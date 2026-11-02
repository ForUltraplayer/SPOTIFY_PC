# @file webview-auth.ps1
# @brief The sign-in window of Myspoti extensions (myspoti.auth.open): one WebView2 page with the extension's own cookies; only the callback address goes back.
# Started by the extension runner while one sign-in is open, never otherwise. The request comes as one JSON line on stdin:
#   {"url":"https://…","callback":"myext://done","hidden":true,"profile":"<folder>","name":"<extension name>","hiddenMs":8000,"timeoutMs":180000}
# The answer is one JSON line on stdout, {"url":"<the address that reached the callback>"} or {"error":"<key>"}, then the window closes.
# Keys: closed (the user closed it), timeout, network: <WebErrorStatus>, webview2-missing (no runtime, even after Microsoft's
# installer was fetched and run), webview2-failed: <detail>, helper-failed: <detail>. Nothing of the page is written anywhere else: no address, no cookie.
# stdin closing (the runner ended) closes the window without an answer.
param([string]$Parts = (Join-Path $PSScriptRoot 'extensions\webview2'))
$ErrorActionPreference = 'Stop'
# Korean on Korean Windows, English elsewhere; SPOTIFYHANGUL_LANGUAGE (ko or en) overrides it for tests.
$useKorean = if ($env:SPOTIFYHANGUL_LANGUAGE) { $env:SPOTIFYHANGUL_LANGUAGE -eq 'ko' } else { (Get-UICulture).TwoLetterISOLanguageName -eq 'ko' }
function Get-Text([string]$Korean, [string]$English) { if ($useKorean) { return $Korean }; return $English }

$utf8 = New-Object Text.UTF8Encoding($false)
$stdout = [Console]::OpenStandardOutput()
$script:sent = $false
function Send-Result($Value) {
    if ($script:sent) { return }
    $script:sent = $true
    $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject $Value -Compress) + "`n")
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput(), $utf8)
try {
    $request = $stdin.ReadLine() | ConvertFrom-Json
    if (-not $request.url -or -not $request.callback -or -not $request.profile) { throw 'incomplete request' }
} catch { Send-Result @{ error = 'helper-failed: bad request' }; exit 2 }
$callback = [string]$request.callback
$hiddenMs = if ($request.hiddenMs) { [int]$request.hiddenMs } else { 8000 }
$timeoutMs = if ($request.timeoutMs) { [int]$request.timeoutMs } else { 180000 }
$name = if ($request.name) { [string]$request.name } else { 'Extension' }

# AuthRequest.reached of the engine: the address starts with the callback, and the callback ends there or at ? # / &.
function Test-Reached([string]$Address) {
    if (-not $Address -or -not $Address.StartsWith($callback, [StringComparison]::Ordinal)) { return $false }
    if ($Address.Length -eq $callback.Length) { return $true }
    return '?#/&'.IndexOf($Address[$callback.Length]) -ge 0 -or '?#/&='.IndexOf($callback[$callback.Length - 1]) -ge 0
}

# The loader is native: where Windows PowerShell runs as an ARM64 process (ARM64 Windows), it takes the ARM64 one.
$loader = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Join-Path $Parts 'arm64' } else { $Parts }
$files = (Join-Path $Parts 'Microsoft.Web.WebView2.Core.dll'), (Join-Path $Parts 'Microsoft.Web.WebView2.WinForms.dll'), (Join-Path $loader 'WebView2Loader.dll')
if ($files | Where-Object { -not (Test-Path -LiteralPath $_) }) { Send-Result @{ error = 'helper-failed: WebView2 parts missing' }; exit 3 }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Path (Join-Path $Parts 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $Parts 'Microsoft.Web.WebView2.WinForms.dll')
[Microsoft.Web.WebView2.Core.CoreWebView2Environment]::SetLoaderDllFolderPath($loader)

function Get-RuntimeVersion {
    try { return [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString() } catch { return $null }
}
if (-not (Get-RuntimeVersion)) {
    # The Evergreen runtime is part of Windows 11 and most Windows 10. Where it is missing, Microsoft's bootstrapper is fetched
    # from Microsoft (it is not shipped: its licence asks a redistributor for terms this project does not set), run only when
    # Microsoft signed it, and installs the runtime (per user when not elevated); the window is tried once more.
    $setup = Join-Path ([IO.Path]::GetTempPath()) ('MicrosoftEdgeWebview2Setup-' + [Guid]::NewGuid().ToString('N') + '.exe')
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $setup -UseBasicParsing -TimeoutSec 120
        $signature = Get-AuthenticodeSignature -LiteralPath $setup
        if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match '(^|,\s*)O="?Microsoft Corporation"?(,|$)') {
            $installer = Start-Process -FilePath $setup -ArgumentList '/silent', '/install' -PassThru -WindowStyle Hidden
            if (-not $installer.WaitForExit(600000)) { $installer.Kill() }
        }
    } catch {}
    finally { Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue }
    if (-not (Get-RuntimeVersion)) { Send-Result @{ error = 'webview2-missing' }; exit 0 }
}

