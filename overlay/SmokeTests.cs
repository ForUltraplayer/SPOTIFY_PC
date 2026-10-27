// @file SmokeTests.cs
// @author: ForUltraplayer
// @brief Exercise payload compatibility, timing, URI supersession and playback authorization without external packages.
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace SpotifyHangulOverlay;

internal static class SmokeTests
{
    public static (bool Passed, string Json) Run()
    {
        var results = new List<object>(); int failures = 0;
        void Test(string name, Action run)
        {
            try { run(); results.Add(new { name, passed = true }); }
            catch (Exception error) { failures++; results.Add(new { name, passed = false, error = error.Message }); }
        }
        void Assert(bool condition, string reason = "Assertion failed") { if (!condition) throw new Exception(reason); }
        void Invalid(Action action) { try { action(); } catch (FormatException) { return; } throw new Exception("Malformed payload accepted"); }
        JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();
        string uri = "youtube:video:abcdefghijk", other = "spotify:track:1234567890123456789012";
        var payload = Parse("""{"trackUri":"youtube:video:abcdefghijk","track":{"title":"원문 제목","artist":"가수","albumArt":"https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg","duration":200000},"lyrics":[{"startTime":-5300,"endTime":1000,"text":"原文","pronText":"한글 발음","transText":"번역"},{"startTime":18240,"endTime":25000,"text":"다음"}],"isSynced":true}""");
        var data = Protocol.ParseLyrics(payload);
        Test("sender-pronText-transText-contract", () => Assert(data.Lines[0].Phonetic == "한글 발음" && data.Lines[0].Translation == "번역"));
        Test("signed-preapplied-offset-preserved", () => Assert(data.Lines[0].Start == -5300));
        Test("offset-not-applied-twice", () => Assert(Protocol.ActiveLine(data.Lines, 18239) == 0 && Protocol.ActiveLine(data.Lines, 18240) == 1));
        Test("before-first-line", () => Assert(Protocol.ActiveLine([new LyricLine(2000, null, "", "", "")], 1999) == -1));
        Test("connection-probe-does-not-change-playback", () => Assert(Protocol.ParseProgress(Parse("""{"position":0,"isPlaying":false}""")) is null));
        Test("uri-required-for-real-progress", () => Invalid(() => Protocol.ParseProgress(Parse("""{"position":2000,"isPlaying":true}"""))));
        Test("invalid-uri-rejected", () => Invalid(() => Protocol.ParseLyrics(Parse("""{"trackUri":"file:///secret"}"""))));
        Test("malformed-timestamp-rejected", () => Invalid(() => Protocol.ParseProgress(Parse("""{"trackUri":"youtube:video:abcdefghijk","position":"10","isPlaying":true}"""))));
        Test("nonfinite-timestamp-rejected", () => Invalid(() => Protocol.ParseProgress(Parse("""{"trackUri":"youtube:video:abcdefghijk","position":1e300,"isPlaying":true}"""))));
        Test("unsafe-art-scheme-rejected", () => Assert(Protocol.SafeArt("file:///secret.png") is null));
        Test("unsafe-art-host-rejected", () => Assert(Protocol.SafeArt("https://i.ytimg.com.evil.test/image") is null));
        Test("unsafe-art-userinfo-rejected", () => Assert(Protocol.SafeArt("https://secret@i.ytimg.com/image") is null));
        Test("expired-pair-rejected", () => Invalid(() => Protocol.ParsePairing(Parse("""{"bridgeUrl":"http://127.0.0.1:19643","token":"abcdefghijklmnopqrstuvwxyz123456","expiresAt":1000}"""), 1000)));
        Test("alternate-broker-rejected", () => Invalid(() => Protocol.ParsePairing(Parse("""{"bridgeUrl":"http://evil.test","token":"abcdefghijklmnopqrstuvwxyz123456","expiresAt":10000}"""), 1000)));
        Test("state-time-interpolation-bounded", () => { var state = new OverlayState(); state.Lyrics(data, 1000); state.Progress(new(uri, 5000, 200000, true, data.Track), 1000); Assert(state.Snapshot(4000).Position == 6500); });
        Test("paused-clock-does-not-advance", () => { var state = new OverlayState(); state.Lyrics(data, 1000); state.Progress(new(uri, 5000, 200000, false, data.Track), 1000); Assert(state.Snapshot(2000).Position == 5000); });
        Test("stale-playback-stops", () => { var state = new OverlayState(); state.Progress(new(uri, 5000, 200000, true, data.Track), 1000); Assert(!state.Snapshot(6000).Fresh && !state.Snapshot(6000).Playing); });
        Test("track-change-clears-old-lyrics-and-art", () => { var state = new OverlayState(); state.Lyrics(data, 1000); state.Progress(new(other, 0, 100000, true, null), 2000); var view = state.Snapshot(2000); Assert(view.Track?.Uri == other && view.Track.Art is null && view.Lines.Length == 0); });
        Test("late-prior-track-lyrics-rejected", () => { var state = new OverlayState(); state.Lyrics(data, 1000); state.Progress(new(other, 0, 100000, true, null), 2000); Assert(!state.Lyrics(data, 2500)); });
        Test("broker-allows-legitimate-previous-track", () => { var state = new OverlayState(); state.Lyrics(data, 1000); state.Progress(new(other, 0, 100000, true, null), 2000); state.Broker(new(uri, 0, 200000, true, 3000), 3000); Assert(state.Lyrics(data, 3001)); });
        Test("unpaired-controls-disabled", () => { var state = new OverlayState(); state.Broker(new(uri, 0, 200000, true, 1000), 1000); Assert(!state.CanCommand(uri, 1001)); });
        Test("current-track-only-command", () => { var state = new OverlayState(); state.SetPair(new("abcdefghijklmnopqrstuvwxyz123456", 20000)); state.Broker(new(uri, 0, 200000, true, 1000), 1000); Assert(state.CanCommand(uri, 1100) && !state.CanCommand(other, 1100) && !state.CanCommand(uri, 6000)); });
        Test("expired-pair-disables-controls", () => { var state = new OverlayState(); state.SetPair(new("abcdefghijklmnopqrstuvwxyz123456", 2000)); state.Broker(new(uri, 0, 200000, true, 1000), 1000); Assert(!state.CanCommand(uri, 2000)); });
        Test("broker-track-wins-over-late-sender", () => { var state = new OverlayState(); state.Broker(new(other, 0, 100000, true, 1000), 1000); Assert(!state.Lyrics(data, 1001)); });
        Test("settings-bounds", () => { var settings = new Settings { ButtonSize = 200, FontSize = double.NaN, Background = "url(evil)", Controls = "broken" }; settings.Normalize(); Assert(settings.ButtonSize == 48 && settings.FontSize == 23 && settings.Background == "#151719" && settings.Controls == "always"); });
        return (failures == 0, JsonSerializer.Serialize(new { passed = results.Count - failures, failed = failures, tests = results }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
