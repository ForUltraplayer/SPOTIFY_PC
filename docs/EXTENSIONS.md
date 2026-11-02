# PC판 확장 연결 설계

이 문서는 안드로이드 Myspoti의 확장을 PC판에서 그대로 쓰기 위한 설계다. 2026-11-02 구현을 시작했다. 목표는 안드로이드처럼 곡이 바뀌면 소스를 묻고, 음원이 있으면 끊김 없이 그 음원으로 넘어가고, 없거나 실패하면 Spotify로 자연스럽게 돌아가는 동작이다.

## 목적과 요구 사항

- Myspoti 확장(오디오 소스, 다운로드 소스 등)을 PC판에서 Myspoti와 같은 방식으로 설치하고 쓴다. 확장 패키지와 API는 Myspoti 것을 그대로 받는다.
- 확장이 곡의 음원 주소를 주면 Spotify 곡 대신 그 음원을 재생한다. 확장이 음원을 주지 않으면 Spotify가 그대로 재생한다.
- 안드로이드처럼 다음 세 가지를 재생 화면에서 바로 열 수 있어야 한다.
  - 현재 재생 중인 코덱과 음질(예: FLAC · 24-bit · 48 kHz, 소스가 알린 값과 재생기가 감지한 값)
  - 소스 선택기(이번 실행 동안 이 곡과 다음 곡을 고른 소스에서 재생, 설정의 순서는 유지)
  - 이 소스를 선택한 이유(확인한 소스와 결과, 걸린 시간, 선택된 소스, 주소가 열린 시간과 HTTP 상태, 대체 재생)
- 새 화면 문구는 영어 기본과 한국어로 둔다. PC 전체의 12 개 언어 대응은 별도 작업에서 맞춘다.

## 지키는 선

- 확장을 설치본에 넣지 않는다. 확장 목록은 Myspoti 스토어와 같은 방식, 같은 규칙으로 보인다(자체 선정 없음, 추천 없음). 공식 저장소, 사용자가 추가한 저장소, `myspoti-extension` 토픽 검색 결과 외의 목록을 PC판이 따로 두지 않고, 특정 확장만 다르게 다루지 않는다. README에서도 특정 확장을 안내하거나 추천하지 않는다.
- 특정 확장이나 서비스에 맞춘 처리를 넣지 않는다. Myspoti 확장 API만 따른다.
- 암호화된 음원의 해제(Myspoti 엔진의 PatternedBlowfish를 쓰는 Deezer식 해제)는 연결하지 않는다. 기술적 보호조치 무력화 소지가 있어서다. 이런 음원을 주는 확장의 곡은 Spotify가 재생한다.
- 확장 권한(actions) 동의, 허용 호스트, 요청 횟수와 응답 크기 제한은 Myspoti 엔진의 검사를 그대로 쓴다.

## 실측 사실

2026-11-02 이 PC의 통합 Spotify 1.3.6.1921(내장 Chrome 151)을 디버깅 포트로 열어 확인했다.

| 형식 | `<audio>` canPlayType | MediaSource |
|---|---|---|
| FLAC (audio/flac, ogg, mp4) | probably | MP4 안의 FLAC만 지원 |
| Opus, Vorbis, MP3 | probably | Opus, MP3 지원 |
| AAC | 미지원 | 미지원 |

지원 판정까지만 확인했고 실제 FLAC 파일 재생은 하지 않았다. 확인 뒤 Spotify는 한글 가사 실행 명령으로 다시 열었고 디버깅 포트가 닫힌 것을 확인했다. 같은 날 Spotify가 로그인 자동 시작(`--autostart --minimized`)으로 도우미 0.7.11과 함께 떠 있는 것도 확인했다.

같은 날(2026-11-02 08:21 UTC 마지막 확인) 새로 빌드한 실행기 jar를 빈 임시 데이터 폴더로 띄워 `GET /v1/store`가 실제 저장소와 검색을 읽는지 확인했다. 확장 패키지는 내려받거나 실행하지 않았고 색인, 검색 결과, 매니페스트, 다운로드 수만 읽었다.

| 항목 | 결과 |
|---|---|
| 공식 저장소 색인(`kota-zo/myspoti-extensions`의 `index.json`) | HTTP 200, 등록된 확장 0 개. 안드로이드와 같이 스토어에서 공식 구역을 보이지 않음 |
| 토픽 검색 | 커뮤니티 구역에 5 개 표시(GitHub 2 개, GitLab 1 개, Codeberg 2 개). 세 호스트 모두 검색 오류 없음. GitHub 검색은 직접 조회로도 2 개였다. GitLab과 Codeberg가 매니페스트 없는 저장소를 더 돌려줬는지는 따로 세지 않았다 |
| 평가 이슈 검색 | 해당 이슈 없음(5 개 모두 "아직 평가 없음") |
| 숨김 | 0 개(차단 목록과 신고 목록 비어 있음, 18 개월 넘게 방치된 저장소 없음) |
| 걸린 시간 | 첫 요청 2.9 초와 4.0 초(두 번 실행), 메모리에 읽어 둔 뒤 요청 0.004 초, `?force=1` 2.6 초 |
| 다운로드 수 | `solidsnakeater87/FLAC-Bridge-Multi-Myspoti` 5 회 |
| GitHub 비로그인 검색 한도 | 막히지 않음(검색이 HTTP 200으로 답함). 첫 확인 직후 `rate_limit` 조회에서 search 한도는 분당 10 회, 남은 횟수 10 회였다 |

측정은 이 PC의 네트워크에서 한 번씩 잰 값이며, 결과 목록은 그 시각의 검색 결과다.

같은 날 설치된 실행기 jar(0.7.12)를 설치된 확장의 사본(별도 임시 데이터 폴더)으로 띄우고, `/v1/audio/pick`에 `accept.manifest: true`와 ISRC를 넣어 `codeberg.kotazi_dev.lossless`와 `community.spotiflacbridge`에 `work/queue-tracks.json`의 두 곡(4:12, 3:37)을 물었다. 네 답 모두 DASH 매니페스트였고 구조는 같았다. 주소, 토큰, 쿼리 값은 기록하지 않았다.

| 항목 | 결과 |
|---|---|
| 답의 형태 | `url`은 빈 문자열, `headers`는 비어 있음, `expiresAt` 있음. 매니페스트는 base64 2,492~2,496 자(해독 1,869~1,871 바이트), XML 선언 있음, DOCTYPE과 ENTITY 없음 |
| MPD | `type="static"`, `profiles="urn:mpeg:dash:profile:isoff-main:2011"`, `mediaPresentationDuration` 있음, Period 1 개, AdaptationSet 1 개(`audio/mp4`), Representation 1 개(`codecs="flac"`, `id="FLAC,44100,16"`, bandwidth 약 1 Mbit/s, `audioSamplingRate="44100"`) |
| 세그먼트 | Representation 안의 SegmentTemplate(`timescale="44100"`, `startNumber="1"`), `initialization`과 `media`는 쿼리가 붙은 절대 https 주소, `media`의 표기는 `$Number$`만. SegmentTimeline은 `S` 2 개(`d="176128"`의 반복과 마지막 짧은 세그먼트, `t` 없음). 4:12 곡은 63 개, 3:37 곡은 55 개(세그먼트 약 3.99 초) |
| 길이 | 타임라인 합(251.573 초)이 `mediaPresentationDuration`(PT4M11.573S)과 같고, 소스가 알린 `durationMs`(252000)와는 0.4 초 다르다 |
| 초기화 세그먼트 | 623 바이트, `audio/mp4`, `ftyp`과 `moov`(`mvex`, `trex` 포함). 표본 항목 `fLaC`(2 채널, 16 비트, 44,100 Hz)와 `dfLa` |
| 미디어 세그먼트 | 앞 4 KB만 Range로 받아 확인했다. HTTP 206, `moof`(`mfhd`, `traf`의 `tfhd`, `tfdt`, `trun`) 다음 `mdat`, 첫 세그먼트의 `tfdt`는 0. 크기는 약 170~290 KB |
| 소스가 알린 값 | Mornye(`codeberg.kotazi_dev.lossless`)는 `mimeType: "audio/flac"`, `codec: "flac"`, 16-bit, 44.1 kHz를 알렸다(실제 형식은 `audio/mp4`). FLAC Bridge Multi(`community.spotiflacbridge`)는 codec, 비트 깊이, 표본율 없이 `quality`만 `Tidal · FLAC · 16-bit · 44.1 kHz`였다 |

