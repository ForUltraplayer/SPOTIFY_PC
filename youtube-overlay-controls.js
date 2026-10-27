/** @file youtube-overlay-controls.js
 * @author: ForUltraplayer
 * @brief Keep basic playback actions available on visible ivLyrics fullscreen lyrics surfaces without changing user settings.
 */
(() => {
    'use strict';
    const ROOT = '.lyrics-lyricsContainer-LyricsContainer.fullscreen-active';
    const CONTROL = '.fullscreen-control-play,.fullscreen-tv-control-btn.play-pause';
    const MARKER = 'hangul-overlay-controls';
    const ICON = {
        back: 'M3 2h2v12H3zM13 2v12L5 8z',
        play: 'M4 2v12l10-6z',
        pause: 'M3 2h4v12H3zM9 2h4v12H9z',
        next: 'M11 2h2v12h-2zM3 2v12l8-6z'
    };

    function readPlayback(host) {
        try {
            const source = host.SpotifyHangulLinks;
            const state = source?.playbackState?.() || source?.snapshot?.();
            if (state?.active === true) return { playing: state.playing === true, linked: true };
        } catch { /* A source transition must not make native controls unusable. */ }
        try { return { playing: host.Spicetify?.Player?.isPlaying?.() === true, linked: false }; }
        catch { return { playing: false, linked: false }; }
    }

    async function invokeAction(host, action) {
        if (!['back', 'togglePlay', 'next'].includes(action)) return false;
        const player = host.Spicetify?.Player;
        if (typeof player?.[action] !== 'function') return false;
        await player[action]();
        return true;
    }

    function visible(host, node, boundary) {
        if (!node?.isConnected) return false;
        const box = node.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        for (let current = node; current; current = current.parentElement) {
            const style = host.getComputedStyle(current);
            if (current.hidden || current.getAttribute('aria-hidden') === 'true'
                || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
                || Number(style.opacity) === 0) return false;
            if (current === boundary) break;
        }
        return true;
    }

    function create(host) {
        const document = host.document;
        let disposed = false, mountedRoot = null, toolbar = null, playButton = null;
        let pending = null;
        const nativeSaved = new Map();
        const style = document.createElement('style');
        style.textContent = `
            [data-testid="${MARKER}"]{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:30px;background:rgba(18,18,18,.88);border:1px solid #ffffff38;z-index:110;pointer-events:auto;color:#fff}
            [data-testid="${MARKER}"] button{display:grid;place-items:center;width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;padding:8px;pointer-events:auto}
            [data-testid="${MARKER}"] button:hover{background:#ffffff20}
            [data-testid="${MARKER}"] button:focus-visible{outline:2px solid #1ed760;outline-offset:2px}
            [data-testid="${MARKER}"] button:disabled{opacity:.4;cursor:default}
            [data-testid="${MARKER}"] svg{width:24px;height:24px;fill:currentColor}
        `;
        document.head.append(style);

        function svg(path) {
            const image = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            image.setAttribute('viewBox', '0 0 16 16');
            image.setAttribute('aria-hidden', 'true');
            const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            shape.setAttribute('d', path); image.append(shape);
            return image;
        }
        function restoreNative() {
            for (const [button, saved] of nativeSaved) {
                if (!button.isConnected) continue;
                for (const [name, value] of Object.entries(saved.attributes)) {
                    if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
                }
                const image = button.querySelector('svg');
                if (image && saved.html !== null) {
                    image.innerHTML = saved.html;
                    if (saved.viewBox === null) image.removeAttribute('viewBox'); else image.setAttribute('viewBox', saved.viewBox);
                }
            }
            nativeSaved.clear();
        }
        function paintNative(button, state) {
            if (!state.linked) return;
            const image = button.querySelector('svg');
            if (!nativeSaved.has(button)) nativeSaved.set(button, {
                attributes: { title: button.getAttribute('title'), 'aria-label': button.getAttribute('aria-label') },
                html: image?.innerHTML ?? null, viewBox: image?.getAttribute('viewBox') ?? null
            });
            const label = state.playing ? '일시정지' : '재생';
            if (button.getAttribute('title') !== label) button.setAttribute('title', label);
            if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
            const path = state.playing ? ICON.pause : ICON.play;
            if (image && image.innerHTML !== `<path d="${path}"></path>`) {
                image.setAttribute('viewBox', '0 0 16 16');
                image.innerHTML = `<path d="${path}"></path>`;
            }
        }
        function removeToolbar() {
            toolbar?.remove(); toolbar = null; playButton = null; mountedRoot = null;
        }
        function button(action, label, path) {
            const node = document.createElement('button');
            node.type = 'button'; node.dataset.action = action;
            node.setAttribute('aria-label', label); node.setAttribute('title', label);
            node.append(svg(path));
            node.addEventListener('click', event => {
                event.preventDefault(); event.stopPropagation();
                invokeAction(host, action).then(sync).catch(error => {
                    host.Spicetify?.showNotification?.(error.message || '재생 조작을 완료하지 못했습니다.', true);
                });
            });
            return node;
        }
        function mount(root) {
            removeToolbar(); mountedRoot = root;
            toolbar = document.createElement('div');
            toolbar.dataset.testid = MARKER;
            toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '가사 재생 컨트롤');
            const previous = button('back', '이전 곡', ICON.back);
            playButton = button('togglePlay', '재생', ICON.play);
            const next = button('next', '다음 곡', ICON.next);
            toolbar.append(previous, playButton, next);
            // Keep existing lyric/background click gestures from also firing.
            toolbar.addEventListener('pointerdown', event => event.stopPropagation());
            toolbar.addEventListener('dblclick', event => event.stopPropagation());
            toolbar.addEventListener('keydown', event => {
                if ([' ', 'Enter'].includes(event.key)) event.stopPropagation();
            });
            toolbar.addEventListener('focusout', schedule);
            root.append(toolbar);
        }
        function sync() {
            if (disposed) return;
            const roots = [...document.querySelectorAll(ROOT)].filter(root => visible(host, root));
            const root = roots.at(-1);
            if (!root) { removeToolbar(); restoreNative(); return; }
            for (const button of nativeSaved.keys()) if (!button.isConnected) nativeSaved.delete(button);
            const state = readPlayback(host), native = [...root.querySelectorAll(CONTROL)];
            if (!state.linked) restoreNative();
            for (const control of native) paintNative(control, state);
            const nativeVisible = native.some(control => visible(host, control, root));
            const focusHeld = toolbar?.contains(document.activeElement);
            if (nativeVisible && !focusHeld) { removeToolbar(); return; }
            if (root !== mountedRoot || !toolbar?.isConnected) mount(root);
            for (const control of toolbar.querySelectorAll('button')) {
                control.disabled = typeof host.Spicetify?.Player?.[control.dataset.action] !== 'function';
            }
            const label = state.playing ? '일시정지' : '재생';
            if (playButton.getAttribute('aria-label') !== label) {
                playButton.setAttribute('aria-label', label); playButton.setAttribute('title', label);
                playButton.replaceChildren(svg(state.playing ? ICON.pause : ICON.play));
            }
        }
        function schedule() {
            if (disposed || pending !== null) return;
            pending = host.setTimeout(() => { pending = null; sync(); }, 0);
        }
        const observer = new host.MutationObserver(records => {
            if (records.some(record => !record.target.closest?.(`[data-testid="${MARKER}"]`))) schedule();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
        const timer = host.setInterval(sync, 500);
        sync();
        return { sync, dispose() {
            if (disposed) return; disposed = true;
            observer.disconnect(); host.clearInterval(timer);
            if (pending !== null) host.clearTimeout(pending);
            removeToolbar(); restoreNative(); style.remove();
        } };
    }
    const api = { create, readPlayback, invokeAction, visible };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') window.SpotifyHangulOverlayControls = api;
})();
