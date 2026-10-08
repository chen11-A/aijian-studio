$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Profile=Join-Path $Root 'profile-01'
$Output=Join-Path $Root 'V4-SHELL-STATIC.json'
if(Test-Path -LiteralPath $Output){throw 'EVIDENCE_EXISTS'}
$ShellPath=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$ShellSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $ShellPath).Hash
if($ShellPath -ine 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -or
    $PSVersionTable.PSVersion.ToString() -ne '7.6.5' -or
    $ShellSha -ne '362A356CE7F0940EC74F73A8FC2C990A2CC24A38A11C90BBD8ECA947110AD139'){throw 'HOST_RED'}
$EnvMap=[ordered]@{
    SYSTEMROOT='C:\WINDOWS';WINDIR='C:\WINDOWS';USERPROFILE=$Profile
    APPDATA=(Join-Path $Profile 'AppData\Roaming')
    LOCALAPPDATA=(Join-Path $Profile 'AppData\Local')
    TEMP=(Join-Path $Profile 'Temp');TMP=(Join-Path $Profile 'Temp')
    HOME=$Profile;NODE_DISABLE_COMPILE_CACHE='1'
}
function StartStatic([string[]]$Arguments) {
    $Info=[Diagnostics.ProcessStartInfo]::new()
    $Info.FileName='C:\Program Files\nodejs\node.exe'
    $Info.WorkingDirectory=$Root
    $Info.UseShellExecute=$false
    $Info.CreateNoWindow=$true
    $Info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $Info.RedirectStandardOutput=$true
    $Info.RedirectStandardError=$true
    foreach($Argument in $Arguments){$Info.ArgumentList.Add($Argument)}
    $Info.Environment.Clear()
    foreach($Entry in $EnvMap.GetEnumerator()){$Info.Environment[$Entry.Key]=[string]$Entry.Value}
    if(@($Info.Environment.Keys).Count -ne 9){throw 'CHILD_ENV_COUNT'}
    $Process=[Diagnostics.Process]::new()
    $Process.StartInfo=$Info
    if(-not $Process.Start()){throw 'START_FALSE'}
    return $Process
}
$Before=@(Get-ChildItem -LiteralPath $Profile -Recurse -Force)
$EchoCode="process.stdout.write(JSON.stringify({arg:process.argv.at(-1),keys:Object.keys(process.env).sort()})+'\n');process.stderr.write('错误路径\n')"
$Echo=StartStatic @('-e',$EchoCode,'--','含 空格中文')
try {
    $EchoOut=$Echo.StandardOutput.ReadToEndAsync()
    $EchoErr=$Echo.StandardError.ReadToEndAsync()
    if(-not $Echo.WaitForExit(10000)){throw 'ECHO_TIMEOUT'}
    if(-not $EchoOut.Wait(5000) -or -not $EchoErr.Wait(5000)){throw 'ECHO_STREAM_TIMEOUT'}
    $EchoText=$EchoOut.Result
    $EchoError=$EchoErr.Result
    $EchoPid=$Echo.Id
    $EchoExit=$Echo.ExitCode
} finally {
    if(-not $Echo.HasExited){$Echo.Kill($true);[void]$Echo.WaitForExit(5000)}
    $Echo.Dispose()
}
$EchoValue=$EchoText|ConvertFrom-Json
if($EchoExit -ne 0 -or $EchoValue.arg -ne '含 空格中文' -or
    (@($EchoValue.keys)-join '|') -ne (@($EnvMap.Keys|Sort-Object)-join '|') -or
    $EchoError -notmatch '错误路径'){throw 'ARG_ENV_STREAM_RED'}
$TreeCode="const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(JSON.stringify({child_pid:c.pid})+'\n');setInterval(()=>{},1000)"
$Tree=StartStatic @('-e',$TreeCode)
$TreeChildPid=$null
try {
    $TreeOut=$Tree.StandardOutput.ReadToEndAsync()
    $TreeErr=$Tree.StandardError.ReadToEndAsync()
    Start-Sleep -Milliseconds 500
    if($Tree.HasExited){throw 'TREE_EARLY_EXIT'}
    $Tree.Kill($true)
    if(-not $Tree.WaitForExit(5000)){throw 'TREE_PARENT_NOT_EXITED'}
    if(-not $TreeOut.Wait(5000) -or -not $TreeErr.Wait(5000)){throw 'TREE_STREAM_TIMEOUT'}
    $TreeText=$TreeOut.Result
    $TreeError=$TreeErr.Result
    $TreeChildPid=[int](($TreeText|ConvertFrom-Json).child_pid)
    $TreePid=$Tree.Id
    $TreeExit=$Tree.ExitCode
} finally {
    if(-not $Tree.HasExited){$Tree.Kill($true);[void]$Tree.WaitForExit(5000)}
    $Tree.Dispose()
}
if($TreeChildPid -le 0 -or (Get-Process -Id $TreeChildPid -ErrorAction SilentlyContinue)){throw 'TREE_CHILD_NOT_EXITED'}
$After=@(Get-ChildItem -LiteralPath $Profile -Recurse -Force)
if($Before.Count -ne 4 -or $After.Count -ne 4){throw 'PROFILE_CHANGED'}
$Evidence=[ordered]@{
    state='PWSh_7_6_5_PROCESS_STATIC_PASS_NO_PRODUCT'
    powershell_path=$ShellPath;powershell_version=$PSVersionTable.PSVersion.ToString()
    powershell_sha256=$ShellSha;node_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Program Files\nodejs\node.exe').Hash
    echo_pid=$EchoPid;echo_exit=$EchoExit;echo_stdout=$EchoText;echo_stderr=$EchoError
    echo_argument=$EchoValue.arg;clean_environment_keys=@($EchoValue.keys)
    create_no_window=$true
    tree_parent_pid=$TreePid;tree_child_pid=$TreeChildPid;tree_exit=$TreeExit
    tree_stdout=$TreeText;tree_stderr=$TreeError;tree_kill_wait_pass=$true
    profile_pre_items=$Before.Count;profile_post_items=$After.Count
    product_run=$false;database_opened=$false
}
[IO.File]::WriteAllText($Output,(($Evidence|ConvertTo-Json -Depth 10)+"`n"),[Text.UTF8Encoding]::new($false))
Write-Output ((Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash)
