# @file test_payload_transaction.ps1
# @brief Exercise full application snapshots, stale-file ownership and interrupted update recovery in isolated folders.
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
. (Join-Path $project 'installer\payload-transaction.ps1')
# Fixtures contain no executable applications and must not inspect or stop live processes.
function Stop-PayloadProcesses([string]$Root) {}
$area=Join-Path $project ('work\payload-transaction-tests-'+[Guid]::NewGuid().ToString('N'))
$payload=Join-Path $area 'new payload'
$root=Join-Path $area '기존 설치 app'
[void](New-Item -ItemType Directory -Path $payload,$root -Force)
$script:tests=0
function Assert($Value,[string]$Message) { if (-not $Value) { throw $Message }; $script:tests++ }
function Put([string]$Directory,[string]$Relative,[string]$Text) {
    $file=Join-Path $Directory $Relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force)
    [IO.File]::WriteAllText($file,$Text,[Text.UTF8Encoding]::new($false))
}
function Make-Manifest([string]$Directory) {
    $files=@{}
    foreach ($file in @(Get-ChildItem -LiteralPath $Directory -Recurse -Force -File)) {
        if ($file.Name -eq 'package-manifest.json') { continue }
        $files[$file.FullName.Substring($Directory.Length+1).Replace('\','/')]=Get-PayloadHash $file.FullName
    }
    $files | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Directory 'package-manifest.json') -Encoding UTF8
}
function Equal-Tree($Expected,[string]$Directory) {
    $actual=Get-PayloadTreeHashes $Directory
    if ($Expected.Count -ne $actual.Count) { return $false }
    foreach ($name in $Expected.Keys) { if ($actual[$name] -ne $Expected[$name]) { return $false } }
    return $true
}
Put $root 'install-marker.json' '{"app":"SpotifyHangul","version":"0.6.1"}'
Put $root 'release.json' '{"version":"0.6.1"}'
Put $root 'runtime\python.exe' 'old python fixture'
Put $root 'Spotify\Apps\xpui\xpui.js' 'old patched spotify'
Put $root 'spicetify-config\config-xpui.ini' 'old config'
Put $root 'client.prefs' 'account preferences'
Put $root 'obsolete-code.js' 'old managed code'
Put $root 'old-feature\only-file.js' 'old managed folder'
Put $root 'modified-old.js' 'original managed code'
Make-Manifest $root
Put $root 'modified-old.js' 'user modified code'
Put $root 'user data\playlist.json' '["spotify:track:abc","youtube:video:UWa_OiXDiQA"]'
Put $root 'user data\lyrics.db' 'pronunciations and offsets: 5300'
Put $payload 'install-marker.json' '{"app":"SpotifyHangul","version":"0.7.0"}'
Put $payload 'release.json' '{"version":"0.7.0"}'
Put $payload 'runtime\python.exe' 'new python fixture'
Put $payload 'new-module.js' 'new module'
Put $payload 'desktop-overlay\lyrics-plus-overlay.exe' 'bundled original overlay fixture'
Make-Manifest $payload
$before=Get-PayloadTreeHashes $root
$transaction=Start-PayloadTransaction $root $payload -NoMetadata
Assert (Equal-Tree $before (Join-Path $transaction.Directory 'previous')) 'Snapshot bytes differ from the previous installation.'
$failed=$false
try {
    Invoke-PayloadTransaction $transaction $payload -Integration {
        param($app)
        Put $app 'Spotify\Apps\xpui\xpui.js' 'partially patched new spotify'
        Put $app 'spicetify-config\config-xpui.ini' 'partially changed config'
        Put $app 'integration-only.tmp' 'partial integration'
        throw 'injected integration failure'
    }
} catch { $failed=$_.Exception.Message -match 'injected integration failure' }
Assert $failed 'The integration fault did not reach the caller.'
Assert (Equal-Tree $before $root) 'Rollback did not restore every previous file and user data byte.'
Assert (-not (Test-Path -LiteralPath (Join-Path $root 'new-module.js'))) 'Rollback left new-only code.'
Assert ((Read-PayloadTransaction $root).Status -eq 'restored') 'Rollback did not persist its completion record.'
Assert (Test-Path -LiteralPath (Join-Path $transaction.Directory 'failed\integration-only.tmp')) 'Failed payload diagnostics were discarded.'
$transaction=Start-PayloadTransaction $root $payload -NoMetadata
Invoke-PayloadTransaction $transaction $payload -Integration { param($app) Put $app 'spicetify-config\config-xpui.ini' 'new integrated config' }
Assert ((Read-PayloadTransaction $root).Status -eq 'pending-commit') 'Successful integration was committed too early.'
Assert (-not (Test-Path -LiteralPath (Join-Path $root 'obsolete-code.js'))) 'Unmodified obsolete owned file survived.'
Assert (-not (Test-Path -LiteralPath (Join-Path $root 'old-feature'))) 'A folder emptied by obsolete file removal survived.'
Assert ((Get-Content -LiteralPath (Join-Path $root 'modified-old.js') -Raw) -eq 'user modified code') 'A user-modified old file was removed.'
Assert ((Get-Content -LiteralPath (Join-Path $root 'user data\lyrics.db') -Raw) -eq 'pronunciations and offsets: 5300') 'User data changed during upgrade.'
Assert (-not (Test-Path -LiteralPath (Join-Path $root 'runtime\runtime'))) 'Recursive payload copy nested runtime twice.'
Assert ((Get-Content -LiteralPath (Join-Path $root 'runtime\python.exe') -Raw) -eq 'new python fixture') 'The runtime was not upgraded.'
# A process interruption before the NSIS metadata commit must revert on the next attempt.
Repair-PayloadTransaction $root $PID
Assert (Equal-Tree $before $root) 'Interrupted pending commit did not restore the old version.'
$transaction=Start-PayloadTransaction $root $payload -NoMetadata
Invoke-PayloadTransaction $transaction $payload -Integration { param($app) Put $app 'integration-success.txt' 'verified' }
Complete-PayloadTransaction $transaction
$after=Get-PayloadTreeHashes $root
Repair-PayloadTransaction $root $PID
Assert (Equal-Tree $after $root) 'A committed installation was rolled back.'
Assert ((Read-PayloadTransaction $root).Status -eq 'committed') 'Successful installation has no commit record.'
Assert (Test-Path -LiteralPath (Join-Path $transaction.Directory 'previous\release.json')) 'Committed update lost its recovery generation.'
# Kill during snapshot copying: partial backup is never applied over the still intact root.
$transaction=Start-PayloadTransaction $root $payload -NoMetadata
$transaction.Status='snapshotting'; Save-PayloadJournal $transaction
Put (Join-Path $transaction.Directory 'previous') 'release.json' 'incomplete snapshot'
Repair-PayloadTransaction $root $PID
Assert (Equal-Tree $after $root) 'An incomplete snapshot was restored over the original installation.'
# Simulate a power loss between the two restoration renames.
$transaction=Start-PayloadTransaction $root $payload -NoMetadata
Invoke-PayloadTransaction $transaction $payload -Integration {}
$transaction.Status='restoring'; Save-PayloadJournal $transaction
Move-Item -LiteralPath $root -Destination (Join-Path $transaction.Directory 'failed')
Repair-PayloadTransaction $root $PID
Assert (Equal-Tree $after $root) 'Interrupted restoration did not resume.'
$transaction=Start-PayloadTransaction $root $payload -NoMetadata
Invoke-PayloadTransaction $transaction $payload -Integration {}
$transaction.Status='restoring'; Save-PayloadJournal $transaction
Move-Item -LiteralPath $root -Destination (Join-Path $transaction.Directory 'failed')
Move-Item -LiteralPath (Join-Path $transaction.Directory 'previous') -Destination $root
Repair-PayloadTransaction $root $PID
Assert (Equal-Tree $after $root) 'Recovery after the completed snapshot rename did not resume.'
$missingRoot=Join-Path $area 'missing backup app'
Put $missingRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $missingRoot 'release.json' '{"version":"0.6.3"}'
$missingTransaction=Start-PayloadTransaction $missingRoot $payload -NoMetadata
Invoke-PayloadTransaction $missingTransaction $payload -Integration {}
$missingBackup=[IO.Path]::GetFullPath((Join-Path $missingTransaction.Directory 'previous'))
if (-not $missingBackup.StartsWith([IO.Path]::GetFullPath($area)+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture backup is outside its test area.' }
Remove-Item -LiteralPath $missingBackup -Recurse -Force
$rejected=$false
try { Undo-PayloadTransaction $missingTransaction } catch { $rejected=$_.Exception.Message -match 'backup is missing' }
Assert $rejected 'A missing snapshot was accepted as successfully restored.'
Assert ((Read-PayloadTransaction $missingRoot).Status -ne 'restored') 'Missing backup incorrectly completed recovery.'
$damagedRoot=Join-Path $area 'damaged backup app'
Put $damagedRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $damagedRoot 'release.json' '{"version":"0.6.3"}'
$damagedTransaction=Start-PayloadTransaction $damagedRoot $payload -NoMetadata
Invoke-PayloadTransaction $damagedTransaction $payload -Integration {}
Put (Join-Path $damagedTransaction.Directory 'previous') 'release.json' '{"version":"damaged"}'
$rejected=$false
try { Undo-PayloadTransaction $damagedTransaction } catch { $rejected=$_.Exception.Message -match 'snapshot hash differs' }
Assert $rejected 'A damaged snapshot was applied over the installation.'
Assert ((Read-PayloadTransaction $damagedRoot).Status -ne 'restored') 'Damaged backup incorrectly completed recovery.'
$fresh=Join-Path $area 'fresh app'
$transaction=Start-PayloadTransaction $fresh $payload -NoMetadata
$failed=$false
try { Invoke-PayloadTransaction $transaction $payload -Integration { throw 'fresh failure' } } catch { $failed=$true }
Assert ($failed -and -not (Test-Path -LiteralPath $fresh)) 'A failed fresh installation left a half-installed root.'
$diagnosticBefore=Get-PayloadTreeHashes $root
$transaction=Start-PayloadTransaction $root $payload -NoMetadata
[void](New-Item -ItemType Directory -Path (Join-Path $transaction.Directory 'failure.txt'))
$failed=$false
try { Invoke-PayloadTransaction $transaction $payload -Integration { throw 'diagnostic write failure fixture' } }
catch { $failed=$_.Exception.Message -match 'diagnostic write failure fixture' }
Assert $failed 'A diagnostic write failure replaced the original installation failure.'
Assert (Equal-Tree $diagnosticBefore $root) 'A diagnostic write failure skipped full rollback.'
# A native current-directory handle reproduces old updater parents that remain
# alive in the installation folder while the new installer is recovering.
$inPlaceRoot=Join-Path $area 'in-place cwd app'
Put $inPlaceRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $inPlaceRoot 'release.json' '{"version":"0.6.1"}'
Put $inPlaceRoot 'unchanged-user.db' 'keep exactly'
Put $inPlaceRoot 'file-before.txt' 'previous file'
Put $inPlaceRoot 'dir-before\old.txt' 'previous directory contents'
$inPlaceBefore=Get-PayloadTreeHashes $inPlaceRoot
$inPlaceTransaction=Start-PayloadTransaction $inPlaceRoot $payload -NoMetadata
Invoke-PayloadTransaction $inPlaceTransaction $payload -Integration {
    param($app)
    Remove-Item -LiteralPath (Join-Path $app 'file-before.txt') -Force
    Put $app 'file-before.txt\new-child.txt' 'new directory replacing a file'
    Remove-Item -LiteralPath (Join-Path $app 'dir-before') -Recurse -Force
    Put $app 'dir-before' 'new file replacing a directory'
    [void](New-Item -ItemType Directory -Path (Join-Path $app 'new-empty-directory'))
}
$nativeCwd=[Environment]::CurrentDirectory
try {
    [Environment]::CurrentDirectory=$inPlaceRoot
    Undo-PayloadTransaction $inPlaceTransaction
} finally { [Environment]::CurrentDirectory=$nativeCwd }
$inPlaceRecord=Read-PayloadTransaction $inPlaceRoot
Assert $inPlaceRecord.InPlaceRestore 'A held current-directory handle did not exercise in-place rollback.'
Assert ($inPlaceRecord.CaptureAttempted -and $inPlaceRecord.Status -eq 'restored') 'In-place recovery did not persist its capture and completion state.'
Assert (Equal-Tree $inPlaceBefore $inPlaceRoot) 'In-place recovery did not restore file/directory conflicts and user data.'
Assert (Test-Path -LiteralPath (Join-Path $inPlaceRecord.Directory 'previous\release.json')) 'In-place recovery consumed the original snapshot.'
Assert (-not (Test-Path -LiteralPath (Join-Path $inPlaceRecord.Directory 'failed\unchanged-user.db'))) 'In-place diagnostics copied unchanged user data instead of only the delta.'
Assert (Test-Path -LiteralPath (Join-Path $inPlaceRecord.Directory 'failed\new-module.js')) 'In-place diagnostics omitted new-only files.'
Assert (-not (Test-Path -LiteralPath (Join-Path $inPlaceRoot 'new-empty-directory'))) 'In-place recovery retained an unnecessary empty directory.'
# Persist an interrupted in-place state, with just part of the old files copied.
$resumeRoot=Join-Path $area 'resume in-place app'
Put $resumeRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $resumeRoot 'release.json' '{"version":"0.6.1"}'
Put $resumeRoot 'runtime\old.exe' 'old runtime bytes'
$resumeBefore=Get-PayloadTreeHashes $resumeRoot
$resumeTransaction=Start-PayloadTransaction $resumeRoot $payload -NoMetadata
Invoke-PayloadTransaction $resumeTransaction $payload -Integration {}
$script:copyDefinition=(Get-Command Copy-PayloadTree).ScriptBlock
$script:resumeBackup=Join-Path $resumeTransaction.Directory 'previous'
function Copy-PayloadTree([string]$From,[string]$To) {
    if ($From -eq $script:resumeBackup) {
        Copy-Item -LiteralPath (Join-Path $From 'release.json') -Destination (Join-Path $To 'release.json') -Force
        throw 'injected partial in-place copy failure'
    }
    & $script:copyDefinition $From $To
}
$interrupted=$false
try { [Environment]::CurrentDirectory=$resumeRoot; Undo-PayloadTransaction $resumeTransaction }
catch { $interrupted=$_.Exception.Message -match 'partial in-place copy failure' }
finally { [Environment]::CurrentDirectory=$nativeCwd; Set-Item Function:\Copy-PayloadTree $script:copyDefinition }
Assert $interrupted 'A core in-place copy failure was hidden.'
$resumeRecord=Read-PayloadTransaction $resumeRoot
Assert ($resumeRecord.Status -eq 'restoring' -and $resumeRecord.CaptureAttempted) 'An interrupted in-place copy was incorrectly completed.'
Assert-PayloadSnapshot $resumeRecord $script:resumeBackup
$captureHash=Get-PayloadHash (Join-Path $resumeRecord.Directory 'failed\release.json')
Put $resumeRoot 'release.json' 'partly restored mixture must not replace initial evidence'
Repair-PayloadTransaction $resumeRoot $PID
Assert (Equal-Tree $resumeBefore $resumeRoot) 'An interrupted in-place rollback was not resumable.'
Assert ((Get-PayloadHash (Join-Path $resumeRecord.Directory 'failed\release.json')) -eq $captureHash) 'A recovery retry replaced initial diagnostics with partly restored data.'
# Diagnostic capture errors, such as disk exhaustion, do not stop core recovery.
$spaceRoot=Join-Path $area 'diagnostic space failure app'
Put $spaceRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $spaceRoot 'release.json' '{"version":"0.6.0"}'
$spaceBefore=Get-PayloadTreeHashes $spaceRoot
$spaceTransaction=Start-PayloadTransaction $spaceRoot $payload -NoMetadata
Invoke-PayloadTransaction $spaceTransaction $payload -Integration {}
$script:failedCapture=Join-Path $spaceTransaction.Directory 'failed'
function Copy-Item {
    param([string]$LiteralPath,[string]$Destination,[switch]$Recurse,[switch]$Force)
    if ($Destination.StartsWith($script:failedCapture+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'injected diagnostic disk exhaustion' }
    Microsoft.PowerShell.Management\Copy-Item @PSBoundParameters
}
try { [Environment]::CurrentDirectory=$spaceRoot; Undo-PayloadTransaction $spaceTransaction }
finally { [Environment]::CurrentDirectory=$nativeCwd; Remove-Item Function:\Copy-Item }
Assert (Equal-Tree $spaceBefore $spaceRoot) 'Diagnostic disk exhaustion prevented in-place rollback.'
Assert ((Read-PayloadTransaction $spaceRoot).Status -eq 'restored') 'Successful core recovery was not completed after a diagnostic capture failure.'
# The initial state transition is mandatory and atomic. If that one write
# fails, neither diagnostic capture nor destructive file recovery may begin.
$journalRoot=Join-Path $area 'mandatory journal failure app'
Put $journalRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $journalRoot 'release.json' '{"version":"0.6.1"}'
$journalBefore=Get-PayloadTreeHashes $journalRoot
$journalTransaction=Start-PayloadTransaction $journalRoot $payload -NoMetadata
Invoke-PayloadTransaction $journalTransaction $payload -Integration {}
$journalCurrent=Get-PayloadTreeHashes $journalRoot
$script:journalDefinition=(Get-Command Save-PayloadJournal).ScriptBlock
function Save-PayloadJournal($Transaction) {
    if ($Transaction.InPlaceRestore -and $Transaction.CaptureAttempted) { throw 'injected mandatory journal write failure' }
    & $script:journalDefinition $Transaction
}
$rejected=$false
try { [Environment]::CurrentDirectory=$journalRoot; Undo-PayloadTransaction $journalTransaction }
catch { $rejected=$_.Exception.Message -match 'mandatory journal write failure' }
finally { [Environment]::CurrentDirectory=$nativeCwd; Set-Item Function:\Save-PayloadJournal $script:journalDefinition }
$journalRecord=Read-PayloadTransaction $journalRoot
Assert ($rejected -and (Equal-Tree $journalCurrent $journalRoot)) 'A failed mandatory state write changed active files.'
Assert (-not $journalRecord.InPlaceRestore -and -not $journalRecord.CaptureAttempted) 'A failed atomic state write persisted only part of the transition.'
Assert (-not (Test-Path -LiteralPath (Join-Path $journalRecord.Directory 'failed'))) 'Diagnostic capture ran before its mandatory state transition.'
try { [Environment]::CurrentDirectory=$journalRoot; Repair-PayloadTransaction $journalRoot $PID }
finally { [Environment]::CurrentDirectory=$nativeCwd }
Assert (Equal-Tree $journalBefore $journalRoot) 'Recovery did not resume after the mandatory state write became available.'
# A power loss (or failed write) after core restoration but before its final
# completion record must also replay without capturing a mixed root again.
$journalTransaction=Start-PayloadTransaction $journalRoot $payload -NoMetadata
Invoke-PayloadTransaction $journalTransaction $payload -Integration {}
function Save-PayloadJournal($Transaction) {
    if ($Transaction.Status -eq 'restored') { throw 'injected final completion journal failure' }
    & $script:journalDefinition $Transaction
}
$rejected=$false
try { [Environment]::CurrentDirectory=$journalRoot; Undo-PayloadTransaction $journalTransaction }
catch { $rejected=$_.Exception.Message -match 'final completion journal failure' }
finally { [Environment]::CurrentDirectory=$nativeCwd; Set-Item Function:\Save-PayloadJournal $script:journalDefinition }
$journalRecord=Read-PayloadTransaction $journalRoot
Assert ($rejected -and (Equal-Tree $journalBefore $journalRoot)) 'The final journal write fault prevented core file restoration.'
Assert ($journalRecord.Status -eq 'restoring' -and $journalRecord.InPlaceRestore -and $journalRecord.CaptureAttempted) 'A failed completion write lost the durable recovery state.'
$captureHash=Get-PayloadHash (Join-Path $journalRecord.Directory 'failed\release.json')
Put $journalRoot 'release.json' 'mixed root after a completion-record interruption'
Repair-PayloadTransaction $journalRoot $PID
Assert (Equal-Tree $journalBefore $journalRoot) 'Recovery after a failed completion write did not finish.'
Assert ((Get-PayloadHash (Join-Path $journalRecord.Directory 'failed\release.json')) -eq $captureHash) 'A completion-record retry overwrote the initial delta evidence.'
# Enumeration is diagnostic work too: an enumeration-only fault must not stop
# the subsequent mandatory enumeration, deletion, copy and hash verification.
$enumRoot=Join-Path $area 'diagnostic enumeration failure app'
Put $enumRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $enumRoot 'release.json' '{"version":"0.6.0"}'
$enumBefore=Get-PayloadTreeHashes $enumRoot
$enumTransaction=Start-PayloadTransaction $enumRoot $payload -NoMetadata
Invoke-PayloadTransaction $enumTransaction $payload -Integration {}
$script:enumFixture=$enumRoot
$script:enumInjected=$false
function Get-ChildItem {
    param([string]$LiteralPath,[switch]$Recurse,[switch]$Force,[switch]$File,[switch]$Directory)
    if ($LiteralPath -eq $script:enumFixture -and $File -and $Recurse -and -not $script:enumInjected) {
        $script:enumInjected=$true
        throw 'injected diagnostic enumeration failure'
    }
    Microsoft.PowerShell.Management\Get-ChildItem @PSBoundParameters
}
try { [Environment]::CurrentDirectory=$enumRoot; Undo-PayloadTransaction $enumTransaction }
finally { [Environment]::CurrentDirectory=$nativeCwd; Remove-Item Function:\Get-ChildItem }
Assert ($script:enumInjected -and (Equal-Tree $enumBefore $enumRoot)) 'A diagnostic enumeration failure stopped core rollback.'
Assert ((Read-PayloadTransaction $enumRoot).Status -eq 'restored') 'Core recovery after diagnostic enumeration failure was not committed.'
$missingCurrent=Get-PayloadTreeHashes $missingRoot
$missingTransaction.InPlaceRestore=$true; Save-PayloadJournal $missingTransaction
$rejected=$false
try { Undo-PayloadTransaction $missingTransaction } catch { $rejected=$_.Exception.Message -match 'in-place recovery snapshot is missing' }
Assert ($rejected -and (Equal-Tree $missingCurrent $missingRoot)) 'An in-place recovery with a missing snapshot changed the active files.'
$damagedCurrent=Get-PayloadTreeHashes $damagedRoot
$damagedTransaction.InPlaceRestore=$true; Save-PayloadJournal $damagedTransaction
$rejected=$false
try { Undo-PayloadTransaction $damagedTransaction } catch { $rejected=$_.Exception.Message -match 'snapshot hash differs' }
Assert ($rejected -and (Equal-Tree $damagedCurrent $damagedRoot)) 'An in-place recovery copied a damaged snapshot.'
foreach ($relative in @('..\outside.txt','file.txt:stream','.')) {
    $rejected=$false
    try { $null=Resolve-PayloadChild $spaceRoot $relative } catch { $rejected=$true }
    Assert $rejected 'An unsafe in-place recovery path was accepted.'
}
foreach ($forbidden in @($env:USERPROFILE,[IO.Path]::GetPathRoot($root),$env:LOCALAPPDATA)) {
    $rejected=$false
    try { $null=Get-PayloadTransactionPath $forbidden } catch { $rejected=$true }
    Assert $rejected 'An unsafe installation root was accepted.'
}
$bad=Join-Path $area 'unowned'
Put $bad 'keep.txt' 'untouched'
$rejected=$false
try { $null=Start-PayloadTransaction $bad $payload -NoMetadata } catch { $rejected=$true }
Assert ($rejected -and (Get-Content -LiteralPath (Join-Path $bad 'keep.txt') -Raw) -eq 'untouched') 'An unowned directory was changed.'
$rejected=$false
try { $null=Start-PayloadTransaction $root $root -NoMetadata } catch { $rejected=$true }
Assert $rejected 'The installation was accepted as its own staging area.'
Put $payload 'new-module.js' 'tampered'
$rejected=$false
try { $null=Start-PayloadTransaction $root $payload -NoMetadata } catch { $rejected=$true }
Assert ($rejected -and (Equal-Tree $after $root)) 'A corrupt package modified the active installation.'
$setup=Get-Content -LiteralPath (Join-Path $project 'installer\setup.nsi') -Raw
Assert ($setup.Contains('SetOutPath "$PLUGINSDIR\payload"')) 'NSIS writes package files directly into the active root.'
Assert ($setup.Contains('Function .onInstFailed') -and $setup.Contains('MUI_CUSTOMFUNCTION_ABORT RollbackInstall') -and $setup.Contains('-Mode Commit')) 'NSIS metadata failure and abort recovery hooks are absent.'
$transaction=Read-PayloadTransaction $root
Remove-PayloadTransaction $root
Assert (-not (Test-Path -LiteralPath $transaction.Directory) -and (Equal-Tree $after $root)) 'Snapshot cleanup changed the active installation or retained old files.'
Assert ($setup.Contains('-Mode Cleanup')) 'Uninstall does not remove its owned snapshot.'
# Exercise the real registry value serializer and shortcut restoration under dedicated test targets.
$script:registryFixture='Software\SpotifyHangulTests\'+[Guid]::NewGuid().ToString('N')
$script:shortcutFixture=Join-Path $area 'metadata shortcuts'
$registryDefinition=(Get-Command Get-PayloadRegistryPaths).ScriptBlock
$shortcutDefinition=(Get-Command Get-PayloadShortcuts).ScriptBlock
function Get-PayloadRegistryPaths { @(($script:registryFixture+'\Installed'),($script:registryFixture+'\PreviouslyAbsent')) }
function Get-PayloadShortcuts { @((Join-Path $script:shortcutFixture 'old.lnk'),(Join-Path $script:shortcutFixture 'new.lnk'),(Join-Path $script:shortcutFixture 'remove.lnk')) }
$metadataRoot=Join-Path $area 'metadata app'
Put $metadataRoot 'install-marker.json' '{"app":"SpotifyHangul"}'
Put $metadataRoot 'old.txt' 'old application'
Put $script:shortcutFixture 'old.lnk' 'original desktop shortcut'
Put $script:shortcutFixture 'remove.lnk' 'original uninstall shortcut'
$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(($script:registryFixture+'\Installed'))
try {
    $key.SetValue('Text','original',[Microsoft.Win32.RegistryValueKind]::String)
    $key.SetValue('Number',7,[Microsoft.Win32.RegistryValueKind]::DWord)
    $key.SetValue('Large',[long]4294967296,[Microsoft.Win32.RegistryValueKind]::QWord)
    $key.SetValue('Bytes',[byte[]]@(0,1,255),[Microsoft.Win32.RegistryValueKind]::Binary)
    $key.SetValue('Many',[string[]]@('alpha','beta'),[Microsoft.Win32.RegistryValueKind]::MultiString)
    $key.SetValue('Expand','%LOCALAPPDATA%\lyrics',[Microsoft.Win32.RegistryValueKind]::ExpandString)
} finally { $key.Dispose() }
Make-Manifest $payload
try {
    $transaction=Start-PayloadTransaction $metadataRoot $payload
    $failed=$false
    try {
        Invoke-PayloadTransaction $transaction $payload -Integration {
            param($app)
            [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree(($script:registryFixture+'\Installed'),$false)
            $new=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(($script:registryFixture+'\PreviouslyAbsent'))
            try { $new.SetValue('New','discard') } finally { $new.Dispose() }
            Put $script:shortcutFixture 'old.lnk' 'changed'
            Put $script:shortcutFixture 'new.lnk' 'new shortcut'
            Remove-Item -LiteralPath (Join-Path $script:shortcutFixture 'remove.lnk')
            throw 'metadata fault'
        }
    } catch { $failed=$_.Exception.Message -match 'metadata fault' }
    Assert $failed 'Metadata fault was not propagated.'
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(($script:registryFixture+'\Installed'))
    try {
        Assert ($key.GetValue('Text') -eq 'original' -and $key.GetValueKind('Text') -eq 'String') 'String registration value was not restored.'
        Assert ($key.GetValue('Number') -eq 7 -and $key.GetValueKind('Number') -eq 'DWord') 'DWORD registration value was not restored.'
        Assert ($key.GetValue('Large') -eq [long]4294967296 -and $key.GetValueKind('Large') -eq 'QWord') 'QWORD registration value was not restored.'
        Assert (($key.GetValue('Bytes') -join ',') -eq '0,1,255' -and $key.GetValueKind('Bytes') -eq 'Binary') 'Binary registration value was not restored.'
        Assert (($key.GetValue('Many') -join ',') -eq 'alpha,beta' -and $key.GetValueKind('Many') -eq 'MultiString') 'Multi-string registration value was not restored.'
        Assert ($key.GetValue('Expand',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -eq '%LOCALAPPDATA%\lyrics' -and $key.GetValueKind('Expand') -eq 'ExpandString') 'Expandable registration value was expanded or lost.'
    } finally { if ($key) { $key.Dispose() } }
    $absent=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(($script:registryFixture+'\PreviouslyAbsent'))
    try { Assert ($null -eq $absent) 'A newly created registration key survived rollback.' } finally { if ($absent) { $absent.Dispose() } }
    Assert ((Get-Content -LiteralPath (Join-Path $script:shortcutFixture 'old.lnk') -Raw) -eq 'original desktop shortcut') 'Existing shortcut bytes were not restored.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $script:shortcutFixture 'new.lnk'))) 'A newly created shortcut survived rollback.'
    Assert ((Get-Content -LiteralPath (Join-Path $script:shortcutFixture 'remove.lnk') -Raw) -eq 'original uninstall shortcut') 'A deleted existing shortcut was not restored.'
} finally {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($script:registryFixture,$false)
    Set-Item Function:\Get-PayloadRegistryPaths $registryDefinition
    Set-Item Function:\Get-PayloadShortcuts $shortcutDefinition
}
$guardActual=Get-PayloadTreeHashes $root
$guardName=@($guardActual.Keys)[0]
foreach ($invalid in @(
    [PSCustomObject]@{Name='missing-file';Value=$null},
    [PSCustomObject]@{Name='missing-file';Value=('x'*64)},
    [PSCustomObject]@{Name='missing-file';Value=$guardActual[$guardName]},
    [PSCustomObject]@{Name='..\outside-file';Value=$guardActual[$guardName]}
)) {
    $guardExpected=@{}
    foreach ($name in $guardActual.Keys) { $guardExpected[$name]=$guardActual[$name] }
    $guardExpected.Remove($guardName)
    $guardExpected[$invalid.Name]=$invalid.Value
    $rejected=$false
    try { Assert-PayloadSnapshot ([PSCustomObject]@{SnapshotFiles=[PSCustomObject]$guardExpected}) $root } catch { $rejected=$true }
    Assert $rejected 'A malformed or out-of-root snapshot entry passed verification.'
}
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'installer\payload-transaction.ps1'),[ref]$null,[ref]$null)
$stopDefinition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Stop-PayloadProcesses'},$true)
Invoke-Expression $stopDefinition.Extent.Text
$script:stopped=@()
function Get-CimInstance {
    param($ClassName,$ErrorAction)
    return @(
        [PSCustomObject]@{ProcessId=101;ExecutablePath=(Join-Path $root 'runtime\pythonw.exe');CommandLine=('pythonw.exe -u "'+(Join-Path $root 'bridge.py')+'"')},
        [PSCustomObject]@{ProcessId=102;ExecutablePath=(Join-Path $root 'runtime\python.exe');CommandLine=('python.exe -u "'+(Join-Path $root 'bridge.py')+'"')},
        [PSCustomObject]@{ProcessId=103;ExecutablePath=(Join-Path $root 'runtime\pythonw.exe');CommandLine='pythonw.exe -u "C:\another\bridge.py"'},
        [PSCustomObject]@{ProcessId=104;ExecutablePath='C:\another\pythonw.exe';CommandLine=('pythonw.exe -u "'+(Join-Path $root 'bridge.py')+'"')},
        [PSCustomObject]@{ProcessId=105;ExecutablePath=(Join-Path $root 'desktop-overlay\lyrics-plus-overlay.exe');CommandLine='overlay'},
        [PSCustomObject]@{ProcessId=106;ExecutablePath='C:\external\lyrics-plus-overlay.exe';CommandLine='external overlay'},
        [PSCustomObject]@{ProcessId=107;ExecutablePath=(Join-Path $root 'Spotify\Spotify.exe');CommandLine='spotify'},
        [PSCustomObject]@{ProcessId=108;ExecutablePath=(Join-Path $root 'runtime\python.exe');CommandLine=('python.exe -c "print('+(Join-Path $root 'bridge.py')+')"')}
    )
}
function Stop-Process { param($Id,$ErrorAction) $script:stopped += $Id }
function Wait-Process { param($Id,$Timeout,$ErrorAction) }
Stop-PayloadProcesses $root
Assert (($script:stopped -join ',') -eq '101,102,105,107') 'Owned pythonw, Python, Spotify and overlay processes were not stopped precisely.'
Remove-Item Function:\Get-CimInstance,Function:\Stop-Process,Function:\Wait-Process
$parseErrors=$null
[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'installer\payload-transaction.ps1'),[ref]$null,[ref]$parseErrors)
Assert (-not $parseErrors.Count) 'Windows PowerShell could not parse the transaction script.'
[PSCustomObject]@{tests=$script:tests;fullSnapshotRollback=$true;interruptedUpdateRecovery=$true;userDataPreserved=$true;area=$area} | ConvertTo-Json
