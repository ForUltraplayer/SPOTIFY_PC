/** @file hangul-lyrics.js
 * @author: ForUltraplayer
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
    function installLyricsPlusFallback() {
        const provider = window.LyricsAddonManager?.getAddon?.('lyricsplus');
        const parser = window.__ivLyricsPlusDebug;
        if (!provider?.getLyrics || !parser?.parseLyricsPayload || !parser?.resolveTrackIsrc || !parser?.buildLyricsUrl) return;
        if (provider.getLyrics.hangulMirrorFallback) return;
        const original = provider.getLyrics;
        const cacheVersion = `${provider.cacheVersion || 'lyricsplus'}-hangul-mirrors-1`;
        provider.cacheVersion = cacheVersion;
        const usable = result => ['karaoke', 'synced', 'unsynced'].some(key => result?.[key]?.length > 0);
        const wrapped = async function (info) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            const native = Promise.resolve().then(() => original.call(this, info));
            const extra = async () => {
                const isrc = await parser.resolveTrackIsrc(info);
                // These are the Android provider's public mirrors. Keep recording
                // identity when available, then retry exact title/artist metadata.
                const attempts = [['https://lyricsplus.binimum.org', isrc]];
                if (isrc) attempts.push(['https://lyricsplus.prjktla.my.id', null]);
                for (const [base, code] of attempts) {
                    try {
                        const response = await fetch(parser.buildLyricsUrl(base, info, code), {
                            signal: controller.signal, credentials: 'omit'
                        });
                        if (!response.ok) continue;
                        const payload = await response.json();
                        if (isrc && payload.metadata?.isrc && payload.metadata.isrc !== isrc) continue;
                        const duration = Number(info.durationMs ?? info.duration_ms ?? info.duration ?? 0);
                        const parsed = parser.parseLyricsPayload(payload, duration > 10000 ? duration : duration * 1000);
                        if (!usable(parsed)) continue;
                        return { ...parsed, uri: info.uri || '', provider: 'lyricsplus', cacheVersion,
                            karaokeSource: parsed.karaoke ? 'lyricsplus' : null, error: null,
                            copyright: 'Lyrics from LyricsPlus.', isrc: isrc || null,
                            lyricsPlus: { mirror: base, type: payload.type || null,
                                source: payload.metadata?.source || null, language: payload.metadata?.language || null,
                                title: payload.metadata?.title || null, songWriters: payload.metadata?.songWriters || [],
                                agents: payload.metadata?.agents || {}, songParts: payload.metadata?.songParts || [],
                                totalDuration: payload.metadata?.totalDuration || null, cached: payload.cached ?? null } };
                    } catch (error) {
                        if (controller.signal.aborted) throw error;
                    }
                }
                throw new Error('No usable lyrics on the additional mirrors');
            };
            try {
                const result = await Promise.any([
                    native.then(result => { if (!usable(result)) throw new Error(result?.error || 'No lyrics'); return result; }),
                    extra()
                ]);
                return { ...result, cacheVersion };
            } catch {
                // Keep the original provider's failure contract and diagnostics.
                const result = await native;
                return result ? { ...result, cacheVersion } : result;
            } finally {
                clearTimeout(timer);
                controller.abort();
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

    async function request(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        const started = Date.now();
        let busyRetries = 0;
        try {
            while (true) {
                const response = await fetch(BASE + path, {
                method: body ? 'POST' : 'GET',
                headers: body ? { 'Content-Type': 'application/json', 'X-Hangul-Lyrics-Client': 'ivlyrics' } : {},
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
                credentials: 'omit'
            });
                const result = await response.json();
                if (response.status === 409 && result.superseded) {
                    const error = new Error(result.error);
                    error.name = 'AbortError'; error.superseded = true;
                    throw error;
                }
                if (response.status === 429 && path === '/resolve' && Date.now() - started < 36000) {
                    if (body.foreground && body.track_id !== activeTrackId()) {
                        const error = new Error('새 곡의 발음 조회로 전환했습니다.');
                        error.name = 'AbortError'; error.superseded = true;
                        throw error;
                    }
                    const delay = Math.min(1000, 250 * ++busyRetries);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                if (!response.ok) throw new Error(result.error || '발음 자료를 가져오지 못했습니다.');
                return result;
            }
        } catch (error) {
            if (error.superseded) throw error;
            if (error instanceof TypeError || error.name === 'AbortError') {
                throw new Error('한글 발음 도우미에 연결하지 못했습니다. “Spotify 한글 가사” 바로가기로 실행해 주세요.');
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    function resolveReadings(body) {
        const key = JSON.stringify(body);
        if (inflightLookups.has(key)) return inflightLookups.get(key);
        const job = request('/resolve', body).finally(() => inflightLookups.delete(key));
        inflightLookups.set(key, job);
        return job;
    }

    const storage = () => Spicetify.LocalStorage;
    const currentKey = () => Spicetify.Player.data?.item?.uri || '';
    function currentTitle() {
        const item = Spicetify.Player.data?.item;
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
        version: '0.5.0',
        description: { ko: '웹에 작성된 한글 발음을 가져옵니다. AI·API 키·유료 호출 없이 원문과 대조합니다.',
            en: 'Existing web-authored Hangul readings; no AI or paid API.' },
        supports: { pronunciation: true, translate: false, metadata: false, tmi: false,
            lyricsStudy: false, characterPronunciation: false, culturalAnnotations: false, wordSupplements: false },
        async init() {
            const manager = window.AIAddonManager;
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
    window.HangulLyricsProvider = { addon, getLastResult: currentResult };
    let attempts = 0;
    const register = () => {
        if (window.AIAddonManager && window.Spicetify?.LocalStorage && window.LyricsService?.cache?.getTranslation) {
            filterCachedPronunciation();
            window.AIAddonManager.register(addon);
        } else if (++attempts < 120) setTimeout(register, 500);
    };
    register();
})();
