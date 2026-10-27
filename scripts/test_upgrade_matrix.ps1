# @file test_upgrade_matrix.ps1
# @author: ForUltraplayer
# @brief Exercise shipped 0.6.x installers and updaters against one actual candidate, restoring host registration and shortcuts.
param([Parameter(Mandatory=$true)][string]$CandidateInstaller,
      [string[]]$BaselineVersions=@('0.6.0','0.6.1','0.6.3'),
      [string]$OutputDirectory)
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$project=Split-Path -Parent $PSScriptRoot
$candidate=(Get-Item -LiteralPath $CandidateInstaller).FullName
$candidateVersion=(Get-Item -LiteralPath $candidate).VersionInfo.FileVersion
if ($candidateVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Candidate executable has no valid product version.' }
if (-not $OutputDirectory) { $OutputDirectory=Join-Path $project ('work\upgrade-matrix-'+(Get-Date -Format 'yyyyMMdd-HHmmss')) }
$area=[IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
$work=[IO.Path]::GetFullPath((Join-Path $project 'work')).TrimEnd('\')
if (-not $area.StartsWith($work+'\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $area)) { throw 'Choose a new dedicated directory below project work.' }
[void](New-Item -ItemType Directory -Path $area)
$nativePowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$keys=@('HKCU:\Software\SpotifyHangul','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul')
$desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Spotify 한글 가사.lnk'
$menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'Spotify 한글 가사'
$menuExisted=Test-Path -LiteralPath $menu
$links=@($desktop)+@('Spotify 한글 가사.lnk','제거.lnk' | ForEach-Object { Join-Path $menu $_ })
$shellBefore=@{}
$registrationBefore=@{}
$environment=@{}
$rows=New-Object Collections.Generic.List[object]
$result=[ordered]@{candidate=$candidate;candidateVersion=$candidateVersion;candidateSha256=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant();candidateBytes=(Get-Item -LiteralPath $candidate).Length;kind='actual-shipped-executables';isolatedUserProfile=$false;networkTransport='real baseline Spotify download; candidate release metadata/download supplied from exact local bytes';liveSpotifyProcessesExcludedFromUpdater=$true;rows=$rows;result='running';hostRestored=$false}
foreach ($name in @('APPDATA','LOCALAPPDATA','SPICETIFY_CONFIG','SPICETIFY_STATE','PATH')) { $environment[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
foreach ($path in $links) { $shellBefore[$path]=if(Test-Path -LiteralPath $path){[IO.File]::ReadAllBytes($path)}else{$null} }
foreach ($key in $keys) {
    $file=Join-Path $area ('registry-before-'+$registrationBefore.Count+'.reg')
    $exists=Test-Path -LiteralPath $key
    if ($exists) { & reg.exe export $key.Replace('HKCU:\','HKCU\') $file /y | Out-Null; if($LASTEXITCODE -ne 0){throw 'Could not save host registry.'} }
    $registrationBefore[$key]=@{exists=$exists;file=$file}
}
function Save-Proof { $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $area 'result.json') -Encoding UTF8 }
function Invoke-Installer([string]$File,[string]$Target,[string]$Log,[switch]$ExpectFailure) {
    $process=Start-Process -FilePath $File -ArgumentList ('/S /D='+$Target) -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(900000)) { throw ('Actual installer timed out; inspect process '+$process.Id) }
    if (Test-Path -LiteralPath (Join-Path $Target 'install.log')) { Copy-Item -LiteralPath (Join-Path $Target 'install.log') -Destination $Log -Force }
    if ($ExpectFailure) { if ($process.ExitCode -eq 0) { throw 'The genuine installer unexpectedly accepted the controlled broken client identity.' } }
    elseif ($process.ExitCode -ne 0) { throw ('Actual installer failed with exit '+$process.ExitCode+'; '+$Log) }
    return $process.ExitCode
}
function Invoke-UpdaterProcess([string]$Executable,[string]$Arguments,[string]$Directory,[string]$Stdout,[string]$Stderr) {
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$Executable
    $info.Arguments=$Arguments
    $info.WorkingDirectory=$Directory
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true
    $info.RedirectStandardError=$true
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $process=[Diagnostics.Process]::new()
    $process.StartInfo=$info
    try {
        [void]$process.Start()
        $handle=$process.Handle
        $output=$process.StandardOutput.ReadToEndAsync()
        $errorOutput=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(900000)){throw 'The actual updater process timed out.'}
        $process.WaitForExit()
        $exitCode=$process.ExitCode
        if($null -eq $exitCode){throw 'The actual updater process exit code was unavailable.'}
        [IO.File]::WriteAllText($Stdout,$output.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true))
        [IO.File]::WriteAllText($Stderr,$errorOutput.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true))
        return $exitCode
    } finally {$process.Dispose()}
}
function Assert-Version([string]$Target,[string]$Version) {
    $state=Get-Content -LiteralPath (Join-Path $Target 'install-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $payload=Get-Content -LiteralPath (Join-Path $Target 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $registered=(Get-ItemProperty -LiteralPath $keys[0]).InstallDir
    $registeredVersion=(Get-ItemProperty -LiteralPath $keys[1]).DisplayVersion
    if (-not $state.ManagedClient -or $state.Version -ne $Version -or $payload.version -ne $Version -or $registered -ne $Target -or $registeredVersion -ne $Version) { throw 'Installed code/state/registration versions do not agree.' }
}
function Snapshot-Data([string[]]$Paths) {
    $hashes=@{}
    foreach ($path in $Paths) { $hashes[$path]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    return $hashes
}
function Assert-SameTree([string]$Target,$Before) {
    $after=Get-PayloadTreeHashes $Target
    if ($Before.Count -ne $after.Count) { throw 'Rollback changed the installed file count.' }
    foreach ($name in $Before.Keys) { if ($Before[$name] -cne $after[$name]) { throw ('Rollback hash mismatch: '+$name) } }
}
function Export-Registration([string]$Directory,[string]$Prefix) {
    $output=@{}
    foreach ($key in $keys) {
        $path=Join-Path $Directory ($Prefix+'-'+$output.Count+'.reg')
        & reg.exe export $key.Replace('HKCU:\','HKCU\') $path /y | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not record controlled-test registry state.' }
        $output[$key]=(Get-FileHash -LiteralPath $path).Hash
    }
    return $output
}
function Assert-InstalledRuntime([string]$Target,[string]$RowArea,$Row) {
    $shell=New-Object -ComObject WScript.Shell
    $shortcutRecords=@(foreach ($path in $links) {
        if (-not (Test-Path -LiteralPath $path)) { throw ('Installed shortcut is missing: '+$path) }
        $link=$shell.CreateShortcut($path)
        if (-not $link.WorkingDirectory -or [IO.Path]::GetFullPath($link.WorkingDirectory).TrimEnd('\') -ine [IO.Path]::GetFullPath($Target).TrimEnd('\')) { throw ('Installed shortcut has a temporary or incorrect working directory: '+$path+'; '+$link.WorkingDirectory) }
        [PSCustomObject]@{name=(Split-Path -Leaf $path);path=$path;workingDirectory=$link.WorkingDirectory;executable=$link.TargetPath}
    })
    $Row.shortcutWorkingDirectories=$shortcutRecords
    $Row.installManifest=Test-Path -LiteralPath (Join-Path $Target 'package-manifest.json')
    $required=@('runtime\python.exe','tools\node.exe','vendor\yt_dlp\__init__.py','vendor\yt_dlp_ejs\__init__.py','youtube-now-playing.js','youtube-now-playing.css','installer\payload-transaction.ps1','installer\desktop-overlay.ps1','Spotify\Apps\xpui\extensions\hangul-lyrics.js','Spotify\Apps\xpui\spicetify-routes-ivLyrics.js')
    foreach ($relative in $required) { if (-not (Test-Path -LiteralPath (Join-Path $Target $relative))) { throw ('Missing installed runtime asset '+$relative) } }
    $Row.requiredRuntimeAssets=$required.Count
    # 0.7.2 stopped bundling the overlay; an upgrade must remove the 0.7.0 copy.
    if (Test-Path -LiteralPath (Join-Path $Target 'desktop-overlay\lyrics-plus-overlay.exe')) { throw 'Bundled overlay from 0.7.0 was left behind.' }
    $smokeCode="import sys,json,pykakasi,phonetics,yt_dlp,yt_dlp_ejs; assert sys.flags.isolated; assert all('anaconda' not in p.lower() for p in sys.path); assert phonetics.japanese_to_hangul(chr(0x9752)+chr(0x3044)+chr(0x7a7a),pykakasi.kakasi()); print(json.dumps({'python':sys.version.split()[0],'isolated':True,'youtubeModules':True}))"
    & (Join-Path $Target 'runtime\python.exe') -I -B -c $smokeCode *> (Join-Path $RowArea 'installed-python-smoke.json')
    if ($LASTEXITCODE -ne 0) { throw 'Installed embedded Python or isolated YouTube dependencies failed.' }
    & (Join-Path $Target 'tools\node.exe') --version *> (Join-Path $RowArea 'installed-node-version.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Installed bundled JavaScript runtime failed.' }
    $Row.isolatedRuntimeSmoke=$true
}
function Start-CallerCwdHolder([string]$Target,[string]$RowArea) {
    $script=Join-Path $RowArea 'caller-cwd-holder.ps1'
    $ready=Join-Path $RowArea 'caller-cwd-holder-ready.json'
    $release=Join-Path $RowArea 'caller-cwd-holder-release.signal'
    @'
# @file caller-cwd-holder.ps1
# @author: ForUltraplayer
# @brief Hold only the isolated test application's current directory until released, with a bounded lifetime.
param([string]$ReadyFile,[string]$ReleaseFile)
$ErrorActionPreference='Stop'
$watch=[Diagnostics.Stopwatch]::StartNew()
[IO.File]::WriteAllText(($ReadyFile+'.tmp'),([PSCustomObject]@{pid=$PID;script=$PSCommandPath;workingDirectory=[Environment]::CurrentDirectory;startedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json),[Text.UTF8Encoding]::new($true))
[IO.File]::Move(($ReadyFile+'.tmp'),$ReadyFile)
while (-not (Test-Path -LiteralPath $ReleaseFile) -and $watch.Elapsed.TotalMinutes -lt 20) { Start-Sleep -Milliseconds 200 }
'@ | Set-Content -LiteralPath $script -Encoding UTF8
    $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$script+'" -ReadyFile "'+$ready+'" -ReleaseFile "'+$release+'"'
    $process=Start-Process -FilePath $nativePowerShell -ArgumentList $arguments -WorkingDirectory $Target -WindowStyle Hidden -PassThru
    $holder=[PSCustomObject]@{Process=$process;Script=$script;Ready=$ready;Release=$release;StartedTicks=$process.StartTime.ToUniversalTime().Ticks.ToString()}
    try {
        for ($attempt=0;$attempt -lt 100 -and -not (Test-Path -LiteralPath $ready);$attempt++) { Start-Sleep -Milliseconds 100 }
        if (-not (Test-Path -LiteralPath $ready)) { throw 'The caller-CWD test holder did not become ready.' }
        $record=Get-Content -LiteralPath $ready -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($record.pid -ne $process.Id -or $record.script -ne $script -or [IO.Path]::GetFullPath($record.workingDirectory).TrimEnd('\') -ine [IO.Path]::GetFullPath($Target).TrimEnd('\')) { throw 'The caller-CWD holder did not acquire the expected actual process directory.' }
        return $holder
    } catch { Stop-CallerCwdHolder $holder; throw }
}
function Stop-CallerCwdHolder($Holder) {
    if (-not $Holder) { return }
    $process=$Holder.Process
    if ($process.HasExited) { return }
    $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$process.Id) -ErrorAction Stop
    $arguments=@([regex]::Matches([string]$live.CommandLine,'"([^"]*)"|(\S+)') | ForEach-Object { if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value } })
    if (-not $live -or $live.ExecutablePath -ine $nativePowerShell -or $arguments -cnotcontains $Holder.Script -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $Holder.StartedTicks) { throw 'The caller-CWD holder identity changed; no unrelated process was stopped.' }
    [IO.File]::WriteAllText($Holder.Release,'release')
    if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -ErrorAction Stop; [void]$process.WaitForExit(3000) }
    if (-not $process.HasExited) { throw 'The isolated caller-CWD holder did not stop.' }
}
. (Join-Path $project 'installer\payload-transaction.ps1')
try {
    Save-Proof
    foreach ($version in $BaselineVersions) {
        if ($version -notin @('0.6.0','0.6.1','0.6.3')) { throw 'Unexpected baseline version.' }
        $rowArea=Join-Path $area $version
        [void](New-Item -ItemType Directory -Path $rowArea)
        $target=Join-Path $rowArea '한글 공백 설치'
        $baseline=Join-Path $project ('dist\SpotifyHangul-'+$version+'-Setup.exe')
        if ((Get-Item -LiteralPath $baseline).VersionInfo.FileVersion -ne $version) { throw 'Shipped baseline executable version mismatch.' }
        $row=[ordered]@{baseline=$version;target=$target;baselineSha256=(Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant();status='running'}
        $rows.Add($row)
        $env:APPDATA=Join-Path $rowArea 'roaming'
        $env:LOCALAPPDATA=Join-Path $rowArea 'local'
        $env:SPICETIFY_CONFIG=Join-Path $rowArea 'empty-config'
        $env:SPICETIFY_STATE=Join-Path $rowArea 'shared-preprocess'
        $env:PATH=Join-Path $env:SystemRoot 'System32'
        [void](New-Item -ItemType Directory -Path $env:APPDATA,$env:LOCALAPPDATA -Force)
        $row.installExit=Invoke-Installer $baseline $target (Join-Path $rowArea 'baseline-install.log')
        Assert-Version $target $version
        $sentinels=@((Join-Path $env:APPDATA 'Spotify\Users\test-user\prefs'),(Join-Path $env:APPDATA 'Spotify\Browser\Local Storage\leveldb\000001.ldb'),(Join-Path $env:APPDATA 'Spotify\Browser\IndexedDB\ivLyrics-db.fixture'),(Join-Path $env:LOCALAPPDATA 'ivLyricsHangul\aliases.json'),(Join-Path $env:LOCALAPPDATA 'ivLyricsHangul\cache.json'),(Join-Path $target 'spicetify-config\Extensions\user-custom.js'),(Join-Path $target 'private-user-file.json'))
        foreach ($path in $sentinels) {
            [void](New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force)
            [IO.File]::WriteAllText($path,('Synthetic data preservation fixture '+$version+' '+[Guid]::NewGuid().ToString('N')),[Text.UTF8Encoding]::new($false))
        }
        $before=Snapshot-Data $sentinels
        # Cause real bootstrap integration to fail without modifying the final Setup.exe.
        # The temporarily invalid ownership receipt belongs only to this isolated test installation.
        $clientIdentity=Join-Path $target 'Spotify\spotx-hangul.json'
        $identityBytes=[IO.File]::ReadAllBytes($clientIdentity)
        $cwdHolder=$null
        try {
            [IO.File]::WriteAllText($clientIdentity,'{}',[Text.UTF8Encoding]::new($false))
            $faultTree=Get-PayloadTreeHashes $target
            $faultRegistry=Export-Registration $rowArea 'fault-registry-before'
            $faultShortcuts=Snapshot-Data $links
            $cwdHolder=Start-CallerCwdHolder $target $rowArea
            $row.callerCwdHolderPid=$cwdHolder.Process.Id
            $row.actualExeFailureWithCallerCwd=$true
            $row.actualExeFailureExit=Invoke-Installer $candidate $target (Join-Path $rowArea 'failed-installer-restored-log.txt') -ExpectFailure
            if ($cwdHolder.Process.HasExited) { throw 'The caller-CWD holder exited before the genuine installer finished its failure recovery.' }
            Assert-SameTree $target $faultTree
            Assert-Version $target $version
            $afterRegistry=Export-Registration $rowArea 'fault-registry-after'
            foreach ($key in $faultRegistry.Keys) { if ($faultRegistry[$key] -cne $afterRegistry[$key]) { throw 'Actual failed installer changed the prior registration.' } }
            foreach ($path in $faultShortcuts.Keys) { if ((Get-FileHash -LiteralPath $path).Hash -cne $faultShortcuts[$path]) { throw 'Actual failed installer changed the prior shortcut bytes.' } }
            $row.actualExeRollbackFiles=$faultTree.Count
            $row.actualExeMetadataRestored=$true
            $failureTransaction=Read-PayloadTransaction $target
            if ($failureTransaction.Status -ne 'restored' -or $failureTransaction.InPlaceRestore -ne $true) { throw 'The genuine installer did not exercise and finish its caller-CWD in-place recovery.' }
            $row.actualExeInPlaceRestore=$true
            $failedInstallLog=Join-Path (Get-PayloadTransactionPath $target) 'failed\install.log'
            if (Test-Path -LiteralPath $failedInstallLog) { Copy-Item -LiteralPath $failedInstallLog -Destination (Join-Path $rowArea 'actual-exe-failure-install.log') }
        } finally {
            Stop-CallerCwdHolder $cwdHolder
            $row.callerCwdHolderStopped=$true
            [IO.File]::WriteAllBytes($clientIdentity,$identityBytes)
        }
        # Use real installed old-version bytes with a controlled integration failure.
        # This checks transaction recovery separately from the genuine candidate EXE below.
        $faultPayload=Join-Path $rowArea 'controlled-fault-payload'
        [void](New-Item -ItemType Directory -Path $faultPayload)
        [IO.File]::WriteAllText((Join-Path $faultPayload 'release.json'),'{"version":"0.7.0"}',[Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $faultPayload 'bridge.py'),'controlled replacement fixture',[Text.UTF8Encoding]::new($false))
        $faultManifest=@{}
        foreach ($file in Get-ChildItem -LiteralPath $faultPayload -File) { $faultManifest[$file.Name]=Get-PayloadHash $file.FullName }
        $faultManifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $faultPayload 'package-manifest.json') -Encoding UTF8
        $oldTree=Get-PayloadTreeHashes $target
        $transaction=Start-PayloadTransaction -Root $target -Payload $faultPayload -OwnerId $PID -NoMetadata
        $failed=$false
        try {
            Invoke-PayloadTransaction $transaction $faultPayload -Integration {
                param($installation)
                [IO.File]::WriteAllText((Join-Path $installation 'install-state.json'),'{"Version":"0.7.0","ManagedClient":true}')
                [IO.File]::WriteAllText((Join-Path $installation 'Spotify\Apps\xpui\xpui.js'),'controlled integration corruption')
                throw 'controlled old-version integration failure'
            }
        } catch { $failed=$_.Exception.Message -match 'controlled old-version integration failure' }
        if (-not $failed) { throw 'The controlled integration failure was not propagated.' }
        Assert-SameTree $target $oldTree
        Assert-Version $target $version
        $row.failureRollbackFiles=$oldTree.Count
        $transaction=Start-PayloadTransaction -Root $target -Payload $faultPayload -OwnerId $PID -NoMetadata
        Invoke-PayloadTransaction $transaction $faultPayload -Integration { param($installation) }
        # Emulate interruption after integration but before the NSIS commit.
        Repair-PayloadTransaction $target $PID
        Assert-SameTree $target $oldTree
        Assert-Version $target $version
        $row.interruptedRecoveryFiles=$oldTree.Count
        if ($version -eq '0.6.0') {
            $row.path='manual actual candidate Setup.exe'
            $row.upgradeExit=Invoke-Installer $candidate $target (Join-Path $rowArea 'upgrade-install.log')
        } else {
            $oldUpdater=Join-Path $rowArea 'shipped-auto-update.ps1'
            Copy-Item -LiteralPath (Join-Path $target 'auto-update.ps1') -Destination $oldUpdater
            $row.updaterSha256=(Get-FileHash -LiteralPath $oldUpdater -Algorithm SHA256).Hash.ToLowerInvariant()
            $releaseFile=Join-Path $rowArea 'controlled-release.json'
            @{tag_name=('v'+$candidateVersion);draft=$false;prerelease=$false;assets=@(@{name=('SpotifyHangul-'+$candidateVersion+'-Setup.exe');browser_download_url=('https://github.com/ForUltraplayer/SPOTIFY_PC/releases/download/v'+$candidateVersion+'/SpotifyHangul-'+$candidateVersion+'-Setup.exe');digest=('sha256:'+$result.candidateSha256);size=$result.candidateBytes})} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $releaseFile -Encoding UTF8
            $driver=Join-Path $rowArea 'updater-transport-driver.ps1'
            @'
# @file updater-transport-driver.ps1
# @author: ForUltraplayer
# @brief Supply a future release while executing the exact shipped updater and genuine candidate Setup.exe.
param($Updater,$Root,$ReleaseFile,$Candidate,$Action)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Invoke-RestMethod { param($Uri,$Headers,$TimeoutSec) return @(Get-Content -LiteralPath $ReleaseFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) Copy-Item -LiteralPath $Candidate -Destination $OutFile }
function Get-Process { param($Name,$Id,$ErrorAction) if ($Name -eq 'Spotify') { return @(Microsoft.PowerShell.Management\Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $Root 'Spotify\Spotify.exe') }) }; if($Id){return Microsoft.PowerShell.Management\Get-Process -Id $Id -ErrorAction SilentlyContinue} }
& $Updater -Mode $Action -InstallRoot $Root -IgnoreInterval
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $driver -Encoding UTF8
            foreach ($action in @('Check','ApplyPending')) {
                $stdout=Join-Path $rowArea ('updater-'+$action+'-stdout.log')
                $stderr=Join-Path $rowArea ('updater-'+$action+'-stderr.log')
                $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$driver+'" -Updater "'+$oldUpdater+'" -Root "'+$target+'" -ReleaseFile "'+$releaseFile+'" -Candidate "'+$candidate+'" -Action '+$action
                $actualExit=Invoke-UpdaterProcess -Executable $nativePowerShell -Arguments $arguments -Directory $target -Stdout $stdout -Stderr $stderr
                Get-Content -LiteralPath $stdout,$stderr -Encoding UTF8 | Out-File -LiteralPath (Join-Path $rowArea 'updater-driver.log') -Encoding UTF8 -Append
                $row[$action+'Exit']=$actualExit
                if ($actualExit -ne 0) { throw ('Shipped updater '+$version+' failed at '+$action+'; see '+$rowArea) }
            }
            $row.originalUpdaterStartedFromInstallDirectory=$true
            $row.path='exact shipped automatic updater with local release transport and actual candidate Setup.exe'
            Copy-Item -LiteralPath (Join-Path $target 'install.log') -Destination (Join-Path $rowArea 'upgrade-install.log')
        }
        Assert-Version $target $candidateVersion
        foreach ($path in $sentinels) { if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $before[$path]) { throw ('User-data fixture changed: '+$path) } }
        $row.userDataFixturesPreserved=$sentinels.Count
        Assert-InstalledRuntime $target $rowArea $row
        $row.status='passed'
        Save-Proof
    }
    $rowArea=Join-Path $area 'fresh-install'
    [void](New-Item -ItemType Directory -Path $rowArea)
    $target=Join-Path $rowArea '새 설치 공백 폴더'
    $env:APPDATA=Join-Path $rowArea 'roaming'
    $env:LOCALAPPDATA=Join-Path $rowArea 'local'
    $env:SPICETIFY_CONFIG=Join-Path $rowArea 'empty-config'
    $env:SPICETIFY_STATE=Join-Path $rowArea 'shared-preprocess'
    $env:PATH=Join-Path $env:SystemRoot 'System32'
    [void](New-Item -ItemType Directory -Path $env:APPDATA,$env:LOCALAPPDATA -Force)
    $row=[ordered]@{baseline='none';target=$target;path='actual candidate fresh Setup.exe followed by actual silent Uninstall.exe';status='running'}
    $rows.Add($row)
    $row.installExit=Invoke-Installer $candidate $target (Join-Path $rowArea 'fresh-install.log')
    Assert-Version $target $candidateVersion
    Assert-InstalledRuntime $target $rowArea $row
    $externalCache=Join-Path $env:LOCALAPPDATA 'ivLyricsHangul\cache.json'
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $externalCache) -Force)
    [IO.File]::WriteAllText($externalCache,'Synthetic external cache must survive uninstall',[Text.UTF8Encoding]::new($false))
    $cacheHash=(Get-FileHash -LiteralPath $externalCache).Hash
    $uninstaller=Join-Path $rowArea 'actual-Uninstall.exe'
    Copy-Item -LiteralPath (Join-Path $target 'Uninstall.exe') -Destination $uninstaller
    $snapshotDirectory=Get-PayloadTransactionPath $target
    $process=Start-Process -FilePath $uninstaller -ArgumentList ('/S _?='+$target) -WorkingDirectory $target -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(300000)) { throw 'Actual fresh uninstaller timed out.' }
    $row.uninstallExit=$process.ExitCode
    $row.uninstallStartedFromInstallDirectory=$true
    if ($process.ExitCode -ne 0 -or (Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $snapshotDirectory)) { throw 'Actual fresh uninstall left the installation or transaction snapshot behind.' }
    if ((Get-FileHash -LiteralPath $externalCache).Hash -cne $cacheHash) { throw 'Uninstall modified the external cache.' }
    $row.externalCachePreserved=$true
    $row.snapshotRemoved=$true
    $row.status='passed'
    $result.result='passed'
} catch {
    $result.result='failed'
    $result.error=$_.Exception.Message
    throw
} finally {
    foreach ($name in $environment.Keys) { [Environment]::SetEnvironmentVariable($name,$environment[$name],'Process') }
    $restoreErrors=New-Object Collections.Generic.List[string]
    foreach ($key in $keys) {
        try {
            if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
            $record=$registrationBefore[$key]
            if ($record.exists) {
                & reg.exe import $record.file | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Could not restore host installation registration.' }
                $restored=$record.file+'.restored.reg'
                & reg.exe export $key.Replace('HKCU:\','HKCU\') $restored /y | Out-Null
                if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $restored).Hash -cne (Get-FileHash -LiteralPath $record.file).Hash) { throw 'Restored host registration did not match the saved bytes.' }
            } elseif (Test-Path -LiteralPath $key) { throw 'A previously absent registration key remains.' }
        } catch { $restoreErrors.Add($_.Exception.Message) }
    }
    foreach ($path in $shellBefore.Keys) {
        try {
            if ($null -ne $shellBefore[$path]) {
                [void](New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force)
                [IO.File]::WriteAllBytes($path,$shellBefore[$path])
                if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -cne [Convert]::ToBase64String($shellBefore[$path])) { throw 'Restored shortcut differs from its saved bytes.' }
            } elseif (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        } catch { $restoreErrors.Add($_.Exception.Message) }
    }
    if (-not $menuExisted -and (Test-Path -LiteralPath $menu) -and -not @(Get-ChildItem -LiteralPath $menu -Force).Count) { Remove-Item -LiteralPath $menu }
    $result.hostRestored=($restoreErrors.Count -eq 0)
    if ($restoreErrors.Count) { $result.restoreErrors=@($restoreErrors); $result.result='failed' }
    Save-Proof
    Write-Output (Join-Path $area 'result.json')
    if ($restoreErrors.Count) { throw ($restoreErrors -join '; ') }
}
