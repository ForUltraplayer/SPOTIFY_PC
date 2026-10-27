// @file Program.cs
// @author: ForUltraplayer
// @brief Launch the owned overlay without elevated privileges or persistent startup settings.
using System;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Threading;

namespace SpotifyHangulOverlay;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (Array.IndexOf(args, "--smoke-test") >= 0)
        {
            var result = SmokeTests.Run();
            int reportIndex = Array.IndexOf(args, "--smoke-report");
            if (reportIndex >= 0 && reportIndex + 1 < args.Length) File.WriteAllText(args[reportIndex + 1], result.Json);
            Console.WriteLine(result.Json);
            return result.Passed ? 0 : 1;
        }
        int port = 15000, duration = 0;
        bool exitWithSpotify = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--port" && i + 1 < args.Length && int.TryParse(args[++i], out int value) && value >= 1024 && value <= 65535) port = value;
            else if (args[i] == "--exit-with-spotify") exitWithSpotify = true;
            else if (args[i] == "--test-duration" && i + 1 < args.Length && int.TryParse(args[++i], out int seconds) && seconds is > 0 and <= 300) duration = seconds;
            else return 2;
        }
        bool isolated = port != 15000;
        using var mutex = new Mutex(true, "Local\\SpotifyHangulOverlay-" + port, out bool created);
        if (!created) return 0;
        var server = new OverlayServer(port);
        try
        {
            server.Start().GetAwaiter().GetResult();
            var application = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            var window = new OverlayWindow(server, isolated, exitWithSpotify);
            DispatcherTimer? shutdown = null;
            if (duration > 0)
            {
                shutdown = new DispatcherTimer { Interval = TimeSpan.FromSeconds(duration) };
                shutdown.Tick += (_, _) => { shutdown.Stop(); window.Close(); };
                shutdown.Start();
            }
            return application.Run(window);
        }
        catch (Exception error)
        {
            // Error text deliberately excludes HTTP bodies, pairing values and arbitrary request URIs.
            if (!isolated) MessageBox.Show("오버레이를 시작하지 못했습니다. 같은 포트를 쓰는 가사 앱을 확인해 주세요.\n" + error.GetType().Name, "한글 가사 오버레이", MessageBoxButton.OK, MessageBoxImage.Warning);
            return 1;
        }
        finally { server.DisposeAsync().AsTask().GetAwaiter().GetResult(); mutex.ReleaseMutex(); }
    }
}
