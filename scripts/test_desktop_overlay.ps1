# @file test_desktop_overlay.ps1
# @author: ForUltraplayer
# @brief Check overlay integrity, exact process ownership, port conflicts and startup cleanup without launching apps.
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$previousModulePath=$env:PSModulePath
# Reproduce a parent interpreter passing an incompatible module search path.
$env:PSModulePath=Join-Path $project 'work\intentionally-empty-overlay-modules'
. (Join-Path $project 'installer\desktop-overlay.ps1')
$area=Join-Path $project ('work\overlay-unit-'+[Guid]::NewGuid().ToString('N'))
$root=Join-Path $area 'installed app'
$directory=Join-Path $root 'desktop-overlay'
$exe=Join-Path $directory 'lyrics-plus-overlay.exe'
$other=Join-Path $area 'another app\lyrics-plus-overlay.exe'
$receiptPath=Join-Path $directory 'receipt.json'
$previousPort=$env:IVLYRICS_PORT
$script:passed=0
function Expect-Rejection([scriptblock]$Action) {
    $rejected=$false
    try { & $Action } catch { $rejected=$true }
    if (-not $rejected) { throw 'Expected overlay rejection.' }
    $script:passed++
}
function Reset-Mocks {
    $script:mockProcesses=@();$script:mockStarted=$false;$script:mockMode='normal'
    $script:mockStopped=@();$script:mockStartCount=0;$script:mockSleepCount=0;$script:mockListenerOwner=321
}
function Get-CimInstance {
    param($ClassName,$Filter,$ErrorAction)
    if ($ClassName -ne 'Win32_Process') { throw 'Unbounded process lookup.' }
    if ($Filter -eq "name='lyrics-plus-overlay.exe'") { return $script:mockProcesses }
    if ($Filter -eq 'ProcessId=321' -and $script:mockStarted) { return [PSCustomObject]@{ExecutablePath=$exe;ProcessId=321} }
    throw 'Unexpected process lookup.'
}
function Get-NetTCPConnection {
    param($State,$LocalPort,$ErrorAction)
    if ($State -ne 'Listen' -or $LocalPort -ne 15555) { throw 'Wrong configured overlay port.' }
    if ($script:mockMode -eq 'busy') { return [PSCustomObject]@{OwningProcess=444} }
    if ($script:mockStarted -or $script:mockProcesses.Count) {
        if ($script:mockMode -eq 'timeout') { return }
        if ($script:mockMode -eq 'race') { return [PSCustomObject]@{OwningProcess=444} }
        return [PSCustomObject]@{OwningProcess=$script:mockListenerOwner}
    }
}
function Start-Process {
    param($FilePath,$WorkingDirectory,$WindowStyle,[switch]$PassThru)
    if ($FilePath -ine $exe -or $WorkingDirectory -ine $directory -or $WindowStyle -ne 'Hidden' -or -not $PassThru) { throw 'Unowned process start.' }
    $script:mockStartCount++;$script:mockStarted=$true
    return [PSCustomObject]@{Id=321}
}
function Stop-Process { param($Id,$ErrorAction) $script:mockStopped+=@($Id) }
function Wait-Process { param($Id,$Timeout,$ErrorAction) }
function Start-Sleep { param($Milliseconds) $script:mockSleepCount++ }
try {
    [void](New-Item -ItemType Directory -Path $directory -Force)
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $other) -Force)
    [IO.File]::WriteAllBytes($exe,[Text.Encoding]::ASCII.GetBytes('MZ-overlay-fixture'))
    Copy-Item -LiteralPath $exe -Destination $other
    $receipt=[PSCustomObject]@{app='SpotifyHangulDesktopOverlay';sha256=(Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $exe).Length}
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $env:IVLYRICS_PORT='15555'
    Reset-Mocks
    if ((Get-BundledDesktopOverlay $root).Executable -ine $exe) { throw 'Bundle path mismatch.' };$script:passed++
    $result=Start-BundledDesktopOverlay $root
    if ($result.Status -ne 'started' -or $result.Pid -ne 321 -or $script:mockStartCount -ne 1) { throw 'Bundle not launched once.' };$script:passed++
    Reset-Mocks
    $script:mockProcesses=@([PSCustomObject]@{ExecutablePath=$exe;ProcessId=321})
    if ((Start-BundledDesktopOverlay $root).Status -ne 'running' -or $script:mockStartCount) { throw 'Already running bundle duplicated.' };$script:passed++
    Reset-Mocks;$script:mockProcesses=@([PSCustomObject]@{ExecutablePath=$other;ProcessId=444})
    Expect-Rejection { Start-BundledDesktopOverlay $root }
    if ($script:mockStopped.Count -or $script:mockStartCount) { throw 'Foreign overlay touched.' };$script:passed++
    Reset-Mocks;$script:mockMode='busy'
    Expect-Rejection { Start-BundledDesktopOverlay $root }
    if ($script:mockStopped.Count -or $script:mockStartCount) { throw 'Port owner touched.' };$script:passed++
    Reset-Mocks;$script:mockMode='race'
    Expect-Rejection { Start-BundledDesktopOverlay $root }
    if ($script:mockStopped.Count -ne 1 -or $script:mockStopped[0] -ne 321) { throw 'Startup race did not clean only its own child.' };$script:passed++
    Reset-Mocks;$script:mockMode='timeout'
    Expect-Rejection { Start-BundledDesktopOverlay $root }
    if ($script:mockSleepCount -ne 20 -or $script:mockStopped.Count -ne 1 -or $script:mockStopped[0] -ne 321) { throw 'Startup timeout cleanup failed.' };$script:passed++
    Reset-Mocks;$script:mockProcesses=@([PSCustomObject]@{ExecutablePath=$exe;ProcessId=321},[PSCustomObject]@{ExecutablePath=$other;ProcessId=444})
    Stop-BundledDesktopOverlay $root
    if ($script:mockStopped.Count -ne 1 -or $script:mockStopped[0] -ne 321) { throw 'Stop touched another overlay.' };$script:passed++
    [IO.File]::AppendAllText($exe,'tamper')
    Expect-Rejection { Get-BundledDesktopOverlay $root }
    Copy-Item -LiteralPath $other -Destination $exe -Force
    $receipt.app='Other';$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    Expect-Rejection { Get-BundledDesktopOverlay $root }
    Remove-Item -LiteralPath $receiptPath
    Reset-Mocks
    if ($null -ne (Start-BundledDesktopOverlay $root) -or $script:mockStartCount) { throw 'Absent optional overlay launched.' };$script:passed++
    [PSCustomObject]@{tests=$script:passed;appsLaunched=$false;ownedProcessAndPort=$true;foreignProcessPreserved=$true;userSettingsUnchanged=$true} | ConvertTo-Json
} finally {
    $env:IVLYRICS_PORT=$previousPort
    $env:PSModulePath=$previousModulePath
    if ([IO.Path]::GetFullPath($area).StartsWith([IO.Path]::GetFullPath((Join-Path $project 'work'))+'\',[StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $area -Recurse -Force -ErrorAction SilentlyContinue
    }
}
