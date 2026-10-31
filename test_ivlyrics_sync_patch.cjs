/** @file test_ivlyrics_sync_patch.cjs
 * @brief Exercise the patched upstream identity and backup contracts against the pinned source.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const root = process.env.IVLYRICS_SOURCE_DIR;
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const extract = (text, start, end) => {
 const first=text.indexOf(start),last=text.indexOf(end,first);
 assert.ok(first>=0&&last>first, 'Upstream contract anchors exist');
 return text.slice(first,last);
};
test('actual offset backup retains large recording-specific values and validates YouTube keys', {skip:!root}, () => {
 const index=source('index.js');
 const context=vm.createContext({console});
 vm.runInContext('const MAX_TRACK_SYNC_OFFSET=60000;'+extract(index,'const normalizeTrackSyncOffsets =','const trackSyncOffsetsMatchNormalized =')+'\nthis.normalize=normalizeTrackSyncOffsets;',context);
 vm.runInContext(`this.result=normalize({'spotify:track:example':45000,'youtube:video:UWa_OiXDiQA':-5300});`,context);
 assert.equal(context.result['spotify:track:example'],45000);
 assert.equal(context.result['youtube:video:UWa_OiXDiQA'],-5300);
 for(const uri of ['youtube:video:x','youtube:video:UWa_OiXDiQA/extra','https://youtube.com/watch?v=UWa_OiXDiQA'])
  assert.throws(()=>vm.runInContext(`normalize({${JSON.stringify(uri)}:1000})`,context));
 vm.runInContext(`this.filtered=normalize({'youtube:video:UWa_OiXDiQA':53000,'bad':5},{ignoreInvalidEntries:true});`,context);
 assert.equal(context.filtered['youtube:video:UWa_OiXDiQA'],53000);
 assert.equal(context.filtered.bad,undefined);
});
test('actual lyric page reads the virtual recording rather than the paused native track', {skip:!root},()=>{
 const text=source('Pages.js');
 const section=extract(text,'const getCurrentTrackUri =','const useTrackOffsetState =');
 const context=vm.createContext({window:{SpotifyHangulSyncController:{resolveTrack:()=>({uri:'youtube:video:UWa_OiXDiQA'})}},Spicetify:{Player:{data:{item:{uri:'spotify:track:previous'}}}}});
 vm.runInContext(section+'this.uri=getCurrentTrackUri();',context);
 assert.equal(context.uri,'youtube:video:UWa_OiXDiQA');
 context.window.SpotifyHangulSyncController.resolveTrack=()=>null;
 vm.runInContext('this.uri=getCurrentTrackUri();',context);
 assert.equal(context.uri,'spotify:track:previous');
});
test('actual lyric display clock advances late lyrics by the selected whole-track offset', {skip:!root},()=>{
 const section=extract(source('Pages.js'),'const getCurrentLyricsPlaybackPosition =','// Latest sync offsets');
 const context=vm.createContext({window:{Utils:{getSafePlayerProgress:()=>18240}},CONFIG:{visual:{delay:0}}});
 vm.runInContext(section+'this.position=getCurrentLyricsPlaybackPosition(5300,0);',context);
 assert.equal(context.position,23540);
});
test('actual quick controls preserve the global ten-second bound separately from track sixty-second bounds', {skip:!root},()=>{
 const options=source('OptionsMenu.js');
 const section=extract(options,'const clampSyncOffset =','const formatSyncOffset =');
 const context=vm.createContext({});
 vm.runInContext(section+'this.track=clampSyncOffset(53000);this.global=clampGlobalSyncOffset(53000);',context);
 assert.equal(context.track,53000);assert.equal(context.global,10000);
 assert.match(options,/react\.createElement\(HangulTrackSyncEditor, \{ trackUri \}\)/);
 assert.match(options,/\[-1000, -100, "current", 100, 1000\]/);
});
const FORK_OVERLAY_URL='https://github.com/ForUltraplayer/ivLyrics-overlay/releases/latest';
test('actual overlay download button and wizard fallback open the fork release page', {skip:!root},()=>{
 const getter=extract(source('LyricsService.js'),'getDownloadUrl() {','async sendToEndpoint(');
 const context=vm.createContext({});
 vm.runInContext('const overlay={'+getter+'};this.url=overlay.getDownloadUrl();',context);
 assert.equal(context.url,FORK_OVERLAY_URL);
 const handler=extract(source('Settings.js'),'const handleDownload = () => {','const getStatusText');
 const opened=[];
 const settingsContext=vm.createContext({window:{OverlaySender:{getDownloadUrl:()=>''},open:(...args)=>opened.push(args)}});
 vm.runInContext(handler+'handleDownload();',settingsContext);
 assert.deepEqual(opened,[[FORK_OVERLAY_URL,'_blank']]);
 assert.ok(source('SetupWizard.js').includes('getDownloadUrl?.() || "'+FORK_OVERLAY_URL+'", "_blank", "noopener,noreferrer"'));
 for(const name of ['LyricsService.js','Settings.js','SetupWizard.js'])
  assert.ok(!source(name).includes('ivlis.kr/ivLyrics/extensions/#overlay'),name+' still points at the upstream overlay page');
});
test('overlay download transform leaves every other upstream link untouched', {skip:!root},()=>{
 const settings=source('Settings.js');
 assert.equal(settings.split('window.open("https://ivlis.kr/ivLyrics/extensions/#helper", "_blank")').length-1,4);
 assert.ok(settings.includes('https://api.github.com/repos/ivLis-Studio/ivLyrics/releases/latest'));
 assert.ok(settings.includes('window.open("https://github.com/ivLis-Studio/ivLyrics", "_blank")'));
 assert.ok(source('SetupWizard.js').includes('window.open("https://ivlis.kr/ivLyrics/extensions/#helper", "_blank")'));
 assert.ok(source('MarketplaceManager.js').includes('raw.githubusercontent.com/ivLis-Studio/ivLyrics/'));
 assert.ok(source('VideoHelperService.js').includes('https://ivlis.kr/ivLyrics/extensions/#helper'));
 assert.equal(source('LyricsService.js').split(FORK_OVERLAY_URL).length-1,1);
});
test('overlay download transform rewrites only its anchors and refuses a changed upstream', ()=>{
 const python=process.env.PYTHON||'python';
 const script=`
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(__dirname,'scripts'))})
import patch_ivlyrics_sync as p
helper = 'window.open("https://ivlis.kr/ivLyrics/extensions/#helper", "_blank");'
sources = {
 'LyricsService.js': "getDownloadUrl() {\\n return '" + p.UPSTREAM_OVERLAY_URL + "';\\n}",
 'Settings.js': "const url = window.OverlaySender?.getDownloadUrl?.() || '" + p.UPSTREAM_OVERLAY_URL + "';\\n" + helper,
 'SetupWizard.js': 'window.open(window.OverlaySender?.getDownloadUrl?.() || "' + p.UPSTREAM_OVERLAY_URL + '", "_blank");\\n' + helper,
}
out = {'ok': p.overlay_download_sources(sources), 'errors': {}}
for name in sources:
    for label, text in (('missing', sources[name].replace(p.UPSTREAM_OVERLAY_URL, 'https://example.invalid/')), ('duplicate', sources[name] + sources[name])):
        try:
            p.overlay_download_sources(dict(sources, **{name: text}))
            out['errors'][name + ':' + label] = None
        except ValueError as error:
            out['errors'][name + ':' + label] = str(error)
print(json.dumps(out))
`;
 const run=spawnSync(python,['-I','-c',script],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const {ok,errors}=JSON.parse(run.stdout);
 assert.ok(ok['LyricsService.js'].includes("return '"+FORK_OVERLAY_URL+"';"));
 assert.ok(ok['Settings.js'].includes("|| '"+FORK_OVERLAY_URL+"';"));
 assert.ok(ok['SetupWizard.js'].includes('|| "'+FORK_OVERLAY_URL+'"'));
 for(const name of ['Settings.js','SetupWizard.js'])
  assert.ok(ok[name].includes('window.open("https://ivlis.kr/ivLyrics/extensions/#helper", "_blank");'),name+' helper link changed');
 assert.equal(Object.keys(errors).length,6);
 for(const [key,message] of Object.entries(errors))
  assert.match(message||'',/^ivLyrics sync contract changed: .*overlay/,key);
});
test('actual video ad blocker keeps thumbnails of videos whose ID contains "ad"', {skip:!root}, ()=>{
 const block=extract(source('VideoBackgroundDepend.js'),'const blockedPatterns','const blockedUrlPattern');
 const patterns=new Function(block+';return blockedPatterns;')();
 const blocked=url=>patterns.some(pattern=>pattern.test(url));
 for(const url of ['https://i.ytimg.com/vi/MZNKiadMo3U/default.jpg','https://i.ytimg.com/vi/MZNKiadMo3U/hqdefault.jpg',
                   'https://i.ytimg.com/vi_webp/MZNKiadMo3U/default.webp','https://i.ytimg.com/vi/rKQptWhAvO0/default.jpg'])
  assert.equal(blocked(url),false,url);
 for(const url of ['https://i.ytimg.com/an_webp/ad/mqdefault.webp','https://googleads.g.doubleclick.net/pagead/id',
                   'https://www.youtube.com/api/stats/ads?ver=2','https://yt3.ggpht.com/ytc/ad123'])
  assert.equal(blocked(url),true,url);
});
test('actual overlay opener asks the helper only when enabled and disconnected, at most every 30 seconds', {skip:!root}, async()=>{
 const service=source('LyricsService.js');
 assert.ok(!service.includes('ivLyrics://overlay'),'dead URL scheme is gone');
 const section=extract(service,'_overlayLaunchRequestedAt: 0,','getDownloadUrl() {');
 const requests=[],timers=[];let clock=1000000,connected=false,checks=0,reply={ok:true};
 const context=vm.createContext({Date:{now:()=>clock},setTimeout:fn=>timers.push(fn),AbortSignal:{timeout:ms=>'timeout:'+ms},
  fetch:async(url,options)=>{requests.push([url,options]);if(reply instanceof Error)throw reply;return reply;}});
 vm.runInContext('this.overlay={enabled:false,isConnected:false,async checkConnection(){this.checks=(this.checks||0)+1;return this.connectedNow;},'+section+'};',context);
 const overlay=context.overlay;
 assert.equal(await overlay.openOverlayApp(),false,'setting off');
 overlay.enabled=true;overlay.isConnected=true;
 assert.equal(await overlay.openOverlayApp(),false,'already connected');
 assert.equal(requests.length,0);assert.equal(overlay.checks,undefined,'no probe while off or connected');
 overlay.isConnected=false;overlay.connectedNow=true;
 assert.equal(await overlay.openOverlayApp(),false,'probe finds a running overlay');
 assert.equal(requests.length,0);assert.equal(overlay.checks,1);
 clock+=30000;overlay.connectedNow=false;
 assert.equal(await overlay.openOverlayApp(),true);
 assert.deepEqual(JSON.parse(JSON.stringify(requests)),[['http://127.0.0.1:19643/overlay/launch',
  {method:'POST',headers:{'X-Hangul-Lyrics-Client':'ivlyrics'},credentials:'omit',signal:'timeout:3000'}]]);
 assert.equal(timers.length,1);timers[0]();assert.equal(overlay.checks,3,'connection is rechecked after the launch');
 clock+=29999;
 assert.equal(await overlay.openOverlayApp(),false,'throttled');assert.equal(requests.length,1);
 clock+=1;reply=new TypeError('Failed to fetch');
 assert.equal(await overlay.openOverlayApp(),false,'helper unreachable is silent');assert.equal(requests.length,2);
 clock+=30000;reply={ok:false,status:404};
 assert.equal(await overlay.openOverlayApp(),false,'overlay not installed is silent');assert.equal(timers.length,1);
});
test('actual lyrics page asks for the overlay when it mounts', {skip:!root}, ()=>{
 const mount=extract(source('index.js'),'componentDidMount() {','Prefetcher.setLyricsContainer(this);');
 assert.ok(mount.includes("document.body.classList.add('ivlyrics-page-active');\n    window.OverlaySender?.openOverlayApp?.();\n"));
 assert.equal(source('index.js').split('openOverlayApp').length-1,1);
});
test('overlay launch transform refuses a changed or duplicated upstream anchor', ()=>{
 const python=process.env.PYTHON||'python';
 const script=`
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(__dirname,'scripts'))})
import patch_ivlyrics_sync as p
sources = {'LyricsService.js': 'const OverlaySender = {\\n' + p.UPSTREAM_OPEN_OVERLAY + '\\n};',
           'index.js': "  componentDidMount() {\\n    document.body.classList.add('ivlyrics-page-active');\\n  }"}
ok = p.overlay_auto_launch(sources)
errors = {}
for name in sources:
    for label, text in (('missing', ''), ('duplicate', sources[name] + sources[name])):
        try:
            p.overlay_auto_launch(dict(sources, **{name: text}))
            errors[name + ':' + label] = None
        except ValueError as error:
            errors[name + ':' + label] = str(error)
print(json.dumps({'ok': ok, 'errors': errors}))
`;
 const run=spawnSync(python,['-I','-c',script],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const {ok,errors}=JSON.parse(run.stdout);
 assert.ok(ok['LyricsService.js'].includes("fetch('http://127.0.0.1:19643/overlay/launch'"));
 assert.ok(!ok['LyricsService.js'].includes('ivLyrics://'));
 assert.ok(ok['index.js'].includes('window.OverlaySender?.openOverlayApp?.();'));
 assert.equal(Object.keys(errors).length,4);
 for(const [key,message] of Object.entries(errors))
  assert.match(message||'',/^ivLyrics sync contract changed: .*overlay/,key);
});
test('actual update check never contacts upstream or offers its releases', {skip:!root}, async ()=>{
 const method=extract(source('Utils.js'),'async checkForUpdates() {','  compareVersions(a, b) {');
 const utils=vm.runInNewContext('({currentVersion:"7.0.16",'+method.trim().replace(/,\s*(\/\*\*[\s\S]*)?$/,'')+'})',{fetch:()=>{throw new Error('network used');},I18n:{t:k=>k},AbortController,setTimeout,clearTimeout});
 assert.deepEqual(JSON.parse(JSON.stringify(await utils.checkForUpdates())),{hasUpdate:false,currentVersion:'7.0.16',latestVersion:'7.0.16'});
});
test('update check transform refuses a changed or duplicated upstream anchor', ()=>{
 const python=process.env.PYTHON||'python';
 const script=`
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(__dirname,'scripts'))})
import patch_ivlyrics_sync as p
sources = {'Utils.js': 'const Utils = {\\n' + p.UPSTREAM_UPDATE_CHECK + '\\n  } catch (e) {}\\n  },\\n};'}
ok = p.managed_updates(sources)
errors = {}
for label, text in (('missing', ''), ('duplicate', sources['Utils.js'] * 2)):
    try:
        p.managed_updates({'Utils.js': text})
        errors[label] = None
    except ValueError as error:
        errors[label] = str(error)
print(json.dumps({'ok': ok, 'errors': errors}))
`;
 const run=spawnSync(python,['-I','-c',script],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const {ok,errors}=JSON.parse(run.stdout);
 assert.ok(ok['Utils.js'].includes('return { hasUpdate: false, currentVersion: this.currentVersion, latestVersion: this.currentVersion };'));
 for(const [key,message] of Object.entries(errors)) assert.match(message||'',/^ivLyrics sync contract changed: update check$/,key);
});
