param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923'
$qaRoot = 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa02-mlt-test-20260928'
$spec = 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\art04-mlt-test-20260928\MLT-唯一合成TEST工程规格.md'
$lock = Join-Path $root 'config\media-toolchain-lock.json'
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$ffmpegReal = (Get-Item -LiteralPath $ffmpeg).Target
$ffprobeReal = (Get-Item -LiteralPath $ffprobe).Target
$specSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $spec).Hash
$lockSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $lock).Hash
$ffmpegSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $ffmpegReal).Hash
$ffprobeSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $ffprobeReal).Hash
if ($specSha -ne '4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D') { throw 'MLT spec changed' }
if ($lockSha -ne 'A4554A71D7942C0706585B609E77059F71634E84EB9A2EDD4072965A9FCFB072') { throw 'Toolchain lock changed' }
if ($ffmpegSha -ne 'AD8F211BC894755E0061C55AB280AE00E8D3D4F15A8CC4372B24CFA247B5942E') { throw 'FFmpeg binary changed' }
if ($ffprobeSha -ne '9DF3B0B5275E830961DF6D94E1F7A71121A7ABD5FF708E9FEC8A0B6084A55015') { throw 'ffprobe binary changed' }
$out = [IO.Path]::GetFullPath($OutputDirectory)
$relative = [IO.Path]::GetRelativePath($qaRoot, $out)
if ($relative -eq '.' -or $relative.StartsWith('..') -or [IO.Path]::IsPathRooted($relative)) { throw 'Output must be a new child of QA root' }
if (Test-Path -LiteralPath $out) { throw 'Output already exists' }
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
New-Item -ItemType Directory -Path $out -Force:$false | Out-Null

function Invoke-Captured {
  param([string]$Exe, [string[]]$ArgumentList, [string]$Stem)
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $Exe
  $info.WorkingDirectory = $out
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($arg in $ArgumentList) { [void]$info.ArgumentList.Add($arg) }
  $stdoutPath = Join-Path $out ($Stem + '.stdout.raw')
  $stderrPath = Join-Path $out ($Stem + '.stderr.raw')
  $stdout = [IO.File]::Open($stdoutPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  $stderr = [IO.File]::Open($stderrPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  $startedUtc = [DateTime]::UtcNow.ToString('o')
  try {
    if (-not $process.Start()) { throw "Failed to start $Stem" }
    $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
    $stderrTask = $process.StandardError.BaseStream.CopyToAsync($stderr)
    $process.WaitForExit()
    [Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask))
    $code = $process.ExitCode
  } finally {
    $stdout.Dispose()
    $stderr.Dispose()
    $process.Dispose()
  }
  $receipt = [ordered]@{
    stem = $Stem; executable = $Exe; args = $ArgumentList; started_utc = $startedUtc
    finished_utc = [DateTime]::UtcNow.ToString('o'); exit_code = $code
    stdout_path = $stdoutPath; stdout_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $stdoutPath).Hash
    stderr_path = $stderrPath; stderr_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $stderrPath).Hash
  }
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out ($Stem + '.receipt.json')) -Encoding utf8
  if ($code -ne 0) { throw "$Stem failed with exit $code; raw logs preserved" }
  return $receipt
}

$receipts = @()
$receipts += Invoke-Captured $ffmpegReal @('-version') 'ffmpeg-version'
$receipts += Invoke-Captured $ffprobeReal @('-version') 'ffprobe-version'
$media = @(
  @{ name='v1-blue.webm'; args=@('-hide_banner','-nostdin','-f','lavfi','-i','color=c=blue:s=320x568:r=25:d=3','-vf','drawbox=x=8:y=0:w=16:h=568:color=white:t=fill','-an','-frames:v','75','-c:v','libvpx-vp9','-deadline','good','-cpu-used','4','-b:v','0','-crf','25','-pix_fmt','yuv420p','-n') },
  @{ name='v2-red.webm'; args=@('-hide_banner','-nostdin','-f','lavfi','-i','color=c=red:s=320x568:r=25:d=3','-vf','drawbox=x=296:y=0:w=16:h=568:color=white:t=fill','-an','-frames:v','75','-c:v','libvpx-vp9','-deadline','good','-cpu-used','4','-b:v','0','-crf','25','-pix_fmt','yuv420p','-n') },
  @{ name='dialogue-test.wav'; args=@('-hide_banner','-nostdin','-f','lavfi','-i','aevalsrc=0.2511886*sin(2*PI*1000*t):s=48000:d=1','-ac','1','-ar','48000','-c:a','pcm_s16le','-n') },
  @{ name='bgm-test.wav'; args=@('-hide_banner','-nostdin','-f','lavfi','-i','aevalsrc=0.0316228*sin(2*PI*220*t):s=48000:d=5','-ac','1','-ar','48000','-c:a','pcm_s16le','-n') }
)
foreach ($item in $media) {
  $file = Join-Path $out $item.name
  $receipts += Invoke-Captured $ffmpegReal ($item.args + @($file)) ('create-' + $item.name)
  $receipts += Invoke-Captured $ffprobeReal @('-v','error','-show_streams','-show_format','-count_frames','-of','json',$file) ('probe-' + $item.name)
  $receipts += Invoke-Captured $ffmpegReal @('-hide_banner','-nostdin','-v','error','-i',$file,'-f','null','-') ('decode-' + $item.name)
}
$files = foreach ($item in $media) {
  $file = Join-Path $out $item.name
  [ordered]@{ name=$item.name; path=$file; bytes=(Get-Item -LiteralPath $file).Length
    sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash
    usage='SYNTHETIC_TEST_ONLY' }
}
$manifest = [ordered]@{
  kind='QA02_MLT_SYNTHETIC_FOUR_MEDIA_MANIFEST'; status='FOUR_MEDIA_ONLY_NO_SRT_NO_MLT'
  created_utc=[DateTime]::UtcNow.ToString('o')
  spec_path=$spec; spec_sha256=$specSha; lock_path=$lock; lock_sha256=$lockSha
  ffmpeg_path=$ffmpegReal; ffmpeg_sha256=$ffmpegSha
  ffprobe_path=$ffprobeReal; ffprobe_sha256=$ffprobeSha
  output_directory=$out; files=$files; receipts=$receipts
  dialogue_status='DIALOGUE_SPEECH_NOT_TESTED'
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'four-media-manifest.json') -Encoding utf8
[pscustomobject]@{ status=$manifest.status; directory=$out; manifest_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $out 'four-media-manifest.json')).Hash; files=$files } | ConvertTo-Json -Depth 4
