$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ReadOnlyWindowProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flag);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetClassName(IntPtr hwnd, StringBuilder value, int capacity);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int capacity);
}
'@
function Describe-Window([long]$value) {
  $handle = [IntPtr]$value
  $exists = [ReadOnlyWindowProbe]::IsWindow($handle)
  $result = [ordered]@{ handle=$value; is_window=$exists; pid=$null; thread_id=$null; class_name=$null; title=$null; root=$null; root_owner=$null; owner=$null; process_name=$null; process_session_id=$null }
  if (-not $exists) { return $result }
  [uint32]$pid = 0
  $result.thread_id = [ReadOnlyWindowProbe]::GetWindowThreadProcessId($handle, [ref]$pid)
  $result.pid = $pid
  $class = New-Object System.Text.StringBuilder -ArgumentList 256
  [void][ReadOnlyWindowProbe]::GetClassName($handle, $class, $class.Capacity)
  $result.class_name = $class.ToString()
  $title = New-Object System.Text.StringBuilder -ArgumentList 256
  [void][ReadOnlyWindowProbe]::GetWindowText($handle, $title, $title.Capacity)
  $result.title = $title.ToString()
  $result.root = [ReadOnlyWindowProbe]::GetAncestor($handle, [uint32]2).ToInt64()
  $result.root_owner = [ReadOnlyWindowProbe]::GetAncestor($handle, [uint32]3).ToInt64()
  $result.owner = [ReadOnlyWindowProbe]::GetWindow($handle, [uint32]4).ToInt64()
  $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($process) { $result.process_name = $process.ProcessName; $result.process_session_id = $process.SessionId }
  return $result
}
$captured = 262296
$current = [ReadOnlyWindowProbe]::GetForegroundWindow().ToInt64()
$record = [ordered]@{
  checked_utc = [DateTime]::UtcNow.ToString('o')
  probe_process_id = $PID
  probe_session_id = (Get-Process -Id $PID).SessionId
  captured_foreground_at_attempt = $captured
  captured_handle_now = Describe-Window $captured
  current_foreground = Describe-Window $current
  historical_owner_proven = $false
  note = 'Current handles can be destroyed or reused; this probe cannot establish ownership at the earlier attempt.'
}
$record | ConvertTo-Json -Depth 6
