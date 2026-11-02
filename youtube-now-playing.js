/** @file youtube-now-playing.js
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
    // Every string the panel shows: English by default, Korean when Spotify's UI is Korean.
    const STRINGS = {
        en: {
            panel_label: 'YouTube now playing', heading: 'Now playing', queue: 'Show queue',
            close: 'Stop link playback', close_title: 'Stop link playback and go back to Spotify', video_base: 'YouTube video',
            no_track_title: 'Pick a song', no_track_artist: 'Pick a song you want to hear from the queue.',
            modes_label: 'YouTube playback mode', mode_audio: 'Audio', mode_video: 'Video',
            mode_audio_label: 'Play audio', mode_video_label: 'Play video',
            lyrics_label: 'Open lyrics in ivLyrics', lyrics: 'Open lyrics', search_label: 'Edit lyrics search info',
            error_title: "Playback can't continue", retry: 'Try again', error_retry: 'Please try again.', original: 'Watch on YouTube',
            source_audio: 'Audio', source_fallback: 'Audio instead of video', source_video: 'Video',
            state_idle: 'Waiting to play', state_error: 'Check your connection', state_loading_audio: 'Loading audio',
            state_loading_video: 'Loading video', state_playing: 'Playing', state_paused: 'Paused',
            quality_bitrate: '%1 · about %2 kbps',
            quality_audio_title: 'Based on the metadata the audio source gave, not a measure of the actual download speed.',
            quality_auto: 'Auto quality', quality_video_title: "The YouTube player's current video quality",
            notice_video: 'YouTube may show ads in videos. Skip them in the player.',
            notice_fallback: "This video can't be played outside YouTube, so its audio plays instead.",
            notice_audio: 'Streams public audio. Some videos may not play.',
        },
        ko: {
            panel_label: 'YouTube 현재 재생 중', heading: '지금 재생 중', queue: '재생목록 보기',
            close: '링크 재생 종료', close_title: '링크 재생을 종료하고 Spotify로 돌아가기', video_base: 'YouTube 영상',
            no_track_title: '곡을 선택하세요', no_track_artist: '재생목록에서 듣고 싶은 곡을 선택하세요.',
            modes_label: 'YouTube 재생 방식', mode_audio: '음원', mode_video: '영상',
            mode_audio_label: '음원 재생', mode_video_label: '영상 재생',
            lyrics_label: 'ivLyrics 가사 열기', lyrics: '가사 열기', search_label: '가사 검색 정보 수정',
            error_title: '재생을 계속할 수 없습니다', retry: '다시 시도', error_retry: '다시 시도해 주세요.', original: 'YouTube에서 보기',
            source_audio: '음원 재생', source_fallback: '음원으로 대체 재생', source_video: '영상 재생',
            state_idle: '재생 대기', state_error: '연결을 확인해 주세요', state_loading_audio: '음원을 불러오는 중',
            state_loading_video: '영상을 불러오는 중', state_playing: '재생 중', state_paused: '일시정지',
            quality_bitrate: '%1 · 약 %2 kbps',
            quality_audio_title: '제공된 음원 메타데이터 기준이며 실제 수신 속도 측정값은 아닙니다.',
            quality_auto: '자동 화질', quality_video_title: 'YouTube 플레이어의 현재 영상 화질',
            notice_video: '영상에는 YouTube 광고가 나올 수 있습니다. 건너뛰기는 플레이어에서 조작하세요.',
            notice_fallback: '외부 영상 재생이 제한되어 이 영상은 음원으로 재생 중입니다.',
            notice_audio: '공개 음원을 스트리밍합니다. 영상에 따라 재생이 제한될 수 있습니다.',
        },
    };
    // The language is read on each call, so a later Spotify language change shows on the next update.
    function translate(host, key, ...args) {
        const locale = host.Spicetify?.Locale?.getLocale?.() || host.navigator?.language;
        const lang = /^ko(?:[-_]|$)/i.test(String(locale || '')) ? 'ko' : 'en';
        const text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
        return text.replace(/%(\d)/g, (mark, n) => args[n - 1] === undefined ? mark : String(args[n - 1]));
    }
    function create(host, callbacks = {}) {
        const doc = host.document;
        if (!doc?.createElement) throw new TypeError('A document is required for the current-track panel.');
        const t = (key, ...args) => translate(host, key, ...args);
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
        element.setAttribute('aria-label', t('panel_label'));
        const header = node('header', 'hl-np-header');
        const heading = node('h2', 'hl-np-heading', t('heading'));
        const headerActions = node('div', 'hl-np-header-actions');
        const queueAction = action(t('queue'), 'onQueue', 'hangul-queue-action', 'queue', 'hl-np-icon-button');
        const closeAction = action(t('close'), 'onClose', 'hangul-close-action', 'close', 'hl-np-icon-button');
        closeAction.title = t('close_title');
        headerActions.append(queueAction, closeAction); header.append(heading, headerActions);

        // This node remains stable for the entire component lifetime. The caller
        // owns the existing iframe and may place it here once or dock by geometry.
        const media = node('div', 'hl-np-media-surface');
        const mediaAnchor = node('div', 'hl-np-media');
        mediaAnchor.dataset.testid = 'hangul-media-anchor';
        const videoBase = node('div', 'hl-np-video-base');
        videoBase.setAttribute('aria-hidden', 'true');
        videoBase.append(icon('youtube'), node('span', '', t('video_base')));
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
        const title = node('h3', 'hl-np-title', t('no_track_title')); title.dataset.testid = 'hangul-now-title';
        const artist = node('p', 'hl-np-artist'); artist.dataset.testid = 'hangul-now-artist';
        info.append(source, title, artist);

        const modeGroup = node('div', 'hl-np-modes');
        modeGroup.setAttribute('role', 'group'); modeGroup.setAttribute('aria-label', t('modes_label'));
        const modeButton = (mode, glyph) => {
            const control = node('button', 'hl-np-mode'); control.type = 'button';
            control.dataset.testid = 'hangul-mode-' + mode;
            control.setAttribute('aria-label', t('mode_' + mode + '_label'));
            control.append(icon(glyph), node('span', '', t('mode_' + mode)));
            listen(control, 'click', () => invoke('onMode', mode));
            return control;
        };
        const audioMode = modeButton('audio', 'music');
        const videoMode = modeButton('video', 'youtube'); modeGroup.append(audioMode, videoMode);

        const status = node('div', 'hl-np-status');
        status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const statusDot = node('span', 'hl-np-status-dot'); statusDot.setAttribute('aria-hidden', 'true');
        const statusLabel = node('span', 'hl-np-status-label');
        const quality = node('span', 'hl-np-quality'); status.append(statusDot, statusLabel, quality);
        const actions = node('div', 'hl-np-actions');
        const lyricsAction = action(t('lyrics_label'), 'onLyrics', 'hangul-lyrics-action', 'lyrics', 'hl-np-primary');
        lyricsAction.append(node('span', '', t('lyrics')));
        const searchAction = action(t('search_label'), 'onSearch', 'hangul-search-action', 'search', 'hl-np-icon-button hl-np-search-action');
        actions.append(lyricsAction, searchAction);

        const notice = node('div', 'hl-np-notice');
        notice.append(icon('info')); const noticeText = node('p'); notice.append(noticeText);
        const errorCard = node('div', 'hl-np-error'); errorCard.hidden = true;
        const errorTitle = node('p', 'hl-np-error-title', t('error_title'));
        const errorText = node('p', 'hl-np-error-text');
        errorText.setAttribute('role', 'alert');
        const retryAction = action(t('retry'), 'onRetry', 'hangul-retry-action', 'retry', 'hl-np-retry');
        retryAction.append(node('span', '', t('retry'))); errorCard.append(errorTitle, errorText, retryAction);

        const original = node('a', 'hl-np-original'); original.dataset.testid = 'hangul-original-action';
        original.target = '_blank'; original.rel = 'noopener noreferrer';
        original.append(node('span', '', t('original')), icon('external'));
        listen(original, 'click', event => {
            if (typeof callbacks.onOriginal === 'function') { event.preventDefault(); invoke('onOriginal'); }
        });
        element.append(header, media, info, modeGroup, status, actions, errorCard, notice, original);

        let disposed = false, lastTrack = null, lastMode = null, animation = null;
        let currentVideoId = null;
        function showActionError(error) {
            if (disposed) return;
            errorText.textContent = error instanceof Error ? error.message : String(error || t('error_retry'));
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
            setText(title, hasTrack ? String(track.title || videoId) : t('no_track_title'));
            title.title = title.textContent;
            setText(artist, hasTrack ? String(track.artist || 'YouTube') : t('no_track_artist'));
            setText(sourceMode, mode === 'audio' ? t(model.fallback ? 'source_fallback' : 'source_audio') : t('source_video'));
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
            const stateText = t(!hasTrack ? 'state_idle' : error ? 'state_error' : loading
                ? (mode === 'audio' ? 'state_loading_audio' : 'state_loading_video')
                : model.playing ? 'state_playing' : 'state_paused');
            if (statusLabel.textContent !== stateText) statusLabel.textContent = stateText;
            let qualityText = '';
            if (mode === 'audio' && !loading && !error && hasTrack) {
                const codec = String(state.codec || 'Opus').slice(0, 16);
                qualityText = codec;
                const bitrate = Number(state.bitrate);
                if (Number.isFinite(bitrate) && bitrate > 0) qualityText = t('quality_bitrate', codec, Math.round(bitrate));
                quality.title = t('quality_audio_title');
            } else if (mode === 'video' && !loading && !error && hasTrack) {
                qualityText = ({ hd2160: '2160p', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p' })[state.quality] || t('quality_auto');
                quality.title = t('quality_video_title');
            }
            setText(quality, qualityText); quality.hidden = !qualityText;
            setText(noticeText, t(mode === 'video' ? 'notice_video' : model.fallback ? 'notice_fallback' : 'notice_audio'));
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
