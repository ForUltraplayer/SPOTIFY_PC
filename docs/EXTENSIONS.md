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

### 재생

- 곡이 바뀌면 Spotify 안의 스크립트가 도우미에 그 곡의 음원을 묻는다. 도우미는 실행기에 묻고, 실행기는 켜진 오디오 소스를 순서대로 묻는다(곡당 15 초 안).
- 음원이 있으면 Spotify를 일시정지하고, 도우미의 미디어 중계 주소를 `<audio>`로 재생한다. 중계는 확장이 준 헤더를 붙이고, Range 요청과 탐색을 넘기고, 주소가 401, 403, 404, 410으로 거절되면 실행기에 한 번 다시 묻는다. 리디렉션은 안드로이드의 ExtensionMediaHttp처럼 다룬다. 최대 5 번까지 따라가고, https에서 http로 내려가는 것과 이 컴퓨터나 사설망 주소(루프백, 사설, 링크 로컬, 예약 주소)로 가는 것은 따라가지 않는다. 호스트나 포트가 바뀌면 확장의 헤더를 빼고 보낸다. 확장 헤더의 Accept-Encoding은 넘기지 않는다(중계가 Content-Encoding을 넘기지 않으므로). 첫 주소는 엔진이 확장의 허용 호스트로 검사한 것이다. 이름 해석과 실제 연결 사이에 주소가 바뀌는 경우(DNS rebinding)는 막지 않는다.
- 재생바, 탐색, 이전과 다음, 음량, 가사 싱크는 지금의 YouTube 직접 재생 경로(`youtube-links.js`의 `new Audio()`와 Spotify 정지 유지, ivLyrics의 외부 재생 시간)를 확장해 연결한다. 가사는 원래 Spotify 곡 ID를 그대로 쓰므로 시간 출처만 바꾼다.
- 1 단계에서는 일반 FLAC, Opus, MP3 주소를 재생한다. DASH-FLAC(MediaSource)은 2 단계로 미룬다. AAC와 DRM 음원은 재생하지 않는다.

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
| `POST /v1/audio` `{track, ahead, accept}` | 순서대로 오디오 소스를 묻는다. `accept`는 PC가 재생할 수 있는 형식(`flac`, `opus`, `mp3`, `vorbis`)과 DASH 가능 여부다. 받을 수 없는 답(AAC, DASH 미지원 단계의 manifest, 변환이 필요한 transform)은 다음 소스로 넘기고 기록에 남긴다. 결과: `{found, attempt, extension, name, stream:{url, headers, mimeType, codec, bitDepth, sampleRate, quality, expiresAt}}` 또는 `{found:false, attempt, reason}` |
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

구현(안드로이드 저장소 `base/extensions-pc`, 2026-11-02)은 안드로이드 동작을 그대로 따르며 위 표와 다른 점은 다음과 같다. `/v1/audio/again`은 안드로이드의 `ExtensionAudio`처럼 보관한 답을 버리고 순서 전체에 다시 묻는다. 모든 소스에 동시에 묻고 순서상 첫 답을 고르며, 나머지는 취소한다. 실행기는 시작할 때와 6 시간마다 Myspoti 공식 저장소의 차단 목록(`blocked.json`)을 받고, 저장소에서 설치한 확장의 업데이트를 확인한다. 권한이 늘지 않는 업데이트는 안드로이드처럼 24 시간 뒤 적용한다. 실행기는 자신을 띄운 도우미가 끝나면 함께 끝난다(`ProcessHandle.parent().onExit()`). 화면이 필요한 기능(확인 창, 로그인 페이지, 웹 페이지)과 `myspoti.spotify`, 재생 제어, 기기 증명, 가사와 다운로드 훅은 아직 PC에서 지원하지 않는다. ISRC는 Spotify 카탈로그를 조회하지 않고 같은 곡의 이전 요청 값만 쓴다.

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

## 미확인과 위험

- 스토어 화면은 가짜 Spotify DOM(linkedom)으로만 검사했다. 실제 Spotify에서 확인하지 않은 것: 색인이 준 아이콘 주소를 Spotify 페이지가 불러오는지(못 불러오면 아이콘을 뺀다), 홈페이지와 저장소 링크가 외부 브라우저로 열리는지, 긴 목록의 배치.
- components.json의 `extensions_pc`는 안드로이드 커밋 23d7800의 GitHub 소스 압축과, 그 커밋으로 빌드해 PC 0.7.12 릴리스에 첨부한 jar를 가리킨다. 안드로이드 한글판 앱은 시험판 릴리스도 업데이트로 받으므로, APK 없는 jar만의 안드로이드 릴리스는 만들지 않는다. 이 첨부 파일을 지우면 다음 빌드가 jar를 받지 못한다.
- 24-bit 음원의 출력 경로: Windows 공유 믹서를 거치므로 비트 그대로의 출력은 아니다. 실제 FLAC 재생은 위 시험에서 확인했지만, 소리를 직접 듣지는 않았다(집에 사람이 없는 상태에서 음량 5%).
- 시험하는 동안 Spotify 음량을 5%로 낮췄고 되돌리지 않았다.
- 설치본 증가량: 시험 빌드(2026-11-02)의 Setup.exe가 212,139,684 바이트로, 배포 중인 0.7.11(166,859,339 바이트)보다 45.3 MB 컸다. 런타임 48 MB, jar 8 MB, 실행기 소스 압축 4.7 MB를 압축한 결과다.
- Spotify와 Spicetify 업데이트로 재생기 API가 바뀔 수 있다.
- Myspoti 확장 API가 원본에서 바뀌면 실행기 jar를 다시 빌드해야 한다.
- 곡 전환 직후 Spotify 음원이 잠깐 들릴 수 있다.
- 페이지 쪽 전환은 가짜 Spotify와 가짜 `<audio>`로만 검사했다. 실제 Spotify에서 확인하지 않은 것: 다음 곡으로 넘길 때 일시정지된 엔진이 재생을 시작하는지, 맞춘 전환의 실제 끊김, Spotify의 루프백 미디어 요청 허용, 재생바와 음질 줄의 DOM 위치, 미디어 키와 Connect 명령의 처리.
- 확장 음원을 재생하는 동안 Spotify 엔진은 일시정지 상태이므로 Spotify의 재생 기록, 다른 기기의 재생 표시, Windows 미디어 표시에는 일시정지로 보일 수 있다. Spotify의 음량 평준화는 확장 음원에 적용되지 않는다.
