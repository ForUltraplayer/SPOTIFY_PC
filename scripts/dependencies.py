# @file dependencies.py
# @author: ForUltraplayer
# @brief Load the single distribution manifest and verify immutable build inputs.
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def load(path=None):
    data = json.loads(Path(path or ROOT / 'components.json').read_text(encoding='utf-8-sig'))
    if data.get('schema') != 1:
        raise ValueError('Unsupported component manifest')
    for name, asset in (data['artifacts'] | data.get('test_fixtures', {})).items():
        if not re.fullmatch(r'(?:wheels/)?[A-Za-z0-9_.-]+', name):
            raise ValueError('Invalid artifact path')
        if not re.fullmatch(r'[a-f0-9]{64}', asset['sha256']) or asset['bytes'] <= 0:
            raise ValueError('Missing artifact digest or size')
        if urlparse(asset['url']).scheme != 'https':
            raise ValueError('Artifact URL requires HTTPS')
    for component in data['components'].values():
        for field in ('artifact', 'source_artifact'):
            if field in component and component[field] not in data['artifacts']:
                raise ValueError('Component references an unknown artifact')
    return data


def verify(path, metadata):
    path = Path(path)
    if path.stat().st_size != metadata['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != metadata['sha256']:
        raise ValueError('Distribution input digest or size mismatch: ' + path.name)


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def source_fingerprint():
    # Bind an inspection report to the checkout whose contracts were tested.
    names = sorted({str(p.relative_to(ROOT)).replace('\\', '/')
                    for pattern in ('*.py', '*.ps1', '*.js', '*.css', '*.cjs', 'scripts/*.py', 'scripts/*.ps1',
                                    'scripts/*.cjs', 'installer/*.ps1', 'installer/*.nsi', 'tests/ui/*.json', 'third_party/spotx/*')
                    for p in ROOT.glob(pattern) if p.is_file()} | {'components.json', 'release.json', 'requirements.txt', 'youtube-player.html'})
    digest = hashlib.sha256()
    for name in names:
        digest.update(name.encode())
        digest.update((ROOT / name).read_bytes())
    return digest.hexdigest()
