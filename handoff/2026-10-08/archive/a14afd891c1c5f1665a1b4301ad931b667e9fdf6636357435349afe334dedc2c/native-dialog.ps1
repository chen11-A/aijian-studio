param(
  [Parameter(Mandatory=$true)][int]$ElectronPid,
  [Parameter(Mandatory=$true)][string]$ExpectedTitle,
  [Parameter(Mandatory=$true)][string]$ExpectedButtonName,
  [Parameter(Mandatory=$true)][ValidateSet('submit','signoff','decision')][string]$ExpectedAction,
  [string]$ProjectId = '',
  [string]$VersionId = '',
  [string]$ContentHash = '',
  [ValidateRange(0,30)][int]$TimeoutSeconds = 20,
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if ([System.IO.File]::Exists($EvidencePath)) { throw "Evidence path already exists: $EvidencePath" }

# Keep this script ASCII-safe for Windows PowerShell 5.1. UIA and process
# arguments are Unicode; JSON evidence is written as UTF-8 without a BOM.
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Evidence {
  $record.updated_utc = [DateTime]::UtcNow.ToString('o')
  $json = $record | ConvertTo-Json -Depth 5
  $next = $EvidencePath + '.next'
  [System.IO.File]::WriteAllText($next, $json, $utf8)
  if ([System.IO.File]::Exists($EvidencePath)) {
    $previous = $EvidencePath + '.previous-' + [guid]::NewGuid().ToString('N')
    [System.IO.File]::Replace($next, $EvidencePath, $previous)
  } else {
    [System.IO.File]::Move($next, $EvidencePath)
  }
}
function Get-UniqueField([string]$text, [string]$pattern, [string]$label) {
  $found = [regex]::Matches($text, $pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if ($found.Count -ne 1) { throw "Native $label count=$($found.Count)" }
  return $found[0].Groups[1].Value
}

$record = [ordered]@{
  started_utc = [DateTime]::UtcNow.ToString('o')
  updated_utc = $null
  electron_pid = $ElectronPid
  expected_title = $ExpectedTitle
  expected_button_name = $ExpectedButtonName
  expected_action = $ExpectedAction
  owner_title = $null
  owner_handle = $null
  window_title = $null
  window_handle = $null
  button_name = $null
  button_handle = $null
  project_id = $null
  version_id = $null
  content_hash = $null
  action = $null
  visible_text = $null
  invoke_pattern_available = $false
  invoke_attempted = $false
  invoked = $false
  status = 'STARTED'
  error = $null
}

try {
  if ($ElectronPid -le 0) { throw 'Electron main PID must be positive' }
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $owner = $null
  $window = $null
  while ($true) {
    $owners = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
    $topLevel = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($candidate in $topLevel) {
      $current = $candidate.Current
      if ($current.ProcessId -eq $ElectronPid -and
          $current.Name -eq 'AIVORA' -and
          $current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
          $current.ClassName -eq 'Chrome_WidgetWin_1' -and
          $current.NativeWindowHandle -gt 0) {
        [void]$owners.Add($candidate)
      }
    }
    if ($owners.Count -gt 1) { throw "AIVORA top-level owner is not unique: $($owners.Count)" }
    if ($owners.Count -eq 1) {
      $owner = $owners[0]
      $dialogs = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
      $descendants = $owner.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      foreach ($candidate in $descendants) {
        $current = $candidate.Current
        if ($current.ProcessId -eq $ElectronPid -and
            $current.Name -eq $ExpectedTitle -and
            $current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
            $current.ClassName -eq '#32770' -and
            $current.NativeWindowHandle -gt 0 -and
            -not $current.IsOffscreen -and $current.IsEnabled) {
          [void]$dialogs.Add($candidate)
        }
      }
      if ($dialogs.Count -gt 1) { throw "Native dialog is not unique: $ExpectedTitle, count=$($dialogs.Count)" }
      if ($dialogs.Count -eq 1) { $window = $dialogs[0]; break }
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Native dialog not found under unique AIVORA owner: $ExpectedTitle / $ElectronPid"
    }
    Start-Sleep -Milliseconds 150
  }

  $record.owner_title = $owner.Current.Name
  $record.owner_handle = $owner.Current.NativeWindowHandle
  $record.window_title = $window.Current.Name
  $record.window_handle = $window.Current.NativeWindowHandle
  $contentElements = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  $buttons = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  $descendants = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $descendants) {
    $current = $element.Current
    if ($current.ProcessId -ne $ElectronPid) { continue }
    if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
        $current.AutomationId -eq 'ContentText') {
      [void]$contentElements.Add($element)
    }
    if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Pane -and
        $current.ClassName -eq 'CCPushButton' -and
        $current.Name -eq $ExpectedButtonName -and
        $current.NativeWindowHandle -gt 0 -and
        -not $current.IsOffscreen -and $current.IsEnabled) {
      [void]$buttons.Add($element)
    }
  }
  if ($contentElements.Count -ne 1) { throw "Native ContentText count=$($contentElements.Count)" }
  if ($buttons.Count -ne 1) { throw "Native confirm CCPushButton Pane count=$($buttons.Count)" }
  $visibleText = $contentElements[0].Current.Name
  $record.visible_text = $visibleText
  $record.project_id = Get-UniqueField $visibleText '(?m)^\u9879\u76ee\uff1a(prj_[0-9a-f]{32})\r?$' 'project ID'
  $record.version_id = Get-UniqueField $visibleText '(?m)^\u7248\u672c\uff1a(ver_[0-9a-f]{32})\r?$' 'version ID'
  $record.content_hash = Get-UniqueField $visibleText '(?m)^\u6765\u6e90\u5185\u5bb9 hash\uff1a(sha256:[0-9a-f]{64})\r?$' 'source content hash'
  $record.action = Get-UniqueField $visibleText '(?m)^Gate\uff1a[A-Za-z0-9]+\uff1b\u52a8\u4f5c\uff1a([a-z]+)\r?$' 'action'
  if ($record.action -cne $ExpectedAction) { throw "Native action mismatch: $($record.action)" }
  if ($ProjectId -and $record.project_id -cne $ProjectId) { throw 'Native project ID mismatch' }
  if ($VersionId -and $record.version_id -cne $VersionId) { throw 'Native version ID mismatch' }
  if ($ContentHash -and $record.content_hash -cne $ContentHash) { throw 'Native source content hash mismatch' }

  $button = $buttons[0]
  $record.button_name = $button.Current.Name
  $record.button_handle = $button.Current.NativeWindowHandle
  [object]$patternObject = $null
  $available = $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$patternObject)
  if (-not $available -or $null -eq $patternObject) {
    $record.status = 'NO_INVOKE_PATTERN'
    throw 'Native confirm Pane has no InvokePattern'
  }
  $record.invoke_pattern_available = $true
  $pattern = [System.Windows.Automation.InvokePattern]$patternObject
  $record.status = 'READY_TO_INVOKE'
  $record.invoke_attempted = $true
  Write-Evidence
  $pattern.Invoke()
  $record.invoked = $true
  $record.status = 'INVOKE_RETURNED'
  Write-Evidence
  Write-Output ('EVIDENCE=' + $EvidencePath)
} catch {
  $record.error = $_.Exception.ToString()
  if ($record.invoke_attempted) {
    $record.status = 'UNKNOWN_AFTER_INVOKE_ATTEMPT'
  } elseif ($record.status -ne 'NO_INVOKE_PATTERN') {
    $record.status = 'REJECTED_BEFORE_INVOKE'
  }
  Write-Evidence
  throw
}
