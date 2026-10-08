param(
  [Parameter(Mandatory=$true)][int]$ElectronPid,
  [Parameter(Mandatory=$true)][string]$ExpectedTitle,
  [Parameter(Mandatory=$true)][string]$ExpectedAction,
  [string]$ProjectId = '',
  [string]$VersionId = '',
  [string]$ContentHash = '',
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$deadline = [DateTime]::UtcNow.AddSeconds(20)
$window = $null
while ([DateTime]::UtcNow -lt $deadline -and $null -eq $window) {
  $roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ElectronPid
    ))
  )
  foreach ($root in $roots) {
    $name = $root.Current.Name
    if ($name -eq $ExpectedTitle) { $window = $root; break }
  }
  if ($null -eq $window) { Start-Sleep -Milliseconds 150 }
}
if ($null -eq $window) { throw "Native dialog title/PID not found: $ExpectedTitle / $ElectronPid" }
$descendants = $window.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)
$names = New-Object System.Collections.Generic.List[string]
$buttons = New-Object System.Collections.Generic.List[object]
foreach ($element in $descendants) {
  $name = $element.Current.Name
  if (-not [string]::IsNullOrWhiteSpace($name)) { $names.Add($name) }
  if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
    $buttons.Add($element)
  }
}
$visibleText = [string]::Join("`n", $names)
if ($visibleText -notmatch '(prj_[0-9a-f]{32})' -or $visibleText -notmatch '(ver_[0-9a-f]{32})' -or $visibleText -notmatch '(sha256:[0-9a-f]{64})') {
  throw 'Native dialog lacks canonical project/version/hash identity'
}
$observedProject = [regex]::Match($visibleText, 'prj_[0-9a-f]{32}').Value
$observedVersion = [regex]::Match($visibleText, 'ver_[0-9a-f]{32}').Value
$observedHash = [regex]::Match($visibleText, 'sha256:[0-9a-f]{64}').Value
$requiredValues = @("动作：$ExpectedAction")
if ($ProjectId) { $requiredValues += $ProjectId }
if ($VersionId) { $requiredValues += $VersionId }
if ($ContentHash) { $requiredValues += $ContentHash }
foreach ($required in $requiredValues) {
  if (-not $visibleText.Contains($required)) { throw "Native dialog identity/action missing: $required" }
}
$expectedButton = "确认$ExpectedTitle"
$matches = @($buttons | Where-Object { $_.Current.Name -eq $expectedButton })
if ($matches.Count -ne 1) { throw "Native confirm button mismatch: $expectedButton, count=$($matches.Count)" }
$button = $matches[0]
if (-not $button.Current.IsEnabled) { throw 'Native confirm button is disabled' }
$pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
if ($null -eq $pattern) { throw 'Native confirm button has no InvokePattern' }
$record = [ordered]@{
  timestamp_utc = [DateTime]::UtcNow.ToString('o')
  electron_pid = $ElectronPid
  window_title = $window.Current.Name
  window_handle = $window.Current.NativeWindowHandle
  button_name = $button.Current.Name
  project_id = $observedProject
  version_id = $observedVersion
  content_hash = $observedHash
  action = $ExpectedAction
  visible_text = $visibleText
  invoked = $false
}
$record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $EvidencePath -Encoding utf8 -NoNewline
$pattern.Invoke()
$record.invoked = $true
$record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $EvidencePath -Encoding utf8 -NoNewline
$record | ConvertTo-Json -Compress -Depth 4
