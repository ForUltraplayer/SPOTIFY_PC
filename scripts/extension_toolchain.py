# @file extension_toolchain.py
# @brief Build the minimal Java runtime from the pinned JDK and place the Myspoti extension runner with its notices.
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import threading
import zipfile

try:
    from .dependencies import verify
except ImportError:
    from dependencies import verify


def _ready_line(command, cwd, data, timeout=30):
    """The runner's first stdout line, read within [timeout] seconds; the runner is stopped either way. It starts
    as the helper starts it: from the jar's folder, the data folder in HANGUL_EXT_DATA (no path on the command line)."""
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               text=True, encoding='utf-8', errors='replace', cwd=cwd, env={**os.environ, 'HANGUL_EXT_DATA': data},
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    line = []
    reader = threading.Thread(target=lambda: line.append(process.stdout.readline()), daemon=True)
    reader.start()
    reader.join(timeout)
    process.kill()
    process.wait(10)
    process.stdout.close()
    return (line[0] if line else '').strip()


def prepare_extension_runner(payload_root, jdk, cache, manifest):
    """Call after the pinned JDK is extracted to [jdk] (a build tool, never shipped) and before the package manifest."""
    root, jdk, cache = Path(payload_root), Path(jdk), Path(cache)
    components, artifacts = manifest['components'], manifest['artifacts']
    java, runner = components['java'], components['extensions_pc']
    names = [java['artifact'], runner['artifact'], runner['source_artifact'], *runner['notices'].values()]
    for name in names:
        verify(cache / name, artifacts[name])
    runtime, extensions = root / 'ext-runtime', root / 'extensions'
    for directory in (runtime, extensions):
        if directory.exists() or directory.is_symlink():
            raise ValueError('Refusing an existing extension runner destination: ' + directory.name)
    # The runtime holds only the modules the runner uses (jdeps); jlink copies the JDK's legal notices into it.
    subprocess.run([str(jdk / 'bin' / 'jlink.exe'), '--module-path', str(jdk / 'jmods'),
                    '--add-modules', ','.join(java['modules']), '--strip-debug', '--no-man-pages',
                    '--no-header-files', '--compress=zip-9', '--output', str(runtime)], check=True)
    if not (runtime / 'legal' / 'java.base' / 'LICENSE').is_file():
        raise ValueError('The Java runtime lost its legal notices')
    extensions.mkdir()
    jar = extensions / 'extensions-pc.jar'
    shutil.copy2(cache / runner['artifact'], jar)
    with tempfile.TemporaryDirectory() as data:
        ready = _ready_line([str(runtime / 'bin' / 'java.exe'), '-Xss2m', '-jar', jar.name, '--port', '0',
                             '--token', secrets.token_urlsafe(24), '--app-version', 'build-smoke'], extensions, data)
    if not ready.startswith('READY '):
        raise ValueError('The extension runner did not start on the bundled runtime')
    with zipfile.ZipFile(cache / runner['source_artifact']) as archive:
        found = [n for n in archive.namelist() if n.endswith('/base/licenses/Apache-2.0.txt') and n.count('/') == 3]
        if len(found) != 1:
            raise ValueError('Runner source notice layout changed')
        notices = {'Extensions-Apache-2.0.txt': archive.read(found[0])}
    notices |= {target: (cache / source).read_bytes() for target, source in runner['notices'].items()}
    if b'Apache License' not in notices['Extensions-Apache-2.0.txt'] or \
            not all(body.strip() for body in notices.values()):
        raise ValueError('Runner notices could not be verified')
    (root / 'licenses').mkdir(exist_ok=True)
    for name, body in notices.items():
        (root / 'licenses' / name).write_bytes(body)
    receipt = {'schema': 1, 'runner': runner['version'], 'revision': runner['revision'], 'java': java['version'],
               'modules': java['modules'], 'jar_sha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
               'notices': {name: hashlib.sha256(body).hexdigest() for name, body in notices.items()},
               'source_artifact': runner['source_artifact'], 'extensions_bundled': False}
    (extensions / 'extension-runner.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    return receipt
