# @file smoke-http.ps1
# @brief Exercise the published executable on a separate loopback port and clean up only the test process.
param([string]$Executable = "$PSScriptRoot\..\work\owned-overlay-build\SpotifyHangulOverlay.exe", [int]$Port = 15005)
$ErrorActionPreference = 'Stop'
if ($Port -eq 15000) { throw 'The smoke test must not use the production overlay port.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'The test port is already occupied.' }
$overlayTest = Start-Process -FilePath $Executable -ArgumentList @('--port', $Port, '--test-duration', '25') -WindowStyle Hidden -PassThru
$httpHandler = [System.Net.Http.HttpClientHandler]::new()
$httpHandler.UseProxy = $false
$http = [System.Net.Http.HttpClient]::new($httpHandler)
$http.Timeout = [TimeSpan]::FromSeconds(3)
$origin = 'https://xpui.app.spotify.com'
$results = [System.Collections.Generic.List[object]]::new()
function Request([string]$Method, [string]$Path, [string]$Body = '', [string]$Origin = $origin, [string]$Type = 'application/json') {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), "http://127.0.0.1:$Port$Path")
    if ($Origin) { $request.Headers.Add('Origin', $Origin) }
    if ($Method -eq 'POST') { $request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, $Type) }
    try {
        $response = $http.SendAsync($request).GetAwaiter().GetResult()
        try { return @{ Status = [int]$response.StatusCode; Body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult(); Cors = [string]$response.Headers.GetValues('Access-Control-Allow-Origin') } }
        catch [System.InvalidOperationException] { return @{ Status = [int]$response.StatusCode; Body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult(); Cors = '' } }
        finally { $response.Dispose() }
    } finally { $request.Dispose() }
}
function Check([string]$Name, [bool]$Passed) { $results.Add(@{name=$Name;passed=$Passed}); if (!$Passed) { throw "Failed: $Name" } }
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 35; $attempt++) {
        try { $health = Request 'GET' '/health'; if ($health.Status -eq 200) { $ready = $true; break } } catch { }
        if ($overlayTest.HasExited) { throw "Overlay exited: $($overlayTest.ExitCode)" }
        Start-Sleep -Milliseconds 200
    }
    Check 'health-identifies-owned-overlay' ($ready -and (($health.Body | ConvertFrom-Json).application -eq 'SpotifyHangulOverlay'))
    Check 'approved-origin-cors' ($health.Cors -eq $origin)
    $denied = Request 'POST' '/progress' '{"position":0,"isPlaying":false}' 'https://untrusted.example'
    Check 'untrusted-origin-rejected' ($denied.Status -eq 403)
    $missing = Request 'POST' '/progress' '{"position":0,"isPlaying":false}' ''
    Check 'mutation-requires-origin' ($missing.Status -eq 403)
    $malformed = Request 'POST' '/lyrics' '{broken'
    Check 'malformed-json-rejected' ($malformed.Status -eq 400)
    $wrongType = Request 'POST' '/lyrics' '{}' $origin 'text/plain'
    Check 'non-json-content-rejected' ($wrongType.Status -eq 415)
    $uri = 'youtube:video:abcdefghijk'
    $lyrics = @{trackUri=$uri;track=@{title='독립 오버레이 검증';artist='원문과 한글 발음';duration=180000};lyrics=@(@{startTime=-5300;text='原文';pronText='한글 발음';transText='번역 문장'},@{startTime=18240;text='두 번째 문장';pronText='발음 확인';transText='번역 확인'});isSynced=$true} | ConvertTo-Json -Depth 10 -Compress
    $accepted = Request 'POST' '/lyrics' $lyrics
    Check 'upstream-lyrics-payload-accepted' ($accepted.Status -eq 200 -and ($accepted.Body | ConvertFrom-Json).accepted)
    $progress = Request 'POST' '/progress' '{"trackUri":"youtube:video:abcdefghijk","position":19000,"isPlaying":false,"duration":180000}'
    Check 'paused-progress-payload-accepted' ($progress.Status -eq 200)
    $probe = Request 'POST' '/progress' '{"position":0,"isPlaying":false}'
    Check 'connection-probe-accepted' ($probe.Status -eq 200)
    $changed = Request 'POST' '/progress' '{"trackUri":"spotify:track:1234567890123456789012","position":0,"isPlaying":false,"duration":180000}'
    $late = Request 'POST' '/lyrics' $lyrics
    Check 'late-previous-track-ignored' ($late.Status -eq 200 -and !(($late.Body | ConvertFrom-Json).accepted))
    $pair = Request 'POST' '/playback-config' '{"bridgeUrl":"http://evil.example","token":"abcdefghijklmnopqrstuvwxyz123456","expiresAt":9999999999999}'
    Check 'foreign-broker-rejected' ($pair.Status -eq 400)
    $huge = Request 'POST' '/lyrics' (' ' * (2 * 1024 * 1024 + 1))
    Check 'oversized-body-rejected' ($huge.Status -eq 413)
    Check 'still-alive-after-malformed-payloads' ((Request 'GET' '/health').Status -eq 200)
    $overlayTest.WaitForExit(30000) | Out-Null
    Check 'timed-test-shutdown' $overlayTest.HasExited
    Start-Sleep -Milliseconds 200
    Check 'listener-released' (!(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue))
    $results | ConvertTo-Json -Depth 4
} finally {
    if (!$overlayTest.HasExited) { Stop-Process -Id $overlayTest.Id -ErrorAction SilentlyContinue }
    $overlayTest.Dispose(); $http.Dispose(); $httpHandler.Dispose()
}
