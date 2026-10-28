# @file test_auto_update.ps1
# @author: ForUltraplayer
# @brief Verify release identity, integrity checks, offline behavior and deferred automatic application.
param([string]$VerifiedInstaller)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$updater=Join-Path $project 'auto-update.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($updater,[ref]$null,[ref]$errors)
if ($errors.Count) { throw 'Updater parsing failed.' }
foreach ($name in @('Select-UpdateAsset','Get-Sha256','Get-InstalledVersion')) {
    $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $node.Extent.Text
}
$area=Join-Path $project ('work\auto-update-tests-'+[Guid]::NewGuid().ToString('N'))
$root=Join-Path $area '기존 설치'
[void](New-Item -ItemType Directory -Path $root)
'{"app":"SpotifyHangul"}' | Set-Content -LiteralPath (Join-Path $root 'install-marker.json') -Encoding UTF8
'{"version":"0.5.1"}' | Set-Content -LiteralPath (Join-Path $root 'release.json') -Encoding UTF8
$fixture=if($VerifiedInstaller){$VerifiedInstaller}else{Join-Path $project 'dist\SpotifyHangul-0.6.0-Setup.exe'}
if (-not (Test-Path -LiteralPath $fixture)) { throw 'The verified previous installer fixture is required.' }
$fixture=(Get-Item -LiteralPath $fixture).FullName
$release=[PSCustomObject]@{tag_name='v0.6.0';draft=$false;assets=@([PSCustomObject]@{
    name='SpotifyHangul-0.6.0-Setup.exe';browser_download_url='https://github.com/ForUltraplayer/SPOTIFY_PC/releases/download/v0.6.0/SpotifyHangul-0.6.0-Setup.exe';
    digest=('sha256:'+(Get-Sha256 $fixture));size=(Get-Item -LiteralPath $fixture).Length})}
