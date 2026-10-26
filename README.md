# SpotX + ivLyrics + 한글 독음 (Windows)

**한국어** | [English](README.en.md)

Spotify 데스크톱 가사 화면에 일본어 노래의 한글 발음을 같이 띄워 줍니다. 한음, 나무위키에 올라와 있는 한글 발음을 가져와 Spotify 가사와 줄 단위로 맞춥니다.

[SpotX](https://github.com/SpotX-Official/SpotX) + [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics) 기반이고, 현재 0.6.1 베타입니다.

**[⬇ 다운로드 (v0.6.1)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.6.1)**

안드로이드 버전: [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID)

## 설치

Spotify, SpotX, Python을 미리 깔아 둘 필요 없습니다.

1. `SpotifyHangul-0.6.1-Setup.exe`를 받아 실행합니다.
2. 설치 폴더를 고릅니다. 기본값은 `%LOCALAPPDATA%\Programs\SpotifyHangul`입니다.
3. 설치 중에 공식 Spotify 파일(약 150 MB)을 내려받습니다.

관리자 권한은 필요 없습니다. 베타라 코드 서명은 없습니다.

## 사용

1. 바탕화면의 **Spotify 한글 가사** 바로가기로 실행합니다.
2. Spotify에서 **ivLyrics** 화면을 엽니다.
3. ivLyrics 설정에서 원문 표시와 한글 발음 표시를 켭니다.

> [!IMPORTANT]
> 일반 Spotify 바로가기로 열면 발음이 안 나옵니다. 꼭 **Spotify 한글 가사** 바로가기를 쓰세요.

곡별 자료 주소 지정이나 자동 발음은 프로필 메뉴의 **한글 발음 자료**에서 설정합니다.

## 기능

- 한음, 나무위키 한글 발음을 Spotify 가사와 줄 단위로 매칭 (일본어 줄의 85% 이상 일치할 때만 사용)
- 한 번 찾은 자료는 기억해서 다음 재생 때 바로 표시
- 가사를 못 찾으면 feat. 제거, 대표 가수, 커버곡 원곡 등으로 재검색
- 조회 실패 시 자동 재시도 (2초 간격 최대 3회)
- 자동 발음: 자료에 없는 줄을 사전으로 변환 (기본 꺼짐)
- 곡 제목 복사 (재생바 제목 우클릭, 곡 메뉴, 프로필 메뉴)

## 업데이트 / 제거

- **0.6.1 이후**: 바로가기로 실행하면 새 버전을 확인해서 자동으로 업데이트합니다 (8시간 간격, Spotify 종료 후 적용).
- **0.6.0 이하**: Spotify를 끄고 `SpotifyHangul-0.6.1-Update.exe`를 실행하거나 Setup.exe를 같은 폴더에 다시 설치합니다.
- **제거**: Windows 설정 > 앱 > 설치된 앱에서 **Spotify 한글 가사**를 제거합니다. 기존 Spotify와 발음 캐시는 남습니다.

통합 Spotify 자체의 자동 업데이트는 패치 유지를 위해 막아 둡니다. Spotify 버전은 새 설치본으로 올라갑니다.

## 알려진 문제

- 한글 발음 자료가 없는 곡은 표시되지 않습니다.
- 자동 발음은 실제 노래의 한자 읽기와 다를 수 있습니다.
- Spotify, Spicetify 업데이트로 호환성이 깨질 수 있습니다.
- Windows ARM64, Store판 Spotify와의 공존은 확인하지 않았습니다.

## 테스트 환경

Windows 11 x64 / Spotify 1.3.6.1921 / Spicetify 2.46.3 / ivLyrics 7.0.16

## 저장 데이터

발음 캐시는 `%LOCALAPPDATA%\ivLyricsHangul\`에 저장됩니다 (최대 500곡, 30일). 업데이트나 제거해도 지워지지 않습니다.

자세한 내용은 [운영 안내](docs/OPERATIONS.md), [검증 기록](docs/VERIFICATION.md), [통합 구조](docs/SPOTX_INTEGRATION.md) 참고.

## 개발

<details>
<summary>테스트와 빌드</summary>

Python과 Node.js가 필요합니다.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_installer.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_bootstrap.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_auto_update.ps1
```

빌드 결과는 `dist/`에 생성됩니다.

```powershell
python scripts/build_spotx_adapter.py
python scripts/prepare_release.py
python scripts/fetch_distribution_inputs.py
python scripts/build_installer.py
```

| 경로 | 역할 |
| --- | --- |
| `bridge.py` | 로컬 도우미 (발음 자료 조회, 원문 대조) |
| `phonetics.py` | 자동 발음 변환 |
| `hangul-lyrics.js` | Spicetify 확장 |
| `start.ps1`, `stop.ps1` | 실행 / 중지 |
| `installer/` | NSIS 설치 프로그램 |
| `scripts/` | 배포, 빌드 스크립트 |

배포 절차는 [docs/RELEASE.md](docs/RELEASE.md) 참고.

</details>

## 라이선스

GPL-3.0-or-later. 포함된 외부 구성 요소는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요. 가사 자체의 재배포 권한은 포함되지 않습니다.
