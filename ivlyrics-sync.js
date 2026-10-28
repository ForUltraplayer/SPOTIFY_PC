/** @file ivlyrics-sync.js
 * @brief Resolve the active recording and persist bounded whole-lyric timing adjustments through ivLyrics.
 */
(() => {
    'use strict';
    const MAX_OFFSET = 60000;
    const validUri = uri => typeof uri === 'string' && (/^youtube:video:[\w-]{11}$/.test(uri)
        || /^spotify:(?:track|episode|local):[^\s]+$/.test(uri));
    function finite(value, label) {
        if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === ''
            || !Number.isFinite(Number(value))) throw new TypeError(label + ' 값을 확인해 주세요.');
        return Number(value);
    }
    function normalizeOffset(value) {
        const offset = Math.round(finite(value, '보정 시간'));
        if (Math.abs(offset) > MAX_OFFSET) throw new RangeError('보정 시간은 앞뒤 60 초 이내로 지정해 주세요.');
        return offset === 0 ? 0 : offset;
    }
    function alignOffset(lineTime, position, globalOffset = 0) {
        const line = finite(lineTime, '가사 시작 시간'), time = finite(position, '재생 시간');
        if (line < 0 || time < 0) throw new RangeError('가사와 재생 시간은 0 이상이어야 합니다.');
        return normalizeOffset(line - time - finite(globalOffset, '공통 보정 시간'));
    }
    function formatOffset(value) {
        const offset = normalizeOffset(value);
        return offset === 0 ? '보정 없음' : '가사를 ' + Number((Math.abs(offset) / 1000).toFixed(3))
            + ' 초 ' + (offset > 0 ? '먼저' : '나중에') + ' 표시';
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
            const value = finite(progress, '재생 시간');
            if (value < 0) throw new RangeError('재생 시간은 0 이상이어야 합니다.');
            return value;
        }
        function getGlobalOffset() {
            const global = typeof host.Utils?.getGlobalSyncOffset === 'function' ? host.Utils.getGlobalSyncOffset()
                : host.CONFIG?.visual?.['global-sync-offset'] ?? 0;
            return finite(host.CONFIG?.visual?.delay ?? 0, '표시 지연') + finite(global, '공통 보정 시간');
        }
        async function getOffset(uri) {
            if (!validUri(uri)) throw new TypeError('곡 정보를 확인해 주세요.');
            // Utils.js is lexical in some ivLyrics builds; the explicitly
            // exported TrackSyncDB remains the same persistent store.
            const owner = typeof host.Utils?.getTrackSyncOffset === 'function' ? host.Utils : host.TrackSyncDB;
            const read = owner === host.Utils ? owner?.getTrackSyncOffset : owner?.getOffset;
            if (typeof read !== 'function') throw new Error('가사 싱크 저장소가 아직 준비되지 않았습니다.');
            return normalizeOffset(await read.call(owner, uri));
        }
        function setOffset(uri, value) {
            let offset;
            try {
                offset = normalizeOffset(value);
                if (!isCurrent(uri)) throw new Error('재생 곡이 바뀌었습니다. 현재 곡에서 다시 맞춰 주세요.');
            } catch (error) { return Promise.reject(error); }
            const write = writes.then(async () => {
                if (!isCurrent(uri)) throw new Error('재생 곡이 바뀌었습니다. 현재 곡에서 다시 맞춰 주세요.');
                const usesUtils = typeof host.Utils?.setTrackSyncOffset === 'function';
                const owner = usesUtils ? host.Utils : host.TrackSyncDB;
                const save = usesUtils ? owner?.setTrackSyncOffset : owner?.setOffset;
                if (typeof save !== 'function') throw new Error('가사 싱크 저장소가 아직 준비되지 않았습니다.');
                if (!usesUtils && (typeof host.CustomEvent !== 'function' || typeof host.dispatchEvent !== 'function'))
                    throw new Error('가사 싱크 변경 알림이 아직 준비되지 않았습니다.');
                const persisted = await save.call(owner, uri, offset);
                if (persisted !== true) throw new Error('싱크 보정값을 저장하지 못했습니다. 다시 시도해 주세요.');
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
    const api = { MAX_OFFSET, validUri, normalizeOffset, alignOffset, formatOffset, create };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') {
        window.SpotifyHangulSync = api;
        window.SpotifyHangulSyncController = create(window);
    }
})();
