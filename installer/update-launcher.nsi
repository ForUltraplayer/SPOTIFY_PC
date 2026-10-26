; @file update-launcher.nsi
; @author: ForUltraplayer
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
!define MUI_WELCOMEPAGE_TEXT "기존 설치 위치를 찾아 GitHub의 최신 통합 설치본을 내려받고 업데이트합니다.$\r$\n$\r$\nSpotify를 완전히 종료한 뒤 계속해 주세요. 인터넷 연결과 약 65 MB의 다운로드가 필요합니다. 기존 통합 Spotify는 재다운로드하지 않습니다."
!define MUI_FINISHPAGE_RUN "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $\"$INSTDIR\start.ps1$\"'
!define MUI_FINISHPAGE_RUN_TEXT "Spotify 한글 가사 실행"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD_DIR}\LICENSE"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"

Function .onInit
  ${IfNot} ${RunningX64}
    SetErrorLevel 1
    Abort
  ${EndIf}
  ReadRegStr $INSTDIR HKCU "Software\SpotifyHangul" "InstallDir"
  ${If} $INSTDIR == ""
    MessageBox MB_ICONSTOP "기존 설치를 찾지 못했습니다. Setup.exe로 먼저 설치해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=auto-update.ps1 "${PAYLOAD_DIR}\auto-update.ps1"
  nsExec::ExecToLog /TIMEOUT=240000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\auto-update.ps1" -Mode Check -IgnoreInterval -Interactive -InstallRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "업데이트 다운로드를 완료하지 못했습니다. 잠시 뒤 다시 실행해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  nsExec::ExecToLog /TIMEOUT=660000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\auto-update.ps1" -Mode ApplyPending -Interactive -InstallRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Spotify를 완전히 종료하고 다시 실행해 주세요. 설치 중이라면 완료될 때까지 기다려 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
SectionEnd
