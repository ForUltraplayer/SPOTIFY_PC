/** @file youtube-ivlyrics.js
 * @brief Adapt link playback to ivLyrics identity, clock, providers and cache without changing native Spotify player state.
 */
(() => {
    'use strict';
    // Every text the YouTube lyrics bridge shows. English is the default; Korean when Spotify's UI is Korean.
    const STRINGS = {
        en: {
            lrclib_credit: 'LRCLIB · Lyrics follow the original song and their timing can differ from a cover.',
            server_status: 'Lyrics server answered: %1',
            not_found: 'Check the lyrics search info. No lyrics were found for that title.',
            empty_lyrics: 'The lyrics source has no lines to show.',
            play_first: 'Play a YouTube song first.',
        },
        ko: {
            lrclib_credit: 'LRCLIB · 원곡 기준 가사이며 커버의 시간과 다를 수 있습니다.',
            server_status: '가사 서버 응답: %1',
            not_found: '가사 검색 정보를 확인해 주세요. 해당 제목으로 가사를 찾지 못했습니다.',
            empty_lyrics: '가사 제공 자료에 표시할 문장이 없습니다.',
            play_first: 'YouTube 곡을 먼저 재생해 주세요.',
        },
    };
    // The language is read on each call, from Spotify's locale and then the browser's.
    function translate(host, key, ...args) {
        const lang = /^ko(?:[-_]|$)/i.test(String(host.Spicetify?.Locale?.getLocale?.() || host.navigator?.language || '')) ? 'ko' : 'en';
        const text = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
        return text.replace(/%(\d)/g, (mark, n) => args[n - 1] === undefined ? mark : String(args[n - 1]));
    }
    const videoId = uri => String(uri || '').match(/^youtube:video:([\w-]{11})$/)?.[1] || null;
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const finiteSeconds = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const primaryArtist = value => normalize(String(value || '').split(/\s*(?:\bfeat\.?|\bfeaturing\b|[,&/、])\s*/i)[0]);
    function searchInfo(item = {}) {
        if (item.lyricTitle) return { title: item.lyricTitle, artist: item.lyricArtist || '' };
        const bracket = String(item.title || '').match(/[\[【]([^\]】]*[\u3040-\u30ff\u3400-\u9fff][^\]】]*)[\]】]/);
        if (bracket) {
            const parts = bracket[1].split(/\s+[|l｜]\s+/);
            return { title: parts[0].trim(), artist: parts[1]?.trim() || '' };
        }
        // A Hangul title followed by a Japanese alias is common in cover
        // uploads. Parenthesized credits and version labels are not aliases.
        const alias = String(item.title || '').match(/^[^()（）]*[\uac00-\ud7a3][^()（）]*[（(]([^()（）]+)[）)]/);
        if (alias) {
            const text = alias[1].trim();
            const japaneseLetters = text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || [];
            const metadata = /(?:^|\W)(?:cover(?:ed)?|feat(?:uring)?\.?|ver(?:sion)?\.?|live|remix|karaoke|instrumental)(?:$|\W)|歌ってみた|カバー|バージョン|ライブ|オフボーカル|インスト|日本語版|韓国語版|英語版|原曲[:：]|本家[:：]/i;
            if (japaneseLetters.length >= 2 && !/[\uac00-\ud7a3]/.test(text) && !metadata.test(text))
                return { title: text, artist: '' };
        }
        const title = String(item.title || '').replace(/\s*\/.*(?:cover|歌ってみた).*$/i, '')
            .replace(/\s*[-–|]?\s*(?:cover(?:ed)?\s*(?:by\s+.*)?|歌ってみた)\s*$/i, '').trim();
        return { title, artist: '' };
    }
    function parseLyrics(result, uri) {
        const synced = [];
        for (const line of String(result.syncedLyrics || '').split('\n')) {
            const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
            const text = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
            if (text) for (const stamp of stamps) {
                const minutes = Number(stamp[1]), seconds = Number(stamp[2]);
                if (Number.isFinite(minutes) && seconds < 60) synced.push({ startTime: Math.round((minutes * 60 + seconds) * 1000), text });
            }
        }
        synced.sort((a, b) => a.startTime - b.startTime);
        const unsynced = String(result.plainLyrics || '').split('\n').map(text => ({ text: text.trim() })).filter(line => line.text);
        return { uri, provider: 'youtube-lrclib', synced, unsynced, karaoke: null,
            copyright: translate(globalThis, 'lrclib_credit') };
    }
    function chooseResult(results, info, duration) {
        const title = normalize(info.title), artist = normalize(info.artist);
        if (!title || !Array.isArray(results)) return null;
        const expectedArtist = primaryArtist(info.artist);
        return results.filter(r => r && typeof r === 'object' && (String(r.syncedLyrics || '').trim() || String(r.plainLyrics || '').trim())
            && (!artist || normalize(r.artistName) === artist || primaryArtist(r.artistName) === expectedArtist)).map(r => {
            const name = normalize(r.trackName);
            const titleScore = name === title ? 100 : name.length >= 4 && title.includes(name) ? 60 : 0;
            return { result: r, score: titleScore + (artist && normalize(r.artistName) === artist ? 30 : 0)
                + (r.syncedLyrics ? 5 : 0) - Math.min(20, Math.abs((Number(r.duration) || duration) - duration) / 5), titleScore };
        }).filter(r => r.titleScore > 0).sort((a, b) => b.score - a.score)[0]?.result || null;
    }
    function create(host, options = {}) {
        let current = null, clock = { seconds: 0, duration: 0, playing: false }, sampledAt = 0, disposed = false, generation = 0;
        let animationSample = { manager: null, uri: null, position: null, playing: false };
        let overlaySync = { service: null, identity: null };
        // A native Spotify song whose sound comes from elsewhere (an extension's audio): same identity, another clock.
        let external = null, externalAt = 0;
        const hooks = [], controllers = new Map(), cache = new Map(), inflight = new Map(), backgroundImages = new Map();
        const now = () => host.performance?.now?.() ?? Date.now();
        const scheduleTimeout = options.setTimeout || setTimeout, cancelTimeout = options.clearTimeout || clearTimeout;
        const service = () => host.LyricsService;
        const t = (key, ...args) => translate(host, key, ...args);
        const item = () => {
            if (!current) return null;
            const duration = Math.round((clock.duration || current.duration || 0) * 1000);
            const title = String(current.title || current.videoId), artist = String(current.artist || 'YouTube');
            const image = 'https://i.ytimg.com/vi/' + current.videoId + '/hqdefault.jpg';
            return { uri: 'youtube:video:' + current.videoId, name: title,
                artists: [{ name: artist }], album: { name: 'YouTube', images: [{ url: image }] },
                duration: { milliseconds: duration }, metadata: { title,
                    artist_name: artist, album_title: 'YouTube', duration: String(duration),
                    image_url: image, image_xlarge_url: image, image_large_url: image } };
        };
        const position = () => Math.max(0, Math.min((clock.duration || Infinity) * 1000,
            clock.seconds * 1000 + (clock.playing ? Math.min(1500, Math.max(0, now() - sampledAt)) : 0)));
        const snapshot = () => { const track = item(); return track ? { uri: track.uri, item: track,
            position: position(), duration: track.duration.milliseconds, isPlaying: clock.playing,
            isLocal: true, automix: false, djNarration: false, source: 'youtube-link',
            playbackId: track.uri, identityKey: track.uri, sampledAt: now() } : null; };
        // The external clock applies only while Spotify still shows that song.
        const externalClock = () => !current && external && host.Spicetify?.Player?.data?.item?.uri === external.uri ? external : null;
        const externalPosition = () => Math.max(0, Math.min((external.duration || Infinity) * 1000,
            external.seconds * 1000 + (external.playing ? Math.min(1500, Math.max(0, now() - externalAt)) : 0)));
        const withExternalClock = value => {
            const clockNow = externalClock();
            if (!clockNow || !value || typeof value !== 'object' || value.uri !== clockNow.uri) return value;
            return { ...value, position: externalPosition(), isPlaying: clockNow.playing, sampledAt: now() };
        };
        function wrap(object, name, handler) {
            if (!object || typeof object[name] !== 'function' || hooks.some(h => h.object === object && h.name === name && object[name] === h.wrapped)) return;
            const original = object[name];
            const wrapped = function (...args) { return handler.call(this, original, args); };
            object[name] = wrapped; hooks.push({ object, name, original, wrapped });
        }
        // ivLyrics makes a new container for every visit of its page. The hooks of one that closed are undone and
        // dropped, and so are hooks whose function was replaced since: kept, they would hold every closed page and its
        // lyrics DOM for as long as Spotify runs.
        let wrappedContainer = null;
        function releaseClosed(container) {
            const closed = wrappedContainer && wrappedContainer !== container ? wrappedContainer : null;
            for (let i = hooks.length - 1; i >= 0; i--) {
                const hook = hooks[i], live = hook.object[hook.name] === hook.wrapped;
                if (live && hook.object !== closed) continue;
                if (live) hook.object[hook.name] = hook.original;
                hooks.splice(i, 1);
            }
            wrappedContainer = container || null;
        }
        const cacheId = uri => videoId(uri) ? 'youtube-' + videoId(uri) : null;
        const profileKey = track => track ? JSON.stringify([track.videoId, searchInfo(track).title, searchInfo(track).artist]) : '';
        function cancelRequests() {
            generation += 1;
            for (const controller of controllers.values()) controller.abort();
            controllers.clear(); inflight.clear();
        }
        function retryDelay(signal) {
            return new Promise((resolve, reject) => {
                if (signal.aborted) { reject(new DOMException('Track changed', 'AbortError')); return; }
                const abort = () => { cancelTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Track changed', 'AbortError')); };
                const timer = scheduleTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
                signal.addEventListener('abort', abort, { once: true });
            });
        }
        function wakeLyricsAnimation() {
            // Pages.js's shared animation manager idles from the native
            // Spotify paused flag, even when its lyric clock is external.
            // Its existing wake boundary keeps callbacks alive without
            // changing Player.data, backend state or the animation scheduler.
            const manager = host.AnimationManager, clockNow = externalClock(), uri = item()?.uri || clockNow?.uri || null;
            const playing = current ? clock.playing : !!clockNow?.playing;
            const playbackPosition = Math.round(current ? position() : clockNow ? externalPosition() : 0);
            if ((current || clockNow) && (playing || animationSample.manager !== manager || animationSample.uri !== uri
                || animationSample.position !== playbackPosition || animationSample.playing !== playing))
                manager?.wake?.();
            animationSample = { manager, uri, position: playbackPosition, playing };
        }
        function syncOverlay(force = false) {
            const overlayService = host.ivLyricsOverlayService;
            if (typeof overlayService?.syncNow !== 'function' || (!current && !force)) return;
            const identity = current ? profileKey(current) : 'native:' + (host.Spicetify?.Player?.data?.item?.uri || '');
            if (!force && overlaySync.service === overlayService && overlaySync.identity === identity) return;
            // Mark before scheduling to avoid reentrant or per-tick refreshes.
            overlaySync = { service: overlayService, identity };
            try { Promise.resolve(overlayService.syncNow()).catch(() => {}); } catch { /* The service owns reconnection. */ }
        }
        function overlayHiddenByFullscreen() {
            const configured = host.CONFIG?.visual?.['fullscreen-hide-overlay'];
            const stored = () => host.ivLyricsStoragePersistence?.getItem?.('ivLyrics:visual:fullscreen-hide-overlay')
                ?? host.Spicetify?.LocalStorage?.get?.('ivLyrics:visual:fullscreen-hide-overlay');
            const enabled = configured !== undefined ? configured !== false && configured !== 'false' : stored() !== 'false';
            const fullscreen = host.document?.getElementById?.('lyrics-fullscreen-container');
            return enabled && !!(fullscreen && host.document?.body?.contains?.(fullscreen)
                && fullscreen.querySelector?.('.lyrics-lyricsContainer-LyricsContainer.fullscreen-active'));
        }
        function paintCurrentArtwork(container) {
            const track = item();
            if (!track || container?.currentTrackUri !== track.uri) return;
            const mode = container.getEffectiveBackgroundMode?.();
            if (mode && mode !== 'gradient-background') return;
            const node = container.containerRef?.current?.querySelector?.('#ivLyrics-gradient-background');
            // Replace an existing album-image background only. Solid, video
            // and color-gradient settings must not gain an image implicitly.
            if (!node?.style?.backgroundImage || node.style.backgroundImage === 'none') return;
            for (const old of backgroundImages.keys()) if (old.isConnected === false) backgroundImages.delete(old);
            const image = 'url("' + track.metadata.image_url + '")';
            if (node.style.backgroundImage === image) return;
            const saved = backgroundImages.get(node) || { original: node.style.backgroundImage };
            saved.written = image; backgroundImages.set(node, saved); node.style.backgroundImage = image;
        }
        function restoreArtwork() {
            for (const [node, saved] of backgroundImages) if (node.isConnected !== false && node.style?.backgroundImage === saved.written)
                node.style.backgroundImage = saved.original;
            backgroundImages.clear();
        }
        function install() {
            if (disposed) return;
            const utils = host.Utils, lyrics = service(), container = host.lyricContainer;
            releaseClosed(container);
            wrap(utils, 'getSafePlayerProgress', (original, args) => current ? position() : externalClock() ? externalPosition() : original.apply(utils, args));
            wrap(utils, 'getPlayerPlaybackSnapshot', (original, args) => snapshot() || withExternalClock(original.apply(utils, args)));
            wrap(utils, 'resolveStablePlaybackTrack', (original, args) => item() || original.apply(utils, args));
            wrap(utils, 'isSpotifyAutomixPlayback', (original, args) => current ? false : original.apply(utils, args));
            wrap(utils, 'isSpotifyDjNarrationPlayback', (original, args) => current ? false : original.apply(utils, args));
            for (const object of [utils, lyrics]) wrap(object, 'getTranslationCacheId', (original, args) => cacheId(args[0]) || original.apply(object, args));
            wrap(lyrics, 'getCurrentTrackInfo', (original, args) => {
                const track = item(); return track ? { uri: track.uri, title: track.name, artist: track.metadata.artist_name,
                    album: 'YouTube', duration: track.duration.milliseconds, trackId: null } : original.apply(lyrics, args);
            });
            wrap(lyrics, 'getLyricsFromProviders', (original, args) => videoId(args[0]?.uri) ? getLyrics(args[0]) : original.apply(lyrics, args));
            const overlaySender = host.OverlaySender;
            wrap(overlaySender, 'sendProgressPayload', function (original, args) {
                const playback = snapshot(), [endpoint, payload, trackUri] = args, clockNow = externalClock();
                if (!playback && clockNow && trackUri === clockNow.uri && payload && typeof payload === 'object') {
                    const at = Math.round(externalPosition()), length = Math.round((clockNow.duration || 0) * 1000) || Number(payload.duration) || 0;
                    return original.call(this, endpoint, { ...payload, position: at, ...(length ? { duration: length, remaining: Math.max(0, length - at) } : {}),
                        isPlaying: clockNow.playing && !overlayHiddenByFullscreen() }, trackUri);
                }
                if (!playback || trackUri !== playback.uri || !payload || typeof payload !== 'object'
                    || (payload.trackUri && payload.trackUri !== playback.uri)
                    || (payload.currentTrack?.uri && payload.currentTrack.uri !== playback.uri)) return original.apply(this, args);
                const position = Math.round(playback.position), duration = Math.round(playback.duration);
                return original.call(this, endpoint, { ...payload, trackUri: playback.uri, position, duration,
                    ...(payload.currentTrack && typeof payload.currentTrack === 'object'
                        ? { currentTrack: { ...payload.currentTrack, title: item().name,
                            artist: item().metadata.artist_name, albumArt: item().metadata.image_url } } : {}),
                    remaining: Math.max(0, duration - position), isPlaying: playback.isPlaying && !overlayHiddenByFullscreen() }, trackUri);
            });
            wrap(overlaySender, 'queueLyricsSend', function (original, args) {
                const track = item(), [endpoint, uri, payload, deliveryContext] = args;
                if (!track || uri !== track.uri || !payload?.track || typeof payload.track !== 'object'
                    || (payload.trackUri && payload.trackUri !== track.uri)
                    || (payload.track.uri && payload.track.uri !== track.uri)) return original.apply(this, args);
                return original.call(this, endpoint, uri, { ...payload, track: { ...payload.track,
                    title: track.name, artist: track.metadata.artist_name,
                    album: track.album.name, albumArt: track.metadata.image_url, duration: track.duration.milliseconds } }, deliveryContext);
            });
            wrap(container, 'getPlaybackPaused', (original, args) => current ? !clock.playing : externalClock() ? !external.playing : original.apply(container, args));
            wrap(container, 'getCurrentPlayerTrackInfo', (original, args) => {
                const track = item(); return track && container.infoFromTrack ? container.infoFromTrack(track) : original.apply(container, args);
            });
            wrap(container, 'getSyncCreatorTrackInfo', (original, args) => item() || original.apply(container, args));
            wrap(container, 'getShareImageTrackInfo', (original, args) => current ? { name: item().name,
                artist: item().metadata.artist_name, cover: item().metadata.image_url } : original.apply(container, args));
            wrap(container, 'fetchColors', function (original, args) {
                const track = item();
                if (!track || args[0] !== track.uri || this.currentTrackUri !== track.uri) return original.apply(this, args);
                // The native extractor takes a Spotify catalog URI. Use the
                // confirmed public thumbnail and a neutral palette instead of
                // retaining another recording's art/colors or inventing a
                // Spotify catalog identity for this external source.
                this.setState?.({ coverUrl: track.metadata.image_url, colorsUri: track.uri,
                    colors: { background: 'rgb(18, 18, 18)', inactive: 'rgb(179, 179, 179)' }, dynamicColors: null });
                paintCurrentArtwork(this); return Promise.resolve();
            });
            wrap(container, 'componentDidUpdate', function (original, args) {
                const result = original.apply(this, args); paintCurrentArtwork(this); return result;
            });
            for (const name of ['fetchTempo', 'fetchMetadataTranslation', 'loadSavedVideoForTrack'])
                wrap(container, name, (original, args) => videoId(args[0]) ? Promise.resolve() : original.apply(container, args));
            // The page open when reload is called, not the one open when it was wrapped.
            const reload = (original, args) => { const page = host.lyricContainer;
                return current && page?.fetchLyrics ? page.fetchLyrics(item(), -1, args[0] !== false) : original.apply(page, args); };
            wrap(container, 'reloadLyrics', reload); wrap(host, 'reloadLyrics', reload);
            if (current && container && container.currentTrackUri !== item().uri)
                container.schedulePlaybackTrackResolution?.(item());
            container?.updatePlaybackPausedState?.();
            paintCurrentArtwork(container);
            wakeLyricsAnimation();
            syncOverlay();
        }
        async function getLyrics(info) {
            if (!current || videoId(info?.uri) !== current.videoId) return { uri: info?.uri, error: 'YouTube track changed' };
            const profile = searchInfo(current), cacheKey = info.uri + '\n' + profile.title + '\n' + profile.artist;
            const requestGeneration = generation, key = generation + '\n' + cacheKey;
            if (cache.has(cacheKey)) return cache.get(cacheKey);
            if (inflight.has(key)) return inflight.get(key);
            const controller = new AbortController(); controllers.set(key, controller);
            const timeout = scheduleTimeout(() => controller.abort(), 20000);
            const job = (async () => {
                let retriesLeft = 3;
                const assertCurrent = () => { if (controller.signal.aborted || generation !== requestGeneration) throw new DOMException('Track changed', 'AbortError'); };
                const fetchSearch = async query => {
                    for (;;) {
                        assertCurrent();
                        let response, networkError;
                        try {
                            response = await (options.fetch || host.fetch).call(host, 'https://lrclib.net/api/search?' + new URLSearchParams(query), { signal: controller.signal });
                        } catch (error) {
                            if (error?.name === 'AbortError') throw error;
                            networkError = error;
                        }
                        assertCurrent();
                        const transient = networkError || response?.status === 429 || (response?.status >= 500 && response?.status <= 599);
                        if (!transient) return response;
                        if (retriesLeft <= 0) throw networkError || Error(t('server_status', response.status));
                        retriesLeft -= 1;
                        await retryDelay(controller.signal);
                    }
                };
                // LRCLIB's title-only structured search can fail for some
                // Japanese titles; its documented free-text query avoids that
                // endpoint shape while candidates still require a title match.
                const queries = profile.artist
                    ? [{ track_name: profile.title, artist_name: profile.artist }, { q: profile.title }]
                    : [{ q: profile.title }];
                let selected;
                for (const query of queries) {
                    const response = await fetchSearch(query);
                    if (!response.ok) throw Error(t('server_status', response.status));
                    selected = chooseResult(await response.json(), profile, clock.duration || current?.duration || 0);
                    if (selected) break;
                }
                if (controller.signal.aborted || generation !== requestGeneration || videoId(info.uri) !== current?.videoId) throw new DOMException('Track changed', 'AbortError');
                if (!selected) return { uri: info.uri, error: t('not_found') };
                const result = parseLyrics(selected, info.uri);
                if (!result.synced.length && !result.unsynced.length) return { uri: info.uri, error: t('empty_lyrics') };
                cache.set(cacheKey, result);
                while (cache.size > 40) cache.delete(cache.keys().next().value);
                const display = item();
                service()?.publishLyricsSnapshot?.({ trackUri: info.uri, trackInfo: { ...info, uri: display.uri,
                    title: display.name, artist: display.metadata.artist_name, album: display.album.name,
                    duration: display.duration.milliseconds }, rawResult: result,
                    provider: result.provider, source: 'lyrics-service' });
                return result;
            })().finally(() => { cancelTimeout(timeout); if (controllers.get(key) === controller) controllers.delete(key); inflight.delete(key); });
            inflight.set(key, job); return job;
        }
        const timer = (options.setInterval || host.setInterval).call(host, install, 500);
        return {
            install, currentTrack: item, snapshot, getLyrics,
            update(track, state) {
                if (disposed) return;
                if (track && !/^[\w-]{11}$/.test(track.videoId || '')) throw new TypeError('Invalid YouTube video identity');
                const previous = profileKey(current);
                current = track ? { ...track } : null;
                clock = { seconds: finiteSeconds(state?.seconds), duration: finiteSeconds(state?.duration) || finiteSeconds(track?.duration),
                    playing: state?.playing === true };
                sampledAt = now();
                if (previous !== profileKey(current)) cancelRequests();
                install();
            },
            /** The clock of the native song [clock.uri] while its sound plays elsewhere; null gives the clock back to Spotify. */
            setExternalClock(value) {
                if (disposed) return;
                const had = !!external;
                external = value && typeof value.uri === 'string' ? { uri: value.uri, seconds: finiteSeconds(value.seconds),
                    duration: finiteSeconds(value.duration), playing: value.playing === true } : null;
                externalAt = now();
                if (had && !external) { host.Utils?.clearSafePlayerProgressCorrection?.(); host.AnimationManager?.wake?.(); }
                host.lyricContainer?.updatePlaybackPausedState?.();
                if (external) install();
            },
            deactivate() {
                const hadTrack = !!current; current = null;
                cancelRequests();
                restoreArtwork();
                if (hadTrack) { host.Utils?.clearSafePlayerProgressCorrection?.();
                    host.lyricContainer?.schedulePlaybackTrackResolution?.(host.Spicetify?.Player?.data?.item || null);
                    host.lyricContainer?.updatePlaybackPausedState?.(); host.AnimationManager?.wake?.(); syncOverlay(true); }
                animationSample = { manager: null, uri: null, position: null, playing: false };
            },
            async reload() {
                if (!current) return;
                const track = item(); cancelRequests();
                const reloadGeneration = generation;
                cache.clear(); service()?.clearLyricsSnapshot?.(track.uri);
                await service()?.clearTrackCache?.(cacheId(track.uri));
                if (current?.videoId === videoId(track.uri) && generation === reloadGeneration) {
                    await host.lyricContainer?.fetchLyrics?.(item(), -1, true);
                    if (current?.videoId === videoId(track.uri) && generation === reloadGeneration) syncOverlay(true);
                }
            },
            open() { if (!current) throw Error(t('play_first')); install();
                if (String(host.Spicetify.Platform.History.location?.pathname || '').toLowerCase() !== '/ivlyrics')
                    host.Spicetify.Platform.History.push('/ivLyrics'); },
            dispose() {
                if (disposed) return; this.deactivate(); disposed = true;
                (options.clearInterval || host.clearInterval)(timer);
                for (const hook of hooks.reverse()) if (hook.object[hook.name] === hook.wrapped) hook.object[hook.name] = hook.original;
            }
        };
    }
    const api = { create, searchInfo, parseLyrics, chooseResult, videoId };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') window.SpotifyHangulIvLyrics = api;
})();
