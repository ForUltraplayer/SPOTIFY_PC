/** @file test_youtube_overlay.cjs
 * @author: ForUltraplayer
 * @brief Verify overlay control routing, conditional mounting and recoverable native icon updates.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const controls = require('./youtube-overlay-controls.js');

class Element {
    constructor(tag, document) {
        this.tagName = tag.toUpperCase(); this.ownerDocument = document;
        this.dataset = {}; this.attributes = new Map(); this.children = [];
        this.listeners = new Map(); this.style = {}; this.box = { width: 400, height: 100 };
        this.css = { display: 'block', visibility: 'visible', opacity: '1' };
        this.native = []; this.innerHTML = ''; this.hidden = false;
    }
    get isConnected() { return this === this.ownerDocument.body || this === this.ownerDocument.head || !!this.parentElement?.isConnected; }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
    replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.has(key) ? this.attributes.get(key) : null; }
    removeAttribute(key) { this.attributes.delete(key); }
    getBoundingClientRect() { return this.box; }
    contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
    querySelectorAll(selector) {
        if (selector.includes('fullscreen-control-play')) return this.native;
        const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        return selector === '*' ? all : all.filter(node => node.tagName.toLowerCase() === selector);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
        if (selector.includes('hangul-overlay-controls') && this.dataset.testid === 'hangul-overlay-controls') return this;
        return this.parentElement?.closest(selector) || null;
    }
    addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
    emit(name, event) { for (const listener of this.listeners.get(name) || []) listener(event); }
}
function harness({ fullscreen = true, nativeVisible = false, linked = true, playing = true } = {}) {
    const doc = { roots: [], activeElement: null, createElement(tag) { return new Element(tag, this); },
        createElementNS(_ns, tag) { return this.createElement(tag); }, querySelectorAll() { return this.roots; } };
    doc.head = new Element('head', doc); doc.body = new Element('body', doc);
    const root = new Element('section', doc), native = new Element('button', doc), icon = new Element('svg', doc);
    icon.innerHTML = '<path d="original"/>'; icon.setAttribute('viewBox', '0 0 24 24');
    native.setAttribute('title', '기존 재생'); native.setAttribute('aria-label', '기존 라벨'); native.append(icon);
    native.css.display = nativeVisible ? 'block' : 'none'; root.native = [native]; root.append(native); doc.body.append(root);
    if (fullscreen) doc.roots = [root];
    const calls = [], source = { active: linked, playing }, timers = new Map(); let seq = 0, observer;
    const player = { isPlaying: () => false, back() { calls.push('back'); }, togglePlay() { calls.push('togglePlay'); }, next() { calls.push('next'); } };
    const host = { document: doc, getComputedStyle: node => node.css, SpotifyHangulLinks: { snapshot: () => source }, Spicetify: { Player: player },
        setTimeout: callback => { const id = ++seq; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
        setInterval: callback => { const id = ++seq; timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id),
        MutationObserver: class { constructor(callback) { this.callback = callback; observer = this; } observe() {} disconnect() { this.disconnected = true; } } };
    return { host, doc, root, native, icon, source, player, calls, timers, get observer() { return observer; },
        toolbar: () => root.children.find(node => node.dataset.testid === 'hangul-overlay-controls') };
}
function event() { return { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; }

test('YouTube overlay reads the link clock while native playback stays paused', () => {
    const h = harness();
    assert.deepEqual(controls.readPlayback(h.host), { playing: true, linked: true });
    h.source.active = false;
    assert.deepEqual(controls.readPlayback(h.host), { playing: false, linked: false });
    h.host.SpotifyHangulLinks.snapshot = () => { throw Error('switching'); };
    h.player.isPlaying = () => true;
    assert.deepEqual(controls.readPlayback(h.host), { playing: true, linked: false });
});
test('overlay actions resolve the current wrapped player and reject unrelated method names', async () => {
    const h = harness();
    await controls.invokeAction(h.host, 'back');
    h.player.next = () => h.calls.push('replacement-next');
    await controls.invokeAction(h.host, 'next');
    assert.equal(await controls.invokeAction(h.host, 'logout'), false);
    assert.deepEqual(h.calls, ['back', 'replacement-next']);
});
test('controls mount only in an already visible fullscreen surface and clean up on exit', () => {
    const h = harness({ fullscreen: false }); const instance = controls.create(h.host);
    assert.equal(h.toolbar(), undefined);
    h.doc.roots = [h.root]; instance.sync(); assert.ok(h.toolbar());
    h.root.css.opacity = '0'; instance.sync(); assert.equal(h.toolbar(), undefined);
    instance.dispose(); assert.equal(h.doc.head.children.length, 0); assert.equal(h.timers.size, 0); assert.equal(h.observer.disconnected, true);
});
test('visible upstream controls are reused and their original icon and labels are restored', () => {
    const h = harness({ nativeVisible: true }); const instance = controls.create(h.host);
    assert.equal(h.toolbar(), undefined);
    assert.equal(h.native.getAttribute('aria-label'), '일시정지'); assert.equal(h.icon.getAttribute('viewBox'), '0 0 16 16');
    h.source.active = false; instance.sync();
    assert.equal(h.native.getAttribute('title'), '기존 재생'); assert.equal(h.native.getAttribute('aria-label'), '기존 라벨');
    assert.equal(h.icon.innerHTML, '<path d="original"/>'); assert.equal(h.icon.getAttribute('viewBox'), '0 0 24 24');
    instance.dispose();
});
test('hidden controls get accessible buttons and one click performs exactly one action', async () => {
    const h = harness(); const instance = controls.create(h.host), toolbar = h.toolbar();
    assert.equal(toolbar.getAttribute('role'), 'toolbar');
    assert.deepEqual(toolbar.children.map(node => node.getAttribute('aria-label')), ['이전 곡', '일시정지', '다음 곡']);
    for (const button of toolbar.children) { const click = event(); button.emit('click', click); assert.equal(click.prevented, true); assert.equal(click.stopped, true); }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls, ['back', 'togglePlay', 'next']);
    const pointer = event(); toolbar.emit('pointerdown', pointer); assert.equal(pointer.stopped, true);
    const key = { ...event(), key: ' ' }; toolbar.emit('keydown', key); assert.equal(key.stopped, true); assert.equal(key.prevented, false);
    instance.dispose();
});
test('focused fallback controls remain stable when upstream controls become visible', () => {
    const h = harness(); const instance = controls.create(h.host), toolbar = h.toolbar();
    h.doc.activeElement = toolbar.children[2]; h.native.css.display = 'block'; instance.sync(); assert.equal(h.toolbar(), toolbar);
    h.doc.activeElement = null; instance.sync(); assert.equal(h.toolbar(), undefined); instance.dispose();
});
test('a missing player action disables its fallback button without altering settings', () => {
    const h = harness(); delete h.player.next; const before = Object.keys(h.host).sort(); const instance = controls.create(h.host);
    assert.equal(h.toolbar().children[2].disabled, true); assert.deepEqual(Object.keys(h.host).sort(), before); instance.dispose();
});
