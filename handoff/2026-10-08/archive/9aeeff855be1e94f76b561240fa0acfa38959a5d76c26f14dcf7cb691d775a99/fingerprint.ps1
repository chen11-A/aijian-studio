param([Parameter(Mandatory=$true)][string]$OutputPath)
$candidate = 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923'
$paths = @(
  'apps/desktop/src/remote-source-extract-contract.ts',
  'apps/desktop/src/remote-source-extract-ipc.ts',
  'apps/desktop/src/api-client.ts',
  'apps/desktop/src/preload.ts',
  'apps/desktop/src/main.ts',
  'apps/studio-web/src/api/studio.ts',
  'apps/studio-web/src/aivora/SourceExtractionPanel.tsx',
  'apps/studio-web/src/aivora/adapters/remoteSourceExtract.ts',
  'apps/studio-web/src/aivora/StoryPages.tsx'
)
$source = @($paths | ForEach-Object {
  $item = Get-Item -LiteralPath (Join-Path $candidate $_)
  [ordered]@{ path = $_; bytes = $item.Length; sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
})
$dist = @('apps/desktop/dist', 'apps/studio-web/dist' | ForEach-Object {
  $dir = Join-Path $candidate $_
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -File -Recurse | ForEach-Object {
      [ordered]@{
        path = $_.FullName.Substring($candidate.Length + 1).Replace('\','/')
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
      }
    }
  }
})
$result = [ordered]@{
  captured_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  candidate = $candidate
  head = (& git -C $candidate rev-parse HEAD | Out-String).Trim()
  status_paths = @(& git -C $candidate status --short)
  source = $source
  dist = $dist
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
