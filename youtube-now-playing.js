/** @file youtube-now-playing.js
 * @author: ForUltraplayer
 * @brief Present the link player's current track using Spotify-like surfaces without owning media playback.
 */
(() => {
    'use strict';
    const ICONS = {
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        queue: '<path d="M4 5h13M4 11h13M4 17h8"/><path d="m17 15 4 3-4 3z"/>',
        external: '<path d="M14 4h6v6M20 4l-9 9M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5"/>',
        lyrics: '<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>',
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
        retry: '<path d="M20 11a8 8 0 1 0-2.2 6M20 4v7h-7"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
        youtube: '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10 9 5 3-5 3z"/>',
        music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
    };
    const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
    function create(host, callbacks = {}) {
        const doc = host.document;
        if (!doc?.createElement) throw new TypeError('A document is required for the current-track panel.');
        const ownedListeners = [];
        const node = (tag, className, value) => {
            const element = doc.createElement(tag);
            if (className) element.className = className;
            if (value !== undefined) element.textContent = value;
            return element;
        };
        const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
        const icon = name => {
            const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '1.7');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.setAttribute('aria-hidden', 'true');
            svg.innerHTML = ICONS[name] || ICONS.info; // Static, locally authored paths only.
            return svg;
        };
        const listen = (element, event, handler) => {
            element.addEventListener(event, handler);
            ownedListeners.push(() => element.removeEventListener(event, handler));
        };
        const invoke = (name, ...args) => {
            try {
                const result = callbacks[name]?.(...args);
                if (result && typeof result.catch === 'function') result.catch(showActionError);
            } catch (error) { showActionError(error); }
        };
        const action = (label, name, testId, iconName, className = '') => {
            const control = node('button', 'hl-np-button ' + className);
            control.type = 'button'; control.title = label;
            control.setAttribute('aria-label', label);
            control.dataset.testid = testId;
            if (iconName) control.append(icon(iconName));
            listen(control, 'click', () => invoke(name));
            return control;
        };
        const element = node('section', 'hl-now-playing');
        element.dataset.testid = 'hangul-now-playing';
        element.setAttribute('aria-label', 'YouTube 현재 재생 중');
        const header = node('header', 'hl-np-header');
        const heading = node('h2', 'hl-np-heading', '지금 재생 중');
        const headerActions = node('div', 'hl-np-header-actions');
        const queueAction = action('재생목록 보기', 'onQueue', 'hangul-queue-action', 'queue', 'hl-np-icon-button');
        const closeAction = action('링크 재생 종료', 'onClose', 'hangul-close-action', 'close', 'hl-np-icon-button');
        closeAction.title = '링크 재생을 종료하고 Spotify로 돌아가기';
        headerActions.append(queueAction, closeAction); header.append(heading, headerActions);

        // This node remains stable for the entire component lifetime. The caller
        // owns the existing iframe and may place it here once or dock by geometry.
        const media = node('div', 'hl-np-media-surface');
        const mediaAnchor = node('div', 'hl-np-media');
        mediaAnchor.dataset.testid = 'hangul-media-anchor';
        const videoBase = node('div', 'hl-np-video-base');
        videoBase.setAttribute('aria-hidden', 'true');
        videoBase.append(icon('youtube'), node('span', '', 'YouTube 영상'));
        const art = node('div', 'hl-np-artwork');
        const backdrop = node('div', 'hl-np-artwork-backdrop');
        backdrop.setAttribute('aria-hidden', 'true');
        const image = node('img', 'hl-np-cover');
        image.alt = ''; image.decoding = 'async';
        const artFallback = node('div', 'hl-np-artwork-fallback');
        artFallback.setAttribute('aria-hidden', 'true'); artFallback.append(icon('music'));
        art.append(backdrop, artFallback, image); mediaAnchor.append(videoBase); media.append(mediaAnchor, art);
        listen(image, 'load', () => { art.dataset.ready = 'true'; art.dataset.failed = 'false'; });
        listen(image, 'error', () => { art.dataset.ready = 'false'; art.dataset.failed = 'true'; });

        const info = node('div', 'hl-np-info');
        const source = node('div', 'hl-np-source');
        const sourceLogo = node('span', 'hl-np-source-logo'); sourceLogo.append(icon('youtube'));
        const sourceText = node('span', '', 'YouTube');
        const divider = node('span', 'hl-np-dot', '·'); divider.setAttribute('aria-hidden', 'true');
        const sourceMode = node('span', 'hl-np-source-mode');
        source.append(sourceLogo, sourceText, divider, sourceMode);
        const title = node('h3', 'hl-np-title', '곡을 선택하세요'); title.dataset.testid = 'hangul-now-title';
        const artist = node('p', 'hl-np-artist'); artist.dataset.testid = 'hangul-now-artist';
        info.append(source, title, artist);

        const modeGroup = node('div', 'hl-np-modes');
        modeGroup.setAttribute('role', 'group'); modeGroup.setAttribute('aria-label', 'YouTube 재생 방식');
        const modeButton = (mode, label, glyph) => {
            const control = node('button', 'hl-np-mode'); control.type = 'button';
            control.dataset.testid = 'hangul-mode-' + mode;
            control.setAttribute('aria-label', label + ' 재생');
            control.append(icon(glyph), node('span', '', label));
            listen(control, 'click', () => invoke('onMode', mode));
            return control;
        };
        const audioMode = modeButton('audio', '음원', 'music');
        const videoMode = modeButton('video', '영상', 'youtube'); modeGroup.append(audioMode, videoMode);

        const status = node('div', 'hl-np-status');
        status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const statusDot = node('span', 'hl-np-status-dot'); statusDot.setAttribute('aria-hidden', 'true');
        const statusLabel = node('span', 'hl-np-status-label');
        const quality = node('span', 'hl-np-quality'); status.append(statusDot, statusLabel, quality);
        const actions = node('div', 'hl-np-actions');
        const lyricsAction = action('ivLyrics 가사 열기', 'onLyrics', 'hangul-lyrics-action', 'lyrics', 'hl-np-primary');
        lyricsAction.append(node('span', '', '가사 열기'));
        const searchAction = action('가사 검색 정보 수정', 'onSearch', 'hangul-search-action', 'search', 'hl-np-icon-button hl-np-search-action');
        actions.append(lyricsAction, searchAction);

        const notice = node('div', 'hl-np-notice');
        notice.append(icon('info')); const noticeText = node('p'); notice.append(noticeText);
        const errorCard = node('div', 'hl-np-error'); errorCard.hidden = true;
        const errorTitle = node('p', 'hl-np-error-title', '재생을 계속할 수 없습니다');
        const errorText = node('p', 'hl-np-error-text');
        errorText.setAttribute('role', 'alert');
        const retryAction = action('다시 시도', 'onRetry', 'hangul-retry-action', 'retry', 'hl-np-retry');
        retryAction.append(node('span', '', '다시 시도')); errorCard.append(errorTitle, errorText, retryAction);

        const original = node('a', 'hl-np-original'); original.dataset.testid = 'hangul-original-action';
        original.target = '_blank'; original.rel = 'noopener noreferrer';
        original.append(node('span', '', 'YouTube에서 보기'), icon('external'));
        listen(original, 'click', event => {
            if (typeof callbacks.onOriginal === 'function') { event.preventDefault(); invoke('onOriginal'); }
        });
        element.append(header, media, info, modeGroup, status, actions, errorCard, notice, original);

        let disposed = false, lastTrack = null, lastMode = null, animation = null;
        let currentVideoId = null;
        function showActionError(error) {
            if (disposed) return;
            errorText.textContent = error instanceof Error ? error.message : String(error || '다시 시도해 주세요.');
            errorCard.hidden = false;
        }
        function update(model = {}) {
            if (disposed) return;
            const track = model.track || {}, state = model.state || {};
            const videoId = VIDEO_ID.test(String(track.videoId || '')) ? String(track.videoId) : null;
            const hasTrack = !!videoId;
            const mode = model.mediaMode === 'direct' ? 'audio' : 'video';
            const preferred = model.preferredMode === 'audio' ? 'audio' : 'video';
            const loading = model.loading === true || model.mediaLoading === true;
            const error = typeof model.error === 'string' ? model.error : '';
            element.dataset.mode = mode;
            element.dataset.loading = String(loading);
            element.dataset.playing = String(model.playing === true);
            element.dataset.track = videoId || '';
            element.dataset.error = String(!!error);
            mediaAnchor.setAttribute('aria-busy', String(loading));
            art.hidden = mode !== 'audio'; mediaAnchor.hidden = mode !== 'video';
            setText(title, hasTrack ? String(track.title || videoId) : '곡을 선택하세요');
            title.title = title.textContent;
            setText(artist, hasTrack ? String(track.artist || 'YouTube') : '재생목록에서 듣고 싶은 곡을 선택하세요.');
            setText(sourceMode, mode === 'audio' ? (model.fallback ? '음원으로 대체 재생' : '음원 재생') : '영상 재생');
            audioMode.setAttribute('aria-pressed', String(preferred === 'audio'));
            videoMode.setAttribute('aria-pressed', String(preferred === 'video'));
            lyricsAction.disabled = searchAction.disabled = !hasTrack;
            original.hidden = !hasTrack;
            if (videoId !== currentVideoId) {
                currentVideoId = videoId;
                art.dataset.ready = 'false'; art.dataset.failed = 'false';
                if (videoId) {
                    const url = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
                    image.src = url; backdrop.style.backgroundImage = 'url("' + url + '")';
                    original.href = 'https://www.youtube.com/watch?v=' + videoId;
                } else {
                    image.removeAttribute('src'); original.removeAttribute('href'); backdrop.style.backgroundImage = '';
                }
            }
            const stateText = !hasTrack ? '재생 대기' : error ? '연결을 확인해 주세요' : loading
                ? (mode === 'audio' ? '음원을 불러오는 중' : '영상을 불러오는 중')
                : model.playing ? '재생 중' : '일시정지';
            if (statusLabel.textContent !== stateText) statusLabel.textContent = stateText;
            let qualityText = '';
            if (mode === 'audio' && !loading && !error && hasTrack) {
                const codec = String(state.codec || 'Opus').slice(0, 16);
                qualityText = codec;
                const bitrate = Number(state.bitrate);
                if (Number.isFinite(bitrate) && bitrate > 0) qualityText += ' · 약 ' + Math.round(bitrate) + ' kbps';
                quality.title = '제공된 음원 메타데이터 기준이며 실제 수신 속도 측정값은 아닙니다.';
            } else if (mode === 'video' && !loading && !error && hasTrack) {
                qualityText = ({ hd2160: '2160p', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p' })[state.quality] || '자동 화질';
                quality.title = 'YouTube 플레이어의 현재 영상 화질';
            }
            setText(quality, qualityText); quality.hidden = !qualityText;
            setText(noticeText, mode === 'video'
                ? '영상에는 YouTube 광고가 나올 수 있습니다. 건너뛰기는 플레이어에서 조작하세요.'
                : model.fallback
                    ? '외부 영상 재생이 제한되어 이 영상은 음원으로 재생 중입니다.'
                    : '공개 음원을 스트리밍합니다. 영상에 따라 재생이 제한될 수 있습니다.');
            errorCard.hidden = !error; setText(errorText, error);
            retryAction.disabled = loading || !hasTrack;
            const reduced = host.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
            if ((videoId !== lastTrack || mode !== lastMode) && !reduced && hasTrack) {
                animation?.cancel?.();
                // Media controls remain stationary and uncovered. Only text
                // enters; playback-clock updates never restart this animation.
                animation = info.animate?.([{ opacity: 0.45, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.6,.2,1)' });
            }
            lastTrack = videoId; lastMode = mode;
        }
        update();
        return {
            element, mediaAnchor,
            update,
            dispose() {
                if (disposed) return;
                disposed = true; animation?.cancel?.();
                for (const remove of ownedListeners) remove();
                // Removing the caller's live iframe is deliberately not part of
                // presentation cleanup; its owner decides the media lifetime.
            },
        };
    }
    const api = { create };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') window.SpotifyHangulNowPlaying = api;
})();
