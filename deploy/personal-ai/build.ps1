param(
    [string]$BaseImage = 'ghcr.io/ayaka-notes/overleaf-pro@sha256:5f84c7f2d0230dd558130ca2901f603d4e0bfe021054879efea1b7fece2f4f1c',
    [string]$ImageTag = 'ayakaleaf-pro:personal-ai',
    [switch]$KeepBuilder
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$buildId = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$builderName = "ayakaleaf-build-$buildId"
$outputRoot = Join-Path $workspaceRoot ".local\build-$buildId"
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

function Invoke-Docker {
    param([string[]]$DockerArguments)
    & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($DockerArguments[0])" }
}

Push-Location -LiteralPath $workspaceRoot
try {
    # Git's exclude rules omit local .env and .local build/cache contents.
    $sourceFiles = @(git -c core.quotePath=false ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to enumerate repository source' }
    if ($sourceFiles -contains '.env' -or @($sourceFiles | Where-Object { $_ -match '(^|/)\.git(/|$)|(^|/)\.local(/|$)|^\.\.' }).Count) {
        throw 'Unsafe build input: refusing to archive credentials or local metadata'
    }
    $fileList = Join-Path $outputRoot 'source-files.txt'
    [System.IO.File]::WriteAllLines($fileList, $sourceFiles, (New-Object System.Text.UTF8Encoding($false)))
    # .NET emits UTF-8 ZIP names consistently, including Chinese documentation.
    # Windows tar's --files-from uses the active ANSI code page on some hosts.
    $sourceArchive = Join-Path $outputRoot 'source.zip'
    $sourceZip = [System.IO.Compression.ZipFile]::Open($sourceArchive, 'Create')
    try {
        foreach ($relativePath in $sourceFiles) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($sourceZip, (Join-Path $workspaceRoot $relativePath), $relativePath, [System.IO.Compression.CompressionLevel]::Fastest) | Out-Null
        }
    } finally { $sourceZip.Dispose() }
    Invoke-Docker -DockerArguments @('create', '--name', $builderName, '--entrypoint', 'sleep', $BaseImage, 'infinity')
    Invoke-Docker -DockerArguments @('start', $builderName)
    Invoke-Docker -DockerArguments @('cp', $sourceArchive, "${builderName}:/tmp/source.zip")
    $compileScript = @'
set -eu
mkdir -p /src
unzip -q /tmp/source.zip -d /src
cp -a /overleaf/.yarn/cache /src/.yarn/cache
cd /src
YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org npm_config_nodedir=/usr CYPRESS_INSTALL_BINARY=0 yarn install
export NODE_OPTIONS="--require /src/.pnp.cjs --import /src/.pnp.register.mjs"
cd services/web
yarn run lezer-latex:generate
node --test modules/workbench/test/*.test.mjs modules/site-settings/test/*.test.mjs
yarn run precompile-pug
node ../../deploy/personal-ai/prepare-locales.mjs
yarn run extract-translations
yarn run webpack:production
cd /src
YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org npm_config_nodedir=/usr yarn workspaces focus --all --production
tar --exclude='./.yarn/cache' --exclude='./.local' --exclude='./.env' --exclude='./.git' -cf /tmp/overlay.tar -C /src .
mkdir -p /tmp/new-cache/.yarn/cache
for archive in /src/.yarn/cache/*; do
  name=$(basename "$archive")
  if [ ! -f "/overleaf/.yarn/cache/$name" ]; then cp "$archive" /tmp/new-cache/.yarn/cache/; fi
done
tar rf /tmp/overlay.tar -C /tmp/new-cache .
'@
    # A file avoids Windows PowerShell 5.1 stripping quotes in multiline native arguments.
    $compilePath = Join-Path $outputRoot 'compile.sh'
    [System.IO.File]::WriteAllText($compilePath, $compileScript.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
    Invoke-Docker -DockerArguments @('cp', $compilePath, "${builderName}:/tmp/compile.sh")
    Invoke-Docker -DockerArguments @('exec', $builderName, 'bash', '/tmp/compile.sh')
    $overlayArchive = Join-Path $outputRoot 'overlay.tar'
    Invoke-Docker -DockerArguments @('cp', "${builderName}:/tmp/overlay.tar", $overlayArchive)
    # Let Docker unpack Linux artifacts, preserving permissions, links and UTF-8 names.
    [System.IO.File]::WriteAllLines((Join-Path $outputRoot '.dockerignore'), @('/source.zip', '/source-files.txt', '/compile.sh'), (New-Object System.Text.UTF8Encoding($false)))
    Invoke-Docker -DockerArguments @('build', '--build-arg', "BASE_IMAGE=$BaseImage", '-t', $ImageTag, '-f', (Join-Path $PSScriptRoot 'Dockerfile'), $outputRoot)
    Write-Output "Built $ImageTag"
}
finally {
    if (-not $KeepBuilder) { & docker rm -f $builderName 2>$null | Out-Null }
    Pop-Location
}
