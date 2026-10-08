param([string]$Target)
$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($Target,[ref]$tokens,[ref]$errors) | Out-Null
Write-Output ('PSVersion=' + $PSVersionTable.PSVersion.ToString())
Write-Output ('ParseErrors=' + $errors.Count)
$errors | ForEach-Object { Write-Output $_.ToString() }
if($errors.Count -gt 0){exit 1}