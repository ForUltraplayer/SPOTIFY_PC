# @file desktop_overlay_package.py
# @author: ForUltraplayer
# @brief Preserve and package the existing desktop overlay for a private local installer candidate.
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
NOTICE = '''Existing ivLyrics desktop overlay, local candidate only

Upstream: https://github.com/ivLis-Studio/ivLyrics-overlay
Upstream desktop source revision: a7f9a0ae71b3ab792b34493aa0084882c93fa620
Version: 1.2.11 with the existing local playback controls and appearance fixes.

This is the existing Tauri desktop overlay, not the independent WPF prototype.
The upstream repository did not declare a redistribution license when inspected.
This local candidate does not establish permission to publish that component.
Public redistribution remains pending a confirmed license or author permission.

The frozen corresponding source, local changes, file hashes and provenance are
included in third_party_sources. User settings, accounts and lyric data are not.
The original updater remains part of this unchanged executable. Manually applying
an upstream overlay update can replace the local playback/appearance fixes.
Windows WebView2 Runtime is required by the original Tauri application.
'''


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def owned_input(root, relative):
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root / 'work') or not path.is_file() or path.is_symlink():
        raise ValueError('Overlay inputs must be frozen project-local work files')
    return path


def prepare_desktop_overlay(payload, output_dir, data, release, root=ROOT):
    """Copy immutable local inputs without touching the original installation."""
    item = data['components'].get('desktop_overlay')
    if not item:
        return None
    root = Path(root).resolve()
    output_dir = Path(output_dir).resolve()
    if (release.get('public_release_ready') is not False
            or item.get('delivery') != 'local-candidate-only'
            or item.get('license_status') != 'upstream-license-unconfirmed'
            or not output_dir.is_relative_to(root / 'work')):
        raise ValueError('Existing overlay is restricted to an unpublished local candidate under work')
    executable = owned_input(root, item['local_binary'])
    sources = owned_input(root, item['local_source_archive'])
    for path, prefix in ((executable, ''), (sources, 'source_')):
        if path.stat().st_size != item[prefix+'bytes'] or digest(path) != item[prefix+'sha256']:
            raise ValueError('Frozen desktop overlay input changed: '+path.name)
    with zipfile.ZipFile(sources) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or 'provenance.json' not in names or 'source-manifest.json' not in names:
            raise ValueError('Desktop overlay source provenance is missing')
        provenance = json.loads(archive.read('provenance.json'))
        if provenance.get('binary_sha256') != item['sha256'] or provenance.get('upstream_revision') != item['source_revision']:
            raise ValueError('Desktop overlay binary and source provenance differ')
        manifest = json.loads(archive.read('source-manifest.json'))
        expected = {'source/'+name for name in manifest} | {'source-manifest.json', 'provenance.json', 'LOCAL-CANDIDATE-NOTICE.txt'}
        if set(names) != expected:
            raise ValueError('Unexpected desktop overlay source entries')
        for name, expected_hash in manifest.items():
            if (Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name
                    or any(part in {'.git', 'node_modules', 'target', '__pycache__'} for part in Path(name).parts)):
                raise ValueError('Unsafe desktop overlay source path')
            if hashlib.sha256(archive.read('source/'+name)).hexdigest() != expected_hash:
                raise ValueError('Desktop overlay source hash mismatch: '+name)
    target = Path(payload) / 'desktop-overlay'
    target.mkdir(parents=True)
    shutil.copy2(executable, target / 'lyrics-plus-overlay.exe')
    receipt = {
        'app': 'SpotifyHangulDesktopOverlay', 'version': item['version'],
        'sha256': item['sha256'], 'bytes': item['bytes'],
        'upstream': item['repository'], 'upstream_revision': item['source_revision'],
        'source_archive': sources.name, 'source_sha256': item['source_sha256'],
        'license_status': item['license_status'], 'delivery': item['delivery'],
        'settings_identifier': 'com.ivlis.lyrics-plus-overlay',
        'autostart_added': False, 'original_installation_modified': False,
    }
    (target / 'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    (target / 'LOCAL-CANDIDATE-NOTICE.txt').write_text(NOTICE, encoding='utf-8')
    source_target = Path(payload) / 'third_party_sources'
    source_target.mkdir(exist_ok=True)
    shutil.copy2(sources, source_target / sources.name)
    return receipt