구현 뒤 도우미의 `ExtensionHost.relay`와 `open_media`로 같은 확인을 다시 했다. 두 소스 모두 페이지 답에 주소가 없고 계획은 `audio/mp4; codecs="flac"`, 63 개, 251,573 ms였다. 초기화 세그먼트와 마지막 세그먼트를 도우미 중계로 `Range: bytes=0-0`만 받아 HTTP 206, `audio/mp4`를 확인했다. 실제 Spotify에서의 재생은 확인하지 않았다(아래 "미확인과 위험").

## 구조

### 확장 실행기

- 안드로이드 저장소의 `base/extensions` 모듈은 안드로이드에 의존하지 않는 JVM 모듈이다(Rhino 샌드박스, 매니페스트와 권한 검사, 훅 호출, 패키지 검증, PlayAttempt). 앱은 `Host` 인터페이스만 구현한다. 데스크톱 참고 구현(`extensions-cli`의 `DesktopHost`)도 있다.
- 안드로이드 저장소에 PC용 실행기 모듈(가칭 `extensions-pc`)을 추가하고 실행 가능한 jar 하나로 만든다. PC 저장소는 그 jar를 components.json에 소스 커밋과 SHA-256으로 고정해 받는다.
- 안드로이드 앱 계층(`Extensions.kt`)에 있는 다음 부분은 PC 실행기에서 다시 만든다: 주소로 설치와 갱신, 켜기와 끄기, 설정 저장, 소스 순서대로 묻기와 시간 제한, 일시 제외(cooldown)와 최근 실패 기억, PlayAttempt 기록, 다음 곡 미리 묻기, 상태 확인.
- 검토한 대안: PC 저장소에 엔진 복사본과 Gradle 빌드를 따로 두는 방식은 원본 엔진과 어긋날 위험이 커서 택하지 않는다. Node(`node:vm`)로 엔진을 다시 구현하는 방식은 `node:vm`이 보안 경계가 아니고 약 5천 줄을 다시 써야 해서 택하지 않는다. 두 방식 모두 시도하지 않았다.

### Java 런타임

- jlink로 실행기에 필요한 모듈만 담은 최소 Java 런타임을 설치본에 넣는다. 모듈은 jdeps로 확인한 java.base, java.desktop, java.instrument, java.logging, jdk.dynalink, jdk.httpserver, jdk.unsupported에 HTTPS용 jdk.crypto.ec를 더한 8 개다.
- 원본은 Eclipse Temurin JDK 21.0.13+9 Windows x64 zip(205,421,281 바이트, Adoptium 공개 SHA-256과 일치)이다. 이 JDK는 빌드 도구로만 쓰고 설치본에는 jlink 결과(`ext-runtime`)만 들어간다. jlink는 JDK의 `legal` 고지를 런타임 안에 그대로 복사한다.
- 측정(2026-11-02, 이 PC): `--strip-debug --no-man-pages --no-header-files --compress=zip-9`로 만든 런타임은 압축 전 48 MB이고, 만드는 데 약 4 초 걸렸다. 이 런타임에서 실행기가 0.2 초 만에 `READY`를 냈다. 설치본(NSIS 압축) 증가량은 아직 재지 않았다.
- `scripts/extension_toolchain.py`가 빌드 때 런타임을 만들고, 실행기 jar를 `extensions/extensions-pc.jar`에 두고, 그 런타임으로 실행기를 한 번 띄워 `READY`를 확인한다. 실행기 jar에 든 라이브러리 고지(Kotlin, kotlinx, OkHttp, Okio는 Apache-2.0, Rhino는 MPL-2.0)를 `licenses/`에 쓴다.
- 검토한 대안: 사용자 PC에 Java 설치를 요구하는 방식은 설치 부담 때문에 택하지 않는다. GraalVM native-image는 Rhino의 리플렉션 처리가 불확실해 시도하지 않았다.

### 실행과 종료

- 도우미(bridge.py)가 켜진 확장이 하나 이상 있을 때만 실행기를 띄우고, 도우미가 끝날 때 함께 끝낸다. 도우미는 Spotify가 끝나고 약 30~35 초 뒤 종료하므로 실행기도 그 수명을 따른다.
- 서비스 등록, 부팅 자동 시작, 실패 후 자동 재시작은 넣지 않는다. 실행기가 연속으로 시작에 실패하면 간격을 두고 재시도하다가 상한에서 멈추고, 그동안 곡은 Spotify가 재생한다.
- 실행기는 루프백 주소의 임의 포트에서 도우미가 만든 일회용 토큰으로만 요청을 받는다. Spotify 안의 스크립트는 지금처럼 도우미(127.0.0.1:19643)만 부른다.

### 확장 로그인 창

확장이 `myspoti.auth.open({url, callback, hidden})`을 부르면(Mornye의 "Connect Mornye", FLAC Bridge의 "Attiva Tidal" 등) 실행기가 로그인 창을 띄운다. 계약은 Myspoti 엔진의 `Host.openAuth`와 `AuthRequest`, `AuthResult`를 그대로 따르고, 동작은 안드로이드 앱의 `ExtensionAuth`에 맞췄다.

| 단계 | 내용 |
| --- | --- |
| 요청 | 엔진이 `AuthRequest.checked()`로 주소를 검사한 뒤 실행기의 `openAuth`를 부른다. 실행기는 id(`auth-1`처럼)를 바로 돌려주고, 결과는 나중에 `auth` 이벤트 `{id, url}` 또는 `{id, error}`로 보낸다 |
| 창 시작 | 실행기가 `HANGUL_EXT_AUTH`가 가리키는 `webview-auth.ps1`을 Windows PowerShell 5.1(`-NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File`)로 띄운다. 도우미(`extension_host.py`)가 설치 폴더의 이 스크립트를 환경 변수로 넘긴다. 스크립트가 없으면 `auth.open`이 "the sign-in window is not installed on this PC" 오류로 끝난다 |
| 요청 전달 | 시작 페이지, 콜백, hidden, 쿠키 폴더, 확장 이름, 8 초, 180 초를 JSON 한 줄로 창의 표준 입력에 쓴다. 명령줄에는 스크립트 경로만 있다. 실행기는 표준 입력을 열어 둔다 |
| 페이지 | 창은 설치 폴더 `extensions\webview2`의 WebView2 SDK 어셈블리로 WinForms 창 하나를 연다. 쿠키와 저장소는 확장별 폴더 `%LOCALAPPDATA%\ivLyricsHangul\extensions\<id>\webview`에 두므로 앱, Spotify, 다른 확장과 섞이지 않고 같은 확장의 다음 로그인까지 남는다. 확장을 제거하면 폴더와 함께 지워진다 |
| 콜백 감지 | 주 프레임의 이동(링크, 리디렉션, 폼 POST, 사용자 지정 스킴), 하위 프레임의 이동, `window.open`, 외부 스킴 실행 요청에서 주소가 엔진의 `AuthRequest.reached`와 같은 규칙으로 콜백에 닿으면 이동을 취소하고 그 주소만 표준 출력에 `{"url": …}` 한 줄로 쓰고 닫는다. 실행기는 받은 주소를 `reached`로 한 번 더 검사하고, 맞지 않으면 `helper-failed`로 바꾼다 |
| 막는 것 | http, https, about 외의 스킴 이동, 새 창, 다운로드, 권한 요청(위치, 카메라 등), 개발자 도구, 페이지와 앱 사이의 스크립트 연결 |
| hidden | 같은 크기의 테두리 없는 창을 모든 화면 바깥에 두고 작업 표시줄에서 뺀 채 페이지를 연다. 8 초 안에 콜백에 닿지 않으면 같은 WebView2 컨트롤을 로그인 창으로 옮겨 보인다. 페이지는 다시 불러오지 않는다. 창 자체를 작업 표시줄에 올리면 Windows 창이 다시 만들어져 초기화 중인 페이지가 끝나므로(실측, 0x80004004) 이 방식을 쓴다 |
| 창 모양 | 제목 "<확장 이름>: 로그인", 안내문(입력한 내용과 쿠키는 이 확장의 로그인 창에만 남고 확장은 마지막 주소만 받는다), 현재 호스트 줄. Windows 화면 언어가 한국어면 한국어, 아니면 영어다. 백그라운드 프로세스가 띄운 창이 Spotify 뒤에 남지 않게 보일 때 한 번 맨 위로 올린다(계속 위에 두지는 않는다) |
| 오류 | 창을 닫으면 `closed`(안드로이드와 같은 값), 180 초 안에 콜백에 닿지 않으면 `timeout`, 페이지를 불러오지 못하면 `network: <WebErrorStatus>`(HTTP 403, 503 같은 확인 페이지 상태는 오류로 보지 않는다), 런타임이 없고 설치도 실패하면 `webview2-missing`, WebView2 초기화 실패는 `webview2-failed: <HRESULT>`, 부품 누락이나 응답 없는 종료는 `helper-failed` |
| 한 번에 하나 | 같은 확장의 창이 열려 있으면 두 번째 요청을 "a sign-in page is already open"으로 거절한다. 안드로이드는 앱 전체에서 하나지만, PC는 확장마다 창과 쿠키 폴더가 따로 있어 확장별로 하나다 |
| 기록 | 실행기 기록에는 "sign-in auth-1 opened on <시작 호스트> (hidden)"과 "reached the callback" 또는 오류 키만 남는다. 콜백 주소와 그 쿼리, 쿠키는 어디에도 쓰지 않고 확장에만 넘긴다 |

