# @file spotx-patch.ps1
# @author: ForUltraplayer
# @brief Apply pinned SpotX patches only to a marked, isolated Spotify staging directory.
param([Parameter(Mandatory=$true)][string]$StagingDirectory,
      [string]$SourceRoot,
      [switch]$AllowUpdates)
$ErrorActionPreference = 'Stop'
if (-not $SourceRoot) { $SourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'third_party\spotx' }
function Get-Sha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
$spotifyDirectory = [IO.Path]::GetFullPath($StagingDirectory).TrimEnd('\')
$stageMarker = Join-Path $spotifyDirectory '.spotify-hangul-stage'
if (-not (Test-Path -LiteralPath $stageMarker) -or
    (Get-Content -LiteralPath $stageMarker -Raw).Trim() -ne 'SpotifyHangul isolated client') {
    throw 'Refusing to patch an unmarked Spotify directory.'
}
if ((Get-Item -LiteralPath $spotifyDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Staging root is a reparse point.'
}
if (@(Get-ChildItem -LiteralPath $spotifyDirectory -Recurse -Force |
    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
    throw 'Staging directory contains a reparse point.'
}
foreach ($item in (Get-Content -LiteralPath (Join-Path $SourceRoot 'upstream.json') -Raw | ConvertFrom-Json).files.PSObject.Properties) {
    if ((Get-Sha256 (Join-Path $SourceRoot $item.Name)) -ne $item.Value) {
        throw ('SpotX source digest mismatch: ' + $item.Name)
    }
}
$spotifyExecutable = Join-Path $spotifyDirectory 'Spotify.exe'
$offline = (Get-Item -LiteralPath $spotifyExecutable).VersionInfo.FileVersion
if ($offline -ne '1.3.6.1921') { throw ('Unverified Spotify version for this adapter: ' + $offline) }
$xpui_spa_patch = Join-Path $spotifyDirectory 'Apps\xpui.spa'
if (-not (Test-Path -LiteralPath $xpui_spa_patch) -or (Test-Path -LiteralPath (Join-Path $spotifyDirectory 'Apps\xpui\xpui.js'))) {
    throw 'SpotX staging requires original Spotify SPA archives.'
}
$spotifyDll = Join-Path $spotifyDirectory 'Spotify.dll'
$chrome_elf = Join-Path $spotifyDirectory 'chrome_elf.dll'
$exe_bak = Join-Path $spotifyDirectory 'Spotify.bak'
$dll_bak = Join-Path $spotifyDirectory 'Spotify.dll.bak'
$chrome_elf_bak = Join-Path $spotifyDirectory 'chrome_elf.dll.bak'
$webjson = Get-Content -LiteralPath (Join-Path $SourceRoot 'patches.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$lang = & (Join-Path $SourceRoot 'en.ps1')
$ru = $false
$test_spa = $true
$sendversion_off = $true
$premium = $false
$new_theme = $true
$exp_spotify = $true
$hide_col_icon_off = $true
$not_block_update = [bool]$AllowUpdates
$no_pause = $true
$css = $null
$calltype = $null
function Stop-Script { param([string]$Message = 'SpotX patch stopped') throw $Message }
function Stop-BrokenSpotifyFiles { param([string]$Details) throw $Details }
. (Join-Path $SourceRoot 'patch-functions.ps1')
. (Join-Path $SourceRoot 'patch-calls.ps1')
$archive = [IO.Compression.ZipFile]::OpenRead($xpui_spa_patch)
try {
    $reader = New-Object IO.StreamReader($archive.GetEntry('xpui.js').Open())
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($text -notmatch 'patched by spotx') { throw 'SpotX archive verification failed.' }
} finally { $archive.Dispose() }
if ((Get-Sha256 $spotifyDll) -eq (Get-Sha256 $dll_bak)) {
    throw 'SpotX binary was not modified.'
}
[PSCustomObject]@{ App='SpotifyHangul'; SpotXRevision='3cfbdfd1fac3dc755155e434116e28b51acfec07';
    SpotifyVersion=$offline; UpdateBlocked=(-not $AllowUpdates); PatchedAt=(Get-Date -Format o) } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $spotifyDirectory 'spotx-hangul.json') -Encoding UTF8
Write-Output 'SpotX archive and binary patches verified.'
