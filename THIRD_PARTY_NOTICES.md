# 외부 구성 요소

소스 압축은 아래 실행 파일과 사전을 포함하지 않는다. 버전 0.5.0 EXE 설치본은 아래 구성 요소를 포함하며 원본 고지와 대응 소스를 함께 제공한다. 설치 폴더의 licenses, vendor, runtime과 third_party_sources에서 확인할 수 있다.

| 구성 요소 | 버전 | 설치된 배포 정보의 라이선스 | 용도 |
| --- | --- | --- | --- |
| PyKakasi | 2.3.0 | GPL-3.0-or-later | 일본어 읽기 사전 |
| jaconv | 0.5.0 | MIT | 일본어 문자 변환 |
| Deprecated | 3.0.0 | MIT | PyKakasi 의존성 |
| wrapt | 2.5.1 | BSD-2-Clause | Deprecated 의존성 |

PyKakasi의 원본 주소는 설치된 배포 정보에 기록된 [codeberg.org/miurahr/pykakasi](https://codeberg.org/miurahr/pykakasi)이다. 현재 개발용 `vendor/`에는 원본 배포 패키지의 고지가 있으나 이 폴더는 Git과 소스 초안에서 제외한다.

Spotify 실행 파일은 배포하지 않는다. EXE 설치본에는 Spicetify 2.46.3과 ivLyrics 7.0.16 및 각각의 LGPL-2.1 원문과 전체 대응 소스 압축을 포함한다. ivLyrics의 등록 인터페이스에 발음 제공자를 연결하고 공개한 LyricsPlus 파서를 사용한다. Spotify 계정 정보와 인증 토큰을 소스나 배포물에 넣지 않는다.

한음과 나무위키 등에서 읽은 가사는 개인 PC에서 대조하고 캐시한다. 가사 전체와 개인 캐시는 배포물에 포함하지 않는다. 한음의 이용 조건에는 앞선 조사에서 확인하지 못한 항목이 남아 있으며 정식 배포 전에 확인해야 한다.

Copyright (C) 2026 ForUltraplayer. 이 프로젝트의 독자 소스는 루트 LICENSE의 GPL-3.0-or-later로 배포한다. android/patches의 Myspoti 파생 수정은 해당 원본의 GPL-3.0 고지를 유지하며 android/LICENSE를 함께 제공한다.

ivLyrics의 LyricsPlus 제공자와 결과 계약을 참조하는 호환 어댑터를 포함하며 해당 프로젝트의 LGPL-2.1 원문을 licenses/ivLyrics-LGPL-2.1.txt에 보존한다. 원본 ivLyrics 전체와 라이브러리 실행 파일은 소스 압축에 포함하지 않으며 EXE 설치본에는 포함한다.

안드로이드에서 추가한 Kuromoji 0.9.0은 Apache-2.0이며 IPADIC 사전의 원본 고지에는 NAIST 등의 저작권·면책 조건이 포함된다. 캐시된 원본 JAR의 LICENSE와 NOTICE를 licenses/Kuromoji-Apache-2.0.txt 및 licenses/Kuromoji-IPADIC-NOTICE.md에 보존한다. jsoup은 MIT이며 Android 원본과 함께 빌드되는 외부 의존성의 고지는 APK 패키징에서도 유지한다.

## EXE 설치본의 추가 구성 요소

| 구성 요소 | 버전 | 라이선스 | 제공 방식 |
| --- | --- | --- | --- |
| CPython 내장 배포 | 3.13.17 x64 | PSF 및 포함된 제삼자 고지 | runtime/LICENSE.txt와 licenses/Python-LICENSE.txt |
| Spicetify CLI | 2.46.3 | LGPL-2.1 | 원본 바이너리와 라이선스 및 전체 대응 소스 압축 |
| ivLyrics PC | 7.0.16 | LGPL-2.1 | 전체 원본 소스와 대응 소스 압축 |
| NSIS 설치 도구와 기본 zlib 압축 | 3.13 | zlib/libpng 등 원본 COPYING | licenses/NSIS-COPYING.txt |
| SpotX 패치 | 3cfbdfd1fac3dc755155e434116e28b51acfec07 | MIT, Copyright (c) 2021-2026 amd64fox | third_party/spotx/LICENSE와 원본 전체 및 분리 패치 소스 |

PyKakasi, jaconv, Deprecated와 wrapt의 원본 소스 배포 압축도 third_party_sources에 제공한다. 각 설치 패키지의 dist-info 고지를 유지한다. 빌드에 사용한 공개 URL과 SHA-256은 licenses/distribution-inputs.json에 보존한다. 안드로이드의 현재 대응 소스와 APK 배포는 https://github.com/ForUltraplayer/SPOTIFY_ANDROID 에서 관리한다.

버전 0.6.0은 Spotify 본체를 설치 중 공식 서버에서 내려받아 검증한 다음 로컬에서 패치한다. Spotify 바이너리는 소스 압축과 Setup.exe에 포함하지 않는다. SpotX 원본은 [기준 커밋](https://github.com/SpotX-Official/SpotX/tree/3cfbdfd1fac3dc755155e434116e28b51acfec07)에 고정하며 원본의 전체 설치 스크립트를 실행하지 않는다. 패치 전용 분리 방식과 외부 서비스 조건의 검토 한계는 docs/SPOTX_INTEGRATION.md에 기록한다.

## 0.7.0 로컬 설치 후보의 기존 데스크톱 오버레이

기존 Tauri 기반 [ivLyrics 데스크톱 오버레이](https://github.com/ivLis-Studio/ivLyrics-overlay)를 자체 WPF 시제품으로 교체하지 않고 `desktop-overlay` 폴더에 포함한다. 원래 앱 식별자와 설정 경로를 유지하며 별도 설치본과 사용자 설정을 덮어쓰지 않는다. 실제 실행 파일과 소스 압축의 해시 및 원본 커밋은 `desktop-overlay/receipt.json`에 기록한다. 전체 고정 소스와 로컬 변경 및 파일별 해시는 `third_party_sources`에 포함한다.

이 오버레이의 원본 저장소에서는 재배포 라이선스 선언을 확인하지 못했다. 원래 ivLyrics의 LGPL-2.1 고지를 별도 네이티브 앱의 허락으로 확장하지 않는다. 이번 구성은 공개 배포 전 로컬 검증 후보이며, 작성자의 허락이나 라이선스 근거가 확인되기 전 공개 배포 가능으로 표시하지 않는다. 빌더는 이 구성의 산출물을 프로젝트 `work` 아래에서만 만들 수 있게 제한한다.

기존 오버레이의 UI와 원본 업데이터를 유지한다. 오버레이 자체에서 원본 업데이트를 수동 적용하면 로컬 재생 조작과 외형 수정이 원본으로 바뀔 수 있다. WebView2 Runtime은 기존 Tauri 앱의 실행 요구 사항이다. 오버레이 시작 도구는 새 부팅 자동 시작이나 실패 후 자동 재시작을 등록하지 않는다.

## 0.7.2 이후 데스크톱 오버레이 분리

0.7.2부터 설치 파일과 소스 압축은 데스크톱 오버레이 실행 파일과 그 소스를 포함하지 않는다. 0.7.0에서 업데이트하면 설치 폴더의 `desktop-overlay` 사본은 소유 파일 목록에 따라 제거된다. 재생 버튼을 추가한 수정본은 별도 [포크 저장소](https://github.com/ForUltraplayer/ivLyrics-overlay)의 `hangul-playback-controls` 브랜치와 릴리스로 배포한다. 원본 저장소의 라이선스 미표기 상태는 바뀌지 않았으며, 포크 릴리스에도 같은 사실과 요청 시 배포를 내린다는 안내를 적었다. 시작 스크립트는 사용자가 `%LOCALAPPDATA%\lyrics-plus-overlay\`에 둔 오버레이가 있을 때만 함께 실행한다.
