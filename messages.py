# @file messages.py
# @brief The helper's user-visible messages in English and Korean, chosen per request or from the Windows display language.
"""One table for bridge.py, playlist_files.py, playback_control.py and youtube_stream.py.

A module raises its errors with a message key (``raise ValueError('youtube_id_invalid')``); the HTTP boundary in
bridge.py turns the key into the request's language with ``error_body`` and keeps the key as the answer's ``code``.
Text that is not an exception (a default playlist name, a source title) is read with ``text`` in the same language.
"""
import ctypes
from functools import lru_cache
import os
import threading

LANGUAGES = ('ko', 'en')
HEADER = 'X-Hangul-Language'
KOREAN_PRIMARY_LANGUAGE = 0x12
_request = threading.local()

MESSAGES = {
    # bridge.py: lyric sources and matching
    'lyric_source_not_allowed': {
        'ko': '한음, 나무위키 또는 티스토리의 HTTPS 가사 주소만 사용할 수 있습니다.',
        'en': 'Only HTTPS lyrics page addresses on Haneum, Namu Wiki or Tistory can be used.'},
    'lookup_superseded': {
        'ko': '새 곡의 발음 조회로 전환했습니다.',
        'en': 'Switched to the pronunciation lookup for the new song.'},
    'lookup_timed_out': {
        'ko': '자료 조회 시간이 지났습니다.',
        'en': 'Looking up the pronunciation data took too long.'},
    'source_not_html': {
        'ko': '가사 HTML 문서가 아닙니다.',
        'en': 'This is not an HTML lyrics page.'},
    'source_too_large': {
        'ko': '가사 문서의 크기 제한을 초과했습니다.',
        'en': 'The lyrics page is larger than the size limit.'},
    'resolve_input_invalid': {
        'ko': '곡명과 원문 가사를 확인해 주세요.',
        'en': 'Check the song title and the original lyrics.'},
    'automatic_setting_invalid': {
        'ko': '자동 발음 설정이 올바르지 않습니다.',
        'en': 'The automatic pronunciation setting is not valid.'},
    'track_identity_invalid': {
        'ko': '곡 식별 정보가 올바르지 않습니다.',
        'en': 'The song identification is not valid.'},
    'retry_count_invalid': {
        'ko': '자동 재조회 횟수가 올바르지 않습니다.',
        'en': 'The automatic retry count is not valid.'},
    'pronunciation_not_found': {
        'ko': '이 곡과 일치하는 한글 발음 자료를 찾지 못했습니다. 자료 주소를 직접 지정할 수 있습니다.',
        'en': 'No Hangul pronunciation data matching this song was found. You can give the page address yourself.'},
    'pronunciation_busy': {
        'ko': '다른 곡의 발음 자료를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.',
        'en': "Another song's pronunciation data is being checked. Try again in a moment."},
    'retries_exhausted': {
        'ko': '이 곡의 자동 재조회 횟수를 모두 사용했습니다.',
        'en': 'All automatic retries for this song have been used.'},
    'pronunciation_below_threshold': {
        'ko': '원문과 85% 이상 일치하는 한글 발음 자료를 찾지 못했습니다. 자료 주소를 직접 지정해 주세요.',
        'en': 'No Hangul pronunciation data matching at least 85% of the original lyrics was found. '
              'Give the page address yourself.'},
    'automatic_source_title': {
        'ko': '기기 내부 자동 발음',
        'en': 'Automatic pronunciation on this PC'},
    'pronunciation_read_failed': {
        'ko': '발음 자료를 읽는 중 오류가 발생했습니다.',
        'en': "Couldn't read the pronunciation data."},
    # bridge.py: YouTube metadata
    'youtube_id_invalid': {
        'ko': 'YouTube 영상 ID가 올바르지 않습니다.',
        'en': 'The YouTube video ID is not valid.'},
    'youtube_metadata_moved': {
        'ko': 'YouTube 메타데이터 주소가 변경되었습니다.',
        'en': 'The YouTube metadata address has changed.'},
    'youtube_video_unavailable': {
        'ko': '비공개이거나 삭제된 영상, 또는 외부 재생이 막힌 영상입니다.',
        'en': 'This video is private or removed, or cannot be played outside YouTube.'},
    'youtube_metadata_too_large': {
        'ko': 'YouTube 메타데이터 크기를 초과했습니다.',
        'en': 'The YouTube metadata is larger than the size limit.'},
    # bridge.py: HTTP requests
    'request_forbidden': {
        'ko': '허용되지 않은 요청입니다.',
        'en': 'This request is not allowed.'},
    'control_request_forbidden': {
        'ko': '허용되지 않은 재생 제어 요청입니다.',
        'en': 'This playback control request is not allowed.'},
    'control_client_invalid': {
        'ko': '재생 연결 클라이언트가 올바르지 않습니다.',
        'en': 'The playback connection client is not valid.'},
    'method_not_supported': {
        'ko': '지원하지 않는 요청 방식입니다.',
        'en': 'This request method is not supported.'},
    'control_request_size_invalid': {
        'ko': '재생 제어 요청 크기가 올바르지 않습니다.',
        'en': 'The playback control request size is not valid.'},
    'control_request_format_invalid': {
        'ko': '재생 제어 형식이 올바르지 않습니다.',
        'en': 'The playback control request format is not valid.'},
    'request_size_invalid': {
        'ko': '요청 크기가 올바르지 않습니다.',
        'en': 'The request size is not valid.'},
    'request_format_invalid': {
        'ko': '요청 형식이 올바르지 않습니다.',
        'en': 'The request format is not valid.'},
    'path_not_found': {
        'ko': '경로가 없습니다.',
        'en': 'There is no such path.'},
    'youtube_files_missing': {
        'ko': '링크 음악 파일이 설치되지 않았습니다.',
        'en': 'The YouTube links files are not installed.'},
    'updater_missing': {
        'ko': '업데이트 프로그램이 설치되지 않았습니다.',
        'en': 'The updater is not installed.'},
    'launch_failed': {
        'ko': '프로그램을 실행하지 못했습니다.',
        'en': "Couldn't start the program."},
    # playlist_files.py
    'playlist_text_invalid': {
        'ko': '목록의 문자열 형식이나 길이가 올바르지 않습니다.',
        'en': 'A text field in the list has the wrong type or length.'},
    'playlist_unicode_invalid': {
        'ko': '목록에 올바르지 않은 유니코드 문자열이 있습니다.',
        'en': 'The list has text that is not valid Unicode.'},
    'track_duration_invalid': {
        'ko': '곡의 재생 시간이 올바르지 않습니다.',
        'en': "A song's length is not valid."},
    'image_host_not_allowed': {
        'ko': 'Spotify 앨범 이미지 주소만 저장할 수 있습니다.',
        'en': 'Only Spotify album image addresses can be saved.'},
    'playlist_file_unsupported': {
        'ko': '지원하는 Spotify-ex 혼합 목록 파일이 아닙니다.',
        'en': 'This is not a supported Spotify-ex mixed list file.'},
    'playlist_data_missing': {
        'ko': '플레이리스트 데이터가 없습니다.',
        'en': 'The file has no playlist data.'},
    'playlist_too_many_tracks': {
        'ko': '각 종류의 곡은 2,000 곡까지 입출력할 수 있습니다.',
        'en': 'Up to 2,000 songs of each kind can be exported or imported.'},
    'spotify_track_uri_invalid': {
        'ko': 'Spotify 곡 주소가 올바르지 않습니다.',
        'en': 'A Spotify song address is not valid.'},
    'spotify_entry_key_invalid': {
        'ko': 'Spotify 곡 항목 식별자가 올바르지 않습니다.',
        'en': 'A Spotify song entry ID is not valid.'},
    'entry_key_duplicate': {
        'ko': '중복된 곡 항목 식별자가 있습니다.',
        'en': 'Two song entries have the same ID.'},
    'imported_playlist_name': {
        'ko': '가져온 혼합 목록',
        'en': 'Imported mixed list'},
    'source_playlist_uri_invalid': {
        'ko': '원본 Spotify 플레이리스트 주소가 올바르지 않습니다.',
        'en': 'The original Spotify playlist address is not valid.'},
    'mixed_order_invalid': {
        'ko': '혼합 재생 순서가 올바르지 않습니다.',
        'en': 'The mixed play order is not valid.'},
    'mixed_order_entry_invalid': {
        'ko': '혼합 재생 순서의 항목이 올바르지 않습니다.',
        'en': 'An entry in the mixed play order is not valid.'},
    'playlist_file_too_large': {
        'ko': '목록 파일은 3 MB까지 저장할 수 있습니다.',
        'en': 'List files can be saved up to 3 MB.'},
    'export_folder_unverified': {
        'ko': '내보내기 폴더의 앱 저장 위치를 확인하지 못했습니다.',
        'en': "Couldn't verify that the export folder is inside the app's storage location."},
    'export_folder_outside': {
        'ko': '내보내기 폴더가 앱 저장 위치 밖을 가리킵니다.',
        'en': "The export folder points outside the app's storage location."},
    # playback_control.py
    'instance_uuid_invalid': {
        'ko': '올바른 재생 인스턴스 UUID가 필요합니다.',
        'en': 'A valid playback instance UUID is required.'},
    'track_uri_invalid': {
        'ko': '올바른 곡 URI가 필요합니다.',
        'en': 'A valid song URI is required.'},
    'track_uri_unsupported': {
        'ko': '지원하는 Spotify 또는 YouTube 곡 URI가 필요합니다.',
        'en': 'A supported Spotify or YouTube song URI is required.'},
    'milliseconds_invalid': {
        'ko': '유효한 밀리초 단위 재생 시간이 필요합니다.',
        'en': 'A valid playback time in milliseconds is required.'},
    'control_session_invalid': {
        'ko': '재생 제어 세션이 올바르지 않거나 만료됐습니다.',
        'en': 'The playback control session is not valid or has expired.'},
    'playback_state_format_invalid': {
        'ko': '재생 상태 형식이 올바르지 않습니다.',
        'en': 'The playback state format is not valid.'},
    'playback_source_mismatch': {
        'ko': '재생 소스와 곡 URI가 일치하지 않습니다.',
        'en': 'The playback source and the song URI do not match.'},
    'is_playing_not_boolean': {
        'ko': '재생 여부는 참 또는 거짓이어야 합니다.',
        'en': 'The playing flag must be true or false.'},
    'playback_action_unsupported': {
        'ko': '지원하는 재생 제어 명령이 아닙니다.',
        'en': 'This is not a supported playback command.'},
    'playback_state_stale': {
        'ko': '재생 상태가 갱신되지 않아 명령을 적용하지 않았습니다.',
        'en': 'The command was not applied because the playback state has not been updated.'},
    'playback_track_changed': {
        'ko': '곡이 변경되어 이전 곡의 명령을 적용하지 않았습니다.',
        'en': 'The song changed, so the command for the previous song was not applied.'},
    'command_queue_full': {
        'ko': '재생 제어 명령이 대기 중입니다. 잠시 후 다시 시도해 주세요.',
        'en': 'Playback commands are still waiting. Try again in a moment.'},
    # youtube_stream.py
    'stream_tools_missing': {
        'ko': '설치된 YouTube 재생 도구가 누락됐습니다. 설치 파일로 복구해 주세요.',
        'en': 'The installed YouTube playback tools are missing. Repair them with the installer.'},
    'development_engine_missing': {
        'ko': '개발용 대체 스트림 엔진 yt-dlp를 찾지 못했습니다.',
        'en': 'The development audio stream engine yt-dlp was not found.'},
    'video_not_public': {
        'ko': '로그인이나 연령 확인이 없는 공개 영상만 대체 재생할 수 있습니다.',
        'en': 'Only public videos without sign-in or age verification can play in Audio mode.'},
    'opus_stream_not_found': {
        'ko': 'Spotify에서 지원하는 공개 Opus 스트림을 찾지 못했습니다.',
        'en': 'No public Opus stream that Spotify can play was found.'},
    'video_info_invalid': {
        'ko': '영상의 재생 정보가 올바르지 않습니다.',
        'en': "The video's playback information is not valid."},
    'stream_url_expired': {
        'ko': '영상 스트림 주소가 만료되었습니다. 다시 재생해 주세요.',
        'en': 'The video stream address has expired. Play it again.'},
    'youtube_id_required': {
        'ko': '올바른 YouTube 영상 ID가 필요합니다.',
        'en': 'A valid YouTube video ID is required.'},
    'stream_busy': {
        'ko': '다른 영상의 대체 스트림을 확인 중입니다. 잠시 후 다시 시도해 주세요.',
        'en': "Another video's audio stream is being checked. Try again in a moment."},
    'stream_lookup_failed': {
        'ko': '공개 영상의 스트림을 확인하지 못했습니다. 로그인 제한이나 엔진 상태를 확인해 주세요.',
        'en': "Couldn't find the public video's stream. Check for a sign-in restriction or the engine status."},
    'stream_lookup_timed_out': {
        'ko': '대체 스트림 조회 시간이 초과됐습니다. 다시 재생해 주세요.',
        'en': 'Looking up the audio stream took too long. Play it again.'},
}


