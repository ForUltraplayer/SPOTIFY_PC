# Spotify 한글 발음 가사

| 표기 | 의미 |
| --- | --- |
| API | 프로그램 사이의 요청 인터페이스 |
| 발음 제공자 코드 | `web-hangul` |
| 로컬 도우미 코드 | `ivLyricsHangul` |

Windows Spotify의 ivLyrics에 웹에 작성된 일본어 노래의 한글 발음을 표시한다. 버전 0.6.0은 Spotify와 SpotX까지 한 번에 구성하는 Windows x64용 EXE 베타다. 설치 폴더를 선택할 수 있으며 Python과 Spotify를 미리 설치할 필요가 없다. 설치 중 공식 Spotify x64 파일 약 150 MB를 내려받아 SHA-256과 Spotify AB 서명을 검사한다. 자체 소스에는 GPL-3.0-or-later를 적용한다. 깨끗한 다른 PC의 설치와 전체 곡의 발음 청취 검수는 남아 있다.

## 기능

- 한음과 나무위키의 일본어 가사와 기존 한글 발음을 대조한다. 곡별 자료 주소로 티스토리를 지정할 수 있다.
- 원문 가사 조회가 실패하면 제목의 feat. 표기를 제거하거나 공동 가수명의 대표 가수로 다시 찾는다. 곡명과 가수 및 확인 가능한 앨범·길이를 검증하고 Live 등 버전 표기는 유지한다.
- 커버곡의 제목에서 원곡 후보를 찾고 현재 가사와 대조한다. 현재 녹음의 가사 재생 시간은 유지한다.
- 가사 서버의 429와 5xx 응답은 일시 오류로 구분하고 해당 서버에 대기 시간을 적용한다. 상태는 한글 발음 자료 설정에서 확인하며 팝업 알림은 띄우지 않는다.
- 원문의 일본어 줄 중 85% 이상과 최소 5 줄이 연결된 자료를 사용한다. 일본어가 3~4 줄인 곡은 모든 줄이 연결되어야 한다.
- 선택 기능으로 누락 줄에 사전 기반 자동 발음을 사용한다. 기본값은 꺼짐이며 사용 알림은 띄우지 않는다. 자료 설정 화면에서 자동으로 만든 줄 수를 확인한다.
- 하단 재생바의 현재 곡 제목은 우클릭 한 번으로 전체 제목을 복사한다. 기존 곡 메뉴의 곡 제목 복사와 프로필 메뉴의 현재 곡 제목 복사도 제공한다. 성공 알림은 띄우지 않는다.

모든 곡에 발음 자료가 있는 것은 아니다. 사이트 응답, 문서 구조와 가사 표기 차이로 실패할 수 있다. 자동 발음은 실제 노래의 한자 읽기와 다를 수 있다. 문장 단위 자료가 여러 재생 줄에 반복될 수 있다.

## 사용

