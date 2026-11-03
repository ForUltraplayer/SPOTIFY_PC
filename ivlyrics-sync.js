/** @file ivlyrics-sync.js
 * @brief Resolve the active recording and persist bounded whole-lyric timing adjustments through ivLyrics.
 */
(() => {
    'use strict';
    const MAX_OFFSET = 60000;
    // Every text the sync core shows or throws. English is the default; Korean when Spotify's UI is Korean.
    const STRINGS = {
        en: {
            check_value: 'Check the %1.', offset_label: 'adjustment', line_time_label: 'lyric start time',
            position_label: 'playback position', global_offset_label: 'global adjustment', delay_label: 'display delay',
            offset_range: 'Keep the adjustment within 60 seconds either way.',
            times_negative: 'The lyric and playback times must be 0 or more.',
            position_negative: 'The playback position must be 0 or more.',
            no_offset: 'No adjustment', offset_earlier: 'Lyrics shown %1 s earlier', offset_later: 'Lyrics shown %1 s later',
            step_earlier: '%1 s earlier', step_later: '%1 s later',
            song_invalid: 'Check the song information.',
            store_not_ready: 'The lyric sync store is not ready yet.',
            song_changed: 'The song changed. Adjust it again on the current song.',
            notify_not_ready: 'The lyric sync change notification is not ready yet.',
            save_failed: "Couldn't save the sync adjustment. Try again.",
        },
        ko: {
            check_value: '%1 값을 확인해 주세요.', offset_label: '보정 시간', line_time_label: '가사 시작 시간',
            position_label: '재생 시간', global_offset_label: '공통 보정 시간', delay_label: '표시 지연',
            offset_range: '보정 시간은 앞뒤 60 초 이내로 지정해 주세요.',
            times_negative: '가사와 재생 시간은 0 이상이어야 합니다.',
            position_negative: '재생 시간은 0 이상이어야 합니다.',
            no_offset: '보정 없음', offset_earlier: '가사를 %1 초 먼저 표시', offset_later: '가사를 %1 초 나중에 표시',
            step_earlier: '%1 초 먼저', step_later: '%1 초 나중에',
            song_invalid: '곡 정보를 확인해 주세요.',
            store_not_ready: '가사 싱크 저장소가 아직 준비되지 않았습니다.',
            song_changed: '재생 곡이 바뀌었습니다. 현재 곡에서 다시 맞춰 주세요.',
            notify_not_ready: '가사 싱크 변경 알림이 아직 준비되지 않았습니다.',
            save_failed: '싱크 보정값을 저장하지 못했습니다. 다시 시도해 주세요.',
        },
    };
    // Spotify's UI language, read on each call: Korean for ko/ko-KR, English otherwise.
    function language() {
        return /^ko(?:[-_]|$)/i.test(String(globalThis.Spicetify?.Locale?.getLocale?.() || globalThis.navigator?.language || '')) ? 'ko' : 'en';
    }
    function t(key, ...args) {
        const text = STRINGS[language()]?.[key] ?? STRINGS.en[key] ?? key;
        return text.replace(/%(\d)/g, (mark, n) => args[n - 1] === undefined ? mark : String(args[n - 1]));
    }
    const seconds = value => Number((Math.abs(value) / 1000).toFixed(3));
    const validUri = uri => typeof uri === 'string' && (/^youtube:video:[\w-]{11}$/.test(uri)
        || /^spotify:(?:track|episode|local):[^\s]+$/.test(uri));
    function finite(value, label) {
        if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === ''
            || !Number.isFinite(Number(value))) throw new TypeError(t('check_value', t(label)));
        return Number(value);
    }
    function normalizeOffset(value) {
        const offset = Math.round(finite(value, 'offset_label'));
        if (Math.abs(offset) > MAX_OFFSET) throw new RangeError(t('offset_range'));
        return offset === 0 ? 0 : offset;
    }
    function alignOffset(lineTime, position, globalOffset = 0) {
        const line = finite(lineTime, 'line_time_label'), time = finite(position, 'position_label');
        if (line < 0 || time < 0) throw new RangeError(t('times_negative'));
        return normalizeOffset(line - time - finite(globalOffset, 'global_offset_label'));
    }
    function formatOffset(value) {
        const offset = normalizeOffset(value);
        return offset === 0 ? t('no_offset') : t(offset > 0 ? 'offset_earlier' : 'offset_later', seconds(offset));
    }
    // The label of one quick-step button: a positive step shows the lyrics earlier.
    function formatStep(step) {
        const offset = normalizeOffset(step);
        return t(offset > 0 ? 'step_earlier' : 'step_later', seconds(offset));
    }
    function create(host) {
        let writes = Promise.resolve();
        function resolveTrack() {
            let track;
            const links = host.SpotifyHangulLinks;
            const linkState = typeof links?.playbackState === 'function' ? links.playbackState() : links?.snapshot?.();
            if (linkState?.active === true) {
                track = links.currentTrack?.();
                if (!/^youtube:video:[\w-]{11}$/.test(track?.uri || '')) return null;
            } else {
                const stable = host.Utils?.resolveStablePlaybackTrack?.();
                track = stable && typeof stable.then !== 'function' && validUri(stable.uri)
                    ? stable : host.Spicetify?.Player?.data?.item;
                if (!validUri(track?.uri) || track.uri.startsWith('youtube:')) return null;
            }
            const artist = track.metadata?.artist_name || track.artists?.map(a => a.name).filter(Boolean).join(', ') || '';
            return Object.freeze({ uri: track.uri, title: String(track.name || track.metadata?.title || track.title || ''),
                artist: String(artist) });
        }
        const isCurrent = uri => validUri(uri) && resolveTrack()?.uri === uri;
        function getLines() {
            const track = resolveTrack(), container = host.lyricContainer;
            if (!track || container?.currentTrackUri !== track.uri) return [];
            const lines = container.state?.currentLyrics;
            return Array.isArray(lines) ? lines.flatMap((line, index) => {
                if (typeof line?.startTime !== 'number' || !Number.isFinite(line.startTime) || line.startTime < 0
                    || typeof line.text !== 'string' || !line.text.trim()) return [];
                return [{ index, startTime: line.startTime, text: line.text }];
            }) : [];
        }
        function getPosition() {
            const progress = typeof host.Utils?.getSafePlayerProgress === 'function'
                ? host.Utils.getSafePlayerProgress() : host.Spicetify?.Player?.getProgress?.();
            const value = finite(progress, 'position_label');
            if (value < 0) throw new RangeError(t('position_negative'));
            return value;
        }
        function getGlobalOffset() {
            const global = typeof host.Utils?.getGlobalSyncOffset === 'function' ? host.Utils.getGlobalSyncOffset()
                : host.CONFIG?.visual?.['global-sync-offset'] ?? 0;
            return finite(host.CONFIG?.visual?.delay ?? 0, 'delay_label') + finite(global, 'global_offset_label');
        }
        async function getOffset(uri) {
            if (!validUri(uri)) throw new TypeError(t('song_invalid'));
            // Utils.js is lexical in some ivLyrics builds; the explicitly
            // exported TrackSyncDB remains the same persistent store.
            const owner = typeof host.Utils?.getTrackSyncOffset === 'function' ? host.Utils : host.TrackSyncDB;
            const read = owner === host.Utils ? owner?.getTrackSyncOffset : owner?.getOffset;
            if (typeof read !== 'function') throw new Error(t('store_not_ready'));
            return normalizeOffset(await read.call(owner, uri));
        }
        function setOffset(uri, value) {
            let offset;
            try {
                offset = normalizeOffset(value);
                if (!isCurrent(uri)) throw new Error(t('song_changed'));
            } catch (error) { return Promise.reject(error); }
            const write = writes.then(async () => {
                if (!isCurrent(uri)) throw new Error(t('song_changed'));
                const usesUtils = typeof host.Utils?.setTrackSyncOffset === 'function';
                const owner = usesUtils ? host.Utils : host.TrackSyncDB;
                const save = usesUtils ? owner?.setTrackSyncOffset : owner?.setOffset;
                if (typeof save !== 'function') throw new Error(t('store_not_ready'));
                if (!usesUtils && (typeof host.CustomEvent !== 'function' || typeof host.dispatchEvent !== 'function'))
                    throw new Error(t('notify_not_ready'));
                const persisted = await save.call(owner, uri, offset);
                if (persisted !== true) throw new Error(t('save_failed'));
                // Utils dispatches this event itself. Direct public-DB writes
                // must perform that same notification exactly once, after commit.
                if (!usesUtils) host.dispatchEvent(new host.CustomEvent('ivLyrics:offset-changed', {
                    detail: { trackUri: uri, offset },
                }));
                return offset;
            });
            // A failed write must not poison the following, independently owned edit.
            writes = write.catch(() => {});
            return write;
        }
        return { resolveTrack, captureTrack: resolveTrack, isCurrent, getLines, getPosition, getGlobalOffset, getOffset, setOffset };
    }
    const api = { MAX_OFFSET, validUri, normalizeOffset, alignOffset, formatOffset, formatStep, create };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') {
        window.SpotifyHangulSync = api;
        window.SpotifyHangulSyncController = create(window);
    }
})();
