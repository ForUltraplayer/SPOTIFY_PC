# @file auto-update.ps1
# @brief Check the project GitHub releases, ask before updating, and install verified releases with visible progress.
# Check without -Interactive (startup background check, -Manual) asks the user and installs right away;
# -Interactive (Update.exe) and ApplyPending keep the silent download-then-install path.
param([ValidateSet('Check','ApplyPending')][string]$Mode='Check',
      [Parameter(Mandatory=$true)][string]$InstallRoot,
      [switch]$IgnoreInterval,
      [switch]$Interactive,
      [switch]$Manual,
      [string]$ErrorFile,
      [version]$RequestedVersion='0.0.0')
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$lock=$null
$applyLock=$null
$cache=$null
$window=$null
# Background checks stay silent on failure; a person who asked (manual check, or 예 on the prompt) sees the reason.
$notify=$false
$prompted=$Mode -eq 'Check' -and -not $Interactive
$previousProcessDirectory=[Environment]::CurrentDirectory
$previousLocation=Get-Location
# Korean on Korean Windows, English elsewhere; SPOTIFYHANGUL_LANGUAGE (ko or en) overrides it for tests.
$useKorean=if ($env:SPOTIFYHANGUL_LANGUAGE) { $env:SPOTIFYHANGUL_LANGUAGE -eq 'ko' } else { (Get-UICulture).TwoLetterISOLanguageName -eq 'ko' }

function Get-Text([string]$Korean,[string]$English) { if ($useKorean) { return $Korean }; return $English }

