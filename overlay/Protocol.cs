// @file Protocol.cs
// @author: ForUltraplayer
// @brief Validate the published lyrics protocol and maintain track-scoped, expiring playback state.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SpotifyHangulOverlay;

internal sealed record LyricLine(double Start, double? End, string Text, string Phonetic, string Translation);
internal sealed record Track(string Uri, string Title, string Artist, string? Art, double Duration);
internal sealed record Lyrics(Track Track, LyricLine[] Lines, bool Synced);
internal sealed record Progress(string Uri, double Position, double Duration, bool Playing, Track? Track);
internal sealed record Pairing(string Token, long ExpiresAt);
internal sealed record BrokerState(string Uri, double Position, double Duration, bool Playing, long UpdatedAt);
internal sealed record ViewState(Track? Track, LyricLine[] Lines, bool Synced, double Position, bool Playing, bool Fresh, bool CanControl, int Version);

internal static class Protocol
{
    public const string SenderOrigin = "https://xpui.app.spotify.com";
    public const string ClientOrigin = "http://spotify-hangul-overlay.localhost";
    public const string BrokerUrl = "http://127.0.0.1:19643";
    public const int BodyLimit = 2 * 1024 * 1024;
    private static readonly Regex UriPattern = new(@"^(spotify:(track|episode):[A-Za-z0-9]{22}|youtube:video:[A-Za-z0-9_-]{11})$", RegexOptions.CultureInvariant);
    public static bool ValidUri(string? value) => value is not null && UriPattern.IsMatch(value);
    public static string Text(JsonElement root, string name, int limit = 4096)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return "";
        if (value.ValueKind != JsonValueKind.String) throw new FormatException("Text property must be a string.");
        var result = value.GetString()!;
        if (result.Length > limit) throw new FormatException("Text property is too long.");
        return result;
    }
    public static double Number(JsonElement root, string name, double fallback = 0, bool signed = false)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return fallback;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var result) || !double.IsFinite(result)
            || Math.Abs(result) > 31_536_000_000 || (!signed && result < 0)) throw new FormatException("Invalid millisecond value.");
        return result;
    }
    private static bool Flag(JsonElement root, string name, bool fallback = false)
    {
        if (!root.TryGetProperty(name, out var value)) return fallback;
        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new FormatException("Invalid boolean.");
        return value.GetBoolean();
    }
    private static string TrackUri(JsonElement root)
    {
        var uri = Text(root, "trackUri", 100);
        if (!ValidUri(uri)) throw new FormatException("Invalid track URI.");
        return uri;
    }
    public static string? SafeArt(string value)
    {
        if (!System.Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo != "") return null;
        string[] hosts = ["i.ytimg.com", "i.scdn.co", "mosaic.scdn.co", "image-cdn-ak.spotifycdn.com", "image-cdn-fa.spotifycdn.com", "image-cdn.spotifycdn.com"];
        return hosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase) ? uri.AbsoluteUri : null;
    }
    private static Track Metadata(JsonElement root, string uri, double duration = 0) => new(uri, Text(root, "title", 500), Text(root, "artist", 500), SafeArt(Text(root, "albumArt", 2048)), Number(root, "duration", duration));
    public static Lyrics ParseLyrics(JsonElement root)
    {
        var uri = TrackUri(root);
        if (!root.TryGetProperty("track", out var track) || track.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("lyrics", out var lyrics) || lyrics.ValueKind != JsonValueKind.Array || lyrics.GetArrayLength() > 10000)
            throw new FormatException("Invalid lyrics payload.");
        var lines = new List<LyricLine>();
        foreach (var line in lyrics.EnumerateArray())
        {
            if (line.ValueKind != JsonValueKind.Object) throw new FormatException("Invalid lyric line.");
            var start = Number(line, "startTime", signed: true);
            double? end = line.TryGetProperty("endTime", out var endValue) && endValue.ValueKind != JsonValueKind.Null ? Number(line, "endTime", signed: true) : null;
            if (end.HasValue && end < start) throw new FormatException("Lyric end precedes start.");
            lines.Add(new(start, end, Text(line, "text"), Text(line, "pronText"), Text(line, "transText")));
        }
        return new(Metadata(track, uri), lines.OrderBy(line => line.Start).ToArray(), Flag(root, "isSynced"));
    }
    public static Progress? ParseProgress(JsonElement root)
    {
        // The upstream sender uses this exact URI-less payload only as a connection probe.
        if (!root.TryGetProperty("trackUri", out var identity) || identity.ValueKind == JsonValueKind.Null)
        {
            if (Number(root, "position") != 0 || Flag(root, "isPlaying")) throw new FormatException("Progress requires a track URI.");
            return null;
        }
        var uri = TrackUri(root);
        var duration = Number(root, "duration");
        Track? metadata = root.TryGetProperty("currentTrack", out var track) && track.ValueKind == JsonValueKind.Object ? Metadata(track, uri, duration) : null;
        return new(uri, Number(root, "position"), duration, Flag(root, "isPlaying"), metadata);
    }
    public static Pairing ParsePairing(JsonElement root, long now)
    {
        if (Text(root, "bridgeUrl", 128) != BrokerUrl) throw new FormatException("Unexpected playback broker.");
        var token = Text(root, "token", 128);
        if (!Regex.IsMatch(token, "^[A-Za-z0-9_-]{32,128}$", RegexOptions.CultureInvariant)) throw new FormatException("Invalid pairing.");
        if (!root.TryGetProperty("expiresAt", out var expires) || !expires.TryGetInt64(out long expiry) || expiry <= now || expiry > now + 86400000)
            throw new FormatException("Expired pairing.");
        return new(token, expiry);
    }
    public static BrokerState? ParseBroker(JsonElement root, long now)
    {
        if (!root.TryGetProperty("state", out var state) || state.ValueKind == JsonValueKind.Null) return null;
        var uri = TrackUri(state);
        if (!state.TryGetProperty("updatedAt", out var stamp) || !stamp.TryGetInt64(out var updated) || updated > now + 1000 || now - updated >= 5000) return null;
        return new(uri, Number(state, "position"), Number(state, "duration"), Flag(state, "isPlaying"), updated);
    }
    public static int ActiveLine(LyricLine[] lines, double position)
    {
        int left = 0, right = lines.Length - 1, found = -1;
        while (left <= right) { int mid = (left + right) / 2; if (lines[mid].Start <= position) { found = mid; left = mid + 1; } else right = mid - 1; }
        return found;
    }
}

