# @file integrate.ps1
# @author: ForUltraplayer
# @brief Integrate the bundled per-user application while preserving existing Spotify customizations.
param(
    [ValidateSet('Prepare','Install','Uninstall')][string]$Mode = 'Install',
    [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$marker = Join-Path $root 'install-marker.json'
$statePath = Join-Path $root 'install-state.json'
$configRoot = if ($env:SPICETIFY_CONFIG) { $env:SPICETIFY_CONFIG } else { Join-Path $env:APPDATA 'spicetify' }
$configPath = Join-Path $configRoot 'config-xpui.ini'
$extension = Join-Path $configRoot 'Extensions\hangul-lyrics.js'
$backup = Join-Path $root 'backup'
$cli = Join-Path $root 'tools\spicetify.exe'
$state = $null
$attempt = $null
$spotifyStopped = $false

function Assert-AppDirectory {
    $forbidden = @([IO.Path]::GetPathRoot($root).TrimEnd('\'), $env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:SystemRoot)
    if ($forbidden -contains $root) { throw '설치할 전용 하위 폴더를 선택해 주세요.' }
    if (Test-Path -LiteralPath $root) {
        $known = $false
        if (Test-Path -LiteralPath $marker) {
            $known = (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).app -eq 'SpotifyHangul'
        }
        if (-not $known -and @(Get-ChildItem -LiteralPath $root -Force).Count) {
            throw '비어 있는 폴더 또는 기존 Spotify 한글 가사 설치 폴더를 선택해 주세요.'
        }
    }
}

function Find-Spotify {
    $candidates = @((Join-Path $env:APPDATA 'Spotify\Spotify.exe'))
    if (Test-Path -LiteralPath $configPath) {
        $setting = Select-String -LiteralPath $configPath -Pattern '^\s*spotify_path\s*=\s*(.+?)\s*$' | Select-Object -First 1
        if ($setting) { $candidates = @((Join-Path $setting.Matches[0].Groups[1].Value 'Spotify.exe')) + $candidates }
    }
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return [IO.Path]::GetFullPath($candidate) } }
    throw 'Spotify 데스크톱 실행 파일을 찾지 못했습니다. Spotify 데스크톱 버전을 설치하고 한 번 실행한 뒤 다시 설치해 주세요.'
}

function Stop-OwnHelper {
    $health = $null
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:19643/health' -TimeoutSec 2 }
    catch [System.Net.WebException] { return }
    if ($health.app -ne 'ivLyricsHangul') { throw '한글 가사 포트를 다른 앱이 사용하고 있습니다.' }
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $health.pid)
    $paths = @((Join-Path $root 'bridge.py'), (Join-Path $env:LOCALAPPDATA 'ivLyricsHangul\bridge.py'))
    $old = (Get-ItemProperty -LiteralPath 'HKCU:\Software\SpotifyHangul' -ErrorAction SilentlyContinue).InstallDir
    if ($old) { $paths += Join-Path $old 'bridge.py' }
    if (-not @($paths | Where-Object { $process.CommandLine -and $process.CommandLine.Contains($_) }).Count) {
        throw '실행 중인 도우미의 설치 경로를 확인하지 못했습니다.'
    }
    Stop-Process -Id $health.pid
}

function Stop-Spotify([string]$Executable) {
    Get-CimInstance Win32_Process -Filter "name='Spotify.exe'" | Where-Object { $_.ExecutablePath -eq $Executable } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    }
}

function Invoke-Spicetify([string[]]$Arguments) {
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $cli @Arguments 2>&1 | Out-File -LiteralPath (Join-Path $root 'install.log') -Encoding UTF8 -Append
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($exitCode -ne 0) { throw ('Spotify 설정 적용에 실패했습니다. install.log를 확인해 주세요. 작업: ' + ($Arguments -join ' ')) }
}

function Get-ApplyArguments([string]$SpotifyExe) {
    # Match Spicetify's own STOCK/MIXED state: original .spa files permit
    # backup; an already applied installation must reuse its existing backup.
    $apps = Join-Path (Split-Path -Parent $SpotifyExe) 'Apps'
    if (@(Get-ChildItem -LiteralPath $apps -Filter '*.spa' -File).Count) { return @('-n','backup','apply') }
    return @('-n','apply')
}

function Restore-Shortcut {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcut = Join-Path $desktop 'Spotify 한글 가사.lnk'
    if (-not (Test-Path -LiteralPath $shortcut)) { return }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($shortcut)
    if (-not $link.Arguments.Contains((Join-Path $root 'start.ps1'))) { return }
    $original = Join-Path $backup 'desktop.before.lnk'
    if (Test-Path -LiteralPath $original) { Copy-Item -LiteralPath $original -Destination $shortcut -Force }
    else { Remove-Item -LiteralPath $shortcut }
}

