# @file fetch_distribution_inputs.py
# @author: ForUltraplayer
# @brief Fetch pinned public distribution inputs and verify published package digests.
import hashlib
import json
from pathlib import Path
import urllib.request
from dependencies import load, verify

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'work' / 'downloads'


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
    manifest = load()
    lock = manifest['artifacts']
    for name, metadata in (lock | manifest.get('test_fixtures', {})).items():
        fetch(name, metadata['url'], metadata['sha256'])
        verify(CACHE / name, metadata)
    # A derived receipt for old tooling; this is never the authority for a build.
    (CACHE / 'distribution-inputs.json').write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