[Windows.Forms.Application]::EnableVisualStyles()
$scale = [Math]::Max(1.0, [Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height / 1080.0)
$form = New-Object Windows.Forms.Form
$form.Text = Get-Text "${name}: 로그인" "${name}: sign in"
$form.ClientSize = New-Object Drawing.Size([int](520 * $scale), [int](720 * $scale))
$form.StartPosition = 'Manual'
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object Drawing.Point(($area.Left + [int](($area.Width - $form.Width) / 2)), ($area.Top + [int](($area.Height - $form.Height) / 2)))
$hidden = $request.hidden -eq $true
# Hidden, the page first lives in a borderless window of the same size beside every screen, out of the taskbar: its scripts
# run as on screen, never seen. Showing it moves the very same control (nothing reloaded) into the sign-in window. Moving a
# window into the taskbar instead would recreate it and end the page.
$cover = $null
if ($hidden) {
    $cover = New-Object Windows.Forms.Form
    $cover.FormBorderStyle = 'None'
    $cover.ShowInTaskbar = $false
    $cover.StartPosition = 'Manual'
    $cover.ClientSize = $form.ClientSize
    $cover.Location = New-Object Drawing.Point(([Windows.Forms.SystemInformation]::VirtualScreen.Right + 200), $area.Top)
}

$notice = New-Object Windows.Forms.Label
$notice.Dock = 'Top'
$notice.AutoSize = $false
$notice.Height = [int](52 * $scale)
$notice.Padding = New-Object Windows.Forms.Padding([int](10 * $scale), [int](6 * $scale), [int](10 * $scale), [int](4 * $scale))
$notice.Text = Get-Text '별도 창입니다. 입력한 내용과 쿠키는 이 확장의 로그인 창에만 남습니다. 확장은 페이지가 마지막에 도착한 주소만 받습니다.' 'A window of its own: what you type and its cookies stay in this extension''s sign-in window. The extension only gets the address the page ends on.'
$hostLine = New-Object Windows.Forms.Label
$hostLine.Dock = 'Top'
$hostLine.Height = [int](22 * $scale)
$hostLine.Padding = New-Object Windows.Forms.Padding([int](10 * $scale), [int](2 * $scale), [int](10 * $scale), 0)
$hostLine.ForeColor = [Drawing.SystemColors]::GrayText
$form.Controls.Add($hostLine)
$form.Controls.Add($notice)
$context = New-Object Windows.Forms.ApplicationContext

$script:finished = $false
function Complete($Result) {
    if ($script:finished) { return }
    $script:finished = $true
    Send-Result $Result
    $context.ExitThread()
}
function Set-HostLine([string]$Address) {
    try { $hostLine.Text = ([Uri]$Address).Host } catch {}
}
$web = { param([string]$Address) try { return ([Uri]$Address).Scheme -in 'https', 'http' } catch { return $false } }

$onReady = {
    param($sender, $e)
    if (-not $e.IsSuccess) {
        # Right after another sign-in of the same extension its browser may still be ending on this profile: tried again.
        if ($script:attempts -lt 3) { $script:retryAt = $clock.ElapsedMilliseconds + 1000; return }
        Complete @{ error = 'webview2-failed: 0x{0:X8}' -f $e.InitializationException.HResult }; return
    }
    $core = $sender.CoreWebView2
    $core.Settings.AreDevToolsEnabled = $false
    $core.Settings.AreHostObjectsAllowed = $false
    $core.Settings.IsWebMessageEnabled = $false
    # The callback, reached by a link, a redirect, a form or a frame: the page closes on it and the address goes back.
    # Only web pages load here: no other app, file or scheme is opened from the page.
    $core.add_NavigationStarting({
        param($s, $a)
        if (Test-Reached $a.Uri) { $a.Cancel = $true; Complete @{ url = $a.Uri }; return }
        if (-not (& $web $a.Uri) -and -not $a.Uri.StartsWith('about:')) { $a.Cancel = $true; return }
        Set-HostLine $a.Uri
    })
    $core.add_FrameNavigationStarting({
        param($s, $a)
        if (Test-Reached $a.Uri) { $a.Cancel = $true; Complete @{ url = $a.Uri }; return }
        if (-not (& $web $a.Uri) -and -not $a.Uri.StartsWith('about:')) { $a.Cancel = $true }
    })
    # window.open: no second window; the address is the callback (done) or loads here.
    $core.add_NewWindowRequested({
        param($s, $a)
        $a.Handled = $true
        if (Test-Reached $a.Uri) { Complete @{ url = $a.Uri } } elseif (& $web $a.Uri) { $s.Navigate($a.Uri) }
    })
    try {
        $core.add_LaunchingExternalUriScheme({
            param($s, $a)
            $a.Cancel = $true
            if (Test-Reached $a.Uri) { Complete @{ url = $a.Uri } }
        })
    } catch {}
    # The page itself cannot be loaded (no network, no such host): the sign-in ends. A check's HTTP status (403, 503 of a
    # challenge page) is not an error, the page goes on.
    $core.add_NavigationCompleted({
        param($s, $a)
        if ($script:finished -or $a.IsSuccess) { return }
        $status = [string]$a.WebErrorStatus
        if ($status -in 'OperationCanceled', 'Unknown') { return }
        try { if ($a.HttpStatusCode -gt 0) { return } } catch {}
        Complete @{ error = "network: $status" }
    })
    $core.add_PermissionRequested({ param($s, $a) $a.State = [Microsoft.Web.WebView2.Core.CoreWebView2PermissionState]::Deny })
    $core.add_DownloadStarting({ param($s, $a) $a.Cancel = $true })
    $core.add_ProcessFailed({
        param($s, $a)
        if ([string]$a.ProcessFailedKind -eq 'BrowserProcessExited') { Complete @{ error = 'webview2-failed: browser process ended' } }
    })
    Set-HostLine ([string]$request.url)
    $core.Navigate([string]$request.url)
}
$script:view = $null
$script:attempts = 0
$script:retryAt = -1
function Start-View {
    if ($script:view) { $script:view.Parent.Controls.Remove($script:view); $script:view.Dispose() }
    $script:attempts++
    $view = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $view.Dock = 'Fill'
    $properties = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $properties.UserDataFolder = [string]$request.profile
    $view.CreationProperties = $properties
    $view.add_CoreWebView2InitializationCompleted($onReady)
    if ($cover -and $cover.Visible) { $cover.Controls.Add($view) } else { $form.Controls.Add($view); $view.BringToFront() }
    $script:view = $view
    try { $null = $view.EnsureCoreWebView2Async($null) } catch { Complete @{ error = 'webview2-failed: ' + $_.Exception.GetType().Name } }
}

$form.add_FormClosing({
    param($sender, $e)
    if (-not $script:finished) { Complete @{ error = 'closed' } }
})

# Started by a background process, the window may not take the focus: it is put above the other windows once (not kept on
# top) so it is not left behind Spotify.
function Show-OnTop {
    $form.TopMost = $true
    $form.TopMost = $false
    $form.Activate()
}

$clock = [Diagnostics.Stopwatch]::StartNew()
$script:ended = $stdin.ReadLineAsync()
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.add_Tick({
    # The runner ended (its end of stdin closed): the window goes, nobody waits for an answer.
    if ($script:ended.IsCompleted) {
        if ($script:ended.Status -eq 'RanToCompletion' -and $null -ne $script:ended.Result) { $script:ended = $stdin.ReadLineAsync() }
        else { $script:sent = $true; $script:finished = $true; $context.ExitThread(); return }
    }
    if ($script:retryAt -ge 0 -and $clock.ElapsedMilliseconds -ge $script:retryAt) { $script:retryAt = -1; Start-View }
    if ($cover -and $cover.Visible -and $clock.ElapsedMilliseconds -ge $hiddenMs) {
        $form.Controls.Add($script:view)
        $script:view.BringToFront()
        $form.Show()
        $cover.Hide()
        Show-OnTop
    }
    if ($clock.ElapsedMilliseconds -ge $timeoutMs) { Complete @{ error = 'timeout' } }
})
$first = if ($hidden) { $cover } else { $form }
$first.add_Shown({
    $timer.Start()
    Start-View
    if (-not $hidden) { Show-OnTop }
})
try {
    $first.Show()
    [Windows.Forms.Application]::Run($context)
} catch {
    Send-Result @{ error = 'helper-failed: ' + $_.Exception.GetType().Name }
} finally {
    $timer.Stop()
    if ($script:view) { $script:view.Dispose() }
    $form.Dispose()
    if ($cover) { $cover.Dispose() }
}
exit 0
