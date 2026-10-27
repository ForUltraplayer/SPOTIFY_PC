/** @file test_ivlyrics_sync_patch.cjs
 * @author: ForUltraplayer
 * @brief Exercise the patched upstream identity and backup contracts against the pinned source.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
