# @file test_start.ps1
# @author: ForUltraplayer
# @brief Validate helper ownership and capability checks without starting or stopping any applications.
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'start.ps1'),[ref]$null,[ref]$errors)
if ($errors.Count) { throw 'Starter parsing failed.' }
$node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-HelperHealth'},$true)
if (-not $node) { throw 'Helper ownership guard missing.' }
Invoke-Expression $node.Extent.Text
$testRoot=Join-Path $project 'work\start-unit\한글 공백'
$bridge=Join-Path $testRoot 'bridge.py'
$python=Join-Path $testRoot 'runtime\pythonw.exe'
$script:mockProcess=[PSCustomObject]@{ExecutablePath=$python;CommandLine=('"'+$python+'" -u "'+$bridge+'"')}
function Get-CimInstance {
    param($ClassName,$Filter,$ErrorAction)
    if ($ClassName -ne 'Win32_Process' -or $Filter -ne 'ProcessId=321') { throw 'Unbounded process lookup.' }
    return $script:mockProcess
}
function Start-Process { throw 'Test must never start applications.' }
function Stop-Process { throw 'Test must never stop applications.' }
$valid=[PSCustomObject]@{app='ivLyricsHangul';version='0.7.0';protocol=1;pid=321;capabilities=@('youtube-links-v1','mixed-playlists-v1','playback-control-v1','lyric-sync-v1')}
$script:passed=0
function Copy-Health { return ($valid | ConvertTo-Json -Depth 5 | ConvertFrom-Json) }
function Expect-Rejection($Health,[int]$ExpectedPid=0) {
    $rejected=$false
    try { $null=Assert-HelperHealth $Health $bridge '0.7.0' $python $ExpectedPid } catch { $rejected=$true }
    if (-not $rejected) { throw 'Unowned or incompatible helper accepted.' }
    $script:passed++
}
if (-not (Assert-HelperHealth $valid $bridge '0.7.0' $python)) { throw 'Owned helper rejected.' }; $script:passed++
if (-not (Assert-HelperHealth $valid $bridge '0.7.0' $python 321)) { throw 'Owned new child rejected.' }; $script:passed++
foreach ($change in @(@('app','other'),@('version','0.6.3'),@('protocol',2),@('pid','not-a-pid'))) {
    $record=Copy-Health; $record.($change[0])=$change[1]; Expect-Rejection $record
}
$record=Copy-Health; $record.capabilities=@('youtube-links-v1','mixed-playlists-v1','playback-control-v1'); Expect-Rejection $record
$record=Copy-Health; $record.capabilities=($valid.capabilities -join ','); Expect-Rejection $record
Expect-Rejection $valid 322
$original=$script:mockProcess
foreach ($command in @(
    ('"'+$python+'" -u "'+(Join-Path $testRoot 'sibling\bridge.py')+'"'),
    ('"'+$python+'" -u "'+$bridge+'.other"'),
    ('"'+$python+'" -c "'+$bridge+'"'),
    ('"'+$python+'" -u "'+$bridge+'" extra')
)) {
    $script:mockProcess=[PSCustomObject]@{ExecutablePath=$python;CommandLine=$command}; Expect-Rejection $valid
}
$script:mockProcess=[PSCustomObject]@{ExecutablePath=(Join-Path $testRoot 'other\pythonw.exe');CommandLine=$original.CommandLine}; Expect-Rejection $valid
$script:mockProcess=$null; Expect-Rejection $valid
$script:mockProcess=[PSCustomObject]@{ExecutablePath=$python;CommandLine=('"'+$python+'" -I -B -u "'+$bridge+'"')}
if (-not (Assert-HelperHealth $valid $bridge '0.7.0' $python)) { throw 'Owned isolated helper rejected.' }; $script:passed++
[PSCustomObject]@{tests=$script:passed;ownedHelperVerified=$true;foreignHelperRejected=$true;capabilitiesRequired=$true;applicationsNotLaunched=$true} | ConvertTo-Json
