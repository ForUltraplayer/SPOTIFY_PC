/** @file audit_playlists.cjs
 * @brief Audit private playlist metadata through the running Spotify lyric pipeline with checkpoints.
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const inventoryPath = process.argv[2] || path.join(root, 'work/playlist-audit/inventory.json');
const reportPath = process.argv[3] || path.join(root, 'work/playlist-audit/results.json');
const helper = process.argv[4] || 'http://127.0.0.1:19644';
const targetLimit = Number(process.argv[5] || 0);

function pageBootstrap(base) {
    const partText = part => part?.text || part?.syllables?.map(s => s.text || '').join('') || '';
    const textRows = line => {
        if (line?.vocals?.lead?.syllables?.length) {
            const parts = [line.vocals.lead, ...(line.vocals.background || []).filter(p => p.syllables?.length)]
                .map(partText).filter(Boolean);
            if (parts.length > 1) return parts;
        }
        return [String(line?.originalText || line?.text || '').trim()];
    };
    const bounded = (promise, milliseconds, message) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), milliseconds);
        promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
    window.__hangulAuditOne = async info => {
        const started = performance.now();
        const summary = { uri: info.uri, title: info.title, artist: info.artist, playlists: info.playlists };
        try {
            if (info.playable === false) return { ...summary, status: 'unavailable' };
            const raw = await bounded(LyricsAddonManager.getLyrics(info), 75000, 'lyrics-timeout');
            const lines = raw?.karaoke || raw?.synced || raw?.unsynced || [];
            if (!lines.length) return { ...summary, status: 'original-missing', error: raw?.error, milliseconds: Math.round(performance.now() - started) };
            const text = lines.flatMap(textRows).join('\n');
            const japaneseLines = text.split('\n').filter(s => /[\u3040-\u30ff]/.test(s)).length;
            summary.provider = raw.provider; summary.originalLines = lines.length;
            if (!japaneseLines) return { ...summary, status: 'non-japanese-or-unclassified', milliseconds: Math.round(performance.now() - started) };
            const lyricMilliseconds = Math.round(performance.now() - started);
            const response = await fetch(base + '/resolve', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hangul-Lyrics-Client': 'ivlyrics' },
                body: JSON.stringify({ title: info.title, artist: info.artist, text, track_id: info.trackId, foreground: false, automatic_fallback: true }),
                signal: AbortSignal.timeout(60000), credentials: 'omit'
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `helper-${response.status}`);
            const originalRows = text.split('\n');
            const targetRows = originalRows.map((s, i) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s) ? i : -1).filter(i => i >= 0);
            const present = targetRows.filter(i => /[가-힣]/.test(result.phonetic?.[i] || '') && !result.phonetic[i].includes('발음 자료 없음')).length;
            const lineContract = result.phonetic?.length === originalRows.length;
            return { ...summary, status: result.valid && lineContract && present >= targetRows.length * .85 ? 'readings-available' : 'reading-mismatch',
                authored: !!result.source_url, matched: result.matched, total: result.total, generated: result.generated_lines?.length || 0,
                readingRows: present, targetRows: targetRows.length, lineContract, source: result.source_url || '', cache: result.cache,
                lyricMilliseconds, milliseconds: Math.round(performance.now() - started) };
        } catch (error) {
            return { ...summary, status: 'error', error: error.message, milliseconds: Math.round(performance.now() - started) };
        }
    };
    return { ready: true, version: window.HangulLyricsProvider?.addon.version };
}

(async () => {
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8').replace(/^\uFEFF/, ''));
    const saved = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { startedAt: new Date().toISOString(), results: [] };
    const done = new Set(saved.results.map(r => r.uri));
    const pending = inventory.tracks.filter(t => !done.has(t.uri));
    const selected = targetLimit ? pending.slice(0, targetLimit) : pending;
    const pages = await (await fetch('http://127.0.0.1:9228/json/list')).json();
    const page = pages.find(p => p.type === 'page' && p.url.includes('xpui'));
    if (!page) throw new Error('Spotify diagnostic page is not available');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let counter = 0, aborted = false;
    const requests = new Map();
    socket.onmessage = event => {
        const message = JSON.parse(event.data), request = requests.get(message.id);
        if (!request) return;
        requests.delete(message.id); clearTimeout(request.timer);
        if (message.result?.exceptionDetails || message.error) request.reject(new Error(message.result?.exceptionDetails?.text || message.error?.message));
        else request.resolve(message.result?.result?.value);
    };
    socket.onclose = () => { aborted = true; for (const job of requests.values()) { clearTimeout(job.timer); job.reject(new Error('Spotify closed; checkpoint retained')); } requests.clear(); };
    const evaluate = expression => new Promise((resolve, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => { requests.delete(id); reject(new Error('Diagnostic response timeout')); }, 145000);
        requests.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    await evaluate(`(${pageBootstrap.toString()})(${JSON.stringify(helper)})`);
    let next = 0;
    const save = () => {
        saved.updatedAt = new Date().toISOString(); saved.totalInventory = inventory.tracks.length;
        saved.completed = saved.results.length; saved.complete = saved.completed === inventory.tracks.length;
        saved.counts = saved.results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
        fs.writeFileSync(reportPath + '.tmp', JSON.stringify(saved)); fs.renameSync(reportPath + '.tmp', reportPath);
    };
    await Promise.all([0, 1].map(async () => {
        while (!aborted && next < selected.length) {
            const info = selected[next++];
            const result = await evaluate(`window.__hangulAuditOne(${JSON.stringify(info)})`);
            saved.results.push(result); save();
            if (saved.completed % 10 === 0) console.log(JSON.stringify({ completed: saved.completed, total: saved.totalInventory, counts: saved.counts }));
        }
    }));
    await evaluate('delete window.__hangulAuditOne'); socket.close(); save();
    console.log(JSON.stringify({ complete: saved.complete, completed: saved.completed, counts: saved.counts }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
