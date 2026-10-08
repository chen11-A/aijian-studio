param(
  [Parameter(Mandatory=$true)][int]$ExpectedPid,
  [Parameter(Mandatory=$true)][long]$ExpectedHwnd,
  [Parameter(Mandatory=$true)][string]$RepoPath,
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
if ([IO.File]::Exists($EvidencePath)) { throw "Evidence already exists: $EvidencePath" }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FocusReadOnly {
  [StructLayout(LayoutKind.Sequential)] public struct LastInputInfo { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetLastInputInfo(ref LastInputInfo info);
  [DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetClassName(IntPtr hwnd, StringBuilder value, int capacity);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int capacity);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flag);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll", EntryPoint="GetUserObjectInformationW", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, uint bufferBytes, out uint bytesNeeded);
}
'@
function Desktop-Name([uint32]$threadId) {
  if ($threadId -eq 0) { return $null }
  $desktop = [FocusReadOnly]::GetThreadDesktop($threadId)
  if ($desktop -eq [IntPtr]::Zero) { return $null }
  $buffer = New-Object System.Text.StringBuilder -ArgumentList 256
  [uint32]$needed = 0
  if (-not [FocusReadOnly]::GetUserObjectInformation($desktop, 2, $buffer, 512, [ref]$needed)) { return $null }
  return $buffer.ToString()
}
function Describe-Window([long]$value) {
  $handle = [IntPtr]$value
  $valid = [FocusReadOnly]::IsWindow($handle)
  $record = [ordered]@{handle=$value;is_window=$valid;pid=$null;thread_id=$null;class_name=$null;title=$null;root=$null;root_owner=$null;owner=$null;desktop_name=$null;session_id=$null;process_name=$null}
  if (-not $valid) { return $record }
  [uint32]$windowPid = 0
  $threadId = [FocusReadOnly]::GetWindowThreadProcessId($handle, [ref]$windowPid)
  $record.pid = $windowPid
  $record.thread_id = $threadId
  $class = New-Object System.Text.StringBuilder -ArgumentList 256
  [void][FocusReadOnly]::GetClassName($handle, $class, $class.Capacity)
  $record.class_name = $class.ToString()
  $title = New-Object System.Text.StringBuilder -ArgumentList 512
  [void][FocusReadOnly]::GetWindowText($handle, $title, $title.Capacity)
  $record.title = $title.ToString()
  $record.root = [FocusReadOnly]::GetAncestor($handle, 2).ToInt64()
  $record.root_owner = [FocusReadOnly]::GetAncestor($handle, 3).ToInt64()
  $record.owner = [FocusReadOnly]::GetWindow($handle, 4).ToInt64()
  $record.desktop_name = Desktop-Name $threadId
  $process = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
  if ($process) { $record.session_id = $process.SessionId; $record.process_name = $process.ProcessName }
  return $record
}
function Get-IdleMilliseconds([uint64]$nowTick, [uint32]$lastInputTick) {
  $nowLow = [uint32]($nowTick -band [uint64]4294967295)
  $idleDelta = [uint32]((([uint64]$nowLow + [uint64]4294967296 - [uint64]$lastInputTick) % [uint64]4294967296))
  if ($idleDelta -gt 86400000) { return $null }
  return $idleDelta
}
$lastInput = New-Object FocusReadOnly+LastInputInfo
$lastInput.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type]'FocusReadOnly+LastInputInfo')
if (-not [FocusReadOnly]::GetLastInputInfo([ref]$lastInput)) { throw 'GetLastInputInfo failed' }
$idleMs = Get-IdleMilliseconds ([FocusReadOnly]::GetTickCount64()) $lastInput.dwTime
$foreground = [FocusReadOnly]::GetForegroundWindow().ToInt64()
$repoPrefix = [IO.Path]::GetFullPath($RepoPath).TrimEnd('\') + '\'
$related = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and $_.ExecutablePath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { [ordered]@{pid=$_.ProcessId;name=$_.Name;executable_path=$_.ExecutablePath} })
$expectedProcess = if ($ExpectedPid -gt 0) { Get-Process -Id $ExpectedPid -ErrorAction Stop } else { $null }
$record = [ordered]@{
  checked_utc = [DateTime]::UtcNow.ToString('o')
  probe_pid = $PID
  probe_session_id = (Get-Process -Id $PID).SessionId
  probe_desktop_name = Desktop-Name ([FocusReadOnly]::GetCurrentThreadId())
  last_input_tick = $lastInput.dwTime
  idle_ms = $idleMs
  expected_pid = $ExpectedPid
  expected_session_id = if ($expectedProcess) { $expectedProcess.SessionId } else { $null }
  expected_window = Describe-Window $ExpectedHwnd
  foreground = Describe-Window $foreground
  related_processes = $related
}
$json = $record | ConvertTo-Json -Depth 7
$utf8 = New-Object System.Text.UTF8Encoding($false)
$stream = New-Object System.IO.FileStream($EvidencePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $bytes = $utf8.GetBytes($json + "`n")
  $stream.Write($bytes, 0, $bytes.Length)
} finally { $stream.Dispose() }
Write-Output 'STATE_OK'