프로세스 수명은 다음과 같다.

- 로그인 창은 `auth.open` 때만 뜨고 결과를 쓰면 바로 끝난다. 서비스, 자동 시작, 재시작 설정은 없다.
- 확장을 끄거나 제거하거나 다시 시작하면 열린 창을 결과 없이 닫는다(안드로이드의 `ExtensionAuth.cancel`). 실행기가 끝날 때도 모두 닫는다. 창의 자식 프로세스(WebView2 브라우저 프로세스)도 함께 끝낸다.
- 실행기가 강제로 끝나 표준 입력이 닫히면 창이 0.2 초 간격 확인에서 이를 보고 결과 없이 닫힌다.
- 창이 답하지 않으면 실행기가 14 분(창이 세는 180 초, 런타임 설치 여유 10 분, 여유 1 분) 뒤 창을 끝내고 `timeout`을 보낸다.
- 런타임 확인은 `CoreWebView2Environment.GetAvailableBrowserVersionString()`으로 한다. 없으면 Microsoft 공식 주소(`go.microsoft.com/fwlink/p/?LinkId=2124703`)에서 Evergreen 부트스트래퍼를 임시 폴더로 받아, Authenticode 서명이 유효하고 서명자가 Microsoft Corporation일 때만 Microsoft 안내대로 `/silent /install`로 실행하고(관리자 권한이 아니면 사용자 단위 설치) 최대 10 분 기다린 뒤 다시 확인한다.
- 같은 확장의 로그인을 끝난 직후 다시 열면 이전 브라우저 프로세스가 쿠키 폴더를 놓을 때까지 약 5 초 더 걸렸다(실측 3 회). 그 사이 초기화가 실패하면 1 초 뒤 최대 두 번 다시 만든다.

WebView2를 고른 이유와 대안은 다음과 같다.

- 확장 API가 요구하는 것은 앱과 분리된 쿠키를 가진 전체 웹 보기와 콜백 주소 감지다(`Actions.kt`의 `WEBVIEW_AUTH`). 기본 브라우저로 열면 사용자 지정 스킴 콜백과 리디렉션 중간 주소를 받을 수 없고, 쿠키가 사용자 브라우저와 섞인다.
- Edge 브라우저는 EEA에서 공식적으로 제거할 수 있으므로 Edge 실행 파일에 기대지 않는다. Evergreen WebView2 Runtime은 Windows 11에 포함되고 Windows 10 대부분에도 설치되어 있다(Microsoft 배포 문서). 없는 PC를 위해 약 1.9 MB 부트스트래퍼만 넣는다.
- Fixed Version 런타임(현재 212.2 MB 설치 파일)은 업데이트 설치 파일 한도(250 MB)에 걸리므로 넣지 않았다. Spotify의 내장 Chromium은 Spotify 프로세스 안이라 확장별 쿠키 분리와 주소 가로채기를 할 수 없어 쓰지 않았다. 둘 다 시도하지 않았다.
- 창은 실행기(Java) 안이 아니라 별도 PowerShell 프로세스다. Java에서 WebView2를 쓰려면 네이티브 연결 라이브러리를 새로 넣어야 하고, Windows PowerShell 5.1과 .NET Framework 4.x는 모든 Windows 10, 11에 있어 SDK의 .NET Framework 어셈블리를 그대로 쓸 수 있다. 이 프로세스는 로그인 중에만 있다.
- 설치본 증가: SDK 어셈블리 2 개와 로더 2 개(x64 194,912 바이트, arm64 180,104 바이트), 고지 2 개로 압축 전 약 3.0 MB다. 압축한 Setup.exe의 실제 증가량은 아래 "미확인과 위험"에 적는다.

### 재생

- 곡이 바뀌면 Spotify 안의 스크립트가 도우미에 그 곡의 음원을 묻는다. 도우미는 실행기에 묻고, 실행기는 켜진 오디오 소스를 순서대로 묻는다(곡당 15 초 안).
- 음원이 있으면 Spotify를 일시정지하고, 도우미의 미디어 중계 주소를 `<audio>`로 재생한다. 중계는 확장이 준 헤더를 붙이고, Range 요청과 탐색을 넘기고, 주소가 401, 403, 404, 410으로 거절되면 실행기에 한 번 다시 묻는다. 리디렉션은 안드로이드의 ExtensionMediaHttp처럼 다룬다. 최대 5 번까지 따라가고, https에서 http로 내려가는 것과 이 컴퓨터나 사설망 주소(루프백, 사설, 링크 로컬, 예약 주소)로 가는 것은 따라가지 않는다. 호스트나 포트가 바뀌면 확장의 헤더를 빼고 보낸다. 확장 헤더의 Accept-Encoding은 넘기지 않는다(중계가 Content-Encoding을 넘기지 않으므로). 첫 주소는 엔진이 확장의 허용 호스트로 검사한 것이다. 이름 해석과 실제 연결 사이에 주소가 바뀌는 경우(DNS rebinding)는 막지 않는다.
- 재생바, 탐색, 이전과 다음, 음량, 가사 싱크는 지금의 YouTube 직접 재생 경로(`youtube-links.js`의 `new Audio()`와 Spotify 정지 유지, ivLyrics의 외부 재생 시간)를 확장해 연결한다. 가사는 원래 Spotify 곡 ID를 그대로 쓰므로 시간 출처만 바꾼다.
- 일반 FLAC, Opus, MP3, Vorbis 주소는 `<audio>`로, DASH 매니페스트(fragmented MP4 안의 FLAC 또는 Opus)는 같은 `<audio>`에 붙인 MediaSource로 재생한다(아래 "DASH 재생"). AAC와 DRM 음원은 재생하지 않는다.

### DASH 재생

Tidal 계열 소스(Mornye, FLAC Bridge)는 음원을 주소 대신 MPEG-DASH 매니페스트(base64 MPD)로 준다. 엔진 계약(`Hooks.kt`의 `AudioStream`)은 "FLAC in fragmented MP4, 세그먼트를 순서대로, 탐색 가능하게 재생"이다. PC는 다음처럼 나눠 재생한다.

| 단계 | 맡는 곳 | 하는 일 |
|---|---|---|
| 받기 | 도우미(`extension_host.py`) | 실행기 요청에 `accept.manifest: true`를 넣는다. 실행기는 매니페스트를 받은 그대로 `stream.manifest`로 돌려준다 |
| 해석 | 도우미 `dash_plan` | MPD를 표준 라이브러리 XML 해석기로 읽어 세그먼트 계획을 만든다. 페이지에는 계획과 도우미 주소 하나만 주고, 매니페스트, 세그먼트 주소, 확장 헤더는 넘기지 않는다 |
| 중계 | 도우미 `open_media`, `bridge.py` `/ext/media/<id>/init`, `/ext/media/<id>/<번호>` | 일반 주소와 같은 중계를 쓴다. 확장 헤더, Range 전달, 리디렉션 규칙(같은 호스트에만 헤더, https에서 http로 내려가지 않음, 사설 주소 거부), 20 초 제한이 같다 |
| 재생 | 페이지(`extension-player.js`) | MediaSource와 SourceBuffer(sequence 모드)에 초기화 세그먼트, 이어서 세그먼트를 순서대로 붙인다 |

도우미가 페이지에 주는 답은 일반 답의 `stream`에서 `url`, `headers`, `manifest`를 빼고 다음을 더한 것이다.

```json
{"media": "/ext/media/<id>", "dash": {"mime": "audio/mp4; codecs=\"flac\"", "durationMs": 251573, "segments": [{"t": 0, "d": 3.9938}]}}
```

`segments`의 `t`(시작)와 `d`(길이)는 초 단위이며 첫 세그먼트를 0으로 둔다. 페이지는 `<media>/init`과 `<media>/<0부터 센 번호>`를 요청한다. 계획이 형식에 맞지 않으면 페이지는 그 답을 재생하지 않는다(`Model.dashPlan`).