$passed=0
'{"version":"0.6.0"}' | Set-Content -LiteralPath (Join-Path $root 'release.json') -Encoding UTF8
'{"Version":"0.5.1"}' | Set-Content -LiteralPath (Join-Path $root 'install-state.json') -Encoding UTF8
if ((Get-InstalledVersion) -ne [version]'0.5.1') { throw 'Unfinished payload copy masks the installed version.' }; $passed++
'{"version":"0.5.1"}' | Set-Content -LiteralPath (Join-Path $root 'release.json') -Encoding UTF8
if ((Select-UpdateAsset @($release) ([version]'0.5.1')).version -ne '0.6.0') { throw 'Valid release was rejected.' }; $passed++
if (Select-UpdateAsset @($release) ([version]'0.6.0')) { throw 'Downgrade or same-version update accepted.' }; $passed++
$wrong=$release | ConvertTo-Json -Depth 6 | ConvertFrom-Json
$wrong.assets[0].browser_download_url='https://github.com/another/repo/releases/download/v0.6.0/SpotifyHangul-0.6.0-Setup.exe'
if (Select-UpdateAsset @($wrong) ([version]'0.5.1')) { throw 'Foreign repository accepted.' }; $passed++
$wrong.assets[0].browser_download_url=$release.assets[0].browser_download_url
$wrong.assets[0].digest=''
if (Select-UpdateAsset @($wrong) ([version]'0.5.1')) { throw 'Missing digest accepted.' }; $passed++
$wrong.draft=$true
$wrong.assets[0].digest=$release.assets[0].digest
if (Select-UpdateAsset @($wrong) ([version]'0.5.1')) { throw 'Draft release accepted.' }; $passed++
$wrong.draft=$false
$wrong | Add-Member -NotePropertyName prerelease -NotePropertyValue $true -Force
if (Select-UpdateAsset @($wrong) ([version]'0.5.1')) { throw 'Public prerelease accepted by stable updater.' }; $passed++
$wrong.prerelease=$false
$wrong.tag_name='v0.6.0-rc.1'
if (Select-UpdateAsset @($wrong) ([version]'0.5.1')) { throw 'RC tag accepted by stable updater.' }; $passed++
$wrong.tag_name='v0.6.0'
if ((Select-UpdateAsset @($wrong) ([version]'0.5.1')).version -ne '0.6.0') { throw 'Stable release rejected after prerelease filtering.' }; $passed++
$release | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $area 'release.json') -Encoding UTF8
$driver=Join-Path $area 'driver.ps1'
@'
# @file driver.ps1
# @author: ForUltraplayer
# @brief Isolate the update script from live network and installer execution.
param($Updater,$Root,$Area,$Fixture,$Scenario,$Action,[switch]$Interactive,[string]$RequestedVersion='0.0.0')
$env:LOCALAPPDATA=Join-Path $Area 'local'
function Invoke-RestMethod {
    param($Uri,$Headers,$TimeoutSec)
    if ($Scenario -eq 'Offline') { throw 'controlled offline fixture' }
    if ($Scenario -eq 'NoRelease') { return @() }
    return @(Get-Content -LiteralPath (Join-Path $Area 'release.json') -Raw | ConvertFrom-Json)
}
function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) Copy-Item -LiteralPath $Fixture -Destination $OutFile }
function Get-Process { param($Name,$Id,$ErrorAction) if ($Scenario -eq 'Playing' -and $Name -eq 'Spotify') { return [PSCustomObject]@{Id=123} } }
function Get-CimInstance {
    param($ClassName,$Filter)
    if ($Scenario -eq 'ActiveInstaller') {
        $pending=Get-ChildItem -LiteralPath (Join-Path $Area 'local') -Filter pending.json -Recurse | Select-Object -First 1
        $record=Get-Content -LiteralPath $pending.FullName -Raw | ConvertFrom-Json
        return [PSCustomObject]@{ExecutablePath=(Join-Path $pending.DirectoryName $record.name)}
    }
    return $null
}
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
    if ($Scenario -notin @('Install','Stale','InstallFail','Timeout')) { throw 'Unexpected installer execution' }
    $cwd=[Environment]::CurrentDirectory.TrimEnd('\')
    if ($cwd -ieq $Root -or $cwd.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Updater kept the installation directory open while waiting for rollback.' }
    [PSCustomObject]@{exe=$FilePath;arguments=$ArgumentList;workingDirectory=$cwd;providerDirectory=(Get-Location).Path} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Area 'executed.json') -Encoding UTF8
    if ($Scenario -in @('Install','Stale')) {
        '{"version":"0.6.0"}' | Set-Content -LiteralPath (Join-Path $Root 'release.json')
        '{"Version":"0.6.0"}' | Set-Content -LiteralPath (Join-Path $Root 'install-state.json')
    }
    $process=[PSCustomObject]@{Id=999999;ExitCode=if($Scenario -eq 'InstallFail'){1}else{0};TimedOut=($Scenario -eq 'Timeout')}
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Timeout) return (-not $this.TimedOut) }
    return $process
}
Set-Location -LiteralPath $Root
[Environment]::CurrentDirectory=$Root
& $Updater -Mode $Action -InstallRoot $Root -IgnoreInterval -Interactive:$Interactive -ErrorFile (Join-Path $Area 'error.txt') -RequestedVersion $RequestedVersion
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $driver -Encoding UTF8
$powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Invoke-Fixture($Scenario,$Action,[switch]$Interactive,[string]$RequestedVersion='0.0.0') {
    Remove-Item -LiteralPath (Join-Path $area 'error.txt') -ErrorAction SilentlyContinue
    $fixtureArguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$driver,'-Updater',$updater,'-Root',$root,'-Area',$area,'-Fixture',$fixture,'-Scenario',$Scenario,'-Action',$Action,'-RequestedVersion',$RequestedVersion)
    if ($Interactive) { $fixtureArguments += '-Interactive' }
    & $powershell @fixtureArguments *>> (Join-Path $area 'driver.log')
    return $LASTEXITCODE
}
if ((Invoke-Fixture Download Check) -ne 0) { throw 'Download fixture failed.' }
$pendingFile=Get-ChildItem -LiteralPath (Join-Path $area 'local') -Filter pending.json -File -Recurse | Select-Object -First 1
if (-not $pendingFile) { throw 'No verified update was queued.' }; $passed++
if ((Invoke-Fixture Playing ApplyPending) -ne 20 -or (Test-Path -LiteralPath (Join-Path $area 'executed.json'))) { throw 'Playback was not protected.' }; $passed++
$pending=Get-Content -LiteralPath $pendingFile.FullName -Raw | ConvertFrom-Json
$download=Join-Path $pendingFile.DirectoryName $pending.name
$stream=[IO.File]::OpenWrite($download)
try { $stream.WriteByte(0) } finally { $stream.Dispose() }
if ((Invoke-Fixture Block ApplyPending -Interactive) -ne 1 -or (Test-Path -LiteralPath (Join-Path $area 'executed.json'))) { throw 'Corrupted installer was executed.' }; $passed++
Copy-Item -LiteralPath $fixture -Destination $download -Force
if ((Invoke-Fixture Install ApplyPending -Interactive) -ne 0) { throw 'Valid queued update failed.' }
$execution=Get-Content -LiteralPath (Join-Path $area 'executed.json') -Raw | ConvertFrom-Json
if ($execution.arguments -ne ('/S /D='+$root) -or (Test-Path -LiteralPath $pendingFile.FullName)) { throw 'Update did not preserve its target or clear the queue.' }; $passed++
'{"Version":"0.5.1"}' | Set-Content -LiteralPath (Join-Path $root 'install-state.json') -Encoding UTF8
$pending | ConvertTo-Json | Set-Content -LiteralPath $pendingFile.FullName -Encoding UTF8
'{"status":"install-failed","version":"0.6.0"}' | Set-Content -LiteralPath (Join-Path $pendingFile.DirectoryName 'state.json') -Encoding UTF8
if ((Invoke-Fixture Block ApplyPending) -ne 0 -or (Get-Content -LiteralPath (Join-Path $pendingFile.DirectoryName 'state.json') -Raw | ConvertFrom-Json).status -ne 'install-failed') { throw 'The same failed update was retried automatically.' }; $passed++
if ((Invoke-Fixture Offline Check) -ne 0) { throw 'Offline check blocks normal playback.' }; $passed++
if ((Invoke-Fixture Offline Check -Interactive) -ne 1) { throw 'Manual updater hides download failures.' }; $passed++
function Reset-PendingFixture {
    '{"Version":"0.5.1"}' | Set-Content -LiteralPath (Join-Path $root 'install-state.json') -Encoding UTF8
    $pending | ConvertTo-Json | Set-Content -LiteralPath $pendingFile.FullName -Encoding UTF8
    '{"status":"queued","version":"0.6.0"}' | Set-Content -LiteralPath (Join-Path $pendingFile.DirectoryName 'state.json') -Encoding UTF8
    Remove-Item -LiteralPath (Join-Path $area 'executed.json') -ErrorAction SilentlyContinue
}
Reset-PendingFixture
if ((Invoke-Fixture InstallFail ApplyPending -Interactive) -ne 1) { throw 'Installation failure did not return an error.' }
$message=[IO.File]::ReadAllText((Join-Path $area 'error.txt'))
if ($message -notmatch '설치 종료 코드: 1' -or $message -match 'Spotify 프로세스가 실행') { throw 'Installation failure was mislabeled as Spotify running.' }; $passed++
$failure=Get-Content -LiteralPath (Join-Path $pendingFile.DirectoryName 'state.json') -Raw | ConvertFrom-Json
if ($failure.status -ne 'install-failed' -or $failure.installer_exit_code -ne 1) { throw 'Installer failure details were lost.' }; $passed++
Reset-PendingFixture
'{"status":"installing","version":"0.6.0","pid":999999}' | Set-Content -LiteralPath (Join-Path $pendingFile.DirectoryName 'state.json') -Encoding UTF8
if ((Invoke-Fixture Stale ApplyPending -Interactive) -ne 0 -or (Test-Path -LiteralPath $pendingFile.FullName)) { throw 'Reboot recovery must succeed on the first interactive retry.' }; $passed++
Reset-PendingFixture
'{"status":"installing","version":"0.6.0","pid":999999}' | Set-Content -LiteralPath (Join-Path $pendingFile.DirectoryName 'state.json') -Encoding UTF8
if ((Invoke-Fixture Block ApplyPending) -ne 0 -or (Test-Path -LiteralPath (Join-Path $area 'executed.json'))) { throw 'Stale automatic install was repeated.' }; $passed++
Reset-PendingFixture
'{"status":"installing","version":"0.6.0","pid":999999}' | Set-Content -LiteralPath (Join-Path $pendingFile.DirectoryName 'state.json') -Encoding UTF8
if ((Invoke-Fixture ActiveInstaller ApplyPending -Interactive) -ne 10 -or (Test-Path -LiteralPath (Join-Path $area 'executed.json'))) { throw 'Active installer was not protected.' }; $passed++
Reset-PendingFixture
if ((Invoke-Fixture Timeout ApplyPending -Interactive) -ne 11 -or [IO.File]::ReadAllText((Join-Path $area 'error.txt')) -notmatch '제한 시간') { throw 'Installer timeout was mislabeled.' }; $passed++
Reset-PendingFixture
$held=[IO.File]::Open((Join-Path $pendingFile.DirectoryName 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    if ((Invoke-Fixture Block ApplyPending -Interactive) -ne 10 -or [IO.File]::ReadAllText((Join-Path $area 'error.txt')) -notmatch '다운로드가 진행') { throw 'Update lock reason missing.' }
} finally { $held.Dispose() }
$passed++
[IO.File]::WriteAllText($pendingFile.FullName,($pending | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
if ((Invoke-Fixture Install ApplyPending -Interactive) -ne 0 -or (Test-Path -LiteralPath $pendingFile.FullName)) { throw 'BOM-free UTF-8 queue lost the Korean installation path.' }
$passed++
Reset-PendingFixture
$originalFixture=$fixture
$replacement=Join-Path $area 'replacement.exe'
Copy-Item -LiteralPath $fixture -Destination $replacement
$stream=[IO.File]::Open($replacement,[IO.FileMode]::Append,[IO.FileAccess]::Write)
try { $stream.WriteByte(90) } finally { $stream.Dispose() }
$replacementRelease=$release | ConvertTo-Json -Depth 6 | ConvertFrom-Json
$replacementRelease.assets[0].digest='sha256:'+(Get-Sha256 $replacement)
$replacementRelease.assets[0].size=(Get-Item -LiteralPath $replacement).Length
$replacementRelease | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $area 'release.json') -Encoding UTF8
$fixture=$replacement
try {
    if ((Invoke-Fixture Download Check -Interactive) -ne 0) { throw 'Replacement release download failed.' }
    $newPending=Get-Content -LiteralPath $pendingFile.FullName -Raw | ConvertFrom-Json
    if ($newPending.sha256 -ne (Get-Sha256 $replacement)) { throw 'Old cached bytes were reused after a release asset changed.' }
} finally { $fixture=$originalFixture }
$passed++
$startup=Join-Path $area 'timeout startup'
[void](New-Item -ItemType Directory -Path $startup)
Copy-Item -LiteralPath (Join-Path $project 'start.ps1') -Destination (Join-Path $startup 'start.ps1')
$updaterCalled=Join-Path $area 'startup-updater-called.txt'
("New-Item -ItemType File -Path '"+$updaterCalled+"' -Force | Out-Null; exit 11") | Set-Content -LiteralPath (Join-Path $startup 'auto-update.ps1') -Encoding UTF8
'{"app":"SpotifyHangul"}' | Set-Content -LiteralPath (Join-Path $startup 'install-marker.json') -Encoding UTF8
# start.ps1 runs the updater only when a download waits in the per-user cache; keep that cache in the test area.
$savedLocalAppData=$env:LOCALAPPDATA
$env:LOCALAPPDATA=Join-Path $area 'startup-local'
try {
    # Without a waiting update startup continues and fails later on this bare fixture; only the updater call matters here.
    $ErrorActionPreference='Continue'
    & $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $startup 'start.ps1') -NoErrorDialog *> (Join-Path $area 'no-pending-startup.log')
    $ErrorActionPreference='Stop'
    if (Test-Path -LiteralPath $updaterCalled) { throw 'Startup ran the updater although no update was waiting.' }
    $passed++
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $startupIdentity=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($startup).TrimEnd('\').ToLowerInvariant()))).Replace('-','').Substring(0,16) }
    finally { $sha.Dispose() }
    $startupCache=Join-Path $env:LOCALAPPDATA ('ivLyricsHangul\updates\'+$startupIdentity)
    [void](New-Item -ItemType Directory -Path $startupCache -Force)
    '{}' | Set-Content -LiteralPath (Join-Path $startupCache 'pending.json') -Encoding UTF8
    & $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $startup 'start.ps1') -NoErrorDialog *> (Join-Path $area 'timeout-startup.log')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $updaterCalled)) { throw 'A timed-out installer must stop startup before trying to launch the missing helper/client.' }
    $passed++
} finally { $env:LOCALAPPDATA=$savedLocalAppData }
Reset-PendingFixture
if ((Invoke-Fixture NoRelease Check -Interactive) -ne 21 -or (Test-Path -LiteralPath $pendingFile.FullName)) { throw 'Withdrawn cached release remains executable after a successful public check.' }
if (-not (Test-Path -LiteralPath $download) -or @(Get-ChildItem -LiteralPath $pendingFile.DirectoryName -Filter 'pending-withdrawn-*.json').Count -lt 1) { throw 'Withdrawn update evidence was not preserved.' }; $passed++
if ((Invoke-Fixture NoRelease Check -Interactive -RequestedVersion '0.6.3') -ne 22) { throw 'A private updater must not report an old public installation as successfully updated.' }; $passed++
if ((Invoke-Fixture Download Check -Interactive -RequestedVersion '0.6.3') -ne 22 -or (Test-Path -LiteralPath $pendingFile.FullName)) { throw 'A private updater selected an older public release instead.' }; $passed++
'{"Version":"0.6.3"}' | Set-Content -LiteralPath (Join-Path $root 'install-state.json') -Encoding UTF8
if ((Invoke-Fixture NoRelease Check -Interactive -RequestedVersion '0.6.3') -ne 0) { throw 'An already installed private version should remain up to date.' }; $passed++
'{"Version":"0.5.1"}' | Set-Content -LiteralPath (Join-Path $root 'install-state.json') -Encoding UTF8
$release | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $area 'release.json') -Encoding UTF8
if ((Invoke-Fixture Download Check -Interactive -RequestedVersion '0.6.0') -ne 0 -or -not (Test-Path -LiteralPath $pendingFile.FullName)) { throw 'A real published update could not be queued after withdrawal recovery.' }; $passed++
[PSCustomObject]@{tests=$passed;foreignReleasesRejected=$true;corruptionRejected=$true;playbackProtected=$true;mockInstallerOnly=$true} | ConvertTo-Json
