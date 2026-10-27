# @file start.ps1
# @author: ForUltraplayer
# @brief Start the local existing-lyrics reader together with Spotify, without autostart registration.
param([switch]$NoErrorDialog)
$ErrorActionPreference = 'Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath

function Assert-HelperHealth($Health, [string]$BridgeScript, [string]$ExpectedVersion, [string]$PythonPath, [int]$ExpectedPid=0) {
    if ($Health.app -cne 'ivLyricsHangul' -or $Health.version -cne $ExpectedVersion -or $Health.protocol -ne 1) {
        throw '한글 가사 도우미 버전이 다릅니다. 실행 중인 다른 설치본을 종료한 뒤 다시 실행해 주세요.'
    }
    foreach ($capability in @('youtube-links-v1','mixed-playlists-v1','playback-control-v1','lyric-sync-v1')) {
        if (@($Health.capabilities) -cnotcontains $capability) { throw '도우미 기능 구성이 다릅니다. 현재 설치본을 다시 실행해 주세요.' }
    }
    $helperProcessId=0
    if (-not [int]::TryParse([string]$Health.pid,[ref]$helperProcessId) -or $helperProcessId -le 0 -or
        ($ExpectedPid -and $helperProcessId -ne $ExpectedPid)) { throw '한글 가사 도우미 실행 정보를 확인하지 못했습니다.' }
    $helperProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$helperProcessId) -ErrorAction Stop
    if (-not $helperProcess -or -not $helperProcess.CommandLine -or -not $PythonPath -or
        -not $helperProcess.ExecutablePath -or
        [IO.Path]::GetFullPath($helperProcess.ExecutablePath) -ine [IO.Path]::GetFullPath($PythonPath)) {
        throw '다른 위치의 도우미가 가사 포트를 사용하고 있습니다. 해당 설치본을 종료한 뒤 다시 실행해 주세요.'
    }
    $expectedBridge=[IO.Path]::GetFullPath($BridgeScript)
    $arguments=@([regex]::Matches($helperProcess.CommandLine,'"([^"]*)"|(\S+)') | ForEach-Object {
        if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
    })
    $scriptIndex=1
    while ($scriptIndex -lt $arguments.Count -and $arguments[$scriptIndex] -cin @('-u','-B','-I')) { $scriptIndex++ }
    if ($scriptIndex -ne $arguments.Count-1 -or
        -not [string]::Equals($arguments[$scriptIndex],$expectedBridge,[StringComparison]::OrdinalIgnoreCase)) {
        throw '다른 설치 위치의 도우미가 실행 중입니다. 해당 설치본을 종료한 뒤 다시 실행해 주세요.'
    }
    return $true
}

$previousProcessDirectory=[Environment]::CurrentDirectory
$previousLocation=Get-Location
try {
# An updater can restore this installation while this PowerShell is waiting.
# Release the directory handle as well as PowerShell's provider location.
$launchDirectory=[IO.Path]::GetTempPath()
Set-Location -LiteralPath $launchDirectory
[Environment]::CurrentDirectory=$launchDirectory
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
$expectedHelperVersion=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json).helper_version
if ($expectedHelperVersion -notmatch '^\d+\.\d+\.\d+$') { throw '설치된 도우미 버전 정보가 올바르지 않습니다.' }
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
    $bridgeHealthy = Assert-HelperHealth $health $bridgeScript $expectedHelperVersion $pythonWindowless
} catch [System.Net.WebException] {
    # The reader is not running yet.
}
if (-not $bridgeHealthy) {
    if (-not $pythonWindowless -or -not (Test-Path -LiteralPath $pythonWindowless)) { throw 'Python 실행 파일을 찾지 못했습니다. 도우미 폴더의 python-path.txt에 설치된 pythonw.exe의 전체 경로를 지정해 주세요.' }
    $startedHelper=Start-Process -FilePath $pythonWindowless -ArgumentList @('-u', ('"' + $bridgeScript + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:19643/health' -TimeoutSec 1
            $bridgeHealthy = Assert-HelperHealth $health $bridgeScript $expectedHelperVersion $pythonWindowless $startedHelper.Id
            if ($bridgeHealthy) { break }
        } catch [System.Net.WebException] { }
    }
    if (-not $bridgeHealthy) { throw '한글 발음 도우미를 시작하지 못했습니다.' }
}
$desktopOverlayHook=Join-Path $PSScriptRoot 'installer\desktop-overlay.ps1'
if (Test-Path -LiteralPath $desktopOverlayHook) {
    . $desktopOverlayHook
    # The overlay is an optional separate app; its failure must not block Spotify.
    try { $null=Start-UserDesktopOverlay }
    catch {
        $overlayMessage='데스크톱 가사창을 시작하지 못했습니다. Spotify는 계속 실행합니다. '+$_.Exception.Message
        try { "$(Get-Date -Format o)`r`n$overlayMessage" | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'start-error.txt') -Encoding UTF8 } catch { }
    }
}
Start-Process -FilePath $spotifyExe -WorkingDirectory (Split-Path -Parent $spotifyExe)
if (Test-Path -LiteralPath $updater) {
    Start-Process -FilePath $nativePowerShell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$updater+'"'),'-Mode','Check','-InstallRoot',('"'+$PSScriptRoot+'"')) -WorkingDirectory $launchDirectory -WindowStyle Hidden
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
} finally {
    try { if (Test-Path -LiteralPath $previousLocation.Path) { Set-Location -LiteralPath $previousLocation.Path } } catch { }
    try { if ([IO.Directory]::Exists($previousProcessDirectory)) { [Environment]::CurrentDirectory=$previousProcessDirectory } } catch { }
}
