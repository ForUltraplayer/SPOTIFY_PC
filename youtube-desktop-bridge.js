/** @file youtube-desktop-bridge.js
 * @author: ForUltraplayer
 * @brief Pair the actual desktop overlay with a bounded loopback command queue and route actions to the current native or link player.
 */
(() => {
    'use strict';
    const BASE = 'http://127.0.0.1:19643';
    const ACTIONS = new Set(['previous', 'toggle', 'play', 'pause', 'next']);
    const clamp = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

    function readState(host) {
        const source = host.SpotifyHangulLinks;
        const compact = source?.playbackState?.();
        const full = !compact || (compact.active && !compact.state) ? source?.snapshot?.() : null;
        const links = compact || full, media = compact?.state || full?.state;
        const track = links?.active ? source?.currentTrack?.() : host.Spicetify?.Player?.data?.item;
        const player = host.Spicetify?.Player;
        const validUri = links?.active
            ? /^youtube:video:[A-Za-z0-9_-]{11}$/.test(track?.uri || '')
            : /^spotify:(?:track|episode):[A-Za-z0-9]{22}$/.test(track?.uri || '');
        const milliseconds = value => Math.min(Number.MAX_SAFE_INTEGER, clamp(value));
        const duration = validUri ? milliseconds(links?.active === true ? clamp(media?.duration) * 1000 : player?.getDuration?.()) : 0;
        const position = validUri ? milliseconds(links?.active === true ? clamp(media?.seconds) * 1000 : player?.getProgress?.()) : 0;
        return { trackUri: validUri ? track.uri : null, source: validUri ? (links?.active ? 'youtube' : 'spotify') : null,
            isPlaying: validUri && (links?.active === true ? links.playing === true : player?.isPlaying?.() === true),
            position: duration ? Math.min(position, duration) : position,
            duration,
            title: String(track?.metadata?.title || track?.name || '').slice(0, 300),
            artist: String(track?.metadata?.artist_name || track?.artists?.map(a => a.name).join(', ') || '').slice(0, 200) };
    }

    async function dispatch(host, command) {
        if (!command || !ACTIONS.has(command.action)) return false;
        const live = readState(host);
        if (!live.trackUri) return false;
        if (command.trackUri !== undefined && command.trackUri !== live.trackUri) return false;
        const player = host.Spicetify?.Player, source = host.SpotifyHangulLinks;
        const linked = source?.playbackState?.() || source?.snapshot?.();
        if (linked?.active && ['play', 'pause'].includes(command.action)) {
            if (typeof source?.[command.action] !== 'function') return false;
            await source[command.action](); return true;
        }
        const method = { previous: 'back', toggle: 'togglePlay', play: 'play', pause: 'pause', next: 'next' }[command.action];
        if (typeof player?.[method] !== 'function') return false;
        await player[method](); return true;
    }

    function create(host) {
        let disposed = false, session = null, pending = null, nextRegistration = 0, nextDesktopConfig = 0;
        let lastUri = undefined, desktopConnected = false, lastError = '';
        const instance = host.crypto.randomUUID(), controllers = new Set(), seen = new Set();
        async function request(url, options = {}) {
            const controller = new AbortController(); controllers.add(controller);
            const timeout = host.setTimeout(() => controller.abort(), 2500);
            try {
                return await host.fetch(url, { ...options, signal: controller.signal });
            } finally { host.clearTimeout(timeout); controllers.delete(controller); }
        }
        const headers = token => ({ 'Content-Type': 'application/json', 'X-Hangul-Lyrics-Client': 'ivlyrics',
            ...(token ? { 'X-Hangul-Overlay-Token': token } : {}) });
        async function work() {
            if (disposed) return;
            const now = Date.now();
            if (!session || session.expiresAt <= now + 60000) {
                if (now < nextRegistration) return;
                nextRegistration = now + 5000;
                const response = await request(BASE + '/playback-session', {
                    method: 'POST', headers: headers(), body: JSON.stringify({ instance }) });
                if (!response.ok) throw Error('Playback pairing unavailable');
                const value = await response.json();
                if (disposed) return;
                if (value.bridgeUrl !== BASE || !/^[A-Za-z0-9_-]{32,256}$/.test(value.token || '')
                    || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 86400000)
                    throw Error('Invalid playback pairing');
                session = value; nextDesktopConfig = 0; seen.clear();
            }
            const paired = session;
            // Hand the control token only to an overlay the user enabled in ivLyrics;
            // otherwise any local process on that port would receive it.
            if (host.OverlaySender?.enabled === false) desktopConnected = false;
            else if (Date.now() >= nextDesktopConfig) {
                nextDesktopConfig = Date.now() + 10000;
                const port = Number(host.OverlaySender?.port || 15000);
                if (Number.isInteger(port) && port >= 1 && port <= 65535) {
                    try {
                        const response = await request('http://127.0.0.1:' + port + '/playback-config', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bridgeUrl: BASE, token: paired.token, expiresAt: paired.expiresAt }) });
                        desktopConnected = response.ok;
                    } catch { desktopConnected = false; }
                }
            }
            if (disposed || paired !== session) return;
            const state = readState(host);
            if (state.trackUri !== lastUri) {
                lastUri = state.trackUri;
                host.ivLyricsOverlayService?.syncNow?.();
            }
            // During startup or a source transition there may be no track.
            // Keep pairing and drain obsolete commands without publishing an
            // invalid null URI to the track-scoped backend protocol.
            if (state.trackUri) {
                const published = await request(BASE + '/playback-state', {
                    method: 'POST', headers: headers(paired.token), body: JSON.stringify(state) });
                if (published.status === 401 || published.status === 403) { session = null; nextRegistration = 0; return; }
                if (!published.ok) throw Error('Playback state unavailable');
            }
            const response = await request(BASE + '/playback-commands', { headers: headers(paired.token) });
            if (!response.ok) throw Error('Playback commands unavailable');
            const body = await response.json();
            if (disposed || paired !== session) return;
            const commands = Array.isArray(body) ? body : body.commands;
            for (const command of (Array.isArray(commands) ? commands : []).slice(0, 32)) {
                if (disposed) return;
                const id = command?.id === undefined ? null : String(command.id);
                if (id && seen.has(id)) continue;
                if (id) { seen.add(id); if (seen.size > 128) seen.delete(seen.values().next().value); }
                await dispatch(host, command);
            }
            lastError = '';
        }
        function sync() {
            if (pending) return pending;
            pending = work().catch(error => { if (!disposed) lastError = error.name === 'AbortError' ? 'Playback request timed out' : error.message; })
                .finally(() => { pending = null; });
            return pending;
        }
        let timer = null, worker = null, workerUrl = null;
        function stopWorker() {
            if (worker) {
                worker.onmessage = null; worker.onerror = null;
                try { worker.terminate(); } catch { /* Continue releasing the owned URL. */ }
                worker = null;
            }
            if (workerUrl !== null) {
                try { host.URL.revokeObjectURL(workerUrl); } catch { /* No other owner uses this URL. */ }
                workerUrl = null;
            }
        }
        function useInterval() {
            stopWorker();
            if (!disposed && timer === null) timer = host.setInterval(() => { void sync(); }, 500);
        }
        // A paused/background Spotify window can throttle its window timers.
        // Keep the publication heartbeat on an owned worker, like OverlaySender.
        if (typeof host.Worker === 'function' && typeof host.Blob === 'function'
            && typeof host.URL?.createObjectURL === 'function' && typeof host.URL?.revokeObjectURL === 'function') {
            try {
                workerUrl = host.URL.createObjectURL(new host.Blob([
                    "setInterval(() => postMessage('tick'), 500);"
                ], { type: 'text/javascript' }));
                worker = new host.Worker(workerUrl);
                worker.onmessage = event => { if (event.data === 'tick' && !disposed) void sync(); };
                worker.onerror = event => { event.preventDefault?.(); useInterval(); };
            } catch { useInterval(); }
        } else useInterval();
        const ready = sync();
        return { ready, sync, getState: () => ({ paired: !!session, desktopConnected, lastError, trackUri: lastUri || null }),
            dispose() {
                if (disposed) return; disposed = true;
                if (timer !== null) { host.clearInterval(timer); timer = null; }
                stopWorker();
                for (const controller of controllers) controller.abort();
                controllers.clear(); session = null; seen.clear();
            } };
    }
    const api = { create, readState, dispatch };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') window.SpotifyHangulDesktopBridge = api;
})();
