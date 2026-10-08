$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DesktopReadOnly {
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll", EntryPoint="GetUserObjectInformationW", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, uint bufferBytes, out uint bytesNeeded);
}
'@
function Describe-Desktop([uint32]$threadId) {
  $handle = [DesktopReadOnly]::GetThreadDesktop($threadId)
  $result = [ordered]@{thread_id=$threadId;desktop_handle=$handle.ToInt64();desktop_name=$null;read_succeeded=$false;last_error=$null}
  if ($handle -eq [IntPtr]::Zero) { $result.last_error=[Runtime.InteropServices.Marshal]::GetLastWin32Error(); return $result }
  $buffer = New-Object System.Text.StringBuilder -ArgumentList 256
  [uint32]$needed = 0
  $result.read_succeeded = [DesktopReadOnly]::GetUserObjectInformation($handle, 2, $buffer, [uint32]512, [ref]$needed)
  if ($result.read_succeeded) { $result.desktop_name=$buffer.ToString() }
  else { $result.last_error=[Runtime.InteropServices.Marshal]::GetLastWin32Error() }
  return $result
}
$record=[ordered]@{
  checked_utc=[DateTime]::UtcNow.ToString('o')
  probe_pid=$PID
  probe_session_id=(Get-Process -Id $PID).SessionId
  probe_thread=Describe-Desktop ([DesktopReadOnly]::GetCurrentThreadId())
  vmware_pid=9656
  vmware_session_id=(Get-Process -Id 9656).SessionId
  vmware_window_thread=Describe-Desktop ([uint32]9924)
  historical_aivora_desktop_proven=$false
}
$record | ConvertTo-Json -Depth 5
