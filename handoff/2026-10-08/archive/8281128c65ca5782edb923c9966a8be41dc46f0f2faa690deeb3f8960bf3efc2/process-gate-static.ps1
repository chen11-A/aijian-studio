$ErrorActionPreference = 'Stop'
$m2Root = $env:M2_REPO_ROOT.ToLowerInvariant()
$m2ProfilePath = $env:M2_PROFILE_PATH.ToLowerInvariant()
$m2SelfPid = [int]$env:M2_SELF_PID
$found = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $m2SelfPid -and $_.Name -match '^(electron|python|pythonw|node|cmd)\.exe$' -and
  (($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($m2Root)) -or
   ($_.CommandLine -and ($_.CommandLine.ToLowerInvariant().Contains($m2Root) -or
     $_.CommandLine.ToLowerInvariant().Contains($m2ProfilePath))))
} | Select-Object ProcessId,Name)
ConvertTo-Json -InputObject $found -Compress