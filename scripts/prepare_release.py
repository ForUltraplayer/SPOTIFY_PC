# @file prepare_release.py
# @author: ForUltraplayer
# @brief Build a source-preview archive from an explicit public-file allowlist.
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    'README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'release.json', 'requirements.txt', 'components.json',
    'bridge.py', 'youtube_stream.py', 'playlist_files.py', 'playback_control.py', 'phonetics.py', 'hangul-lyrics.js', 'youtube-links.js', 'youtube-ivlyrics.js', 'youtube-library.js', 'youtube-overlay-controls.js', 'youtube-desktop-bridge.js', 'youtube-player.html', 'start.ps1', 'stop.ps1', 'auto-update.ps1',
    'test_bridge.py', 'test_extension.cjs', 'test_playlist_files.py', 'test_youtube_stream.py', 'test_playback_control.py', 'test_playback_http.py', 'test_youtube_library.cjs', 'test_youtube_overlay.cjs', 'test_youtube_ivlyrics.cjs', 'test_youtube_navigation.cjs', 'test_youtube_desktop.cjs', 'scripts/prepare_release.py',
    'docs/RELEASE.md', 'docs/OPERATIONS.md', 'docs/VERIFICATION.md', 'docs/LICENSE_REVIEW.md',
    'docs/SPOTX_INTEGRATION.md', 'docs/YOUTUBE_LINKS.md', 'scripts/start_youtube_dev.ps1',
    'licenses/ivLyrics-LGPL-2.1.txt',
    'licenses/Kuromoji-Apache-2.0.txt', 'licenses/Kuromoji-IPADIC-NOTICE.md',
    'android/README.md', 'android/PLAN.md', 'android/LICENSE', 'android/upstream.json',
    'android/patches/myspoti-hangul.patch',
    'scripts/fetch_distribution_inputs.py', 'scripts/build_installer.py', 'scripts/audit_playlists.cjs',
    'scripts/test_installer.ps1', 'scripts/test_bootstrap.ps1', 'scripts/test_auto_update.ps1', '.gitattributes',
    'installer/integrate.ps1', 'installer/setup.nsi',
    'installer/update-launcher.nsi',
    'installer/bootstrap.ps1', 'installer/spotx-patch.ps1', 'scripts/build_spotx_adapter.py',
    'third_party/spotx/upstream-run.ps1', 'third_party/spotx/patches.json', 'third_party/spotx/en.ps1',
    'third_party/spotx/LICENSE', 'third_party/spotx/upstream.json',
    'third_party/spotx/patch-functions.ps1', 'third_party/spotx/patch-calls.ps1',
    'installer/managed-ivlyrics.ps1', 'scripts/dependencies.py', 'scripts/check_compatibility.py',
    'scripts/check_ivlyrics.cjs', 'scripts/upstream_updates.py', 'scripts/test_dependencies.py',
    'ivlyrics-sync.js', 'ivlyrics-sync-ui.js', 'test_ivlyrics_sync.cjs', 'test_ivlyrics_sync_ui.cjs',
    'test_ivlyrics_sync_patch.cjs', 'scripts/patch_ivlyrics_sync.py',
    'scripts/test_release_sources.py', 'docs/DISTRIBUTION_PLAN.md',
    'tests/ui/package.json', 'tests/ui/package-lock.json',
    'scripts/test_start.ps1',
    'scripts/youtube_toolchain.py',
    'installer/desktop-overlay.ps1', 'scripts/test_desktop_overlay.ps1',
    'installer/payload-transaction.ps1', 'scripts/test_payload_transaction.ps1', 'scripts/test_upgrade_matrix.ps1',
    'youtube-now-playing.js', 'youtube-now-playing.css', 'test_youtube_now_playing.cjs',
    'scripts/test_managed_ivlyrics.ps1', '.github/workflows/dependencies.yml', 'docs/DEPENDENCIES.md',
)


def validate_source_archive(archive, version):
    """Bind shipped corresponding sources to the exact checkout being packaged."""
    prefix = f'SpotifyHangul-{version}-source-preview/'
    expected = {name: (ROOT / name).read_bytes() for name in FILES}
    expected_names = {prefix + name for name in expected} | {prefix + 'manifest.json'}
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or set(names) != expected_names:
            raise ValueError('Corresponding source archive has unexpected, duplicate or missing files')
        manifest_entry = bundle.getinfo(prefix + 'manifest.json')
        if manifest_entry.file_size > 1_000_000:
            raise ValueError('Corresponding source manifest is too large')
        manifest = json.loads(bundle.read(manifest_entry))
        hashes = {name: hashlib.sha256(data).hexdigest() for name, data in expected.items()}
        if manifest != hashes:
            raise ValueError('Corresponding source manifest differs from the current checkout')
        for name, data in expected.items():
            entry = bundle.getinfo(prefix + name)
            if entry.file_size != len(data) or hashlib.sha256(bundle.read(entry)).hexdigest() != hashes[name]:
                raise ValueError('Corresponding source bytes differ: ' + name)
    return hashlib.sha256(Path(archive).read_bytes()).hexdigest()


def prepare_release(output_dir=None):
    release = json.loads((ROOT / 'release.json').read_text(encoding='utf-8-sig'))
    version = release['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    if release['channel'] not in ('source-preview', 'installer-beta'):
        raise ValueError('Unsupported release channel')
    frontend = (ROOT / 'hangul-lyrics.js').read_text(encoding='utf-8-sig')
    helper = (ROOT / 'bridge.py').read_text(encoding='utf-8-sig')
    if f"version: '{version}'" not in frontend:
        raise ValueError('Frontend version does not match release.json')
    if f'VERSION = "{release["helper_version"]}"' not in helper:
        raise ValueError('Helper version does not match release.json')
    payload = {name: (ROOT / name).read_bytes() for name in FILES}
    forbidden = (b'C:\\Users\\Administrator', b'Documents\\Codex', b'-----BEGIN ' + b'PRIVATE KEY-----')
    for name, data in payload.items():
        if any(marker in data for marker in forbidden):
            raise ValueError(f'Local path or private key marker in {name}')
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()}
    payload['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    destination = Path(output_dir).resolve() if output_dir is not None else ROOT / 'dist'
    stem = f'SpotifyHangul-{version}-source-preview'
    archive = destination / f'{stem}.zip'
    if archive.exists():
        raise FileExistsError('Source artifact already exists; choose a new candidate directory or version')
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name, data in payload.items():
            bundle.writestr(f'{stem}/{name}', data)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (destination / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    print(json.dumps({'archive': str(archive), 'files': len(payload), 'sha256': digest,
                      'public_release_ready': False}, ensure_ascii=True))
    return archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, help='Isolated candidate output; defaults to dist')
    prepare_release(parser.parse_args().output_dir)
