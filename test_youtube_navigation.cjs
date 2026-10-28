/** @file test_youtube_navigation.cjs
 * @brief Exercise actual link-player navigation handlers without reloading an active YouTube source.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'youtube-links.js'), 'utf8');

test('current-track presentation separates loading, failure and actual fallback engine without using lookup titles', () => {
    const models=[],item={kind:'youtube',videoId:'rKQptWhAvO0',title:'Actual cover',artist:'Cover artist',lyricTitle:'Lookup only'};
    const context=vm.createContext({queue:[item],queueIndex:0,lastError:'Loading',streamRequest:{},active:true,
        mediaMode:'direct',preferredMode:'audio',playing:false,playbackIntent:true,pendingAudioSeek:null,
        audio:{readyState:0},state:{seconds:83},nowPlaying:{update:value=>models.push(value)}});
    vm.runInContext(functionSource('renderStatus'),context);context.renderStatus();
    assert.equal(models.at(-1).loading,true);assert.equal(models.at(-1).error,'');
    assert.equal(models.at(-1).track.title,'Actual cover');
    context.streamRequest=null;context.lastError='Unavailable';context.renderStatus();
    assert.equal(models.at(-1).loading,false);assert.equal(models.at(-1).error,'Unavailable');
    context.lastError='';context.preferredMode='video';context.renderStatus();
    assert.equal(models.at(-1).fallback,true);assert.equal(models.at(-1).mediaMode,'direct');
});

test('video retry preserves the current recording, position and pause intent',()=>{
    const loads=[];const context=vm.createContext({queue:[{kind:'youtube',videoId:'rKQptWhAvO0'}],queueIndex:0,
        active:true,mediaMode:'youtube',preferredMode:'video',state:{seconds:83,ready:true},playbackIntent:false,lastError:'Error',
        audio:{},open(){},renderStatus(){},send:(command,args)=>loads.push({command,args})});
    vm.runInContext(functionSource('retryCurrentPlayback'),context);context.retryCurrentPlayback();
    assert.equal(loads.length,1);assert.equal(loads[0].command,'load');assert.equal(loads[0].args.videoId,'rKQptWhAvO0');
    assert.equal(loads[0].args.seconds,83);assert.equal(loads[0].args.autoplay,false);assert.equal(context.queueIndex,0);
});

test('a transient first-load failure retries once silently, then shows the error',async()=>{
    const item={kind:'youtube',videoId:'rKQptWhAvO0'};let retries=0,renders=0;
    const context=vm.createContext({queue:[item],queueIndex:0,active:true,state:{ready:true},lastError:'Error',
        autoRetried:null,autoRetryTimer:null,setTimeout:(fn)=>{context.pending=fn;return 1;},
        renderStatus(){renders++;},retryCurrentPlayback(){retries++;}});
    vm.runInContext(functionSource('autoRetryOnce'),context);
    assert.equal(context.autoRetryOnce(),true);assert.equal(context.lastError,'');assert.equal(context.state.ready,false);
    assert.equal(context.autoRetryOnce(),true,'a second failure while the retry is pending stays silent');
    context.pending();assert.equal(retries,1);
    assert.equal(context.autoRetryOnce(),false,'a failure after the retry surfaces the error');
    context.queue=[{kind:'youtube',videoId:'abcdefghijk'}];context.autoRetried=null;
    assert.equal(context.autoRetryOnce(),true,'a new track gets its own retry');
    context.active=false;context.autoRetried=null;assert.equal(context.autoRetryOnce(),false);
});

test('a dropped helper connection is retried twice, an abort or third failure is reported', async () => {
    let calls = 0;
    const context = vm.createContext({ BASE: 'http://127.0.0.1:19643', setTimeout: fn => fn(),
        fetch: async () => { calls++; if (calls < 3) throw new TypeError('Failed to fetch'); return { ok: true }; } });
    vm.runInContext('async ' + functionSource('postHelper'), context);
    assert.equal((await context.postHelper('/youtube/metadata', { video_id: 'abcdefghijk' })).ok, true);
    assert.equal(calls, 3);
    calls = -10; await assert.rejects(context.postHelper('/youtube/metadata', {}), /Failed to fetch/);
    context.fetch = async () => { const error = new Error('stop'); error.name = 'AbortError'; calls++; throw error; };
    calls = 0; await assert.rejects(context.postHelper('/x', {}), /stop/); assert.equal(calls, 1, 'an abort is not retried');
});

test('a player page that never reports ready is reopened at most twice per track', () => {
    let now = 1000; const item = { kind: 'youtube', videoId: 'MZNKiadMo3U' };
    const frame = { src: 'http://127.0.0.1:19643/youtube/player#session=s' };
    const context = vm.createContext({ BASE: 'http://127.0.0.1:19643', session: 's', frame, queue: [item], queueIndex: 0,
        active: true, mediaMode: 'youtube', state: { ready: false }, frameWaitStart: 0, frameReloads: 0, frameItem: null,
        Date: { now: () => now }, encodeURIComponent });
    vm.runInContext(functionSource('frameWatchdog'), context);
    const reloads = () => (frame.src.match(/\?r=/) ? frame.src : null);
    context.frameWatchdog(); now = 10000; context.frameWatchdog(); assert.equal(reloads(), null, 'waits 10 s first');
    now = 11001; context.frameWatchdog(); assert.match(frame.src, /\/youtube\/player\?r=11001#session=s$/);
    now = 21002; context.frameWatchdog(); now = 31003; context.frameWatchdog();
    assert.equal(context.frameReloads, 2); assert.match(frame.src, /\?r=21002#/, 'no third reload');
    context.state = { ready: true }; context.frameWatchdog(); assert.equal(context.frameWaitStart, 0);
    context.queue = [{ kind: 'youtube', videoId: 'abcdefghijk' }]; context.state = { ready: false }; context.frameWatchdog();
    assert.equal(context.frameReloads, 0, 'a new track gets its own reloads');
});

// The slider-to-YouTube volume tables and helpers are declarations, not single functions.
const volumeSource = source.split(/\r?\n/).filter(line => /const (SPOTIFY_DB|AUDIO_DB|VIDEO_DB)=|function lookup\(|function linkVolume\(|const spotifyVolume=|const audioVolume=/.test(line)).join(';');
function functionSource(name) {
    const start = source.indexOf('function ' + name + '(');
    if (start < 0) return null;
    const body = /\)\s*\{/.exec(source.slice(start));
    if (!body) throw Error('Could not find actual function body: ' + name);
    const open = start + body.index + body[0].length - 1;
    let depth = 0, quote = null, comment = null;
    for (let index = open; index < source.length; index++) {
        const current = source[index], next = source[index + 1];
        if (comment === 'line') { if (current === '\n') comment = null; continue; }
        if (comment === 'block') { if (current === '*' && next === '/') { comment = null; index++; } continue; }
        if (quote) { if (current === '\\') { index++; continue; } if (current === quote) quote = null; continue; }
        if (current === '/' && next === '/') { comment = 'line'; index++; continue; }
        if (current === '/' && next === '*') { comment = 'block'; index++; continue; }
        if (current === "'" || current === '"' || current === '`') { quote = current; continue; }
        if (current === '{') depth++;
        if (current === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    throw Error('Could not isolate actual function: ' + name);
}
function button(options = {}) {
    const classes = new Set(options.classes || []);
    const value = { dataset: { testid: options.id }, _tippy: options.tooltip ? { props: { content: options.tooltip } } : undefined, classList: { contains: name => classes.has(name) },
        matches(selector) {
            if (selector.includes('ivlyrics-playbar-control')) return classes.has('ivlyrics-playbar-control') && (!selector.includes(':not(.ivlyrics-fullscreen-btn)') || !classes.has('ivlyrics-fullscreen-btn'));
            if (selector === '.ivlyrics-fullscreen-btn') return classes.has('ivlyrics-fullscreen-btn');
            if (selector.includes('ivlyrics-fullscreen-btn')) return classes.has('ivlyrics-fullscreen-btn');
            return selector === '[data-encore-id="buttonPrimary"]' && options.primary;
        },
        closest(selector) {
            if (selector === 'button') return value;
            if (selector.includes('ivlyrics')) return value.matches(selector) ? value : null;
            if (selector === '[data-testid="now-playing-bar"]') return options.inBar ? {} : null;
            if (selector.includes('now-playing-widget')) return options.inWidget ? {} : null;
            if (selector.includes('action-bar-row')) return options.inHeader ? {} : null;
            return null;
        },
        getAttribute(name) { if (name === 'aria-label') return options.label || ''; return null; } };
    return value;
}
function clickHarness(overrides = {}) {
    const calls = [], history = { location: { pathname: '/ivLyrics' }, push(route) { calls.push(['navigate', route]); history.location.pathname = route; } },
        context = vm.createContext({
        active: true, kind: 'youtube', view: { uri: 'local:my-list', name: 'My list', mixed: [{}] },
        viewBypass: false, mixedGrid: { isConnected: true }, queueSource: 'local:my-list',
        playing: true, repeat: 'off', shuffle: false, state: {},
        open: () => calls.push('open'), toggle: () => calls.push('toggle'), startView: index => calls.push(['start', index]),
        ivLyrics: { open: () => calls.push('lyrics') }, window: {}, Spicetify: { Player: { togglePlay: () => calls.push('native-toggle') }, Platform: { History: history } },
        refreshView: () => { calls.push('refresh'); return Promise.resolve(); },
        notify: message => calls.push(['notify', message]), updateBar() {}, send: command => calls.push(['send', command]),
        advance: direction => calls.push(['advance', direction]), ...overrides,
    });
    // New shared header handlers are executed from the implementation when present.
    for (const name of ['togglePlaylistPlayback', 'toggleViewPlayback', 'showQueue', 'isIvLyricsMicrophone', 'openLyrics']) {
        const definition = functionSource(name); if (definition) vm.runInContext(definition, context);
    }
    vm.runInContext(functionSource('click'), context);
    return { calls, context, invoke(target) {
        const event = { target: { closest: selector => selector === 'button' ? target : null },
            prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        context.click(event); return event;
    } };
}
test('queue navigation opens the actual local source list without restarting playback', () => {
    const id = '017b20a4-ef0b-4c95-87f3-1f747e9a735e', harness = clickHarness({ queueSource: 'local:' + id });
    harness.context.state.seconds = 83;
    harness.invoke(button({ id: 'control-button-queue', inBar: true }));
    assert.deepEqual(harness.calls, [['navigate', '/spotify-hangul-links/' + id]]);
    assert.equal(harness.context.state.seconds, 83); assert.equal(harness.context.playing, true);
    harness.invoke(button({ id: 'control-button-queue', inBar: true }));
    assert.equal(harness.calls.length, 1, 'The same route must not be pushed twice');
});
test('mixed native Spotify playback also opens its source playlist through the queue button', () => {
    const id = '5C3W78fpJbRdLpbr7kvAMe', harness = clickHarness({ active: false, kind: 'spotify', queueSource: 'spotify:playlist:' + id });
    harness.invoke(button({ id: 'control-button-queue', inBar: true }));
    assert.deepEqual(harness.calls, [['navigate', '/playlist/' + id]]);
});
test('queue navigation without a bound source keeps the player view available', () => {
    const harness = clickHarness({ queueSource: null }); harness.invoke(button({ id: 'control-button-queue', inBar: true }));
    assert.deepEqual(harness.calls, ['open']);
});
test('queue navigation returns the same playlist from original editing to its mixed view', () => {
    const uri = 'spotify:playlist:5C3W78fpJbRdLpbr7kvAMe', harness = clickHarness({ queueSource: uri, viewBypass: true });
    harness.context.Spicetify.Platform.History.location.pathname = '/playlist/' + uri.split(':')[2];
    harness.invoke(button({ id: 'control-button-queue', inBar: true }));
    assert.deepEqual(harness.calls, ['refresh']); assert.equal(harness.context.viewBypass, false);
});
test('native playlist header toggles the current source instead of restarting it at index zero', () => {
    const harness = clickHarness(); harness.invoke(button({ primary: true, inHeader: true, label: 'My list 재생하기' }));
    assert.deepEqual(harness.calls, ['toggle']);
});
test('a different playlist header deliberately starts that playlist', () => {
    const harness = clickHarness({ queueSource: 'local:another-list' });
    harness.invoke(button({ primary: true, inHeader: true, label: 'My list 재생하기' }));
    assert.deepEqual(harness.calls, [['start', 0]]);
});
test('the actual ivLyrics microphone opens lyrics before the generic track-widget handler', () => {
    const harness = clickHarness(); const event = harness.invoke(button({ inBar: true, inWidget: true, classes: ['ivlyrics-playbar-control'] }));
    assert.deepEqual(harness.calls, ['lyrics']); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
});
test('a copied fullscreen style class never changes a microphone tooltip identity', () => {
    const harness = clickHarness();
    harness.invoke(button({ classes: ['ivlyrics-playbar-control', 'ivlyrics-fullscreen-btn'], tooltip: 'Lyrics Plus', inBar: true }));
    assert.deepEqual(harness.calls, ['lyrics']);
    harness.calls.length = 0;
    harness.invoke(button({ classes: ['ivlyrics-playbar-control', 'ivlyrics-fullscreen-btn'], tooltip: 'Fullscreen', inBar: true }));
    assert.deepEqual(harness.calls, []);
});
test('hidden native lyrics button still routes to ivLyrics for a YouTube source', () => {
    const harness = clickHarness(); harness.invoke(button({ id: 'lyrics-button', inBar: true }));
    assert.deepEqual(harness.calls, ['lyrics']);
});
test('ivLyrics fullscreen control keeps its separate upstream behavior', () => {
    const harness = clickHarness(); const event = harness.invoke(button({ inBar: true, classes: ['ivlyrics-playbar-control', 'ivlyrics-fullscreen-btn'] }));
    assert.deepEqual(harness.calls, []); assert.equal(event.prevented, false);
});
test('native Spotify playback keeps the microphone callback available upstream', () => {
    const harness = clickHarness({ active: false, kind: null });
    const event = harness.invoke(button({ inBar: true, classes: ['ivlyrics-playbar-control'] }));
    assert.deepEqual(harness.calls, []); assert.equal(event.prevented, false);
});
test('the local imported-playlist header toggles an active source without startView', async () => {
    const harness = clickHarness();
    const match = source.match(/const actions=el\('div'\);actions\.dataset\.testid='action-bar-row';actions\.append\(([^;]+)\);localRoot\.append\(actions\)/);
    assert.ok(match, 'Local header construction must stay available for its real callback test');
    harness.context.button = (_label, action) => ({ action });
    const control = vm.runInContext(match[1], harness.context);
    await control.action(); assert.deepEqual(harness.calls, ['toggle']);
});
test('opening a player anchored to the right panel keeps its iframe in the original body host', () => {
    const moves = [], panel = { style: {}, isConnected: true },
        bodyHost = { append: node => { moves.push('body-append'); node.parentElement = bodyHost; } },
        dock = { children: [], isConnected: true, getBoundingClientRect: () => ({ left: 1200, top: 64, width: 400, height: 720, right: 1600, bottom: 784 }),
            append: node => { moves.push('dock-append'); node.parentElement = dock; } };
    panel.parentElement = bodyHost;
    const styled = () => ({ style: {} });
    const context = vm.createContext({ active: true, mediaMode: 'youtube', panel, dockHidden: new Map(),
        document: { getElementById: () => dock, body: bodyHost, documentElement: { clientWidth: 1600, clientHeight: 900 } },
        window: { innerWidth: 1600, innerHeight: 900 }, innerWidth: 1600, innerHeight: 900,
        header: { firstChild: {}, children: [styled(), styled(), styled()], style: {} }, controls: styled(), hint: styled(), body: styled(), list: styled(), status: styled(), right: { children: [styled(), styled(), styled()] }, frame: styled(), directCard: styled(),
        ensureFrame() {}, restoreDock() {}, notify() {}, renderStatus() {}, Spicetify: { Player: {} }, view: null,
    });
    vm.runInContext(functionSource('open'), context); context.open(); context.open();
    assert.deepEqual(moves, [], 'Showing navigation must leave the existing browsing context attached');
});
function messageHarness(intent = true, wasPlaying = true) {
    const sent = [], child = {}, context = vm.createContext({ BASE: 'http://127.0.0.1:19643', session: 'my-session',
        frame: { contentWindow: child }, queue: [{ kind: 'youtube', videoId: 'rKQptWhAvO0' }], queueIndex: 0,
        active: true, mediaMode: 'youtube', state: { seconds: 83, duration: 194 }, playing: wasPlaying, playbackIntent: intent, lastError: '',
        send: (command, extra) => sent.push([command, extra]), ivLyrics: { update() {} },
        renderStatus() {}, updateBar() {}, startDirect() {}, advance() {},
    });
    vm.runInContext(functionSource('onMessage'), context);
    return { context, sent, child, ready() { context.onMessage({ origin: 'http://127.0.0.1:19643', source: child,
        data: { type: 'spotify-hangul-youtube-state', session: 'my-session', event: 'ready', state: -1, seconds: 0, duration: 0 } }); } };
}
test('an unexpected player-ready event restores position and play intent instead of loading at zero', () => {
    const { context, sent, ready } = messageHarness(); ready();
    assert.equal(sent.length, 1); assert.equal(sent[0][0], 'load'); assert.equal(sent[0][1].videoId, 'rKQptWhAvO0');
    assert.equal(sent[0][1].seconds, 83); assert.equal(sent[0][1].autoplay, true);
    assert.equal(context.state.seconds, 83); assert.equal(context.playing, true);
});
test('pause intent wins over a previous playing sample when a player becomes ready', () => {
    const { context, sent, ready } = messageHarness(false, true); ready();
    assert.equal(sent.length, 1); assert.equal(sent[0][1].seconds, 83); assert.equal(sent[0][1].autoplay, false);
    assert.equal(context.playbackIntent, false); assert.equal(context.state.seconds, 83);
});
test('a hidden iframe becoming ready never reloads an active direct-audio source', () => {
    const { context, sent, ready } = messageHarness(); context.mediaMode = 'direct'; ready();
    assert.deepEqual(sent, []); assert.equal(context.state.seconds, 83); assert.equal(context.playing, true);
});
test('pre-ready load and pause commands produce only one authoritative restored child load', () => {
    const html = fs.readFileSync(path.join(__dirname, 'youtube-player.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1], listeners = new Map(), calls = [];
    let config, video = '', seconds = 0, playerState = -1;
    const player = { getVideoData: () => ({ video_id: video }), getPlayerState: () => playerState,
        getCurrentTime: () => seconds, getDuration: () => 194, getVolume: () => 25, isMuted: () => false,
        setVolume() {}, unMute() {}, loadVideoById(args) { calls.push(['load', args.startSeconds]); video = args.videoId; seconds = args.startSeconds; playerState = 1; },
        cueVideoById(args) { calls.push(['cue', args.startSeconds]); video = args.videoId; seconds = args.startSeconds; playerState = 5; }, pauseVideo() { calls.push(['pause']); playerState = 2; } };
    const host = messageHarness(false, true), parent = { postMessage(data) { host.context.onMessage({ origin: 'http://127.0.0.1:19643', source: host.child, data }); } };
    const window = { addEventListener: (type, callback) => listeners.set(type, callback) };
    const context = vm.createContext({ window, parent, URLSearchParams, location: { hash: '#session=my-session', origin: 'http://127.0.0.1:19643' },
        document: { getElementById: () => ({ style: {} }), createElement: () => ({}), head: { append() {} } },
        YT: { Player: function (_id, options) { config = options; return player; } }, setInterval: () => 1, setTimeout: () => 1, clearInterval() {} });
    vm.runInContext(script, context); window.onYouTubeIframeAPIReady();
    const receive = data => listeners.get('message')({ origin: 'https://xpui.app.spotify.com', source: parent,
        data: { type: 'spotify-hangul-youtube-command', session: 'my-session', ...data } });
    receive({ command: 'load', videoId: 'rKQptWhAvO0', seconds: 0, autoplay: true }); receive({ command: 'pause' });
    assert.deepEqual(calls, []);
    host.context.send = (command, extra) => receive({ command, ...extra }); config.events.onReady();
    assert.deepEqual(calls, [['cue', 83]]); assert.equal(host.context.playbackIntent, false);
});

function modeHarness(options = {}) {
    const calls = [], values = new Map(), tasks = [], child = {};
    const element = () => ({ style: {}, append() {}, setAttribute(name, value) { this[name] = value; } });
    const audio = { src: '', currentTime: 0, duration: 194, volume: .25, muted: false, paused: true, ended: false, readyState: 0,
        pause() { this.paused = true; calls.push('audio-pause'); },
        play() { if (!this.readyState) { this.readyState = 1; context.applyAudioResume(); } this.paused = false; calls.push(['audio-play', this.currentTime]); return Promise.resolve(); },
        removeAttribute(name) { if (name === 'src') this.src = ''; }, load() { this.currentTime = 0; this.readyState = 0; } };
    const response = path => ({ ok: true, json: async () => ({ url: 'https://fixture.' + 'googlevideo.com/' + path, codec: 'opus', bitrate_kbps: 136, duration: 194 }) });
    const context = vm.createContext({ BASE: 'http://127.0.0.1:19643', MODE_KEY: 'spotify-hangul:youtube-playback-mode:v1',
        session: 'mode-test', URL, AbortController, DOMException, setTimeout, clearTimeout, audioGain: 1,
        active: true, kind: 'youtube', preferredMode: 'video', mediaMode: 'youtube', streamEpoch: 0,
        streamRequest: null, streamAttempted: false, pendingAudioSeek: null, playbackIntent: true, playing: true, lastError: '',
        queue: [{ kind: 'youtube', videoId: 'rKQptWhAvO0', title: 'Actual cover title' }], queueIndex: 0,
        queueSource: 'local:source-list', state: { seconds: 83, duration: 194, volume: 25, muted: false }, audio,
        frame: { contentWindow: { postMessage: (data, origin) => calls.push(['frame', data.command, data.seconds, data.autoplay, origin]) } },
        localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        audioModeButton: element(), videoModeButton: element(),
        directCard: { replaceChildren() {}, append() {} }, el: element,
        ivLyrics: { update: (item, state) => calls.push(['lyrics', item.videoId, state.seconds, state.playing]) },
        open: () => calls.push('open'), renderStatus() {}, updateBar() {}, notify: message => calls.push(['notice', message]),
        ensureFrame: () => calls.push('ensure-frame'), fetch: options.fetch || (async () => response('audio')),
        // The silent first-load retry has its own test; keep these paths on their explicit error behaviour.
        autoRetried: null, autoRetryTimer: null, clearTimeout() {}, autoRetryOnce: () => false,
        Spicetify: { Player: {}, Platform: {} }, originals: {}, ...options.context,
    });
    vm.runInContext(volumeSource, context);
    for (const name of ['readPlaybackMode', 'updateModeControls', 'cancelStream', 'clearAudio', 'send', 'updateAudio', 'applyAudioResume', 'setPlaybackMode'])
        vm.runInContext(functionSource(name), context);
    vm.runInContext('async ' + functionSource('startDirect'), context);
    const realStart = context.startDirect;
    context.startDirect = (...args) => { const task = realStart(...args); tasks.push(task); return task; };
    return { context, calls, values, tasks, audio, response, child, settle: () => Promise.all(tasks) };
}

test('playback preference defaults to the official video mode and is stored outside playlist data', () => {
    const h = modeHarness({ context: { active: false, kind: 'spotify' } });
    assert.equal(h.context.readPlaybackMode(), 'video');
    h.values.set(h.context.MODE_KEY, 'unknown'); assert.equal(h.context.readPlaybackMode(), 'video');
    h.context.setPlaybackMode('audio');
    assert.equal(h.context.readPlaybackMode(), 'audio');
    assert.deepEqual([...h.values.entries()], [[h.context.MODE_KEY, 'audio']]);
    assert.equal(h.context.preferredMode, 'audio');
    assert.deepEqual(h.calls, []); assert.equal(h.context.queueSource, 'local:source-list');
});

test('switching an active video to audio resumes the same recording and time before playback', async () => {
    const h = modeHarness(); h.context.setPlaybackMode('audio'); await h.settle();
    assert.equal(h.context.mediaMode, 'direct'); assert.equal(h.audio.currentTime, 83);
    assert.deepEqual(h.calls.filter(c => Array.isArray(c) && c[0] === 'audio-play'), [['audio-play', 83]]);
    assert.ok(h.calls.some(c => Array.isArray(c) && c[0] === 'frame' && c[1] === 'pause'));
    assert.equal(h.context.queueIndex, 0); assert.equal(h.context.queue[0].title, 'Actual cover title');
});

test('pause and seek intent during extraction are honored when audio metadata arrives', async () => {
    let resolve; const deferred = new Promise(r => { resolve = r; });
    const h = modeHarness({ fetch: () => deferred }); h.context.setPlaybackMode('audio');
    h.context.send('pause'); h.context.send('seek', { seconds: 62 });
    assert.equal(h.context.state.seconds, 62); assert.equal(h.context.playbackIntent, false);
    resolve(h.response('paused')); await h.settle();
    assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'audio-play').length, 0);
    h.audio.readyState = 1; h.context.applyAudioResume(); h.context.updateAudio();
    assert.equal(h.audio.currentTime, 62); assert.equal(h.context.state.seconds, 62); assert.equal(h.context.playing, false);
});

test('switching back to video clears direct audio and restores current time and pause intent', () => {
    const h = modeHarness({ context: { mediaMode: 'direct', preferredMode: 'audio', playbackIntent: false } });
    h.audio.src = 'fixture'; h.audio.currentTime = 91; h.audio.paused = false;
    h.context.setPlaybackMode('video');
    assert.equal(h.audio.src, ''); assert.equal(h.audio.paused, true); assert.equal(h.context.mediaMode, 'youtube');
    assert.deepEqual(h.calls.find(c => Array.isArray(c) && c[0] === 'frame' && c[1] === 'load'),
        ['frame', 'load', 91, false, 'http://127.0.0.1:19643']);
    assert.equal(h.context.state.seconds, 91); assert.equal(h.context.queueIndex, 0);
});

test('a late extraction response cannot replace a newer mode selection for the same video', async () => {
    const resolvers = [], h = modeHarness({ fetch: () => new Promise(r => resolvers.push(r)) });
    h.context.setPlaybackMode('audio'); const first = h.tasks[0];
    h.context.setPlaybackMode('video'); h.context.setPlaybackMode('audio');
    resolvers[0](h.response('old')); await first;
    assert.equal(h.audio.src, '', 'The aborted response must not install an old audio source');
    resolvers[1](h.response('new')); await h.settle();
    assert.ok(h.audio.src.endsWith('/new')); assert.equal(h.audio.currentTime, 83);
    assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'audio-play').length, 1);
});

test('audio extraction failure remains explicit and never silently starts ad-capable video', async () => {
    const h = modeHarness({ fetch: async () => ({ ok: false, status: 404, json: async () => ({ error: 'Unavailable' }) }) });
    h.context.setPlaybackMode('audio'); await h.settle();
    assert.equal(h.context.mediaMode, 'direct'); assert.match(h.context.lastError, /YouTube 영상을 선택/);
    assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'frame' && c[1] === 'load').length, 0);
    assert.equal(h.audio.src, '');
});

test('a changed recording rejects an extraction response even when the network ignores abort', async () => {
    let resolve; const h = modeHarness({ fetch: () => new Promise(r => { resolve = r; }) });
    h.context.setPlaybackMode('audio');
    h.context.cancelStream(); h.context.queue = [{ kind: 'youtube', videoId: 'UWa_OiXDiQA' }];
    resolve(h.response('stale-track')); await h.settle();
    assert.equal(h.audio.src, ''); assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'audio-play').length, 0);
});

test('the saved audio choice starts the next YouTube queue item without loading the video player', async () => {
    const h = modeHarness({ context: { active: false, kind: null, preferredMode: 'audio', lyricAbort: null,
        queueSource: null, lyrics: [], lyricsResult: null, lyricBox: { textContent: '' },
        Spicetify: { Platform: {}, Player: {} }, originals: { pause() {} }, remember() {}, markPlaying() {} } });
    vm.runInContext(functionSource('playCurrent'), h.context);
    h.context.playCurrent(); await h.settle();
    assert.equal(h.context.kind, 'youtube'); assert.equal(h.context.active, true);
    assert.equal(h.context.mediaMode, 'direct'); assert.equal(h.audio.currentTime, 0);
    assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'frame' && c[1] === 'load').length, 0);
    assert.deepEqual(h.calls.filter(c => Array.isArray(c) && c[0] === 'audio-play'), [['audio-play', 0]]);
});

test('opening video after native playback clears legacy frame hiding without moving its browsing context', () => {
    const style = () => ({ style: {} }), child = {}, parent = {}, frame = { style: { display: 'none' }, src: 'fixture-player', contentWindow: child, parentElement: parent };
    const panel = style(), calls = [];
    const context = vm.createContext({ active: true, mediaMode: 'youtube', frame, panel,
        document: { getElementById: () => null }, header: style(), controls: style(), hint: style(), body: style(), list: style(),
        renderStatus() { calls.push('status'); }, ensureFrame() { calls.push('ensure'); }, restoreDock() {}, notify() {} });
    vm.runInContext(functionSource('open'), context); context.open();
    assert.equal(frame.style.display, ''); assert.equal(frame.src, 'fixture-player');
    assert.equal(frame.contentWindow, child); assert.equal(frame.parentElement, parent);
    assert.equal(panel.style.cssText.includes('display:block'), true);
    assert.deepEqual(calls, ['status', 'ensure']);
});

test('video mode load inherits current audio volume and mute without changing time or pause intent', () => {
    const h = modeHarness({ context: { mediaMode: 'direct', preferredMode: 'audio', playbackIntent: false,
        state: { seconds: 83, duration: 194, volume: 87, muted: true } } });
    const messages = []; h.context.frame.contentWindow.postMessage = data => messages.push(data);
    h.audio.src = 'fixture-audio'; h.audio.currentTime = 91; h.audio.paused = true;
    h.context.setPlaybackMode('video');
    const loads = messages.filter(data => data.command === 'load');
    // The player gets the setting that sounds like Spotify at 87; the slider keeps 87.
    assert.equal(loads.length, 1); assert.equal(loads[0].volume, vm.runInContext('videoVolume(87)', h.context)); assert.ok(loads[0].volume < 87); assert.equal(loads[0].muted, true);
    assert.equal(loads[0].seconds, 91); assert.equal(loads[0].autoplay, false);
    assert.equal(h.context.state.volume, 87); assert.equal(h.context.queueIndex, 0);
    h.context.send('play'); assert.equal(messages.at(-1).muted, true);
});

function iframeVolumeHarness() {
    const html = fs.readFileSync(path.join(__dirname, 'youtube-player.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1], listeners = new Map(), calls = [], messages = [];
    let config, volume = 25, muted = false, video = '', seconds = 0, playerState = -1, onState = () => {};
    const player = { getVideoData: () => ({ video_id: video }), getPlayerState: () => playerState,
        getCurrentTime: () => seconds, getDuration: () => 194, getVolume: () => volume, isMuted: () => muted,
        setVolume(value) { volume = value; calls.push(['volume', value]); },
        mute() { muted = true; calls.push(['mute']); }, unMute() { muted = false; calls.push(['unmute']); },
        playVideo() { playerState = 1; calls.push(['play', volume, muted]); }, pauseVideo() { playerState = 2; calls.push(['pause']); },
        loadVideoById(args) { video = args.videoId; seconds = args.startSeconds; playerState = 1; calls.push(['load', seconds, volume, muted]); },
        cueVideoById(args) { video = args.videoId; seconds = args.startSeconds; playerState = 5; calls.push(['cue', seconds, volume, muted]); } };
    const parent = { postMessage(data) { messages.push(data); onState(data); } },
        window = { addEventListener: (type, callback) => listeners.set(type, callback) };
    const context = vm.createContext({ window, parent, URLSearchParams, location: { hash: '#session=mode-test', origin: 'http://127.0.0.1:19643' },
        document: { getElementById: () => ({ style: {} }), createElement: () => ({}), head: { append() {} } },
        YT: { Player: function (_id, options) { config = options; return player; } }, setInterval: () => 1, setTimeout: () => 1, clearInterval() {} });
    vm.runInContext(script, context); window.onYouTubeIframeAPIReady();
    return { calls, messages, ready: () => config.events.onReady(), onState: callback => { onState = callback; },
        receive: data => listeners.get('message')({ origin: 'https://xpui.app.spotify.com', source: parent,
            data: { type: 'spotify-hangul-youtube-command', session: 'mode-test', ...data } }),
        read: () => ({ volume, muted, video, seconds, playerState }) };
}

test('cold iframe readiness restores parent volume and mute before the single paused cue', () => {
    const h = modeHarness({ context: { playing: false, playbackIntent: false, state: { seconds: 83, duration: 194, volume: 63, muted: true } } });
    const child = iframeVolumeHarness();
    h.context.frame.contentWindow.postMessage = data => child.receive(data);
    vm.runInContext(functionSource('onMessage'), h.context);
    child.onState(data => h.context.onMessage({ origin: 'http://127.0.0.1:19643', source: h.context.frame.contentWindow, data }));
    h.context.send('load', { videoId: 'rKQptWhAvO0', seconds: 83, autoplay: false });
    assert.equal(child.calls.length, 0, 'the unready child must not apply an early command');
    child.ready();
    const setting = vm.runInContext('videoVolume(63)', h.context);
    assert.deepEqual(child.calls.filter(call => call[0] === 'cue' || call[0] === 'load'), [['cue', 83, setting, true]]);
    assert.equal(child.read().volume, setting); assert.equal(child.read().muted, true);
    assert.equal(h.context.state.volume, 63); assert.equal(h.context.playbackIntent, false);
});

test('iframe explicit mute wins over autoplay and subsequent play while legacy commands still unmute', () => {
    const child = iframeVolumeHarness(); child.ready();
    child.receive({ command: 'load', videoId: 'rKQptWhAvO0', seconds: 35, autoplay: true, volume: 81, muted: true });
    assert.deepEqual(child.calls.at(-1), ['load', 35, 81, true]);
    child.receive({ command: 'play', muted: true }); assert.deepEqual(child.calls.at(-1), ['play', 81, true]);
    child.receive({ command: 'play' }); assert.deepEqual(child.calls.at(-1), ['play', 81, false]);
    child.receive({ command: 'load', videoId: 'rKQptWhAvO0', seconds: 36, autoplay: false, volume: 140, muted: false });
    assert.deepEqual(child.calls.at(-1), ['cue', 36, 100, false]);
    child.receive({ command: 'load', videoId: 'rKQptWhAvO0', seconds: 37, autoplay: true, volume: -5, muted: false });
    assert.deepEqual(child.calls.at(-1), ['load', 37, 0, false]);
});

test('YouTube lyric buttons open ivLyrics and ask its overlay sender to start the desktop overlay', () => {
    const calls = [];
    const context = vm.createContext({ ivLyrics: { open: () => calls.push('open') },
        window: { OverlaySender: { openOverlayApp: async () => { calls.push('overlay'); return true; } } } });
    vm.runInContext(functionSource('openLyrics'), context);
    context.openLyrics(); assert.deepEqual(calls, ['open', 'overlay']);
    context.ivLyrics.open = () => { throw new Error('YouTube 곡을 먼저 재생해 주세요.'); };
    assert.throws(() => context.openLyrics(), /먼저 재생/); assert.deepEqual(calls, ['open', 'overlay'], 'no launch without a track');
    context.ivLyrics.open = () => calls.push('open'); context.window = {};
    context.openLyrics(); assert.deepEqual(calls, ['open', 'overlay', 'open'], 'ivLyrics without the sender is left alone');
    for (const wiring of ['onLyrics:openLyrics,', 'stopImmediatePropagation();openLyrics();return;', "id==='lyrics-button'&&active)action=openLyrics;", 'openLyrics,editLyricInfo'])
        assert.ok(source.includes(wiring), wiring);
    assert.ok(!source.includes('ivLyrics.open()}') && source.split('ivLyrics.open()').length === 2, 'every lyric entry point goes through openLyrics');
});

test('audio mode follows Spotify loudness for the slider and the official player gain while the slider keeps the user volume', async () => {
    const loud = path => ({ ok: true, json: async () => ({ ...JSON.parse(JSON.stringify({ url: 'https://fixture.' + 'googlevideo.com/' + path, codec: 'opus', bitrate_kbps: 136, duration: 194 })), volume_gain: 0.4285 }) });
    const h = modeHarness({ fetch: async () => loud('loud') }); h.context.setPlaybackMode('audio'); await h.settle();
    const element = slider => vm.runInContext(`linkVolume(${slider},AUDIO_DB)/100`, h.context);
    assert.ok(Math.abs(h.audio.volume - element(25) * 0.4285) < 1e-9); assert.ok(element(25) < 0.25 && element(100) === 1);
    h.context.updateAudio(); assert.equal(h.context.state.volume, 25);
    h.context.send('volume', { volume: 60 }); assert.ok(Math.abs(h.audio.volume - element(60) * 0.4285) < 1e-9);
    h.context.updateAudio(); assert.equal(h.context.state.volume, 60);
    for (const gain of [undefined, 0, 5, 'x']) {
        const plain = modeHarness({ fetch: async () => ({ ok: true, json: async () => ({ url: 'https://fixture.' + 'googlevideo.com/plain', codec: 'opus', bitrate_kbps: 136, duration: 194, volume_gain: gain }) }) });
        plain.context.setPlaybackMode('audio'); await plain.settle();
        assert.ok(Math.abs(plain.audio.volume - vm.runInContext('linkVolume(25,AUDIO_DB)/100', plain.context)) < 1e-9, String(gain));
    }
});

test('a YouTube item starts at Spotify volume and slider changes are written back for the next Spotify song', async () => {
    const written = [];
    const h = modeHarness({ context: { active: false, kind: null, preferredMode: 'audio', lyricAbort: null,
        queueSource: null, lyrics: [], lyricsResult: null, lyricBox: { textContent: '' }, remember() {}, markPlaying() {},
        state: { seconds: 0, duration: 194, volume: 25, muted: false },
        Spicetify: { Platform: {}, Player: { getVolume: () => 0.4 } },
        originals: { pause() {}, setVolume(value) { written.push(value); } } } });
    vm.runInContext(functionSource('playCurrent'), h.context);
    h.context.playCurrent(); await h.settle();
    assert.equal(h.context.state.volume, 40);
    assert.ok(Math.abs(h.audio.volume - vm.runInContext('audioVolume(40)', h.context)) < 1e-9);
    h.context.send('volume', { volume: 70 });
    assert.deepEqual(written, [0.7]); assert.equal(h.context.state.volume, 70);
    assert.ok(Math.abs(h.audio.volume - vm.runInContext('audioVolume(70)', h.context)) < 1e-9);
});

test('leaving a YouTube item redraws the volume bar at the shared volume instead of the value saved when it started', () => {
    const node = (tagName, extra = {}) => ({ tagName, isConnected: true, dataset: {}, attributes: {}, textContent: '', ...extra,
        getAttribute(name) { return this.attributes[name] ?? null; }, setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; } });
    const range = node('INPUT', { value: '0.3', max: '1' });
    const properties = {}, visual = node('DIV', { style: { setProperty: (name, value) => { properties[name] = value; } } });
    visual.attributes['data-testid'] = 'progress-bar';
    const savedNodes = new Map([[range, { value: '0.6', max: '1', html: null, text: '', href: null, label: null, valueText: null, style: null }],
        [visual, { html: null, text: '', href: null, label: null, valueText: null, style: '--progress-bar-transform: 60%;' }]]);
    const volumeNodes = new Set([range, visual]);
    const context = vm.createContext({ savedNodes, volumeNodes, Spicetify: { Player: { getVolume: () => 0.3 } } });
    vm.runInContext(functionSource('restoreBar'), context);
    context.restoreBar();
    assert.equal(range.value, '0.3'); assert.equal(properties['--progress-bar-transform'], '30%');
    assert.equal(savedNodes.size, 0); assert.equal(volumeNodes.size, 0);
});
