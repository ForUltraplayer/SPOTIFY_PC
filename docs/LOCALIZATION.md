# 외국어 지원 방안 검토

2026-11-03 기준 검토안이다. 아래 구조와 단계는 제안이며 아직 구현하지 않았다. 현재 상태는 코드에서 확인한 사실이다.

## 용어

| 한국어 명칭 | 코드 |
| --- | --- |
| 링크 음악 화면 | `youtube-links.js`, `youtube-now-playing.js`, `youtube-library.js`, `youtube-overlay-controls.js`, `youtube-player.html` |
| 한글 가사 설정 | `hangul-lyrics.js` |
| 가사 싱크 화면 | `ivlyrics-sync.js`, `ivlyrics-sync-ui.js` |
| 확장 플레이어 | `extension-player.js` |
| 도우미 | `bridge.py`, `playlist_files.py`, `playback_control.py`, `youtube_stream.py` |
| 설치·실행 스크립트 | `installer/bootstrap.ps1`, `installer/integrate.ps1`, `start.ps1`, `stop.ps1` |
| 업데이트 | `auto-update.ps1`, `update-ui.ps1`, `webview-auth.ps1` |
| 데스크톱 가사창 | `overlay/*.cs` |

## 결론

영어 기본값과 한국어 번역을 갖춘 2개 언어 구조로 바꾸고, 다른 언어는 번역 파일을 더하는 방식으로 열어 둔다. 화면 언어는 사용자가 보고 있는 프로그램의 언어를 따른다. Spotify 안의 화면은 Spotify 화면 언어를, 설치 프로그램은 NSIS 언어 선택을, 그 밖의 Windows 쪽은 Windows 표시 언어를 따른다. 이미 확장 플레이어와 업데이트에서 쓰는 방식을 나머지로 넓히는 것이라 새 도구는 들이지 않는다.

한글 발음 표시는 한국어를 읽는 사람을 위한 기능이므로 현지화 대상이 아니다. 외국어 지원의 주 대상은 외국어 Windows나 영어 Spotify를 쓰는 한국어 사용자와, YouTube 링크 음악과 확장 음원만 쓰는 비한국어 사용자다.

## 검토 시작 시점의 상태

아래 표와 문구 수는 현지화를 시작하기 전의 상태다. 지금 상태는 아래 단계별 결과를 따른다.

| 영역 | 상태 | 근거 |
| --- | --- | --- |
| 확장 플레이어 | 영어 기본값과 한국어. Spotify 화면 언어로 고름 | `extension-player.js`의 `STRINGS`, `language()`, `t()` |
| 업데이트 | 영어와 한국어. Windows 표시 언어로 고르고 `SPOTIFYHANGUL_LANGUAGE`로 바꿀 수 있음 | `auto-update.ps1`의 `Get-Text` |
| 설치 프로그램 | 영어와 한국어 | `installer/setup.nsi`의 `MUI_LANGUAGE`, `LangString` |
| 링크 음악 화면, 한글 가사 설정, 가사 싱크 화면 | 한국어만 | 문구가 코드 안에 바로 들어 있음 |
| 도우미 오류 | 한국어 문장을 HTTP 응답의 `error`로 보내고 화면이 그대로 표시 | `bridge.py`의 `send_json(..., {'error': ...})` |
| 설치·실행 스크립트 | 한국어만. 실패 대화상자 제목 포함 | `start.ps1`의 오류 팝업 |
| 데스크톱 가사창 | 한국어만. 문화권 처리 없음 | `overlay/OverlayWindow.cs` |

현지화되지 않은 한국어 문구는 약 400개다. 따옴표 안에 한글이 든 서로 다른 문자열을 파일별로 센 값이며, 이미 번역 표가 있는 파일과 발음 자료는 뺐다. 주석이 아닌 로그 문구 일부가 섞여 있어 실제 화면 문구는 이보다 적을 수 있다.

| 영역 | 문구 수(약) |
| --- | --- |
| 링크 음악 화면 | 190 |
| 한글 가사 설정, 가사 싱크 화면 | 100 |
| 도우미 | 80 |
| 설치·실행 스크립트 | 50 |
| 데스크톱 가사창 | 40 |

## 방안 비교

