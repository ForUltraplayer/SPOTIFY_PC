; @file setup.nsi
; @author: ForUltraplayer
; @brief Build a selectable-directory per-user installer with an embedded Python runtime.
Unicode true
RequestExecutionLevel user
SetCompressor zlib
CRCCheck force
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
Var TransactionStarted
Var InstallerPid
Var InstallationMutex
Name "Spotify 한글 가사"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\SpotifyHangul"
InstallDirRegKey HKCU "Software\SpotifyHangul" "InstallDir"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "Spotify Hangul Lyrics"
VIAddVersionKey "FileDescription" "Spotify Hangul Lyrics Setup"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "2026 ForUltraplayer"
!define MUI_ABORTWARNING
!define MUI_CUSTOMFUNCTION_ABORT RollbackInstall
!define MUI_WELCOMEPAGE_TEXT "Spotify, SpotX, Spicetify와 한글 발음 가사를 한 번에 구성합니다.$\r$\n$\r$\nPython과 Spotify를 미리 설치할 필요가 없습니다. 설치 중 인터넷 연결과 약 150 MB의 추가 다운로드가 필요합니다.$\r$\n$\r$\n기존 Spotify는 보존하고 선택한 폴더에 통합본을 설치합니다. SpotX 패치를 유지하기 위해 통합본의 Spotify 자동 업데이트를 차단합니다."
; Windows 11 hands a new console to Windows Terminal, which shows a window even with
; -WindowStyle Hidden; a headless console host keeps the launcher invisible.
!define MUI_FINISHPAGE_RUN "$SYSDIR\conhost.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS '--headless $\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $\"$INSTDIR\start.ps1$\"'
!define MUI_FINISHPAGE_RUN_TEXT "Spotify 한글 가사 실행"
; The desktop overlay is optional and distributed separately from this installer.
!define MUI_FINISHPAGE_LINK "데스크톱 가사창(선택) 받기"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/ForUltraplayer/ivLyrics-overlay/releases/latest"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD_DIR}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "English"

!macro AcquireInstallationMutex
  ; Keep the handle in the NSIS parent across Apply, metadata writes and Commit.
  ; The Local namespace covers concurrent installers in the current desktop session.
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\SpotifyHangulInstaller") p .r0 ?e'
  Pop $1
  StrCpy $InstallationMutex $0
  ${If} $0 == 0
  ${OrIf} $1 == 183
    ${If} $0 != 0
      System::Call 'kernel32::CloseHandle(p $InstallationMutex)'
    ${EndIf}
    StrCpy $InstallationMutex 0
    MessageBox MB_ICONSTOP "다른 설치 또는 제거가 진행 중입니다. 완료 후 다시 실행해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend

Function .onInit
  StrCpy $TransactionStarted "0"
  System::Call 'kernel32::GetCurrentProcessId() i .r9'
  StrCpy $InstallerPid $9
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "이 설치본은 Windows x64용입니다." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  !insertmacro AcquireInstallationMutex
FunctionEnd

Function .onGUIEnd
  ${If} $InstallationMutex != 0
    System::Call 'kernel32::CloseHandle(p $InstallationMutex)'
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro AcquireInstallationMutex
FunctionEnd

Function un.onGUIEnd
  ${If} $InstallationMutex != 0
    System::Call 'kernel32::CloseHandle(p $InstallationMutex)'
  ${EndIf}
FunctionEnd

Function RollbackInstall
  ${If} $TransactionStarted == "1"
    SetOutPath "$TEMP"
    nsExec::ExecToLog /TIMEOUT=600000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\payload-transaction.ps1" -Mode Rollback -InstallRoot "$INSTDIR" -OwnerProcessId $InstallerPid'
    Pop $0
    ${If} $0 != 0
      DetailPrint "Rollback needs recovery on the next installer run. The previous snapshot is retained beside the installation folder."
    ${EndIf}
  ${EndIf}
FunctionEnd

