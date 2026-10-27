// @file OverlayServer.cs
// @author: ForUltraplayer
// @brief Serve bounded loopback lyrics requests and authorize track-scoped playback controls.
using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace SpotifyHangulOverlay;

internal sealed class OverlayServer : IAsyncDisposable
{
    public readonly OverlayState State = new();
    private readonly CancellationTokenSource stop = new();
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(2) };
    private WebApplication? app;
    private Task? polling;
    public int Port { get; }
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public OverlayServer(int port) { Port = port; }
    public async Task Start()
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ContentRootPath = AppContext.BaseDirectory });
        builder.Logging.ClearProviders(); // No request bodies or pairing tokens are written to logs.
        builder.WebHost.ConfigureKestrel(server =>
        {
            server.Listen(IPAddress.Loopback, Port);
            server.Limits.MaxRequestBodySize = Protocol.BodyLimit;
            server.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(5);
            server.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(10);
            server.Limits.MaxConcurrentConnections = 16;
        });
        app = builder.Build();
        app.Run(Handle);
        await app.StartAsync(stop.Token).ConfigureAwait(false);
        polling = Poll();
    }
    private async Task Handle(HttpContext context)
    {
        var request = context.Request;
        string origin = request.Headers.Origin.ToString();
        bool allowedHost = request.Host.Port == Port && (request.Host.Host == "127.0.0.1" || request.Host.Host == "localhost");
        bool local = context.Connection.RemoteIpAddress is not null && IPAddress.IsLoopback(context.Connection.RemoteIpAddress);
        if (!local || !allowedHost || (origin != "" && origin != Protocol.SenderOrigin)) { context.Response.StatusCode = 403; return; }
        if (origin == Protocol.SenderOrigin)
        {
            context.Response.Headers.AccessControlAllowOrigin = origin;
            context.Response.Headers.Vary = "Origin";
            context.Response.Headers.AccessControlAllowMethods = "GET, POST, OPTIONS";
            context.Response.Headers.AccessControlAllowHeaders = "Content-Type";
            if (request.Headers["Access-Control-Request-Private-Network"] == "true") context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
        }
        context.Response.Headers.CacheControl = "no-store";
        string path = request.Path.Value ?? "";
        if (request.Method == "OPTIONS") { context.Response.StatusCode = 204; return; }
        if (request.Method == "GET" && path == "/health")
        {
            await context.Response.WriteAsJsonAsync(new { application = "SpotifyHangulOverlay", protocol = 1, version = "0.1.0" }, stop.Token); return;
        }
        // Trusted desktop tools may probe health; browser mutations need Spotify's exact origin.
        if (request.Method != "POST" || !(path is "/lyrics" or "/progress" or "/ping" or "/playback-config")) { context.Response.StatusCode = 404; return; }
        if (origin != Protocol.SenderOrigin) { context.Response.StatusCode = 403; return; }
        if (request.ContentLength > Protocol.BodyLimit) { context.Response.StatusCode = 413; return; }
        if (request.ContentType?.Split(';')[0].Trim() != "application/json") { context.Response.StatusCode = 415; return; }
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token, context.RequestAborted);
            timeout.CancelAfter(TimeSpan.FromSeconds(4));
            using var document = await JsonDocument.ParseAsync(request.Body, new JsonDocumentOptions { MaxDepth = 32 }, timeout.Token);
            if (document.RootElement.ValueKind != JsonValueKind.Object) throw new FormatException("Object payload required.");
            var root = document.RootElement;
            bool accepted = true;
            if (path == "/lyrics") accepted = State.Lyrics(Protocol.ParseLyrics(root), Now);
            if (path == "/progress") { var progress = Protocol.ParseProgress(root); if (progress is not null) accepted = State.Progress(progress, Now); }
            if (path == "/playback-config") State.SetPair(Protocol.ParsePairing(root, Now));
            await context.Response.WriteAsJsonAsync(new { ok = true, accepted }, timeout.Token);
        }
        catch (BadHttpRequestException error) { context.Response.StatusCode = error.StatusCode; }
        catch (Exception error) when (error is JsonException or FormatException or InvalidOperationException or OverflowException)
        { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = "Invalid overlay payload." }); }
        catch (OperationCanceledException) { if (!context.Response.HasStarted) context.Response.StatusCode = 408; }
        catch (IOException) { if (!context.Response.HasStarted) context.Response.StatusCode = 400; }
    }
    private HttpRequestMessage Request(HttpMethod method, string path, Pairing pair)
    {
        var request = new HttpRequestMessage(method, Protocol.BrokerUrl + path);
        request.Headers.Add("Origin", Protocol.ClientOrigin);
        request.Headers.Add("X-Hangul-Overlay-Token", pair.Token);
        return request;
    }
    private async Task Poll()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));
        try
        {
            while (await timer.WaitForNextTickAsync(stop.Token).ConfigureAwait(false))
            {
                var pair = State.Pair(Now);
                if (pair is null) { State.Broker(null, Now); continue; }
                try
                {
                    using var request = Request(HttpMethod.Get, "/playback-state", pair);
                    using var response = await client.SendAsync(request, stop.Token).ConfigureAwait(false);
                    response.EnsureSuccessStatusCode();
                    var bytes = await response.Content.ReadAsByteArrayAsync(stop.Token).ConfigureAwait(false);
                    if (bytes.Length > 4096) throw new FormatException("Oversized broker state.");
                    using var document = JsonDocument.Parse(bytes);
                    // A replacement pairing must not receive the old session's in-flight state.
                    if (State.Pair(Now)?.Token == pair.Token) State.Broker(Protocol.ParseBroker(document.RootElement, Now), Now);
                }
                catch (Exception error) when (error is HttpRequestException or OperationCanceledException or JsonException or FormatException)
                { State.Broker(null, Now); }
            }
        }
        catch (OperationCanceledException) { }
    }
    public async Task<bool> Command(string action, string uri)
    {
        if (!(action is "previous" or "toggle" or "next") || !State.CanCommand(uri, Now)) return false;
        var pair = State.Pair(Now);
        if (pair is null) return false;
        try
        {
            using var request = Request(HttpMethod.Post, "/playback-command", pair);
            request.Content = JsonContent.Create(new { action, trackUri = uri });
            using var response = await client.SendAsync(request, stop.Token).ConfigureAwait(false);
            return response.IsSuccessStatusCode;
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException) { return false; }
    }
    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync().ConfigureAwait(false);
        if (polling is not null) await polling.ConfigureAwait(false);
        if (app is not null) { using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(3)); await app.StopAsync(limit.Token).ConfigureAwait(false); await app.DisposeAsync().ConfigureAwait(false); }
        client.Dispose(); stop.Dispose();
    }
}
