param([Parameter(Mandatory=$true)][string]$EvidencePath)
$ErrorActionPreference = 'Stop'
if ([IO.File]::Exists($EvidencePath)) { throw "Evidence already exists: $EvidencePath" }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing') -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public sealed class MockWin32ButtonForm : Form {
  // https://learn.microsoft.com/en-us/windows/win32/controls/bm-click
  // https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr CreateWindowEx(int exStyle, string className, string title,
    int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
    IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
  [DllImport("user32.dll", SetLastError=true)]
  private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")]
  private static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")]
  private static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)]
  private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message,
    IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result);
  [DllImport("kernel32.dll")]
  private static extern void SetLastError(uint error);

  private IntPtr buttonHwnd;
  public int ClickCount;
  public int SendCount;
  public long ApiReturn;
  public long MessageResult;
  public int LastError;
  public string Error;
  public string ButtonClass;
  public uint ButtonPid;
  public bool IsWindowValue;
  public bool IsChildValue;
  public bool IsEnabledValue;
  public bool IsVisibleValue;
  public long ForegroundHandle;
  public long FormHandle;
  public long ButtonHandle;

  public MockWin32ButtonForm() {
    Text = "QA02 isolated Win32 Button mock";
    Width = 400;
    Height = 180;
    StartPosition = FormStartPosition.CenterScreen;
    TopMost = true;
  }

  protected override void OnShown(EventArgs e) {
    base.OnShown(e);
    FormHandle = Handle.ToInt64();
    buttonHwnd = CreateWindowEx(0, "Button", "Mock confirm", 0x50000000,
      30, 40, 180, 40, Handle, (IntPtr)101, IntPtr.Zero, IntPtr.Zero);
    ButtonHandle = buttonHwnd.ToInt64();
    if (buttonHwnd == IntPtr.Zero) { Error = "CreateWindowEx failed"; Close(); return; }
    Activate();
    ThreadPool.QueueUserWorkItem(_ => {
      try {
        Thread.Sleep(150);
        var name = new StringBuilder(256);
        GetClassName(buttonHwnd, name, name.Capacity);
        ButtonClass = name.ToString();
        uint pid;
        GetWindowThreadProcessId(buttonHwnd, out pid);
        ButtonPid = pid;
        IsWindowValue = IsWindow(buttonHwnd);
        IsChildValue = IsChild((IntPtr)FormHandle, buttonHwnd);
        IsEnabledValue = IsWindowEnabled(buttonHwnd);
        IsVisibleValue = IsWindowVisible(buttonHwnd);
        ForegroundHandle = GetForegroundWindow().ToInt64();
        if (ButtonClass != "Button" || !IsWindowValue || !IsChildValue ||
            !IsEnabledValue || !IsVisibleValue) {
          Error = "Mock pre-send handle gate failed";
          return;
        }
        IntPtr messageResult;
        SetLastError(0);
        SendCount = 1;
        ApiReturn = SendMessageTimeout(buttonHwnd, 245, IntPtr.Zero, IntPtr.Zero,
          35, 5000, out messageResult).ToInt64();
        LastError = Marshal.GetLastWin32Error();
        MessageResult = messageResult.ToInt64();
      } catch (Exception ex) { Error = ex.ToString(); }
      finally { try { BeginInvoke(new Action(Close)); } catch (Exception ex) { Error = ex.ToString(); } }
    });
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0111 && buttonHwnd != IntPtr.Zero && m.LParam == buttonHwnd &&
        (m.WParam.ToInt64() & 0xffff) == 101 && ((m.WParam.ToInt64() >> 16) & 0xffff) == 0) {
      ClickCount++;
    }
    base.WndProc(ref m);
  }
}
'@
$form = New-Object MockWin32ButtonForm
[System.Windows.Forms.Application]::Run($form)
$record = [ordered]@{
  checked_utc = [DateTime]::UtcNow.ToString('o')
  scope = 'Isolated mock Win32 Button; no AIVORA or c19 process'
  pid = $PID
  form_handle = $form.FormHandle
  button_handle = $form.ButtonHandle
  button_class = $form.ButtonClass
  button_pid = $form.ButtonPid
  is_window = $form.IsWindowValue
  is_child = $form.IsChildValue
  is_enabled = $form.IsEnabledValue
  is_visible = $form.IsVisibleValue
  foreground_handle = $form.ForegroundHandle
  send_count = $form.SendCount
  api_return = $form.ApiReturn
  message_result = $form.MessageResult
  last_error = $form.LastError
  bn_clicked_count = $form.ClickCount
  error = $form.Error
}
[IO.File]::WriteAllText($EvidencePath, ($record | ConvertTo-Json -Depth 5),
  (New-Object System.Text.UTF8Encoding($false)))
if ($form.Error -or $form.SendCount -ne 1 -or $form.ApiReturn -eq 0 -or
    $form.ClickCount -ne 1) { throw 'Mock BM_CLICK behavior probe did not meet one-send/one-notification gate' }
Write-Output ('EVIDENCE=' + $EvidencePath)
