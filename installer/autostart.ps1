# @file autostart.ps1
# @brief Point Spotify's own login autostart value at the Hangul launcher, and hand it back on uninstall.

# Spotify keeps its login autostart in HKCU Run "Spotify" as "<Spotify.exe>" --autostart [--minimized].
# Rewriting that same value, instead of adding another, keeps Spotify's in-app switch and the Windows
# Startup apps switch (StartupApproved\Run\Spotify) in charge, and never creates an autostart the user did not have.
$script:AutostartKey='Software\Microsoft\Windows\CurrentVersion\Run'
$script:SpotifyAutostart='^\s*"([^"]+\\Spotify\.exe)"\s+--autostart(\s+--minimized)?\s*$'

function Get-AutostartLauncher([string]$Root,[string]$Mode) {
    # Abbreviated switches: Windows documents 260 characters as the limit of a Run command.
    $system=Join-Path $env:SystemRoot 'System32'
    '"'+(Join-Path $system 'conhost.exe')+'" --headless "'+(Join-Path $system 'WindowsPowerShell\v1.0\powershell.exe')+
        '" -NoP -EP Bypass -W Hidden -File "'+(Join-Path ([IO.Path]::GetFullPath($Root).TrimEnd('\')) 'start.ps1')+'" -Autostart '+$Mode
}

function Resolve-SpotifyAutostart($Current,[string[]]$Clients,[string]$Root) {
    # The launcher that replaces a Spotify value pointing at one of $Clients; $null leaves the value alone.
    if (-not $Current) { return $null }
    $match=[regex]::Match([string]$Current,$script:SpotifyAutostart,'IgnoreCase')
    if (-not $match.Success) { return $null }
    $path=[IO.Path]::GetFullPath($match.Groups[1].Value)
    if (-not @($Clients | Where-Object { $_ -and [IO.Path]::GetFullPath($_) -ieq $path }).Count) { return $null }
    $launcher=Get-AutostartLauncher $Root $(if ($match.Groups[2].Success) { 'Minimized' } else { 'Normal' })
    if ($launcher.Length -gt 260) { return $null }
    return $launcher
}

function Resolve-UninstalledAutostart($Current,[string]$Root,[string]$Previous) {
    # Only this installation's launcher is handed back: to the previous client, else the default original client,
    # while one exists; otherwise it is removed.
    foreach ($mode in 'Minimized','Normal') {
        if ([string]$Current -cne (Get-AutostartLauncher $Root $mode)) { continue }
        $client=@($Previous,(Join-Path $env:APPDATA 'Spotify\Spotify.exe')) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
        if ($client) {
            return [PSCustomObject]@{Action='Set';Value=('"'+$client+'" --autostart'+$(if ($mode -eq 'Minimized') { ' --minimized' } else { '' }))}
        }
        return [PSCustomObject]@{Action='Delete';Value=$null}
    }
    return [PSCustomObject]@{Action='Keep';Value=$null}
}

function Read-SpotifyAutostart {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($script:AutostartKey)
    if (-not $key) { return $null }
    try { return $key.GetValue('Spotify',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Dispose() }
}

function Update-SpotifyAutostart([string]$Root,[string[]]$Clients) {
    $launcher=Resolve-SpotifyAutostart (Read-SpotifyAutostart) $Clients $Root
    if (-not $launcher) { return }
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($script:AutostartKey,$true)
    try { $key.SetValue('Spotify',$launcher,[Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
}

function Restore-SpotifyAutostart([string]$Root,[string]$Previous) {
    $result=Resolve-UninstalledAutostart (Read-SpotifyAutostart) $Root $Previous
    if ($result.Action -eq 'Keep') { return }
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($script:AutostartKey,$true)
    try {
        if ($result.Action -eq 'Set') { $key.SetValue('Spotify',$result.Value,[Microsoft.Win32.RegistryValueKind]::String) }
        else { $key.DeleteValue('Spotify',$false) }
    } finally { $key.Dispose() }
}