@lru_cache(maxsize=None)
def detected_language():
    """'ko' when the Windows display language is Korean, otherwise 'en'; read once."""
    if os.name != 'nt':
        return 'en'
    try:
        language_id = ctypes.windll.kernel32.GetUserDefaultUILanguage()
    except (AttributeError, OSError):
        return 'en'
    return 'ko' if language_id & 0x3FF == KOREAN_PRIMARY_LANGUAGE else 'en'


def set_request_language(value):
    """Remember the request's X-Hangul-Language for this thread; anything but ko/en means no preference."""
    _request.language = value if value in LANGUAGES else None


def language():
    return getattr(_request, 'language', None) or detected_language()


def text(key):
    return MESSAGES[key][language()]


def error_body(error, fallback=None, **fields):
    """The JSON of an error answer: ``error`` in the request's language and ``code`` for the client.

    ``error`` is a message key or an exception raised with one; an exception whose message is not a key
    (a stdlib parse error, for example) keeps its own text and gets the handler's ``fallback`` code."""
    if isinstance(error, str):
        return {'error': text(error), 'code': error, **fields}
    key = error.args[0] if error.args and isinstance(error.args[0], str) else ''
    if key in MESSAGES:
        return {'error': text(key), 'code': key, **fields}
    return {'error': str(error), 'code': fallback, **fields}
