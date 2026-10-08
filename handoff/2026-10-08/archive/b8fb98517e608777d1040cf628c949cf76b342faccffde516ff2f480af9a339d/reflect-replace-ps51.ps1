param([string]$Directory)
Add-Type -AssemblyName UIAutomationClient
$methods=@([System.Windows.Automation.AutomationElement].GetMethods() | Where-Object { $_.Name -eq 'TryGetCurrentPattern' })
Write-Output ('TryGetCurrentPatternOverloads=' + $methods.Count)
$target=Join-Path $Directory 'replace-target.txt'
$next=Join-Path $Directory 'replace-next.txt'
[IO.File]::WriteAllText($target,'before',[Text.Encoding]::ASCII)
[IO.File]::WriteAllText($next,'after',[Text.Encoding]::ASCII)
$backup=Join-Path $Directory 'replace-backup.txt'
[IO.File]::Replace($next,$target,$backup)
Write-Output ('ReplaceResult=' + [IO.File]::ReadAllText($target))
if($methods.Count -lt 1 -or [IO.File]::ReadAllText($target) -ne 'after'){exit 1}
