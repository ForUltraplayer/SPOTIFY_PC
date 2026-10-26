# 설치 배포 안내

버전 0.5.1은 Windows x64용 EXE 베타 설치본이다. 사용자 지정 폴더에 설치하며 CPython 3.13.17과 사전을 포함하므로 별도 Python 설치가 필요하지 않다. 다른 깨끗한 PC에서의 검증이 남아 있어 정식 배포 준비 완료로 표시하지 않는다.

## 설치와 제거

1. Spotify 데스크톱 버전을 설치하고 한 번 실행한다. 현재 탐지는 일반 데스크톱 설치 경로나 기존 Spicetify 설정을 사용한다. Microsoft Store 전용 설치와 Windows ARM64는 검증하지 않았다.
2. 배포 페이지의 Setup.exe를 실행하고 비어 있는 전용 하위 폴더를 선택한다. 기본 위치는 `%LOCALAPPDATA%\Programs\SpotifyHangul`이다. 설치 중 Spotify는 종료된다.
3. 바탕화면의 Spotify 한글 가사를 실행하고 Spotify 안의 ivLyrics 화면을 연다. 원문 표시와 한글 발음 표시를 선택한다. 자동 발음 사용 여부는 한글 발음 자료 메뉴에서 정한다.
4. 제거할 때는 Windows 설치된 앱의 Spotify 한글 가사를 사용한다. 이 설치본이 추가한 발음 확장을 연결 해제하거나 설치 전 파일로 복원한다. 함께 준비한 ivLyrics와 개인 캐시는 유지한다.

설치 프로그램은 관리자 권한을 요구하지 않는다. 선택한 폴더에는 현재 사용자의 쓰기 권한이 필요하다. 서비스, 부팅 자동 시작이나 전역 PATH는 등록하지 않는다. Spotify와 Spicetify의 버전 호환성은 외부 업데이트에 따라 달라질 수 있다. 기존 ivLyrics가 있으면 유지하므로 다른 기존 버전과의 조합은 추가 검증이 필요하다. 베타 EXE는 코드 서명이 없다.

기존 발음 확장과 설정 및 바탕화면 바로가기는 설치 폴더의 backup에 보존한다. 적용 도중 오류가 나면 해당 시도의 확장과 설정을 복원하고 가능한 경우 이전 설정을 재적용한다. 오류 원문은 install.log에 남긴다. 제거 후 ivLyrics 표시 설정의 자동 복원은 제공하지 않는다.

## 포함 범위와 재현 빌드

설치본은 자체 소스, 내장 Python, 의존 라이브러리와 사전, Spicetify 2.46.3, ivLyrics 7.0.16을 포함한다. 원본 고지는 licenses와 각 패키지에 유지한다. GPL 및 LGPL 구성 요소의 대응 소스 압축은 third_party_sources에 포함한다. Spotify 실행 파일, 계정 정보, 가사 묶음과 개인 캐시는 배포하지 않는다.

```powershell
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_installer.ps1
python scripts/prepare_release.py
python scripts/fetch_distribution_inputs.py
python scripts/build_installer.py
```

빌드용 Python과 Node.js는 개발 PC에 필요하며 설치 대상 PC에는 필요하지 않다. 다운로드는 공식 공개 배포 주소를 사용한다. Python과 PyPI 패키지는 공개된 SHA-256과 비교하고 나머지 입력도 다운로드 잠금 목록에 해시를 기록한다. Python의 Sigstore 자료에서는 배포 해시를 비교하며 서명 체인 검증을 대신했다고 주장하지 않는다. 설치 도구 NSIS는 프로젝트 work에만 풀어서 사용한다.

소스 압축은 scripts/prepare_release.py의 명시적 허용 목록만 포함한다. `.git/`, `work/`, 개인 캐시, 서명 키, 설치 상태와 진단 기록은 제외한다. 모든 산출물은 dist에 생성하고 SHA-256 목록을 함께 제공한다. 공개 소스에는 개인 재생 목록의 이름이나 곡별 검사 결과를 넣지 않는다.

## 남은 검증

현재 PC의 실제 설치, 한글 및 공백 경로, 제거와 기존 설정 보존 결과는 검증 기록에 구분해 남긴다. PATH에서 Python을 제외한 격리 검사는 깨끗한 다른 PC에서의 설치 시험과 구별한다. 전체 곡의 발음 청취 정확도와 외부 가사 서비스의 모든 이용 조건 검토는 완료하지 않았다. 자체 소프트웨어의 라이선스가 가사 재배포 권한을 부여하지 않는다.
