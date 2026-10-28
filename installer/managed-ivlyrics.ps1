# @file managed-ivlyrics.ps1
# @brief Replace managed ivLyrics code transactionally without modifying Spotify profile data.

function Assert-IvLyricsChild([string]$Parent, [string]$Path) {
    $base=[IO.Path]::GetFullPath($Parent).TrimEnd('\')
    $full=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $full.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'ivLyrics path escapes its owner.' }
    $check=$full
    while ($check -and $check.Length -ge $base.Length) {
        if ((Test-Path -LiteralPath $check) -and ((Get-Item -LiteralPath $check).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'ivLyrics path contains a reparse point.'
        }
        $check=Split-Path -Parent $check
    }
    if (Test-Path -LiteralPath $full) {
        if (@(Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
            throw 'ivLyrics tree contains a reparse point.'
        }
    }
}

function Test-IvLyricsFiles([string]$Directory, $Manifest, [switch]$AllowExtra) {
    foreach ($file in $Manifest.files.PSObject.Properties) {
        $path=Join-Path $Directory $file.Name
        Assert-IvLyricsChild $Directory $path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
        $stream=[IO.File]::OpenRead($path)
        $hash=[Security.Cryptography.SHA256]::Create()
        try { $digest=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
        finally { $stream.Dispose(); $hash.Dispose() }
        if ($digest -cne $file.Value) { return $false }
    }
    if ($AllowExtra) { return $true }
    # Stale scripts from an older version must not survive a replacement.
    $expected=@($Manifest.files.PSObject.Properties).Count+1
    return @(Get-ChildItem -LiteralPath $Directory -Recurse -File -Force).Count -eq $expected
}

function Install-ManagedIvLyrics([string]$InstallRoot, [string]$ConfigRoot) {
    $source=Join-Path $InstallRoot 'ivLyrics'
    $target=Join-Path $ConfigRoot 'CustomApps\ivLyrics'
    Assert-IvLyricsChild $InstallRoot $source
    Assert-IvLyricsChild $ConfigRoot $target
    $manifest=Get-Content -LiteralPath (Join-Path $source 'hangul-managed.json') -Raw | ConvertFrom-Json
    $component=(Get-Content -LiteralPath (Join-Path $InstallRoot 'components.json') -Raw | ConvertFrom-Json).components.ivlyrics
    if ($manifest.app -ne 'SpotifyHangul' -or $manifest.version -ne $component.version -or $manifest.revision -ne $component.revision -or
        -not $manifest.files.'index.js' -or -not (Test-IvLyricsFiles $source $manifest -AllowExtra)) { throw 'Bundled ivLyrics integrity verification failed.' }
    if ((Test-Path -LiteralPath (Join-Path $target 'hangul-managed.json')) -and (Test-IvLyricsFiles $target $manifest)) {
        return [PSCustomObject]@{Changed=$false;Target=$target;Backup=$null;InstallRoot=$InstallRoot;ConfigRoot=$ConfigRoot}
    }
    $backup=Join-Path $InstallRoot ('backup\ivlyrics-'+[Guid]::NewGuid().ToString('N'))
    $stage=Join-Path $ConfigRoot ('CustomApps\.ivlyrics-stage-'+[Guid]::NewGuid().ToString('N'))
    Assert-IvLyricsChild $InstallRoot $backup
    Assert-IvLyricsChild $ConfigRoot $stage
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force)
    $saved=$false
    try {
        [void](New-Item -ItemType Directory -Path $stage)
        # NSIS overlays the payload directory. Copy only the new manifest's files,
        # so obsolete source files from a previous installer are never executed.
        foreach ($file in $manifest.files.PSObject.Properties) {
            $destination=Join-Path $stage $file.Name
            [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
            Copy-Item -LiteralPath (Join-Path $source $file.Name) -Destination $destination
        }
        Copy-Item -LiteralPath (Join-Path $source 'hangul-managed.json') -Destination (Join-Path $stage 'hangul-managed.json')
        if (-not (Test-IvLyricsFiles $stage $manifest)) { throw 'Staged ivLyrics integrity verification failed.' }
        if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup; $saved=$true }
        Move-Item -LiteralPath $stage -Destination $target
    } catch {
        if ($saved) { Move-Item -LiteralPath $backup -Destination $target }
        throw
    } finally {
        if (Test-Path -LiteralPath $stage) { Assert-IvLyricsChild $ConfigRoot $stage; Remove-Item -LiteralPath $stage -Recurse -Force }
    }
    return [PSCustomObject]@{Changed=$true;Target=$target;Backup=if($saved){$backup}else{$null};InstallRoot=$InstallRoot;ConfigRoot=$ConfigRoot}
}

function Undo-ManagedIvLyrics($Transaction) {
    if (-not $Transaction -or -not $Transaction.Changed) { return }
    Assert-IvLyricsChild $Transaction.ConfigRoot $Transaction.Target
    if (Test-Path -LiteralPath $Transaction.Target) { Remove-Item -LiteralPath $Transaction.Target -Recurse -Force }
    if ($Transaction.Backup -and (Test-Path -LiteralPath $Transaction.Backup)) {
        Assert-IvLyricsChild $Transaction.InstallRoot $Transaction.Backup
        Move-Item -LiteralPath $Transaction.Backup -Destination $Transaction.Target
    }
}
