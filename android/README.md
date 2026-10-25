# Myspoti 한글 안드로이드 패치

현재 개발과 배포는 [안드로이드 전용 저장소](https://github.com/ForUltraplayer/SPOTIFY_ANDROID)에서 진행한다. 이 폴더는 저장소 분리 전의 패치 이력이다.

기존 Myspoti 한글의 재생과 한글 가사를 한 앱에서 사용하는 방식을 유지한다. 이번 버전은 2.0.1-hangul.3이며 applicationId는 app.myspoti.hangul, versionCode는 1085다. 개발 계획과 휴대폰에서 확인할 항목은 [계획](PLAN.md)에 기록한다.

## 구현

한음·나무위키·티스토리의 기존 발음을 일본어 원문과 대조한다. 커버 제목의 feat 표기, 반복 횟수 표기, 일본어·영어 원제가 본문에만 있고 한글 제목으로 등록된 문서, 동명 문서의 한국어 제목 링크를 처리한다. 대조를 통과한 자료 주소를 곡명과 가수별로 최대 500 개, 30 일 동안 기억하며 다음 입력도 다시 대조한다.

가사 메뉴의 누락 줄에 기기 내부 자동 발음 사용은 기본적으로 꺼져 있다. 켜면 기존 발음이 없는 줄만 사전과 가나 변환 규칙으로 보완한다. 기존 발음 캐시에 자동 생성 결과를 덮어쓰지 않는다. 자동 발음 줄 수와 주의 문구는 가사 화면 안에 표시하고 별도 앱 알림은 추가하지 않는다.

가사 화면의 제목을 길게 누르거나 메뉴의 곡 제목 복사를 선택하면 전체 제목을 복사한다. Android 운영체제 자체의 클립보드 표시는 OS 정책을 따른다.

## 재현 빌드

Git, Android SDK 37, JDK 17과 Gradle이 사용하는 도구 체인이 필요하다. SDK와 JDK는 저장소에 포함하지 않는다. 검증 환경은 Gradle wrapper 9.7.1과 Android Gradle Plugin 9.4.1이며 의존성 다운로드에는 네트워크가 필요할 수 있다.

```powershell
$workspace = Join-Path $PWD 'work\android-build'
git clone https://github.com/kota-zo/myspoti.git $workspace
git -C $workspace checkout d99d09db66a79b22643b7b87b30b00e4b8b232ce
git -C $workspace apply --check "$PWD\android\patches\myspoti-hangul.patch"
git -C $workspace apply "$PWD\android\patches\myspoti-hangul.patch"
Set-Location "$workspace\base"
# JAVA_HOME과 ANDROID_HOME에는 이 PC의 JDK 및 SDK 경로를 지정한다.
.\gradlew.bat --no-daemon :app:testDebugUnitTest --tests 'com.music.spotui.data.api.HangulReadingEngineTest'
.\gradlew.bat --no-daemon :app:assembleRelease '-PappVersionName=2.0.1-hangul.3' '-PappVersionCode=1085'
```

기준 소스와 패치로 대응 소스를 재현할 수 있으며 원본 고지와 Android LICENSE는 유지한다. 기본 빌드는 개인 릴리스 키가 없으면 개발용 서명을 사용한다. 기존 설치 앱을 업데이트할 때는 같은 서명자로 다시 서명해야 한다. 개인 키와 서명 자격 정보는 이 저장소에 넣지 않는다.

## 현재 검증 범위

휴대폰 없이 Java 가사 엔진 검사 22 개, Kotlin·Compose 컴파일과 R8 최적화를 포함한 release APK 빌드를 통과했다. 실제 빌드된 APK 안에서 IPADIC의 NAIST 고지가 유지되는 것을 확인했다. 로컬 설치 후보는 기존 개인 서명 키로 다시 서명했고 이전 1084 APK와 서명자가 일치하며 새 버전 코드는 1085다.

설치·로그인·기기 화면의 복사·재생 및 Spotify Connect 전환은 아직 검증하지 않았다. 사용자의 휴대폰 조작이 필요한 이 단계는 대기한다. 새 APK는 휴대폰 미검증 사실을 밝힌 베타로 전용 저장소의 릴리스에 배포한다. 이전의 로컬 전용 방침을 사용자 요청에 따라 변경했다.
