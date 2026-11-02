# @file test_auto_draft.py
# @brief Check the automatic draft's candidate choice, version bump and release notes without network or Git.
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import auto_draft
from dependencies import ROOT

FILES = ('bridge.py', 'hangul-lyrics.js', 'release.json', 'README.md', 'README.en.md')


class AutoDraftTest(unittest.TestCase):
    def setUp(self):
        self.area = Path(tempfile.mkdtemp())
        for name in FILES: shutil.copyfile(ROOT / name, self.area / name)
        self.root = patch.object(auto_draft, 'ROOT', self.area)
        self.root.start()
        self.old = __import__('json').loads((ROOT / 'release.json').read_text(encoding='utf-8'))['version']

    def tearDown(self):
        self.root.stop()
        shutil.rmtree(self.area)

    def read(self, name):
        return (self.area / name).read_bytes().decode('utf-8')

    def test_candidates_keep_stageable_newer_releases_with_their_tag(self):
        status = {'components': [
            {'component': 'ivlyrics', 'status': 'candidate', 'latest': '7.0.19', 'url': 'https://github.com/a/b/releases/tag/v7.0.19'},
            {'component': 'spicetify', 'status': 'current', 'latest': '2.46.4', 'url': 'https://github.com/c/d/releases/tag/v2.46.4'},
            {'component': 'node', 'status': 'candidate', 'latest': '26.13.0', 'url': 'https://github.com/nodejs/node/releases/tag/v26.13.0'},
            {'component': 'spotify', 'status': 'candidate', 'bytes': 1}]}
        self.assertEqual([('ivlyrics', 'v7.0.19', '7.0.19')], auto_draft.candidates(status))

    def test_bump_moves_every_version_but_keeps_history(self):
        before = {name: self.read(name) for name in FILES}
        auto_draft.bump(self.old, '9.9.9', ['ivLyrics 7.0.19'])
        self.assertIn('VERSION = "9.9.9"', self.read('bridge.py'))
        self.assertIn("version: '9.9.9',", self.read('hangul-lyrics.js'))
        self.assertEqual(2, self.read('release.json').count('"9.9.9"'))
        for name in ('README.md', 'README.en.md'):
            text = self.read(name)
            self.assertIn('/tag/v9.9.9', text)
            self.assertIn('SpotifyHangul-9.9.9-Setup.exe', text)
            self.assertNotIn('SpotifyHangul-'+self.old+'-Setup.exe', text)
            # History entries and "from x.y.z" sentences still name the version that shipped them.
            self.assertEqual(before[name].count('- '+self.old+': '), text.count('- '+self.old+': '))
            history = [row for row in text.split('\n') if row.startswith('- ') and ': ' in row and row[2].isdigit()]
            self.assertEqual('- 9.9.9: ivLyrics 7.0.19'+(' 적용' if name == 'README.md' else ''), history[-1].rstrip('\r'))
            self.assertEqual('\r\n' in before[name], '\r\n' in text)

    def test_bump_stops_when_a_file_changed_shape(self):
        (self.area / 'README.en.md').write_text('no version here', encoding='utf-8')
        with self.assertRaises(ValueError): auto_draft.bump(self.old, '9.9.9', ['ivLyrics 7.0.19'])

    def test_notes_carry_install_and_known_issues_to_the_new_setup(self):
        previous = ('### 변경 사항\r\n\r\n- old change\r\n\r\n### 설치와 업데이트\r\n\r\n- run `SpotifyHangul-0.7.11-Setup.exe`\r\n\r\n'
                    '### 알려진 문제\r\n\r\n- unsigned\r\n\r\n### English\r\n\r\n- old.\r\n\r\n**Install:** run `SpotifyHangul-0.7.11-Setup.exe`.\r\n')
        text = auto_draft.notes('0.7.11', '0.7.12', [('ivlyrics', 'v7.0.19', '7.0.19')], previous)
        self.assertIn('- ivLyrics 7.0.19 적용 ([원본 릴리스](https://github.com/ivLis-Studio/ivLyrics/releases/tag/v7.0.19))', text)
        self.assertIn('- run `SpotifyHangul-0.7.12-Setup.exe`', text)
        self.assertIn('- unsigned', text)
        self.assertIn('- ivLyrics 7.0.19.\n\n**Install:** run `SpotifyHangul-0.7.12-Setup.exe`.', text)
        self.assertNotIn('old change', text)
        self.assertNotIn('0.7.11', text)


if __name__ == '__main__':
    unittest.main()
