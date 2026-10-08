param(
  [Parameter(Mandatory=$true)][int]$MainPid,
  [Parameter(Mandatory=$true)][string]$ExpectedTitle,
  [Parameter(Mandatory=$true)][string]$ExpectedButtonName,
  [Parameter(Mandatory=$true)][ValidateSet('submit','signoff','decision')][string]$ExpectedAction,
  [Parameter(Mandatory=$true)][ValidatePattern('^prj_[0-9a-f]{32}$')][string]$ProjectId,
  [Parameter(Mandatory=$true)][ValidatePattern('^ver_[0-9a-f]{32}$')][string]$VersionId,
  [Parameter(Mandatory=$true)][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ContentHash,
  [ValidateRange(0,30)][int]$TimeoutSeconds = 20,
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
if ([IO.File]::Exists($EvidencePath)) { throw "Evidence already exists: $EvidencePath" }
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Evidence {
  $record.updated_utc = [DateTime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($EvidencePath, ($record | ConvertTo-Json -Depth 6), $utf8)
}
function Get-UniqueField([string]$text, [string]$pattern, [string]$label) {
  $matches = [regex]::Matches($text, $pattern, [Text.RegularExpressions.RegexOptions]::Multiline)
  if ($matches.Count -ne 1) { throw "Native $label count=$($matches.Count)" }
  return $matches[0].Groups[1].Value
}
$record = [ordered]@{
  started_utc = [DateTime]::UtcNow.ToString('o')
  updated_utc = $null
  read_only = $true
  native_action_attempted = $false
  main_pid = $MainPid
  expected_title = $ExpectedTitle
  expected_button_name = $ExpectedButtonName
  expected_action = $ExpectedAction
  expected_project_id = $ProjectId
  expected_version_id = $VersionId
  expected_content_hash = $ContentHash
  owner = $null
  dialog = $null
  button = $null
  identity = $null
  supported_patterns = $null
  win32 = $null
  msaa = $null
  stability = $null
  status = 'STARTED'
  error = $null
}
try {
  if ($MainPid -le 0) { throw 'Main PID must be positive' }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName Accessibility
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeReadOnly {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("oleacc.dll", PreserveSig=true)]
  public static extern int AccessibleObjectFromWindow(
    IntPtr hwnd, uint objectId, ref Guid iid,
    [MarshalAs(UnmanagedType.Interface)] out object accessible);
}
'@
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $owner = $null
  $dialog = $null
  while ($true) {
    $owners = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
    $top = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($candidate in $top) {
      $current = $candidate.Current
      if ($current.ProcessId -eq $MainPid -and
          $current.Name -eq 'AIVORA' -and
          $current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
          $current.ClassName -eq 'Chrome_WidgetWin_1' -and
          $current.NativeWindowHandle -gt 0) {
        [void]$owners.Add($candidate)
      }
    }
    if ($owners.Count -gt 1) { throw "AIVORA owner count=$($owners.Count)" }
    if ($owners.Count -eq 1) {
      $owner = $owners[0]
      $dialogs = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
      $descendants = $owner.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      foreach ($candidate in $descendants) {
        $current = $candidate.Current
        if ($current.ProcessId -eq $MainPid -and
            $current.Name -eq $ExpectedTitle -and
            $current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
            $current.ClassName -eq '#32770' -and
            $current.NativeWindowHandle -gt 0 -and
            -not $current.IsOffscreen -and $current.IsEnabled) {
          [void]$dialogs.Add($candidate)
        }
      }
      if ($dialogs.Count -gt 1) { throw "Native dialog count=$($dialogs.Count)" }
      if ($dialogs.Count -eq 1) { $dialog = $dialogs[0]; break }
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Native dialog not found under unique AIVORA owner: $ExpectedTitle / $MainPid"
    }
    Start-Sleep -Milliseconds 150
  }
  $record.owner = [ordered]@{
    name = $owner.Current.Name
    pid = $owner.Current.ProcessId
    handle = $owner.Current.NativeWindowHandle
    class_name = $owner.Current.ClassName
  }
  $record.dialog = [ordered]@{
    name = $dialog.Current.Name
    pid = $dialog.Current.ProcessId
    handle = $dialog.Current.NativeWindowHandle
    class_name = $dialog.Current.ClassName
  }
  $contents = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  $buttons = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  $descendants = $dialog.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $descendants) {
    $current = $element.Current
    if ($current.ProcessId -ne $MainPid) { continue }
    if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
        $current.AutomationId -eq 'ContentText') {
      [void]$contents.Add($element)
    }
    if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Pane -and
        $current.ClassName -eq 'CCPushButton' -and
        $current.Name -eq $ExpectedButtonName -and
        $current.NativeWindowHandle -gt 0 -and
        -not $current.IsOffscreen -and $current.IsEnabled) {
      [void]$buttons.Add($element)
    }
  }
  if ($contents.Count -ne 1) { throw "ContentText count=$($contents.Count)" }
  if ($buttons.Count -ne 1) { throw "Confirm CCPushButton Pane count=$($buttons.Count)" }
  $visibleText = $contents[0].Current.Name
  $identity = [ordered]@{
    project_id = Get-UniqueField $visibleText '(?m)^\u9879\u76ee\uff1a(prj_[0-9a-f]{32})\r?$' 'project ID'
    version_id = Get-UniqueField $visibleText '(?m)^\u7248\u672c\uff1a(ver_[0-9a-f]{32})\r?$' 'version ID'
    content_hash = Get-UniqueField $visibleText '(?m)^\u6765\u6e90\u5185\u5bb9 hash\uff1a(sha256:[0-9a-f]{64})\r?$' 'source content hash'
    action = Get-UniqueField $visibleText '(?m)^Gate\uff1a[A-Za-z0-9]+\uff1b\u52a8\u4f5c\uff1a([a-z]+)\r?$' 'action'
    visible_text = $visibleText
  }
  $record.identity = $identity
  if ($identity.action -cne $ExpectedAction) { throw 'Native action mismatch' }
  if ($identity.project_id -cne $ProjectId) { throw 'Native project ID mismatch' }
  if ($identity.version_id -cne $VersionId) { throw 'Native version ID mismatch' }
  if ($identity.content_hash -cne $ContentHash) { throw 'Native source hash mismatch' }
  $button = $buttons[0]
  $buttonHwnd = [IntPtr]$button.Current.NativeWindowHandle
  $record.button = [ordered]@{
    name = $button.Current.Name
    pid = $button.Current.ProcessId
    handle = $button.Current.NativeWindowHandle
    class_name = $button.Current.ClassName
    expected_class_name = 'CCPushButton'
    control_type = $button.Current.ControlType.ProgrammaticName
    automation_id = $button.Current.AutomationId
    is_enabled = $button.Current.IsEnabled
    is_offscreen = $button.Current.IsOffscreen
  }
  $patterns = @($button.GetSupportedPatterns() | ForEach-Object {
    [ordered]@{ id = $_.Id; name = $_.ProgrammaticName }
  })
  if (@($patterns | Group-Object id | Where-Object Count -gt 1).Count) {
    throw 'Duplicate supported UIA pattern IDs'
  }
  $record.supported_patterns = $patterns
  [uint32]$winPid = 0
  $threadId = [NativeReadOnly]::GetWindowThreadProcessId($buttonHwnd, [ref]$winPid)
  $classBuffer = New-Object System.Text.StringBuilder -ArgumentList 256
  $classLength = [NativeReadOnly]::GetClassName($buttonHwnd, $classBuffer, $classBuffer.Capacity)
  $parent = [NativeReadOnly]::GetParent($buttonHwnd)
  $record.win32 = [ordered]@{
    is_window = [NativeReadOnly]::IsWindow($buttonHwnd)
    pid = $winPid
    thread_id = $threadId
    class_name = $classBuffer.ToString()
    expected_class_name = 'Button'
    class_length = $classLength
    control_id = [NativeReadOnly]::GetDlgCtrlID($buttonHwnd)
    parent_handle = $parent.ToInt64()
    child_of_dialog = [NativeReadOnly]::IsChild([IntPtr]$dialog.Current.NativeWindowHandle, $buttonHwnd)
  }
  if (-not $record.win32.is_window -or $winPid -ne $MainPid -or
      $threadId -eq 0 -or $classLength -le 0 -or
      $record.win32.class_name -cne 'Button' -or
      -not $record.win32.child_of_dialog) {
    throw 'Win32 button handle/owner mismatch'
  }
  $record.stability = [ordered]@{
    owner_handle = $record.owner.handle
    dialog_handle = $record.dialog.handle
    button_handle = $record.button.handle
    after_msaa = $null
  }
  if ($owner.Current.NativeWindowHandle -ne $record.owner.handle -or
      $dialog.Current.NativeWindowHandle -ne $record.dialog.handle -or
      $button.Current.NativeWindowHandle -ne $record.button.handle -or
      $owner.Current.ProcessId -ne $MainPid -or
      $dialog.Current.ProcessId -ne $MainPid -or
      $button.Current.ProcessId -ne $MainPid -or
      -not [NativeReadOnly]::IsWindow([IntPtr]$record.owner.handle) -or
      -not [NativeReadOnly]::IsWindow([IntPtr]$record.dialog.handle)) {
    throw 'UIA owner/dialog/button handle or PID changed before MSAA read'
  }
  $iid = [Accessibility.IAccessible].GUID
  [object]$accessible = $null
  $hr = [NativeReadOnly]::AccessibleObjectFromWindow(
    $buttonHwnd, [uint32]4294967292, [ref]$iid, [ref]$accessible
  )
  $record.msaa = [ordered]@{ hresult = $hr; name = $null; role = $null; state = $null; default_action = $null }
  if ($hr -ne 0 -or $null -eq $accessible) { throw "MSAA IAccessible unavailable: HRESULT=$hr" }
  $msaa = [Accessibility.IAccessible]$accessible
  $record.msaa.name = $msaa.get_accName(0)
  $record.msaa.role = [int]$msaa.get_accRole(0)
  $record.msaa.state = [int]$msaa.get_accState(0)
  $record.msaa.default_action = $msaa.get_accDefaultAction(0)
  if ($record.msaa.name -cne $ExpectedButtonName) { throw 'MSAA button name mismatch' }
  if ($record.msaa.role -ne [int][System.Windows.Forms.AccessibleRole]::PushButton) {
    throw 'MSAA button role mismatch'
  }
  $blockedStates = [int][System.Windows.Forms.AccessibleStates]::Unavailable -bor
    [int][System.Windows.Forms.AccessibleStates]::Invisible -bor
    [int][System.Windows.Forms.AccessibleStates]::Offscreen
  if (($record.msaa.state -band $blockedStates) -ne 0) { throw 'MSAA button unavailable or hidden' }
  if ($record.msaa.default_action -isnot [string] -or
      [string]::IsNullOrWhiteSpace($record.msaa.default_action)) {
    throw 'MSAA button default action missing'
  }
  [uint32]$afterWinPid = 0
  $afterThreadId = [NativeReadOnly]::GetWindowThreadProcessId($buttonHwnd, [ref]$afterWinPid)
  $record.stability.after_msaa = [ordered]@{
    owner_handle = $owner.Current.NativeWindowHandle
    dialog_handle = $dialog.Current.NativeWindowHandle
    button_handle = $button.Current.NativeWindowHandle
    owner_pid = $owner.Current.ProcessId
    dialog_pid = $dialog.Current.ProcessId
    button_pid = $button.Current.ProcessId
    win32_button_pid = $afterWinPid
    win32_button_thread_id = $afterThreadId
    owner_is_window = [NativeReadOnly]::IsWindow([IntPtr]$record.owner.handle)
    dialog_is_window = [NativeReadOnly]::IsWindow([IntPtr]$record.dialog.handle)
    button_is_window = [NativeReadOnly]::IsWindow($buttonHwnd)
    button_is_child_of_dialog = [NativeReadOnly]::IsChild([IntPtr]$record.dialog.handle, $buttonHwnd)
  }
  if ($record.stability.after_msaa.owner_handle -ne $record.owner.handle -or
      $record.stability.after_msaa.dialog_handle -ne $record.dialog.handle -or
      $record.stability.after_msaa.button_handle -ne $record.button.handle -or
      $record.stability.after_msaa.owner_pid -ne $MainPid -or
      $record.stability.after_msaa.dialog_pid -ne $MainPid -or
      $record.stability.after_msaa.button_pid -ne $MainPid -or
      $afterWinPid -ne $MainPid -or $afterThreadId -eq 0 -or
      -not $record.stability.after_msaa.owner_is_window -or
      -not $record.stability.after_msaa.dialog_is_window -or
      -not $record.stability.after_msaa.button_is_window -or
      -not $record.stability.after_msaa.button_is_child_of_dialog) {
    throw 'UIA/Win32 handle, PID, or dialog ancestry changed after MSAA read'
  }
  $record.status = 'READ_ONLY_CAPABILITY_OBSERVED'
  Write-Evidence
  Write-Output ('EVIDENCE=' + $EvidencePath)
} catch {
  $record.status = 'STOP_READ_ONLY_PROBE'
  $record.error = $_.Exception.ToString()
  Write-Evidence
  throw
}
