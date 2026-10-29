; @file update-launcher.nsi
; @brief Download and install the latest project release into the existing per-user installation.
Unicode true
RequestExecutionLevel user
SetCompressor zlib
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Name "Spotify 한글 가사 업데이트"
OutFile "${OUTPUT_FILE}"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "Spotify Hangul Lyrics Updater"
VIAddVersionKey "FileDescription" "Spotify Hangul Lyrics Update Launcher"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "2026 ForUltraplayer"
!define MUI_WELCOMEPAGE_TEXT "$(WelcomeText)"
; A headless console host keeps Windows Terminal from showing a PowerShell window.
!define MUI_FINISHPAGE_RUN "$SYSDIR\conhost.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS '--headless $\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $\"$INSTDIR\start.ps1$\"'
!define MUI_FINISHPAGE_RUN_TEXT "$(RunText)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD_DIR}\LICENSE"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
; The first language is the fallback for Windows languages without a translation.
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Korean"

LangString WelcomeText ${LANG_KOREAN} "기존 설치 위치를 찾아 GitHub의 최신 통합 설치본을 내려받고 업데이트합니다.$\r$\n$\r$\nSpotify를 완전히 종료한 뒤 계속해 주세요. 인터넷 연결과 통합 설치본을 받을 공간이 필요합니다. 기존 통합 Spotify는 버전과 백업 상태를 확인한 뒤 재사용합니다."
LangString WelcomeText ${LANG_ENGLISH} "Finds the existing installation, then downloads the latest integrated installer from GitHub and updates it.$\r$\n$\r$\nClose Spotify completely before you continue. An internet connection and room for the integrated installer are needed. The existing integrated Spotify is reused after its version and backup are checked."
LangString RunText ${LANG_KOREAN} "Spotify 한글 가사 실행"
LangString RunText ${LANG_ENGLISH} "Start Spotify Hangul Lyrics"
LangString NoInstallation ${LANG_KOREAN} "기존 설치를 찾지 못했습니다. Setup.exe로 먼저 설치해 주세요."
LangString NoInstallation ${LANG_ENGLISH} "No existing installation was found. Install it with Setup.exe first."
LangString UpdateFailed ${LANG_KOREAN} "업데이트에 실패했습니다. 설치 창의 세부 정보를 확인해 주세요. 오류 코드: $0"
LangString UpdateFailed ${LANG_ENGLISH} "The update failed. Check the installer's details. Error code: $0"

Function .onInit
  ${IfNot} ${RunningX64}
    SetErrorLevel 1
    Abort
  ${EndIf}
  ReadRegStr $INSTDIR HKCU "Software\SpotifyHangul" "InstallDir"
  ${If} $INSTDIR == ""
    MessageBox MB_ICONSTOP "$(NoInstallation)" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Function ShowUpdateError
  StrCpy $1 "$(UpdateFailed)"
  IfFileExists "$PLUGINSDIR\update-error.txt" 0 show_update_error
  FileOpen $2 "$PLUGINSDIR\update-error.txt" r
  FileReadUTF16LE $2 $1
  FileClose $2
  show_update_error:
  MessageBox MB_ICONSTOP "$1" /SD IDOK
FunctionEnd

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=auto-update.ps1 "${PAYLOAD_DIR}\auto-update.ps1"
  Delete "$PLUGINSDIR\update-error.txt"
  nsExec::ExecToLog /TIMEOUT=240000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\auto-update.ps1" -Mode Check -IgnoreInterval -Interactive -InstallRoot "$INSTDIR" -ErrorFile "$PLUGINSDIR\update-error.txt" -RequestedVersion "${APP_VERSION}"'
  Pop $0
  ${If} $0 != 0
    Call ShowUpdateError
    SetErrorLevel 1
    Abort
  ${EndIf}
  Delete "$PLUGINSDIR\update-error.txt"
  nsExec::ExecToLog /TIMEOUT=660000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\auto-update.ps1" -Mode ApplyPending -Interactive -InstallRoot "$INSTDIR" -ErrorFile "$PLUGINSDIR\update-error.txt"'
  Pop $0
  ${If} $0 != 0
    Call ShowUpdateError
    SetErrorLevel 1
    Abort
  ${EndIf}
SectionEnd
