# @file extension_host.py
# @brief Start the Myspoti extension runner on demand, relay its API to the Spotify page and serve the audio it finds.
import base64
import binascii
import ipaddress
import json
import math
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
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'ivLyricsHangul' / 'extensions'
# What the page plays: <audio> takes FLAC, Opus, MP3 and Vorbis files (Spotify's Chromium has no AAC, measured), and
# its MediaSource takes a DASH manifest's FLAC or Opus in fragmented MP4 (see dash_plan).
ACCEPT = {'codecs': ['flac', 'opus', 'mp3', 'vorbis'], 'manifest': True}
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
# A DASH manifest as the engine takes it (AudioStream.parse: at most 1 MB of base64), and what the helper plays of it:
# one static period, FLAC or Opus in MP4 (what Spotify's MediaSource takes), a SegmentTemplate with a SegmentTimeline or a
# fixed duration. Tidal-family sources answer a SegmentTimeline with $Number$ and absolute https addresses (measured).
DASH_MAX = 1024 * 1024
DASH_SEGMENTS = 5000
DASH_HOSTS = 4
DASH_URL = 4096
DASH_CODECS = ('flac', 'opus')
DASH_MARK = re.compile(r'\$(RepresentationID|Number|Bandwidth|Time)(?:%0([1-9])d)?\$|\$\$')
ISO_DURATION = re.compile(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?')


class RunnerUnavailable(RuntimeError):
    pass


class DashRefused(ValueError):
    """A manifest the helper does not play; the message says why (for the attempt's note)."""


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


def auth_window():
    """The sign-in window the runner opens for `myspoti.auth.open` (webview-auth.ps1 of the installation, or
    HANGUL_EXT_AUTH on a development PC); None when it is missing."""
    path = Path(os.environ.get('HANGUL_EXT_AUTH') or ROOT / 'webview-auth.ps1')
    return path if path.is_file() else None


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


def _local(node):
    return node.tag.rpartition('}')[2]


def _child(node, name):
    return next((c for c in node if _local(c) == name), None)


def _children(node, name):
    return [c for c in node if _local(c) == name]


def _whole(value, low, high, what):
    if value is None or not re.fullmatch(r'-?\d{1,15}', value.strip()) or not low <= int(value) <= high:
        raise DashRefused(f'{what} is not a number from {low} to {high}')
    return int(value)


def _seconds(value):
    """The seconds of an ISO 8601 duration ("PT4M11.573S"); None when absent or not one."""
    match = ISO_DURATION.fullmatch((value or '').strip())
    if not match or not any(match.groups()):
        return None
    days, hours, minutes, seconds = match.groups()
    return int(days or 0) * 86400 + int(hours or 0) * 3600 + int(minutes or 0) * 60 + float(seconds or 0)


def dash_plan(manifest, check_host=public_host):
    """What the page needs to play an audio-source's DASH manifest (base64 MPD), and the addresses it stands for:
    ({mime, durationMs, segments: [{t, d}] in seconds}, {init, url(i), count}). The manifest is the extension's,
    untrusted: DashRefused for anything else than the forms above, a DOCTYPE or entity, more than DASH_SEGMENTS
    segments, an address that is not http(s) once its BaseURLs are applied, or a host check_host refuses."""
    try:
        # As the engine reads it (Java's MIME decoder): characters outside base64 are skipped.
        raw = base64.b64decode(re.sub(r'[^A-Za-z0-9+/=]', '', manifest))
        text = raw.decode('utf-8-sig')
    except (binascii.Error, UnicodeDecodeError):
        raise DashRefused('not a base64 UTF-8 manifest')
    if len(raw) > DASH_MAX:
        raise DashRefused('over 1 MB')
    # No DOCTYPE, so no entity can be declared (or expanded); CDATA has no place in an MPD either.
    if re.search(r'<!(?!--)', text):
        raise DashRefused('a DOCTYPE, entity or CDATA section')
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise DashRefused('not XML')
    if _local(root) != 'MPD' or root.get('type', 'static') != 'static':
        raise DashRefused('not a static MPD (a live one is not played)')
    periods = _children(root, 'Period')
    if len(periods) != 1:
        raise DashRefused(f'{len(periods)} periods, one is played')
    period = periods[0]
    total = _seconds(period.get('duration')) or _seconds(root.get('mediaPresentationDuration'))
    candidates = []
    for adaptation in _children(period, 'AdaptationSet'):
        for representation in _children(adaptation, 'Representation'):
            mime = (representation.get('mimeType') or adaptation.get('mimeType') or '').strip().lower()
            codec = (representation.get('codecs') or adaptation.get('codecs') or '').strip().lower()
            if mime == 'audio/mp4' and codec in DASH_CODECS:
                bandwidth = representation.get('bandwidth', '0').strip()
                candidates.append((int(bandwidth) if bandwidth.isdigit() else 0, adaptation, representation, codec))
    if not candidates:
        raise DashRefused('no FLAC or Opus audio in MP4')
    _, adaptation, representation, codec = max(candidates, key=lambda c: c[0])
    levels = (period, adaptation, representation)
    templates = [t for t in (_child(n, 'SegmentTemplate') for n in levels) if t is not None]
    if not templates:
        raise DashRefused('no SegmentTemplate (a SegmentList or SegmentBase is not played)')
    # A lower level's SegmentTemplate takes the attributes and the timeline of the levels above it.
    attributes, timeline = {}, None
    for template in templates:
        attributes.update(template.attrib)
        timeline = _child(template, 'SegmentTimeline') if _child(template, 'SegmentTimeline') is not None else timeline
    base = ''
    for node in (root, *levels):
        address = (getattr(_child(node, 'BaseURL'), 'text', None) or '').strip()
        if len(address) > DASH_URL:
            raise DashRefused('a BaseURL over 4096 characters')
        if address:
            base = urllib.parse.urljoin(base, address)
    timescale = _whole(attributes.get('timescale', '1'), 1, 10 ** 9, 'timescale')
    first = _whole(attributes.get('startNumber', '1'), 0, 10 ** 9, 'startNumber')
    init, media = attributes.get('initialization'), attributes.get('media')
    if not init or not media:
        raise DashRefused('no initialization or media address')
    starts, durations = [], []
    if timeline is not None:
        at = 0
        entries = _children(timeline, 'S')
        for index, entry in enumerate(entries):
            d = _whole(entry.get('d'), 1, 10 ** 12, 'S@d')
            if entry.get('t') is not None:
                at = _whole(entry.get('t'), 0, 10 ** 15, 'S@t')
            repeat = _whole(entry.get('r', '0'), -1, DASH_SEGMENTS, 'S@r')
            if repeat == -1:
                # Repeats up to the end of the period: only for the last entry, with a known length.
                if index != len(entries) - 1 or total is None:
                    raise DashRefused('an open repeat without a known end')
                repeat = max(0, math.ceil((total * timescale - at) / d - 1e-9) - 1)
            if len(starts) + repeat + 1 > DASH_SEGMENTS:
                raise DashRefused(f'over {DASH_SEGMENTS} segments')
            for _ in range(repeat + 1):
                starts.append(at)
                durations.append(d)
                at += d
    elif attributes.get('duration'):
        d = _whole(attributes['duration'], 1, 10 ** 12, 'duration')
        if total is None:
            raise DashRefused('a fixed segment duration without a known length')
        length = round(total * timescale)
        count = math.ceil(length / d - 1e-9)
        if not 0 < count <= DASH_SEGMENTS:
            raise DashRefused(f'over {DASH_SEGMENTS} segments')
        starts = [i * d for i in range(count)]
        durations = [d] * (count - 1) + [length - d * (count - 1)]
    else:
        raise DashRefused('no SegmentTimeline or segment duration')
    if not starts:
        raise DashRefused('no segment')
    values = {'RepresentationID': representation.get('id'), 'Bandwidth': representation.get('bandwidth')}
    for template in (init, media):
        if '$' in DASH_MARK.sub('', template):
            raise DashRefused('an address template with an unknown $ identifier')

    def fill(template, number=None, time=None):
        def one(match):
            if match.group(0) == '$$':
                return '$'
            value = {**values, 'Number': number, 'Time': time}[match.group(1)]
            if value is None:
                raise DashRefused(f'${match.group(1)}$ without a value')
            return str(value).zfill(int(match.group(2) or 0))
        address = urllib.parse.urljoin(base, DASH_MARK.sub(one, template))
        parts = urllib.parse.urlsplit(address)
        if parts.scheme not in ('https', 'http') or not parts.hostname or len(address) > DASH_URL:
            raise DashRefused('an address that is not http(s)')
        return address

    init_url = fill(init)
    url = lambda i: fill(media, first + i, starts[i])
    hosts = {urllib.parse.urlsplit(u).hostname for u in (init_url, *map(url, range(len(starts))))}
    if len(hosts) > DASH_HOSTS or not all(check_host(h) for h in hosts):
        raise DashRefused('an address on this computer or network')
    page = {'mime': f'audio/mp4; codecs="{codec}"', 'durationMs': round(sum(durations) * 1000 / timescale),
            'segments': [{'t': (s - starts[0]) / timescale, 'd': d / timescale} for s, d in zip(starts, durations)]}
    return page, {'init': init_url, 'url': url, 'count': len(starts)}


class ExtensionHost:
    def __init__(self, app_version='', data=DATA, command=None, cwd=None, clock=time.monotonic, start_timeout=20,
                 check_host=public_host, auth=auth_window):
        self.data = Path(data)
        self.auth = auth() if callable(auth) else auth
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
                                                env=self._environment(),
                                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self.started = self.clock()
                self.port = self._read_ready(self.process)
            except (OSError, RunnerUnavailable):
                self._stop_locked()
                self._failed()
                raise RunnerUnavailable('runner-failed')
            return self.port

    def _environment(self):
        """The runner's environment: the data folder and the sign-in window by name, never on Java's command line (it is
        read in the Windows code page); without the window the runner refuses sign-in pages."""
        environment = {k: v for k, v in os.environ.items() if k.upper() != 'HANGUL_EXT_AUTH'}
        environment['HANGUL_EXT_DATA'] = str(self.data)
        if self.auth is not None:
            environment['HANGUL_EXT_AUTH'] = str(self.auth)
        return environment

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
        if not isinstance(stream, dict):
            return status, value
        kept = {k: v for k, v in stream.items() if k not in ('url', 'headers', 'manifest')}
        if isinstance(stream.get('manifest'), str):
            # A DASH answer: the page gets the segment plan and one helper address; the segments' addresses stay here.
            try:
                dash, entry = dash_plan(stream['manifest'], self.check_host)
            except DashRefused as refusal:
                self._note_refused(body, str(refusal))
                return status, {**value, 'found': False, 'reason': 'not-playable', 'stream': None}
            return status, {**value, 'stream': {**kept, 'dash': dash, 'media': '/ext/media/' + self.register({**stream, 'dash': entry})}}
        if isinstance(stream.get('url'), str):
            value = {**value, 'stream': {**kept, 'media': '/ext/media/' + self.register(stream)}}
        return status, value

    def _note_refused(self, body, reason):
        """Why the source's manifest was not played, on its attempt ("Why this source?"); Spotify plays the song."""
        track = body.get('track') if isinstance(body, dict) else None
        if not isinstance(track, dict) or not isinstance(track.get('id'), str):
            return
        try:
            # Short: the page waits on this answer, and the note is only the reason shown later.
            self.call('POST', '/v1/attempts/note', {'trackId': track['id'], 'fallback': 'Spotify',
                                                    'open': {'ok': False, 'ms': 0, 'error': 'DASH manifest not played: ' + reason}},
                      timeout=3)
        except RunnerUnavailable:
            pass

    def register(self, stream):
        """A helper address for a stream: its url, or a DASH plan's addresses (`dash`), with the extension's headers."""
        media = secrets.token_urlsafe(18)
        with self.media_lock:
            self.media[media] = {'url': stream.get('url') or '', 'dash': stream.get('dash'), 'headers': dict(stream.get('headers') or {})}
            while len(self.media) > MEDIA_KEEP:
                self.media.pop(next(iter(self.media)))
        return media

    def open_media(self, media, range_header=None, timeout=20, part=None):
        """The source's response for a registered address (Range passed on), or for a DASH address's part: 'init' or a
        segment's index; LookupError when unknown."""
        with self.media_lock:
            entry = self.media.get(media)
        dash = entry and entry.get('dash')
        if dash and part == 'init':
            url = dash['init']
        elif dash and isinstance(part, int) and 0 <= part < dash['count']:
            url = dash['url'](part)
        else:
            url = entry['url'] if entry and not dash and part is None else ''
        if not url.startswith(('https://', 'http://')):
            raise LookupError('media-unknown')
        # Accept-Encoding is left out: the relay passes the body on as it comes and does not pass Content-Encoding.
        headers = {k: v for k, v in entry['headers'].items() if k.lower() not in ('host', 'range', 'connection', 'accept-encoding')}
        opener = urllib.request.build_opener(MediaRedirects(headers, self.check_host))
        if range_header:
            headers['Range'] = range_header
        request = urllib.request.Request(url, headers=headers)
        try:
            return opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            return error
