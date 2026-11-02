/** @file extension-player.js
 * @brief Play a native Spotify song from a Myspoti audio-source extension through the helper, and show its quality line, playback details, extension manager and store.
 */
(() => {
'use strict';

/*
 * Playback switch policy (the page side of docs/EXTENSIONS.md "재생").
 *
 * Spotify always starts a song at once; the lookup never holds it back.
 * - Answer already known (asked ahead about 10 s into the previous song): at the song change the
 *   engine is paused straight away and the extension audio starts from the engine's position (about
 *   0 s). Spotify's own sound is not heard, as on Android where a warmed song opens at once.
 * - Answer arriving while the song plays: accepted up to POLICY.switchWindowMs after the song
 *   started. The extension audio is loaded muted and played alongside Spotify, then aligned to the
 *   engine's position (held or moved ahead); once both are at the same point the engine is paused
 *   and the extension audio unmuted in the same task, so the switch has no gap and no jump back.
 *   An answer later than the window, or audio not ready within POLICY.handoverMs, leaves the song
 *   to Spotify: a late jump of sound in the middle of a song is worse than staying.
 * - Not found, runner unavailable (503), not acceptable, other device, YouTube link playback:
 *   Spotify simply plays; nothing on screen changes but the quality line ("Spotify").
 * - Address refused (401, 403, 404, 410) or a media error: /ext/audio/again once, then back to
 *   Spotify at the same position, with the fallback noted for "Why this source?".
 */

const Model = (() => {
    const POLICY = {
        switchWindowMs: 10000, handoverMs: 8000, handoverLeadSec: 0.8, alignSec: 0.12, holdMaxSec: 3,
        maxHandoverSeeks: 3, aheadAtMs: 10000, aheadKeepMs: 10 * 60000, expirySafetyMs: 30000,
        transitionMs: 4000, restartBackSec: 3, lookupTimeoutMs: 17000, stateKeepMs: 10000,
    };
    const REFUSED = [401, 403, 404, 410];

    // Every string the module shows. English is the default; a later pass adds languages here.
    const STRINGS = {
        en: {
            details_title: 'Playback details', quality_title: 'Sound quality', quality_now: 'Playing now: %1',
            quality_unknown: 'Not known yet: start a song', quality_spotify: 'Spotify plays this song with its own quality setting.',
            announced: 'Announced by the source: %1', detected: 'Detected by the player: %1',
            detected_note: 'What the player received. Windows mixes the sound, so it is not a bit-perfect output.',
            other_device: 'Another device plays: extensions are used when this computer plays.',
            source_title: 'Source', source_detail: 'Plays this song and the next ones from the source you pick, until Spotify is closed. Your order stays as it is.',
            source_playing: 'Playing now', source_tag: 'temporary', source_reset: 'Back to my order',
            source_missing: "%1 doesn't have this song: it goes on from where it played, and your order stays as it was.",
            source_next: '%1 plays from the next song: this one goes on as it plays.',
            source_active: 'Temporary choice for this session: %1 is asked first, until Spotify is closed.',
            source_none: 'No audio source extension is turned on.',
            why_title: 'Why this source?', why_none: 'No extension attempt recorded for this song yet.', why_asked: 'Sources asked',
            why_ms: '%1 · %2 ms', why_skipped: 'skipped: %1', why_chosen: 'Chosen: %1', why_none_chosen: 'No source had it',
            why_open_ok: 'Opened in %1 ms', why_open_failed: 'Failed to open after %1 ms: %2', why_http: 'HTTP %1',
            why_announced: 'Announced by the source: %1', why_ext_quality: 'Its setting: %1 (%2)', why_detected: 'Detected by the player: %1',
            why_fallback: 'Fallback: %1', why_error: 'Last error: %1', why_ahead: 'Asked ahead, before the song played',
            outcome_found: 'found', outcome_not_found: 'not found', outcome_sign_in: 'sign-in needed', outcome_rate_limited: 'rate limited',
            outcome_quality_unavailable: 'quality unavailable', outcome_server_down: 'server down', outcome_network: 'network error or timeout',
            outcome_skipped: 'skipped', outcome_bug: 'extension error',
            note_picked: 'picked in the player for this session', note_goes_on: 'the song goes on where it played',
            note_recent_miss: 'Spotify: no extension had it under a minute ago, not asked again', note_no_source: 'Spotify: no source to ask',
            note_none_had: 'Spotify: no extension had it', note_refused: 'asked the extensions again: its address was refused (expired or gone)',
            note_set_aside: 'set aside: %1', note_inactive: 'inactive: %1',
            manage_title: 'Extensions', manage_open: 'Manage extensions', loading: 'Reading…', play: 'Play', pause: 'Pause',
            third_party: 'Extensions are made by third parties and are not reviewed by Spotify Hangul Lyrics. You are responsible for the sources you install.',
            install_title: 'Install from an address', install_hint: 'Repository or package address (https://…)', install_continue: 'Continue',
            install_error: 'Not installed: %1', prompt_install: 'Install %1?', prompt_update: 'Update %1?', prompt_by: '%1 · version %2',
            prompt_source: 'From %1', prompt_replaces: 'Replaces the installed version %1',
            prompt_changes: 'What changes', actions_title: 'What it does', action_critical: 'Critical', action_no_why: '(no reason given)',
            action_hosts: 'Websites: %1', action_any_host: 'any website',
            critical_warning: 'Critical actions can change your account, replace where songs come from or show a free web page. Allow them only if you trust the author.',
            risk_accept: 'I understand this extension is made by a third party and I install it on my own responsibility',
            install: 'Install', update_accept: 'Accept', cancel: 'Cancel', installed_done: '%1 is installed',
            installed_title: 'Installed', none_installed: 'No extension installed.', by: 'by %1', version: 'Version %1',
            status_running: 'Running', status_off: 'Off', status_inactive: 'Inactive: %1', status_turned_off: 'Turned off: %1', enabled: 'On',
            settings: 'Settings', settings_none: 'This extension has no settings.', save: 'Save', saved: 'Saved',
            setting_readonly: 'Not editable here',
            check_update: 'Check for updates', check_up_to_date: 'Up to date', check_applied: 'Updated: it asks nothing new',
            check_needs_ok: 'An update needs your OK', check_incompatible: 'The new version needs a newer app',
            check_blocked: 'The new version is blocked', check_failed: 'Could not check: %1',
            change_action: 'New: %1', change_host: 'New website: %1', change_any_host: 'Any website', change_why: 'New reason for %1',
            change_code: 'Its code changed', change_other: 'Changed: %1',
            remove: 'Remove', remove_sure: 'Remove now', remove_confirm: 'Remove %1? Its settings and what it stored go with it.',
            order_title: 'Audio sources', order_footer: 'Asked from top to bottom for each song: the first one that has it plays it.',
            order_spotify_detail: 'Plays when no source above it has the song', order_below: 'Not asked: Spotify is above',
            move_up: 'Move up', move_down: 'Move down',
            error_runner_missing: 'The extension runner is not installed on this PC.', error_runner_failed: 'The extension runner could not start. Songs play from Spotify.',
            error_network: 'The helper did not answer.', error_other: 'Not done: %1',
            check_waiting: 'An update was found: it is applied a day after it was published', check_repo_changed: 'Its repository changed: the update is refused',
            check_declined: 'You kept this version', check_source_gone: 'Its repository no longer exists: it keeps running from the copy on this PC',
            check_not_repository: 'Installed from a package address: there is no repository to check',
            status_idle: 'On', status_cooldown: 'Set aside for now: %1', status_sign_in: 'Sign in again: %1', status_error: 'Last error: %1',
            prompt_new: 'new in this version', prompt_not_newer: 'This version (or a newer one) is already installed.',
            prompt_incompatible: 'This version needs a newer app', install_missing: 'Every action it lists must be accepted: %1',
            clash_title: 'Which one to keep?', clash_exclusive: 'Replaces %1, currently provided by %2', clash_conflict: 'Incompatible with %1 (installed)',
            clash_replaces: 'Replaces %1 (installed)', clash_keep_new: 'Use %1 (the other stays installed, %2)', clash_keep_old: 'Keep %1',
            clash_idle: 'idle', clash_off: 'turned off',
            setting_set: 'Set (hidden)', setting_unset: 'Not set', setting_default: 'Default', setting_pressed: 'Done',
            tab_store: 'Store', tab_installed_updates: 'Installed (%1)', store_search: 'Search extensions',
            cat_all: 'All', cat_lyrics: 'Lyrics', cat_playback: 'Playback & audio', cat_library: 'Library', cat_discovery: 'Discovery',
            cat_stats: 'Stats', cat_look: 'Look & feel', cat_social: 'Social', cat_tools: 'Tools', cat_other: 'Other',
            store_official: 'Official', store_yours: 'Added by you', store_official_note: 'Myspoti reviews each extension before it is listed.',
            store_yours_note: 'Not reviewed by Myspoti: install at your own risk.', store_repo_error: 'Could not read this repository: %1',
            store_repo_empty: 'This repository lists no extension.', store_community_title: 'On GitHub, GitLab and Codeberg', store_community: 'Community',
            store_community_note: 'Published by the community, not reviewed by Myspoti. Each author is responsible for their extension.',
            store_search_error: 'Could not search: %1', rating_none: 'No votes yet', rating: '★ %1 · %2 votes',
            show_all: 'Show all (%1 hidden)', show_less: 'Hide blocked, reported, low-rated and abandoned ones', store_no_match: 'No extension matches.',
            store_empty_title: 'What are extensions?',
            store_empty_body: 'Extensions are Myspoti add-ons made by third parties, such as other sources for the audio of a song. Each one runs in a sandbox and asks before it reaches anything. Add a repository to browse its extensions, or pick one the community published below.',
            other_ways: 'Other ways to install', repo_add: 'Add a repository', repo_hint: 'https://…/index.json',
            repo_warning: 'Myspoti does not review a repository you add: what you install from it is at your own risk.', refresh: 'Refresh',
            store_installed: 'Installed', store_update: 'Update', store_requires_api: 'Made for a newer Myspoti (extension API %1)',
            store_requires: 'Requires Myspoti %1 or newer', author_owner: 'by %1 · repository by %2', author_unverified: 'by %1 · not verified',
            store_back: 'Back to the store', store_not_listed: 'This extension is no longer listed (or the store is still loading).',
            details: 'Details', detail_updated: 'Updated', detail_min_app: 'Needs Myspoti', detail_size: 'Size', detail_sha: 'Package sha256',
            detail_kb: '%1 KB', changelog: "What's new", homepage: 'Homepage', repository: 'Repository', downloads: '%1 downloads',
            update_from: 'Update available: %1 → %2',
        },
        ko: {
            details_title: '재생 상세 정보', quality_title: '음질', quality_now: '현재 재생 중: %1',
            quality_unknown: '아직 알 수 없음: 곡을 재생하세요', quality_spotify: 'Spotify가 자체 음질 설정으로 이 곡을 재생합니다.',
            announced: '소스가 알린 정보: %1', detected: '플레이어가 감지한 정보: %1',
            detected_note: '플레이어가 받은 형식입니다. Windows가 소리를 섞어 출력하므로 원음 그대로 나가지는 않습니다.',
            other_device: '다른 기기에서 재생 중입니다. 확장은 이 컴퓨터에서 재생할 때 사용됩니다.',
            source_title: '소스', source_detail: 'Spotify를 닫을 때까지 이 곡과 다음 곡들을 선택한 소스에서 재생합니다. 설정한 순서는 그대로 유지됩니다.',
            source_playing: '지금 재생 중', source_tag: '임시', source_reset: '내 순서로 돌아가기',
            source_missing: '%1에 이 곡이 없습니다. 재생하던 소스에서 계속 재생되며, 순서는 그대로 유지됩니다.',
            source_next: '%1에서 다음 곡부터 재생합니다. 이 곡은 지금처럼 계속 재생됩니다.',
            source_active: '이번 세션의 임시 선택: Spotify를 닫을 때까지 %1을(를) 가장 먼저 확인합니다.',
            source_none: '켜진 오디오 소스 확장이 없습니다.',
            why_title: '이 소스를 선택한 이유', why_none: '이 곡에 대해 기록된 확장 시도가 아직 없습니다.', why_asked: '확인한 소스',
            why_ms: '%1 · %2 ms', why_skipped: '건너뜀: %1', why_chosen: '선택됨: %1', why_none_chosen: '곡을 가진 소스가 없음',
            why_open_ok: '%1 ms 만에 열림', why_open_failed: '%1 ms 후 열기 실패: %2', why_http: 'HTTP %1',
            why_announced: '소스가 알린 정보: %1', why_ext_quality: '자체 설정: %1(%2)', why_detected: '플레이어가 감지한 정보: %1',
            why_fallback: '대체: %1', why_error: '마지막 오류: %1', why_ahead: '곡을 재생하기 전에 미리 확인함',
            outcome_found: '찾음', outcome_not_found: '찾지 못함', outcome_sign_in: '로그인 필요', outcome_rate_limited: '요청 한도 초과',
            outcome_quality_unavailable: '해당 음질 없음', outcome_server_down: '서버 중단', outcome_network: '네트워크 오류 또는 시간 초과',
            outcome_skipped: '건너뜀', outcome_bug: '확장 오류',
            note_picked: '이번 실행 동안 플레이어에서 선택함', note_goes_on: '곡은 재생하던 곳에서 계속됩니다',
            note_recent_miss: 'Spotify: 1분 안에 이 곡을 가진 확장이 없어 다시 묻지 않음', note_no_source: 'Spotify: 물어볼 소스가 없음',
            note_none_had: 'Spotify: 이 곡을 가진 확장이 없음', note_refused: '확장에 다시 물음: 음원 주소가 거부됨(만료되었거나 사라짐)',
            note_set_aside: '잠시 제외됨: %1', note_inactive: '비활성: %1',
            manage_title: '확장', manage_open: '확장 관리', loading: '읽는 중…', play: '재생', pause: '일시정지',
            third_party: '확장은 제3자가 만들며 Spotify 한글 가사가 검토하지 않습니다. 설치하는 소스에 대한 책임은 사용자에게 있습니다.',
            install_title: '주소로 설치', install_hint: '저장소 또는 패키지 주소(https://…)', install_continue: '계속',
            install_error: '설치하지 못했습니다: %1', prompt_install: '%1을(를) 설치할까요?', prompt_update: '%1을(를) 업데이트할까요?', prompt_by: '%1 · 버전 %2',
            prompt_source: '출처: %1', prompt_replaces: '설치된 버전 %1을(를) 교체합니다',
            prompt_changes: '바뀌는 점', actions_title: '하는 일', action_critical: '고위험', action_no_why: '(이유를 밝히지 않음)',
            action_hosts: '웹사이트: %1', action_any_host: '모든 웹사이트',
            critical_warning: '고위험 작업은 계정을 변경하거나, 곡을 가져오는 곳을 바꾸거나, 임의의 웹페이지를 표시할 수 있습니다. 만든 사람을 신뢰하는 경우에만 허용하세요.',
            risk_accept: '이 확장은 제3자가 만들었으며, 본인의 책임하에 설치한다는 것을 이해합니다',
            install: '설치', update_accept: '수락', cancel: '취소', installed_done: '%1을(를) 설치했습니다',
            installed_title: '설치됨', none_installed: '설치된 확장이 없습니다.', by: '만든 사람: %1', version: '버전 %1',
            status_running: '실행 중', status_off: '꺼짐', status_inactive: '비활성: %1', status_turned_off: '꺼짐: %1', enabled: '켜짐',
            settings: '설정', settings_none: '이 확장에는 설정이 없습니다.', save: '저장', saved: '저장했습니다',
            setting_readonly: '여기서는 바꿀 수 없음',
            check_update: '업데이트 확인', check_up_to_date: '최신 상태', check_applied: '업데이트되었습니다. 새로 요청하는 권한은 없습니다',
            check_needs_ok: '승인이 필요한 업데이트가 있습니다', check_incompatible: '새 버전에는 더 최신 앱이 필요합니다',
            check_blocked: '새 버전은 차단되었습니다', check_failed: '확인할 수 없습니다: %1',
            change_action: '새로 추가: %1', change_host: '새 웹사이트: %1', change_any_host: '모든 웹사이트', change_why: '%1의 새 이유',
            change_code: '코드가 바뀜', change_other: '바뀜: %1',
            remove: '제거', remove_sure: '제거 확정', remove_confirm: '%1을(를) 제거할까요? 설정과 저장된 데이터도 함께 삭제됩니다.',
            order_title: '오디오 소스', order_footer: '각 곡마다 위에서 아래로 확인합니다. 곡을 가진 첫 번째 소스에서 재생됩니다.',
            order_spotify_detail: '위에 있는 소스에 곡이 없을 때 재생됩니다', order_below: '묻지 않음: Spotify가 위에 있습니다',
            move_up: '위로 이동', move_down: '아래로 이동',
            error_runner_missing: '이 PC에 확장 실행기가 설치되어 있지 않습니다.', error_runner_failed: '확장 실행기를 시작하지 못했습니다. 곡은 Spotify에서 재생됩니다.',
            error_network: '도우미가 응답하지 않았습니다.', error_other: '처리하지 못했습니다: %1',
            check_waiting: '업데이트를 찾았습니다. 게시되고 하루 뒤에 적용됩니다', check_repo_changed: '저장소가 바뀌어 업데이트를 거부했습니다',
            check_declined: '현재 버전을 유지했습니다', check_source_gone: '저장소가 더 이상 없습니다. 이 PC에 있는 사본으로 계속 실행됩니다',
            check_not_repository: '패키지 주소로 설치해 확인할 저장소가 없습니다',
            status_idle: '켜짐', status_cooldown: '잠시 제외됨: %1', status_sign_in: '다시 로그인 필요: %1', status_error: '마지막 오류: %1',
            prompt_new: '이 버전에서 새로 추가됨', prompt_not_newer: '이 버전(또는 더 최신 버전)이 이미 설치되어 있습니다.',
            prompt_incompatible: '이 버전에는 더 최신 앱이 필요합니다', install_missing: '나열된 작업을 모두 수락해야 합니다: %1',
            clash_title: '어느 것을 유지할까요?', clash_exclusive: '%2이(가) 현재 제공 중인 %1을(를) 대체합니다', clash_conflict: '%1(설치됨)과(와) 호환되지 않음',
            clash_replaces: '%1(설치됨)을(를) 대체함', clash_keep_new: '%1 사용(다른 확장은 %2 상태로 설치 유지)', clash_keep_old: '%1 유지',
            clash_idle: '대기', clash_off: '꺼짐',
            setting_set: '설정됨(표시하지 않음)', setting_unset: '설정 안 됨', setting_default: '기본값', setting_pressed: '완료',
            tab_store: '스토어', tab_installed_updates: '설치됨(%1)', store_search: '확장 검색',
            cat_all: '모두', cat_lyrics: '가사', cat_playback: '재생 & 오디오', cat_library: '라이브러리', cat_discovery: '탐색',
            cat_stats: '통계', cat_look: '화면 & 테마', cat_social: '소셜', cat_tools: '도구', cat_other: '기타',
            store_official: '공식', store_yours: '직접 추가함', store_official_note: 'Myspoti가 목록에 올리기 전에 각 확장을 검토합니다.',
            store_yours_note: 'Myspoti가 검토하지 않았습니다. 설치에 따른 위험은 본인이 책임집니다.', store_repo_error: '이 저장소를 읽을 수 없습니다: %1',
            store_repo_empty: '이 저장소에 등록된 확장이 없습니다.', store_community_title: 'GitHub, GitLab, Codeberg에서', store_community: '커뮤니티',
            store_community_note: '커뮤니티가 게시했으며 Myspoti가 검토하지 않았습니다. 각 확장의 책임은 만든 사람에게 있습니다.',
            store_search_error: '검색하지 못했습니다: %1', rating_none: '아직 평가 없음', rating: '★ %1 · %2표',
            show_all: '모두 보기(%1개 숨겨짐)', show_less: '차단, 신고, 낮은 평점, 방치된 확장 숨기기', store_no_match: '일치하는 확장이 없습니다.',
            store_empty_title: '확장이란?',
            store_empty_body: '확장은 제3자가 만든 Myspoti 추가 기능으로, 곡의 오디오를 가져올 다른 소스 등이 있습니다. 각 확장은 샌드박스에서 실행되며 무언가에 접근하기 전에 먼저 묻습니다. 저장소를 추가해 확장을 둘러보거나, 아래에서 커뮤니티가 게시한 확장을 고르세요.',
            other_ways: '다른 설치 방법', repo_add: '저장소 추가', repo_hint: 'https://…/index.json',
            repo_warning: 'Myspoti는 직접 추가한 저장소를 검토하지 않습니다. 이 저장소에서 설치하는 확장의 위험은 본인이 책임집니다.', refresh: '새로고침',
            store_installed: '설치됨', store_update: '업데이트', store_requires_api: '더 최신 Myspoti용입니다(확장 API %1)',
            store_requires: 'Myspoti %1 이상 필요', author_owner: '제작 %1 · 저장소 %2', author_unverified: '제작 %1 · 인증되지 않음',
            store_back: '스토어로 돌아가기', store_not_listed: '이 확장은 더 이상 목록에 없습니다(또는 스토어를 아직 불러오는 중입니다).',
            details: '세부정보', detail_updated: '최종 업데이트', detail_min_app: '필요한 Myspoti 버전', detail_size: '크기', detail_sha: '패키지 sha256',
            detail_kb: '%1 KB', changelog: '변경 사항', homepage: '홈페이지', repository: '저장소', downloads: '다운로드 %1회',
            update_from: '업데이트 가능: %1 → %2',
        },
    };
    const OUTCOMES = { 'found': 'outcome_found', 'not-found': 'outcome_not_found', 'sign-in': 'outcome_sign_in', 'rate-limited': 'outcome_rate_limited',
        'quality-unavailable': 'outcome_quality_unavailable', 'server-down': 'outcome_server_down', 'network': 'outcome_network', 'skipped': 'outcome_skipped' };
    // The engine's fixed English notes (Extensions, ExtensionAudio); an extension's own text is shown as it is.
    const NOTES = {
        'picked in the player for this session': 'note_picked', 'the song goes on where it played': 'note_goes_on',
        'Spotify: no extension had it under a minute ago, not asked again': 'note_recent_miss', 'Spotify: no source to ask': 'note_no_source',
        'Spotify: no extension had it': 'note_none_had', 'asked the extensions again: its address was refused (expired or gone)': 'note_refused',
    };
    const PREFIXED = [['set aside: ', 'note_set_aside'], ['inactive: ', 'note_inactive']];
    const ACTIONS = {
        en: { 'playback.control': 'Control playback', 'playback.queue': 'Edit the queue', 'playback.events': 'Know what you play',
            'lyrics.provide': 'Provide lyrics', 'trackinfo.provide': 'Add song details', 'audio.source': 'Play audio from elsewhere',
            'download.source': 'Provide downloads', 'home.sections': 'Add Home sections', 'search.provide': 'Add search results',
            'menu.items': 'Add menu entries', 'player.buttons': 'Add player buttons', 'settings.page': 'Its own settings', 'notify': 'Show short messages',
            'library.read': 'Read your library', 'library.write': 'Change your library', 'playlists.write': 'Edit your playlists',
            'spotify.catalog': 'Browse Spotify', 'spotify.raw': 'Full Spotify access', 'network': 'Use the internet', 'network.any': 'Use any website',
            'webview.page': 'Its own web page', 'webview.auth': 'Sign in on a website', 'storage': 'Keep its own data', 'attest': 'Prove this is Myspoti' },
        ko: { 'playback.control': '재생 제어', 'playback.queue': '재생목록 편집', 'playback.events': '재생하는 곡 정보 받기',
            'lyrics.provide': '가사 제공', 'trackinfo.provide': '곡 정보 추가', 'audio.source': '다른 곳의 오디오로 재생',
            'download.source': '다운로드 제공', 'home.sections': '홈 섹션 추가', 'search.provide': '검색 결과 추가',
            'menu.items': '메뉴 항목 추가', 'player.buttons': '플레이어 버튼 추가', 'settings.page': '자체 설정 페이지', 'notify': '짧은 메시지 표시',
            'library.read': '라이브러리 읽기', 'library.write': '라이브러리 변경', 'playlists.write': '플레이리스트 편집',
            'spotify.catalog': 'Spotify 둘러보기', 'spotify.raw': 'Spotify 전체 접근', 'network': '인터넷 사용', 'network.any': '모든 웹사이트 사용',
            'webview.page': '자체 웹페이지', 'webview.auth': '웹사이트에서 로그인', 'storage': '자체 데이터 저장', 'attest': 'Myspoti임을 증명' },
    };
    const EDITABLE = ['text', 'secret', 'toggle', 'number', 'choice'];
    // Measured through the output mix (dB below full volume), the same tables as youtube-links.js:
    // Spotify's slider against an <audio> element's volume.
    const SPOTIFY_DB = [[0, -120], [2, -52.1], [5, -41.6], [10, -34.8], [15, -32.6], [20, -30.8], [30, -26.6], [40, -22.4], [50, -18.5], [60, -15.2], [70, -11.4], [80, -8.1], [90, -4], [95, -2], [100, 0]];
    const AUDIO_DB = [[0, -120], [.25, -46.7], [.5, -40.3], [1, -34], [2, -27.9], [3, -24.7], [5, -21.1], [10, -16.7], [20, -11.2], [30, -8.2], [40, -6.5], [50, -4.9], [60, -3.9], [70, -2.8], [80, -1.9], [90, -1.1], [100, 0]];

    const language = locale => /^ko(?:[-_]|$)/i.test(String(locale || '')) ? 'ko' : 'en';
    function t(lang, key, ...args) {
        const text = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
        return text.replace(/%(\d)/g, (mark, n) => args[n - 1] === undefined ? mark : String(args[n - 1]));
    }
    const maskText = text => String(text ?? '').replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, url => url.split(/[?#]/)[0].replace(/\/\/[^/@]*@/, '//'));
    const kHz = hz => (hz % 1000 === 0 ? String(hz / 1000) : (hz / 1000).toFixed(1)) + ' kHz';
    const clock = seconds => { const s = Math.max(0, Math.floor(Number(seconds) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

    /** "FLAC · 24-bit · 48 kHz" from what the source announced, else its own short text; "" when it said nothing. */
    function qualityLabel(stream) {
        if (!stream || typeof stream !== 'object') return '';
        const depth = Number(stream.bitDepth), rate = Number(stream.sampleRate);
        const parts = [
            typeof stream.codec === 'string' && stream.codec.trim() ? stream.codec.trim().toUpperCase().slice(0, 16) : null,
            Number.isInteger(depth) && depth >= 8 && depth <= 32 ? depth + '-bit' : null,
            Number.isFinite(rate) && rate >= 8000 && rate <= 768000 ? kHz(rate) : null,
        ].filter(Boolean);
        if (parts.length) return parts.join(' · ');
        // The runner's own label (the source's free text when it gave no codec, depth or rate).
        return stream.quality ? String(stream.quality).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    }
    /** The line under the playbar: "<source> · FLAC · 24-bit · 48 kHz", "Spotify", with the temporary tag of a session pick. */
    function sourceLine(lang, playing) {
        const label = playing?.extension ? [playing.name || playing.extension, qualityLabel(playing.stream)].filter(Boolean).join(' · ') : 'Spotify';
        return playing?.temporary ? label + ' · ' + t(lang, 'source_tag') : label;
    }
    /** What the page measured: "audio/flac · 3:45 · 2116 kbit/s"; "" when nothing is known. */
    function detectedLabel({ mime, durationSec, bytes, sampleRate } = {}) {
        const type = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase().slice(0, 40) : '';
        const duration = Number(durationSec), size = Number(bytes), rate = Number(sampleRate);
        return [type || null, Number.isFinite(rate) && rate >= 8000 ? kHz(rate) : null,
            Number.isFinite(duration) && duration > 0 ? clock(duration) : null,
            Number.isFinite(duration) && duration > 0 && size > 0 ? Math.round(size * 8 / duration / 1000) + ' kbit/s' : null].filter(Boolean).join(' · ');
    }

    /** Whether a song is asked for: 'ask', or why not ('not-track', 'remote', 'link', 'off'). */
    function shouldAsk({ uri, remote, linkBusy, state }) {
        if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(String(uri || ''))) return 'not-track';
        if (remote) return 'remote';
        if (linkBusy) return 'link';
        return state?.available && state.audio ? 'ask' : 'off';
    }
    /**
     * What to do with an answer: 'spotify' (none), 'start' (known at the song change, or Spotify is
     * paused: switch now), 'handover' (aligned switch while Spotify plays), 'late' (past the window:
     * Spotify keeps the song). [sinceSongMs] counts from the song's start, not from when it was seen.
     */
    function onAnswer({ found, sinceSongMs, known, playing }) {
        if (!found) return 'spotify';
        if (known || !playing) return 'start';
        return sinceSongMs <= POLICY.switchWindowMs ? 'handover' : 'late';
    }
    /** One step of the aligned switch: both at the same point ('commit'), hold the extension audio ('wait'), or move it ahead ('seek'). */
    function handoverStep(audioSec, engineSec, seeks = 0) {
        const diff = audioSec - engineSec;
        if (Math.abs(diff) <= POLICY.alignSec || seeks >= POLICY.maxHandoverSeeks) return { action: 'commit' };
        if (diff > 0 && diff <= POLICY.holdMaxSec) return { action: 'wait', ms: Math.round(diff * 1000) };
        return { action: 'seek', to: Math.max(0, engineSec + POLICY.handoverLeadSec * (seeks + 1)) };
    }
    const refused = status => REFUSED.includes(Number(status));
    const previousAction = seconds => Number(seconds) > POLICY.restartBackSec ? 'restart' : 'previous';
    function lookup(table, x, from, to) {
        const index = table.findIndex(row => x <= row[from]);
        if (index <= 0) return table[index < 0 ? table.length - 1 : 0][to];
        const [a, b] = [table[index - 1], table[index]];
        return a[to] + (b[to] - a[to]) * (x - a[from]) / (b[from] - a[from]);
    }
    /** The <audio> volume (0..1) that sounds like Spotify's slider [level] (0..1). */
    function volumeFor(level, muted) {
        const slider = Math.max(0, Math.min(100, (Number(level) || 0) * 100));
        if (muted || !slider) return 0;
        return Math.max(0, Math.min(1, lookup(AUDIO_DB, lookup(SPOTIFY_DB, slider, 0, 1), 1, 0) / 100));
    }
    /** An answer asked ahead is used while it is fresh: at most aheadKeepMs, less when the runner says when it expires (epoch ms). */
    function aheadFresh(entry, now) {
        if (!entry?.answer.found) return false;
        const expires = entry.answer.stream.expiresAt;
        return now < (expires ? Math.min(entry.at + POLICY.aheadKeepMs, expires - POLICY.expirySafetyMs) : entry.at + POLICY.aheadKeepMs);
    }
    // The helper's media address of a found answer; anything else is not played.
    const mediaPath = answer => /^\/ext\/media\/[A-Za-z0-9_-]{8,80}$/.test(answer.stream.media) ? answer.stream.media : null;

    function image(value) {
        const text = String(value || '');
        const id = text.match(/^spotify:image:([a-f0-9]{20,64})$/i)?.[1];
        if (id) return 'https://i.scdn.co/image/' + id;
        return /^https:\/\/[^\s]+$/.test(text) ? text : null;
    }
    /** The song as the runner's TrackInfo, from Spicetify's player item or a queue entry; null for what is not a catalog track. */
    function trackInfo(item) {
        const uri = String(item?.uri || ''), id = uri.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
        if (!id) return null;
        const meta = item.metadata || {};
        const listed = Array.isArray(item.artists) ? item.artists.map(a => String(a?.name || '').trim()).filter(Boolean) : [];
        const artists = listed.length ? listed : [meta.artist_name, ...[1, 2, 3, 4, 5].map(n => meta['artist_name:' + n])].map(a => String(a || '').trim()).filter(Boolean);
        const duration = Number(item.duration?.milliseconds ?? meta.duration) || 0;
        const isrc = [meta.isrc, item.isrc, item.external_ids?.isrc].find(value => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(String(value || '')));
        const cover = [item.album?.images?.[0]?.url, meta.image_xlarge_url, meta.image_large_url, meta.image_url].map(image).find(Boolean);
        return { id, uri, title: String(item.name || meta.title || '').slice(0, 300), artist: artists[0] || '', artists,
            album: String(item.album?.name || meta.album_title || '').slice(0, 300), durationMs: Math.max(0, Math.round(duration)),
            ...(isrc ? { isrc: String(isrc).toUpperCase() } : {}), ...(cover ? { cover } : {}) };
    }

    const outcomeLabel = (lang, key) => t(lang, OUTCOMES[key] || 'outcome_bug');
    /** A note ("a; b" parts) in the page's language where it is one of the engine's fixed ones. */
    function note(lang, text) {
        return String(text ?? '').split('; ').map(part => {
            if (NOTES[part]) return t(lang, NOTES[part]);
            const prefixed = PREFIXED.find(([prefix]) => part.startsWith(prefix));
            return prefixed ? t(lang, prefixed[1], part.slice(prefixed[0].length)) : part;
        }).join('; ');
    }
    /** "Why this source?" as lines ({kind: head | line | muted, text}), as Android's WhySourceSheet writes them. */
    function attemptLines(lang, attempt, names = {}, detected = null) {
        if (!attempt) return [{ kind: 'muted', text: t(lang, 'why_none') }];
        const nameOf = id => names[id] || id;
        const { asked, open } = attempt, seen = detected || attempt.detected;
        return [
            ...(attempt.ahead ? [{ kind: 'muted', text: t(lang, 'why_ahead') }] : []),
            { kind: 'head', text: t(lang, 'why_asked') },
            ...asked.map(a => ({ kind: 'line', text: nameOf(a.extension) + ' — '
                + (a.skippedReason ? t(lang, 'why_skipped', note(lang, maskText(a.skippedReason))) : t(lang, 'why_ms', outcomeLabel(lang, a.outcome), a.ms))
                + (a.detail ? ' (' + note(lang, maskText(a.detail)) + ')' : '') })),
            { kind: 'line', text: attempt.chosen ? t(lang, 'why_chosen', nameOf(attempt.chosen)) : t(lang, 'why_none_chosen') },
            ...(open ? [{ kind: 'line', text: (open.ok ? t(lang, 'why_open_ok', open.ms) : t(lang, 'why_open_failed', open.ms, maskText(open.error || '?')))
                + (open.httpStatus ? ' · ' + t(lang, 'why_http', open.httpStatus) : '') }] : []),
            ...(attempt.announced ? [{ kind: 'line', text: t(lang, 'why_announced', attempt.announced) }] : []),
            ...(attempt.sourceQuality && attempt.chosen ? [{ kind: 'line', text: t(lang, 'why_ext_quality', attempt.sourceQuality, nameOf(attempt.chosen)) }] : []),
            ...(seen ? [{ kind: 'line', text: t(lang, 'why_detected', seen) }] : []),
            ...(attempt.fallback ? [{ kind: 'muted', text: t(lang, 'why_fallback', note(lang, maskText(attempt.fallback))) }] : []),
            ...(attempt.error ? [{ kind: 'muted', text: t(lang, 'why_error', maskText(attempt.error)) }] : []),
        ];
    }

    const actionLabel = (lang, key) => ACTIONS[lang]?.[key] ?? ACTIONS.en[key] ?? String(key);
    /**
     * The install or update prompt from a preview (or an update's `pending`): critical actions first,
     * then the manifest's order, each clash with the choice it offers, and what may not be installed.
     */
    function consent(preview) {
        const actions = preview.asks.map((a, index) => ({ ...a, index }))
            .sort((a, b) => Number(b.critical) - Number(a.critical) || a.index - b.index);
        return {
            pending: preview.pending, plan: preview.plan, manifest: preview.manifest, source: preview.source,
            compatible: preview.compatible, critical: preview.critical, replaces: preview.replaces?.version || '',
            clashes: preview.clashes, changes: preview.changes || [], actions, granted: preview.asks.map(a => a.key),
            installable: preview.plan !== 'not-newer' && preview.compatible,
        };
    }
    /** What confirm sends for the clash choices: per other extension, false keeps it and leaves the new one off. */
    const keepChoices = (clashes, keepNew) => Object.fromEntries(clashes.map(c => [c.other, keepNew(c.other) !== false]));
    /** An update's change (Change, serialized) as one line, with whether it is critical. */
    function changeLine(lang, change) {
        const text = change.kind === 'ACTION' ? t(lang, 'change_action', actionLabel(lang, change.key))
            : change.kind === 'HOST' ? (change.key === '*' ? t(lang, 'change_any_host') : t(lang, 'change_host', change.key))
            : change.kind === 'WHY' ? t(lang, 'change_why', actionLabel(lang, change.key))
            : change.kind === 'CODE' ? t(lang, 'change_code') : t(lang, 'change_other', change.key || change.kind.toLowerCase());
        return { text, critical: change.critical === true };
    }
    // Updates.Result keys.
    const UPDATE_RESULTS = { 'up-to-date': 'check_up_to_date', 'applied': 'check_applied', 'waiting': 'check_waiting', 'repo-changed': 'check_repo_changed',
        'needs-ok': 'check_needs_ok', 'declined': 'check_declined', 'source-gone': 'check_source_gone', 'incompatible': 'check_incompatible',
        'blocked': 'check_blocked', 'not-from-a-repository': 'check_not_repository', 'failed': 'check_failed' };
    const updateMessage = (lang, result) => t(lang, UPDATE_RESULTS[result] || 'check_failed', result);
    /** The extension's state line: off (and why), inactive, set aside, waiting to sign in, its last error, or running. */
    function statusLine(lang, extension) {
        if (!extension.enabled) return { text: extension.disabledReason ? t(lang, 'status_turned_off', extension.disabledReason) : t(lang, 'status_off'), ok: false };
        if (extension.status && !extension.status.live) return { text: t(lang, 'status_inactive', extension.status.detail || extension.status.state), ok: false };
        if (extension.cooldown) return { text: t(lang, 'status_cooldown', extension.cooldown), ok: false };
        if (extension.signIn) return { text: t(lang, 'status_sign_in', extension.signIn), ok: false };
        if (extension.error) return { text: t(lang, 'status_error', extension.error), ok: false };
        return { text: t(lang, extension.running ? 'status_running' : 'status_idle'), ok: true };
    }

    /**
     * The settings form: each field with the value shown (the user's, else the default) and how it is
     * changed: edited (text, secret, toggle, number, choice), pressed (button) or shown only. A secret's
     * value never reaches the page: only whether one is set. The PC is never on mobile data, so a
     * per-network setting shows and sets its Wi-Fi value.
     */
    function settingFields(extension) {
        return extension.settings.map(s => {
            const value = s.type === 'secret' ? '' : s.set && s.value !== null && s.value !== undefined ? s.value : s.default;
            return { key: s.key, type: s.type, label: s.label, description: s.description, options: s.options, set: s.set,
                value: s.type === 'toggle' ? value === true : value ?? '',
                mode: s.type === 'button' ? 'press' : EDITABLE.includes(s.type) && (s.type !== 'choice' || s.options.length > 0) ? 'edit' : 'show' };
        });
    }
    /**
     * The values to save: only the fields the user changed (a secret when something was typed),
     * typed as the settings declare them; null puts a setting back to its default.
     */
    function settingValues(fields, read, reset = new Set()) {
        return Object.fromEntries(fields.filter(f => f.mode === 'edit').flatMap(f => {
            if (reset.has(f.key)) return [[f.key, null]];
            const raw = read(f.key);
            if (f.type === 'secret') return raw ? [[f.key, String(raw)]] : [];
            const value = f.type === 'toggle' ? raw === true : f.type === 'number' ? (raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw)) : String(raw ?? '');
            return value === null || value === f.value ? [] : [[f.key, value]];
        }));
    }
    function orderMove(order, id, delta) {
        const result = [...order], from = result.indexOf(id), to = from + delta;
        if (from < 0 || to < 0 || to >= result.length) return result;
        result.splice(to, 0, ...result.splice(from, 1));
        return result;
    }
    function errorKey(status, value) {
        if (value.error === 'runner-missing') return 'error_runner_missing';
        if (value.error === 'runner-failed' || status === 503) return 'error_runner_failed';
        if (status === 0) return 'error_network';
        return 'error_other';
    }


    // ── Store (the Android app's Store tab, from GET /v1/store) ──
    const CATEGORIES = ['lyrics', 'playback', 'library', 'discovery', 'stats', 'look', 'social', 'tools', 'other'];
    /** Whether [entry] is in [category] (null: any) and every word of [query] is in its name, author, description, id or tags (engine Store.matches). */
    function storeMatches(entry, query, category) {
        if (category && entry.category !== category) return false;
        const hay = [entry.name, entry.author, entry.description, entry.id, (entry.tags || []).join(' ')].join(' ').toLowerCase();
        return String(query || '').toLowerCase().split(' ').filter(word => word.trim()).every(word => hay.includes(word));
    }
    /**
     * What the Store view shows: each repository with the rows matching the search, the community's
     * rows in the runner's order without the hidden ones unless [showAll], the categories that have
     * something in them, the empty state (no repository to show) and the "no match" line.
     */
    function storeView(store, { query = '', category = null, showAll = false } = {}) {
        const repos = (Array.isArray(store?.repos) ? store.repos : []).map(repo => {
            const entries = Array.isArray(repo.extensions) ? repo.extensions : [];
            return { ...repo, entries, rows: entries.filter(e => storeMatches(e, query, category)) };
        });
        const c = store?.community && typeof store.community === 'object' ? store.community : null;
        const all = Array.isArray(c?.extensions) ? c.extensions : [];
        const listed = all.filter(e => showAll || !e.hidden), hidden = Number(c?.hidden) || 0;
        const community = c ? { ...c, rows: listed.filter(e => storeMatches(e, query, category)), hidden, toggle: hidden > 0 || showAll } : null;
        const present = new Set([...repos.flatMap(r => r.entries), ...listed].map(e => e.category));
        const shown = repos.reduce((n, r) => n + r.rows.length, 0) + (community?.rows.length || 0);
        return { repos, community, categories: CATEGORIES.filter(key => present.has(key) || key === category),
            empty: repos.length === 0, noMatch: shown === 0 && (repos.some(r => r.entries.length) || all.length > 0) };
    }
    /** "★ 4.8 · 20 votes" (the runner's Bayesian stars), or "No votes yet". */
    const ratingLine = (lang, rating) => !rating || !Number(rating.votes) ? t(lang, 'rating_none') : t(lang, 'rating', Number(rating.stars).toFixed(1), rating.votes);
    /** The manifest's author is the package's own claim: shown with the repository's owner, else as not verified. */
    const authorLine = (lang, entry) => entry.owner ? t(lang, 'author_owner', entry.author, entry.owner) : t(lang, 'author_unverified', entry.author);
    /** Why it cannot be installed here: a newer extension API, or a newer Myspoti engine. */
    const incompatibleLine = (lang, entry) => entry.needsApi ? t(lang, 'store_requires_api', entry.apiVersion) : t(lang, 'store_requires', entry.minAppVersion || '');
    /** The row's one button (engine StoreAction): its label and whether it acts. */
    function storeButton(lang, entry) {
        const key = { install: 'install', update: 'store_update', installed: 'store_installed', incompatible: 'install' }[entry.action] || 'install';
        return { action: entry.action, label: t(lang, key), enabled: entry.action !== 'incompatible' };
    }
    /** The GitHub repository whose release downloads are counted (`owner/name`), or null (GitLab, Codeberg, an address). */
    const downloadsRepo = entry => /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(String(entry?.repo || '')) ? entry.repo : null;
    /** The updates waiting: the installed extensions a repository has a newer version of, and those staged for the user's OK. */
    function updateCount(installed, store) {
        const ids = new Set((installed || []).filter(e => e.pendingUpdate).map(e => e.id));
        [...(store?.repos || []).flatMap(r => r.extensions || []), ...(store?.community?.extensions || [])].forEach(e => { if (e.action === 'update') ids.add(e.id); });
        return ids.size;
    }
    const httpsOnly = value => /^https:\/\/[^\s"'<>]+$/.test(String(value || '')) ? value : null;

    return { POLICY, STRINGS, language, t, maskText, qualityLabel, sourceLine, detectedLabel, shouldAsk, onAnswer, handoverStep,
        refused, previousAction, volumeFor, aheadFresh, mediaPath, trackInfo, outcomeLabel, note, attemptLines, actionLabel, consent,
        keepChoices, changeLine, updateMessage, statusLine, settingFields, settingValues, orderMove, errorKey, clock,
        CATEGORIES, storeMatches, storeView, ratingLine, authorLine, incompatibleLine, storeButton, downloadsRepo, updateCount, httpsOnly };
})();

if (typeof module !== 'undefined') module.exports = Model;
if (typeof window === 'undefined') return;

function create(host, options = {}) {
    const BASE = 'http://127.0.0.1:19643';
    const Spicetify = host.Spicetify, doc = host.document;
    // Spicetify replaces its Player object after the page starts: the one in use is followed (bindPlayer).
    let Player = Spicetify.Player;
    const lang = Model.language(Spicetify.Locale?.getLocale?.() || host.navigator?.language);
    const t = (key, ...args) => Model.t(lang, key, ...args);
    const ivLyrics = options.ivLyrics || null, linkBusy = () => !!options.linkBusy?.();
    const P = Model.POLICY, now = () => Date.now();
    const audio = new host.Audio();
    audio.preload = 'auto';
    const originals = {}, listeners = [], savedNodes = new Map();
    let disposed = false, epoch = 0, song = null, mode = 'spotify', answer = null, lookup = null, intent = false;
    let transitionUntil = 0, pinned = 0, pinUntil = 0, retried = false, openedAt = 0, opened = false, startAt = null;
    let handover = null, detected = '', clockShown = false, dragging = false, aheadFor = null, state = null, stateAt = 0, lead = null;
    const ahead = new Map(), names = new Map();

    const remote = () => Spicetify.Platform?.ConnectAPI?.state?.activeDevice?.isLocal === false;
    const engineProgress = () => Number(originals.getProgress.call(Player)) || 0;
    const enginePlaying = () => !!originals.isPlaying.call(Player);
    const enginePause = () => originals.pause.call(Player);
    const owning = () => mode === 'extension' && !linkBusy();
    const extSeconds = () => Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const extDuration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (song?.track.durationMs || 0) / 1000;

    async function call(method, path, body, timeoutMs = 20000, signal) {
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, timeoutMs);
        try {
            const response = await host.fetch(BASE + path, method === 'GET' ? { signal: controller.signal, cache: 'no-store' } : {
                method, signal: controller.signal, body: JSON.stringify(body || {}),
                headers: { 'Content-Type': 'application/json', 'X-Hangul-Lyrics-Client': 'ivlyrics' } });
            return { status: response.status, value: await response.json().catch(() => ({})) };
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
    // A helper or runner that cannot be reached is the same as no answer: Spotify plays.
    const quiet = promise => promise.catch(error => ({ status: 0, value: { error: error?.name === 'AbortError' ? 'aborted' : 'network' } }));
    async function readState(force = false) {
        if (!force && state && now() - stateAt < P.stateKeepMs) return state;
        const { status, value } = await quiet(call('GET', '/ext/state', null, 3000));
        state = status === 200 ? value : null; stateAt = now();
        return state;
    }
    // Read again every stateKeepMs while it plays: a state missed at start (the helper not ready) or an extension
    // installed since would otherwise wait for the next song, with no quality line and the song left to Spotify.
    // The song last looked at, and whether it played elsewhere then: playback moved back here asks it again.
    let stateReading = false, seenUri;
    const seenKey = () => (Player.data?.item?.uri || '') + (remote() ? ' remote' : '');
    function refreshState() {
        if (stateReading || now() - stateAt < P.stateKeepMs) return;
        stateReading = true;
        const had = !!state?.audio;
        void readState(true).then(next => {
            stateReading = false;
            if (!had && next?.audio && mode === 'spotify' && !disposed) void onSong();
        });
    }
    const note = body => song && quiet(call('POST', '/ext/attempts/note', { trackId: song.track.id, ...body }, 8000));
    const playingInfo = () => mode === 'extension' && answer ? { extension: answer.extension, name: answer.name || names.get(answer.extension),
        stream: answer.stream, temporary: !!lead } : { temporary: !!lead };

    // ── Audio element ──
    function syncVolume() { audio.volume = Model.volumeFor(Player.getVolume?.(), !!Player.getMute?.()); }
    function load(next, { at = 0, play = false, silent = false } = {}) {
        answer = next; opened = false; detected = ''; openedAt = performance.now(); startAt = at;
        audio.muted = silent; syncVolume();
        audio.src = BASE + Model.mediaPath(next);
        if (play) audio.play().catch(playRefused);
    }
    function clearAudio() { startAt = null; audio.pause(); audio.removeAttribute('src'); audio.load(); }
    function playRefused(error) { if (error?.name !== 'AbortError') failed(String(error?.message || error)); }
    function onMetadata() {
        if (startAt === null) return;
        audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity, startAt));
        startAt = null;
    }
    async function onOpened() {
        if (opened || !answer) return;
        opened = true;
        const ms = Math.round(performance.now() - openedAt), current = song, media = Model.mediaPath(answer);
        const probe = await probeMedia(media);
        if (song !== current) return;
        detected = Model.detectedLabel({ mime: probe.type, durationSec: audio.duration, bytes: probe.bytes });
        note({ open: { ok: true, ms, ...(probe.status ? { httpStatus: probe.status } : {}) }, ...(detected ? { detected } : {}) });
        render();
    }
    /** The status, type and size of a small range of the address (the <audio> element does not tell them). */
    async function probeMedia(media) {
        if (!media) return {};
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
        try {
            const response = await host.fetch(BASE + media, { headers: { Range: 'bytes=0-0' }, signal: controller.signal, cache: 'no-store' });
            const bytes = Number(response.headers.get('Content-Range')?.match(/\/(\d+)$/)?.[1]) || null;
            return { status: response.status, type: response.headers.get('Content-Type'), bytes };
        } catch (error) {
            return { error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error) };
        } finally { clearTimeout(timer); controller.abort(); }
    }
    const MEDIA_ERRORS = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'not supported' };
    async function failed(reason) {
        if (mode === 'spotify' || !answer || !song) return;
        const current = song, at = mode === 'extension' ? extSeconds() : null, ms = Math.round(performance.now() - openedAt);
        const error = reason || 'media ' + (MEDIA_ERRORS[audio.error?.code] || 'error');
        const probe = await probeMedia(Model.mediaPath(answer));
        if (song !== current) return;
        note({ open: { ok: false, ms, error, ...(probe.status ? { httpStatus: probe.status } : {}) } });
        // Refused (401, 403, 404, 410) or any other media failure: the source is asked once more.
        if (!retried) {
            retried = true;
            const { status, value } = await quiet(call('POST', '/ext/audio/again', { track: current.track }, P.lookupTimeoutMs));
            if (song !== current) return;
            if (status === 200 && value.found && Model.mediaPath(value)) {
                if (mode === 'pending' || at === null) startHandover(value);
                else load(value, { at, play: intent });
                return;
            }
        }
        giveBack(at, error);
    }
    /** Spotify plays the song again, at [at] seconds when the extension had played it. */
    function giveBack(at, error) {
        const wasOwning = mode === 'extension';
        stopExtension();
        if (wasOwning && at !== null) { originals.seek.call(Player, Math.round(at * 1000)); if (intent) originals.play.call(Player); }
        note({ fallback: 'Spotify', ...(error ? { error } : {}) });
        render();
    }
    function stopExtension() {
        clearTimeout(handover?.timer); clearTimeout(handover?.deadline); handover = null;
        clearAudio(); mode = 'spotify'; answer = null; restoreBar(); showClock();
    }

    // ── Switching ──
    function startNow(next) {
        mode = 'extension'; retried = false;
        enginePause(); transitionUntil = now() + P.transitionMs; pinUntil = transitionUntil;
        load(next, { at: engineProgress() / 1000, play: intent });
        render();
    }
    function startHandover(next) {
        clearTimeout(handover?.timer); clearTimeout(handover?.deadline);
        mode = 'pending';
        const current = song;
        handover = { seeks: 0, timer: null, deadline: setTimeout(() => {
            if (song !== current || mode !== 'pending') return;
            note({ open: { ok: false, ms: P.handoverMs, error: 'not ready in time' }, fallback: 'Spotify' });
            stopExtension(); render();
        }, P.handoverMs) };
        load(next, { at: engineProgress() / 1000 + P.handoverLeadSec, play: true, silent: true });
    }
    function handoverTick() {
        if (mode !== 'pending' || !handover || handover.timer || audio.paused || audio.readyState < 3) return;
        if (!enginePlaying()) { commit(false); return; }
        const step = Model.handoverStep(extSeconds(), engineProgress() / 1000, handover.seeks);
        if (step.action === 'commit') commit(true);
        else if (step.action === 'seek') { handover.seeks++; audio.currentTime = step.to; }
        else { audio.pause(); handover.timer = setTimeout(() => { if (mode !== 'pending') return; handover.timer = null; audio.play().catch(playRefused); commit(true); }, step.ms); }
    }
    /** The engine stops and the extension audio is heard, in the same task. */
    function commit(playing) {
        clearTimeout(handover?.deadline); handover = null;
        if (!playing) { audio.pause(); audio.currentTime = engineProgress() / 1000; }
        enginePause(); intent = playing; mode = 'extension';
        transitionUntil = now() + P.transitionMs; pinUntil = transitionUntil;
        syncVolume(); audio.muted = false;
        render();
    }

    async function onSong() {
        if (disposed) return;
        const resume = mode === 'extension' ? intent : null;
        epoch++; lookup?.abort(); lookup = null;
        if (mode !== 'spotify') stopExtension();
        const mine = epoch, item = Player.data?.item, track = Model.trackInfo(item);
        seenUri = seenKey();
        song = track ? { uri: track.uri, track, startedAt: now() - engineProgress() } : null;
        retried = false; aheadFor = null; detected = '';
        // Spotify was paused under the extension audio: when this song stays with Spotify, it plays as the extension did.
        const keepPlaying = () => { if (resume && mine === epoch && mode === 'spotify' && !enginePlaying()) originals.play.call(Player); };
        render();
        const reason = Model.shouldAsk({ uri: item?.uri, remote: remote(), linkBusy: linkBusy(), state: await readState() });
        if (mine !== epoch) return;
        if (reason !== 'ask') { setTimeout(keepPlaying, 400); return; }
        intent = resume ?? enginePlaying();
        const kept = ahead.get(track.id);
        ahead.delete(track.id);
        if (Model.aheadFresh(kept, now()) && Model.mediaPath(kept.answer)) { startNow(kept.answer); return; }
        setTimeout(keepPlaying, 400);
        const controller = new AbortController(); lookup = controller;
        const { status, value } = await quiet(call('POST', '/ext/audio', { track }, P.lookupTimeoutMs, controller.signal));
        if (mine !== epoch || controller.signal.aborted) return;
        lookup = null;
        if (status === 200 && value.name && value.extension) names.set(value.extension, value.name);
        const playing = enginePlaying();
        const decision = Model.onAnswer({ found: status === 200 && !!value.found && !!Model.mediaPath(value), sinceSongMs: now() - song.startedAt, known: false, playing });
        if (remote() || linkBusy()) return;
        if (decision === 'start') {
            // Paused now: by the user (it stays paused), or Spotify did not start after the extension's song (it plays on).
            if (resume !== true) intent = false;
            startNow(value);
        } else if (decision === 'handover') startHandover(value);
        else if (decision === 'late') note({ fallback: 'Spotify', error: 'answered after ' + Math.round((now() - song.startedAt) / 1000) + ' s' });
        render();
    }
    function maybeAhead() {
        if (!song || aheadFor === song.uri || !state?.audio || remote() || linkBusy()) return;
        const position = mode === 'extension' ? extSeconds() * 1000 : engineProgress();
        if (position < P.aheadAtMs) return;
        aheadFor = song.uri;
        const entry = (Spicetify.Queue?.nextTracks || []).map(e => e?.contextTrack || e).find(e => /^spotify:track:/.test(String(e?.uri || '')));
        const next = Model.trackInfo(entry);
        if (!next || next.id === song.track.id || Model.aheadFresh(ahead.get(next.id), now())) return;
        quiet(call('POST', '/ext/audio', { track: next, ahead: true }, P.lookupTimeoutMs)).then(({ status, value }) => {
            if (disposed || status !== 200 || !value.found || !Model.mediaPath(value)) return;
            if (value.name && value.extension) names.set(value.extension, value.name);
            ahead.set(next.id, { answer: value, at: now() });
            [...ahead.keys()].slice(0, Math.max(0, ahead.size - 4)).forEach(key => ahead.delete(key));
        });
    }

    // ── Transport while the extension plays ──
    function toggle() { setIntent(audio.paused); }
    function setIntent(play) {
        intent = !!play;
        if (intent) audio.play().catch(playRefused); else audio.pause();
        render();
    }
    function seekTo(seconds) { audio.currentTime = Math.max(0, Math.min(extDuration() || Infinity, Number(seconds) || 0)); showClock(); updateBar(); }
    function nextSong() { transitionUntil = now() + P.transitionMs; originals.next.call(Player); }
    function previous() {
        if (Model.previousAction(extSeconds()) === 'restart') { seekTo(0); return; }
        // Spotify restarts its song rather than going back when its own position is past 3 s.
        originals.seek.call(Player, 0); pinned = 0;
        transitionUntil = now() + P.transitionMs;
        originals.back.call(Player);
    }
    function ended() {
        if (!owning()) return;
        if (Player.getRepeat?.() === 2) { audio.currentTime = 0; audio.play().catch(playRefused); return; }
        nextSong();
    }
    const handlers = {
        togglePlay: toggle, play: () => setIntent(true), pause: () => setIntent(false),
        seek: value => { const n = Number(value); seekTo(n > 0 && n <= 1 ? n * extDuration() : n / 1000); },
        getProgress: () => Math.round(extSeconds() * 1000), isPlaying: () => !audio.paused,
        next: nextSong, back: previous,
    };
    ['setVolume', 'increaseVolume', 'decreaseVolume', 'toggleMute', 'setMute'].forEach(name => { handlers[name] = null; });
    function wrapPlayer() {
        Object.keys(handlers).filter(name => typeof Player[name] === 'function').forEach(name => {
            const original = Player[name]; originals[name] = original;
            Player[name] = function (...args) {
                if (!owning()) return original.apply(this, args);
                if (handlers[name]) return handlers[name](...args);
                const result = original.apply(this, args); syncVolume(); return result;
            };
        });
    }
    function unwrapPlayer() {
        Object.entries(originals).forEach(([name, original]) => { Player[name] = original; delete originals[name]; });
        Player.removeEventListener?.('songchange', songChanged); Player.removeEventListener?.('onplaypause', guardEngine);
    }
    /** Moves the wrapped controls and the listeners to the Player Spicetify now has, then looks at its song. */
    function bindPlayer() {
        const next = host.Spicetify?.Player;
        if (!next || next === Player) return false;
        unwrapPlayer();
        Player = next;
        wrapPlayer(); listenPlayer();
        return true;
    }
    wrapPlayer();

    function tick() {
        if (disposed) return;
        if (bindPlayer() && mode === 'spotify') { void onSong(); return; }
        if (mode !== 'spotify') {
            if (linkBusy()) { stopExtension(); render(); return; }   // The link player took over and paused Spotify itself.
            if (Player.data?.item?.uri !== song?.uri) { void onSong(); return; }
            if (remote()) { const at = mode === 'extension' ? extSeconds() : null; stopExtension(); if (at !== null) originals.seek.call(Player, Math.round(at * 1000)); render(); return; }
        }
        if (mode === 'extension') {
            guardEngine();
            const position = engineProgress();
            // A seek on Spotify's own controls moves the paused engine: the extension audio follows it.
            if (!dragging) {
                if (now() > pinUntil && Math.abs(position - pinned) > 1500) seekTo(position / 1000);
                pinned = position;
            }
            syncVolume(); updateBar();
        }
        // Spotify restores the last song after the page starts without a songchange: a song seen here and not
        // asked yet is asked now, or it would stay with Spotify and show no line until the next one.
        else if (seenKey() !== seenUri) { void onSong(); return; }
        refreshState(); showClock(); maybeAhead(); renderLine();
    }
    /** The engine stays paused under the extension audio; past the switch, a play sent to Spotify (media key, tray, Connect) toggles this song. */
    function guardEngine() {
        // A new song Spotify starts (next, previous, a click in a list) is left to onSong.
        if (mode !== 'extension' || !enginePlaying() || Player.data?.item?.uri !== song?.uri) return;
        enginePause();
        if (now() > transitionUntil) toggle();
    }
    function showClock() {
        if (!ivLyrics?.setExternalClock) return;
        if (mode === 'extension' && song) { ivLyrics.setExternalClock({ uri: song.uri, seconds: extSeconds(), duration: extDuration(), playing: !audio.paused }); clockShown = true; }
        else if (clockShown) { ivLyrics.setExternalClock(null); clockShown = false; }
    }

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('canplay', () => { void onOpened(); handoverTick(); });
    audio.addEventListener('playing', handoverTick);
    audio.addEventListener('seeked', handoverTick);
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', () => { if (audio.getAttribute('src')) void failed(); });
    ['play', 'pause', 'timeupdate'].forEach(name => audio.addEventListener(name, () => { if (mode === 'extension') { showClock(); updateBar(); } }));

    // ── Native playbar ──
    const rememberNode = node => {
        if (node && !savedNodes.has(node)) savedNodes.set(node, { text: node.textContent, html: node.namespaceURI === 'http://www.w3.org/2000/svg' ? node.innerHTML : null,
            viewBox: node.getAttribute('viewBox'), label: node.getAttribute('aria-label'), valueText: node.getAttribute('aria-valuetext'),
            max: node.getAttribute('max'), value: node.value, style: node.getAttribute('style') });
        return node;
    };
    const setText = (node, value) => { if (node && node.textContent !== value) { rememberNode(node); node.textContent = value; } };
    function restoreBar() {
        savedNodes.forEach((old, node) => {
            if (!node.isConnected) return;
            if (old.html !== null) { node.innerHTML = old.html; if (old.viewBox === null) node.removeAttribute('viewBox'); else node.setAttribute('viewBox', old.viewBox); }
            else if (node.tagName === 'INPUT') { node.max = old.max; node.value = old.value; }
            else if (node.tagName !== 'BUTTON' && node.getAttribute('data-testid') !== 'progress-bar') node.textContent = old.text;
            delete node.dataset.hangulExtState;
            [['aria-label', 'label'], ['aria-valuetext', 'valueText'], ['style', 'style']].forEach(([attr, key]) => {
                if (old[key] === null) node.removeAttribute(attr); else node.setAttribute(attr, old[key]);
            });
        });
        savedNodes.clear();
    }
    function updateBar() {
        const bar = doc.querySelector('[data-testid="now-playing-bar"]');
        if (!bar || mode !== 'extension') return;
        const playing = !audio.paused, seconds = extSeconds(), duration = extDuration();
        const play = bar.querySelector('[data-testid="control-button-playpause"]');
        if (play) {
            rememberNode(play); play.setAttribute('aria-label', t(playing ? 'pause' : 'play'));
            const svg = play.querySelector('svg');
            if (svg && play.dataset.hangulExtState !== String(playing)) {
                rememberNode(svg); svg.setAttribute('viewBox', '0 0 16 16');
                svg.innerHTML = playing ? '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>' : '<path d="M4 2v12l10-6z"/>';
            }
            play.dataset.hangulExtState = String(playing);
        }
        const progress = bar.querySelector('.playback-bar');
        if (!progress || dragging) return;
        const texts = progress.querySelectorAll('[data-testid="playback-position"],[data-testid="playback-duration"]');
        if (texts.length) { setText(texts[0], Model.clock(seconds)); if (texts.length > 1) setText(texts[texts.length - 1], Model.clock(duration)); }
        const range = progress.querySelector('input[type="range"]');
        if (range) { rememberNode(range); range.max = String(Math.round(duration * 1000)); range.value = String(Math.round(seconds * 1000)); range.setAttribute('aria-valuetext', Model.clock(seconds) + '/' + Model.clock(duration)); }
        const visual = progress.querySelector('[data-testid="progress-bar"]');
        if (visual) { rememberNode(visual); visual.style.setProperty('--progress-bar-transform', (duration ? Math.min(100, seconds / duration * 100) : 0) + '%'); }
    }
    function click(event) {
        if (!owning()) return;
        const target = event.target.closest?.('button');
        if (!target?.closest('[data-testid="now-playing-bar"]')) return;
        const action = { 'control-button-playpause': toggle, 'control-button-skip-back': previous, 'control-button-skip-forward': nextSong }[target.dataset.testid];
        if (!action) return;
        event.preventDefault(); event.stopImmediatePropagation(); action(); updateBar();
    }
    function keyboard(event) {
        if (!owning() || event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.target.closest?.('input,textarea,select,button,[role="button"],[contenteditable=true]')) return;
        event.preventDefault(); event.stopImmediatePropagation(); toggle();
    }
    const pointerDown = event => { if (event.target.closest?.('[data-testid="now-playing-bar"] .playback-bar')) dragging = true; };
    const pointerUp = () => { dragging = false; };
    [['click', click], ['keydown', keyboard], ['pointerdown', pointerDown], ['pointerup', pointerUp]].forEach(([name, fn]) => {
        doc.addEventListener(name, fn, true); listeners.push(() => doc.removeEventListener(name, fn, true));
    });
    function songChanged() { void onSong(); }
    function listenPlayer() { Player.addEventListener?.('songchange', songChanged); Player.addEventListener?.('onplaypause', guardEngine); }
    listenPlayer();

    // ── Quality line, playback details and manager ──
    const style = doc.createElement('style');
    style.textContent = `
        .hl-ext-line{background:none;border:0;padding:2px 6px;margin:0 6px 0 0;border-radius:4px;color:var(--text-subdued,#b3b3b3);font:11px/1.3 var(--encore-body-font-stack,system-ui);max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;flex:0 1 auto}
        .hl-ext-line:hover{color:var(--text-base,#fff)}.hl-ext-line[data-source=extension]{color:var(--text-bright-accent,#1ed760)}
        .hl-ext{display:grid;gap:14px;font:14px/1.45 var(--encore-body-font-stack,system-ui);color:var(--text-base,#fff)}
        .hl-ext h3{margin:6px 0 2px;font-size:16px}.hl-ext h4{margin:4px 0 0;font-size:14px}.hl-ext p{margin:0}.hl-ext-muted{color:var(--text-subdued,#b3b3b3)}.hl-ext-green{color:var(--text-bright-accent,#1ed760)}
        .hl-ext-warn{color:var(--text-warning,#ffa42b)}.hl-ext-card{display:grid;gap:8px;padding:12px;border-radius:8px;background:var(--background-elevated-base,#242424)}
        .hl-ext-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.hl-ext-row>.hl-ext-grow{flex:1;min-width:160px}
        .hl-ext button{background:transparent;color:var(--text-base,#fff);border:1px solid #ffffff50;border-radius:20px;padding:6px 14px;cursor:pointer;font:inherit}
        .hl-ext button:hover{border-color:#fff}.hl-ext button:disabled{opacity:.45;cursor:default}.hl-ext button.hl-ext-primary{background:var(--background-base-accent,#1ed760);color:#000;border-color:transparent;font-weight:700}
        .hl-ext button.hl-ext-choice{border-radius:6px;text-align:left;display:flex;justify-content:space-between;gap:8px;width:100%}
        .hl-ext button.hl-ext-choice[aria-pressed=true]{border-color:var(--text-bright-accent,#1ed760)}
        .hl-ext input[type=text],.hl-ext input[type=password],.hl-ext input[type=number],.hl-ext input[type=url],.hl-ext select{background:#2a2a2a;color:#fff;border:1px solid #777;border-radius:4px;padding:8px;font:inherit;min-width:0}
        .hl-ext-action{padding:6px 8px;border-left:3px solid transparent}.hl-ext-action[data-critical=true]{border-left-color:var(--text-warning,#ffa42b)}
        .hl-ext img.hl-ext-icon{width:36px;height:36px;border-radius:6px;object-fit:cover}
        .hl-ext button.hl-ext-tab[aria-pressed=true],.hl-ext button.hl-ext-chip[aria-pressed=true]{background:#fff;color:#000;border-color:#fff}
        .hl-ext button.hl-ext-chip{padding:4px 12px;font-size:13px}.hl-ext button.hl-ext-text-button{border:0;padding:4px 0;color:var(--text-bright-accent,#1ed760);justify-self:start}
        .hl-ext input.hl-ext-search{width:100%;box-sizing:border-box}.hl-ext-store-section{display:grid;gap:4px}
        .hl-ext-store-row{padding:8px;border-radius:6px;cursor:pointer;flex-wrap:nowrap}.hl-ext-store-row:hover{background:#ffffff12}
        .hl-ext-pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;background:#2a2a2a;color:var(--text-subdued,#b3b3b3)}
        .hl-ext-pill-accent{background:#1ed76030;color:var(--text-bright-accent,#1ed760)}.hl-ext-pill-warn{background:#ffa42b26;color:var(--text-warning,#ffa42b)}
        .hl-ext-mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all}.hl-ext-small{font-size:12px}.hl-ext-label{min-width:150px}
        .hl-ext-clip{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.hl-ext-link{color:var(--text-bright-accent,#1ed760)}`;
    doc.head.append(style);
    const el = (tag, text, className) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
    const button = (text, action, className) => {
        const node = el('button', text, className); node.type = 'button';
        node.onclick = () => { Promise.resolve().then(action).catch(error => Spicetify.showNotification?.(t('error_other', error?.message || error), true)); };
        return node;
    };
    const line = el('button', '', 'hl-ext-line');
    line.dataset.testid = 'hangul-extension-quality';
    line.onclick = () => { void openDetails(); };
    function renderLine() {
        const installed = !!state?.installed, show = installed && !remote() && !!song && !linkBusy();
        line.hidden = !show;
        if (!show) return;
        const text = Model.sourceLine(lang, playingInfo());
        if (line.textContent !== text) { line.textContent = text; line.title = t('details_title') + ': ' + text; }
        line.dataset.source = mode === 'extension' ? 'extension' : 'spotify';
        if (line.isConnected) return;
        // At the start of the playbar's right-hand controls, before the volume.
        const bar = doc.querySelector('[data-testid="now-playing-bar"]');
        const anchor = ['[data-testid="volume-bar"]', '[data-testid="control-button-queue"]', '[data-testid="lyrics-button"]'].map(selector => bar?.querySelector(selector)).find(Boolean);
        anchor?.parentElement?.insertBefore(line, anchor.parentElement.firstChild);
    }
    let detailsBox = null;
    function render() { renderLine(); if (detailsBox?.isConnected) void fillDetails(detailsBox); }

    async function openDetails() {
        detailsBox = el('div', undefined, 'hl-ext');
        detailsBox.append(el('p', t('loading'), 'hl-ext-muted'));
        Spicetify.PopupModal.display({ title: t('details_title'), content: detailsBox, isLarge: true });
        await fillDetails(detailsBox);
    }
    async function fillDetails(box) {
        const current = song;
        const [extensions, session, attempt] = await Promise.all([
            quiet(call('GET', '/ext/extensions', null, 8000)), quiet(call('GET', '/ext/session', null, 8000)),
            current ? quiet(call('GET', '/ext/attempts/latest?track=' + encodeURIComponent(current.track.id), null, 8000)) : Promise.resolve({ status: 0, value: null })]);
        if (box !== detailsBox || song !== current) return;
        if (extensions.status === 200) extensions.value.extensions.forEach(e => names.set(e.id, e.name));
        if (session.status === 200) lead = session.value.source;
        const nameOf = id => id === 'spotify' ? 'Spotify' : names.get(id) || id;
        const quality = el('section'); quality.append(el('h3', t('quality_title')));
        if (remote()) quality.append(el('p', t('other_device'), 'hl-ext-muted'));
        else if (!current) quality.append(el('p', t('quality_unknown'), 'hl-ext-green'));
        else {
            quality.append(el('p', t('quality_now', Model.sourceLine(lang, playingInfo())), 'hl-ext-green'));
            if (mode === 'extension') {
                const announced = Model.qualityLabel(answer.stream);
                if (announced) quality.append(el('p', t('announced', announced)));
                if (detected) quality.append(el('p', t('detected', detected)), el('p', t('detected_note'), 'hl-ext-muted'));
            } else quality.append(el('p', t('quality_spotify'), 'hl-ext-muted'));
        }
        const picker = el('section'); picker.append(el('h3', t('source_title')), el('p', t('source_detail'), 'hl-ext-muted'));
        if (session.status !== 200) picker.append(el('p', t(Model.errorKey(session.status, session.value), session.value.error || session.status), 'hl-ext-muted'));
        else if (session.value.choices.length <= 1) picker.append(el('p', t('source_none'), 'hl-ext-muted'));
        else {
            // The runner's choices: Spotify and the sources turned on, in the order they are asked now (the session pick first).
            const playingId = mode === 'extension' ? answer.extension : 'spotify';
            session.value.choices.forEach(id => {
                const row = button('', () => pick(id), 'hl-ext-choice');
                row.setAttribute('aria-pressed', String(id === playingId));
                row.append(el('span', nameOf(id)), el('span', [id === playingId ? t('source_playing') : '', id === lead ? t('source_tag') : ''].filter(Boolean).join(' · '), 'hl-ext-muted'));
                picker.append(row);
            });
            if (lead) picker.append(el('p', t('source_active', nameOf(lead)), 'hl-ext-muted'), button(t('source_reset'), backToOrder));
            picker.append(pickMessage);
        }
        const why = el('section'); why.append(el('h3', t('why_title')));
        Model.attemptLines(lang, attempt.status === 200 ? attempt.value.attempt : null, Object.fromEntries(names), mode === 'extension' ? detected : null)
            .forEach(item => why.append(item.kind === 'head' ? el('h4', item.text) : el('p', item.text, item.kind === 'muted' ? 'hl-ext-muted' : undefined)));
        box.replaceChildren(quality, picker, why, el('div', undefined, 'hl-ext-row'));
        box.lastChild.append(button(t('manage_open'), () => { Spicetify.PopupModal.hide(); void openManager(); }));
    }
    const pickMessage = el('p', '', 'hl-ext-muted');
    async function pick(id) {
        const current = song;
        if (!current) return;
        const at = mode === 'extension' ? extSeconds() : null;
        const { status, value } = await quiet(call('POST', '/ext/audio/pick', { track: current.track, source: id }, P.lookupTimeoutMs));
        if (song !== current) return;
        ahead.clear();
        if (status !== 200) { pickMessage.textContent = t(Model.errorKey(status, value), value.error || status); return; }
        lead = id;
        pickMessage.textContent = '';
        if (value.reason === 'spotify-picked') { if (mode !== 'spotify') giveBack(at); }
        else if (value.found && Model.mediaPath(value)) {
            if (value.name) names.set(id, value.name);
            retried = false;
            // The song goes on where it played, from the source picked.
            if (mode === 'extension') load(value, { at, play: intent });
            else if (enginePlaying()) startHandover(value);
            else { intent = false; startNow(value); }
        } else pickMessage.textContent = t('source_missing', names.get(id) || id);
        render();
    }
    /** Back to the saved order: the runner asks nothing again, the song goes on from where it plays. */
    async function backToOrder() {
        const { status, value } = await quiet(call('POST', '/ext/session', { source: null }));
        if (status !== 200) { pickMessage.textContent = t(Model.errorKey(status, value), value.error || status); return; }
        lead = value.source; ahead.clear();
        render();
    }

    // ── Extension manager: the Store and Installed views, as the Android app's two tabs ──
    let managerBox = null, view = null, storeData = null, storeQuery = '', storeCategory = null, showAll = false, detail = null, storeForce = false;
    const downloadCounts = new Map();
    async function openManager() {
        managerBox = el('div', undefined, 'hl-ext');
        view = null; detail = null;
        Spicetify.PopupModal.display({ title: t('manage_title'), content: managerBox, isLarge: true });
        await fillManager();
    }
    const message = el('p', '', 'hl-ext-muted');
    function showError(status, value) { message.textContent = t(Model.errorKey(status, value), value.error || status); }
    const extensionPath = (id, action) => '/ext/extensions/' + encodeURIComponent(id) + '/' + action;
    async function fillManager() {
        const box = managerBox;
        box.replaceChildren(el('p', t('loading'), 'hl-ext-muted'));
        const [extensions, order] = await Promise.all([quiet(call('GET', '/ext/extensions', null, 25000)), quiet(call('GET', '/ext/order', null, 25000))]);
        if (box !== managerBox) return;
        const list = extensions.status === 200 ? extensions.value.extensions : [];
        list.forEach(e => names.set(e.id, e.name));
        // As on Android: the Store first while nothing is installed, else the installed ones.
        if (view === null) view = list.length ? 'installed' : 'store';
        if (view === 'store') { await fillStore(box, list); return; }
        const install = el('section', undefined, 'hl-ext-card');
        const address = el('input'); address.type = 'url'; address.placeholder = t('install_hint'); address.setAttribute('aria-label', t('install_title')); address.className = 'hl-ext-grow';
        const go = button(t('install_continue'), async () => {
            go.disabled = true; message.textContent = t('loading');
            const { status, value } = await quiet(call('POST', '/ext/install/preview', { url: address.value.trim() }, 120000)).finally(() => { go.disabled = false; });
            if (status !== 200) { message.textContent = t('install_error', value.error || status); return; }
            message.textContent = ''; showConsent(value);
        }, 'hl-ext-primary');
        const row = el('div', undefined, 'hl-ext-row'); row.append(address, go);
        install.append(el('h3', t('install_title')), row, el('p', t('third_party'), 'hl-ext-muted'), message);
        const installed = el('section'); installed.append(el('h3', t('installed_title')));
        if (extensions.status !== 200) installed.append(el('p', t(Model.errorKey(extensions.status, extensions.value), extensions.value.error || extensions.status), 'hl-ext-muted'));
        else if (!list.length) installed.append(el('p', t('none_installed'), 'hl-ext-muted'));
        list.forEach(extension => installed.append(extensionCard(extension)));
        box.replaceChildren(tabs(list), install, installed);
        if (extensions.status === 200 && order.status === 200 && order.value.order.length > 1) box.append(orderCard(order.value.order, list));
    }
    /** "Store" and "Installed", the latter with the number of updates waiting. */
    function tabs(list) {
        const row = el('div', undefined, 'hl-ext-row hl-ext-tabs'), updates = Model.updateCount(list, storeData);
        [['store', t('tab_store')], ['installed', updates ? t('tab_installed_updates', updates) : t('installed_title')]].forEach(([key, label]) => {
            const tab = button(label, () => { view = key; detail = null; message.textContent = ''; return fillManager(); }, 'hl-ext-tab');
            tab.setAttribute('aria-pressed', String(view === key));
            row.append(tab);
        });
        return row;
    }
    const pill = (text, className) => el('span', text, 'hl-ext-pill' + (className ? ' ' + className : ''));
    const link = (text, href) => { const node = el('a', text, 'hl-ext-link'); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; };
    function icon(entry, size) {
        const src = Model.httpsOnly(entry.icon);
        if (!src) return null;
        const node = el('img', undefined, 'hl-ext-icon'); node.alt = ''; node.src = src; node.referrerPolicy = 'no-referrer';
        if (size) { node.style.width = size; node.style.height = size; }
        node.onerror = () => node.remove();
        return node;
    }
    /** The Store view: the repositories, the community's extensions and the other ways to install (or one extension's page). */
    async function fillStore(box, list) {
        const force = storeForce; storeForce = false;
        const { status, value } = await quiet(call('GET', '/ext/store' + (force ? '?force=1' : ''), null, 130000));
        if (box !== managerBox || view !== 'store') return;
        if (status === 200) storeData = value;
        const head = [tabs(list), message];
        if (status !== 200) { box.replaceChildren(...head, el('p', t(Model.errorKey(status, value), value.error || status), 'hl-ext-muted'), otherWays()); return; }
        if (detail) { box.replaceChildren(...head, entryPage(detail)); return; }
        const search = el('input'); search.type = 'text'; search.placeholder = t('store_search'); search.setAttribute('aria-label', t('store_search')); search.value = storeQuery; search.className = 'hl-ext-search';
        const chips = el('div', undefined, 'hl-ext-row hl-ext-chips'), body = el('div', undefined, 'hl-ext');
        const draw = () => {
            const shown = Model.storeView(storeData, { query: storeQuery, category: storeCategory, showAll });
            chips.replaceChildren(...[null, ...shown.categories].map(key => {
                const chip = button(t('cat_' + (key || 'all')), () => { storeCategory = key === storeCategory ? null : key; draw(); }, 'hl-ext-chip');
                chip.setAttribute('aria-pressed', String(key === storeCategory));
                return chip;
            }));
            body.replaceChildren(...storeSections(shown));
        };
        search.oninput = () => { storeQuery = search.value; draw(); };
        draw();
        box.replaceChildren(...head, search, chips, body, otherWays());
    }
    function storeSections(shown) {
        const parts = [];
        if (shown.empty) {
            const empty = el('section'); empty.append(el('h3', t('store_empty_title')), el('p', t('store_empty_body'), 'hl-ext-muted'));
            parts.push(empty);
        }
        shown.repos.forEach(repo => {
            const section = el('section', undefined, 'hl-ext-store-section'), head = el('div', undefined, 'hl-ext-row'), info = el('div', undefined, 'hl-ext-grow');
            const title = el('div', undefined, 'hl-ext-row'); title.append(el('strong', repo.name), repo.official ? pill(t('store_official'), 'hl-ext-pill-accent') : pill(t('store_yours'), 'hl-ext-pill-warn'));
            info.append(title, el('p', repo.url, 'hl-ext-muted hl-ext-mono'), el('p', t(repo.official ? 'store_official_note' : 'store_yours_note'), repo.official ? 'hl-ext-muted' : 'hl-ext-warn'));
            head.append(info, button(t('refresh'), refreshStore));
            if (!repo.official) head.append(button(t('remove'), () => changeRepository({ remove: repo.url })));
            section.append(head);
            if (repo.error) section.append(el('p', t('store_repo_error', repo.error), 'hl-ext-warn'));
            if (repo.loaded && !repo.entries.length) section.append(el('p', t('store_repo_empty'), 'hl-ext-muted'));
            repo.rows.forEach(entry => section.append(storeRow(entry)));
            parts.push(section);
        });
        // Discovered on GitHub, GitLab and Codeberg: by score, then the most recently updated; the hidden ones behind "Show all".
        if (shown.community) {
            const c = shown.community, section = el('section', undefined, 'hl-ext-store-section'), head = el('div', undefined, 'hl-ext-row'), info = el('div', undefined, 'hl-ext-grow');
            const title = el('div', undefined, 'hl-ext-row'); title.append(el('strong', t('store_community_title')), pill(t('store_community'), 'hl-ext-pill-warn'));
            info.append(title, el('p', t('store_community_note'), 'hl-ext-warn'));
            head.append(info, button(t('refresh'), refreshStore));
            section.append(head);
            if (c.error) section.append(el('p', t('store_search_error', c.error), 'hl-ext-warn'));
            c.rows.forEach(entry => section.append(storeRow(entry)));
            if (c.toggle) section.append(button(showAll ? t('show_less') : t('show_all', c.hidden), () => { showAll = !showAll; return fillManager(); }, 'hl-ext-text-button'));
            parts.push(section);
        }
        if (shown.noMatch) parts.push(el('p', t('store_no_match'), 'hl-ext-muted'));
        return parts;
    }
    /** A store row: icon, name, version, one line, its rating, the badge and the one state button; a click opens its page. */
    function storeRow(entry) {
        const row = el('div', undefined, 'hl-ext-row hl-ext-store-row'), info = el('div', undefined, 'hl-ext-grow');
        row.dataset.id = entry.id; row.tabIndex = 0; row.setAttribute('role', 'button');
        const open = () => { detail = { index: entry.index, id: entry.id }; return fillManager(); };
        row.onclick = () => { void open(); };
        row.onkeydown = event => { if (event.key === 'Enter') void open(); };
        const title = el('div', undefined, 'hl-ext-row'); title.append(el('strong', entry.name), pill('v' + entry.version));
        if (entry.action === 'update') title.append(pill(t('store_update'), 'hl-ext-pill-accent'));
        if (entry.action === 'installed') title.append(pill(t('store_installed')));
        info.append(title, entry.action === 'incompatible' ? el('p', Model.incompatibleLine(lang, entry), 'hl-ext-warn')
            : el('p', (entry.description || Model.authorLine(lang, entry)).slice(0, 200), 'hl-ext-muted hl-ext-clip'));
        if (entry.clash) info.append(el('p', t(entry.clash.kind === 'replaces' ? 'clash_replaces' : 'clash_conflict', entry.clash.otherName), 'hl-ext-warn'));
        if (entry.rated) info.append(el('p', [Model.ratingLine(lang, entry.rating), entry.updatedAt ? String(entry.updatedAt).slice(0, 10) : ''].filter(Boolean).join(' · '), entry.hidden ? 'hl-ext-warn hl-ext-small' : 'hl-ext-muted hl-ext-small'));
        else if (entry.updatedAt) info.append(el('p', String(entry.updatedAt).slice(0, 10), 'hl-ext-muted hl-ext-small'));
        const pic = icon(entry);
        row.append(...(pic ? [pic] : []), info, stateButton(entry));
        return row;
    }
    function stateButton(entry) {
        const state = Model.storeButton(lang, entry);
        const node = button(state.label, () => state.action === 'installed' ? openInstalled() : installEntry(entry, node), state.action === 'install' || state.action === 'update' ? 'hl-ext-primary' : undefined);
        const act = node.onclick; node.onclick = event => { event?.stopPropagation?.(); act(); };
        node.disabled = !state.enabled;
        return node;
    }
    const openInstalled = () => { view = 'installed'; detail = null; return fillManager(); };
    const refreshStore = () => { storeForce = true; return fillManager(); };
    async function changeRepository(body) {
        const { status, value } = await quiet(call('POST', '/ext/store/repos', body));
        if (status !== 200) showError(status, value); else message.textContent = '';
        await fillManager();
    }
    /** The package downloaded as Myspoti does it, then the same prompt as an install by address. */
    async function installEntry(entry, node) {
        if (node) node.disabled = true;
        message.textContent = t('loading');
        const { status, value } = await quiet(call('POST', '/ext/store/install', { index: entry.index, id: entry.id }, 130000));
        if (node) node.disabled = false;
        if (status !== 200) { message.textContent = t('install_error', value.detail || value.error || status); return; }
        message.textContent = ''; showConsent(value);
    }
    /** One extension's store page: what it is, its rating and downloads, what it does, and the details checked when it is downloaded. */
    function entryPage({ index, id }) {
        const page = el('section', undefined, 'hl-ext');
        const back = button('← ' + t('store_back'), () => { detail = null; return fillManager(); }, 'hl-ext-text-button');
        const all = [...(storeData?.repos || []).flatMap(r => r.extensions || []), ...(storeData?.community?.extensions || [])];
        const entry = all.find(e => e.index === index && e.id === id);
        if (!entry) { page.append(back, el('p', t('store_not_listed'), 'hl-ext-muted')); return page; }
        const head = el('div', undefined, 'hl-ext-row'), info = el('div', undefined, 'hl-ext-grow'), pic = icon(entry, '72px');
        const tags = el('div', undefined, 'hl-ext-row'); tags.append(pill('v' + entry.version), pill(t('cat_' + (Model.CATEGORIES.includes(entry.category) ? entry.category : 'other')), 'hl-ext-pill-accent'));
        info.append(el('h3', entry.name), el('p', Model.authorLine(lang, entry), 'hl-ext-muted'), tags);
        head.append(...(pic ? [pic] : []), info);
        page.append(back, head);
        if (entry.rated) {
            const counts = el('p', Model.ratingLine(lang, entry.rating), 'hl-ext-muted');
            const repo = Model.downloadsRepo(entry);
            const showCount = () => { const n = downloadCounts.get(repo); if (n !== undefined && n !== null) counts.textContent = Model.ratingLine(lang, entry.rating) + ' · ' + t('downloads', n); };
            if (repo && downloadCounts.has(repo)) showCount();
            else if (repo) void quiet(call('GET', '/ext/store/downloads?repo=' + repo, null, 30000)).then(({ status, value }) => {
                if (status === 200) { downloadCounts.set(repo, value.downloads); showCount(); }
            });
            page.append(counts);
        }
        if (entry.action === 'incompatible') page.append(el('p', Model.incompatibleLine(lang, entry), 'hl-ext-warn'));
        if (entry.action === 'update' && entry.installedVersion) page.append(el('p', t('update_from', entry.installedVersion, entry.version), 'hl-ext-muted'));
        const act = el('div', undefined, 'hl-ext-row'); act.append(stateButton(entry)); page.append(act);
        if (entry.description) page.append(el('p', entry.description.slice(0, 2000)));
        if (entry.tags?.length) { const row = el('div', undefined, 'hl-ext-row'); entry.tags.slice(0, 20).forEach(tag => row.append(pill('#' + tag))); page.append(row); }
        if (entry.changelog) page.append(el('h4', t('changelog')), el('p', entry.changelog.slice(0, 2000), 'hl-ext-muted'));
        if (entry.clash) page.append(el('p', t(entry.clash.kind === 'replaces' ? 'clash_replaces' : 'clash_conflict', entry.clash.otherName), 'hl-ext-warn'));
        const actions = el('div', undefined, 'hl-ext-card'); actions.append(el('strong', t('actions_title')));
        entry.asks.map((a, i) => ({ ...a, i })).sort((a, b) => Number(b.critical) - Number(a.critical) || a.i - b.i).forEach(action => {
            const item = el('div', undefined, 'hl-ext-action'); item.dataset.critical = String(action.critical);
            const label = el('p', Model.actionLabel(lang, action.key) + (action.critical ? ' · ' + t('action_critical') : ''), action.critical ? 'hl-ext-warn' : undefined);
            item.append(label, el('p', action.why || t('action_no_why'), 'hl-ext-muted'));
            if (action.hosts.length) item.append(el('p', t('action_hosts', action.hosts.map(h => h === '*' ? t('action_any_host') : h).join(', ')), 'hl-ext-muted'));
            actions.append(item);
        });
        page.append(actions);
        if (entry.critical) page.append(el('p', t('critical_warning'), 'hl-ext-warn'));
        const facts = el('div', undefined, 'hl-ext-card'); facts.append(el('strong', t('details')));
        const fact = (label, value, mono) => { const row = el('div', undefined, 'hl-ext-row'); row.append(el('span', label, 'hl-ext-muted hl-ext-label'), el('span', value, mono ? 'hl-ext-mono' : undefined)); facts.append(row); };
        if (entry.updatedAt) fact(t('detail_updated'), String(entry.updatedAt).slice(0, 10));
        if (entry.minAppVersion) fact(t('detail_min_app'), entry.minAppVersion);
        if (entry.size > 0) fact(t('detail_size'), t('detail_kb', Math.ceil(entry.size / 1024)));
        // What the package is checked against when it is downloaded.
        if (entry.sha256) fact(t('detail_sha'), entry.sha256.slice(0, 16) + '…', true);
        page.append(facts);
        const links = el('div', undefined, 'hl-ext-row');
        if (Model.httpsOnly(entry.homepage)) links.append(link(t('homepage'), entry.homepage));
        if (Model.httpsOnly(entry.repoPage)) links.append(link(t('repository'), entry.repoPage));
        if (links.childNodes.length) page.append(links);
        page.append(el('p', t('third_party'), 'hl-ext-muted'));
        return page;
    }
    /** At the bottom of the Store: a repository to add (its index address), with what that means. */
    function otherWays() {
        const card = el('section', undefined, 'hl-ext-card');
        const address = el('input'); address.type = 'url'; address.placeholder = t('repo_hint'); address.setAttribute('aria-label', t('repo_add')); address.className = 'hl-ext-grow';
        const add = button(t('repo_add'), () => { const url = address.value.trim(); return url ? changeRepository({ add: url }) : undefined; });
        const row = el('div', undefined, 'hl-ext-row'); row.append(address, add);
        card.append(el('h3', t('other_ways')), el('p', t('repo_warning'), 'hl-ext-muted'), row);
        return card;
    }
    const changed = () => { ahead.clear(); void readState(true).then(render); };
    function extensionCard(extension) {
        const card = el('div', undefined, 'hl-ext-card'), head = el('div', undefined, 'hl-ext-row');
        // The runner gives its icon as a PNG data address, or null.
        if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(extension.icon || '')) { const icon = el('img', undefined, 'hl-ext-icon'); icon.alt = ''; icon.src = extension.icon; head.append(icon); }
        const info = el('div', undefined, 'hl-ext-grow'), state = Model.statusLine(lang, extension);
        info.append(el('strong', extension.name), el('p', [t('version', extension.version), extension.author ? t('by', extension.author) : ''].filter(Boolean).join(' · '), 'hl-ext-muted'),
            el('p', state.text, state.ok ? 'hl-ext-green' : 'hl-ext-muted'));
        if (extension.pendingUpdate) info.append(el('p', t('check_needs_ok') + ': ' + extension.version + ' → ' + extension.pendingUpdate.version, 'hl-ext-warn'));
        if (extension.sourceGone) info.append(el('p', t('check_source_gone'), 'hl-ext-muted'));
        const toggleLabel = el('label', undefined, 'hl-ext-row'), enabled = el('input');
        enabled.type = 'checkbox'; enabled.checked = extension.enabled;
        enabled.onchange = async () => {
            enabled.disabled = true;
            const { status, value } = await quiet(call('POST', extensionPath(extension.id, 'enabled'), { enabled: enabled.checked }));
            if (status !== 200) showError(status, value);
            changed(); await fillManager();
        };
        toggleLabel.append(enabled, el('span', t('enabled')));
        head.append(info, toggleLabel);
        const description = extension.description ? el('p', extension.description.slice(0, 600), 'hl-ext-muted') : null;
        const settingsBox = el('div', undefined, 'hl-ext-card'); settingsBox.hidden = true;
        const actions = el('div', undefined, 'hl-ext-row');
        // Asked in the page, pressed twice: Spotify's browser may answer window.confirm with no dialog and false.
        const remove = button(t('remove'), async () => {
            if (remove.dataset.armed !== '1') {
                remove.dataset.armed = '1'; remove.textContent = t('remove_sure'); message.textContent = t('remove_confirm', extension.name);
                return;
            }
            const { status, value } = await quiet(call('POST', extensionPath(extension.id, 'remove'), {}));
            if (status !== 200) showError(status, value); else message.textContent = '';
            changed(); await fillManager();
        });
        actions.append(
            button(t('settings'), () => { settingsBox.hidden = !settingsBox.hidden; if (!settingsBox.hidden) settingsForm(extension, settingsBox); }),
            button(t('check_update'), async () => {
                message.textContent = t('loading');
                const { status, value } = await quiet(call('POST', extensionPath(extension.id, 'update'), {}, 120000));
                if (status !== 200) { showError(status, value); return; }
                // An update that asks more: the same prompt as an install, its new actions marked.
                if (value.pending) { message.textContent = ''; showConsent(value.pending); return; }
                message.textContent = Model.updateMessage(lang, value.result); changed(); await fillManager();
            }),
            remove);
        card.append(head, ...(description ? [description] : []), actions, settingsBox);
        return card;
    }
    function settingsForm(extension, box) {
        const fields = Model.settingFields(extension), inputs = new Map(), reset = new Set();
        box.replaceChildren();
        if (!fields.length) { box.append(el('p', t('settings_none'), 'hl-ext-muted')); return; }
        const status = el('span', '', 'hl-ext-muted');
        const send = async body => {
            const { status: code, value } = await quiet(call('POST', extensionPath(extension.id, 'settings'), body));
            ahead.clear();
            return code === 200 ? '' : t(Model.errorKey(code, value), value.error || code);
        };
        fields.forEach(field => {
            const row = el('label', undefined, 'hl-ext-row'), name = el('span', field.label, 'hl-ext-grow');
            let input;
            if (field.mode === 'press') {
                // A button sends the extension its `setting` event with `pressed`.
                input = button(field.label, async () => { status.textContent = (await send({ press: field.key })) || t('setting_pressed'); });
                name.textContent = '';
            } else if (field.mode === 'show') input = el('span', String(field.value) || t('setting_readonly'), 'hl-ext-muted');
            else if (field.type === 'toggle') { input = el('input'); input.type = 'checkbox'; input.checked = field.value === true; }
            else if (field.type === 'choice') { input = el('select'); field.options.forEach(option => { const node = el('option', option); node.value = option; if (option === String(field.value)) node.setAttribute('selected', ''); input.append(node); }); }
            else {
                input = el('input'); input.type = field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text';
                if (field.type === 'secret') { input.autocomplete = 'off'; input.placeholder = t(field.set ? 'setting_set' : 'setting_unset'); }
                else input.value = String(field.value);
            }
            if (field.mode === 'edit') { input.setAttribute('aria-label', field.label); inputs.set(field.key, input); }
            row.append(name, input);
            if (field.mode === 'edit' && field.set) {
                const back = button(t('setting_default'), () => { reset.add(field.key); back.disabled = true; });
                row.append(back);
            }
            box.append(row);
            if (field.description) box.append(el('p', field.description, 'hl-ext-muted'));
        });
        if (inputs.size) {
            const save = button(t('save'), async () => {
                const values = Model.settingValues(fields, key => { const input = inputs.get(key); return input.type === 'checkbox' ? input.checked : input.value; }, reset);
                if (!Object.keys(values).length) { status.textContent = t('saved'); return; }
                status.textContent = (await send({ values })) || t('saved');
            }, 'hl-ext-primary');
            const row = el('div', undefined, 'hl-ext-row'); row.append(save, status); box.append(row);
        } else box.append(status);
    }
    function orderCard(order, list) {
        const card = el('section', undefined, 'hl-ext-card');
        card.append(el('h3', t('order_title')), el('p', t('order_footer'), 'hl-ext-muted'));
        const spotifyAt = order.indexOf('spotify');
        order.forEach((id, index) => {
            const extension = list.find(e => e.id === id), row = el('div', undefined, 'hl-ext-row'), info = el('div', undefined, 'hl-ext-grow');
            info.append(el('strong', id === 'spotify' ? 'Spotify' : extension.name));
            if (id === 'spotify') info.append(el('p', t('order_spotify_detail'), 'hl-ext-muted'));
            else if (index > spotifyAt) info.append(el('p', t('order_below'), 'hl-ext-muted'));
            else if (!extension.enabled) info.append(el('p', t('status_off'), 'hl-ext-muted'));
            const move = delta => async () => {
                const { status, value } = await quiet(call('POST', '/ext/order', { order: Model.orderMove(order, id, delta) }));
                if (status !== 200) showError(status, value);
                changed(); await fillManager();
            };
            const up = button('↑', move(-1)), down = button('↓', move(1));
            up.setAttribute('aria-label', t('move_up')); down.setAttribute('aria-label', t('move_down'));
            up.disabled = index === 0; down.disabled = index === order.length - 1;
            row.append(info, up, down); card.append(row);
        });
        return card;
    }
    /** The prompt for a preview, or for an update's `pending` (the same object). */
    function showConsent(preview) {
        const box = managerBox, view = Model.consent(preview), m = view.manifest, update = view.plan === 'update';
        const title = el('h3', t(update ? 'prompt_update' : 'prompt_install', m.name));
        const facts = [t('prompt_by', m.author, m.version), t('prompt_source', Model.maskText(view.source)), view.replaces ? t('prompt_replaces', view.replaces) : ''].filter(Boolean);
        const parts = [title, ...facts.map(text => el('p', text, 'hl-ext-muted'))];
        if (view.plan === 'not-newer') parts.push(el('p', t('prompt_not_newer'), 'hl-ext-warn'));
        if (!view.compatible) parts.push(el('p', t('prompt_incompatible'), 'hl-ext-warn'));
        if (view.changes.length) {
            const changes = el('div', undefined, 'hl-ext-card'); changes.append(el('strong', t('prompt_changes')));
            view.changes.map(change => Model.changeLine(lang, change)).forEach(change => changes.append(el('p', change.text, change.critical ? 'hl-ext-warn' : undefined)));
            parts.push(changes);
        }
        const actions = el('div', undefined, 'hl-ext-card'); actions.append(el('strong', t('actions_title')));
        view.actions.forEach(action => {
            const item = el('div', undefined, 'hl-ext-action'); item.dataset.critical = String(action.critical);
            const label = el('p', Model.actionLabel(lang, action.key)); label.style.fontWeight = '700';
            if (action.critical) { label.className = 'hl-ext-warn'; label.textContent += ' · ' + t('action_critical'); }
            if (update && action.new) label.textContent += ' · ' + t('prompt_new');
            item.append(label, el('p', action.why || t('action_no_why'), 'hl-ext-muted'));
            if (action.hosts.length) item.append(el('p', t('action_hosts', action.hosts.map(h => h === '*' ? t('action_any_host') : h).join(', ')), 'hl-ext-muted'));
            actions.append(item);
        });
        parts.push(actions);
        // Each clash: the new one acts (the default) or the installed one is kept and the new one stays off.
        const keepNew = new Map();
        if (view.clashes.length) {
            const clashes = el('div', undefined, 'hl-ext-card'); clashes.append(el('strong', t('clash_title')));
            view.clashes.forEach(clash => {
                const what = clash.kind === 'exclusive' ? t('clash_exclusive', Model.actionLabel(lang, clash.action), clash.otherName)
                    : t(clash.kind === 'replaces' ? 'clash_replaces' : 'clash_conflict', clash.otherName);
                const group = el('div', undefined, 'hl-ext-clash'); group.dataset.other = clash.other;
                group.append(el('p', what));
                [[true, t('clash_keep_new', m.name, t(clash.kind === 'exclusive' ? 'clash_idle' : 'clash_off'))], [false, t('clash_keep_old', clash.otherName)]].forEach(([value, text]) => {
                    const option = el('label', undefined, 'hl-ext-row'), radio = el('input');
                    radio.type = 'radio'; radio.name = 'hl-ext-clash-' + clash.other; radio.value = String(value); radio.checked = value;
                    radio.onchange = () => { if (radio.checked) keepNew.set(clash.other, value); };
                    option.append(radio, el('span', text, 'hl-ext-grow')); group.append(option);
                });
                clashes.append(group);
            });
            parts.push(clashes);
        }
        if (view.critical) parts.push(el('p', t('critical_warning'), 'hl-ext-warn'));
        parts.push(el('p', t('third_party'), 'hl-ext-muted'));
        const accept = el('label', undefined, 'hl-ext-row'), tick = el('input'); tick.type = 'checkbox';
        accept.append(tick, el('span', t('risk_accept'), 'hl-ext-grow'));
        const status = el('p', '', 'hl-ext-muted');
        const confirm = button(t(update ? 'update_accept' : 'install'), async () => {
            confirm.disabled = true;
            const body = { pending: view.pending, granted: view.granted, ...(view.clashes.length ? { keep: Model.keepChoices(view.clashes, other => keepNew.get(other)) } : {}) };
            const { status: code, value } = await quiet(call('POST', '/ext/install/confirm', body, 120000));
            if (code !== 200) {
                confirm.disabled = false;
                status.textContent = value.error === 'not-granted' ? t('install_missing', value.missing.map(key => Model.actionLabel(lang, key)).join(', ')) : t('install_error', value.error || code);
                return;
            }
            message.textContent = t('installed_done', value.extension.name); changed(); await fillManager();
        }, 'hl-ext-primary');
        confirm.disabled = true;
        tick.disabled = !view.installable;
        tick.onchange = () => { confirm.disabled = !tick.checked || !view.installable; };
        const row = el('div', undefined, 'hl-ext-row'); row.append(confirm, button(t('cancel'), () => fillManager()));
        parts.push(accept, row, status);
        box.replaceChildren(...parts);
        box.scrollIntoView?.({ block: 'start' });
    }

    const menu = Spicetify.Menu?.Item ? new Spicetify.Menu.Item(t('manage_open'), false, () => { void openManager(); }) : null;
    menu?.register();
    const timer = setInterval(tick, 250);
    void readState(true).then(() => { void onSong(); });

    return {
        model: Model, openDetails, openManager,
        snapshot: () => ({ mode, intent, song: song ? { ...song.track } : null, answer: answer ? { extension: answer.extension, name: answer.name, stream: { ...answer.stream } } : null,
            seconds: extSeconds(), detected, lead, ahead: [...ahead.keys()], line: line.hidden ? null : line.textContent }),
        dispose() {
            if (disposed) return;
            const at = mode === 'extension' ? extSeconds() : null;
            if (mode !== 'spotify') giveBack(at);
            disposed = true; epoch++; lookup?.abort();
            clearInterval(timer); listeners.forEach(remove => remove());
            unwrapPlayer();
            menu?.deregister(); line.remove(); style.remove(); ivLyrics?.setExternalClock?.(null);
        },
    };
}
window.SpotifyHangulExtensionPlayer = { model: Model, create };
})();
