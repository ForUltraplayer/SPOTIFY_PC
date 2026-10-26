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
$release | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $area 'release.json') -Encoding UTF8
$driver=Join-Path $area 'driver.ps1'
@'
# @file driver.ps1
# @author: ForUltraplayer
# @brief Isolate the update script from live network and installer execution.
param($Updater,$Root,$Area,$Fixture,$Scenario,$Action,[switch]$Interactive)
$env:LOCALAPPDATA=Join-Path $Area 'local'
function Invoke-RestMethod {
    param($Uri,$Headers,$TimeoutSec)
    if ($Scenario -eq 'Offline') { throw 'controlled offline fixture' }
    return @(Get-Content -LiteralPath (Join-Path $Area 'release.json') -Raw | ConvertFrom-Json)
}
function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) Copy-Item -LiteralPath $Fixture -Destination $OutFile }
function Get-Process { param($Name,$Id,$ErrorAction) if ($Scenario -eq 'Playing' -and $Name -eq 'Spotify') { return [PSCustomObject]@{Id=123} } }
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
    if ($Scenario -ne 'Install') { throw 'Unexpected installer execution' }
    [PSCustomObject]@{exe=$FilePath;arguments=$ArgumentList} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Area 'executed.json')
    '{"version":"0.6.0"}' | Set-Content -LiteralPath (Join-Path $Root 'release.json')
    '{"Version":"0.6.0"}' | Set-Content -LiteralPath (Join-Path $Root 'install-state.json')
    $process=[PSCustomObject]@{Id=999999;ExitCode=0}
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Timeout) return $true }
    return $process
}
& $Updater -Mode $Action -InstallRoot $Root -IgnoreInterval -Interactive:$Interactive
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $driver -Encoding UTF8
$powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Invoke-Fixture($Scenario,$Action,[switch]$Interactive) {
    $fixtureArguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$driver,'-Updater',$updater,'-Root',$root,'-Area',$area,'-Fixture',$fixture,'-Scenario',$Scenario,'-Action',$Action)
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
[PSCustomObject]@{tests=$passed;foreignReleasesRejected=$true;corruptionRejected=$true;playbackProtected=$true;mockInstallerOnly=$true} | ConvertTo-Json
