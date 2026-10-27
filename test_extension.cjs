/** @file test_extension.cjs
 * @author: ForUltraplayer
 * @brief Verify legacy-label filtering through the actual ivLyrics cache boundary.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const linkModel = require('./youtube-links.js');

test('link player accepts canonical YouTube, Music and short links without media downloads', () => {
    for (const value of ['https://www.youtube.com/watch?v=rKQptWhAvO0', 'https://music.youtube.com/watch?v=rKQptWhAvO0&list=PLtest', 'https://youtu.be/rKQptWhAvO0?t=3', 'https://www.youtube.com/shorts/rKQptWhAvO0']) {
        assert.equal(linkModel.youtubeId(value), 'rKQptWhAvO0');
    }
});
test('link player rejects unrelated, credentialed and executable URLs', () => {
    for (const value of ['javascript:alert(1)', 'file:///C:/music.mp3', 'http://youtube.com/watch?v=rKQptWhAvO0', 'https://youtube.com.evil.test/watch?v=rKQptWhAvO0', 'https://name:password@youtube.com/watch?v=rKQptWhAvO0', 'https://youtube.com/playlist?list=PLtest']) assert.equal(linkModel.youtubeId(value), null);
});
test('mixed link lists preserve Spotify identities and discard unsupported items', () => {
    const value = linkModel.library({ schema: 1, playlists: [{ id: 'test', name: 'mixed', tracks: [{ kind: 'youtube', videoId: 'rKQptWhAvO0', title: 'cover' }, { kind: 'spotify', uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', title: 'original' }, { kind: 'spotify', uri: 'https://evil.test/' }] }] });
    assert.deepEqual(value.playlists[0].tracks.map(t => t.kind), ['youtube', 'spotify']);
    assert.equal(value.playlists[0].tracks[1].uri, 'spotify:track:6x7SB38tuekpu4xpH9OIPY');
});
test('link queue has bounded end, repeat-one, repeat-all and nonrepeating shuffle contracts', () => {
    assert.equal(linkModel.nextIndex(1, 2, 1, 'off', false), -1);
    assert.equal(linkModel.nextIndex(1, 2, 0, 'one', false), 1);
    assert.equal(linkModel.nextIndex(1, 2, 1, 'all', false), 0);
    assert.equal(linkModel.nextIndex(0, 2, -1, 'all', false), 1);
    for (let i = 0; i < 4; i++) assert.notEqual(linkModel.nextIndex(i, 4, 1, 'off', true, () => 0.5), i);
    assert.equal(linkModel.nextIndex(0, 0, 1, 'all', true), -1);
});
test('malformed persisted link lists recover without activating playback', () => {
    for (const value of [null, {}, { schema: 2, playlists: [] }, { schema: 1, playlists: [null] }]) assert.deepEqual(linkModel.library(value), { schema: 1, playlists: [{ id: 'default', name: '링크 음악', tracks: [] }] });
});

const nativeItems = [
    { kind: 'spotify', uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', entryKey: 'first' },
    { kind: 'spotify', uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', entryKey: 'duplicate' },
];
test('playlist bindings survive storage and do not accept unrelated source identities', () => {
    const value = linkModel.library({ schema: 1, playlists: [
        { id: 'native', name: 'mix', sourceUri: 'spotify:playlist:5C3W78fpJbRdLpbr7kvAMe', tracks: [{ kind: 'youtube', videoId: 'rKQptWhAvO0', after: 'duplicate' }] },
        { id: 'bad', sourceUri: 'https://evil.test', tracks: [] },
    ] });
    assert.equal(value.playlists[0].sourceUri, 'spotify:playlist:5C3W78fpJbRdLpbr7kvAMe');
    assert.equal(value.playlists[0].tracks[0].after, 'duplicate');
    assert.equal(value.playlists[1].sourceUri, undefined);
});
test('native playlist order stays live and duplicate recordings have distinct insertion anchors', () => {
    const links = [{ kind: 'youtube', videoId: 'rKQptWhAvO0', after: 'first' }];
    assert.deepEqual(linkModel.merge(nativeItems, links).map(t => t.entryKey || t.videoId), ['first', 'rKQptWhAvO0', 'duplicate']);
    assert.deepEqual(linkModel.merge([...nativeItems].reverse(), links).map(t => t.entryKey || t.videoId), ['duplicate', 'first', 'rKQptWhAvO0']);
    assert.equal(nativeItems.length, 2);
    assert.equal(links[0].after, 'first');
});
test('removed native anchors keep links available at the end rather than losing their recordings', () => {
    const links = [{ kind: 'youtube', videoId: 'rKQptWhAvO0', after: 'removed' }, { kind: 'youtube', videoId: 'abcdefghijk', after: '' }];
    assert.deepEqual(linkModel.merge(nativeItems, links).map(t => t.entryKey || t.videoId), ['abcdefghijk', 'first', 'duplicate', 'rKQptWhAvO0']);
});
test('moving YouTube entries across native rows changes local anchors without reordering Spotify data', () => {
    const links = [{ kind: 'youtube', videoId: 'rKQptWhAvO0', after: 'first' }];
    const moved = linkModel.place(nativeItems, links, 'rKQptWhAvO0', 2);
    assert.deepEqual(linkModel.merge(nativeItems, moved).map(t => t.entryKey || t.videoId), ['first', 'duplicate', 'rKQptWhAvO0']);
    assert.equal(moved[0].after, 'duplicate');
    const top = linkModel.place(nativeItems, moved, 'rKQptWhAvO0', 0);
    assert.equal(top[0].after, '');
    assert.deepEqual(linkModel.merge(nativeItems, top).map(t => t.entryKey || t.videoId), ['rKQptWhAvO0', 'first', 'duplicate']);
    assert.deepEqual(nativeItems.map(t => t.entryKey), ['first', 'duplicate']);
    assert.equal(links[0].after, 'first');
});
test('a shared mixed order can move Spotify and YouTube entries without changing the source playlist', () => {
    const links = [{ kind: 'youtube', videoId: 'rKQptWhAvO0', after: 'first' }];
    const live = linkModel.merge(nativeItems, links);
    const order = linkModel.reorder(live, 'sp:duplicate', 0);
    assert.deepEqual(linkModel.merge(nativeItems, links, order).map(linkModel.rowKey), ['sp:duplicate', 'sp:first', 'yt:rKQptWhAvO0']);
    assert.deepEqual(nativeItems.map(t => t.entryKey), ['first', 'duplicate']);
    const changed = [{ ...nativeItems[0], entryKey: 'new' }, nativeItems[1]];
    assert.deepEqual(linkModel.merge(changed, links, order).map(linkModel.rowKey), ['sp:duplicate', 'yt:rKQptWhAvO0', 'sp:new']);
});
test('imported local native snapshots and search metadata survive a full library reload', () => {
    const result=linkModel.library({schema:1,playlists:[{id:'imported',local:true,name:'restored',nativeTracks:[{...nativeItems[0],title:'Native',duration:42,album:'Album',image:'https://i.scdn.co/image/abc?token=discard'}],tracks:[{kind:'youtube',videoId:'_-uHa5KiR90',lyricTitle:'フィナーレ。',lyricArtist:'eill'}],order:['yt:_-uHa5KiR90','sp:first']}]});
    const playlist=result.playlists[0];
    assert.equal(playlist.local,true);assert.equal(playlist.nativeTracks[0].entryKey,'first');
    assert.equal(playlist.nativeTracks[0].image,'https://i.scdn.co/image/abc');
    assert.equal(playlist.tracks[0].lyricArtist,'eill');
    assert.deepEqual(linkModel.merge(playlist.nativeTracks,playlist.tracks,playlist.order).map(linkModel.rowKey),['yt:_-uHa5KiR90','sp:first']);
});
test('native playlist integration waits for router and topbar readiness before creating UI', () => {
    for (const history of [null, { listen() {} }]) {
        const delays = [];
        const api = { Player: {}, Topbar: {}, Menu: {}, Platform: { History: history } };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'youtube-links.js'), 'utf8'), {
            window: { Spicetify: api }, Spicetify: api,
            document: { querySelector: () => null, createElement: () => assert.fail('UI created before readiness') },
            setTimeout: (_fn, delay) => delays.push(delay),
        });
        assert.deepEqual(delays, [1000]);
    }
});

function loadYouTubeFrame() {
    const html = fs.readFileSync(path.join(__dirname, 'youtube-player.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    const messages=[],listeners = new Map(), calls = [], parent = { postMessage(value) {messages.push(value);} };
    let playerConfig;
    const player = {
        getVideoData: () => ({ video_id: 'rKQptWhAvO0' }), getPlayerState: () => 2,
        getCurrentTime: () => 0, getDuration: () => 194, getVolume: () => 25,
        isMuted: () => false, getPlaybackQuality: () => 'large',
        setVolume: value => calls.push(['volume', value]), unMute: () => calls.push(['unmute']),
        playVideo: () => calls.push(['play']), pauseVideo: () => calls.push(['pause']),
        loadVideoById: value => calls.push(['load', value.videoId]),
        cueVideoById: value => calls.push(['cue', value.videoId]),
        seekTo: value => calls.push(['seek', value]),
    };
    const window = { addEventListener: (type, listener) => listeners.set(type, listener) };
    const context = vm.createContext({ window, parent, location: { hash: '#session=trusted-session', origin: 'http://127.0.0.1:19643' }, URLSearchParams,
        document: { getElementById: () => ({ style: {}, textContent: '' }), createElement: () => ({}), head: { append() {} } },
        YT: { Player: function (_id, config) { playerConfig = config; return player; } },
        setInterval: () => 1, setTimeout: () => 1, clearInterval() {}, console,
    });
    new vm.Script(scripts[0][1], { filename: 'youtube-player.html' }).runInContext(context);
    window.onYouTubeIframeAPIReady(); playerConfig.events.onReady(); calls.length = 0;
    return { listener: listeners.get('message'), calls, parent, config:playerConfig, messages };
}
test('standard player reports embed errors and video quality events for the fallback boundary', () => {
    const frame=loadYouTubeFrame();frame.config.events.onError({data:150});
    assert.equal(frame.messages.at(-1).errorCode,150);
    frame.config.events.onPlaybackQualityChange({data:'hd720'});
    assert.equal(frame.messages.at(-1).quality,'hd720');
});
test('isolated player ignores untrusted origins, frames and session identifiers', () => {
    const frame = loadYouTubeFrame();
    const data = { type: 'spotify-hangul-youtube-command', session: 'trusted-session', command: 'play' };
    frame.listener({ origin: 'https://evil.test', source: frame.parent, data });
    frame.listener({ origin: 'https://xpui.app.spotify.com', source: {}, data });
    frame.listener({ origin: 'https://xpui.app.spotify.com', source: frame.parent, data: { ...data, session: 'other' } });
    assert.deepEqual(frame.calls, []);
    frame.listener({ origin: 'https://xpui.app.spotify.com', source: frame.parent, data });
    assert.deepEqual(frame.calls, [['unmute'], ['play']]);
});
test('trusted link player commands reject invalid media identities and bound seeking', () => {
    const frame = loadYouTubeFrame();
    const send = extra => frame.listener({ origin: 'https://xpui.app.spotify.com', source: frame.parent,
        data: { type: 'spotify-hangul-youtube-command', session: 'trusted-session', ...extra } });
    send({ command: 'load', videoId: 'https://evil.test/' });
    assert.deepEqual(frame.calls, []);
    send({ command: 'load', videoId: 'rKQptWhAvO0', autoplay: false });
    send({ command: 'seek', seconds: 500 });
    send({ command: 'volume', volume: -10 });
    assert.deepEqual(frame.calls, [['cue', 'rKQptWhAvO0'], ['seek', 194], ['volume', 0]]);
});

function loadExtension(record, response) {
    let saved = record;
    const values = new Map();
    const notices = [];
    const listeners = new Map();
    const delays = [];
    const cache = { async getTranslation() { assert.equal(this, cache); return saved; },
        async setTranslation(track, lang, phonetic, data) { assert.equal(this, cache); saved = data; return true; } };
    const api = { LocalStorage: { get: key => values.get(key), set: (key, value) => values.set(key, value) },
        Player: { data: { item: { uri: 'spotify:track:test' } } }, showNotification: value => notices.push(value) };
    api.Player.addEventListener = (event, fn) => listeners.set(event, fn);
    api.Player.removeEventListener = (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event); };
    const window = { Spicetify: api, LyricsService: { cache, getTranslationCacheId: uri => uri?.replace(/^spotify:track:/, '') }, AIAddonManager: { register() {} } };
    const context = { window, Spicetify: api, URL, setTimeout: (fn, ms) => {
        if (ms <= 5000) { delays.push(ms); return setTimeout(fn, 0); }
        return 0;
    }, clearTimeout, AbortController,
        fetch: async (url, options) => {
            context.lastRequest = JSON.parse(options.body);
            context.requestCount = (context.requestCount || 0) + 1;
            if (typeof response === 'function') return response(context.lastRequest, context.requestCount, options);
            return { ok: true, json: async () => response };
        } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'hangul-lyrics.js'), 'utf8'), context);
    Object.defineProperty(cache, 'harness', { value: { context, values, notices, listeners, delays, getSaved: () => saved } });
    return cache;
}

function linkLoaderHarness({ health, failScript = false, existing = false } = {}) {
    const cache = loadExtension(null, null), { context } = cache.harness, scripts = [], timers = [], requests = [];
    const currentHealth = { app: 'ivLyricsHangul', version: require('./release.json').helper_version, protocol: 1,
        capabilities: ['youtube-links-v1', 'mixed-playlists-v1', 'playback-control-v1', 'lyric-sync-v1'] };
    const makeScript = () => {
        const listeners = new Map();
        const script = { dataset: {}, removed: false,
            addEventListener(type, listener) { listeners.set(type, listener); },
            removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
            remove() { script.removed = true; },
            emit(type) { script['on' + type]?.(); listeners.get(type)?.(); } };
        return script;
    };
    const existingScript = existing ? makeScript() : null;
    if (existingScript) { existingScript.src = 'http://127.0.0.1:19643/youtube/extension.js'; scripts.push(existingScript); }
    context.window.document = {
        querySelector() { return scripts.find(script => !script.removed); },
        createElement(name) { assert.equal(name, 'script'); return makeScript(); },
        head: { append(script) { scripts.push(script); Promise.resolve().then(() => script.emit(failScript ? 'error' : 'load')); } },
    };
    context.setTimeout = (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return timer; };
    context.clearTimeout = timer => { if (timer) timer.cancelled = true; };
    context.fetch = async (url, options) => {
        requests.push({ url, credentials: options.credentials });
        const value = typeof health === 'function' ? health(requests.length, currentHealth) : health || currentHealth;
        return { ok: true, json: async () => value };
    };
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    const retry = async () => {
        await flush(); const timer = timers.find(timer => !timer.cancelled && timer.ms === 2000);
        assert.ok(timer, 'A bounded two-second retry was scheduled'); timer.cancelled = true; timer.fn(); await flush();
    };
    return { context, window: context.window, scripts, timers, requests, existingScript, flush, retry,
        load: () => context.window.HangulLyricsProvider.ensureLinkPlayer() };
}

test('installed extension loads the local link feature once across concurrent initializations', async () => {
    const h = linkLoaderHarness();
    const first = h.load(), second = h.load();
    assert.equal(first, second); await first;
    await h.load();
    assert.equal(h.requests.length, 1); assert.equal(h.scripts.length, 1);
    assert.equal(h.requests[0].url, 'http://127.0.0.1:19643/health');
    assert.equal(h.requests[0].credentials, 'omit');
    assert.equal(h.scripts[0].src, 'http://127.0.0.1:19643/youtube/extension.js');
    assert.equal(h.window.SpotifyHangulLinkLoader.loaded, true);
    assert.equal(h.timers.filter(t => !t.cancelled).length, 0);
});

test('normal pronunciation-provider registration bootstraps links without invoking provider settings', async () => {
    const h = linkLoaderHarness();
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'hangul-lyrics.js'), 'utf8'), h.context);
    await h.window.SpotifyHangulLinkLoader.promise;
    assert.equal(h.requests.length, 1); assert.equal(h.scripts.length, 1);
    assert.equal(h.window.SpotifyHangulLinkLoader.loaded, true);
});

test('installed extension waits for a late helper with bounded two-second retry intervals', async () => {
    const h = linkLoaderHarness({ health: (count, value) => { if (count < 3) throw new TypeError('helper not ready'); return value; } });
    const task = h.load(); await h.flush(); assert.equal(h.scripts.length, 0);
    await h.retry(); assert.equal(h.scripts.length, 0);
    await h.retry(); await task;
    assert.equal(h.requests.length, 3); assert.equal(h.scripts.length, 1);
    assert.equal(h.window.SpotifyHangulLinkLoader.attempts, 3);
});

test('installed extension stops after three extra script failures and does not restart an initialization storm', async () => {
    const h = linkLoaderHarness({ failScript: true });
    const task = h.load(); const failure = assert.rejects(task, /YouTube/);
    for (let i = 0; i < 3; i++) await h.retry(); await failure;
    assert.equal(h.requests.length, 4); assert.equal(h.scripts.length, 4);
    assert.equal(h.scripts.every(script => script.removed), true);
    assert.equal(h.window.SpotifyHangulLinkLoader.attempts, 4);
    await assert.rejects(h.load(), /YouTube/);
    assert.equal(h.requests.length, 4);
    assert.equal(h.timers.filter(t => !t.cancelled).length, 0);
});

test('installed extension rejects incompatible helper capabilities without injecting a script', async () => {
    const h = linkLoaderHarness({ health: (_count, value) => ({ ...value, capabilities: value.capabilities.join(',') }) });
    const task = h.load(); const failure = assert.rejects(task, /도우미 버전/);
    for (let i = 0; i < 3; i++) await h.retry(); await failure;
    assert.equal(h.requests.length, 4); assert.equal(h.scripts.length, 0);
});

test('installed extension reuses an existing loading script and an already active controller', async () => {
    const h = linkLoaderHarness({ existing: true }); const task = h.load(); await h.flush();
    assert.equal(h.scripts.length, 1); h.existingScript.emit('load'); await task;
    assert.equal(h.window.SpotifyHangulLinkLoader.loaded, true);
    const active = linkLoaderHarness(); active.window.SpotifyHangulLinks = {};
    await active.load(); assert.equal(active.requests.length, 0); assert.equal(active.scripts.length, 0);
});

test('stored pronunciation labels are hidden without changing the original cache record', async () => {
    const record = { phonetic: ['〔문장 전체〕기존 발음', '[문장 전체] 다른 발음', '', '원래 발음'],
        translation: ['뜻은 유지'], source: 'existing', timings: [10, 20] };
    const cache = loadExtension(record);
    const result = await cache.getTranslation('track', 'ko', true);
    assert.deepEqual(Array.from(result.phonetic), ['기존 발음', '다른 발음', '', '원래 발음']);
    assert.equal(record.phonetic[0], '〔문장 전체〕기존 발음');
    assert.equal(result.timings, record.timings);
    assert.equal(result.translation, record.translation);
    assert.equal(result.source, record.source);
});

test('translation requests and absent caches retain their contract', async () => {
    const record = { translation: ['〔문장 전체〕인용문은 보존'] };
    assert.equal(await loadExtension(record).getTranslation('track', 'ko', false), record);
    assert.equal(await loadExtension(null).getTranslation('track', 'ko', true), null);
});

test('automatic fallback is explicit and source metadata survives the real cache boundary', async () => {
    const response = { valid: true, phonetic: ['츠키노미치'], reading_kind: 'automatic',
        generated_lines: [0], matched: 0, total: 1, source_url: '', source_title: '기기 내부 자동 발음' };
    const cache = loadExtension(null, response);
    const h = cache.harness;
    h.values.set('ivLyrics:hangul-web:automatic-fallback', 'true');
    const result = await h.context.window.HangulLyricsProvider.addon.translateLyrics({
        title: 'Test', artist: 'Artist', text: '月の道', lang: 'ko', sourceLang: 'ja', wantSmartPhonetic: true
    });
    assert.equal(h.context.lastRequest.automatic_fallback, true);
    await cache.setTranslation('test', 'ko', true, { phonetic: result.phonetic }, 'web-hangul');
    assert.equal(h.getSaved().hangulReading.reading_kind, 'automatic');
    assert.equal(h.getSaved().hangulReading.source_url, '');
    await cache.getTranslation('test', 'ko', true, 'web-hangul');
    assert.equal(h.notices.length, 0);
    h.values.set('ivLyrics:hangul-web:automatic-fallback', 'false');
    assert.equal(await cache.getTranslation('test', 'ko', true, 'web-hangul'), null);
    assert.equal(h.getSaved().phonetic[0], '츠키노미치');
});

test('default request uses authored readings and does not enable automatic generation', async () => {
    const cache = loadExtension(null, { valid: true, phonetic: ['츠키노 미치'], reading_kind: 'authored', generated_lines: [] });
    await cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics({
        title: 'Test', artist: 'Artist', text: '月の道', lang: 'ko', wantSmartPhonetic: true
    });
    assert.equal(cache.harness.context.lastRequest.automatic_fallback, false);
    assert.equal(cache.harness.notices.length, 0);
});

test('authored cache with a missing line is retried only when automatic fallback is enabled', async () => {
    const record = { phonetic: ['기존 발음', '(발음 자료 없음)'], hangulReading: { matching_version: '0.3.1' } };
    const cache = loadExtension(record);
    assert.ok(await cache.getTranslation('test', 'ko', true, 'web-hangul'));
    cache.harness.values.set('ivLyrics:hangul-web:automatic-fallback', 'true');
    assert.equal(await cache.getTranslation('test', 'ko', true, 'web-hangul'), null);
    const other = loadExtension({ phonetic: ['다른 제공자의 발음', '(발음 자료 없음)'] });
    other.harness.values.set('ivLyrics:hangul-web:automatic-fallback', 'true');
    assert.ok(await other.getTranslation('test', 'ko', true, 'other-provider'));
});

test('partial results from an older matcher are retried without deleting other providers', async () => {
    const cache = loadExtension({ phonetic: ['기존 발음', '(발음 자료 없음)'] });
    assert.equal(await cache.getTranslation('test', 'ko', true, 'web-hangul'), null);
    assert.ok(await cache.getTranslation('test', 'ko', true, 'other-provider'));
});

test('prefetching another song never uses the active song source override', async () => {
    const cache = loadExtension(null, { valid: true, phonetic: ['기존 발음'], generated_lines: [] });
    cache.harness.values.set('ivLyrics:hangul-web:sources', JSON.stringify({
        'spotify:track:test': 'https://namu.wiki/w/ActiveSong'
    }));
    await cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics({
        trackId: 'different-track', title: 'Other Song', artist: 'Artist', text: '月の道', lang: 'ko', wantSmartPhonetic: true
    });
    assert.equal(cache.harness.context.lastRequest.source_url, '');
});

const params = { trackId:'test', title:'Test', artist:'Artist', text:'月の道', lang:'ko', wantSmartPhonetic:true };
const authored = { valid:true,phonetic:['츠키노 미치'],reading_kind:'authored',generated_lines:[] };

test('a busy helper is retried and its successful result reaches the caller', async () => {
    const cache=loadExtension(null,async (_,count)=>count===1
        ? {ok:false,status:429,json:async()=>({error:'busy'})}
        : {ok:true,status:200,json:async()=>authored});
    const result=await cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params);
    assert.equal(result.phonetic[0],'츠키노 미치');
    assert.equal(cache.harness.context.requestCount,2);
});

test('a missing pronunciation is searched again rather than accepted as the final result', async () => {
    const attempts = [];
    const cache = loadExtension(null, async (body, count) => {
        attempts.push(body.retry_attempt);
        return count < 4 ? { ok: false, status: 404, json: async () => ({ error: 'not found yet' }) }
            : { ok: true, status: 200, json: async () => authored };
    });
    const result = await cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params);
    assert.deepEqual(attempts, [0, 1, 2, 3]);
    assert.deepEqual(cache.harness.delays, [2000, 2000, 2000]);
    assert.equal(result.hangulReading.lookup_attempts, 4);
    assert.equal(cache.harness.notices.length, 0);
    assert.equal(cache.harness.listeners.size, 0);
});

test('repeated failure stops after three extra attempts and remounts share the active job', async () => {
    const cache = loadExtension(null, async () => ({ ok: false, status: 503, json: async () => ({ error: 'temporary' }) }));
    const addon = cache.harness.context.window.HangulLyricsProvider.addon;
    await assert.rejects(Promise.all([addon.translateLyrics(params), addon.translateLyrics(params)]));
    assert.equal(cache.harness.context.requestCount, 4);
    assert.equal(cache.harness.listeners.size, 0);
});

test('invalid input is not retried and a valid result does not wait', async () => {
    const invalid = loadExtension(null, async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid' }) }));
    await assert.rejects(invalid.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params));
    assert.equal(invalid.harness.context.requestCount, 1);
    const good = loadExtension(null, authored);
    await good.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params);
    assert.equal(good.harness.context.requestCount, 1);
});

test('prefetch misses do not launch repeated web searches', async () => {
    const cache = loadExtension(null, async () => ({ ok: false, status: 404, json: async () => ({ error: 'missing' }) }));
    await assert.rejects(cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics({ ...params, trackId: 'next' }));
    assert.equal(cache.harness.context.requestCount, 1);
});

test('changing the track aborts the HTTP request and releases the song listener', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const cache = loadExtension(null, async (_, count, options) => {
        started();
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
            const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
        }, { once: true }));
    });
    const pending = cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params);
    await ready;
    cache.harness.context.Spicetify.Player.data.item.uri = 'spotify:track:next';
    cache.harness.listeners.get('songchange')();
    await assert.rejects(pending, error => error.superseded === true);
    assert.equal(cache.harness.context.requestCount, 1);
    assert.equal(cache.harness.listeners.size, 0);
});

test('a malformed successful response is retried before reaching the lyrics screen', async () => {
    const cache = loadExtension(null, async (_, count) => ({ ok: true, status: 200,
        json: async () => count === 1 ? { valid: false, phonetic: [] } : authored }));
    const result = await cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params);
    assert.equal(result.phonetic[0], authored.phonetic[0]);
    assert.equal(cache.harness.context.requestCount, 2);
});

test('the total lookup deadline prevents more source requests', async () => {
    let now = 0;
    const cache = loadExtension(null, async () => {
        now = 59999;
        return { ok: false, status: 503, json: async () => ({ error: 'temporary' }) };
    });
    cache.harness.context.Date = { now: () => now };
    await assert.rejects(cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params));
    assert.equal(cache.harness.context.requestCount, 1);
    assert.equal(cache.harness.listeners.size, 0);
});

test('changing tracks during the retry delay cancels its timer', async () => {
    let waiting;
    const ready = new Promise(resolve => { waiting = resolve; });
    const cache = loadExtension(null, async () => ({ ok: false, status: 404, json: async () => ({ error: 'missing' }) }));
    cache.harness.context.setTimeout = (fn, ms) => {
        if (ms === 2000) { waiting(); return setTimeout(fn, 5000); }
        return 0;
    };
    const pending = cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params);
    await ready;
    cache.harness.context.Spicetify.Player.data.item.uri = 'spotify:track:next';
    cache.harness.listeners.get('songchange')();
    await assert.rejects(pending, error => error.superseded === true);
    assert.equal(cache.harness.context.requestCount, 1);
    assert.equal(cache.harness.listeners.size, 0);
});

test('an old foreground retry stops when Spotify Connect changes the current track', async () => {
    const cache=loadExtension(null,async()=>{
        cache.harness.context.Spicetify.Player.data.item.uri='spotify:track:new';
        return {ok:false,status:429,json:async()=>({error:'busy'})};
    });
    await assert.rejects(cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params),e=>e.superseded===true);
    assert.equal(cache.harness.context.requestCount,1);
});

test('identical concurrent consumers share one HTTP lookup', async () => {
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    const cache=loadExtension(null,async()=>{await gate;return {ok:true,status:200,json:async()=>authored};});
    const addon=cache.harness.context.window.HangulLyricsProvider.addon;
    const first=addon.translateLyrics(params),second=addon.translateLyrics(params);
    release();
    const [a,b]=await Promise.all([first,second]);
    assert.equal(cache.harness.context.requestCount,1);
    assert.equal(a.phonetic[0],b.phonetic[0]);
});

test('helper supersession remains an AbortError instead of a connection failure', async () => {
    const cache=loadExtension(null,async()=>({ok:false,status:409,json:async()=>({error:'superseded',superseded:true})}));
    await assert.rejects(cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params),e=>e.name==='AbortError'&&e.superseded===true);
});

test('prefetched result metadata is not shown as the active track source', async () => {
    const cache=loadExtension(null,authored);
    await cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics({...params,trackId:'other'});
    assert.equal(cache.harness.context.window.HangulLyricsProvider.getLastResult(),null);
    await cache.harness.context.window.HangulLyricsProvider.addon.translateLyrics(params);
    assert.equal(cache.harness.context.window.HangulLyricsProvider.getLastResult().trackId,'test');
});

test('automatic readings remain available without notifications on current or prefetched tracks', async () => {
    const cache = loadExtension(null, { ...authored, generated_lines: [0], reading_kind: 'automatic' });
    const h = cache.harness;
    h.values.set('ivLyrics:hangul-web:automatic-fallback', 'true');
    const addon = h.context.window.HangulLyricsProvider.addon;
    await addon.translateLyrics({ ...params, trackId: 'next' });
    assert.equal(h.notices.length, 0);
    await addon.translateLyrics(params);
    await addon.translateLyrics(params);
    assert.equal(h.notices.length, 0);
    h.context.Spicetify.Player.data.item.uri = 'spotify:track:next';
    await addon.translateLyrics({ ...params, trackId: 'next' });
    assert.equal(h.notices.length, 0);
    h.context.Spicetify.Player.data.item.uri = 'spotify:track:test';
    await addon.translateLyrics(params);
    assert.equal(h.notices.length, 0);
});

test('fast loading saves the existing priority setting and applies provider-first mode', async () => {
    const cache=loadExtension(null,authored),h=cache.harness;
    let typeFirst=true;
    h.values.set('ivLyrics:hangul-web:configured','true');
    h.values.set('ivLyrics:hangul-web:display-config-version','1');
    h.context.window.LyricsAddonManager={isPreferLyricsTypeOverProviderOrderEnabled:()=>typeFirst,
        setPreferLyricsTypeOverProviderOrderEnabled:value=>{typeFirst=value;}};
    await h.context.window.HangulLyricsProvider.addon.init();
    assert.equal(typeFirst,false);
    assert.equal(JSON.parse(h.values.get('ivLyrics:hangul-web:loading-previous')).typeFirst,true);
});

test('the v2 footer album link copies the full song title on right-click without a toast', async () => {
    const h = loadExtension(null, authored).harness, copied = [], listeners = [];
    h.values.set('ivLyrics:hangul-web:configured', 'true');
    h.values.set('ivLyrics:hangul-web:display-config-version', '1');
    h.context.Spicetify.Player.data.item.name = 'ジェヘナ (feat. 東雲絵名&暁山瑞希&初音ミク)';
    h.context.Spicetify.Platform = { ClipboardAPI: { copy: async title => copied.push(title) } };
    h.context.window.document = { addEventListener: (type, listener, capture) => {
        assert.equal(type, 'contextmenu'); assert.equal(capture, true); listeners.push(listener);
    } };
    const addon = h.context.window.HangulLyricsProvider.addon;
    await addon.init(); await addon.init();
    assert.equal(listeners.length, 1);
    let prevented = false, stopped = false;
    const link = { textContent: h.context.Spicetify.Player.data.item.name,
        closest: selector => { assert.equal(selector, '[data-testid="now-playing-widget-v2"]'); return {}; } };
    listeners[0]({ target: { closest: () => link }, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    assert.deepEqual(copied, [h.context.Spicetify.Player.data.item.name]);
    assert.ok(prevented && stopped);
    assert.equal(h.notices.length, 0);
    for (const other of [{ textContent: 'artist', closest: () => ({}) }, { textContent: link.textContent, closest: () => null }]) {
        listeners[0]({ target: { closest: () => other }, preventDefault: () => assert.fail('unrelated right-click intercepted') });
    }
    assert.equal(copied.length, 1);
});

async function mirrorHarness(native, fetcher) {
    const cache = loadExtension(null, authored), h = cache.harness;
    h.values.set('ivLyrics:hangul-web:configured', 'true');
    h.values.set('ivLyrics:hangul-web:display-config-version', '1');
    const provider = { cacheVersion: 'original', getLyrics: native };
    h.context.window.LyricsAddonManager = { getAddon: () => provider };
    h.context.window.__ivLyricsPlusDebug = {
        resolveTrackIsrc: async () => 'JPX302467020',
        buildLyricsUrl: (base, info, code) => code ? `${base}?isrc=${code}` : `${base}?title=${info.title}&artist=${info.artist}`,
        parseLyricsPayload: (payload, duration) => { assert.equal(duration, 216566); return payload.parsed; }
    };
    h.context.fetch = fetcher;
    await h.context.window.HangulLyricsProvider.addon.init();
    Object.defineProperty(provider, 'harness', { value: h });
    return provider;
}
const coverInfo = { uri: 'spotify:track:cover', title: 'Cover', artist: 'Singer', duration: 216566 };
test('an Android mirror rescues original lyrics absent on the desktop mirrors', async () => {
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.hostname, 'lyricsplus.binimum.org');
        assert.equal(parsed.searchParams.get('isrc'), 'JPX302467020');
        assert.equal(parsed.searchParams.get('title'), 'Cover');
        assert.equal(options.credentials, 'omit');
        return { ok: true, json: async () => ({ parsed: { synced: [{ text: 'fixture', startTime: 1234 }] } }) };
    });
    const result = await provider.getLyrics(coverInfo);
    assert.equal(result.synced[0].startTime, 1234);
    assert.equal(result.provider, 'lyricsplus');
    assert.equal(result.cacheVersion, provider.cacheVersion);
    assert.equal(result.isrc, 'JPX302467020');
});
test('both mirrors receive recording identity and exact metadata after a miss', async () => {
    const urls = [];
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        urls.push(url);
        return urls.length === 1 ? { ok: false } : { ok: true, json: async () => ({ parsed: { synced: [{ text: 'fixture' }] } }) };
    });
    assert.equal((await provider.getLyrics(coverInfo)).synced.length, 1);
    assert.equal(urls.length, 2);
    const second = new URL(urls[1]);
    assert.equal(second.hostname, 'lyricsplus.prjktla.my.id');
    assert.equal(second.searchParams.get('title'), 'Cover');
    assert.equal(second.searchParams.get('artist'), 'Singer');
    assert.equal(second.searchParams.get('isrc'), 'JPX302467020');
});
test('a working native provider returns without waiting for the additional mirror', async () => {
    let wasAborted = false;
    const provider = await mirrorHarness(async () => ({ synced: [{ text: 'native' }], copyright: 'retained' }),
        async (_, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => { wasAborted = true; reject(new Error('aborted')); });
        }));
    const result = await provider.getLyrics(coverInfo);
    assert.equal(result.synced[0].text, 'native');
    assert.equal(result.copyright, 'retained');
    assert.ok(wasAborted);
});
test('incorrect recording identities and unusable payloads preserve the native failure', async () => {
    let count = 0;
    const provider = await mirrorHarness(async () => ({ error: 'Original failure', synced: null }), async () => ({
        ok: true, json: async () => ++count === 1
            ? { metadata: { isrc: 'OTHER' }, parsed: { synced: [{ text: 'wrong recording' }] } }
            : { parsed: { synced: [] } }
    }));
    const result = await provider.getLyrics(coverInfo);
    assert.equal(result.error, 'Original failure');
    assert.equal(result.synced, null);
});

const normalizedInfo = { ...coverInfo, title: 'Cover (feat. Guest)', album: 'Cover Album' };
const normalizedPayload = (overrides = {}) => ({
    metadata: { title: 'Cover', artist: 'Singer', album: 'Cover Album', totalDuration: '3:36.566', ...overrides },
    lyrics: [{ time: 1000, duration: 212000, text: 'fixture' }],
    parsed: { synced: [{ text: 'fixture', startTime: 1000 }] }
});
const jsonResponse = (body, status = 200, retryAfter = null) => ({ ok: status === 200, status,
    headers: { get: key => key === 'Retry-After' ? retryAfter : null }, json: async () => body });

test('feat-only search recovery preserves the cover artist album and recording identifier', async () => {
    const urls = [];
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        const u = new URL(url); urls.push(u);
        return u.searchParams.get('title') === normalizedInfo.title
            ? jsonResponse({}, 404) : jsonResponse(normalizedPayload());
    });
    const result = await provider.getLyrics(normalizedInfo);
    assert.equal(result.synced.length, 1);
    assert.equal(result.lyricsPlus.normalizedTitle, true);
    assert.equal(result.uri, normalizedInfo.uri);
    assert.equal(urls.length, 3);
    for (const url of urls) {
        assert.equal(url.searchParams.get('artist'), 'Singer');
        assert.equal(url.searchParams.get('isrc'), 'JPX302467020');
    }
});

test('normalized searches reject a different artist album duration or truncated performance', async () => {
    for (const [override, truncated] of [[{ artist: 'Other Singer' }, false], [{ album: 'Live Album' }, false],
        [{ totalDuration: '1:30.000' }, false], [{}, true]]) {
        const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
            if (new URL(url).searchParams.get('title') === normalizedInfo.title) return jsonResponse({}, 404);
            const payload = normalizedPayload(override);
            if (truncated) payload.lyrics[0].duration = 59000;
            return jsonResponse(payload);
        });
        assert.equal((await provider.getLyrics(normalizedInfo)).error, 'No lyrics');
    }
});

test('missing QQ identity is checked against metadata from the same source', async () => {
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        const u = new URL(url);
        if (u.pathname === '/v1/metadata/get') return jsonResponse({ metadata: {
            name: 'Cover', artistName: 'Singer/Guest', source: 'QQ Music', durationMs: 216566
        } });
        if (u.searchParams.get('title') === normalizedInfo.title) return jsonResponse({}, 404);
        const payload = normalizedPayload(); payload.metadata = { source: 'QQ Music' };
        return jsonResponse(payload);
    });
    assert.equal((await provider.getLyrics(normalizedInfo)).synced.length, 1);
});

test('a metadata lookup from another source cannot validate missing lyric identity', async () => {
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        const u = new URL(url);
        if (u.pathname === '/v1/metadata/get') return jsonResponse({ metadata: { name: 'Cover', artistName: 'Singer', source: 'Other' } });
        if (u.searchParams.get('title') === normalizedInfo.title) return jsonResponse({}, 404);
        const payload = normalizedPayload(); payload.metadata = { source: 'QQ Music' };
        return jsonResponse(payload);
    });
    assert.equal((await provider.getLyrics(normalizedInfo)).error, 'No lyrics');
});

test('a throttled mirror is skipped for normalized candidates and subsequent songs', async () => {
    const hosts = [];
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        const u = new URL(url); hosts.push(u.hostname);
        if (u.hostname === 'lyricsplus.binimum.org') return jsonResponse({}, 429, '120');
        return u.searchParams.get('title') === normalizedInfo.title ? jsonResponse({}, 404) : jsonResponse(normalizedPayload());
    });
    assert.equal((await provider.getLyrics(normalizedInfo)).synced.length, 1);
    assert.equal((await provider.getLyrics({ ...normalizedInfo, uri: 'spotify:track:another' })).synced.length, 1);
    assert.equal(hosts.filter(host => host === 'lyricsplus.binimum.org').length, 1);
});

test('request limits and overload remain transient while a mirror is cooling down', async () => {
    let calls = 0;
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        calls++; return jsonResponse({}, new URL(url).hostname === 'lyricsplus.binimum.org' ? 429 : 503);
    });
    for (const info of [normalizedInfo, { ...normalizedInfo, uri: 'spotify:track:next' }]) {
        const result = await provider.getLyrics(info);
        assert.equal(result.retryable, true);
        assert.equal(result.lyricsLookup.status, 'temporary-error');
        assert.equal(provider.harness.context.window.HangulLyricsProvider.getLookupStatus(info.uri).status, 'temporary-error');
    }
    assert.equal(calls, 2);
});

test('a feat candidate retains Live labels and full width artist punctuation is compared safely', async () => {
    const info = { ...normalizedInfo, title: 'Cover (Live) (feat. Guest)', artist: 'Singer！' };
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        const title = new URL(url).searchParams.get('title');
        if (title === info.title) return jsonResponse({}, 404);
        assert.equal(title, 'Cover (Live)');
        return jsonResponse(normalizedPayload({ title: 'Cover (Live)', artist: 'Singer!' }));
    });
    assert.equal((await provider.getLyrics(info)).synced.length, 1);
});

test('an exact metadata lookup already owned by the native provider is not duplicated', async () => {
    const urls=[];
    const provider=await mirrorHarness(async()=>({error:'No lyrics'}),async url=>{
        const parsed=new URL(url);urls.push(parsed);
        return parsed.searchParams.get('title')===normalizedInfo.title?jsonResponse({},404):jsonResponse(normalizedPayload());
    });
    const parser=provider.harness.context.window.__ivLyricsPlusDebug;
    parser.resolveTrackIsrc=async()=>'';
    parser.getApiBases=()=>['https://lyricsplus.prjktla.my.id'];
    assert.equal((await provider.getLyrics(normalizedInfo)).synced.length,1);
    assert.equal(urls.filter(url=>url.hostname==='lyricsplus.prjktla.my.id'&&url.searchParams.get('title')===normalizedInfo.title).length,0);
});

test('joint credits can retry the primary artist without replacing recording identity', async () => {
    const info={...normalizedInfo,artist:'Singer, Guest One, Guest Two'};
    const seen=[];
    const provider=await mirrorHarness(async()=>({error:'No lyrics'}),async url=>{
        const u=new URL(url);seen.push(u);
        if(u.searchParams.get('artist')!=='Singer')return jsonResponse({},404);
        assert.equal(u.searchParams.get('isrc'),'JPX302467020');
        assert.equal(u.searchParams.get('title'),'Cover');
        return jsonResponse(normalizedPayload());
    });
    assert.equal((await provider.getLyrics(info)).synced.length,1);
    assert.equal(seen.filter(u=>u.searchParams.get('artist')==='Singer').length,1);
});

test('joint-credit recovery preserves full width punctuation in the search title', async () => {
    const info={...normalizedInfo,title:'我らステインバスターズ！',artist:'Singer, Guest'};
    const provider=await mirrorHarness(async()=>({error:'No lyrics'}),async url=>{
        const u=new URL(url);
        assert.equal(u.searchParams.get('title'),'我らステインバスターズ！');
        if(u.searchParams.get('artist')!== 'Singer')return jsonResponse({},404);
        return jsonResponse(normalizedPayload({title:'我らステインバスターズ！'}));
    });
    assert.equal((await provider.getLyrics(info)).synced.length,1);
});
