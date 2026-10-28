# @file test_installer.ps1
# @brief Verify installer directory boundaries and helper process ownership without touching live applications.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$hook = Join-Path $project 'installer\integrate.ps1'
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($hook, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Installer hook did not parse.' }
foreach ($name in @('Assert-AppDirectory','Stop-OwnHelper','Get-ApplyArguments')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw ('Missing function: ' + $name) }
    Invoke-Expression $definition.Extent.Text
}
$testArea = Join-Path $project 'work\installer-unit-tests'
New-Item -ItemType Directory -Path $testArea -Force | Out-Null
$passed = 0
$root = Join-Path $testArea ('empty app directory ' + [Guid]::NewGuid().ToString('N'))
$marker = Join-Path $root 'install-marker.json'
New-Item -ItemType Directory -Path $root -Force | Out-Null
Assert-AppDirectory
$passed++
$sentinel = Join-Path $root 'user-data.txt'
'preserve' | Set-Content -LiteralPath $sentinel -Encoding UTF8
$rejected = $false
try { Assert-AppDirectory } catch { $rejected = $true }
if (-not $rejected -or (Get-Content -LiteralPath $sentinel -Raw).Trim() -ne 'preserve') { throw 'Unowned directory was not preserved.' }
$passed++
'{"app":"SpotifyHangul"}' | Set-Content -LiteralPath $marker -Encoding UTF8
Assert-AppDirectory
$passed++
[void](New-Item -ItemType Directory -Path (Join-Path $root 'Apps') -Force)
if (((Get-ApplyArguments (Join-Path $root 'Spotify.exe')) -join ' ') -ne '-n apply') { throw 'Applied Spotify must reuse its backup.' }
$passed++
[IO.File]::WriteAllText((Join-Path $root 'Apps\xpui.spa'), 'original archive')
if (((Get-ApplyArguments (Join-Path $root 'Spotify.exe')) -join ' ') -ne '-n backup apply') { throw 'Stock Spotify must be backed up before applying.' }
$passed++
$root = $env:USERPROFILE
$marker = Join-Path $root 'install-marker.json'
$rejected = $false
try { Assert-AppDirectory } catch { $rejected = $true }
if (-not $rejected) { throw 'User profile root accepted.' }
$passed++
$root = Join-Path $testArea 'owned app'
$script:stopped = @()
$script:mockCommand = 'pythonw.exe -u "' + (Join-Path $root 'bridge.py') + '"'
function Invoke-RestMethod { param($Uri,$TimeoutSec) return [PSCustomObject]@{ app='ivLyricsHangul'; pid=1234 } }
function Get-CimInstance { param($ClassName,$Filter) return [PSCustomObject]@{ CommandLine=$script:mockCommand } }
function Get-ItemProperty { param($LiteralPath,$ErrorAction) return $null }
function Stop-Process { param($Id) $script:stopped += $Id }
Stop-OwnHelper
if ($script:stopped.Count -ne 1 -or $script:stopped[0] -ne 1234) { throw 'Verified helper was not stopped.' }
$passed++
$script:stopped = @()
$script:mockCommand = 'pythonw.exe -u "J:\unrelated-app\bridge.py"'
$rejected = $false
try { Stop-OwnHelper } catch { $rejected = $true }
if (-not $rejected -or $script:stopped.Count) { throw 'Unrelated process was accepted.' }
$passed++
[PSCustomObject]@{ tests=$passed; directoryBoundariesVerified=$true; unrelatedProcessPreserved=$true } | ConvertTo-Json
