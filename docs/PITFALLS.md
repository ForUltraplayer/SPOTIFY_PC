# 환경 함정 기록

PC판과 안드로이드판을 고치면서 실제 환경에서만 드러난 함정을 모은다. 코드나 공식 문서만 읽어서는 보이지 않았고, 실제 PC와 Spotify에서 돌려 보고서야 확인한 것들이다. 새 함정을 찾으면 같은 형식으로 덧붙인다. 각 항목에는 확인한 날짜와 근거를 적고, 추정은 추정으로 표시한다.

| 약어 | 뜻 |
| --- | --- |
| 실행기 | Myspoti 확장 실행기(`extensions-pc.jar`, Java) |
| 도우미 | 로컬 도우미(`bridge.py`, 127.0.0.1:19643) |
| 페이지 | Spotify 안에서 도는 스크립트(`extension-player.js`, `youtube-links.js` 등) |
| 진단 포트 | Spotify를 `--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1`로 켠 루프백 전용 디버깅 연결 |

## Spotify와 Spicetify

| 함정 | 증상 | 대응 |
| --- | --- | --- |
| Spotify가 페이지 시작 뒤 `Spicetify.Player`를 새 객체로 바꿈 | 시작 때 잡은 객체에는 곡 정보가 없고, 곡 변경 신호도 오지 않으며, 감싼 재생 조작도 먹지 않음 | 쓰는 쪽이 매번 현재 객체와 비교해 바뀌었으면 다시 감싼다(`bindPlayer`). 페이지 쪽 두 모듈 모두 해당한다 |
| 앱을 켠 뒤 Spotify가 되살린 곡은 곡 변경 신호 없이 나타남 | 첫 곡을 확장에 묻지 않음 | 확인 루프에서 마지막으로 본 곡과 다르면 묻는다(`seenKey`). 재생 기기가 이 PC로 돌아온 경우도 같다 |
| 진단 포트로 페이지를 새로 고친 직후에는 `Spicetify.Player.data.item`이 비어 있음 | 화면에는 곡이 보여도 페이지 상태는 곡 없음 | 재생을 시작하기 전까지는 정상이다. 결함으로 보지 않는다 |
| 진단 포트로 페이지를 여러 번 새로 고치면 Spicetify가 반쯤 초기화된 상태로 남음 | `Spicetify.Player.playUri`가 `reading 'play'` 오류를 냄 | 새로 고치기 대신 Spotify를 껐다 켠다 |
| Spicetify가 `youtube-links.js` 사본을 `Spotify\Apps\xpui\extensions\`에 따로 둠 | 설치 폴더의 같은 파일만 바꾸면 페이지는 여전히 옛 코드를 씀(페이지는 이 사본을 먼저 불러옴) | 시험할 때 두 곳을 모두 바꾸거나 설치 프로그램으로 다시 설치한다 |
| `spclient.wg.spotify.com/metadata/4/track/<hex>`는 `Accept: application/json`을 줘도 protobuf로 답함 | JSON 해석 오류 | 바이트에서 `\x0a\x04isrc\x12\x0c` 뒤 12 글자를 읽는다. 공개 Web API 응답에는 이 PC의 토큰으로 ISRC가 오지 않았다 |
| Spotify 내장 Chromium은 AAC를 재생하지 못함 | AAC만 주는 확장 음원은 PC에서 쓸 수 없음 | 실행기에 FLAC, Opus, MP3, Vorbis만 받는다고 알린다 |
| 스크립트로 만든 클릭(`dispatchEvent`)은 실제 마우스 클릭과 처리 시점이 다름 | 스크립트 클릭으로는 실제로 나는 창 닫힘이 재현되지 않았고, 반대로 판정 방법을 잘못 써서 재현된 것처럼 보이기도 했음(2026-11-02) | 창이 열렸는지는 창 요소 자체로 판정한다. 진단 포트의 실제 입력(`Input.dispatchMouseEvent`)은 이 환경에서 메뉴에 먹히지 않았다 |

## 확장 실행기와 Windows

| 함정 | 증상 | 대응 |
| --- | --- | --- |
| Java가 Windows에서 명령줄을 시스템 코드 페이지로 읽음 | 코드 페이지 밖 글자(한국어 Windows의 태국어 사용자 이름 등)가 든 경로가 `?`로 바뀌어 실행기가 시작하지 못함(재현함) | 데이터 폴더는 `HANGUL_EXT_DATA`, 로그인 창 스크립트는 `HANGUL_EXT_AUTH` 환경 변수로 넘기고, jar는 작업 폴더 기준 이름으로 띄운다 |
| 실행기 기록이 UTF-8이 아닌 코드 페이지로 나오는데 도우미가 UTF-8 글자로 읽었음 | 해석 오류로 읽기 스레드가 멈추고 출력 통로가 차서, 실행기의 모든 요청이 기록 잠금에서 멈춤(스레드 덤프로 확인, 읽기 스레드의 오류 자체는 추정) | 도우미는 실행기 출력을 바이트로 비우고, 실행기는 `-Dstdout.encoding=UTF-8`로 띄운다 |
| 도우미의 루프백 호출에 Windows 시스템 프록시가 적용될 수 있음 | 회사 PC 등에서 실행기 호출이 전부 실패할 수 있음(독립 검토의 지적, 실제 프록시 환경은 미시험) | 실행기 호출은 프록시 없이 연결한다 |
| 끝나는 중인 Chromium 하위 프로세스에 `Stop-Process`를 하면 접근 거부가 나고, 끝난 프로세스가 잠깐 목록에 남음 | Spotify가 켜진 상태에서 업데이트 설치가 실패함(실제 설치로 재현과 수정 확인) | 오류는 무시하고, 마지막에 `HasExited`로 정말 남은 것만 센다 |
| 실행기 jar의 `-plain` 산출물과 fatJar가 같은 폴더에 생김 | 잘못된 jar를 집을 수 있음 | fatJar 이름은 `extensions-pc.jar`로 고정한다 |

## 확장

| 함정 | 증상 | 대응 |
| --- | --- | --- |
| 확장이 ISRC로 곡을 맞춤 | 안드로이드에서 되는 곡이 PC에서 안 됨. 같은 15 곡에서 ISRC 없이 10 곡, 있으면 15 곡(2026-11-02 측정) | 페이지가 곡마다 ISRC를 찾아 같이 보낸다(곡별 캐시, 3 초 제한) |
| Mornye와 FLAC Bridge는 로그인 창을 숨김 모드(`hidden: true`)로 엶 | 안드로이드에서는 로그인 창을 본 적이 없는데, PC에는 웹 창이 없어 연결이 안 됨 | 웹 창을 화면 밖에서 먼저 돌리고 8 초 뒤에만 보여 주는 엔진 규칙을 따른다 |
| Tidal을 쓰는 확장(Mornye, FLAC Bridge)은 음원을 DASH 매니페스트로 줌 | 로그인과 연결이 돼도 PC에서는 "not playable here: a DASH manifest"로 건너뜀(2026-11-02, 두 확장 각 3 곡 모두) | 도우미가 `accept.manifest: true`로 묻고 MPD를 세그먼트 계획으로 바꾸며, 페이지가 MediaSource로 재생한다(`docs/EXTENSIONS.md` "DASH 재생"). Spotify 내장 Chromium의 MediaSource는 mp4/flac을 받는 것으로 측정했다. 2026-11-02 실제 Spotify에서 Mornye의 DASH 답(55 개 세그먼트)이 재생되고, 버퍼 밖(150 초)과 안(20 초) 탐색, 일시정지가 동작함을 확인했다(진단 포트, 소리는 직접 듣지 않음) |
| Mornye는 곡마다 다른 서비스로 답하고, 일부는 암호화된 음원(transform)으로 줌 | 같은 확장이 어떤 곡은 DASH로, 어떤 곡(RED OUT, モニタリング)은 "its audio is encrypted (transform), which the PC does not decrypt"로 건너뜀(2026-11-02) | PC는 암호화 해제를 하지 않는다(처음부터 정한 선). 다음 소스가 답한다 |
| 두 Tidal 계열 확장의 MPD가 같은 형태임 | 정적 MPD, Period와 Representation 1 개(`codecs="flac"`), SegmentTemplate과 SegmentTimeline(`S` 2 개), `$Number$`, 쿼리가 붙은 절대 https 주소, 헤더 없음. 4:12 곡이 약 3.99 초 세그먼트 63 개, 초기화 세그먼트 623 바이트, 첫 세그먼트 `tfdt` 0, 세그먼트는 Range에 206으로 답함(2026-11-02, 두 확장 각 2 곡) | 안드로이드 `DashLive.parse`와 같은 형태를 기준으로 해석하고, 다른 형태는 이유를 남기고 거절한다 |
| DASH 답의 `mimeType`과 길이가 실제와 다름 | Mornye는 매니페스트 답에도 `mimeType: "audio/flac"`을 알림(실제는 `audio/mp4`). 소스가 알린 `durationMs` 252000과 MPD 타임라인 합 251573이 다름(2026-11-02) | DASH 답의 형식과 길이는 MPD에서 읽는다. 음질 줄의 "소스가 알린 정보"는 소스 값 그대로 둔다 |
| FLAC Bridge Multi는 DASH 답에 codec, 비트 깊이, 표본율을 넣지 않음 | 실행기의 `codec`이 null이 되고 음질 줄은 `quality` 문구(`Tidal · FLAC · 16-bit · 44.1 kHz`)로만 보임(2026-11-02) | 음질 줄은 실행기의 `quality`로 대신한다(기존 동작) |
| 실행기 READY 직후의 첫 요청에는 확장이 아직 준비되지 않음 | 도우미의 `ExtensionHost`로 실행기를 띄우자마자 `/v1/audio/pick`을 보내면 두 소스 모두 "not a running audio source"로 건너뜀. 3 초 기다린 뒤에는 찾음(2026-11-02, 시험 스크립트 3 회 실행에서 매번 재현) | 아직 고치지 않았다. 실제 Spotify에서 실행기를 처음 띄우는 첫 곡이 Spotify로 재생되는지는 확인하지 않았다(추정) |
| WebView2 창을 작업 표시줄에 올리면 Windows 창이 다시 만들어짐 | 숨김에서 보이는 창으로 바꿀 때 초기화가 0x80004004로 끝남(로그인 창 작업에서 실측) | 숨김 창의 같은 WebView2 컨트롤을 보이는 창으로 옮긴다 |
| 같은 확장의 로그인을 끝난 직후 다시 열면 이전 브라우저가 쿠키 폴더를 놓을 때까지 약 5 초 걸림 | 그 사이 초기화가 실패한 경우가 1 회 있었음 | 1 초 뒤 최대 2 회 다시 시도한다 |
| 확장의 로그인과 설정은 기기마다 따로임 | 폰에서 해 둔 연결이 PC로 넘어오지 않음 | PC에서 다시 연결해야 한다 |
| 확장별 기록 위치 | 원인을 찾기 어려움 | `%LOCALAPPDATA%\ivLyricsHangul\extensions\<확장 ID>\log.txt`, 코드는 같은 폴더의 `package.zip`(읽기만 한다) |
| 음질 줄의 값은 확장이 알린 값 | 실제 파일과 다를 수 있음 | 진단 포트로 FLAC 머리(STREAMINFO)를 읽어 대조한다. 2026-11-02 RED OUT은 24-bit, 48 kHz, 1769 kbit/s로 일치했다 |

## 배포와 업데이트

| 함정 | 증상 | 대응 |
| --- | --- | --- |
| 안드로이드 한글판 앱은 시험판 릴리스도 업데이트로 받음 | APK 없는 안드로이드 릴리스를 만들면 폰에 빈 업데이트가 뜸 | 실행기 jar는 PC 릴리스에 첨부하고, 안드로이드 확인용은 초안으로 올린다 |
| PC 업데이터는 시험판을 건너뛰고 설치 파일 250 MB 상한이 있음 | 상한을 넘으면 자동 업데이트가 안 됨 | 0.7.12 설치본은 212 MB다. WebView2 고정 버전 런타임(150 MB 이상)은 넣지 않는다 |
| 시험판을 내면 README의 공개 버전이 `release.json`보다 뒤처짐 | 자동 초안이 README 문장을 찾지 못해 실패함 | 자동 초안은 README에 적힌 공개 버전을 읽는다 |
| 버전을 올리기 전에 빌드한 시험 설치본은 옛 버전 번호를 가짐 | "같은 버전이 깔려 있다"고 잘못 판단함 | 시험 설치본의 `release.json`을 직접 확인한다 |
| Edge는 유럽경제지역에서 공식으로 지울 수 있음 | Edge를 쓰는 기능이 일부 PC에서 동작하지 않음 | 웹 창은 Windows 11의 일부인 WebView2 런타임을 쓴다. 런타임이 없는 일부 Windows 10에서는 Microsoft 공식 주소에서 설치 도우미를 받아 서명을 확인한 뒤 실행한다(사용권 2(b)항 때문에 동봉하지 않음) |

## 진단 절차

1. Spotify를 진단 포트로 켠다. 설치 폴더의 `Spotify\Spotify.exe`를 끄고 위 두 인수를 붙여 다시 실행한다.
2. 진단 포트의 페이지 목록(`http://127.0.0.1:9227/json/list`)에서 `xpui` 페이지에 붙어 `Runtime.evaluate`로 상태를 읽는다. 확장 플레이어의 상태는 `SpotifyHangulLinks.extensionSnapshot()`이 돌려준다.
3. 실행기 상태는 도우미의 `/ext/state`, `/ext/extensions`, `/ext/attempts/latest?track=<id>`로 읽는다. 실행기가 멈춘 것 같으면 같은 JDK의 `jstack <pid>`로 스레드를 본다.
4. 확인이 끝나면 진단 포트 없이 Spotify를 다시 켠다. 진단 포트를 켠 채로 두지 않는다.
