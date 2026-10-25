# 실행과 중지

| 표기 | 의미 |
| --- | --- |
| 로컬 도우미 | `ivLyricsHangul` |
| 발음 제공자 | `web-hangul` |

프로젝트 소스와 실제 실행 파일은 별도 위치에 있다. 소스 폴더를 이동해도 현재 설치된 도우미의 실행 경로는 바뀌지 않는다.

| 항목 | 위치 |
| --- | --- |
| 도우미와 시작·중지 스크립트 | `%LOCALAPPDATA%\ivLyricsHangul` |
| 개인 자료 캐시와 별칭 | 같은 폴더의 `cache.json`, `aliases.json` |
| 설치 PC의 Python 경로 | 같은 폴더의 `python-path.txt` |
| 마지막 시작 오류 | 같은 폴더의 `start-error.txt` |
| 제공자 확장 | Spicetify 사용자 설정 폴더의 `Extensions\hangul-lyrics.js` |
| 도우미 상태 | `http://127.0.0.1:19643/health` |

바탕화면 바로가기는 도우미를 준비한 뒤 Spotify를 실행한다. 일반 Spotify 바로가기는 도우미를 시작하지 않는다. 같은 한글 가사 바로가기를 여러 번 실행해도 정상 응답하는 기존 도우미를 재사용한다.

도우미는 같은 PC의 루프백 주소에서만 요청을 받으며 일본어 사전을 사용한 뒤 메모리에 유지한다. GPU, 음성 장치나 대형 추론 모델을 사용하지 않는다. 별도 프로세스는 Spotify 안의 직접 요청과 기본 프록시 경로에서 나무위키 본문을 읽지 못했던 검증 결과를 바탕으로 추가했다. 다른 외부 프록시로 교체하는 대안은 시험하지 않았다.

서비스, 부팅 자동 시작과 실패 후 재시작은 등록하지 않는다. Spotify 프로세스가 사라진 뒤 약 30~35 초가 지나면 도우미가 종료되도록 구현했다. 시작 시 Spotify를 기다리는 유예 시간은 120 초다. 현재 실행 상태와 자동 시작 설정은 별개다.

도우미만 중지하려면 다음 명령을 사용한다. 상태 응답의 프로세스와 설치된 스크립트의 경로가 일치할 때만 종료한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\ivLyricsHangul\stop.ps1"
```

발음 기능 연결을 제거하려면 도우미를 중지한 뒤 `spicetify config extensions hangul-lyrics.js-`와 `spicetify apply`를 실행한다. 초기 설정의 다른 발음 제공자와 화면 모드는 자동 복원되지 않으므로 ivLyrics 설정에서 원하는 표시를 다시 선택한다. 개인 캐시를 삭제할 필요는 없다.

검증용 Spotify 디버깅 포트는 상시 사용하지 않는다. 진단을 위해 열었다면 작업 후 진단 옵션 없이 Spotify를 다시 실행하고 포트가 닫혔는지 확인한다. 이번 프로젝트의 개인 실행 이력과 프로세스 번호는 배포 문서 대신 Git에서 제외한 `work/`에 기록한다.