| 방안 | 장점 | 단점 |
| --- | --- | --- |
| 가. 한국어만 유지하고 문서에 명시 | 작업 없음 | 영어 Spotify와 외국어 Windows에서 한국어와 외국어가 섞여 보임. 설치 세부 정보 창의 한글이 `?`로 보일 수 있음(추정) |
| 나. 모듈마다 번역 표를 두고 영어 기본값과 한국어를 넣음(권장) | 확장 플레이어에서 이미 쓰는 방식. 파일 하나씩 따로 바꾸고 시험할 수 있음. 모듈 단위 테스트가 그대로 동작 | 번역 표가 파일마다 흩어져 번역자가 여러 파일을 봐야 함 |
| 다. 공용 번역 모듈 하나(`hangul-i18n.js` 같은 이름)로 모으고 언어별 JSON을 둠 | 번역자가 한곳만 보면 됨. 언어 추가가 쉬움 | Spicetify 확장 사이의 로드 순서를 정할 수 있는지 확인하지 않음. 모듈 테스트마다 공용 모듈을 함께 실어야 함 |

나를 먼저 하고, 언어가 셋 이상으로 늘 때 번역 표만 언어별 파일로 빼는 다로 옮긴다. 나의 표 구조(키와 `%1` 자리표시)를 처음부터 같게 두면 옮길 때 호출부는 바뀌지 않는다.

## 영역별 처리

| 영역 | 처리 |
| --- | --- |
| Spotify 안의 화면 | 확장 플레이어와 같은 `STRINGS`와 `t()`를 둔다. 언어는 `Spicetify.Locale.getLocale()`로 고른다. Spotify 버튼을 찾을 때는 문구 대신 위치·상태 속성이나 `Spicetify.Locale.get(키)`를 쓴다(0.8.1에서 셔플·기기 연결에 적용) |
| 도우미 | 오류에 고정 코드(`code`)를 더해 보내고, 화면이 코드로 번역한다. 기존 `error` 문장은 영어로 바꿔 진단 기록용으로 남긴다. 화면이 모르는 코드는 `error`를 그대로 보인다 |
| 설치·실행 스크립트 | 업데이트의 `Get-Text` 방식을 쓴다. 영어로 출력되면 NSIS 설치 세부 정보 창의 `?` 문제도 비한국어 Windows에서 함께 사라진다 |
| 데스크톱 가사창 | `CultureInfo.CurrentUICulture`로 고르는 사전 하나를 둔다. 문구가 40개 정도라 resx 파일은 쓰지 않는다 |
| 바로가기 이름 | `Spotify 한글 가사.lnk`는 그대로 둔다. 기존 설치의 바로가기와 자동 시작 값이 이 이름을 가리키므로 바꾸면 업그레이드 경로를 다시 검증해야 한다 |

언어를 고르는 규칙은 모든 영역에서 같게 한다. 한국어(`ko`, `ko-KR`)면 한국어, 그 밖에는 영어다. Spotify 안의 화면과 Windows 쪽 언어가 다르면 각자 자기 프로그램의 언어를 따른다. 사용자가 직접 고르는 설정은 처음에는 두지 않고 `SPOTIFYHANGUL_LANGUAGE`만 유지한다.

## 검사

- 번역 검사 스크립트(`scripts/check_translations.cjs`, 테스트는 `test_translations.cjs`)가 현지화를 마친 모듈(`LOCALIZED` 목록)을 검사한다. 영어(`en`)로 시작하는 문구 표(`const 이름 = { en: {...}, ko: {...} }`)마다 모든 키에 영어와 한국어가 있는지, `%1` 같은 자리표시가 같은지 보고, 주석을 뺀 코드에서 표 밖에 한글이 남았는지 본다. 모듈은 한국어 문구를 표로 다 옮긴 뒤 목록에 넣는다.
- 기존 모듈 테스트에 영어 로캘 경우를 더한다(`test_youtube_navigation.cjs`의 다른 언어 Spotify 시험과 같은 방식).
- 실제 화면 확인은 Spotify `prefs`의 `language`를 바꿔 하고(`work/spotify-lang.ps1`, 끝나면 `-Restore`), 설치 프로그램은 NSIS 언어 선택에서 영어를 골라 본다.
- 외국어 Windows 설치 시험은 VM이나 다른 PC가 있어야 한다. 이 PC에는 없다.

## 순서와 규모 (제안)

