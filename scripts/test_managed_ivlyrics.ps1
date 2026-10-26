# @file test_managed_ivlyrics.ps1
# @author: ForUltraplayer
# @brief Verify code replacement, stale-file removal, integrity and rollback using isolated fixtures.
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
. (Join-Path $project 'installer\managed-ivlyrics.ps1')
$area=Join-Path $project ('work\ivlyrics-tests-'+[Guid]::NewGuid().ToString('N'))
$app=Join-Path $area 'app'
$config=Join-Path $app 'spicetify-config'
$source=Join-Path $app 'ivLyrics'
$target=Join-Path $config 'CustomApps\ivLyrics'
[void](New-Item -ItemType Directory -Path $source,$target)
function Assert($Value,[string]$Message) { if(-not $Value){throw $Message} }
'new code' | Set-Content -LiteralPath (Join-Path $source 'index.js') -Encoding UTF8
$algorithm=[Security.Cryptography.SHA256]::Create()
try { $hash=[BitConverter]::ToString($algorithm.ComputeHash([IO.File]::ReadAllBytes((Join-Path $source 'index.js')))).Replace('-','').ToLowerInvariant() }
finally { $algorithm.Dispose() }
@{app='SpotifyHangul';version='2';revision='new';files=@{'index.js'=$hash}} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $source 'hangul-managed.json') -Encoding UTF8
@{components=@{ivlyrics=@{version='2';revision='new'}}} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $app 'components.json') -Encoding UTF8
'old code' | Set-Content -LiteralPath (Join-Path $target 'index.js')
'obsolete' | Set-Content -LiteralPath (Join-Path $target 'old-addon.js')
'settings remain' | Set-Content -LiteralPath (Join-Path $config 'config-xpui.ini')
$transaction=Install-ManagedIvLyrics $app $config
Assert $transaction.Changed 'Existing ivLyrics was not replaced'
Assert (-not (Test-Path -LiteralPath (Join-Path $target 'old-addon.js'))) 'Stale code survived'
Assert ((Get-Content -LiteralPath (Join-Path $target 'index.js') -Raw).Trim() -eq 'new code') 'New code missing'
Assert ((Get-Content -LiteralPath (Join-Path $transaction.Backup 'index.js') -Raw).Trim() -eq 'old code') 'Backup missing'
Assert ((Get-Content -LiteralPath (Join-Path $config 'config-xpui.ini') -Raw).Trim() -eq 'settings remain') 'Settings changed'
$unchanged=Install-ManagedIvLyrics $app $config
Assert (-not $unchanged.Changed) 'Identical code was replaced again'
Undo-ManagedIvLyrics $transaction
Assert ((Get-Content -LiteralPath (Join-Path $target 'index.js') -Raw).Trim() -eq 'old code') 'Rollback lost original'
Assert (Test-Path -LiteralPath (Join-Path $target 'old-addon.js')) 'Rollback lost stale original'
'left by a previous NSIS payload' | Set-Content -LiteralPath (Join-Path $source 'old-bundled-addon.js')
$overlaid=Install-ManagedIvLyrics $app $config
Assert $overlaid.Changed 'Overlaid payload was rejected'
Assert (-not (Test-Path -LiteralPath (Join-Path $target 'old-bundled-addon.js'))) 'Obsolete bundled code was copied'
Undo-ManagedIvLyrics $overlaid
'corrupt' | Set-Content -LiteralPath (Join-Path $source 'index.js')
$rejected=$false
try { Install-ManagedIvLyrics $app $config | Out-Null } catch { $rejected=$true }
Assert $rejected 'Corrupted source accepted'
Assert ((Get-Content -LiteralPath (Join-Path $target 'index.js') -Raw).Trim() -eq 'old code') 'Corrupt source changed target'
$rejected=$false
try { Assert-IvLyricsChild $app (Join-Path $app '..\outside') } catch { $rejected=$true }
Assert $rejected 'Outside path accepted'
[PSCustomObject]@{tests=13;replacement=$true;rollback=$true;integrity=$true;settingsPreserved=$true}|ConvertTo-Json
