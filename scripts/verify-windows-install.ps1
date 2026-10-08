# Read-only installation evidence checks. The installer and UI are run by QA.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('PreInstall', 'PostInstall', 'PreUpgrade', 'PostUpgrade', 'PostUninstall')]
    [string]$Phase,

    [Parameter(Mandatory = $true)] [string]$InstallerPath,
    [Parameter(Mandatory = $true)] [string]$ExpectedInstallerSha256,
    [Parameter(Mandatory = $true)] [string]$InstallDirectory,
    [Parameter(Mandatory = $true)] [string]$UserDataDirectory,
    [string]$ExecutableRelativePath = 'AIVORA.exe',
    [string]$BackupPath,
    [string]$ExpectedBackupSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Verify([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Windows install verification: $Message" }
}

function Assert-PlainRelativeFile([string]$Root, [string]$RelativePath) {
    Assert-Verify (-not [string]::IsNullOrWhiteSpace($RelativePath)) 'backup file path is empty'
    Assert-Verify (-not [System.IO.Path]::IsPathRooted($RelativePath)) "backup file path is absolute: $RelativePath"
    $segments = @($RelativePath -split '[/\\]')
    Assert-Verify (-not ($segments | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })) "backup file path is unsafe: $RelativePath"
    $current = $Root
    foreach ($segment in $segments) {
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        Assert-Verify (-not (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) "backup path contains a link: $RelativePath"
    }
    Assert-Verify (-not $item.PSIsContainer) "backup entry is not a file: $RelativePath"
    return $current
}

Assert-Verify ($ExpectedInstallerSha256 -match '^[0-9a-fA-F]{64}$') 'installer SHA256 is invalid'
Assert-Verify ([System.IO.Path]::IsPathRooted($InstallerPath)) 'installer path must be absolute'
Assert-Verify ([System.IO.Path]::IsPathRooted($InstallDirectory)) 'install directory must be absolute'
Assert-Verify ([System.IO.Path]::IsPathRooted($UserDataDirectory)) 'user data directory must be absolute'
Assert-Verify (Test-Path -LiteralPath $InstallerPath -PathType Leaf) 'installer evidence file is missing'
$installerHash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash
Assert-Verify ($installerHash -ieq $ExpectedInstallerSha256) 'installer SHA256 drifted'
Assert-Verify (-not [System.IO.Path]::IsPathRooted($ExecutableRelativePath)) 'executable path must be relative'
Assert-Verify (-not (($ExecutableRelativePath -split '[/\\]') | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })) 'executable path is unsafe'

$installRoot = [System.IO.Path]::GetFullPath($InstallDirectory)
$userDataRoot = [System.IO.Path]::GetFullPath($UserDataDirectory)
$executable = Join-Path $installRoot $ExecutableRelativePath
$backupHash = $null
$backupFileCount = $null

if ($Phase -eq 'PostUpgrade') {
    Assert-Verify (-not [string]::IsNullOrWhiteSpace($BackupPath)) 'installer backup path is required after upgrade'
    Assert-Verify ([System.IO.Path]::IsPathRooted($BackupPath)) 'backup directory must be absolute'
    Assert-Verify ($ExpectedBackupSha256 -match '^[0-9a-fA-F]{64}$') 'backup receipt SHA256 is invalid'
    $backupRoot = [System.IO.Path]::GetFullPath($BackupPath)
    Assert-Verify (Test-Path -LiteralPath $backupRoot -PathType Container) 'backup directory is missing'
    $backupRootItem = Get-Item -LiteralPath $backupRoot -Force -ErrorAction Stop
    Assert-Verify (-not (($backupRootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) 'backup directory is a link'
    $backupPrefix = $backupRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $userDataPrefix = $userDataRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    Assert-Verify (-not ($backupRoot.Equals($userDataRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $backupRoot.StartsWith($userDataPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $userDataRoot.StartsWith($backupPrefix, [System.StringComparison]::OrdinalIgnoreCase))) 'backup directory overlaps user data'
    $receiptPath = Assert-PlainRelativeFile $backupRoot 'receipt.json'
    $backupHash = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash
    Assert-Verify ($backupHash -ieq $ExpectedBackupSha256) 'backup receipt SHA256 drifted'
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Verify ($receipt.schema_version -eq 1) 'backup receipt schema is unsupported'
    Assert-Verify ([string]$receipt.source_workspace -ieq $userDataRoot) 'backup source workspace differs from user data directory'
    Assert-Verify (@($receipt.files).Count -gt 0) 'backup receipt has no files'
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($receipt.files)) {
        $relative = [string]$entry.path
        Assert-Verify ($seen.Add($relative.Replace('\', '/'))) "duplicate backup file: $relative"
        Assert-Verify ([string]$entry.sha256 -match '^[0-9a-fA-F]{64}$') "invalid backup SHA256: $relative"
        Assert-Verify ([long]$entry.byte_size -ge 0) "invalid backup byte size: $relative"
        $file = Assert-PlainRelativeFile $backupRoot $relative
        Assert-Verify ((Get-Item -LiteralPath $file -Force).Length -eq [long]$entry.byte_size) "backup byte size drifted: $relative"
        Assert-Verify ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ieq [string]$entry.sha256) "backup SHA256 drifted: $relative"
    }
    Assert-Verify ($seen.Contains('workspace.sqlite3')) 'backup database is missing from receipt'
    foreach ($item in @(Get-ChildItem -LiteralPath $backupRoot -Recurse -Force)) {
        Assert-Verify (-not (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) 'backup tree contains a link'
        if ($item.PSIsContainer) { continue }
        $relative = $item.FullName.Substring($backupRoot.Length + 1).Replace('\', '/')
        Assert-Verify ($relative -ceq 'receipt.json' -or $seen.Contains($relative)) "unlisted backup file: $relative"
    }
    $backupFileCount = $seen.Count
}

switch ($Phase) {
    'PreInstall' {
        Assert-Verify (-not (Test-Path -LiteralPath $installRoot)) 'install directory already exists'
    }
    'PostInstall' {
        Assert-Verify (Test-Path -LiteralPath $executable -PathType Leaf) 'installed executable is missing'
    }
    'PreUpgrade' {
        Assert-Verify (Test-Path -LiteralPath $executable -PathType Leaf) 'current installed executable is missing'
        Assert-Verify (Test-Path -LiteralPath $userDataRoot -PathType Container) 'user data is missing before upgrade'
    }
    'PostUpgrade' {
        Assert-Verify (Test-Path -LiteralPath $executable -PathType Leaf) 'upgraded executable is missing'
        Assert-Verify (Test-Path -LiteralPath $userDataRoot -PathType Container) 'user data is missing after upgrade'
    }
    'PostUninstall' {
        Assert-Verify (-not (Test-Path -LiteralPath $installRoot)) 'program files remain after uninstall'
        Assert-Verify (Test-Path -LiteralPath $userDataRoot -PathType Container) 'user data was not preserved after uninstall'
    }
}

[pscustomobject]@{
    phase = $Phase
    installer_sha256 = $installerHash
    install_directory = $installRoot
    user_data_directory = $userDataRoot
    installed_executable_present = (Test-Path -LiteralPath $executable -PathType Leaf)
    backup_sha256 = $backupHash
    backup_file_count = $backupFileCount
    scope = 'filesystem-and-hash-only; QA must verify UI, data readback and recovery separately'
} | ConvertTo-Json -Depth 3