도우미가 받는 MPD와 거절하는 MPD는 다음과 같다. 안드로이드의 `DashLive.parse`는 SegmentTemplate과 SegmentTimeline, `$Number$`, 절대 주소만 다루고, 실제 두 확장의 답도 이 형태였다(아래 "실측 사실"). 도우미는 같은 형태에 표준이 정한 상속과 표기 몇 가지를 더 받는다.

| 구분 | 내용 |
|---|---|
| 받음 | 정적(`type="static"`) MPD 하나의 Period, `audio/mp4`의 `flac` 또는 `opus` Representation(여럿이면 bandwidth가 가장 큰 것), SegmentTemplate과 SegmentTimeline(`S@t`, `S@d`, `S@r`, 마지막 `S`의 `r="-1"`) 또는 고정 `duration`, `$Number$`, `$Time$`, `$RepresentationID$`, `$Bandwidth$`, `%0Nd` 자릿수, `$$`, MPD, Period, AdaptationSet, Representation 단계의 BaseURL 상대 주소 결합, 위 단계에서 아래 단계로 이어지는 SegmentTemplate 속성 |
| 거절 | DOCTYPE, ENTITY, CDATA가 든 문서(엔티티 확장을 원천 차단), 1 MB 초과, 동적(live) MPD, Period 2 개 이상, SegmentList와 SegmentBase, AAC 등 다른 코덱, 모르는 `$` 식별자, 세그먼트 5,000 개 초과, BaseURL 결합 뒤 http(s)가 아니거나 4,096 자를 넘는 주소, 호스트 5 개 이상, 도우미의 호스트 검사(`public_host`, 모든 해석 주소가 공인 주소)를 통과하지 못한 호스트 |

거절한 답은 페이지에 `{found: false, reason: "not-playable"}`로 가고 Spotify가 그 곡을 재생한다. 도우미는 거절 사유를 `/v1/attempts/note`에 `DASH manifest not played: <사유>`로 남겨 "이 소스를 선택한 이유"에서 보이게 한다.

페이지의 재생 규칙은 다음과 같다.

- 재생 위치에서 약 30 초 앞까지 붙인다(`POLICY.dashAheadSec`). 재생 중 `timeupdate`, 탐색의 `seeking`, 붙이기를 마친 `updateend`마다 다음에 붙일 세그먼트를 정한다(`Model.dashNext`). 붙여 둔 구간 안이면 그 구간 끝 다음 세그먼트를, 밖이면 새 위치를 담은 세그먼트를 고른다. 받는 중인 세그먼트가 필요 없어지면 그 요청을 취소한다.
- 바로 앞 세그먼트에 이어지지 않는 세그먼트(곡 중간에서 시작, 탐색)는 `timestampOffset`을 계획의 시작 시간으로 두고 붙인다. 이어지는 세그먼트는 sequence 모드가 앞 세그먼트 끝에 잇는다. 세그먼트 안의 시간값(`tfdt`)이나 `presentationTimeOffset`에 기대지 않는다.
- 마지막 세그먼트 끝까지 붙으면 `endOfStream()`을 부르고, 그 뒤의 `ended`는 일반 주소와 같이 다음 곡이나 한 곡 반복으로 이어진다.
- 세그먼트가 401, 403, 404, 410이면 일반 주소의 거절과 같이 `/ext/audio/again`에 한 번 묻고 같은 위치에서 새 답으로 잇는다. 그 밖의 실패(네트워크, 15 초 제한, 5xx)는 1 초 뒤 그 세그먼트를 한 번 더 받고, 다시 실패하면 Spotify가 같은 위치에서 재생한다. 미디어 요소의 오류(해독 등)는 일반 주소와 같이 다시 묻기부터 한다.
- Chromium의 오디오 버퍼가 차서 `QuotaExceededError`가 나면 재생 위치 10 초 전까지의 구간을 지우고, 지울 것이 없으면 2 초 뒤 다시 붙인다. 받은 세그먼트는 버리지 않고 들고 있다가 붙인다.
- 맞춘 전환, 재생바, 가사 시간, 음량, 혼합 재생목록 계약, 음질 줄은 같은 `<audio>`를 쓰므로 일반 주소와 같다. 감지한 정보는 범위 확인 대신 받은 세그먼트의 크기와 길이로 비트레이트를 셈한다(예: `audio/mp4 · 4:11 · 1035 kbit/s`).
- 곡을 바꾸거나 재생기를 정리할 때 MediaSource의 객체 주소를 해제하고 받는 중인 요청을 취소한다. 객체 주소는 `sourceopen`에서도 해제한다.
- `MediaSource.isTypeSupported`가 그 형식을 받지 않으면 그 곡은 Spotify가 재생하고 사유를 기록에 남긴다.

### 페이지의 재생 전환 규칙

`extension-player.js`(도우미의 `/ext/player.js`, `youtube-links.js`가 불러온다)가 다음 규칙으로 바꾼다. 곡을 묻는 동안 Spotify의 시작을 막지 않는다.

- 미리 받은 답이 있는 곡(앞 곡 재생 약 10 초 뒤 `ahead: true`로 물어 둔 답, 10 분 안이며 만료 30 초 전까지)은 곡이 바뀌는 즉시 Spotify를 일시정지하고 확장 음원을 Spotify 위치(약 0 초)에서 시작한다. 안드로이드에서 미리 받은 곡이 바로 열리는 것과 같게 Spotify 소리가 거의 들리지 않는다.
- 답이 곡 재생 중에 오면 곡 시작 후 10 초 안의 답만 받는다. 확장 음원을 소리 없이 Spotify보다 0.8 초 앞에서 미리 재생하고, 두 위치가 0.12 초 안으로 맞으면(앞서면 그만큼 멈췄다가) 같은 작업에서 Spotify를 일시정지하고 확장 음원의 소리를 켠다. 위치가 뒤처지면 앞으로 옮겨 최대 3 번 다시 맞춘다. 8 초 안에 준비되지 않거나 10 초가 지난 답은 그 곡을 Spotify에 맡기고 기록만 남긴다. 곡 한가운데에서 소리가 바뀌는 것보다 Spotify를 유지하는 편이 자연스럽기 때문이다.
- Spotify가 일시정지 상태일 때 온 답은 시간과 관계없이 바로 바꾸고 일시정지를 유지한다.
- 답이 없거나 실행기를 쓸 수 없거나(503) 받을 수 없는 형식이면 Spotify가 그대로 재생한다. 화면에서는 음질 줄이 "Spotify"로 남을 뿐이다. 다른 기기에서 재생 중이거나 YouTube 혼합 재생 중이면 묻지 않는다.
- 주소가 거절되거나(401, 403, 404, 410) 미디어 오류가 나면 `/ext/audio/again`에 한 번 묻고, 다시 실패하면 Spotify를 확장 음원이 재생하던 위치로 옮겨 재생하며 대체 사실을 `/ext/attempts/note`에 남긴다. 주소를 연 결과는 `<audio>`가 재생 가능해진 시간과, 도우미 중계에 `Range: bytes=0-0`으로 확인한 HTTP 상태, 형식, 전체 크기로 남긴다.
- 확장 음원이 재생되는 동안 Spotify 엔진은 일시정지 상태로 둔다. 전환 뒤 4 초 동안 Spotify가 다시 재생되면 곧바로 멈추고, 그 뒤에 Spotify가 재생되면 미디어 키, 트레이, Connect의 재생 명령으로 보고 확장 음원의 재생과 일시정지를 바꾼다. 재생바의 재생과 일시정지, 이전(3 초 넘게 재생했으면 처음으로), 다음, Space 키, `Spicetify.Player` 호출은 확장 음원으로 보낸다. 탐색은 Spotify 재생바를 그대로 쓰고, 멈춰 있는 엔진 위치가 바뀌면 확장 음원을 그 위치로 옮긴다. 음량과 음소거는 Spotify 슬라이더 값을 YouTube 직접 재생과 같은 측정 표로 바꿔 적용한다. 곡이 끝나면 Spotify의 반복 설정이 한 곡 반복이면 처음부터 다시 재생하고, 아니면 Spotify의 다음 곡으로 넘긴다(셔플과 반복 순서는 Spotify가 정한다).
- 가사는 ivLyrics 어댑터의 `setExternalClock`으로 시간만 확장 음원에서 받는다. 곡 정보, 표지, 좋아요는 Spotify 곡 그대로다.

### 스토어

