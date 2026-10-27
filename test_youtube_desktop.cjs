/** @file test_youtube_desktop.cjs
 * @author: ForUltraplayer
 * @brief Verify authenticated desktop pairing, stale-command rejection and correct native/link control routing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const bridge = require('./youtube-desktop-bridge.js');

const URI = 'spotify:track:6x7SB38tuekpu4xpH9OIPY';
const TOKEN = 'x'.repeat(43);
function harness(handler) {
    const timers = new Map(), calls = []; let counter = 0;
    const item = { uri: URI, name: 'native', metadata: { title: 'native', artist_name: 'artist' } };
    const player = { data: { item }, isPlaying: () => false, getProgress: () => 1200, getDuration: () => 5000 };
    for (const name of ['back', 'togglePlay', 'play', 'pause', 'next']) player[name] = () => calls.push(name);
    const requests = [];
    const host = { Spicetify: { Player: player }, OverlaySender: { port: 15000 }, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
        setInterval(fn) { timers.set(++counter, fn); return counter; }, clearInterval(id) { timers.delete(id); },
        setTimeout(fn) { timers.set(++counter, fn); return counter; }, clearTimeout(id) { timers.delete(id); },
        fetch: async (url, options) => { requests.push({ path: new URL(url).pathname, options });
            if (handler) return handler(url, options);
            const body = url.endsWith('/playback-session') ? { bridgeUrl: 'http://127.0.0.1:19643', token: TOKEN, expiresAt: Date.now() + 900000 }
                : url.endsWith('/playback-commands') ? { commands: [] } : {};
            return { ok: true, status: 200, json: async () => body };
        } };
    return { host, player, item, calls, timers, requests };
}
function workerHarness(handler) {
    const h = harness(handler), blobs = new Map(), workers = [], revoked = [], intervals = [];
    const setInterval = h.host.setInterval;
    h.host.setInterval = (fn, delay) => { intervals.push(delay); return setInterval(fn, delay); };
    h.host.Blob = class { constructor(parts, options) { this.source = parts.join(''); this.type = options.type; } };
    h.host.URL = { createObjectURL(blob) { const url = 'blob:owned-' + blobs.size; blobs.set(url, blob); return url; },
        revokeObjectURL(url) { revoked.push(url); } };
    h.host.Worker = class {
        constructor(url) {
            this.url = url; this.terminated = false; this.ticks = [];
            workers.push(this);
            vm.runInNewContext(blobs.get(url).source, {
                setInterval: (fn, delay) => { this.ticks.push({ fn, delay }); },
                postMessage: data => this.onmessage?.({ data }),
            });
        }
        terminate() { this.terminated = true; }
    };
    return { ...h, workers, blobs, revoked, intervals };
}
test('native publication uses the actual item and finite native clock without modifying player data', () => {
    const h = harness(); const before = h.player.data;
    assert.deepEqual(bridge.readState(h.host), { trackUri: URI, source: 'spotify', isPlaying: false, position: 1200, duration: 5000, title: 'native', artist: 'artist' });
    h.player.getProgress = () => NaN; h.player.getDuration = () => Infinity;
    assert.equal(bridge.readState(h.host).position, 0); assert.equal(bridge.readState(h.host).duration, 0);
    assert.equal(h.player.data, before);
});
test('link publication uses virtual identity and source time while Spotify is paused', () => {
    const h = harness();
    h.host.SpotifyHangulLinks = { playbackState: () => ({ active: true, playing: true, kind: 'youtube' }),
        snapshot: () => ({ active: true, playing: true, state: { seconds: 2.5, duration: 244 } }),
        currentTrack: () => ({ uri: 'youtube:video:_-uHa5KiR90', metadata: { title: 'cover', artist_name: 'singer' } }) };
    assert.deepEqual(bridge.readState(h.host), { trackUri: 'youtube:video:_-uHa5KiR90', source: 'youtube', isPlaying: true, position: 2500, duration: 244000, title: 'cover', artist: 'singer' });
    assert.equal(h.player.data.item, h.item);
});
test('commands are scoped to the still-current track and allowlisted actions', async () => {
    const h = harness();
    assert.equal(await bridge.dispatch(h.host, { action: 'next', trackUri: 'spotify:track:old' }), false);
    assert.equal(await bridge.dispatch(h.host, { action: 'logout', trackUri: URI }), false);
    await bridge.dispatch(h.host, { action: 'previous', trackUri: URI });
    await bridge.dispatch(h.host, { action: 'next', trackUri: URI });
    assert.deepEqual(h.calls, ['back', 'next']);
});
test('explicit YouTube play and pause use the link engine while navigation keeps wrapped player methods', async () => {
    const h = harness(); const linked = [];
    h.host.SpotifyHangulLinks = { playbackState: () => ({ active: true, playing: true, kind: 'youtube' }),
        snapshot: () => ({ state: { seconds: 2.5, duration: 244 } }), currentTrack: () => ({ uri: 'youtube:video:_-uHa5KiR90' }),
        play: () => linked.push('play'), pause: () => linked.push('pause') };
    for (const action of ['play', 'pause', 'next', 'previous', 'toggle']) await bridge.dispatch(h.host, { action, trackUri: 'youtube:video:_-uHa5KiR90' });
    assert.deepEqual(linked, ['play', 'pause']); assert.deepEqual(h.calls, ['next', 'back', 'togglePlay']);
});
test('pairing precedes desktop configuration, publication and queue drain without token disclosure', async () => {
    const h = harness(), instance = bridge.create(h.host); await instance.ready;
    assert.deepEqual(h.requests.map(r => r.path), ['/playback-session', '/playback-config', '/playback-state', '/playback-commands']);
    const config = JSON.parse(h.requests[1].options.body);
    assert.equal(config.bridgeUrl, 'http://127.0.0.1:19643'); assert.equal(config.token, TOKEN);
    assert.equal(h.requests[2].options.headers['X-Hangul-Overlay-Token'], TOKEN);
    assert.equal(JSON.stringify(instance.getState()).includes(TOKEN), false);
    assert.equal(instance.getState().desktopConnected, true);
    instance.dispose(); assert.equal(h.timers.size, 0);
});
test('a replayed queue ID executes once and late commands for another recording are ignored', async () => {
    const h = harness(async url => ({ ok: true, status: 200, json: async () => url.endsWith('/playback-session')
        ? { bridgeUrl: 'http://127.0.0.1:19643', token: TOKEN, expiresAt: Date.now() + 900000 }
        : url.endsWith('/playback-commands') ? { commands: [{ id: 1, action: 'next', trackUri: URI }, { id: 2, action: 'pause', trackUri: 'old' }] } : {} }));
    const instance = bridge.create(h.host); await instance.ready; await instance.sync();
    assert.deepEqual(h.calls, ['next']); instance.dispose();
});
test('an older desktop binary does not block native/link state publication', async () => {
    const h = harness(async url => ({ ok: !url.endsWith('/playback-config'), status: url.endsWith('/playback-config') ? 404 : 200,
        json: async () => url.endsWith('/playback-session') ? { bridgeUrl: 'http://127.0.0.1:19643', token: TOKEN, expiresAt: Date.now() + 900000 }
            : url.endsWith('/playback-commands') ? { commands: [] } : {} }));
    const instance = bridge.create(h.host); await instance.ready;
    assert.equal(instance.getState().desktopConnected, false); assert.ok(h.requests.some(r => r.path === '/playback-state'));
    await instance.sync(); assert.equal(h.requests.filter(r => r.path === '/playback-config').length, 1); instance.dispose();
});
test('invalid pairing endpoints are rejected before publication or outbound desktop configuration', async () => {
    const h = harness(async () => ({ ok: true, status: 200, json: async () => ({ bridgeUrl: 'https://unrelated.example', token: TOKEN, expiresAt: Date.now() + 900000 }) }));
    const instance = bridge.create(h.host); await instance.ready;
    assert.equal(instance.getState().paired, false); assert.equal(h.requests.length, 1); instance.dispose();
});
test('disposing an in-flight request aborts work and prevents later command dispatch', async () => {
    const h = harness((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('disposed', 'AbortError')), { once: true });
    }));
    const instance = bridge.create(h.host); instance.dispose(); await instance.ready;
    assert.equal(h.timers.size, 0); assert.deepEqual(h.calls, []); assert.equal(instance.getState().paired, false);
});
test('a URI transition requests the public desktop lyrics resync without a native songchange broadcast', async () => {
    const h = harness(); let syncs = 0;
    h.host.ivLyricsOverlayService = { syncNow() { syncs++; } };
    const instance = bridge.create(h.host); await instance.ready; await instance.sync();
    assert.equal(syncs, 1);
    h.player.data.item = { ...h.item, uri: 'spotify:track:1p4EbJLS0jdWX3tOHdru8S' }; await instance.sync();
    assert.equal(syncs, 2); instance.dispose();
});
test('the real compact playback API obtains media time from snapshot and publishes its required backend source', async () => {
    const h = harness(); let seconds = 27.125;
    h.host.SpotifyHangulLinks = {
        playbackState: () => ({ active: true, playing: true, kind: 'youtube' }),
        snapshot: () => ({ active: true, kind: 'youtube', mediaMode: 'direct', playing: true, state: { seconds, duration: 243.581 } }),
        currentTrack: () => ({ uri: 'youtube:video:_-uHa5KiR90', metadata: { title: 'Finale', artist_name: 'Cover singer' } }),
    };
    const instance = bridge.create(h.host); await instance.ready;
    const publication = () => JSON.parse(h.requests.filter(request => request.path === '/playback-state').at(-1).options.body);
    assert.equal(instance.getState().paired, true); assert.equal(instance.getState().lastError, '');
    assert.equal(publication().source, 'youtube'); assert.equal(publication().position, 27125); assert.equal(publication().duration, 243581);
    seconds = 33.75; await instance.sync(); assert.equal(publication().position, 33750);
    assert.equal(h.player.data.item, h.item); instance.dispose();
});
test('inactive compact state does not borrow stale YouTube snapshot time or source', () => {
    const h = harness(); let snapshots = 0;
    h.host.SpotifyHangulLinks = { playbackState: () => ({ active: false, playing: false, kind: 'spotify' }),
        snapshot: () => { snapshots++; return { active: true, state: { seconds: 44, duration: 194 } }; },
        currentTrack: () => ({ uri: 'youtube:video:_-uHa5KiR90' }) };
    const state = bridge.readState(h.host);
    assert.equal(state.source, 'spotify'); assert.equal(state.trackUri, URI); assert.equal(state.position, 1200); assert.equal(snapshots, 0);
});
test('a null track preserves pairing and command draining without publishing an invalid state or executing obsolete commands', async () => {
    const h = harness(async url => ({ ok: true, status: 200, json: async () => url.endsWith('/playback-session')
        ? { bridgeUrl: 'http://127.0.0.1:19643', token: TOKEN, expiresAt: Date.now() + 900000 }
        : url.endsWith('/playback-commands') ? { commands: [{ id: 'old', action: 'next', trackUri: URI }] } : {} }));
    h.player.data.item = null;
    assert.deepEqual(bridge.readState(h.host), { trackUri: null, source: null, isPlaying: false, position: 0, duration: 0, title: '', artist: '' });
    const instance = bridge.create(h.host); await instance.ready; await instance.sync();
    assert.equal(instance.getState().paired, true); assert.equal(instance.getState().lastError, '');
    assert.equal(h.requests.some(request => request.path === '/playback-state'), false);
    assert.equal(h.requests.filter(request => request.path === '/playback-commands').length, 2); assert.deepEqual(h.calls, []);
    h.player.data.item = h.item; await instance.sync();
    assert.equal(JSON.parse(h.requests.find(request => request.path === '/playback-state').options.body).source, 'spotify');
    assert.equal(instance.getState().paired, true); instance.dispose();
});
test('missing virtual identity and unsupported local native URIs never fall back to a different recording', () => {
    const h = harness();
    h.host.SpotifyHangulLinks = { playbackState: () => ({ active: true, playing: true, kind: 'youtube' }),
        snapshot: () => ({ state: { seconds: 40, duration: 194 } }), currentTrack: () => null };
    assert.equal(bridge.readState(h.host).trackUri, null); assert.equal(bridge.readState(h.host).isPlaying, false);
    delete h.host.SpotifyHangulLinks; h.player.data.item = { uri: 'spotify:local:artist:album:song:194' };
    assert.equal(bridge.readState(h.host).trackUri, null); assert.equal(bridge.readState(h.host).source, null);
});
test('the owned worker keeps paused publication alive without relying on window interval ticks', async () => {
    const h = workerHarness(), instance = bridge.create(h.host); await instance.ready;
    const worker = h.workers[0];
    assert.equal(h.workers.length, 1); assert.deepEqual(h.intervals, []);
    assert.equal(worker.ticks[0].delay, 500); assert.equal(h.blobs.get(worker.url).type, 'text/javascript');
    assert.equal(JSON.parse(h.requests.find(r => r.path === '/playback-state').options.body).isPlaying, false);
    worker.ticks[0].fn(); await instance.sync();
    assert.equal(h.requests.filter(r => r.path === '/playback-state').length, 2);
    assert.equal(h.requests.filter(r => r.path === '/playback-session').length, 1);
    assert.equal(h.requests.filter(r => r.path === '/playback-config').length, 1);
    const lateMessage = worker.onmessage;
    instance.dispose(); instance.dispose();
    assert.equal(worker.terminated, true); assert.deepEqual(h.revoked, [worker.url]); assert.equal(h.timers.size, 0);
    const before = h.requests.length; lateMessage({ data: 'tick' }); worker.ticks[0].fn();
    assert.equal(h.requests.length, before);
});
test('worker tick bursts share one request cycle and consume each command ID only once', async () => {
    const h = workerHarness(async url => ({ ok: true, status: 200, json: async () => url.endsWith('/playback-session')
        ? { bridgeUrl: 'http://127.0.0.1:19643', token: TOKEN, expiresAt: Date.now() + 900000 }
        : url.endsWith('/playback-commands') ? { commands: [{ id: 'same', action: 'next', trackUri: URI }] } : {} }));
    const instance = bridge.create(h.host); await instance.ready;
    const worker = h.workers[0], before = h.requests.length;
    worker.onmessage({ data: 'unexpected' }); assert.equal(h.requests.length, before);
    for (let i = 0; i < 20; i++) worker.ticks[0].fn();
    await instance.sync();
    assert.equal(h.requests.filter(r => r.path === '/playback-state').length, 2);
    assert.equal(h.requests.filter(r => r.path === '/playback-session').length, 1);
    assert.deepEqual(h.calls, ['next']); instance.dispose();
});
test('worker initialization failure releases the URL and installs a single fallback interval', async () => {
    const h = workerHarness(); h.host.Worker = class { constructor() { throw Error('Worker blocked'); } };
    const instance = bridge.create(h.host); await instance.ready;
    assert.deepEqual(h.intervals, [500]); assert.deepEqual(h.revoked, ['blob:owned-0']);
    assert.equal(h.timers.size, 1); assert.equal(instance.getState().paired, true);
    instance.dispose(); assert.equal(h.timers.size, 0); assert.deepEqual(h.revoked, ['blob:owned-0']);
});
test('asynchronous worker failure switches to one bounded fallback and terminates its worker', async () => {
    const h = workerHarness(), instance = bridge.create(h.host); await instance.ready;
    const worker = h.workers[0], error = worker.onerror; let prevented = 0;
    error({ preventDefault() { prevented++; } }); error({ preventDefault() { prevented++; } });
    assert.equal(prevented, 2); assert.equal(worker.terminated, true); assert.equal(worker.onmessage, null);
    assert.deepEqual(h.intervals, [500]); assert.deepEqual(h.revoked, [worker.url]); assert.equal(h.timers.size, 1);
    [...h.timers.values()][0](); await instance.sync();
    assert.equal(h.requests.filter(r => r.path === '/playback-state').length, 2);
    instance.dispose(); assert.equal(h.timers.size, 0);
});
test('unavailable worker APIs preserve the interval fallback and create no worker resources', async () => {
    for (const unavailable of ['Worker', 'Blob', 'createObjectURL', 'revokeObjectURL']) {
        const h = workerHarness();
        if (unavailable.endsWith('ObjectURL')) delete h.host.URL[unavailable]; else delete h.host[unavailable];
        const instance = bridge.create(h.host); await instance.ready;
        assert.deepEqual(h.intervals, [500]); assert.equal(h.workers.length, 0); assert.equal(h.blobs.size, 0);
        instance.dispose(); assert.equal(h.timers.size, 0);
    }
});
test('disposing a worker-backed bridge aborts its pending fetch and releases every owned resource', async () => {
    const h = workerHarness((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('disposed', 'AbortError')), { once: true });
    }));
    const instance = bridge.create(h.host); instance.dispose(); await instance.ready;
    assert.equal(h.workers[0].terminated, true); assert.equal(h.revoked.length, 1);
    assert.equal(h.timers.size, 0); assert.deepEqual(h.calls, []); assert.equal(instance.getState().paired, false);
});
