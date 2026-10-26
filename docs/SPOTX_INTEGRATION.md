# SpotX 통합 설치

## 구성과 변경 범위

버전 0.6.0은 선택한 설치 폴더에 Spotify 1.3.6.1921을 구성하고 SpotX를 먼저 적용한 다음 Spicetify 2.46.3과 ivLyrics 7.0.16 및 한글 가사 확장을 적용한다. 실행 환경은 기존 내장 Python을 사용한다. 일반 Spotify와 SpotX를 미리 설치할 필요가 없다.

공식 Spotify 설치 파일은 EXE에 넣거나 GitHub에 재배포하지 않는다. 설치 시 [공식 x64 배포 주소](https://download.scdn.co/SpotifyFullSetupX64.exe)에서 내려받는다. 크기 157180192 바이트, SHA-256 E5CA46AD79DE202C8DEAF888C26F2A608B9E042142279E0690D589D80640591D와 Spotify AB의 유효한 Authenticode 서명을 모두 확인한 뒤 파일 추출 모드로 실행한다. 이 해시는 [WinGet의 해당 버전 입력](https://github.com/microsoft/winget-pkgs/blob/master/manifests/s/Spotify/Spotify/1.3.6.1921.g7086c071a617/Spotify.Spotify.installer.yaml)과 실제 다운로드에서 일치했다. 공식 주소의 파일이 다른 버전으로 교체되면 실행을 중단하며 새 통합 설치본이 필요하다.

SpotX 기준은 커밋 3cfbdfd1fac3dc755155e434116e28b51acfec07이다. MIT 원문과 원본 전체 스크립트를 third_party/spotx에 보존한다. scripts/build_spotx_adapter.py는 원본 해시를 검증하고 파일 패치 함수와 호출 부분만 분리한다. 원본 설치 스크립트 전체를 실행하지 않는다. 백신 예외 추가, Store판 제거, 전역 프로세스 종료, 바로가기 변경과 자동 시작 설정은 분리한 코드에 포함하지 않는다. 추가 리소스의 원격 실행도 없다.

통합본의 Spotify 자동 업데이트 차단은 SpotX 기본 동작으로 적용한다. 별도의 부팅 자동 시작과 서비스 및 실패 후 자동 재시작은 등록하지 않는다. 기존 Spotify의 자동 시작 설정은 보존한다. 통합본을 사용하려면 한글 가사 바로가기를 사용한다.

## 기존 설치 보존과 제거

기존 Spotify 실행 파일과 공유 Spicetify 설정을 덮어쓰지 않는다. 자체 Spotify는 설치 폴더의 Spotify에, Spicetify 설정과 백업은 spicetify-config에 둔다. 기존 config-xpui.ini와 Extensions, CustomApps, Themes는 처음 설치할 때 복사한다. 기존 설정을 복사한 뒤 그쪽에서 추가한 변경은 자동 동기화하지 않는다.

이미 Spicetify를 적용한 폴더에 SpotX를 바로 적용하면 원본 SPA 파일이 없어 중단된다. [SpotX FAQ](https://telegra.ph/SpotX-FAQ-09-19#Can-I-use-SpotX-and-Spicetify-together?)도 SpotX를 먼저 적용하도록 안내하며 병용을 권장하지는 않는다. 이 통합본은 깨끗한 공식 파일에서 시작하고 별도 Spicetify 백업을 만들어 적용 순서와 백업 혼용을 해결한다. 한글 발음 확장 연동이 병용 목적이다.

Spotify는 단일 실행 인스턴스를 사용하므로 기존 클라이언트가 실행 중이면 새 실행이 기존 창으로 전달될 수 있다. start.ps1은 설치 기록과 기본 경로로 확인한 이전 Spotify만 종료한 뒤 통합본을 연다. 다른 경로의 Spotify가 발견되면 사용자가 직접 종료하도록 오류를 표시한다.

재적용 전에는 해당 시도의 자체 Spicetify 설정과 Spotify Apps 폴더를 보존하고 실패하면 복원한다. 최초 다운로드와 패치는 임시 하위 폴더에서 수행한다. 진단은 install.log와 spotx-install.log에 남긴다. 설치 프로그램 재실행 시 검증된 같은 버전의 통합 클라이언트는 재다운로드하지 않는다.

제거하면 선택한 설치 폴더의 통합 Spotify와 Spicetify 및 실행 환경이 함께 제거된다. 이전 Spotify 설치와 사용자 프로필 및 발음 캐시는 남긴다. 버전 0.5.x에서 같은 폴더로 업데이트한 경우 기존 설치 기록을 legacy-install-state.json으로 보존하며 제거 시 이전 확장 복원 절차도 실행한다.

## 설계 대안

| 대안 | 검토 결과 |
| --- | --- |
| SpotX 원본 자동 설치 전체 실행 | 소스 확인에서 Store 제거, Defender 예외, 전역 프로세스 종료와 사용자 설정 변경을 확인해 채택하지 않음 |
| 사용 중인 Spotify를 직접 교체 | 기존 Spicetify 백업과 파일을 함께 복구해야 하므로 채택하지 않음 |
| 별도 관리 폴더에서 공식 파일에 순차 적용 | 기존 설치 파일을 보존하고 독립 백업 사용 가능, 격리 설치 시험 통과 |
| Spotify 실행 파일을 EXE에 포함 | 재배포 권한을 확인하지 못했으므로 채택하지 않음 |

## 검증과 한계

2026년 10월 26일 Windows 11 x64에서 Spotify가 없는 별도 APPDATA 프로필과 한글 및 공백 경로로 설치 훅을 실행했다. 검증한 공식 설치 파일에서 추출하고 SpotX 바이너리 패치와 UI 패치를 적용했다. 이어 Spicetify와 ivLyrics 및 발음 확장이 같은 클라이언트에 존재하는지 확인했다. 이 시험은 다른 물리 PC에서 EXE를 설치한 검증과 구별한다.

Python 없는 PATH에서 기존 통합본의 재적용도 통과했다. 기존 발음 기능의 Python 43 개와 JavaScript 29 개, 이전 설치 보호 검사 8 개가 통과했으며 통합 설치의 경로 보호, 잘못된 크기와 해시 거부, 패치 코드의 외부 작업 제외 및 실제 서명 입력 검사를 12 개 추가했다.

후속으로 Spotify가 없는 별도 프로필과 Windows System32만 남긴 PATH에서 실제 EXE의 새 설치와 제거도 각각 종료 코드 0을 확인했다. 현재 사용 중인 설치 폴더의 EXE 업데이트와 새 경로의 실행, ivLyrics의 원문 및 한글 발음 표시도 확인했다. 설치 직후 기존 파일과 설정 및 캐시 7 개가 이전 해시와 일치했다. 새 경로의 Windows 네트워크 허용 요청은 사용자가 직접 처리했다. 검증 중 발생했던 PowerShell 모듈 로드 오류와 복구 시험은 docs/VERIFICATION.md에 구분해 기록한다.

일반 Windows 10과 Windows ARM64, Store판 공존, 보안 제품별 허용 여부, 다른 물리 PC는 미검증이다. 실제 광고 차단은 바이너리 변경 검증과 구별하며 광고 수신 전후의 통제 재생 검증은 수행하지 않았다. 계정별 서버 기능과 고음질 및 다운로드를 보장하지 않는다. 전체 재생 목록 검사는 사용자의 중단 요청을 유지한다.

## 라이선스와 서비스 조건

SpotX MIT는 포함한 코드의 재배포와 수정을 허용하며 원문 고지를 유지한다. 이것이 Spotify의 허가나 서비스 약관 준수를 보장하지는 않는다. [Spotify 이용 약관](https://www.spotify.com/us/legal/end-user-agreement/)은 서비스와 콘텐츠 재배포를 제한한다. 이 배포물에는 Spotify 실행 파일과 개인 가사 데이터베이스를 넣지 않는다. 자체 구성 요소의 라이선스 검토와 외부 서비스 이용 조건은 구별한다.


## 0.6.3에서 정정한 백업 분리

이 문서에서 기존 구성의 백업까지 독립적이라고 설명한 부분은 정정한다. 기존 코드는 SPICETIFY_CONFIG로 설정을 분리했으나 Spicetify의 GetStateFolder는 별도의 SPICETIFY_STATE가 없으면 공유 APPDATA를 사용했다. 0.6.3 개발 수정본은 설치 폴더 안에 전처리 상태를 분리하고 이전 백업을 그대로 신뢰하지 않고 검증한 원본에서 다시 생성한다. 공유 백업 복사는 자료가 어느 클라이언트와 연결된 것인지 입증할 수 없어 채택하지 않았다. 기존 바이너리를 교체하지 않고 UI 원본만 다시 준비하며 첫 상태 전환에 추가 다운로드가 필요하다. 실제 검증 결과는 VERIFICATION.md의 후속 기록을 따른다.
