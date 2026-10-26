# Spotify 한글 발음 가사 (Windows)

**한국어** | [English](README.en.md)

Windows용 Spotify 데스크톱 앱의 가사 화면에 **일본어 노래의 한글 발음**을 함께 표시합니다. 사람이 웹에 정리해 둔 한글 발음 자료를 찾아 Spotify의 일본어 가사와 줄 단위로 맞춘 뒤 보여 줍니다.

> [!NOTE]
> 현재 버전은 **0.6.1 베타**입니다. 0.6.0의 새 설치와 제거 및 한글 가사 표시를 확인했으며 사용자의 다른 PC에서도 설치 성공을 확인받았습니다. 0.6.1에는 발음 자동 재시도와 GitHub 자동 업데이트를 추가했습니다. 전체 곡의 발음 청취 검수는 남아 있습니다.

**[⬇ 설치 파일 받기 (SpotifyHangul-0.6.1-Setup.exe)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.6.1)**

기존 설치자는 같은 배포 페이지의 **SpotifyHangul-0.6.1-Update.exe**를 사용할 수 있습니다. Spotify를 완전히 종료하고 실행하면 설치 위치를 자동으로 찾아 최신 통합 설치본을 내려받고 적용합니다.

## 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 하는 일 | Spotify 가사 화면에 일본어 원문과 한글 발음을 함께 표시 |
| 발음 출처 | 한음, 나무위키에 사람이 작성한 기존 한글 발음 |
| 대상 | Windows x64, Windows 11에서 검증 |
| 기반 | [SpotX](https://github.com/SpotX-Official/SpotX) + [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics) |
| 설치 방식 | EXE 하나, Spotify와 SpotX 자동 구성, Python과 Spicetify 및 ivLyrics 포함 |
| 비용 | 유료 API 키 없이 사용, Spotify 로그인 필요 |
| 안드로이드 | 별도 앱 [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID) |

## 동작 구조

공식 Spotify x64 파일을 내려받아 선택한 설치 폴더에 구성하고 SpotX를 먼저 적용합니다. 이어 Spicetify와 가사 앱 ivLyrics를 적용해 한글 발음을 공급합니다. 기존 Spotify 파일은 보존하며 통합본에는 별도 Spicetify 설정과 백업을 사용합니다.

```text
통합 Spotify 데스크톱 앱 (SpotX 적용)
 └─ Spicetify (Spotify에 확장을 붙이는 도구)
     ├─ ivLyrics (가사 화면 앱, 원문과 발음 표시)
     └─ 한글 발음 확장 (이 프로젝트)
          └─ 로컬 도우미 (같은 PC에서만 동작)
               └─ 한음, 나무위키에서 발음 자료 조회 후 원문과 대조
```

로컬 도우미는 Spotify 안에서 직접 읽을 수 없는 웹 문서를 대신 읽어 오는 작은 프로그램입니다. 바탕화면 바로가기로 Spotify를 열 때 함께 시작하고, Spotify를 닫으면 약 30 초 뒤 스스로 종료합니다. 서비스 등록이나 부팅 자동 시작은 하지 않습니다.

## 주요 기능

**발음 표시**

- 한음, 나무위키의 일본어 가사와 한글 발음을 Spotify 가사와 줄 단위로 대조
- 원문 일본어 줄의 85% 이상, 최소 5 줄이 맞는 자료만 사용 (일본어가 3~4 줄인 곡은 모든 줄 일치 필요)
- 원문 대조를 통과한 자료 주소를 기억해 다음 재생 때 빠르게 표시
- 곡마다 사용할 자료 주소를 직접 지정 가능 (프로필 메뉴의 **한글 발음 자료**)

**가사를 못 찾을 때의 보완**

- 제목의 feat. 표기를 빼거나 공동 가수 중 대표 가수로 재검색
- 곡명, 가수, 앨범, 길이를 확인해 다른 녹음의 가사 배제 (Live 등 버전 표기는 유지)
- 커버곡은 제목에서 원곡을 찾아 원곡 가사와 대조하고, 재생 시간은 현재 녹음 기준 유지
- 가사 서버가 혼잡(429, 5xx)하면 일시 오류로 보고 해당 서버만 잠시 대기
- 현재 곡의 발음 조회가 실패하면 2 초 간격으로 최대 3 회 추가 재시도, 전체 조회 시간은 최대 60 초로 제한하고 곡 변경 시 중단

**선택 기능**

- 자동 발음: 발음 자료에 없는 줄을 사전 기반으로 변환 (기본값 꺼짐, 자료 설정 화면에서 자동 생성 줄 수 확인)
- 제목 복사: 하단 재생바의 곡 제목 우클릭, 곡 메뉴, 프로필 메뉴에서 전체 제목 복사

## 설치

### 1단계: 통합 설치

**Spotify와 SpotX 및 Python을 미리 설치하거나 먼저 실행할 필요가 없습니다.** 인터넷 연결만 준비합니다.

1. [0.6.1 배포 페이지](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.6.1)에서 `SpotifyHangul-0.6.1-Setup.exe`를 받아 실행합니다.
2. 기본값(`%LOCALAPPDATA%\Programs\SpotifyHangul`) 또는 비어 있는 전용 설치 폴더를 선택합니다. 기존 한글 가사 설치본을 업데이트하려면 같은 폴더를 선택합니다.
3. 설치 프로그램이 공식 Spotify x64 파일 약 150 MB를 내려받고 크기와 SHA-256 및 Spotify AB 서명을 검사한 뒤 SpotX와 가사 기능을 연결합니다.

관리자 권한은 필요하지 않으며 설치 폴더에 쓰기 권한이 있어야 합니다. 베타 EXE에는 코드 서명이 없습니다. 기존 확장과 테마 및 ivLyrics가 있으면 처음 설치할 때 통합본의 별도 설정 폴더에 복사합니다. 이후 기존 설정의 변경을 자동 동기화하지는 않습니다.

통합 Spotify의 자동 업데이트는 패치 유지를 위해 차단하며 새 통합 설치본으로 버전을 교체합니다. 백신 예외와 부팅 자동 시작은 추가하지 않습니다. Store판은 자동 제거하지 않으며 공존 검증은 남아 있습니다. [통합 구조와 검증 범위](docs/SPOTX_INTEGRATION.md)를 참고하세요.

### 2단계: 사용

1. 바탕화면의 **Spotify 한글 가사** 바로가기로 통합 Spotify를 엽니다. 기존 Spotify가 실행 중이면 확인한 이전 클라이언트를 종료하고 통합본을 엽니다.
2. Spotify에서 **ivLyrics** 화면을 엽니다.
3. ivLyrics 설정에서 원문 표시와 한글 발음 표시를 선택합니다.
4. 필요하면 프로필 메뉴의 **한글 발음 자료**에서 곡별 자료 주소와 자동 발음을 설정합니다.

> [!IMPORTANT]
> 일반 Spotify 바로가기로 열면 로컬 도우미가 시작되지 않아 발음이 표시되지 않습니다. 항상 **Spotify 한글 가사** 바로가기를 사용하세요.

### 업데이트와 제거

- **기존 설치자의 첫 업데이트**: Spotify를 종료하고 Update.exe를 실행합니다. 이 작은 실행 파일이 최신 Setup.exe 약 65 MB를 내려받아 기존 설치 폴더에 적용합니다. 기존 통합 Spotify는 재다운로드하지 않습니다. Setup.exe를 같은 폴더에 직접 설치해도 됩니다.
- **0.6.1 이후 자동 업데이트**: 한글 가사 바로가기로 실행할 때 GitHub의 새 버전을 확인합니다. 확인 간격은 최소 8 시간이며, 새 설치본을 백그라운드에서 내려받아 크기와 SHA-256 및 파일 버전을 검사합니다. Spotify가 완전히 종료된 뒤 다음 실행 전에 적용합니다. 인터넷 오류는 음악 실행을 막지 않으며, 설치가 실패한 같은 버전을 무한 반복 적용하지 않습니다.
- **Spotify 버전 교체**: 통합 Spotify는 자동 업데이트를 차단합니다. 새 통합 설치본으로 교체합니다. 공식 다운로드 파일이 바뀌어 해시 검사가 실패해도 새 설치본이 필요합니다.
- **제거**: Windows **설정 > 앱 > 설치된 앱**에서 **Spotify 한글 가사**를 제거합니다. 설치 폴더의 통합 Spotify와 Spicetify 및 ivLyrics를 함께 제거합니다. 기존 Spotify와 사용자 프로필 및 개인 발음 캐시는 남깁니다.

## 한계와 주의 사항

- 모든 곡에 한글 발음 자료가 있지는 않습니다. 사이트 응답, 문서 구조, 가사 표기 차이로 실패할 수 있습니다.
- 자동 발음은 실제 노래의 한자 읽기와 다를 수 있습니다.
- 문장 단위로 작성된 자료는 같은 발음이 여러 재생 줄에 반복될 수 있습니다.
- Spotify와 Spicetify 업데이트에 따라 호환성이 달라질 수 있습니다.
- Windows ARM64는 검증하지 않았습니다.

## 검증 환경

| 구성 요소 | 확인한 버전 |
| --- | --- |
| Windows | 11 x64 |
| Spotify | 1.3.6.1921, 공식 파일에 SpotX 적용 |
| SpotX | 3cfbdfd1fac3dc755155e434116e28b51acfec07 |
| Spicetify | 2.46.3 |
| ivLyrics | 7.0.16 |
| 내장 Python | CPython 3.13.17 |

상세 결과와 미완료 항목은 [검증 기록](docs/VERIFICATION.md)에 있습니다.

## 저장 데이터

| 데이터 | 위치 | 보관 기준 |
| --- | --- | --- |
| 조회한 한글 발음 | `%LOCALAPPDATA%\ivLyricsHangul\cache.json` | 최대 500 곡, 30 일 |
| 원문과 일치한 자료 주소 | `%LOCALAPPDATA%\ivLyricsHangul\aliases.json` | 최대 500 곡, 30 일 |
| 조회 실패 기록 | 로컬 도우미 메모리 | 10 분 |
| ivLyrics 자체 캐시 | Spotify 내부 IndexedDB의 `ivLyricsCache` | 기본 365 일 |

개인 캐시는 설치 폴더와 분리되어 업데이트나 제거 때 지워지지 않습니다. 계정 정보와 개인 캐시는 배포물에 포함하지 않습니다. 실행 위치와 수동 중지 방법은 [운영 안내](docs/OPERATIONS.md)에 정리되어 있습니다.

## 개발자용

<details>
<summary>테스트, 소스 배포, 설치 프로그램 빌드</summary>

개발 PC에는 Python과 Node.js가 필요합니다. 의존성은 프로젝트 전용 `vendor` 폴더에 설치합니다.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_installer.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_bootstrap.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_auto_update.ps1
```

소스 배포 초안과 설치 프로그램은 다음 명령으로 `dist/`에 생성합니다. 외부 배포 파일은 공식 배포 주소와 SHA-256으로 고정합니다.

```powershell
python scripts/build_spotx_adapter.py
python scripts/fetch_distribution_inputs.py
python scripts/check_compatibility.py
python scripts/prepare_release.py
python scripts/build_installer.py
```

로컬 도우미의 Python은 환경 변수 `IVLYRICS_HANGUL_PYTHON`, `runtime/pythonw.exe`, `python-path.txt`, PATH의 실제 Python 순서로 찾습니다. 시작에 실패하면 설치 폴더의 `start-error.txt`에 오류를 남깁니다.

| 경로 | 역할 |
| --- | --- |
| `bridge.py` | 로컬 도우미: 웹 자료 조회, 일본어 원문 대조, 로컬 HTTP 응답 |
| `phonetics.py` | 사전 기반 자동 발음 변환 |
| `hangul-lyrics.js` | Spicetify 확장: ivLyrics 발음 공급, 캐시, 제목 복사 |
| `start.ps1`, `stop.ps1` | 도우미와 Spotify 시작, 도우미 중지 |
| `installer/` | NSIS 설치 프로그램과 Spicetify 연결 스크립트 |
| `scripts/` | 배포 준비, 외부 입력 다운로드, 설치 프로그램 빌드 |

배포 절차와 포함 범위는 [배포 안내](docs/RELEASE.md)를 참고합니다.

개발 중인 0.6.2는 `components.json`에서 버전과 해시를 관리합니다. ivLyrics 교체와 원본 감지 및 호환성 검사 절차는 [구성 요소 유지 관리](docs/DEPENDENCIES.md)를 참고하세요.

</details>

## 라이선스

이 프로젝트의 소스는 GPL-3.0-or-later를 따릅니다. 설치본에 포함한 외부 구성 요소의 라이선스와 대응 소스는 [외부 구성 요소](THIRD_PARTY_NOTICES.md)와 [라이선스 검토](docs/LICENSE_REVIEW.md)에 정리되어 있습니다. 소프트웨어 라이선스는 가사 자체의 재배포 권한을 부여하지 않습니다.

이 저장소의 `android/` 폴더는 안드로이드 앱을 분리하기 전의 이력입니다. 안드로이드 개발과 APK 배포는 [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID)에서 진행합니다.

안드로이드의 [현재 베타 APK](https://github.com/ForUltraplayer/SPOTIFY_ANDROID/releases/tag/v2.0.1-hangul.4)는 재생과 한글 가사를 한 앱에서 제공합니다. Google 로그인 실패 사례와 Spotify용 비밀번호를 사용하는 이메일 로그인 대안은 해당 README와 릴리스에 명시했습니다. Apple과 Facebook 로그인은 실제 검증하지 않았습니다.
