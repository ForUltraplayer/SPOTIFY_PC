/** @file test_translations.cjs
 * @brief Every localized module has English and Korean for each of its screen texts and no Korean text outside its table.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LOCALIZED, check, withoutComments } = require('./scripts/check_translations.cjs');

for (const file of LOCALIZED) test(file + ' shows no text that is not in its translation table', () => assert.deepEqual(check(file), []));

test('the checker keeps strings and regexes while blanking comments', () => {
    const code = withoutComments("const a = 'x // y'; // 주석\nconst b = /a\\/b/; /* 블록 */ const c = `t`;", false);
    assert.ok(code.includes("'x // y'")); assert.ok(code.includes('/a\\/b/')); assert.ok(!/[가-힣]/.test(code)); assert.ok(code.includes('`t`'));
});
