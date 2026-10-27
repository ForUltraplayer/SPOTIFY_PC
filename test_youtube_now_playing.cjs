/** @file test_youtube_now_playing.cjs
 * @author: ForUltraplayer
 * @brief Exercise the actual now-playing DOM component and preserve the embedded player's ownership.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
let parseHTML;
try {
    ({ parseHTML } = require(require.resolve('linkedom', { paths: [path.join(__dirname, 'tests/ui/node_modules')] })));
} catch {}
if (!parseHTML && process.env.IVLYRICS_REQUIRE_UI_TESTS === '1') {
    throw new Error('Required DOM UI tests cannot run. Install locked fixtures with npm ci --ignore-scripts --prefix tests/ui.');
}
const options = { skip: !parseHTML ? 'Locked DOM test fixtures are not installed.' : false };
const component = () => require('./youtube-now-playing.js');
const track = { videoId: 'UWa_OiXDiQA', title: '유령도쿄(Ayase) / 아오쿠모 린 Cover', artist: '아오쿠모 린 AOKUMO RIN' };
const model = overrides => ({ track: { ...track }, state: { quality: 'hd720', codec: 'opus', bitrate: 136 },
    preferredMode: 'video', mediaMode: 'youtube', playing: false, loading: false, error: '', ...overrides });

function fixture({ reducedMotion = false } = {}) {
    const { window } = parseHTML('<!doctype html><html><body></body></html>');
    const animations = [], calls = [];
    window.matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} });
    window.HTMLElement.prototype.animate = function (frames, settings) {
        const animation = { node: this, frames, settings, cancel() { animation.cancelled = true; }, finished: Promise.resolve() };
        animations.push(animation); return animation;
    };
    const handlers = Object.fromEntries(['Mode', 'Lyrics', 'Search', 'Retry', 'Original', 'Queue', 'Close'].map(name =>
        ['on' + name, (...args) => calls.push([name.toLowerCase(), ...args])]));
    const view = component().create(window, handlers);
    window.document.body.append(view.element);
    const find = id => view.element.querySelector('[data-testid="' + id + '"]');
    return { window, view, find, animations, calls, cleanup() { view.dispose(); } };
}

test('real source metadata is rendered as text without using lyric search aliases', options, () => {
    const f = fixture();
    try {
        const value = model({ track: { ...track, title: '<img src=x onerror=alert(1)> 원래 영상', artist: '<script>artist</script>',
            lyricTitle: 'Ghost City Tokyo', lyricArtist: 'Ayase' } });
        const before = JSON.stringify(value);
        f.view.update(value);
        assert.equal(f.find('hangul-now-title').textContent, value.track.title);
        assert.equal(f.find('hangul-now-artist').textContent, value.track.artist);
        assert.equal(f.find('hangul-now-title').querySelector('img'), null);
        assert.equal(f.find('hangul-now-artist').querySelector('script'), null);
        assert.equal(JSON.stringify(value), before);
    } finally { f.cleanup(); }
});

test('updating track, mode and progress never replaces or moves an existing iframe', options, () => {
    const f = fixture();
    try {
        const anchor = f.view.mediaAnchor, frame = f.window.document.createElement('iframe');
        frame.src = 'http://127.0.0.1:19643/youtube/player#session=fixture';
        anchor.append(frame);
        for (const value of [model(), model({ preferredMode: 'audio', mediaMode: 'direct' }),
            model({ loading: true }), model({ track: { ...track, videoId: 'rKQptWhAvO0' }, playing: true }), model({ error: '조회 실패' })]) {
            f.view.update(value);
            assert.equal(f.view.mediaAnchor, anchor);
            assert.equal(frame.parentElement, anchor);
            assert.equal(anchor.querySelector('iframe'), frame);
            assert.equal(frame.getAttribute('src'), 'http://127.0.0.1:19643/youtube/player#session=fixture');
        }
    } finally { f.cleanup(); }
});

test('source mode actions fire once and reflect selected state accessibly', options, () => {
    const f = fixture();
    try {
        f.view.update(model());
        assert.equal(f.find('hangul-mode-video').getAttribute('aria-pressed'), 'true');
        assert.equal(f.find('hangul-mode-audio').getAttribute('aria-pressed'), 'false');
        f.find('hangul-mode-audio').click();
        assert.deepEqual(f.calls, [['mode', 'audio']]);
        f.view.update(model({ preferredMode: 'audio', mediaMode: 'direct' }));
        assert.equal(f.find('hangul-mode-audio').getAttribute('aria-pressed'), 'true');
        assert.equal(f.find('hangul-mode-video').getAttribute('aria-pressed'), 'false');
        f.find('hangul-mode-video').click();
        assert.deepEqual(f.calls, [['mode', 'audio'], ['mode', 'video']]);
    } finally { f.cleanup(); }
});

test('existing lyric, search, queue and close actions stay connected without reattaching listeners', options, () => {
    const f = fixture();
    try {
        f.view.update(model());
        for (let index = 0; index < 20; index++) f.view.update(model({ playing: index % 2 === 0 }));
        for (const id of ['hangul-lyrics-action', 'hangul-search-action', 'hangul-queue-action', 'hangul-close-action']) f.find(id).click();
        assert.deepEqual(f.calls, [['lyrics'], ['search'], ['queue'], ['close']]);
    } finally { f.cleanup(); }
});

test('loading and errors expose status and retry without replacing the media surface', options, () => {
    const f = fixture();
    try {
        f.view.update(model({ preferredMode: 'audio', mediaMode: 'direct', loading: true }));
        assert.equal(f.view.element.dataset.loading, 'true');
        assert.ok(f.view.element.querySelector('[role="status"], [aria-live]'));
        f.view.update(model({ preferredMode: 'audio', mediaMode: 'direct', error: '공개 음원을 찾지 못했습니다.' }));
        const alert = f.view.element.querySelector('[role="alert"]');
        assert.ok(alert);
        assert.ok(alert.textContent.includes('공개 음원을 찾지 못했습니다.'));
        const retry = f.find('hangul-retry-action');
        assert.ok(retry && !retry.disabled);
        retry.click();
        assert.deepEqual(f.calls, [['retry']]);
    } finally { f.cleanup(); }
});

test('tick updates do not replay the track entrance animation', options, () => {
    const f = fixture();
    try {
        f.view.update(model());
        const initial = f.animations.length;
        for (let index = 0; index < 30; index++) f.view.update(model({ state: { seconds: index / 2, quality: 'hd720' }, playing: true }));
        assert.equal(f.animations.length, initial);
        f.view.update(model({ track: { ...track, videoId: 'rKQptWhAvO0' } }));
        assert.ok(f.animations.length > initial);
    } finally { f.cleanup(); }
});

test('clock ticks preserve selectable title and artist text nodes', options, () => {
    const f = fixture();
    try {
        f.view.update(model());
        const titleText = f.find('hangul-now-title').firstChild;
        const artistText = f.find('hangul-now-artist').firstChild;
        for (let index = 0; index < 20; index++) f.view.update(model({ state: { seconds: index, quality: 'hd720' }, playing: true }));
        assert.equal(f.find('hangul-now-title').firstChild, titleText);
        assert.equal(f.find('hangul-now-artist').firstChild, artistText);
    } finally { f.cleanup(); }
});

test('missing track and busy retry controls cannot advertise available actions', options, () => {
    const f = fixture();
    try {
        f.view.update(model({ track: { videoId: '../../external', title: '외부 주소' } }));
        assert.equal(f.find('hangul-lyrics-action').disabled, true);
        assert.equal(f.find('hangul-search-action').disabled, true);
        assert.equal(f.find('hangul-original-action').hidden, true);
        assert.equal(f.find('hangul-original-action').getAttribute('href'), null);
        f.view.update(model({ loading: true, error: '연결을 확인해 주세요' }));
        assert.equal(f.find('hangul-retry-action').disabled, true);
    } finally { f.cleanup(); }
});

test('reduced motion suppresses entrance animation while metadata still updates', options, () => {
    const f = fixture({ reducedMotion: true });
    try {
        f.view.update(model());
        f.view.update(model({ track: { ...track, videoId: 'rKQptWhAvO0', title: '새 곡' } }));
        assert.equal(f.find('hangul-now-title').textContent, '새 곡');
        assert.equal(f.animations.length, 0);
    } finally { f.cleanup(); }
});

test('the component keeps the YouTube player area separate from action and notice layers', options, () => {
    const f = fixture();
    try {
        f.view.update(model());
        assert.equal(f.view.mediaAnchor.querySelector('button'), null);
        assert.equal(f.view.mediaAnchor.querySelector('[role="alert"]'), null);
        for (const id of ['hangul-mode-audio', 'hangul-mode-video', 'hangul-lyrics-action']) assert.equal(f.view.mediaAnchor.contains(f.find(id)), false);
        const style = fs.readFileSync(path.join(__dirname, 'youtube-now-playing.css'), 'utf8');
        assert.match(style, /prefers-reduced-motion/);
    } finally { f.cleanup(); }
});

test('dispose clears interaction and animation without taking ownership of the caller iframe', options, () => {
    const f = fixture();
    f.view.update(model());
    const frame = f.window.document.createElement('iframe');
    f.view.mediaAnchor.append(frame);
    const title = f.find('hangul-now-title').textContent;
    f.cleanup();
    f.find('hangul-lyrics-action').click();
    f.find('hangul-mode-audio').click();
    assert.deepEqual(f.calls, []);
    assert.equal(f.animations.at(-1).cancelled, true);
    assert.equal(frame.parentElement, f.view.mediaAnchor);
    f.view.update(model({ track: { ...track, title: '해제 뒤 갱신' } }));
    assert.equal(f.find('hangul-now-title').textContent, title);
});
