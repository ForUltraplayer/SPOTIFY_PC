# @file test_bootstrap.ps1
# @brief Check bootstrap boundaries and reject malformed Spotify installers before execution.
param([string]$VerifiedInstaller)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$components=(Get-Content -LiteralPath (Join-Path $project 'components.json') -Raw | ConvertFrom-Json).components
$source=Join-Path $project 'installer\bootstrap.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$null,[ref]$errors)
if ($errors.Count) { throw 'Bootstrap parsing failed.' }
foreach ($name in @('Assert-AppDirectory','Assert-OwnedChild','Test-SpotifyInstaller','Get-Sha256','Get-ManagedApplyArguments','Invoke-SpotXPatch')) {
    $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $node.Extent.Text
}
$area=Join-Path $project ('work\bootstrap-unit-'+[Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $area)
$root=Join-Path $area 'empty app'
$marker=Join-Path $root 'install-marker.json'
[void](New-Item -ItemType Directory -Path $root)
$count=0
Assert-AppDirectory
$count++
'preserve' | Set-Content -LiteralPath (Join-Path $root 'user.txt')
$rejected=$false
try { Assert-AppDirectory } catch { $rejected=$true }
if (-not $rejected) { throw 'Nonempty unowned folder accepted.' }
$count++
'{"app":"SpotifyHangul"}' | Set-Content -LiteralPath $marker
Assert-AppDirectory
Assert-OwnedChild (Join-Path $root 'Spotify')
$count++
foreach ($path in @($root,(Split-Path -Parent $root),(Join-Path $root '..\sibling'))) {
    $rejected=$false
    try { Assert-OwnedChild $path } catch { $rejected=$true }
    if (-not $rejected) { throw 'Out-of-application path accepted.' }
    $count++
}
$file=Join-Path $area 'truncated.exe'
[IO.File]::WriteAllBytes($file,[byte[]]::new(1024))
$rejected=$false
try { Test-SpotifyInstaller $file } catch { $rejected=$_.Exception.Message -match '크기' }
if (-not $rejected) { throw 'Truncated installer accepted.' }
$count++
$stream=[IO.File]::OpenWrite($file)
try { $stream.SetLength($components.spotify.bytes) } finally { $stream.Dispose() }
$rejected=$false
try { Test-SpotifyInstaller $file } catch { $rejected=$_.Exception.Message -match 'SHA-256' }
if (-not $rejected) { throw 'Wrong installer digest accepted.' }
$count++
if ($VerifiedInstaller) { Test-SpotifyInstaller $VerifiedInstaller; $count++ }
foreach ($name in @('patch-functions.ps1','patch-calls.ps1')) {
    $patchAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project ('third_party\spotx\'+$name)),[ref]$null,[ref]$errors)
    if ($errors.Count) { throw 'Generated SpotX adapter parsing failed.' }
    $forbidden=@('Invoke-WebRequest','Invoke-RestMethod','Add-MpPreference','Remove-AppxPackage','Start-Process','Stop-Process','Read-Host','Set-ItemProperty','New-ItemProperty')
    $commands=$patchAst.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true)
    if (@($commands | Where-Object { $_.GetCommandName() -in $forbidden }).Count) { throw 'Unexpected operation in patch adapter.' }
    $count++
}
$entry=Join-Path $area 'nsis temporary files'
$prepared=Join-Path $area 'prepared app'
[void](New-Item -ItemType Directory -Path $entry)
Copy-Item -LiteralPath $source -Destination (Join-Path $entry 'bootstrap.ps1')
$nativePowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $nativePowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $entry 'bootstrap.ps1') -Mode Prepare -InstallRoot $prepared *> (Join-Path $area 'prepare-entry.log')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $prepared 'install-marker.json'))) {
    throw 'NSIS Prepare entry point must run with bootstrap.ps1 alone before payload extraction.'
}
$count++
$applyClient=Join-Path $area 'cli client'
[void](New-Item -ItemType Directory -Path (Join-Path $applyClient 'Apps'))
$applyIni=Join-Path $area 'cli-config.ini'
"[Backup]`r`nwith = 2.46.3`r`n" | Set-Content -LiteralPath $applyIni -Encoding UTF8
if (((Get-ManagedApplyArguments $applyClient $applyIni '2.46.4' $false) -join ' ') -ne '-n restore backup apply') { throw 'CLI upgrade must regenerate preprocessing.' }
$count++
"[Backup]`r`nwith = 2.46.4`r`n" | Set-Content -LiteralPath $applyIni -Encoding UTF8
if (((Get-ManagedApplyArguments $applyClient $applyIni '2.46.4' $false) -join ' ') -ne '-n apply') { throw 'Same CLI must reuse valid preprocessing.' }
$count++
if (((Get-ManagedApplyArguments $applyClient $applyIni '2.46.4' $true) -join ' ') -ne '-n restore backup apply') { throw 'New isolated state requires preprocessing.' }
$count++
'stock' | Set-Content -LiteralPath (Join-Path $applyClient 'Apps\xpui.spa')
if (((Get-ManagedApplyArguments $applyClient $applyIni '2.46.4' $false) -join ' ') -ne '-n backup apply') { throw 'Fresh stock must be backed up first.' }
$count++
# A SpotX failure must reach failure.txt whole; Windows reports it in the system language and wraps it over several lines.
$root=Join-Path $area 'spotx log'
[void](New-Item -ItemType Directory -Path $root)
$powershell=$nativePowerShell
$failingPatch=Join-Path $area 'failing-spotx.ps1'
@'
param([string]$StagingDirectory)
$ErrorActionPreference='Stop'
Write-Output ('patching '+$StagingDirectory)
throw ('En la línea del parche, el archivo de destino no está disponible '+('x'*120)+' fin del mensaje')
'@ | Set-Content -LiteralPath $failingPatch -Encoding UTF8
$failure=$null
try { Invoke-SpotXPatch $failingPatch 'staged client' } catch { $failure=$_.Exception.Message }
$log=Get-Content -LiteralPath (Join-Path $root 'spotx-install.log') -Raw
if (-not $failure -or ($failure -replace '\s','') -notmatch 'findelmensaje' -or ($log -replace '\s','') -notmatch 'findelmensaje' -or $log -notmatch 'patching staged client') {
    throw ('A SpotX failure lost its full message: '+$failure)
}
$count++
$passingPatch=Join-Path $area 'passing-spotx.ps1'
"param([string]`$StagingDirectory)`r`nWrite-Output 'SpotX archive and binary patches verified.'" | Set-Content -LiteralPath $passingPatch -Encoding UTF8
Invoke-SpotXPatch $passingPatch 'staged client'
if ((Get-Content -LiteralPath (Join-Path $root 'spotx-install.log') -Raw) -notmatch 'patches verified') { throw 'A successful SpotX run was not logged.' }
$count++
$root=$env:USERPROFILE
$marker=Join-Path $root 'install-marker.json'
$rejected=$false
try { Assert-AppDirectory } catch { $rejected=$true }
if (-not $rejected) { throw 'Profile root accepted.' }
$count++
# Windows PowerShell reads a BOM-less script in the ANSI code page, which broke en.ps1 on Spanish Windows (issue #1).
$patchAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'installer\spotx-patch.ps1'),[ref]$null,[ref]$null)
$langLoad=$patchAst.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$lang'},$true)
$SourceRoot=Join-Path $project 'third_party\spotx'
$lang=& ([scriptblock]::Create($langLoad.Right.Extent.Text))
if ([string]$lang.Welcome -notmatch [char]0x2554) { throw 'en.ps1 was not read as UTF-8.' }
$count++
# Scripts run by path must survive any ANSI code page; en.ps1 is read as UTF-8 above and upstream-run.ps1 is reference only.
$unsafe=@(@('installer','third_party\spotx','.') | ForEach-Object { Get-ChildItem -LiteralPath (Join-Path $project $_) -Filter '*.ps1' -File } | Where-Object {
    $bytes=[IO.File]::ReadAllBytes($_.FullName)
    $_.Name -notin @('en.ps1','upstream-run.ps1') -and -not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) -and @($bytes | Where-Object { $_ -ge 0x80 }).Count
})
if ($unsafe.Count) { throw ('Non-ASCII scripts without a UTF-8 BOM: '+($unsafe.Name -join ', ')) }
$count++
[PSCustomObject]@{tests=$count; malformedInstallerRejected=$true; externalPathsRejected=$true; patchOnlyAdapter=$true} | ConvertTo-Json
