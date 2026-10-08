$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher=Join-Path $Root 'launch_b31_v4_once.ps1'
$Output=Join-Path $Root 'V4-CLAIM-STATIC.json'
$Fixture=Join-Path $Root 'claim-static-fixture'
if(Test-Path -LiteralPath $Output){throw 'EVIDENCE_EXISTS'}
if(Test-Path -LiteralPath $Fixture){throw 'FIXTURE_EXISTS'}
$Text=Get-Content -LiteralPath $Launcher -Raw -Encoding UTF8
$FunctionStart=$Text.IndexOf('function WriteTextOnce(')
$FunctionEnd=$Text.IndexOf('function WriteJsonOnce(')
$ClaimStart=$Text.IndexOf('$Claim=[ordered]@{')
$ClaimEnd=$Text.IndexOf("$" + "Phase='PRECHECK'")
if($FunctionStart -lt 0 -or $FunctionEnd -le $FunctionStart -or
    $ClaimStart -lt 0 -or $ClaimEnd -le $ClaimStart){throw 'EXTRACTION_RED'}
$FunctionSource=$Text.Substring($FunctionStart,$FunctionEnd-$FunctionStart)
$ClaimSource=$Text.Substring($ClaimStart,$ClaimEnd-$ClaimStart)
$Utf8=[Text.UTF8Encoding]::new($false)
function Require([bool]$Condition,[string]$Code){if(-not $Condition){throw $Code}}
function Sha([string]$Path){return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash}
. ([scriptblock]::Create($FunctionSource))
$ClaimBlock=[scriptblock]::Create($ClaimSource)
[IO.Directory]::CreateDirectory($Fixture)|Out-Null
$Results=@()
foreach($Case in @('success','create_new_failure','injected_flush_failure','injected_dispose_failure','injected_readback_failure')){
    $CaseRoot=Join-Path $Fixture $Case
    [IO.Directory]::CreateDirectory($CaseRoot)|Out-Null
    $AttemptPath=Join-Path $CaseRoot 'B31-ATTEMPT-USED.json'
    $AttemptRedPath=Join-Path $CaseRoot 'B31-ATTEMPT-RED.json'
    $GrantPath=Join-Path $CaseRoot 'B31-GRANT.json'
    $OriginalFunction=(Get-Command WriteTextOnce).ScriptBlock
    if($Case -eq 'create_new_failure'){
        [IO.File]::WriteAllText($AttemptPath,'SENTINEL',[Text.UTF8Encoding]::new($false))
    } elseif($Case -eq 'injected_flush_failure' -or $Case -eq 'injected_dispose_failure'){
        $Failure=$Case
        function WriteTextOnce([string]$Path,[string]$Value){
            if($Path -eq $AttemptPath){throw $Failure}
            & $OriginalFunction $Path $Value
        }
    } elseif($Case -eq 'injected_readback_failure'){
        function WriteTextOnce([string]$Path,[string]$Value){
            if($Path -eq $AttemptPath){
                & $OriginalFunction $Path ($Value+'CORRUPT')
            } else {& $OriginalFunction $Path $Value}
        }
    }
    $Thrown=$null
    try {. $ClaimBlock} catch {$Thrown=$_.ToString()}
    if($Case -eq 'success'){
        if($null -ne $Thrown -or -not (Test-Path -LiteralPath $AttemptPath) -or
            (Test-Path -LiteralPath $AttemptRedPath)){throw 'SUCCESS_CASE_RED'}
        $Marker=Get-Content -LiteralPath $AttemptPath -Raw|ConvertFrom-Json
        if($Marker.state -ne 'ONE_SHOT_ATTEMPT_CONSUMED'){throw 'SUCCESS_MARKER_RED'}
    } else {
        if($Thrown -notmatch 'ATTEMPT_CLAIM_RED_STOP_NO_RETRY' -or
            -not (Test-Path -LiteralPath $AttemptRedPath)){throw ('FAILURE_CASE_RED:'+ $Case)}
        $Red=Get-Content -LiteralPath $AttemptRedPath -Raw|ConvertFrom-Json
        if($Red.state -ne 'ATTEMPT_CLAIM_RED_STOP_NO_RETRY'){throw ('RED_MARKER_INVALID:'+ $Case)}
        if($Case -eq 'create_new_failure' -and
            (Get-Content -LiteralPath $AttemptPath -Raw) -ne 'SENTINEL'){throw 'EXISTING_ATTEMPT_CHANGED'}
    }
    if(Test-Path -LiteralPath (Join-Path $CaseRoot 'run-01')){throw 'RUN_CREATED'}
    $Results+= [ordered]@{
        case=$Case;thrown=$Thrown
        attempt_present=(Test-Path -LiteralPath $AttemptPath)
        attempt_sha256=$(if(Test-Path -LiteralPath $AttemptPath){Sha $AttemptPath}else{$null})
        attempt_red_present=(Test-Path -LiteralPath $AttemptRedPath)
        attempt_red_sha256=$(if(Test-Path -LiteralPath $AttemptRedPath){Sha $AttemptRedPath}else{$null})
        run_absent=$true
    }
    . ([scriptblock]::Create($FunctionSource))
}
$Evidence=[ordered]@{
    state='B31_V4_CLAIM_STATIC_FIXTURE_PASS_NO_PRODUCT'
    launcher_sha256=Sha $Launcher
    cases=$Results
    product_run=$false;typescript_run=$false;mock_run=$false
}
[IO.File]::WriteAllText($Output,(($Evidence|ConvertTo-Json -Depth 12)+"`n"),[Text.UTF8Encoding]::new($false))
Write-Output (Sha $Output)
