# @file start.ps1
# @author: ForUltraplayer
# @brief Start the local existing-lyrics reader together with Spotify, without autostart registration.
param([switch]$NoErrorDialog)
$ErrorActionPreference = 'Stop'
try {
$updater = Join-Path $PSScriptRoot 'auto-update.ps1'
$nativePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if ((Test-Path -LiteralPath $updater) -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'install-marker.json'))) {
    # Run a temporary copy: the installer may replace this application's files.
    $updateRunner = Join-Path ([IO.Path]::GetTempPath()) ('SpotifyHangul-Update-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    Copy-Item -LiteralPath $updater -Destination $updateRunner
    try {
        & $nativePowerShell -NoProfile -ExecutionPolicy Bypass -File $updateRunner -Mode ApplyPending -InstallRoot $PSScriptRoot
        if ($LASTEXITCODE -in @(10,11)) { return }
    } finally { Remove-Item -LiteralPath $updateRunner -ErrorAction SilentlyContinue }
}
$bridgeScript = Join-Path $PSScriptRoot 'bridge.py'
$pythonWindowless = $env:IVLYRICS_HANGUL_PYTHON
if (-not $pythonWindowless) {
    $bundledPython = Join-Path $PSScriptRoot 'runtime\pythonw.exe'
    $pythonPathFile = Join-Path $PSScriptRoot 'python-path.txt'
    if (Test-Path -LiteralPath $bundledPython) { $pythonWindowless = $bundledPython }
    elseif (Test-Path -LiteralPath $pythonPathFile) {
        $pythonWindowless = (Get-Content -LiteralPath $pythonPathFile -Raw).Trim()
    }
    else {
        # Desktop shortcuts do not inherit a terminal's Conda PATH. WindowsApps
        # aliases may open the Store instead of running the lyric reader.
        $pythonCommand = Get-Command pythonw.exe,python.exe -CommandType Application -ErrorAction SilentlyContinue |
            Where-Object { $_.Source -notmatch '\\Microsoft\\WindowsApps\\' } | Select-Object -First 1
        if ($pythonCommand) {
            $pythonWindowless = $pythonCommand.Source
            $siblingWindowless = Join-Path (Split-Path -Parent $pythonWindowless) 'pythonw.exe'
            if (Test-Path -LiteralPath $siblingWindowless) { $pythonWindowless = $siblingWindowless }
        }
    }
}
$spotifyExe = Join-Path $env:APPDATA 'Spotify\Spotify.exe'
$installationState = Join-Path $PSScriptRoot 'install-state.json'
if (Test-Path -LiteralPath $installationState) {
    $installedSpotify = (Get-Content -LiteralPath $installationState -Raw | ConvertFrom-Json).SpotifyExe
    if ($installedSpotify -and (Test-Path -LiteralPath $installedSpotify)) { $spotifyExe = $installedSpotify }
}
if (-not (Test-Path -LiteralPath $spotifyExe)) { throw 'Spotify 실행 파일을 찾지 못했습니다.' }
if (Test-Path -LiteralPath $installationState) {
    $installedState = Get-Content -LiteralPath $installationState -Raw | ConvertFrom-Json
    if ($installedState.ManagedClient) {
        # Spotify's single-instance handoff could open the old client instead
        # of the managed one. Only stop known previous Spotify executables.
        $knownPrevious = @($installedState.PreviousSpotifyExe, (Join-Path $env:APPDATA 'Spotify\Spotify.exe'))
        $other = @(Get-CimInstance Win32_Process -Filter "name='Spotify.exe'" |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ne $spotifyExe })
        foreach ($process in $other) {
            if ($knownPrevious -contains $process.ExecutablePath) { Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
            else { throw '다른 위치의 Spotify가 실행 중입니다. 해당 Spotify를 종료한 뒤 한글 가사 바로가기를 다시 실행해 주세요.' }
        }
    }
}
$bridgeHealthy = $false
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:19643/health' -TimeoutSec 2
    if ($health.app -ne 'ivLyricsHangul') { throw '한글 가사 도우미 포트를 다른 프로그램이 사용하고 있습니다.' }
    $bridgeHealthy = $true
} catch [System.Net.WebException] {
    # The reader is not running yet.
}
if (-not $bridgeHealthy) {
    if (-not $pythonWindowless -or -not (Test-Path -LiteralPath $pythonWindowless)) { throw 'Python 실행 파일을 찾지 못했습니다. 도우미 폴더의 python-path.txt에 설치된 pythonw.exe의 전체 경로를 지정해 주세요.' }
    Start-Process -FilePath $pythonWindowless -ArgumentList @('-u', ('"' + $bridgeScript + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:19643/health' -TimeoutSec 1
            if ($health.app -eq 'ivLyricsHangul') { $bridgeHealthy = $true; break }
        } catch [System.Net.WebException] { }
    }
    if (-not $bridgeHealthy) { throw '한글 발음 도우미를 시작하지 못했습니다.' }
}
Start-Process -FilePath $spotifyExe
if (Test-Path -LiteralPath $updater) {
    Start-Process -FilePath $nativePowerShell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$updater+'"'),'-Mode','Check','-InstallRoot',('"'+$PSScriptRoot+'"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
}
} catch {
    $message = $_.Exception.Message
    $errorFile = Join-Path $PSScriptRoot 'start-error.txt'
    try { "$(Get-Date -Format o)`r`n$message" | Set-Content -LiteralPath $errorFile -Encoding UTF8 } catch { }
    if (-not $NoErrorDialog) {
        $dialog = New-Object -ComObject WScript.Shell
        [void]$dialog.Popup("$message`r`n`r`n오류 기록: $errorFile", 0, 'Spotify 한글 가사 실행 오류', 16)
    }
    throw $message
}
