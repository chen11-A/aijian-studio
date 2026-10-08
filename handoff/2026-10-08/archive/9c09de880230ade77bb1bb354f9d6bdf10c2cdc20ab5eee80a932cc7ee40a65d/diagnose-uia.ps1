param(
  [Parameter(Mandatory=$true)][int]$MainPid,
  [Parameter(Mandatory=$true)][string]$EvidencePath,
  [string]$BaselinePath = ''
)
$ErrorActionPreference = 'Stop'
try {
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Describe-Element($element) {
  try {
    $current = $element.Current
    return [ordered]@{
      name = $current.Name
      pid = $current.ProcessId
      handle = $current.NativeWindowHandle
      control_type = $current.ControlType.ProgrammaticName
      class_name = $current.ClassName
      automation_id = $current.AutomationId
      is_offscreen = $current.IsOffscreen
      is_enabled = $current.IsEnabled
    }
  } catch {
    return [ordered]@{ stale_element = $_.Exception.Message }
  }
}

$processes = @(Get-CimInstance Win32_Process)
$owned = @{}
$owned[[string]$MainPid] = $true
do {
  $added = $false
  foreach ($process in $processes) {
    if ($owned.ContainsKey([string]$process.ParentProcessId) -and
        -not $owned.ContainsKey([string]$process.ProcessId)) {
      $owned[[string]$process.ProcessId] = $true
      $added = $true
    }
  }
} while ($added)
$processRows = @($processes | Where-Object { $owned.ContainsKey([string]$_.ProcessId) } |
  Select-Object ProcessId,ParentProcessId,Name,CreationDate)

$baselineHandles = @{}
if ($BaselinePath) {
  $baseline = Get-Content -LiteralPath $BaselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($handle in $baseline.all_top_handles) { $baselineHandles[[string]$handle] = $true }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$top = $root.FindAll([System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition)
$allTopHandles = New-Object System.Collections.Generic.List[int]
$candidateRoots = New-Object System.Collections.Generic.List[object]
foreach ($element in $top) {
  $meta = Describe-Element $element
  if ($meta.Contains('stale_element')) { continue }
  $allTopHandles.Add([int]$meta.handle)
  $isOwned = $owned.ContainsKey([string]$meta.pid)
  $isNew = $BaselinePath -and -not $baselineHandles.ContainsKey([string]$meta.handle)
  if (-not $isOwned -and -not $isNew) { continue }

  $descendants = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  $visible = New-Object System.Collections.Generic.List[object]
  $limit = [Math]::Min($descendants.Count, 2000)
  for ($index = 0; $index -lt $limit; $index++) {
    $child = Describe-Element $descendants.Item($index)
    if ($child.Contains('stale_element')) { continue }
    if (-not $child.is_offscreen -and
        ($child.name -or $child.control_type -eq 'ControlType.Button' -or
         $child.control_type -eq 'ControlType.Window')) {
      $visible.Add($child)
    }
  }
  $candidateRoots.Add([ordered]@{
    top = $meta
    owned_pid = [bool]$isOwned
    new_since_baseline = [bool]$isNew
    descendant_count = $descendants.Count
    scanned_count = $limit
    visible_named_or_button_descendants = $visible.ToArray()
  })
}

$record = [ordered]@{
  captured_utc = [DateTime]::UtcNow.ToString('o')
  main_pid = $MainPid
  process_tree = $processRows
  all_top_count = $top.Count
  all_top_handles = $allTopHandles.ToArray()
  candidate_roots = $candidateRoots.ToArray()
}
$json = $record | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($EvidencePath, $json,
  (New-Object System.Text.UTF8Encoding($false)))
Write-Output "UIA_CAPTURED roots=$($candidateRoots.Count) top=$($top.Count)"
} catch {
  $failure = [ordered]@{
    captured_utc = [DateTime]::UtcNow.ToString('o')
    exception_type = $_.Exception.GetType().FullName
    position_message = $_.InvocationInfo.PositionMessage
    script_stack_trace = $_.ScriptStackTrace
    error_record = $_.ToString()
    exception_string = $_.Exception.ToString()
  }
  $failureJson = $failure | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText("$EvidencePath.failure.json", $failureJson,
    (New-Object System.Text.UTF8Encoding($false)))
  throw
}
