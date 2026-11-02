/** @file youtube-links.js
 * @brief Manage link-only mixed playlists and route native Spotify playbar controls to an isolated YouTube player.
 */
(() => {
// Every text the link screens show. English is the default; Korean when Spotify's UI is Korean.
const STRINGS = {
    en: {
        default_list: 'Linked music', untitled_list: 'Playlist',
        module_failed: "Couldn't load the YouTube modules. They are tried again on their own once the helper is ready.",
        open_playlist_to_export: 'Open the playlist to export first.', too_many_lists: 'There are already as many lists as can be saved.',
        panel_title: 'Linked music', collapse: 'Collapse', back_to_spotify: 'Back to Spotify', link_placeholder: 'YouTube / YouTube Music link',
        new_list: 'New list', list_name_prompt: 'Playlist name', add_link: 'Add link', add_current_song: 'Add the current Spotify song',
        import_current_list: 'Import the current Spotify list',
        panel_hint: "Only the links are saved. This list is kept in Linked music on this PC; the original list on Spotify's servers is not changed.",
        frame_title: 'YouTube linked music player', check_mode: 'Check the playback mode.', mode_not_saved: "Couldn't save the playback mode setting.",
        audio_error: 'The fallback audio failed to play. Play the song again.', audio_checking: 'Looking for the public audio…',
        audio_not_found: "Couldn't find the public audio.", audio_bad_url: 'Not a valid public audio address.',
        audio_timeout: 'Looking up the audio took too long.', audio_retry: '%1 Choose Audio again, or choose YouTube video.',
        open_playlist_for_youtube: 'Open the Spotify playlist to add YouTube to.', remove: 'Remove', empty_list: 'Add a link or the current Spotify song.',
        read_timeout: 'Reading the Spotify list took too long. Press Reload.',
        too_long: 'A mixed list supports up to 2,000 songs for now. The original list is shown.',
        read_incomplete: "Couldn't read the whole Spotify list. Press Reload.",
        unsupported_item: 'The list has an item that is not supported, so the original Spotify list is shown.',
        local_label: 'Imported local playlist', play_button: '▶ Play', spotify_playlist: 'Spotify playlist', add_youtube_link: 'Add YouTube link',
        reload: 'Reload', mixed_list: 'Mixed list', edit_original: 'Edit original', spotify_order: 'Spotify order', export: 'Export', import: 'Import',
        links_saved_note: 'YouTube links are saved on this PC.', reading_list: 'Reading the Spotify list…',
        list_counts: '%1 Spotify + %2 YouTube songs · Links are saved on this PC.', mixed_tracklist: '%1 mixed track list',
        column_title: 'Title', column_album: 'Album / source', column_duration: 'Duration', play_item: 'Play %1',
        move_up: 'Move %1 up', move_down: 'Move %1 down', remove_link: 'Remove the %1 link', copy_title: 'Copy title',
        add_youtube_after: 'Add YouTube after this song', open_spotify_song: 'Open the Spotify song', lyric_info: 'Lyrics search info',
        select_youtube_first: 'Select a YouTube song first.', lyric_title_label: 'Song title for the lyrics search',
        lyric_artist_label: 'Original artist for the lyrics search',
        lyric_info_note: "For a cover video you can give the original song's title and artist. The original's timing can differ from the video.",
        lyric_save: 'Save and look up the lyrics again', lyric_title_required: 'Enter a song title for the lyrics search.',
        lyric_info_title: 'YouTube lyrics search info', reload_before_play: 'Reload the list, then play it.',
        this_computer_only: "Mixed YouTube playback works on this computer. Choose this computer in Spotify's Connect to a device.",
        invalid_link: 'Enter a supported YouTube video link.', metadata_failed: "Couldn't get the video's details.",
        open_playlist_first: 'Open a Spotify playlist first.', video_url_placeholder: 'YouTube / YouTube Music video address',
        video_url_label: 'YouTube video address', position_label: 'Where to add it in the list', position_end: 'End of the list',
        position_start: 'Start of the list', after_track: 'After %1', saved_videos_label: 'Videos added before',
        saved_videos_hint: 'Type an address or pick an earlier video',
        add_dialog_note: "Adds a link between this playlist's songs. The link details are saved on this PC.",
        add_to_playlist: 'Add to this playlist', checking_video: "Checking the video's details…",
        already_in_playlist: 'This video is already in this playlist.', video_timeout: 'Looking up the video took too long. Try again.',
        add_dialog_title: 'Add YouTube to %1', already_in_list: 'This video is already in this list.',
        youtube_info_failed: "Couldn't get the YouTube details.", select_spotify_song: 'Select a Spotify song first.',
        select_playlist_song: 'Select a song from a Spotify playlist first.', list_read_unsupported: "This Spotify version can't read lists.",
        imported_list_name: 'List imported from Spotify', imported_notice: 'Imported %1 songs into a Linked music list. The original list stays as it is.',
        device_changed: 'The playback device changed, so mixed YouTube playback stopped. Play it again on this computer.',
        spotify_play_failed: "Couldn't play the Spotify song.", press_play: "Press the YouTube player's play button.",
        youtube_pause: 'Pause YouTube', youtube_play: 'Play YouTube', repeat: 'Linked music repeat: %1', playlist_pause: 'Pause %1', playlist_play: 'Play %1',
        shuffle_on: 'Linked music shuffle on', shuffle_off: 'Linked music shuffle off', plays_here: 'YouTube linked music plays on this PC.',
        copy_link: 'Copy YouTube link', youtube_link_music: 'YouTube linked music', managed_in_list: 'YouTube videos are managed in Linked music lists.',
        lyric_loading: 'Looking up lyrics…', lyric_server: 'Lyrics server answered: %1',
        lyric_not_found: 'No original lyrics were found for that title and artist.',
        lyric_timing: 'Timing follows the original song and can differ from a cover video.',
        add_youtube_menu: 'Add YouTube to playlist', no_local_lists: 'No imported local lists.', import_from_file: 'Import from a file',
        local_lists: 'Local mixed playlists', import_mixed: 'Import a mixed playlist', playback_mode: 'YouTube playback mode',
        playback_mode_note: 'Audio uses the public audio stream. YouTube video can show ads, and it is separate from your Spotify sign-in.',
        mode_audio: 'Audio', mode_video: 'YouTube video', no_playlist: 'No such playlist.',
    },
    ko: {
        default_list: '링크 음악', untitled_list: '재생목록',
        module_failed: 'YouTube 연결 모듈을 불러오지 못했습니다. 도우미가 준비되면 자동으로 다시 시도합니다.',
        open_playlist_to_export: '내보낼 플레이리스트를 먼저 여세요.', too_many_lists: '저장 가능한 목록 수를 초과했습니다.',
        panel_title: '링크 음악', collapse: '접기', back_to_spotify: 'Spotify로 돌아가기', link_placeholder: 'YouTube / YouTube Music 링크',
        new_list: '목록 만들기', list_name_prompt: '재생목록 이름', add_link: '링크 추가', add_current_song: '현재 Spotify 곡 추가',
        import_current_list: '현재 Spotify 목록 가져오기',
        panel_hint: '링크만 저장합니다. 이 목록은 이 PC의 링크 음악에서 관리하며 Spotify 서버의 원본 목록은 바꾸지 않습니다.',
        frame_title: 'YouTube 링크 음악 플레이어', check_mode: '재생 방식을 확인해 주세요.', mode_not_saved: '재생 방식 설정을 저장하지 못했습니다.',
        audio_error: '대체 오디오 재생에 실패했습니다. 해당 곡을 다시 재생해 주세요.', audio_checking: '공개 음원을 확인하는 중…',
        audio_not_found: '공개 음원을 찾지 못했습니다.', audio_bad_url: '유효한 공개 오디오 주소가 아닙니다.',
        audio_timeout: '음원 조회 시간이 초과됐습니다.', audio_retry: '%1 음원 재생을 다시 누르거나 YouTube 영상을 선택해 주세요.',
        open_playlist_for_youtube: 'YouTube를 추가할 Spotify 플레이리스트를 여세요.', remove: '제거', empty_list: '링크나 현재 Spotify 곡을 추가하세요.',
        read_timeout: 'Spotify 목록 조회 시간이 초과됐습니다. 다시 불러오기를 눌러 주세요.',
        too_long: '통합 목록은 현재 2,000 곡까지 지원합니다. 원본 목록을 표시합니다.',
        read_incomplete: 'Spotify 목록을 끝까지 읽지 못했습니다. 다시 불러오기를 눌러 주세요.',
        unsupported_item: '지원하지 않는 항목이 있어 원본 Spotify 목록을 표시합니다.',
        local_label: '가져온 로컬 플레이리스트', play_button: '▶ 재생', spotify_playlist: 'Spotify 플레이리스트', add_youtube_link: 'YouTube 링크 추가',
        reload: '다시 불러오기', mixed_list: '통합 목록', edit_original: '원본 편집', spotify_order: 'Spotify 순서로', export: '내보내기', import: '가져오기',
        links_saved_note: 'YouTube 링크는 이 PC에 저장됩니다.', reading_list: 'Spotify 목록을 읽는 중…',
        list_counts: 'Spotify %1 곡 + YouTube %2 곡 · 링크는 이 PC에 저장됩니다.', mixed_tracklist: '%1 통합 곡 목록',
        column_title: '제목', column_album: '앨범 / 출처', column_duration: '재생 시간', play_item: '%1 재생',
        move_up: '%1 위로 이동', move_down: '%1 아래로 이동', remove_link: '%1 링크 제거', copy_title: '제목 복사',
        add_youtube_after: '이 곡 뒤에 YouTube 추가', open_spotify_song: 'Spotify 곡 열기', lyric_info: '가사 검색 정보',
        select_youtube_first: 'YouTube 곡을 먼저 선택하세요.', lyric_title_label: '가사 검색용 곡명',
        lyric_artist_label: '가사 검색용 원곡 가수',
        lyric_info_note: '커버 영상의 경우 원곡 제목과 가수를 지정할 수 있습니다. 원곡 시간은 영상과 다를 수 있습니다.',
        lyric_save: '저장하고 가사 다시 조회', lyric_title_required: '가사 검색용 곡명을 입력해 주세요.',
        lyric_info_title: 'YouTube 가사 검색 정보', reload_before_play: '목록을 다시 불러온 뒤 재생해 주세요.',
        this_computer_only: 'YouTube 혼합 재생은 이 컴퓨터에서 지원합니다. Spotify의 기기에 연결하기에서 이 컴퓨터를 선택해 주세요.',
        invalid_link: '지원하는 YouTube 영상 링크를 입력해 주세요.', metadata_failed: '영상 정보를 가져오지 못했습니다.',
        open_playlist_first: 'Spotify 플레이리스트를 먼저 여세요.', video_url_placeholder: 'YouTube / YouTube Music 영상 주소',
        video_url_label: 'YouTube 영상 주소', position_label: '목록에 추가할 위치', position_end: '목록 맨 끝',
        position_start: '목록 맨 앞', after_track: '%1 뒤', saved_videos_label: '이전에 추가한 영상',
        saved_videos_hint: '직접 입력하거나 이전 영상 선택',
        add_dialog_note: '이 플레이리스트의 곡 사이에 링크를 추가합니다. 링크 정보는 이 PC에 저장됩니다.',
        add_to_playlist: '이 플레이리스트에 추가', checking_video: '영상 정보를 확인하는 중…',
        already_in_playlist: '이미 이 플레이리스트에 추가한 영상입니다.', video_timeout: '영상 조회 시간이 초과됐습니다. 다시 시도해 주세요.',
        add_dialog_title: '%1에 YouTube 추가', already_in_list: '이미 이 목록에 있는 영상입니다.',
        youtube_info_failed: 'YouTube 정보를 가져오지 못했습니다.', select_spotify_song: '먼저 Spotify 곡을 선택하세요.',
        select_playlist_song: 'Spotify 재생목록의 곡을 먼저 선택하세요.', list_read_unsupported: '현재 Spotify 버전에서 목록 읽기를 지원하지 않습니다.',
        imported_list_name: 'Spotify에서 가져온 목록', imported_notice: '%1 곡을 링크 음악 목록으로 가져왔습니다. 원본 목록은 유지됩니다.',
        device_changed: '재생 기기가 변경되어 YouTube 혼합 재생을 종료했습니다. 이 컴퓨터에서 다시 재생해 주세요.',
        spotify_play_failed: 'Spotify 곡을 재생하지 못했습니다.', press_play: 'YouTube 플레이어의 재생 버튼을 눌러 주세요.',
        youtube_pause: 'YouTube 일시정지', youtube_play: 'YouTube 재생', repeat: '링크 음악 반복: %1', playlist_pause: '%1 일시 정지하기', playlist_play: '%1 재생하기',
        shuffle_on: '링크 음악 셔플 켜짐', shuffle_off: '링크 음악 셔플 꺼짐', plays_here: 'YouTube 링크 음악은 현재 PC에서 재생됩니다.',
        copy_link: 'YouTube 링크 복사', youtube_link_music: 'YouTube 링크 음악', managed_in_list: 'YouTube 영상은 링크 음악 목록에서 관리합니다.',
        lyric_loading: '가사 자료 조회 중…', lyric_server: '가사 제공 서버 응답: %1',
        lyric_not_found: '해당 제목과 가수로 원문 가사를 찾지 못했습니다.',
        lyric_timing: '원곡 기준 시간이며 커버 영상과 다를 수 있습니다.',
        add_youtube_menu: '플레이리스트에 YouTube 추가', no_local_lists: '가져온 로컬 목록이 없습니다.', import_from_file: '파일에서 가져오기',
        local_lists: '로컬 혼합 플레이리스트', import_mixed: '혼합 플레이리스트 가져오기', playback_mode: 'YouTube 재생 방식',
        playback_mode_note: '음원 재생은 공개 오디오를 사용합니다. YouTube 영상에는 광고가 나올 수 있으며, Spotify 로그인과 별도입니다.',
        mode_audio: '음원 재생', mode_video: 'YouTube 영상', no_playlist: '재생목록이 없습니다.',
    },
};
// Spotify's UI language, read on each call: Korean for ko/ko-KR, English otherwise.
function language(){return /^ko(?:[-_]|$)/i.test(String(globalThis.Spicetify?.Locale?.getLocale?.()||globalThis.navigator?.language||''))?'ko':'en';}
function t(key,...args){const text=STRINGS[language()]?.[key]??STRINGS.en[key]??key;return text.replace(/%(\d)/g,(mark,n)=>args[n-1]===undefined?mark:String(args[n-1]));}
const SpotifyHangulLinkModel = (() => {
    'use strict';
    function youtubeId(value) {
        const text=String(value||'').trim();
        if (/^[\w-]{11}$/.test(text)) return text;
        let url;try{url=new URL(text);}catch{return null;}
        if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
        if(!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be'].includes(url.hostname))return null;
        const id=url.hostname.endsWith('youtu.be')?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})$/)?.[1];
        return /^[\w-]{11}$/.test(id||'')?id:null;
    }
    function nextIndex(index,length,direction,repeat,shuffle,random=Math.random) {
        if(!length)return -1;
        if(repeat==='one'&&direction===0)return index;
        if(shuffle&&length>1){const offset=1+Math.floor(random()*(length-1));return(index+offset)%length;}
        const result=index+(direction<0?-1:1);
        return result<0?(repeat==='all'?length-1:-1):result>=length?(repeat==='all'?0:-1):result;
    }
    function track(value) {
        if(!value||typeof value!=='object')return null;
        if(value.kind==='youtube'&&youtubeId(value.videoId))return{kind:'youtube',videoId:youtubeId(value.videoId),title:String(value.title||value.videoId).slice(0,300),artist:String(value.artist||'YouTube').slice(0,200),duration:Math.max(0,Number(value.duration)||0),...(typeof value.after==='string'?{after:value.after.slice(0,180)}:{}),...(typeof value.lyricTitle==='string'?{lyricTitle:value.lyricTitle.slice(0,300),lyricArtist:String(value.lyricArtist||'').slice(0,200)}:{})};
        if(value.kind==='spotify'&&/^spotify:track:[\da-zA-Z]{22}$/.test(value.uri||''))return{kind:'spotify',uri:value.uri,title:String(value.title||'Spotify').slice(0,300),artist:String(value.artist||'').slice(0,200),duration:Math.max(0,Number(value.duration)||0)};
        return null;
    }
    function library(value) {
        if(value?.schema!==1||!Array.isArray(value.playlists))return{schema:1,playlists:[{id:'default',name:t('default_list'),tracks:[]}]};
        const playlists=value.playlists.filter(p=>p&&typeof p.id==='string'&&Array.isArray(p.tracks)).slice(0,100).map(p=>({id:p.id.slice(0,80),name:String(p.name||t('untitled_list')).slice(0,100),tracks:p.tracks.slice(0,2000).map(track).filter(Boolean),...(/^spotify:playlist:[A-Za-z0-9]{22}$/.test(p.sourceUri||'')?{sourceUri:p.sourceUri}:{}),...(Array.isArray(p.order)?{order:[...new Set(p.order.filter(k=>typeof k==='string'&&/^(sp|yt):.{1,180}$/.test(k)))].slice(0,4000)}:{}),...(p.local===true&&Array.isArray(p.nativeTracks)?{local:true,nativeTracks:p.nativeTracks.slice(0,2000).map((n,i)=>{const item=track(n);if(item?.kind!=='spotify')return null;let image='';if(/^spotify:image:[a-fA-F0-9]{20,64}$/.test(n.image||''))image=n.image;else try{const url=new URL(n.image);if(url.protocol==='https:'&&['i.scdn.co','mosaic.scdn.co','image-cdn-ak.spotifycdn.com','image-cdn-fa.spotifycdn.com','image-cdn.spotifycdn.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port)image=url.origin+url.pathname;}catch{}return{...item,entryKey:String(n.entryKey||item.uri+'#'+i).slice(0,180),album:String(n.album||'').slice(0,300),image};}).filter(Boolean)}:{})}));
        return playlists.length?{schema:1,playlists}:library(null);
    }
    const rowKey=item=>item.kind==='youtube'?'yt:'+item.videoId:'sp:'+item.entryKey;
    function merge(native,links,order=[]) {
        const buckets=new Map(),tail=[];
        const keys=new Set(native.map(t=>t.entryKey));
        for(const value of links){const item=track(value);if(item?.kind!=='youtube')continue;
            if(item.after!==''&&!keys.has(item.after)){tail.push(item);continue;}
            if(!buckets.has(item.after))buckets.set(item.after,[]);buckets.get(item.after).push(item);}
        const live=[...(buckets.get('')||[]),...native.flatMap(item=>[item,...(buckets.get(item.entryKey)||[])]),...tail];
        if(!order.length)return live;
        const byKey=new Map(live.map(item=>[rowKey(item),item])),result=[];
        for(const key of order)if(byKey.has(key)){result.push(byKey.get(key));byKey.delete(key);}
        return result.concat(live.filter(item=>byKey.has(rowKey(item))));
    }
    function place(native,links,videoId,targetIndex) {
        const mixed=merge(native,links),from=mixed.findIndex(t=>t.kind==='youtube'&&t.videoId===videoId);
        if(from<0)return links;
        const [item]=mixed.splice(from,1);mixed.splice(Math.max(0,Math.min(mixed.length,targetIndex)),0,item);
        let after='';return mixed.flatMap(t=>{if(t.kind==='spotify'){after=t.entryKey;return[];}return[{...t,after}];});
    }
    function reorder(items,key,targetIndex){const result=[...items],from=result.findIndex(item=>rowKey(item)===key);if(from<0)return result.map(rowKey);const[item]=result.splice(from,1);result.splice(Math.max(0,Math.min(result.length,targetIndex)),0,item);return result.map(rowKey);}
    return{youtubeId,nextIndex,track,library,merge,place,rowKey,reorder};
})();
if(typeof module!=='undefined')module.exports=SpotifyHangulLinkModel;
if(typeof window!=='undefined')(() => {
    'use strict';
    const BASE='http://127.0.0.1:19643',KEY='spotify-hangul:link-playlists:v1',MODE_KEY='spotify-hangul:youtube-playback-mode:v1',MODEL=SpotifyHangulLinkModel;
    // The loopback helper can drop a connection while it restarts; retry a network failure twice before reporting it.
    async function postHelper(path,body,signal){for(let attempt=0;;attempt++){try{return await fetch(BASE+path,{method:'POST',headers:{'Content-Type':'application/json','X-Hangul-Lyrics-Client':'ivlyrics'},body:JSON.stringify(body),signal});}catch(error){if(error.name==='AbortError'||attempt>=2)throw error;await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));}}}
    function readPlaybackMode(){try{return localStorage.getItem(MODE_KEY)==='audio'?'audio':'video';}catch{return'video';}}
    let adapterLoading=false,moduleFailures=0;
    const init=()=>{
        if(!window.Spicetify?.Player||!Spicetify.Topbar||!Spicetify.Menu||typeof Spicetify.Platform?.History?.listen!=='function'||!document.querySelector('main')||!document.querySelector('[data-testid="now-playing-bar"]')){setTimeout(init,1000);return;}
        if(window.SpotifyHangulLinks)return;
        const dependency=[['SpotifyHangulIvLyrics','ivlyrics.js'],['SpotifyHangulLibrary','library.js'],['SpotifyHangulOverlayControls','overlay.js'],['SpotifyHangulDesktopBridge','desktop.js'],['SpotifyHangulNowPlaying','now-playing.js']].find(([name])=>!window[name]);
        if(dependency){if(!adapterLoading){adapterLoading=true;const script=document.createElement('script');script.src=BASE+'/youtube/'+dependency[1];script.onload=()=>{adapterLoading=false;init();};script.onerror=()=>{adapterLoading=false;script.remove();moduleFailures++;if(moduleFailures===3)Spicetify.showNotification?.(t('module_failed'),true);if(moduleFailures<40)setTimeout(init,3000);};document.head.append(script);}return;}
        // Without this stylesheet the now-playing panel draws its icons full size; retry a failed load instead of keeping it broken.
        let nowPlayingStyle=null;const loadNowPlayingStyle=attempt=>{const link=document.createElement('link');link.id='spotify-hangul-now-playing-style';link.rel='stylesheet';link.href=BASE+'/youtube/now-playing.css'+(attempt?'?r='+attempt:'');link.onerror=()=>{link.remove();if(attempt<10&&!disposed)setTimeout(()=>loadNowPlayingStyle(attempt+1),2000);};nowPlayingStyle=link;document.head.append(link);};if(!document.getElementById('spotify-hangul-now-playing-style'))loadNowPlayingStyle(0);
        let data,rawLibrary=null;try{rawLibrary=localStorage.getItem(KEY);data=MODEL.library(JSON.parse(rawLibrary));}catch{data=MODEL.library(null);}
        // A schema change or damaged entry falls back to fewer lists, and the next save would erase the rest; keep the first such original once.
        {let rawCount=-1;try{rawCount=JSON.parse(rawLibrary)?.playlists?.length??-1;}catch{}if(rawLibrary&&rawLibrary!=='null'&&(rawCount<0||data.playlists.length<rawCount))try{if(localStorage.getItem(KEY+':backup')===null)localStorage.setItem(KEY+':backup',rawLibrary);}catch{}}
        let selected=data.playlists[0].id,queue=[],queueIndex=-1,active=false,kind=null,playing=false,playbackIntent=false,shuffle=false,repeat='off',disposed=false;
        let baseline=null,state={seconds:0,duration:0,volume:25,muted:false,quality:'unknown'},lastError='',audioGain=1,lyrics=[],lyricsResult=null,nativeTransitionUntil=0,lastNativeDuration=0,lyricAbort=null,queueSource=null,mediaMode='youtube',streamRequest=null,streamAttempted=false,autoRetried=null,autoRetryTimer=null;
        let preferredMode=readPlaybackMode(),streamEpoch=0,pendingAudioSeek=null;
        const session=crypto.randomUUID(),listeners=[],originals={},savedNodes=new Map(),volumeNodes=new Set();
        const playlist=()=>data.playlists.find(p=>p.id===selected)||data.playlists[0];
        let view=null,viewEpoch=0,viewTimer=null,originalGrid=null,gridDisplay='',mixedGrid=null,viewTools=null,viewBypass=false,localRoot=null;const localHidden=new Map();
        const dockHidden=new Map();
        const ivLyrics=window.SpotifyHangulIvLyrics.create(window);
        const library=window.SpotifyHangulLibrary.create(window,{getCurrent:async()=>{if(!view)throw new Error(t('open_playlist_to_export'));const p=binding(view.uri);return{name:view.name,sourceUri:p?.sourceUri||(/^spotify:playlist:/.test(view.uri)?view.uri:undefined),nativeTracks:await readPlaylist(view.uri),tracks:p?.tracks||[],order:p?.order||[]};},onImport:async p=>{if(data.playlists.length>=100)throw new Error(t('too_many_lists'));data.playlists.push(p);save();Spicetify.Platform.History.push('/spotify-hangul-links/'+p.id);}});
        let overlay=null,desktopBridge=null;
        const notify=(message,error=false)=>Spicetify.showNotification?.(message,error);
        const save=()=>localStorage.setItem(KEY,JSON.stringify(data));
        const el=(tag,text,css)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(css)node.style.cssText=css;return node;};
        const button=(text,action)=>{const node=el('button',text,'background:#303030;color:white;border:1px solid #555;border-radius:6px;padding:8px 12px;cursor:pointer');node.onclick=()=>Promise.resolve().then(action).catch(e=>notify(e.message||String(e),true));return node;};
        const panel=el('section',undefined,'position:fixed;left:90px;right:16px;top:64px;bottom:96px;z-index:9999;background:#121212;color:white;border:1px solid #555;border-radius:10px;padding:18px;overflow:auto;display:none;font:14px system-ui');panel.id='spotify-hangul-links';
        const header=el('div',undefined,'display:flex;align-items:center;gap:10px;margin-bottom:12px');
        header.append(el('h2',t('panel_title'),'margin:0;flex:1'),button(t('collapse'),()=>collapse()),button(t('back_to_spotify'),()=>stop()));panel.append(header);
        const controls=el('div',undefined,'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0');
        const choose=el('select',undefined,'background:#222;color:white;padding:8px;max-width:230px');choose.onchange=()=>{selected=choose.value;render();};
        const url=el('input');url.placeholder=t('link_placeholder');url.style.cssText='flex:1;min-width:200px;background:#222;color:white;padding:9px;border:1px solid #555;border-radius:5px';
        controls.append(choose,button(t('new_list'),()=>{const name=prompt(t('list_name_prompt'));if(!name?.trim())return;const p={id:crypto.randomUUID(),name:name.trim().slice(0,100),tracks:[]};data.playlists.push(p);selected=p.id;save();render();}),url,button(t('add_link'),()=>addYoutube(url.value)),button(t('add_current_song'),()=>addCurrent()),button(t('import_current_list'),()=>importCurrentPlaylist()));panel.append(controls);
        const hint=el('p',t('panel_hint'),'color:#aaa;margin:8px 0');panel.append(hint);
        const body=el('div',undefined,'display:grid;grid-template-columns:minmax(280px,1fr) minmax(360px,1.2fr);gap:16px');
        const list=el('div',undefined,'max-height:60vh;overflow:auto');const right=el('div');
        const frame=document.createElement('iframe');frame.id='spotify-hangul-youtube-frame';frame.title=t('frame_title');frame.allow='autoplay; encrypted-media; fullscreen';frame.style.cssText='width:100%;height:100%;min-height:200px;border:0;background:black';
        const audio=new Audio();
        const lyricBox=el('div',undefined,'max-height:220px;overflow:auto;white-space:pre-wrap;line-height:1.8');
        const nowPlaying=window.SpotifyHangulNowPlaying.create(window,{onMode:setPlaybackMode,onLyrics:openLyrics,onSearch:()=>editLyricInfo(queue[queueIndex]),onRetry:retryCurrentPlayback,onQueue:showQueue,onClose:stop});
        nowPlaying.mediaAnchor.append(frame);right.append(nowPlaying.element);body.append(list,right);panel.append(body);document.body.append(panel);
        // ivLyrics' own page-mount request is skipped when the page is already open, so ask here too (it throttles and checks the setting).
        function openLyrics(){ivLyrics.open();void window.OverlaySender?.openOverlayApp?.();}
        function updateModeControls(){renderStatus();}
        function retryCurrentPlayback(){const item=queue[queueIndex];if(!active||item?.kind!=='youtube')return;const seconds=mediaMode==='direct'&&audio.src&&Number.isFinite(audio.currentTime)?audio.currentTime:Math.max(0,Number(state.seconds)||0);if(mediaMode==='direct'||preferredMode==='audio'){cancelStream();clearAudio();state={...state,seconds};void startDirect({seconds});return;}lastError='';state={...state,seconds,ready:false};open();send('load',{videoId:item.videoId,seconds,autoplay:playbackIntent});renderStatus();}
        // First loads fail transiently (expired stream URL, player not settled); a manual retry almost always works, so retry once per track silently.
        function autoRetryOnce(){const item=queue[queueIndex];if(!active||item?.kind!=='youtube')return false;if(autoRetried===item)return autoRetryTimer!==null;autoRetried=item;lastError='';state={...state,ready:false};renderStatus();autoRetryTimer=setTimeout(()=>{autoRetryTimer=null;if(active&&queue[queueIndex]===item)retryCurrentPlayback();},800);return true;}
        updateModeControls();
        function cancelStream(){streamEpoch++;streamRequest?.abort();streamRequest=null;streamAttempted=false;pendingAudioSeek=null;}
        function clearAudio(){audio.pause();audio.removeAttribute('src');audio.load();}
        function setPlaybackMode(mode){
            if(mode!=='audio'&&mode!=='video')throw new Error(t('check_mode'));
            preferredMode=mode;try{localStorage.setItem(MODE_KEY,mode);}catch{notify(t('mode_not_saved'),true);}updateModeControls();
            if(!active||kind!=='youtube')return;
            if(mode==='audio'&&mediaMode==='direct'&&(streamRequest||audio.src&&!lastError))return;
            if(mode==='video'&&mediaMode==='youtube'&&!streamRequest)return;
            const seconds=mediaMode==='direct'&&audio.src&&Number.isFinite(audio.currentTime)?audio.currentTime:Math.max(0,Number(state.seconds)||0);
            cancelStream();mediaMode='youtube';clearAudio();state={...state,seconds};playing=false;lastError='';
            if(mode==='audio'){void startDirect({seconds});return;}
            open();send('load',{videoId:queue[queueIndex].videoId,seconds,autoplay:playbackIntent});renderStatus();
        }
        function ensureFrame(){if(!frame.src)frame.src=BASE+'/youtube/player#session='+encodeURIComponent(session)+'&lang='+language();}
        // The same slider position must sound equally loud for Spotify songs and YouTube links. Measured on
        // 2026-10-28 through the output mix (dB below full volume): Spotify's own slider falls about 4 dB per
        // tenth, while the audio element and the embedded player barely drop above half volume. Each YouTube
        // setting is chosen so it lands on Spotify's level for the slider value; the embedded player only takes
        // whole percents and bottoms out near -24 dB, so very low sliders stay at its quietest step.
        const SPOTIFY_DB=[[0,-120],[2,-52.1],[5,-41.6],[10,-34.8],[15,-32.6],[20,-30.8],[30,-26.6],[40,-22.4],[50,-18.5],[60,-15.2],[70,-11.4],[80,-8.1],[90,-4],[95,-2],[100,0]];
        const AUDIO_DB=[[0,-120],[.25,-46.7],[.5,-40.3],[1,-34],[2,-27.9],[3,-24.7],[5,-21.1],[10,-16.7],[20,-11.2],[30,-8.2],[40,-6.5],[50,-4.9],[60,-3.9],[70,-2.8],[80,-1.9],[90,-1.1],[100,0]];
        const VIDEO_DB=[[0,-120],[1,-24],[2,-19.5],[3,-18.6],[5,-17],[10,-14.2],[20,-10.6],[30,-7.5],[40,-5.8],[50,-4.6],[60,-3.4],[70,-2.5],[80,-1.7],[90,-.9],[100,0]];
        function lookup(table,x,from,to){for(let i=1;i<table.length;i++){const a=table[i-1],b=table[i];if(x<=b[from])return a[to]+(b[to]-a[to])*(x-a[from])/(b[from]-a[from]);}return table[table.length-1][to];}
        function linkVolume(slider,table){const value=Math.max(0,Math.min(100,Number(slider)||0));return value?lookup(table,lookup(SPOTIFY_DB,value,0,1),1,0):0;}
        // One volume for both players: a YouTube item starts at Spotify's volume and changes are written back,
        // so the next Spotify song plays where the slider was left. Spotify's volume does not scale YouTube audio.
        const spotifyVolume=()=>{const value=Number(Spicetify.Player.getVolume?.());return Number.isFinite(value)?Math.max(0,Math.min(100,Math.round(value*100))):(Number.isFinite(state.volume)?state.volume:25);};
        const audioVolume=slider=>linkVolume(slider,AUDIO_DB)/100*audioGain,videoVolume=slider=>{const value=linkVolume(slider,VIDEO_DB);return value?Math.max(1,Math.round(value)):0;};
        function send(command,extra={}){if(command==='load'){playbackIntent=extra.autoplay===true;extra={...extra,volume:videoVolume(Number.isFinite(state.volume)?state.volume:25),muted:!!state.muted};}else if(command==='volume'){state={...state,volume:Math.max(0,Math.min(100,Number(extra.volume)||0))};extra={...extra,volume:videoVolume(state.volume)};originals.setVolume?.call(Spicetify.Player,state.volume/100);}else if(command==='play'){playbackIntent=true;extra={...extra,muted:!!state.muted};}else if(command==='pause'||command==='stop')playbackIntent=false;if(mediaMode==='direct'){if(command==='pause'||command==='stop')audio.pause();else if(command==='play'&&audio.src)audio.play().catch(e=>{if(e.name==='AbortError')return;lastError=e.message;renderStatus();});else if(command==='seek'){const seconds=Math.max(0,Math.min(audio.duration||Infinity,Number(extra.seconds)||0));if(pendingAudioSeek||!audio.src){if(pendingAudioSeek)pendingAudioSeek.seconds=seconds;state={...state,seconds};}else audio.currentTime=seconds;}else if(command==='volume')audio.volume=audioVolume(state.volume);else if(command==='mute')audio.muted=!!extra.muted;updateAudio();return;}ensureFrame();frame.contentWindow?.postMessage({type:'spotify-hangul-youtube-command',session,command,...extra},BASE);}
        function updateAudio(){if(!active||mediaMode!=='direct')return;state={...state,...(!pendingAudioSeek&&audio.src?{seconds:audio.currentTime||0,duration:Number.isFinite(audio.duration)?audio.duration:state.duration}:{}),muted:audio.muted};playing=!!audio.src&&!audio.paused&&!audio.ended;ivLyrics.update(queue[queueIndex],{...state,playing});renderStatus();updateBar();}
        function applyAudioResume(){const resume=pendingAudioSeek;if(!resume||!audio.src||audio.readyState<1||resume.epoch!==streamEpoch||mediaMode!=='direct'||!active||queue[queueIndex]?.videoId!==resume.videoId)return;audio.currentTime=Math.max(0,Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,resume.seconds));pendingAudioSeek=null;}
        audio.addEventListener('loadedmetadata',applyAudioResume);
        audio.addEventListener('playing',()=>{if(mediaMode==='direct'){lastError='';updateAudio();}});
        for(const event of['timeupdate','play','pause','loadedmetadata','volumechange','seeked'])audio.addEventListener(event,updateAudio);
        audio.addEventListener('ended',()=>{if(active&&mediaMode==='direct')advance(0);});audio.addEventListener('error',()=>{if(active&&mediaMode==='direct'){if(autoRetryOnce())return;lastError=t('audio_error');renderStatus();}});
        // Look up the next YouTube recording's audio in the last 45 s of this one, so it starts without the lookup wait.
        const prefetched=new Map();
        audio.addEventListener('timeupdate',()=>{if(!active||mediaMode!=='direct'||preferredMode!=='audio'||!Number.isFinite(audio.duration)||audio.duration-audio.currentTime>45)return;const next=queue[queueIndex+1];if(next?.kind!=='youtube'||Date.now()-(prefetched.get(next.videoId)||0)<240000)return;prefetched.set(next.videoId,Date.now());postHelper('/youtube/stream',{video_id:next.videoId}).then(r=>r.body?.cancel()).catch(()=>{});});
        async function startDirect({seconds=Math.max(0,Number(state.seconds)||0)}={}){
            if(streamAttempted||!active||queue[queueIndex]?.kind!=='youtube')return;
            streamAttempted=true;const item=queue[queueIndex],epoch=streamEpoch,controller=new AbortController();streamRequest=controller;
            const current=()=>active&&queue[queueIndex]===item&&streamEpoch===epoch&&mediaMode==='direct';
            let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},95000);
            frame.contentWindow?.postMessage({type:'spotify-hangul-youtube-command',session,command:'pause'},BASE);
            mediaMode='direct';pendingAudioSeek={epoch,videoId:item.videoId,seconds};state={...state,seconds};playing=false;lastError=t('audio_checking');open();renderStatus();
            try{let response,stream;for(let attempt=0;attempt<4;attempt++){
                response=await fetch(BASE+'/youtube/stream',{method:'POST',headers:{'Content-Type':'application/json','X-Hangul-Lyrics-Client':'ivlyrics'},body:JSON.stringify({video_id:item.videoId}),signal:controller.signal});stream=await response.json();
                if(response.ok)break;if(attempt===3||!(response.status===429||response.status>=500))throw new Error(stream.error||t('audio_not_found'));
                await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},2000);const cancel=()=>{clearTimeout(timer);reject(new DOMException('Track changed','AbortError'));};if(controller.signal.aborted)cancel();else controller.signal.addEventListener('abort',cancel,{once:true});});
            }
            if(!current()||controller.signal.aborted)return;
            const url=new URL(stream.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.googlevideo.com')||url.username||url.password||url.port)throw new Error(t('audio_bad_url'));
            lastError='';state={...state,codec:stream.codec,bitrate:stream.bitrate_kbps,duration:stream.duration};audioGain=Number(stream.volume_gain)>0&&Number(stream.volume_gain)<=1?Number(stream.volume_gain):1;audio.volume=audioVolume(state.volume);audio.muted=!!state.muted;audio.src=stream.url;
            open();
            if(audio.readyState>=1)applyAudioResume();if(playbackIntent&&current())await audio.play();if(current())updateAudio();
            }catch(error){if(current()&&(!controller.signal.aborted||timedOut)){if(!timedOut&&autoRetryOnce())return;lastError=t('audio_retry',timedOut?t('audio_timeout'):error.message);renderStatus();}}
            finally{clearTimeout(timeout);if(streamRequest===controller){streamRequest=null;if(current())renderStatus();}}
        }
        function restoreDock(){for(const[node,display]of dockHidden){if(node.isConnected)node.style.display=display;}dockHidden.clear();if(panel.parentElement!==document.body)document.body.append(panel);panel.style.display='none';}
        function open(){if(!active){restoreDock();const uri=view?.uri||Spicetify.Player.data?.context?.uri;if(/^spotify:playlist:[A-Za-z0-9]{22}$/.test(uri||'')){Spicetify.Platform.History.push('/playlist/'+uri.split(':')[2]);return;}notify(t('open_playlist_for_youtube'));return;}
            // The stable media anchor owns mode visibility. Clear legacy frame hiding after native tracks.
            frame.style.display='';
            const dock=document.getElementById('Desktop_PanelContainer_Id');
            // React-owned sidebar children can be replaced during navigation. Keep
            // the media frame in its original body host and dock by geometry only.
            if(dock){const rect=dock.getBoundingClientRect();panel.style.cssText=`position:fixed;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:5;background:var(--background-base,#121212);color:var(--text-base,white);padding:16px;overflow:auto;display:block`;}
            else{panel.style.cssText='position:fixed;box-sizing:border-box;right:12px;bottom:100px;width:min(360px,calc(100vw - 24px));max-height:70vh;z-index:9999;background:var(--background-base,#121212);color:var(--text-base,white);padding:16px;border-radius:8px;overflow:auto;display:block';}
            header.style.display='none';controls.style.display='none';hint.style.display='none';body.style.display='block';list.style.display='none';renderStatus();if(mediaMode!=='direct')ensureFrame();}
        function collapse(){if(active)open();else restoreDock();}
        function showQueue(){const local=queueSource?.match(/^local:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i),native=queueSource?.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);const path=local?'/spotify-hangul-links/'+local[1]:native?'/playlist/'+native[1]:null;if(!path){open();return;}const history=Spicetify.Platform.History;if(history.location.pathname!==path)history.push(path);else if(viewBypass){viewBypass=false;refreshView().catch(error=>notify(error.message,true));}}
        function render(){
            choose.replaceChildren(...data.playlists.map(p=>{const option=el('option',p.name);option.value=p.id;return option;}));choose.value=selected;
            list.replaceChildren();
            playlist().tracks.forEach((item,index)=>{
                const row=el('div',undefined,'display:flex;align-items:center;gap:5px;padding:8px;border-bottom:1px solid #333');
                const info=el('span',`${item.kind==='youtube'?'YouTube':'Spotify'} · ${item.title}\n${item.artist}`,'flex:1;white-space:pre-wrap');
                row.append(button('▶',()=>start(index)),info,button('↑',()=>move(index,-1)),button('↓',()=>move(index,1)),button(t('remove'),()=>{playlist().tracks.splice(index,1);save();render();}));list.append(row);
            });
            if(!playlist().tracks.length)list.append(el('p',t('empty_list')));
        }
        const viewStyle=el('style');viewStyle.textContent=`
            .hl-mixed-grid{font:14px var(--encore-body-font-stack,system-ui);color:var(--text-base,#fff);padding:0 16px}
            .hl-mixed-row{display:grid;grid-template-columns:32px minmax(180px,4fr) minmax(100px,2fr) minmax(130px,1fr);gap:16px;align-items:center;min-height:56px;padding:0 12px;border-radius:4px}
            .hl-mixed-row:hover,.hl-mixed-row:focus-within{background:#ffffff12}.hl-mixed-row[data-playing=true]{color:#1ed760;background:#ffffff08}
            .hl-mixed-head{color:#b3b3b3;min-height:36px;border-bottom:1px solid #ffffff20;margin-bottom:8px;border-radius:0}
            .hl-mixed-row button{background:none!important;color:inherit!important;border:0!important;cursor:pointer;padding:6px!important}.hl-mixed-row button:hover{color:#1ed760!important}
            .hl-mixed-title{display:flex;gap:12px;align-items:center;min-width:0}.hl-mixed-info{min-width:0;flex:1}.hl-mixed-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hl-mixed-artist{color:#b3b3b3;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .hl-mixed-actions{display:flex;align-items:center;justify-content:flex-end;gap:4px;color:#b3b3b3;font-size:12px}.hl-mixed-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0}.hl-mixed-tools button{border-radius:20px;padding:8px 14px;background:transparent;color:#eee;border:1px solid #ffffff50;cursor:pointer}.hl-mixed-tools button:hover{border-color:white}.hl-mixed-note{color:#b3b3b3;font-size:12px}
            @media(max-width:1200px){.hl-mixed-row{grid-template-columns:24px minmax(150px,1fr) 130px;gap:8px}.hl-mixed-album{display:none}}
        `;document.head.append(viewStyle);
        const viewedUri=()=>{const path=Spicetify.Platform.History.location.pathname,local=path.match(/^\/spotify-hangul-links\/([A-Za-z0-9_-]{1,80})$/);if(local&&data.playlists.some(p=>p.local&&p.id===local[1]))return'local:'+local[1];const match=path.match(/^\/playlist\/([A-Za-z0-9]{22})(?:\/|$)/);return match?'spotify:playlist:'+match[1]:null;};
        const binding=uri=>uri?.startsWith('local:')?data.playlists.find(p=>p.local&&p.id===uri.slice(6)):data.playlists.find(p=>!p.local&&p.sourceUri===uri);
        function clearView(){if(originalGrid?.isConnected)originalGrid.style.display=gridDisplay;originalGrid=null;mixedGrid?.remove();mixedGrid=null;viewTools?.remove();viewTools=null;localRoot?.remove();localRoot=null;for(const[node,display]of localHidden)if(node.isConnected)node.style.display=display;localHidden.clear();}
        async function readPlaylist(uri){const tracks=[];let offset=0,total=1;const counts=new Map();
            if(uri.startsWith('local:'))return binding(uri)?.nativeTracks?.map(t=>({...t}))||[];
            while(offset<total){let timeout;const result=await Promise.race([Spicetify.Platform.PlaylistAPI.getContents(uri,{offset,limit:100}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error(t('read_timeout'))),15000);})]).finally(()=>clearTimeout(timeout));const items=result.items||[];total=result.totalLength??offset+items.length;if(total>2000)throw new Error(t('too_long'));if(!items.length){if(offset<total)throw new Error(t('read_incomplete'));break;}
                for(const entry of items){const source=entry.track||entry;const item=MODEL.track({kind:'spotify',uri:source.uri,title:source.name,artist:source.artists?.map(a=>a.name).join(', '),duration:(source.duration?.milliseconds??(Number(source.duration)||0))/1000});if(!item)throw new Error(t('unsupported_item'));const occurrence=counts.get(item.uri)||0;counts.set(item.uri,occurrence+1);tracks.push({...item,entryKey:entry.uid||source.uid||item.uri+'#'+occurrence,album:source.album?.name||'',image:source.album?.images?.find(i=>i.label==='small')?.url||source.album?.images?.[0]?.url||''});}
                offset+=items.length;
            }return tracks;}
        async function refreshView(force=false){const uri=viewedUri();if(!uri){viewEpoch++;clearView();view=null;viewBypass=false;return;}
            const local=binding(uri)?.local;
            if(view?.uri!==uri&&local){viewEpoch++;clearView();view=null;viewBypass=false;}
            if(local&&!localRoot?.isConnected){const main=document.querySelector('main');if(!main)return;for(const child of main.children){localHidden.set(child,child.style.display);child.style.display='none';}localRoot=el('section',undefined,'padding:28px 24px;background:linear-gradient(#23333b,#121212 260px);min-height:100%;color:white');localRoot.dataset.hangulLocal='true';localRoot.append(el('p',t('local_label'),'color:#bbb'),el('h1',binding(uri).name,'font-size:42px;margin:12px 0 24px'));const actions=el('div');actions.dataset.testid='action-bar-row';actions.append(button(t('play_button'),togglePlaylistPlayback));localRoot.append(actions);const placeholder=el('div');placeholder.setAttribute('role','grid');placeholder.setAttribute('aria-rowcount','1');localRoot.append(placeholder);main.append(localRoot);}
            if(local)for(const child of document.querySelector('main')?.children||[]){if(child!==localRoot&&!localHidden.has(child)){localHidden.set(child,child.style.display);child.style.display='none';}}
            const page=local?localRoot:document.querySelector('main [data-testid="playlist-page"]');const grid=page?.querySelector('[role="grid"][aria-rowcount]');const toolbar=page?.querySelector('[data-testid="action-bar-row"]');if(!grid||!toolbar)return;
            if(view?.uri!==uri){viewEpoch++;if(!local)clearView();view={uri,name:page.querySelector('h1')?.textContent||t('spotify_playlist'),tracks:null,loading:false,error:''};viewBypass=false;}
            for(const stale of page.querySelectorAll('[data-hangul-links="tools"]'))if(stale!==viewTools)stale.remove();
            if(!viewTools?.isConnected){viewTools=el('div',undefined,'');viewTools.className='hl-mixed-tools';viewTools.dataset.hangulLinks='tools';const add=button(t('add_youtube_link'),()=>addDialog());add.dataset.testid='hangul-youtube-add';viewTools.append(add,button(t('reload'),()=>refreshView(true)),button(viewBypass?t('mixed_list'):t('edit_original'),()=>{viewBypass=!viewBypass;refreshView(!viewBypass);}),button(t('spotify_order'),()=>{const p=binding(view.uri);if(p)delete p.order;save();renderView();}),button(t('export'),()=>library.exportCurrent()),button(t('import'),()=>library.openPicker()),el('span',t('links_saved_note'),''));viewTools.children[2].disabled=!!local;viewTools.lastChild.className='hl-mixed-note';toolbar.after(viewTools);}
            if((!view.tracks||force)&&!view.loading){const epoch=++viewEpoch;view.loading=true;view.error='';const expected=view;viewTools.lastChild.textContent=t('reading_list');try{const tracks=await readPlaylist(uri);if(disposed||epoch!==viewEpoch||view!==expected||viewedUri()!==uri)return;view.tracks=tracks;}catch(error){if(view===expected&&epoch===viewEpoch)view.error=error.message;}finally{expected.loading=false;}if(view!==expected||epoch!==viewEpoch)return;}
            if(view.loading)return;
            viewTools.lastChild.textContent=view.error||t('list_counts',view.tracks?.length||0,binding(uri)?.tracks.length||0);
            viewTools.children[2].textContent=viewBypass?t('mixed_list'):t('edit_original');
            if(view.error||viewBypass||(!local&&!binding(uri)?.tracks.length&&!binding(uri)?.order?.length)){if(originalGrid?.isConnected)originalGrid.style.display=gridDisplay;originalGrid=null;mixedGrid?.remove();mixedGrid=null;return;}
            if(originalGrid!==grid||!mixedGrid?.isConnected){if(originalGrid?.isConnected)originalGrid.style.display=gridDisplay;mixedGrid?.remove();originalGrid=grid;gridDisplay=grid.style.display;grid.style.display='none';mixedGrid=el('div');mixedGrid.className='hl-mixed-grid';mixedGrid.dataset.testid='hangul-mixed-tracklist';mixedGrid.setAttribute('role','table');grid.before(mixedGrid);renderView();}
            else if(force)renderView();
        }
        function renderView(){if(!view?.tracks||!mixedGrid)return;const bound=binding(view.uri);view.mixed=MODEL.merge(view.tracks,bound?.tracks||[],bound?.order);mixedGrid.replaceChildren();mixedGrid.setAttribute('aria-label',t('mixed_tracklist',view.name));
            const heading=el('div');heading.className='hl-mixed-row hl-mixed-head';heading.setAttribute('role','row');for(const[label,album]of[['#'],[t('column_title')],[t('column_album'),true],[t('column_duration')]]){const cell=el('div',label);cell.setAttribute('role','columnheader');if(album)cell.className='hl-mixed-album';heading.append(cell);}mixedGrid.append(heading);
            view.mixed.forEach((item,index)=>{const row=el('div');row.className='hl-mixed-row';row.setAttribute('role','row');row.dataset.index=String(index);row.dataset.kind=item.kind;row.dataset.identity=item.videoId||item.uri;const play=button('▶',()=>startView(index));play.setAttribute('aria-label',t('play_item',item.title));play.title=String(index+1);play.dataset.testid='hangul-row-play';row.append(play);
                const title=el('div');title.className='hl-mixed-title';const image=el('img');image.width=40;image.height=40;image.loading='lazy';image.alt='';image.style.cssText='border-radius:4px;object-fit:cover';image.src=item.kind==='youtube'?'https://i.ytimg.com/vi/'+item.videoId+'/default.jpg':item.image;const info=el('div');info.className='hl-mixed-info';const name=el('div',item.title);name.className='hl-mixed-name';name.title=item.title;const artist=el('div',item.artist);artist.className='hl-mixed-artist';info.append(name,artist);title.append(image,info);row.append(title);const album=el('div',item.kind==='youtube'?'YouTube':item.album);album.className='hl-mixed-album hl-mixed-artist';row.append(album);
                const actions=el('div');actions.className='hl-mixed-actions';actions.append(el('span',item.duration?time(item.duration):'—'));
                for(const[mark,delta,label]of[['↑',-1,'move_up'],['↓',1,'move_down']]){const move=button(mark,()=>moveViewed(MODEL.rowKey(item),index+delta));move.setAttribute('aria-label',t(label,item.title));actions.append(move);}
                if(item.kind==='youtube'){const remove=button('×',()=>{const p=binding(view.uri);p.tracks=p.tracks.filter(t=>t.videoId!==item.videoId);p.order=p.order?.filter(k=>k!==MODEL.rowKey(item));save();refreshView(true);});remove.setAttribute('aria-label',t('remove_link',item.title));actions.append(remove);}
                row.draggable=true;row.ondragstart=event=>event.dataTransfer.setData('application/x-hangul-row',MODEL.rowKey(item));row.ondragover=event=>{if([...event.dataTransfer.types].includes('application/x-hangul-row'))event.preventDefault();};row.ondrop=event=>{const key=event.dataTransfer.getData('application/x-hangul-row');if(!view.mixed.some(t=>MODEL.rowKey(t)===key))return;event.preventDefault();moveViewed(key,index);};row.append(actions);row.ondblclick=event=>{if(!event.target.closest('button'))Promise.resolve().then(()=>startView(index)).catch(e=>notify(e.message,true));};row.oncontextmenu=event=>{event.preventDefault();const content=el('div');content.append(button(t('copy_title'),()=>Spicetify.Platform.ClipboardAPI.copy(item.title)),button(t('add_youtube_after'),()=>addDialog(item.kind==='spotify'?item.entryKey:item.after)));if(item.kind==='spotify')content.append(button(t('open_spotify_song'),()=>Spicetify.Platform.History.push('/track/'+item.uri.split(':')[2])));else content.append(button(t('lyric_info'),()=>editLyricInfo(item)));Spicetify.PopupModal.display({title:item.title,content});};mixedGrid.append(row);});markPlaying();}
        function moveViewed(key,index){if(!view?.mixed)return;const p=binding(view.uri);p.order=MODEL.reorder(view.mixed,key,index);save();renderView();}
        function togglePlaylistPlayback(){if(queueSource===view?.uri&&(active||kind==='spotify')){if(active)toggle();else Spicetify.Player.togglePlay();}else startView(0);}
        function markPlaying(){if(!mixedGrid)return;for(const row of mixedGrid.querySelectorAll('[data-index]')){const item=view?.mixed?.[Number(row.dataset.index)],playingItem=queue[queueIndex];const matches=queueSource===view?.uri&&item&&playingItem&&MODEL.rowKey(item)===MODEL.rowKey(playingItem);const value=String(!!matches);if(row.dataset.playing!==value)row.dataset.playing=value;}}
        function editLyricInfo(item){if(item?.kind!=='youtube')throw new Error(t('select_youtube_first'));const profile=window.SpotifyHangulIvLyrics.searchInfo(item),content=el('div',undefined,'display:grid;gap:12px');const title=el('input'),artist=el('input');for(const node of[title,artist])node.style.cssText='background:#282828;color:white;border:1px solid #777;padding:12px;border-radius:4px';title.value=profile.title;title.setAttribute('aria-label',t('lyric_title_label'));artist.value=profile.artist;artist.setAttribute('aria-label',t('lyric_artist_label'));const message=el('p',t('lyric_info_note'));content.append(title,artist,message,button(t('lyric_save'),async()=>{if(!title.value.trim())throw new Error(t('lyric_title_required'));for(const p of data.playlists)for(const t of p.tracks)if(t.kind==='youtube'&&t.videoId===item.videoId){t.lyricTitle=title.value.trim().slice(0,300);t.lyricArtist=artist.value.trim().slice(0,200);}for(const t of queue)if(t.kind==='youtube'&&t.videoId===item.videoId){t.lyricTitle=title.value.trim().slice(0,300);t.lyricArtist=artist.value.trim().slice(0,200);}save();if(active&&queue[queueIndex]?.videoId===item.videoId){ivLyrics.update(queue[queueIndex],{...state,playing});await ivLyrics.reload();}Spicetify.PopupModal.hide();}));Spicetify.PopupModal.display({title:t('lyric_info_title'),content});}
        function startView(index){if(!view?.tracks||view.error)throw new Error(t('reload_before_play'));const device=Spicetify.Platform.ConnectAPI?.state?.activeDevice;if(device&&device.isLocal===false)throw new Error(t('this_computer_only'));const bound=binding(view.uri);queue=MODEL.merge(view.tracks,bound?.tracks||[],bound?.order);queueSource=view.uri;queueIndex=index;playCurrent();markPlaying();}
        async function metadata(value){const id=MODEL.youtubeId(value);if(!id)throw new Error(t('invalid_link'));const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);try{const response=await postHelper('/youtube/metadata',{video_id:id},controller.signal);const info=await response.json();if(!response.ok)throw new Error(info.error||t('metadata_failed'));return MODEL.track({kind:'youtube',videoId:id,title:info.title,artist:info.author||info.artist});}finally{clearTimeout(timeout);}}
        function addDialog(after){if(!view?.tracks||view.error)throw new Error(view?.error||t('open_playlist_first'));const target=view;const content=el('div',undefined,'display:grid;gap:14px');const input=el('input');input.placeholder=t('video_url_placeholder');input.setAttribute('aria-label',t('video_url_label'));input.style.cssText='width:100%;padding:12px;background:#282828;color:white;border:1px solid #777;border-radius:4px';
            const position=el('select');position.setAttribute('aria-label',t('position_label'));position.style.cssText=input.style.cssText;for(const[label,value]of[[t('position_end'),'$end'],[t('position_start'),''],...target.tracks.map(track=>[t('after_track',track.title),track.entryKey])]){const option=el('option',label);option.value=value;position.append(option);}if(typeof after==='string')position.value=after;
            const saved=data.playlists.filter(p=>!p.sourceUri).flatMap(p=>p.tracks.filter(t=>t.kind==='youtube'));if(saved.length){const pick=el('select');pick.style.cssText=input.style.cssText;pick.setAttribute('aria-label',t('saved_videos_label'));pick.append(el('option',t('saved_videos_hint')));for(const t of saved){const option=el('option',t.title);option.value=t.videoId;pick.append(option);}pick.onchange=()=>{if(MODEL.youtubeId(pick.value))input.value='https://www.youtube.com/watch?v='+pick.value;};content.append(pick);}
            const message=el('p',t('add_dialog_note'),'color:#b3b3b3');const add=button(t('add_to_playlist'),async()=>{add.disabled=true;message.textContent=t('checking_video');try{const item=await metadata(input.value);if(disposed)return;let p=binding(target.uri);if(!p){p={id:'native:'+target.uri.split(':')[2],sourceUri:target.uri,name:target.name,tracks:[]};data.playlists.push(p);}if(p.tracks.some(t=>t.videoId===item.videoId))throw new Error(t('already_in_playlist'));item.after=position.value==='$end'?(target.tracks.at(-1)?.entryKey||''):position.value;p.tracks.push(item);if(p.order?.length){const live=MODEL.merge(target.tracks,p.tracks.filter(t=>t.videoId!==item.videoId),p.order);const at=position.value==='$end'?live.length:position.value===''?0:live.findIndex(t=>t.kind==='spotify'&&t.entryKey===position.value)+1;live.splice(Math.max(0,at),0,item);p.order=live.map(MODEL.rowKey);}save();if(view?.uri===target.uri){viewBypass=false;await refreshView(true);}Spicetify.PopupModal.hide();}catch(error){message.textContent=error.name==='AbortError'?t('video_timeout'):error.message;}finally{add.disabled=false;}});add.dataset.testid='hangul-youtube-confirm';content.append(input,position,message,add);Spicetify.PopupModal.display({title:t('add_dialog_title',target.name),content});}
        const scheduleView=()=>{clearTimeout(viewTimer);viewTimer=setTimeout(()=>refreshView().catch(error=>notify(error.message,true)),180);};
        const viewObserver=new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('#spotify-hangul-links,.hl-mixed-grid,.hl-mixed-tools'))){scheduleView();}});viewObserver.observe(document.body,{childList:true,subtree:true});
        const unlisten=Spicetify.Platform.History.listen(()=>{viewEpoch++;clearView();view=null;viewBypass=false;scheduleView();});scheduleView();
        function move(index,delta){const tracks=playlist().tracks;const to=index+delta;if(to<0||to>=tracks.length)return;[tracks[index],tracks[to]]=[tracks[to],tracks[index]];save();render();}
        async function addYoutube(value,metadata){
            const id=MODEL.youtubeId(value);if(!id)throw new Error(t('invalid_link'));
            if(playlist().tracks.some(t=>t.kind==='youtube'&&t.videoId===id)){notify(t('already_in_list'));return;}
            const info=metadata||await postHelper('/youtube/metadata',{video_id:id}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||t('youtube_info_failed'));return body;});
            playlist().tracks.push(MODEL.track({kind:'youtube',videoId:id,title:info.title,artist:info.author||info.artist}));url.value='';save();render();return id;
        }
        function addCurrent(){const item=Spicetify.Player.data?.item;if(!item?.uri?.startsWith('spotify:track:'))throw new Error(t('select_spotify_song'));const meta=item.metadata||{};playlist().tracks.push(MODEL.track({kind:'spotify',uri:item.uri,title:item.name||meta.title,artist:meta.artist_name,duration:Spicetify.Player.getDuration()/1000}));save();render();}
        async function importCurrentPlaylist(){
            const context=Spicetify.Player.data?.context;if(!context?.uri?.startsWith('spotify:playlist:'))throw new Error(t('select_playlist_song'));
            if(typeof Spicetify.Platform.PlaylistAPI?.getContents!=='function')throw new Error(t('list_read_unsupported'));
            const tracks=[];let offset=0,total=1;
            while(offset<total&&offset<2000){const response=await Spicetify.Platform.PlaylistAPI.getContents(context.uri,{offset,limit:100});const items=response.items||[];if(!items.length)break;for(const entry of items){const item=entry.track||entry;const track=MODEL.track({kind:'spotify',uri:item.uri,title:item.name,artist:item.artists?.map(a=>a.name).join(', '),duration:typeof item.duration==='object'?(item.duration.milliseconds||0)/1000:Number(item.duration||0)/1000});if(track)tracks.push(track);}offset+=items.length;total=response.totalLength??offset;}
            const p={id:crypto.randomUUID(),name:String(context.metadata?.context_description||context.metadata?.title||t('imported_list_name')).slice(0,100),tracks};data.playlists.push(p);selected=p.id;save();render();notify(t('imported_notice',tracks.length));
        }
        function start(index){queueSource=null;queue=playlist().tracks.map(t=>({...t}));queueIndex=index;playCurrent();}
        function remember(){if(baseline)return;baseline={uri:Spicetify.Player.data?.item?.uri,contextUri:Spicetify.Player.data?.context?.uri,progress:Spicetify.Player.getProgress(),paused:!Spicetify.Player.isPlaying()};}
        function playCurrent(){bindPlayer();const item=queue[queueIndex];if(!item)return stop();clearTimeout(autoRetryTimer);autoRetryTimer=null;autoRetried=null;cancelStream();mediaMode='youtube';clearAudio();const device=Spicetify.Platform.ConnectAPI?.state?.activeDevice;if(queueSource&&device&&device.isLocal===false){send('pause');active=false;kind=null;queue=[];queueIndex=-1;queueSource=null;baseline=null;ivLyrics.deactivate();restoreBar();restoreDock();notify(t('device_changed'),true);return;}lyricAbort?.abort();remember();lastError='';lyrics=[];lyricsResult=null;lyricBox.textContent='';if(item.kind==='youtube'){
                originals.pause.call(Spicetify.Player);nativeTransitionUntil=Date.now()+4000;active=true;kind='youtube';extensionPlayer?.yieldToLink?.();playing=false;playbackIntent=true;state={...state,seconds:0,duration:item.duration||0,volume:spotifyVolume()};ivLyrics.update(item,{...state,playing});open();if(preferredMode==='audio')void startDirect({seconds:0});else send('load',{videoId:item.videoId,autoplay:true});
            }else{active=false;kind='spotify';ivLyrics.deactivate();restoreDock();nativeTransitionUntil=Date.now()+8000;lastNativeProgress=0;lastNativeDuration=0;restoreBar();send('pause');Promise.resolve(/^spotify:playlist:/.test(queueSource||'')?Spicetify.Player.playUri(queueSource,{}, {skipTo:{uri:item.uri,uid:item.entryKey},initiallyPaused:false}):Spicetify.Player.playUri(item.uri)).catch(()=>{lastError=t('spotify_play_failed');kind=null;renderStatus();});}
            renderStatus();markPlaying();
        }
        function advance(direction=1){const next=MODEL.nextIndex(queueIndex,queue.length,direction,repeat,shuffle);if(next<0){playing=false;if(active)send('pause');else{Spicetify.Player.pause();kind=null;queue=[];queueIndex=-1;}return;}queueIndex=next;playCurrent();}
        function toggle(){if(kind!=='youtube')return;send(playbackIntent?'pause':'play');}
        function stop(){cancelStream();lyricAbort?.abort();send('pause');mediaMode='youtube';clearAudio();active=false;kind=null;playing=false;queue=[];queueIndex=-1;queueSource=null;ivLyrics.deactivate();restoreBar();restoreDock();markPlaying();const saved=baseline;baseline=null;if(saved?.uri){const restore=()=>{Spicetify.Player.seek(saved.progress);if(saved.paused)Spicetify.Player.pause();else Spicetify.Player.play();};const context=saved.contextUri||saved.uri;if(Spicetify.Player.data?.item?.uri!==saved.uri||Spicetify.Player.data?.context?.uri!==context)Promise.resolve(Spicetify.Player.playUri(context,{}, {skipTo:{uri:saved.uri},seekTo:saved.progress,initiallyPaused:saved.paused})).then(restore);else restore();}}
        function renderStatus(){const item=queue[queueIndex],error=streamRequest?'':lastError;const loading=active&&!error&&(!!streamRequest||(mediaMode==='direct'&&!!pendingAudioSeek&&audio.readyState<1)||(mediaMode==='youtube'&&playbackIntent&&(!state.ready||state.state===3)));nowPlaying.update({track:item?.kind==='youtube'?item:null,state,playing,preferredMode,mediaMode,loading:!!loading,error,fallback:preferredMode==='video'&&mediaMode==='direct'});}
        function onMessage(event){
            if(event.origin!==BASE||event.source!==frame.contentWindow||event.data?.type!=='spotify-hangul-youtube-state'||event.data.session!==session)return;
            const next=event.data;if(next.event==='ready'){const item=queue[queueIndex];if(active&&mediaMode!=='direct'&&item?.kind==='youtube')send('load',{videoId:item.videoId,seconds:state.seconds||0,autoplay:playbackIntent});return;}
            if(!active||mediaMode==='direct')return;
            const item=queue[queueIndex];if(next.videoId&&next.videoId!==item?.videoId)return;
            if(next.event==='error'&&[101,150].includes(Number(next.errorCode))){startDirect();return;}
            if(next.event==='error'&&Number(next.errorCode)!==100&&autoRetryOnce())return;
            if(!next.videoId&&next.event!=='error'&&next.event!=='autoplay-blocked')return;
            if(next.state===1)playbackIntent=true;else if(next.state===2&&playing)playbackIntent=false;
            state={...next,volume:state.volume};playing=next.state===1;lastError=next.error||'';
            if(next.event==='autoplay-blocked')lastError=t('press_play');
            if(next.event==='state'&&next.value===0){advance(0);return;}
            ivLyrics.update(queue[queueIndex],{...state,playing});renderStatus();updateBar();
        }
        window.addEventListener('message',onMessage);listeners.push(()=>window.removeEventListener('message',onMessage));
        const rememberNode=node=>{if(node&&!savedNodes.has(node))savedNodes.set(node,{text:node.textContent,html:node.namespaceURI==='http://www.w3.org/2000/svg'?node.innerHTML:null,viewBox:node.getAttribute('viewBox'),href:node.getAttribute('href'),src:node.getAttribute('src'),label:node.getAttribute('aria-label'),valueText:node.getAttribute('aria-valuetext'),max:node.getAttribute('max'),value:node.value,style:node.getAttribute('style')});return node;};
        function text(node,value){if(node&&node.textContent!==value){rememberNode(node);node.textContent=value;}}
        function restoreBar(){for(const[node,old]of savedNodes){if(!node.isConnected)continue;if(old.html!==null){node.innerHTML=old.html;if(old.viewBox===null)node.removeAttribute('viewBox');else node.setAttribute('viewBox',old.viewBox);}else if(node.tagName==='IMG')node.src=old.src;else if(node.tagName==='INPUT'){node.max=old.max;node.value=old.value;}else if(node.tagName!=='BUTTON'&&node.getAttribute('data-testid')!=='progress-bar')node.textContent=old.text;delete node.dataset.youtubeState;delete node.dataset.hangulYoutubeArtist;delete node.dataset.hangulYoutubeTitle;for(const[attr,key]of[['href','href'],['aria-label','label'],['aria-valuetext','valueText'],['style','style']]){if(old[key]===null)node.removeAttribute(attr);else node.setAttribute(attr,old[key]);}}
            // The volume was shared while the link played, so the bar shows Spotify's volume now, not the saved one.
            const level=Number(Spicetify.Player.getVolume?.());if(Number.isFinite(level))for(const node of volumeNodes){if(!node.isConnected)continue;if(node.tagName==='INPUT')node.value=String(level);else node.style.setProperty('--progress-bar-transform',level*100+'%');}
            volumeNodes.clear();savedNodes.clear();}
        // Spotify's own wording in its UI language (a missing key comes back as the key): its buttons are found by
        // these labels, not by Korean ones, so a Spotify in English or Japanese keeps the YouTube controls.
        function spotifyText(key,...args){const text=Spicetify.Locale?.get?.(key,...args);return typeof text==='string'&&text!==key?text:'';}
        function isPlaylistPlay(button){const label=button.getAttribute('aria-label')||'';return !!label&&([spotifyText('playlist.a11y.play',view.name),spotifyText('playlist.a11y.pause',view.name)].includes(label)||label.startsWith(view.name+' '));}
        const time=seconds=>`${Math.floor(Math.max(0,seconds||0)/60)}:${String(Math.floor(Math.max(0,seconds||0)%60)).padStart(2,'0')}`;
        function updateBar(){if(!active)return;const bar=document.querySelector('[data-testid="now-playing-bar"]');if(!bar)return;const item=queue[queueIndex];if(!item)return;
            const widget=bar.querySelector('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]');
            const title=widget?.querySelector('[data-hangul-youtube-title],a[href*="/album/"],a[data-testid="context-item-link"]');const artist=widget?.querySelector('[data-hangul-youtube-artist],a[href*="/artist/"]');if(title)title.dataset.hangulYoutubeTitle='true';if(artist)artist.dataset.hangulYoutubeArtist='true';
            text(title,item.title);text(artist,item.artist);for(const node of[title,artist]){if(node){rememberNode(node);node.setAttribute('href','https://www.youtube.com/watch?v='+item.videoId);}}
            for(const node of widget?.querySelectorAll('a[href*="/artist/"]')||[]){if(node!==artist){rememberNode(node);node.style.display='none';}}
            for(const node of widget?.querySelectorAll('button[aria-checked]')||[]){rememberNode(node);node.style.display='none';}
            const image=widget?.querySelector('img');if(image&&image.src!==`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`){rememberNode(image);image.src=`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;}
            const play=bar.querySelector('[data-testid="control-button-playpause"]');if(play){rememberNode(play);play.setAttribute('aria-label',playing?t('youtube_pause'):t('youtube_play'));const svg=play.querySelector('svg');if(svg&&play.dataset.youtubeState!==(playing?'playing':'paused')){rememberNode(svg);svg.setAttribute('viewBox','0 0 16 16');svg.innerHTML=playing?'<path d="M3 2h4v12H3zM9 2h4v12H9z"/>':'<path d="M4 2v12l10-6z"/>'; }play.dataset.youtubeState=playing?'playing':'paused';}
            const progress=bar.querySelector('.playback-bar');if(progress){const texts=progress.querySelectorAll('[data-testid="playback-position"],[data-testid="playback-duration"]');if(texts.length){text(texts[0],time(state.seconds));if(texts.length>1)text(texts[texts.length-1],time(state.duration));}const range=progress.querySelector('input[type="range"]');if(range){rememberNode(range);range.max=String(Math.round(state.duration*1000));range.value=String(Math.round(state.seconds*1000));range.setAttribute('aria-valuetext',time(state.seconds)+'/'+time(state.duration));}const visual=progress.querySelector('[data-testid="progress-bar"]');if(visual){rememberNode(visual);visual.style.setProperty('--progress-bar-transform',(state.duration?Math.min(100,state.seconds/state.duration*100):0)+'%');}}
            const volumeRange=Array.from(bar.querySelectorAll('input[type="range"]')).find(input=>!input.closest('.playback-bar'));if(volumeRange){rememberNode(volumeRange);volumeNodes.add(volumeRange);volumeRange.value=String((state.muted?0:state.volume)/100);const visual=volumeRange.parentElement?.parentElement?.querySelector('[data-testid="progress-bar"]');if(visual){rememberNode(visual);volumeNodes.add(visual);visual.style.setProperty('--progress-bar-transform',(state.muted?0:state.volume)+'%');}}
            const repeatButton=bar.querySelector('[data-testid="control-button-repeat"]');if(repeatButton){rememberNode(repeatButton);repeatButton.setAttribute('aria-label',t('repeat',repeat));repeatButton.style.color=repeat==='off'?'':'#1ed760';}
            if(queueSource===view?.uri)for(const play of document.querySelectorAll('button[data-encore-id="buttonPrimary"]')){if(play.closest('[data-testid="now-playing-bar"]')||!isPlaylistPlay(play))continue;rememberNode(play);play.setAttribute('aria-label',spotifyText(playing?'playlist.a11y.pause':'playlist.a11y.play',view.name)||t(playing?'playlist_pause':'playlist_play',view.name));const svg=play.querySelector('svg');if(svg&&play.dataset.youtubeState!==(playing?'playing':'paused')){rememberNode(svg);svg.setAttribute('viewBox','0 0 16 16');svg.innerHTML=playing?'<path d="M3 2h4v12H3zM9 2h4v12H9z"/>':'<path d="M4 2v12l10-6z"/>';play.dataset.youtubeState=playing?'playing':'paused';}}
        }
        function isIvLyricsMicrophone(target){if(!target?.matches('.ivlyrics-playbar-control'))return false;const label=target._tippy?.props?.content||target.getAttribute('aria-label')||target.getAttribute('title');if(typeof label==='string'&&label.trim())return label===(globalThis.I18n?.t?.('playbarButton.label')||'Lyrics Plus')||label==='Lyrics Plus';return !target.matches('.ivlyrics-fullscreen-btn');}
        function click(event){const target=event.target.closest?.('button');if(active&&isIvLyricsMicrophone(target)){event.preventDefault();event.stopImmediatePropagation();openLyrics();return;}if(view?.mixed?.length&&!viewBypass&&mixedGrid?.isConnected&&target?.matches('[data-encore-id="buttonPrimary"]')&&!target.closest('[data-testid="now-playing-bar"]')&&(target.closest('main [data-testid="action-bar-row"]')||isPlaylistPlay(target))){event.preventDefault();event.stopImmediatePropagation();try{togglePlaylistPlayback();}catch(error){notify(error.message,true);}return;}
            if(!active&&kind!=='spotify')return;const anchor=event.target.closest?.('a');if(active&&anchor?.closest('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]')){event.preventDefault();event.stopImmediatePropagation();open();return;}const bar=target?.closest('[data-testid="now-playing-bar"]');if(!bar)return;const id=target.dataset.testid;let action;
            if(id==='control-button-playpause'&&active)action=toggle;
            else if(id==='control-button-skip-forward')action=()=>advance(1);
            else if(id==='control-button-skip-back')action=()=>advance(-1);
            else if(id==='control-button-repeat')action=()=>{repeat=repeat==='off'?'all':repeat==='all'?'one':'off';notify(t('repeat',repeat));};
            else if(id==='volume-bar-toggle-mute-button'&&active)action=()=>send('mute',{muted:!state.muted});
            // Shuffle has no test id: it is the other button beside "previous", whatever its label's language.
            else if((target.closest('.player-controls__left')&&id!=='control-button-skip-back'))action=()=>{shuffle=!shuffle;notify(t(shuffle?'shuffle_on':'shuffle_off'));};
            else if(id==='cover-art-button')action=open;
            else if(id==='lyrics-button'&&active)action=openLyrics;
            else if(id==='control-button-queue'&&(active||kind==='spotify'))action=showQueue;
            else if(active&&target.closest('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]'))action=()=>{open();};
            else if(active&&target.getAttribute('aria-label')&&(target.getAttribute('aria-label')===spotifyText('playback-control.connect-picker')||/Connect to a device/i.test(target.getAttribute('aria-label'))))action=()=>notify(t('plays_here'));
            if(action){event.preventDefault();event.stopImmediatePropagation();action();updateBar();}
        }
        document.addEventListener('click',click,true);listeners.push(()=>document.removeEventListener('click',click,true));
        function contextMenu(event){if(!active||!event.target.closest?.('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]'))return;event.preventDefault();event.stopImmediatePropagation();const item=queue[queueIndex];const content=el('div',undefined,'display:flex;gap:8px');content.append(button(t('copy_title'),()=>Spicetify.Platform.ClipboardAPI.copy(item.title)),button(t('copy_link'),()=>Spicetify.Platform.ClipboardAPI.copy('https://www.youtube.com/watch?v='+item.videoId)));Spicetify.PopupModal.display({title:t('youtube_link_music'),content});}
        document.addEventListener('contextmenu',contextMenu,true);listeners.push(()=>document.removeEventListener('contextmenu',contextMenu,true));
        function rangeInput(event){if(!active||event.target.tagName!=='INPUT'||event.target.type!=='range')return;const input=event.target;if(!input.closest('[data-testid="now-playing-bar"]'))return;event.stopImmediatePropagation();if(input.closest('.playback-bar'))send('seek',{seconds:Number(input.value)/1000});else send('volume',{volume:Number(input.value)*100});}
        document.addEventListener('input',rangeInput,true);document.addEventListener('change',rangeInput,true);listeners.push(()=>{document.removeEventListener('input',rangeInput,true);document.removeEventListener('change',rangeInput,true);});
        let dragging=null;
        function pointer(event){if(!active||event.button!==0)return;const area=event.target.closest?.('[data-testid="progress-bar"]');if(!area?.closest('[data-testid="now-playing-bar"]'))return;const rect=area.getBoundingClientRect();if(!rect.width)return;dragging={rect,seek:!!area.closest('.playback-bar')};event.preventDefault();event.stopImmediatePropagation();applyPointer(event);}
        function applyPointer(event){if(!active||!dragging)return;event.preventDefault();event.stopImmediatePropagation();const part=Math.max(0,Math.min(1,(event.clientX-dragging.rect.left)/dragging.rect.width));if(dragging.seek)send('seek',{seconds:part*state.duration});else send('volume',{volume:part*100});}
        function pointerUp(event){if(!dragging)return;applyPointer(event);dragging=null;}
        document.addEventListener('pointerdown',pointer,true);document.addEventListener('pointermove',applyPointer,true);document.addEventListener('pointerup',pointerUp,true);listeners.push(()=>{document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('pointermove',applyPointer,true);document.removeEventListener('pointerup',pointerUp,true);});
        function keyboard(event){if(!active||event.target.closest?.('input,textarea,button,[role="button"],[contenteditable=true]'))return;let action;if(event.code==='Space')action=toggle;else if(event.code==='ArrowRight')action=()=>send('seek',{seconds:state.seconds+5});else if(event.code==='ArrowLeft')action=()=>send('seek',{seconds:state.seconds-5});if(action){event.preventDefault();event.stopImmediatePropagation();action();}}
        document.addEventListener('keydown',keyboard,true);listeners.push(()=>document.removeEventListener('keydown',keyboard,true));
        const playerHandlers={togglePlay:toggle,pause:()=>send('pause'),next:()=>advance(1),back:()=>advance(-1),seek:ms=>send('seek',{seconds:Number(ms)/1000}),setVolume:volume=>send('volume',{volume:Number(volume)*100}),increaseVolume:()=>send('volume',{volume:state.volume+5}),decreaseVolume:()=>send('volume',{volume:state.volume-5}),toggleMute:()=>send('mute',{muted:!state.muted}),setMute:muted=>send('mute',{muted:!!muted}),setHeart:()=>notify(t('managed_in_list')),toggleHeart:()=>notify(t('managed_in_list'))};
        // Spicetify replaces its Player object after the page starts: the controls move to the one in use, or next/back
        // would reach Spotify's own queue and leave the mixed list. The extension player binds this first (options.bindPlayer).
        let player=Spicetify.Player;
        function wrapPlayer(){for(const[name,handler]of Object.entries(playerHandlers)){const original=player[name];if(typeof original!=='function')continue;originals[name]=original;player[name]=function(...args){return active||(kind==='spotify'&&['next','back'].includes(name))?handler(...args):original.apply(this,args);};}}
        function unwrapPlayer(){for(const[name,original]of Object.entries(originals)){player[name]=original;delete originals[name];}}
        function bindPlayer(){const next=Spicetify.Player;if(!next||next===player)return;unwrapPlayer();player=next;wrapPlayer();}
        wrapPlayer();
        // Native Spotify items in the mixed queue use Spotify's own player. A
        // natural end advances the link queue; manual native song changes exit it.
        // Under the extension audio (owns) the engine stays paused and never ends the song by itself: the
        // extension reports the end through skip(0), and a song change seen then is the user's.
        let lastNativeProgress=0;
        // A player page that failed to load (connection reset) never reports ready; reopen it, at most twice per track.
        let frameWaitStart=0,frameReloads=0,frameItem=null;
        function frameWatchdog(){const item=queue[queueIndex];if(item!==frameItem){frameItem=item;frameReloads=0;frameWaitStart=0;}if(!active||mediaMode==='direct'||item?.kind!=='youtube'||!frame.src||state.ready){frameWaitStart=0;return;}if(!frameWaitStart){frameWaitStart=Date.now();return;}if(Date.now()-frameWaitStart<10000||frameReloads>=2)return;frameReloads++;frameWaitStart=Date.now();frame.src=BASE+'/youtube/player?r='+Date.now()+'#session='+encodeURIComponent(session)+'&lang='+language();}
        const timer=setInterval(()=>{if(disposed)return;bindPlayer();markPlaying();frameWatchdog();if(active){if(Date.now()<=nativeTransitionUntil&&Spicetify.Player.isPlaying())originals.pause.call(Spicetify.Player);else if(Date.now()>nativeTransitionUntil&&Spicetify.Player.isPlaying()){lyricAbort?.abort();send('pause');streamRequest?.abort();mediaMode='youtube';audio.pause();audio.removeAttribute('src');audio.load();active=false;kind=null;playing=false;queue=[];queueIndex=-1;queueSource=null;baseline=null;ivLyrics.deactivate();restoreBar();restoreDock();return;}if(!panel.isConnected||!panel.parentElement?.isConnected||panel.parentElement===document.body&&document.getElementById('Desktop_PanelContainer_Id'))open();updateBar();return;}if(kind==='spotify'&&queue[queueIndex]){const current=Spicetify.Player.data;const uri=current?.item?.uri;if(uri!==queue[queueIndex].uri){if(Date.now()<nativeTransitionUntil)return;if(lastNativeDuration>0&&lastNativeProgress>=lastNativeDuration-2500)advance(1);else{kind=null;queue=[];queueIndex=-1;queueSource=null;}lastNativeProgress=0;}else{const engineHeard=!extensionPlayer?.owns?.();lastNativeProgress=Spicetify.Player.getProgress();lastNativeDuration=engineHeard?Spicetify.Player.getDuration():0;playing=Spicetify.Player.isPlaying();renderStatus();if(engineHeard&&current?.isPaused&&lastNativeDuration>0&&lastNativeProgress>=lastNativeDuration-1000)advance(0);}}},500);
        async function testLyrics(searchTitle,searchArtist){const item=queue[queueIndex];if(item?.kind!=='youtube')throw new Error(t('select_youtube_first'));const title=typeof searchTitle==='string'?searchTitle:prompt(t('lyric_title_label'),item.title)||'';if(!title)return;const artist=typeof searchArtist==='string'?searchArtist:prompt(t('lyric_artist_label'),item.artist)||'';lyricBox.textContent=t('lyric_loading');
            lyricAbort?.abort();const controller=new AbortController();lyricAbort=controller;const timeout=setTimeout(()=>controller.abort(),24000);
            try {
            const url='https://lrclib.net/api/search?track_name='+encodeURIComponent(title)+'&artist_name='+encodeURIComponent(artist);const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error(t('lyric_server',response.status));const results=await response.json();const result=results.find(r=>r.syncedLyrics)||results.find(r=>r.plainLyrics);if(!result){lyricBox.textContent=t('lyric_not_found');return;}
            lyrics=(result.syncedLyrics||result.plainLyrics||'').split('\n').map(line=>{const m=line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);return{time:m?Number(m[1])*60+Number(m[2]):null,text:(m?m[3]:line).trim()};}).filter(l=>l.text);
            const data={title,artist,text:lyrics.map(l=>l.text).join('\n'),automatic_fallback:false};
            const read=await fetch(BASE+'/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Hangul-Lyrics-Client':'ivlyrics'},body:JSON.stringify(data),signal:controller.signal});lyricsResult=await read.json();renderLyric();
            } finally {clearTimeout(timeout);if(lyricAbort===controller)lyricAbort=null;}
        }
        function renderLyric(){if(!lyrics.length)return;const index=lyrics.findLastIndex(l=>l.time!==null&&l.time<=state.seconds);const phonetic=lyricsResult?.phonetic||[];if(lyrics.every(l=>l.time===null)){lyricBox.textContent=lyrics.map((l,i)=>l.text+(phonetic[i]?'\n'+phonetic[i]:'')).join('\n\n');return;}const at=Math.max(0,index);lyricBox.textContent=t('lyric_timing')+'\n'+lyrics[at].text+'\n'+(phonetic[at]||lyricsResult?.error||'');}
        const addHere=()=>{if(view?.tracks)addDialog();else open();};
        const menu=new Spicetify.Menu.Item(t('add_youtube_menu'),false,addHere);menu.register();
        function localLists(){const content=el('div',undefined,'display:grid;gap:8px');for(const p of data.playlists.filter(p=>p.local))content.append(button(p.name,()=>{Spicetify.PopupModal.hide();Spicetify.Platform.History.push('/spotify-hangul-links/'+p.id);}));if(!content.children.length)content.append(el('p',t('no_local_lists')));content.append(button(t('import_from_file'),()=>library.openPicker()));Spicetify.PopupModal.display({title:t('local_lists'),content});}
        const importMenu=new Spicetify.Menu.Item(t('import_mixed'),false,()=>library.openPicker());importMenu.register();const localMenu=new Spicetify.Menu.Item(t('local_lists'),false,localLists);localMenu.register();
        const playbackMenu=new Spicetify.Menu.Item(t('playback_mode'),false,()=>{const content=el('div',undefined,'display:grid;gap:12px');content.append(el('p',t('playback_mode_note')),button(t('mode_audio'),()=>{setPlaybackMode('audio');Spicetify.PopupModal.hide();}),button(t('mode_video'),()=>{setPlaybackMode('video');Spicetify.PopupModal.hide();}));Spicetify.PopupModal.display({title:t('playback_mode'),content});});playbackMenu.register();
        const top=new Spicetify.Topbar.Button(t('add_youtube_menu'),'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l12-7z"/></svg>',addHere);
        render();
        window.SpotifyHangulLinks={open,start,addYoutube,addCurrent,importCurrentPlaylist,stop,testLyrics,refreshView,startView,addDialog,currentTrack:()=>ivLyrics.currentTrack(),openLyrics,editLyricInfo,setPlaybackMode,exportPlaylist:()=>library.exportCurrent(),importPlaylistFile:file=>library.importFile(file),localLists,playbackState:()=>({active,playing,kind,state:{seconds:state.seconds,duration:state.duration}}),selectPlaylist(id){if(!data.playlists.some(p=>p.id===id))throw new Error(t('no_playlist'));selected=id;render();},pause:()=>send('pause'),play:()=>send('play'),next:()=>advance(1),previous:()=>advance(-1),seek:seconds=>send('seek',{seconds}),
            snapshot:()=>({active,kind,mediaMode,preferredMode,queueIndex,queueSource,playing,state:{...state},error:lastError,repeat,shuffle,selected,view:view?{uri:view.uri,nativeCount:view.tracks?.length,mixedCount:view.mixed?.length,error:view.error,bypass:viewBypass}:null,lyricsCount:lyrics.length,readingCoverage:lyricsResult?.coverage,readingError:lyricsResult?.error,lyricDisplay:lyricBox.textContent,playlists:JSON.parse(JSON.stringify(data.playlists))}),
            dispose(){if(disposed)return;extensionPlayer?.dispose();stop();desktopBridge?.dispose();overlay?.dispose();library.dispose();ivLyrics.dispose();disposed=true;viewEpoch++;clearTimeout(viewTimer);viewObserver.disconnect();unlisten?.();clearView();viewStyle.remove();clearInterval(timer);for(const fn of listeners)fn();unwrapPlayer();menu.deregister();importMenu.deregister();localMenu.deregister();playbackMenu.deregister();top.element?.remove();nowPlaying.dispose();nowPlayingStyle?.remove();panel.remove();delete window.SpotifyHangulLinks;}};
        desktopBridge=window.SpotifyHangulDesktopBridge.create(window);
        overlay=window.SpotifyHangulOverlayControls.create(window);
        // Extension audio for native songs is a separate module: when it cannot load, link playback still works and it is tried again.
        // Only a link item is busy for it: a mixed list's Spotify song plays through it like any other, and its skip/end moves the mixed list (skip).
        let extensionPlayer=null,extensionLoads=0;const loadExtensionPlayer=()=>{if(disposed||extensionPlayer)return;if(window.SpotifyHangulExtensionPlayer){extensionPlayer=window.SpotifyHangulExtensionPlayer.create(window,{ivLyrics,linkBusy:()=>active,skip:direction=>{if(active||kind!=='spotify'||!queue[queueIndex])return false;advance(direction);return true;},bindPlayer});if(window.SpotifyHangulLinks)window.SpotifyHangulLinks.extensionSnapshot=()=>extensionPlayer?.snapshot();return;}const script=document.createElement('script');script.src=BASE+'/ext/player.js';script.onload=loadExtensionPlayer;script.onerror=()=>{script.remove();if(++extensionLoads<40&&!disposed)setTimeout(loadExtensionPlayer,3000);};document.head.append(script);};loadExtensionPlayer();
    };
    init();
})();
})();
