# @file stop.ps1
# @brief Stop only the verified local Hangul lyric reader, without changing startup settings.
$ErrorActionPreference = 'Stop'
# Korean on Korean Windows, English elsewhere; SPOTIFYHANGUL_LANGUAGE (ko or en) overrides it.
$useKorean = if ($env:SPOTIFYHANGUL_LANGUAGE) { $env:SPOTIFYHANGUL_LANGUAGE -eq 'ko' } else { (Get-UICulture).TwoLetterISOLanguageName -eq 'ko' }

function Get-Text([string]$Korean, [string]$English) { if ($useKorean) { return $Korean }; return $English }

$health = Invoke-RestMethod -Uri 'http://127.0.0.1:19643/health' -TimeoutSec 2
$helper = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $health.pid)
$expectedScript = Join-Path $PSScriptRoot 'bridge.py'
if ($health.app -ne 'ivLyricsHangul' -or -not $helper.CommandLine.Contains($expectedScript)) {
    throw (Get-Text '한글 발음 도우미의 실행 정보를 확인하지 못했습니다.' 'Could not confirm the Hangul lyrics helper process information.')
}
Stop-Process -Id $health.pid
Write-Output (Get-Text '한글 발음 도우미를 종료했습니다.' 'The Hangul lyrics helper was stopped.')
