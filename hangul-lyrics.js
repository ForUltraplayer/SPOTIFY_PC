/** @file hangul-lyrics.js
 * @brief Display existing web-authored Hangul readings through ivLyrics' provider contract.
 */
(() => {
    'use strict';
    const ID = 'web-hangul';
    const BASE = 'http://127.0.0.1:19643';
    const PREFIX = 'ivLyrics:hangul-web:';
    let lastResult = null;
    const pendingResults = new Map();
    const inflightLookups = new Map();
    const trackResults = new Map();
    const automaticEnabled = () => storage().get(PREFIX + 'automatic-fallback') === 'true';
    const activeTrackId = () => window.LyricsService?.getTranslationCacheId?.(currentKey());
    function rememberResult(trackId, metadata) {
        lastResult = { ...metadata, trackId };
        if (trackId) {
            trackResults.set(trackId, lastResult);
            if (trackResults.size > 60) trackResults.delete(trackResults.keys().next().value);
        }
    }
    const currentResult = () => trackResults.get(activeTrackId()) || null;
    function ensureLinkPlayer() {
        if (window.SpotifyHangulLinks) return Promise.resolve();
        const document = window.document;
        if (!document?.head || !document.createElement) return Promise.resolve();
        if (window.SpotifyHangulLinkLoader?.promise) return window.SpotifyHangulLinkLoader.promise;
        const loader = { attempts: 0, loaded: false, promise: null };
        window.SpotifyHangulLinkLoader = loader;
        const url = BASE + '/youtube/extension.js';
        const loadScript = () => new Promise((resolve, reject) => {
            if (window.SpotifyHangulLinks) { resolve(); return; }
            const existing = document.querySelector?.('script[src="' + url + '"]');
            if (existing?.dataset?.hangulLoaded === 'true') { resolve(); return; }
            const script = existing || document.createElement('script');
            let complete = false;
            const finish = error => {
                if (complete) return;
                complete = true; clearTimeout(timer);
                script.removeEventListener?.('load', loaded);
                script.removeEventListener?.('error', failed);
                if (!existing) { script.onload = null; script.onerror = null; }
                if (error) { if (!existing) script.remove?.(); reject(error); }
                else { if (script.dataset) script.dataset.hangulLoaded = 'true'; resolve(); }
            };
            const loaded = () => finish();
            const failed = () => finish(new Error('YouTube 기능 모듈을 불러오지 못했습니다.'));
            const timer = setTimeout(() => finish(new Error('YouTube 기능 모듈 응답 시간이 초과됐습니다.')), 5000);
            if (existing) {
                script.addEventListener?.('load', loaded, { once: true });
                script.addEventListener?.('error', failed, { once: true });
            } else {
                script.src = url; script.onload = loaded; script.onerror = failed;
                document.head.append(script);
            }
        });
        loader.promise = (async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
                loader.attempts++;
                try {
                    const health = await request('/health', null, { timeoutMs: 1500 });
                    const capabilities = ['youtube-links-v1', 'mixed-playlists-v1', 'playback-control-v1', 'lyric-sync-v1'];
                    if (health.app !== 'ivLyricsHangul' || health.version !== addon.version || health.protocol !== 1 || !Array.isArray(health.capabilities)
                        || !capabilities.every(value => health.capabilities?.includes(value)))
                        throw new Error('도우미 버전이 다릅니다. Spotify 한글 가사를 종료한 뒤 다시 실행해 주세요.');
                    await loadScript(); loader.loaded = true; return;
                } catch (error) {
                    if (attempt === 3) {
                        // A helper that starts late (first run, antivirus scan) gets one fresh cycle every
                        // 30 s, at most 10 times, so YouTube features recover without restarting Spotify.
                        const recoveries = window.SpotifyHangulLinkRecoveries || 0;
                        if (recoveries < 10) {
                            window.SpotifyHangulLinkRecoveries = recoveries + 1;
                            setTimeout(() => {
                                if (window.SpotifyHangulLinkLoader !== loader) return;
                                window.SpotifyHangulLinkLoader = null;
                                void ensureLinkPlayer().catch(failure => console.warn('[SpotifyHangul] ' + failure.message));
                            }, 30000);
                        }
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        })();
        return loader.promise;
    }
    const lyricLookups = new Map();
    const mirrorCooldowns = new Map();
    const cleanLookupTitle = value => String(value || '')
        .replace(/\s*[(（[［]\s*(?:feat\.?|ft\.?|featuring)\s+[^)）\]］]+[)）\]］]/gi, '').trim();
    const identityKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const durationSeconds = value => {
        const parts = String(value ?? '').split(':').map(Number);
        return parts.every(Number.isFinite) ? parts.reduce((total, part) => total * 60 + part, 0) : 0;
    };
    function sameRecordingMetadata(metadata, info) {
        if (identityKey(cleanLookupTitle(metadata.title || metadata.name)) !== identityKey(cleanLookupTitle(info.title))) return false;
        const expected = identityKey(String(info.artist || '').split(',')[0]);
        const artists = String(metadata.artist || metadata.artistName || '').split(/[/,;]/)
            .map(value => identityKey(value.replace(/\s+feat\..*$/i, '')));
        if (!expected || !artists.includes(expected)) return false;
        const album = metadata.album || metadata.albumName;
        if (album && info.album && identityKey(album) !== identityKey(info.album)) return false;
        const duration = Number(info.durationMs ?? info.duration_ms ?? info.duration ?? 0);
        const expectedSeconds = duration > 10000 ? duration / 1000 : duration;
        const actual = metadata.durationMs ? Number(metadata.durationMs) / 1000 : durationSeconds(metadata.totalDuration);
        return !actual || !expectedSeconds || Math.abs(actual - expectedSeconds) <= 3;
    }
    function installLyricsPlusFallback() {
        const provider = window.LyricsAddonManager?.getAddon?.('lyricsplus');
        const parser = window.__ivLyricsPlusDebug;
        if (!provider?.getLyrics || !parser?.parseLyricsPayload || !parser?.resolveTrackIsrc || !parser?.buildLyricsUrl) return;
        if (provider.getLyrics.hangulMirrorFallback) return;
        const original = provider.getLyrics;
        const cacheVersion = `${provider.cacheVersion || 'lyricsplus'}-hangul-mirrors-2`;
        provider.cacheVersion = cacheVersion;
        const usable = result => ['karaoke', 'synced', 'unsynced'].some(key => result?.[key]?.length > 0);
        const wrapped = async function (info) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 18000);
            const attempts = [];
            const native = Promise.resolve().then(() => original.call(this, info));
            const load = async (base, url) => {
                const cooling = mirrorCooldowns.get(base);
                if (cooling?.until > Date.now()) {
                    attempts.push({ host: base, status: cooling.status, skipped: true });
                    return null;
                }
                const response = await fetch(String(url), { signal: controller.signal, credentials: 'omit' });
                attempts.push({ host: base, status: response.status || (response.ok ? 200 : 404) });
                if (response.status === 429 || response.status >= 500) {
                    const retry = response.headers?.get?.('Retry-After');
                    const seconds = Number(retry);
                    const delay = retry && !Number.isFinite(seconds) ? Date.parse(retry) - Date.now() : seconds * 1000;
                    mirrorCooldowns.set(base, { status: response.status,
                        until: Date.now() + Math.min(300000, Math.max(30000, delay || 60000)) });
                    return null;
                }
                return response.ok ? response.json() : null;
            };
            const extra = async () => {
                const isrc = await parser.resolveTrackIsrc(info);
                const cleaned = cleanLookupTitle(info.title);
                const candidates = [{ ...info }];
                const primaryArtist = String(info.artist || '').split(',')[0].trim();
                if (primaryArtist && primaryArtist !== info.artist) candidates.push({ ...info,
                    title: cleaned || info.title, artist: primaryArtist });
                if (cleaned && cleaned !== info.title) candidates.push({ ...info, title: cleaned });
                const nativeBases = parser.getApiBases?.() || [];
                // Exact recording metadata stays first. A cover's ISRC is never
                // attached to an original-song title or a different artist.
                for (let index = 0; index < candidates.length; index++) {
                    const candidate = candidates[index];
                    for (const base of ['https://lyricsplus.binimum.org', 'https://lyricsplus.prjktla.my.id']) {
                        if (index === 0 && !isrc && nativeBases.includes(base)) continue;
                        try {
                            const url = new URL(parser.buildLyricsUrl(base, candidate, null));
                            if (isrc) url.searchParams.set('isrc', isrc);
                            const payload = await load(base, url);
                            if (!payload) continue;
                            if (isrc && payload.metadata?.isrc && payload.metadata.isrc !== isrc) continue;
                            if (index > 0) {
                                let metadata = payload.metadata || {};
                                if (!metadata.title || !metadata.artist) {
                                    const identityUrl = new URL('/v1/metadata/get', base);
                                    identityUrl.searchParams.set('title', candidate.title);
                                    identityUrl.searchParams.set('artist', candidate.artist);
                                    const identity = await load(base, identityUrl);
                                    const found = identity?.metadata;
                                    if (!found || !metadata.source || found.source !== metadata.source) continue;
                                    metadata = { ...metadata, ...found };
                                }
                                if (!sameRecordingMetadata(metadata, info)) continue;
                            }
                            const duration = Number(info.durationMs ?? info.duration_ms ?? info.duration ?? 0);
                            const milliseconds = duration > 10000 ? duration : duration * 1000;
                            const parsed = parser.parseLyricsPayload(payload, milliseconds);
                            if (!usable(parsed)) continue;
                            if (index > 0 && milliseconds) {
                                const end = Math.max(...(payload.lyrics || []).map(line => Number(line.time || 0) + Number(line.duration || 0)));
                                if (!Number.isFinite(end) || end > milliseconds + 3000 || end < milliseconds * .6) continue;
                            }
                            return { ...parsed, uri: info.uri || '', provider: 'lyricsplus', cacheVersion,
                                karaokeSource: parsed.karaoke ? 'lyricsplus' : null, error: null,
                                copyright: 'Lyrics from LyricsPlus.', isrc: isrc || null,
                                lyricsPlus: { mirror: base, type: payload.type || null,
                                    source: payload.metadata?.source || null, language: payload.metadata?.language || null,
                                    title: payload.metadata?.title || null, songWriters: payload.metadata?.songWriters || [],
                                    agents: payload.metadata?.agents || {}, songParts: payload.metadata?.songParts || [],
                                    totalDuration: payload.metadata?.totalDuration || null, cached: payload.cached ?? null,
                                    lookupTitle: candidate.title, normalizedTitle: index > 0 } };
                        } catch (error) {
                            if (controller.signal.aborted) throw error;
                            attempts.push({ host: base, status: 0, error: error.name || 'Error' });
                        }
                    }
                }
                throw new Error('No verified lyrics on the additional mirrors');
            };
            try {
                const result = await Promise.any([
                    native.then(result => { if (!usable(result)) throw new Error(result?.error || 'No lyrics'); return result; }),
                    extra()
                ]);
                lyricLookups.set(info.uri, { status: 'success', attempts, normalizedTitle: !!result.lyricsPlus?.normalizedTitle });
                return { ...result, cacheVersion };
            } catch {
                // Preserve the provider contract and retain transient diagnostics
                // instead of treating a throttled endpoint as a permanent miss.
                const retryable = controller.signal.aborted || attempts.some(item => item.status === 0 || item.status === 429 || item.status >= 500);
                lyricLookups.set(info.uri, { status: retryable ? 'temporary-error' : 'not-found', attempts });
                const result = await native.catch(() => null);
                return { ...(result || { error: 'No lyrics found', uri: info.uri }), cacheVersion,
                    retryable, lyricsLookup: lyricLookups.get(info.uri) };
            } finally {
                clearTimeout(timer);
                controller.abort();
                if (lyricLookups.size > 60) lyricLookups.delete(lyricLookups.keys().next().value);
            }
        };
        wrapped.hangulMirrorFallback = true;
        provider.getLyrics = wrapped;
    }
    function setFastLoading(enabled) {
        const manager = window.LyricsAddonManager;
        if (!manager?.setPreferLyricsTypeOverProviderOrderEnabled) return;
        const previousKey = PREFIX + 'loading-previous';
        if (!storage().get(previousKey)) storage().set(previousKey, JSON.stringify({
            typeFirst: manager.isPreferLyricsTypeOverProviderOrderEnabled()
        }));
        const previous = JSON.parse(storage().get(previousKey));
        const next = enabled ? false : previous.typeFirst;
        if (manager.isPreferLyricsTypeOverProviderOrderEnabled() !== next) {
            manager.setPreferLyricsTypeOverProviderOrderEnabled(next);
        }
        storage().set(PREFIX + 'fast-loading', String(enabled));
    }
    const hideGroupingLabel = line => typeof line === 'string'
        ? line.replace(/^\s*(?:〔문장\s*전체〕|\[문장\s*전체\])\s*/u, '') : line;
    function cleanPronunciation(result) {
        return Array.isArray(result?.phonetic)
            ? { ...result, phonetic: result.phonetic.map(hideGroupingLabel) } : result;
    }
    function filterCachedPronunciation() {
        const cache = window.LyricsService.cache;
        if (cache.getTranslation.hangulLabelFilter) return;
        const original = cache.getTranslation;
        const filtered = async function (...args) {
            const result = await original.apply(this, args);
            if (args[2] !== true) return result;
            const metadata = result?.hangulReading;
            const activeProviders = window.AIAddonManager?.getEnabledProvidersFor?.('pronunciation') || [];
            const ours = args[3] === ID || !!metadata || (/^ko(?:-|$)/i.test(args[1] || '') &&
                activeProviders.length === 1 && activeProviders[0].id === ID);
            if (metadata?.generated_lines?.length && !automaticEnabled()) return null;
            // Rows generated by older offline kana rules are recomputed with the current rules.
            if (metadata?.generated_lines?.length && metadata.phonetics_version !== '2') return null;
            if (ours && result?.phonetic?.includes('(발음 자료 없음)') && metadata?.matching_version !== '0.3.1') return null;
            if (ours && automaticEnabled() && result?.phonetic?.includes('(발음 자료 없음)')) return null;
            if (metadata) {
                rememberResult(args[0], metadata);
            }
            return cleanPronunciation(result);
        };
        filtered.hangulLabelFilter = true;
        cache.getTranslation = filtered;
        const originalSet = cache.setTranslation;
        if (typeof originalSet === 'function') cache.setTranslation = async function (...args) {
            if (args[2] === true && Array.isArray(args[3]?.phonetic)) {
                const pending = pendingResults.get(args[0]);
                if (pending && JSON.stringify(pending.phonetic) === JSON.stringify(args[3].phonetic)) {
                    args[3] = { ...args[3], hangulReading: pending.metadata };
                }
            }
            return originalSet.apply(this, args);
        };
    }

    function supersededError() {
        const error = new Error('새 곡의 발음 조회로 전환했습니다.');
        error.name = 'AbortError'; error.superseded = true;
        return error;
    }
    async function request(path, body, { signal, timeoutMs = 45000 } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        try {
            const response = await fetch(BASE + path, {
                method: body ? 'POST' : 'GET',
                headers: body ? { 'Content-Type': 'application/json', 'X-Hangul-Lyrics-Client': 'ivlyrics' } : {},
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
                credentials: 'omit'
            });
            const result = await response.json();
            if ((response.status === 409 && result.superseded) ||
                (body?.foreground && body.track_id !== activeTrackId())) throw supersededError();
            if (!response.ok) {
                const error = new Error(result.error || '발음 자료를 가져오지 못했습니다.');
                error.retryable = response.status === 404 || response.status === 429 || response.status >= 500;
                throw error;
            }
            return result;
        } catch (error) {
            if (signal?.aborted || (body?.foreground && body.track_id !== activeTrackId())) throw supersededError();
            if (error.superseded) throw error;
            if (error instanceof TypeError || error.name === 'AbortError') {
                const failure = new Error('한글 발음 도우미에 연결하지 못했습니다. “Spotify 한글 가사” 바로가기로 실행해 주세요.');
                failure.retryable = true;
                throw failure;
            }
            if (error.name === 'SyntaxError') error.retryable = true;
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }

    function retryDelay(milliseconds, signal) {
        return new Promise((resolve, reject) => {
            const cleanup = () => signal.removeEventListener('abort', abort);
            const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
            const abort = () => { clearTimeout(timer); cleanup(); reject(supersededError()); };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
        });
    }
    function resolveReadings(body) {
        const key = JSON.stringify(body);
        if (inflightLookups.has(key)) return inflightLookups.get(key);
        const controller = new AbortController();
        const checkTrack = () => {
            if (body.foreground && body.track_id !== activeTrackId()) controller.abort();
            if (controller.signal.aborted) throw supersededError();
        };
        const onSongChange = () => {
            if (body.foreground && body.track_id !== activeTrackId()) controller.abort();
        };
        if (body.foreground) Spicetify.Player.addEventListener?.('songchange', onSongChange);
        const deadline = Date.now() + 60000;
        const job = (async () => {
            const delays = body.foreground ? [0, 2000, 2000, 2000] : [0];
            for (let attempt = 0; attempt < delays.length; attempt++) {
                checkTrack();
                try {
                    const result = await request('/resolve', { ...body, retry_attempt: attempt }, {
                        signal: controller.signal, timeoutMs: Math.max(1, Math.min(45000, deadline - Date.now()))
                    });
                    checkTrack();
                    if (!result.valid || !Array.isArray(result.phonetic) || result.phonetic.length !== String(body.text).split('\n').length) {
                        const error = new Error('발음 자료와 원문 가사의 줄을 맞추지 못했습니다.');
                        error.retryable = true;
                        throw error;
                    }
                    return { ...result, lookup_attempts: attempt + 1 };
                } catch (error) {
                    checkTrack();
                    const delay = delays[attempt + 1];
                    if (!error.retryable || !delay || Date.now() + delay >= deadline) throw error;
                    await retryDelay(delay, controller.signal);
                }
            }
        })().finally(() => {
            if (body.foreground) Spicetify.Player.removeEventListener?.('songchange', onSongChange);
            inflightLookups.delete(key);
        });
        inflightLookups.set(key, job);
        return job;
    }

    const storage = () => Spicetify.LocalStorage;
    const currentKey = () => window.SpotifyHangulLinks?.currentTrack?.()?.uri || Spicetify.Player.data?.item?.uri || '';
    function currentTitle() {
        const item = window.SpotifyHangulLinks?.currentTrack?.() || Spicetify.Player.data?.item;
        return item?.name || item?.metadata?.title || window.LyricsService?.getCurrentTrackInfo?.()?.title || '';
    }
    async function copyCurrentTitle() {
        const title = currentTitle();
        if (!title) {
            Spicetify.showNotification?.('먼저 복사할 곡을 선택해 주세요.', true);
            return;
        }
        try {
            await Spicetify.Platform.ClipboardAPI.copy(title);
        } catch {
            Spicetify.showNotification?.('곡 제목을 복사하지 못했습니다.', true);
        }
    }
    // The helper starts the updater, which reports the result in its own window.
    async function checkForUpdate() {
        try {
            await request('/update/check', {}, { timeoutMs: 5000 });
            Spicetify.showNotification?.('업데이트를 확인하고 있습니다.', false, 1500);
        } catch {
            Spicetify.showNotification?.('업데이트 확인을 시작하지 못했습니다. “Spotify 한글 가사” 바로가기로 다시 실행해 주세요.', true);
        }
    }
    let footerCopyInstalled = false;
    function installFooterTitleCopy() {
        if (footerCopyInstalled || !window.document?.addEventListener) return;
        footerCopyInstalled = true;
        window.document.addEventListener('contextmenu', event => {
            const link = event.target?.closest?.('a');
            if (!link?.closest('[data-testid="now-playing-widget-v2"]') || link.textContent.trim() !== currentTitle()) return;
            event.preventDefault();
            event.stopPropagation();
            void copyCurrentTitle();
        }, true);
    }
    function sourceUrls() {
        try { return JSON.parse(storage().get(PREFIX + 'sources') || '{}'); }
        catch { return {}; }
    }

    function Settings() {
        const React = Spicetify.React;
        const h = React.createElement;
        const [url, setUrl] = React.useState(() => sourceUrls()[currentKey()] || '');
        const [message, setMessage] = React.useState('연결 상태를 확인하고 있습니다.');
        const [source, setSource] = React.useState(currentResult);
        const lookup = lyricLookups.get(currentKey());
        const [automatic, setAutomatic] = React.useState(automaticEnabled);
        const [fast, setFast] = React.useState(() => storage().get(PREFIX + 'fast-loading') !== 'false');
        React.useEffect(() => {
            let active = true;
            request('/health').then(health => {
                if (!active) return;
                setMessage('기존 한글 발음 자료를 사용할 수 있습니다.');
                // The helper's last request can belong to a prefetched track.
                // Only current-track metadata is a source for this settings view.
                if (!source) setSource(currentResult());
            }).catch(error => { if (active) setMessage(error.message); });
            return () => { active = false; };
        }, []);
        const save = async () => {
            try {
                if (url.trim()) {
                    const parsed = new URL(url.trim());
                    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') ||
                        !(parsed.hostname === 'namu.wiki' || parsed.hostname.endsWith('.tistory.com') ||
                            (parsed.hostname === 'haneum.site' && /^\/songs\/[^/]+$/.test(parsed.pathname)))) {
                        throw new Error('한음, 나무위키 또는 티스토리의 HTTPS 가사 주소를 입력해 주세요.');
                    }
                }
                const key = currentKey();
                if (!key) throw new Error('먼저 곡을 선택해 주세요.');
                const urls = sourceUrls();
                if (url.trim()) urls[key] = url.trim(); else delete urls[key];
                storage().set(PREFIX + 'sources', JSON.stringify(urls));
                storage().set(PREFIX + 'automatic-fallback', String(automatic));
                setFastLoading(fast);
                const trackId = window.LyricsService?.getTranslationCacheId?.(key);
                if (trackId) await window.LyricsService.clearTranslationCache(trackId);
                setMessage('저장했습니다. ivLyrics를 다시 열거나 곡의 발음을 다시 불러와 주세요.');
            } catch (error) { setMessage(error.message); }
        };
        return h('div', { style: { display: 'grid', gap: '12px', lineHeight: '1.6', padding: '12px' } },
            h('strong', null, '기존 한글 발음 가사'),
            h('p', null, '한음과 나무위키에서 일본어 원문을 대조해 기존 한글 발음을 가져옵니다. 티스토리는 자료 주소를 지정할 수 있습니다.'),
            h('p', { role: 'status' }, message),
            lookup?.status === 'temporary-error' && h('p', null, '원문 가사 서버의 요청 제한 또는 일시 오류가 있었습니다. 잠시 뒤 다시 조회해 주세요.'),
            source?.source_url && h('p', null,
                '최근 출처: ', h('a', { href: source.source_url, target: '_blank', rel: 'noopener noreferrer' }, source.source_title || source.title || '가사 문서'),
                ` (${source.matched}/${source.total} 줄)`),
            source?.generated_lines?.length > 0 && h('p', null, `기기 내부 자동 발음: ${source.generated_lines.length}줄. 사전 기반 변환이라 실제 노래와 다를 수 있습니다.`),
            h('p', null, '커버곡은 원곡 후보를 찾아 가사를 대조합니다. 줄 구분이 다르면 출처의 발음 문장을 그대로 표시합니다.'),
            h('label', null, '현재 곡의 자료 주소 (선택)',
                h('input', { value: url, onChange: event => setUrl(event.target.value),
                    placeholder: '한음, 나무위키 또는 티스토리 가사 페이지',
                    style: { width: '100%', color: 'inherit', background: '#242424', padding: '9px', border: '1px solid #777', borderRadius: '6px' } })),
            h('label', null,
                h('input', { type: 'checkbox', checked: automatic, onChange: event => setAutomatic(event.target.checked) }),
                ' 자료가 없으면 기기 내부 자동 발음 사용'),
            h('small', null, '자동 발음은 유료 API 없이 PC에서 처리합니다. 노래 특유의 한자 읽기나 이름은 틀릴 수 있습니다. 기본값은 꺼짐입니다.'),
            h('label', null,
                h('input', { type: 'checkbox', checked: fast, onChange: event => setFast(event.target.checked) }),
                ' 빠른 가사 표시: 글자 단위 자료를 기다리기보다 제공자 순서대로 조회'),
            h('button', { onClick: save }, '설정 저장'),
            h('small', null, '주소를 비우면 한음과 나무위키에서 찾습니다. 기존 자료는 일본어 줄의 85% 이상이 연결될 때 사용합니다.'));
    }

    function setVisual(key, value) {
        storage().set('ivLyrics:visual:' + key, String(value));
        if (typeof CONFIG !== 'undefined' && CONFIG.visual) CONFIG.visual[key] = value;
        if (window.CONFIG?.visual) window.CONFIG.visual[key] = value;
    }

    const addon = {
        id: ID,
        name: '기존 한글 발음 가사',
        author: 'ForUltraplayer',
        version: '0.7.5',
        description: { ko: '웹에 작성된 한글 발음을 가져옵니다. AI·API 키·유료 호출 없이 원문과 대조합니다.',
            en: 'Existing web-authored Hangul readings; no AI or paid API.' },
        supports: { pronunciation: true, translate: false, metadata: false, tmi: false,
            lyricsStudy: false, characterPronunciation: false, culturalAnnotations: false, wordSupplements: false },
        async init() {
            const manager = window.AIAddonManager;
            void ensureLinkPlayer().catch(error => console.warn('[SpotifyHangul] ' + error.message));
            installFooterTitleCopy();
            installLyricsPlusFallback();
            setFastLoading(storage().get(PREFIX + 'fast-loading') !== 'false');
            if (storage().get(PREFIX + 'configured') !== 'true') {
                const previous = {};
                const keys = ['translate:target-language', 'translate:pronunciation-notation',
                    'translation-mode:japanese', 'translation-mode-2:japanese'];
                for (const key of keys) previous[key] = storage().get('ivLyrics:visual:' + key);
                previous.providerOrder = manager.getProviderOrder();
                previous.capabilities = {};
                for (const provider of manager.getAddons()) {
                    if (provider.id === ID || !provider.supports?.pronunciation) continue;
                    previous.capabilities[provider.id] = manager.getAddonSetting(provider.id, 'capability:pronunciation', null);
                    manager.setCapabilityEnabled(provider.id, 'pronunciation', false);
                }
                storage().set(PREFIX + 'previous', JSON.stringify(previous));
                manager.setProviderEnabled(ID, true);
                manager.setCapabilityEnabled(ID, 'pronunciation', true);
                manager.setProviderOrder([ID, ...manager.getProviderOrder().filter(id => id !== ID)]);
                setVisual('translate:target-language', 'ko');
                setVisual('translate:pronunciation-notation', 'translation');
                setVisual('translation-mode:japanese', 'gemini_romaji');
                setVisual('translation-mode-2:japanese', 'none');
                storage().set(PREFIX + 'configured', 'true');
            }
            // Repair the initial local build's language-code/name mismatch once.
            if (storage().get(PREFIX + 'display-config-version') !== '1') {
                const previous = JSON.parse(storage().get(PREFIX + 'previous') || '{}');
                for (const key of ['translation-mode:japanese', 'translation-mode-2:japanese']) {
                    if (!(key in previous)) previous[key] = storage().get('ivLyrics:visual:' + key);
                }
                storage().set(PREFIX + 'previous', JSON.stringify(previous));
                setVisual('translation-mode:japanese', 'gemini_romaji');
                setVisual('translation-mode-2:japanese', 'none');
                storage().set(PREFIX + 'display-config-version', '1');
            }
            if (Spicetify.Menu?.Item) new Spicetify.Menu.Item('한글 발음 자료', false, () => {
                Spicetify.PopupModal.display({ title: '한글 발음 자료', content: Spicetify.React.createElement(Settings), isLarge: true });
            }).register();
            if (Spicetify.Menu?.Item) new Spicetify.Menu.Item('현재 곡 제목 복사', false, copyCurrentTitle).register();
            if (Spicetify.Menu?.Item) new Spicetify.Menu.Item('Spotify 한글 가사 ' + addon.version + ' · 업데이트 확인', false, checkForUpdate).register();
            if (Spicetify.ContextMenu?.Item) new Spicetify.ContextMenu.Item('곡 제목 복사',
                ([uri]) => { if (uri === currentKey()) return copyCurrentTitle(); },
                uris => uris.length === 1 && !!currentKey() && uris[0] === currentKey()
            ).register();
        },
        getSettingsUI: () => Settings,
        async testConnection() { return (await request('/health')).app === 'ivLyricsHangul'; },
        async translateLyrics({ trackId: requestedTrackId, title, artist, text, lang, wantSmartPhonetic, pronunciationNotation, sourceLang, onLine }) {
            if (!wantSmartPhonetic || !/^ko(?:-|$)/i.test(lang || '') ||
                (pronunciationNotation && pronunciationNotation !== 'translation') ||
                (sourceLang && sourceLang !== 'auto' && !/^ja(?:-|$)/i.test(sourceLang))) {
                throw new Error('이 제공자는 일본어 곡의 기존 한글 발음만 지원합니다.');
            }
            const trackKey = currentKey();
            const urls = sourceUrls();
            const sourceUrl = requestedTrackId
                ? Object.entries(urls).find(([uri]) => window.LyricsService.getTranslationCacheId?.(uri) === requestedTrackId)?.[1] || ''
                : urls[trackKey] || '';
            const trackId = requestedTrackId || window.LyricsService.getTranslationCacheId?.(trackKey);
            const result = cleanPronunciation(await resolveReadings({ title, artist, text,
                source_url: sourceUrl, automatic_fallback: automaticEnabled(),
                track_id: trackId || '', foreground: !!trackId && trackId === activeTrackId() }));
            if (!result.valid || !Array.isArray(result.phonetic) || result.phonetic.length !== String(text).split('\n').length) {
                throw new Error('발음 자료와 원문 가사의 줄을 맞추지 못했습니다.');
            }
            const { phonetic, ...metadata } = result;
            rememberResult(trackId, metadata);
            if (trackId) {
                pendingResults.set(trackId, { phonetic, metadata });
                if (pendingResults.size > 50) pendingResults.delete(pendingResults.keys().next().value);
            }
            if (typeof onLine === 'function') result.phonetic.forEach((line, index) => onLine(index, line, { provider: ID, final: true }));
            return { phonetic: result.phonetic, hangulReading: metadata };
        }
    };
    window.HangulLyricsProvider = { addon, getLastResult: currentResult, getLookupStatus: uri => lyricLookups.get(uri || currentKey()) || null,
        ensureLinkPlayer };
    let attempts = 0;
    const register = () => {
        if (window.AIAddonManager && window.Spicetify?.LocalStorage && window.LyricsService?.cache?.getTranslation) {
            filterCachedPronunciation();
            window.AIAddonManager.register(addon);
            void ensureLinkPlayer().catch(error => console.warn('[SpotifyHangul] ' + error.message));
        } else if (++attempts < 120) setTimeout(register, 500);
    };
    register();
})();