[배포 페이지](https://github.com/ForUltraplayer/SPOTIFY_PC/releases)에서 `SpotifyHangul-0.6.0-Setup.exe`를 받는다. 인터넷에 연결한 상태에서 설치 프로그램을 실행하고 전용 폴더를 선택한다. Spotify를 따로 설치하거나 먼저 실행할 필요가 없다. 선택한 폴더 안에 Spotify를 구성하고 SpotX, Spicetify와 ivLyrics를 적용한다. 기존 Spotify 파일과 공유 Spicetify 설정은 보존한다. 통합본에는 별도 Spicetify 설정을 사용하며 기존 확장과 테마가 있으면 처음 설치할 때 복사한다.

통합본의 Spotify는 패치 유지를 위해 자동 업데이트를 차단한다. 이후 버전 교체는 통합 설치본 업데이트로 진행한다. 백신 예외와 부팅 자동 시작은 추가하지 않는다. 설치 후 한글 가사 바로가기를 실행하면 기존에 실행 중인 일반 Spotify를 종료하고 통합본을 연다. [통합 구조와 검증 범위](docs/SPOTX_INTEGRATION.md)를 참고한다.

바탕화면의 **Spotify 한글 가사** 바로가기를 실행하고 Spotify의 **ivLyrics** 화면을 연다. 이미 Spotify가 실행 중이어도 같은 바로가기를 사용할 수 있다. 프로필 메뉴의 **한글 발음 자료**에서 현재 곡의 자료 주소와 자동 발음을 설정한다. 자동 발음은 기본값이 꺼짐이며 원하는 경우 직접 켠다.

시작 스크립트는 환경 변수 `IVLYRICS_HANGUL_PYTHON`, `runtime/pythonw.exe`, `python-path.txt`, PATH의 실제 Python 순서로 찾는다. WindowsApps 앱 별칭은 제외한다. 실행에 실패하면 `start-error.txt`에 오류를 남기고 오류 창을 표시한다. `python-path.txt`는 설치 PC에서 만들며 배포물에는 넣지 않는다.

설치 전제와 미완료 항목은 [배포 안내](docs/RELEASE.md), 실행 위치와 중지는 [운영 안내](docs/OPERATIONS.md)에 기록한다. 이 베타 설치 파일에는 코드 서명이 없다. 이전 [0.5.0 베타](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.5.0)도 유지한다.

## 캐시와 데이터 보존

조회에 성공한 발음은 `%LOCALAPPDATA%\ivLyricsHangul\cache.json`, 원문과 일치한다고 확인한 자료 주소는 같은 폴더의 `aliases.json`에 저장한다. 각각 최대 500 곡과 30 일을 기준으로 관리한다. 조회 실패는 같은 도우미 프로세스 안에서 10 분 동안 기억한다. ivLyrics는 이와 별도로 Spotify 내부 IndexedDB의 `ivLyricsCache`에 원문과 발음 등의 결과를 저장한다. 확인한 기본 보관 기간은 365 일이다.

설치 폴더와 개인 캐시는 분리한다. 업데이트와 프로그램 제거 시 위 개인 캐시를 지우지 않는다. 저장된 원문이 달라지거나 캐시가 만료되면 다시 대조할 수 있다. 한 번 저장했다고 모든 다른 가사 버전까지 영구히 재사용하는 구조는 아니다. 개인 캐시와 계정 정보는 배포물에 넣지 않는다.

## 개발과 검증

검증한 조합은 Windows 11 x64, Python 3.13.9, Spotify 1.3.6.1921, Spicetify 2.46.3, ivLyrics 7.0.16이다. Node.js는 확장 검사에 사용한다. 의존성은 프로젝트 전용 폴더에 설치한다.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
```

소스 배포 초안은 다음 명령으로 생성한다. 개인 캐시, 설치 PC의 Python 경로, 진단 기록과 런타임은 포함하지 않는다.

```powershell
python scripts/build_spotx_adapter.py
python scripts/prepare_release.py
```

생성 위치는 `dist/`이며 파일별 SHA-256 목록과 압축 파일의 해시를 함께 만든다. 설치 프로그램을 빌드하려면 고정된 외부 배포 파일을 준비한 다음 다음 명령을 사용한다. 다운로드 입력은 공식 배포 주소와 SHA-256으로 기록한다.

```powershell
python scripts/fetch_distribution_inputs.py
python scripts/build_installer.py
```

설치본은 CPython 3.13.17, Spicetify 2.46.3, ivLyrics 7.0.16과 원본 라이선스 및 대응 소스를 포함한다. 전체 검증 범위는 [검증 기록](docs/VERIFICATION.md)에 기록한다.

## 안드로이드

개발과 APK 배포는 [안드로이드 전용 저장소](https://github.com/ForUltraplayer/SPOTIFY_ANDROID)에서 관리한다. [베타 APK](https://github.com/ForUltraplayer/SPOTIFY_ANDROID/releases/tag/v2.0.1-hangul.4)는 Myspoti 기반으로 재생과 한글 가사를 같은 앱에서 제공하며 PC 서버에 연결하지 않는다. Google 로그인 실패 사례와 이메일 로그인 대안은 안드로이드 README와 릴리스에 명시했다. Apple과 Facebook 로그인은 실제 검증하지 않았다. 호스트 검사와 APK 빌드 및 서명은 확인했고 새 APK의 휴대폰 설치와 실제 재생 검증은 대기한다. 이 저장소의 `android/` 패치는 분리 전 이력이며 새 개발의 기준은 전용 저장소다.

## 소스 구성

| 경로 | 역할 |
| --- | --- |
| `bridge.py` | 웹 자료 조회와 일본어 원문 대조, 로컬 HTTP 요청 처리 |
| `phonetics.py` | 선택 기능인 기기 내부 발음 변환 |
| `hangul-lyrics.js` | ivLyrics 제공자 연결, 캐시 처리와 제목 복사 |
| `start.ps1`, `stop.ps1` | 도우미와 Spotify 시작 및 도우미 중지 |
| `scripts/prepare_release.py` | 허용한 소스 파일만 배포 초안으로 묶는 도구 |
| `work/` | 원본 이력, 개인 진단과 검증 기록, Git 제외 |

프로젝트 이동 전의 전체 기록은 로컬 `work/migration/README-legacy.md`와 `verification-legacy.json`에 보존한다. Git에 들어가는 문서와 배포 초안에는 개인 진단 자료를 포함하지 않는다. 외부 의존성과 라이선스 상태는 [외부 구성 요소](THIRD_PARTY_NOTICES.md)와 [라이선스 검토](docs/LICENSE_REVIEW.md)에 기록한다.
