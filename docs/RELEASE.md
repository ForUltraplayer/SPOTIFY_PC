현재 공개 배포는 0.6.3 베타다. 0.6.2는 업그레이드 실패로 초안 상태로 전환했으며 아래 0.6.2 설명은 당시 구성 기록이다. 0.6.3은 구버전 설치 전환 검사와 사용자의 다른 PC 덮어 설치 성공 보고 후 공개 승인을 받아 배포한다.

# 설치 배포 안내

버전 0.6.2는 Windows x64용 통합 EXE 베타다. 사용자 지정 폴더에 Spotify와 SpotX, Spicetify 및 ivLyrics를 한 번에 구성한다. CPython 3.13.17과 사전을 포함하므로 별도 Python 설치가 필요하지 않다. 설치 중 공식 Spotify 파일 약 150 MB를 추가로 내려받는다. 다른 깨끗한 PC에서의 검증이 남아 있어 정식 배포 준비 완료로 표시하지 않는다.

## 설치와 제거

1. Spotify를 미리 설치하거나 실행할 필요가 없다. 인터넷 연결을 준비한다. Microsoft Store판 공존과 Windows ARM64는 검증하지 않았다.
2. 배포 페이지의 Setup.exe를 실행하고 비어 있는 전용 하위 폴더를 선택한다. 기본 위치는 `%LOCALAPPDATA%\Programs\SpotifyHangul`이다. 기존 설치를 업데이트하려면 같은 폴더를 선택한다.
3. 바탕화면의 Spotify 한글 가사를 실행하고 Spotify 안의 ivLyrics 화면을 연다. 원문 표시와 한글 발음 표시를 선택한다. 자동 발음 사용 여부는 한글 발음 자료 메뉴에서 정한다.
4. 제거할 때는 Windows 설치된 앱의 Spotify 한글 가사를 사용한다. 설치 폴더의 통합 Spotify와 Spicetify 및 ivLyrics는 함께 제거한다. 기존 Spotify와 사용자 프로필 및 개인 발음 캐시는 유지한다. 0.5.x에서 업데이트한 경우 이전 확장 복원 절차도 실행한다.

설치 프로그램은 관리자 권한을 요구하지 않는다. 선택한 폴더에는 현재 사용자의 쓰기 권한이 필요하다. 서비스나 전역 PATH는 등록하지 않는다. 부팅 자동 시작은 새로 만들지 않으며, 0.7.11부터 Spotify가 등록해 둔 자동 시작 값만 한글 가사 실행으로 바꾼다. 백신 예외도 추가하지 않는다. 통합 Spotify의 자동 업데이트는 패치 유지를 위해 차단하며 새 통합 설치본으로 버전을 교체한다. 기존 ivLyrics가 있으면 처음 설치할 때 복사해 유지하므로 다른 기존 버전과의 조합은 추가 검증이 필요하다. 베타 EXE는 코드 서명이 없다.

기존 Spotify 파일과 공유 Spicetify 설정은 덮어쓰지 않는다. 통합본은 설치 폴더의 spicetify-config와 독립 백업을 사용한다. 재적용 전 해당 시도의 설정과 Spotify Apps 폴더를 보존하고 실패하면 복원한다. 0.5.x에서 보존한 backup은 유지한다. 오류 원문은 install.log와 spotx-install.log에 남긴다. 제거 후 ivLyrics 표시 설정의 자동 복원은 제공하지 않는다. [통합 구조와 한계](SPOTX_INTEGRATION.md)를 참고한다.

## 포함 범위와 재현 빌드

설치본은 자체 소스, 내장 Python, 의존 라이브러리와 사전, Spicetify 2.46.4, ivLyrics 7.0.16과 고정한 SpotX MIT 소스를 포함한다. 원본 고지는 licenses와 각 패키지 및 third_party/spotx/LICENSE에 유지한다. GPL 및 LGPL 구성 요소의 대응 소스 압축은 third_party_sources에 포함한다. Spotify 실행 파일, 계정 정보, 가사 묶음과 개인 캐시는 배포하지 않는다.

```powershell
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_installer.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_bootstrap.ps1
python scripts/build_spotx_adapter.py
python scripts/fetch_distribution_inputs.py
python scripts/check_compatibility.py
python scripts/prepare_release.py
python scripts/build_installer.py
```

빌드용 Python과 Node.js는 개발 PC에 필요하며 설치 대상 PC에는 필요하지 않다. 다운로드는 공식 공개 배포 주소를 사용한다. Python과 PyPI 패키지는 공개된 SHA-256과 비교하고 나머지 입력도 다운로드 잠금 목록에 해시를 기록한다. Python의 Sigstore 자료에서는 배포 해시를 비교하며 서명 체인 검증을 대신했다고 주장하지 않는다. 설치 도구 NSIS는 프로젝트 work에만 풀어서 사용한다.

소스 압축은 scripts/prepare_release.py의 명시적 허용 목록만 포함한다. `.git/`, `work/`, 개인 캐시, 서명 키, 설치 상태와 진단 기록은 제외한다. 모든 산출물은 dist에 생성하고 SHA-256 목록을 함께 제공한다. 공개 소스에는 개인 재생 목록의 이름이나 곡별 검사 결과를 넣지 않는다.

## 자동 업데이트 대상 릴리스 게시

0.7.0부터 자동 업데이터는 초안과 시험판(prerelease) 표시가 붙은 GitHub 릴리스를 건너뛴다. 0.6.x 업데이터는 시험판 표시를 확인하지 않는다. 따라서 0.7.0 설치자에게 전달할 0.7.1 이후 버전은 시험판 표시 없이 게시해야 한다. 업데이터는 다음 조건을 모두 만족하는 릴리스만 선택한다.

| 항목 | 조건 |
| --- | --- |
| 태그 | `v` 뒤에 숫자 세 자리 버전 (`v0.7.1`) |
| 상태 | 초안 아님, 시험판 아님 |
| 자산 이름 | `SpotifyHangul-<버전>-Setup.exe` |
| 자산 크기 | 1 MB 이상 250 MB 이하, GitHub 자산 SHA-256 정보 존재 |
| 파일 버전 | Setup.exe의 Windows 파일 버전이 태그 버전과 같음 |

업데이터는 Spotify 한글 가사를 실행할 때 최대 4 시간마다 확인한다(0.7.3 이하 설치본은 8 시간). 새 설치 프로그램을 내려받아 두고 다음 실행 때 조용히 적용한다.

## 남은 검증

현재 PC의 실제 설치, 한글 및 공백 경로, 제거와 기존 설정 보존 결과는 검증 기록에 구분해 남긴다. PATH에서 Python을 제외한 격리 검사는 깨끗한 다른 PC에서의 설치 시험과 구별한다. 전체 곡의 발음 청취 정확도와 외부 가사 서비스의 모든 이용 조건 검토는 완료하지 않았다. 자체 소프트웨어의 라이선스가 가사 재배포 권한을 부여하지 않는다.

## 0.6.2 구성 요소 관리

구성 요소 정보는 components.json으로 통합한다. Spicetify 2.46.4 후보의 자동 검사를 통과해 개발 목록에 반영했다. 설치본 빌드는 현재 소스와 목록에 일치하는 호환성 검사 보고서를 요구한다. ivLyrics 교체와 원본 유지 관리 절차는 [구성 요소 유지 관리](DEPENDENCIES.md)를 따른다. 공개 릴리스와 실제 재생 검증 여부는 별도로 확인한다.
