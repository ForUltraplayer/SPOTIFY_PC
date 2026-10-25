# 라이선스 검토

2026년 10월 26일에 소스 공개 범위를 검토했다. 검토 대상은 이 저장소의 소스와 Android 수정 패치다. 개인 캐시, 가사 원문 묶음, 인증 정보, 서명 키와 외부 런타임 바이너리는 공개 대상에 포함하지 않는다.

## 공개 판단

자체 PC 소스는 GPL-3.0-or-later를 적용하고 LICENSE 원문을 포함한다. 확인한 외부 소프트웨어 라이선스에서 이 소스 공개를 막는 조건은 찾지 못했다. 따라서 개인 GitHub 계정 ForUltraplayer에 공개 저장소로 올린다. 공개 소스와 다른 PC에 설치 가능한 완성 배포물은 구분한다.

Android는 명시적 GPL-3.0을 제공하는 Myspoti의 특정 커밋에 적용할 패치로 공개한다. 원본 저작권과 고지는 유지하고 기준 커밋을 android/upstream.json에 고정한다. 전체 기반 소스는 해당 원본 저장소에서 받을 수 있다. 설치용 APK는 휴대폰 검증 전까지 로컬 결과물로 관리한다.

ivLyrics Android는 조회한 저장소의 라이선스 메타데이터가 없고 명시적 배포 라이선스를 확인하지 못했다. 그 프로젝트의 소스나 APK는 이 공개 저장소에 넣지 않는다. 비공개 저장소로 바꾸는 행위가 외부 소스의 재배포 권한을 새로 만들어 주는 것은 아니다.

## 확인 자료와 적용

| 구성 요소 | 확인한 라이선스 | 이 저장소의 처리 | 근거 |
| --- | --- | --- | --- |
| 자체 PC 소스 | GPL-3.0-or-later 적용 | 원본 LICENSE 포함 | 루트 LICENSE와 THIRD_PARTY_NOTICES.md |
| PyKakasi 2.3.0과 사전 | GPL-3.0-or-later | 소스 초안에는 실행 파일과 사전을 넣지 않음 | [PyPI의 버전별 고지](https://pypi.org/project/pykakasi/2.3.0/) |
| jaconv, Deprecated | MIT | 버전 고정, 개발 vendor는 공개 제외 | 설치된 배포 정보의 METADATA와 LICENSE |
| wrapt | BSD-2-Clause | 버전 고정, 개발 vendor는 공개 제외 | 설치된 배포 정보의 METADATA와 LICENSE |
| ivLyrics PC | LGPL-2.1 | 등록 인터페이스와 공개 파서 사용, 호환 어댑터의 원본 참고를 표기하고 라이선스 보존 | [원본 LICENSE](https://github.com/ivLis-Studio/ivLyrics/blob/main/LICENSE) |
| Myspoti | GPL-3.0 | 원본 고지 유지, 기준 커밋과 수정 패치 및 LICENSE 제공 | [원본 LICENSE](https://github.com/kota-zo/myspoti/blob/main/LICENSE) |
| Kuromoji 0.9.0 | Apache-2.0 | JAR의 원본 LICENSE 보존 | [원본 라이선스](https://github.com/atilika/kuromoji/blob/master/LICENSE.md) |
| IPADIC 사전 | NAIST·ICOT 고지 | 원본 JAR의 NOTICE 보존, APK에서도 고지 유지 여부 확인 | licenses/Kuromoji-IPADIC-NOTICE.md |
| jsoup | MIT | 원본 고지 유지 | [공식 라이선스](https://jsoup.org/license) |
| ivLyrics Android | 명시적 배포 라이선스 미확인 | 소스와 APK 공개 대상에서 제외 | [확인한 저장소](https://github.com/ivLis-Studio/ivLyrics-Android) |

## 검토 범위의 한계

이 검토는 소프트웨어 소스와 추가 의존성의 고지를 기준으로 한다. 외부 가사 사이트의 서비스 이용 조건, Spotify 계정 조건과 상표 사용 권한을 소프트웨어 라이선스로 대신 판단하지 않는다. 웹에서 열람한 가사를 재배포 허가를 받은 데이터로 간주하지 않으며 이 저장소에는 가사 데이터베이스를 넣지 않는다.

Python과 사전 등을 포함한 독립 실행 설치 프로그램을 만들 때는 포함하는 실제 파일에 맞춰 라이선스, 원본 고지와 대응 소스를 다시 구성한다. 현재 공개 상태는 그 바이너리 재배포 검증이 끝났다는 의미가 아니다.
