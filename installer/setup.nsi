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
!define MUI_WELCOMEPAGE_TEXT "Spotify, SpotX, Spicetify와 한글 발음 가사를 한 번에 구성합니다.$\r$\n$\r$\nPython과 Spotify를 미리 설치할 필요가 없습니다. 설치 중 인터넷 연결과 약 150 MB의 추가 다운로드가 필요합니다.$\r$\n$\r$\n기존 Spotify는 보존하고 선택한 폴더에 통합본을 설치합니다. SpotX 패치를 유지하기 위해 통합본의 Spotify 자동 업데이트를 차단합니다."
!define MUI_FINISHPAGE_RUN "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $\"$INSTDIR\start.ps1$\"'
!define MUI_FINISHPAGE_RUN_TEXT "Spotify 한글 가사 실행"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD_DIR}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "이 설치본은 Windows x64용입니다." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Section "Spotify 한글 가사" SEC_MAIN
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=bootstrap.ps1 "${PAYLOAD_DIR}\installer\bootstrap.ps1"
  nsExec::ExecToLog /TIMEOUT=60000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\bootstrap.ps1" -Mode Prepare -InstallRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "설치 준비에 실패했습니다. 자세한 내용은 설치 창의 세부 정보를 확인해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  FileOpen $1 "$INSTDIR\install.log" a
  FileSeek $1 0 END
  FileWrite $1 "$\r$\n[NSIS] Prepare completed; extracting payload.$\r$\n"
  FileClose $1
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD_DIR}\*.*"
  FileOpen $1 "$INSTDIR\install.log" a
  FileSeek $1 0 END
  FileWrite $1 "[NSIS] Payload extracted; starting integration.$\r$\n"
  FileClose $1
  nsExec::ExecToLog /TIMEOUT=600000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\bootstrap.ps1" -Mode Install -InstallRoot "$INSTDIR"'
  Pop $0
  FileOpen $1 "$INSTDIR\install.log" a
  FileSeek $1 0 END
  FileWrite $1 "[NSIS] Integration result: $0$\r$\n"
  FileClose $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Spotify 연결에 실패했습니다. 설치 폴더의 install.log와 세부 정보를 확인해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
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
  CreateShortcut "$DESKTOP\Spotify 한글 가사.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\start.ps1"' "$INSTDIR\Spotify\Spotify.exe"
  CreateShortcut "$SMPROGRAMS\Spotify 한글 가사\Spotify 한글 가사.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\start.ps1"' "$INSTDIR\Spotify\Spotify.exe"
  CreateShortcut "$SMPROGRAMS\Spotify 한글 가사\제거.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog /TIMEOUT=120000 '"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\bootstrap.ps1" -Mode Uninstall -InstallRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "연결 해제에 실패해 파일 제거를 중단했습니다. 세부 정보를 확인해 주세요." /SD IDOK
    SetErrorLevel 1
    Abort
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
