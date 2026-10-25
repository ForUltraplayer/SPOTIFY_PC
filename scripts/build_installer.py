# @file build_installer.py
# @author: ForUltraplayer
# @brief Assemble an isolated Windows runtime and build a per-user NSIS installer.
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'work' / 'downloads'
PAYLOAD = ROOT / 'work' / 'installer-payload'
TOOLS = ROOT / 'work' / 'build-tools'


def extract(archive, destination, strip_root=False):
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            parts = Path(item.filename).parts
            if strip_root:
                parts = parts[1:]
            if not parts or item.is_dir():
                continue
            target = destination.joinpath(*parts).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError('Archive path escapes build directory')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.read(item))


def main():
    release = json.loads((ROOT / 'release.json').read_text(encoding='utf-8-sig'))
    lock = json.loads((CACHE / 'distribution-inputs.json').read_text(encoding='utf-8'))
    for name, metadata in lock.items():
        if hashlib.sha256((CACHE / name).read_bytes()).hexdigest() != metadata['sha256']:
            raise ValueError(f'Distribution input changed: {name}')
    if PAYLOAD.exists():
        if PAYLOAD.parent != ROOT / 'work' or not (PAYLOAD / '.builder-owned').is_file():
            raise ValueError('Refusing to replace an unowned payload directory')
        shutil.rmtree(PAYLOAD)
    PAYLOAD.mkdir(parents=True)
    (PAYLOAD / '.builder-owned').write_text('SpotifyHangul build payload\n')
    for name in ('bridge.py', 'phonetics.py', 'hangul-lyrics.js', 'start.ps1', 'stop.ps1',
                 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'release.json'):
        shutil.copy2(ROOT / name, PAYLOAD / name)
    shutil.copytree(ROOT / 'installer', PAYLOAD / 'installer')
    shutil.copytree(ROOT / 'licenses', PAYLOAD / 'licenses')
    extract(CACHE / 'python-3.13.17-embed-amd64.zip', PAYLOAD / 'runtime')
    (PAYLOAD / 'runtime' / 'python313._pth').write_text('python313.zip\n.\n..\n../vendor\n', encoding='ascii')
    extract(CACHE / 'spicetify-2.46.3-windows-x64.zip', PAYLOAD / 'tools')
    extract(CACHE / 'ivLyrics-7.0.16-source.zip', PAYLOAD / 'ivLyrics', strip_root=True)
    temporary = ROOT / 'work' / 'build-temp'
    temporary.mkdir(exist_ok=True)
    build_environment = dict(os.environ, TEMP=str(temporary), TMP=str(temporary))
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-index', '--no-compile', '--ignore-installed', '--no-deps',
                    '--find-links', str(CACHE / 'wheels'), '--target', str(PAYLOAD / 'vendor'),
                    '-r', str(ROOT / 'requirements.txt')], env=build_environment, check=True)
    sources = PAYLOAD / 'third_party_sources'
    sources.mkdir()
    for name in lock:
        if name.endswith('.tar.gz') or name.endswith('-source.zip'):
            shutil.copy2(CACHE / name, sources / name)
    source_bundle = ROOT / 'dist' / f'SpotifyHangul-{release["version"]}-source-preview.zip'
    if not source_bundle.exists():
        raise ValueError('Run prepare_release.py before building the installer')
    shutil.copy2(source_bundle, sources / source_bundle.name)
    shutil.copy2(CACHE / 'distribution-inputs.json', PAYLOAD / 'licenses' / 'distribution-inputs.json')
    extract(CACHE / 'nsis-3.13.zip', TOOLS / 'nsis', strip_root=True)
    shutil.copy2(TOOLS / 'nsis' / 'COPYING', PAYLOAD / 'licenses' / 'NSIS-COPYING.txt')
    shutil.copy2(PAYLOAD / 'runtime' / 'LICENSE.txt', PAYLOAD / 'licenses' / 'Python-LICENSE.txt')
    spicetify_source = TOOLS / 'spicetify-source'
    extract(CACHE / 'spicetify-2.46.3-source.zip', spicetify_source, strip_root=True)
    shutil.copy2(spicetify_source / 'LICENSE', PAYLOAD / 'licenses' / 'Spicetify-LICENSE.txt')
    marker = {'app': 'SpotifyHangul', 'version': release['version'], 'runtime': 'CPython 3.13.17 x64'}
    (PAYLOAD / 'install-marker.json').write_text(json.dumps(marker), encoding='utf-8')
    smoke = "import json,sys,pykakasi,phonetics; assert sys.flags.isolated == 1; assert all('anaconda' not in p.lower() for p in sys.path); print(json.dumps({'python':sys.version.split()[0],'isolated':True,'dictionaryWorks':bool(phonetics.japanese_to_hangul('青い空',pykakasi.kakasi()))}))"
    environment = dict(os.environ, PATH=os.path.join(os.environ['SystemRoot'], 'System32'), PYTHONPATH='', PYTHONHOME='')
    subprocess.run([str(PAYLOAD / 'runtime' / 'python.exe'), '-I', '-B', '-c', smoke], env=environment, cwd=PAYLOAD, check=True)
    manifest = {str(p.relative_to(PAYLOAD)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in PAYLOAD.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    (PAYLOAD / 'package-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    output = ROOT / 'dist' / f'SpotifyHangul-{release["version"]}-Setup.exe'
    arguments = [str(TOOLS / 'nsis' / 'makensis.exe'), '/V2', '/INPUTCHARSET', 'UTF8',
                 f'/DPAYLOAD_DIR={PAYLOAD}', f'/DOUTPUT_FILE={output}', f'/DAPP_VERSION={release["version"]}',
                 str(ROOT / 'installer' / 'setup.nsi')]
    subprocess.run(arguments, check=True)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    (ROOT / 'dist' / 'INSTALLER-SHA256SUMS.txt').write_text(f'{digest}  {output.name}\n', encoding='utf-8')
    print(json.dumps({'installer': str(output), 'bytes': output.stat().st_size, 'sha256': digest}))


if __name__ == '__main__':
    main()
