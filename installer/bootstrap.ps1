# @file bootstrap.ps1
# @brief Install a managed Spotify/SpotX client and isolated Spicetify configuration in one application folder.
param([ValidateSet('Prepare','Install','Uninstall')][string]$Mode='Install',
      [Parameter(Mandatory=$true)][string]$InstallRoot,
      [string]$InstallerFile)
$ErrorActionPreference='Stop'
# Parent shells can pass PowerShell 7 modules into Windows PowerShell 5.1.
# Resolve Windows security/certificate commands from this interpreter only.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$marker=Join-Path $root 'install-marker.json'
$statePath=Join-Path $root 'install-state.json'
$client=Join-Path $root 'Spotify'
$config=Join-Path $root 'spicetify-config'
$cli=Join-Path $root 'tools\spicetify.exe'
$powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$stage=$null
$state=$null
$attemptConfig=$null
$attemptApps=$null
$preprocessState=Join-Path $root 'spicetify-state'
$attemptPreprocess=$null
$preprocessExisted=$false
$preprocessTouched=$false
$stockApps=$null
$ivLyricsTransaction=$null
# Korean on Korean Windows, English elsewhere; SPOTIFYHANGUL_LANGUAGE (ko or en) overrides it (the installer passes its language, tests pin it).
$useKorean=if ($env:SPOTIFYHANGUL_LANGUAGE) { $env:SPOTIFYHANGUL_LANGUAGE -eq 'ko' } else { (Get-UICulture).TwoLetterISOLanguageName -eq 'ko' }

function Get-Text([string]$Korean,[string]$English) { if ($useKorean) { return $Korean }; return $English }

function Assert-AppDirectory {
    $forbidden=@([IO.Path]::GetPathRoot($root).TrimEnd('\'),$env:USERPROFILE,$env:APPDATA,$env:LOCALAPPDATA,$env:ProgramFiles,${env:ProgramFiles(x86)},$env:SystemRoot)
    if ($forbidden -contains $root) { throw (Get-Text '설치할 전용 하위 폴더를 선택해 주세요.' 'Choose a dedicated subfolder to install into.') }
    if (Test-Path -LiteralPath $root) {
        if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw (Get-Text '연결 폴더에는 설치할 수 없습니다.' 'Cannot install into a linked folder.') }
        $known=(Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).app -eq 'SpotifyHangul')
        if (-not $known -and @(Get-ChildItem -LiteralPath $root -Force).Count) { throw (Get-Text '비어 있는 폴더 또는 기존 설치 폴더를 선택해 주세요.' 'Choose an empty folder or an existing installation folder.') }
    }
}

function Assert-OwnedChild([string]$Path) {
    $resolved=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $resolved.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw (Get-Text '설치 폴더 밖의 경로를 거부했습니다.' 'Refused a path outside the installation folder.') }
    if (Test-Path -LiteralPath $resolved) {
        if ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw (Get-Text '연결 폴더를 거부했습니다.' 'Refused a linked folder.') }
        if (@(Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw (Get-Text '연결 파일을 포함한 폴더를 거부했습니다.' 'Refused a folder that contains linked files.') }
    }
}

function Stop-ExactSpotify([string]$Path) {
    if (-not $Path) { return }
    Get-CimInstance Win32_Process -Filter "name='Spotify.exe'" | Where-Object { $_.ExecutablePath -eq $Path } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}

function Stop-ManagedHelper {
    try { $health=Invoke-RestMethod 'http://127.0.0.1:19643/health' -TimeoutSec 2 }
    catch [Net.WebException] { return }
    if ($health.app -ne 'ivLyricsHangul') { throw (Get-Text '가사 도우미 포트를 다른 앱이 사용하고 있습니다.' 'Another app is using the lyrics helper port.') }
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$health.pid)
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains((Join-Path $root 'bridge.py'))) {
        Stop-Process -Id $health.pid
        Wait-Process -Id $health.pid -Timeout 10 -ErrorAction SilentlyContinue
    }
}

function Invoke-Cli([string[]]$Arguments) {
    $saved=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        & $cli @Arguments 2>&1 | Out-File -LiteralPath (Join-Path $root 'install.log') -Encoding UTF8 -Append
        $code=$LASTEXITCODE
    } finally { $ErrorActionPreference=$saved }
    if ($code -ne 0) { throw ((Get-Text 'Spicetify 적용에 실패했습니다. install.log를 확인해 주세요: ' 'Applying Spicetify failed. Check install.log: ')+($Arguments -join ' ')) }
}

