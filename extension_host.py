# @file extension_host.py
# @brief Start the Myspoti extension runner on demand, relay its API to the Spotify page and serve the audio it finds.
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'ivLyricsHangul' / 'extensions'
# What the page's <audio> plays: Spotify's Chromium has no AAC (measured), DASH comes later.
ACCEPT = {'codecs': ['flac', 'opus', 'mp3', 'vorbis'], 'manifest': False}
# The runner's API the page may reach through the helper, by method; {id} is an extension id.
FORWARD = {
    'GET': ('/v1/health', '/v1/extensions', '/v1/order', '/v1/session', '/v1/attempts/latest', '/v1/store',
            '/v1/store/downloads'),
    'POST': ('/v1/install/preview', '/v1/install/confirm', '/v1/order', '/v1/audio', '/v1/audio/pick',
             '/v1/audio/again', '/v1/attempts/note', '/v1/session', '/v1/store/repos', '/v1/store/install'),
}
# The only queries passed on: a song id for its last attempt, the store's Refresh, a GitHub repository for its download count.
QUERIES = {
    '/v1/attempts/latest': re.compile(r'track=[^&]*'),
    '/v1/store': re.compile(r'force=1'),
    '/v1/store/downloads': re.compile(r'repo=[A-Za-z0-9_.-]{1,100}(?:/|%2F)[A-Za-z0-9_.-]{1,100}'),
}
# Seconds the runner may take: reading the store (indexes, the hosts' searches, manifests) and downloading a package, from it or an address.
TIMEOUTS = {'/v1/store': 120, '/v1/store/install': 120, '/v1/install/preview': 120}
EXTENSION_ACTIONS = ('enabled', 'settings', 'remove', 'update')
# An extension id as the manifest allows it (Manifest.kt).
EXTENSION_ID = re.compile(r'[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+')
# Seconds to wait before each new start after a failed one; past the last, that wait goes on.
RETRY_AFTER = (5, 30, 120, 1800)
# A runner that ends within this many seconds of its start counts as a failed start.
STABLE_AFTER = 60
MEDIA_REDIRECTS = 5
# The runner is on this computer: a system or environment proxy (company PCs, some antivirus) never carries it.
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
MEDIA_KEEP = 64
CHUNK = 64 * 1024


class RunnerUnavailable(RuntimeError):
    pass


def default_command(app_version):
    """(command, folder to start it in) of the bundled runtime and jar, or HANGUL_EXT_JAVA / HANGUL_EXT_JAR on a
    development PC; (None, None) when they are missing."""
    java = Path(os.environ.get('HANGUL_EXT_JAVA') or ROOT / 'ext-runtime' / 'bin' / 'java.exe')
    jar = Path(os.environ.get('HANGUL_EXT_JAR') or ROOT / 'extensions' / 'extensions-pc.jar')
    if not java.is_file() or not jar.is_file():
        return None, None
    # Java reads its command line in the Windows code page: a path with letters outside it arrives as "?". The jar
    # is named from its own folder and the data folder goes in HANGUL_EXT_DATA, so no path is on the command line.
    # UTF-8 keeps the log readable when it is kept; the reader never decodes it.
    return [str(java), '-Xss2m', '-Dstdout.encoding=UTF-8', '-jar', jar.name, '--app-version', app_version], jar.parent


def public_host(host):
    """Whether every address [host] resolves to is a public one (no loopback, private, link-local or reserved)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    addresses = {ipaddress.ip_address(info[4][0].split('%')[0]) for info in infos}
    return bool(addresses) and all(a.is_global and not a.is_multicast for a in addresses)


class MediaRedirects(urllib.request.HTTPRedirectHandler):
    """Follows a source's redirects as the Android player does (ExtensionMediaHttp): a few at most, never from https
    to http, never to an address on this computer or network, and the extension's headers only to the same host."""
    max_redirections = MEDIA_REDIRECTS

    def __init__(self, extension_headers, check_host=public_host):
        self.extension_headers = {k.lower() for k in extension_headers}
        self.check_host = check_host

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urllib.parse.urlsplit(req.full_url), urllib.parse.urlsplit(newurl)
        if new.scheme not in ('https', 'http') or (old.scheme == 'https' and new.scheme == 'http') \
                or not new.hostname or not self.check_host(new.hostname):
            return None
        request = super().redirect_request(req, fp, code, msg, headers, newurl)
        if request is not None and (old.hostname, old.port) != (new.hostname, new.port):
            for name in [k for k in request.headers if k.lower() in self.extension_headers and k.lower() != 'range']:
                del request.headers[name]
        return request


