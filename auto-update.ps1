# @file auto-update.ps1
# @author: ForUltraplayer
# @brief Download verified releases from the project GitHub repository and apply them before Spotify starts.
param([ValidateSet('Check','ApplyPending')][string]$Mode='Check',
      [Parameter(Mandatory=$true)][string]$InstallRoot,
      [switch]$IgnoreInterval,
      [switch]$Interactive)
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$lock=$null
$applyLock=$null
$cache=$null

function Get-Sha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Assert-Installation {
    $marker=Join-Path $root 'install-marker.json'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).app -ne 'SpotifyHangul') {
        throw 'Spotify 한글 가사 설치 폴더를 확인하지 못했습니다.'
    }
    $forbidden=@([IO.Path]::GetPathRoot($root).TrimEnd('\'),$env:USERPROFILE,$env:LOCALAPPDATA,$env:APPDATA,$env:SystemRoot,$env:ProgramFiles)
    if ($forbidden -contains $root -or (Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw '업데이트 대상 경로가 올바르지 않습니다.'
    }
}

function Get-InstalledVersion {
    $installation=Join-Path $root 'install-state.json'
    if (Test-Path -LiteralPath $installation) {
        $record=Get-Content -LiteralPath $installation -Raw | ConvertFrom-Json
        if ($record.Version -match '^\d+\.\d+\.\d+$') { return [version]$record.Version }
    }
    $registered=(Get-ItemProperty -LiteralPath 'HKCU:\Software\SpotifyHangul' -ErrorAction SilentlyContinue).InstallDir
    if ($registered -and [IO.Path]::GetFullPath($registered).TrimEnd('\') -eq $root) {
        $version=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SpotifyHangul' -ErrorAction SilentlyContinue).DisplayVersion
        if ($version -match '^\d+\.\d+\.\d+$') { return [version]$version }
    }
    return [version](Get-Content -LiteralPath (Join-Path $root 'release.json') -Raw | ConvertFrom-Json).version
}

function Select-UpdateAsset($Releases,[version]$CurrentVersion) {
    $candidates=@(foreach ($release in $Releases) {
        if ($release.draft -or [string]$release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { continue }
        $version=$Matches[1]
        if ([version]$version -le $CurrentVersion) { continue }
        $name='SpotifyHangul-'+$version+'-Setup.exe'
        $url='https://github.com/ForUltraplayer/SPOTIFY_PC/releases/download/v'+$version+'/'+$name
        $asset=$release.assets | Where-Object { $_.name -ceq $name -and $_.browser_download_url -ceq $url } | Select-Object -First 1
        if (-not $asset -or $asset.digest -notmatch '^sha256:([a-fA-F0-9]{64})$' -or $asset.size -lt 1MB -or $asset.size -gt 250MB) { continue }
        [PSCustomObject]@{app='SpotifyHangul';version=$version;name=$name;url=$url;sha256=$Matches[1].ToLowerInvariant();size=[long]$asset.size}
    })
    return $candidates | Sort-Object { [version]$_.version } -Descending | Select-Object -First 1
}

function Test-QueuedInstaller($Pending,[version]$CurrentVersion) {
    if ($Pending.app -ne 'SpotifyHangul' -or $Pending.root -cne $root -or $Pending.version -notmatch '^\d+\.\d+\.\d+$' -or [version]$Pending.version -le $CurrentVersion) { return $false }
    $name='SpotifyHangul-'+$Pending.version+'-Setup.exe'
    $url='https://github.com/ForUltraplayer/SPOTIFY_PC/releases/download/v'+$Pending.version+'/'+$name
    if ($Pending.name -cne $name -or $Pending.url -cne $url -or $Pending.sha256 -notmatch '^[a-f0-9]{64}$' -or $Pending.size -lt 1MB -or $Pending.size -gt 250MB) { return $false }
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

try {
    Assert-Installation
    $current=Get-InstalledVersion
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { $identity=[BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-','').Substring(0,16) }
    finally { $algorithm.Dispose() }
    $cache=Join-Path $env:LOCALAPPDATA ('ivLyricsHangul\updates\'+$identity)
    [void](New-Item -ItemType Directory -Path $cache -Force)
    if ((Get-Item -LiteralPath $cache).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '업데이트 저장 폴더가 연결 경로입니다.' }
    if ($Mode -eq 'ApplyPending') {
        try { $applyLock=[IO.File]::Open((Join-Path $cache 'apply.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
        catch [IO.IOException] { exit 10 }
    }
    try { $lock=[IO.File]::Open((Join-Path $cache 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch [IO.IOException] { if ($Interactive) { exit 10 }; exit 0 }
    $pendingPath=Join-Path $cache 'pending.json'
    $pending=if (Test-Path -LiteralPath $pendingPath) { Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json } else { $null }
    $statePath=Join-Path $cache 'state.json'
    $state=if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
    if ($Mode -eq 'ApplyPending') {
        if (-not $pending) { exit 0 }
        if ([version]$pending.version -le $current) { Remove-Item -LiteralPath $pendingPath; exit 0 }
        if ($state.status -eq 'install-failed' -and $state.version -eq $pending.version -and -not $Interactive) { exit 0 }
        if ($state.status -eq 'installing') {
            $running=if ($state.pid) { Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$state.pid) } else { $null }
            if ($running -and $running.ExecutablePath -eq (Join-Path $cache $pending.name)) { exit 10 }
            Write-UpdateState @{status='install-failed';version=$pending.version;error='이전 설치가 중단되어 자동 재시도를 멈췄습니다.'}
            if ($Interactive) { exit 1 }; exit 0
        }
        if (-not (Test-QueuedInstaller $pending $current)) { throw '예약된 업데이트의 버전 또는 해시가 올바르지 않습니다.' }
        if (Get-Process -Name Spotify -ErrorAction SilentlyContinue) { exit 20 }
        Write-UpdateState @{status='installing';version=$pending.version;checked_at=(Get-Date -Format o)}
        $process=Start-Process -FilePath (Join-Path $cache $pending.name) -ArgumentList ('/S /D='+$root) -WindowStyle Hidden -PassThru
        Write-UpdateState @{status='installing';version=$pending.version;pid=$process.Id;checked_at=(Get-Date -Format o)}
        if (-not $process.WaitForExit(600000)) { exit 10 }
        if ($process.ExitCode -ne 0 -or (Get-InstalledVersion) -ne [version]$pending.version) {
            Write-UpdateState @{status='install-failed';version=$pending.version;error=('설치 종료 코드: '+$process.ExitCode)}
            if ($Interactive) { exit 1 }; exit 0
        }
        Write-UpdateState @{status='installed';version=$pending.version;checked_at=(Get-Date -Format o)}
        Remove-Item -LiteralPath $pendingPath
        Write-Output ('Spotify 한글 가사를 '+$pending.version+' 버전으로 업데이트했습니다.')
        exit 0
    }
    if ($state.status -eq 'installing') { exit 0 }
    if (-not $IgnoreInterval -and $state.checked_at -and (Get-Date) -lt ([DateTimeOffset]::Parse($state.checked_at).LocalDateTime.AddHours(8))) { exit 0 }
    [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $releases=Invoke-RestMethod -Uri 'https://api.github.com/repos/ForUltraplayer/SPOTIFY_PC/releases?per_page=10' -Headers @{'User-Agent'='SpotifyHangul-Updater';'Accept'='application/vnd.github+json'} -TimeoutSec 15
    $asset=Select-UpdateAsset $releases $current
    if (-not $asset) { Write-UpdateState @{status='up-to-date';checked_at=(Get-Date -Format o)}; exit 0 }
    if (-not $Interactive -and $state.status -eq 'install-failed' -and $state.version -eq $asset.version) {
        Write-UpdateState @{status='install-failed';version=$state.version;error=$state.error;checked_at=(Get-Date -Format o)}
        exit 0
    }
    if ($pending -and $pending.version -eq $asset.version -and (Test-QueuedInstaller $pending $current)) {
        Write-UpdateState @{status='queued';version=$pending.version;checked_at=(Get-Date -Format o)}
        exit 0
    }
    $file=Join-Path $cache $asset.name
    $temporary=$file+'.download'
    $ProgressPreference='SilentlyContinue'
    Invoke-WebRequest -Uri $asset.url -OutFile $temporary -UseBasicParsing -TimeoutSec 180
    $asset | Add-Member -NotePropertyName root -NotePropertyValue $root
    if ((Get-Item -LiteralPath $temporary).Length -ne $asset.size -or (Get-Sha256 $temporary) -cne $asset.sha256) {
        Remove-Item -LiteralPath $temporary
        throw '다운로드한 업데이트의 크기 또는 SHA-256이 다릅니다.'
    }
    Move-Item -LiteralPath $temporary -Destination $file -Force
    if (-not (Test-QueuedInstaller $asset $current)) { throw '다운로드한 설치 파일의 제품 버전이 다릅니다.' }
    $asset | ConvertTo-Json | Set-Content -LiteralPath $pendingPath -Encoding UTF8
    Write-UpdateState @{status='queued';version=$asset.version;checked_at=(Get-Date -Format o)}
    Write-Output ('다음 실행 전에 적용할 '+$asset.version+' 업데이트를 내려받았습니다.')
} catch {
    if ($cache) { try { Write-UpdateState @{status='check-failed';checked_at=(Get-Date -Format o);error=$_.Exception.Message} } catch {} }
    # Checking/downloading must never prevent music playback.
    Write-Warning $_.Exception.Message
    if ($Interactive) { exit 1 }
    exit 0
} finally {
    if ($lock) { $lock.Dispose() }
    if ($applyLock) { $applyLock.Dispose() }
}