Function .onInstFailed
  Call RollbackInstall
FunctionEnd

Section "Spotify 한글 가사" SEC_MAIN
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=payload-transaction.ps1 "${PAYLOAD_DIR}\installer\payload-transaction.ps1"
  SetOutPath "$PLUGINSDIR\payload"
  File /r "${PAYLOAD_DIR}\*.*"
  StrCpy $TransactionStarted "1"
  nsExec::ExecToLog /TIMEOUT=900000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\payload-transaction.ps1" -Mode Apply -InstallRoot "$INSTDIR" -PayloadRoot "$PLUGINSDIR\payload" -OwnerProcessId $InstallerPid'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "설치에 실패했습니다. 이전 파일 복구 결과와 진단 기록은 설치 폴더 옆의 update 폴더에서 확인할 수 있습니다. 복구가 중단됐다면 이 설치 파일을 다시 실행해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ClearErrors
  ; Shortcuts inherit OUTDIR. Never retain the temporary extraction directory.
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\SpotifyHangul" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "DisplayName" "Spotify 한글 가사"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "Publisher" "ForUltraplayer"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\Spotify 한글 가사"
  CreateShortcut "$DESKTOP\Spotify 한글 가사.lnk" "$SYSDIR\conhost.exe" '--headless "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\start.ps1"' "$INSTDIR\Spotify\Spotify.exe"
  CreateShortcut "$SMPROGRAMS\Spotify 한글 가사\Spotify 한글 가사.lnk" "$SYSDIR\conhost.exe" '--headless "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\start.ps1"' "$INSTDIR\Spotify\Spotify.exe"
  CreateShortcut "$SMPROGRAMS\Spotify 한글 가사\제거.lnk" "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    Call RollbackInstall
    MessageBox MB_ICONSTOP "설치 등록에 실패해 이전 설치 복구를 시도했습니다. 복구 결과는 설치 창의 세부 정보에서 확인하고, 복구가 중단됐다면 이 설치 파일을 다시 실행해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  nsExec::ExecToLog /TIMEOUT=60000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\payload-transaction.ps1" -Mode Commit -InstallRoot "$INSTDIR" -OwnerProcessId $InstallerPid'
  Pop $0
  ${If} $0 != 0
    Call RollbackInstall
    MessageBox MB_ICONSTOP "설치 완료 기록을 저장하지 못해 이전 설치 복구를 시도했습니다. 복구가 중단됐다면 이 설치 파일을 다시 실행해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  StrCpy $TransactionStarted "0"
SectionEnd

Section "Uninstall"
  ; A shortcut may start here with INSTDIR as cwd; release it before removal.
  SetOutPath "$TEMP"
  nsExec::ExecToLog /TIMEOUT=120000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\bootstrap.ps1" -Mode Uninstall -InstallRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "연결 해제에 실패해 파일 제거를 중단했습니다. 세부 정보를 확인해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  nsExec::ExecToLog /TIMEOUT=600000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\payload-transaction.ps1" -Mode Cleanup -InstallRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    ; A damaged or stale update record must not make the app impossible to remove.
    ; The record folder beside the installation is left untouched for inspection.
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "업데이트 복구 기록을 정리하지 못했습니다.$\r$\n$\r$\n기록 폴더는 그대로 두고 제거를 계속할까요? '아니요'를 누르면 제거를 중단합니다." /SD IDNO IDYES continueUninstall
    SetErrorLevel 1
    Abort
    continueUninstall:
  ${EndIf}
  ReadRegStr $0 HKCU "Software\SpotifyHangul" "InstallDir"
  ${If} $0 == $INSTDIR
    DeleteRegKey HKCU "Software\SpotifyHangul"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul"
    RMDir /r "$SMPROGRAMS\Spotify 한글 가사"
  ${EndIf}
  ; integrate.ps1 validates this exact absolute application directory and marker.
  RMDir /r "$INSTDIR"
SectionEnd
