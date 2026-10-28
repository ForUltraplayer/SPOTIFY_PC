# @file desktop-overlay.ps1
# @author: ForUltraplayer
# @brief Keep 0.7.0 launch compatibility and stop the overlay copy that 0.7.0 bundled, without touching a separately installed overlay.
# Windows PowerShell must resolve its own utility/CIM/network modules when a
# PowerShell 7 parent passed down a different PSModulePath.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath

# The overlay is a separate app that ivLyrics opens with its overlay button, as in the
# original. On the first launch after an auto-update the 0.7.0 start.ps1 is still running,
# dot-sources this file and calls this name; it must neither start anything nor throw.
function Start-BundledDesktopOverlay([string]$InstallRoot) {
    return $null
}

# 0.7.0 bundled the overlay under the install root. Stop only that copy so an
# uninstall or upgrade never closes a separately installed overlay.
function Stop-BundledDesktopOverlay([string]$InstallRoot) {
    $executable=Join-Path ([IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')) 'desktop-overlay\lyrics-plus-overlay.exe'
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "name='lyrics-plus-overlay.exe'")) {
        if ($process.ExecutablePath -and [IO.Path]::GetFullPath($process.ExecutablePath) -ieq $executable) {
            Stop-Process -Id $process.ProcessId -ErrorAction Stop
            Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        }
    }
}
