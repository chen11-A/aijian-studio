$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PacketPath = Join-Path $Root 'B31-PACKET.json'
$GrantPath = Join-Path $Root 'B31-GRANT.json'
$AttemptPath = Join-Path $Root 'B31-ATTEMPT-USED.json'
$AttemptRedPath = Join-Path $Root 'B31-ATTEMPT-RED.json'
$Run = Join-Path $Root 'run-01'
$FallbackRed = Join-Path $Root 'B31-LAUNCH-RED-STOP.json'
$Utf8 = [Text.UTF8Encoding]::new($false)

function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
function Sha([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash }
function WriteTextOnce([string]$Path, [string]$Value) {
    $Stream = [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $WriteFailure=$null
    $DisposeFailure=$null
    try { $Bytes=$Utf8.GetBytes($Value); $Stream.Write($Bytes,0,$Bytes.Length); $Stream.Flush($true) }
    catch { $WriteFailure=$_.ToString() }
    try { $Stream.Dispose() } catch { $DisposeFailure=$_.ToString() }
    if($null -ne $WriteFailure -or $null -ne $DisposeFailure) {
        throw ('WRITE_ONCE_FAILURE write=' + $WriteFailure + ' dispose=' + $DisposeFailure)
    }
}
function WriteJsonOnce([string]$Path, [object]$Value) {
    WriteTextOnce $Path (($Value | ConvertTo-Json -Depth 20) + "`n")
}
function ProfileInventory([string]$Path) {
    $Items=@(Get-ChildItem -LiteralPath $Path -Force -Recurse)
    return [ordered]@{
        directories=@($Items|Where-Object {$_.PSIsContainer}).Count
        files=@($Items|Where-Object {-not $_.PSIsContainer}).Count
        links=@($Items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count
    }
}
function InvokeChild([string]$Executable,[string[]]$Arguments,[System.Collections.IDictionary]$CleanEnv,[int]$TimeoutMs) {
    $Info=[Diagnostics.ProcessStartInfo]::new()
    $Info.FileName=$Executable
    $Info.WorkingDirectory=$Root
    $Info.UseShellExecute=$false
    $Info.CreateNoWindow=$true
    $Info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $Info.RedirectStandardOutput=$true
    $Info.RedirectStandardError=$true
    foreach($Argument in $Arguments){$Info.ArgumentList.Add($Argument)}
    $Info.Environment.Clear()
    foreach($Entry in $CleanEnv.GetEnumerator()){$Info.Environment[$Entry.Key]=$Entry.Value}
    Require (@($Info.Environment.Keys).Count -eq 9) 'CHILD_ENV_COUNT'
    $Process=[Diagnostics.Process]::new()
    try {
        $Process.StartInfo=$Info
        Require ($Process.Start()) 'CHILD_START_FALSE'
        $PidValue=$Process.Id
        $OutTask=$Process.StandardOutput.ReadToEndAsync()
        $ErrTask=$Process.StandardError.ReadToEndAsync()
        $Exited=$Process.WaitForExit($TimeoutMs)
        $KillError=$null
        if(-not $Exited) {
            try {$Process.Kill($true)} catch {$KillError=$_.ToString()}
            [void]$Process.WaitForExit(5000)
        }
        $OutComplete=$OutTask.Wait(5000)
        $ErrComplete=$ErrTask.Wait(5000)
        return [ordered]@{
            pid=$PidValue; timeout_ms=$TimeoutMs; timed_out=(-not $Exited)
            kill_error=$KillError; process_has_exited=$Process.HasExited
            stdout_complete=$OutComplete; stderr_complete=$ErrComplete
            stdout=$(if($OutComplete){$OutTask.Result}else{$null})
            stderr=$(if($ErrComplete){$ErrTask.Result}else{$null})
            exit_code=$(if($Process.HasExited){$Process.ExitCode}else{$null})
        }
    } finally {$Process.Dispose()}
}
function RecordChild([string]$Name,[object]$Result) {
    WriteTextOnce (Join-Path $Run ($Name+'-STDOUT.txt')) ([string]$Result.stdout)
    WriteTextOnce (Join-Path $Run ($Name+'-STDERR.txt')) ([string]$Result.stderr)
    WriteJsonOnce (Join-Path $Run ($Name+'-EXIT.json')) $Result
    Require (-not $Result.timed_out -and $Result.process_has_exited -and
        $Result.stdout_complete -and $Result.stderr_complete -and
        $Result.exit_code -eq 0 -and [string]::IsNullOrEmpty($Result.stderr)) ($Name+'_RED')
}

$ExpectedShell='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
$ExpectedShellSha='362A356CE7F0940EC74F73A8FC2C990A2CC24A38A11C90BBD8ECA947110AD139'
$ActualShell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
Require ($ActualShell -ieq $ExpectedShell -and $PSVersionTable.PSVersion.ToString() -eq '7.6.5' -and
    (Sha $ActualShell) -eq $ExpectedShellSha) 'POWERSHELL_HOST_MISMATCH_NO_ATTEMPT'
Require (Test-Path -LiteralPath $GrantPath -PathType Leaf) 'NO_GRANT_NO_ATTEMPT'
Require (-not (Test-Path -LiteralPath $AttemptPath)) 'ATTEMPT_ALREADY_USED_NO_RETRY'
$Claim=[ordered]@{state='ONE_SHOT_ATTEMPT_CONSUMED';at_utc=[DateTimeOffset]::UtcNow.ToString('o');grant_path=$GrantPath}
$ClaimText=(($Claim | ConvertTo-Json -Depth 20) + "`n")
try {
    WriteTextOnce $AttemptPath $ClaimText
    $Readback=[IO.File]::ReadAllBytes($AttemptPath)
    $ReadbackText=[Text.UTF8Encoding]::new($false,$true).GetString($Readback)
    Require ($ReadbackText -ceq $ClaimText) 'ATTEMPT_READBACK_BYTES'
    $ReadbackJson=$ReadbackText|ConvertFrom-Json
    Require ($ReadbackJson.state -eq $Claim.state -and
        $ReadbackJson.at_utc -eq $Claim.at_utc -and
        $ReadbackJson.grant_path -eq $GrantPath) 'ATTEMPT_READBACK_FIELDS'
    $ClaimSha=Sha $AttemptPath
    Require ($ClaimSha.Length -eq 64) 'ATTEMPT_READBACK_SHA'
} catch {
    $ClaimFailure=$_.ToString()
    $Red=[ordered]@{
        state='ATTEMPT_CLAIM_RED_STOP_NO_RETRY';at_utc=[DateTimeOffset]::UtcNow.ToString('o')
        raw_error=$ClaimFailure;attempt_path=$AttemptPath
        attempt_present=(Test-Path -LiteralPath $AttemptPath)
        grant_path=$GrantPath
    }
    try {
        $RedText=(($Red | ConvertTo-Json -Depth 20) + "`n")
        WriteTextOnce $AttemptRedPath $RedText
        $RedReadback=[Text.UTF8Encoding]::new($false,$true).GetString(
            [IO.File]::ReadAllBytes($AttemptRedPath))
        Require ($RedReadback -ceq $RedText) 'ATTEMPT_RED_READBACK'
    } catch {
        throw ('ATTEMPT_CLAIM_RED_UNPERSISTED original=' + $ClaimFailure +
            ' red_write=' + $_.ToString())
    }
    throw ('ATTEMPT_CLAIM_RED_STOP_NO_RETRY ' + $ClaimFailure)
}
$Phase='PRECHECK'
try {
    Require (-not (Test-Path -LiteralPath $Run)) 'RUN_ALREADY_EXISTS'
    [IO.Directory]::CreateDirectory($Run)|Out-Null
    $Packet=Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8|ConvertFrom-Json
    $Grant=Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8|ConvertFrom-Json
    Require ($Packet.schema -eq 'qa02.b31.desktop.ipc.packet.v4' -and $Packet.status -eq 'STATIC_PREPARED_NOT_GRANTED_NOT_RUN' -and
        $Packet.scope -eq 'B31_DESKTOP_IPC_TS_MOCK_ISOLATED_V4' -and $Packet.run_root -eq $Run) 'PACKET_SCOPE'
    Require ($Packet.powershell_path -eq $ExpectedShell -and
        $Packet.powershell_sha256 -eq $ExpectedShellSha -and
        $Packet.powershell_version -eq '7.6.5') 'PACKET_POWERSHELL'
    Require ($Grant.status -eq 'APPROVED_SINGLE_RUN' -and $Grant.scope -eq $Packet.scope -and
        $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true -and
        $Grant.clean_environment_approved -eq $true -and $Grant.approval_id -eq $Packet.approval_id -and
        $Grant.one_shot_run -eq 'run-01') 'GRANT_SCOPE'
    Require ($Grant.powershell_sha256 -eq $Packet.powershell_sha256) 'GRANT_POWERSHELL'
    Require ($Grant.launcher_sha256 -eq $Packet.launcher_sha256 -and $Grant.launcher_sha256 -eq (Sha $PSCommandPath)) 'LAUNCHER_CHANGED'
    Require ($Grant.runner_sha256 -eq $Packet.runner_sha256 -and
        $Grant.loader_policy_sha256 -eq $Packet.loader_policy_sha256 -and
        $Grant.python_probe_sha256 -eq $Packet.python_probe_sha256 -and
        $Grant.node_probe_sha256 -eq $Packet.node_probe_sha256 -and
        $Grant.closure_sha256 -eq $Packet.closure_sha256 -and
        $Grant.closure_scanner_sha256 -eq $Packet.closure_scanner_sha256) 'GRANT_PROBE_BINDING'
    Require ($Packet.python_probe_timeout_ms -eq 30000 -and $Packet.node_probe_timeout_ms -eq 30000 -and
        $Packet.typecheck_timeout_ms -eq 120000 -and
        $Packet.mock_timeout_ms -eq 60000 -and $Packet.expected_stage_project_files -eq 92 -and
        $Packet.expected_toolchain_files -eq 286) 'LIMIT_PACKET_CHANGED'
    Require ($Packet.stage_root -eq (Join-Path $Root 'stage') -and
        $Packet.python_path -eq 'C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe') 'INPUT_PATHS'
    $Profile=[string]$Packet.profile_root
    Require ($Profile -eq (Join-Path $Root 'profile-01')) 'PROFILE_PATH'
    foreach($Dir in @($Profile,(Join-Path $Profile 'AppData'),(Join-Path $Profile 'AppData\Roaming'),
        (Join-Path $Profile 'AppData\Local'),(Join-Path $Profile 'Temp'))) {
        Require (Test-Path -LiteralPath $Dir -PathType Container) ('PROFILE_MISSING:'+ $Dir)
        Require (-not ((Get-Item -LiteralPath $Dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) ('PROFILE_REPARSE:'+ $Dir)
    }
    $ProfileBefore=ProfileInventory $Profile
    Require ($ProfileBefore.directories -eq 4 -and $ProfileBefore.files -eq 0 -and $ProfileBefore.links -eq 0) 'PROFILE_PRE'
    $WindowsRoot=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
    $CleanEnv=[ordered]@{
        SYSTEMROOT=$WindowsRoot;WINDIR=$WindowsRoot;USERPROFILE=$Profile
        APPDATA=(Join-Path $Profile 'AppData\Roaming')
        LOCALAPPDATA=(Join-Path $Profile 'AppData\Local')
        TEMP=(Join-Path $Profile 'Temp');TMP=(Join-Path $Profile 'Temp');HOME=$Profile
        NODE_DISABLE_COMPILE_CACHE='1'
    }
    $Node=[string]$Packet.node_path
    $Python=[string]$Packet.python_path
    $Phase='PYTHON_PRE'
    $PyPre=InvokeChild $Python @('-I','-B','-S',(Join-Path $Root 'probe_python_sources.py')) $CleanEnv 30000
    RecordChild 'PYTHON-PRE' $PyPre
    $PyPreValue=$PyPre.stdout|ConvertFrom-Json
    Require ($PyPreValue.state -eq 'FIXED_PYTHON_SOURCE_VIEW_PASS' -and
        $PyPreValue.python_sha256 -eq $Packet.python_sha256 -and
        $PyPreValue.py_rows -gt 0) 'PYTHON_PRE_MISMATCH'
    $Phase='NODE_PRE'
    $NodePre=InvokeChild $Node @((Join-Path $Root 'probe_node_sources.cjs')) $CleanEnv 30000
    RecordChild 'NODE-PRE' $NodePre
    $NodePreValue=$NodePre.stdout|ConvertFrom-Json
    Require ($NodePreValue.state -eq 'NODE_SOURCE_VIEW_PASS' -and
        $NodePreValue.packet_sha256 -eq $Grant.packet_sha256 -and
        $NodePreValue.node_sha256 -eq $Packet.node_sha256 -and
        $NodePreValue.project_files -eq 92 -and $NodePreValue.toolchain_files -eq 286 -and
        $NodePreValue.stage_actual_files -eq 379) 'NODE_PRE_MISMATCH'
    $Phase='TYPECHECK'
    $Tsc=Join-Path $Packet.stage_root 'node_modules\typescript\bin\tsc'
    $Config=Join-Path $Packet.stage_root 'apps\desktop\tsconfig.qa.json'
    $Typecheck=InvokeChild $Node @($Tsc,'-p',$Config,'--listFiles') $CleanEnv 120000
    RecordChild 'TYPECHECK' $Typecheck
    $TypecheckFiles=@($Typecheck.stdout -split "`r?`n" | Where-Object {$_ -ne ''})
    Require ($TypecheckFiles.Count -gt 80) 'TYPECHECK_CLOSURE_EMPTY'
    foreach($File in $TypecheckFiles) {
        $Resolved=[IO.Path]::GetFullPath($File)
        Require ($Resolved.StartsWith(([string]$Packet.stage_root + [IO.Path]::DirectorySeparatorChar),
            [StringComparison]::OrdinalIgnoreCase)) ('TYPECHECK_AUTHOR_FALLBACK:'+ $File)
    }
    $Phase='MOCK'
    $Mock=InvokeChild $Node @((Join-Path $Root 'desktop_ipc_mock_once.cjs')) $CleanEnv 60000
    RecordChild 'MOCK' $Mock
    $MockResult=$Mock.stdout|ConvertFrom-Json
    Require ($MockResult.state -eq 'DESKTOP_IPC_TS_MOCK_PASS_ONLY' -and
        $MockResult.canary_leak_in_results -eq $false -and
        $MockResult.provider_called -eq $false -and $MockResult.electron_run -eq $false -and
        $MockResult.backend_called -eq $false) 'MOCK_RESULT_INVALID'
    Require ((@($MockResult.channels)-join '|') -eq (@($Packet.expected_channels)-join '|')) 'MOCK_CHANNELS_CHANGED'
    $Phase='PYTHON_POST'
    $PyPost=InvokeChild $Python @('-I','-B','-S',(Join-Path $Root 'probe_python_sources.py')) $CleanEnv 30000
    RecordChild 'PYTHON-POST' $PyPost
    $PyPostValue=$PyPost.stdout|ConvertFrom-Json
    Require ($PyPostValue.state -eq $PyPreValue.state -and
        $PyPostValue.py_rows_digest -eq $PyPreValue.py_rows_digest) 'PYTHON_POST_CHANGED'
    $Phase='NODE_POST'
    $NodePost=InvokeChild $Node @((Join-Path $Root 'probe_node_sources.cjs')) $CleanEnv 30000
    RecordChild 'NODE-POST' $NodePost
    $NodePostValue=$NodePost.stdout|ConvertFrom-Json
    Require ($NodePostValue.state -eq $NodePreValue.state -and
        $NodePostValue.digest -eq $NodePreValue.digest) 'NODE_POST_CHANGED'
    $ProfileAfter=ProfileInventory $Profile
    Require ($ProfileAfter.directories -eq 4 -and $ProfileAfter.files -eq 0 -and $ProfileAfter.links -eq 0) 'PROFILE_POST'
    WriteJsonOnce (Join-Path $Run 'RECEIPT.json') ([ordered]@{
        state='PASS_B31_DESKTOP_IPC_TS_MOCK_V4_ONLY'; at_utc=[DateTimeOffset]::UtcNow.ToString('o')
        approval_id=$Grant.approval_id;packet_sha256=$Grant.packet_sha256
        source_manifest_sha256=$Packet.source_manifest_sha256
        python_before=$PyPreValue;python_after=$PyPostValue
        node_before=$NodePreValue;node_after=$NodePostValue
        profile_before=$ProfileBefore;profile_after=$ProfileAfter
        node_sha256=$Packet.node_sha256;typecheck_pid=$Typecheck.pid;mock_pid=$Mock.pid
        typecheck_file_count=$TypecheckFiles.Count
        mock_result=$MockResult;provider_called=$false;electron_run=$false;backend_called=$false
    })
    Write-Output 'PASS_B31_DESKTOP_IPC_TS_MOCK_V4_ONLY'
} catch {
    $RawError=$_.ToString()
    if(Test-Path -LiteralPath $Run -PathType Container) {
        if(-not (Test-Path -LiteralPath (Join-Path $Run 'RED.json'))) {
            WriteJsonOnce (Join-Path $Run 'RED.json') ([ordered]@{
                state='RED_STOP_NO_RETRY';phase=$Phase;at_utc=[DateTimeOffset]::UtcNow.ToString('o')
                raw_error=$RawError;attempt_sha256=(Sha $AttemptPath)
            })
        }
        if(-not (Test-Path -LiteralPath (Join-Path $Run 'STDERR.txt'))) {WriteTextOnce (Join-Path $Run 'STDERR.txt') $RawError}
        if(-not (Test-Path -LiteralPath (Join-Path $Run 'STDOUT.txt'))) {WriteTextOnce (Join-Path $Run 'STDOUT.txt') ''}
        if(-not (Test-Path -LiteralPath (Join-Path $Run 'EXIT.json'))) {
            WriteJsonOnce (Join-Path $Run 'EXIT.json') ([ordered]@{
                state='RED_STOP_NO_RETRY';phase=$Phase;at_utc=[DateTimeOffset]::UtcNow.ToString('o')
                raw_error=$RawError;python_pre_started=($null -ne $PyPre)
                node_pre_started=($null -ne $NodePre)
                typecheck_started=($null -ne $Typecheck);mock_started=($null -ne $Mock)
                python_post_started=($null -ne $PyPost);node_post_started=($null -ne $NodePost)
            })
        }
    } else {
        if(-not (Test-Path -LiteralPath $FallbackRed)) {
            WriteJsonOnce $FallbackRed ([ordered]@{state='RED_STOP_NO_RETRY';phase=$Phase;raw_error=$RawError})
        }
    }
    throw
}
