/** @file test_extension.cjs
 * @author: ForUltraplayer
 * @brief Verify legacy-label filtering through the actual ivLyrics cache boundary.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadExtension(record, response) {
    let saved = record;
    const values = new Map();
    const notices = [];
    const cache = { async getTranslation() { assert.equal(this, cache); return saved; },
        async setTranslation(track, lang, phonetic, data) { assert.equal(this, cache); saved = data; return true; } };
    const api = { LocalStorage: { get: key => values.get(key), set: (key, value) => values.set(key, value) },
        Player: { data: { item: { uri: 'spotify:track:test' } } }, showNotification: value => notices.push(value) };
    const window = { Spicetify: api, LyricsService: { cache, getTranslationCacheId: uri => uri?.replace(/^spotify:track:/, '') }, AIAddonManager: { register() {} } };
    const context = { window, Spicetify: api, setTimeout: (fn, ms) => ms <= 1000 ? setTimeout(fn, 0) : 0, clearTimeout, AbortController,
        fetch: async (url, options) => {
            context.lastRequest = JSON.parse(options.body);
            context.requestCount = (context.requestCount || 0) + 1;
            if (typeof response === 'function') return response(context.lastRequest, context.requestCount);
            return { ok: true, json: async () => response };
        } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'hangul-lyrics.js'), 'utf8'), context);
    Object.defineProperty(cache, 'harness', { value: { context, values, notices, getSaved: () => saved } });
    return cache;
}

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
    return provider;
}
const coverInfo = { uri: 'spotify:track:cover', title: 'Cover', artist: 'Singer', duration: 216566 };
test('an Android mirror rescues original lyrics absent on the desktop mirrors', async () => {
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async (url, options) => {
        assert.ok(url.includes('binimum.org?isrc='));
        assert.equal(options.credentials, 'omit');
        return { ok: true, json: async () => ({ parsed: { synced: [{ text: 'fixture', startTime: 1234 }] } }) };
    });
    const result = await provider.getLyrics(coverInfo);
    assert.equal(result.synced[0].startTime, 1234);
    assert.equal(result.provider, 'lyricsplus');
    assert.equal(result.cacheVersion, provider.cacheVersion);
    assert.equal(result.isrc, 'JPX302467020');
});
test('a failed recording-code lookup retries exact title and artist metadata', async () => {
    const urls = [];
    const provider = await mirrorHarness(async () => ({ error: 'No lyrics' }), async url => {
        urls.push(url);
        return urls.length === 1 ? { ok: false } : { ok: true, json: async () => ({ parsed: { synced: [{ text: 'fixture' }] } }) };
    });
    assert.equal((await provider.getLyrics(coverInfo)).synced.length, 1);
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes('prjktla.my.id?title=Cover&artist=Singer'));
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
