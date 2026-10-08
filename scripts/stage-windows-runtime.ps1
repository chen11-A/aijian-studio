# Stages fixed, release-approved files for a separately selected installer tool.
# No dependency download, signing, installer execution, or cleanup occurs here.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$ManifestPath,
    [Parameter(Mandatory = $true)] [string]$CandidateRoot,
    [Parameter(Mandatory = $true)] [string]$OutputDirectory,
    [Parameter(Mandatory = $true)] [string]$ContractsSmokeReceiptPath,
    [Parameter(Mandatory = $true)] [string]$ExpectedContractsSmokeReceiptSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Stage([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Windows runtime staging: $Message" }
}

function Safe-Destination([string]$Destination) {
    Assert-Stage (-not [string]::IsNullOrWhiteSpace($Destination)) 'destination is empty'
    Assert-Stage (-not [System.IO.Path]::IsPathRooted($Destination)) "destination is absolute: $Destination"
    $parts = @($Destination -split '[/\\]')
    Assert-Stage (-not ($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })) "destination has an unsafe segment: $Destination"
    $normalized = $parts -join '/'
    Assert-Stage ($normalized.StartsWith('app/', [System.StringComparison]::Ordinal) -or $normalized.StartsWith('resources/', [System.StringComparison]::Ordinal) -or $normalized -in @('build/installer.nsh', 'build/electron-builder.json')) "destination must be under app/, resources/ or fixed build inputs: $Destination"
    return $normalized
}

$root = (Resolve-Path -LiteralPath $CandidateRoot -ErrorAction Stop).Path
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath -ErrorAction Stop).Path
$layoutFile = Join-Path $root 'packaging/windows/runtime-layout.json'
$preflightFile = Join-Path $root 'scripts/release-preflight-windows.ps1'
Assert-Stage (Test-Path -LiteralPath $layoutFile -PathType Leaf) 'runtime layout is missing'
Assert-Stage (Test-Path -LiteralPath $preflightFile -PathType Leaf) 'release preflight is missing'

Assert-Stage ([System.IO.Path]::IsPathRooted($OutputDirectory)) 'output directory must be an absolute path'
$target = [System.IO.Path]::GetFullPath($OutputDirectory)
$parent = Split-Path -Parent $target
Assert-Stage (Test-Path -LiteralPath $parent -PathType Container) 'output parent directory is missing'
Assert-Stage (-not (Test-Path -LiteralPath $target)) 'output directory already exists; no overwrite is allowed'
$rootPrefix = $root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
Assert-Stage (-not ($target.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -or
    $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase))) 'output cannot be in the candidate root'

