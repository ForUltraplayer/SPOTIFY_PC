# @file youtube_toolchain.py
# @brief Assemble pinned Python extractor assets and Node with their original distribution notices.
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import zipfile

try:
    from .dependencies import verify
except ImportError:
    from dependencies import verify


def _tar_notice(path, basename):
    with tarfile.open(path, 'r:gz') as archive:
        found = [member for member in archive.getmembers()
                 if member.isfile() and len(Path(member.name).parts) == 2 and Path(member.name).name == basename]
        if len(found) != 1 or found[0].size > 2_000_000:
            raise ValueError('Required source notice changed: ' + path.name)
        return archive.extractfile(found[0]).read()


def prepare_youtube_tools(payload_root, cache, manifest):
    """Call after the normal --no-index vendor install and before the package manifest.

    The normal builder already copies source_artifact files to third_party_sources.
    This helper does not create that directory or use a system PATH fallback.
    """
    root, cache = Path(payload_root), Path(cache)
    components, artifacts = manifest['components'], manifest['artifacts']
    for name in ('yt_dlp', 'yt_dlp_ejs', 'node'):
        for key in ('artifact', 'source_artifact'):
            artifact = components[name][key]
            verify(cache / artifact, artifacts[artifact])
    vendor = root / 'vendor'
    for name in ('yt_dlp', 'yt_dlp_ejs'):
        if not (vendor / name / '__init__.py').is_file():
            raise ValueError('Pinned Python module was not installed: ' + name)
    for name in ('tools', 'licenses'):
        directory = root / name
        if directory.is_symlink():
            raise ValueError('Refusing a linked toolchain destination')
        directory.mkdir(parents=True, exist_ok=True)
    node = components['node']
    target = root / 'tools/node.exe'
    if target.is_symlink():
        raise ValueError('Refusing a linked Node destination')
    with zipfile.ZipFile(cache / node['artifact']) as archive:
        names = archive.namelist()
        member = node['binary_member']
        if names.count(member) != 1:
            raise ValueError('Pinned Node executable layout changed')
        info = archive.getinfo(member)
        if info.file_size > 250_000_000:
            raise ValueError('Node executable exceeds the package limit')
        with archive.open(info) as source, target.open('wb') as output:
            shutil.copyfileobj(source, output)
        license_member = node['license_member']
        if names.count(license_member) != 1 or archive.getinfo(license_member).file_size > 5_000_000:
            raise ValueError('Pinned Node compiled dependency notices changed')
        node_license = archive.read(license_member)
        if b'Node.js' not in node_license or b'V8' not in node_license or b'MIT License' not in node_license:
            raise ValueError('Node aggregate license text could not be verified')
    notices = {
        'YouTube-Node-THIRD-PARTY-LICENSES.txt': node_license,
        'YouTube-yt-dlp-Unlicense.txt': _tar_notice(cache / components['yt_dlp']['source_artifact'], 'LICENSE'),
        'YouTube-EJS-Unlicense.txt': _tar_notice(cache / components['yt_dlp_ejs']['source_artifact'], 'LICENSE'),
    }
    with zipfile.ZipFile(cache / components['yt_dlp_ejs']['artifact']) as archive:
        bundled = archive.read('yt_dlp_ejs/yt/solver/lib.min.js')
        end = bundled.find(b'*/')
        if not bundled.startswith(b'/*!') or end < 0 or b'Name: meriyah' not in bundled[:end] or b'Name: astring' not in bundled[:end]:
            raise ValueError('EJS bundled dependency notices changed')
        notices['YouTube-EJS-BUNDLED-LICENSES.txt'] = bundled[:end + 2] + b'\n'
        for member in ('yt_dlp_ejs/yt/solver/core.min.js', 'yt_dlp_ejs/yt/solver/lib.min.js'):
            installed = root / 'vendor' / member
            if not installed.is_file() or installed.read_bytes() != archive.read(member):
                raise ValueError('Installed EJS scripts differ from the pinned wheel')
    for name, body in notices.items():
        (root / 'licenses' / name).write_bytes(body)
    receipt = {'schema': 1, 'engine': 'embedded-python-module',
               'versions': {name: components[name]['version'] for name in ('yt_dlp', 'yt_dlp_ejs', 'node')},
               'required_ejs_version': components['yt_dlp']['required_ejs_version'],
               'node_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
               'notices': {name: hashlib.sha256(body).hexdigest() for name, body in notices.items()},
               'source_artifacts': [components[name]['source_artifact'] for name in ('yt_dlp', 'yt_dlp_ejs', 'node')],
               'remote_components': False, 'system_path_fallback': False}
    if receipt['versions']['yt_dlp_ejs'] != receipt['required_ejs_version']:
        raise ValueError('EJS version does not match the pinned yt-dlp contract')
    (root / 'tools/youtube-toolchain.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    return receipt
