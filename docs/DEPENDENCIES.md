# 구성 요소 유지 관리

## 기준과 저장 위치

구성 요소 목록(components.json)은 Spotify, SpotX, Spicetify, ivLyrics, 내장 Python과 NSIS의 선택 버전 및 다운로드 주소, 크기와 SHA-256을 관리한다. Python 패키지 버전은 기존 requirements.txt에 고정하고 대응 배포 파일의 해시는 구성 요소 목록에서 관리한다. release.json은 자체 앱 버전과 검증 환경만 관리한다. work/downloads/distribution-inputs.json은 다운로드 영수증이며 빌드 기준으로 사용하지 않는다.

## 원본 감지와 반영

```powershell
python scripts/upstream_updates.py check
python scripts/upstream_updates.py stage --component spicetify --tag v2.46.4
python scripts/check_compatibility.py --manifest work/candidate-components.json --report work/compatibility-candidate.json
python scripts/upstream_updates.py promote
python scripts/check_compatibility.py
python scripts/prepare_release.py
python scripts/build_installer.py
```

ivLyrics 후보는 구성 요소 이름을 ivlyrics로 지정한다. 이미 선택된 버전의 재등록은 거부한다. 후보 파일은 work에 따로 저장하며 운영 중인 Spotify를 바꾸지 않는다. 후보 검사 보고서는 후보 목록과 기존 목록 및 검사한 소스의 해시에 연결한다. 검사 실패나 파일 변경이 있으면 반영을 거부하고, 반영 후에는 새 목록으로 다시 검사해야 설치본을 빌드할 수 있다.

검사는 실제 ivLyrics 소스의 구문과 제공자 등록 및 가사 파서, 캐시 연결 함수, Spicetify 실행 파일 버전, SpotX 어댑터 무결성과 기존 기능 및 설치 보호 회귀를 포함한다. 실제 Spotify에서 로그인과 재생, 가사 화면 및 광고 동작까지 보장하는 검사는 아니다. 보고서의 runtime_playback은 별도 확인 전까지 pending으로 유지한다. 공개 배포 전에 새 설치와 기존 설치 업데이트 및 실패 복원, 실제 가사 화면을 확인한다.

SpotX는 릴리스 태그보다 최신 기본 브랜치 커밋을 확인한다. 새 커밋은 어댑터 추출 경계와 허용 동작을 검토한 뒤 원본 파일과 목록을 함께 변경하고 build_spotx_adapter.py로 재생성한다. Spotify는 공식 주소의 파일 크기 변경을 감지한다. 같은 크기라고 같은 버전이나 해시로 확정하지 않는다. 새 Spotify를 채택할 때는 유효한 배포 서명, 전체 SHA-256, SpotX와 Spicetify 적용을 확인한 뒤 목록을 수정한다. 두 구성 요소는 자동 후보 반영 대상에서 제외한다.

## GitHub 검사

.github/workflows/dependencies.yml은 매일 UTC 02:27에 원본 상태를 확인하고 현재 구성의 호환성 검사를 실행한다. main 변경과 PR에서도 검사하며 수동 실행에서 Spicetify 또는 ivLyrics의 정확한 태그를 후보로 지정할 수 있다. 결과와 후보 목록은 component-inspection 아티팩트와 작업 요약에 남는다. 조회 실패는 최신 상태로 처리하지 않고 실패로 보고한다. 이 워크플로는 저장소 내용과 실행 중인 사용자 앱을 바꾸지 않는다. 초안 릴리스는 아래 자동 초안 워크플로가 따로 만든다.

예약 실행과 수동 실행에서는 scripts/report_upstream.py가 바뀐 구성 요소마다 `upstream` 라벨의 이슈를 연다. 본문에는 현재와 새 버전, 원본과 비교 주소, 커밋 수와 바뀐 파일 수, 원본 릴리스 노트(6000 자까지), 최신 커밋 제목 60 개와 바뀐 파일 100 개, 반영 방식(Spicetify와 ivLyrics는 자동 초안, 나머지는 요청 시 직접 반영)을 적는다. 원본 글은 코드 블록에 넣어 원본의 `@이름`이 다른 사람에게 알림을 보내거나 `#번호`가 이 저장소의 이슈로 연결되지 않게 한다. 구성 요소마다 열린 이슈는 하나만 둔다. 더 새로운 버전이 나오면 열린 이슈의 제목과 본문을 바꾸고 댓글을 달아 알림이 가게 한다. 같은 버전의 이슈가 이미 있으면 닫혀 있어도 다시 만들지 않으므로, 확인한 이슈는 닫으면 된다. 저장소 소유자는 기본적으로 저장소의 이슈와 댓글 알림을 받는다.

검사는 GitHub의 일시적인 Windows 실행기에서 최대 20 분 동안 실행한다. PC에 서비스나 부팅 자동 시작을 추가하지 않는다. 반복 검사를 중지하려면 저장소 Actions에서 Component maintenance 워크플로를 비활성화하거나 schedule 항목을 제거한다. 이 구성은 저장소에 푸시되고 GitHub에서 실행 결과를 확인해야 활성화 여부가 검증된다.

## 자동 초안 릴리스

