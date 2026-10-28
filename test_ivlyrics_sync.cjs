/** @file test_ivlyrics_sync.cjs
 * @brief Verify timing direction, recording ownership, persistence failures and serialized edits for the easy sync editor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sync = require('./ivlyrics-sync.js');
const NATIVE = { uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', name: 'Spotify song', artists: [{ name: 'Native singer' }] };
const COVER = { uri: 'youtube:video:UWa_OiXDiQA', name: 'Cover upload', metadata: { title: 'Cover upload', artist_name: 'Cover singer' } };
const OTHER = { uri: 'youtube:video:rKQptWhAvO0', name: 'Another cover' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness() {
    let current = COVER, active = true, progress = 18240;
    const stored = new Map(), calls = [];
    const host = {
        SpotifyHangulLinks: { playbackState: () => ({ active }), snapshot: () => ({ active }), currentTrack: () => current },
        Spicetify: { Player: { data: { item: NATIVE }, getProgress: () => 99999 } },
        CONFIG: { visual: { delay: 100 } },
        lyricContainer: { currentTrackUri: COVER.uri, state: { currentLyrics: [{ startTime: 23440, text: 'first' }, { startTime: 30000, text: 'second' }] } },
        Utils: {
            resolveStablePlaybackTrack() { assert.equal(this, host.Utils); return NATIVE; },
            getSafePlayerProgress() { assert.equal(this, host.Utils); return progress; },
            getGlobalSyncOffset() { assert.equal(this, host.Utils); return -200; },
            async getTrackSyncOffset(uri) { assert.equal(this, host.Utils); calls.push(['get', uri]); return stored.get(uri) || 0; },
            async setTrackSyncOffset(uri, value) { assert.equal(this, host.Utils); calls.push(['set', uri, value]); stored.set(uri, value); return true; },
        },
    };
    return { host, stored, calls, controller: sync.create(host), switchTrack(track) { current = track; },
        setActive(value) { active = value; }, setProgress(value) { progress = value; } };
}

test('five point three seconds is 5300 ms and positive offsets advance the lyric clock', () => {
    assert.equal(sync.alignOffset(23440, 18140), 5300);
    assert.equal(sync.alignOffset(18140, 23440), -5300);
    assert.equal(sync.formatOffset(5300), '가사를 5.3 초 먼저 표시');
    assert.equal(sync.formatOffset(-5300), '가사를 5.3 초 나중에 표시');
    assert.equal(sync.formatOffset(0), '보정 없음');
});

test('alignment accounts for existing display delay and global offset, never existing track offset twice', () => {
    const h = harness(), c = h.controller;
    assert.equal(c.getPosition(), 18240);
    assert.equal(c.getGlobalOffset(), -100);
    assert.equal(sync.alignOffset(23440, c.getPosition(), c.getGlobalOffset()), 5300);
    assert.equal(sync.alignOffset(23440, 18240, 200), 5000);
});

test('bounds accept sixty seconds and reject an excessive anchor instead of silently reporting a clamped success', () => {
    assert.equal(sync.normalizeOffset(60000), 60000);
    assert.equal(sync.normalizeOffset(-60000), -60000);
    assert.equal(sync.normalizeOffset('5300.4'), 5300);
    assert.equal(sync.normalizeOffset(-0), 0);
    assert.throws(() => sync.alignOffset(100000, 1), RangeError);
    for (const value of [60001, -60001, Infinity, NaN, null, undefined, '', 'no', {}, true])
        assert.throws(() => sync.normalizeOffset(value));
    for (const args of [[-1, 10], [10, -1], [null, 0], [0, NaN], [0, 0, Infinity]])
        assert.throws(() => sync.alignOffset(...args));
});

test('active YouTube ownership wins over a still-present native Spotify item and keeps upload metadata', () => {
    const h = harness(), result = h.controller.resolveTrack();
    h.host.SpotifyHangulLinks.snapshot = () => { throw Error('Heavy playlist snapshot must not run during render'); };
    assert.deepEqual(result, { uri: COVER.uri, title: 'Cover upload', artist: 'Cover singer' });
    assert.ok(Object.isFrozen(result));
    assert.equal(h.controller.captureTrack().uri, COVER.uri);
    assert.equal(h.controller.isCurrent(NATIVE.uri), false);
});

test('inactive link state uses the native recording and malformed active virtual identity fails closed', () => {
    const h = harness(); h.setActive(false);
    assert.equal(h.controller.resolveTrack().uri, NATIVE.uri);
    h.setActive(true); h.switchTrack({ ...COVER, uri: 'youtube:video:invalid' });
    assert.equal(h.controller.resolveTrack(), null);
    h.switchTrack(NATIVE);
    assert.equal(h.controller.resolveTrack(), null);
});

test('asynchronous stable resolver falls back to native item without treating its Promise as a track', () => {
    const h = harness(); h.setActive(false);
    h.host.Utils.resolveStablePlaybackTrack = async () => COVER;
    assert.equal(h.controller.resolveTrack().uri, NATIVE.uri);
    h.host.Spicetify.Player.data.item = null;
    assert.equal(h.controller.resolveTrack(), null);
});

test('only timed nonempty lines belonging to the displayed recording are offered as anchors', () => {
    const h = harness();
    h.host.lyricContainer.state.currentLyrics.push({ text: 'untimed' }, { startTime: -1, text: 'invalid' },
        { startTime: 100, text: '' }, { startTime: '100', text: 'malformed' }, { startTime: 0, text: 'zero' });
    assert.deepEqual(h.controller.getLines(), [{ index: 0, startTime: 23440, text: 'first' },
        { index: 1, startTime: 30000, text: 'second' }, { index: 6, startTime: 0, text: 'zero' }]);
    h.switchTrack(OTHER);
    assert.deepEqual(h.controller.getLines(), []);
});

test('edits persist against the exact video key without seeking, changing titles or mutating lyric timestamps', async () => {
    const h = harness(), before = JSON.stringify(h.host.lyricContainer.state.currentLyrics);
    assert.equal(await h.controller.setOffset(COVER.uri, 5300), 5300);
    assert.equal(h.stored.get(COVER.uri), 5300);
    assert.equal(h.stored.has(NATIVE.uri), false);
    assert.equal(await h.controller.getOffset(COVER.uri), 5300);
    assert.equal(JSON.stringify(h.host.lyricContainer.state.currentLyrics), before);
    assert.equal(COVER.name, 'Cover upload');
    assert.deepEqual(h.calls, [['set', COVER.uri, 5300], ['get', COVER.uri]]);
});

test('changing songs rejects a stale open editor before any persistence', async () => {
    const h = harness(), captured = h.controller.captureTrack(); h.switchTrack(OTHER);
    await assert.rejects(h.controller.setOffset(captured.uri, 5300), /곡이 바뀌/);
    assert.equal(h.calls.length, 0);
    await assert.rejects(h.controller.setOffset('spotify:playlist:other', 0), /곡이 바뀌/);
});

test('rapid edits serialize and leave the latest adjustment in storage', async () => {
    const h = harness(), wait = deferred(), entered = deferred(); let inFlight = 0, peak = 0;
    h.host.Utils.setTrackSyncOffset = async (uri, value) => {
        inFlight++; peak = Math.max(peak, inFlight);
        if (value === 100) { entered.resolve(); await wait.promise; }
        h.stored.set(uri, value); inFlight--; return true;
    };
    const first = h.controller.setOffset(COVER.uri, 100), last = h.controller.setOffset(COVER.uri, 200);
    await entered.promise;
    assert.equal(h.stored.size, 0); wait.resolve();
    assert.deepEqual(await Promise.all([first, last]), [100, 200]);
    assert.equal(peak, 1); assert.equal(h.stored.get(COVER.uri), 200);
});

test('an edit queued before a song change does not overwrite the next recording', async () => {
    const h = harness(), wait = deferred(), entered = deferred();
    h.host.Utils.setTrackSyncOffset = async (uri, value) => { entered.resolve(); await wait.promise; h.stored.set(uri, value); return true; };
    const first = h.controller.setOffset(COVER.uri, 100), second = h.controller.setOffset(COVER.uri, 200);
    const rejected = assert.rejects(second, /곡이 바뀌/);
    await entered.promise; h.switchTrack(OTHER); wait.resolve();
    await first; await rejected;
    assert.equal(h.stored.get(COVER.uri), 100); assert.equal(h.stored.has(OTHER.uri), false);
});

test('failed persistence is reported and does not poison later retry or reset', async () => {
    const h = harness(); let first = true;
    h.host.Utils.setTrackSyncOffset = async (uri, value) => { if (first) { first = false; return false; } h.stored.set(uri, value); return true; };
    await assert.rejects(h.controller.setOffset(COVER.uri, 100), /저장하지 못/);
    assert.equal(await h.controller.setOffset(COVER.uri, 0), 0);
    h.host.Utils.setTrackSyncOffset = async () => { throw Error('storage unavailable'); };
    await assert.rejects(h.controller.setOffset(COVER.uri, 10), /storage unavailable/);
});

test('public TrackSyncDB-only runtime uses the existing DB and dispatches exactly once after its commit', async () => {
    const h = harness(), events = [], entered = deferred(), commit = deferred();
    delete h.host.Utils.getTrackSyncOffset; delete h.host.Utils.setTrackSyncOffset;
    h.host.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
    h.host.dispatchEvent = event => { events.push(event); };
    const db = h.host.TrackSyncDB = {
        async getOffset(uri) { assert.equal(this, db); return h.stored.get(uri) || 0; },
        async setOffset(uri, value) { assert.equal(this, db); entered.resolve(); await commit.promise; h.stored.set(uri, value); return true; },
    };
    assert.equal(await h.controller.getOffset(COVER.uri), 0);
    const saving = h.controller.setOffset(COVER.uri, 5300);
    await entered.promise; assert.equal(events.length, 0);
    commit.resolve(); assert.equal(await saving, 5300);
    assert.equal(await h.controller.getOffset(COVER.uri), 5300);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ivLyrics:offset-changed');
    assert.deepEqual(events[0].detail, { trackUri: COVER.uri, offset: 5300 });
    assert.equal(h.stored.has(NATIVE.uri), false);
});

test('failed public DB write never emits a successful offset change and a Utils write is not double-dispatched', async () => {
    const h = harness(), events = [];
    h.host.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
    h.host.dispatchEvent = event => events.push(event);
    h.host.TrackSyncDB = { getOffset: async () => 0, setOffset: async () => false };
    const utilsSave = h.host.Utils.setTrackSyncOffset;
    delete h.host.Utils.setTrackSyncOffset;
    await assert.rejects(h.controller.setOffset(COVER.uri, 5300), /저장하지 못/);
    assert.equal(events.length, 0);
    h.host.TrackSyncDB.setOffset = async () => { throw Error('db unavailable'); };
    await assert.rejects(h.controller.setOffset(COVER.uri, 5300), /db unavailable/);
    assert.equal(events.length, 0);
    h.host.Utils.setTrackSyncOffset = async function (uri, value) {
        const result = await utilsSave.call(this, uri, value);
        h.host.dispatchEvent(new h.host.CustomEvent('ivLyrics:offset-changed', { detail: { trackUri: uri, offset: value } }));
        return result;
    };
    assert.equal(await h.controller.setOffset(COVER.uri, 5300), 5300);
    assert.equal(events.length, 1);
});

test('missing store and invalid clock values fail visibly instead of inventing a sync result', async () => {
    const h = harness(); h.setProgress(NaN);
    assert.throws(() => h.controller.getPosition(), TypeError);
    delete h.host.Utils.getTrackSyncOffset;
    await assert.rejects(h.controller.getOffset(COVER.uri), /준비되지/);
    delete h.host.Utils.setTrackSyncOffset;
    await assert.rejects(h.controller.setOffset(COVER.uri, 0), /준비되지/);
    await assert.rejects(h.controller.getOffset('http://wrong'), TypeError);
});

test('browser injection exposes the same core without requiring a module loader', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync('ivlyrics-sync.js', 'utf8'), { window });
    assert.equal(window.SpotifyHangulSync.MAX_OFFSET, 60000);
    assert.equal(typeof window.SpotifyHangulSyncController.resolveTrack, 'function');
    assert.equal(window.SpotifyHangulSync.alignOffset(23440, 18140), 5300);
});
