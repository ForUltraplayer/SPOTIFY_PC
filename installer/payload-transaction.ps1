# @file payload-transaction.ps1
# @brief Stage verified application files and recover a complete installation after failure or interruption.
param([ValidateSet('Apply','Commit','Recover','Rollback','Cleanup')][string]$Mode,
      [string]$InstallRoot,[string]$PayloadRoot,[int]$OwnerProcessId=$PID)

function Get-PayloadHash([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    $hash=[Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $hash.Dispose() }
}

function Assert-PayloadTree([string]$Path) {
    $full=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    $check=$full
    while ($check) {
        if ((Test-Path -LiteralPath $check) -and ((Get-Item -LiteralPath $check -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Update path contains a reparse point.' }
        $check=Split-Path -Parent $check
    }
    if (Test-Path -LiteralPath $full) {
        if (@(Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Update tree contains a reparse point.' }
    }
    return $full
}

function Get-PayloadTransactionPath([string]$Root) {
    $rootFull=Assert-PayloadTree $Root
    $forbidden=@([IO.Path]::GetPathRoot($rootFull).TrimEnd('\'),$env:USERPROFILE,$env:APPDATA,$env:LOCALAPPDATA,$env:ProgramFiles,${env:ProgramFiles(x86)},$env:SystemRoot)
    if (-not [IO.Path]::IsPathRooted($Root) -or $forbidden -contains $rootFull) { throw 'Select a dedicated application subdirectory.' }
    $hash=[Security.Cryptography.SHA256]::Create()
    try { $id=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($rootFull.ToLowerInvariant()))).Replace('-','').Substring(0,12) }
    finally { $hash.Dispose() }
    return Join-Path (Split-Path -Parent $rootFull) ('.'+(Split-Path -Leaf $rootFull)+'-update-'+$id)
}

function Get-PayloadShortcuts {
    $desktop=[Environment]::GetFolderPath('Desktop')
    $programs=[Environment]::GetFolderPath('Programs')
    return @((Join-Path $desktop 'Spotify 한글 가사.lnk'),(Join-Path $programs 'Spotify 한글 가사\Spotify 한글 가사.lnk'),(Join-Path $programs 'Spotify 한글 가사\제거.lnk'))
}

function Get-PayloadRegistryPaths {
    return @('Software\SpotifyHangul','Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul')
}

function Save-PayloadJournal($Transaction) {
    $path=Join-Path $Transaction.Directory 'journal.json'
    $temporary=$path+'.tmp'
    [IO.File]::WriteAllText($temporary,($Transaction | ConvertTo-Json -Depth 14),[Text.UTF8Encoding]::new($true))
    if (Test-Path -LiteralPath $path) { [IO.File]::Replace($temporary,$path,($path+'.previous')) }
    else { [IO.File]::Move($temporary,$path) }
}

function Read-PayloadTransaction([string]$Root) {
    $directory=Get-PayloadTransactionPath $Root
    if (-not (Test-Path -LiteralPath $directory)) { return $null }
    [void](Assert-PayloadTree $directory)
    $file=Join-Path $directory 'journal.json'
    if (-not (Test-Path -LiteralPath $file)) { throw ('An unrecognized update directory exists: '+$directory) }
    $transaction=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($transaction.App -ne 'SpotifyHangul' -or $transaction.Root -ne [IO.Path]::GetFullPath($Root).TrimEnd('\') -or $transaction.Directory -ne $directory -or $transaction.Schema -ne 1) { throw 'Invalid update recovery record.' }
    if ($transaction.Status -notin @('snapshotting','prepared','applying','pending-commit','committed','restoring','restored')) { throw 'Unknown update recovery status.' }
    foreach ($shortcut in @($transaction.Shortcuts)) {
        if ($shortcut.Path -notin @(Get-PayloadShortcuts) -or $shortcut.Name -notmatch '^shortcut-[0-2]\.lnk$') { throw 'Invalid shortcut recovery target.' }
    }
    foreach ($entry in @($transaction.Registry)) {
        if ($entry.Path -notin @(Get-PayloadRegistryPaths)) { throw 'Invalid registry recovery target.' }
    }
    return $transaction
}

function Stop-PayloadProcesses([string]$Root) {
    $spotify=Join-Path $Root 'Spotify\Spotify.exe'
    $overlay=Join-Path $Root 'desktop-overlay\lyrics-plus-overlay.exe'
    $bridge=Join-Path $Root 'bridge.py'
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
        $owned=$process.ExecutablePath -and ($process.ExecutablePath -eq $spotify -or $process.ExecutablePath -eq $overlay)
        $helper=$false
        if ($process.ExecutablePath -and $process.ExecutablePath -in @((Join-Path $Root 'runtime\python.exe'),(Join-Path $Root 'runtime\pythonw.exe')) -and $process.CommandLine) {
            $arguments=@([regex]::Matches($process.CommandLine,'"([^"]*)"|(\S+)') | ForEach-Object {
                if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
            })
            $scriptIndex=1
            while ($scriptIndex -lt $arguments.Count -and $arguments[$scriptIndex] -cin @('-u','-B','-I')) { $scriptIndex++ }
            $helper=$scriptIndex -eq $arguments.Count-1 -and [string]::Equals($arguments[$scriptIndex],$bridge,[StringComparison]::OrdinalIgnoreCase)
        }
        if ($owned -or $helper) {
            Stop-Process -Id $process.ProcessId -ErrorAction Stop
            Wait-Process -Id $process.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
        }
    }
}

function Test-PayloadManifest([string]$Directory) {
    $base=Assert-PayloadTree $Directory
    $manifest=Get-Content -LiteralPath (Join-Path $base 'package-manifest.json') -Raw | ConvertFrom-Json
    $seen=@{}
    foreach ($file in $manifest.PSObject.Properties) {
        $relative=$file.Name.Replace('/','\')
        $target=[IO.Path]::GetFullPath((Join-Path $base $relative))
        if ([IO.Path]::IsPathRooted($relative) -or -not $target.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase) -or $seen.ContainsKey($target) -or $file.Value -notmatch '^[a-f0-9]{64}$') { throw 'Invalid package manifest entry.' }
        $seen[$target]=$true
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-PayloadHash $target) -cne $file.Value) { throw ('Package integrity failed: '+$relative) }
    }
    foreach ($file in @(Get-ChildItem -LiteralPath $base -Recurse -Force -File)) {
        if ($file.FullName -ne (Join-Path $base 'package-manifest.json') -and -not $seen.ContainsKey($file.FullName)) { throw ('Unlisted package file: '+$file.Name) }
    }
    if (-not $seen.Count) { throw 'The package manifest is empty.' }
    return $manifest
}

function Copy-PayloadTree([string]$From,[string]$To) {
    [void](Assert-PayloadTree $From)
    [void](Assert-PayloadTree $To)
    [void](New-Item -ItemType Directory -Path $To -Force)
    foreach ($entry in @(Get-ChildItem -LiteralPath $From -Recurse -Force -Directory)) { [void](New-Item -ItemType Directory -Path (Join-Path $To $entry.FullName.Substring($From.Length+1)) -Force) }
    foreach ($entry in @(Get-ChildItem -LiteralPath $From -Recurse -Force -File)) { Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $To $entry.FullName.Substring($From.Length+1)) -Force }
}

function Get-PayloadTreeHashes([string]$Directory) {
    $files=@{}
    foreach ($file in @(Get-ChildItem -LiteralPath $Directory -Recurse -Force -File)) { $files[$file.FullName.Substring($Directory.Length+1)] = Get-PayloadHash $file.FullName }
    return $files
}

function Save-PayloadMetadata($Transaction) {
    $shortcuts=@()
    $number=0
    foreach ($path in @(Get-PayloadShortcuts)) {
        $name='shortcut-'+$number+'.lnk'
        $exists=Test-Path -LiteralPath $path
        if ($exists) { [void](Assert-PayloadTree $path); Copy-Item -LiteralPath $path -Destination (Join-Path $Transaction.Directory $name) }
        $shortcuts += [PSCustomObject]@{Path=$path;Name=$name;Existed=$exists}
        $number++
    }
    $Transaction.Shortcuts=$shortcuts
    $registry=@()
    foreach ($path in @(Get-PayloadRegistryPaths)) {
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
        $values=@()
        if ($key) {
            try {
                if ($key.GetSubKeyNames().Count) { throw 'Unexpected subkeys in installer registration.' }
                foreach ($name in $key.GetValueNames()) { $values += [PSCustomObject]@{Name=$name;Kind=$key.GetValueKind($name).ToString();Value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)} }
            } finally { $key.Dispose() }
        }
        $registry += [PSCustomObject]@{Path=$path;Existed=($null -ne $key);Values=$values}
    }
    $Transaction.Registry=$registry
}

function Restore-PayloadMetadata($Transaction) {
    foreach ($shortcut in @($Transaction.Shortcuts)) {
        if ($shortcut.Existed) { [void](New-Item -ItemType Directory -Path (Split-Path -Parent $shortcut.Path) -Force); Copy-Item -LiteralPath (Join-Path $Transaction.Directory $shortcut.Name) -Destination $shortcut.Path -Force }
        elseif (Test-Path -LiteralPath $shortcut.Path) { Remove-Item -LiteralPath $shortcut.Path -Force }
    }
    foreach ($entry in @($Transaction.Registry)) {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($entry.Path,$false)
        if ($entry.Existed) {
            $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($entry.Path)
            try {
                foreach ($item in @($entry.Values)) {
                    $kind=[Microsoft.Win32.RegistryValueKind]$item.Kind
                    $value=$item.Value
                    if ($kind -eq 'DWord') { $value=[int]$value }
                    elseif ($kind -eq 'QWord') { $value=[long]$value }
                    elseif ($kind -eq 'Binary') { $value=[byte[]]$value }
                    elseif ($kind -eq 'MultiString') { $value=[string[]]$value }
                    $key.SetValue($item.Name,$value,$kind)
                }
            } finally { $key.Dispose() }
        }
    }
}

function Assert-PayloadSnapshot($Transaction,[string]$Directory) {
    if ($Transaction.PSObject.Properties.Name -notcontains 'SnapshotFiles') { throw 'The recovery record has no verified snapshot hashes.' }
    $actual=Get-PayloadTreeHashes $Directory
    $expected=@{}
    foreach ($file in $Transaction.SnapshotFiles.PSObject.Properties) {
        $null=Resolve-PayloadChild $Directory $file.Name
        if ($file.Value -isnot [string] -or $file.Value -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid recovery snapshot hash.' }
        $expected[$file.Name]=$file.Value
    }
    if ($actual.Count -ne $expected.Count) { throw 'The recovery snapshot file count differs.' }
    foreach ($name in $expected.Keys) {
        if (-not $actual.ContainsKey($name) -or $actual[$name] -cne $expected[$name]) { throw ('The recovery snapshot hash differs: '+$name) }
    }
}

function Resolve-PayloadChild([string]$Directory,[string]$Relative) {
    $base=[IO.Path]::GetFullPath($Directory).TrimEnd('\')
    if (-not $Relative -or [IO.Path]::IsPathRooted($Relative) -or $Relative.Contains(':')) { throw 'Invalid recovery file path.' }
    $path=[IO.Path]::GetFullPath((Join-Path $base $Relative))
    if (-not $path.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery file escapes its installation.' }
    return $path
}

function Restore-PayloadInPlace($Transaction,[string]$Backup,[string]$Failed,[switch]$CaptureDelta) {
    # Old updater parents can keep the application directory as their current
    # directory. Their handle prevents a directory rename but not file recovery.
    Assert-PayloadSnapshot $Transaction $Backup
    [void](Assert-PayloadTree $Transaction.Root)
    $expected=@{}
    foreach ($file in $Transaction.SnapshotFiles.PSObject.Properties) {
        $null=Resolve-PayloadChild $Transaction.Root $file.Name
        $expected[$file.Name]=$file.Value
    }
    if ($CaptureDelta) {
        # The caller persisted InPlaceRestore and CaptureAttempted together.
        # This non-persistent switch exists only on the first recovery call.
        # A replay never captures a partly restored directory as initial evidence.
        $captureErrors=0
        try { $captureFiles=@(Get-ChildItem -LiteralPath $Transaction.Root -Recurse -Force -File) }
        catch { $captureFiles=@(); $captureErrors++ }
        foreach ($file in $captureFiles) {
            $relative=$file.FullName.Substring($Transaction.Root.Length+1)
            try {
                if ($expected.ContainsKey($relative) -and (Get-PayloadHash $file.FullName) -ceq $expected[$relative]) { continue }
                $destination=Resolve-PayloadChild $Failed $relative
                [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
                Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
            } catch { $captureErrors++ }
        }
        if ($captureErrors) { Write-Warning ('Could not retain '+$captureErrors+' changed diagnostic files; restoring the verified snapshot.') }
    }
    # Remove new files first. This also clears a new file that occupies a path
    # which used to be a directory. Core recovery errors must remain fatal.
    foreach ($file in @(Get-ChildItem -LiteralPath $Transaction.Root -Recurse -Force -File)) {
        $relative=$file.FullName.Substring($Transaction.Root.Length+1)
        if (-not $expected.ContainsKey($relative)) {
            $path=Resolve-PayloadChild $Transaction.Root $relative
            Remove-Item -LiteralPath $path -Force
        }
    }
    foreach ($relative in $expected.Keys) {
        $path=Resolve-PayloadChild $Transaction.Root $relative
        if (Test-Path -LiteralPath $path -PathType Container) {
            [void](Assert-PayloadTree $path)
            Remove-Item -LiteralPath $path -Recurse -Force
        }
    }
    Copy-PayloadTree $Backup $Transaction.Root
    Assert-PayloadSnapshot $Transaction $Transaction.Root
    # Empty directories are not part of the file-hash contract. Preserve every
    # baseline directory and remove only new empty directories when possible.
    $directories=@{}
    foreach ($directory in @(Get-ChildItem -LiteralPath $Backup -Recurse -Force -Directory)) { $directories[$directory.FullName.Substring($Backup.Length+1)]=$true }
    foreach ($directory in @(Get-ChildItem -LiteralPath $Transaction.Root -Recurse -Force -Directory | Sort-Object { $_.FullName.Length } -Descending)) {
        $relative=$directory.FullName.Substring($Transaction.Root.Length+1)
        if (-not $directories.ContainsKey($relative)) {
            try { if (-not @(Get-ChildItem -LiteralPath $directory.FullName -Force).Count) { Remove-Item -LiteralPath $directory.FullName -Force } }
            catch { Write-Warning ('An empty update directory could not be removed: '+$relative) }
        }
    }
}

function Undo-PayloadTransaction($Transaction) {
    $current=Read-PayloadTransaction $Transaction.Root
    if (-not $current) { throw 'The recovery record is missing.' }
    $Transaction=$current
    if ($Transaction.Status -in @('committed','restored')) { return }
    if ($Transaction.Status -eq 'snapshotting') {
        $Transaction.Status='restored'; Save-PayloadJournal $Transaction
        return
    }
    Stop-PayloadProcesses $Transaction.Root
    $backup=Join-Path $Transaction.Directory 'previous'
    $failed=Join-Path $Transaction.Directory 'failed'
    if ($Transaction.Status -ne 'restoring') { $Transaction.Status='restoring'; Save-PayloadJournal $Transaction }
    if ($Transaction.InPlaceRestore -and (-not $Transaction.RootExisted -or -not (Test-Path -LiteralPath $backup -PathType Container))) { throw 'The in-place recovery snapshot is missing.' }
    # Prefer a same-volume rename. Older updater parents may hold the root as
    # their current directory, so a verified in-place recovery is also resumable.
    if (Test-Path -LiteralPath $backup) {
        if ($Transaction.RootExisted) { Assert-PayloadSnapshot $Transaction $backup }
        if ($Transaction.InPlaceRestore) {
            if (-not $Transaction.RootExisted) { throw 'In-place recovery requires an existing installation snapshot.' }
            Restore-PayloadInPlace $Transaction $backup $failed
        } elseif (Test-Path -LiteralPath $Transaction.Root) {
            if (Test-Path -LiteralPath $failed) { throw 'Both failed and active update trees exist; refusing to discard files.' }
            try { Move-Item -LiteralPath $Transaction.Root -Destination $failed -ErrorAction Stop }
            catch {
                if (-not $Transaction.RootExisted -or -not (Test-Path -LiteralPath $Transaction.Root -PathType Container)) { throw }
                Assert-PayloadSnapshot $Transaction $backup
                $Transaction | Add-Member -MemberType NoteProperty -Name InPlaceRestore -Value $true -Force
                $Transaction | Add-Member -MemberType NoteProperty -Name CaptureAttempted -Value $true -Force
                Save-PayloadJournal $Transaction
                Restore-PayloadInPlace $Transaction $backup $failed -CaptureDelta
            }
        }
        if ($Transaction.RootExisted -and -not $Transaction.InPlaceRestore) { Move-Item -LiteralPath $backup -Destination $Transaction.Root }
    } elseif ($Transaction.RootExisted) {
        if (-not (Test-Path -LiteralPath $Transaction.Root) -or -not (Test-Path -LiteralPath $failed)) { throw 'The installation backup is missing; restoration cannot be confirmed.' }
        # A previous recovery may have completed the rename before metadata was
        # restored. Verify the complete old file set before reporting success.
        Assert-PayloadSnapshot $Transaction $Transaction.Root
    }
    elseif (-not $Transaction.RootExisted -and (Test-Path -LiteralPath $Transaction.Root)) {
        if (Test-Path -LiteralPath $failed) { throw 'The failed update directory is occupied.' }
        Move-Item -LiteralPath $Transaction.Root -Destination $failed
    }
    Restore-PayloadMetadata $Transaction
    $Transaction.Status='restored'; Save-PayloadJournal $Transaction
}

function Assert-PayloadOwner($Transaction,[int]$OwnerId) {
    if (-not $Transaction -or $Transaction.Status -in @('committed','restored')) { return }
    $owner=Get-Process -Id $Transaction.OwnerProcessId -ErrorAction SilentlyContinue
    if ($Transaction.OwnerProcessId -ne $OwnerId -and $owner -and $owner.StartTime.ToUniversalTime().Ticks.ToString() -eq $Transaction.OwnerStartedTicks) { throw 'Another installer is still using this installation.' }
}

function Repair-PayloadTransaction([string]$Root,[int]$OwnerId=$PID) {
    $transaction=Read-PayloadTransaction $Root
    if (-not $transaction) { return }
    Assert-PayloadOwner $transaction $OwnerId
    if ($transaction.Status -notin @('committed','restored')) { Undo-PayloadTransaction $transaction }
    # Keep one completed/recovered generation for diagnosis; the next attempt replaces only this owned record.
}

function Start-PayloadTransaction([string]$Root,[string]$Payload,[int]$OwnerId=$PID,[switch]$NoMetadata) {
    $rootFull=Assert-PayloadTree $Root
    $directory=Get-PayloadTransactionPath $rootFull
    $payloadFull=[IO.Path]::GetFullPath($Payload).TrimEnd('\')
    if ($payloadFull -eq $rootFull -or $payloadFull.StartsWith($rootFull+'\',[StringComparison]::OrdinalIgnoreCase) -or $rootFull.StartsWith($payloadFull+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Stage the package outside the application folder.' }
    $null=Test-PayloadManifest $Payload
    Repair-PayloadTransaction $rootFull $OwnerId
    if (Test-Path -LiteralPath $directory) {
        $old=Read-PayloadTransaction $rootFull
        if ($old.Status -notin @('committed','restored')) { throw 'The previous update has not recovered.' }
        [void](Assert-PayloadTree $directory)
        Remove-Item -LiteralPath $directory -Recurse -Force
    }
    $existed=Test-Path -LiteralPath $rootFull
    if ($existed -and @(Get-ChildItem -LiteralPath $rootFull -Force).Count) {
        $marker=Join-Path $rootFull 'install-marker.json'
        if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).app -ne 'SpotifyHangul') { throw 'The selected folder is not a SpotifyHangul installation.' }
    }
    [void](New-Item -ItemType Directory -Path $directory -Force)
    $owner=Get-Process -Id $OwnerId -ErrorAction Stop
    $transaction=[PSCustomObject]@{Schema=1;App='SpotifyHangul';Root=$rootFull;Directory=$directory;RootExisted=$existed;OwnerProcessId=$OwnerId;OwnerStartedTicks=$owner.StartTime.ToUniversalTime().Ticks.ToString();Status='snapshotting';Shortcuts=@();Registry=@();SnapshotFiles=[PSCustomObject]@{};InPlaceRestore=$false;CaptureAttempted=$false;StartedUtc=[DateTime]::UtcNow.ToString('o')}
    Save-PayloadJournal $transaction
    if (-not $NoMetadata) { Save-PayloadMetadata $transaction; Save-PayloadJournal $transaction }
    Stop-PayloadProcesses $rootFull
    $backup=Join-Path $directory 'previous'
    [void](New-Item -ItemType Directory -Path $backup)
    if ($existed) {
        $before=Get-PayloadTreeHashes $rootFull
        Copy-PayloadTree $rootFull $backup
        $after=Get-PayloadTreeHashes $backup
        if ($before.Count -ne $after.Count) { throw 'The installation snapshot is incomplete.' }
        foreach ($name in $before.Keys) { if ($before[$name] -ne $after[$name]) { throw ('Snapshot integrity failed: '+$name) } }
        $transaction.SnapshotFiles=[PSCustomObject]$before
    }
    $transaction.Status='prepared'; Save-PayloadJournal $transaction
    return $transaction
}

function Invoke-PayloadTransaction($Transaction,[string]$Payload,[scriptblock]$Integration) {
    $manifest=Test-PayloadManifest $Payload
    try {
        $Transaction.Status='applying'; Save-PayloadJournal $Transaction
        [void](New-Item -ItemType Directory -Path $Transaction.Root -Force)
        # Remove only obsolete files listed by the prior installer. User-created data is preserved.
        $oldManifest=Join-Path $Transaction.Root 'package-manifest.json'
        if (Test-Path -LiteralPath $oldManifest) {
            $old=Get-Content -LiteralPath $oldManifest -Raw | ConvertFrom-Json
            $base=$Transaction.Root
            foreach ($entry in $old.PSObject.Properties) {
                if ($manifest.PSObject.Properties.Name -contains $entry.Name) { continue }
                $relative=$entry.Name.Replace('/','\')
                $target=[IO.Path]::GetFullPath((Join-Path $base $relative))
                if ([IO.Path]::IsPathRooted($relative) -or -not $target.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'The old package manifest escapes the installation.' }
                if ((Test-Path -LiteralPath $target -PathType Leaf) -and (Get-PayloadHash $target) -ceq $entry.Value) {
                    Remove-Item -LiteralPath $target -Force
                    # Drop folders this leaves empty (0.7.2 removed desktop-overlay), never the root.
                    $parent=Split-Path -Parent $target
                    while ($parent.Length -gt $base.Length -and -not @(Get-ChildItem -LiteralPath $parent -Force).Count) {
                        Remove-Item -LiteralPath $parent -Force
                        $parent=Split-Path -Parent $parent
                    }
                }
            }
        }
        Copy-PayloadTree $Payload $Transaction.Root
        if ($Integration) { & $Integration $Transaction.Root }
        else {
            $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
            & $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Transaction.Root 'installer\bootstrap.ps1') -Mode Prepare -InstallRoot $Transaction.Root
            if ($LASTEXITCODE -ne 0) { throw 'Installation preparation failed.' }
            & $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Transaction.Root 'installer\bootstrap.ps1') -Mode Install -InstallRoot $Transaction.Root
            if ($LASTEXITCODE -ne 0) { throw 'Spotify integration failed. See the update recovery directory and install.log.' }
        }
        $Transaction.Status='pending-commit'; Save-PayloadJournal $Transaction
    } catch {
        $failure=$_
        try { [IO.File]::WriteAllText((Join-Path $Transaction.Directory 'failure.txt'),$failure.ToString(),[Text.UTF8Encoding]::new($true)) }
        catch { Write-Warning ('Failed to save installation diagnostics: '+$_.Exception.Message) }
        Undo-PayloadTransaction $Transaction
        throw $failure
    }
}

function Complete-PayloadTransaction($Transaction) {
    $current=Read-PayloadTransaction $Transaction.Root
    if (-not $current -or $current.Status -ne 'pending-commit') { throw 'An integrated installation is required before commit.' }
    $current.Status='committed'; Save-PayloadJournal $current
    # Retain the verified previous generation until the next successful update attempt.
}

function Remove-PayloadTransaction([string]$Root,[int]$OwnerId=$PID) {
    $transaction=Read-PayloadTransaction $Root
    if (-not $transaction) { return }
    Assert-PayloadOwner $transaction $OwnerId
    if ($transaction.Status -notin @('committed','restored')) { throw 'Recover the interrupted update before removing its snapshot.' }
    [void](Assert-PayloadTree $transaction.Directory)
    Remove-Item -LiteralPath $transaction.Directory -Recurse -Force
}

if ($Mode) {
    $ErrorActionPreference='Stop'
    $mutex=$null
    $locked=$false
    $metadataMutex=$null
    $metadataLocked=$false
    try {
        if (-not $InstallRoot) { throw 'InstallRoot is required.' }
        $directory=Get-PayloadTransactionPath $InstallRoot
        $mutex=[Threading.Mutex]::new($false,('Local\SpotifyHangulUpdate-'+(Split-Path -Leaf $directory)))
        try { $locked=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked=$true }
        if (-not $locked) { throw 'Another installer is updating this folder.' }
        $metadataMutex=[Threading.Mutex]::new($false,'Local\SpotifyHangulMetadata')
        try { $metadataLocked=$metadataMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $metadataLocked=$true }
        if (-not $metadataLocked) { throw 'Another installer is changing application registration.' }
        if ($Mode -eq 'Apply') {
            $transaction=Start-PayloadTransaction $InstallRoot $PayloadRoot $OwnerProcessId
            Invoke-PayloadTransaction $transaction $PayloadRoot
        } elseif ($Mode -eq 'Commit') { $transaction=Read-PayloadTransaction $InstallRoot; Assert-PayloadOwner $transaction $OwnerProcessId; Complete-PayloadTransaction $transaction }
        elseif ($Mode -eq 'Recover') { Repair-PayloadTransaction $InstallRoot $OwnerProcessId }
        elseif ($Mode -eq 'Cleanup') { Remove-PayloadTransaction $InstallRoot $OwnerProcessId }
        else { $transaction=Read-PayloadTransaction $InstallRoot; if ($transaction) { Assert-PayloadOwner $transaction $OwnerProcessId; Undo-PayloadTransaction $transaction } }
    } catch { Write-Error $_ -ErrorAction Continue; exit 1 }
    finally {
        if ($metadataLocked) { $metadataMutex.ReleaseMutex() }; if ($metadataMutex) { $metadataMutex.Dispose() }
        if ($locked) { $mutex.ReleaseMutex() }; if ($mutex) { $mutex.Dispose() }
    }
}
