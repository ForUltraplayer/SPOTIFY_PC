/** @file check_translations.cjs
 * @brief Check the screen-text tables of the localized modules: every key has English and Korean with the same
 * %n placeholders, and no Hangul is left in the code outside the table (comments aside), so no Korean text is shown
 * to a reader in another language. usage: node scripts/check_translations.cjs [file...]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
// Modules whose screen text is localized. A module joins this list once its Korean text has moved into its table.
const LOCALIZED = ['extension-player.js', 'youtube-links.js', 'youtube-player.html', 'youtube-now-playing.js',
    'youtube-library.js', 'youtube-overlay-controls.js', 'hangul-lyrics.js', 'ivlyrics-sync.js', 'ivlyrics-sync-ui.js', 'youtube-ivlyrics.js'];
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

// The code with comments blanked (strings, template literals and regex literals kept), offsets unchanged.
function withoutComments(source, html) {
    let out = '', quote = null, regex = false, klass = false, last = '';
    for (let i = 0; i < source.length; i++) {
        const c = source[i], next = source[i + 1];
        if (quote) { out += c; if (c === '\\') { out += next ?? ''; i++; } else if (c === quote) quote = null; continue; }
        if (regex) { out += c; if (c === '\\') { out += next ?? ''; i++; } else if (c === '[') klass = true; else if (c === ']') klass = false; else if (c === '/' && !klass) regex = false; continue; }
        if (html && source.startsWith('<!--', i)) { const end = source.indexOf('-->', i); const stop = end < 0 ? source.length : end + 3; out += source.slice(i, stop).replace(/[^\n]/g, ' '); i = stop - 1; continue; }
        if (c === '/' && next === '/') { const end = source.indexOf('\n', i); const stop = end < 0 ? source.length : end; out += ' '.repeat(stop - i); i = stop - 1; continue; }
        if (c === '/' && next === '*') { const end = source.indexOf('*/', i + 2); const stop = end < 0 ? source.length : end + 2; out += source.slice(i, stop).replace(/[^\n]/g, ' '); i = stop - 1; continue; }
        if (c === '"' || c === "'" || c === '`') quote = c;
        // A slash starts a regex where a value cannot end: after an operator, a bracket or nothing.
        else if (c === '/' && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last))) regex = true;
        out += c;
        if (!/\s/.test(c)) last = c;
    }
    return out;
}

// Each text table: an object literal `const NAME = { en: {...}, ko: {...} }`, found by brace depth on the comment-free code.
function tableSpans(code) {
    return [...code.matchAll(/const (\w+)\s*=\s*\{(?=\s*en\s*:)/g)].map(match => ({ name: match[1], span: tableSpan(code, match.index + match[0].length - 1) }));
}
function tableSpan(code, start) {
    let depth = 0, quote = null;
    for (let i = start; i < code.length; i++) {
        const c = code[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '{') depth++;
        if (c === '}' && --depth === 0) return [start, i + 1];
    }
    return null;
}

function check(file) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const code = withoutComments(source, file.endsWith('.html'));
    const problems = [], tables = tableSpans(code);
    if (!tables.length || tables.some(table => !table.span)) return ['no complete `const NAME = { en: {...}, ko: {...} }` table'];
    const marks = text => [...String(text).matchAll(/%(\d)/g)].map(m => m[1]).sort().join(',');
    for (const { name, span } of tables) {
        const strings = vm.runInNewContext('(' + code.slice(span[0], span[1]) + ')');
        const en = strings.en || {}, ko = strings.ko || {};
        for (const key of Object.keys(en)) {
            if (!(key in ko)) problems.push(`${name}."${key}" has no Korean (ko)`);
            else if (marks(en[key]) !== marks(ko[key])) problems.push(`${name}."${key}" placeholders differ: en %${marks(en[key])} / ko %${marks(ko[key])}`);
            if (HANGUL.test(en[key])) problems.push(`${name}."${key}" English text has Hangul`);
        }
        for (const key of Object.keys(ko)) if (!(key in en)) problems.push(`${name}."${key}" has no English (en)`);
    }
    const inTable = position => tables.some(({ span }) => position >= span[0] && position < span[1]);
    const lines = code.split('\n');
    let offset = 0;
    lines.forEach((line, index) => {
        const begin = offset, end = offset + line.length; offset = end + 1;
        const outside = line.split('').filter((c, i) => !inTable(begin + i)).join('');
        if (HANGUL.test(outside)) problems.push(`line ${index + 1}: Hangul outside the table: ${outside.trim().slice(0, 100)}`);
    });
    return problems;
}

if (require.main === module) {
    const files = process.argv.length > 2 ? process.argv.slice(2) : LOCALIZED;
    let failed = 0;
    for (const file of files) {
        const problems = check(file);
        if (problems.length) { failed++; console.log(`${file}: ${problems.length} problem(s)`); for (const p of problems) console.log('  ' + p); }
        else console.log(`${file}: ok`);
    }
    process.exitCode = failed ? 1 : 0;
}
module.exports = { LOCALIZED, check, withoutComments };
