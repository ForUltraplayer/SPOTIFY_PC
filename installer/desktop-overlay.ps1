# @file desktop-overlay.ps1
# @author: ForUltraplayer
# @brief Launch or stop only the bundled existing overlay without changing its user settings or autostart.
# Windows PowerShell must resolve its own utility/CIM/network modules when a
# PowerShell 7 parent passed down a different PSModulePath.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
function Get-BundledDesktopOverlay([string]$InstallRoot) {
    $root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    $directory=Join-Path $root 'desktop-overlay'
    $receiptPath=Join-Path $directory 'receipt.json'
    if (-not (Test-Path -LiteralPath $receiptPath)) { return $null }
    foreach ($path in @($root,$directory,$receiptPath)) {
        if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '가사 오버레이 경로가 연결 폴더 또는 파일이어서 실행을 중단했습니다.' }
    }
    $receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $executable=Join-Path $directory 'lyrics-plus-overlay.exe'
    if ($receipt.app -cne 'SpotifyHangulDesktopOverlay' -or $receipt.sha256 -notmatch '^[a-f0-9]{64}$' -or
        -not (Test-Path -LiteralPath $executable)) { throw '내장 가사 오버레이 정보가 올바르지 않습니다. 설치본을 다시 실행해 주세요.' }
    $file=Get-Item -LiteralPath $executable
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Length -ne $receipt.bytes -or
        (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ine $receipt.sha256) {
        throw '내장 가사 오버레이 파일 검증에 실패했습니다. 설치본을 다시 실행해 주세요.'
    }
    return [PSCustomObject]@{Executable=$executable;Receipt=$receipt}
}

function Start-BundledDesktopOverlay([string]$InstallRoot) {
    $bundle=Get-BundledDesktopOverlay $InstallRoot
    if (-not $bundle) { return $null }
    $port=Get-DesktopOverlayPort
    $running=@(Get-CimInstance Win32_Process -Filter "name='lyrics-plus-overlay.exe'")
    foreach ($process in $running) {
        if (-not $process.ExecutablePath) { throw '실행 중인 가사 오버레이의 경로를 확인하지 못했습니다. 기존 오버레이를 종료한 뒤 다시 실행해 주세요.' }
        if ([IO.Path]::GetFullPath($process.ExecutablePath) -ieq $bundle.Executable) {
            Confirm-DesktopOverlayServer -ProcessId $process.ProcessId -Port $port
            return [PSCustomObject]@{Status='running';Pid=$process.ProcessId;Bundled=$true}
        }
        # The original single-instance identifier is preserved. Do not replace an
        # independently installed app or reset its settings merely to start ours.
        $original=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'lyrics-plus-overlay\lyrics-plus-overlay.exe'
        if ([IO.Path]::GetFullPath($process.ExecutablePath) -ieq $original -and
            (Test-Path -LiteralPath $process.ExecutablePath) -and
            (Get-FileHash -LiteralPath $process.ExecutablePath -Algorithm SHA256).Hash -ieq $bundle.Receipt.sha256) {
            Confirm-DesktopOverlayServer -ProcessId $process.ProcessId -Port $port
            return [PSCustomObject]@{Status='existing-compatible';Pid=$process.ProcessId;Bundled=$false}
        }
        throw '다른 버전의 가사 오버레이가 실행 중입니다. 트레이에서 기존 오버레이를 종료한 뒤 다시 실행해 주세요.'
    }
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count) { throw ('다른 프로그램이 가사 오버레이 포트를 사용 중입니다. 포트: '+$port+'.') }
    $started=Start-Process -FilePath $bundle.Executable -WorkingDirectory (Split-Path -Parent $bundle.Executable) -WindowStyle Hidden -PassThru
    try {
        Confirm-DesktopOverlayServer -ProcessId $started.Id -Port $port
        return [PSCustomObject]@{Status='started';Pid=$started.Id;Bundled=$true}
    } catch {
        $owned=Get-CimInstance Win32_Process -Filter ('ProcessId='+$started.Id) -ErrorAction SilentlyContinue
        if ($owned.ExecutablePath -and [IO.Path]::GetFullPath($owned.ExecutablePath) -ieq $bundle.Executable) {
            Stop-Process -Id $started.Id -ErrorAction SilentlyContinue
        }
        throw
    }
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
            if (@($listeners | Where-Object { $_.OwningProcess -ne $ProcessId }).Count) {
                throw ('다른 프로그램이 가사 오버레이 포트를 먼저 사용했습니다. 포트: '+$Port+'. 기존 프로그램은 종료하지 않았습니다.')
            }
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw '내장 가사 오버레이의 로컬 서버가 시작되지 않았습니다. Windows WebView2 Runtime 설치 여부를 확인해 주세요.'
}

function Stop-BundledDesktopOverlay([string]$InstallRoot) {
    $executable=Join-Path ([IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')) 'desktop-overlay\lyrics-plus-overlay.exe'
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "name='lyrics-plus-overlay.exe'")) {
        if ($process.ExecutablePath -and [IO.Path]::GetFullPath($process.ExecutablePath) -ieq $executable) {
            Stop-Process -Id $process.ProcessId -ErrorAction Stop
            Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        }
    }
}
