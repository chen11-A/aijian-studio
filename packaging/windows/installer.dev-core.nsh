; Windows 10+ gate only. Existing login and projects are not a reason to abort,
; and this macro must not read or delete %APPDATA%.
!macro customInit
  ClearErrors
  SetRegView 64
  ReadRegDWORD $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentMajorVersionNumber"
  SetRegView lastused
  IfErrors aivoraDevUnsupportedWindows
  IntCmp $R0 10 aivoraDevSupportedWindows aivoraDevUnsupportedWindows aivoraDevSupportedWindows
aivoraDevUnsupportedWindows:
  MessageBox MB_ICONSTOP|MB_OK "AIVORA 需要 Windows 10 或更高版本。" /SD IDOK
  SetErrorLevel 3
  Abort
aivoraDevSupportedWindows:
!macroend