internal sealed class OverlayState
{
    private readonly object gate = new();
    private Lyrics? lyrics;
    private Track? track;
    private Progress? progress;
    private long progressAt;
    private BrokerState? broker;
    private long brokerReceived;
    private readonly Dictionary<string, long> retired = new();
    private Pairing? pairing;
    private int version;
    public Pairing? Pair(long now) { lock (gate) return pairing is not null && pairing.ExpiresAt > now ? pairing : null; }
    public void SetPair(Pairing value) { lock (gate) { if (pairing?.Token != value.Token) broker = null; pairing = value; } }
    private bool Accept(string uri, long now)
    {
        foreach (var key in retired.Where(pair => now - pair.Value > 15000).Select(pair => pair.Key).ToArray()) retired.Remove(key);
        if (broker is not null && now - broker.UpdatedAt < 5000 && broker.Uri != uri) return false;
        if (track?.Uri == uri) return true;
        if (retired.ContainsKey(uri)) return false;
        ChangeTrack(uri, now);
        return true;
    }
    private void ChangeTrack(string uri, long now)
    {
        if (track?.Uri == uri) return;
        if (track is not null) retired[track.Uri] = now;
        lyrics = null; progress = null; progressAt = 0;
        track = new Track(uri, "가사 연결 대기", "", null, 0);
        version++;
    }
    public bool Lyrics(Lyrics value, long now)
    {
        lock (gate) { if (!Accept(value.Track.Uri, now)) return false; lyrics = value; track = value.Track; version++; return true; }
    }
    public bool Progress(Progress value, long now)
    {
        lock (gate)
        {
            if (!Accept(value.Uri, now)) return false;
            progress = value; progressAt = now;
            if (value.Track is not null && value.Track != track) { track = value.Track; version++; }
            return true;
        }
    }
    public void Broker(BrokerState? value, long now)
    {
        lock (gate)
        {
            broker = value; brokerReceived = now;
            if (value is not null) { retired.Remove(value.Uri); ChangeTrack(value.Uri, now); }
        }
    }
    public ViewState Snapshot(long now)
    {
        lock (gate)
        {
            bool brokerFresh = broker is not null && now - broker.UpdatedAt < 5000 && now - brokerReceived < 5000 && broker.Uri == track?.Uri;
            bool progressFresh = progress is not null && now - progressAt < 5000 && progress.Uri == track?.Uri;
            bool fresh = brokerFresh || progressFresh;
            bool playing = brokerFresh ? broker!.Playing : progressFresh && progress!.Playing;
            double position = brokerFresh ? broker!.Position : progress?.Position ?? 0;
            long sampledAt = brokerFresh ? brokerReceived : progressAt;
            if (playing) position += Math.Clamp(now - sampledAt, 0, 1500);
            double duration = brokerFresh ? broker!.Duration : progress?.Duration ?? track?.Duration ?? 0;
            if (duration > 0) position = Math.Min(position, duration);
            bool control = brokerFresh && pairing is not null && pairing.ExpiresAt > now;
            return new(track, lyrics?.Lines ?? [], lyrics?.Synced ?? false, position, playing, fresh, control, version);
        }
    }
    public bool CanCommand(string uri, long now) { var view = Snapshot(now); return view.CanControl && view.Track?.Uri == uri; }
}
