# @file start_youtube_dev.ps1
# @author: ForUltraplayer
# @brief Launch the requested experimental link player using the existing Spotify client and source helper without startup registration.
param([switch]$Restart)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$client=Join-Path $env:APPDATA 'Spotify\Spotify.exe'
$extension=Join-Path $env:APPDATA 'Spotify\Apps\xpui\extensions\hangul-lyrics.js'
$bridge=Join-Path $project 'bridge.py'
if(-not(Test-Path -LiteralPath $client) -or -not(Test-Path -LiteralPath $extension)){throw '기존 Spotify와 한글 가사 확장이 있는 개발 PC에서 실행해 주세요.'}
$area=Join-Path $project 'work\youtube-development'
[void](New-Item -ItemType Directory -Path $area -Force)
$installed=[IO.File]::ReadAllText($extension)
$source=[IO.File]::ReadAllText((Join-Path $project 'hangul-lyrics.js'))
$marker='/* SpotifyHangul YouTube development loader */'
if(-not $installed.StartsWith($source+[Environment]::NewLine) -and -not $installed.StartsWith($source+"`n")){
    $backup=Join-Path $area ('hangul-lyrics-before-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.js')
    $before=Get-Item -LiteralPath $extension
    Copy-Item -LiteralPath $extension -Destination $backup
    @{path=$extension;backup=$backup;sha256=(Get-FileHash -LiteralPath $backup).Hash;lastWriteTimeUtc=$before.LastWriteTimeUtc.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $area 'loader-backup.json') -Encoding UTF8
    $loader=@'

/* SpotifyHangul YouTube development loader */
(() => {
    if (window.SpotifyHangulLinks) return;
    const script = document.createElement('script');
    script.src = 'http://127.0.0.1:19643/youtube/extension.js';
    script.onerror = () => console.warn('[SpotifyHangul] Link player helper is unavailable. Start with scripts/start_youtube_dev.ps1.');
    document.head.append(script);
})();
'@
    [IO.File]::WriteAllText($extension,$source+$loader,[Text.UTF8Encoding]::new($false))
}
$health=$null
try{$health=Invoke-RestMethod 'http://127.0.0.1:19643/health' -TimeoutSec 2}catch{}
if($health){
    $helper=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$health.pid)
    if($health.app -ne 'ivLyricsHangul' -or -not $helper.CommandLine.Contains($bridge)){throw '다른 한글 가사 도우미가 실행 중입니다. 해당 Spotify와 도우미를 종료한 뒤 다시 실행해 주세요.'}
}else{
    $python=(Get-Command python -ErrorAction Stop).Source
    $helper=Start-Process -FilePath $python -ArgumentList @('-u',('"'+$bridge+'"')) -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $area 'helper.log') -RedirectStandardError (Join-Path $area 'helper-error.log')
    $helper.Id | Set-Content -LiteralPath (Join-Path $area 'helper.pid')
    for($attempt=0;$attempt -lt 20;$attempt++){
        Start-Sleep -Milliseconds 250
        try{$health=Invoke-RestMethod 'http://127.0.0.1:19643/health' -TimeoutSec 1;break}catch{}
    }
    if(-not $health){throw '링크 음악 도우미를 시작하지 못했습니다. work/youtube-development/helper-error.log를 확인해 주세요.'}
}
if($Restart){
    Get-CimInstance Win32_Process -Filter "name='Spotify.exe'" | Where-Object ExecutablePath -eq $client | ForEach-Object{Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}
}
Start-Process -FilePath $client -WindowStyle Normal
Write-Output 'Spotify 플레이리스트의 YouTube 링크 추가 버튼으로 개발 기능을 사용하세요. Spotify 종료 후 도우미도 자동 종료됩니다.'
