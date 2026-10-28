# @file desktop-overlay.ps1
# @author: ForUltraplayer
# @brief Launch the separately installed desktop overlay, if any, without changing its user settings or autostart.
# Windows PowerShell must resolve its own utility/CIM/network modules when a
# PowerShell 7 parent passed down a different PSModulePath.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath

# The overlay is no longer bundled. Users install it themselves (the original
# installer or the fork EXE) at the original app's per-user location.
function Get-UserDesktopOverlay {
    $executable=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'lyrics-plus-overlay\lyrics-plus-overlay.exe'
    if (-not (Test-Path -LiteralPath $executable)) { return $null }
    if ((Get-Item -LiteralPath $executable).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '가사 오버레이 경로가 연결 파일이어서 실행을 중단했습니다.' }
    return $executable
}

function Start-UserDesktopOverlay {
    $port=Get-DesktopOverlayPort
    $running=@(Get-CimInstance Win32_Process -Filter "name='lyrics-plus-overlay.exe'")
    if ($running.Count) {
        Confirm-DesktopOverlayServer -ProcessId $running[0].ProcessId -Port $port
        return [PSCustomObject]@{Status='running';Pid=$running[0].ProcessId}
    }
    $executable=Get-UserDesktopOverlay
    if (-not $executable) { return $null }
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count) { throw ('다른 프로그램이 가사 오버레이 포트를 사용 중입니다. 포트: '+$port+'.') }
    $started=Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) -WindowStyle Hidden -PassThru
    try {
        Confirm-DesktopOverlayServer -ProcessId $started.Id -Port $port
        return [PSCustomObject]@{Status='started';Pid=$started.Id}
    } catch {
        $owned=Get-CimInstance Win32_Process -Filter ('ProcessId='+$started.Id) -ErrorAction SilentlyContinue
        if ($owned.ExecutablePath -and [IO.Path]::GetFullPath($owned.ExecutablePath) -ieq $executable) {
            Stop-Process -Id $started.Id -ErrorAction SilentlyContinue
        }
        throw
    }
}

# On the first launch after an auto-update the 0.7.0 start.ps1 is still running
# and dot-sources this file, then calls the old name. Its caller aborts Spotify on
# any error, so this shim must never throw.
function Start-BundledDesktopOverlay([string]$InstallRoot) {
    try { return Start-UserDesktopOverlay } catch { return $null }
}

function Get-DesktopOverlayPort {
    $port=15000
    $portPath=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ivlyrics-overlay\port.txt'
    $portValue=$env:IVLYRICS_PORT
    if (-not $portValue -and (Test-Path -LiteralPath $portPath)) { $portValue=(Get-Content -LiteralPath $portPath -Raw).Trim() }
    $parsedPort=0
    if ([int]::TryParse([string]$portValue,[ref]$parsedPort) -and $parsedPort -ge 1024 -and $parsedPort -le 65535) { $port=$parsedPort }
    return $port
}

function Confirm-DesktopOverlayServer([int]$ProcessId,[int]$Port) {
    for ($attempt=0;$attempt -lt 20;$attempt++) {
        $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        if ($listeners.Count) {
            $others=@($listeners | Where-Object { $_.OwningProcess -ne $ProcessId })
            if ($others.Count) {
                # Two launches at once (installer finish page and shortcut) both start the
                # overlay; the one that won the port is the same app and serves fine.
                $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$others[0].OwningProcess) -ErrorAction SilentlyContinue
                if ($owner.Name -eq 'lyrics-plus-overlay.exe') { return }
                throw ('다른 프로그램이 가사 오버레이 포트를 먼저 사용했습니다. 포트: '+$Port+'. 기존 프로그램은 종료하지 않았습니다.')
            }
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw '가사 오버레이의 로컬 서버가 시작되지 않았습니다. Windows WebView2 Runtime 설치 여부를 확인해 주세요.'
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
