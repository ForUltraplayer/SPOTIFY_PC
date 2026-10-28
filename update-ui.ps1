# @file update-ui.ps1
# @author: ForUltraplayer
# @brief Show the update prompt, download progress and installation status windows used by auto-update.ps1.
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$updateUiFont=New-Object Drawing.Font('Malgun Gothic',9.75)

function Show-UpdateDialog([string]$Text,[Drawing.Icon]$Icon,[string[]]$Buttons) {
    # A custom TopMost form instead of MessageBox: Spotify opens at the same time and would cover a plain box.
    $form=New-Object Windows.Forms.Form -Property @{Text='Spotify 한글 가사 업데이트';Font=$updateUiFont;FormBorderStyle='FixedDialog';MaximizeBox=$false;MinimizeBox=$false;StartPosition='CenterScreen';TopMost=$true;AutoSize=$true;AutoSizeMode='GrowAndShrink'}
    $layout=New-Object Windows.Forms.TableLayoutPanel -Property @{ColumnCount=2;RowCount=2;AutoSize=$true;AutoSizeMode='GrowAndShrink';Padding=(New-Object Windows.Forms.Padding 14)}
    $layout.Controls.Add((New-Object Windows.Forms.PictureBox -Property @{Image=$Icon.ToBitmap();SizeMode='AutoSize';Margin=(New-Object Windows.Forms.Padding 0,0,12,0)}),0,0)
    $layout.Controls.Add((New-Object Windows.Forms.Label -Property @{Text=$Text;AutoSize=$true;MaximumSize=(New-Object Drawing.Size 440,0);Margin=(New-Object Windows.Forms.Padding 0,4,0,16)}),1,0)
    $row=New-Object Windows.Forms.FlowLayoutPanel -Property @{FlowDirection='RightToLeft';AutoSize=$true;AutoSizeMode='GrowAndShrink';Anchor='Right';Margin=(New-Object Windows.Forms.Padding 0)}
    # Right-to-left flow: add the last button first so the first one stays on the left.
    foreach ($index in ($Buttons.Count-1)..0) {
        $button=New-Object Windows.Forms.Button -Property @{Text=$Buttons[$index];Tag=$index;AutoSize=$true;MinimumSize=(New-Object Drawing.Size 88,30)}
        $button.Add_Click({ $owner=$this.FindForm(); $owner.Tag=$this.Tag; $owner.Close() })
        $row.Controls.Add($button)
        if ($index -eq 0) { $form.AcceptButton=$button }
    }
    $layout.Controls.Add($row,0,1)
    $layout.SetColumnSpan($row,2)
    $form.Controls.Add($layout)
    $form.Add_Shown({ $this.Activate() })
    [void]$form.ShowDialog()
    $choice=$form.Tag
    $form.Dispose()
    # $null when the title bar close button dismissed the dialog.
    return $choice
}

function Show-UpdatePrompt([string]$Version,[string]$CurrentVersion) {
    # Korean subject particle follows the spoken last digit (2 이, 4 사, 5 오, 9 구 end in a vowel).
    $particle=if ('2459'.Contains([string]$Version[-1])) { '가' } else { '이' }
    $text='새 버전 '+$Version+$particle+" 있습니다. 지금 업데이트할까요?`r`n`r`n현재 버전: "+$CurrentVersion+"`r`n내려받는 동안 음악은 계속 들을 수 있습니다.`r`n설치할 때 Spotify가 잠시 종료되고, 끝나면 다시 실행됩니다."
    return (Show-UpdateDialog $text ([Drawing.SystemIcons]::Question) @('예','아니요')) -eq 0
}

function Show-UpdateMessage([string]$Text,[switch]$IsError) {
    [void](Show-UpdateDialog $Text $(if ($IsError) { [Drawing.SystemIcons]::Error } else { [Drawing.SystemIcons]::Information }) @('확인'))
}