$probe = $parent
while ($true) {
    $item = Get-Item -LiteralPath $probe -Force -ErrorAction Stop
    Assert-Stage (-not (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) 'output parent contains a link or junction'
    $next = Split-Path -Parent $probe
    if ([string]::IsNullOrEmpty($next) -or $next -eq $probe) { break }
    $probe = $next
}
$gitRoot = & git -C $parent rev-parse --show-toplevel 2>$null
Assert-Stage ($LASTEXITCODE -ne 0) "output parent is inside a Git worktree: $gitRoot"

# Preflight runs before creating an output directory. Its Release gate checks the
# actual media lock, paired tool hashes, source HEAD and every listed input.
$preflightResult = & $preflightFile -ManifestPath $manifestFile -CandidateRoot $root -Purpose Release | ConvertFrom-Json
Assert-Stage ($preflightResult.purpose -eq 'Release') 'release preflight did not complete'
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$layout = Get-Content -LiteralPath $layoutFile -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-Stage ($layout.schema_version -eq 1 -and $layout.stage_kind -eq 'installer-input-only') 'unsupported runtime layout'

$byRole = @{}
$destinations = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($input in @($manifest.inputs)) {
    $role = [string]$input.role
    $destination = Safe-Destination ([string]$input.destination)
    Assert-Stage (-not $byRole.ContainsKey($role)) "duplicate input role: $role"
    Assert-Stage ($destinations.Add($destination)) "duplicate package destination: $destination"
    $byRole[$role] = $destination
}
foreach ($required in $layout.required_destinations.PSObject.Properties) {
    Assert-Stage ($byRole.ContainsKey($required.Name)) "required package role missing: $($required.Name)"
    Assert-Stage ($byRole[$required.Name] -ceq [string]$required.Value) "package destination mismatch: $($required.Name)"
}
Assert-Stage ($byRole.ContainsKey('runtime-layout')) 'runtime-layout input is missing'
Assert-Stage (($manifest.inputs | Where-Object { $_.role -eq 'runtime-layout' }).path -eq 'packaging/windows/runtime-layout.json') 'runtime-layout input path is wrong'
Assert-Stage (($manifest.inputs | Where-Object { $_.role -eq 'desktop-package' }).path -eq 'packaging/windows/app-runtime.package.json') 'desktop runtime package input path is wrong'
Assert-Stage (($manifest.inputs | Where-Object { $_.role -eq 'installer-hook' }).path -eq 'packaging/windows/installer.nsh') 'installer hook input path is wrong'
Assert-Stage (($manifest.inputs | Where-Object { $_.role -eq 'installer-config' }).path -eq 'packaging/windows/electron-builder.v26.json') 'installer config input path is wrong'
$appPackage = Get-Content -LiteralPath (Join-Path $root 'packaging/windows/app-runtime.package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$installerConfig = Get-Content -LiteralPath (Join-Path $root 'packaging/windows/electron-builder.v26.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$contractsPackageInput = @($manifest.inputs | Where-Object { $_.role -eq 'contracts-package' })[0]
$contractsPackage = Get-Content -LiteralPath (Join-Path $root ([string]$contractsPackageInput.path)) -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-Stage ($appPackage.main -ceq 'dist/main.js' -and $appPackage.type -ceq 'commonjs' -and $appPackage.productName -ceq 'AIVORA') 'desktop runtime package entry or product name is unsupported'
Assert-Stage ($installerConfig.appId -ceq 'com.aivora.studio' -and $installerConfig.productName -ceq $appPackage.productName) 'installer identity differs from the frozen runtime identity'
Assert-Stage ($installerConfig.npmRebuild -eq $false -and $installerConfig.nodeGypRebuild -eq $false -and $installerConfig.allowMissingDependencies -eq $false) 'installer may rebuild or silently omit runtime dependencies'
Assert-Stage ($installerConfig.nsis.include -ceq 'build/installer.nsh' -and $installerConfig.nsis.oneClick -eq $true -and $installerConfig.nsis.perMachine -eq $false -and $installerConfig.nsis.allowElevation -eq $false -and $installerConfig.nsis.deleteAppDataOnUninstall -eq $false) 'installer policy differs from the frozen per-user and data-preservation policy'
Assert-Stage ($contractsPackage.name -ceq '@aijian/contracts' -and $contractsPackage.type -ceq 'commonjs') 'contracts runtime package metadata is unsupported'
Assert-Stage ($appPackage.dependencies.'@aijian/contracts' -ceq $contractsPackage.version) 'desktop and contracts runtime versions differ'

# QA owns the Electron CJS-to-ESM load check. A pinned receipt must name the
# exact main and contracts bytes staged below; a build artifact alone is not proof.
Assert-Stage ($ExpectedContractsSmokeReceiptSha256 -match '^[0-9a-fA-F]{64}$') 'contracts smoke receipt SHA256 is invalid'
$smokeFile = (Resolve-Path -LiteralPath $ContractsSmokeReceiptPath -ErrorAction Stop).Path
$smokeHash = (Get-FileHash -LiteralPath $smokeFile -Algorithm SHA256).Hash
Assert-Stage ($smokeHash -ieq $ExpectedContractsSmokeReceiptSha256) 'contracts smoke receipt SHA256 drifted'
$smoke = Get-Content -LiteralPath $smokeFile -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-Stage ($smoke.schema_version -eq 1 -and $smoke.result -ceq 'PASS' -and $smoke.exit_code -eq 0) 'contracts smoke did not pass'
Assert-Stage ($smoke.candidate_head -ieq $preflightResult.candidate_head) 'contracts smoke candidate drifted'
Assert-Stage (-not [string]::IsNullOrWhiteSpace([string]$smoke.electron_version)) 'contracts smoke Electron version is missing'
$smokeBindings = @{
    'desktop-main' = 'desktop_main_sha256'
    'contracts-package' = 'contracts_package_sha256'
    'contracts-artifact-js' = 'contracts_artifact_js_sha256'
    'contracts-invalidation-js' = 'contracts_invalidation_js_sha256'
}
foreach ($role in $smokeBindings.Keys) {
    $input = @($manifest.inputs | Where-Object { $_.role -eq $role })[0]
    $field = $smokeBindings[$role]
    Assert-Stage ([string]$smoke.$field -ieq [string]$input.sha256) "contracts smoke input drifted: $role"
}

# The manifest must cover every built file in each runtime tree. A missing JS,
# renderer asset or sidecar support file would otherwise make a plausible but
# unusable staging directory.
$declaredPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$inputsByPath = @{}
foreach ($input in @($manifest.inputs)) {
    $normalizedPath = ([string]$input.path).Replace('\', '/')
    [void]$declaredPaths.Add($normalizedPath)
    $inputsByPath[$normalizedPath] = $input
}
$runtimeTrees = @(
    @{ role = 'desktop-main'; destination_root = 'app/dist' },
    @{ role = 'renderer-index'; destination_root = 'resources/renderer' },
    @{ role = 'contracts-package'; destination_root = 'app/node_modules/@aijian/contracts' },
    @{ role = 'sidecar-runtime'; destination_root = 'resources/sidecar' }
)
foreach ($tree in $runtimeTrees) {
    $role = [string]$tree.role
    $input = @($manifest.inputs | Where-Object { $_.role -eq $role })[0]
    $relativeDirectory = Split-Path -Parent ([string]$input.path)
    $directory = Join-Path $root $relativeDirectory
    Assert-Stage (Test-Path -LiteralPath $directory -PathType Container) "runtime directory is missing: $role"
    foreach ($item in @(Get-ChildItem -LiteralPath $directory -Recurse -Force)) {
        Assert-Stage (-not (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) "runtime directory contains a link: $role"
        if ($item.PSIsContainer) { continue }
        $relativeFile = $item.FullName.Substring($root.Length + 1).Replace('\', '/')
        if ($role -eq 'desktop-main') {
            Assert-Stage (-not ($item.Name -match '(?i)\.(test|spec)\.(js|cjs|mjs)$' -or
                $item.Name -match '(?i)(^|-)test-fixture\.(js|cjs|mjs)$')) "desktop test artifact cannot be staged: $relativeFile"
        }
        Assert-Stage ($declaredPaths.Contains($relativeFile)) "runtime file is not listed in manifest: $relativeFile"
        $relativeInsideTree = $item.FullName.Substring($directory.Length + 1).Replace('\', '/')
        $expectedDestination = [string]$tree.destination_root + '/' + $relativeInsideTree
        $actualDestination = $byRole[[string]$inputsByPath[$relativeFile].role]
        Assert-Stage ($actualDestination -ceq $expectedDestination) "runtime file destination mismatch: $relativeFile"
    }
}

New-Item -ItemType Directory -Path $target -ErrorAction Stop | Out-Null
$staged = @()
foreach ($input in @($manifest.inputs)) {
    $destination = $byRole[[string]$input.role]
    $source = Join-Path $root ([string]$input.path)
    $outputFile = Join-Path $target ($destination.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    $outputParent = Split-Path -Parent $outputFile
    New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $outputFile -ErrorAction Stop
    $copiedHash = (Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash
    Assert-Stage ($copiedHash -ieq [string]$input.sha256) "copy hash mismatch: $($input.role)"
    $staged += [pscustomobject]@{
        role = [string]$input.role
        destination = $destination
        sha256 = $copiedHash
    }
}

$receipt = [ordered]@{
    schema_version = 1
    stage_kind = 'installer-input-only'
    candidate_head = [string]$preflightResult.candidate_head
    input_manifest_sha256 = [string]$preflightResult.manifest_sha256
    layout_sha256 = (Get-FileHash -LiteralPath $layoutFile -Algorithm SHA256).Hash
    contracts_smoke_receipt_sha256 = $smokeHash
    staged_files = $staged
}
$receiptPath = Join-Path $target 'STAGED-INPUTS.json'
[System.IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
Write-Output "STAGED_INPUTS=$receiptPath"
Write-Output "STAGED_INPUTS_SHA256=$((Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash)"
