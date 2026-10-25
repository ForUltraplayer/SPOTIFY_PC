# 외부 구성 요소

현재 소스 초안은 다음 라이브러리의 실행 파일과 사전을 포함하지 않는다. 개발 환경의 설치된 배포 정보에서 확인한 버전과 라이선스를 기록한다. 실제로 포함하는 배포물을 만들 때 원본 고지와 필요한 소스 제공 구성을 함께 확인해야 한다.

| 구성 요소 | 버전 | 설치된 배포 정보의 라이선스 | 용도 |
| --- | --- | --- | --- |
| PyKakasi | 2.3.0 | GPL-3.0-or-later | 일본어 읽기 사전 |
| jaconv | 0.5.0 | MIT | 일본어 문자 변환 |
| Deprecated | 3.0.0 | MIT | PyKakasi 의존성 |
| wrapt | 2.5.1 | BSD-2-Clause | Deprecated 의존성 |

PyKakasi의 원본 주소는 설치된 배포 정보에 기록된 [codeberg.org/miurahr/pykakasi](https://codeberg.org/miurahr/pykakasi)이다. 현재 개발용 `vendor/`에는 원본 배포 패키지의 고지가 있으나 이 폴더는 Git과 소스 초안에서 제외한다.

Spotify, Spicetify와 ivLyrics는 별도 설치 전제이며 소스 초안에 포함하지 않는다. ivLyrics의 등록 인터페이스에 발음 제공자를 연결하고 공개한 LyricsPlus 파서를 사용한다. Spotify 계정 정보와 인증 토큰을 소스나 배포물에 넣지 않는다.

한음과 나무위키 등에서 읽은 가사는 개인 PC에서 대조하고 캐시한다. 가사 전체와 개인 캐시는 배포물에 포함하지 않는다. 한음의 이용 조건에는 앞선 조사에서 확인하지 못한 항목이 남아 있으며 정식 배포 전에 확인해야 한다.

Copyright (C) 2026 ForUltraplayer. 이 프로젝트의 독자 소스는 루트 LICENSE의 GPL-3.0-or-later로 배포한다. android/patches의 Myspoti 파생 수정은 해당 원본의 GPL-3.0 고지를 유지하며 android/LICENSE를 함께 제공한다.

ivLyrics의 LyricsPlus 제공자와 결과 계약을 참조하는 호환 어댑터를 포함하며 해당 프로젝트의 LGPL-2.1 원문을 licenses/ivLyrics-LGPL-2.1.txt에 보존한다. 원본 ivLyrics 전체와 라이브러리 실행 파일은 소스 묶음에 포함하지 않는다.

안드로이드에서 추가한 Kuromoji 0.9.0은 Apache-2.0이며 IPADIC 사전의 원본 고지에는 NAIST 등의 저작권·면책 조건이 포함된다. 캐시된 원본 JAR의 LICENSE와 NOTICE를 licenses/Kuromoji-Apache-2.0.txt 및 licenses/Kuromoji-IPADIC-NOTICE.md에 보존한다. jsoup은 MIT이며 Android 원본과 함께 빌드되는 외부 의존성의 고지는 APK 패키징에서도 유지한다.
