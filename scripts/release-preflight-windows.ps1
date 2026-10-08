# Validates frozen local inputs. It does not build, install, sign, or publish.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$CandidateRoot,

    [ValidateSet('Release', 'Development')]
    [string]$Purpose = 'Release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Input([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Release preflight: $Message" }
}

function Assert-PlainFileUnderRoot([string]$Root, [string]$RelativePath) {
    Assert-Input (-not [string]::IsNullOrWhiteSpace($RelativePath)) 'input path is empty'
    Assert-Input (-not [System.IO.Path]::IsPathRooted($RelativePath)) "input path is absolute: $RelativePath"
    $segments = @($RelativePath -split '[/\\]')
    Assert-Input (-not ($segments | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })) "input path has an unsafe segment: $RelativePath"

    $current = $Root
    foreach ($segment in $segments) {
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        Assert-Input (-not (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) "input path contains a link: $RelativePath"
    }
    Assert-Input (-not $item.PSIsContainer) "input is not a file: $RelativePath"
    $fullPath = [System.IO.Path]::GetFullPath($current)
    $rootPrefix = $Root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    Assert-Input ($fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) "input escapes candidate root: $RelativePath"
    return $fullPath
}

$manifestFile = (Resolve-Path -LiteralPath $ManifestPath -ErrorAction Stop).Path
$root = (Resolve-Path -LiteralPath $CandidateRoot -ErrorAction Stop).Path
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-Input ($manifest.schema_version -eq 1) 'unsupported manifest schema'
Assert-Input ($manifest.example_only -eq $false) 'example manifest cannot be used as an input'
Assert-Input ($manifest.purpose -ceq $Purpose) "manifest purpose does not match $Purpose"
Assert-Input ($manifest.candidate_head -match '^[0-9a-fA-F]{40}$') 'candidate HEAD must be a full commit SHA'
Assert-Input ($null -ne $manifest.inputs -and @($manifest.inputs).Count -gt 0) 'input list is empty'

$headOutput = & git -C $root rev-parse HEAD 2>&1
Assert-Input ($LASTEXITCODE -eq 0) 'candidate HEAD could not be read'
$actualHead = [string](@($headOutput)[-1])
Assert-Input ($actualHead -ieq $manifest.candidate_head) 'candidate HEAD drifted'

$seenRoles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$seenPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$verified = @()
foreach ($entry in @($manifest.inputs)) {
    $role = [string]$entry.role
    $relativePath = [string]$entry.path
    $expectedHash = [string]$entry.sha256
    $status = [string]$entry.distribution_status
    Assert-Input ($role -match '^[a-z][a-z0-9-]{2,63}$') "invalid input role: $role"
    Assert-Input ($seenRoles.Add($role)) "duplicate input role: $role"
    Assert-Input ($seenPaths.Add($relativePath.Replace('\', '/'))) "duplicate input path: $relativePath"
    Assert-Input ($expectedHash -match '^[0-9a-fA-F]{64}$') "invalid SHA256 for $role"
    Assert-Input ($status -in @('DEVELOPMENT_ONLY', 'RELEASE_REVIEW_REQUIRED', 'RELEASE_APPROVED')) "invalid distribution status for $role"
    if ($Purpose -eq 'Release') {
        Assert-Input ($status -eq 'RELEASE_APPROVED') "input is not approved for release: $role"
        Assert-Input (-not [string]::IsNullOrWhiteSpace([string]$entry.approval_reference)) "release approval reference missing: $role"
    }
    $fullPath = Assert-PlainFileUnderRoot $root $relativePath
    $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    Assert-Input ($actualHash -ieq $expectedHash) "input SHA256 drifted: $role"
    $verified += [pscustomobject]@{ role = $role; path = $relativePath; sha256 = $actualHash }
}

if ($Purpose -eq 'Release') {
    foreach ($role in @('desktop-main', 'desktop-preload', 'renderer-index', 'sidecar-runtime', 'media-lock', 'ffmpeg', 'ffprobe')) {
        Assert-Input ($seenRoles.Contains($role)) "required release input missing: $role"
    }

    $mediaInput = @($verified | Where-Object { $_.role -eq 'media-lock' })[0]
    $ffmpegInput = @($verified | Where-Object { $_.role -eq 'ffmpeg' })[0]
    $ffprobeInput = @($verified | Where-Object { $_.role -eq 'ffprobe' })[0]
    Assert-Input ($mediaInput.path.Replace('\', '/') -ceq 'config/media-toolchain-lock.json') 'media-lock must use the repository lock'
    $mediaLockPath = Assert-PlainFileUnderRoot $root $mediaInput.path
    $mediaLock = Get-Content -LiteralPath $mediaLockPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Input ($mediaLock.schema_version -eq 1 -and $null -ne $mediaLock.profiles) 'invalid media toolchain lock'
    $approvedProfiles = @($mediaLock.profiles | Where-Object { $_.distribution_status -eq 'RELEASE_APPROVED' })
    Assert-Input ($approvedProfiles.Count -gt 0) 'media lock has no release-approved profile'
    $matchingProfiles = @($mediaLock.profiles | Where-Object {
        $_.ffmpeg_sha256 -ieq $ffmpegInput.sha256 -and
        $_.ffprobe_sha256 -ieq $ffprobeInput.sha256
    })
    Assert-Input ($matchingProfiles.Count -eq 1) 'ffmpeg/ffprobe SHA256 do not select one locked profile'
    $selectedProfile = $matchingProfiles[0]
    Assert-Input ($selectedProfile.distribution_status -eq 'RELEASE_APPROVED') 'selected media profile is not approved for release'
    $licenseClass = [string]$selectedProfile.license_class
    $spdxLicense = [string]$selectedProfile.spdx_license
    Assert-Input ($licenseClass -in @('LGPL', 'GPL')) 'selected media profile license class is unsupported'
    Assert-Input ($spdxLicense -match "^$licenseClass-") 'selected media profile SPDX license does not match its class'
    Assert-Input (-not [string]::IsNullOrWhiteSpace([string]$selectedProfile.approval_reference)) 'selected media profile lacks a release approval reference'
}

[pscustomobject]@{
    purpose = $Purpose
    candidate_head = $actualHead
    manifest_sha256 = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash
    verified_inputs = $verified
} | ConvertTo-Json -Depth 5
