// @file Settings.cs
// @author: ForUltraplayer
// @brief Store only this overlay's appearance and window preferences, never playback credentials.
using System;
using System.IO;
using System.Text.Json;

namespace SpotifyHangulOverlay;

internal sealed class Settings
{
    public double Left { get; set; } = 100;
    public double Top { get; set; } = 100;
    public double Width { get; set; } = 620;
    public double Height { get; set; } = 340;
    public bool Locked { get; set; } = true;
    public bool Topmost { get; set; } = true;
    public string Controls { get; set; } = "always";
    public double ButtonSize { get; set; } = 32;
    public double Opacity { get; set; } = 1;
    public double BackgroundOpacity { get; set; } = .65;
    public string Background { get; set; } = "#151719";
    public double HoverOpacity { get; set; } = .2;
    public string Font { get; set; } = "Malgun Gothic";
    public double FontSize { get; set; } = 23;
    public bool Original { get; set; } = true;
    public bool Phonetic { get; set; } = true;
    public bool Translation { get; set; } = true;
    public void Normalize()
    {
        static double Bound(double value, double fallback, double min, double max) => double.IsFinite(value) ? Math.Clamp(value, min, max) : fallback;
        Left = Bound(Left, 100, -30000, 30000); Top = Bound(Top, 100, -30000, 30000);
        Width = Bound(Width, 620, 360, 2400); Height = Bound(Height, 340, 200, 1600);
        ButtonSize = Bound(ButtonSize, 32, 24, 48); FontSize = Bound(FontSize, 23, 12, 64);
        Opacity = Bound(Opacity, 1, .1, 1); BackgroundOpacity = Bound(BackgroundOpacity, .65, 0, 1);
        if (Controls is not ("always" or "hover" or "hidden")) Controls = "always";
        if (HoverOpacity is not (0 or .2 or 1)) HoverOpacity = .2;
        if (!System.Text.RegularExpressions.Regex.IsMatch(Background ?? "", "^#[0-9a-fA-F]{6}$")) Background = "#151719";
        if (string.IsNullOrWhiteSpace(Font) || Font.Length > 100) Font = "Malgun Gothic";
    }
    public static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SpotifyHangulOverlay", "settings.json");
    public static Settings Load()
    {
        try { var settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new(); settings.Normalize(); return settings; }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { return new(); }
    }
    public bool Save()
    {
        try
        {
            Normalize(); Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            var pending = FilePath + ".tmp";
            File.WriteAllText(pending, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(pending, FilePath, true); return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return false; }
    }
}