function Invoke-SpotXPatch([string]$Script,[string]$StagingDirectory) {
    $log=Join-Path $root 'spotx-install.log'
    # Under Stop the first stderr line of the child becomes the exception and the rest of its error is lost.
    $saved=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        & $powershell -NoProfile -ExecutionPolicy Bypass -File $Script -StagingDirectory $StagingDirectory 2>&1 | Out-File -LiteralPath $log -Encoding UTF8
        $code=$LASTEXITCODE
    } finally { $ErrorActionPreference=$saved }
    # Reporters send failure.txt first, so carry the end of the log into it.
    if ($code -ne 0) { throw ((Get-Text 'SpotX 적용에 실패했습니다. spotx-install.log를 확인해 주세요.' 'Applying SpotX failed. Check spotx-install.log.')+"`r`n--- spotx-install.log ---`r`n"+(@(Get-Content -LiteralPath $log -Tail 40) -join "`r`n")) }
}

function Test-SpotifyInstaller([string]$Path) {
    if ((Get-Item -LiteralPath $Path).Length -ne $components.spotify.bytes) { throw (Get-Text 'Spotify 설치 파일 크기가 다릅니다. 실행을 중단합니다.' 'The Spotify installer has an unexpected file size. Stopping.') }
    if ((Get-Sha256 $Path) -ne $components.spotify.sha256) {
        throw (Get-Text 'Spotify 설치 파일의 SHA-256이 검증 버전과 다릅니다. 새 통합 설치본이 필요합니다.' 'The SHA-256 of the Spotify installer differs from the verified version. A new integrated installer is needed.')
    }
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    $signature=Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Spotify AB(,|$)') {
        throw (Get-Text 'Spotify AB의 유효한 서명을 확인하지 못해 실행을 중단합니다.' 'Could not verify a valid Spotify AB signature. Stopping.')
    }
}

