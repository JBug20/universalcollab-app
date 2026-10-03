Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Name "UniversalCollab"
OutFile "UniversalCollab-Setup-1.0.0-rc.8.exe"
InstallDir "$LOCALAPPDATA\Programs\StreamRelay"
InstallDirRegKey HKCU "Software\StreamRelay" "InstallDir"
RequestExecutionLevel user
SetCompressor zlib
VIProductVersion "1.0.0.8"
VIAddVersionKey "ProductName" "UniversalCollab"
VIAddVersionKey "FileVersion" "1.0.0-rc.8"
VIAddVersionKey "FileDescription" "UniversalCollab setup"
VIAddVersionKey "LegalCopyright" "MIT License"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\StreamRelay.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
 SetShellVarContext current
 FindWindow $0 "" "UniversalCollab"
 FindWindow $1 "" "Stream Relay"
 ${If} $0 != 0
 ${OrIf} $1 != 0
  MessageBox MB_OK "Close UniversalCollab or Stream Relay, then run this installer again. Closing the app does not stop your broadcast."
  Abort
 ${EndIf}
FunctionEnd
Section
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 File /r /x ".*" "windows-app\*"
 Delete "$SMPROGRAMS\Stream Relay\Stream Relay.lnk"
 Delete "$SMPROGRAMS\Stream Relay\Uninstall.lnk"
 RMDir "$SMPROGRAMS\Stream Relay"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\UniversalCollab"
 CreateShortcut "$SMPROGRAMS\UniversalCollab\UniversalCollab.lnk" "$INSTDIR\StreamRelay.exe"
 CreateShortcut "$SMPROGRAMS\UniversalCollab\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\StreamRelay" "InstallDir" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StreamRelay" "DisplayName" "UniversalCollab"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StreamRelay" "DisplayVersion" "1.0.0-rc.8"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StreamRelay" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
 SetShellVarContext current
 RMDir /r "$INSTDIR"
 RMDir /r "$SMPROGRAMS\UniversalCollab"
 DeleteRegKey HKCU "Software\StreamRelay"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\StreamRelay"
SectionEnd