try {
    Assert-AppDirectory
    if ($Mode -eq 'Prepare') {
        [void](Find-Spotify)
        Stop-OwnHelper
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        '{"app":"SpotifyHangul","prepared":true}' | Set-Content -LiteralPath $marker -Encoding UTF8
        exit 0
    }
    if ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).app -ne 'SpotifyHangul') { throw '설치 폴더 식별자가 올바르지 않습니다.' }
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $configRoot = $state.ConfigRoot
        $env:SPICETIFY_CONFIG = $configRoot
        $configPath = Join-Path $configRoot 'config-xpui.ini'
        $extension = Join-Path $configRoot 'Extensions\hangul-lyrics.js'
    }
    if ($Mode -eq 'Uninstall') {
        if (-not $state) { throw '설치 기록을 찾지 못해 자동 제거를 중단했습니다.' }
        $registered = (Get-ItemProperty -LiteralPath 'HKCU:\Software\SpotifyHangul' -ErrorAction SilentlyContinue).InstallDir
        if ($registered -and [IO.Path]::GetFullPath($registered).TrimEnd('\') -ne $root) { exit 0 }
        Stop-OwnHelper
        Stop-Spotify $state.SpotifyExe
        if ($state.ExtensionExisted -and (Test-Path -LiteralPath (Join-Path $backup 'hangul-lyrics.before.js'))) {
            Copy-Item -LiteralPath (Join-Path $backup 'hangul-lyrics.before.js') -Destination $extension -Force
        } else {
            Invoke-Spicetify -Arguments @('config','extensions','hangul-lyrics.js-')
            if (Test-Path -LiteralPath $extension) { Remove-Item -LiteralPath $extension }
        }
        Invoke-Spicetify -Arguments @('-n','apply')
        Restore-Shortcut
        exit 0
    }
    $spotifyExe = Find-Spotify
    $prefs = Join-Path $env:APPDATA 'Spotify\prefs'
    if (-not (Test-Path -LiteralPath $prefs)) { throw '먼저 Spotify를 한 번 실행해 초기 설정을 완료해 주세요.' }
    New-Item -ItemType Directory -Path $backup,(Join-Path $configRoot 'Extensions'),(Join-Path $configRoot 'CustomApps') -Force | Out-Null
    if (-not $state) {
        $state = [PSCustomObject]@{ App='SpotifyHangul'; ConfigRoot=$configRoot; SpotifyExe=$spotifyExe; ExtensionExisted=(Test-Path -LiteralPath $extension); ConfigExisted=(Test-Path -LiteralPath $configPath) }
        if ($state.ExtensionExisted) { Copy-Item -LiteralPath $extension -Destination (Join-Path $backup 'hangul-lyrics.before.js') }
        if ($state.ConfigExisted) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'config.before.ini') }
        $shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Spotify 한글 가사.lnk'
        if (Test-Path -LiteralPath $shortcut) { Copy-Item -LiteralPath $shortcut -Destination (Join-Path $backup 'desktop.before.lnk') }
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    }
    & (Join-Path $root 'runtime\python.exe') -I -B -c 'import sys,pykakasi,phonetics; assert sys.flags.isolated == 1; assert phonetics.japanese_to_hangul(chr(0x9752)+chr(0x3044)+chr(0x7a7a),pykakasi.kakasi())'
    if ($LASTEXITCODE -ne 0) { throw '앱에 포함된 실행 환경 검증에 실패했습니다.' }
    # Keep the first-install baseline for removal, and an independent snapshot
    # for this update attempt so a failure cannot roll back later user changes.
    $attempt = [PSCustomObject]@{ ExtensionExisted=(Test-Path -LiteralPath $extension); ConfigExisted=(Test-Path -LiteralPath $configPath) }
    if ($attempt.ExtensionExisted) { Copy-Item -LiteralPath $extension -Destination (Join-Path $backup 'attempt.extension.js') -Force }
    if ($attempt.ConfigExisted) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'attempt.config.ini') -Force }
    Stop-Spotify $spotifyExe
    $spotifyStopped = $true
    Invoke-Spicetify -Arguments @('config','spotify_path',(Split-Path -Parent $spotifyExe),'prefs_path',$prefs)
    $customApp = Join-Path $configRoot 'CustomApps\ivLyrics'
    if (-not (Test-Path -LiteralPath (Join-Path $customApp 'index.js'))) {
        Copy-Item -LiteralPath (Join-Path $root 'ivLyrics') -Destination $customApp -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $root 'hangul-lyrics.js') -Destination $extension -Force
    Invoke-Spicetify -Arguments @('config','custom_apps','ivLyrics','extensions','hangul-lyrics.js')
    Invoke-Spicetify -Arguments (Get-ApplyArguments $spotifyExe)
    Write-Output 'Spotify 한글 가사 연결을 완료했습니다.'
} catch {
    $message = $_.Exception.Message
    if ($Mode -eq 'Install' -and $attempt) {
        if ($attempt.ExtensionExisted) {
            Copy-Item -LiteralPath (Join-Path $backup 'attempt.extension.js') -Destination $extension -Force
        } elseif (Test-Path -LiteralPath $extension) { Remove-Item -LiteralPath $extension }
        if ($attempt.ConfigExisted) {
            Copy-Item -LiteralPath (Join-Path $backup 'attempt.config.ini') -Destination $configPath -Force
            if ($spotifyStopped) {
                try { Invoke-Spicetify -Arguments @('-n','apply') } catch { Write-Warning $_.Exception.Message }
            }
        } elseif (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath }
    }
    Write-Error $message -ErrorAction Continue
    exit 1
}
