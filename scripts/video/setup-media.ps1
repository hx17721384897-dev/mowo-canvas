$ErrorActionPreference = 'Stop'
$videoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../data/video-runtime'))
New-Item -ItemType Directory -Force -Path $videoRoot | Out-Null
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'media-runtime.json') -Raw | ConvertFrom-Json
$archive = Join-Path $videoRoot $manifest.archive
$hash = $manifest.sha256
if (-not (Test-Path -LiteralPath $archive)) {
    $download = $archive + '.download'
    Invoke-WebRequest -Uri $manifest.url -OutFile $download -TimeoutSec 300
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $hash) { throw 'FFmpeg download hash mismatch' }
    Move-Item -LiteralPath $download -Destination $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $hash) { throw 'FFmpeg archive hash mismatch; preserved for diagnosis' }
$entries = & tar.exe -tf $archive
if ($LASTEXITCODE -ne 0) { throw 'Windows tar cannot read this 7z archive' }
foreach ($entry in $entries) {
    if ($entry -match '(^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$))') { throw 'Invalid archive entry' }
}
$package = Join-Path $videoRoot 'media-package'
New-Item -ItemType Directory -Force -Path $package | Out-Null
& tar.exe -xf $archive -C $package
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg extraction failed' }
$source = Join-Path $package $manifest.directory
$tools = Join-Path $videoRoot 'tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
foreach ($binary in @('ffmpeg.exe', 'ffprobe.exe')) {
    Copy-Item -LiteralPath (Join-Path $source ('bin/' + $binary)) -Destination (Join-Path $tools $binary) -Force
    if ((Get-FileHash -LiteralPath (Join-Path $tools $binary) -Algorithm SHA256).Hash -ne $manifest.binaries.$binary) {
        throw ('Media executable hash mismatch: ' + $binary)
    }
}
foreach ($notice in @('LICENSE', 'LICENSE.txt', 'README.txt')) {
    $noticePath = Join-Path $source $notice
    if (Test-Path -LiteralPath $noticePath) { Copy-Item -LiteralPath $noticePath -Destination (Join-Path $tools $notice) -Force }
}
foreach ($binary in @('ffmpeg.exe', 'ffprobe.exe')) {
    $versionOutput = & (Join-Path $tools $binary) -version
    if ($LASTEXITCODE -ne 0) { throw ('Media executable verification failed: ' + $binary) }
    $versionOutput | Select-Object -First 1
}
Write-Output 'MOWO media tools ready; no dependency on line or system PATH.'