function Open-UpdateWindow {
    # No title bar close button: cancelling is only offered while it is still safe (download and the notice).
    $form=New-Object Windows.Forms.Form -Property @{Text='Spotify 한글 가사 업데이트';Font=$updateUiFont;FormBorderStyle='FixedDialog';ControlBox=$false;StartPosition='CenterScreen';TopMost=$true;ClientSize=(New-Object Drawing.Size 460,150)}
    $status=New-Object Windows.Forms.Label -Property @{Location=(New-Object Drawing.Point 16,14);Size=(New-Object Drawing.Size 428,44)}
    $bar=New-Object Windows.Forms.ProgressBar -Property @{Location=(New-Object Drawing.Point 16,62);Size=(New-Object Drawing.Size 428,22);Maximum=1000;MarqueeAnimationSpeed=30}
    $detail=New-Object Windows.Forms.Label -Property @{Location=(New-Object Drawing.Point 16,96);Size=(New-Object Drawing.Size 320,22)}
    $cancel=New-Object Windows.Forms.Button -Property @{Text='취소';Location=(New-Object Drawing.Point 356,106);Size=(New-Object Drawing.Size 88,30)}
    $cancel.Add_Click({ $this.Tag='canceled'; $this.Enabled=$false })
    $form.Controls.AddRange(@($status,$bar,$detail,$cancel))
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    return [PSCustomObject]@{Form=$form;Status=$status;Bar=$bar;Detail=$detail;Cancel=$cancel}
}

function Set-UpdateWindow($Window,[string]$Status,[double]$Percent=-1,[string]$Detail='',[switch]$AllowCancel) {
    if ($Status) { $Window.Status.Text=$Status }
    # A negative percentage means the duration is unknown (verification, closing Spotify, installing).
    if ($Percent -lt 0) { $Window.Bar.Style='Marquee' }
    else { $Window.Bar.Style='Continuous'; $Window.Bar.Value=[int][Math]::Min(1000,[Math]::Max(0,$Percent*10)) }
    $Window.Detail.Text=$Detail
    $Window.Cancel.Visible=[bool]$AllowCancel
    [Windows.Forms.Application]::DoEvents()
}

function Wait-UpdateWindow($Window,[int]$Milliseconds) {
    # Keep the window painting (and the marquee moving) while the caller waits; report a cancel click.
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30 } while ($clock.ElapsedMilliseconds -lt $Milliseconds)
    return $Window.Cancel.Tag -eq 'canceled'
}

function Close-UpdateWindow($Window) {
    if (-not $Window.Form.IsDisposed) { $Window.Form.Close(); $Window.Form.Dispose() }
}

function Save-UpdateDownload($Window,[string]$Uri,[string]$OutFile,[long]$Size) {
    # Stream the file on the window's thread so progress and the cancel button stay live without a runspace.
    $request=[Net.HttpWebRequest]::Create($Uri)
    $request.UserAgent='SpotifyHangul-Updater'
    $request.Timeout=30000
    $request.ReadWriteTimeout=60000
    $response=$request.GetResponse()
    $source=$response.GetResponseStream()
    $target=[IO.File]::Create($OutFile)
    try {
        $buffer=New-Object byte[] 65536
        $received=0L
        $clock=[Diagnostics.Stopwatch]::StartNew()
        while (($read=$source.Read($buffer,0,$buffer.Length)) -gt 0) {
            $received+=$read
            # The release API fixed the size; stop a response that keeps going instead of filling the disk.
            if ($received -gt $Size) { throw '내려받은 업데이트가 공개된 크기보다 큽니다.' }
            $target.Write($buffer,0,$read)
            [Windows.Forms.Application]::DoEvents()
            if ($Window.Cancel.Tag -eq 'canceled') { return $false }
            if ($clock.ElapsedMilliseconds -ge 150 -or $received -eq $Size) {
                $clock.Restart()
                Set-UpdateWindow $Window $null ($received*100/$Size) ('{0:N1} / {1:N1} MB ({2}%)' -f ($received/1MB),($Size/1MB),[Math]::Floor($received*100/$Size)) -AllowCancel
            }
        }
    } finally { $target.Dispose(); $source.Dispose(); $response.Dispose() }
    return $true
}
