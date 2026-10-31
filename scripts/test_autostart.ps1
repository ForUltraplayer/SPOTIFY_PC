# @file test_autostart.ps1
# @brief Validate which Spotify autostart values are taken over and handed back, without touching the registry.
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
. (Join-Path $project 'installer\autostart.ps1')
$root=Join-Path $project 'work\autostart-unit\SpotifyHangul'
$managed=Join-Path $root 'Spotify\Spotify.exe'
# A private APPDATA, so whether this PC has the original client does not change the results.
$env:APPDATA=Join-Path $project 'work\autostart-unit\AppData'
$original=Join-Path $env:APPDATA 'Spotify\Spotify.exe'
if (Test-Path -LiteralPath $original) { Remove-Item -LiteralPath $original }
$clients=@($managed,$null,$original)
$script:passed=0
function Expect($Actual,$Expected,[string]$Case) {
    if ($Actual -cne $Expected) { throw "${Case}: expected [$Expected] got [$Actual]" }
    $script:passed++
}
$minimized=Get-AutostartLauncher $root 'Minimized'
$normal=Get-AutostartLauncher $root 'Normal'
if ($minimized -notmatch '-File "[^"]+\\start\.ps1" -Autostart Minimized$' -or $minimized -notmatch '^"[^"]+\\conhost\.exe" --headless ') { throw "Unexpected launcher: $minimized" }

# Spotify's own values for the original and the integrated client are taken over, keeping the window mode.
Expect (Resolve-SpotifyAutostart ('"'+$original+'" --autostart --minimized') $clients $root) $minimized 'original minimized'
Expect (Resolve-SpotifyAutostart ('"'+$original+'" --autostart') $clients $root) $normal 'original normal'
Expect (Resolve-SpotifyAutostart ('"'+$managed+'" --autostart --minimized') $clients $root) $minimized 'integrated client'
Expect (Resolve-SpotifyAutostart ('"'+$original.ToUpperInvariant()+'" --autostart --minimized') $clients $root) $minimized 'path case'
# Anything else stays the user's: no value, already this launcher, other programs, other Spotify copies, extra options.
Expect (Resolve-SpotifyAutostart $null $clients $root) $null 'absent value is never created'
Expect (Resolve-SpotifyAutostart '' $clients $root) $null 'empty value'
Expect (Resolve-SpotifyAutostart $minimized $clients $root) $null 'already this launcher'
Expect (Resolve-SpotifyAutostart ('"'+(Join-Path $root '..\Other\Spotify.exe')+'" --autostart') $clients $root) $null 'unknown Spotify copy'
Expect (Resolve-SpotifyAutostart ('"'+$original+'" --autostart --minimized --extra') $clients $root) $null 'unknown option'
Expect (Resolve-SpotifyAutostart ('"C:\Tools\other.exe" --autostart') $clients $root) $null 'other program'
Expect (Resolve-SpotifyAutostart ($original+' --autostart') $clients $root) $null 'unquoted path'
$wideRoot=Join-Path $project ('work\autostart-unit\한글 공백\'+('x'*150))
Expect (Resolve-SpotifyAutostart ('"'+$original+'" --autostart') $clients $wideRoot) $null 'over the 260 character Run limit'
$koreanRoot=Join-Path $project 'work\autostart-unit\한글 공백'
Expect (Resolve-SpotifyAutostart ('"'+$original+'" --autostart') $clients $koreanRoot) (Get-AutostartLauncher $koreanRoot 'Normal') 'Korean folder with spaces'

# Uninstall hands back only this installation's launcher.
$present=Join-Path $project 'scripts\test_autostart.ps1'
$result=Resolve-UninstalledAutostart $minimized $root $present
Expect $result.Action 'Set' 'restore action'; Expect $result.Value ('"'+$present+'" --autostart --minimized') 'restore minimized'
Expect (Resolve-UninstalledAutostart $normal $root $present).Value ('"'+$present+'" --autostart') 'restore normal'
Expect (Resolve-UninstalledAutostart $minimized $root (Join-Path $root 'missing\Spotify.exe')).Action 'Delete' 'missing previous client'
Expect (Resolve-UninstalledAutostart $minimized $root $null).Action 'Delete' 'no previous client'
[void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $original)); Set-Content -LiteralPath $original -Value 'fixture'
Expect (Resolve-UninstalledAutostart $minimized $root (Join-Path $root 'missing\Spotify.exe')).Value ('"'+$original+'" --autostart --minimized') 'previous path gone, default original client present'
Remove-Item -LiteralPath $original
Expect (Resolve-UninstalledAutostart ('"'+$original+'" --autostart') $root $present).Action 'Keep' 'user changed the value'
Expect (Resolve-UninstalledAutostart (Get-AutostartLauncher $koreanRoot 'Minimized') $root $present).Action 'Keep' 'other installation'
Expect (Resolve-UninstalledAutostart $null $root $present).Action 'Keep' 'value removed by the user'

# The starter forwards Spotify's autostart switches only when it was started by the login value.
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'start.ps1'),[ref]$null,[ref]$errors)
if ($errors.Count) { throw 'Starter parsing failed.' }
$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$spotifyArguments'},$true)
foreach ($case in @(@('',''),@('Normal','--autostart'),@('Minimized','--autostart --minimized'))) {
    $Autostart=$case[0]
    $spotifyArguments=$null
    Invoke-Expression $assignment.Extent.Text
    Expect ($spotifyArguments -join ' ') $case[1] ('Spotify arguments for '+$(if ($case[0]) { $case[0] } else { 'shortcut' }))
}
[PSCustomObject]@{tests=$script:passed;absentValueNeverCreated=$true;foreignValuesKept=$true;registryUntouched=$true} | ConvertTo-Json
