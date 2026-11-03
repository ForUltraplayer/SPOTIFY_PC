/** @file youtube-library.js
 * @brief Export and import complete local mixed playlists, and import the Android app's list files, without Spotify server writes or stream URLs.
 */
(() => {
    'use strict';
    const FORMAT = 'SpotifyHangulMixedPlaylist', MAX_BYTES = 3000000, MAX_TRACKS = 2000;
    const PHONE_FORMAT = 'myspoti-hangul-local-playlist', phoneYoutube = /^myspoti-yt:\/\/video\/([A-Za-z0-9_-]{11})$/;
    const spotifyTrack = /^spotify:track:[A-Za-z0-9]{22}$/;
    const spotifyPlaylist = /^spotify:playlist:[A-Za-z0-9]{22}$/;
    const youtubeId = /^[A-Za-z0-9_-]{11}$/;
    const imageHosts = new Set(['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'image-cdn.spotifycdn.com']);
    // Every string the module shows. English is the default; Korean follows Spotify's UI language.
    const STRINGS = {
        en: {
            bad_text: 'A text field in the list has the wrong type or length.', bad_duration: "A song's length is not valid.",
            bad_image: 'An album image address is not valid.', spotify_image_only: 'Only Spotify album image addresses can be imported.',
            bad_spotify_uri: 'A Spotify song address is not valid.', bad_entry_key: 'A Spotify song entry ID is not valid.',
            bad_video_id: 'A YouTube video ID is not valid.', no_playlist: 'The file has no playlist data.',
            too_many: 'Up to 2,000 songs of each kind can be exported or imported.', duplicate_entry: 'Two song entries have the same ID.',
            default_name: 'Imported mixed list', bad_source: 'The original Spotify playlist address is not valid.',
            bad_order: 'The mixed play order is not valid.', bad_order_item: 'An entry in the mixed play order is not valid.',
            save_too_big: 'List files can be saved up to 3 MB.', bad_phone_items: "The phone list's song entries are not valid.",
            import_too_big: 'List files can be imported up to 3 MB.', bad_json: 'This is not a valid JSON list file.',
            unsupported: 'This is not a supported Spotify Hangul mixed list or phone list file.',
            save_failed: "Couldn't save the playlist.", bad_save_result: 'The save result is not valid.',
            export_detail: 'Saved the Spotify songs, YouTube links, play order and lyrics search details together.',
            copy_path: 'Copy file path', export_title: 'Playlist exported', export_done: 'List saved: %1',
            pick_file: 'Choose a JSON file of 3 MB or less.', imported: 'Imported as a new local list: %1',
            imported_skipped: 'Imported as a new local list: %1 (%2 items left out, such as phone files and repeated videos)',
        },
        ko: {
            bad_text: '목록의 문자열 형식이나 길이가 올바르지 않습니다.', bad_duration: '곡의 재생 시간이 올바르지 않습니다.',
            bad_image: '앨범 이미지 주소가 올바르지 않습니다.', spotify_image_only: 'Spotify 앨범 이미지 주소만 가져올 수 있습니다.',
            bad_spotify_uri: 'Spotify 곡 주소가 올바르지 않습니다.', bad_entry_key: 'Spotify 곡 항목 식별자가 올바르지 않습니다.',
            bad_video_id: 'YouTube 영상 ID가 올바르지 않습니다.', no_playlist: '플레이리스트 데이터가 없습니다.',
            too_many: '각 종류의 곡은 2,000 곡까지 입출력할 수 있습니다.', duplicate_entry: '중복된 곡 항목 식별자가 있습니다.',
            default_name: '가져온 혼합 목록', bad_source: '원본 Spotify 플레이리스트 주소가 올바르지 않습니다.',
            bad_order: '혼합 재생 순서가 올바르지 않습니다.', bad_order_item: '혼합 재생 순서의 항목이 올바르지 않습니다.',
            save_too_big: '목록 파일은 3 MB까지 저장할 수 있습니다.', bad_phone_items: '휴대폰 목록의 곡 항목이 올바르지 않습니다.',
            import_too_big: '목록 파일은 3 MB까지 가져올 수 있습니다.', bad_json: '올바른 JSON 목록 파일이 아닙니다.',
            unsupported: '지원하는 Spotify 한글 혼합 목록이나 휴대폰 목록 파일이 아닙니다.',
            save_failed: '플레이리스트를 저장하지 못했습니다.', bad_save_result: '저장 결과가 올바르지 않습니다.',
            export_detail: 'Spotify 곡과 YouTube 링크, 재생 순서 및 가사 검색 정보를 함께 저장했습니다.',
            copy_path: '저장 경로 복사', export_title: '플레이리스트 내보내기 완료', export_done: '목록 저장 완료: %1',
            pick_file: '3 MB 이하의 JSON 파일을 선택해 주세요.', imported: '새 로컬 목록으로 가져왔습니다: %1',
            imported_skipped: '새 로컬 목록으로 가져왔습니다: %1 (휴대폰 파일과 중복 영상 등 %2 개 항목 제외)',
        },
    };
    // The language is read on each call, from Spotify's locale and then the browser's.
    const languageOf = host => /^ko(?:[-_]|$)/i.test(String(host?.Spicetify?.Locale?.getLocale?.() || host?.navigator?.language || '')) ? 'ko' : 'en';
    function translate(host, key, ...args) {
        const text = STRINGS[languageOf(host)]?.[key] ?? STRINGS.en[key] ?? key;
        return text.replace(/%(\d)/g, (mark, n) => args[n - 1] === undefined ? mark : String(args[n - 1]));
    }
    const t = (key, ...args) => translate(globalThis, key, ...args);
    const fail = (key, ...args) => { throw new Error(t(key, ...args)); };
    function text(value, limit, fallback = '') {
        if (value == null) return fallback;
        if (typeof value !== 'string' || value.length > limit || value.includes('\0')) fail('bad_text');
        return value;
    }
    function duration(value) {
        if (value == null) return 0;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 31536000) fail('bad_duration');
        return value;
    }
    function image(value) {
        if (!value) return '';
        const source = text(value, 1200);
        if (/^spotify:image:[a-fA-F0-9]{20,64}$/.test(source)) return source;
        let url; try { url = new URL(source); } catch { fail('bad_image'); }
        if (url.protocol !== 'https:' || !imageHosts.has(url.hostname) || url.username || url.password || url.port) fail('spotify_image_only');
        return url.origin + url.pathname;
    }
    function cleanNative(value, index) {
        if (!value || value.kind !== 'spotify' || !spotifyTrack.test(value.uri || '')) fail('bad_spotify_uri');
        const entryKey = text(value.entryKey, 180, value.uri + '#' + index);
        if (!entryKey || /[\x00-\x1f]/.test(entryKey)) fail('bad_entry_key');
        return { kind: 'spotify', uri: value.uri, title: text(value.title, 300, 'Spotify'), artist: text(value.artist, 200),
            duration: duration(value.duration), entryKey, album: text(value.album, 300), image: image(value.image) };
    }
    function cleanYoutube(value) {
        if (!value || value.kind !== 'youtube' || !youtubeId.test(value.videoId || '')) fail('bad_video_id');
        const item = { kind: 'youtube', videoId: value.videoId, title: text(value.title, 300, value.videoId),
            artist: text(value.artist, 200, 'YouTube'), duration: duration(value.duration) };
        if (value.after != null) item.after = text(value.after, 180);
        if (value.lyricTitle != null) { item.lyricTitle = text(value.lyricTitle, 300); item.lyricArtist = text(value.lyricArtist, 200); }
        return item;
    }
    const key = item => item.kind === 'youtube' ? 'yt:' + item.videoId : 'sp:' + item.entryKey;
    function cleanPlaylist(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('no_playlist');
        if (!Array.isArray(value.nativeTracks) || !Array.isArray(value.tracks)
            || value.nativeTracks.length > MAX_TRACKS || value.tracks.length > MAX_TRACKS) fail('too_many');
        const nativeTracks = value.nativeTracks.map(cleanNative), tracks = value.tracks.map(cleanYoutube);
        const nativeKeys = new Set(nativeTracks.map(t => t.entryKey)), videoKeys = new Set(tracks.map(t => t.videoId));
        if (nativeKeys.size !== nativeTracks.length || videoKeys.size !== tracks.length) fail('duplicate_entry');
        const playlist = { name: text(value.name, 100, t('default_name')), nativeTracks, tracks };
        if (value.sourceUri != null) {
            if (!spotifyPlaylist.test(value.sourceUri)) fail('bad_source');
            playlist.sourceUri = value.sourceUri;
        }
        const before = tracks.filter(t => t.after === ''), tail = tracks.filter(t => t.after !== '' && !nativeKeys.has(t.after));
        const defaultOrder = [...before, ...nativeTracks.flatMap(t => [t, ...tracks.filter(link => link.after === t.entryKey)]), ...tail].map(key);
        if (value.order != null && (!Array.isArray(value.order) || value.order.length > MAX_TRACKS * 2)) fail('bad_order');
        const valid = new Set(defaultOrder), order = [];
        for (const item of value.order || []) {
            if (typeof item !== 'string' || item.length > 183 || !/^(sp|yt):[^\x00-\x1f]+$/.test(item)) fail('bad_order_item');
            if (valid.has(item) && !order.includes(item)) order.push(item);
        }
        playlist.order = order.concat(defaultOrder.filter(item => !order.includes(item)));
        return playlist;
    }
    function documentFor(playlist, date = new Date()) {
        const value = { format: FORMAT, schema: 1, exportedAt: date.toISOString(), playlist: cleanPlaylist(playlist) };
        if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) fail('save_too_big');
        return value;
    }
    // A list file of the Android app (Myspoti-ex): its YouTube links come over in the phone's order.
    // Phone files only play on that phone and a PC list holds each video once, so both are left out and counted.
    function fromPhone(value) {
        if (value.items != null && !Array.isArray(value.items)) fail('bad_phone_items');
        const items = value.items || [];
        if (items.length > MAX_TRACKS) fail('too_many');
        const seen = new Set();
        const tracks = items.flatMap(item => {
            const videoId = typeof item?.uri === 'string' ? item.uri.match(phoneYoutube)?.[1] : undefined;
            if (!videoId || seen.has(videoId)) return [];
            seen.add(videoId);
            // The phone keeps one title and artist, also its lyric search name; the PC search reads the title then.
            return [{ kind: 'youtube', videoId, title: item.title || undefined, artist: item.artist || undefined,
                duration: typeof item.duration === 'number' ? item.duration / 1000 : item.duration }];
        });
        const name = text(value.name, 100).trim() || undefined;
        return { playlist: cleanPlaylist({ name, nativeTracks: [], tracks, order: tracks.map(key) }), skipped: items.length - tracks.length };
    }
    function read(source) {
        if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_BYTES) fail('import_too_big');
        let value; try { value = JSON.parse(source.replace(/^\uFEFF/, '')); } catch { fail('bad_json'); }
        if (value?.format === PHONE_FORMAT && value.version === 1) return fromPhone(value);
        if (!value || value.format !== FORMAT || value.schema !== 1) fail('unsupported');
        return { playlist: cleanPlaylist(value.playlist), skipped: 0 };
    }
    const parse = source => read(source).playlist;
    function imported(source, id) {
        return { id, local: true, ...parse(source) };
    }
    function create(host, options) {
        let disposed = false;
        const pending = new Set(), inputs = new Set();
        const t = (key, ...args) => translate(host, key, ...args);
        const notify = (message, error = false) => host.Spicetify?.showNotification?.(message, error);
        const check = () => { if (disposed) throw new DOMException('Playlist tools disposed', 'AbortError'); };
        async function exportCurrent() {
            check(); const document = documentFor(await options.getCurrent()); check();
            const controller = new AbortController(); pending.add(controller);
            const timeout = host.setTimeout(() => controller.abort(), 15000);
            try {
                const response = await host.fetch('http://127.0.0.1:19643/youtube/export', { method: 'POST',
                    // The helper answers its errors in the language asked for.
                    headers: { 'Content-Type': 'application/json', 'X-Hangul-Lyrics-Client': 'ivlyrics', 'X-Hangul-Language': languageOf(host) },
                    body: JSON.stringify(document), signal: controller.signal });
                const result = await response.json(); check();
                if (!response.ok) throw new Error(result.error || t('save_failed'));
                if (typeof result.path !== 'string' || typeof result.filename !== 'string') throw new Error(t('bad_save_result'));
                const modal = host.Spicetify?.PopupModal;
                if (modal && host.document) {
                    const content = host.document.createElement('div'), description = host.document.createElement('p');
                    description.textContent = t('export_detail');
                    const location = host.document.createElement('p'); location.textContent = result.path; location.style.cssText = 'overflow-wrap:anywhere;user-select:text';
                    const copy = host.document.createElement('button'); copy.textContent = t('copy_path');
                    copy.onclick = () => host.Spicetify.Platform.ClipboardAPI.copy(result.path);
                    content.append(description, location, copy); modal.display({ title: t('export_title'), content });
                } else notify(t('export_done', result.path));
                return result;
            } finally { host.clearTimeout(timeout); pending.delete(controller); }
        }
        async function importFile(file) {
            check(); if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size) || file.size > MAX_BYTES || file.size < 1) throw new Error(t('pick_file'));
            const source = await file.text(); check();
            const { playlist: value, skipped } = read(source), playlist = { id: host.crypto.randomUUID(), local: true, ...value };
            await options.onImport(playlist); check();
            notify(skipped ? t('imported_skipped', playlist.name, skipped) : t('imported', playlist.name));
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