안드로이드 앱의 `ExtensionStore`, `Extensions.catalog`, `Extensions.fetch`를 실행기(`ExtensionStore.kt`)로 옮겼다. 엔진(`base/extensions`)의 `Catalog`, `Discovery`, `Ranking`, `Store`를 그대로 쓰므로 목록에 오르는 확장, 순서, 숨김, 상태 단추는 Myspoti와 같다.

- 읽는 곳: Myspoti 공식 저장소 색인(`https://raw.githubusercontent.com/kota-zo/myspoti-extensions/main/index.json`, 항상 읽고 등록된 확장이 있을 때만 보이며 지울 수 없다), 사용자가 추가한 저장소 색인(`registry.json`의 `repositories`, 안드로이드와 같은 형식), GitHub, GitLab, Codeberg에서 `myspoti-extension` 토픽이 붙은 공개 저장소(호스트마다 검색 한 번, 매니페스트는 8 개씩 동시에 읽고, 없거나 검사에 걸린 매니페스트의 저장소는 뺀다).
- 저장소 색인이 차단하라고 적은 설치 확장은 안드로이드처럼 끈다.
- 커뮤니티 구역은 `Ranking.order`로 점수(👍 비율의 베이즈 평균), 최근 갱신 순으로 늘어놓는다. 차단 목록이나 신고 목록에 있는 확장, 10 표 이상이면서 점수 0.4 미만인 확장, 18 개월 넘게 갱신되지 않은 확장은 `Ranking.hidden`에 따라 "모두 보기" 뒤에 둔다. 차단과 신고는 공식 저장소의 `blocked.json`을 따른다.
- 평가는 저장소 주인이 연 `myspoti-ratings` 이슈의 👍와 👎만 센다(GitHub만 해당). PC판은 평가를 보기만 한다. 공식이나 사용자 저장소의 항목도 같은 저장소가 토픽 검색에 나오면 목록 줄에 그 평가를 보인다. 안드로이드는 이 경우 목록 줄에는 "아직 평가 없음"을, 확장 페이지에만 평가를 보이므로 이 점이 다르다.
- 캐시: 색인은 실행기가 떠 있는 동안 한 번 읽고 새로고침 때 다시 읽는다(CDN 캐시를 피하려고 `t=` 쿼리를 붙인다). 검색, 매니페스트, 평가, 다운로드 수는 데이터 폴더의 `cache/`에 6 시간 보관한다. 새로고침은 캐시를 건너뛰지만, 호스트가 403이나 429로 요청 한도를 알리면 이전 사본을 쓴다. 새로고침은 안드로이드처럼 차단 목록도 다시 읽고, 저장소에서 설치한 확장의 업데이트 확인을 뒤에서 시작한다.
- 설치: 색인 항목이 저장소를 가리키면 그 저장소의 최신 릴리스(없으면 기본 브랜치)를 받고, 색인에 sha256이 있으면 대조한다. 패키지 주소만 있으면 색인 주소 기준으로 받아 sha256이 다르면 거절한다. 받은 패키지의 id가 색인과 다르거나 차단 목록에 있으면 거절한다. 통과하면 `/v1/install/preview`와 같은 대기 객체를 돌려주므로 동의 화면과 `/v1/install/confirm`은 그대로다.
- 남은 일: 평가 투표(GitHub 기기 로그인으로 👍, 👎 달기)는 PC판에 넣지 않았다. 안드로이드의 설치한 확장 페이지가 검색 결과의 저장소 id와 설치 때 고정한 id를 비교해 보이는 "저장소가 바뀜" 경고와, 스토어 확장 페이지의 신고 단추도 아직 없다.

### 화면

- 재생 화면의 음질 줄: 재생바 오른쪽 조작부 앞에 "<소스 이름> · FLAC · 24-bit · 48 kHz" 또는 "Spotify"를 보인다(소스 선택기로 고른 세션에는 "임시"를 붙인다). 확장이 하나라도 설치되어 있을 때만 보인다. 누르면 재생 상세 정보 창(음질, 소스, 이 소스를 선택한 이유)을 연다.
- 소스 선택기는 `GET /v1/session`의 `choices`를 그 순서대로 보이고, 고르면 `/v1/audio/pick`으로 이 곡부터 그 소스에서 재생한다. "내 순서로 돌아가기"는 `POST /v1/session {source: null}`로 세션 선택만 지우며, 곡은 지금 재생하는 곳에서 계속된다.
- 확장 관리: 프로필 메뉴의 "확장 관리"에서 연다. 안드로이드처럼 "스토어"와 "설치됨" 두 보기로 나뉘고, 설치한 확장이 없으면 스토어로 연다. "설치됨" 탭에는 저장소에 새 버전이 있거나 승인을 기다리는 업데이트 수를 붙인다. "설치됨" 보기에서는 저장소 주소로 설치, 권한 동의 화면, 켜기와 끄기, 확장 설정, 소스 순서, 제거, 업데이트 확인을 한다.
  - 스토어 보기는 안드로이드 스토어 탭의 배치를 따른다. 위에서부터 검색 칸, 목록에 있는 분류만 보이는 분류 칩, 공식 저장소(등록된 확장이 있을 때만, "공식" 표시), 사용자가 추가한 저장소("직접 추가함" 표시, 검토하지 않았다는 안내, 제거 단추), 커뮤니티 구역("GitHub, GitLab, Codeberg에서", "커뮤니티" 표시, 만든 사람 책임 안내), "다른 설치 방법"(저장소 추가와 그 위험 안내) 순이다. 구역마다 새로고침 단추가 있고, 읽지 못한 저장소나 검색에 실패한 호스트는 오류 줄로 보인다.
  - 한 줄에는 아이콘(색인이 준 https 주소일 때만), 이름, 버전, 설명(없으면 "제작 …· 저장소 …" 또는 "인증되지 않음"), 충돌하는 설치 확장, 평가(저장소가 있는 확장만 "★ 4.8 · 20표" 또는 "아직 평가 없음")와 갱신일, "업데이트" 또는 "설치됨" 표시, 상태 단추(설치, 업데이트, 설치됨, 호환되지 않으면 누를 수 없는 설치와 필요한 버전 안내)가 들어간다.
  - 커뮤니티 구역의 숨긴 확장은 "모두 보기(N개 숨겨짐)"로 펼친다. 펼친 동안 숨긴 확장의 평가 줄은 경고색으로 보인다.
  - 줄을 누르면 확장 페이지를 연다. 이름, 작성자 줄, 버전과 분류, 평가와 다운로드 수(GitHub 저장소만), 설치된 버전과의 차이, 상태 단추, 설명, 태그, 변경 사항, 하는 일(고위험 먼저, 고위험 경고), 세부정보(갱신일, 필요한 Myspoti 버전, 크기, 색인의 sha256 앞 16 자리), 홈페이지와 저장소 링크를 보인다.
  - 설치와 업데이트 단추는 `/ext/store/install`로 패키지를 받은 뒤, 주소로 설치할 때와 같은 동의 화면을 열고 `/ext/install/confirm`으로 마친다. 실행기가 거절하면(예: sha256 불일치) 그 사유를 보이고 목록에 남는다.
  - 동의 화면은 미리 보기의 `asks`를 모두 보이고(고위험을 먼저, 업데이트에서는 `new`인 작업에 "이 버전에서 새로 추가됨"을 붙인다), `clashes`마다 새 확장을 쓸지 설치된 확장을 유지할지 고르게 해 `keep`으로 보낸다. `plan`이 `not-newer`이거나 `compatible`이 거짓이면 설치할 수 없다. `granted`에는 `asks`의 키를 모두 넣고, `not-granted` 거절이면 빠진 작업을 보인다.
  - 업데이트 확인은 `result` 키를 문구로 보이고, `pending`이 오면 그 객체로 같은 동의 화면을 연다.
  - 설정은 text, secret, toggle, number, choice를 바꾸고, 바꾼 값만 보낸다. 값을 정한 설정은 "기본값"으로 `null`을 보내 되돌린다. secret은 값을 받지 않으므로 설정 여부만 보이고, 입력했을 때만 보낸다. button은 `{press: key}`로 누른다. PC는 모바일 데이터에 있지 않으므로 네트워크별 설정은 Wi-Fi 값만 보이고 바꾼다(`key@cell`은 쓰지 않는다).
- 화면은 Spicetify 확장(JavaScript)으로 Spotify 안에 그린다. 문구는 영어와 한국어이며 Spotify의 화면 언어로 고른다.

## 실행기 API

