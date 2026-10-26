# 실행과 중지

| 표기 | 의미 |
| --- | --- |
| 로컬 도우미 | ivLyricsHangul |
| 발음 제공자 | web-hangul |

## 설치 위치와 데이터

| 항목 | 위치 |
| --- | --- |
| EXE 설치본의 실행 파일 | 설치할 때 선택한 폴더 |
| 기본 설치 위치 | %LOCALAPPDATA%\Programs\SpotifyHangul |
| 이전 수동 설치의 실행 파일 | %LOCALAPPDATA%\ivLyricsHangul |
| 발음 캐시와 확인한 자료 주소 | %LOCALAPPDATA%\ivLyricsHangul의 cache.json과 aliases.json |
| 원문과 발음 등의 ivLyrics 캐시 | Spotify 내부 IndexedDB의 ivLyricsCache |
| 통합 Spotify와 SpotX | 설치 폴더의 Spotify |
| 통합 Spicetify 설정과 백업 | 설치 폴더의 spicetify-config |
| 설치 상태와 이전 버전 복원용 파일 | 설치 폴더의 install-state.json과 legacy-install-state.json 및 backup |
| 설치 오류와 시작 오류 | 설치 폴더의 install.log와 spotx-install.log 및 start-error.txt |
| 제공자 확장 | 설치 폴더의 spicetify-config\Extensions\hangul-lyrics.js |
| 도우미 상태 | http://127.0.0.1:19643/health |
| 자동 업데이트 대기 파일과 상태 | %LOCALAPPDATA%\ivLyricsHangul\updates\설치경로해시 |

설치 폴더와 데이터 폴더는 분리한다. 발음 캐시와 자료 주소는 각각 최대 500 곡, 30 일을 기준으로 관리한다. 실패 결과는 같은 프로세스 안에서 10 분 동안 기억한다. 확인한 ivLyrics 7.0.16은 데이터베이스 버전 7을 사용하며 기본 캐시 기간은 365 일이다. 앱 설정과 원문 버전 및 만료 여부에 따라 실제 재조회 시점이 달라진다.

## 시작과 수명

바탕화면 바로가기는 도우미를 준비한 뒤 Spotify를 실행한다. 일반 Spotify 바로가기는 도우미를 시작하지 않는다. 같은 한글 가사 바로가기를 여러 번 실행해도 정상 응답하는 기존 도우미를 재사용한다. EXE 설치본은 내장 Python을 사용한다. 개발용 명시 환경 변수 IVLYRICS_HANGUL_PYTHON을 지정한 경우에는 그 경로가 우선한다.

버전 0.6.0부터 한글 가사 바로가기는 설치 폴더 안의 통합 Spotify를 연다. 기존 Spotify가 실행 중이면 설치 기록과 기본 경로로 확인한 이전 클라이언트만 종료한다. 두 클라이언트의 사용자 데이터는 Spotify 기본 프로필을 사용하므로 동시에 실행하지 않는다. 기존 Spotify의 파일과 부팅 자동 시작 설정은 바꾸지 않는다. 기존 자동 시작으로 일반 Spotify가 열렸다면 한글 가사 바로가기를 다시 실행한다.

도우미는 같은 PC의 루프백 주소에서만 요청을 받는다. 사전을 초기화한 뒤 메모리에 유지하며 GPU와 음성 장치는 사용하지 않는다. 별도 프로세스는 Spotify 안의 직접 요청과 기본 프록시 경로에서 나무위키 본문을 읽지 못했던 검증 결과를 바탕으로 추가했다. 다른 외부 프록시로 교체하는 대안은 시험하지 않았다.

서비스, 부팅 자동 시작과 실패 후 재시작은 등록하지 않는다. Spotify가 사라진 뒤 약 30~35 초 후 종료하며 시작 시 Spotify를 기다리는 유예 시간은 120 초다. 중지 스크립트는 상태 응답의 프로세스 번호와 설치 경로가 일치할 때만 도우미를 종료한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "선택한 설치폴더\stop.ps1"
```

프로그램 제거는 Windows 설치된 앱에서 진행한다. 개인 캐시를 삭제할 필요는 없다. 통합 Spotify는 자동 업데이트를 차단하며 버전 교체는 새 통합 설치본으로 진행한다. 검증용 디버깅 포트는 상시 사용하지 않으며 진단 후 해당 옵션 없이 Spotify를 다시 실행한다.

이번 작업의 개인 실행 이력, 임시 검사 도우미와 프로세스 번호는 Git에서 제외한 work/runtime/RUNNING.md에 기록한다. 재생 목록 검사는 별도 포트와 별도 캐시를 사용하므로 많은 곡을 검사해도 사용 중인 500 곡 캐시를 밀어내지 않는다. 임시 검사 프로세스는 작업 후 종료한다.

## GitHub 자동 업데이트

0.6.1부터 시작 스크립트는 Spotify를 열기 전에 내려받은 업데이트가 있는지 확인한다. Spotify 프로세스가 열려 있으면 적용을 미룬다. Spotify 실행 후 별도 Windows PowerShell 프로세스가 프로젝트 GitHub 릴리스를 확인하고 새 Setup.exe를 내려받은 뒤 종료한다. 확인 간격은 최소 8 시간이며 실행 중에 주기적으로 계속 감시하는 구조는 아니다. 실패한 설치의 동일 버전 자동 적용은 중단하며 수동 Update.exe로 다시 시도할 수 있다.

GitHub 공개 API와 알려진 저장소의 정확한 자산 주소만 사용하고 파일 크기 및 GitHub 자산 SHA-256과 설치 파일의 버전을 검사한다. 이는 코드 서명이나 GitHub 계정 침해 방어를 대신하지 않는다. 다운로드는 최대 180 초, 설치 완료 대기는 최대 600 초로 제한한다. 상태는 업데이트 저장 폴더의 state.json과 pending.json에 기록한다. 다운로드와 적용에는 각각 잠금을 사용하며 설치 중인 경우 두 번째 실행이 겹치지 않도록 한다.

별도 서비스를 등록하거나 Windows 자동 시작을 추가하지 않는다. 기존 시작 스크립트와 검증한 통합 설치본을 재사용하는 방식을 선택했다. 상주 서비스와 차등 파일 패치는 시험하지 않았다. Update.exe는 작은 다운로드 실행기이며 약 65 MB의 통합 설치본을 추가로 받는다. 자동 업데이트로 기존 통합 Spotify를 재사용하는 경우 Spotify 본체를 다시 받지 않는다. 업데이트 상태를 포함한 개인 데이터는 프로그램 제거 후에도 남는다.
