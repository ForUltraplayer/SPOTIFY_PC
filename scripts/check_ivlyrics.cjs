/** @file check_ivlyrics.cjs
 * @author: ForUltraplayer
 * @brief Exercise the actual upstream LyricsPlus parser and check Hangul integration contracts.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.argv[2];
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
for (const name of ['index.js', 'OptionsMenu.js', 'Pages.js', 'LyricsService.js', 'AIAddonManager.js', 'LyricsAddonManager.js', 'Addon_Lyrics_LyricsPlus.js']) {
    new vm.Script(source(name), { filename: name });
}
for (const method of ['getTranslation', 'setTranslation', 'getTranslationCacheId']) {
    assert.match(source('LyricsService.js'), new RegExp('\\b' + method + '\\s*\\('), 'Missing cache contract: '+method);
}
for (const method of ['getSafePlayerProgress', 'getPlayerPlaybackSnapshot', 'resolveStablePlaybackTrack', 'getCurrentTrackInfo', 'getLyricsFromProviders']) {
    assert.match(source('LyricsService.js'), new RegExp('\\b' + method + '\\s*\\('), 'Missing link-player lyrics contract: '+method);
}
assert.match(source('index.js'), /window\.lyricContainer\s*=\s*this/, 'Missing mounted lyrics-container contract');
assert.match(source('index.js'), /schedulePlaybackTrackResolution\s*\(/, 'Missing lyrics track-transition contract');
assert.match(source('AIAddonManager.js'), /\bregister\s*\(addon\)/);
const window = { LyricsAddonManager: { register(addon) { window.provider = addon; } } };
const context = { window, console, URL, atob, setTimeout() { throw Error('Unexpected registration wait'); } };
vm.runInNewContext(source('Addon_Lyrics_LyricsPlus.js'), context, { timeout: 5000 });
assert.equal(typeof window.provider.getLyrics, 'function');
for (const method of ['parseLyricsPayload', 'resolveTrackIsrc', 'buildLyricsUrl']) {
    assert.equal(typeof window.__ivLyricsPlusDebug?.[method], 'function', 'Missing parser contract: '+method);
}
const parsed = window.__ivLyricsPlusDebug.parseLyricsPayload({ type: 'Line', lyrics: [
    { text: '合成の空', time: 1000, duration: 2000 }, { text: 'テストの声', time: 4000, duration: 2000 }
] }, 7000);
assert.equal(parsed.synced.length, 2);
assert.equal(parsed.synced[0].text, '合成の空');
assert.equal(parsed.synced[1].startTime, 4000);
console.log('ivLyrics syntax, cache contracts and actual parser smoke passed');
