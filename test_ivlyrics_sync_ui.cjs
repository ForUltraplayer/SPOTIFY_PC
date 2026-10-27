/** @file test_ivlyrics_sync_ui.cjs
 * @author: ForUltraplayer
 * @brief Exercise the actual React sync editor controls with bounded recording-specific storage.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('./ivlyrics-sync.js');
const ui = require('./ivlyrics-sync-ui.js');
let React, renderer;
try {
    const modules = process.env.IVLYRICS_REACT_MODULES || path.join(__dirname, 'tests/ui/node_modules');
    React = require(require.resolve('react', { paths: [modules] }));
    renderer = require(require.resolve('react-test-renderer', { paths: [modules] }));
} catch {}
if ((!React || !renderer) && process.env.IVLYRICS_REQUIRE_UI_TESTS === '1') {
    throw new Error('Required React UI tests cannot run. Install locked fixtures with npm ci --ignore-scripts --prefix tests/ui.');
}
const options = { skip: !React || !renderer ? 'React test dependencies are not installed; set IVLYRICS_REACT_MODULES.' : false };
global.IS_REACT_ACT_ENVIRONMENT = true;
const URI = 'youtube:video:UWa_OiXDiQA', OTHER = 'youtube:video:rKQptWhAvO0';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ initial = 0, persist, read } = {}) {
    const listeners = new Map(), calls = [], values = new Map([[URI, initial]]);
    let uri = URI, position = 13000;
    const host = {
        SpotifyHangulSync: core,
        SpotifyHangulLinks: { playbackState: () => ({ active: true }), currentTrack: () => ({ uri, name: '원래 커버 제목', metadata: { artist_name: '커버 가수' } }) },
        lyricContainer: { currentTrackUri: URI, state: { currentLyrics: [{ startTime: 18240, text: '<실제 첫 문장>' }, { startTime: 30000, text: '두 번째 문장' }] } },
        CONFIG: { visual: { delay: 40 } },
        Utils: {
            getSafePlayerProgress: () => position, getGlobalSyncOffset: () => 200,
            getTrackSyncOffset: read || (async key => values.get(key) || 0),
            setTrackSyncOffset: async (key, value) => { calls.push([key, value]); if (persist) { const success = await persist(key, value); if (!success) return false; } values.set(key, value); host.dispatchEvent({ type: 'ivLyrics:offset-changed', detail: { trackUri: key, offset: value } }); return true; },
        },
        addEventListener(type, fn) { const set = listeners.get(type) || new Set(); set.add(fn); listeners.set(type, set); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    };
    host.SpotifyHangulSyncController = core.create(host);
    return { host, calls, values, listeners, setPosition(value) { position = value; }, changeTrack(value = OTHER) { uri = value; host.lyricContainer.currentTrackUri = value; } };
}
async function mount(f) {
    const Entry = ui.create(React, f.host); let root;
    await renderer.act(async () => { root = renderer.create(React.createElement(Entry, { trackUri: URI })); });
    const button = label => root.root.findAllByType('button').find(n => n.children.join('') === label);
    const change = (label, value) => renderer.act(async () => root.root.find(n => n.props['aria-label'] === label).props.onChange({ target: { value } }));
    const click = label => renderer.act(async () => { const b = button(label); assert.ok(b, label); if (!b.props.disabled) await b.props.onClick(); });
    await click('쉽게 싱크 맞추기');
    return { root, Entry, button, change, click, output: () => root.root.findByType('output').children.join(''), dispose: () => renderer.act(async () => root.unmount()) };
}
test('the editor exposes original title, human directions and timed lyric text as React text', options, async () => {
    const f = fixture(), app = await mount(f);
    assert.equal(app.root.root.find(n => n.props.role === 'dialog').props['aria-label'], '쉽게 싱크 맞추기');
    assert.ok(app.root.root.findAllByType('p').some(n => n.children.includes('원래 커버 제목')));
    assert.ok(app.root.root.findAllByType('option').some(n => n.children.includes('<실제 첫 문장>')));
    assert.equal(app.output(), '보정 없음');
    for (const label of ['가사를 1 초 먼저', '가사를 0.1 초 먼저', '가사를 0.1 초 나중에', '가사를 1 초 나중에']) assert.ok(app.button(label));
    assert.equal(app.button('지금 이 문장 시작').props.disabled, true);
    await app.dispose();
});
test('line alignment samples the click instant and shifts lyrics without modifying playback or metadata', options, async () => {
    const f = fixture(), app = await mount(f);
    await app.change('맞출 가사 문장', '0');
    f.setPosition(12700);
    await app.click('지금 이 문장 시작');
    assert.deepEqual(f.calls, [[URI, 5300]]);
    assert.equal(app.output(), '가사를 5.3 초 먼저 표시');
    assert.equal(f.host.SpotifyHangulLinks.currentTrack().name, '원래 커버 제목');
    assert.equal(f.host.Utils.getSafePlayerProgress(), 12700);
    await app.dispose();
});
test('seconds and direction allow large offsets, undo and reset through the same recording key', options, async () => {
    const f = fixture({ initial: 5300 }), app = await mount(f);
    await app.click('가사를 1 초 먼저');
    assert.equal(f.values.get(URI), 6300);
    await app.click('직전 보정 취소');
    assert.equal(f.values.get(URI), 5300);
    assert.equal(app.button('직전 보정 취소').props.disabled, true);
    await app.change('보정할 초', '53'); await app.change('가사 표시 방향', 'delay');
    await app.click('입력한 시간 적용');
    assert.equal(f.values.get(URI), -53000);
    assert.equal(app.output(), '가사를 53 초 나중에 표시');
    await app.click('원래대로'); assert.equal(f.values.get(URI), 0);
    await app.click('직전 보정 취소'); assert.equal(f.values.get(URI), -53000);
    await app.dispose();
});
test('invalid input and stale owner cannot write an offset for a replacement song', options, async () => {
    const f = fixture(), app = await mount(f);
    await app.change('보정할 초', '61'); await app.click('입력한 시간 적용');
    assert.equal(f.calls.length, 0);
    assert.ok(app.root.root.findAll(n => n.props.role === 'alert').some(n => n.children.join('').includes('0~60')));
    f.changeTrack();
    await renderer.act(async () => app.root.update(React.createElement(app.Entry, { trackUri: OTHER })));
    assert.equal(app.button('가사를 1 초 먼저').props.disabled, true);
    await app.click('가사를 1 초 먼저'); assert.equal(f.calls.length, 0);
    await app.dispose();
});
test('a pending write blocks duplicate taps and failure preserves offset and undo state', options, async () => {
    const waiting = deferred(), f = fixture({ initial: 500, persist: () => waiting.promise }), app = await mount(f);
    await app.click('가사를 1 초 먼저');
    assert.equal(app.button('가사를 1 초 먼저').props.disabled, true);
    await app.click('가사를 1 초 먼저');
    assert.equal(f.calls.length, 1);
    await renderer.act(async () => waiting.resolve(false));
    assert.equal(app.output(), '가사를 0.5 초 먼저 표시');
    assert.equal(app.button('직전 보정 취소').props.disabled, true);
    assert.ok(app.root.root.findAll(n => n.props.role === 'alert').some(n => n.children.join('').includes('저장하지 못')));
    await app.dispose();
});
test('changed lyric contents require a fresh selection and closed editors dispose listeners', options, async () => {
    const f = fixture(), app = await mount(f);
    await app.change('맞출 가사 문장', '0');
    f.host.lyricContainer.state.currentLyrics[0] = { startTime: 23440, text: '다른 시간표의 문장' };
    await app.click('지금 이 문장 시작'); assert.equal(f.calls.length, 0);
    await app.click('문장 목록 새로 불러오기');
    assert.equal(app.button('지금 이 문장 시작').props.disabled, true);
    await app.dispose();
    assert.equal([...f.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});
