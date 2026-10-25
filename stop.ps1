# @file stop.ps1
# @author: ForUltraplayer
# @brief Stop only the verified local Hangul lyric reader, without changing startup settings.
$ErrorActionPreference = 'Stop'
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:19643/health' -TimeoutSec 2
$helper = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $health.pid)
$expectedScript = Join-Path $PSScriptRoot 'bridge.py'
if ($health.app -ne 'ivLyricsHangul' -or -not $helper.CommandLine.Contains($expectedScript)) {
    throw '한글 발음 도우미의 실행 정보를 확인하지 못했습니다.'
}
Stop-Process -Id $health.pid
Write-Output '한글 발음 도우미를 종료했습니다.'