| 단계 | 내용 | 규모 |
| --- | --- | --- |
| 1 | 번역 검사 스크립트, 링크 음악 화면 | 문구 약 190개, 파일 5개 |
| 2 | 한글 가사 설정, 가사 싱크 화면 | 약 100개. 가사 싱크 화면은 ivLyrics 패치(`scripts/patch_ivlyrics_sync.py`)와 함께 바뀌므로 패치 테스트도 고침 |
| 3 | 도우미 오류 코드와 화면 쪽 번역 | 약 80개. 도우미와 화면이 같은 릴리스에 들어가야 함 |
| 4 | 설치·실행 스크립트, 데스크톱 가사창 | 약 90개 |

단계마다 따로 릴리스할 수 있다. 영어 번역은 기존 한국어 문구의 뜻을 그대로 옮기고, 영어 문구 검수는 사용자가 따로 한다.

## 1단계 결과 (2026-11-03)

링크 음악 화면 5개 파일의 문구를 표로 옮겼다. 한국어는 원래 문구 그대로이고, 이어 붙여 만들던 문장 몇 개만 자리표시가 있는 한 문장으로 바꿨다.

| 파일 | 키 수 | 언어를 고르는 곳 |
| --- | --- | --- |
| `youtube-links.js` | 117 | Spotify 화면 언어, 없으면 `navigator.language` |
| `youtube-player.html` | 7 | 페이지 주소의 `lang`(링크 음악 화면이 넘김). Spotify 밖 페이지라 Spotify 언어를 직접 읽지 못함 |
| `youtube-now-playing.js` | 36 | Spotify 화면 언어 |
| `youtube-library.js` | 28 | Spotify 화면 언어 |
| `youtube-overlay-controls.js` | 6 | Spotify 화면 언어 |

Spotify 버튼을 한국어 이름으로 찾던 나머지 부분(셔플, 좋아요, 기기 연결)도 없앴다. 이제 위치, 상태 속성, Spotify의 현재 언어 문구로만 찾는다.

| 확인 | 결과 |
| --- | --- |
| 번역 검사 | 6개 파일 모두 통과(확장 플레이어 포함) |
| 테스트 | JS 280 개, Python 141 개 통과. 각 모듈에 한국어 Spotify 경우 테스트 추가 |
| 영어 Spotify | 우리 화면 문구 112 개에 한글 없음. 남은 한글은 곡 제목과 저장된 목록 이름 |
| 한국어 Spotify | 원래 한국어 문구로 나옴. 셔플과 기기 연결 가로채기, 좋아요 숨김, 재생 버튼 상태 정상 |

알아 둘 점:

- 기본 목록 이름(`YouTube links`, `Imported mixed list`)은 처음 저장할 때의 언어로 저장된다. 나중에 언어를 바꿔도 이미 저장한 이름은 그대로다.
- 영어 복수형은 처리하지 않는다. 1곡이어도 `songs`, `items`로 나온다.

1단계 때 검수 대상으로 남긴 영어 용어는 아래 용어집으로 정했다.

## 2~4단계 결과 (2026-11-03)

| 영역 | 파일 | 처리 |
| --- | --- | --- |
| 한글 가사 설정 | `hangul-lyrics.js` | 문구 표 35 개 키. 도우미 요청에 화면 언어를 보냄 |
| 가사 싱크 화면 | `ivlyrics-sync.js`, `ivlyrics-sync-ui.js`, `youtube-ivlyrics.js`, `scripts/patch_ivlyrics_sync.py` | 문구 표 22, 38, 5 개 키. ivLyrics에 넣던 한국어 2 곳은 우리 모듈의 번역 함수 호출로 바꿈 |
| 도우미 | `messages.py`(새 파일), `bridge.py`, `playlist_files.py`, `playback_control.py`, `youtube_stream.py` | 메시지 74 개를 한 표로 모음. 오류 응답에 `error`(번역문)와 `code`(키)를 함께 보냄 |
| 설치·실행 스크립트 | `installer/bootstrap.ps1`, `installer/integrate.ps1`, `installer/payload-transaction.ps1`, `start.ps1`, `stop.ps1`, `installer/setup.nsi`, `installer/update-launcher.nsi` | `Get-Text` 방식. 설치 프로그램이 고른 언어를 `SPOTIFYHANGUL_LANGUAGE`로 넘김 |
| WPF 오버레이 시제품 | `overlay/` | 배포하지 않는 시제품이라 제외. 실제 데스크톱 가사창은 별도 ivLyrics-overlay 포크라 이 저장소 밖 |

