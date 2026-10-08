$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PacketPath = Join-Path $Root 'B31-PACKET.json'
$GrantPath = Join-Path $Root 'B31-GRANT.json'
$AttemptPath = Join-Path $Root 'B31-ATTEMPT-USED.json'
$Run = Join-Path $Root 'run-01'
$FallbackRed = Join-Path $Root 'B31-LAUNCH-RED-STOP.json'
$Utf8 = [Text.UTF8Encoding]::new($false)

function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
function Sha([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash }
function WriteTextOnce([string]$Path, [string]$Value) {
    $Stream = [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $Bytes=$Utf8.GetBytes($Value); $Stream.Write($Bytes,0,$Bytes.Length); $Stream.Flush($true) }
    finally { $Stream.Dispose() }
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
function VerifyFile([string]$Path,[object]$Row) {
    Require (Test-Path -LiteralPath $Path -PathType Leaf) ('FILE_MISSING:'+ $Path)
    $Item=Get-Item -LiteralPath $Path -Force
    Require (-not ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) ('REPARSE:'+ $Path)
    Require ($Item.Length -eq [long]$Row.bytes -and (Sha $Path) -eq $Row.sha256) ('FILE_CHANGED:'+ $Path)
}
function VerifyInputs([object]$Stage,[object]$Tool,[object]$Packet) {
    Require ((Sha $Stage.source_manifest_path) -eq $Packet.source_manifest_sha256) 'SOURCE_MANIFEST_CHANGED'
    $SourceManifest=Get-Content -LiteralPath $Stage.source_manifest_path -Raw -Encoding UTF8|ConvertFrom-Json
    Require (@($SourceManifest.selected_dependency_files).Count -eq 50 -and
        @($SourceManifest.backend_version.source_files).Count -eq 194 -and
        @($SourceManifest.c19_preserved_baseline).Count -eq 6 -and
        @($SourceManifest.superseded_dev05_author_observations).Count -eq 6) 'SOURCE_MANIFEST_COUNTS'
    foreach($Row in $SourceManifest.selected_dependency_files) {VerifyFile $Row.source_path $Row}
    foreach($Row in $SourceManifest.backend_version.source_files) {VerifyFile $Row.source_path $Row}
    foreach($Row in $SourceManifest.c19_preserved_baseline) {VerifyFile $Row.path $Row}
    foreach($Entry in $SourceManifest.references.PSObject.Properties) {VerifyFile $Entry.Value.path $Entry.Value}
    Require ((Sha (Join-Path $Root 'STAGE-MANIFEST.json')) -eq $Packet.stage_manifest_sha256) 'STAGE_MANIFEST_CHANGED'
    Require ((Sha (Join-Path $Root 'TOOLCHAIN-MANIFEST.json')) -eq $Packet.toolchain_manifest_sha256) 'TOOLCHAIN_MANIFEST_CHANGED'
    Require (@($Stage.files).Count -eq 92 -and @($Tool.files).Count -eq 286) 'INVENTORY_COUNTS'
    $Expected=@{}
    foreach($Row in $Stage.files) {
        $Target=Join-Path $Stage.stage_root $Row.relative_path
        VerifyFile $Row.source_path $Row
        VerifyFile $Target $Row
        $Expected[$Target.ToLowerInvariant()]=$true
    }
    foreach($Row in $Tool.files) {
        VerifyFile $Row.source $Row
        VerifyFile $Row.staged $Row
        $Expected[$Row.staged.ToLowerInvariant()]=$true
    }
    VerifyFile $Tool.qa_tsconfig.path $Tool.qa_tsconfig
    $Expected[$Tool.qa_tsconfig.path.ToLowerInvariant()]=$true
    $Actual=@(Get-ChildItem -LiteralPath $Stage.stage_root -Force -Recurse)
    Require (@($Actual|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count -eq 0) 'STAGE_REPARSE'
    $ActualFiles=@($Actual|Where-Object {-not $_.PSIsContainer})
    Require ($ActualFiles.Count -eq $Expected.Count) 'STAGE_EXTRA_FILE_COUNT'
    foreach($File in $ActualFiles) { Require ($Expected.ContainsKey($File.FullName.ToLowerInvariant())) ('STAGE_UNLISTED:'+ $File.FullName) }
    return [ordered]@{
        manifest_selected=50;manifest_backend=194;manifest_c19=6;manifest_refs=8
        project_files=@($Stage.files).Count;toolchain_files=@($Tool.files).Count
        actual_files=$ActualFiles.Count
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
    Require (@($Info.Environment.Keys).Count -eq 8) 'CHILD_ENV_COUNT'
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

Require (Test-Path -LiteralPath $GrantPath -PathType Leaf) 'NO_GRANT_NO_ATTEMPT'
Require (-not (Test-Path -LiteralPath $AttemptPath)) 'ATTEMPT_ALREADY_USED_NO_RETRY'
WriteJsonOnce $AttemptPath ([ordered]@{state='ONE_SHOT_ATTEMPT_CONSUMED';at_utc=[DateTimeOffset]::UtcNow.ToString('o');grant_path=$GrantPath})
$Phase='PRECHECK'
try {
    Require (-not (Test-Path -LiteralPath $Run)) 'RUN_ALREADY_EXISTS'
    [IO.Directory]::CreateDirectory($Run)|Out-Null
    $Packet=Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8|ConvertFrom-Json
    $Grant=Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8|ConvertFrom-Json
    $Stage=Get-Content -LiteralPath (Join-Path $Root 'STAGE-MANIFEST.json') -Raw -Encoding UTF8|ConvertFrom-Json
    $Tool=Get-Content -LiteralPath (Join-Path $Root 'TOOLCHAIN-MANIFEST.json') -Raw -Encoding UTF8|ConvertFrom-Json
    Require ($Packet.schema -eq 'qa02.b31.desktop.ipc.packet.v1' -and $Packet.status -eq 'STATIC_PREPARED_NOT_GRANTED_NOT_RUN' -and
        $Packet.scope -eq 'B31_DESKTOP_IPC_TS_MOCK_ISOLATED' -and $Packet.run_root -eq $Run) 'PACKET_SCOPE'
    Require ($Grant.status -eq 'APPROVED_SINGLE_RUN' -and $Grant.scope -eq $Packet.scope -and
        $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true -and
        $Grant.clean_environment_approved -eq $true -and $Grant.approval_id -eq $Packet.approval_id -and
        $Grant.one_shot_run -eq 'run-01') 'GRANT_SCOPE'
    Require ($Grant.packet_sha256 -eq (Sha $PacketPath)) 'PACKET_CHANGED'
    Require ($Grant.launcher_sha256 -eq $Packet.launcher_sha256 -and $Grant.launcher_sha256 -eq (Sha $PSCommandPath)) 'LAUNCHER_CHANGED'
    Require ($Grant.runner_sha256 -eq $Packet.runner_sha256 -and $Grant.runner_sha256 -eq (Sha (Join-Path $Root 'desktop_ipc_mock_once.cjs'))) 'RUNNER_CHANGED'
    Require ($Grant.static_checker_sha256 -eq $Packet.static_checker_sha256 -and $Grant.static_checker_sha256 -eq (Sha (Join-Path $Root 'verify_stage_static.py'))) 'STATIC_CHECKER_CHANGED'
    Require ($Packet.source_checker_sha256 -eq (Sha (Join-Path $Root 'verify_manifest_static.py')) -and
        $Packet.static_source_sha256 -eq (Sha (Join-Path $Root 'B31-STATIC-SOURCE.json'))) 'SOURCE_CHECKER_CHANGED'
    Require ($Packet.stage_manifest_sha256 -eq (Sha (Join-Path $Root 'STAGE-MANIFEST.json'))) 'STAGE_PACKET_CHANGED'
    Require ($Packet.toolchain_manifest_sha256 -eq (Sha (Join-Path $Root 'TOOLCHAIN-MANIFEST.json'))) 'TOOLCHAIN_PACKET_CHANGED'
    Require ($Packet.static_inventory_sha256 -eq (Sha (Join-Path $Root 'B31-STATIC-INVENTORY.json'))) 'STATIC_INVENTORY_CHANGED'
    Require ($Packet.source_manifest_sha256 -eq $Stage.source_manifest_sha256) 'SOURCE_PACKET_CHANGED'
    Require ($Tool.node_binary.sha256 -eq $Packet.node_sha256 -and $Tool.node_binary.path -eq $Packet.node_path) 'NODE_PACKET_CHANGED'
    Require ($Packet.hash_probe_timeout_ms -eq 30000 -and $Packet.typecheck_timeout_ms -eq 120000 -and
        $Packet.mock_timeout_ms -eq 60000 -and $Packet.expected_stage_project_files -eq 92 -and
        $Packet.expected_toolchain_files -eq 286) 'LIMIT_PACKET_CHANGED'
    VerifyFile $Tool.node_binary.path $Tool.node_binary
    $Before=VerifyInputs $Stage $Tool $Packet
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
    }
    $Node=[string]$Tool.node_binary.path
    $Phase='HASH_PROBE'
    $ProbeCode='const fs=require("node:fs"),crypto=require("node:crypto");const p=process.execPath;process.stdout.write(JSON.stringify({node_sha256:crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase(),environment_keys:Object.keys(process.env).sort(),node_version:process.version})+"\n")'
    $Probe=InvokeChild $Node @('-e',$ProbeCode) $CleanEnv 30000
    RecordChild 'HASH-PROBE' $Probe
    $ProbeValue=$Probe.stdout|ConvertFrom-Json
    Require ($ProbeValue.node_sha256 -eq $Packet.node_sha256 -and
        ((@($ProbeValue.environment_keys)-join '|') -eq ((@($CleanEnv.Keys|Sort-Object)-join '|')))) 'HASH_PROBE_MISMATCH'
    $Phase='TYPECHECK'
    $Tsc=Join-Path $Stage.stage_root 'node_modules\typescript\bin\tsc'
    $Config=Join-Path $Stage.stage_root 'apps\desktop\tsconfig.qa.json'
    $Typecheck=InvokeChild $Node @($Tsc,'-p',$Config,'--listFiles') $CleanEnv 120000
    RecordChild 'TYPECHECK' $Typecheck
    $TypecheckFiles=@($Typecheck.stdout -split "`r?`n" | Where-Object {$_ -ne ''})
    Require ($TypecheckFiles.Count -gt 80) 'TYPECHECK_CLOSURE_EMPTY'
    foreach($File in $TypecheckFiles) {
        $Resolved=[IO.Path]::GetFullPath($File)
        Require ($Resolved.StartsWith(([string]$Stage.stage_root + [IO.Path]::DirectorySeparatorChar),
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
    $After=VerifyInputs $Stage $Tool $Packet
    Require (($Before|ConvertTo-Json -Compress) -eq ($After|ConvertTo-Json -Compress)) 'INPUTS_CHANGED'
    $ProfileAfter=ProfileInventory $Profile
    Require ($ProfileAfter.directories -eq 4 -and $ProfileAfter.files -eq 0 -and $ProfileAfter.links -eq 0) 'PROFILE_POST'
    WriteJsonOnce (Join-Path $Run 'RECEIPT.json') ([ordered]@{
        state='PASS_B31_DESKTOP_IPC_TS_MOCK_ONLY'; at_utc=[DateTimeOffset]::UtcNow.ToString('o')
        approval_id=$Grant.approval_id;packet_sha256=$Grant.packet_sha256
        source_manifest_sha256=$Packet.source_manifest_sha256
        input_before=$Before;input_after=$After;profile_before=$ProfileBefore;profile_after=$ProfileAfter
        node_sha256=$Packet.node_sha256;typecheck_pid=$Typecheck.pid;mock_pid=$Mock.pid
        typecheck_file_count=$TypecheckFiles.Count
        mock_result=$MockResult;provider_called=$false;electron_run=$false;backend_called=$false
    })
    Write-Output 'PASS_B31_DESKTOP_IPC_TS_MOCK_ONLY'
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
                raw_error=$RawError;hash_probe_started=($null -ne $Probe)
                typecheck_started=($null -ne $Typecheck);mock_started=($null -ne $Mock)
            })
        }
    } else {
        if(-not (Test-Path -LiteralPath $FallbackRed)) {
            WriteJsonOnce $FallbackRed ([ordered]@{state='RED_STOP_NO_RETRY';phase=$Phase;raw_error=$RawError})
        }
    }
    throw
}