도우미는 실행기를 jar가 있는 폴더에서 `java -jar extensions-pc.jar --port 0 --token <토큰> --app-version <버전>`으로 시작하고, 데이터 폴더는 환경 변수 `HANGUL_EXT_DATA`로 넘긴다(`--data <폴더>`도 받는다). Java는 Windows에서 명령줄을 시스템 코드 페이지로 읽으므로, 그 밖의 글자가 든 경로(한국어 Windows의 태국어 사용자 이름, 영어 Windows의 한글 사용자 이름)를 명령줄로 넘기면 `?`로 깨져 실행기가 시작하지 못한다(2026-11-02 재현). 도우미의 실행기 호출은 시스템이나 환경 변수의 프록시를 쓰지 않는다. 실행기가 READY 뒤 60 초 안에 끝나도 시작 실패로 세고, 실패가 이어지면 5 초, 30 초, 120 초, 그 뒤로는 30 분마다 다시 시도한다. 실행기는 준비되면 표준 출력 첫 줄에 `READY <포트>`를 쓴다. 데이터 폴더는 `%LOCALAPPDATA%\ivLyricsHangul\extensions`이며 설치한 패키지, 권한, 설정, 확장별 저장소, 소스 순서를 담는다. 모든 요청은 127.0.0.1에서만 받고 `X-Hangul-Token` 머리글이 맞아야 하며, 본문과 응답은 JSON이다. 화면 문구는 실행기가 만들지 않고 키(outcome, reason 등)만 돌려준다.

| 요청 | 내용 |
|---|---|
| `GET /v1/health` | `{protocol, version, ready}` |
| `GET /v1/extensions` | 설치한 확장 목록: id, 이름, 버전, 작성자, 설명, 아이콘(data URL), 켜짐, 상태(live, 사유), 제공 훅, 권한 목록(key, 단계, critical, 이유, 호스트, 허용 여부), 설정 정의와 현재 값, 출처(저장소, ref, 커밋) |
| `POST /v1/install/preview` `{url}` | 저장소 주소(GitHub, GitLab, Codeberg)나 패키지 주소를 받아 내려받고 검증한 뒤, 설치하지 않고 매니페스트 요약과 물어볼 권한, 교체될 기존 버전, 충돌을 돌려준다(`pending` 키 포함) |
| `POST /v1/install/confirm` `{pending, granted}` | 사용자가 허용한 권한으로 설치한다 |
| `POST /v1/extensions/{id}/enabled` `{enabled}` | 켜기와 끄기 |
| `POST /v1/extensions/{id}/settings` `{values}` | 설정 저장 |
| `POST /v1/extensions/{id}/remove` | 제거 |
| `POST /v1/extensions/{id}/update` | 업데이트 확인과 적용(권한이 늘면 다시 동의를 받는 `pending`을 돌려준다) |
| `GET /v1/order`, `POST /v1/order` `{order}` | 오디오 소스 순서. `"spotify"`도 한 자리로 들어간다 |
| `POST /v1/audio` `{track, ahead, accept}` | 순서대로 오디오 소스를 묻는다. `accept`는 PC가 재생할 수 있는 형식(`flac`, `opus`, `mp3`, `vorbis`)과 DASH 가능 여부(`manifest`)다. 도우미는 `manifest: true`를 보낸다. 받을 수 없는 답(AAC, `manifest: false`일 때의 manifest, 변환이 필요한 transform)은 다음 소스로 넘기고 기록에 남긴다. 결과: `{found, attempt, extension, name, stream:{url, headers, mimeType, codec, bitDepth, sampleRate, quality, expiresAt, manifest?}}` 또는 `{found:false, attempt, reason}`. DASH 답은 `url`이 빈 문자열이고 `manifest`에 확장이 준 base64 MPD가 그대로 온다 |
| `POST /v1/audio/pick` `{track, source}` | 소스 선택기에서 고른 소스(또는 `"spotify"`)만 묻고, 실행기가 끝날 때까지 다음 곡에도 그 소스를 먼저 쓴다 |
| `POST /v1/audio/again` `{track}` | 주소가 401, 403, 404, 410으로 거절됐을 때 고른 소스에 한 번 다시 묻는다 |
| `POST /v1/attempts/note` `{trackId, open, detected, fallback, error}` | 재생기가 주소를 연 결과와 감지한 형식을 기록에 더한다 |
| `GET /v1/attempts/latest?track=<id>` | 그 곡의 마지막 PlayAttempt(선택 이유 화면용) |
| `GET /v1/session` | 소스 선택기로 고른 소스 |
| `GET /v1/store`, `GET /v1/store?force=1` | 스토어 목록. `repos`: 보이는 저장소 배열(공식은 등록된 확장이 있을 때만 맨 앞, 이어서 사용자 저장소) `{url, name, official, loaded, error, extensions}`. `community`: `{index:"github:topic/myspoti-extension", loaded, error, hidden, extensions}`이며 `extensions`는 숨긴 것까지 순위 순서로 모두 담고 `hidden`은 숨긴 수다. 항목마다 `index, id, name, version, versionCode, apiVersion, needsApi, author, description, repo, owner, repoPage, homepage, icon, updatedAt, category, tags, changelog, minAppVersion, size, sha256, action(install, update, installed, incompatible), installedVersion, asks, critical, rated, rating{up, down, votes, stars, issue}, hidden(blocked, flagged, low-score, stale 또는 null), clash{kind, other, otherName}`. `force=1`은 새로고침이다 |
| `POST /v1/store/repos` `{add}` 또는 `{remove}` | 사용자 저장소를 더하거나 뺀다(`add`는 https 주소만). 결과: `{repositories}` |
| `POST /v1/store/install` `{index, id}` | 그 색인의 항목을 안드로이드 `fetch`와 같은 방식으로 받아 검증하고 `/v1/install/preview`와 같은 대기 객체를 돌려준다. 목록에 없으면 404 `not-listed`, sha256이 다르면 400 `refused` |
| `GET /v1/store/downloads?repo=<owner/name>` | GitHub 저장소 최신 릴리스 패키지의 다운로드 수. 결과: `{repo, downloads}`(없으면 null) |

Myspoti의 차단 목록(ExtensionUpdates.blocked)과 권한 검사, 요청 제한은 엔진 동작을 그대로 따른다.

도우미는 페이지의 `/ext/...` 요청을 위 경로로만 넘긴다(`extension_host.py`의 `FORWARD`). 쿼리는 `attempts/latest`의 `track=`, `store`의 `force=1`, `store/downloads`의 `repo=<owner/name>`만 넘기고 나머지는 404로 막는다. 스토어 읽기와 스토어 설치는 실행기 응답을 120 초까지 기다리고, 다른 요청은 25 초다.

구현(안드로이드 저장소 `base/extensions-pc`, 2026-11-02)은 안드로이드 동작을 그대로 따르며 위 표와 다른 점은 다음과 같다. `/v1/audio/again`은 안드로이드의 `ExtensionAudio`처럼 보관한 답을 버리고 순서 전체에 다시 묻는다. 모든 소스에 동시에 묻고 순서상 첫 답을 고르며, 나머지는 취소한다. 실행기는 시작할 때와 6 시간마다 Myspoti 공식 저장소의 차단 목록(`blocked.json`)을 받고, 저장소에서 설치한 확장의 업데이트를 확인한다. 권한이 늘지 않는 업데이트는 안드로이드처럼 24 시간 뒤 적용한다. 실행기는 자신을 띄운 도우미가 끝나면 함께 끝난다(`ProcessHandle.parent().onExit()`). 로그인 페이지(`myspoti.auth.open`)는 아래 "확장 로그인 창"으로 연다. 그 밖에 화면이 필요한 기능(확인 창, 확장의 웹 페이지)과 `myspoti.spotify`, 재생 제어, 기기 증명, 가사와 다운로드 훅은 아직 PC에서 지원하지 않는다. ISRC는 Spotify 카탈로그를 조회하지 않고 같은 곡의 이전 요청 값만 쓴다.

## 구현 순서

1. 실행기 모듈과 PC용 Host: 설치, 설정, 오디오 소스 묻기, PlayAttempt를 루프백 API로 제공. 단위 검사.
2. 도우미 연결과 미디어 중계: 실행기 수명 관리, 헤더와 Range 중계, 만료 재질의.
3. Spotify 곡 바꿔 재생: 정지 유지, 재생바와 다음 곡, 실패 시 Spotify 복귀, 가사 시간 출처.
4. 음질 줄, 음질 창(소스 선택기, 선택 이유), 확장 관리 화면.
5. 설치본에 실행기 jar와 최소 Java 런타임 포함, 호환성 검사와 설치 시험, 실제 FLAC 재생 확인.

## 실제 PC 시험 (2026-11-02)