도우미의 언어는 요청 헤더 `X-Hangul-Language`(`ko` 또는 `en`)를 따르고, 헤더가 없으면 Windows 표시 언어를 따른다(`GetUserDefaultUILanguage`, 처음 한 번만 읽음). 링크 음악 화면, 목록 내보내기, 한글 가사 설정이 이 헤더를 보낸다.

그대로 둔 한국어:

| 문구 | 이유 |
| --- | --- |
| `(발음 자료 없음)` | 도우미가 발음 없는 줄에 넣고 한글 가사 설정이 같은 바이트로 비교하는 표식. 캐시에도 저장됨 |
| 가사 묶음 라벨 `〔문장 전체〕`, 제목 판별 정규식의 한글 범위, 도우미의 가수 이름·검색 데이터 | 화면 문구가 아니라 들어오는 데이터와 비교하는 값. JS에서는 검사기를 위해 `\uXXXX`로 적음 |
| `payload-transaction.ps1`의 무결성·복구 내부 오류 약 30 개 | 원래 영어만 있던 유지보수자용 진단. 사용자가 조치할 수 있는 12 개에만 한국어를 새로 씀 |
| `start.ps1`이 `start-error.txt`에만 쓰는 자동 시작 전환 실패 문구 | 로그 전용 |
| 바로가기 이름 `Spotify 한글 가사.lnk` | 기존 설치의 바로가기와 자동 시작 값이 이 이름을 가리킴 |

영어 용어집(주요 항목):

| 한국어 | 영어 |
| --- | --- |
| Spotify 한글 가사 | Spotify Hangul Lyrics |
| 링크 음악 | YouTube links |
| 혼합 플레이리스트 / 목록 | mixed playlist / mixed list |
| 음원 재생 / 영상 재생 | Audio / Video |
| 대체 재생 / 대체 스트림 | Audio mode / audio stream |
| 한글 발음 / 발음 자료 / 자동 발음 | Hangul pronunciation / pronunciation data / automatic pronunciation |
| 도우미 | helper (the Hangul lyrics helper) |
| 재생목록(대기열 뜻) / 곡 | queue / song |
| 가사창 | desktop lyrics overlay |
| 연결 폴더(reparse point) | linked folder |

Spotify 화면의 문장은 "Couldn't ..."처럼 줄임형과 명령문을 쓰고 "Please"는 쓰지 않는다. 설치 스크립트는 "Could not ..."을 쓴다.

| 확인 | 결과 |
| --- | --- |
| 번역 검사 | JS 10 개 파일 모두 통과 |
| 테스트 | JS 288 개(ivLyrics 원본 없이 건너뛰는 10 개 제외), Python 169 개, PowerShell 6 개 묶음 통과. ivLyrics 패치 테스트는 새로 푼 ivLyrics 7.0.18 원본으로 13 개 모두 통과 |
| 0.8.3 로컬 후보 설치 | 이 PC에 덮어 설치(종료 코드 0), `messages.py` 설치됨, 도우미 0.8.3 |
| 도우미 언어 | 같은 오류에 헤더 `en`은 영어, `ko`와 헤더 없음(이 PC는 한국어 Windows)은 한국어. `code`는 `youtube_id_invalid`로 같음 |
| 영어 Spotify | 가사 제공자 이름, 싱크 표시, 지금 재생 중 화면이 영어. 우리 화면에 한글 없음 |
| 한국어 Spotify | 같은 화면이 원래 한국어. 셔플·기기 연결 가로채기와 좋아요 숨김 정상 |

## 확인하지 않은 것

- Spicetify 확장의 로드 순서를 정할 수 있는지(방안 다에 필요)
- ivLyrics 자체의 언어 설정과 Spotify 화면 언어가 다를 때 어느 쪽을 따르는 것이 자연스러운지
- 비한국어 Windows에서의 실제 설치. NSIS 설치 세부 정보 창의 `?`는 영어 출력으로 사라지는 것을 미국 OEM 코드 페이지(437)를 흉내 낸 시험으로만 확인함
- 영어 설치 프로그램 화면에서 스크립트 문구가 실제로 영어로 나오는지(언어 전달은 작은 시험 설치 파일로만 확인함)
- 한글 가사 설정 창과 싱크 대화상자를 열었을 때의 실제 화면(모듈 테스트와 화면 밖 API로만 확인함)
- `test_auto_update.ps1`(필요한 0.7.3 설치 파일이 없어 실행하지 못함)
