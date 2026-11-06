# SpotX + ivLyrics + 한글 독음 (Windows)

**한국어** | [English](README.en.md)

Spotify 데스크톱 가사 화면에 일본어 노래의 한글 발음을 같이 띄워 줍니다. 한음, 나무위키에 올라와 있는 한글 발음을 가져와 Spotify 가사와 줄 단위로 맞춥니다. YouTube 링크도 Spotify 곡과 같은 목록에서 재생할 수 있습니다.

[SpotX](https://github.com/SpotX-Official/SpotX) + [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics) 기반이고, 현재 공개 버전은 0.9.4입니다.

> 개인이 취미로 만든 비공식 프로젝트입니다. 유지보수와 업데이트를 보장하지 않으니 [면책](#면책) 내용을 먼저 읽어 주세요.

**[⬇ 다운로드 (v0.9.4)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.9.4)** · [버전별 변경 내역](https://github.com/ForUltraplayer/SPOTIFY_PC/releases)

> 0.9.0부터 앱 이름이 **Spotify-ex**로 바뀌었습니다. 바탕화면과 시작 메뉴의 바로가기는 업데이트 때 새로 만들어지지만, 작업 표시줄이나 시작 화면에 고정한 아이콘은 새 **Spotify-ex** 바로가기로 다시 고정해 주세요.

## 설치

Spotify, SpotX, Python을 미리 깔아 둘 필요 없습니다. 설치 파일에 Python과 Node가 들어 있습니다.

1. `SpotifyHangul-0.9.4-Setup.exe`를 받아 실행합니다.
2. 설치 폴더를 고릅니다. 기본값은 `%LOCALAPPDATA%\Programs\SpotifyHangul`입니다.
3. 설치 중에 공식 Spotify 파일(약 150 MB)을 내려받습니다.

베타라 코드 서명은 없습니다.

## 사용

1. 바탕화면의 **Spotify-ex** 바로가기로 실행합니다.
2. Spotify에서 **ivLyrics** 화면을 엽니다.
3. ivLyrics 설정에서 원문 표시와 한글 발음 표시를 켭니다.

곡별 자료 주소 지정이나 자동 발음은 프로필 메뉴의 **한글 발음 자료**에서 설정합니다.

> [!IMPORTANT]
> 일반 Spotify 바로가기로 열면 한글 발음과 YouTube 곡이 동작하지 않습니다. 꼭 **Spotify-ex** 바로가기를 쓰세요. 0.7.11부터는 Spotify의 「로그인 후 자동 실행」이 켜져 있으면, 바로가기로 한 번 실행한 뒤부터 Windows 시작 때도 한글 가사로 열립니다.

## 기능

**한글 발음**

- 한음, 나무위키 한글 발음을 Spotify 가사와 줄 단위로 매칭 (일본어 줄의 85% 이상 일치할 때만 사용)
- 한 번 찾은 자료는 기억해서 다음 재생 때 바로 표시
- 가사를 못 찾으면 feat. 제거, 대표 가수, 커버곡 원곡 등으로 재검색
- 조회 실패 시 자동 재시도 (2초 간격 최대 3회)
- 자동 발음: 자료에 없는 줄을 사전으로 변환 (기본 꺼짐, 한음과 나무위키 표기 관례를 따름)
- 곡별 초 단위 가사 싱크 조절과 되돌리기

**YouTube 연결**

- YouTube 링크를 Spotify 곡과 같은 목록에서 재생하고, 목록을 파일로 내보내거나 가져오기
- 음원 스트리밍과 영상 플레이어 전환, 기존 재생바와 ivLyrics 가사 연결
- Spotify 곡과 같은 볼륨 값과 비슷한 소리 크기로 재생

**그 밖의 기능**

- 곡 제목 복사 (재생바 제목 우클릭, 곡 메뉴, 프로필 메뉴)
- 프로필 메뉴에서 설치 버전 확인과 수동 업데이트 확인
- 설치 실패와 중단 시 이전 파일 및 설치 등록 복원

구현과 제약은 [YouTube 연결 안내](docs/YOUTUBE_LINKS.md)와 [운영 안내](docs/OPERATIONS.md)를 참고하세요.

<details>
<summary>변경 내역</summary>

- 0.9.1: AdGuard 같은 광고 차단·보안 프로그램이 PC 안의 연결을 검사할 때 확장 탭이 "읽는 중…"에서 멈추고 확장 설치가 실패하던 문제 수정
- 0.9.0: 앱 이름을 Spotify-ex로 변경(바로가기와 시작 메뉴를 새 이름으로 다시 만들고 옛 바로가기는 정리, 고정 아이콘은 다시 고정 필요)
- 0.9.0: Spotify가 한국어가 아니면 한글 가사 설정, 가사 싱크, YouTube 링크 음악 화면과 도우미·설치 안내를 영어로 표시
- 0.8.1: 오래 켜 두면 Spotify 화면이 검게 되고 재생이 멈추던 문제(재생 상태 응답을 닫지 않아 화면 프로세스 자원이 분당 120개씩 쌓임) 수정
- 0.8.1: 가사 화면을 여닫을 때 메모리가 쌓이던 문제와 다른 언어 Spotify에서 YouTube 재생 중 셔플·기기 연결 버튼이 동작하지 않던 문제 수정
- 0.8.0: YouTube·Spotify 혼합 플레이리스트의 Spotify 곡도 확장 음원으로 재생하고, 곡마다 ISRC를 확장에 보내 더 많은 곡을 찾음
- 0.8.0: Mornye, FLAC Bridge처럼 로그인이 필요한 확장을 연결하고(WebView2 창), Tidal 계열(DASH) 음원을 재생
- 0.8.0: 확장에서 곡을 못 찾으면 음질 줄에 이유를 표시하고, 재생 상세 정보에 「다시 찾기」 추가
- 0.8.0: 휴대폰(Myspoti-ex)에서 내보낸 목록 파일 가져오기, 확장 관리 탭을 누를 때 창이 닫히던 문제 수정
- 0.7.12: 안드로이드 Myspoti(Myspoti-ex)의 확장을 PC에서 사용. 프로필 메뉴의 「확장 관리」에서 Myspoti와 같은 스토어로 설치하고, 재생바에서 지금 재생 중인 소스와 음질, 소스 선택기, 선택 이유를 확인
- 0.7.12: Spotify가 켜진 상태에서 업데이트할 때 설치가 실패하던 문제 수정
- 0.7.11: Spotify의 「로그인 후 자동 실행」이 켜져 있으면 Windows 시작 때도 한글 가사로 열림(바로가기로 한 번 실행한 뒤부터)
- 0.7.11: ivLyrics 7.0.18 적용. 이 설치본을 바꿀 수 없는 ivLyrics 자체 업데이트 알림은 더 이상 표시하지 않음
- 0.7.10: 한국어가 아닌 Windows의 언어 환경에서 설치가 실패하던 문제 수정
- 0.7.8: Windows 사용자 이름이 긴 PC 등에서 설치가 「설치에 실패했습니다」로 끝나던 문제 수정
- 0.7.8: 한국어가 아닌 Windows에서 설치·업데이트 창을 영어로 표시하고, 쓸 수 없는 설치 폴더는 고를 때 바로 안내(0.7.7 시험판 내용 포함)
- 0.7.6: 자동 업데이트 안정성 개선. 배포 저장소 주소가 바뀌어도 새 버전을 계속 찾음
- 0.7.5: YouTube 음원이 Spotify 곡보다 크게 들리던 문제 수정. YouTube 플레이어와 같은 음량 보정을 음원 모드에도 적용
- 0.7.5: 같은 볼륨 슬라이더 위치에서 YouTube 음원과 영상이 Spotify 곡과 비슷한 크기로 들리도록 볼륨 곡선을 맞춤
- 0.7.5: Spotify 곡과 YouTube 곡이 볼륨 값을 함께 씀. YouTube 곡에서 바꾼 볼륨이 다음 Spotify 곡에도 그대로 적용
- 0.7.4: 새 버전이 있으면 업데이트할지 묻고, 진행률을 보여 주며 내려받아 설치한 뒤 다시 실행
- 0.7.4: Spotify 오른쪽 위 프로필 메뉴에서 설치 버전 확인과 수동 업데이트 확인
- 0.7.4: 「데스크탑 오버레이 사용」이 켜져 있으면 가사 화면이나 YouTube 곡의 「가사 열기」를 누를 때 설치된 가사창을 자동 실행
- 0.7.3: 바로가기를 두 번 누르거나 설치 직후 동시에 실행해도 도우미 오류 없이 시작
- 0.7.3: 실행할 때 PowerShell 창이 뜨지 않고, Spotify가 더 빨리 열림
- 0.7.3: AdGuard 등 네트워크 필터가 켜진 PC에서 "Failed to fetch"와 YouTube 모듈 로드 실패 수정
- 0.7.3: 영상 ID에 "ad"가 들어간 YouTube 곡의 썸네일이 비던 문제 수정
- 0.7.2: YouTube 음원 첫 재생 실패 수정 (새 음원 주소가 재생 가능해질 때까지 대기, 실패 시 한 번 자동 재시도)
- 0.7.2: 자동 발음을 한음·나무위키 표기 관례(장음 생략, 촉음 받침 ㅅ)에 맞춤
- 0.9.3: 혼합 목록 셔플 수정. Spotify 셔플 설정을 그대로 따르고, 모든 곡을 한 번씩 재생한 뒤 다시 섞음. 혼합 목록의 스마트 셔플은 목록 안의 곡만 섞으며 안내를 한 번 표시
- 0.9.2: ivLyrics 7.1.2 적용
- 0.9.4: ivLyrics 7.1.4 적용

</details>

## 데스크톱 가사창

데스크톱 가사창(오버레이)은 따로 설치합니다. 재생 버튼을 추가한 수정본의 설치 파일(`lyrics-plus-overlay_…_x64-setup.exe`)을 [ivLyrics-overlay 포크 릴리스](https://github.com/ForUltraplayer/ivLyrics-overlay/releases/latest)에서 받아 설치한 뒤, ivLyrics 설정의 **일반 > 데스크탑 오버레이 사용**을 켭니다. 켜 두면 가사 화면이나 YouTube 곡의 「가사 열기」를 누를 때 가사창이 자동으로 실행됩니다.

원본 오버레이 저장소에는 라이선스가 명시돼 있지 않습니다. 구성 요소별 안내는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.

## 업데이트 / 제거

- **자동 업데이트**: 바로가기로 실행하면 새 버전을 확인합니다 (마지막 확인에서 4 시간 이후 재조회). 새 버전이 있으면 업데이트할지 묻고, 「예」를 누르면 내려받은 뒤 Spotify를 닫고 설치해 다시 실행합니다. 프로필 메뉴의 「업데이트 확인」으로 바로 확인할 수도 있습니다.
- **직접 설치 / 업데이트**: Spotify와 가사창을 종료하고 `SpotifyHangul-0.9.4-Setup.exe`를 같은 폴더에 다시 설치합니다.
- **제거**: Windows 설정 > 앱 > 설치된 앱에서 **Spotify-ex**를 제거합니다. 기존 Spotify와 발음 캐시는 남습니다.

통합 Spotify 자체의 자동 업데이트는 패치 유지를 위해 막아 둡니다. Spotify 버전은 새 설치본으로 올라갑니다.

<details>
<summary>이전 버전에서 올라올 때</summary>

- 0.6.0, 0.6.1, 0.6.3에서도 중간 버전 없이 바로 업데이트할 수 있습니다. 0.6.3에서 처음 올라올 때는 공식 Spotify 파일 약 150 MB를 추가로 내려받습니다.
- 0.7.3 이하는 묻지 않고 8 시간 간격으로 조용히 내려받아 다음 실행 전에 적용합니다.
- 0.7.0부터 업데이터는 GitHub의 시험판(prerelease) 표시가 없는 릴리스만 선택합니다.
- 0.7.0에 포함됐던 데스크톱 가사창은 업데이트 때 설치 폴더에서 제거되며, 따로 받아 둔 가사창은 그대로 둡니다.

</details>

## 설치나 실행이 안 될 때

- **설치 프로그램은 관리자 권한 없이 더블클릭으로 실행합니다.** 우클릭의 「관리자 권한으로 실행」이나, 파일 속성 > 호환성 탭의 「관리자 권한으로 이 프로그램 실행」을 쓰면 Spicetify 적용 단계에서 설치가 실패합니다. 사용자 계정 컨트롤(UAC)을 끈 PC처럼 모든 프로그램이 관리자 권한으로 실행되는 환경에서도 같은 이유로 설치되지 않을 수 있습니다(아직 대응 전).
- **확장 탭이 「읽는 중…」에서 멈추거나 확장 설치가 실패하면** 광고 차단·보안 프로그램이 PC 안의 연결(127.0.0.1)을 검사하는지 확인합니다. AdGuard는 0.9.1부터 켠 채로 쓸 수 있습니다. 다른 프로그램에서 같은 증상이 나면 127.0.0.1을 검사 대상에서 빼 주세요.
- **문제를 알릴 때**는 [이슈](https://github.com/ForUltraplayer/SPOTIFY_PC/issues)에 남겨 주세요. 설치에 실패했다면 설치 폴더 옆의 `.SpotifyHangul-update-…` 폴더에 있는 `failure.txt`를 함께 올려 주세요. 기본 설치 폴더라면 `%LOCALAPPDATA%\Programs` 안에 있습니다. 파일에 Windows 사용자 이름이 들어 있을 수 있으니, 원하지 않으면 지우고 올려도 됩니다.

## 알려진 문제

- 한글 발음 자료가 없는 곡은 표시되지 않습니다.
- 자동 발음은 실제 노래의 한자 읽기와 다를 수 있습니다.
- YouTube 영상 모드는 영상 플레이어의 최소 볼륨보다 작게 줄일 수 없어, 슬라이더를 아주 낮게 두면 Spotify 곡보다 크게 들릴 수 있습니다.
- Spotify, Spicetify 업데이트로 호환성이 깨질 수 있습니다.
- 깨끗한 다른 PC의 첫 실행, Windows 10과 ARM64, Store판 Spotify와의 공존은 확인하지 않았습니다.

## 테스트 환경

Windows 11 x64 / Spotify 1.3.6.1921 / Spicetify 2.46.4 / ivLyrics 7.0.16

## 저장 데이터

발음 캐시는 `%LOCALAPPDATA%\ivLyricsHangul\`에 저장됩니다 (최대 500곡, 30일). 업데이트나 제거해도 지워지지 않습니다.

자세한 내용은 [운영 안내](docs/OPERATIONS.md), [검증 기록](docs/VERIFICATION.md), [통합 구조](docs/SPOTX_INTEGRATION.md), [배포 준비](docs/DISTRIBUTION_PLAN.md) 참고.

## 개발

<details>
<summary>테스트와 빌드</summary>

Python과 Node.js가 필요합니다.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p "test_*.py"
node --test (Get-ChildItem test_*.cjs).Name
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_installer.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_bootstrap.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_auto_update.ps1
```

0.7.2부터 설치본은 데스크톱 오버레이를 포함하지 않아 저장소와 공개 다운로드만으로 빌드할 수 있습니다. 빌드는 `work/` 아래의 새 후보 폴더에 만듭니다.

```powershell
python scripts/build_spotx_adapter.py
python scripts/fetch_distribution_inputs.py
npm ci --ignore-scripts --prefix tests/ui
python scripts/check_compatibility.py
python scripts/prepare_release.py --output-dir work/release-candidates/candidate-1
python scripts/build_installer.py --output-dir work/release-candidates/candidate-1
```

| 경로 | 역할 |
| --- | --- |
| `bridge.py` | 로컬 도우미 (발음 자료 조회, 원문 대조) |
| `phonetics.py` | 자동 발음 변환 |
| `hangul-lyrics.js` | Spicetify 확장 |
| `start.ps1`, `stop.ps1` | 실행 / 중지 |
| `installer/` | NSIS 설치 프로그램 |
| `scripts/` | 배포, 빌드 스크립트 |
| `overlay/` | 제품에 포함하지 않는 독립 WPF 시제품 소스 |

배포 절차는 [docs/RELEASE.md](docs/RELEASE.md) 참고.

0.6.2부터 `components.json`에서 버전과 해시를 관리합니다. ivLyrics 교체와 원본 감지 및 호환성 검사 절차는 [구성 요소 유지 관리](docs/DEPENDENCIES.md)를 참고하세요.

</details>

## 면책

- 개인이 취미로 만든 비공식 프로젝트이며, 있는 그대로 제공하고 어떤 보증도 하지 않습니다. 유지보수, 업데이트, 문의 답변은 시간이 날 때 하며 예고 없이 멈출 수 있습니다. Spotify가 바뀌면 일부 기능이 언제든 동작하지 않을 수 있습니다.
- 이 프로젝트는 Spotify AB와 관련이 없으며 Spotify의 승인이나 보증을 받지 않았습니다. Spotify는 Spotify AB의 상표입니다.
- 설치본은 공식 Spotify 클라이언트에 SpotX 패치를 적용하고 자동 업데이트를 막습니다. 클라이언트 수정과 광고 차단은 [Spotify 이용 약관](https://www.spotify.com/kr-ko/legal/end-user-agreement/)에 어긋날 수 있으며 Spotify가 계정을 제한할 수 있습니다. 사용에 따른 책임은 사용자에게 있습니다.
- 가사와 한글 발음 자료의 권리는 각 권리자에게 있습니다. 이 프로젝트는 가사를 배포하지 않고 사용자의 PC에서만 조회하고 저장합니다.
- YouTube 재생에는 YouTube 이용 약관이 적용됩니다.
- 권리자가 요청하면 해당 부분을 내립니다. [이슈](https://github.com/ForUltraplayer/SPOTIFY_PC/issues)로 연락해 주세요.

## 라이선스

GPL-3.0-or-later. 포함된 외부 구성 요소는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요. 가사 자체의 재배포 권한은 포함되지 않습니다.