설치본 시험판을 이 개발 PC에 설치하고, Spotify를 루프백 진단 포트(127.0.0.1:9227)로 열어 페이지 안을 읽었다. 시험 뒤 진단 포트 없이 다시 켰다. 사용자가 스토어에서 Qobuz Hi-Res, FLAC Bridge Multi, Stream & Download Mornye Integration을 설치한 상태였다.

처음에는 재생은 되지만 확장 음원으로 바뀌지 않고 음질 줄도 보이지 않았다. 원인은 네 가지였고, 모두 고친 뒤 시험을 더했다.

| 결함 | 근거 | 고친 내용 |
| --- | --- | --- |
| 실행기의 모든 요청이 멈춤(음원 조회가 25 초 뒤 `runner-failed`) | 스레드 덤프에서 요청 스레드가 모두 기록 잠금을 기다리고, 잠금을 쥔 스레드가 표준 출력 쓰기에서 멈춤. 실행기는 기록을 Windows 코드 페이지로 내보낸다. 도우미가 이를 UTF-8 글자로 읽다 해석 오류로 읽기를 멈춘 것으로 추정한다(읽기 스레드의 오류 자체는 보지 못함) | 도우미가 실행기 출력을 글자로 해석하지 않고 바이트로 비운다. 실행기는 `-Dstdout.encoding=UTF-8`로 띄운다 |
| 페이지가 가진 `Spicetify.Player`가 옛 객체 | 중단점에서 `Player === Spicetify.Player`가 false. 옛 객체에는 곡 정보가 없고 곡 변경 신호도 오지 않음 | 확인 루프가 객체가 바뀐 것을 보면 재생 조작 가로채기와 신호 연결을 새 객체로 옮기고 곡을 다시 본다 |
| 앱을 켠 직후 Spotify가 되살린 곡을 묻지 않음 | 플레이어가 만들어질 때 재생 곡이 없었고, 되살아난 곡은 곡 변경 신호 없이 나타남 | 확인 루프가 곡이 달라진 것을 보면 묻는다 |
| 다른 기기에서 재생하다 이 PC로 옮긴 곡을 묻지 않음 | 곡이 같아 다시 묻지 않음 | 같은 곡이라도 재생 기기가 이 PC로 돌아오면 묻는다 |

확장 상태는 시작할 때 한 번 읽지 못해도 10 초마다 다시 읽는다.

고친 뒤 확인한 것은 다음과 같다.
- RED OUT(Kenshi Yonezu)이 약 2 초 만에 Qobuz Hi-Res 음원으로 바뀌어 재생됐다. 재생바 오른쪽 조작부에 "Qobuz Hi-Res · FLAC · 24-bit · 48 kHz"가 보였다.
- 재생 상세 정보 창이 음질을 보였다. 소스가 알린 정보는 FLAC · 24-bit · 48 kHz였고, 플레이어가 감지한 정보는 audio/flac · 1769 kbit/s였다.
- 같은 창에 소스 목록과 선택 이유가 보였다. Mornye는 연결 전이라 건너뛰었고, Qobuz는 찾았고, FLAC Bridge는 찾지 못했다. 열기는 2.2 초에 HTTP 206이었다.
- 소스 선택기에서 Spotify를 고르면 "Spotify · 임시"로 바뀌었고, Qobuz를 다시 고르면 같은 위치에서 이어졌다.
- 地球儀(Kenshi Yonezu)는 세 확장 모두 음원이 없어 Spotify가 재생했다.

이 고침은 설치 폴더의 `extension_host.py`, `extension-player.js`, `youtube-links.js`에 직접 복사해 시험했다. 정식 설치본은 다시 빌드하지 않았다. `youtube-links.js`에는 진단용으로 확장 플레이어의 읽기 전용 상태(`SpotifyHangulLinks.extensionSnapshot()`)를 더했다.

### 독립 검토에서 고친 것 (2026-11-02)

다른 모델(Claude Fable)이 코드를 따로 읽고 낸 지적 가운데 다음을 고쳤고, 각각 시험을 더했다.

| 등급 | 지적 | 고친 내용 |
| --- | --- | --- |
| 높음 | 시스템 코드 페이지 밖의 글자가 든 사용자 폴더나 설치 폴더에서 실행기가 시작하지 못함(재현함) | 데이터 폴더는 `HANGUL_EXT_DATA`, jar는 작업 폴더 기준 이름으로 넘긴다. 태국어, 한글, 움라우트가 섞인 폴더에서 실제 jar로 시작을 확인했다 |
| 중간 | 도우미의 실행기 호출에 시스템 프록시가 쓰임 | 프록시 없이 직접 연결한다 |
| 중간 | 미디어 중계가 리디렉션에서 확장 헤더를 다른 호스트로 보내고, https에서 http로 내려가는 것과 사설 주소를 막지 않음 | 위 "재생" 절의 규칙대로 리디렉션을 다룬다 |
| 낮음 | READY 직후 죽는 실행기를 바로 다시 띄우고, 실패 상한 뒤에는 영구히 멈춤 | 60 초 안의 종료를 실패로 세고, 상한 뒤에는 30 분마다 다시 시도한다 |
| 낮음 | 도우미의 확장 ID 검사가 `..`를 통과시킴(실제 탈출은 없음) | 매니페스트 ID 규칙으로 검사한다 |
| 낮음 | 제거 확인에 `window.confirm`을 씀(Spotify 브라우저에서 창 없이 거절될 수 있음) | 화면 안에서 두 번 눌러 제거한다 |
| 낮음 | 확장 플레이어 모듈 다시 불러오기가 50 초 뒤 멈춤 | 다른 모듈과 같이 3 초씩 40 번 시도한다 |
| 낮음 | 업데이트 중 프로세스 종료 확인에서 권한 오류가 나면 설치가 멈춤 | 그 경우 끝난 것으로 본다 |

### 0.8.0 시험판 설치본 시험 (2026-11-02)

v0.8.0 릴리스에 올린 `SpotifyHangul-0.8.0-Setup.exe`(SHA-256 `b608b3fb…`)를 이 PC의 기존 설치 위에 조용한 설치로 덮어 설치했다. 설치된 `extension_host.py`, `extension-player.js`, `youtube-links.js`, `webview-auth.ps1`, `bridge.py`, `installer\payload-transaction.ps1`은 저장소 커밋 1004f65와 같았고, 실행기 jar는 릴리스 첨부본과 같은 `e53500db…`였다. 이전의 직접 복사본은 이 설치로 모두 바뀌었다. 확인한 것은 다음과 같다(진단 포트로 페이지 안을 읽음, 음량 5%).

| 항목 | 결과 |
| --- | --- |
| 일반 재생 | アイネクライネ에 ISRC(JPPO01402002)를 함께 보냈고 약 5 초 안에 Qobuz Hi-Res · FLAC · 16-bit · 44.1 kHz로 바뀜 |
| 혼합 목록 | YouTube 6 곡과 Spotify 3 곡이 섞인 목록에서 Spotify 곡이 Qobuz 확장 음원으로 재생됨. 「다음」은 목록의 다음 YouTube 항목으로 넘어갔고, YouTube 음원(opus, 약 128 kbit/s)은 약 6 초 뒤 재생 시작 |
| 못 찾은 이유 | Zako(柊マグネタイト)는 확장 답이 9.5 초 만에 왔고, 그 뒤 음질 줄이 「Spotify · 암호화된 음원만 있음(PC에서 재생 안 함)」으로 바뀜. 답이 오기 전에는 「Spotify」만 보임 |
| 다시 찾기 | Tetoris의 재생 상세 정보에 버튼과 설명이 보였고, 누르면 「여전히 재생할 수 있는 소스가 없음: 암호화된 음원만 있음(PC에서 재생 안 함)」이 표시됨 |
| DASH | 소스 선택기로 Mornye를 고르자 55 개 세그먼트 FLAC으로 재생됐고, 버퍼가 세그먼트(약 4 초) 단위로 앞으로 늘어남. 150 초와 20 초로 탐색해도 이어서 재생됨. 시험 뒤 「내 순서로 돌아가기」로 되돌림 |
| 확장 관리 탭 | 실제 마우스 입력(CDP `Input.dispatchMouseEvent`)으로 스토어, 설치됨, 스토어를 차례로 눌러도 창이 열린 채였음. 첫 시도에서는 스토어를 누른 직후 설치됨 탭을 찾지 못했다(스토어를 불러오는 동안으로 추정) |

