# @file test_desktop_overlay_package.py
# @author: ForUltraplayer
# @brief Verify local overlay inclusion, immutable provenance and publication boundaries.
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from desktop_overlay_package import prepare_desktop_overlay


class DesktopOverlayPackageTests(unittest.TestCase):
    def setUp(self):
        self.area = tempfile.TemporaryDirectory(prefix='overlay-package-', dir=Path(__file__).resolve().parent.parent / 'work')
        self.addCleanup(self.area.cleanup)
        self.root = Path(self.area.name)
        self.inputs = self.root / 'work' / 'frozen-overlay'
        self.inputs.mkdir(parents=True)
        self.binary = self.inputs / 'lyrics-plus-overlay.exe'
        self.binary.write_bytes(b'MZ-overlay-fixture')
        self.archive = self.inputs / 'overlay-source.zip'
        binary_hash = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.item = {'version': '1.2.11', 'repository': 'ivLis-Studio/ivLyrics-overlay',
                     'source_revision': 'a'*40, 'local_binary': str(self.binary.relative_to(self.root)),
                     'local_source_archive': str(self.archive.relative_to(self.root)),
                     'sha256': binary_hash, 'bytes': self.binary.stat().st_size,
                     'delivery': 'local-candidate-only', 'license_status': 'upstream-license-unconfirmed'}
        self.write_archive()
        self.data = {'components': {'desktop_overlay': self.item}}
        self.release = {'public_release_ready': False}
        self.output = self.root / 'work' / 'candidate'
        self.payload = self.root / 'work' / 'payload'

    def write_archive(self, extra=False, provenance_hash=None, source_hash=None):
        source = b'// source fixture\n'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr('source/src/App.tsx', source)
            archive.writestr('source-manifest.json', json.dumps({'src/App.tsx': source_hash or hashlib.sha256(source).hexdigest()}))
            archive.writestr('provenance.json', json.dumps({'binary_sha256': provenance_hash or self.item['sha256'],
                                                          'upstream_revision': self.item['source_revision']}))
            archive.writestr('LOCAL-CANDIDATE-NOTICE.txt', 'Local unpublished candidate')
            if extra:
                archive.writestr('source/private-account.json', '{}')
        self.item['source_sha256'] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.item['source_bytes'] = self.archive.stat().st_size

    def prepare(self):
        return prepare_desktop_overlay(self.payload, self.output, self.data, self.release, self.root)

    def test_copies_exact_binary_and_sources_with_receipt(self):
        receipt = self.prepare()
        self.assertEqual((self.payload / 'desktop-overlay/lyrics-plus-overlay.exe').read_bytes(), self.binary.read_bytes())
        self.assertEqual((self.payload / 'third_party_sources/overlay-source.zip').read_bytes(), self.archive.read_bytes())
        self.assertEqual(receipt['sha256'], self.item['sha256'])
        self.assertFalse(receipt['autostart_added'])
        self.assertFalse(receipt['original_installation_modified'])
        self.assertEqual(receipt, json.loads((self.payload / 'desktop-overlay/receipt.json').read_text()))

    def test_component_absent_is_explicitly_optional(self):
        self.data['components'] = {}
        self.assertIsNone(self.prepare())
        self.assertFalse(self.payload.exists())

    def test_public_ready_rejected(self):
        self.release['public_release_ready'] = True
        with self.assertRaises(ValueError): self.prepare()

    def test_missing_public_ready_rejected(self):
        self.release.clear()
        with self.assertRaises(ValueError): self.prepare()

    def test_public_output_rejected(self):
        self.output = self.root / 'dist'
        with self.assertRaises(ValueError): self.prepare()

    def test_unfrozen_external_path_rejected(self):
        self.item['local_binary'] = '../elsewhere.exe'
        with self.assertRaises(ValueError): self.prepare()

    def test_changed_binary_rejected(self):
        self.binary.write_bytes(b'MZ-other-binary')
        with self.assertRaises(ValueError): self.prepare()

    def test_changed_source_archive_rejected(self):
        with self.archive.open('ab') as stream: stream.write(b'changed')
        with self.assertRaises(ValueError): self.prepare()

    def test_unassociated_binary_rejected(self):
        self.write_archive(provenance_hash='b'*64)
        with self.assertRaises(ValueError): self.prepare()

    def test_source_file_hash_required(self):
        self.write_archive(source_hash='c'*64)
        with self.assertRaises(ValueError): self.prepare()

    def test_extra_source_file_rejected(self):
        self.write_archive(extra=True)
        with self.assertRaises(ValueError): self.prepare()


if __name__ == '__main__':
    unittest.main()