function Get-Sha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Assert-CombinedClient {
    $ui=Join-Path $client 'Apps\xpui\xpui.js'
    if (-not (Test-Path -LiteralPath $ui)) { throw (Get-Text 'Spotify 화면 파일을 찾지 못했습니다.' 'The Spotify UI file was not found.') }
    $text=[IO.File]::ReadAllText($ui)
    if ($text -notmatch 'patched by spotx' -or $text -notmatch 'spicetify') { throw (Get-Text 'SpotX와 Spicetify의 동시 적용을 확인하지 못했습니다.' 'Could not confirm that SpotX and Spicetify are both applied.') }
    foreach ($file in @('Apps\xpui\extensions\hangul-lyrics.js','Apps\xpui\spicetify-routes-ivLyrics.js','Apps\xpui\extensions\ivLyrics\Addon_AI_LocalModel.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $client $file))) { throw ((Get-Text '가사 구성 파일 누락: ' 'Missing lyrics component file: ')+$file) }
    }
}

function Get-ManagedApplyArguments([string]$ClientPath,[string]$ConfigPath,[string]$CliVersion,[bool]$RebuildState) {
    if (@(Get-ChildItem -LiteralPath (Join-Path $ClientPath 'Apps') -Filter '*.spa' -File).Count) { return @('-n','backup','apply') }
    $section=''
    $preparedWith=''
    foreach ($line in Get-Content -LiteralPath $ConfigPath) {
        if ($line -match '^\s*\[([^]]+)\]') { $section=$Matches[1]; continue }
        if ($section -eq 'Backup' -and $line -match '^\s*with\s*=\s*(\S+)') { $preparedWith=$Matches[1] }
    }
    if ($RebuildState -or $preparedWith -ne $CliVersion) { return @('-n','restore','backup','apply') }
    return @('-n','apply')
}

try {
    Assert-AppDirectory
    if ($Mode -eq 'Prepare') {
        Stop-ManagedHelper
        [void](New-Item -ItemType Directory -Path $root -Force)
        if (-not (Test-Path -LiteralPath $marker)) { '{"app":"SpotifyHangul","prepared":true}' | Set-Content -LiteralPath $marker -Encoding UTF8 }
        $shortcut=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Spotify 한글 가사.lnk'
        $savedShortcut=Join-Path $root 'backup\desktop.managed-before.lnk'
        if (-not (Test-Path -LiteralPath $statePath) -and (Test-Path -LiteralPath $shortcut) -and -not (Test-Path -LiteralPath $savedShortcut)) {
            [void](New-Item -ItemType Directory -Path (Split-Path -Parent $savedShortcut) -Force)
            Copy-Item -LiteralPath $shortcut -Destination $savedShortcut
        }
        exit 0
    }
    if (Test-Path -LiteralPath $statePath) { $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
    if ($Mode -eq 'Uninstall') {
        if (-not $state -or -not $state.ManagedClient) { throw (Get-Text '통합 설치 기록을 찾지 못했습니다.' 'The integrated installation record was not found.') }
        $legacyHook=Join-Path $root 'installer\integrate.ps1'
        Stop-ManagedHelper
        Stop-ExactSpotify (Join-Path $client 'Spotify.exe')
        $overlayHelper=Join-Path $root 'installer\desktop-overlay.ps1'
        if (Test-Path -LiteralPath $overlayHelper) { . $overlayHelper; Stop-BundledDesktopOverlay -InstallRoot $root }
        $autostartHelper=Join-Path $root 'installer\autostart.ps1'
        if (Test-Path -LiteralPath $autostartHelper) { . $autostartHelper; Restore-SpotifyAutostart $root $state.PreviousSpotifyExe }
        if (Test-Path -LiteralPath (Join-Path $root 'legacy-install-state.json')) {
            & $powershell -NoProfile -ExecutionPolicy Bypass -File $legacyHook -Mode Uninstall -InstallRoot $root -StateFile 'legacy-install-state.json'
            if ($LASTEXITCODE -ne 0) { throw (Get-Text '기존 버전의 연결 해제에 실패했습니다.' 'Disconnecting the previous version failed.') }
        }
        $desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Spotify 한글 가사.lnk'
        if (Test-Path -LiteralPath $desktop) {
            $shell=New-Object -ComObject WScript.Shell
            if ($shell.CreateShortcut($desktop).Arguments.Contains((Join-Path $root 'start.ps1'))) {
                $savedShortcut=Join-Path $root 'backup\desktop.managed-before.lnk'
                if (Test-Path -LiteralPath $savedShortcut) { Copy-Item -LiteralPath $savedShortcut -Destination $desktop -Force }
                else { Remove-Item -LiteralPath $desktop }
            }
        }
        exit 0
    }
    # NSIS runs Prepare from a temporary folder containing only this script.
    # Load installation helpers only after the complete payload is extracted.
    . (Join-Path $root 'installer\managed-ivlyrics.ps1')
    Assert-OwnedChild $client
    Assert-OwnedChild $config
    Assert-OwnedChild $preprocessState
    $components=(Get-Content -LiteralPath (Join-Path $root 'components.json') -Raw | ConvertFrom-Json).components
    $reuse=(Test-Path -LiteralPath (Join-Path $client 'spotx-hangul.json'))
    if ($reuse) {
        $identity=Get-Content -LiteralPath (Join-Path $client 'spotx-hangul.json') -Raw | ConvertFrom-Json
        $reuse=$identity.App -eq 'SpotifyHangul' -and $identity.SpotifyVersion -eq $components.spotify.version -and
            $identity.SpotXRevision -eq $components.spotx.revision
    }
    # Older releases isolated config only; Spicetify's state still used APPDATA.
    # Rebuild once from verified, SpotX-patched stock files rather than trusting
    # another client's shared Backup/Extracted directories.
    $rebuildState=$reuse -and -not (Test-Path -LiteralPath (Join-Path $preprocessState 'xpui.spa'))
    if (-not $reuse -or $rebuildState) {
        if (-not $reuse -and (Test-Path -LiteralPath $client) -and @(Get-ChildItem -LiteralPath $client -Force).Count) { throw (Get-Text '기존 Spotify 하위 폴더의 소유권을 확인하지 못했습니다.' 'Could not confirm ownership of the existing Spotify subfolder.') }
        $stage=Join-Path $root ('.client-stage-'+[Guid]::NewGuid().ToString('N'))
        [void](New-Item -ItemType Directory -Path $stage)
        $download=Join-Path $stage 'SpotifySetup.exe'
        if ($InstallerFile) { Copy-Item -LiteralPath $InstallerFile -Destination $download }
        else {
            Write-Output (Get-Text '공식 Spotify x64 설치 파일을 내려받습니다. 약 150 MB가 필요합니다.' 'Downloading the official Spotify x64 installer. About 150 MB is needed.')
            [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $ProgressPreference='SilentlyContinue'
            Invoke-WebRequest -Uri $components.spotify.url -OutFile $download -UseBasicParsing -TimeoutSec 180
        }
        Test-SpotifyInstaller $download
        $extract=Join-Path $stage 'client'
        $process=Start-Process -FilePath $download -ArgumentList ('/extract "'+$extract+'"') -WindowStyle Hidden -PassThru
        if (-not $process.WaitForExit(120000)) { $process.Kill(); throw (Get-Text 'Spotify 파일 추출 시간이 초과되었습니다.' 'Extracting the Spotify files timed out.') }
        if ($process.ExitCode -ne 0) { throw ((Get-Text 'Spotify 파일 추출 실패: ' 'Extracting the Spotify files failed: ')+$process.ExitCode) }
        'SpotifyHangul isolated client' | Set-Content -LiteralPath (Join-Path $extract '.spotify-hangul-stage') -Encoding UTF8
        Invoke-SpotXPatch (Join-Path $root 'installer\spotx-patch.ps1') $extract
        if ($reuse) { $stockApps=Join-Path $extract 'Apps' }
        else {
            if (Test-Path -LiteralPath $client) { Remove-Item -LiteralPath $client }
            Move-Item -LiteralPath $extract -Destination $client
        }
    }
    if ($state -and -not $state.ManagedClient) {
        if (-not (Test-Path -LiteralPath (Join-Path $root 'legacy-install-state.json'))) { Copy-Item -LiteralPath $statePath -Destination (Join-Path $root 'legacy-install-state.json') }
    }
    # Keep customizations but give the managed client its own backup/extraction
    # folders. A shared Spicetify backup could otherwise erase SpotX changes.
    if (-not (Test-Path -LiteralPath $config)) {
        [void](New-Item -ItemType Directory -Path $config)
        $existing=if ($env:SPICETIFY_CONFIG) { $env:SPICETIFY_CONFIG } else { Join-Path $env:APPDATA 'spicetify' }
        foreach ($name in @('config-xpui.ini','Extensions','CustomApps','Themes')) {
            $from=Join-Path $existing $name
            if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination (Join-Path $config $name) -Recurse }
        }
    }
    $attemptConfig=Join-Path $root ('.config-attempt-'+[Guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $config -Destination $attemptConfig -Recurse
    $preprocessExisted=Test-Path -LiteralPath $preprocessState
    if ($preprocessExisted) {
        $attemptPreprocess=Join-Path $root ('.preprocess-attempt-'+[Guid]::NewGuid().ToString('N'))
        Copy-Item -LiteralPath $preprocessState -Destination $attemptPreprocess -Recurse
    }
    if ($reuse) {
        Stop-ExactSpotify (Join-Path $client 'Spotify.exe')
        $attemptApps=Join-Path $root ('.apps-attempt-'+[Guid]::NewGuid().ToString('N'))
        Copy-Item -LiteralPath (Join-Path $client 'Apps') -Destination $attemptApps -Recurse
    }
    $env:SPICETIFY_CONFIG=$config
    $env:SPICETIFY_STATE=$preprocessState
    $preprocessTouched=$true
    [void](New-Item -ItemType Directory -Path $preprocessState -Force)
    if ($stockApps) {
        Get-ChildItem -LiteralPath $stockApps -Filter '*.spa' -File | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $preprocessState $_.Name) -Force
        }
    }
    $prefs=Join-Path $root 'client.prefs'
    ('app.last-launched-version="'+$components.spotify.version+'"') | Set-Content -LiteralPath $prefs -Encoding ASCII
    & (Join-Path $root 'runtime\python.exe') -I -B -c 'import sys,pykakasi,phonetics; assert sys.flags.isolated == 1; assert phonetics.japanese_to_hangul(chr(0x9752)+chr(0x3044)+chr(0x7a7a),pykakasi.kakasi())'
    if ($LASTEXITCODE -ne 0) { throw (Get-Text '내장 Python과 발음 사전 검사에 실패했습니다.' 'The bundled Python and pronunciation dictionary check failed.') }
    Invoke-Cli @('config','spotify_path',$client,'prefs_path',$prefs)
    [void](New-Item -ItemType Directory -Path (Join-Path $config 'Extensions'),(Join-Path $config 'CustomApps') -Force)
    $ivLyricsTransaction=Install-ManagedIvLyrics $root $config
    Copy-Item -LiteralPath (Join-Path $root 'hangul-lyrics.js') -Destination (Join-Path $config 'Extensions\hangul-lyrics.js') -Force
    Invoke-Cli @('config','custom_apps','ivLyrics','extensions','hangul-lyrics.js')
    if (Test-Path -LiteralPath (Join-Path $root 'youtube-links.js')) {
        foreach ($asset in @('youtube-player.html','youtube-ivlyrics.js','youtube-library.js','youtube-overlay-controls.js','youtube-desktop-bridge.js','youtube_stream.py','playlist_files.py','playback_control.py','messages.py')) {
            if (-not (Test-Path -LiteralPath (Join-Path $root $asset))) { throw ((Get-Text 'YouTube 연결 파일이 없습니다: ' 'A YouTube link file is missing: ')+$asset) }
        }
        Copy-Item -LiteralPath (Join-Path $root 'youtube-links.js') -Destination (Join-Path $config 'Extensions\youtube-links.js') -Force
        Invoke-Cli @('config','extensions','youtube-links.js')
    }
    Stop-ExactSpotify (Join-Path $client 'Spotify.exe')
    Invoke-Cli (Get-ManagedApplyArguments $client (Join-Path $config 'config-xpui.ini') $components.spicetify.version $rebuildState)
    Assert-CombinedClient
    $release=Get-Content -LiteralPath (Join-Path $root 'release.json') -Raw | ConvertFrom-Json
    [PSCustomObject]@{ App='SpotifyHangul'; ManagedClient=$true; Version=$release.version; SpotifyExe=(Join-Path $client 'Spotify.exe'); ConfigRoot=$config;
        PreviousSpotifyExe=if ($state -and $state.ManagedClient) { $state.PreviousSpotifyExe } elseif ($state) { $state.SpotifyExe } else { Join-Path $env:APPDATA 'Spotify\Spotify.exe' } } |
        ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    Write-Output (Get-Text 'Spotify, SpotX, Spicetify와 한글 가사 설치를 완료했습니다.' 'Spotify, SpotX, Spicetify and Hangul lyrics are installed.')
} catch {
    $message=$_.Exception.Message
    if ((Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).app -eq 'SpotifyHangul')) {
        ('[bootstrap '+$Mode+'] '+$message+"`r`n"+$_.InvocationInfo.PositionMessage+"`r`n"+$_.ScriptStackTrace) |
            Out-File -LiteralPath (Join-Path $root 'install.log') -Encoding UTF8 -Append
    }
    if ($ivLyricsTransaction) { Undo-ManagedIvLyrics $ivLyricsTransaction }
    if ($attemptConfig -and (Test-Path -LiteralPath $attemptConfig)) {
        Assert-OwnedChild $config
        Remove-Item -LiteralPath $config -Recurse -Force
        Move-Item -LiteralPath $attemptConfig -Destination $config
        $attemptConfig=$null
    }
    if ($attemptApps -and (Test-Path -LiteralPath $attemptApps)) {
        $apps=Join-Path $client 'Apps'
        Assert-OwnedChild $apps
        Remove-Item -LiteralPath $apps -Recurse -Force
        Move-Item -LiteralPath $attemptApps -Destination $apps
        $attemptApps=$null
    }
    if ($preprocessTouched) {
        Assert-OwnedChild $preprocessState
        if (Test-Path -LiteralPath $preprocessState) { Remove-Item -LiteralPath $preprocessState -Recurse -Force }
        if ($attemptPreprocess -and (Test-Path -LiteralPath $attemptPreprocess)) {
            Move-Item -LiteralPath $attemptPreprocess -Destination $preprocessState
            $attemptPreprocess=$null
        }
    }
    # Newly assembled files are retained for diagnosis; no existing Spotify
    # executable, account preferences or public cache has been overwritten.
    Write-Error $message -ErrorAction Continue
    exit 1
} finally {
    foreach ($temporary in @($stage,$attemptConfig,$attemptApps,$attemptPreprocess)) {
        if ($temporary -and (Test-Path -LiteralPath $temporary)) { Assert-OwnedChild $temporary; Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
}
