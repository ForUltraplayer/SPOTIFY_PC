# Spotify 한글 발음 가사

| 표기 | 의미 |
| --- | --- |
| API | 프로그램 사이의 요청 인터페이스 |
| 발음 제공자 코드 | `web-hangul` |
| 로컬 도우미 코드 | `ivLyricsHangul` |

Windows Spotify의 ivLyrics에 웹에 작성된 일본어 노래의 한글 발음을 표시한다. 프로젝트 버전은 0.4.3이며 로컬 도우미 버전은 0.4.0이다. 현재 배포물은 소스 검토용 초안이다. 다른 PC의 자동 설치와 깨끗한 Windows 환경의 검증은 남아 있다. 자체 소스는 GPL-3.0-or-later로 공개하며 Myspoti 기반 안드로이드 패치는 해당 원본의 GPL-3.0 고지를 유지한다.

## 기능

- 한음과 나무위키의 일본어 가사와 기존 한글 발음을 대조한다. 곡별 자료 주소로 티스토리를 지정할 수 있다.
- 커버곡의 제목에서 원곡 후보를 찾고 현재 가사와 대조한다. 현재 녹음의 가사 재생 시간은 유지한다.
- 원문의 일본어 줄 중 85% 이상과 최소 5 줄이 연결된 자료를 사용한다. 일본어가 3~4 줄인 곡은 모든 줄이 연결되어야 한다.
- 선택 기능으로 누락 줄에 사전 기반 자동 발음을 사용한다. 기본값은 꺼짐이며 사용 알림은 띄우지 않는다. 자료 설정 화면에서 자동으로 만든 줄 수를 확인한다.
- 하단 재생바의 현재 곡 제목은 우클릭 한 번으로 전체 제목을 복사한다. 기존 곡 메뉴의 곡 제목 복사와 프로필 메뉴의 현재 곡 제목 복사도 제공한다. 성공 알림은 띄우지 않는다.

모든 곡에 발음 자료가 있는 것은 아니다. 사이트 응답, 문서 구조와 가사 표기 차이로 실패할 수 있다. 자동 발음은 실제 노래의 한자 읽기와 다를 수 있다. 문장 단위 자료가 여러 재생 줄에 반복될 수 있다.

## 사용

현재 설치된 PC에서는 바탕화면의 **Spotify 한글 가사** 바로가기를 실행하고 Spotify의 **ivLyrics** 화면을 연다. 이미 Spotify가 실행 중이어도 같은 바로가기를 사용할 수 있다. 프로필 메뉴의 **한글 발음 자료**에서 현재 곡의 자료 주소와 자동 발음을 설정한다.

시작 스크립트는 환경 변수 `IVLYRICS_HANGUL_PYTHON`, `runtime/pythonw.exe`, `python-path.txt`, PATH의 실제 Python 순서로 찾는다. WindowsApps 앱 별칭은 제외한다. 실행에 실패하면 `start-error.txt`에 오류를 남기고 오류 창을 표시한다. `python-path.txt`는 설치 PC에서 만들며 배포물에는 넣지 않는다.

다른 PC에 설치하기 위한 현재 수동 절차와 미완료 항목은 [배포 준비](docs/RELEASE.md), 실행 위치와 중지는 [운영 안내](docs/OPERATIONS.md)에 기록한다.

## 개발과 검증

검증한 조합은 Windows 11 x64, Python 3.13.9, Spotify 1.3.6.1921, Spicetify 2.46.3, ivLyrics 7.0.16이다. Node.js는 확장 검사에 사용한다. 의존성은 프로젝트 전용 폴더에 설치한다.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
```

소스 배포 초안은 다음 명령으로 생성한다. 개인 캐시, 설치 PC의 Python 경로, 진단 기록과 런타임은 포함하지 않는다.

```powershell
python scripts/prepare_release.py
```

생성 위치는 `dist/`이며 파일별 SHA-256 목록과 압축 파일의 해시를 함께 만든다. 실행 환경과 의존성을 포함한 설치 프로그램은 아직 제공하지 않는다. 다른 PC 검증 전에는 정식 설치 배포로 표시하지 않는다. 소스 공개와 설치 프로그램의 배포 준비 완료는 별개의 상태다.

## 안드로이드

기존 Myspoti 한글에 적용할 [개발 계획](android/PLAN.md), 기준 커밋과 수정 패치를 `android/`에 관리한다. 재생과 한글 가사를 같은 앱에서 제공하며 PC 서버에 연결하지 않는다. APK 빌드와 호스트 검사는 휴대폰 없이 진행한다. 설치·로그인·실제 재생 검증에는 휴대폰이 필요하다.

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
