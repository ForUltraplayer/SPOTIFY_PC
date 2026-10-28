/** @file youtube-links.js
 * @author: ForUltraplayer
 * @brief Manage link-only mixed playlists and route native Spotify playbar controls to an isolated YouTube player.
 */
(() => {
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
        if(value?.schema!==1||!Array.isArray(value.playlists))return{schema:1,playlists:[{id:'default',name:'링크 음악',tracks:[]}]};
        const playlists=value.playlists.filter(p=>p&&typeof p.id==='string'&&Array.isArray(p.tracks)).slice(0,100).map(p=>({id:p.id.slice(0,80),name:String(p.name||'재생목록').slice(0,100),tracks:p.tracks.slice(0,2000).map(track).filter(Boolean),...(/^spotify:playlist:[A-Za-z0-9]{22}$/.test(p.sourceUri||'')?{sourceUri:p.sourceUri}:{}),...(Array.isArray(p.order)?{order:[...new Set(p.order.filter(k=>typeof k==='string'&&/^(sp|yt):.{1,180}$/.test(k)))].slice(0,4000)}:{}),...(p.local===true&&Array.isArray(p.nativeTracks)?{local:true,nativeTracks:p.nativeTracks.slice(0,2000).map((n,i)=>{const item=track(n);if(item?.kind!=='spotify')return null;let image='';if(/^spotify:image:[a-fA-F0-9]{20,64}$/.test(n.image||''))image=n.image;else try{const url=new URL(n.image);if(url.protocol==='https:'&&['i.scdn.co','mosaic.scdn.co','image-cdn-ak.spotifycdn.com','image-cdn-fa.spotifycdn.com','image-cdn.spotifycdn.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port)image=url.origin+url.pathname;}catch{}return{...item,entryKey:String(n.entryKey||item.uri+'#'+i).slice(0,180),album:String(n.album||'').slice(0,300),image};}).filter(Boolean)}:{})}));
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
        if(dependency){if(!adapterLoading){adapterLoading=true;const script=document.createElement('script');script.src=BASE+'/youtube/'+dependency[1];script.onload=()=>{adapterLoading=false;init();};script.onerror=()=>{adapterLoading=false;script.remove();moduleFailures++;if(moduleFailures===3)Spicetify.showNotification?.('YouTube 연결 모듈을 불러오지 못했습니다. 도우미가 준비되면 자동으로 다시 시도합니다.',true);if(moduleFailures<40)setTimeout(init,3000);};document.head.append(script);}return;}
        // Without this stylesheet the now-playing panel draws its icons full size; retry a failed load instead of keeping it broken.
        let nowPlayingStyle=null;const loadNowPlayingStyle=attempt=>{const link=document.createElement('link');link.id='spotify-hangul-now-playing-style';link.rel='stylesheet';link.href=BASE+'/youtube/now-playing.css'+(attempt?'?r='+attempt:'');link.onerror=()=>{link.remove();if(attempt<10&&!disposed)setTimeout(()=>loadNowPlayingStyle(attempt+1),2000);};nowPlayingStyle=link;document.head.append(link);};if(!document.getElementById('spotify-hangul-now-playing-style'))loadNowPlayingStyle(0);
        let data,rawLibrary=null;try{rawLibrary=localStorage.getItem(KEY);data=MODEL.library(JSON.parse(rawLibrary));}catch{data=MODEL.library(null);}
        // A schema change or damaged entry falls back to fewer lists, and the next save would erase the rest; keep the first such original once.
        {let rawCount=-1;try{rawCount=JSON.parse(rawLibrary)?.playlists?.length??-1;}catch{}if(rawLibrary&&rawLibrary!=='null'&&(rawCount<0||data.playlists.length<rawCount))try{if(localStorage.getItem(KEY+':backup')===null)localStorage.setItem(KEY+':backup',rawLibrary);}catch{}}
        let selected=data.playlists[0].id,queue=[],queueIndex=-1,active=false,kind=null,playing=false,playbackIntent=false,shuffle=false,repeat='off',disposed=false;
        let baseline=null,state={seconds:0,duration:0,volume:25,muted:false,quality:'unknown'},lastError='',lyrics=[],lyricsResult=null,nativeTransitionUntil=0,lastNativeDuration=0,lyricAbort=null,queueSource=null,mediaMode='youtube',streamRequest=null,streamAttempted=false,autoRetried=null,autoRetryTimer=null;
        let preferredMode=readPlaybackMode(),streamEpoch=0,pendingAudioSeek=null;
        const session=crypto.randomUUID(),listeners=[],originals={},savedNodes=new Map();
        const playlist=()=>data.playlists.find(p=>p.id===selected)||data.playlists[0];
        let view=null,viewEpoch=0,viewTimer=null,originalGrid=null,gridDisplay='',mixedGrid=null,viewTools=null,viewBypass=false,localRoot=null;const localHidden=new Map();
        const dockHidden=new Map();
        const ivLyrics=window.SpotifyHangulIvLyrics.create(window);
        const library=window.SpotifyHangulLibrary.create(window,{getCurrent:async()=>{if(!view)throw new Error('내보낼 플레이리스트를 먼저 여세요.');const p=binding(view.uri);return{name:view.name,sourceUri:p?.sourceUri||(/^spotify:playlist:/.test(view.uri)?view.uri:undefined),nativeTracks:await readPlaylist(view.uri),tracks:p?.tracks||[],order:p?.order||[]};},onImport:async p=>{if(data.playlists.length>=100)throw new Error('저장 가능한 목록 수를 초과했습니다.');data.playlists.push(p);save();Spicetify.Platform.History.push('/spotify-hangul-links/'+p.id);}});
        let overlay=null,desktopBridge=null;
        const notify=(message,error=false)=>Spicetify.showNotification?.(message,error);
        const save=()=>localStorage.setItem(KEY,JSON.stringify(data));
        const el=(tag,text,css)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(css)node.style.cssText=css;return node;};
        const button=(text,action)=>{const node=el('button',text,'background:#303030;color:white;border:1px solid #555;border-radius:6px;padding:8px 12px;cursor:pointer');node.onclick=()=>Promise.resolve().then(action).catch(e=>notify(e.message||String(e),true));return node;};
        const panel=el('section',undefined,'position:fixed;left:90px;right:16px;top:64px;bottom:96px;z-index:9999;background:#121212;color:white;border:1px solid #555;border-radius:10px;padding:18px;overflow:auto;display:none;font:14px system-ui');panel.id='spotify-hangul-links';
        const header=el('div',undefined,'display:flex;align-items:center;gap:10px;margin-bottom:12px');
        header.append(el('h2','링크 음악','margin:0;flex:1'),button('접기',()=>collapse()),button('Spotify로 돌아가기',()=>stop()));panel.append(header);
        const controls=el('div',undefined,'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0');
        const choose=el('select',undefined,'background:#222;color:white;padding:8px;max-width:230px');choose.onchange=()=>{selected=choose.value;render();};
        const url=el('input');url.placeholder='YouTube / YouTube Music 링크';url.style.cssText='flex:1;min-width:200px;background:#222;color:white;padding:9px;border:1px solid #555;border-radius:5px';
        controls.append(choose,button('목록 만들기',()=>{const name=prompt('재생목록 이름');if(!name?.trim())return;const p={id:crypto.randomUUID(),name:name.trim().slice(0,100),tracks:[]};data.playlists.push(p);selected=p.id;save();render();}),url,button('링크 추가',()=>addYoutube(url.value)),button('현재 Spotify 곡 추가',()=>addCurrent()),button('현재 Spotify 목록 가져오기',()=>importCurrentPlaylist()));panel.append(controls);
        const hint=el('p','링크만 저장합니다. 이 목록은 이 PC의 링크 음악에서 관리하며 Spotify 서버의 원본 목록은 바꾸지 않습니다.','color:#aaa;margin:8px 0');panel.append(hint);
        const body=el('div',undefined,'display:grid;grid-template-columns:minmax(280px,1fr) minmax(360px,1.2fr);gap:16px');
        const list=el('div',undefined,'max-height:60vh;overflow:auto');const right=el('div');
        const frame=document.createElement('iframe');frame.id='spotify-hangul-youtube-frame';frame.title='YouTube 링크 음악 플레이어';frame.allow='autoplay; encrypted-media; fullscreen';frame.style.cssText='width:100%;height:100%;min-height:200px;border:0;background:black';
        const audio=new Audio();
        const lyricBox=el('div',undefined,'max-height:220px;overflow:auto;white-space:pre-wrap;line-height:1.8');
        const nowPlaying=window.SpotifyHangulNowPlaying.create(window,{onMode:setPlaybackMode,onLyrics:()=>ivLyrics.open(),onSearch:()=>editLyricInfo(queue[queueIndex]),onRetry:retryCurrentPlayback,onQueue:showQueue,onClose:stop});
        nowPlaying.mediaAnchor.append(frame);right.append(nowPlaying.element);body.append(list,right);panel.append(body);document.body.append(panel);
        function updateModeControls(){renderStatus();}
        function retryCurrentPlayback(){const item=queue[queueIndex];if(!active||item?.kind!=='youtube')return;const seconds=mediaMode==='direct'&&audio.src&&Number.isFinite(audio.currentTime)?audio.currentTime:Math.max(0,Number(state.seconds)||0);if(mediaMode==='direct'||preferredMode==='audio'){cancelStream();clearAudio();state={...state,seconds};void startDirect({seconds});return;}lastError='';state={...state,seconds,ready:false};open();send('load',{videoId:item.videoId,seconds,autoplay:playbackIntent});renderStatus();}
        // First loads fail transiently (expired stream URL, player not settled); a manual retry almost always works, so retry once per track silently.
        function autoRetryOnce(){const item=queue[queueIndex];if(!active||item?.kind!=='youtube')return false;if(autoRetried===item)return autoRetryTimer!==null;autoRetried=item;lastError='';state={...state,ready:false};renderStatus();autoRetryTimer=setTimeout(()=>{autoRetryTimer=null;if(active&&queue[queueIndex]===item)retryCurrentPlayback();},800);return true;}
        updateModeControls();
        function cancelStream(){streamEpoch++;streamRequest?.abort();streamRequest=null;streamAttempted=false;pendingAudioSeek=null;}
        function clearAudio(){audio.pause();audio.removeAttribute('src');audio.load();}
        function setPlaybackMode(mode){
            if(mode!=='audio'&&mode!=='video')throw new Error('재생 방식을 확인해 주세요.');
            preferredMode=mode;try{localStorage.setItem(MODE_KEY,mode);}catch{notify('재생 방식 설정을 저장하지 못했습니다.',true);}updateModeControls();
            if(!active||kind!=='youtube')return;
            if(mode==='audio'&&mediaMode==='direct'&&(streamRequest||audio.src&&!lastError))return;
            if(mode==='video'&&mediaMode==='youtube'&&!streamRequest)return;
            const seconds=mediaMode==='direct'&&audio.src&&Number.isFinite(audio.currentTime)?audio.currentTime:Math.max(0,Number(state.seconds)||0);
            cancelStream();mediaMode='youtube';clearAudio();state={...state,seconds};playing=false;lastError='';
            if(mode==='audio'){void startDirect({seconds});return;}
            open();send('load',{videoId:queue[queueIndex].videoId,seconds,autoplay:playbackIntent});renderStatus();
        }
        function ensureFrame(){if(!frame.src)frame.src=BASE+'/youtube/player#session='+encodeURIComponent(session);}
        function send(command,extra={}){if(command==='load'){playbackIntent=extra.autoplay===true;extra={...extra,volume:Number.isFinite(state.volume)?Math.max(0,Math.min(100,state.volume)):25,muted:!!state.muted};}else if(command==='play'){playbackIntent=true;extra={...extra,muted:!!state.muted};}else if(command==='pause'||command==='stop')playbackIntent=false;if(mediaMode==='direct'){if(command==='pause'||command==='stop')audio.pause();else if(command==='play'&&audio.src)audio.play().catch(e=>{if(e.name==='AbortError')return;lastError=e.message;renderStatus();});else if(command==='seek'){const seconds=Math.max(0,Math.min(audio.duration||Infinity,Number(extra.seconds)||0));if(pendingAudioSeek||!audio.src){if(pendingAudioSeek)pendingAudioSeek.seconds=seconds;state={...state,seconds};}else audio.currentTime=seconds;}else if(command==='volume')audio.volume=Math.max(0,Math.min(1,Number(extra.volume)/100));else if(command==='mute')audio.muted=!!extra.muted;updateAudio();return;}ensureFrame();frame.contentWindow?.postMessage({type:'spotify-hangul-youtube-command',session,command,...extra},BASE);}
        function updateAudio(){if(!active||mediaMode!=='direct')return;state={...state,...(!pendingAudioSeek&&audio.src?{seconds:audio.currentTime||0,duration:Number.isFinite(audio.duration)?audio.duration:state.duration}:{}),volume:audio.volume*100,muted:audio.muted};playing=!!audio.src&&!audio.paused&&!audio.ended;ivLyrics.update(queue[queueIndex],{...state,playing});renderStatus();updateBar();}
        function applyAudioResume(){const resume=pendingAudioSeek;if(!resume||!audio.src||audio.readyState<1||resume.epoch!==streamEpoch||mediaMode!=='direct'||!active||queue[queueIndex]?.videoId!==resume.videoId)return;audio.currentTime=Math.max(0,Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,resume.seconds));pendingAudioSeek=null;}
        audio.addEventListener('loadedmetadata',applyAudioResume);
        audio.addEventListener('playing',()=>{if(mediaMode==='direct'){lastError='';updateAudio();}});
        for(const event of['timeupdate','play','pause','loadedmetadata','volumechange','seeked'])audio.addEventListener(event,updateAudio);
        audio.addEventListener('ended',()=>{if(active&&mediaMode==='direct')advance(0);});audio.addEventListener('error',()=>{if(active&&mediaMode==='direct'){if(autoRetryOnce())return;lastError='대체 오디오 재생에 실패했습니다. 해당 곡을 다시 재생해 주세요.';renderStatus();}});
        // Look up the next YouTube recording's audio in the last 45 s of this one, so it starts without the lookup wait.
        const prefetched=new Map();
        audio.addEventListener('timeupdate',()=>{if(!active||mediaMode!=='direct'||preferredMode!=='audio'||!Number.isFinite(audio.duration)||audio.duration-audio.currentTime>45)return;const next=queue[queueIndex+1];if(next?.kind!=='youtube'||Date.now()-(prefetched.get(next.videoId)||0)<240000)return;prefetched.set(next.videoId,Date.now());postHelper('/youtube/stream',{video_id:next.videoId}).catch(()=>{});});
        async function startDirect({seconds=Math.max(0,Number(state.seconds)||0)}={}){
            if(streamAttempted||!active||queue[queueIndex]?.kind!=='youtube')return;
            streamAttempted=true;const item=queue[queueIndex],epoch=streamEpoch,controller=new AbortController();streamRequest=controller;
            const current=()=>active&&queue[queueIndex]===item&&streamEpoch===epoch&&mediaMode==='direct';
            let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},95000);
            frame.contentWindow?.postMessage({type:'spotify-hangul-youtube-command',session,command:'pause'},BASE);
            mediaMode='direct';pendingAudioSeek={epoch,videoId:item.videoId,seconds};state={...state,seconds};playing=false;lastError='공개 음원을 확인하는 중…';open();renderStatus();
            try{let response,stream;for(let attempt=0;attempt<4;attempt++){
                response=await fetch(BASE+'/youtube/stream',{method:'POST',headers:{'Content-Type':'application/json','X-Hangul-Lyrics-Client':'ivlyrics'},body:JSON.stringify({video_id:item.videoId}),signal:controller.signal});stream=await response.json();
                if(response.ok)break;if(attempt===3||!(response.status===429||response.status>=500))throw new Error(stream.error||'공개 음원을 찾지 못했습니다.');
                await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},2000);const cancel=()=>{clearTimeout(timer);reject(new DOMException('Track changed','AbortError'));};if(controller.signal.aborted)cancel();else controller.signal.addEventListener('abort',cancel,{once:true});});
            }
            if(!current()||controller.signal.aborted)return;
            const url=new URL(stream.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.googlevideo.com')||url.username||url.password||url.port)throw new Error('유효한 공개 오디오 주소가 아닙니다.');
            lastError='';state={...state,codec:stream.codec,bitrate:stream.bitrate_kbps,duration:stream.duration};audio.volume=Math.max(0,Math.min(1,state.volume/100));audio.muted=!!state.muted;audio.src=stream.url;
            open();
            if(audio.readyState>=1)applyAudioResume();if(playbackIntent&&current())await audio.play();if(current())updateAudio();
            }catch(error){if(current()&&(!controller.signal.aborted||timedOut)){if(!timedOut&&autoRetryOnce())return;lastError=(timedOut?'음원 조회 시간이 초과됐습니다.':error.message)+' 음원 재생을 다시 누르거나 YouTube 영상을 선택해 주세요.';renderStatus();}}
            finally{clearTimeout(timeout);if(streamRequest===controller){streamRequest=null;if(current())renderStatus();}}
        }
        function restoreDock(){for(const[node,display]of dockHidden){if(node.isConnected)node.style.display=display;}dockHidden.clear();if(panel.parentElement!==document.body)document.body.append(panel);panel.style.display='none';}
        function open(){if(!active){restoreDock();const uri=view?.uri||Spicetify.Player.data?.context?.uri;if(/^spotify:playlist:[A-Za-z0-9]{22}$/.test(uri||'')){Spicetify.Platform.History.push('/playlist/'+uri.split(':')[2]);return;}notify('YouTube를 추가할 Spotify 플레이리스트를 여세요.');return;}
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
                row.append(button('▶',()=>start(index)),info,button('↑',()=>move(index,-1)),button('↓',()=>move(index,1)),button('제거',()=>{playlist().tracks.splice(index,1);save();render();}));list.append(row);
            });
            if(!playlist().tracks.length)list.append(el('p','링크나 현재 Spotify 곡을 추가하세요.'));
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
            while(offset<total){let timeout;const result=await Promise.race([Spicetify.Platform.PlaylistAPI.getContents(uri,{offset,limit:100}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Spotify 목록 조회 시간이 초과됐습니다. 다시 불러오기를 눌러 주세요.')),15000);})]).finally(()=>clearTimeout(timeout));const items=result.items||[];total=result.totalLength??offset+items.length;if(total>2000)throw new Error('통합 목록은 현재 2,000 곡까지 지원합니다. 원본 목록을 표시합니다.');if(!items.length){if(offset<total)throw new Error('Spotify 목록을 끝까지 읽지 못했습니다. 다시 불러오기를 눌러 주세요.');break;}
                for(const entry of items){const source=entry.track||entry;const item=MODEL.track({kind:'spotify',uri:source.uri,title:source.name,artist:source.artists?.map(a=>a.name).join(', '),duration:(source.duration?.milliseconds??(Number(source.duration)||0))/1000});if(!item)throw new Error('지원하지 않는 항목이 있어 원본 Spotify 목록을 표시합니다.');const occurrence=counts.get(item.uri)||0;counts.set(item.uri,occurrence+1);tracks.push({...item,entryKey:entry.uid||source.uid||item.uri+'#'+occurrence,album:source.album?.name||'',image:source.album?.images?.find(i=>i.label==='small')?.url||source.album?.images?.[0]?.url||''});}
                offset+=items.length;
            }return tracks;}
        async function refreshView(force=false){const uri=viewedUri();if(!uri){viewEpoch++;clearView();view=null;viewBypass=false;return;}
            const local=binding(uri)?.local;
            if(view?.uri!==uri&&local){viewEpoch++;clearView();view=null;viewBypass=false;}
            if(local&&!localRoot?.isConnected){const main=document.querySelector('main');if(!main)return;for(const child of main.children){localHidden.set(child,child.style.display);child.style.display='none';}localRoot=el('section',undefined,'padding:28px 24px;background:linear-gradient(#23333b,#121212 260px);min-height:100%;color:white');localRoot.dataset.hangulLocal='true';localRoot.append(el('p','가져온 로컬 플레이리스트','color:#bbb'),el('h1',binding(uri).name,'font-size:42px;margin:12px 0 24px'));const actions=el('div');actions.dataset.testid='action-bar-row';actions.append(button('▶ 재생',togglePlaylistPlayback));localRoot.append(actions);const placeholder=el('div');placeholder.setAttribute('role','grid');placeholder.setAttribute('aria-rowcount','1');localRoot.append(placeholder);main.append(localRoot);}
            if(local)for(const child of document.querySelector('main')?.children||[]){if(child!==localRoot&&!localHidden.has(child)){localHidden.set(child,child.style.display);child.style.display='none';}}
            const page=local?localRoot:document.querySelector('main [data-testid="playlist-page"]');const grid=page?.querySelector('[role="grid"][aria-rowcount]');const toolbar=page?.querySelector('[data-testid="action-bar-row"]');if(!grid||!toolbar)return;
            if(view?.uri!==uri){viewEpoch++;if(!local)clearView();view={uri,name:page.querySelector('h1')?.textContent||'Spotify 플레이리스트',tracks:null,loading:false,error:''};viewBypass=false;}
            for(const stale of page.querySelectorAll('[data-hangul-links="tools"]'))if(stale!==viewTools)stale.remove();
            if(!viewTools?.isConnected){viewTools=el('div',undefined,'');viewTools.className='hl-mixed-tools';viewTools.dataset.hangulLinks='tools';const add=button('YouTube 링크 추가',()=>addDialog());add.dataset.testid='hangul-youtube-add';viewTools.append(add,button('다시 불러오기',()=>refreshView(true)),button(viewBypass?'통합 목록':'원본 편집',()=>{viewBypass=!viewBypass;refreshView(!viewBypass);}),button('Spotify 순서로',()=>{const p=binding(view.uri);if(p)delete p.order;save();renderView();}),button('내보내기',()=>library.exportCurrent()),button('가져오기',()=>library.openPicker()),el('span','YouTube 링크는 이 PC에 저장됩니다.',''));viewTools.children[2].disabled=!!local;viewTools.lastChild.className='hl-mixed-note';toolbar.after(viewTools);}
            if((!view.tracks||force)&&!view.loading){const epoch=++viewEpoch;view.loading=true;view.error='';const expected=view;viewTools.lastChild.textContent='Spotify 목록을 읽는 중…';try{const tracks=await readPlaylist(uri);if(disposed||epoch!==viewEpoch||view!==expected||viewedUri()!==uri)return;view.tracks=tracks;}catch(error){if(view===expected&&epoch===viewEpoch)view.error=error.message;}finally{expected.loading=false;}if(view!==expected||epoch!==viewEpoch)return;}
            if(view.loading)return;
            viewTools.lastChild.textContent=view.error||`Spotify ${view.tracks?.length||0} 곡 + YouTube ${binding(uri)?.tracks.length||0} 곡 · 링크는 이 PC에 저장됩니다.`;
            viewTools.children[2].textContent=viewBypass?'통합 목록':'원본 편집';
            if(view.error||viewBypass||(!local&&!binding(uri)?.tracks.length&&!binding(uri)?.order?.length)){if(originalGrid?.isConnected)originalGrid.style.display=gridDisplay;originalGrid=null;mixedGrid?.remove();mixedGrid=null;return;}
            if(originalGrid!==grid||!mixedGrid?.isConnected){if(originalGrid?.isConnected)originalGrid.style.display=gridDisplay;mixedGrid?.remove();originalGrid=grid;gridDisplay=grid.style.display;grid.style.display='none';mixedGrid=el('div');mixedGrid.className='hl-mixed-grid';mixedGrid.dataset.testid='hangul-mixed-tracklist';mixedGrid.setAttribute('role','table');grid.before(mixedGrid);renderView();}
            else if(force)renderView();
        }
        function renderView(){if(!view?.tracks||!mixedGrid)return;const bound=binding(view.uri);view.mixed=MODEL.merge(view.tracks,bound?.tracks||[],bound?.order);mixedGrid.replaceChildren();mixedGrid.setAttribute('aria-label',view.name+' 통합 곡 목록');
            const heading=el('div');heading.className='hl-mixed-row hl-mixed-head';heading.setAttribute('role','row');for(const label of['#','제목','앨범 / 출처','재생 시간']){const cell=el('div',label);cell.setAttribute('role','columnheader');if(label==='앨범 / 출처')cell.className='hl-mixed-album';heading.append(cell);}mixedGrid.append(heading);
            view.mixed.forEach((item,index)=>{const row=el('div');row.className='hl-mixed-row';row.setAttribute('role','row');row.dataset.index=String(index);row.dataset.kind=item.kind;row.dataset.identity=item.videoId||item.uri;const play=button('▶',()=>startView(index));play.setAttribute('aria-label',item.title+' 재생');play.title=String(index+1);play.dataset.testid='hangul-row-play';row.append(play);
                const title=el('div');title.className='hl-mixed-title';const image=el('img');image.width=40;image.height=40;image.loading='lazy';image.alt='';image.style.cssText='border-radius:4px;object-fit:cover';image.src=item.kind==='youtube'?'https://i.ytimg.com/vi/'+item.videoId+'/default.jpg':item.image;const info=el('div');info.className='hl-mixed-info';const name=el('div',item.title);name.className='hl-mixed-name';name.title=item.title;const artist=el('div',item.artist);artist.className='hl-mixed-artist';info.append(name,artist);title.append(image,info);row.append(title);const album=el('div',item.kind==='youtube'?'YouTube':item.album);album.className='hl-mixed-album hl-mixed-artist';row.append(album);
                const actions=el('div');actions.className='hl-mixed-actions';actions.append(el('span',item.duration?time(item.duration):'—'));
                for(const[mark,delta,label]of[['↑',-1,'위로 이동'],['↓',1,'아래로 이동']]){const move=button(mark,()=>moveViewed(MODEL.rowKey(item),index+delta));move.setAttribute('aria-label',item.title+' '+label);actions.append(move);}
                if(item.kind==='youtube'){const remove=button('×',()=>{const p=binding(view.uri);p.tracks=p.tracks.filter(t=>t.videoId!==item.videoId);p.order=p.order?.filter(k=>k!==MODEL.rowKey(item));save();refreshView(true);});remove.setAttribute('aria-label',item.title+' 링크 제거');actions.append(remove);}
                row.draggable=true;row.ondragstart=event=>event.dataTransfer.setData('application/x-hangul-row',MODEL.rowKey(item));row.ondragover=event=>{if([...event.dataTransfer.types].includes('application/x-hangul-row'))event.preventDefault();};row.ondrop=event=>{const key=event.dataTransfer.getData('application/x-hangul-row');if(!view.mixed.some(t=>MODEL.rowKey(t)===key))return;event.preventDefault();moveViewed(key,index);};row.append(actions);row.ondblclick=event=>{if(!event.target.closest('button'))Promise.resolve().then(()=>startView(index)).catch(e=>notify(e.message,true));};row.oncontextmenu=event=>{event.preventDefault();const content=el('div');content.append(button('제목 복사',()=>Spicetify.Platform.ClipboardAPI.copy(item.title)),button('이 곡 뒤에 YouTube 추가',()=>addDialog(item.kind==='spotify'?item.entryKey:item.after)));if(item.kind==='spotify')content.append(button('Spotify 곡 열기',()=>Spicetify.Platform.History.push('/track/'+item.uri.split(':')[2])));else content.append(button('가사 검색 정보',()=>editLyricInfo(item)));Spicetify.PopupModal.display({title:item.title,content});};mixedGrid.append(row);});markPlaying();}
        function moveViewed(key,index){if(!view?.mixed)return;const p=binding(view.uri);p.order=MODEL.reorder(view.mixed,key,index);save();renderView();}
        function togglePlaylistPlayback(){if(queueSource===view?.uri&&(active||kind==='spotify')){if(active)toggle();else Spicetify.Player.togglePlay();}else startView(0);}
        function markPlaying(){if(!mixedGrid)return;for(const row of mixedGrid.querySelectorAll('[data-index]')){const item=view?.mixed?.[Number(row.dataset.index)],playingItem=queue[queueIndex];const matches=queueSource===view?.uri&&item&&playingItem&&MODEL.rowKey(item)===MODEL.rowKey(playingItem);const value=String(!!matches);if(row.dataset.playing!==value)row.dataset.playing=value;}}
        function editLyricInfo(item){if(item?.kind!=='youtube')throw new Error('YouTube 곡을 먼저 선택하세요.');const profile=window.SpotifyHangulIvLyrics.searchInfo(item),content=el('div',undefined,'display:grid;gap:12px');const title=el('input'),artist=el('input');for(const node of[title,artist])node.style.cssText='background:#282828;color:white;border:1px solid #777;padding:12px;border-radius:4px';title.value=profile.title;title.setAttribute('aria-label','가사 검색용 곡명');artist.value=profile.artist;artist.setAttribute('aria-label','가사 검색용 원곡 가수');const message=el('p','커버 영상의 경우 원곡 제목과 가수를 지정할 수 있습니다. 원곡 시간은 영상과 다를 수 있습니다.');content.append(title,artist,message,button('저장하고 가사 다시 조회',async()=>{if(!title.value.trim())throw new Error('가사 검색용 곡명을 입력해 주세요.');for(const p of data.playlists)for(const t of p.tracks)if(t.kind==='youtube'&&t.videoId===item.videoId){t.lyricTitle=title.value.trim().slice(0,300);t.lyricArtist=artist.value.trim().slice(0,200);}for(const t of queue)if(t.kind==='youtube'&&t.videoId===item.videoId){t.lyricTitle=title.value.trim().slice(0,300);t.lyricArtist=artist.value.trim().slice(0,200);}save();if(active&&queue[queueIndex]?.videoId===item.videoId){ivLyrics.update(queue[queueIndex],{...state,playing});await ivLyrics.reload();}Spicetify.PopupModal.hide();}));Spicetify.PopupModal.display({title:'YouTube 가사 검색 정보',content});}
        function startView(index){if(!view?.tracks||view.error)throw new Error('목록을 다시 불러온 뒤 재생해 주세요.');const device=Spicetify.Platform.ConnectAPI?.state?.activeDevice;if(device&&device.isLocal===false)throw new Error('YouTube 혼합 재생은 이 컴퓨터에서 지원합니다. Spotify의 기기에 연결하기에서 이 컴퓨터를 선택해 주세요.');const bound=binding(view.uri);queue=MODEL.merge(view.tracks,bound?.tracks||[],bound?.order);queueSource=view.uri;queueIndex=index;playCurrent();markPlaying();}
        async function metadata(value){const id=MODEL.youtubeId(value);if(!id)throw new Error('지원하는 YouTube 영상 링크를 입력해 주세요.');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);try{const response=await postHelper('/youtube/metadata',{video_id:id},controller.signal);const info=await response.json();if(!response.ok)throw new Error(info.error||'영상 정보를 가져오지 못했습니다.');return MODEL.track({kind:'youtube',videoId:id,title:info.title,artist:info.author||info.artist});}finally{clearTimeout(timeout);}}
        function addDialog(after){if(!view?.tracks||view.error)throw new Error(view?.error||'Spotify 플레이리스트를 먼저 여세요.');const target=view;const content=el('div',undefined,'display:grid;gap:14px');const input=el('input');input.placeholder='YouTube / YouTube Music 영상 주소';input.setAttribute('aria-label','YouTube 영상 주소');input.style.cssText='width:100%;padding:12px;background:#282828;color:white;border:1px solid #777;border-radius:4px';
            const position=el('select');position.setAttribute('aria-label','목록에 추가할 위치');position.style.cssText=input.style.cssText;for(const[label,value]of[['목록 맨 끝','$end'],['목록 맨 앞',''],...target.tracks.map(t=>[t.title+' 뒤',t.entryKey])]){const option=el('option',label);option.value=value;position.append(option);}if(typeof after==='string')position.value=after;
            const saved=data.playlists.filter(p=>!p.sourceUri).flatMap(p=>p.tracks.filter(t=>t.kind==='youtube'));if(saved.length){const pick=el('select');pick.style.cssText=input.style.cssText;pick.setAttribute('aria-label','이전에 추가한 영상');pick.append(el('option','직접 입력하거나 이전 영상 선택'));for(const t of saved){const option=el('option',t.title);option.value=t.videoId;pick.append(option);}pick.onchange=()=>{if(MODEL.youtubeId(pick.value))input.value='https://www.youtube.com/watch?v='+pick.value;};content.append(pick);}
            const message=el('p','이 플레이리스트의 곡 사이에 링크를 추가합니다. 링크 정보는 이 PC에 저장됩니다.','color:#b3b3b3');const add=button('이 플레이리스트에 추가',async()=>{add.disabled=true;message.textContent='영상 정보를 확인하는 중…';try{const item=await metadata(input.value);if(disposed)return;let p=binding(target.uri);if(!p){p={id:'native:'+target.uri.split(':')[2],sourceUri:target.uri,name:target.name,tracks:[]};data.playlists.push(p);}if(p.tracks.some(t=>t.videoId===item.videoId))throw new Error('이미 이 플레이리스트에 추가한 영상입니다.');item.after=position.value==='$end'?(target.tracks.at(-1)?.entryKey||''):position.value;p.tracks.push(item);if(p.order?.length){const live=MODEL.merge(target.tracks,p.tracks.filter(t=>t.videoId!==item.videoId),p.order);const at=position.value==='$end'?live.length:position.value===''?0:live.findIndex(t=>t.kind==='spotify'&&t.entryKey===position.value)+1;live.splice(Math.max(0,at),0,item);p.order=live.map(MODEL.rowKey);}save();if(view?.uri===target.uri){viewBypass=false;await refreshView(true);}Spicetify.PopupModal.hide();}catch(error){message.textContent=error.name==='AbortError'?'영상 조회 시간이 초과됐습니다. 다시 시도해 주세요.':error.message;}finally{add.disabled=false;}});add.dataset.testid='hangul-youtube-confirm';content.append(input,position,message,add);Spicetify.PopupModal.display({title:target.name+'에 YouTube 추가',content});}
        const scheduleView=()=>{clearTimeout(viewTimer);viewTimer=setTimeout(()=>refreshView().catch(error=>notify(error.message,true)),180);};
        const viewObserver=new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('#spotify-hangul-links,.hl-mixed-grid,.hl-mixed-tools'))){scheduleView();}});viewObserver.observe(document.body,{childList:true,subtree:true});
        const unlisten=Spicetify.Platform.History.listen(()=>{viewEpoch++;clearView();view=null;viewBypass=false;scheduleView();});scheduleView();
        function move(index,delta){const tracks=playlist().tracks;const to=index+delta;if(to<0||to>=tracks.length)return;[tracks[index],tracks[to]]=[tracks[to],tracks[index]];save();render();}
        async function addYoutube(value,metadata){
            const id=MODEL.youtubeId(value);if(!id)throw new Error('지원하는 YouTube 영상 링크를 입력해 주세요.');
            if(playlist().tracks.some(t=>t.kind==='youtube'&&t.videoId===id)){notify('이미 이 목록에 있는 영상입니다.');return;}
            const info=metadata||await postHelper('/youtube/metadata',{video_id:id}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||'YouTube 정보를 가져오지 못했습니다.');return body;});
            playlist().tracks.push(MODEL.track({kind:'youtube',videoId:id,title:info.title,artist:info.author||info.artist}));url.value='';save();render();return id;
        }
        function addCurrent(){const item=Spicetify.Player.data?.item;if(!item?.uri?.startsWith('spotify:track:'))throw new Error('먼저 Spotify 곡을 선택하세요.');const meta=item.metadata||{};playlist().tracks.push(MODEL.track({kind:'spotify',uri:item.uri,title:item.name||meta.title,artist:meta.artist_name,duration:Spicetify.Player.getDuration()/1000}));save();render();}
        async function importCurrentPlaylist(){
            const context=Spicetify.Player.data?.context;if(!context?.uri?.startsWith('spotify:playlist:'))throw new Error('Spotify 재생목록의 곡을 먼저 선택하세요.');
            if(typeof Spicetify.Platform.PlaylistAPI?.getContents!=='function')throw new Error('현재 Spotify 버전에서 목록 읽기를 지원하지 않습니다.');
            const tracks=[];let offset=0,total=1;
            while(offset<total&&offset<2000){const response=await Spicetify.Platform.PlaylistAPI.getContents(context.uri,{offset,limit:100});const items=response.items||[];if(!items.length)break;for(const entry of items){const item=entry.track||entry;const track=MODEL.track({kind:'spotify',uri:item.uri,title:item.name,artist:item.artists?.map(a=>a.name).join(', '),duration:typeof item.duration==='object'?(item.duration.milliseconds||0)/1000:Number(item.duration||0)/1000});if(track)tracks.push(track);}offset+=items.length;total=response.totalLength??offset;}
            const p={id:crypto.randomUUID(),name:String(context.metadata?.context_description||context.metadata?.title||'Spotify에서 가져온 목록').slice(0,100),tracks};data.playlists.push(p);selected=p.id;save();render();notify(tracks.length+' 곡을 링크 음악 목록으로 가져왔습니다. 원본 목록은 유지됩니다.');
        }
        function start(index){queueSource=null;queue=playlist().tracks.map(t=>({...t}));queueIndex=index;playCurrent();}
        function remember(){if(baseline)return;baseline={uri:Spicetify.Player.data?.item?.uri,contextUri:Spicetify.Player.data?.context?.uri,progress:Spicetify.Player.getProgress(),paused:!Spicetify.Player.isPlaying()};}
        function playCurrent(){const item=queue[queueIndex];if(!item)return stop();clearTimeout(autoRetryTimer);autoRetryTimer=null;autoRetried=null;cancelStream();mediaMode='youtube';clearAudio();const device=Spicetify.Platform.ConnectAPI?.state?.activeDevice;if(queueSource&&device&&device.isLocal===false){send('pause');active=false;kind=null;queue=[];queueIndex=-1;queueSource=null;baseline=null;ivLyrics.deactivate();restoreBar();restoreDock();notify('재생 기기가 변경되어 YouTube 혼합 재생을 종료했습니다. 이 컴퓨터에서 다시 재생해 주세요.',true);return;}lyricAbort?.abort();remember();lastError='';lyrics=[];lyricsResult=null;lyricBox.textContent='';if(item.kind==='youtube'){
                originals.pause.call(Spicetify.Player);nativeTransitionUntil=Date.now()+4000;active=true;kind='youtube';playing=false;playbackIntent=true;state={...state,seconds:0,duration:item.duration||0};ivLyrics.update(item,{...state,playing});open();if(preferredMode==='audio')void startDirect({seconds:0});else send('load',{videoId:item.videoId,autoplay:true});
            }else{active=false;kind='spotify';ivLyrics.deactivate();restoreDock();nativeTransitionUntil=Date.now()+8000;lastNativeProgress=0;lastNativeDuration=0;restoreBar();send('pause');Promise.resolve(/^spotify:playlist:/.test(queueSource||'')?Spicetify.Player.playUri(queueSource,{}, {skipTo:{uri:item.uri,uid:item.entryKey},initiallyPaused:false}):Spicetify.Player.playUri(item.uri)).catch(()=>{lastError='Spotify 곡을 재생하지 못했습니다.';kind=null;renderStatus();});}
            renderStatus();markPlaying();
        }
        function advance(direction=1){const next=MODEL.nextIndex(queueIndex,queue.length,direction,repeat,shuffle);if(next<0){playing=false;if(active)send('pause');else{originals.pause.call(Spicetify.Player);kind=null;queue=[];queueIndex=-1;}return;}queueIndex=next;playCurrent();}
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
            state=next;playing=next.state===1;lastError=next.error||'';
            if(next.event==='autoplay-blocked')lastError='YouTube 플레이어의 재생 버튼을 눌러 주세요.';
            if(next.event==='state'&&next.value===0){advance(0);return;}
            ivLyrics.update(queue[queueIndex],{...state,playing});renderStatus();updateBar();
        }
        window.addEventListener('message',onMessage);listeners.push(()=>window.removeEventListener('message',onMessage));
        const rememberNode=node=>{if(node&&!savedNodes.has(node))savedNodes.set(node,{text:node.textContent,html:node.namespaceURI==='http://www.w3.org/2000/svg'?node.innerHTML:null,viewBox:node.getAttribute('viewBox'),href:node.getAttribute('href'),src:node.getAttribute('src'),label:node.getAttribute('aria-label'),valueText:node.getAttribute('aria-valuetext'),max:node.getAttribute('max'),value:node.value,style:node.getAttribute('style')});return node;};
        function text(node,value){if(node&&node.textContent!==value){rememberNode(node);node.textContent=value;}}
        function restoreBar(){for(const[node,old]of savedNodes){if(!node.isConnected)continue;if(old.html!==null){node.innerHTML=old.html;if(old.viewBox===null)node.removeAttribute('viewBox');else node.setAttribute('viewBox',old.viewBox);}else if(node.tagName==='IMG')node.src=old.src;else if(node.tagName==='INPUT'){node.max=old.max;node.value=old.value;}else if(node.tagName!=='BUTTON'&&node.getAttribute('data-testid')!=='progress-bar')node.textContent=old.text;delete node.dataset.youtubeState;delete node.dataset.hangulYoutubeArtist;delete node.dataset.hangulYoutubeTitle;for(const[attr,key]of[['href','href'],['aria-label','label'],['aria-valuetext','valueText'],['style','style']]){if(old[key]===null)node.removeAttribute(attr);else node.setAttribute(attr,old[key]);}}savedNodes.clear();}
        const time=seconds=>`${Math.floor(Math.max(0,seconds||0)/60)}:${String(Math.floor(Math.max(0,seconds||0)%60)).padStart(2,'0')}`;
        function updateBar(){if(!active)return;const bar=document.querySelector('[data-testid="now-playing-bar"]');if(!bar)return;const item=queue[queueIndex];if(!item)return;
            const widget=bar.querySelector('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]');
            const title=widget?.querySelector('[data-hangul-youtube-title],a[href*="/album/"],a[data-testid="context-item-link"]');const artist=widget?.querySelector('[data-hangul-youtube-artist],a[href*="/artist/"]');if(title)title.dataset.hangulYoutubeTitle='true';if(artist)artist.dataset.hangulYoutubeArtist='true';
            text(title,item.title);text(artist,item.artist);for(const node of[title,artist]){if(node){rememberNode(node);node.setAttribute('href','https://www.youtube.com/watch?v='+item.videoId);}}
            for(const node of widget?.querySelectorAll('a[href*="/artist/"]')||[]){if(node!==artist){rememberNode(node);node.style.display='none';}}
            for(const node of widget?.querySelectorAll('button[aria-label*="좋아요"],button[aria-label*="플레이리스트에 추가"]')||[]){rememberNode(node);node.style.display='none';}
            const image=widget?.querySelector('img');if(image&&image.src!==`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`){rememberNode(image);image.src=`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;}
            const play=bar.querySelector('[data-testid="control-button-playpause"]');if(play){rememberNode(play);play.setAttribute('aria-label',playing?'YouTube 일시정지':'YouTube 재생');const svg=play.querySelector('svg');if(svg&&play.dataset.youtubeState!==(playing?'playing':'paused')){rememberNode(svg);svg.setAttribute('viewBox','0 0 16 16');svg.innerHTML=playing?'<path d="M3 2h4v12H3zM9 2h4v12H9z"/>':'<path d="M4 2v12l10-6z"/>'; }play.dataset.youtubeState=playing?'playing':'paused';}
            const progress=bar.querySelector('.playback-bar');if(progress){const texts=progress.querySelectorAll('[data-testid="playback-position"],[data-testid="playback-duration"]');if(texts.length){text(texts[0],time(state.seconds));if(texts.length>1)text(texts[texts.length-1],time(state.duration));}const range=progress.querySelector('input[type="range"]');if(range){rememberNode(range);range.max=String(Math.round(state.duration*1000));range.value=String(Math.round(state.seconds*1000));range.setAttribute('aria-valuetext',time(state.seconds)+'/'+time(state.duration));}const visual=progress.querySelector('[data-testid="progress-bar"]');if(visual){rememberNode(visual);visual.style.setProperty('--progress-bar-transform',(state.duration?Math.min(100,state.seconds/state.duration*100):0)+'%');}}
            const volumeRange=Array.from(bar.querySelectorAll('input[type="range"]')).find(input=>!input.closest('.playback-bar'));if(volumeRange){rememberNode(volumeRange);volumeRange.value=String((state.muted?0:state.volume)/100);const visual=volumeRange.parentElement?.parentElement?.querySelector('[data-testid="progress-bar"]');if(visual){rememberNode(visual);visual.style.setProperty('--progress-bar-transform',(state.muted?0:state.volume)+'%');}}
            const repeatButton=bar.querySelector('[data-testid="control-button-repeat"]');if(repeatButton){rememberNode(repeatButton);repeatButton.setAttribute('aria-label','링크 음악 반복: '+repeat);repeatButton.style.color=repeat==='off'?'':'#1ed760';}
            if(queueSource===view?.uri)for(const play of document.querySelectorAll('button[data-encore-id="buttonPrimary"]')){if(play.closest('[data-testid="now-playing-bar"]')||!(play.getAttribute('aria-label')||'').startsWith(view.name+' '))continue;rememberNode(play);play.setAttribute('aria-label',view.name+(playing?' 일시 정지하기':' 재생하기'));const svg=play.querySelector('svg');if(svg&&play.dataset.youtubeState!==(playing?'playing':'paused')){rememberNode(svg);svg.setAttribute('viewBox','0 0 16 16');svg.innerHTML=playing?'<path d="M3 2h4v12H3zM9 2h4v12H9z"/>':'<path d="M4 2v12l10-6z"/>';play.dataset.youtubeState=playing?'playing':'paused';}}
        }
        function isIvLyricsMicrophone(target){if(!target?.matches('.ivlyrics-playbar-control'))return false;const label=target._tippy?.props?.content||target.getAttribute('aria-label')||target.getAttribute('title');if(typeof label==='string'&&label.trim())return label===(globalThis.I18n?.t?.('playbarButton.label')||'Lyrics Plus')||label==='Lyrics Plus';return !target.matches('.ivlyrics-fullscreen-btn');}
        function click(event){const target=event.target.closest?.('button');if(active&&isIvLyricsMicrophone(target)){event.preventDefault();event.stopImmediatePropagation();ivLyrics.open();return;}if(view?.mixed?.length&&!viewBypass&&mixedGrid?.isConnected&&target?.matches('[data-encore-id="buttonPrimary"]')&&!target.closest('[data-testid="now-playing-bar"]')&&(target.closest('main [data-testid="action-bar-row"]')||(target.getAttribute('aria-label')||'').startsWith(view.name+' '))){event.preventDefault();event.stopImmediatePropagation();try{togglePlaylistPlayback();}catch(error){notify(error.message,true);}return;}
            if(!active&&kind!=='spotify')return;const anchor=event.target.closest?.('a');if(active&&anchor?.closest('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]')){event.preventDefault();event.stopImmediatePropagation();open();return;}const bar=target?.closest('[data-testid="now-playing-bar"]');if(!bar)return;const id=target.dataset.testid;let action;
            if(id==='control-button-playpause'&&active)action=toggle;
            else if(id==='control-button-skip-forward')action=()=>advance(1);
            else if(id==='control-button-skip-back')action=()=>advance(-1);
            else if(id==='control-button-repeat')action=()=>{repeat=repeat==='off'?'all':repeat==='all'?'one':'off';notify('링크 음악 반복: '+repeat);};
            else if(id==='volume-bar-toggle-mute-button'&&active)action=()=>send('mute',{muted:!state.muted});
            else if(target.getAttribute('aria-label')?.includes('셔플'))action=()=>{shuffle=!shuffle;notify('링크 음악 셔플 '+(shuffle?'켜짐':'꺼짐'));};
            else if(id==='cover-art-button')action=open;
            else if(id==='lyrics-button'&&active)action=()=>ivLyrics.open();
            else if(id==='control-button-queue'&&(active||kind==='spotify'))action=showQueue;
            else if(active&&target.closest('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]'))action=()=>{open();};
            else if(active&&/기기에 연결|Connect to a device/i.test(target.getAttribute('aria-label')||''))action=()=>notify('YouTube 링크 음악은 현재 PC에서 재생됩니다.');
            if(action){event.preventDefault();event.stopImmediatePropagation();action();updateBar();}
        }
        document.addEventListener('click',click,true);listeners.push(()=>document.removeEventListener('click',click,true));
        function contextMenu(event){if(!active||!event.target.closest?.('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]'))return;event.preventDefault();event.stopImmediatePropagation();const item=queue[queueIndex];const content=el('div',undefined,'display:flex;gap:8px');content.append(button('제목 복사',()=>Spicetify.Platform.ClipboardAPI.copy(item.title)),button('YouTube 링크 복사',()=>Spicetify.Platform.ClipboardAPI.copy('https://www.youtube.com/watch?v='+item.videoId)));Spicetify.PopupModal.display({title:'YouTube 링크 음악',content});}
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
        for(const[name,handler]of Object.entries({togglePlay:toggle,pause:()=>send('pause'),next:()=>advance(1),back:()=>advance(-1),seek:ms=>send('seek',{seconds:Number(ms)/1000}),setVolume:volume=>send('volume',{volume:Number(volume)*100}),increaseVolume:()=>send('volume',{volume:state.volume+5}),decreaseVolume:()=>send('volume',{volume:state.volume-5}),toggleMute:()=>send('mute',{muted:!state.muted}),setMute:muted=>send('mute',{muted:!!muted}),setHeart:()=>notify('YouTube 영상은 링크 음악 목록에서 관리합니다.'),toggleHeart:()=>notify('YouTube 영상은 링크 음악 목록에서 관리합니다.')})){const original=Spicetify.Player[name];if(typeof original!=='function')continue;originals[name]=original;Spicetify.Player[name]=function(...args){return active||(kind==='spotify'&&['next','back'].includes(name))?handler(...args):original.apply(this,args);};}
        // Native Spotify items in the mixed queue use Spotify's own player. A
        // natural end advances the link queue; manual native song changes exit it.
        let lastNativeProgress=0;
        // A player page that failed to load (connection reset) never reports ready; reopen it, at most twice per track.
        let frameWaitStart=0,frameReloads=0,frameItem=null;
        function frameWatchdog(){const item=queue[queueIndex];if(item!==frameItem){frameItem=item;frameReloads=0;frameWaitStart=0;}if(!active||mediaMode==='direct'||item?.kind!=='youtube'||!frame.src||state.ready){frameWaitStart=0;return;}if(!frameWaitStart){frameWaitStart=Date.now();return;}if(Date.now()-frameWaitStart<10000||frameReloads>=2)return;frameReloads++;frameWaitStart=Date.now();frame.src=BASE+'/youtube/player?r='+Date.now()+'#session='+encodeURIComponent(session);}
        const timer=setInterval(()=>{if(disposed)return;markPlaying();frameWatchdog();if(active){if(Date.now()<=nativeTransitionUntil&&Spicetify.Player.isPlaying())originals.pause.call(Spicetify.Player);else if(Date.now()>nativeTransitionUntil&&Spicetify.Player.isPlaying()){lyricAbort?.abort();send('pause');streamRequest?.abort();mediaMode='youtube';audio.pause();audio.removeAttribute('src');audio.load();active=false;kind=null;playing=false;queue=[];queueIndex=-1;queueSource=null;baseline=null;ivLyrics.deactivate();restoreBar();restoreDock();return;}if(!panel.isConnected||!panel.parentElement?.isConnected||panel.parentElement===document.body&&document.getElementById('Desktop_PanelContainer_Id'))open();updateBar();return;}if(kind==='spotify'&&queue[queueIndex]){const current=Spicetify.Player.data;const uri=current?.item?.uri;if(uri!==queue[queueIndex].uri){if(Date.now()<nativeTransitionUntil)return;if(lastNativeDuration>0&&lastNativeProgress>=lastNativeDuration-2500)advance(1);else{kind=null;queue=[];queueIndex=-1;queueSource=null;}lastNativeProgress=0;}else{lastNativeProgress=Spicetify.Player.getProgress();lastNativeDuration=Spicetify.Player.getDuration();playing=Spicetify.Player.isPlaying();renderStatus();if(current?.isPaused&&lastNativeDuration>0&&lastNativeProgress>=lastNativeDuration-1000)advance(0);}}},500);
        async function testLyrics(searchTitle,searchArtist){const item=queue[queueIndex];if(item?.kind!=='youtube')throw new Error('YouTube 곡을 먼저 선택하세요.');const title=typeof searchTitle==='string'?searchTitle:prompt('가사 검색용 곡명',item.title)||'';if(!title)return;const artist=typeof searchArtist==='string'?searchArtist:prompt('가사 검색용 원곡 가수',item.artist)||'';lyricBox.textContent='가사 자료 조회 중…';
            lyricAbort?.abort();const controller=new AbortController();lyricAbort=controller;const timeout=setTimeout(()=>controller.abort(),24000);
            try {
            const url='https://lrclib.net/api/search?track_name='+encodeURIComponent(title)+'&artist_name='+encodeURIComponent(artist);const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error('가사 제공 서버 응답: '+response.status);const results=await response.json();const result=results.find(r=>r.syncedLyrics)||results.find(r=>r.plainLyrics);if(!result){lyricBox.textContent='해당 제목과 가수로 원문 가사를 찾지 못했습니다.';return;}
            lyrics=(result.syncedLyrics||result.plainLyrics||'').split('\n').map(line=>{const m=line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);return{time:m?Number(m[1])*60+Number(m[2]):null,text:(m?m[3]:line).trim()};}).filter(l=>l.text);
            const data={title,artist,text:lyrics.map(l=>l.text).join('\n'),automatic_fallback:false};
            const read=await fetch(BASE+'/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Hangul-Lyrics-Client':'ivlyrics'},body:JSON.stringify(data),signal:controller.signal});lyricsResult=await read.json();renderLyric();
            } finally {clearTimeout(timeout);if(lyricAbort===controller)lyricAbort=null;}
        }
        function renderLyric(){if(!lyrics.length)return;const index=lyrics.findLastIndex(l=>l.time!==null&&l.time<=state.seconds);const phonetic=lyricsResult?.phonetic||[];if(lyrics.every(l=>l.time===null)){lyricBox.textContent=lyrics.map((l,i)=>l.text+(phonetic[i]?'\n'+phonetic[i]:'')).join('\n\n');return;}const at=Math.max(0,index);lyricBox.textContent='원곡 기준 시간이며 커버 영상과 다를 수 있습니다.\n'+lyrics[at].text+'\n'+(phonetic[at]||lyricsResult?.error||'');}
        const addHere=()=>{if(view?.tracks)addDialog();else open();};
        const menu=new Spicetify.Menu.Item('플레이리스트에 YouTube 추가',false,addHere);menu.register();
        function localLists(){const content=el('div',undefined,'display:grid;gap:8px');for(const p of data.playlists.filter(p=>p.local))content.append(button(p.name,()=>{Spicetify.PopupModal.hide();Spicetify.Platform.History.push('/spotify-hangul-links/'+p.id);}));if(!content.children.length)content.append(el('p','가져온 로컬 목록이 없습니다.'));content.append(button('파일에서 가져오기',()=>library.openPicker()));Spicetify.PopupModal.display({title:'로컬 혼합 플레이리스트',content});}
        const importMenu=new Spicetify.Menu.Item('혼합 플레이리스트 가져오기',false,()=>library.openPicker());importMenu.register();const localMenu=new Spicetify.Menu.Item('로컬 혼합 플레이리스트',false,localLists);localMenu.register();
        const playbackMenu=new Spicetify.Menu.Item('YouTube 재생 방식',false,()=>{const content=el('div',undefined,'display:grid;gap:12px');content.append(el('p','음원 재생은 공개 오디오를 사용합니다. YouTube 영상에는 광고가 나올 수 있으며, Spotify 로그인과 별도입니다.'),button('음원 재생',()=>{setPlaybackMode('audio');Spicetify.PopupModal.hide();}),button('YouTube 영상',()=>{setPlaybackMode('video');Spicetify.PopupModal.hide();}));Spicetify.PopupModal.display({title:'YouTube 재생 방식',content});});playbackMenu.register();
        const top=new Spicetify.Topbar.Button('플레이리스트에 YouTube 추가','<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l12-7z"/></svg>',addHere);
        render();
        window.SpotifyHangulLinks={open,start,addYoutube,addCurrent,importCurrentPlaylist,stop,testLyrics,refreshView,startView,addDialog,currentTrack:()=>ivLyrics.currentTrack(),openLyrics:()=>ivLyrics.open(),editLyricInfo,setPlaybackMode,exportPlaylist:()=>library.exportCurrent(),importPlaylistFile:file=>library.importFile(file),localLists,playbackState:()=>({active,playing,kind,state:{seconds:state.seconds,duration:state.duration}}),selectPlaylist(id){if(!data.playlists.some(p=>p.id===id))throw new Error('재생목록이 없습니다.');selected=id;render();},pause:()=>send('pause'),play:()=>send('play'),next:()=>advance(1),previous:()=>advance(-1),seek:seconds=>send('seek',{seconds}),
            snapshot:()=>({active,kind,mediaMode,preferredMode,queueIndex,queueSource,playing,state:{...state},error:lastError,repeat,shuffle,selected,view:view?{uri:view.uri,nativeCount:view.tracks?.length,mixedCount:view.mixed?.length,error:view.error,bypass:viewBypass}:null,lyricsCount:lyrics.length,readingCoverage:lyricsResult?.coverage,readingError:lyricsResult?.error,lyricDisplay:lyricBox.textContent,playlists:JSON.parse(JSON.stringify(data.playlists))}),
            dispose(){if(disposed)return;stop();desktopBridge?.dispose();overlay?.dispose();library.dispose();ivLyrics.dispose();disposed=true;viewEpoch++;clearTimeout(viewTimer);viewObserver.disconnect();unlisten?.();clearView();viewStyle.remove();clearInterval(timer);for(const fn of listeners)fn();for(const[name,original]of Object.entries(originals))Spicetify.Player[name]=original;menu.deregister();importMenu.deregister();localMenu.deregister();playbackMenu.deregister();top.element?.remove();nowPlaying.dispose();nowPlayingStyle?.remove();panel.remove();delete window.SpotifyHangulLinks;}};
        desktopBridge=window.SpotifyHangulDesktopBridge.create(window);
        overlay=window.SpotifyHangulOverlayControls.create(window);
    };
    init();
})();
})();
