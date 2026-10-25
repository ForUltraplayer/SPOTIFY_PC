# @file fetch_distribution_inputs.py
# @author: ForUltraplayer
# @brief Fetch pinned public distribution inputs and verify published package digests.
import base64
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'work' / 'downloads'
INPUTS = {
    'python-3.13.17-embed-amd64.zip': 'https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip',
    'spicetify-2.46.3-windows-x64.zip': 'https://github.com/spicetify/cli/releases/download/v2.46.3/spicetify-2.46.3-windows-x64.zip',
    'spicetify-2.46.3-source.zip': 'https://codeload.github.com/spicetify/cli/zip/refs/tags/v2.46.3',
    'ivLyrics-7.0.16-source.zip': 'https://codeload.github.com/ivLis-Studio/ivLyrics/zip/fe45082ef26a5dfdd87170b50e56ded2da95702d',
    'nsis-3.13.zip': 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip',
}


def read_url(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'SpotifyHangul-distribution-builder/0.5'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def fetch(name, url, expected=None):
    target = CACHE / name
    if not target.resolve().is_relative_to(CACHE.resolve()):
        raise ValueError('Input path escapes download directory')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.is_file():
        data = read_url(url)
        if name.endswith('.zip') and not data.startswith(b'PK'):
            raise ValueError(f'Not a ZIP archive: {name}')
        target.write_bytes(data)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if expected and digest != expected:
        raise ValueError(f'Published SHA-256 mismatch: {name}')
    print(f'{name}: {target.stat().st_size} bytes', flush=True)
    return {'url': url, 'sha256': digest, 'bytes': target.stat().st_size}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    lock_file = CACHE / 'distribution-inputs.json'
    lock = json.loads(lock_file.read_text(encoding='utf-8')) if lock_file.exists() else {}
    for name, url in INPUTS.items():
        expected = lock.get(name, {}).get('sha256')
        if name.startswith('python-'):
            bundle = json.loads(read_url(url + '.sigstore'))
            expected = base64.b64decode(bundle['messageSignature']['messageDigest']['digest']).hex()
        lock[name] = fetch(name, url, expected)
        lock_file.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
    requirements = (ROOT / 'requirements.txt').read_text().splitlines()
    for line in requirements:
        package, version = line.split('==')
        metadata = json.loads(read_url(f'https://pypi.org/pypi/{package}/{version}/json'))
        source = next(item for item in metadata['urls'] if item['packagetype'] == 'sdist')
        lock[source['filename']] = fetch(source['filename'], source['url'], source['digests']['sha256'])
        wheel = next(item for item in metadata['urls'] if item['packagetype'] == 'bdist_wheel'
                     and (item['filename'].endswith('-none-any.whl') or item['filename'].endswith('-cp313-cp313-win_amd64.whl')))
        wheel_name = 'wheels/' + wheel['filename']
        lock[wheel_name] = fetch(wheel_name, wheel['url'], wheel['digests']['sha256'])
        lock_file.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
