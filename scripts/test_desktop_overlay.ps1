# @file test_desktop_overlay.ps1
# @author: ForUltraplayer
# @brief Check that launches never start the overlay and that only the 0.7.0 bundled copy is stopped.
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$previousModulePath=$env:PSModulePath
# Reproduce a parent interpreter passing an incompatible module search path.
$env:PSModulePath=Join-Path $project 'work\intentionally-empty-overlay-modules'
. (Join-Path $project 'installer\desktop-overlay.ps1')
$root=Join-Path $project 'work\overlay-unit\installed app'
$bundled=Join-Path $root 'desktop-overlay\lyrics-plus-overlay.exe'
$userOverlay=Join-Path $env:LOCALAPPDATA 'lyrics-plus-overlay\lyrics-plus-overlay.exe'
$script:passed=0;$script:started=0;$script:stopped=@();$script:processes=@()
function Start-Process { $script:started++ }
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) if ($Filter -ne "name='lyrics-plus-overlay.exe'") { throw 'Unexpected process lookup.' }; $script:processes }
function Stop-Process { param($Id,$ErrorAction) $script:stopped+=@($Id) }
function Wait-Process { param($Id,$Timeout,$ErrorAction) }
try {
    # The 0.7.0 start.ps1 calls this right after an auto-update; ivLyrics opens the overlay instead.
    if ($null -ne (Start-BundledDesktopOverlay $root) -or $script:started) { throw 'A launch started the overlay.' };$script:passed++
    $script:processes=@([PSCustomObject]@{ExecutablePath=$bundled;ProcessId=321},[PSCustomObject]@{ExecutablePath=$userOverlay;ProcessId=444})
    Stop-BundledDesktopOverlay $root
    if ($script:stopped.Count -ne 1 -or $script:stopped[0] -ne 321) { throw 'Stop touched the separately installed overlay.' };$script:passed++
    [PSCustomObject]@{tests=$script:passed;overlayStarted=$false;userOverlayPreserved=$true} | ConvertTo-Json
} finally {
    $env:PSModulePath=$previousModulePath
}
