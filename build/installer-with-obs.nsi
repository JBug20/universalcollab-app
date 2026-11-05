; UniversalCollab Private Preview with OBS Studio: Windows installer (built by build/build-with-obs.mjs, which
; passes STAGE, VERSION, VIVERSION, OUTFILE, OBSVERSION and UNINSTALL_LIST). Installs per user into the same folder
; and uninstall entry as the earlier 1.2.0 setup, so it upgrades it in place. Settings and accounts live in
; %APPDATA%\Stream Relay and the included OBS keeps its settings in obs-studio\config; neither is touched.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\UniversalCollabPrivate"
Name "UniversalCollab Private Preview (with OBS Studio)"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\UniversalCollabPrivate"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
VIProductVersion "${VIVERSION}"
VIAddVersionKey "ProductName" "UniversalCollab"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "UniversalCollab setup"
VIAddVersionKey "LegalCopyright" "MIT License; OBS Studio is GPL software"
!define MUI_ICON "${STAGE}\resources\app\assist-engine\Notify.ico"
!define MUI_UNICON "${STAGE}\resources\app\assist-engine\Notify.ico"
!define MUI_WELCOMEPAGE_TITLE "UniversalCollab Private Preview ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This installs UniversalCollab with OBS Studio ${OBSVERSION} included.$\r$\n$\r$\nOBS does not need to be downloaded separately: UniversalCollab sets it up, starts it in the system tray and closes it for you. Your own OBS installation (if any) is not changed.$\r$\n$\r$\nIncludes Stream Assist, Studio Mode and automatic app updates. Your settings are kept.$\r$\n$\r$\nClose UniversalCollab before continuing."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\StreamRelay.exe"
!define MUI_FINISHPAGE_TEXT "Installed. Open UniversalCollab Private from the Start menu.$\r$\n$\r$\nNew users: the included OBS is used automatically. If you already used your own OBS: Settings > OBS > OBS connection settings > OBS to use > OBS included with UniversalCollab.$\r$\n$\r$\nOBS Studio is GPL software; see OBS-STUDIO-NOTICE.txt in the install folder."
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Waits until no program from the install folder is running (UniversalCollab, Stream Assist, the included OBS).
!macro WaitForAppClosed UN
Function ${UN}WaitForAppClosed
  retry:
  nsExec::ExecToStack `powershell -NoProfile -NonInteractive -Command "@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR\', [StringComparison]::OrdinalIgnoreCase) }).Count"`
  Pop $0
  Pop $1
  IntCmp $1 0 done done
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close UniversalCollab (and the OBS it started, in the system tray), then choose Retry. Closing the app does not stop a relay broadcast." IDRETRY retry
  Abort
  done:
FunctionEnd
!macroend
!insertmacro WaitForAppClosed ""
!insertmacro WaitForAppClosed "un."

Section
  SetShellVarContext current
  Call WaitForAppClosed
  SetOutPath "$INSTDIR"
  ; Old app files and the previous-version copy kept by app updates are replaced as a whole.
  RMDir /r "$INSTDIR\resources\app"
  RMDir /r "$INSTDIR\resources\app-previous"
  ; The earlier setup's installation record; this setup's uninstaller replaces it.
  Delete "$INSTDIR\installed-files.txt"
  File /r "${STAGE}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\UniversalCollab Private.lnk" "$INSTDIR\StreamRelay.exe" "" "$INSTDIR\StreamRelay.exe" 0 SW_SHOWNORMAL "" "UniversalCollab with private Stream Assist"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "UniversalCollab Private Preview (with OBS Studio)"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "UniversalCollab"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\StreamRelay.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Call un.WaitForAppClosed
  ; Only the files this setup installed (and the app folder, which app updates change). Saved settings, accounts
  ; and the included OBS's settings (obs-studio\config) are kept.
  RMDir /r "$INSTDIR\resources\app"
  RMDir /r "$INSTDIR\resources\app-previous"
  !include "${UNINSTALL_LIST}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\UniversalCollab Private.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