설치 직후 시험 스크립트가 부른 설치 폴더의 `stop.ps1`이 도우미 상태 확인(`/health`)에서 시간 초과를 냈다. 곧 이어 `start.ps1`이 띄운 0.8.0 도우미는 정상으로 답했다. 원인은 확인하지 않았다(설치 프로그램이 띄운 도우미가 아직 시작 중이었던 것으로 추정).

확인하지 않은 것: 사람이 직접 화면을 보고 듣는 확인, 로그인 창이 열린 상태의 업데이트, 장시간 재생.

## 미확인과 위험

- 스토어 화면은 가짜 Spotify DOM(linkedom)으로만 검사했다. 실제 Spotify에서 확인하지 않은 것: 색인이 준 아이콘 주소를 Spotify 페이지가 불러오는지(못 불러오면 아이콘을 뺀다), 홈페이지와 저장소 링크가 외부 브라우저로 열리는지, 긴 목록의 배치.
- components.json의 `extensions_pc`는 안드로이드 커밋 ca84b1f(2.3.0-hangul.3)의 GitHub 소스 압축과, 그 커밋으로 빌드해 PC 0.8.0 릴리스에 첨부한 jar를 가리킨다. 안드로이드 한글판 앱은 시험판 릴리스도 업데이트로 받으므로, APK 없는 jar만의 안드로이드 릴리스는 만들지 않는다. 이 첨부 파일을 지우면 다음 빌드가 jar를 받지 못한다.
- 24-bit 음원의 출력 경로: Windows 공유 믹서를 거치므로 비트 그대로의 출력은 아니다. 실제 FLAC 재생은 위 시험에서 확인했지만, 소리를 직접 듣지는 않았다(집에 사람이 없는 상태에서 음량 5%).
- 시험하는 동안 Spotify 음량을 5%로 낮췄고 되돌리지 않았다.
- 확장 로그인 창(2026-11-02 이 PC, Windows 11, WebView2 Runtime 156.0.4314.58): 루프백 시험 페이지로 https 리디렉션, 사용자 지정 스킴, 폼 POST, 하위 프레임, `window.open`, 연결 실패, 콜백과 앞부분만 같은 주소의 무시, hidden에서 보이는 창으로의 전환(페이지 요청 1 회, 페이지 타이머 유지), 180 초 대신 짧게 준 시간 제한, 창 닫기, 표준 입력 닫힘을 확인했다. 실행기 jar와 실제 창을 이은 경로는 시작 주소가 곧 콜백인 hidden 페이지로 확인했다(약 2 초). 런타임이 없는 경로는 런타임 위치 환경 변수를 빈 폴더로 돌리고 부트스트래퍼 자리에 다른 실행 파일을 두어 `webview2-missing`까지만 확인했고, 실제 부트스트래퍼 설치는 하지 않았다. 런타임이 없는 Windows 10, ARM64 Windows(arm64 로더 선택), 고해상도 배율에서의 창 크기와 선명도, Mornye와 FLAC Bridge의 실제 연결은 확인하지 않았다.
- 실행기를 띄운 Java가 콘솔 없이 실행될 때 로그인 창의 PowerShell에도 콘솔 창이 생기지 않는 것은 `GetConsoleWindow()`가 0을 돌려주는 것으로 확인했다. 백그라운드 프로세스가 띄운 창이 실제로 Spotify 위에 보이는지는 사용자가 다른 전체 화면 앱을 쓰는 중이라 화면으로 확인하지 않았다(창 위치와 제목은 UI Automation으로 확인).
- 업데이트가 실행기를 멈출 때 열려 있던 로그인 창은 업데이트의 프로세스 정리 목록(`payload-transaction.ps1`)에 들어 있다. 이 설치본의 `webview-auth.ps1`을 실행하는 시스템 PowerShell을 멈추고 끝날 때까지 기다린 뒤 `extensions\webview2`의 DLL을 바꾼다(2026-11-02 Fable 검토 반영, 가짜 프로세스 목록으로만 검사). WebView2 브라우저 프로세스(msedgewebview2)는 SDK DLL을 쓰지 않으므로 목록에 넣지 않았다.
- 로그인 창이 열린 채 확장을 제거하면 WebView2가 쿠키 폴더(`<id>\webview`)를 몇 초 더 잡고 있어 그 폴더가 남을 수 있다(추정, 재현하지 않음). 같은 확장을 다시 설치하면 이전 로그인이 남아 있을 수 있다.
- 확장 관리와 재생 상세 상자 안의 클릭은 Spotify 모달이 닫히지 않도록 문서 수준으로 전파하지 않는다. 그래서 상자 안을 눌러도 열려 있던 Spotify 메뉴가 닫히지 않을 수 있다(추정).
- DASH: 붙인 구간 끝이 세그먼트 중간을 넘었으면 그 세그먼트는 들어간 것으로 보고 다음 세그먼트를 받는다. MPD의 길이보다 짧게 들어간 세그먼트를 같은 자리에 끝없이 다시 붙이던 경우를 막는다(2026-11-02 Fable 검토 반영, 모델 테스트로만 확인).
- WebView2 부트스트래퍼는 사용권 2(b)항(재배포자에게 최종 사용자 동의 조건과 Microsoft 면책을 요구)을 피하려고 동봉하지 않고 필요할 때 Microsoft에서 받는다(2026-11-02 결정). 그래서 런타임이 없는 오프라인 PC에서는 로그인 창을 쓸 수 없다.
- 설치본 증가량: 시험 빌드(2026-11-02)의 Setup.exe가 212,139,684 바이트로, 배포 중인 0.7.11(166,859,339 바이트)보다 45.3 MB 컸다. 런타임 48 MB, jar 8 MB, 실행기 소스 압축 4.7 MB를 압축한 결과다.
- 로그인 창이 더하는 크기: 새 파일 8 개(`webview-auth.ps1`, `extensions\webview2`의 5 개, 고지 2 개)는 압축 전 3,024,256 바이트다. 설치본과 같은 NSIS 3.13 zlib로 이 파일만 담은 시험 패키지를 만들어 빈 패키지와 비교하면 2,133,754 바이트(약 2.1 MB) 늘었다(2026-11-02). 전체 Setup.exe와 Update.exe는 다시 빌드하지 않았다.
- Spotify와 Spicetify 업데이트로 재생기 API가 바뀔 수 있다.
- Myspoti 확장 API가 원본에서 바뀌면 실행기 jar를 다시 빌드해야 한다.
- 곡 전환 직후 Spotify 음원이 잠깐 들릴 수 있다.
- 페이지 쪽 전환은 가짜 Spotify와 가짜 `<audio>`로만 검사했다. 실제 Spotify에서 확인하지 않은 것: 다음 곡으로 넘길 때 일시정지된 엔진이 재생을 시작하는지, 맞춘 전환의 실제 끊김, Spotify의 루프백 미디어 요청 허용, 재생바와 음질 줄의 DOM 위치, 미디어 키와 Connect 명령의 처리.
- DASH 재생은 가짜 MediaSource와 가짜 SourceBuffer로만 검사했다(붙이는 순서, 탐색, 버퍼 가득 참, 끝, 거절 뒤 다시 묻기, 맞춘 전환). 실제 Spotify에서 확인하지 않은 것: 실제 세그먼트를 붙였을 때 소리가 나는지, sequence 모드와 `timestampOffset`으로 이은 세그먼트 경계의 끊김, 탐색 뒤 재생 재개, `endOfStream()` 뒤의 `ended`, 곡이 바뀔 때 MediaSource 정리, 페이지에서 도우미로 가는 세그먼트 요청의 CORS. 실제 MPD의 세그먼트 수와 길이, 도우미의 해석과 중계까지는 확인했다(위 "실측 사실").
- Chromium의 오디오 SourceBuffer 한도는 약 12 MB로 알려져 있으나 Spotify의 Chromium에서 재지 않았다. 측정한 16-bit 44.1 kHz(약 1 Mbit/s)의 30 초는 약 3.8 MB라 닿지 않는다. 24-bit 96 kHz(약 4~5 Mbit/s로 추정)면 30 초가 한도를 넘을 수 있고, 그때는 `QuotaExceededError` 처리로 앞서 받는 양이 줄어든다.
- 도우미의 MPD 해석은 실측한 형태와 그 표준 변형을 단위 검사로만 확인했다. `$Time$`, BaseURL 결합, 고정 `duration`, `r="-1"`을 쓰는 실제 소스는 보지 못했다.
- 확장 음원을 재생하는 동안 Spotify 엔진은 일시정지 상태이므로 Spotify의 재생 기록, 다른 기기의 재생 표시, Windows 미디어 표시에는 일시정지로 보일 수 있다. Spotify의 음량 평준화는 확장 음원에 적용되지 않는다.