class ExtensionHost:
    def __init__(self, app_version='', data=DATA, command=None, cwd=None, clock=time.monotonic, start_timeout=20,
                 check_host=public_host):
        self.data = Path(data)
        self.command, self.cwd = (command, cwd) if command is not None else default_command(app_version)
        self.check_host = check_host
        self.started = 0.0
        self.clock = clock
        self.start_timeout = start_timeout
        self.lock = threading.Lock()
        self.process = None
        self.port = None
        self.token = None
        self.failures = 0
        self.next_try = 0.0
        self.media = {}
        self.media_lock = threading.Lock()

    def registry(self):
        try:
            value = json.loads((self.data / 'registry.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return []
        entries = value.get('extensions') if isinstance(value, dict) else None
        return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []

    def needed(self):
        """An enabled extension gives audio or downloads: only then is the runner started for playback."""
        return any(e.get('enabled') and {'audio-source', 'download-source'} & set(e.get('hooks') or ()) for e in self.registry())

    def running(self):
        return self.process is not None and self.process.poll() is None

    def _failed(self):
        self.failures += 1
        self.next_try = self.clock() + RETRY_AFTER[min(self.failures, len(RETRY_AFTER)) - 1]

    def ensure(self):
        with self.lock:
            if self.running():
                if self.failures and self.clock() - self.started >= STABLE_AFTER:
                    self.failures = 0
                return self.port
            if self.process is not None:
                # It ended by itself after READY: one that does not stay up waits like one that never started.
                lived = self.clock() - self.started
                self._stop_locked()
                if lived < STABLE_AFTER:
                    self._failed()
            if self.command is None:
                raise RunnerUnavailable('runner-missing')
            if self.clock() < self.next_try:
                raise RunnerUnavailable('runner-failed')
            self.token = secrets.token_urlsafe(24)
            self.data.mkdir(parents=True, exist_ok=True)
            command = [*self.command, '--port', '0', '--token', self.token]
            try:
                # Bytes, not text: the runner's log is in the Windows code page, and one line that does not decode
                # would end the reader below, fill the pipe and stop the runner at its next log line.
                self.process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                                stderr=subprocess.DEVNULL, cwd=self.cwd,
                                                env={**os.environ, 'HANGUL_EXT_DATA': str(self.data)},
                                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self.started = self.clock()
                self.port = self._read_ready(self.process)
            except (OSError, RunnerUnavailable):
                self._stop_locked()
                self._failed()
                raise RunnerUnavailable('runner-failed')
            return self.port

    def _read_ready(self, process):
        line = []

        def read():
            line.append(process.stdout.readline())
        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        reader.join(self.start_timeout)
        text = (line[0] if line else b'').strip()
        if not text.startswith(b'READY '):
            raise RunnerUnavailable('runner-failed')
        # The runner keeps writing its log to stdout; drain it so the pipe never fills and blocks it.
        threading.Thread(target=lambda: [None for _ in iter(lambda: process.stdout.read(CHUNK), b'')], daemon=True).start()
        return int(text.split()[1])

    def stop(self):
        with self.lock:
            self._stop_locked()

    def _stop_locked(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if self.process is not None and self.process.stdout is not None:
            self.process.stdout.close()
        self.process = None
        self.port = None

    def call(self, method, path, body=None, timeout=None):
        """(status, JSON) of the runner's [path]; RunnerUnavailable when it cannot be started."""
        timeout = timeout or TIMEOUTS.get(path.partition('?')[0], 25)
        port = self.ensure()
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        request = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=data, method=method,
                                         headers={'X-Hangul-Token': self.token, 'Content-Type': 'application/json'})
        try:
            with LOCAL.open(request, timeout=timeout) as response:
                return response.status, json.loads(response.read() or b'{}')
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.loads(error.read() or b'{}')
            except ValueError:
                return error.code, {'error': 'runner-error'}
        except (OSError, ValueError):
            raise RunnerUnavailable('runner-failed')

    def allowed(self, method, path):
        """The runner path the page may reach, or None."""
        base, _, query = path.partition('?')
        if base in FORWARD.get(method, ()):
            if not query:
                return base
            allowed = QUERIES.get(base)
            return path if method == 'GET' and allowed and allowed.fullmatch(query) else None
        parts = base.split('/')
        if method == 'POST' and len(parts) == 5 and parts[1:3] == ['v1', 'extensions'] and parts[4] in EXTENSION_ACTIONS \
                and EXTENSION_ID.fullmatch(parts[3]):
            return base
        return None

    def relay(self, method, path, body=None):
        """Forward a page request; audio answers get a helper media address instead of the source's."""
        if method == 'POST' and path in ('/v1/audio', '/v1/audio/pick', '/v1/audio/again') and isinstance(body, dict):
            body = {**body, 'accept': ACCEPT}
        status, value = self.call(method, path, body)
        stream = value.get('stream') if isinstance(value, dict) and value.get('found') else None
        if isinstance(stream, dict) and isinstance(stream.get('url'), str):
            value = {**value, 'stream': {**{k: v for k, v in stream.items() if k not in ('url', 'headers')},
                                        'media': '/ext/media/' + self.register(stream)}}
        return status, value

    def register(self, stream):
        media = secrets.token_urlsafe(18)
        with self.media_lock:
            self.media[media] = {'url': stream['url'], 'headers': dict(stream.get('headers') or {})}
            while len(self.media) > MEDIA_KEEP:
                self.media.pop(next(iter(self.media)))
        return media

    def open_media(self, media, range_header=None, timeout=20):
        """The source's response for a registered address (Range passed on); LookupError when unknown."""
        with self.media_lock:
            entry = self.media.get(media)
        if entry is None or not entry['url'].startswith(('https://', 'http://')):
            raise LookupError('media-unknown')
        # Accept-Encoding is left out: the relay passes the body on as it comes and does not pass Content-Encoding.
        headers = {k: v for k, v in entry['headers'].items() if k.lower() not in ('host', 'range', 'connection', 'accept-encoding')}
        opener = urllib.request.build_opener(MediaRedirects(headers, self.check_host))
        if range_header:
            headers['Range'] = range_header
        request = urllib.request.Request(entry['url'], headers=headers)
        try:
            return opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            return error
