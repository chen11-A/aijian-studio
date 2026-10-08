param(
  [Parameter(Mandatory=$true)][int]$MainPid,
  [Parameter(Mandatory=$true)][string]$ExpectedTitle,
  [Parameter(Mandatory=$true)][string]$ExpectedButtonName,
  [Parameter(Mandatory=$true)][ValidateSet('G1')][string]$ExpectedGate,
  [Parameter(Mandatory=$true)][ValidateSet('submit')][string]$ExpectedAction,
  [Parameter(Mandatory=$true)][ValidatePattern('^prj_[0-9a-f]{32}$')][string]$ProjectId,
  [Parameter(Mandatory=$true)][ValidatePattern('^ver_[0-9a-f]{32}$')][string]$VersionId,
  [Parameter(Mandatory=$true)][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ContentHash,
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ExpectedRevision,
  [Parameter(Mandatory=$true)][ValidateRange(0,2147483647)][int]$ExpectedReviewEvidenceRevision,
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
function Get-NativeRevisions([string]$text) {
  $currentLabels = [regex]::Matches($text, '(?m)^\u5f53\u524d\u4fee\u8ba2\uff1a')
  $evidenceLabels = [regex]::Matches($text, '\u8bc4\u5ba1\u8bc1\u636e\u4fee\u8ba2\uff1a')
  if ($currentLabels.Count -ne 1 -or $evidenceLabels.Count -ne 1) {
    throw "Native revision label counts=$($currentLabels.Count)/$($evidenceLabels.Count)"
  }
  $line = [regex]::Matches($text,
    '(?m)^\u5f53\u524d\u4fee\u8ba2\uff1a([1-9][0-9]*)\uff1b\u8bc4\u5ba1\u8bc1\u636e\u4fee\u8ba2\uff1a(0|[1-9][0-9]*)\r?$')
  if ($line.Count -ne 1) { throw "Native revision line count=$($line.Count)" }
  return [ordered]@{
    revision = [int]$line[0].Groups[1].Value
    review_evidence_revision = [int]$line[0].Groups[2].Value
  }
}
function Get-NativeGateAction([string]$text) {
  $gateLabels = [regex]::Matches($text, 'Gate\uff1a')
  $actionLabels = [regex]::Matches($text, '\u52a8\u4f5c\uff1a')
  if ($gateLabels.Count -ne 1 -or $actionLabels.Count -ne 1) {
    throw "Native gate/action label counts=$($gateLabels.Count)/$($actionLabels.Count)"
  }
  $line = [regex]::Matches($text,
    '(?m)^Gate\uff1a([A-Za-z0-9]+)\uff1b\u52a8\u4f5c\uff1a([a-z]+)\r?$')
  if ($line.Count -ne 1) { throw "Native gate/action line count=$($line.Count)" }
  return [ordered]@{
    gate = $line[0].Groups[1].Value
    action = $line[0].Groups[2].Value
  }
}
function Assert-NativeRevisionMatches([int]$Actual, [int]$Expected) {
  if ($Actual -ne $Expected) { throw 'Native source revision mismatch' }
}
function Get-InputObservation {
  $lastInput = New-Object NativeReadOnly+LastInputInfo
  $lastInput.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type]'NativeReadOnly+LastInputInfo')
  if (-not [NativeReadOnly]::GetLastInputInfo([ref]$lastInput)) {
    throw 'GetLastInputInfo failed before native focus'
  }
  $nowLow = [uint32]([NativeReadOnly]::GetTickCount64() -band [uint64]4294967295)
  $idleMs = [uint32]((([uint64]$nowLow + [uint64]4294967296 -
    [uint64]$lastInput.dwTime) % [uint64]4294967296))
  if ($idleMs -gt 86400000) { throw 'Last-input idle duration is unknown' }
  $foreground = [NativeReadOnly]::GetForegroundWindow()
  [uint32]$foregroundPid = 0
  if ($foreground -ne [IntPtr]::Zero) {
    [void][NativeReadOnly]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  }
  return [ordered]@{
    foreground_handle = $foreground.ToInt64()
    foreground_pid = $foregroundPid
    last_input_tick = $lastInput.dwTime
    idle_ms = $idleMs
  }
}
$record = [ordered]@{
  started_utc = [DateTime]::UtcNow.ToString('o')
  updated_utc = $null
  read_only = $false
  focus_attempted = $false
  native_action_attempted = $false
  main_pid = $MainPid
  expected_title = $ExpectedTitle
  expected_button_name = $ExpectedButtonName
  expected_gate = $ExpectedGate
  expected_action = $ExpectedAction
  expected_project_id = $ProjectId
  expected_version_id = $VersionId
  expected_content_hash = $ContentHash
  expected_revision = $ExpectedRevision
  expected_review_evidence_revision = $ExpectedReviewEvidenceRevision
  owner = $null
  dialog = $null
  dialog_visible_text = $null
  button = $null
  identity = $null
  supported_patterns = $null
  win32 = $null
  stability = $null
  focus = $null
  send = $null
  status = 'STARTED'
  error = $null
}
try {
  if ($MainPid -le 0) { throw 'Main PID must be positive' }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeReadOnly {
  [StructLayout(LayoutKind.Sequential)]
  public struct LastInputInfo { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetLastInputInfo(ref LastInputInfo info);
  [DllImport("kernel32.dll")]
  public static extern ulong GetTickCount64();
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
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetForegroundWindow(IntPtr hwnd);
  // https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam,
    uint flags, uint timeoutMs, out IntPtr messageResult);
  [DllImport("kernel32.dll")]
  public static extern void SetLastError(uint error);
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
  $record.dialog_visible_text = $visibleText
  Write-Evidence
  $revisions = Get-NativeRevisions $visibleText
  $gateAction = Get-NativeGateAction $visibleText
  $identity = [ordered]@{
    project_id = Get-UniqueField $visibleText '(?m)^\u9879\u76ee\uff1a(prj_[0-9a-f]{32})\r?$' 'project ID'
    version_id = Get-UniqueField $visibleText '(?m)^\u7248\u672c\uff1a(ver_[0-9a-f]{32})\r?$' 'version ID'
    content_hash = Get-UniqueField $visibleText '(?m)^\u6765\u6e90\u5185\u5bb9 hash\uff1a(sha256:[0-9a-f]{64})\r?$' 'source content hash'
    gate = $gateAction.gate
    action = $gateAction.action
    revision = $revisions.revision
    review_evidence_revision = $revisions.review_evidence_revision
    visible_text = $visibleText
  }
  $record.identity = $identity
  if ($identity.gate -cne $ExpectedGate) { throw 'Native gate mismatch' }
  if ($identity.action -cne $ExpectedAction) { throw 'Native action mismatch' }
  if ($identity.project_id -cne $ProjectId) { throw 'Native project ID mismatch' }
  if ($identity.version_id -cne $VersionId) { throw 'Native version ID mismatch' }
  if ($identity.content_hash -cne $ContentHash) { throw 'Native source hash mismatch' }
  Assert-NativeRevisionMatches $identity.revision $ExpectedRevision
  if ($identity.review_evidence_revision -ne $ExpectedReviewEvidenceRevision) {
    throw 'Native review evidence revision mismatch'
  }
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
  $dialogHwnd = [IntPtr]$record.dialog.handle
  $foregroundBefore = [NativeReadOnly]::GetForegroundWindow()
  if ($foregroundBefore -eq $dialogHwnd) {
    $record.focus = [ordered]@{
      status = 'ALREADY_FOREGROUND_NO_CALL'
      target_handle = $record.dialog.handle
      before = Get-InputObservation
      after = $null
      api_return = $null
    }
    Write-Evidence
  } else {
    # Give recent user input time to settle; never interfere with an active user.
    Start-Sleep -Milliseconds 5000
    $before1 = Get-InputObservation
    Start-Sleep -Milliseconds 250
    $before2 = Get-InputObservation
    if ($before1.foreground_handle -ne $before2.foreground_handle -or
        $before1.last_input_tick -ne $before2.last_input_tick -or
        $before2.idle_ms -lt 5000 -or
        $before2.foreground_handle -eq 0) {
      throw 'Foreground or user input not idle and stable before native focus'
    }
    if ($before2.foreground_handle -eq $record.dialog.handle) {
      throw 'Dialog foreground changed during native focus preflight'
    }
    $record.focus_attempted = $true
    $record.focus = [ordered]@{
      status = 'FOCUS_ARMED_OUTCOME_UNKNOWN'
      target_handle = $record.dialog.handle
      before = $before2
      after = $null
      api_return = $null
      last_error = $null
      call_index = 1
    }
    $record.status = 'FOCUS_ARMED_OUTCOME_UNKNOWN'
    Write-Evidence
    $focusReturn = [NativeReadOnly]::SetForegroundWindow($dialogHwnd)
    $focusLastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Start-Sleep -Milliseconds 250
    $after1 = Get-InputObservation
    Start-Sleep -Milliseconds 250
    $after2 = Get-InputObservation
    $record.focus.api_return = $focusReturn
    $record.focus.last_error = $focusLastError
    $record.focus.after = [ordered]@{ first = $after1; second = $after2 }
    $record.focus.status = 'FOCUS_RETURNED_RECHECK_REQUIRED'
    Write-Evidence
    if (-not $focusReturn -or
        $after1.foreground_handle -ne $record.dialog.handle -or
        $after2.foreground_handle -ne $record.dialog.handle -or
        $after1.foreground_pid -ne $MainPid -or
        $after2.foreground_pid -ne $MainPid -or
        $before2.last_input_tick -ne $after1.last_input_tick -or
        $before2.last_input_tick -ne $after2.last_input_tick) {
      throw 'Windows denied native focus or foreground/input changed after one call'
    }
    $record.focus.status = 'FOCUS_CONFIRMED'
    Write-Evidence
  }
  if ($owner.Current.ProcessId -ne $MainPid -or
      $owner.Current.NativeWindowHandle -ne $record.owner.handle -or
      $owner.Current.Name -cne 'AIVORA' -or
      $dialog.Current.ProcessId -ne $MainPid -or
      $dialog.Current.NativeWindowHandle -ne $record.dialog.handle -or
      $dialog.Current.Name -cne $ExpectedTitle -or
      $dialog.Current.IsOffscreen -or -not $dialog.Current.IsEnabled -or
      $contents[0].Current.Name -cne $visibleText -or
      $button.Current.ProcessId -ne $MainPid -or
      $button.Current.NativeWindowHandle -ne $record.button.handle -or
      $button.Current.Name -cne $ExpectedButtonName -or
      $button.Current.IsOffscreen -or -not $button.Current.IsEnabled -or
      -not [NativeReadOnly]::IsChild($dialogHwnd, $buttonHwnd)) {
    throw 'Native dialog or identity changed after focus'
  }
  $record.stability = [ordered]@{
    owner_handle = $record.owner.handle
    dialog_handle = $record.dialog.handle
    button_handle = $record.button.handle
    before_send = $null
  }
  [uint32]$finalWinPid = 0
  $finalThreadId = [NativeReadOnly]::GetWindowThreadProcessId($buttonHwnd, [ref]$finalWinPid)
  $finalClass = New-Object System.Text.StringBuilder -ArgumentList 256
  $finalClassLength = [NativeReadOnly]::GetClassName($buttonHwnd, $finalClass, $finalClass.Capacity)
  $record.stability.before_send = [ordered]@{
    owner_handle = $owner.Current.NativeWindowHandle
    dialog_handle = $dialog.Current.NativeWindowHandle
    button_handle = $button.Current.NativeWindowHandle
    owner_pid = $owner.Current.ProcessId
    dialog_pid = $dialog.Current.ProcessId
    button_pid = $button.Current.ProcessId
    win32_button_pid = $finalWinPid
    win32_button_thread_id = $finalThreadId
    win32_button_class = $finalClass.ToString()
    win32_button_class_length = $finalClassLength
    owner_is_window = [NativeReadOnly]::IsWindow([IntPtr]$record.owner.handle)
    dialog_is_window = [NativeReadOnly]::IsWindow([IntPtr]$record.dialog.handle)
    button_is_window = [NativeReadOnly]::IsWindow($buttonHwnd)
    button_is_child_of_dialog = [NativeReadOnly]::IsChild([IntPtr]$record.dialog.handle, $buttonHwnd)
    dialog_is_enabled = [NativeReadOnly]::IsWindowEnabled([IntPtr]$record.dialog.handle)
    button_is_enabled = [NativeReadOnly]::IsWindowEnabled($buttonHwnd)
    dialog_is_visible = [NativeReadOnly]::IsWindowVisible([IntPtr]$record.dialog.handle)
    button_is_visible = [NativeReadOnly]::IsWindowVisible($buttonHwnd)
    button_uia_is_enabled = $button.Current.IsEnabled
    button_uia_is_offscreen = $button.Current.IsOffscreen
    foreground_handle = [NativeReadOnly]::GetForegroundWindow().ToInt64()
  }
  # A non-active dialog can make BM_CLICK fail; never change product focus here.
  # https://learn.microsoft.com/en-us/windows/win32/controls/bm-click
  # https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow
  $gate = $record.stability.before_send
  if ($gate.owner_handle -ne $record.owner.handle -or
      $gate.dialog_handle -ne $record.dialog.handle -or
      $gate.button_handle -ne $record.button.handle -or
      $gate.owner_pid -ne $MainPid -or
      $gate.dialog_pid -ne $MainPid -or
      $gate.button_pid -ne $MainPid -or
      $gate.win32_button_pid -ne $MainPid -or
      $gate.win32_button_thread_id -eq 0 -or
      $gate.win32_button_class -cne 'Button' -or
      $gate.win32_button_class_length -ne 6 -or
      -not $gate.owner_is_window -or
      -not $gate.dialog_is_window -or
      -not $gate.button_is_window -or
      -not $gate.button_is_child_of_dialog -or
      -not $gate.dialog_is_enabled -or
      -not $gate.button_is_enabled -or
      -not $gate.dialog_is_visible -or
      -not $gate.button_is_visible -or
      -not $gate.button_uia_is_enabled -or
      $gate.button_uia_is_offscreen -or
      $gate.foreground_handle -ne $record.dialog.handle) {
    throw 'Native handle, PID, child, visibility, enabled, or foreground gate failed'
  }
  # A durable intent record makes an interrupted send an UNKNOWN, never a retry.
  $record.native_action_attempted = $true
  $record.send = [ordered]@{
    method = 'SendMessageTimeoutW'
    target_handle = $buttonHwnd.ToInt64()
    message = 245 # BM_CLICK (0x00F5); wParam/lParam are zero.
    flags = 35 # SMTO_BLOCK | SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT.
    timeout_ms = 5000
    attempt_index = 1
    status = 'ARMED_OUTCOME_UNKNOWN'
    api_return = $null
    message_result = $null
    last_error = $null
  }
  $record.status = 'ARMED_OUTCOME_UNKNOWN'
  Write-Evidence
  [uint32]$lastPid = 0
  [void][NativeReadOnly]::GetWindowThreadProcessId($buttonHwnd, [ref]$lastPid)
  if (-not [NativeReadOnly]::IsWindow($buttonHwnd) -or
      $lastPid -ne $MainPid -or
      -not [NativeReadOnly]::IsChild([IntPtr]$record.dialog.handle, $buttonHwnd) -or
      [NativeReadOnly]::GetForegroundWindow().ToInt64() -ne $record.dialog.handle) {
    throw 'Final native handle or foreground gate changed after intent record'
  }
  [NativeReadOnly]::SetLastError(0)
  $messageResult = [IntPtr]::Zero
  $apiReturn = [NativeReadOnly]::SendMessageTimeout(
    $buttonHwnd, [uint32]245, [IntPtr]::Zero, [IntPtr]::Zero,
    [uint32]35, [uint32]5000, [ref]$messageResult
  )
  $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  $record.send.api_return = $apiReturn.ToInt64()
  $record.send.message_result = $messageResult.ToInt64()
  $record.send.last_error = $lastError
  $record.send.status = if ($apiReturn -eq [IntPtr]::Zero) { 'CALL_FAILED_OR_TIMED_OUT' } else { 'CALL_RETURNED' }
  $record.status = if ($apiReturn -eq [IntPtr]::Zero) { 'UNKNOWN_AFTER_SEND' } else { 'SEND_RETURNED_BUSINESS_UNVERIFIED' }
  Write-Evidence
  if ($apiReturn -eq [IntPtr]::Zero) { throw 'SendMessageTimeout failed or timed out; business outcome unknown' }
  Write-Output ('EVIDENCE=' + $EvidencePath)
} catch {
  if (-not $record.native_action_attempted) {
    $record.status = if ($record.focus_attempted) {
      'STOP_AFTER_FOCUS_BEFORE_NATIVE_SEND'
    } else {
      'STOP_BEFORE_NATIVE_SEND'
    }
  } else {
    $record.status = 'UNKNOWN_AFTER_SEND'
  }
  $record.error = $_.Exception.ToString()
  Write-Evidence
  throw
}
