param([string]$ModelPath)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../data/video-runtime'))
$pythonManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'python-runtime.json') -Raw | ConvertFrom-Json
$runtime = Join-Path $root $pythonManifest.directory
$python = Join-Path $runtime 'python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'MOWO Python is missing. Run npm run video:setup first.' }

$modelHash = 'af5bc7dcbc517613d0d7fb39ee97add80e52a05d8de4717652e500a5bf573810'
$modelDirectory = Join-Path $root 'models'
$model = Join-Path $modelDirectory 'transnet-split.onnx'
New-Item -ItemType Directory -Force -Path $modelDirectory | Out-Null
if (-not (Test-Path -LiteralPath $model)) {
    if (-not $ModelPath) { throw 'Provide -ModelPath pointing to the verified TransNet V2 split ONNX model.' }
    $inputModel = [IO.Path]::GetFullPath($ModelPath)
    if (-not (Test-Path -LiteralPath $inputModel)) { throw 'Model file does not exist.' }
    if ((Get-FileHash -LiteralPath $inputModel -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelHash) {
        throw 'Model SHA-256 does not match the detector contract.'
    }
    Copy-Item -LiteralPath $inputModel -Destination ($model + '.partial')
    Move-Item -LiteralPath ($model + '.partial') -Destination $model
}
if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelHash) {
    throw 'MOWO model SHA-256 mismatch; existing file was preserved.'
}

$packages = Join-Path $runtime 'shot-packages'
$wheels = @(
    @('av-19.0.2-cp312-abi3-win_amd64.whl', '3ce5a1d7b916d13c16ac58f1756f0fee4af2d53f02bc1403e18550b50d375a22', 'https://files.pythonhosted.org/packages/32/5a/743a83666ded197df8b9957e2800bef9a39d52b23be2ca211bbd14b5fb22/av-19.0.2-cp312-abi3-win_amd64.whl'),
    @('numpy-2.4.5-cp314-cp314-win_amd64.whl', '4bd2cd4ef9c0afa87de73723c0a33c0edff62143e1432917458e26d3d195d87f', 'https://files.pythonhosted.org/packages/aa/92/d063df4d63d988b20d881856c74df76c0c1786229bb870f3a52af0981d4d/numpy-2.4.5-cp314-cp314-win_amd64.whl'),
    @('onnxruntime_directml-1.24.4-cp314-cp314-win_amd64.whl', '51d86bb949488e572b00422f344990a4a81d982416d73b6c0e4ced2bcd423d19', 'https://files.pythonhosted.org/packages/b7/04/816932a3ade867a687e406716ca76e0774c6b921545b45818e3ebfcc54ce/onnxruntime_directml-1.24.4-cp314-cp314-win_amd64.whl'),
    @('flatbuffers-25.12.19-py2.py3-none-any.whl', '7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4', 'https://files.pythonhosted.org/packages/e8/2d/d2a548598be01649e2d46231d151a6c56d10b964d94043a335ae56ea2d92/flatbuffers-25.12.19-py2.py3-none-any.whl'),
    @('packaging-26.3-py3-none-any.whl', 'd7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c', 'https://files.pythonhosted.org/packages/63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527/packaging-26.3-py3-none-any.whl'),
    @('protobuf-7.36.2-cp310-abi3-win_amd64.whl', 'a300819d441e078a5608c0d3c709796bb548136058fda017ae51d425b44fd353', 'https://files.pythonhosted.org/packages/8a/55/b77bda4e5e5f5971fb51b07663694690e9afdb9402136c16a522bd621cad/protobuf-7.36.2-cp310-abi3-win_amd64.whl'),
    @('sympy-1.14.0-py3-none-any.whl', 'e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5', 'https://files.pythonhosted.org/packages/a2/09/77d55d46fd61b4a135c444fc97158ef34a095e5681d0a6c10b75bf356191/sympy-1.14.0-py3-none-any.whl'),
    @('mpmath-1.3.0-py3-none-any.whl', 'a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c', 'https://files.pythonhosted.org/packages/43/e3/7d92a15f894aa0c9c4b49b8ee9ac9850d6e63b03c9c32c0367a13ae62209/mpmath-1.3.0-py3-none-any.whl')
)

New-Item -ItemType Directory -Force -Path $packages | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($entry in $wheels) {
    $name, $expected, $url = $entry
    $marker = Join-Path $packages ($name + '.verified')
    if (Test-Path -LiteralPath $marker) { continue }
    $archivePath = Join-Path $root $name
    if (-not (Test-Path -LiteralPath $archivePath)) {
        Invoke-WebRequest -Uri $url -OutFile ($archivePath + '.download') -TimeoutSec 300
        Move-Item -LiteralPath ($archivePath + '.download') -Destination $archivePath
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        throw ('Wheel SHA-256 mismatch: ' + $name)
    }
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        foreach ($file in $archive.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $packages $file.FullName))
            if (-not $target.StartsWith($packages + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
                throw ('Unsafe wheel entry: ' + $name)
            }
            if ($file.Name) {
                New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($file, $target, $true)
            }
        }
    } finally { $archive.Dispose() }
    [IO.File]::WriteAllText($marker, $expected, [Text.UTF8Encoding]::new($false))
    Remove-Item -LiteralPath $archivePath
}

$pth = Join-Path $runtime $pythonManifest.pth
$content = [IO.File]::ReadAllText($pth)
if ($content -notmatch '(?m)^shot-packages\r?$') {
    [IO.File]::WriteAllText($pth, ($content.TrimEnd() + "`nshot-packages`n"), [Text.UTF8Encoding]::new($false))
}
& $python -I -c "import av,numpy,onnxruntime; assert av.__version__ == '19.0.2' and numpy.__version__ == '2.4.5' and onnxruntime.__version__ == '1.24.4'; print('MOWO shot runtime ready:', av.__version__, numpy.__version__, onnxruntime.__version__)"
if ($LASTEXITCODE -ne 0) { throw 'MOWO shot runtime import verification failed.' }
Write-Output ('Verified model: ' + $model)
