$ErrorActionPreference = "Stop"

Set-Location "F:\UserData\Documents\ChatGPT\sp\aijian-studio"
$env:Path = "$env:APPDATA\Python\Python312\Scripts;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:USERPROFILE\.local\bin;$env:Path"

& ".\scripts\dev-windows.ps1"
