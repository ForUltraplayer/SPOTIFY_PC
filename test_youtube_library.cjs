/** @file test_youtube_library.cjs
 * @brief Verify mixed playlist portability, import isolation and fixed-origin export behavior.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('./youtube-library.js');
// Node reports this machine's language: the messages are English unless a test sets a Korean Spotify.
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });
const native = { kind: 'spotify', uri: 'spotify:track:6x7SB38tuekpu4xpH9OIPY', title: '地球儀', artist: 'Kenshi Yonezu',
    duration: 273, entryKey: 'recording-one', album: 'Album', image: 'spotify:image:ab67616d00004851ff04f64ce0d75dc523c8bbf7' };
const youtube = { kind: 'youtube', videoId: 'rKQptWhAvO0', title: 'Cover', artist: 'Singer', duration: 194,
    after: 'recording-one', lyricTitle: '東京テディベア', lyricArtist: 'Neru' };
const example = () => ({ name: '개인 혼합 목록', sourceUri: 'spotify:playlist:5C3W78fpJbRdLpbr7kvAMe',
    nativeTracks: [{ ...native }, { ...native, entryKey: 'recording-two' }], tracks: [{ ...youtube }],
    order: ['sp:recording-two', 'yt:rKQptWhAvO0', 'sp:recording-one'] });

test('one file contains duplicate-recording identities, YouTube references, order and search metadata', () => {
    const document = library.documentFor(example(), new Date('2026-10-27T00:00:00Z'));
    const restored = library.parse(JSON.stringify(document));
    assert.deepEqual(restored, example());
    assert.equal(document.exportedAt, '2026-10-27T00:00:00.000Z');
});
test('import constructs a separate local playlist instead of reusing exported identities', () => {
    const original = example(); const source = JSON.stringify(library.documentFor(original));
    const first = library.imported(source, 'new-one'), second = library.imported(source, 'new-two');
    assert.equal(first.local, true); assert.equal(first.id, 'new-one'); assert.equal(second.id, 'new-two');
    assert.equal(first.sourceUri, original.sourceUri); assert.notEqual(first.nativeTracks, original.nativeTracks);
    first.tracks[0].title = 'changed'; assert.equal(original.tracks[0].title, 'Cover'); assert.equal(second.tracks[0].title, 'Cover');
});
test('export allowlist strips runtime media URLs and arbitrary secrets from every boundary', () => {
    const source = example(); source.token = 'private'; source.nativeTracks[0].accessToken = 'private';
    source.tracks[0].streamUrl = 'https://secret.googlevideo.com/videoplayback?signature=private';
    const text = JSON.stringify(library.documentFor(source));
    assert.doesNotMatch(text, /private|googlevideo|streamUrl|accessToken/);
});
test('default order preserves front anchors, native occurrences and removed-anchor links', () => {
    const source = example(); delete source.order;
    source.tracks.push({ kind: 'youtube', videoId: 'abcdefghijk', after: '' }, { kind: 'youtube', videoId: '12345678901', after: 'removed' });
    assert.deepEqual(library.cleanPlaylist(source).order, ['yt:abcdefghijk', 'sp:recording-one', 'yt:rKQptWhAvO0', 'sp:recording-two', 'yt:12345678901']);
});
test('stale ordered entries disappear while newly present native and YouTube items stay available', () => {
    const source = example(); source.order = ['sp:deleted', 'sp:recording-two', 'sp:recording-two'];
    assert.deepEqual(library.cleanPlaylist(source).order, ['sp:recording-two', 'sp:recording-one', 'yt:rKQptWhAvO0']);
});
test('unsafe source, image and track addresses are rejected before import can perform actions', () => {
    for (const mutate of [
        source => { source.sourceUri = 'https://example.test/playlist'; },
        source => { source.nativeTracks[0].uri = 'javascript:alert(1)'; },
        source => { source.nativeTracks[0].image = 'https://i.scdn.co.evil.test/image/x'; },
        source => { source.nativeTracks[0].image = 'https://person:password@i.scdn.co/image/x'; },
        source => { source.nativeTracks[0].image = 'file:///C:/private.txt'; },
        source => { source.tracks[0].videoId = 'https://youtube.com/watch?v=rKQptWhAvO0'; },
    ]) { const source = example(); mutate(source); assert.throws(() => library.cleanPlaylist(source)); }
});
test('duplicate entry keys, repeated video IDs and malformed durations are rejected', () => {
    for (const mutate of [
        source => { source.nativeTracks[1].entryKey = source.nativeTracks[0].entryKey; },
        source => { source.tracks.push({ ...youtube }); },
        source => { source.tracks[0].duration = Infinity; },
        source => { source.nativeTracks[0].duration = -1; },
        source => { source.nativeTracks[0].duration = true; },
    ]) { const source = example(); mutate(source); assert.throws(() => library.cleanPlaylist(source)); }
});
test('schema, UTF-8 size and item counts are bounded and a UTF-8 BOM is accepted', () => {
    const source = JSON.stringify(library.documentFor(example()));
    assert.deepEqual(library.parse('\uFEFF' + source), example());
    for (const value of ['not json', '{}', JSON.stringify({ format: library.FORMAT, schema: 2, playlist: example() }), ' '.repeat(library.MAX_BYTES + 1)]) assert.throws(() => library.parse(value));
    const many = example(); many.tracks = Array.from({ length: 2001 }, () => ({ ...youtube })); assert.throws(() => library.cleanPlaylist(many));
});
test('UTF-8 byte cap also bounds arrays whose individual fields satisfy their limits', () => {
    const source = example(); source.nativeTracks = Array.from({ length: 2000 }, (_, i) => ({ ...native,
        entryKey: String(i), title: '日'.repeat(300), artist: '歌'.repeat(200), album: '曲'.repeat(300) }));
    assert.throws(() => library.documentFor(source), /3 MB/);
});
test('import reads a file without network requests and gives the caller a fresh local snapshot', async () => {
    const source = JSON.stringify(library.documentFor(example())); let received;
    const host = { crypto: { randomUUID: () => 'fresh-id' }, fetch: () => assert.fail('Import must stay local'), Spicetify: {} };
    const tools = library.create(host, { onImport: async value => { received = value; } });
    await tools.importFile({ size: Buffer.byteLength(source), text: async () => source });
    assert.equal(received.id, 'fresh-id'); assert.equal(received.local, true); assert.equal(received.nativeTracks.length, 2);
});
test('export posts an allowlisted document only to the existing loopback helper', async () => {
    let request;
    const host = { setTimeout, clearTimeout, fetch: async (url, options) => {
        request = { url, options }; return { ok: true, json: async () => ({ path: 'C:\\app\\exports\\test.json', filename: 'test.json' }) };
    }, Spicetify: {} };
    const tools = library.create(host, { getCurrent: async () => example() });
    const result = await tools.exportCurrent();
    assert.equal(request.url, 'http://127.0.0.1:19643/youtube/export');
    assert.equal(request.options.headers['X-Hangul-Lyrics-Client'], 'ivlyrics');
    assert.equal(JSON.parse(request.options.body).format, library.FORMAT); assert.equal(result.filename, 'test.json');
    tools.dispose();
});
test('disposed tools and an oversized input never invoke import callbacks', async () => {
    let imports = 0; const tools = library.create({ crypto: { randomUUID: () => 'new' }, Spicetify: {} }, { onImport: () => imports++ });
    await assert.rejects(tools.importFile({ size: library.MAX_BYTES + 1, text: async () => assert.fail('Too large') }));
    tools.dispose(); await assert.rejects(tools.importFile({ size: 1, text: async () => '{}' }), { name: 'AbortError' });
    assert.equal(imports, 0);
});
// What LocalPlaylists.export() of the Android app writes: phone files and YouTube links of one phone list.
const phoneFile = (items, extra = {}) => JSON.stringify({ format: 'myspoti-hangul-local-playlist', version: 1, name: '휴대폰 목록', items, ...extra }, null, 2);
const phoneLink = (id, title = 'Cover', artist = 'Singer', duration = 194500) => ({ key: 'k-' + id, uri: 'myspoti-yt://video/' + id,
    title, artist, album: 'YouTube', duration, art: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' });
const phoneOnly = { key: 'k-file', uri: 'content://media/external/audio/media/42', title: 'Recording', artist: 'Me', album: 'Voice', duration: 1000, art: 'content://media/external/audio/albumart/1' };

test('an Android phone list brings its YouTube links in order and leaves out phone files and repeated videos', async () => {
    const source = phoneFile([phoneLink('rKQptWhAvO0', '東京テディベア', 'Neru'), phoneOnly, phoneLink('abcdefghijk', '', '', 0), phoneLink('rKQptWhAvO0'), 7, { uri: 'javascript:alert(1)' }]);
    assert.deepEqual(library.parse(source), { name: '휴대폰 목록', nativeTracks: [], order: ['yt:rKQptWhAvO0', 'yt:abcdefghijk'], tracks: [
        { kind: 'youtube', videoId: 'rKQptWhAvO0', title: '東京テディベア', artist: 'Neru', duration: 194.5 },
        { kind: 'youtube', videoId: 'abcdefghijk', title: 'abcdefghijk', artist: 'YouTube', duration: 0 }] });
    let received, notice;
    const host = { crypto: { randomUUID: () => 'phone-id' }, fetch: () => assert.fail('Import must stay local'), Spicetify: { showNotification: message => { notice = message; } } };
    const tools = library.create(host, { onImport: async value => { received = value; } });
    await tools.importFile({ size: Buffer.byteLength(source), text: async () => '﻿' + source });
    assert.equal(received.id, 'phone-id'); assert.equal(received.local, true); assert.equal('skipped' in received, false);
    assert.match(notice, /휴대폰 목록/); assert.match(notice, /4 items left out/);
    // The PC export of the imported list is the PC's own format again.
    assert.equal(library.documentFor(received).format, library.FORMAT);
});
test('an Android phone list without YouTube links or a name becomes an empty list with the default name', () => {
    assert.deepEqual(library.parse(phoneFile([phoneOnly], { name: '  ' })), { name: 'Imported mixed list', nativeTracks: [], tracks: [], order: [] });
    assert.deepEqual(library.parse(JSON.stringify({ format: 'myspoti-hangul-local-playlist', version: 1 })).tracks, []);
});
test('an Android phone list is checked against the same limits as the PC file', () => {
    for (const source of [
        phoneFile([phoneLink('rKQptWhAvO0')], { version: 2 }),
        phoneFile({ uri: 'myspoti-yt://video/rKQptWhAvO0' }),
        phoneFile(Array.from({ length: 2001 }, () => phoneOnly)),
        phoneFile([phoneLink('rKQptWhAvO0')], { name: '목'.repeat(101) }),
        phoneFile([phoneLink('rKQptWhAvO0')], { name: 5 }),
        phoneFile([phoneLink('rKQptWhAvO0', 'x'.repeat(301))]),
        phoneFile([phoneLink('rKQptWhAvO0', 'Cover', 'a\0b')]),
        phoneFile([phoneLink('rKQptWhAvO0', 'Cover', 'Singer', -1)]),
        phoneFile([phoneLink('rKQptWhAvO0', 'Cover', 'Singer', '194500')]),
        phoneFile([phoneLink('rKQptWhAvO0', { toString: () => 'x' })]),
        phoneFile([phoneOnly], { name: 'x'.repeat(library.MAX_BYTES) }),
    ]) assert.throws(() => library.parse(source), source.slice(0, 120));
    // A look-alike address is not a YouTube link: it is left out, never played.
    for (const uri of ['myspoti-yt://video/rKQptWhAvO0/x', 'myspoti-yt://video/rKQptWhAvO', 'https://youtube.com/watch?v=rKQptWhAvO0', 'MYSPOTI-YT://video/rKQptWhAvO0'])
        assert.deepEqual(library.parse(phoneFile([{ ...phoneLink('rKQptWhAvO0'), uri }])).tracks, [], uri);
});
test('a Korean Spotify gets the Korean default name, errors and import notice', async () => {
    const saved = globalThis.Spicetify; globalThis.Spicetify = { Locale: { getLocale: () => 'ko' } };
    try {
        assert.equal(library.parse(phoneFile([phoneOnly], { name: '' })).name, '가져온 혼합 목록');
        assert.throws(() => library.parse('not json'), { message: '올바른 JSON 목록 파일이 아닙니다.' });
    } finally { globalThis.Spicetify = saved; }
    const source = phoneFile([phoneLink('rKQptWhAvO0'), phoneOnly]); let notice;
    const host = { crypto: { randomUUID: () => 'ko-id' }, Spicetify: { Locale: { getLocale: () => 'ko' }, showNotification: message => { notice = message; } } };
    await library.create(host, { onImport: async () => {} }).importFile({ size: Buffer.byteLength(source), text: async () => source });
    assert.equal(notice, '새 로컬 목록으로 가져왔습니다: 휴대폰 목록 (휴대폰 파일과 중복 영상 등 1 개 항목 제외)');
});
