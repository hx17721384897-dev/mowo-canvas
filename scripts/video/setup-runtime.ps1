$ErrorActionPreference = 'Stop'
$videoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../data/video-runtime'))
New-Item -ItemType Directory -Force -Path $videoRoot | Out-Null

function Get-VerifiedArtifact($Url, $Name, $Hash) {
    $target = Join-Path $videoRoot $Name
    if (-not (Test-Path -LiteralPath $target)) {
        $download = $target + '.download'
        Invoke-WebRequest -Uri $Url -OutFile $download -TimeoutSec 300
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $Hash) {
            throw "Downloaded artifact hash mismatch: $Name. The incomplete file was not published."
        }
        Move-Item -LiteralPath $download -Destination $target
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $Hash) {
        throw "Artifact hash mismatch: $Name. Preserve the file for diagnosis; do not execute it."
    }
    return $target
}

$python = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'python-runtime.json') -Raw | ConvertFrom-Json
$pythonZip = Get-VerifiedArtifact $python.url $python.archive $python.sha256
$wheel = Get-VerifiedArtifact 'https://files.pythonhosted.org/packages/b7/75/ae700ddc7e0b1095fd06cf7e251627dcf4cafcaff460cce92cdc08023b13/yt_dlp-2026.10.21-py3-none-any.whl' 'yt_dlp-2026.10.21-py3-none-any.whl' '94A3A3E2C423129D0BBD2F1BE000C4171FA1226C29E251C84AFF868F2851C247'
$qrWheel = Get-VerifiedArtifact 'https://files.pythonhosted.org/packages/dd/b8/d2d6d731733f51684bbf76bf34dab3b70a9148e8f2cef2bb544fccec681a/qrcode-8.2-py3-none-any.whl' 'qrcode-8.2-py3-none-any.whl' '16E64E0716C14960108E85D853062C9E8BBA5CA8252C0B4D0231B9DF4060FF4F'
$pythonDirectory = Join-Path $videoRoot $python.directory
Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDirectory -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageDirectory = Join-Path $pythonDirectory 'packages'
New-Item -ItemType Directory -Force -Path $packageDirectory | Out-Null
foreach ($package in @($wheel, $qrWheel)) {
$archive = [IO.Compression.ZipFile]::OpenRead($package)
try {
    foreach ($entry in $archive.Entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $packageDirectory $entry.FullName))
        if (-not $target.StartsWith($packageDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Invalid package entry'
        }
        if ($entry.Name) {
            New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    }
} finally { $archive.Dispose() }
}
[IO.File]::WriteAllText((Join-Path $pythonDirectory $python.pth), ($python.zipLibrary + "`n.`npackages`nshot-packages`n"), [Text.UTF8Encoding]::new($false))
Write-Output ('Python ' + $python.version + ' runtime ready. Media tools: scripts/video/setup-media.ps1. Existing runtimes were preserved.')
