// @file OverlayWindow.cs
// @brief Render native desktop lyrics with transparent locking, safe controls and owned preferences.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace SpotifyHangulOverlay;

internal sealed class OverlayWindow : Window
{
    private readonly OverlayServer server;
    private readonly Settings preferences;
    private readonly bool isolated;
    private readonly bool exitWithSpotify;
    private readonly DispatcherTimer ticker = new() { Interval = TimeSpan.FromMilliseconds(50) };
    private readonly Border surface = new() { CornerRadius = new CornerRadius(12), Padding = new Thickness(15), BorderThickness = new Thickness(1), BorderBrush = new SolidColorBrush(Color.FromArgb(50, 255, 255, 255)) };
    private readonly Grid content = new();
    private readonly StackPanel toolbar = new() { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel linePanel = new();
    private readonly ScrollViewer scroller = new() { VerticalScrollBarVisibility = ScrollBarVisibility.Hidden, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
    private readonly TextBlock title = new() { Foreground = Brushes.White, FontSize = 14, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TextBlock artist = new() { Foreground = Brushes.LightGray, FontSize = 11, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly TextBlock status = new() { Foreground = Brushes.LightGray, FontSize = 10, HorizontalAlignment = HorizontalAlignment.Right, Text = "Spotify 연결 대기" };
    private readonly Image cover = new() { Width = 36, Height = 36, Margin = new Thickness(0, 0, 10, 0), Stretch = Stretch.UniformToFill };
    private readonly List<(StackPanel Panel, TextBlock Original, TextBlock Phonetic, TextBlock Translation)> rows = new();
    private readonly List<Button> playbackButtons = new();
    private readonly Button toggle;
    private readonly HttpClient images = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(5) };
    private readonly CancellationTokenSource lifetime = new();
    private CancellationTokenSource? imageCancellation;
    private Forms.NotifyIcon? tray;
    private System.Drawing.Icon? trayIcon;
    private nint handle;
    private bool clickThrough;
    private int version = -1, activeLine = -2;
    private string? currentArt, currentUri;
    private long frameAt, missingSince, lastProcessCheck;
    private readonly long startedAt = Environment.TickCount64;
    private bool closing, commandPending;
    private Window? settingsWindow;

    public OverlayWindow(OverlayServer server, bool isolated, bool exitWithSpotify)
    {
        this.server = server; this.isolated = isolated; this.exitWithSpotify = exitWithSpotify;
        preferences = isolated ? new Settings { Left = 150, Top = 150 } : Settings.Load();
        Title = "한글 가사 오버레이"; Width = preferences.Width; Height = preferences.Height;
        Left = preferences.Left; Top = preferences.Top; MinWidth = 360; MinHeight = 200;
        WindowStyle = WindowStyle.None; AllowsTransparency = true; Background = Brushes.Transparent;
        ShowInTaskbar = false; Topmost = preferences.Topmost;
        ResizeMode = ResizeMode.CanResizeWithGrip;
        if (Left + Width < SystemParameters.VirtualScreenLeft || Left > SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth || Top + Height < SystemParameters.VirtualScreenTop || Top > SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight)
        { Left = SystemParameters.WorkArea.Left + 60; Top = SystemParameters.WorkArea.Top + 60; }
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        content.RowDefinitions.Add(new RowDefinition());
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var header = new DockPanel { Margin = new Thickness(0, 0, 0, 9) };
        DockPanel.SetDock(cover, Dock.Left); header.Children.Add(cover);
        var metadata = new StackPanel(); metadata.Children.Add(title); metadata.Children.Add(artist); header.Children.Add(metadata);
        content.Children.Add(header); scroller.Content = linePanel; Grid.SetRow(scroller, 1); content.Children.Add(scroller);
        var footer = new StackPanel(); footer.Children.Add(toolbar); footer.Children.Add(status); Grid.SetRow(footer, 2); content.Children.Add(footer);
        playbackButtons.Add(AddButton("|◀", "이전 곡", () => _ = Send("previous")));
        toggle = AddButton("▶", "재생 또는 일시정지", () => _ = Send("toggle")); playbackButtons.Add(toggle);
        playbackButtons.Add(AddButton("▶|", "다음 곡", () => _ = Send("next")));
        AddButton("설정", "표시 설정과 잠금", OpenSettings);
        surface.Child = content; Content = surface;
        MouseLeftButtonDown += (_, e) => { if (!preferences.Locked && e.OriginalSource is not Button) { try { DragMove(); } catch (InvalidOperationException) { } } };
        MouseRightButtonUp += (_, _) => { if (!preferences.Locked) OpenSettings(); };
        SourceInitialized += (_, _) => { handle = new WindowInteropHelper(this).Handle; SetClickThrough(preferences.Locked); };
        Loaded += (_, _) => { CreateTray(); ApplyPreferences(); ticker.Start(); };
        ticker.Tick += (_, _) => Tick();
        Closed += (_, _) => Cleanup();
    }
    private Button AddButton(string text, string tip, Action action)
    {
        var button = new Button { Content = text, ToolTip = tip, Margin = new Thickness(3), Padding = new Thickness(5, 0, 5, 0), MinWidth = 35, Foreground = Brushes.White, Background = new SolidColorBrush(Color.FromRgb(47, 52, 57)), BorderThickness = new Thickness(0), Focusable = true };
        button.Click += (_, _) => action(); toolbar.Children.Add(button); return button;
    }
    private async Task Send(string action)
    {
        if (commandPending) return;
        var state = server.State.Snapshot(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (!state.CanControl || state.Track is null) return;
        commandPending = true;
        bool sent = await server.Command(action, state.Track.Uri);
        commandPending = false;
        if (!sent && !closing) status.Text = "재생 연결을 확인해 주세요";
    }
    private void CreateTray()
    {
        // This small H glyph is drawn here; no external artwork is embedded.
        using var bitmap = new System.Drawing.Bitmap(32, 32);
        using (var drawing = System.Drawing.Graphics.FromImage(bitmap))
        {
            drawing.Clear(System.Drawing.Color.FromArgb(25, 50, 42));
            using var pen = new System.Drawing.Pen(System.Drawing.Color.FromArgb(114, 245, 177), 4);
            drawing.DrawLine(pen, 9, 7, 9, 25); drawing.DrawLine(pen, 23, 7, 23, 25); drawing.DrawLine(pen, 9, 16, 23, 16);
        }
        nint nativeIcon = bitmap.GetHicon();
        using (var temporary = System.Drawing.Icon.FromHandle(nativeIcon)) trayIcon = (System.Drawing.Icon)temporary.Clone();
        DestroyIcon(nativeIcon);
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("설정 열기", null, (_, _) => Dispatcher.Invoke(OpenSettings));
        menu.Items.Add("잠금 전환", null, (_, _) => Dispatcher.Invoke(() => { preferences.Locked = !preferences.Locked; ApplyPreferences(); Save(); }));
        menu.Items.Add("창 위치 초기화", null, (_, _) => Dispatcher.Invoke(() => { Left = SystemParameters.WorkArea.Left + 60; Top = SystemParameters.WorkArea.Top + 60; Save(); }));
        menu.Items.Add("종료", null, (_, _) => Dispatcher.Invoke(Close));
        tray = new Forms.NotifyIcon { Icon = trayIcon, Visible = true, Text = isolated ? "한글 가사 오버레이 검증" : "한글 가사 오버레이", ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => Dispatcher.Invoke(OpenSettings);
    }
    private void Tick()
    {
        if (closing) return;
        bool inside = CursorInside(this);
        bool visible = preferences.Controls == "always" || (preferences.Controls == "hover" && inside);
        toolbar.Visibility = visible ? Visibility.Visible : Visibility.Hidden;
        double hover = inside ? preferences.HoverOpacity : 1;
        surface.Opacity = preferences.Opacity * hover;
        // Zero-opacity controls cannot create invisible native input targets.
        bool hit = visible && surface.Opacity > .001 && CursorInside(toolbar);
        SetClickThrough(preferences.Locked && !hit);
        long now = Environment.TickCount64;
        if (now - frameAt < 100) return;
        frameAt = now;
        var view = server.State.Snapshot(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        foreach (var button in playbackButtons) button.IsEnabled = view.CanControl && !commandPending;
        toggle.Content = view.Playing ? "Ⅱ" : "▶";
        if (view.Version != version)
        {
            version = view.Version;
            title.Text = view.Track?.Title ?? "한글 가사 오버레이"; artist.Text = view.Track?.Artist ?? "Spotify에서 음악을 재생해 주세요";
            if (currentUri != view.Track?.Uri || currentArt != view.Track?.Art)
            {
                currentUri = view.Track?.Uri; currentArt = view.Track?.Art; cover.Source = null;
                imageCancellation?.Cancel(); imageCancellation?.Dispose();
                imageCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                if (currentArt is not null && currentUri is not null) _ = LoadImage(currentArt, currentUri, imageCancellation.Token);
            }
            RebuildLines(view); activeLine = -2;
        }
        cover.Visibility = view.Fresh ? Visibility.Visible : Visibility.Hidden;
        scroller.Visibility = view.Fresh ? Visibility.Visible : Visibility.Hidden;
        title.Visibility = view.Fresh ? Visibility.Visible : Visibility.Hidden;
        artist.Visibility = view.Fresh ? Visibility.Visible : Visibility.Hidden;
        status.Text = view.Fresh ? $"{TimeSpan.FromMilliseconds(view.Position):m\\:ss}  ·  {(view.Playing ? "재생 중" : "일시정지")}  ·  {(view.CanControl ? "제어 연결됨" : "제어 연결 대기")}" : "Spotify 연결 대기 · 트레이에서 설정 열기";
        if (view.Fresh && view.Synced)
        {
            int index = Protocol.ActiveLine(view.Lines, view.Position);
            if (index != activeLine)
            {
                if (activeLine >= 0 && activeLine < rows.Count) Highlight(activeLine, false);
                activeLine = index;
                if (index >= 0 && index < rows.Count)
                {
                    Highlight(index, true);
                    rows[index].Panel.UpdateLayout();
                    var point = rows[index].Panel.TranslatePoint(new Point(), linePanel);
                    scroller.ScrollToVerticalOffset(Math.Max(0, point.Y - scroller.ViewportHeight * .35));
                }
            }
        }
        if (exitWithSpotify && now - startedAt >= 20000 && now - lastProcessCheck >= 1000)
        {
            lastProcessCheck = now;
            var processes = Process.GetProcessesByName("Spotify");
            bool present = processes.Length > 0;
            foreach (var process in processes) process.Dispose();
            if (present) missingSince = 0;
            else if (missingSince == 0) missingSince = now;
            else if (now - missingSince >= 35000) Close();
        }
    }
    private void RebuildLines(ViewState view)
    {
        linePanel.Children.Clear(); rows.Clear();
        if (view.Lines.Length == 0) linePanel.Children.Add(new TextBlock { Text = "가사를 기다리고 있습니다", Foreground = Brushes.LightGray, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(15) });
        foreach (var line in view.Lines)
        {
            var panel = new StackPanel { Margin = new Thickness(4, 8, 4, 8) };
            TextBlock Label(string text, double size, bool show) => new() { Text = text, FontSize = size, FontFamily = new FontFamily(preferences.Font), Foreground = Brushes.LightGray, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Visibility = show && text != "" ? Visibility.Visible : Visibility.Collapsed };
            var original = Label(line.Text, preferences.FontSize, preferences.Original);
            var phonetic = Label(line.Phonetic, preferences.FontSize * .85, preferences.Phonetic);
            var translation = Label(line.Translation, preferences.FontSize * .8, preferences.Translation);
            panel.Children.Add(original); panel.Children.Add(phonetic); panel.Children.Add(translation);
            linePanel.Children.Add(panel); rows.Add((panel, original, phonetic, translation));
        }
    }
    private void Highlight(int index, bool active)
    {
        var row = rows[index];
        row.Original.Foreground = active ? Brushes.White : Brushes.LightGray;
        row.Phonetic.Foreground = active ? new SolidColorBrush(Color.FromRgb(130, 240, 182)) : Brushes.LightGray;
        row.Translation.Foreground = active ? Brushes.White : Brushes.LightGray;
        row.Panel.Opacity = active ? 1 : .48;
        row.Original.FontWeight = active ? FontWeights.Bold : FontWeights.Normal;
    }
    private async Task LoadImage(string url, string uri, CancellationToken token)
    {
        try
        {
            using var response = await images.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > 3 * 1024 * 1024) return;
            await using var input = await response.Content.ReadAsStreamAsync(token);
            using var data = new MemoryStream(); var buffer = new byte[8192];
            int read;
            while ((read = await input.ReadAsync(buffer, token)) > 0) { if (data.Length + read > 3 * 1024 * 1024) return; data.Write(buffer, 0, read); }
            if (token.IsCancellationRequested || currentUri != uri || currentArt != url) return;
            data.Position = 0;
            var bitmap = new BitmapImage(); bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.DecodePixelWidth = 128; bitmap.StreamSource = data; bitmap.EndInit(); bitmap.Freeze();
            cover.Source = bitmap;
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException or NotSupportedException or FormatException or ArgumentException) { }
    }
    private bool CursorInside(FrameworkElement element)
    {
        if (handle == 0 || !GetCursorPos(out var cursor) || !element.IsVisible) return false;
        var point = element.PointFromScreen(new Point(cursor.X, cursor.Y));
        return point.X >= 0 && point.Y >= 0 && point.X < element.ActualWidth && point.Y < element.ActualHeight;
    }
    private void SetClickThrough(bool value)
    {
        if (handle == 0 || clickThrough == value) return;
        long style = GetWindowLongPtr(handle, -20).ToInt64();
        SetWindowLongPtr(handle, -20, new nint(value ? style | 0x20 : style & ~0x20));
        clickThrough = value;
    }
    private void ApplyPreferences()
    {
        preferences.Normalize(); Topmost = preferences.Topmost;
        ResizeMode = preferences.Locked ? ResizeMode.NoResize : ResizeMode.CanResizeWithGrip;
        var color = (Color)ColorConverter.ConvertFromString(preferences.Background);
        color.A = (byte)Math.Round(preferences.BackgroundOpacity * 255); surface.Background = new SolidColorBrush(color);
        foreach (Button button in toolbar.Children) { button.Height = preferences.ButtonSize; button.FontSize = Math.Max(11, preferences.ButtonSize * .45); button.MinWidth = preferences.ButtonSize; }
        version = -1;
    }
    private void Save()
    {
        if (isolated) return;
        preferences.Left = Left; preferences.Top = Top; preferences.Width = Width; preferences.Height = Height;
        if (!preferences.Save() && settingsWindow is not null) System.Windows.MessageBox.Show(settingsWindow, "설정을 저장하지 못했습니다. 폴더 권한을 확인해 주세요.", "한글 가사 오버레이");
    }
    private void OpenSettings()
    {
        if (settingsWindow is not null) { settingsWindow.Activate(); return; }
        var dialog = new Window { Title = "한글 가사 오버레이 설정", Width = 460, Height = 710, MinHeight = 400, WindowStartupLocation = WindowStartupLocation.CenterScreen, Background = new SolidColorBrush(Color.FromRgb(28, 31, 34)), Foreground = Brushes.White, Topmost = true };
        settingsWindow = dialog;
        var panel = new StackPanel { Margin = new Thickness(20) };
        dialog.Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        void Label(string text) => panel.Children.Add(new TextBlock { Text = text, Margin = new Thickness(0, 9, 0, 4), TextWrapping = TextWrapping.Wrap });
        void Check(string name, bool value, Action<bool> update)
        {
            var checkbox = new CheckBox { Content = name, IsChecked = value, Foreground = Brushes.White, Margin = new Thickness(0, 4, 0, 4) };
            checkbox.Click += (_, _) => { update(checkbox.IsChecked == true); ApplyPreferences(); Save(); }; panel.Children.Add(checkbox);
        }
        void Slider(string name, double value, double min, double max, double step, Action<double> update)
        {
            var text = new TextBlock { Text = $"{name}: {value:0.##}", Margin = new Thickness(0, 9, 0, 4) }; panel.Children.Add(text);
            var slider = new System.Windows.Controls.Slider { Minimum = min, Maximum = max, Value = value, TickFrequency = step, IsSnapToTickEnabled = true };
            slider.ValueChanged += (_, _) => { update(slider.Value); text.Text = $"{name}: {slider.Value:0.##}"; ApplyPreferences(); }; slider.PreviewMouseLeftButtonUp += (_, _) => Save(); panel.Children.Add(slider);
        }
        Check("잠금과 마우스 통과 (표시된 버튼은 클릭 가능)", preferences.Locked, value => preferences.Locked = value);
        Check("항상 위에 표시", preferences.Topmost, value => preferences.Topmost = value);
        Label("재생 버튼 표시");
        var controls = new ComboBox { ItemsSource = new[] { "항상 표시", "마우스 오버 시 표시", "숨김" }, SelectedIndex = preferences.Controls == "always" ? 0 : preferences.Controls == "hover" ? 1 : 2 };
        controls.SelectionChanged += (_, _) => { preferences.Controls = new[] { "always", "hover", "hidden" }[controls.SelectedIndex]; ApplyPreferences(); Save(); }; panel.Children.Add(controls);
        Slider("버튼 크기", preferences.ButtonSize, 24, 48, 1, value => preferences.ButtonSize = value);
        Slider("전체 불투명도", preferences.Opacity, .1, 1, .05, value => preferences.Opacity = value);
        Slider("배경 불투명도", preferences.BackgroundOpacity, 0, 1, .05, value => preferences.BackgroundOpacity = value);
        Label("마우스 오버 시 불투명도 (트레이 설정은 항상 사용 가능)");
        var hover = new ComboBox { ItemsSource = new[] { "완전 투명", "20 %", "유지" }, SelectedIndex = preferences.HoverOpacity == 0 ? 0 : preferences.HoverOpacity == .2 ? 1 : 2 };
        hover.SelectionChanged += (_, _) => { preferences.HoverOpacity = new double[] { 0, .2, 1 }[hover.SelectedIndex]; ApplyPreferences(); Save(); }; panel.Children.Add(hover);
        Label("배경색 (#RRGGBB)"); var background = new TextBox { Text = preferences.Background };
        background.LostFocus += (_, _) => { if (System.Text.RegularExpressions.Regex.IsMatch(background.Text, "^#[0-9a-fA-F]{6}$")) { preferences.Background = background.Text; ApplyPreferences(); Save(); } else background.Text = preferences.Background; }; panel.Children.Add(background);
        Label("글꼴"); var font = new ComboBox { ItemsSource = Fonts.SystemFontFamilies.Select(item => item.Source).OrderBy(name => name).ToArray(), SelectedItem = preferences.Font, IsEditable = true, Text = preferences.Font };
        font.LostFocus += (_, _) => { preferences.Font = font.Text; ApplyPreferences(); Save(); }; panel.Children.Add(font);
        Slider("가사 글자 크기", preferences.FontSize, 12, 64, 1, value => preferences.FontSize = value);
        Check("원문 표시", preferences.Original, value => preferences.Original = value);
        Check("한글 발음 표시", preferences.Phonetic, value => preferences.Phonetic = value);
        Check("번역 표시", preferences.Translation, value => preferences.Translation = value);
        Label("싱크 보정은 Spotify 가사 화면에서 설정합니다. 보정된 시간표를 그대로 받습니다.\n잠금을 풀면 배경을 드래그하거나 오른쪽 아래에서 크기를 조절할 수 있습니다.\n단어별 채움, 다중 보컬과 사용자 CSS는 이 버전에서 지원하지 않습니다.");
        var close = new Button { Content = "닫기", Padding = new Thickness(8), Margin = new Thickness(0, 10, 0, 0) }; close.Click += (_, _) => dialog.Close(); panel.Children.Add(close);
        dialog.Closed += (_, _) => { Save(); settingsWindow = null; };
        dialog.Show(); dialog.Activate();
    }
    private void Cleanup()
    {
        closing = true; ticker.Stop(); lifetime.Cancel(); imageCancellation?.Cancel();
        settingsWindow?.Close(); Save();
        if (tray is not null) { tray.Visible = false; tray.ContextMenuStrip?.Dispose(); tray.Dispose(); }
        trayIcon?.Dispose(); images.Dispose(); imageCancellation?.Dispose(); lifetime.Dispose();
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X; public int Y; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern nint SetWindowLongPtr(nint hwnd, int index, nint value);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(nint icon);
}