.github/workflows/draft-release.yml은 매일 UTC 02:57에 scripts/auto_draft.py를 실행한다. Spicetify나 ivLyrics에 더 새로운 정식 릴리스가 있으면 위 절차(stage, 후보 검사, promote)를 구성 요소마다 거친다. 이어서 버전의 마지막 자리를 하나 올리고(bridge.py, hangul-lyrics.js, release.json, README 두 개의 현재 버전 줄과 변경 내역 한 줄) 전체 호환성 검사, 원본 묶음, 설치본 빌드를 실행한다. 결과는 `auto/v버전` 브랜치의 커밋 하나와 같은 이름 태그의 초안 릴리스(Setup.exe 첨부)로 올린다. 릴리스 본문은 변경 사항과, 직전 공개 릴리스의 설치와 업데이트 및 알려진 문제 절을 새 Setup 이름으로 바꿔 쓴다.

초안은 저장소에 쓰기 권한이 있는 사람에게만 보이고 GitHub API의 공개 조회에도 나오지 않으므로 사용자의 자동 업데이트가 받지 않는다. 소유자는 초안 페이지에서 Setup.exe를 받아 설치와 재생을 확인한 뒤 「Publish release」를 누른다. 시험판 표시는 켜지 않는다(0.7.0 이후 업데이터가 건너뛴다). 공개하면 .github/workflows/release-published.yml이 main이 그 사이 바뀌지 않았을 때 main을 태그 커밋으로 앞당기고 브랜치를 지운다. main이 바뀌었으면 병합 PR을 연다. 문제가 있으면 초안과 `auto/` 브랜치를 지우면 된다.

같은 태그의 릴리스나 초안이 이미 있으면 아무것도 하지 않는다. 그래서 공개하지 않은 초안이 있는 동안 나온 더 새로운 원본 릴리스는 그 초안을 공개하거나 지운 다음 날 반영된다. 원본 코드가 바뀌어 ivLyrics 패치 위치를 찾지 못하거나 검사가 실패하면 작업이 실패로 끝나고 초안은 만들지 않는다. GitHub는 예약 워크플로의 실패를 그 cron 설정을 마지막으로 바꾼 계정에 알린다. SpotX, Node, Spotify는 stage 단계가 없어 자동 초안 대상이 아니며 지금처럼 직접 반영한다.

이 작업은 저장소 쓰기 권한(contents: write)을 쓰며 GitHub의 일시적인 Windows 실행기에서 최대 60 분 동안 실행한다. 설치 시험과 실제 재생 확인은 실행기에서 하지 않는다. Actions의 수동 실행에서 dry_run을 켜면 빌드까지만 하고 브랜치와 초안을 만들지 않는다. 원본 후보가 없어도 현재 구성으로 버전을 올려 빌드하므로 실행기에서 빌드 경로를 시험할 수 있다. 중지하려면 Automatic draft release 워크플로를 비활성화한다.

## ivLyrics 교체와 복원

통합 설치는 동봉한 ivLyrics 전체 파일의 해시를 확인하고 임시 폴더에 준비한 뒤 앱 코드 폴더를 교체한다. 이전 버전에만 있던 파일은 새 코드에 섞지 않는다. 변경 전 코드는 설치 폴더의 backup/ivlyrics-식별자에 남긴다. 동일한 코드가 이미 있으면 교체하지 않는다. Spicetify 적용이나 통합 확인이 실패하면 이번 시도의 ivLyrics와 설정 및 Spotify Apps 백업을 복원한다.

브라우저 저장소, Spotify 프로필, 발음 cache.json과 aliases.json은 교체 대상이 아니다. 기존 코드 폴더 안에 직접 넣은 파일은 백업에 보존되며 새 코드에 자동 합치지 않는다. 백업은 로컬 디스크를 사용하며 누적될 수 있으므로 정상 동작 확인 후 필요 없는 이전 코드 백업을 정리한다. 기존 0.5.x 연결 제거용 integrate.ps1은 통합 클라이언트 교체 경로와 구분해 유지한다.

설치 대상 코드와 동봉한 원본 폴더 모두 이전 파일이 남을 수 있으므로 새 파일 목록에 있는 항목만 복사한다. 원본 폴더의 불필요한 파일은 새 코드에 포함하지 않는다. PC 원본 감지 대상은 Spicetify와 ivLyrics의 정식 릴리스, SpotX의 기본 브랜치 커밋 및 공식 Spotify 다운로드의 크기 변경이다. Python과 NSIS 및 Python 라이브러리는 고정한 입력을 유지하며 별도 검토 후 목록을 갱신한다. 후보 도구는 이전 버전과 같은 버전의 반영을 거부한다.


0.6.2의 Spicetify 버전 전환 실패를 계기로 0.6.3부터 전처리 상태도 설치 폴더에 분리한다. CLI 버전 변경 시 기존 전처리를 재사용하지 않고 원본 백업에서 다시 만든다. 이전 상태를 처음 분리할 때는 공유 백업의 신원을 가정하지 않고 검증한 공식 설치본에서 SpotX UI 원본을 준비한다. 자세한 자원 수명과 복원 및 오류 안내는 OPERATIONS.md에 기록한다. 0.6.2는 비공개 초안으로 유지하고 0.6.3은 구버전 업데이트 검증과 사용자 승인 후 공개 베타로 배포한다.
