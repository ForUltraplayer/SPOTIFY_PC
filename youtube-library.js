/** @file youtube-library.js
 * @brief Export and import complete local mixed playlists without Spotify server writes or stream URLs.
 */
(() => {
    'use strict';
    const FORMAT = 'SpotifyHangulMixedPlaylist', MAX_BYTES = 3000000, MAX_TRACKS = 2000;
    const spotifyTrack = /^spotify:track:[A-Za-z0-9]{22}$/;
    const spotifyPlaylist = /^spotify:playlist:[A-Za-z0-9]{22}$/;
    const youtubeId = /^[A-Za-z0-9_-]{11}$/;
    const imageHosts = new Set(['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'image-cdn.spotifycdn.com']);
    const fail = message => { throw new Error(message); };
    function text(value, limit, fallback = '') {
        if (value == null) return fallback;
        if (typeof value !== 'string' || value.length > limit || value.includes('\0')) fail('목록의 문자열 형식이나 길이가 올바르지 않습니다.');
        return value;
    }
    function duration(value) {
        if (value == null) return 0;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 31536000) fail('곡의 재생 시간이 올바르지 않습니다.');
        return value;
    }
    function image(value) {
        if (!value) return '';
        const source = text(value, 1200);
        if (/^spotify:image:[a-fA-F0-9]{20,64}$/.test(source)) return source;
        let url; try { url = new URL(source); } catch { fail('앨범 이미지 주소가 올바르지 않습니다.'); }
        if (url.protocol !== 'https:' || !imageHosts.has(url.hostname) || url.username || url.password || url.port) fail('Spotify 앨범 이미지 주소만 가져올 수 있습니다.');
        return url.origin + url.pathname;
    }
    function cleanNative(value, index) {
        if (!value || value.kind !== 'spotify' || !spotifyTrack.test(value.uri || '')) fail('Spotify 곡 주소가 올바르지 않습니다.');
        const entryKey = text(value.entryKey, 180, value.uri + '#' + index);
        if (!entryKey || /[\x00-\x1f]/.test(entryKey)) fail('Spotify 곡 항목 식별자가 올바르지 않습니다.');
        return { kind: 'spotify', uri: value.uri, title: text(value.title, 300, 'Spotify'), artist: text(value.artist, 200),
            duration: duration(value.duration), entryKey, album: text(value.album, 300), image: image(value.image) };
    }
    function cleanYoutube(value) {
        if (!value || value.kind !== 'youtube' || !youtubeId.test(value.videoId || '')) fail('YouTube 영상 ID가 올바르지 않습니다.');
        const item = { kind: 'youtube', videoId: value.videoId, title: text(value.title, 300, value.videoId),
            artist: text(value.artist, 200, 'YouTube'), duration: duration(value.duration) };
        if (value.after != null) item.after = text(value.after, 180);
        if (value.lyricTitle != null) { item.lyricTitle = text(value.lyricTitle, 300); item.lyricArtist = text(value.lyricArtist, 200); }
        return item;
    }
    const key = item => item.kind === 'youtube' ? 'yt:' + item.videoId : 'sp:' + item.entryKey;
    function cleanPlaylist(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('플레이리스트 데이터가 없습니다.');
        if (!Array.isArray(value.nativeTracks) || !Array.isArray(value.tracks)
            || value.nativeTracks.length > MAX_TRACKS || value.tracks.length > MAX_TRACKS) fail('각 종류의 곡은 2,000 곡까지 입출력할 수 있습니다.');
        const nativeTracks = value.nativeTracks.map(cleanNative), tracks = value.tracks.map(cleanYoutube);
        const nativeKeys = new Set(nativeTracks.map(t => t.entryKey)), videoKeys = new Set(tracks.map(t => t.videoId));
        if (nativeKeys.size !== nativeTracks.length || videoKeys.size !== tracks.length) fail('중복된 곡 항목 식별자가 있습니다.');
        const playlist = { name: text(value.name, 100, '가져온 혼합 목록'), nativeTracks, tracks };
        if (value.sourceUri != null) {
            if (!spotifyPlaylist.test(value.sourceUri)) fail('원본 Spotify 플레이리스트 주소가 올바르지 않습니다.');
            playlist.sourceUri = value.sourceUri;
        }
        const before = tracks.filter(t => t.after === ''), tail = tracks.filter(t => t.after !== '' && !nativeKeys.has(t.after));
        const defaultOrder = [...before, ...nativeTracks.flatMap(t => [t, ...tracks.filter(link => link.after === t.entryKey)]), ...tail].map(key);
        if (value.order != null && (!Array.isArray(value.order) || value.order.length > MAX_TRACKS * 2)) fail('혼합 재생 순서가 올바르지 않습니다.');
        const valid = new Set(defaultOrder), order = [];
        for (const item of value.order || []) {
            if (typeof item !== 'string' || item.length > 183 || !/^(sp|yt):[^\x00-\x1f]+$/.test(item)) fail('혼합 재생 순서의 항목이 올바르지 않습니다.');
            if (valid.has(item) && !order.includes(item)) order.push(item);
        }
        playlist.order = order.concat(defaultOrder.filter(item => !order.includes(item)));
        return playlist;
    }
    function documentFor(playlist, date = new Date()) {
        const value = { format: FORMAT, schema: 1, exportedAt: date.toISOString(), playlist: cleanPlaylist(playlist) };
        if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) fail('목록 파일은 3 MB까지 저장할 수 있습니다.');
        return value;
    }
    function parse(source) {
        if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_BYTES) fail('목록 파일은 3 MB까지 가져올 수 있습니다.');
        let value; try { value = JSON.parse(source.replace(/^\uFEFF/, '')); } catch { fail('올바른 JSON 목록 파일이 아닙니다.'); }
        if (!value || value.format !== FORMAT || value.schema !== 1) fail('지원하는 Spotify 한글 혼합 목록 파일이 아닙니다.');
        return cleanPlaylist(value.playlist);
    }
    function imported(source, id) {
        return { id, local: true, ...parse(source) };
    }
    function create(host, options) {
        let disposed = false;
        const pending = new Set(), inputs = new Set();
        const notify = (message, error = false) => host.Spicetify?.showNotification?.(message, error);
        const check = () => { if (disposed) throw new DOMException('Playlist tools disposed', 'AbortError'); };
        async function exportCurrent() {
            check(); const document = documentFor(await options.getCurrent()); check();
            const controller = new AbortController(); pending.add(controller);
            const timeout = host.setTimeout(() => controller.abort(), 15000);
            try {
                const response = await host.fetch('http://127.0.0.1:19643/youtube/export', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Hangul-Lyrics-Client': 'ivlyrics' },
                    body: JSON.stringify(document), signal: controller.signal });
                const result = await response.json(); check();
                if (!response.ok) throw new Error(result.error || '플레이리스트를 저장하지 못했습니다.');
                if (typeof result.path !== 'string' || typeof result.filename !== 'string') throw new Error('저장 결과가 올바르지 않습니다.');
                const modal = host.Spicetify?.PopupModal;
                if (modal && host.document) {
                    const content = host.document.createElement('div'), description = host.document.createElement('p');
                    description.textContent = 'Spotify 곡과 YouTube 링크, 재생 순서 및 가사 검색 정보를 함께 저장했습니다.';
                    const location = host.document.createElement('p'); location.textContent = result.path; location.style.cssText = 'overflow-wrap:anywhere;user-select:text';
                    const copy = host.document.createElement('button'); copy.textContent = '저장 경로 복사';
                    copy.onclick = () => host.Spicetify.Platform.ClipboardAPI.copy(result.path);
                    content.append(description, location, copy); modal.display({ title: '플레이리스트 내보내기 완료', content });
                } else notify('목록 저장 완료: ' + result.path);
                return result;
            } finally { host.clearTimeout(timeout); pending.delete(controller); }
        }
        async function importFile(file) {
            check(); if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size) || file.size > MAX_BYTES || file.size < 1) fail('3 MB 이하의 JSON 파일을 선택해 주세요.');
            const source = await file.text(); check();
            const playlist = imported(source, host.crypto.randomUUID());
            await options.onImport(playlist); check(); notify('새 로컬 목록으로 가져왔습니다: ' + playlist.name);
            return playlist;
        }
        function openPicker() {
            check(); const input = host.document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
            const remove = () => { inputs.delete(input); input.remove(); };
            input.onchange = () => { const file = input.files?.[0]; remove(); if (file) importFile(file).catch(error => { if (error.name !== 'AbortError') notify(error.message, true); }); };
            input.oncancel = remove; inputs.add(input); host.document.body.append(input); input.click();
        }
        return { exportCurrent, importFile, openPicker, dispose() { if (disposed) return; disposed = true;
            for (const controller of pending) controller.abort(); for (const input of inputs) input.remove(); inputs.clear(); } };
    }
    const api = { FORMAT, MAX_BYTES, cleanPlaylist, documentFor, parse, imported, create };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') window.SpotifyHangulLibrary = api;
})();
