# @file extension_toolchain.py
# @brief Build the minimal Java runtime from the pinned JDK and place the Myspoti extension runner, its sign-in window parts and their notices.
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


def prepare_sign_in_window(root, cache, manifest):
    """The WebView2 parts of the runner's sign-in window (webview-auth.ps1) under extensions/webview2: the SDK's two .NET
    Framework assemblies and its loaders (x64, arm64 in arm64/) from the pinned NuGet package, and the SDK's notices in
    licenses/. Microsoft's runtime bootstrapper is not shipped: webview-auth.ps1 fetches it from Microsoft where needed."""
    root, cache = Path(root), Path(cache)
    webview, artifacts = manifest['components']['webview2'], manifest['artifacts']
    verify(cache / webview['artifact'], artifacts[webview['artifact']])
    target = root / 'extensions' / 'webview2'
    if target.exists() or target.is_symlink():
        raise ValueError('Refusing an existing sign-in window destination: ' + target.name)
    target.mkdir(parents=True)
    with zipfile.ZipFile(cache / webview['artifact']) as package:
        for member, part in webview['files'].items():
            body = package.read(member)
            if hashlib.sha256(body).hexdigest() != part['sha256']:
                raise ValueError('WebView2 part differs from components.json: ' + member)
            destination = (target / part['to']).resolve()
            if not destination.is_relative_to(target.resolve()):
                raise ValueError('WebView2 part escapes its folder: ' + part['to'])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(body)
        notices = {name: package.read(member) for name, member in webview['notices'].items()}
    if not all(body.strip() for body in notices.values()) or b'Redistribution and use' not in notices['WebView2-SDK-LICENSE.txt']:
        raise ValueError('WebView2 notices could not be verified')
    (root / 'licenses').mkdir(exist_ok=True)
    for name, body in notices.items():
        (root / 'licenses' / name).write_bytes(body)
    return {'version': webview['version'],
            'files': sorted(p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()),
            'notices': {name: hashlib.sha256(body).hexdigest() for name, body in notices.items()}}


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
               'source_artifact': runner['source_artifact'], 'extensions_bundled': False,
               'sign_in_window': prepare_sign_in_window(root, cache, manifest)}
    (extensions / 'extension-runner.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    return receipt
