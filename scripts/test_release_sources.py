# @file test_release_sources.py
# @brief Ensure installer corresponding sources cannot lag behind validated application code.
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile
import prepare_release


class SourceArchiveTest(unittest.TestCase):
    def setUp(self):
        self.area = tempfile.TemporaryDirectory()
        self.addCleanup(self.area.cleanup)
        self.root = Path(self.area.name)
        self.content = {'main.py': b'print("source")\n', 'release.json': b'{"version":"0.7.0"}'}
        for name, body in self.content.items():
            (self.root / name).write_bytes(body)
        self.archive = self.root / 'candidate.zip'
        self.prefix = 'SpotifyHangul-0.7.0-source-preview/'
        self.root_patch = patch.object(prepare_release, 'ROOT', self.root)
        self.files_patch = patch.object(prepare_release, 'FILES', tuple(self.content))
        self.root_patch.start(); self.files_patch.start()
        self.addCleanup(self.root_patch.stop); self.addCleanup(self.files_patch.stop)

    def write_archive(self, content=None, manifest=None, extra=None):
        content = self.content if content is None else content
        manifest = manifest if manifest is not None else {name: hashlib.sha256(body).hexdigest() for name, body in self.content.items()}
        with zipfile.ZipFile(self.archive, 'w') as bundle:
            for name, body in content.items():
                bundle.writestr(self.prefix + name, body)
            bundle.writestr(self.prefix + 'manifest.json', json.dumps(manifest))
            if extra:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    bundle.writestr(extra, b'extra')

    def test_identical_archive_is_bound_to_current_source(self):
        self.write_archive()
        self.assertEqual(prepare_release.validate_source_archive(self.archive, '0.7.0'), hashlib.sha256(self.archive.read_bytes()).hexdigest())

    def test_checkout_change_rejects_stale_sources(self):
        self.write_archive()
        (self.root / 'main.py').write_bytes(b'changed\n')
        with self.assertRaisesRegex(ValueError, 'manifest differs'):
            prepare_release.validate_source_archive(self.archive, '0.7.0')

    def test_bytes_changed_under_unchanged_manifest_are_rejected(self):
        self.write_archive(content={**self.content, 'main.py': b'evil source!!!\n'})
        with self.assertRaisesRegex(ValueError, 'source bytes differ'):
            prepare_release.validate_source_archive(self.archive, '0.7.0')

    def test_extra_duplicate_and_missing_entries_are_rejected(self):
        for extra in (self.prefix + 'main.py', self.prefix + '../private.txt'):
            self.write_archive(extra=extra)
            with self.assertRaisesRegex(ValueError, 'unexpected, duplicate or missing'):
                prepare_release.validate_source_archive(self.archive, '0.7.0')
        self.write_archive(content={'main.py': self.content['main.py']})
        with self.assertRaises(ValueError):
            prepare_release.validate_source_archive(self.archive, '0.7.0')


if __name__ == '__main__':
    unittest.main()
