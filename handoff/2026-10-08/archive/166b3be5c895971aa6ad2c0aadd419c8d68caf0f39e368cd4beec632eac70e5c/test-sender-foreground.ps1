$ErrorActionPreference = 'Stop'
$sender = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path 'native-bm-click-attempt02.ps1'
$text = [IO.File]::ReadAllText($sender)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw "Sender PowerShell parse errors=$($parseErrors.Count)" }
$csharp = [regex]::Match($text, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $csharp.Success) { throw 'Sender NativeReadOnly declaration not found' }
Add-Type -TypeDefinition $csharp.Groups[1].Value
$function = @($ast.FindAll({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'Describe-ForegroundWindow'
}, $true))
if ($function.Count -ne 1) { throw "Foreground descriptor function count=$($function.Count)" }
Invoke-Expression $function[0].Extent.Text
$sampled = [NativeReadOnly]::GetForegroundWindow()
$identity = Describe-ForegroundWindow $sampled
if ($identity.handle -ne $sampled.ToInt64()) { throw 'Descriptor used another HWND' }
if ($identity.is_window -and ($identity.pid -le 0 -or $identity.thread_id -le 0)) {
  throw 'Valid foreground HWND missing PID/TID'
}
$gateIf = @($ast.FindAll({ param($node)
  $node -is [System.Management.Automation.Language.IfStatementAst] -and
  $node.Extent.Text.Contains('Native handle, PID, child, visibility, enabled, or foreground gate failed')
}, $true))
if ($gateIf.Count -ne 1) { throw "Native gate count=$($gateIf.Count)" }
$condition = $gateIf[0].Clauses[0].Item1.Extent.Text
$MainPid = 4242
$record = [ordered]@{
  owner = [ordered]@{handle=10}
  dialog = [ordered]@{handle=20}
  button = [ordered]@{handle=30}
}
$gate = [ordered]@{
  owner_handle=10; dialog_handle=20; button_handle=30
  owner_pid=$MainPid; dialog_pid=$MainPid; button_pid=$MainPid
  win32_button_pid=$MainPid; win32_button_thread_id=1
  win32_button_class='Button'; win32_button_class_length=6
  owner_is_window=$true; dialog_is_window=$true; button_is_window=$true
  button_is_child_of_dialog=$true; dialog_is_enabled=$true; button_is_enabled=$true
  dialog_is_visible=$true; button_is_visible=$true; button_uia_is_enabled=$true
  button_uia_is_offscreen=$false; foreground_handle=99
}
$competitionRejected = [bool](Invoke-Expression $condition)
$gate.foreground_handle = $record.dialog.handle
$matchingPassed = -not [bool](Invoke-Expression $condition)
if (-not $competitionRejected -or -not $matchingPassed) {
  throw 'Sender native gate changed its strict foreground behavior'
}
$report = [ordered]@{
  status='PASS'
  scope='OFFLINE_FOREGROUND_DESCRIPTOR_AND_ORIGINAL_GATE_EXPRESSION'
  sender_parse_errors=$parseErrors.Count
  same_handle_descriptor=$true
  foreground_identity=$identity
  competition_gate_rejected=$competitionRejected
  matching_foreground_gate_passed=$matchingPassed
  native_send_attempted=$false
  electron_launched=$false
}
$output = Join-Path $PSScriptRoot 'sender-foreground-test.json'
[IO.File]::WriteAllText($output, ($report | ConvertTo-Json -Depth 6),
  (New-Object System.Text.UTF8Encoding($false)))
Write-Output ($report | ConvertTo-Json -Depth 6)
