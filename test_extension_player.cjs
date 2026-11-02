/** @file test_extension_player.cjs
 * @brief Exercise the extension player's switch policy, quality and attempt texts, consent and settings model, store view, ivLyrics clock and playback takeover.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('./extension-player.js');
const ivLyricsAdapter = require('./youtube-ivlyrics.js');
let parseHTML;
try {
    ({ parseHTML } = require(require.resolve('linkedom', { paths: [path.join(__dirname, 'tests/ui/node_modules')] })));
} catch {}
if (!parseHTML && process.env.IVLYRICS_REQUIRE_UI_TESTS === '1') {
    throw new Error('Required DOM UI tests cannot run. Install locked fixtures with npm ci --ignore-scripts --prefix tests/ui.');
}
const dom = { skip: !parseHTML ? 'Locked DOM test fixtures are not installed.' : false };

test('every string exists in English and Korean, and a missing one falls back to English then to its key', () => {
    assert.deepEqual(Object.keys(Model.STRINGS.ko).sort(), Object.keys(Model.STRINGS.en).sort());
    assert.equal(Model.language('ko-KR'), 'ko'); assert.equal(Model.language('ko'), 'ko'); assert.equal(Model.language('kok'), 'en');
    assert.equal(Model.language('en-US'), 'en'); assert.equal(Model.language(undefined), 'en');
    assert.equal(Model.t('ko', 'why_title'), '이 소스를 선택한 이유');
    assert.equal(Model.t('ko', 'details_title'), '재생 상세 정보');
    assert.equal(Model.t('fr', 'why_title'), 'Why this source?');
    assert.equal(Model.t('ko', 'no-such-key'), 'no-such-key');
    assert.equal(Model.t('ko', 'why_open_failed', 120, 'HTTP 403'), '120 ms 후 열기 실패: HTTP 403');
    assert.equal(Model.t('en', 'why_ms', 'found'), 'found · %2 ms', 'a missing argument stays visible');
});

test('quality labels follow what the source announced, as Android formats them', () => {
    assert.equal(Model.qualityLabel({ codec: 'flac', bitDepth: 24, sampleRate: 48000 }), 'FLAC · 24-bit · 48 kHz');
    assert.equal(Model.qualityLabel({ codec: 'flac', bitDepth: 16, sampleRate: 44100 }), 'FLAC · 16-bit · 44.1 kHz');
    assert.equal(Model.qualityLabel({ codec: 'opus', bitDepth: 64, sampleRate: 1000 }), 'OPUS', 'values out of range are left out');
    assert.equal(Model.qualityLabel({ codec: null, bitDepth: null, sampleRate: null, quality: '  Hi-Res   FLAC ' }), 'Hi-Res FLAC', 'the runner\'s own label when no field is known');
    assert.equal(Model.qualityLabel({ codec: null, bitDepth: null, sampleRate: null, quality: null }), ''); assert.equal(Model.qualityLabel(null), '');
    const playing = { extension: 'x.flac', name: 'Some source', stream: { codec: 'flac', bitDepth: 24, sampleRate: 96000 } };
    assert.equal(Model.sourceLine('en', playing), 'Some source · FLAC · 24-bit · 96 kHz');
    assert.equal(Model.sourceLine('ko', { ...playing, temporary: true }), 'Some source · FLAC · 24-bit · 96 kHz · 임시');
    assert.equal(Model.sourceLine('en', {}), 'Spotify');
    assert.equal(Model.sourceLine('en', { temporary: true }), 'Spotify · temporary');
    assert.equal(Model.sourceLine('en', { extension: 'only.id', name: null, stream: { quality: null } }), 'only.id');
    assert.equal(Model.detectedLabel({ mime: 'audio/FLAC; codecs=flac', durationSec: 200, bytes: 40000000 }), 'audio/flac · 3:20 · 1600 kbit/s');
    assert.equal(Model.detectedLabel({ mime: 'audio/mpeg' }), 'audio/mpeg');
    assert.equal(Model.detectedLabel({}), '');
});

test('a song is asked only on this computer, for a catalog track, outside link playback, with an audio source on', () => {
    const on = { available: true, audio: true }, uri = 'spotify:track:4uLU6hMCjMI75M1A2tKUQC';
    assert.equal(Model.shouldAsk({ uri, remote: false, linkBusy: false, state: on }), 'ask');
    assert.equal(Model.shouldAsk({ uri: 'spotify:episode:4uLU6hMCjMI75M1A2tKUQC', state: on }), 'not-track');
    assert.equal(Model.shouldAsk({ uri: 'spotify:local:a:b:c:1', state: on }), 'not-track');
    assert.equal(Model.shouldAsk({ uri, remote: true, state: on }), 'remote');
    assert.equal(Model.shouldAsk({ uri, linkBusy: true, state: on }), 'link');
    assert.equal(Model.shouldAsk({ uri, state: { available: true, audio: false } }), 'off');
    assert.equal(Model.shouldAsk({ uri, state: { available: false, audio: true } }), 'off');
    assert.equal(Model.shouldAsk({ uri, state: null }), 'off');
});

test('the switch policy: known answers switch at once, late ones leave the song to Spotify', () => {
    const { switchWindowMs } = Model.POLICY;
    assert.equal(Model.onAnswer({ found: false, sinceSongMs: 0, playing: true }), 'spotify');
    assert.equal(Model.onAnswer({ found: true, known: true, sinceSongMs: 50, playing: true }), 'start');
    assert.equal(Model.onAnswer({ found: true, sinceSongMs: 60000, playing: false }), 'start', 'a paused song switches silently');
    assert.equal(Model.onAnswer({ found: true, sinceSongMs: 1200, playing: true }), 'handover');
    assert.equal(Model.onAnswer({ found: true, sinceSongMs: switchWindowMs, playing: true }), 'handover');
    assert.equal(Model.onAnswer({ found: true, sinceSongMs: switchWindowMs + 1, playing: true }), 'late');
});

test('the aligned handover holds an early audio, moves a late one ahead and gives up seeking after a bound', () => {
    assert.deepEqual(Model.handoverStep(10.05, 10), { action: 'commit' });
    assert.deepEqual(Model.handoverStep(10.5, 10), { action: 'wait', ms: 500 });
    assert.deepEqual(Model.handoverStep(9, 10), { action: 'seek', to: 10.8 });
    assert.deepEqual(Model.handoverStep(9, 10, 1), { action: 'seek', to: 11.6 }, 'each retry leads by more');
    assert.deepEqual(Model.handoverStep(20, 10), { action: 'seek', to: 10.8 }, 'too far ahead to hold');
    assert.deepEqual(Model.handoverStep(9, 10, Model.POLICY.maxHandoverSeeks), { action: 'commit' });
});

test('refusals, the previous button rule, volume matching and fresh ahead answers', () => {
    assert.deepEqual([401, 403, 404, 410, 500, 206].map(Model.refused), [true, true, true, true, false, false]);
    assert.equal(Model.previousAction(3.5), 'restart'); assert.equal(Model.previousAction(2.9), 'previous');
    assert.equal(Model.volumeFor(0, false), 0); assert.equal(Model.volumeFor(1, true), 0); assert.equal(Model.volumeFor(1, false), 1);
    const levels = [0.05, 0.2, 0.5, 0.8, 0.95].map(level => Model.volumeFor(level, false));
    assert.deepEqual([...levels].sort((a, b) => a - b), levels, 'louder slider, louder audio');
    // Half of Spotify's slider measured -18.5 dB; the <audio> element reaches it at about 7.95 % volume.
    assert.ok(Math.abs(Model.volumeFor(0.5, false) - 0.0795) < 0.001);
    const answer = { found: true, stream: { media: '/ext/media/abcdefgh12', expiresAt: null } };
    assert.equal(Model.aheadFresh({ answer, at: 1000 }, 1000 + 60000), true);
    assert.equal(Model.aheadFresh({ answer, at: 1000 }, 1000 + Model.POLICY.aheadKeepMs), false);
    assert.equal(Model.aheadFresh({ answer: { ...answer, stream: { ...answer.stream, expiresAt: 100000 } }, at: 1000 }, 71000), false, 'an address about to expire is asked again');
    assert.equal(Model.aheadFresh({ answer: { ...answer, stream: { ...answer.stream, expiresAt: 500000 } }, at: 1000 }, 200000), true);
    assert.equal(Model.aheadFresh({ answer: { found: false, reason: 'not-found' }, at: 1000 }, 1001), false);
    assert.equal(Model.aheadFresh(undefined, 1001), false);
    assert.equal(Model.mediaPath(answer), '/ext/media/abcdefgh12');
    assert.equal(Model.mediaPath({ stream: { media: 'https://elsewhere.example/a' } }), null);
    assert.equal(Model.mediaPath({ stream: { media: '/ext/media/../../health' } }), null);
});

test('the track sent to the runner comes from Spicetify\'s item or queue entry', () => {
    const item = { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', name: 'Song', duration: { milliseconds: 201500 },
        metadata: { title: 'Ignored', artist_name: 'Main', 'artist_name:1': 'Guest', album_title: 'Album', image_url: 'spotify:image:ab67616d0000b273aaaaaaaaaaaaaaaaaaaaaaaa', isrc: 'usum71703861' } };
    assert.deepEqual(Model.trackInfo(item), { id: '4uLU6hMCjMI75M1A2tKUQC', uri: item.uri, title: 'Song', artist: 'Main', artists: ['Main', 'Guest'],
        album: 'Album', durationMs: 201500, isrc: 'USUM71703861', cover: 'https://i.scdn.co/image/ab67616d0000b273aaaaaaaaaaaaaaaaaaaaaaaa' });
    const queued = Model.trackInfo({ uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', metadata: { title: 'Next', artist_name: 'B', duration: '180000', image_url: 'http://insecure/x' } });
    assert.equal(queued.durationMs, 180000); assert.equal(queued.cover, undefined); assert.equal(queued.isrc, undefined);
    assert.deepEqual(Model.trackInfo({ uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', artists: [{ name: 'A' }, { name: '' }, { name: 'C' }] }).artists, ['A', 'C']);
    assert.equal(Model.trackInfo({ uri: 'spotify:ad:123' }), null); assert.equal(Model.trackInfo(null), null);
});

test('"Why this source?" reads as Android\'s sheet, with the engine\'s notes localized and addresses masked', () => {
    const attempt = { id: 3, track: '4uLU6hMCjMI75M1A2tKUQC', ahead: true, chosen: 'b.flac', announced: 'FLAC · 24-bit · 96 kHz', sourceQuality: 'Quality: Hi-Res',
        asked: [{ extension: 'a.src', outcome: 'not-found', ms: 412 }, { extension: 'c.src', outcome: 'skipped', ms: 0, skippedReason: 'set aside: rate limited' },
            { extension: 'b.flac', outcome: 'found', ms: 803, detail: 'see https://cdn.example/x?token=secret' }, { extension: 'd.src', outcome: 'weird', ms: 5 }],
        open: { ok: false, ms: 120, httpStatus: 403, error: 'refused https://cdn.example/f.flac?sig=abc' },
        detected: 'audio/flac', fallback: 'Spotify: no extension had it; the song goes on where it played', error: 'boom' };
    const names = { 'a.src': 'Source A', 'b.flac': 'Source B' };
    assert.deepEqual(Model.attemptLines('ko', attempt, names, 'audio/flac · 3:20'), [
        { kind: 'muted', text: '곡을 재생하기 전에 미리 확인함' },
        { kind: 'head', text: '확인한 소스' },
        { kind: 'line', text: 'Source A — 찾지 못함 · 412 ms' },
        { kind: 'line', text: 'c.src — 건너뜀: 잠시 제외됨: rate limited' },
        { kind: 'line', text: 'Source B — 찾음 · 803 ms (see https://cdn.example/x)' },
        { kind: 'line', text: 'd.src — 확장 오류 · 5 ms' },
        { kind: 'line', text: '선택됨: Source B' },
        { kind: 'line', text: '120 ms 후 열기 실패: refused https://cdn.example/f.flac · HTTP 403' },
        { kind: 'line', text: '소스가 알린 정보: FLAC · 24-bit · 96 kHz' },
        { kind: 'line', text: '자체 설정: Quality: Hi-Res(Source B)' },
        { kind: 'line', text: '플레이어가 감지한 정보: audio/flac · 3:20' },
        { kind: 'muted', text: '대체: Spotify: 이 곡을 가진 확장이 없음; 곡은 재생하던 곳에서 계속됩니다' },
        { kind: 'muted', text: '마지막 오류: boom' },
    ]);
    const en = Model.attemptLines('en', { asked: [], chosen: null, open: { ok: true, ms: 88, httpStatus: 206 } });
    assert.deepEqual(en.map(l => l.text), ['Sources asked', 'No source had it', 'Opened in 88 ms · HTTP 206']);
    assert.deepEqual(Model.attemptLines('en', null), [{ kind: 'muted', text: 'No extension attempt recorded for this song yet.' }]);
    assert.equal(Model.note('en', 'inactive: signed out; something of its own'), 'inactive: signed out; something of its own');
    assert.equal(Model.note('ko', 'picked in the player for this session'), '이번 실행 동안 플레이어에서 선택함');
    assert.equal(Model.maskText('a https://u:p@h.example/p?q=1#f b'), 'a https://h.example/p b');
});

const ask = (key, critical, extra = {}) => ({ key, label: key, level: critical ? 'critical' : 'normal', critical, why: '', hosts: [], new: true, ...extra });
const preview = (extra = {}) => ({ pending: 'p-1', plan: 'install', compatible: true, sha256: 'ab'.repeat(32), source: 'https://codeberg.org/someone/x?ref=main', origin: null,
    manifest: { id: 'x.y', name: 'X', version: '1.2', versionCode: 12, author: 'Someone', description: '', changelog: '', icon: null },
    asks: [ask('network', false, { why: 'Reach its server', hosts: ['api.example'] }), ask('audio.source', true, { why: 'Play songs' }), ask('storage', false), ask('webview.page', true, { why: 'Sign in' })],
    critical: true, replaces: null, clashes: [], ...extra });

test('the consent list shows critical actions first, keeps the manifest order otherwise, and grants every listed action', () => {
    const view = Model.consent(preview({ replaces: { version: '1.1', versionCode: 11 }, clashes: [{ kind: 'exclusive', other: 'old.one', otherName: 'Old one', action: 'audio.source' }] }));
    assert.deepEqual(view.actions.map(a => [a.key, a.critical]), [['audio.source', true], ['webview.page', true], ['network', false], ['storage', false]]);
    assert.deepEqual(view.granted, ['network', 'audio.source', 'storage', 'webview.page'], 'every asked key, in the manifest order');
    assert.equal(view.actions[1].why, 'Sign in'); assert.deepEqual(view.actions[2].hosts, ['api.example']);
    assert.equal(view.critical, true); assert.equal(view.pending, 'p-1'); assert.equal(view.replaces, '1.1'); assert.equal(view.manifest.name, 'X');
    assert.equal(view.installable, true);
    assert.equal(Model.consent(preview({ plan: 'not-newer' })).installable, false, 'an older or the same version is not installed');
    assert.equal(Model.consent(preview({ compatible: false })).installable, false);
    assert.equal(Model.consent(preview()).replaces, '');
    assert.deepEqual(Model.keepChoices(view.clashes, () => undefined), { 'old.one': true }, 'by default the new one acts');
    assert.deepEqual(Model.keepChoices(view.clashes, other => other !== 'old.one'), { 'old.one': false });
    assert.equal(Model.actionLabel('ko', 'audio.source'), '다른 곳의 오디오로 재생'); assert.equal(Model.actionLabel('ko', 'future.thing'), 'future.thing');
    assert.deepEqual(Model.changeLine('en', { kind: 'ACTION', key: 'library.write', why: '', before: '', critical: true, added: 0, removed: 0 }), { text: 'New: Change your library', critical: true });
    assert.equal(Model.changeLine('ko', { kind: 'HOST', key: '*', critical: true }).text, '모든 웹사이트');
    assert.equal(Model.changeLine('en', { kind: 'CODE', key: 'main.js', critical: false }).text, 'Its code changed');
    assert.equal(Model.updateMessage('ko', 'up-to-date'), '최신 상태');
    assert.equal(Model.updateMessage('en', 'applied'), 'Updated: it asks nothing new');
    assert.equal(Model.updateMessage('ko', 'not-from-a-repository'), '패키지 주소로 설치해 확인할 저장소가 없습니다');
    assert.equal(Model.updateMessage('en', 'something-new'), 'Could not check: something-new');
});

const extension = (extra = {}) => ({ id: 'x.flac', name: 'Source X', version: '1.0', versionCode: 1, author: 'Someone', description: '', icon: null,
    enabled: true, running: true, disabledReason: null, error: null, status: null, cooldown: null, signIn: null, hooks: ['audio-source'], permissions: [], settings: [],
    source: 'https://codeberg.org/someone/x', origin: null, sha256: 'ab'.repeat(32), installedAt: 1, previous: null, pendingUpdate: null, sourceGone: false, updateBlocked: null, ...extra });
const setting = (key, type, extra = {}) => ({ key, type, label: key, description: '', default: null, options: [], section: null, role: null, perNetwork: false, set: false, value: null, ...extra });

test('the state line follows the runner\'s fields', () => {
    assert.deepEqual(Model.statusLine('en', extension()), { text: 'Running', ok: true });
    assert.deepEqual(Model.statusLine('en', extension({ running: false })), { text: 'On', ok: true });
    assert.equal(Model.statusLine('ko', extension({ enabled: false, disabledReason: 'blocked' })).text, '꺼짐: blocked');
    assert.equal(Model.statusLine('ko', extension({ enabled: false })).text, '꺼짐');
    assert.equal(Model.statusLine('en', extension({ status: { state: 'signed-out', live: false, detail: 'Sign in again' } })).text, 'Inactive: Sign in again');
    assert.equal(Model.statusLine('en', extension({ cooldown: 'rate limited' })).text, 'Set aside for now: rate limited');
    assert.equal(Model.statusLine('en', extension({ error: 'boom' })).text, 'Last error: boom');
});

test('settings fields: edited, pressed or shown, the user\'s value else the default, only changes sent', () => {
    const fields = Model.settingFields(extension({ settings: [
        setting('quality', 'choice', { options: ['Hi-Res', 'FLAC'], default: 'Hi-Res', set: true, value: 'FLAC' }),
        setting('gapless', 'toggle', { default: true }),
        setting('token', 'secret', { set: true }), setting('limit', 'number', { default: 3 }),
        setting('name', 'text', { set: true, value: 'x' }), setting('pair', 'button'),
        setting('later', 'color', { default: '#fff' }), setting('empty', 'choice')] }));
    assert.deepEqual(fields.map(f => [f.key, f.mode, f.value]), [['quality', 'edit', 'FLAC'], ['gapless', 'edit', true], ['token', 'edit', ''],
        ['limit', 'edit', 3], ['name', 'edit', 'x'], ['pair', 'press', ''], ['later', 'show', '#fff'], ['empty', 'show', '']]);
    const form = { quality: 'Hi-Res', gapless: true, token: '', limit: '7', name: 'x' };
    assert.deepEqual(Model.settingValues(fields, key => form[key]), { quality: 'Hi-Res', limit: 7 }, 'unchanged fields and an empty secret are not sent');
    assert.deepEqual(Model.settingValues(fields, key => key === 'token' ? 'abc' : form[key], new Set(['name'])), { quality: 'Hi-Res', token: 'abc', limit: 7, name: null }, 'null puts a setting back to its default');
    assert.equal(Model.settingValues(fields, key => key === 'limit' ? 'x' : form[key]).limit, undefined, 'an invalid number is not sent');
});

test('order moves keep every entry, and errors map to keys', () => {
    assert.deepEqual(Model.orderMove(['c', 'spotify', 'a'], 'a', -1), ['c', 'a', 'spotify']);
    assert.deepEqual(Model.orderMove(['c', 'spotify'], 'c', -1), ['c', 'spotify']);
    assert.equal(Model.errorKey(503, { error: 'runner-missing' }), 'error_runner_missing');
    assert.equal(Model.errorKey(503, {}), 'error_runner_failed'); assert.equal(Model.errorKey(400, { error: 'bad-request' }), 'error_other');
    assert.equal(Model.errorKey(0, { error: 'network' }), 'error_network');
});

test('ivLyrics follows the extension clock of the native song and gives it back to Spotify', () => {
    let clock = 1000; const calls = [];
    const native = { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' };
    const host = {
        performance: { now: () => clock }, setInterval: () => 1, clearInterval() {},
        Spicetify: { Player: { data: { item: native } } },
        Utils: { getSafePlayerProgress: () => 2000, getPlayerPlaybackSnapshot: () => ({ uri: native.uri, position: 2000, isPlaying: false, duration: 200000 }),
            clearSafePlayerProgressCorrection: () => calls.push('clear') },
        lyricContainer: { getPlaybackPaused: () => true, updatePlaybackPausedState: () => calls.push('paused-state') },
        OverlaySender: { sendProgressPayload: (endpoint, payload, uri) => ({ endpoint, payload, uri }) },
    };
    const adapter = ivLyricsAdapter.create(host);
    adapter.setExternalClock({ uri: native.uri, seconds: 30, duration: 200, playing: true });
    clock += 400;
    assert.equal(host.Utils.getSafePlayerProgress(), 30400);
    assert.deepEqual(host.Utils.getPlayerPlaybackSnapshot(), { uri: native.uri, position: 30400, isPlaying: true, duration: 200000, sampledAt: clock });
    assert.equal(host.lyricContainer.getPlaybackPaused(), false);
    const sent = host.OverlaySender.sendProgressPayload('/p', { trackUri: native.uri, position: 2000, isPlaying: false }, native.uri);
    assert.deepEqual(sent.payload, { trackUri: native.uri, position: 30400, duration: 200000, remaining: 169600, isPlaying: true });
    adapter.setExternalClock({ uri: native.uri, seconds: 31, duration: 200, playing: false });
    clock += 5000;
    assert.equal(host.Utils.getSafePlayerProgress(), 31000, 'a paused clock does not move');
    host.Spicetify.Player.data = { item: { uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY' } };
    assert.equal(host.Utils.getSafePlayerProgress(), 2000, 'another song shown by Spotify keeps its own clock');
    host.Spicetify.Player.data = { item: native };
    adapter.setExternalClock(null);
    assert.equal(host.Utils.getSafePlayerProgress(), 2000);
    assert.equal(host.lyricContainer.getPlaybackPaused(), true);
    assert.ok(calls.includes('clear'));
    adapter.dispose();
});

const A = 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', B = 'spotify:track:6x7SB38tuekpu4xpH9OIPY';
// Values made in the module's realm have their own prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };
const item = (uri, name) => ({ uri, name, metadata: { title: name, artist_name: 'Artist', album_title: 'Album' }, duration: { milliseconds: 200000 } });

function harness({ answers = {}, engine = {}, remote = false, linkBusy = false, again = missing, probeStatus = 206, routes = () => undefined } = {}) {
    const { window } = parseHTML('<!doctype html><html><head></head><body><div data-testid="now-playing-bar"><div class="playback-bar">'
        + '<div data-testid="playback-position">0:00</div><div data-testid="progress-bar"></div><div data-testid="playback-duration">3:20</div></div>'
        + '<div class="right"><button data-testid="control-button-playpause"><svg></svg></button><div data-testid="volume-bar"></div></div></div></body></html>');
    const calls = [], requests = [], events = {}, timers = [], clocks = [], intervals = [], modals = [];
    const state = { playing: true, position: 0, repeat: 0, ...engine };
    class FakeAudio extends EventTarget {
        constructor() { super(); Object.assign(this, { paused: true, currentTime: 0, duration: NaN, readyState: 0, muted: false, volume: 1, error: null, attributes: {} }); }
        set src(value) { this.attributes.src = value; calls.push(['audio-src', value]); }
        get src() { return this.attributes.src || ''; }
        getAttribute(name) { return this.attributes[name] ?? null; }
        removeAttribute(name) { delete this.attributes[name]; }
        load() {}
        play() { this.paused = false; calls.push('audio-play'); this.dispatchEvent(new Event('play')); return Promise.resolve(); }
        pause() { if (!this.paused) { this.paused = true; calls.push('audio-pause'); this.dispatchEvent(new Event('pause')); } }
        fire(name) { this.dispatchEvent(new Event(name)); }
    }
    let audio = null;
    window.Audio = class extends FakeAudio { constructor() { super(); audio = this; } };
    const Player = {
        data: { item: item(A, 'Song A') },
        isPlaying: () => state.playing, getProgress: () => state.position,
        pause() { calls.push('engine-pause'); state.playing = false; }, play() { calls.push('engine-play'); state.playing = true; },
        togglePlay() { calls.push('engine-toggle'); state.playing = !state.playing; },
        seek(ms) { calls.push(['engine-seek', ms]); state.position = ms; }, next() { calls.push('engine-next'); }, back() { calls.push('engine-back'); },
        getVolume: () => 0.5, getMute: () => false, getRepeat: () => state.repeat, setVolume() {}, toggleMute() {}, setMute() {}, increaseVolume() {}, decreaseVolume() {},
        addEventListener(name, fn) { (events[name] ||= []).push(fn); }, removeEventListener() {},
    };
    window.Spicetify = { Player, Locale: { getLocale: () => 'ko' }, showNotification() {},
        Platform: { ConnectAPI: { state: { activeDevice: { isLocal: !remote } } } },
        Queue: { nextTracks: [{ contextTrack: item(B, 'Song B') }] },
        PopupModal: { display: value => { modals.push(value); window.document.body.append(value.content); }, hide() {} }, Menu: { Item: class { register() {} deregister() {} } } };
    window.confirm = () => true;
    window.fetch = async (url, init = {}) => {
        const route = url.replace('http://127.0.0.1:19643', ''), body = init.body ? JSON.parse(init.body) : null;
        requests.push({ route, method: init.method || 'GET', body, headers: init.headers });
        const reply = (status, value, headers = {}) => ({ status, json: async () => value, headers: { get: name => headers[name] ?? null } });
        const custom = routes(route, body);
        if (custom) return reply(...custom);
        if (route === '/ext/state') return reply(200, { available: true, installed: true, audio: true, running: true });
        if (route === '/ext/audio') return reply(200, answers[(body.ahead ? 'ahead:' : '') + body.track.uri] || missing);
        if (route === '/ext/audio/again') return reply(200, again);
        if (route.startsWith('/ext/media/')) return reply(probeStatus, {}, { 'Content-Type': 'audio/flac', 'Content-Range': 'bytes 0-0/40000000' });
        return reply(200, {});
    };
    const context = vm.createContext({ window, console, performance, AbortController, URL,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
        setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'extension-player.js'), 'utf8'), context);
    const player = window.SpotifyHangulExtensionPlayer.create(window, { ivLyrics: { setExternalClock: value => clocks.push(value) }, linkBusy: () => linkBusy });
    const runTimers = ms => { timers.filter(t => t.fn && (ms === undefined || t.ms === ms)).forEach(t => { const fn = t.fn; t.fn = null; fn(); }); };
    const changeSong = (uri, name) => { Player.data = { item: item(uri, name) }; (events.songchange || []).forEach(fn => fn()); };
    return { window, player, Player, state, calls, requests, clocks, modals, audio: () => audio, runTimers, changeSong, tick: () => intervals.forEach(fn => fn()),
        notes: () => requests.filter(r => r.route === '/ext/attempts/note').map(r => r.body), cleanup: () => player.dispose() };
}
const found = (id, extra = {}) => ({ found: true, attempt: null, extension: 'x.flac', name: 'Source X', stream: { media: '/ext/media/' + id, mimeType: 'audio/flac',
    codec: 'flac', bitDepth: 24, sampleRate: 96000, quality: 'FLAC · 24-bit · 96 kHz', durationMs: 200000, expiresAt: null, ...extra } });
const missing = { found: false, attempt: null, reason: 'not-found' };

test('an answer while Spotify plays is handed over in step, then the playbar, lyrics clock and controls follow the extension audio', dom, async () => {
    const h = harness({ answers: { [A]: found('media-aaaa1') } });
    await flush();
    const audio = h.audio();
    assert.equal(h.player.snapshot().mode, 'pending');
    assert.equal(audio.src, 'http://127.0.0.1:19643/ext/media/media-aaaa1'); assert.equal(audio.muted, true); assert.equal(audio.paused, false);
    assert.ok(!h.calls.includes('engine-pause'), 'Spotify keeps playing while the extension audio loads');
    const posted = h.requests.find(r => r.route === '/ext/audio');
    assert.equal(posted.headers['X-Hangul-Lyrics-Client'], 'ivlyrics'); assert.equal(posted.body.track.id, '4uLU6hMCjMI75M1A2tKUQC');
    audio.duration = 200; audio.fire('loadedmetadata');
    assert.equal(audio.currentTime, Model.POLICY.handoverLeadSec, 'loaded ahead of Spotify');
    h.state.position = 300; audio.readyState = 4; audio.fire('canplay');
    assert.equal(audio.paused, true, 'held until Spotify reaches the same point');
    h.state.position = 800; h.runTimers(500);
    assert.equal(h.player.snapshot().mode, 'extension');
    assert.ok(h.calls.includes('engine-pause')); assert.equal(audio.muted, false); assert.equal(audio.paused, false);
    assert.ok(Math.abs(audio.volume - Model.volumeFor(0.5, false)) < 1e-9);
    await flush();
    const opened = h.notes().find(n => n.open?.ok);
    assert.equal(opened.trackId, '4uLU6hMCjMI75M1A2tKUQC'); assert.equal(opened.open.httpStatus, 206);
    assert.equal(opened.detected, 'audio/flac · 3:20 · 1600 kbit/s');
    const probe = h.requests.find(r => r.route.startsWith('/ext/media/'));
    assert.equal(probe.headers.Range, 'bytes=0-0');
    assert.equal(h.player.snapshot().line, 'Source X · FLAC · 24-bit · 96 kHz');
    assert.ok(h.window.document.querySelector('[data-testid="hangul-extension-quality"]'), 'the quality line sits in the playbar');
    audio.currentTime = 42; audio.fire('timeupdate');
    assert.deepEqual(plain(h.clocks.at(-1)), { uri: A, seconds: 42, duration: 200, playing: true });
    assert.equal(h.window.document.querySelector('[data-testid="playback-position"]').textContent, '0:42');
    assert.equal(h.Player.isPlaying(), true, 'Spicetify reports the extension audio'); assert.equal(h.Player.getProgress(), 42000);
    h.Player.togglePlay();
    assert.equal(audio.paused, true); assert.ok(!h.calls.includes('engine-toggle'), 'the engine stays paused');
    h.window.document.querySelector('[data-testid="control-button-playpause"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
    assert.equal(audio.paused, false, 'the native play button plays the extension audio');
    h.Player.seek(90000); assert.equal(audio.currentTime, 90);
    h.Player.back(); assert.equal(audio.currentTime, 0, 'past 3 s, previous restarts the song');
    h.cleanup();
    assert.deepEqual(h.calls.filter(c => Array.isArray(c) && c[0] === 'engine-seek').at(-1), ['engine-seek', 0], 'disposing gives the song back where it played');
    assert.equal(h.clocks.at(-1), null);
});

test('a song asked ahead starts at once from the extension when Spotify reaches it, and its end goes on to Spotify\'s next song', dom, async () => {
    const h = harness({ answers: { [A]: found('media-aaaa1'), ['ahead:' + B]: found('media-bbbb2') }, engine: { playing: false } });
    await flush();
    const audio = h.audio();
    assert.equal(h.player.snapshot().mode, 'extension', 'a paused song switches at once');
    assert.equal(audio.paused, true, 'and stays paused');
    h.Player.play(); assert.equal(audio.paused, false);
    audio.duration = 200; audio.fire('loadedmetadata'); audio.currentTime = 12;
    h.tick();
    await flush();
    assert.ok(h.requests.some(r => r.route === '/ext/audio' && r.body.ahead === true && r.body.track.uri === B));
    assert.deepEqual(plain(h.player.snapshot().ahead), ['6x7SB38tuekpu4xpH9OIPY']);
    audio.fire('ended');
    assert.ok(h.calls.includes('engine-next'));
    const before = h.calls.length;
    h.changeSong(B, 'Song B');
    await flush();
    assert.equal(h.player.snapshot().mode, 'extension');
    assert.equal(audio.src, 'http://127.0.0.1:19643/ext/media/media-bbbb2');
    assert.ok(h.calls.slice(before).includes('engine-pause') && h.calls.slice(before).includes('audio-play'));
    assert.ok(!h.requests.some(r => r.route === '/ext/audio' && !r.body.ahead && r.body.track.uri === B), 'the kept answer is used, not asked again');
    h.state.repeat = 2; audio.currentTime = 199; audio.fire('ended');
    assert.equal(audio.currentTime, 0, 'repeat one replays the extension audio');
    h.cleanup();
});

test('a refused address asks the source again once, then Spotify plays on from the same point', dom, async () => {
    const h = harness({ answers: { [A]: found('media-aaaa1') }, engine: { playing: false }, probeStatus: 403, again: found('media-again3') });
    await flush();
    const audio = h.audio();
    h.Player.play(); audio.currentTime = 42; audio.error = { code: 4 }; audio.fire('error');
    await flush();
    assert.ok(h.requests.some(r => r.route === '/ext/audio/again'));
    assert.equal(audio.src, 'http://127.0.0.1:19643/ext/media/media-again3');
    const refusedNote = h.notes().find(n => n.open && !n.open.ok);
    assert.equal(refusedNote.open.httpStatus, 403); assert.equal(refusedNote.open.error, 'media not supported');
    audio.duration = 200; audio.fire('loadedmetadata'); assert.equal(audio.currentTime, 42, 'the new address resumes at the same point');
    audio.error = { code: 2 }; audio.fire('error');
    await flush();
    assert.equal(h.requests.filter(r => r.route === '/ext/audio/again').length, 1, 'asked again only once');
    assert.equal(h.player.snapshot().mode, 'spotify');
    assert.ok(h.calls.some(c => Array.isArray(c) && c[0] === 'engine-seek' && c[1] === 42000)); assert.equal(h.calls.at(-1), 'engine-play');
    assert.equal(h.notes().at(-1).fallback, 'Spotify');
    h.cleanup();
});

test('no answer, another device or link playback leave Spotify alone', dom, async () => {
    const plain = harness();
    await flush();
    assert.equal(plain.player.snapshot().mode, 'spotify'); assert.ok(!plain.calls.includes('engine-pause'));
    assert.equal(plain.player.snapshot().line, 'Spotify');
    plain.cleanup();
    for (const options of [{ remote: true }, { linkBusy: true }]) {
        const h = harness({ answers: { [A]: found('media-aaaa1') }, ...options });
        await flush();
        assert.ok(!h.requests.some(r => r.route === '/ext/audio'), JSON.stringify(options));
        assert.equal(h.player.snapshot().mode, 'spotify');
        h.cleanup();
    }
});

test('a state missed at start, or an extension installed later, is read again: the line shows and the playing song is asked', dom, async () => {
    let ready = false;
    const h = harness({ answers: { [A]: found('media-late1') }, routes: route => route === '/ext/state' && !ready ? [503, { error: 'runner-failed' }] : undefined });
    const P = h.window.SpotifyHangulExtensionPlayer.model.POLICY, keep = P.stateKeepMs;
    try {
        await flush();
        assert.equal(h.player.snapshot().line, null, 'no state: no line');
        assert.ok(!h.requests.some(r => r.route === '/ext/audio'));
        ready = true; P.stateKeepMs = 0;
        h.tick(); await flush();
        assert.equal(h.player.snapshot().line, 'Spotify', 'the line shows once the state is read');
        assert.ok(h.requests.some(r => r.route === '/ext/audio' && r.body.track.uri === A), 'the playing song is asked without waiting for the next one');
    } finally { P.stateKeepMs = keep; h.cleanup(); }
});

test('the song Spotify restores after the page started, without a songchange, is asked and shows the line', dom, async () => {
    const h = harness({ answers: { [A]: found('media-rest1') } });
    try {
        h.Player.data = { item: null };
        h.changeSong(undefined); h.Player.data = { item: null };
        await flush();
        const asked = () => h.requests.filter(r => r.route === '/ext/audio' && r.body.track.uri === A).length;
        const before = asked();
        h.Player.data = { item: item(A, 'Song A') };   // restored, no event
        h.tick(); await flush();
        assert.equal(asked(), before + 1, 'the restored song is asked once');
        assert.equal(h.player.snapshot().song?.uri, A);
        h.tick(); h.tick(); await flush();
        assert.equal(asked(), before + 1, 'and not again on the next ticks');
    } finally { h.cleanup(); }
});

test('a Player object Spicetify replaces after the page started is followed: its song is asked and its controls are wrapped', dom, async () => {
    const h = harness({ answers: { [B]: found('media-fresh') } });
    try {
        await flush();
        const old = h.window.Spicetify.Player, events = {}, calls = [];
        const fresh = {
            data: { item: item(B, 'Song B') }, isPlaying: () => true, getProgress: () => 0,
            pause() { calls.push('fresh-pause'); }, play() {}, togglePlay() {}, seek() {}, next() { calls.push('fresh-next'); }, back() {},
            getVolume: () => 0.5, getMute: () => false, getRepeat: () => 0, setVolume() {}, toggleMute() {}, setMute() {}, increaseVolume() {}, decreaseVolume() {},
            addEventListener(name, fn) { (events[name] ||= []).push(fn); }, removeEventListener() {},
        };
        const freshNext = fresh.next;
        h.window.Spicetify.Player = fresh;
        h.tick(); await flush();
        assert.ok(h.requests.some(r => r.route === '/ext/audio' && r.body.track.uri === B), 'the new object\'s song is asked');
        assert.notEqual(fresh.next, freshNext, 'its controls are wrapped');
        assert.ok(events.songchange?.length, 'its songchange is listened to');
        assert.ok(!String(old.next).includes('owning'), 'the old object gets its own controls back');
    } finally { h.cleanup(); }
});

test('removing asks in the page, without window.confirm: the first press arms it, the second removes', dom, async () => {
    const h = harness({ routes: route => {
        if (route === '/ext/extensions') return [200, { extensions: [extension()] }];
        if (route === '/ext/order') return [200, { order: ['x.flac', 'spotify'], asked: ['x.flac', 'spotify'], session: null }];
        if (route === '/ext/extensions/x.flac/remove') return [200, { removed: true }];
    } });
    try {
        h.window.confirm = () => { throw new Error('window.confirm must not be used'); };
        await flush();
        await h.player.openManager(); await flush();
        const box = h.modals.at(-1).content;
        const removes = () => h.requests.filter(r => r.route === '/ext/extensions/x.flac/remove').length;
        click(h.window, exact(box, '제거')); await flush();
        assert.equal(removes(), 0, 'the first press only asks');
        assert.ok(box.textContent.includes('제거할까요'), 'the question is shown in the page');
        click(h.window, exact(box, '제거 확정')); await flush();
        assert.equal(removes(), 1, 'the second press removes');
    } finally { h.cleanup(); }
});

test('a song first seen on another device is asked once playback moves to this computer', dom, async () => {
    const h = harness({ answers: { [A]: found('media-back1') }, remote: true });
    try {
        await flush(); h.tick(); await flush();
        const asked = () => h.requests.filter(r => r.route === '/ext/audio' && r.body.track.uri === A).length;
        assert.equal(asked(), 0, 'nothing is asked while another device plays');
        h.window.Spicetify.Platform.ConnectAPI.state.activeDevice.isLocal = true;
        h.tick(); await flush();
        assert.equal(asked(), 1, 'asked when playback comes here');
        h.tick(); await flush();
        assert.equal(asked(), 1, 'and only once');
    } finally { h.cleanup(); }
});

const installed = [
    extension({ settings: [setting('quality', 'choice', { options: ['Hi-Res', 'FLAC'], default: 'FLAC' }), setting('pair', 'button', { label: 'Pair again' })] }),
    extension({ id: 'y.src', name: 'Source Y', version: '2.0', author: '', enabled: false, running: false, disabledReason: 'turned off' }),
];
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const byText = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent.startsWith(text));
const exact = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);

test('playback details show the quality, the runner\'s source choices and why this source was chosen; back to my order clears the session', dom, async () => {
    const attempt = { id: 1, at: 1, track: '4uLU6hMCjMI75M1A2tKUQC', title: 'Song A', asked: [{ extension: 'x.flac', outcome: 'found', ms: 321 }], chosen: 'x.flac', announced: 'FLAC · 24-bit · 96 kHz' };
    let session = { source: null, choices: ['x.flac', 'spotify'] };
    const h = harness({ answers: { [A]: found('media-aaaa1') }, engine: { playing: false }, routes: (route, body) => {
        if (route === '/ext/extensions') return [200, { extensions: installed }];
        if (route === '/ext/session') {
            if (body) { assert.deepEqual(body, { source: null }); session = { source: null, choices: ['x.flac', 'spotify'] }; }
            return [200, session];
        }
        if (route === '/ext/attempts/latest?track=4uLU6hMCjMI75M1A2tKUQC') return [200, { attempt }];
        if (route === '/ext/audio/pick') {
            session = { source: body.source, choices: [body.source, ...['x.flac', 'spotify'].filter(id => id !== body.source)] };
            return [200, body.source === 'spotify' ? { found: false, reason: 'spotify-picked', attempt: null } : found('media-pick4')];
        }
    } });
    await flush();
    await h.player.openDetails();
    const box = h.modals.at(-1).content, text = box.textContent;
    assert.equal(h.modals.at(-1).title, '재생 상세 정보');
    assert.ok(text.includes('현재 재생 중: Source X · FLAC · 24-bit · 96 kHz'));
    assert.ok(text.includes('소스가 알린 정보: FLAC · 24-bit · 96 kHz'));
    assert.ok(text.includes('이 소스를 선택한 이유') && text.includes('Source X — 찾음 · 321 ms') && text.includes('선택됨: Source X'));
    assert.deepEqual([...box.querySelectorAll('.hl-ext-choice')].map(node => node.firstChild.textContent), ['Source X', 'Spotify'], 'the runner\'s choices, in its order');
    click(h.window, [...box.querySelectorAll('.hl-ext-choice')][1]);
    await flush();
    const pick = h.requests.find(r => r.route === '/ext/audio/pick');
    assert.equal(pick.body.source, 'spotify'); assert.equal(pick.body.track.id, '4uLU6hMCjMI75M1A2tKUQC');
    assert.equal(h.player.snapshot().mode, 'spotify', 'picking Spotify gives the song back');
    assert.equal(h.player.snapshot().lead, 'spotify');
    assert.equal(h.player.snapshot().line, 'Spotify · 임시');
    await flush();
    const now = h.modals.at(-1).content;
    assert.deepEqual([...now.querySelectorAll('.hl-ext-choice')].map(node => node.firstChild.textContent), ['Spotify', 'Source X']);
    const picks = h.requests.filter(r => r.route === '/ext/audio/pick').length;
    click(h.window, byText(now, '내 순서로 돌아가기'));
    await flush();
    assert.ok(h.requests.some(r => r.route === '/ext/session' && r.method === 'POST'), 'back to my order clears the session pick');
    assert.equal(h.requests.filter(r => r.route === '/ext/audio/pick').length, picks, 'nothing is asked again');
    assert.equal(h.player.snapshot().lead, null);
    assert.equal(h.player.snapshot().mode, 'spotify', 'the song goes on from where it plays');
    h.cleanup();
});

test('the manager lists extensions, presses buttons, saves only changes, offers each clash and grants every listed action', dom, async () => {
    const offer = preview({ pending: 'pending-7', source: 'https://codeberg.org/a/z', manifest: { id: 'z.new', name: 'New Z', version: '0.1', versionCode: 1, author: 'Author Z', description: '', changelog: '', icon: null },
        asks: [ask('network', false, { why: 'Reach its server', hosts: ['api.z.example'] }), ask('audio.source', true, { why: 'Play songs' })],
        clashes: [{ kind: 'exclusive', other: 'x.flac', otherName: 'Source X', action: 'audio.source' }, { kind: 'conflict', other: 'y.src', otherName: 'Source Y' }] });
    let refusals = 1;
    const h = harness({ routes: (route, body) => {
        if (route === '/ext/extensions') return [200, { extensions: installed }];
        if (route === '/ext/order') return [200, { order: ['x.flac', 'spotify', 'y.src'], asked: ['x.flac', 'spotify'], session: null }];
        if (route === '/ext/install/preview') return [200, offer];
        if (route === '/ext/install/confirm') return refusals-- > 0 ? [400, { error: 'not-granted', missing: ['audio.source'] }] : [200, { extension: extension({ id: 'z.new', name: 'New Z' }) }];
        if (route === '/ext/extensions/x.flac/settings') return [200, {}];
        if (route === '/ext/extensions/x.flac/update') return [200, { result: 'up-to-date', extension: installed[0] }];
    } });
    await flush();
    await h.player.openManager();
    const box = h.modals.at(-1).content;
    assert.equal(h.modals.at(-1).title, '확장');
    assert.ok(box.textContent.includes('Source X') && box.textContent.includes('꺼짐: turned off'));
    assert.ok(box.textContent.includes('제3자'), 'the neutral third-party note is shown');
    assert.ok(box.textContent.includes('묻지 않음: Spotify가 위에 있습니다'), 'a source below Spotify is said not to be asked');
    click(h.window, byText(box, '업데이트 확인'));
    await flush();
    assert.ok(box.textContent.includes('최신 상태'), 'the update result key is shown in words');
    click(h.window, byText(box, '설정'));
    await flush();
    const select = box.querySelector('select');
    assert.equal(select.value, 'FLAC', 'the default when the user set nothing');
    select.querySelector('[selected]').removeAttribute('selected'); select.querySelector('option').setAttribute('selected', '');
    click(h.window, byText(box, 'Pair again'));
    await flush();
    assert.deepEqual(h.requests.find(r => r.route === '/ext/extensions/x.flac/settings').body, { press: 'pair' }, 'a button is pressed');
    click(h.window, byText(box, '저장'));
    await flush();
    assert.deepEqual(h.requests.filter(r => r.route === '/ext/extensions/x.flac/settings').at(-1).body, { values: { quality: 'Hi-Res' } });
    box.querySelector('input[type="url"]').value = 'https://codeberg.org/a/z';
    click(h.window, byText(box, '계속'));
    await flush();
    assert.deepEqual(h.requests.find(r => r.route === '/ext/install/preview').body, { url: 'https://codeberg.org/a/z' });
    assert.ok(box.textContent.includes('New Z을(를) 설치할까요?'));
    const actions = [...box.querySelectorAll('.hl-ext-action')];
    assert.deepEqual(actions.map(node => node.dataset.critical), ['true', 'false'], 'the critical action comes first');
    assert.ok(actions[0].textContent.includes('다른 곳의 오디오로 재생 · 고위험') && actions[1].textContent.includes('웹사이트: api.z.example'));
    assert.ok(!actions[0].textContent.includes('새로 추가됨'), 'a fresh install marks nothing as new');
    assert.ok(box.querySelector('.hl-ext-warn'));
    const clashes = [...box.querySelectorAll('.hl-ext-clash')];
    assert.deepEqual(clashes.map(node => node.dataset.other), ['x.flac', 'y.src']);
    assert.ok(clashes[0].textContent.includes('Source X이(가) 현재 제공 중인 다른 곳의 오디오로 재생을(를) 대체합니다'));
    assert.ok(clashes[1].textContent.includes('New Z 사용(다른 확장은 꺼짐 상태로 설치 유지)') && clashes[1].textContent.includes('Source Y 유지'));
    const keepOld = clashes[1].querySelector('input[value="false"]'); keepOld.checked = true; keepOld.dispatchEvent(new h.window.Event('change'));
    const install = byText(box, '설치');
    assert.equal(install.disabled, true, 'install waits for the tick');
    const tick = [...box.querySelectorAll('input[type="checkbox"]')].at(-1); tick.checked = true; tick.dispatchEvent(new h.window.Event('change'));
    assert.equal(install.disabled, false);
    click(h.window, install);
    await flush();
    assert.deepEqual(h.requests.find(r => r.route === '/ext/install/confirm').body,
        { pending: 'pending-7', granted: ['network', 'audio.source'], keep: { 'x.flac': true, 'y.src': false } });
    assert.ok(box.textContent.includes('나열된 작업을 모두 수락해야 합니다: 다른 곳의 오디오로 재생'), 'a not-granted refusal names what is missing');
    click(h.window, install);
    await flush();
    assert.ok(box.textContent.includes('New Z을(를) 설치했습니다'));
    h.cleanup();
});

test('an update that asks more opens its pending prompt, marks the new actions and confirms with its key', dom, async () => {
    const staged = preview({ pending: 'upd-1', plan: 'update', manifest: { id: 'x.flac', name: 'Source X', version: '1.1', versionCode: 2, author: 'Someone', description: '', changelog: '', icon: null },
        asks: [ask('audio.source', true, { new: false }), ask('library.write', true, { new: true })], replaces: { version: '1.0', versionCode: 1 },
        changes: [{ kind: 'ACTION', key: 'library.write', why: '', before: '', critical: true, added: 0, removed: 0 }] });
    const h = harness({ routes: route => {
        if (route === '/ext/extensions') return [200, { extensions: [installed[0]] }];
        if (route === '/ext/order') return [200, { order: ['x.flac', 'spotify'], asked: ['x.flac', 'spotify'], session: null }];
        if (route === '/ext/extensions/x.flac/update') return [200, { result: 'needs-ok', pending: staged, extension: installed[0] }];
        if (route === '/ext/install/confirm') return [200, { extension: installed[0] }];
    } });
    await flush();
    await h.player.openManager();
    const box = h.modals.at(-1).content;
    click(h.window, byText(box, '업데이트 확인'));
    await flush();
    assert.ok(box.textContent.includes('Source X을(를) 업데이트할까요?') && box.textContent.includes('새로 추가: 라이브러리 변경'));
    const actions = [...box.querySelectorAll('.hl-ext-action')];
    assert.ok(actions[1].textContent.includes('이 버전에서 새로 추가됨') && !actions[0].textContent.includes('이 버전에서 새로 추가됨'));
    const tick = [...box.querySelectorAll('input[type="checkbox"]')].at(-1); tick.checked = true; tick.dispatchEvent(new h.window.Event('change'));
    click(h.window, byText(box, '수락'));
    await flush();
    assert.deepEqual(h.requests.find(r => r.route === '/ext/install/confirm').body, { pending: 'upd-1', granted: ['audio.source', 'library.write'] });
    h.cleanup();
});

test('a version already installed cannot be confirmed', dom, async () => {
    const h = harness({ routes: route => {
        if (route === '/ext/extensions') return [200, { extensions: [] }];
        if (route === '/ext/order') return [200, { order: ['spotify'], asked: ['spotify'], session: null }];
        if (route === '/ext/install/preview') return [200, preview({ plan: 'not-newer' })];
    } });
    await flush();
    await h.player.openManager();
    const box = h.modals.at(-1).content;
    // Nothing installed: the manager opens on the Store, as Myspoti does; the installed view is one tab away.
    assert.equal(exact(box, '스토어').getAttribute('aria-pressed'), 'true');
    click(h.window, exact(box, '설치됨'));
    await flush();
    assert.ok(box.textContent.includes('설치된 확장이 없습니다.'));
    assert.equal(box.querySelectorAll('.hl-ext-card').length, 1, 'no order card with Spotify alone');
    box.querySelector('input[type="url"]').value = 'https://codeberg.org/a/x';
    click(h.window, byText(box, '계속'));
    await flush();
    assert.ok(box.textContent.includes('이 버전(또는 더 최신 버전)이 이미 설치되어 있습니다.'));
    assert.equal([...box.querySelectorAll('input[type="checkbox"]')].at(-1).disabled, true);
    assert.equal(byText(box, '설치').disabled, true);
    h.cleanup();
});

// ── Store ──

const OFFICIAL = 'https://raw.githubusercontent.com/kota-zo/myspoti-extensions/main/index.json', MINE = 'https://example.test/index.json', TOPIC = 'github:topic/myspoti-extension';
const storeEntry = (extra = {}) => ({ index: OFFICIAL, id: 'o.one', name: 'Official One', version: '1.0.0', versionCode: 1, apiVersion: 1, needsApi: false,
    author: 'Author O', description: 'Lyrics from somewhere', repo: null, owner: null, repoPage: null, homepage: null, icon: null, updatedAt: '2026-10-23', category: 'lyrics',
    tags: [], changelog: '', minAppVersion: null, size: 0, sha256: 'ab'.repeat(32), action: 'install', installedVersion: null,
    asks: [ask('lyrics.provide', false, { why: 'Show lyrics' })], critical: false, rated: false, rating: null, hidden: null, clash: null, ...extra });
const storeAnswer = () => ({
    repos: [
        { url: OFFICIAL, name: 'Myspoti', official: true, loaded: true, error: null, extensions: [storeEntry()] },
        { url: MINE, name: 'Mine', official: false, loaded: true, error: null,
            extensions: [storeEntry({ index: MINE, id: 'x.flac', name: 'Source X', version: '1.1', versionCode: 2, action: 'update', installedVersion: '1.0', category: 'playback', description: '' })] },
    ],
    community: { index: TOPIC, loaded: true, error: 'GitLab: gitlab.com answered 503', hidden: 1, extensions: [
        storeEntry({ index: TOPIC, id: 'c.good', name: 'Community Good', author: 'Author C', repo: 'alice/good', owner: 'alice', repoPage: 'https://github.com/alice/good',
            homepage: 'https://github.com/alice/good', rated: true, rating: { up: 20, down: 0, votes: 20, stars: 4.8, issue: 3 }, category: 'playback', description: 'Hi-res audio',
            changelog: 'Faster', sha256: null, asks: [ask('network', false, { why: 'Reach its server', hosts: ['api.example'] }), ask('audio.source', true, { why: 'Play songs' })], critical: true }),
        storeEntry({ index: TOPIC, id: 'c.low', name: 'Community Low', repo: 'gitlab:bob/low', owner: 'bob', rated: true, rating: { up: 1, down: 15, votes: 16, stars: 1.9, issue: 5 },
            hidden: 'low-score', category: 'tools', action: 'incompatible', needsApi: false, minAppVersion: '9.0.0' }),
    ] },
});

test('the store view follows the runner: sections, search words and categories, hidden ones behind "Show all", one button per row', () => {
    const store = storeAnswer();
    const shown = Model.storeView(store);
    assert.deepEqual(shown.repos.map(r => r.rows.map(e => e.id)), [['o.one'], ['x.flac']]);
    assert.deepEqual(shown.community.rows.map(e => e.id), ['c.good'], 'the hidden one waits for Show all');
    assert.equal(shown.community.toggle, true); assert.equal(shown.empty, false); assert.equal(shown.noMatch, false);
    assert.deepEqual(shown.categories, ['lyrics', 'playback'], 'only the categories with something listed');
    assert.deepEqual(Model.storeView(store, { showAll: true }).community.rows.map(e => e.id), ['c.good', 'c.low'], 'in the runner\'s order');
    assert.deepEqual(Model.storeView(store, { showAll: true }).categories, ['lyrics', 'playback', 'tools']);
    assert.deepEqual(Model.storeView(store, { query: 'HI-RES audio' }).community.rows.map(e => e.id), ['c.good'], 'every word, any case');
    assert.deepEqual(Model.storeView(store, { query: 'hi-res lyrics' }).repos.flatMap(r => r.rows), []);
    assert.equal(Model.storeView(store, { query: 'nothing like this' }).noMatch, true);
    assert.deepEqual(Model.storeView(store, { category: 'lyrics' }).repos.map(r => r.rows.length), [1, 0]);
    assert.deepEqual(Model.storeView(store, { category: 'social' }).categories, ['lyrics', 'playback', 'social'], 'the chosen category stays offered');
    assert.equal(Model.storeView({}).empty, true); assert.equal(Model.storeView({}).community, null); assert.equal(Model.storeView({}).noMatch, false);
    assert.equal(Model.storeView({ repos: [], community: { extensions: [], hidden: 0 } }).community.toggle, false);

    assert.equal(Model.ratingLine('ko', store.community.extensions[0].rating), '★ 4.8 · 20표');
    assert.equal(Model.ratingLine('en', null), 'No votes yet'); assert.equal(Model.ratingLine('en', { votes: 0, stars: 3.8 }), 'No votes yet');
    assert.equal(Model.authorLine('ko', store.community.extensions[0]), '제작 Author C · 저장소 alice');
    assert.equal(Model.authorLine('en', storeEntry()), 'by Author O · not verified', 'an address\'s author is its own claim');
    assert.equal(Model.incompatibleLine('ko', store.community.extensions[1]), 'Myspoti 9.0.0 이상 필요');
    assert.equal(Model.incompatibleLine('en', storeEntry({ needsApi: true, apiVersion: 3 })), 'Made for a newer Myspoti (extension API 3)');
    assert.deepEqual(['install', 'update', 'installed', 'incompatible'].map(action => Model.storeButton('ko', storeEntry({ action }))),
        [{ action: 'install', label: '설치', enabled: true }, { action: 'update', label: '업데이트', enabled: true },
            { action: 'installed', label: '설치됨', enabled: true }, { action: 'incompatible', label: '설치', enabled: false }]);
    assert.equal(Model.downloadsRepo(store.community.extensions[0]), 'alice/good');
    assert.equal(Model.downloadsRepo(store.community.extensions[1]), null, 'download counts exist on GitHub only');
    assert.equal(Model.updateCount([extension({ id: 'y.src', pendingUpdate: { version: '2' } })], store), 2);
    assert.equal(Model.httpsOnly('http://x.example/a.png'), null); assert.equal(Model.httpsOnly('https://x.example/a.png'), 'https://x.example/a.png');
});

test('the Store tab lists what Myspoti lists, adds and removes repositories, refreshes, opens a page and installs through the same prompt', dom, async () => {
    const h = harness({ routes: (route, body) => {
        if (route === '/ext/extensions') return [200, { extensions: [] }];
        if (route === '/ext/order') return [200, { order: ['spotify'], asked: ['spotify'], session: null }];
        if (route === '/ext/store' || route === '/ext/store?force=1') return [200, storeAnswer()];
        if (route === '/ext/store/repos') return [200, { repositories: body.add ? [MINE, body.add] : [] }];
        if (route === '/ext/store/downloads?repo=alice/good') return [200, { repo: 'alice/good', downloads: 42 }];
        if (route === '/ext/store/install') return [200, preview({ pending: 'store-1', source: 'https://github.com/alice/good',
            manifest: { id: 'c.good', name: 'Community Good', version: '1.0.0', versionCode: 1, author: 'Author C', description: '', changelog: '', icon: null },
            asks: [ask('network', false), ask('audio.source', true)] })];
        if (route === '/ext/install/confirm') return [200, { extension: extension({ id: 'c.good', name: 'Community Good' }) }];
    } });
    await flush();
    await h.player.openManager();
    const box = h.modals.at(-1).content;
    const rows = () => [...box.querySelectorAll('.hl-ext-store-row')].map(node => node.dataset.id);
    assert.equal(exact(box, '스토어').getAttribute('aria-pressed'), 'true', 'nothing installed: the Store first');
    assert.ok(exact(box, '설치됨(1)'), 'the update in a repository is counted on the Installed tab');
    const sections = [...box.querySelectorAll('.hl-ext-store-section')];
    assert.equal(sections.length, 3);
    assert.ok(sections[0].textContent.includes('Myspoti') && sections[0].textContent.includes('공식') && sections[0].textContent.includes('Myspoti가 목록에 올리기 전에'));
    assert.ok(sections[1].textContent.includes('Mine') && sections[1].textContent.includes('직접 추가함') && sections[1].textContent.includes(MINE));
    assert.ok(sections[2].textContent.includes('GitHub, GitLab, Codeberg에서') && sections[2].textContent.includes('커뮤니티'));
    assert.ok(sections[2].textContent.includes('검색하지 못했습니다: GitLab: gitlab.com answered 503'), 'a host that failed is said, the others still listed');
    assert.deepEqual(rows(), ['o.one', 'x.flac', 'c.good']);
    const good = box.querySelector('[data-id="c.good"]'), flac = box.querySelector('[data-id="x.flac"]');
    assert.ok(good.textContent.includes('Community Good') && good.textContent.includes('v1.0.0') && good.textContent.includes('★ 4.8 · 20표 · 2026-10-23'));
    assert.ok(flac.textContent.includes('업데이트') && exact(flac, '업데이트'), 'an update: its badge and its button');
    assert.ok(flac.textContent.includes('제작 Author O · 인증되지 않음'), 'no description: the author line');
    assert.ok(!box.querySelector('[data-id="o.one"]').textContent.includes('표'), 'an address entry has no rating line');

    click(h.window, byText(box, '모두 보기(1개 숨겨짐)'));
    await flush();
    assert.deepEqual(rows(), ['o.one', 'x.flac', 'c.good', 'c.low']);
    const low = box.querySelector('[data-id="c.low"]');
    assert.ok(low.querySelector('.hl-ext-warn.hl-ext-small'), 'the hidden one\'s rating is marked');
    assert.ok(low.textContent.includes('Myspoti 9.0.0 이상 필요') && exact(low, '설치').disabled);
    click(h.window, byText(box, '차단, 신고, 낮은 평점, 방치된 확장 숨기기'));
    await flush();
    assert.deepEqual(rows(), ['o.one', 'x.flac', 'c.good']);

    const search = box.querySelector('input.hl-ext-search');
    search.value = 'hi-res'; search.dispatchEvent(new h.window.Event('input'));
    assert.deepEqual(rows(), ['c.good']);
    search.value = ''; search.dispatchEvent(new h.window.Event('input'));
    click(h.window, exact(box, '가사'));
    await flush();
    assert.deepEqual(rows(), ['o.one']);
    assert.equal(exact(box, '가사').getAttribute('aria-pressed'), 'true');
    click(h.window, exact(box, '가사'));
    await flush();
    assert.deepEqual(rows(), ['o.one', 'x.flac', 'c.good']);

    click(h.window, byText(box, '새로고침'));
    await flush();
    assert.ok(h.requests.some(r => r.route === '/ext/store?force=1'), 'Refresh reads past the caches');
    box.querySelector('input[type="url"]').value = 'https://new.example/index.json';
    click(h.window, exact(box, '저장소 추가'));
    await flush();
    assert.deepEqual(h.requests.filter(r => r.route === '/ext/store/repos').at(-1).body, { add: 'https://new.example/index.json' });
    click(h.window, exact(box.querySelectorAll('.hl-ext-store-section')[1], '제거'));
    await flush();
    assert.deepEqual(h.requests.filter(r => r.route === '/ext/store/repos').at(-1).body, { remove: MINE });
    assert.ok(!exact(box.querySelectorAll('.hl-ext-store-section')[0], '제거'), 'the official repository cannot be removed');

    click(h.window, box.querySelector('[data-id="c.good"]'));
    await flush();
    const text = box.textContent;
    assert.ok(text.includes('Community Good') && text.includes('제작 Author C · 저장소 alice') && text.includes('Hi-res audio') && text.includes('변경 사항') && text.includes('Faster'));
    assert.ok(text.includes('★ 4.8 · 20표 · 다운로드 42회'), 'its downloads are read for its page');
    assert.ok(h.requests.some(r => r.route === '/ext/store/downloads?repo=alice/good'));
    const actions = [...box.querySelectorAll('.hl-ext-action')];
    assert.deepEqual(actions.map(node => node.dataset.critical), ['true', 'false'], 'critical first');
    assert.ok(actions[0].textContent.includes('다른 곳의 오디오로 재생 · 고위험') && actions[1].textContent.includes('웹사이트: api.example'));
    assert.ok(text.includes('고위험 작업은'), 'the critical warning');
    assert.equal(box.querySelector('a.hl-ext-link[href="https://github.com/alice/good"]').target, '_blank');
    click(h.window, byText(box, '← 스토어로 돌아가기'));
    await flush();
    assert.deepEqual(rows(), ['o.one', 'x.flac', 'c.good']);

    click(h.window, box.querySelector('[data-id="c.good"]'));
    await flush();
    click(h.window, exact(box, '설치'));
    await flush();
    assert.deepEqual(h.requests.find(r => r.route === '/ext/store/install').body, { index: TOPIC, id: 'c.good' });
    assert.ok(box.textContent.includes('Community Good을(를) 설치할까요?') && box.textContent.includes('출처: https://github.com/alice/good'), 'the same prompt as an install by address');
    const tick = [...box.querySelectorAll('input[type="checkbox"]')].at(-1); tick.checked = true; tick.dispatchEvent(new h.window.Event('change'));
    click(h.window, exact(box, '설치'));
    await flush();
    assert.deepEqual(h.requests.find(r => r.route === '/ext/install/confirm').body, { pending: 'store-1', granted: ['network', 'audio.source'] });
    assert.ok(box.textContent.includes('Community Good을(를) 설치했습니다'));
    h.cleanup();
});

test('a store install the runner refuses says why and stays on the store', dom, async () => {
    const h = harness({ routes: route => {
        if (route === '/ext/extensions') return [200, { extensions: [] }];
        if (route === '/ext/order') return [200, { order: ['spotify'], asked: ['spotify'], session: null }];
        if (route === '/ext/store') return [200, storeAnswer()];
        if (route === '/ext/store/install') return [400, { error: 'refused', detail: 'the package is not the one the repository lists (sha256 differs)' }];
    } });
    await flush();
    await h.player.openManager();
    const box = h.modals.at(-1).content;
    click(h.window, exact(box.querySelector('[data-id="o.one"]'), '설치'));
    await flush();
    assert.ok(box.textContent.includes('설치하지 못했습니다: the package is not the one the repository lists (sha256 differs)'));
    assert.ok(box.querySelector('[data-id="o.one"]'), 'no prompt: the list stays');
    assert.ok(!h.requests.some(r => r.route === '/ext/install/confirm'));
    h.cleanup();
});
