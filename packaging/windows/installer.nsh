; electron-builder v26 NSIS include. Upgrades fail closed until a verified
; pre-replacement workspace backup hook is implemented and tested.
!macro customInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" aivoraNoRegistry aivoraExistingInstall
aivoraNoRegistry:
  IfFileExists "$INSTDIR\AIVORA.exe" aivoraExistingInstall aivoraNoExecutable
aivoraNoExecutable:
  IfFileExists "$APPDATA\AIVORA" aivoraExistingInstall aivoraFreshInstall
aivoraExistingInstall:
  MessageBox MB_ICONSTOP|MB_OK "AIVORA install is blocked: existing installation or user data requires a verified backup." /SD IDOK
  Abort
aivoraFreshInstall:
!macroend
