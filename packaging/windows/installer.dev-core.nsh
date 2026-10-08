; Separate, explicitly limited development product. No upgrade bypass.
!macro customInit
  ClearErrors
  SetRegView 64
  ReadRegDWORD $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentMajorVersionNumber"
  SetRegView lastused
  IfErrors aivoraDevUnsupportedWindows
  IntCmp $R0 10 aivoraDevSupportedWindows aivoraDevUnsupportedWindows aivoraDevSupportedWindows
aivoraDevUnsupportedWindows:
  MessageBox MB_ICONSTOP|MB_OK "AIVORA Dev Core requires Windows 10 or later with the operating-system Universal CRT." /SD IDOK
  SetErrorLevel 3
  Abort
aivoraDevSupportedWindows:
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" aivoraDevNoRegistry aivoraDevExistingInstall
aivoraDevNoRegistry:
  IfFileExists "$INSTDIR\AIVORA Dev Core.exe" aivoraDevExistingInstall aivoraDevNoExecutable
aivoraDevNoExecutable:
  IfFileExists "$APPDATA\AIVORA Dev Core" aivoraDevExistingInstall aivoraDevNoData
aivoraDevNoData:
  IfFileExists "$APPDATA\AIVORA" aivoraDevExistingInstall aivoraDevFreshInstall
aivoraDevExistingInstall:
  MessageBox MB_ICONSTOP|MB_OK "AIVORA Dev Core installation stopped: existing installation or user data requires a verified backup. This development installer does not upgrade or remove user data." /SD IDOK
  SetErrorLevel 2
  Abort
aivoraDevFreshInstall:
!macroend
