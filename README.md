# Spotify 한글 발음 가사 (Windows)

Windows용 Spotify 데스크톱 앱의 가사 화면에 **일본어 노래의 한글 발음**을 함께 표시합니다. 사람이 웹에 정리해 둔 한글 발음 자료를 찾아 Spotify의 일본어 가사와 줄 단위로 맞춘 뒤 보여 줍니다.

> [!NOTE]
> 현재 버전은 **0.5.1 베타**입니다. 다른 PC에서의 새 설치 검증과 전체 곡의 발음 청취 검수가 남아 있습니다.

**[⬇ 설치 파일 받기 (SpotifyHangul-0.5.1-Setup.exe)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/latest)**

## 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 하는 일 | Spotify 가사 화면에 일본어 원문과 한글 발음을 함께 표시 |
| 발음 출처 | 한음, 나무위키에 사람이 작성한 기존 한글 발음 |
| 대상 | Windows x64 (Windows 11에서 검증), Spotify 데스크톱 앱 (공식 설치본 또는 SpotX 적용본) |
| 기반 | [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics) |
| 설치 방식 | EXE 설치 프로그램 하나 (Python, Spicetify, ivLyrics 포함) |
| 비용 | 유료 API 키나 계정 없이 사용 |
| 안드로이드 | 별도 앱 [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID) |

## 동작 구조

Spotify 데스크톱 앱 자체를 바꾸지 않고, Spotify 꾸미기 도구인 Spicetify 위에서 가사 앱 ivLyrics에 한글 발음을 공급합니다.

```text
Spotify 데스크톱 앱
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

**선택 기능**

- 자동 발음: 발음 자료에 없는 줄을 사전 기반으로 변환 (기본값 꺼짐, 자료 설정 화면에서 자동 생성 줄 수 확인)
- 제목 복사: 하단 재생바의 곡 제목 우클릭, 곡 메뉴, 프로필 메뉴에서 전체 제목 복사

## 설치

### 1단계: Spotify 데스크톱 앱 준비 (필수)

이 프로그램은 Spotify를 설치하지 않습니다. **아래 둘 중 하나를 먼저 설치하고, 한 번 실행해 로그인까지 마쳐야 합니다.** Spotify를 한 번도 실행하지 않았으면 설치 프로그램이 Spotify 설정 파일을 찾지 못해 중단됩니다.

| 방법 | 설치 방법 | 비고 |
| --- | --- | --- |
| A. 공식 Spotify | [Spotify 다운로드 페이지](https://www.spotify.com/download/windows/)에서 **설치 파일 직접 다운로드**를 선택하거나 [SpotifySetup.exe](https://download.scdn.co/SpotifySetup.exe)를 실행 | 가장 단순한 방법 |
| B. SpotX 적용 Spotify | [SpotX](https://github.com/SpotX-Official/SpotX) 저장소의 Installation 안내에 따라 설치 | 무료 계정 광고 차단 등 SpotX 기능 사용 시 |

> [!WARNING]
> **Microsoft Store 버전 Spotify는 지원하지 않습니다.** 설치 프로그램은 `%APPDATA%\Spotify\Spotify.exe`에 설치된 일반 데스크톱 버전만 찾습니다. Store 버전만 있다면 위 A나 B로 데스크톱 버전을 설치하세요. SpotX도 Store 버전에는 적용되지 않으며, 설치 과정에서 Store 버전 제거를 안내합니다.

SpotX를 쓸 경우에는 **SpotX 적용을 먼저 끝낸 뒤** 2단계를 진행합니다. 순서를 바꿔 나중에 SpotX를 다시 적용했다면 2단계의 설치 프로그램을 한 번 더 실행합니다.

### 2단계: 설치 프로그램 실행

1. 음악을 멈춥니다. 설치 중 Spotify가 자동으로 종료됩니다.
2. [배포 페이지](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/latest)에서 `SpotifyHangul-0.5.1-Setup.exe`를 받아 실행합니다.
3. 설치 폴더는 기본값(`%LOCALAPPDATA%\Programs\SpotifyHangul`) 또는 **비어 있는 전용 폴더**를 선택합니다.

관리자 권한은 필요하지 않습니다. 코드 서명이 없는 베타 설치 파일이라 Windows SmartScreen 경고가 나올 수 있습니다. Python, Spicetify, ivLyrics는 설치본에 포함되어 있어 따로 설치할 필요가 없습니다. 이미 Spicetify나 ivLyrics를 쓰고 있었다면 기존 ivLyrics와 설정을 유지합니다.

### 3단계: 사용

1. 바탕화면의 **Spotify 한글 가사** 바로가기로 Spotify를 엽니다. (Spotify가 이미 켜져 있어도 이 바로가기를 사용합니다.)
2. Spotify에서 **ivLyrics** 화면을 엽니다.
3. ivLyrics 설정에서 원문 표시와 한글 발음 표시를 선택합니다.
4. 필요하면 프로필 메뉴의 **한글 발음 자료**에서 곡별 자료 주소와 자동 발음을 설정합니다.

> [!IMPORTANT]
> 일반 Spotify 바로가기로 열면 로컬 도우미가 시작되지 않아 발음이 표시되지 않습니다. 항상 **Spotify 한글 가사** 바로가기를 사용하세요.

### 업데이트와 제거

- **업데이트**: 새 버전 설치 파일을 같은 폴더에 다시 설치합니다.
- **Spotify 업데이트 후 발음이 사라질 때**: Spotify가 업데이트되면 Spicetify 적용이 풀릴 수 있습니다. 설치 프로그램을 다시 실행합니다.
- **제거**: Windows **설정 > 앱 > 설치된 앱**에서 **Spotify 한글 가사**를 제거합니다. 이 프로그램이 추가한 확장만 해제하며 ivLyrics와 발음 캐시는 남겨 둡니다.

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
| Spotify | 1.3.6.1921 (공식 데스크톱 설치본) |
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
```

소스 배포 초안과 설치 프로그램은 다음 명령으로 `dist/`에 생성합니다. 외부 배포 파일은 공식 배포 주소와 SHA-256으로 고정합니다.

```powershell
python scripts/prepare_release.py
python scripts/fetch_distribution_inputs.py
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

</details>

## 라이선스

이 프로젝트의 소스는 GPL-3.0-or-later를 따릅니다. 설치본에 포함한 외부 구성 요소의 라이선스와 대응 소스는 [외부 구성 요소](THIRD_PARTY_NOTICES.md)와 [라이선스 검토](docs/LICENSE_REVIEW.md)에 정리되어 있습니다. 소프트웨어 라이선스는 가사 자체의 재배포 권한을 부여하지 않습니다.

이 저장소의 `android/` 폴더는 안드로이드 앱을 분리하기 전의 이력입니다. 안드로이드 개발과 APK 배포는 [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID)에서 진행합니다.
