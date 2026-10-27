# @file test_playlist_files.py
# @author: ForUltraplayer
# @brief Verify full mixed-playlist snapshot validation and app-owned atomic exports.
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from playlist_files import FORMAT, MAX_BYTES, save_export, validate_document


def example():
    return {'format': FORMAT, 'schema': 1, 'exportedAt': '2026-10-27T00:00:00Z', 'playlist': {
        'name': '혼합 목록', 'sourceUri': 'spotify:playlist:5C3W78fpJbRdLpbr7kvAMe',
        'nativeTracks': [{'kind': 'spotify', 'uri': 'spotify:track:6x7SB38tuekpu4xpH9OIPY',
                          'title': '地球儀', 'artist': 'Kenshi Yonezu', 'duration': 273, 'entryKey': 'one',
                          'album': 'Album', 'image': 'spotify:image:ab67616d00004851ff04f64ce0d75dc523c8bbf7'}],
        'tracks': [{'kind': 'youtube', 'videoId': 'rKQptWhAvO0', 'title': 'Cover', 'artist': 'Singer',
                    'duration': 194, 'after': '', 'lyricTitle': '東京テディベア', 'lyricArtist': 'Neru'}],
        'order': ['yt:rKQptWhAvO0', 'sp:one']}}


class PlaylistFilesTests(unittest.TestCase):
    def test_export_preserves_both_sources_order_and_lyric_search(self):
        with tempfile.TemporaryDirectory() as area:
            result = save_export(example(), Path(area))
            path = Path(result['path'])
            self.assertTrue(path.parent.samefile(Path(area) / 'exports'))
            self.assertEqual(path.name, result['filename'])
            self.assertEqual(path.stat().st_size, result['bytes'])
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), example())
            self.assertEqual(list(path.parent.glob('*.tmp')), [])

    def test_filename_is_generated_and_previous_exports_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as area:
            value = example(); value['path'] = '../outside'; value['filename'] = 'private.json'
            first = save_export(value, area); second = save_export(value, area)
            self.assertNotEqual(first['path'], second['path'])
            self.assertTrue(Path(first['path']).is_file())
            self.assertFalse((Path(area) / 'private.json').exists())

    def test_unknown_fields_cannot_persist_stream_urls_or_tokens(self):
        value = example(); value['token'] = 'private'; value['playlist']['tracks'][0]['streamUrl'] = 'https://secret.googlevideo.com/private'
        value['playlist']['nativeTracks'][0]['authorization'] = 'private'
        self.assertNotIn('private', json.dumps(validate_document(value)))

    def test_urls_schema_counts_and_nonfinite_durations_are_rejected(self):
        invalid = []
        for mutate in [
            lambda d: d.update(schema=2),
            lambda d: d.update(schema=True),
            lambda d: d['playlist'].update(sourceUri='https://example.test'),
            lambda d: d['playlist']['nativeTracks'][0].update(image='http://127.0.0.1/private'),
            lambda d: d['playlist']['nativeTracks'][0].update(image='https://i.scdn.co.evil.test/x'),
            lambda d: d['playlist']['tracks'][0].update(videoId='not a video url'),
            lambda d: d['playlist']['tracks'][0].update(duration=float('nan')),
            lambda d: d['playlist']['tracks'][0].update(duration=True),
            lambda d: d['playlist'].update(tracks=[d['playlist']['tracks'][0]] * 2001),
        ]:
            value = example(); mutate(value); invalid.append(value)
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(ValueError): validate_document(value)

    def test_native_recording_duplicates_need_distinct_entry_keys(self):
        value = example(); duplicate = copy.deepcopy(value['playlist']['nativeTracks'][0]); duplicate['entryKey'] = 'two'
        value['playlist']['nativeTracks'].append(duplicate)
        self.assertEqual(validate_document(value)['playlist']['order'], ['yt:rKQptWhAvO0', 'sp:one', 'sp:two'])
        duplicate['entryKey'] = 'one'
        with self.assertRaises(ValueError): validate_document(value)

    def test_failed_replace_leaves_no_partial_export_or_temporary_files(self):
        with tempfile.TemporaryDirectory() as area:
            with patch('playlist_files.os.replace', side_effect=OSError('test failure')):
                with self.assertRaises(OSError): save_export(example(), area)
            self.assertEqual(list((Path(area) / 'exports').iterdir()), [])

    def test_invalid_document_is_rejected_before_directory_creation(self):
        with tempfile.TemporaryDirectory() as area:
            root = Path(area) / 'new-state'
            with self.assertRaises(ValueError): save_export({}, root)
            self.assertFalse(root.exists())

    def test_multibyte_limit_rejects_large_valid_field_arrays_before_saving(self):
        value = example()
        value['playlist']['nativeTracks'] = [{**value['playlist']['nativeTracks'][0], 'entryKey': str(i),
            'title': '日' * 300, 'artist': '歌' * 200, 'album': '曲' * 300} for i in range(2000)]
        with tempfile.TemporaryDirectory() as area:
            with self.assertRaises(ValueError): save_export(value, area)
            self.assertFalse((Path(area) / 'exports').exists())

    def test_export_folder_cannot_follow_a_link_outside_the_state_root(self):
        with tempfile.TemporaryDirectory() as area, tempfile.TemporaryDirectory() as other:
            try:
                os.symlink(other, Path(area) / 'exports', target_is_directory=True)
            except OSError:
                self.skipTest('Directory symlinks are unavailable in this environment')
            with self.assertRaises(ValueError): save_export(example(), area)
            self.assertEqual(list(Path(other).iterdir()), [])

    @unittest.skipUnless(os.name == 'nt', 'Windows path alias regression')
    def test_different_windows_spellings_of_the_same_directory_can_export(self):
        with tempfile.TemporaryDirectory() as area:
            root = Path(area).resolve()
            folder = root / 'exports'
            alias = Path('\\\\?\\' + str(folder))
            original_resolve = Path.resolve

            def asymmetric_resolve(path, *args, **kwargs):
                if path == folder:
                    return alias
                return original_resolve(path, *args, **kwargs)

            with patch.object(Path, 'resolve', asymmetric_resolve):
                result = save_export(example(), root)
            exported = Path(result['path'])
            self.assertNotEqual(alias.parent, root)
            self.assertTrue(alias.parent.samefile(root))
            self.assertEqual(exported.parent, alias)
            self.assertEqual(json.loads(exported.read_text(encoding='utf-8')), example())

    def test_a_resolved_folder_with_a_different_parent_identity_is_rejected(self):
        with tempfile.TemporaryDirectory() as area, tempfile.TemporaryDirectory() as outside:
            root = Path(area).resolve()
            escaped = Path(outside).resolve() / 'exports'
            escaped.mkdir()
            original_resolve = Path.resolve

            def escaped_resolve(path, *args, **kwargs):
                if path == root / 'exports':
                    return escaped
                return original_resolve(path, *args, **kwargs)

            with patch.object(Path, 'resolve', escaped_resolve):
                with self.assertRaises(ValueError): save_export(example(), root)
            self.assertEqual(list(escaped.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
