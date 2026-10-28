/** @file test_youtube_ivlyrics.cjs
 * @brief Exercise ivLyrics link adapter identity, clock, cancellation and native delegation contracts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create, searchInfo, parseLyrics, chooseResult, videoId } = require('./youtube-ivlyrics.js');

const VIDEO = 'rKQptWhAvO0', OTHER = '_-uHa5KiR90';
const URI = 'youtube:video:' + VIDEO;
const TRACK = { videoId: VIDEO, title: '도쿄 테디베어 [東京テディベア l Neru] / 토키노 메리 Cover', artist: 'Cover Singer' };
const INFO = { uri: URI, title: '東京テディベア', artist: 'Neru', duration: 194000 };
const RESULT = { trackName: '東京テディベア', artistName: 'Neru', duration: 194,
    syncedLyrics: '[00:01.25]仮の行\n[00:03.00]次の行', plainLyrics: '仮の行\n次の行' };
const response = value => ({ ok: true, json: async () => value });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fakeTimeouts() {
    const tasks = new Map(), scheduled = []; let id = 0;
    return {
        tasks, scheduled,
        setTimeout(fn, ms) { const key = ++id; tasks.set(key, { fn, ms }); scheduled.push(ms); return key; },
        clearTimeout(key) { tasks.delete(key); },
        fire(ms) { const entry = [...tasks].find(([, task]) => task.ms === ms); assert.ok(entry, 'Expected pending timer: ' + ms); tasks.delete(entry[0]); entry[1].fn(); },
    };
}

function harness(fetch = async () => response([RESULT]), options = {}) {
    const calls = [], timers = new Map(); let clock = 0;
    const native = Object.freeze({ uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', name: 'Native song' });
    const host = {
        performance: { now: () => clock }, fetch,
        setInterval(fn) { timers.set(1, fn); return 1; }, clearInterval(id) { timers.delete(id); },
        Spicetify: { Player: { data: Object.freeze({ item: native, isPaused: true }), isPlaying: () => false,
            getProgress: () => 9876, seek: value => calls.push(['native-seek', value]) },
            Platform: { PlayerAPI: { _state: Object.freeze({ item: native, isPaused: true }) },
                History: { push: value => calls.push(['route', value]) } } },
    };
    host.Utils = {
        getSafePlayerProgress() { assert.equal(this, host.Utils); return 9876; },
        getPlayerPlaybackSnapshot() { assert.equal(this, host.Utils); return { uri: native.uri, position: 9876 }; },
        resolveStablePlaybackTrack() { assert.equal(this, host.Utils); return native; },
        isSpotifyAutomixPlayback: () => true, isSpotifyDjNarrationPlayback: () => true,
        getTranslationCacheId(uri) { assert.equal(this, host.Utils); return 'native-cache:' + uri; },
        clearSafePlayerProgressCorrection: () => calls.push(['clock-clear']),
    };
    host.LyricsService = {
        getTranslationCacheId(uri) { assert.equal(this, host.LyricsService); return 'service-native:' + uri; },
        getCurrentTrackInfo() { assert.equal(this, host.LyricsService); return { uri: native.uri }; },
        getLyricsFromProviders(info) { assert.equal(this, host.LyricsService); calls.push(['native-provider', info.uri]); return { native: true }; },
        publishLyricsSnapshot: value => calls.push(['publish', value]),
        clearLyricsSnapshot: uri => calls.push(['clear-snapshot', uri]),
        clearTrackCache: async id => calls.push(['clear-cache', id]),
    };
    function container() {
        return {
            currentTrackUri: native.uri,
            infoFromTrack: track => ({ uri: track.uri, title: track.metadata.title, artist: track.metadata.artist_name }),
            getPlaybackPaused: () => true, getCurrentPlayerTrackInfo: () => ({ native: true }),
            getSyncCreatorTrackInfo: () => native, getShareImageTrackInfo: () => ({ native: true }),
            fetchColors: uri => calls.push(['colors', uri]), fetchTempo: uri => calls.push(['tempo', uri]),
            fetchMetadataTranslation: uri => calls.push(['metadata', uri]), loadSavedVideoForTrack: uri => calls.push(['video', uri]),
            reloadLyrics: value => calls.push(['native-reload', value]),
            schedulePlaybackTrackResolution(track) { calls.push(['schedule', track?.uri]); this.currentTrackUri = track?.uri; },
            updatePlaybackPausedState: () => calls.push(['paused-update']),
            fetchLyrics: async (track, mode, refresh) => calls.push(['fetch-lyrics', track.uri, mode, refresh]),
        };
    }
    host.lyricContainer = container(); host.reloadLyrics = host.lyricContainer.reloadLyrics;
    const originals = { progress: host.Utils.getSafePlayerProgress, provider: host.LyricsService.getLyricsFromProviders,
        reload: host.reloadLyrics, paused: host.lyricContainer.getPlaybackPaused };
    const adapter = create(host, options); adapter.install();
    return { host, adapter, calls, timers, originals, native, container, setClock(value) { clock = value; } };
}

test('YouTube virtual identity accepts only exact video URIs', () => {
    assert.equal(videoId(URI), VIDEO);
    for (const value of [null, VIDEO, URI + '?x=1', 'spotify:track:' + VIDEO, 'youtube:video:../private']) assert.equal(videoId(value), null);
});
test('original-song metadata is inferred separately from the source identity and explicit edits win', () => {
    assert.deepEqual(searchInfo(TRACK), { title: '東京テディベア', artist: 'Neru' });
    assert.deepEqual(searchInfo({ ...TRACK, lyricTitle: 'Edited song', lyricArtist: 'Original singer' }), { title: 'Edited song', artist: 'Original singer' });
    assert.deepEqual(searchInfo({ title: 'Example / Singer Cover' }), { title: 'Example', artist: '' });
});
test('editing original-song search fields never renames the displayed video, artist, artwork or URI', () => {
    const h = harness(); h.adapter.update(TRACK, { seconds: 47, duration: 194, playing: true });
    const before = h.adapter.currentTrack();
    assert.equal(before.name, TRACK.title); assert.equal(before.metadata.title, TRACK.title);
    assert.equal(before.artists[0].name, TRACK.artist); assert.equal(before.metadata.artist_name, TRACK.artist);
    h.adapter.update({ ...TRACK, lyricTitle: 'Ghost City Tokyo', lyricArtist: 'Ayase' }, { seconds: 47, duration: 194, playing: true });
    assert.deepEqual(h.adapter.currentTrack(), before); assert.deepEqual(h.adapter.snapshot().item, before);
    assert.equal(h.host.LyricsService.getCurrentTrackInfo().title, TRACK.title);
    assert.equal(h.host.LyricsService.getCurrentTrackInfo().artist, TRACK.artist);
    assert.equal(h.host.lyricContainer.getCurrentPlayerTrackInfo().title, TRACK.title);
    assert.equal(h.host.lyricContainer.getCurrentPlayerTrackInfo().artist, TRACK.artist);
    assert.equal(h.host.lyricContainer.getShareImageTrackInfo().name, TRACK.title);
    assert.equal(h.host.lyricContainer.getSyncCreatorTrackInfo().name, TRACK.title); h.adapter.dispose();
});
test('an English original-song lookup keeps its selected timing while all published display metadata remains the video source', async () => {
    const queries = [], video = { videoId: 'UWa_OiXDiQA', title: '幽霊東京 / Cover Singer Cover', artist: 'Cover channel' };
    const lrc = (start, end) => Array.from({ length: 48 }, (_, index) => {
        const time = Math.round(start + (end - start) * index / 47), minutes = Math.floor(time / 60000);
        const seconds = (time % 60000 / 1000).toFixed(2).padStart(5, '0'); return `[${minutes}:${seconds}]検証用の行${index}`;
    }).join('\n');
    const h = harness(async url => {
        const query = new URL(url).searchParams; queries.push(query);
        return response([{ trackName: query.get('track_name') || query.get('q'), artistName: 'Ayase', duration: 205,
            syncedLyrics: query.get('track_name') === 'Ghost City Tokyo' ? lrc(18240, 198420) : lrc(23440, 203660) }]);
    });
    h.adapter.update(video, { seconds: 47, duration: 202, playing: true });
    const uri = h.adapter.currentTrack().uri, before = h.adapter.currentTrack();
    assert.equal((await h.adapter.getLyrics({ uri })).synced[0].startTime, 23440);
    h.adapter.update({ ...video, lyricTitle: 'Ghost City Tokyo', lyricArtist: 'Ayase' }, { seconds: 47, duration: 202, playing: true });
    const lyrics = await h.adapter.getLyrics({ uri, title: 'Ghost City Tokyo', artist: 'Ayase' });
    assert.equal(queries.at(-1).get('track_name'), 'Ghost City Tokyo'); assert.equal(queries.at(-1).get('artist_name'), 'Ayase');
    assert.equal(lyrics.synced.length, 48); assert.equal(lyrics.synced[0].startTime, 18240); assert.equal(lyrics.synced.at(-1).startTime, 198420);
    assert.deepEqual(h.adapter.currentTrack(), before);
    const published = h.calls.filter(call => call[0] === 'publish').at(-1)[1];
    assert.equal(published.trackInfo.title, video.title); assert.equal(published.trackInfo.artist, video.artist);
    assert.equal(published.trackInfo.uri, uri); assert.equal(published.trackInfo.duration, 202000); h.adapter.dispose();
});
test('a parenthesized Japanese alias after a Korean title is used without inventing an original artist', () => {
    for (const title of ['피날레(フィナーレ。) / 시라유키 히나 Cover', '피날레（フィナーレ。） / 시라유키 히나 Cover'])
        assert.deepEqual(searchInfo({ title }), { title: 'フィナーレ。', artist: '' });
    assert.deepEqual(searchInfo({ title: '피날레(フィナーレ。)', lyricTitle: 'Manual title', lyricArtist: 'Manual singer' }),
        { title: 'Manual title', artist: 'Manual singer' });
});
test('parenthesized credits, versions and Korean readings are never promoted to a Japanese song title', () => {
    for (const title of ['피날레(cover)', '피날레(feat. 初音ミク)', '피날레(日本語版)', '피날레(ライブ)',
        '피날레(フィナーレ ver.)', '피날레(原曲：フィナーレ。)', '피날레(시라유키 히나)', 'Original title(初音ミク)']) {
        assert.equal(searchInfo({ title }).title, title);
        assert.equal(searchInfo({ title }).artist, '');
    }
});
test('LRC conversion keeps millisecond precision, repeated timestamps and stable line ordering', () => {
    const parsed = parseLyrics({ syncedLyrics: '[00:03.00][00:07.50]二番\n[00:01.25]一番\n[00:99.00]invalid', plainLyrics: '一番\n\n二番' }, URI);
    assert.deepEqual(parsed.synced.map(line => line.startTime), [1250, 3000, 7500]);
    assert.deepEqual(parsed.unsynced, [{ text: '一番' }, { text: '二番' }]);
    assert.equal(parsed.uri, URI);
});
test('candidate selection rejects different explicit artists and unrelated song titles', () => {
    assert.equal(chooseResult([{ ...RESULT, artistName: 'Unrelated Artist' }], INFO, 194), null);
    assert.equal(chooseResult([{ ...RESULT, trackName: 'Another Song' }], INFO, 194), null);
    assert.equal(chooseResult([{ ...RESULT, artistName: 'Neru feat. 鏡音リン' }], INFO, 194).artistName, 'Neru feat. 鏡音リン');
    for (const value of [null, {}, [null], [{ ...RESULT, syncedLyrics: ' ', plainLyrics: '' }]]) assert.equal(chooseResult(value, INFO, 194), null);
});
test('inactive hooks delegate native calls and do not alter the native player item', () => {
    const h = harness();
    assert.equal(h.host.Utils.getSafePlayerProgress(), 9876);
    assert.equal(h.host.Utils.resolveStablePlaybackTrack(), h.native);
    assert.deepEqual(h.host.LyricsService.getLyricsFromProviders({ uri: h.native.uri }), { native: true });
    assert.equal(h.host.Utils.getTranslationCacheId(h.native.uri), 'native-cache:' + h.native.uri);
    assert.equal(h.host.Spicetify.Player.data.item, h.native); h.adapter.dispose();
});
test('YouTube clock uses its own sampled media time and clamps extrapolation and duration', () => {
    const h = harness(); h.adapter.update(TRACK, { seconds: 10, duration: 194, playing: true });
    h.setClock(600); assert.equal(h.host.Utils.getSafePlayerProgress(), 10600);
    h.setClock(10000); assert.equal(h.host.Utils.getSafePlayerProgress(), 11500);
    assert.equal(h.host.Utils.getPlayerPlaybackSnapshot().uri, URI);
    assert.equal(h.host.Utils.getPlayerPlaybackSnapshot().duration, 194000);
    assert.equal(h.host.Utils.getPlayerPlaybackSnapshot().source, 'youtube-link');
    assert.equal(h.host.Spicetify.Player.data.item, h.native);
    h.adapter.update(TRACK, { seconds: 193.8, duration: 194, playing: true }); h.setClock(10500);
    assert.equal(h.host.Utils.getSafePlayerProgress(), 194000);
    h.adapter.update(TRACK, { seconds: 12, duration: 194, playing: false }); h.setClock(20000);
    assert.equal(h.host.Utils.getSafePlayerProgress(), 12000); h.adapter.dispose();
});
test('pause, artwork metadata and translation cache identity follow YouTube without native Spotify calls', async () => {
    const h = harness(); h.adapter.update(TRACK, { seconds: 3, duration: 194, playing: true });
    assert.equal(h.host.lyricContainer.getPlaybackPaused(), false);
    assert.equal(h.host.lyricContainer.getCurrentPlayerTrackInfo().title, TRACK.title);
    assert.equal(h.host.LyricsService.getCurrentTrackInfo().uri, URI);
    assert.equal(h.host.Utils.getTranslationCacheId(URI), 'youtube-' + VIDEO);
    assert.equal(h.host.LyricsService.getTranslationCacheId(URI), 'youtube-' + VIDEO);
    assert.equal(h.host.Utils.isSpotifyAutomixPlayback(), false);
    await h.host.lyricContainer.fetchColors(URI); await h.host.lyricContainer.fetchTempo(URI);
    await h.host.lyricContainer.fetchMetadataTranslation(URI); await h.host.lyricContainer.loadSavedVideoForTrack(URI);
    assert.equal(h.calls.some(call => ['colors', 'tempo', 'metadata', 'video'].includes(call[0])), false);
    assert.ok(h.adapter.currentTrack().metadata.image_url.includes(VIDEO));
    h.adapter.dispose();
});
test('concurrent lyric requests share one free provider lookup and successful results are cached', async () => {
    const wait = deferred(); let requests = 0;
    const h = harness(async () => { requests++; return wait.promise; });
    h.adapter.update(TRACK, { duration: 194, playing: true });
    const a = h.host.LyricsService.getLyricsFromProviders(INFO), b = h.host.LyricsService.getLyricsFromProviders(INFO);
    assert.equal(requests, 1); wait.resolve(response([RESULT]));
    assert.equal((await a).synced.length, 2); await b;
    await h.host.LyricsService.getLyricsFromProviders(INFO); assert.equal(requests, 1);
    assert.equal(h.calls.filter(call => call[0] === 'publish').length, 1); h.adapter.dispose();
});
test('a miss is not cached and the original artist remains required on title-only fallback', async () => {
    const queries = [];
    const h = harness(async url => { queries.push(new URL(url)); return response([{ ...RESULT, artistName: 'Wrong Singer' }]); });
    h.adapter.update(TRACK, { duration: 194 });
    assert.ok((await h.adapter.getLyrics(INFO)).error); assert.equal(queries.length, 2);
    assert.equal(queries[0].searchParams.get('artist_name'), 'Neru');
    assert.equal(queries[1].searchParams.has('artist_name'), false);
    assert.ok((await h.adapter.getLyrics(INFO)).error); assert.equal(queries.length, 4); h.adapter.dispose();
});
test('track changes cancel stale lookups even when a provider ignores the abort signal', async () => {
    const wait = deferred(); let signal;
    const h = harness(async (_url, options) => { signal = options.signal; return wait.promise; });
    h.adapter.update(TRACK, { duration: 194 }); const pending = h.adapter.getLyrics(INFO);
    h.adapter.update({ videoId: OTHER, title: 'Other song' }, { duration: 244 });
    assert.equal(signal.aborted, true); wait.resolve(response([RESULT]));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(h.calls.some(call => call[0] === 'publish'), false); h.adapter.dispose();
});
test('same-video metadata edits invalidate pending lyrics before they can publish under the same URI', async () => {
    const wait = deferred();
    const h = harness(async () => wait.promise); h.adapter.update(TRACK, { duration: 194 });
    const pending = h.adapter.getLyrics(INFO);
    h.adapter.update({ ...TRACK, lyricTitle: 'Edited', lyricArtist: 'Edited Singer' }, { duration: 194 });
    wait.resolve(response([RESULT])); await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(h.calls.some(call => call[0] === 'publish'), false); h.adapter.dispose();
});
test('reload releases aborted inflight requests so an immediate retry gets a new request', async () => {
    const first = deferred(); let requests = 0;
    const h = harness(async () => ++requests === 1 ? first.promise : response([RESULT]));
    h.adapter.update(TRACK, { duration: 194 }); const pending = h.adapter.getLyrics(INFO);
    await h.adapter.reload(); const next = h.adapter.getLyrics(INFO);
    assert.equal(requests, 2); first.resolve(response([RESULT]));
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal((await next).synced.length, 2);
    assert.ok(h.calls.some(call => call[0] === 'clear-cache' && call[1] === 'youtube-' + VIDEO)); h.adapter.dispose();
});
test('a track switch during asynchronous cache clearing never reloads the replacement track', async () => {
    const wait = deferred(), h = harness(); h.host.LyricsService.clearTrackCache = () => wait.promise;
    h.adapter.update(TRACK, { duration: 194 }); const reload = h.adapter.reload();
    h.adapter.update({ videoId: OTHER, title: 'Other song' }, { duration: 244 }); wait.resolve(); await reload;
    assert.equal(h.calls.some(call => call[0] === 'fetch-lyrics'), false); h.adapter.dispose();
});
test('new lyric containers and replaced global reload functions get independent wrappers', async () => {
    const h = harness(); h.adapter.update(TRACK, { duration: 194 });
    const old = h.host.lyricContainer; const replacement = h.container(); h.host.lyricContainer = replacement;
    h.host.reloadLyrics = replacement.reloadLyrics; h.adapter.install();
    assert.equal(replacement.getPlaybackPaused(), true);
    assert.equal(replacement.getCurrentPlayerTrackInfo().uri, URI);
    await h.host.reloadLyrics(false);
    assert.ok(h.calls.some(call => call[0] === 'fetch-lyrics' && call[1] === URI && call[3] === false));
    h.adapter.dispose(); assert.equal(old.getPlaybackPaused, h.originals.paused);
});
test('deactivation restores native lookup and dispose restores hooks and stops the adapter timer', () => {
    const h = harness(); h.adapter.update(TRACK, { seconds: 10, duration: 194, playing: true });
    h.adapter.deactivate(); assert.equal(h.host.Utils.getSafePlayerProgress(), 9876);
    assert.equal(h.host.Utils.resolveStablePlaybackTrack(), h.native);
    assert.ok(h.calls.some(call => call[0] === 'schedule' && call[1] === h.native.uri));
    h.adapter.dispose(); assert.equal(h.timers.size, 0);
    assert.equal(h.host.Utils.getSafePlayerProgress, h.originals.progress);
    assert.equal(h.host.LyricsService.getLyricsFromProviders, h.originals.provider);
    assert.equal(h.host.reloadLyrics, h.originals.reload);
    h.adapter.install(); assert.equal(h.host.Utils.getSafePlayerProgress, h.originals.progress);
});
test('invalid video identities cannot enter the adapter, and nonfinite clocks remain bounded', () => {
    const h = harness(); assert.throws(() => h.adapter.update({ videoId: '../not-video' }, {}), TypeError);
    h.adapter.update(TRACK, { seconds: Infinity, duration: NaN, playing: false });
    assert.equal(h.adapter.snapshot().position, 0); assert.equal(h.adapter.snapshot().duration, 0); h.adapter.dispose();
});
test('unknown original artists use documented free-text search instead of failing title-only structured URLs', async () => {
    const queries = [];
    const h = harness(async url => {
        const query = new URL(url).searchParams; queries.push(query);
        return query.has('track_name') ? { ok: false, status: 503 } : response([{ ...RESULT, trackName: 'フィナーレ。' }]);
    });
    h.adapter.update({ videoId: OTHER, title: '피날레(フィナーレ。) / 시라유키 히나 Cover' }, { duration: 244 });
    const result = await h.adapter.getLyrics({ uri: 'youtube:video:' + OTHER });
    assert.equal(result.synced.length, 2); assert.equal(queries.length, 1);
    assert.equal(queries[0].get('q'), 'フィナーレ。'); assert.equal(queries[0].has('track_name'), false);
    h.adapter.dispose();
});
test('transient status and network failures retry every two seconds at most three additional times', async () => {
    const timers = fakeTimeouts(); let requests = 0;
    const h = harness(async () => {
        requests++;
        if (requests === 1) return { ok: false, status: 503 };
        if (requests === 2) return { ok: false, status: 429, headers: { get: () => '60' } };
        if (requests === 3) throw new TypeError('Network unavailable');
        return response([RESULT]);
    }, timers);
    h.adapter.update(TRACK, { duration: 194 }); const pending = h.adapter.getLyrics(INFO);
    for (let retry = 0; retry < 3; retry++) { await flush(); assert.equal(requests, retry + 1); timers.fire(2000); }
    const result = await pending;
    assert.equal(result.synced.length, 2); assert.equal(requests, 4);
    assert.deepEqual(timers.scheduled, [20000, 2000, 2000, 2000]); assert.equal(timers.tasks.size, 0);
    h.adapter.dispose();
});
test('permanent 4xx failures and malformed successful JSON do not trigger retries', async () => {
    for (const status of [400, 401, 403, 404]) {
        const timers = fakeTimeouts(); let requests = 0;
        const h = harness(async () => { requests++; return { ok: false, status }; }, timers);
        h.adapter.update(TRACK, { duration: 194 });
        await assert.rejects(h.adapter.getLyrics(INFO), new RegExp(String(status)));
        assert.equal(requests, 1); assert.deepEqual(timers.scheduled, [20000]); h.adapter.dispose();
    }
    const timers = fakeTimeouts(); let requests = 0;
    const h = harness(async () => { requests++; return { ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }; }, timers);
    h.adapter.update(TRACK, { duration: 194 }); await assert.rejects(h.adapter.getLyrics(INFO), SyntaxError);
    assert.equal(requests, 1); assert.deepEqual(timers.scheduled, [20000]); h.adapter.dispose();
});
test('a persistent transient failure stops after the third extra attempt and remains retryable later', async () => {
    const timers = fakeTimeouts(); let requests = 0;
    const h = harness(async () => { requests++; return { ok: false, status: 503 }; }, timers);
    h.adapter.update(TRACK, { duration: 194 }); const pending = assert.rejects(h.adapter.getLyrics(INFO), /503/);
    for (let retry = 0; retry < 3; retry++) { await flush(); timers.fire(2000); }
    await pending; assert.equal(requests, 4); assert.equal(timers.tasks.size, 0);
    const next = assert.rejects(h.adapter.getLyrics(INFO), { name: 'AbortError' }); await flush();
    assert.equal(requests, 5); h.adapter.deactivate(); await next; h.adapter.dispose();
});
test('the three-retry budget is shared between structured and free-text search candidates', async () => {
    const timers = fakeTimeouts(); let requests = 0;
    const h = harness(async () => {
        requests++;
        return requests === 2 ? response([]) : { ok: false, status: 503 };
    }, timers);
    h.adapter.update(TRACK, { duration: 194 }); const pending = assert.rejects(h.adapter.getLyrics(INFO), /503/);
    for (let retry = 0; retry < 3; retry++) { await flush(); timers.fire(2000); }
    await pending; assert.equal(requests, 5); assert.deepEqual(timers.scheduled, [20000, 2000, 2000, 2000]);
    h.adapter.dispose();
});
test('track or metadata changes during a retry delay cancel its timer and prevent further requests', async () => {
    for (const replacement of [{ videoId: OTHER, title: 'Other song' }, { ...TRACK, lyricTitle: 'Edited song' }]) {
        const timers = fakeTimeouts(); let requests = 0;
        const h = harness(async () => { requests++; return { ok: false, status: 503 }; }, timers);
        h.adapter.update(TRACK, { duration: 194 }); const pending = assert.rejects(h.adapter.getLyrics(INFO), { name: 'AbortError' });
        await flush(); assert.ok([...timers.tasks.values()].some(task => task.ms === 2000));
        h.adapter.update(replacement, { duration: 194 }); await pending;
        assert.equal(requests, 1); assert.equal(timers.tasks.size, 0); h.adapter.dispose();
    }
});
test('the existing twenty-second deadline aborts a pending retry before another provider request', async () => {
    const timers = fakeTimeouts(); let requests = 0;
    const h = harness(async () => { requests++; return { ok: false, status: 503 }; }, timers);
    h.adapter.update(TRACK, { duration: 194 }); const pending = assert.rejects(h.adapter.getLyrics(INFO), { name: 'AbortError' });
    await flush(); timers.fire(20000); await pending;
    assert.equal(requests, 1); assert.equal(timers.tasks.size, 0); h.adapter.dispose();
});
test('provider AbortError is not treated as a transient network failure', async () => {
    const timers = fakeTimeouts(); let requests = 0;
    const h = harness(async () => { requests++; throw new DOMException('Cancelled', 'AbortError'); }, timers);
    h.adapter.update(TRACK, { duration: 194 }); await assert.rejects(h.adapter.getLyrics(INFO), { name: 'AbortError' });
    assert.equal(requests, 1); assert.deepEqual(timers.scheduled, [20000]); h.adapter.dispose();
});
test('external playback wakes ivLyrics animation while paused samples remain idle until seeking', () => {
    const h = harness(); let wakes = 0;
    h.host.AnimationManager = { wake() { wakes++; } };
    h.adapter.update(TRACK, { seconds: 10, duration: 194, playing: true }); assert.equal(wakes, 1);
    h.setClock(500); h.adapter.install(); assert.equal(wakes, 2);
    h.adapter.update(TRACK, { seconds: 10.5, duration: 194, playing: false }); assert.equal(wakes, 3);
    h.setClock(1000); h.adapter.install(); h.adapter.install(); assert.equal(wakes, 3);
    h.adapter.update(TRACK, { seconds: 33, duration: 194, playing: false }); assert.equal(wakes, 4);
    h.adapter.deactivate(); assert.equal(wakes, 5);
    h.adapter.install(); assert.equal(wakes, 5);
    assert.equal(h.calls.some(call => call[0] === 'native-seek'), false); h.adapter.dispose();
});
test('media ticks and an already-open ivLyrics route do not repeatedly reload lyrics or seek native playback', async () => {
    const h = harness(); h.host.Spicetify.Platform.History.location = { pathname: '/ivLyrics' };
    h.adapter.update(TRACK, { seconds: 47, duration: 194, playing: true });
    for (let count = 1; count <= 8; count++) {
        h.setClock(count * 500); h.adapter.update(TRACK, { seconds: 47 + count / 2, duration: 194, playing: true });
        h.adapter.install(); h.adapter.open();
    }
    assert.equal(h.calls.filter(call => call[0] === 'schedule').length, 1);
    assert.equal(h.calls.filter(call => call[0] === 'route' || call[0] === 'fetch-lyrics' || call[0] === 'native-seek').length, 0);
    assert.equal(h.adapter.snapshot().position, 51000);
    h.host.lyricContainer = h.container(); h.adapter.install();
    assert.equal(h.adapter.snapshot().position, 51000);
    assert.equal(h.calls.filter(call => call[0] === 'schedule').length, 2);
    assert.equal(h.calls.some(call => call[0] === 'native-seek'), false); h.adapter.dispose();
});
test('desktop progress uses the matching YouTube clock without mutating its caller payload', () => {
    const h = harness(), sent = [];
    h.host.OverlaySender = { sendProgressPayload(endpoint, payload, uri) { assert.equal(this, h.host.OverlaySender); sent.push({ endpoint, payload, uri }); return 'sent'; } };
    h.adapter.update(TRACK, { seconds: 10, duration: 194, playing: true }); h.setClock(600);
    const payload = Object.freeze({ trackUri: URI, position: 9876, duration: 999999, remaining: 990123, isPlaying: false, currentTrack: { title: 'Keep title' } });
    assert.equal(h.host.OverlaySender.sendProgressPayload('/progress', payload, URI), 'sent');
    assert.deepEqual(sent[0], { endpoint: '/progress', uri: URI, payload: { ...payload,
        currentTrack: { ...payload.currentTrack, title: TRACK.title, artist: TRACK.artist, albumArt: 'https://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg' },
        position: 10600, duration: 194000, remaining: 183400, isPlaying: true } });
    assert.notEqual(sent[0].payload, payload); assert.equal(payload.isPlaying, false);
    assert.equal(h.host.Spicetify.Player.data.isPaused, true); assert.equal(h.host.Spicetify.Platform.PlayerAPI._state.isPaused, true);
    h.adapter.dispose();
});
test('native, prefetched and stale desktop progress payloads retain the original identity and object', () => {
    const h = harness(), sent = [];
    const original = function (...args) { assert.equal(this, h.host.OverlaySender); sent.push(args); };
    h.host.OverlaySender = { sendProgressPayload: original }; h.adapter.update(TRACK, { seconds: 7, duration: 194, playing: true });
    for (const [payload, uri] of [[{ trackUri: h.native.uri, isPlaying: false }, h.native.uri],
        [{ trackUri: 'youtube:video:' + OTHER, isPlaying: false }, 'youtube:video:' + OTHER],
        [{ trackUri: 'youtube:video:' + OTHER, isPlaying: false }, URI]]) {
        h.host.OverlaySender.sendProgressPayload('/progress', payload, uri);
        assert.equal(sent.at(-1)[1], payload); assert.equal(sent.at(-1)[2], uri);
    }
    h.adapter.deactivate(); const inactive = { trackUri: URI, isPlaying: false };
    h.host.OverlaySender.sendProgressPayload('/progress', inactive, URI); assert.equal(sent.at(-1)[1], inactive);
    h.adapter.dispose(); assert.equal(h.host.OverlaySender.sendProgressPayload, original);
});
test('an inherited lyricsHelperSender keeps its own receiver, port and connection state through the progress wrapper', () => {
    const h = harness(), sent = [];
    const original = function (endpoint, payload, uri) {
        sent.push({ receiver: this, port: this.port, endpoint, payload, uri });
        if (endpoint === '/lyrics/progress' && this.port !== 15001) this.isConnected = false;
        this.lastEndpoint = endpoint;
        return this.port;
    };
    h.host.OverlaySender = { port: 15000, isConnected: true, sendProgressPayload: original };
    h.adapter.update(TRACK, { seconds: 25, duration: 194, playing: true });
    const helper = Object.create(h.host.OverlaySender); helper.port = 15001; helper.isConnected = true;
    const ytPayload = { trackUri: URI, position: 0, duration: 0, isPlaying: false };
    assert.equal(helper.sendProgressPayload('/lyrics/progress', ytPayload, URI), 15001);
    assert.equal(sent[0].receiver, helper); assert.equal(sent[0].port, 15001); assert.equal(sent[0].payload.position, 25000);
    assert.equal(sent[0].payload.isPlaying, true); assert.equal(helper.isConnected, true);
    assert.equal(h.host.OverlaySender.isConnected, true); assert.equal(h.host.OverlaySender.lastEndpoint, undefined);
    const nativePayload = { trackUri: h.native.uri, isPlaying: false };
    helper.sendProgressPayload('/lyrics/progress', nativePayload, h.native.uri);
    assert.equal(sent.at(-1).receiver, helper); assert.equal(sent.at(-1).payload, nativePayload);
    assert.equal(helper.isConnected, true); h.adapter.dispose();
    assert.equal(helper.sendProgressPayload, original);
});
test('matching lyric deliveries use source-video display metadata while preserving lyrics, context and inherited receiver', () => {
    const h = harness(), sent = [], original = function (...args) { sent.push({ receiver: this, args }); return this.port; };
    h.host.OverlaySender = { port: 15000, queueLyricsSend: original };
    h.adapter.update(TRACK, { seconds: 25, duration: 194, playing: true });
    const helper = Object.create(h.host.OverlaySender); helper.port = 15001;
    const nativeArt = 'https://i.scdn.co/image/native';
    const track = Object.freeze({ title: 'Translated title', artist: 'Display artist', album: 'Native album', albumArt: nativeArt, duration: 999000 });
    const lines = Object.freeze([{ text: '仮の行', startTime: 1000 }]), payload = Object.freeze({ trackUri: URI, track, lyrics: lines, isSynced: true });
    const delivery = Object.freeze({ key: 'delivery', generation: 4, isReconnectCycle: false });
    for (const [sender, endpoint] of [[h.host.OverlaySender, '/lyrics'], [helper, '/lyrics/sender']]) {
        assert.equal(sender.queueLyricsSend(endpoint, URI, payload, delivery), sender.port);
        const call = sent.at(-1), corrected = call.args[2];
        assert.equal(call.receiver, sender); assert.equal(call.args[0], endpoint); assert.equal(call.args[1], URI); assert.equal(call.args[3], delivery);
        assert.notEqual(corrected, payload); assert.notEqual(corrected.track, track); assert.equal(corrected.lyrics, lines);
        assert.deepEqual(corrected.track, { ...track, title: TRACK.title, artist: TRACK.artist,
            album: 'YouTube', albumArt: 'https://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg', duration: 194000 });
    }
    assert.equal(track.albumArt, nativeArt); assert.equal(h.host.Spicetify.Player.data.item, h.native);
    h.adapter.dispose(); assert.equal(helper.queueLyricsSend, original);
});
test('artwork correction never changes native, prefetched or mismatched lyric deliveries', () => {
    const h = harness(), sent = [];
    h.host.OverlaySender = { queueLyricsSend: (...args) => sent.push(args) }; h.adapter.update(TRACK, { duration: 194 });
    for (const [uri, payload] of [[h.native.uri, { track: { albumArt: 'native' } }],
        ['youtube:video:' + OTHER, { track: { albumArt: 'other-video' } }],
        [URI, { trackUri: 'youtube:video:' + OTHER, track: { albumArt: 'stale' } }],
        [URI, { track: { uri: h.native.uri, albumArt: 'other-recording' } }]]) {
        h.host.OverlaySender.queueLyricsSend('/lyrics', uri, payload);
        assert.equal(sent.at(-1)[2], payload);
    }
    h.adapter.deactivate(); const inactive = { track: { albumArt: 'keep' } };
    h.host.OverlaySender.queueLyricsSend('/lyrics', URI, inactive); assert.equal(sent.at(-1)[2], inactive); h.adapter.dispose();
});
test('matching progress artwork uses the public video thumbnail but explicit other-recording metadata is untouched', () => {
    const h = harness(), sent = [];
    h.host.OverlaySender = { sendProgressPayload: (_endpoint, payload) => sent.push(payload) }; h.adapter.update(TRACK, { duration: 194 });
    const currentTrack = Object.freeze({ title: 'Keep title', artist: 'Keep artist', albumArt: 'native-image' });
    h.host.OverlaySender.sendProgressPayload('/progress', { currentTrack }, URI);
    assert.equal(sent.at(-1).currentTrack.albumArt, 'https://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg');
    assert.equal(sent.at(-1).currentTrack.title, TRACK.title); assert.equal(sent.at(-1).currentTrack.artist, TRACK.artist);
    assert.equal(currentTrack.title, 'Keep title'); assert.equal(currentTrack.albumArt, 'native-image');
    const other = { trackUri: URI, currentTrack: { uri: h.native.uri, albumArt: 'keep-native' } };
    h.host.OverlaySender.sendProgressPayload('/progress', other, URI); assert.equal(sent.at(-1), other); h.adapter.dispose();
});
test('the current lyric container uses video artwork without changing other containers or background mode settings', async () => {
    const h = harness(), node = { isConnected: true, style: { backgroundImage: 'url("https://i.scdn.co/image/native")' } };
    const nativeBackground = node.style.backgroundImage, stateUpdates = [];
    h.host.lyricContainer.containerRef = { current: { querySelector: selector => selector === '#ivLyrics-gradient-background' ? node : null } };
    h.host.lyricContainer.getEffectiveBackgroundMode = () => 'gradient-background';
    h.host.lyricContainer.setState = value => stateUpdates.push(value);
    h.host.lyricContainer.componentDidUpdate = () => 'updated';
    h.adapter.update(TRACK, { duration: 194 }); await h.host.lyricContainer.fetchColors(URI);
    const videoArt = 'https://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg';
    assert.equal(stateUpdates.at(-1).coverUrl, videoArt); assert.equal(stateUpdates.at(-1).colorsUri, URI);
    assert.equal(stateUpdates.at(-1).dynamicColors, null); assert.equal(node.style.backgroundImage, 'url("' + videoArt + '")');
    node.style.backgroundImage = nativeBackground;
    assert.equal(h.host.lyricContainer.componentDidUpdate(), 'updated'); assert.equal(node.style.backgroundImage, 'url("' + videoArt + '")');
    const updates = stateUpdates.length; await h.host.lyricContainer.fetchColors(h.native.uri);
    assert.equal(stateUpdates.length, updates); assert.ok(h.calls.some(call => call[0] === 'colors' && call[1] === h.native.uri));
    h.adapter.deactivate(); assert.equal(node.style.backgroundImage, nativeBackground);
    h.adapter.dispose();
});
test('solid backgrounds and user-edited styles are preserved when artwork adaptation is disabled or removed', () => {
    const h = harness(), node = { isConnected: true, style: { backgroundImage: '' } };
    h.host.lyricContainer.containerRef = { current: { querySelector: () => node } };
    h.host.lyricContainer.getEffectiveBackgroundMode = () => 'solid-background';
    h.adapter.update(TRACK, { duration: 194 }); assert.equal(node.style.backgroundImage, '');
    node.style.backgroundImage = 'url("native")'; h.adapter.install(); assert.equal(node.style.backgroundImage, 'url("native")');
    h.host.lyricContainer.getEffectiveBackgroundMode = () => 'gradient-background'; h.adapter.install();
    assert.ok(node.style.backgroundImage.includes(VIDEO)); node.style.backgroundImage = 'url("user-selected")';
    h.adapter.deactivate(); assert.equal(node.style.backgroundImage, 'url("user-selected")'); h.adapter.dispose();
});
test('desktop playback correction preserves pause and the user fullscreen-hide setting', () => {
    const h = harness(), sent = [];
    h.host.OverlaySender = { sendProgressPayload: (_endpoint, payload) => sent.push(payload) };
    h.adapter.update(TRACK, { seconds: 5, duration: 194, playing: false });
    h.host.OverlaySender.sendProgressPayload('/progress', { isPlaying: true }, URI);
    assert.equal(sent.at(-1).isPlaying, false); assert.equal(sent.at(-1).position, 5000);
    const fullscreen = { querySelector: () => ({}) };
    h.host.document = { getElementById: () => fullscreen, body: { contains: () => true } };
    h.host.CONFIG = { visual: { 'fullscreen-hide-overlay': true } };
    h.adapter.update(TRACK, { seconds: 6, duration: 194, playing: true });
    h.host.OverlaySender.sendProgressPayload('/progress', { isPlaying: false }, URI); assert.equal(sent.at(-1).isPlaying, false);
    h.host.CONFIG.visual['fullscreen-hide-overlay'] = false;
    h.host.OverlaySender.sendProgressPayload('/progress', { isPlaying: false }, URI); assert.equal(sent.at(-1).isPlaying, true);
    h.adapter.dispose();
});
test('desktop overlay refreshes only on source identity changes, explicit reload and deactivation', async () => {
    const h = harness(); let syncs = 0;
    h.host.ivLyricsOverlayService = { syncNow() { syncs++; } };
    h.adapter.update(TRACK, { seconds: 0, duration: 194, playing: true }); assert.equal(syncs, 1);
    for (const seconds of [0.5, 1, 1.5]) { h.adapter.update(TRACK, { seconds, duration: 194, playing: true }); h.adapter.install(); }
    assert.equal(syncs, 1);
    h.adapter.update({ ...TRACK, lyricTitle: 'Edited song' }, { seconds: 1.5, duration: 194, playing: true }); assert.equal(syncs, 2);
    await h.adapter.reload(); assert.equal(syncs, 3);
    h.adapter.update({ videoId: OTHER, title: 'Another song' }, { seconds: 0, duration: 244, playing: true }); assert.equal(syncs, 4);
    h.adapter.deactivate(); assert.equal(syncs, 5); h.adapter.install(); assert.equal(syncs, 5);
    h.adapter.dispose(); assert.equal(syncs, 5);
});
test('a late or replaced desktop overlay service is refreshed once without broadcasting native song events', () => {
    const h = harness(); let syncs = 0;
    h.host.Spicetify.Player.dispatchEvent = () => assert.fail('Native song events must not be broadcast');
    h.adapter.update(TRACK, { seconds: 0, duration: 194, playing: true });
    h.host.ivLyricsOverlayService = { syncNow() { syncs++; } }; h.adapter.install(); h.adapter.install(); assert.equal(syncs, 1);
    h.host.ivLyricsOverlayService = { syncNow() { syncs++; } }; h.adapter.install(); h.adapter.install(); assert.equal(syncs, 2);
    h.adapter.dispose();
});

// Run the installed/pinned upstream's actual scheduler and line selector. This
// catches native-paused idle behavior which a clock-only test cannot observe.
const upstreamRoots = [process.env.IVLYRICS_SOURCE_DIR,
    process.env.APPDATA && path.join(process.env.APPDATA, 'spicetify', 'CustomApps', 'ivLyrics'),
    path.join(__dirname, 'work', 'installer-payload', 'ivLyrics')].filter(Boolean);
const pagesFile = upstreamRoots.map(root => path.join(root, 'Pages.js')).find(file => fs.existsSync(file));
const serviceFile = upstreamRoots.map(root => path.join(root, 'LyricsService.js')).find(file => fs.existsSync(file));
test('actual upstream native-art lyric payload construction is corrected at the queue boundary',
    { skip: serviceFile ? false : 'Set IVLYRICS_SOURCE_DIR to run the actual upstream lyric artwork contract' }, async () => {
        const source = fs.readFileSync(serviceFile, 'utf8'), method = source.indexOf('async sendLyrics(');
        const queue = source.indexOf("await this.queueLyricsSend('/lyrics', trackInfo.uri", method);
        const start = source.lastIndexOf('let albumArt = null;', queue), end = source.indexOf('\n            });', queue);
        assert.ok(method >= 0 && start > method && queue > start && end > queue, 'Upstream lyric artwork payload boundary changed');
        const h = harness(), sent = [];
        h.host.Spicetify.Player.data = { item: { ...h.native, metadata: { image_xlarge_url: 'https://i.scdn.co/image/native', album_title: 'Native album' } }, isPaused: true };
        h.host.Spicetify.Player.getDuration = () => 999000;
        h.host.OverlaySender = { queueLyricsSend: (...args) => sent.push(args) }; h.adapter.update(TRACK, { duration: 194 });
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const invoke = new AsyncFunction('Spicetify', 'trackInfo', 'currentTitle', 'currentArtist', 'mappedLines', 'isSynced',
            'deliveryKey', 'deliveryGeneration', 'isReconnectCycle', 'offset', 'translatedMetadata', 'helperDebug', 'resolveSpotifyImageUrl', source.slice(start, end + '\n            });'.length));
        const lines = [{ text: '仮の行', startTime: 1000 }];
        await invoke.call(h.host.OverlaySender, h.host.Spicetify, INFO, 'Original title', 'Original artist', lines, true, 'key', 1, false, 0, null, () => {}, value => value);
        assert.equal(sent.length, 1); assert.equal(sent[0][0], '/lyrics'); assert.equal(sent[0][1], URI);
        assert.equal(sent[0][2].track.albumArt, 'https://i.ytimg.com/vi/' + VIDEO + '/hqdefault.jpg');
        assert.equal(sent[0][2].track.duration, 194000); assert.equal(sent[0][2].lyrics, lines);
        assert.equal(h.host.Spicetify.Player.data.item.metadata.image_xlarge_url, 'https://i.scdn.co/image/native'); h.adapter.dispose();
    });
test('actual ivLyrics getFullLyrics accepts the newly published YouTube raw snapshot',
    { skip: serviceFile ? false : 'Set IVLYRICS_SOURCE_DIR to run the actual upstream snapshot acceptance contract' }, async () => {
        const source = fs.readFileSync(serviceFile, 'utf8'), methodStart = source.indexOf('async getFullLyrics(');
        const start = source.indexOf('const providerSnapshot = this.getLyricsSnapshot(info?.uri);', methodStart);
        const end = source.indexOf('if (!isCurrentRequest()) return staleResult();', start);
        assert.ok(methodStart >= 0 && start > methodStart && end > start, 'Upstream raw-snapshot acceptance contract changed');
        const accept = new Function('initialSnapshot', 'initialSnapshotRevision', 'lyricsResult', 'info',
            'let acceptedSnapshot=initialSnapshot;' + source.slice(start, end) + ';return acceptedSnapshot;');
        const h = harness(); h.adapter.update(TRACK, { duration: 194 }); const result = await h.adapter.getLyrics(INFO);
        const published = h.calls.find(call => call[0] === 'publish')[1];
        const initial = { revision: 10 }, snapshot = { ...published, revision: 11 };
        assert.equal(snapshot.source, 'lyrics-service'); assert.equal(snapshot.rawResult, result);
        assert.equal(accept.call({ getLyricsSnapshot: () => snapshot }, initial, 10, result, INFO), snapshot);
        const old = { ...snapshot, source: 'youtube-link' };
        assert.equal(accept.call({ getLyricsSnapshot: () => old }, initial, 10, result, INFO), initial,
            'The previous custom source reproduces upstream rejection instead of accepting the in-flight raw result');
        h.adapter.dispose();
    });
test('actual ivLyrics AnimationManager keeps selecting later lyric rows with the native Spotify player paused',
    { skip: pagesFile ? false : 'Set IVLYRICS_SOURCE_DIR to run the actual upstream renderer contract' }, () => {
        const source = fs.readFileSync(pagesFile, 'utf8');
        const declaration = name => {
            const start = source.indexOf('const ' + name + ' =');
            assert.ok(start >= 0, 'Missing upstream playback contract: ' + name);
            const end = source.indexOf('\n};', start);
            assert.ok(end > start, 'Upstream playback declaration layout changed: ' + name);
            return source.slice(start, end + 3);
        };
        const h = harness(); h.host.addEventListener = () => {}; h.host.removeEventListener = () => {};
        let sequence = 0;
        const context = vm.createContext({
            window: h.host, Spicetify: h.host.Spicetify, performance: h.host.performance,
            document: { hidden: false, documentElement: { classList: { contains: () => false } },
                body: { classList: { contains: () => false } }, addEventListener() {}, removeEventListener() {} },
            CONFIG: { visual: { delay: 0 } }, DEFAULT_TRACK_POSITION_FPS: 60,
            getTrackPositionFPS: () => 60, getGlobalSyncOffsetValue: () => 0,
            requestAnimationFrame: () => ++sequence, cancelAnimationFrame() {},
            setTimeout: () => ++sequence, clearTimeout() {},
        });
        new vm.Script(['AnimationManager', 'getCurrentLyricsPlaybackPosition', 'getActiveTimedLineIndex', 'prepareSyncedLineStartIndex']
            .map(declaration).join('\n') + '\nglobalThis.contract={AnimationManager,getCurrentLyricsPlaybackPosition,getActiveTimedLineIndex,prepareSyncedLineStartIndex};',
        { filename: 'ivLyrics/Pages.js playback boundary' }).runInContext(context);
        const contract = context.contract, manager = contract.AnimationManager, lines = [0, 1000, 2000, 3000, 4000].map(startTime => ({ startTime }));
        const lookup = contract.prepareSyncedLineStartIndex(lines), selected = [];
        manager.addCallback(() => selected.push(contract.getActiveTimedLineIndex(lines, contract.getCurrentLyricsPlaybackPosition(0, 0), lookup)));
        for (const time of [0, 500, 1000, 1500, 2000, 2500]) {
            h.setClock(time); h.adapter.update(TRACK, { seconds: time / 1000, duration: 194, playing: true }); manager.animate(time);
        }
        assert.equal(manager.idle, true, 'Unadapted upstream reproduces its native-paused idle condition');
        assert.equal(selected.at(-1), 1, 'Clock-only adaptation stalls the active row after the settle period');
        h.host.AnimationManager = manager;
        for (const time of [3000, 3500, 4000, 4500]) {
            h.setClock(time); h.adapter.update(TRACK, { seconds: time / 1000, duration: 194, playing: true }); manager.animate(time);
        }
        assert.equal(manager.idle, false); assert.equal(selected.at(-1), 4);
        assert.equal(h.host.Spicetify.Player.data.isPaused, true);
        assert.equal(h.host.Spicetify.Platform.PlayerAPI._state.isPaused, true);
        h.adapter.update(TRACK, { seconds: 4.5, duration: 194, playing: false });
        for (const time of [5000, 5500, 6000]) { h.setClock(time); h.adapter.install(); manager.animate(time); }
        assert.equal(manager.idle, true, 'A paused external source still reaches the upstream low-work idle state');
        h.adapter.update(TRACK, { seconds: 1.25, duration: 194, playing: false }); manager.animate(6017);
        assert.equal(selected.at(-1), 1, 'Seeking wakes the real upstream line selector even while paused');
        assert.equal(h.calls.some(call => call[0] === 'native-seek'), false); manager.stop(); h.adapter.dispose();
    });