function Get-Sha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Assert-Installation {
    $marker=Join-Path $root 'install-marker.json'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json).app -ne 'SpotifyHangul') {
        throw (Get-Text 'Spotify 한글 가사 설치 폴더를 확인하지 못했습니다.' 'Could not confirm the Spotify Hangul Lyrics installation folder.')
    }
    $forbidden=@([IO.Path]::GetPathRoot($root).TrimEnd('\'),$env:USERPROFILE,$env:LOCALAPPDATA,$env:APPDATA,$env:SystemRoot,$env:ProgramFiles)
    if ($forbidden -contains $root -or (Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw (Get-Text '업데이트 대상 경로가 올바르지 않습니다.' 'The update target folder is not valid.')
    }
}

function Get-InstalledVersion {
    $installation=Join-Path $root 'install-state.json'
    if (Test-Path -LiteralPath $installation) {
        $record=Get-Content -LiteralPath $installation -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($record.Version -match '^\d+\.\d+\.\d+$') { return [version]$record.Version }
    }
    $registered=(Get-ItemProperty -LiteralPath 'HKCU:\Software\SpotifyHangul' -ErrorAction SilentlyContinue).InstallDir
    if ($registered -and [IO.Path]::GetFullPath($registered).TrimEnd('\') -eq $root) {
        $version=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul' -ErrorAction SilentlyContinue).DisplayVersion
        if ($version -match '^\d+\.\d+\.\d+$') { return [version]$version }
    }
    return [version](Get-Content -LiteralPath (Join-Path $root 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

# A repository rename keeps the owner, so any repository name under it is accepted.
function Test-ReleaseDownloadUrl([string]$Url,[string]$Version,[string]$Name) {
    return $Url -cmatch ('^https://github\.com/ForUltraplayer/[A-Za-z0-9._-]+/releases/download/v'+[regex]::Escape($Version)+'/'+[regex]::Escape($Name)+'$')
}

function Select-UpdateAsset($Releases,[version]$CurrentVersion) {
    $candidates=@(foreach ($release in $Releases) {
        if ($release.draft -or $release.prerelease -or [string]$release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { continue }
        $version=$Matches[1]
        if ([version]$version -le $CurrentVersion) { continue }
        $name='SpotifyHangul-'+$version+'-Setup.exe'
        $asset=$release.assets | Where-Object { $_.name -ceq $name -and (Test-ReleaseDownloadUrl $_.browser_download_url $version $name) } | Select-Object -First 1
        if (-not $asset -or $asset.digest -notmatch '^sha256:([a-fA-F0-9]{64})$' -or $asset.size -lt 1MB -or $asset.size -gt 250MB) { continue }
        [PSCustomObject]@{app='SpotifyHangul';version=$version;name=$name;url=[string]$asset.browser_download_url;sha256=$Matches[1].ToLowerInvariant();size=[long]$asset.size}
    })
    return $candidates | Sort-Object { [version]$_.version } -Descending | Select-Object -First 1
}

function Test-QueuedInstaller($Pending,[version]$CurrentVersion) {
    if ($Pending.app -ne 'SpotifyHangul' -or $Pending.root -cne $root -or $Pending.version -notmatch '^\d+\.\d+\.\d+$' -or [version]$Pending.version -le $CurrentVersion) { return $false }
    $name='SpotifyHangul-'+$Pending.version+'-Setup.exe'
    if ($Pending.name -cne $name -or -not (Test-ReleaseDownloadUrl $Pending.url $Pending.version $name) -or $Pending.sha256 -notmatch '^[a-f0-9]{64}$' -or $Pending.size -lt 1MB -or $Pending.size -gt 250MB) { return $false }
    $file=Join-Path $cache $name
    if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -ne $Pending.size) { return $false }
    if ((Get-Sha256 $file) -cne $Pending.sha256) { return $false }
    return (Get-Item -LiteralPath $file).VersionInfo.FileVersion -eq $Pending.version
}

function Write-UpdateState($Value) {
    $temporary=Join-Path $cache 'state.tmp'
    $Value | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination (Join-Path $cache 'state.json') -Force
}

function Report-UpdateError([string]$Message) {
    Write-Warning $Message
    if ($ErrorFile) {
        try { [IO.File]::WriteAllText($ErrorFile,$Message,[Text.Encoding]::Unicode) } catch { }
    }
    if ($notify) { Show-UpdateMessage $Message -IsError }
}

function Complete-UpdateDownload($Asset,[string]$Temporary,[string]$File,[version]$CurrentVersion) {
    if ((Get-Item -LiteralPath $Temporary).Length -ne $Asset.size -or (Get-Sha256 $Temporary) -cne $Asset.sha256) {
        Remove-Item -LiteralPath $Temporary
        throw (Get-Text '다운로드한 업데이트의 크기 또는 SHA-256이 다릅니다.' 'The downloaded update does not match the published size or SHA-256.')
    }
    Move-Item -LiteralPath $Temporary -Destination $File -Force
    if (-not (Test-QueuedInstaller $Asset $CurrentVersion)) { throw (Get-Text '다운로드한 설치 파일의 제품 버전이 다릅니다.' 'The downloaded installer reports a different product version.') }
}

function Start-QueuedInstaller($Pending) {
    Write-UpdateState @{status='installing';version=$Pending.version;checked_at=(Get-Date -Format o)}
    $process=Start-Process -FilePath (Join-Path $cache $Pending.name) -ArgumentList ('/S /D='+$root) -WindowStyle Hidden -PassThru
    Write-UpdateState @{status='installing';version=$Pending.version;pid=$process.Id;checked_at=(Get-Date -Format o)}
    return $process
}

# Returns the failure message, or $null after a verified installation.
function Complete-QueuedInstaller($Pending,$Process) {
    if ($Process.ExitCode -ne 0 -or (Get-InstalledVersion) -ne [version]$Pending.version) {
        $message=(Get-Text '업데이트 설치가 실패했습니다. 설치 종료 코드: ' 'The update failed to install. Installer exit code: ')+$Process.ExitCode+(Get-Text '. 설치 로그: ' '. Installation log: ')+(Join-Path $root 'install.log')
        Write-UpdateState @{status='install-failed';version=$Pending.version;error=$message;installer_exit_code=$Process.ExitCode}
        return $message
    }
    Write-UpdateState @{status='installed';version=$Pending.version;checked_at=(Get-Date -Format o)}
    Remove-Item -LiteralPath $pendingPath
    return $null
}

try {
    $updateDirectory=[IO.Path]::GetTempPath()
    Set-Location -LiteralPath $updateDirectory
    [Environment]::CurrentDirectory=$updateDirectory
    # A test driver may predefine the window functions; production loads them from beside this script.
    if ($prompted -and $Manual) {
        if (-not (Get-Command Show-UpdatePrompt -CommandType Function -ErrorAction SilentlyContinue)) { . (Join-Path $PSScriptRoot 'update-ui.ps1') }
        $notify=$true
    }
    Assert-Installation
    $current=Get-InstalledVersion
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { $identity=[BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-','').Substring(0,16) }
    finally { $algorithm.Dispose() }
    $cache=Join-Path $env:LOCALAPPDATA ('ivLyricsHangul\updates\'+$identity)
    [void](New-Item -ItemType Directory -Path $cache -Force)
    if ((Get-Item -LiteralPath $cache).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw (Get-Text '업데이트 저장 폴더가 연결 경로입니다.' 'The update cache folder is a link.') }
    if ($Mode -eq 'ApplyPending') {
        try { $applyLock=[IO.File]::Open((Join-Path $cache 'apply.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
        catch [IO.IOException] { Report-UpdateError (Get-Text '다른 업데이트 적용 작업이 실행 중입니다. 해당 작업이 끝난 뒤 다시 실행해 주세요.' 'Another update is being applied. Run this again after it finishes.'); exit 10 }
    }
    try { $lock=[IO.File]::Open((Join-Path $cache 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch [IO.IOException] {
        if ($Interactive) { Report-UpdateError (Get-Text '다른 업데이트 확인 또는 다운로드가 진행 중입니다. 잠시 뒤 다시 실행해 주세요.' 'Another update check or download is in progress. Try again in a moment.'); exit 10 }
        # The lock is held while a prompt or progress window is open, so a second check never opens another one.
        if ($notify) { Show-UpdateMessage (Get-Text '이미 업데이트를 확인하고 있습니다. 열려 있는 업데이트 창을 확인해 주세요.' 'An update check is already running. Look for the open update window.'); exit 10 }
        exit 0
    }
    $pendingPath=Join-Path $cache 'pending.json'
    $pending=if (Test-Path -LiteralPath $pendingPath) { Get-Content -LiteralPath $pendingPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $statePath=Join-Path $cache 'state.json'
    $state=if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    if ($Mode -eq 'ApplyPending') {
        if (-not $pending) { exit 0 }
        if ([version]$pending.version -le $current) { Remove-Item -LiteralPath $pendingPath; exit 0 }
        if ($state.status -eq 'install-failed' -and $state.version -eq $pending.version -and -not $Interactive) { exit 0 }
        if ($state.status -eq 'installing') {
            $running=if ($state.pid) { Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$state.pid) } else { $null }
            if ($running -and $running.ExecutablePath -eq (Join-Path $cache $pending.name)) { Report-UpdateError (Get-Text '이전 설치 프로그램이 아직 실행 중입니다. 완료될 때까지 기다려 주세요.' 'The previous installer is still running. Wait for it to finish.'); exit 10 }
            if (-not $Interactive) {
                Write-UpdateState @{status='install-failed';version=$pending.version;error=(Get-Text '이전 설치가 중단되어 자동 재시도를 멈췄습니다.' 'The previous installation was interrupted, so automatic retries stopped.')}
                exit 0
            }
            # A reboot can leave an installing record without a process. The
            # interactive retry may recover it after validating the installer.
        }
        if (-not (Test-QueuedInstaller $pending $current)) { throw (Get-Text '예약된 업데이트의 버전 또는 해시가 올바르지 않습니다.' 'The queued update has an invalid version or hash.') }
        if (Get-Process -Name Spotify -ErrorAction SilentlyContinue) { Report-UpdateError (Get-Text 'Spotify 프로세스가 실행 중입니다. 작업 관리자에서 Spotify를 완전히 종료한 뒤 다시 실행해 주세요.' 'Spotify is still running. Close it completely in Task Manager, then run this again.'); exit 20 }
        $process=Start-QueuedInstaller $pending
        if (-not $process.WaitForExit(600000)) { Report-UpdateError (Get-Text '설치 프로그램이 제한 시간 안에 끝나지 않았습니다. 설치 창과 install.log를 확인해 주세요.' 'The installer did not finish in time. Check the installer window and install.log.'); exit 11 }
        $failure=Complete-QueuedInstaller $pending $process
        if ($failure) { Report-UpdateError $failure; if ($Interactive) { exit 1 }; exit 0 }
        Write-Output (Get-Text ('Spotify 한글 가사를 '+$pending.version+' 버전으로 업데이트했습니다.') ('Updated Spotify Hangul Lyrics to '+$pending.version+'.'))
        exit 0
    }
    if ($state.status -eq 'installing') {
        $running=if ($state.pid) { Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$state.pid) } else { $null }
        if ($pending -and $running -and $running.ExecutablePath -eq (Join-Path $cache $pending.name)) {
            if ($Interactive -or $notify) { Report-UpdateError (Get-Text '이전 설치 프로그램이 아직 실행 중입니다. 완료될 때까지 기다려 주세요.' 'The previous installer is still running. Wait for it to finish.'); exit 10 }
            exit 0
        }
        if (-not ($Interactive -or $notify)) { exit 0 }
    }
    if (-not ($IgnoreInterval -or $Manual) -and $state.checked_at -and (Get-Date) -lt ([DateTimeOffset]::Parse($state.checked_at).LocalDateTime.AddHours(4))) { exit 0 }
    [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # Look up the releases by repository ID, which a rename keeps.
    $releases=Invoke-RestMethod -Uri 'https://api.github.com/repositories/1433444843/releases?per_page=10' -Headers @{'User-Agent'='SpotifyHangul-Updater';'Accept'='application/vnd.github+json'} -TimeoutSec 15
    $asset=Select-UpdateAsset $releases $current
    if (-not $asset) {
        if ($pending -and [version]$pending.version -gt $current) {
            $message=(Get-Text ('대기 중인 '+$pending.version+' 업데이트가 공개 배포 목록에 없습니다. 철회된 파일의 실행을 중단했습니다. 비공개 검증본은 해당 Setup.exe를 직접 실행해 주세요.') ('The pending '+$pending.version+' update is no longer in the public releases, so the withdrawn file was not run. For a private test build, run its Setup.exe directly.'))
            $held=Join-Path $cache ('pending-withdrawn-'+[Guid]::NewGuid().ToString('N')+'.json')
            Move-Item -LiteralPath $pendingPath -Destination $held
            Write-UpdateState @{status='withdrawn';version=$pending.version;error=$message;checked_at=(Get-Date -Format o)}
            Report-UpdateError $message
            if ($Interactive) { exit 21 }; exit 0
        }
        if ($current -lt $RequestedVersion) {
            $message=(Get-Text ('요청한 '+$RequestedVersion+' 버전이 아직 공개되지 않았습니다. 비공개 검증본은 Setup.exe를 직접 실행해 주세요.') ('Version '+$RequestedVersion+' is not public yet. For a private test build, run its Setup.exe directly.'))
            Write-UpdateState @{status='unavailable';version=$RequestedVersion.ToString();error=$message;checked_at=(Get-Date -Format o)}
            Report-UpdateError $message
            if ($Interactive) { exit 22 }; exit 0
        }
        Write-UpdateState @{status='up-to-date';checked_at=(Get-Date -Format o)}
        if ($notify) { Show-UpdateMessage (Get-Text ('최신 버전입니다 ('+$current+')') ('You have the latest version ('+$current+')')) }
        exit 0
    }
    if ([version]$asset.version -lt $RequestedVersion) {
        Report-UpdateError (Get-Text ('요청한 '+$RequestedVersion+' 버전은 아직 공개되지 않았습니다. 더 이전 버전으로 대신 업데이트하지 않습니다. 비공개 검증본의 Setup.exe를 직접 실행해 주세요.') ('Version '+$RequestedVersion+' is not public yet, and an older version is not installed instead. For a private test build, run its Setup.exe directly.'))
        if ($Interactive) { exit 22 }; exit 0
    }
    # A failed installation is not retried by itself; Update.exe and the manual check may retry it.
    if (-not ($Interactive -or $notify) -and $state.status -eq 'install-failed' -and $state.version -eq $asset.version) {
        Write-UpdateState @{status='install-failed';version=$state.version;error=$state.error;checked_at=(Get-Date -Format o)}
        exit 0
    }
    $file=Join-Path $cache $asset.name
    $temporary=$file+'.download'
    $asset | Add-Member -NotePropertyName root -NotePropertyValue $root
    if ($Interactive) {
        if ($pending -and $pending.version -eq $asset.version -and $pending.sha256 -ceq $asset.sha256 -and
            $pending.size -eq $asset.size -and $pending.url -ceq $asset.url -and (Test-QueuedInstaller $pending $current)) {
            Write-UpdateState @{status='queued';version=$pending.version;checked_at=(Get-Date -Format o)}
            exit 0
        }
        $ProgressPreference='SilentlyContinue'
        Invoke-WebRequest -Uri $asset.url -OutFile $temporary -UseBasicParsing -TimeoutSec 180
        Complete-UpdateDownload $asset $temporary $file $current
        $asset | ConvertTo-Json | Set-Content -LiteralPath $pendingPath -Encoding UTF8
        Write-UpdateState @{status='queued';version=$asset.version;checked_at=(Get-Date -Format o)}
        Write-Output (Get-Text ('다음 실행 전에 적용할 '+$asset.version+' 업데이트를 내려받았습니다.') ('Downloaded the '+$asset.version+' update; it is applied before the next launch.'))
        exit 0
    }
    if (-not (Get-Command Show-UpdatePrompt -CommandType Function -ErrorAction SilentlyContinue)) { . (Join-Path $PSScriptRoot 'update-ui.ps1') }
    if (-not (Show-UpdatePrompt $asset.version $current.ToString())) {
        # 아니요: nothing now; the next check after the four-hour interval asks again.
        Write-UpdateState @{status='declined';version=$asset.version;checked_at=(Get-Date -Format o)}
        exit 0
    }
    $notify=$true
    $window=Open-UpdateWindow
    Set-UpdateWindow $window (Get-Text '업데이트를 준비하고 있습니다.' 'Preparing the update.')
    # Reuse an installer kept from an earlier attempt only if it still matches the published digest and version.
    if (-not ((Test-Path -LiteralPath $file) -and (Test-QueuedInstaller $asset $current))) {
        Set-UpdateWindow $window (Get-Text ('업데이트 파일(버전 '+$asset.version+")을 내려받고 있습니다.`r`n음악은 계속 들을 수 있습니다.") ('Downloading the update (version '+$asset.version+").`r`nYou can keep listening to music.")) 0 ('0.0 / {0:N1} MB (0%)' -f ($asset.size/1MB)) -AllowCancel
        $downloaded=$false
        # A cancelled or broken transfer leaves no partial file; only Complete-UpdateDownload promotes it.
        try { $downloaded=Save-UpdateDownload $window $asset.url $temporary $asset.size }
        finally { if (-not $downloaded) { Remove-Item -LiteralPath $temporary -ErrorAction SilentlyContinue } }
        if (-not $downloaded) { Write-UpdateState @{status='canceled';version=$asset.version;checked_at=(Get-Date -Format o)}; exit 0 }
        Set-UpdateWindow $window (Get-Text '내려받은 파일을 확인하고 있습니다.' 'Checking the downloaded file.')
        Complete-UpdateDownload $asset $temporary $file $current
    }
    Set-UpdateWindow $window (Get-Text "설치하려면 Spotify를 종료해야 합니다.`r`n잠시 뒤 Spotify가 닫히고 설치가 시작됩니다." "Spotify has to close for the installation.`r`nIt closes in a moment and the installation starts.") -AllowCancel
    if (Wait-UpdateWindow $window 4000) { Write-UpdateState @{status='canceled';version=$asset.version;checked_at=(Get-Date -Format o)}; exit 0 }
    Set-UpdateWindow $window (Get-Text 'Spotify를 종료하고 있습니다.' 'Closing Spotify.')
    # Ask like the window's close button first so Spotify can save its state; force only what remains.
    # The installer itself stops this installation's helper and overlay, so nothing else is closed here.
    foreach ($spotify in @(Get-Process -Name Spotify -ErrorAction SilentlyContinue)) { [void]$spotify.CloseMainWindow() }
    for ($attempt=0; $attempt -lt 20 -and @(Get-Process -Name Spotify -ErrorAction SilentlyContinue).Count; $attempt++) { [void](Wait-UpdateWindow $window 250) }
    $remaining=@(Get-Process -Name Spotify -ErrorAction SilentlyContinue)
    if ($remaining.Count) {
        # Spotify may be set to hide in the tray instead of closing.
        Stop-Process -Id $remaining.Id -Force -ErrorAction SilentlyContinue
        for ($attempt=0; $attempt -lt 20 -and @(Get-Process -Name Spotify -ErrorAction SilentlyContinue).Count; $attempt++) { [void](Wait-UpdateWindow $window 250) }
        if (@(Get-Process -Name Spotify -ErrorAction SilentlyContinue).Count) { throw (Get-Text 'Spotify를 종료하지 못했습니다. 작업 관리자에서 Spotify를 완전히 종료한 뒤 다시 시도해 주세요.' 'Could not close Spotify. Close it completely in Task Manager, then try again.') }
    }
    # Queue the verified installer first so an interrupted install leaves the pending/installing records ApplyPending already handles.
    $asset | ConvertTo-Json | Set-Content -LiteralPath $pendingPath -Encoding UTF8
    Set-UpdateWindow $window (Get-Text "업데이트를 설치하고 있습니다.`r`n창이 닫힐 때까지 기다려 주세요." "Installing the update.`r`nPlease wait until this window closes.")
    $process=Start-QueuedInstaller $asset
    $deadline=(Get-Date).AddMinutes(10)
    while (-not $process.WaitForExit(100)) {
        if ((Get-Date) -gt $deadline) {
            Close-UpdateWindow $window; $window=$null
            Report-UpdateError (Get-Text '설치 프로그램이 제한 시간 안에 끝나지 않았습니다. 설치가 끝난 뒤 Spotify 한글 가사를 다시 실행하고, 계속 실패하면 install.log를 확인해 주세요.' 'The installer did not finish in time. Start Spotify Hangul Lyrics again after it finishes, and check install.log if it keeps failing.')
            exit 11
        }
        [void](Wait-UpdateWindow $window 0)
    }
    $failure=Complete-QueuedInstaller $asset $process
    if ($failure) {
        Close-UpdateWindow $window; $window=$null
        # The installer's own rollback restores the previous files, so the old version is started again.
        Report-UpdateError ($failure+(Get-Text "`r`n`r`n설치 프로그램이 이전 버전 복구를 시도했습니다. 확인을 누르면 Spotify 한글 가사를 다시 실행합니다." "`r`n`r`nThe installer tried to restore the previous version. Press OK to start Spotify Hangul Lyrics again."))
    } else {
        Set-UpdateWindow $window (Get-Text ('버전 '+$asset.version+' 설치를 마쳤습니다. Spotify 한글 가사를 다시 실행합니다.') ('Version '+$asset.version+' is installed. Starting Spotify Hangul Lyrics again.')) 100
        [void](Wait-UpdateWindow $window 1500)
    }
    # Same command as the desktop shortcut: the helper and Spotify start from the new files.
    $nativePowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $headlessHost=Join-Path $env:SystemRoot 'System32\conhost.exe'
    $launch=@('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+(Join-Path $root 'start.ps1')+'"'))
    if (Test-Path -LiteralPath $headlessHost) { Start-Process -FilePath $headlessHost -ArgumentList (@('--headless',('"'+$nativePowerShell+'"'))+$launch) -WorkingDirectory $updateDirectory }
    else { Start-Process -FilePath $nativePowerShell -ArgumentList $launch -WorkingDirectory $updateDirectory -WindowStyle Hidden }
    if ($failure) { exit 1 }
    exit 0
} catch {
    $message=$_.Exception.Message
    if ($window) { Close-UpdateWindow $window; $window=$null }
    if ($cache) { try { Write-UpdateState @{status=if($Mode -eq 'ApplyPending'){'install-failed'}else{'check-failed'};checked_at=(Get-Date -Format o);error=$message} } catch {} }
    # Checking/downloading must never prevent music playback.
    Report-UpdateError $message
    if ($Interactive -or $notify) { exit 1 }
    exit 0
} finally {
    if ($window) { Close-UpdateWindow $window }
    if ($lock) { $lock.Dispose() }
    if ($applyLock) { $applyLock.Dispose() }
    try { if (Test-Path -LiteralPath $previousLocation.Path) { Set-Location -LiteralPath $previousLocation.Path } } catch { }
    try { if ([IO.Directory]::Exists($previousProcessDirectory)) { [Environment]::CurrentDirectory=$previousProcessDirectory } } catch { }
}
