# 배포 준비

현재 상태는 소스 배포 초안이다. 설치 프로그램과 런타임을 포함한 정식 배포는 아직 검증하지 않았다.

## 포함 범위

가사 연결 소스, 실행 스크립트, 고정된 의존성 버전, 검사 코드와 사용 문서를 포함한다. `scripts/prepare_release.py`가 명시적으로 지정한 파일만 묶고 파일별 SHA-256 목록을 만든다. 원본 Spotify 실행 파일, 계정 정보, 가사 전체, 개인 캐시와 Python 실행 환경은 포함하지 않는다.

프로젝트 버전과 검증한 프로그램 버전은 `release.json`에 기록한다. `public_release_ready`는 현재 거짓이며 빌드 도구는 소스 초안만 생성한다.

## 다른 PC의 수동 설치 전제

1. Spotify 데스크톱, Spicetify와 ivLyrics를 먼저 설치하고 ivLyrics의 원문 가사가 표시되는지 확인한다. 이 프로젝트의 자동 설치 대상으로 아직 구현하지 않았다.
2. 검증한 Python 버전을 준비한다. Microsoft Store 앱 별칭만 있는 상태는 지원되는 Python 설치가 아니다.
3. 소스에서 `python -m pip install --target vendor -r requirements.txt`를 실행한다. 전역 Python 패키지를 교체하지 않는다.
4. `%LOCALAPPDATA%\ivLyricsHangul`에 `bridge.py`, `phonetics.py`, `start.ps1`, `stop.ps1`, `vendor/`를 복사한다. 기존 설치가 있다면 먼저 실행 파일과 캐시를 백업한다.
5. 설치 폴더의 `python-path.txt`에 해당 PC의 `pythonw.exe` 전체 경로를 UTF-8로 저장한다. 다른 PC의 경로 파일을 복사하지 않는다.
6. `hangul-lyrics.js`를 해당 PC의 Spicetify 확장 폴더에 복사하고 `spicetify config extensions hangul-lyrics.js`와 `spicetify refresh -e`를 실행한다. Spotify 버전에 따라 Spicetify 재적용이 필요할 수 있다.
7. Windows PowerShell에 `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "설치폴더\start.ps1"` 인수를 전달하는 바로가기를 만든다. 실행 후 원문 가사와 한글 발음을 확인한다.

이 절차는 현재 PC의 설치 구조를 기준으로 정리했다. 깨끗한 다른 PC에서 그대로 설치하는 검증은 아직 수행하지 않았다. Python과 의존성을 묶은 설치 프로그램은 다음 준비 항목이다.

## 정식 배포 전 확인 항목

| 항목 | 상태 | 다음 확인 |
| --- | --- | --- |
| 소스 저장소와 비공개 파일 분리 | 준비 | 배포 초안 목록과 Git 상태 검사 |
| 전체 제목 복사와 자동 발음 알림 제거 | 구현 | Spotify 업데이트 후 실제 화면 회귀 검사 |
| 터미널 PATH에 의존하지 않는 시작 | 현재 PC 확인 | Python 미설치 및 앱 별칭만 있는 다른 PC 검사 |
| 기존 발음과 커버곡 원문 대조 | 기존 회귀 검사 보존 | 실제 여러 곡의 전환과 누락 사례 검사 |
| 설치·업데이트·제거 도구 | 미구현 | 기존 캐시 보존, 실패 복구, 설치 위치 탐지 |
| 독립 Python 실행 환경 | 미포함 | 내장 Python과 의존성 및 사전의 재배포 구성 검토 |
| 자체 소스 라이선스 | GPL-3.0-or-later 적용 | 실제 바이너리 배포 시 고지와 대응 소스 구성 재검증 |
| 외부 라이브러리와 사전 고지 | 목록 준비 | 실제 포함 파일별 고지와 소스 제공 조건 확인 |
| 한음 등 외부 자료 이용 조건 | 미확인 항목 존재 | 가사 자체를 배포하지 않고 이용 조건 재확인 |
| 깨끗한 Windows 설치 시험 | 미수행 | 새 사용자 프로필, 한글·공백 경로, 일반 권한, 제거 및 복구 |

## 배포 초안 생성

```powershell
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
python scripts/prepare_release.py
```

빌드 도구는 검사를 대신 실행하지 않는다. 검사 결과와 실제 설치 검증 범위를 구분해 기록한 뒤 생성한다. `.git/`, `work/`, `vendor/`, `runtime/`, `cache.json`, `aliases.json`, `python-path.txt`와 `start-error.txt`는 묶음에서 제외한다. 패키지의 파일 목록은 화이트리스트로 정하므로 작업 폴더의 임시 파일을 추가해도 자동으로 포함되지 않는다.
