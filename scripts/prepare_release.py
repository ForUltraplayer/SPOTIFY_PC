# @file prepare_release.py
# @author: ForUltraplayer
# @brief Build a source-preview archive from an explicit public-file allowlist.
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'release.json', 'requirements.txt',
    'bridge.py', 'phonetics.py', 'hangul-lyrics.js', 'start.ps1', 'stop.ps1',
    'test_bridge.py', 'test_extension.cjs', 'scripts/prepare_release.py',
    'docs/RELEASE.md', 'docs/OPERATIONS.md', 'docs/VERIFICATION.md', 'docs/LICENSE_REVIEW.md',
    'docs/SPOTX_INTEGRATION.md',
    'licenses/ivLyrics-LGPL-2.1.txt',
    'licenses/Kuromoji-Apache-2.0.txt', 'licenses/Kuromoji-IPADIC-NOTICE.md',
    'android/README.md', 'android/PLAN.md', 'android/LICENSE', 'android/upstream.json',
    'android/patches/myspoti-hangul.patch',
    'scripts/fetch_distribution_inputs.py', 'scripts/build_installer.py', 'scripts/audit_playlists.cjs',
    'scripts/test_installer.ps1', 'scripts/test_bootstrap.ps1', '.gitattributes',
    'installer/integrate.ps1', 'installer/setup.nsi',
    'installer/bootstrap.ps1', 'installer/spotx-patch.ps1', 'scripts/build_spotx_adapter.py',
    'third_party/spotx/upstream-run.ps1', 'third_party/spotx/patches.json', 'third_party/spotx/en.ps1',
    'third_party/spotx/LICENSE', 'third_party/spotx/upstream.json',
    'third_party/spotx/patch-functions.ps1', 'third_party/spotx/patch-calls.ps1',
)


def prepare_release():
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
    destination = ROOT / 'dist'
    destination.mkdir(exist_ok=True)
    stem = f'SpotifyHangul-{version}-source-preview'
    archive = destination / f'{stem}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name, data in payload.items():
            bundle.writestr(f'{stem}/{name}', data)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (destination / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    print(json.dumps({'archive': str(archive), 'files': len(payload), 'sha256': digest,
                      'public_release_ready': False}, ensure_ascii=True))
    return archive


if __name__ == '__main__':
    prepare_release()
