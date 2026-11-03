# @file test_extension_host.py
# @brief Verify the extension runner lifecycle, the relayed API, audio address rewriting and the media relay.
import http.server
import json
import os
from pathlib import Path
import sys
import tempfile
import textwrap
import threading
import unittest
from unittest import mock
import urllib.parse
import base64
import extension_host
from extension_host import ExtensionHost, RunnerUnavailable, ACCEPT, DASH_SEGMENTS, DashRefused, dash_plan

FAKE_RUNNER = textwrap.dedent('''
    import http.server, json, os, sys, time
    args = sys.argv[1:]
    token = args[args.index('--token') + 1]
    seen = []
    class H(http.server.BaseHTTPRequestHandler):
        # Keeps the connection like the runner's HttpServer: the helper ends it, never `Connection: close`.
        protocol_version = 'HTTP/1.1'
        def log_message(self, *a): pass
        def answer(self, code, value):
            data = json.dumps(value).encode()
            self.send_response(code); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            if self.headers.get('X-Hangul-Token') != token: return self.answer(401, {'error': 'token'})
            if self.path == '/v1/hang':
                time.sleep(5)
            self.answer(200, {'path': self.path, 'connection': self.headers.get('Connection'), 'seen': seen, 'args': args, 'data': os.environ.get('HANGUL_EXT_DATA'),
                              'auth': os.environ.get('HANGUL_EXT_AUTH')})
        def do_POST(self):
            if self.headers.get('X-Hangul-Token') != token: return self.answer(401, {'error': 'token'})
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])) or b'{}')
            seen.append(body)
            if self.path == '/v1/audio' and body['track'].get('manifest'):
                return self.answer(200, {'found': True, 'extension': 'x', 'stream': {'url': '', 'manifest': body['track']['manifest'],
                                         'headers': {'X-Key': 'secret'}, 'codec': 'flac', 'quality': 'FLAC', 'expiresAt': 123}})
            if self.path == '/v1/audio':
                return self.answer(200, {'found': True, 'extension': 'x', 'stream': {'url': body['track']['url'], 'headers': {'X-Key': 'secret'}, 'codec': 'flac'}})
            self.answer(200, {'path': self.path, 'connection': self.headers.get('Connection'), 'body': body})
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    print('READY', server.server_port, flush=True)
    server.serve_forever()
''')


class Source(http.server.BaseHTTPRequestHandler):
    body = bytes(range(256)) * 40
    paths = []

    def log_message(self, *_):
        pass

    def do_GET(self):
        Source.paths.append(self.path)
        if self.path.startswith('/to/'):
            self.send_response(302); self.send_header('Location', urllib.parse.unquote(self.path[4:])); self.send_header('Content-Length', '0'); self.end_headers(); return
        if self.headers.get('X-Key') != 'secret':
            self.send_response(403); self.send_header('Content-Length', '0'); self.end_headers(); return
        start = int(self.headers['Range'].split('=')[1].split('-')[0]) if self.headers.get('Range') else 0
        part = self.body[start:]
        self.send_response(206 if start else 200)
        self.send_header('Content-Type', 'audio/flac')
        self.send_header('Content-Length', str(len(part)))
        if start:
            self.send_header('Content-Range', f'bytes {start}-{len(self.body) - 1}/{len(self.body)}')
        self.end_headers()
        self.wfile.write(part)


def mpd(representation, top='', period_base='', kind='static', periods=1, doctype=''):
    """A manifest as Tidal-family sources answer it (measured: one period, FLAC in MP4, a SegmentTemplate with a
    SegmentTimeline and $Number$, absolute https addresses), with the parts a test changes."""
    period = (f'<Period id="0">{period_base}<AdaptationSet id="0" contentType="audio" mimeType="audio/mp4" lang="und" segmentAlignment="true">'
              f'<Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>{representation}</AdaptationSet></Period>')
    text = (f"<?xml version='1.0' encoding='UTF-8'?>{doctype}\n"
            f'<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-main:2011" type="{kind}" '
            f'minBufferTime="PT3.993S" mediaPresentationDuration="PT4M11.573S">{top}{period * periods}</MPD>')
    return base64.b64encode(text.encode()).decode()


def flac(template, codecs='flac', bandwidth='1038258', rid='FLAC,44100,16'):
    return f'<Representation id="{rid}" codecs="{codecs}" bandwidth="{bandwidth}" audioSamplingRate="44100">{template}</Representation>'


TIDAL = ('<SegmentTemplate timescale="44100" initialization="https://cdn.example/a/0.mp4?token=t&amp;x=1" '
         'media="https://cdn.example/a/$Number$.mp4?token=t&amp;x=1" startNumber="1">'
         '<SegmentTimeline><S d="176128" r="61"/><S d="174448"/></SegmentTimeline></SegmentTemplate>')
ANY = lambda host: True


class DashPlanTest(unittest.TestCase):
    def test_the_measured_tidal_form_gives_its_segments_in_order(self):
        page, entry = dash_plan(mpd(flac(TIDAL)), ANY)
        self.assertEqual('audio/mp4; codecs="flac"', page['mime'])
        self.assertEqual(63, len(page['segments']))
        self.assertEqual(251573, page['durationMs'])
        self.assertEqual({'t': 0.0, 'd': 176128 / 44100}, page['segments'][0])
        self.assertAlmostEqual(62 * 176128 / 44100, page['segments'][-1]['t'])
        self.assertAlmostEqual(174448 / 44100, page['segments'][-1]['d'])
        self.assertEqual('https://cdn.example/a/0.mp4?token=t&x=1', entry['init'])
        self.assertEqual('https://cdn.example/a/1.mp4?token=t&x=1', entry['url'](0))
        self.assertEqual('https://cdn.example/a/63.mp4?token=t&x=1', entry['url'](62))
        self.assertNotIn('cdn.example', json.dumps(page), 'the page gets no address')

    def test_base_urls_time_marks_and_the_best_playable_representation(self):
        template = ('<SegmentTemplate timescale="1000" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Time%08d$.m4s">'
                    '<SegmentTimeline><S t="1000" d="4000" r="1"/><S d="2000"/></SegmentTimeline></SegmentTemplate>')
        manifest = mpd(flac('', codecs='mp4a.40.2', bandwidth='9999999', rid='aac') + flac(template, bandwidth='900', rid='low')
                       + flac(template, bandwidth='1400', rid='hi'), top='<BaseURL>https://cdn.example/root/</BaseURL>',
                       period_base='<BaseURL>p/</BaseURL>')
        page, entry = dash_plan(manifest, ANY)
        self.assertEqual('https://cdn.example/root/p/hi/init.mp4', entry['init'])
        self.assertEqual(['https://cdn.example/root/p/hi/00001000.m4s', 'https://cdn.example/root/p/hi/00005000.m4s',
                          'https://cdn.example/root/p/hi/00009000.m4s'], [entry['url'](i) for i in range(3)])
        self.assertEqual([{'t': 0.0, 'd': 4.0}, {'t': 4.0, 'd': 4.0}, {'t': 8.0, 'd': 2.0}], page['segments'])
        self.assertEqual(10000, page['durationMs'])

    def test_a_fixed_segment_duration_and_an_open_repeat_end_with_the_presentation(self):
        fixed = '<SegmentTemplate timescale="10" duration="40" initialization="https://c.example/i" media="https://c.example/$Number%03d$" startNumber="0"/>'
        page, entry = dash_plan(mpd(flac(fixed)), ANY)
        self.assertEqual(63, len(page['segments']))
        self.assertEqual('https://c.example/000', entry['url'](0))
        self.assertAlmostEqual(251.6 - 62 * 4, page['segments'][-1]['d'])
        open_repeat = TIDAL.replace('<S d="176128" r="61"/><S d="174448"/>', '<S d="176128" r="-1"/>')
        self.assertEqual(63, len(dash_plan(mpd(flac(open_repeat)), ANY)[0]['segments']))

    def test_what_is_not_played_is_refused(self):
        cases = {
            'entity': mpd(flac(TIDAL), doctype='<!DOCTYPE MPD [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>'),
            'live': mpd(flac(TIDAL), kind='dynamic'),
            'periods': mpd(flac(TIDAL), periods=2),
            'aac': mpd(flac(TIDAL, codecs='mp4a.40.2')),
            'list': mpd(flac('<SegmentList><SegmentURL media="https://cdn.example/1.mp4"/></SegmentList>')),
            'mark': mpd(flac(TIDAL.replace('$Number$', '$SubNumber$'))),
            'scheme': mpd(flac(TIDAL.replace('https://cdn.example/a/$Number$', 'file:///C:/a/$Number$'))),
            'relative': mpd(flac(TIDAL.replace('https://cdn.example/a/', ''))),
            'count': mpd(flac(TIDAL.replace('r="61"', f'r="{DASH_SEGMENTS}"'))),
            'open repeat in the middle': mpd(flac(TIDAL.replace('r="61"', 'r="-1"'))),
            'no timing': mpd(flac(TIDAL.replace('<SegmentTimeline><S d="176128" r="61"/><S d="174448"/></SegmentTimeline>', ''))),
            'not xml': base64.b64encode(b'<MPD><Period>').decode(),
            'not base64 text': base64.b64encode(b'\xff\xfe<MPD/>').decode(),
            'over 1 MB': base64.b64encode(b'<MPD>' + b' ' * (1024 * 1024) + b'</MPD>').decode(),
        }
        for name, manifest in cases.items():
            with self.subTest(name), self.assertRaises(DashRefused):
                dash_plan(manifest, ANY)
        with self.assertRaises(DashRefused):
            dash_plan(mpd(flac(TIDAL)), lambda host: host != 'cdn.example')


class ExtensionHostTest(unittest.TestCase):
    def setUp(self):
        self.area = Path(tempfile.mkdtemp())
        runner = self.area / 'runner.py'
        runner.write_text(FAKE_RUNNER, encoding='utf-8')
        self.host = ExtensionHost('0.0-test', data=self.area / 'data', command=[sys.executable, str(runner)],
                                  check_host=lambda host: host in ('127.0.0.1', 'localhost'))

    def tearDown(self):
        self.host.stop()

    def test_registry_decides_without_starting_the_runner(self):
        self.assertFalse(self.host.needed())
        (self.area / 'data').mkdir()
        (self.area / 'data' / 'registry.json').write_text(json.dumps({'extensions': [
            {'id': 'lyrics', 'enabled': True, 'hooks': ['lyrics']},
            {'id': 'off', 'enabled': False, 'hooks': ['audio-source']}]}), encoding='utf-8')
        self.assertFalse(self.host.needed())
        (self.area / 'data' / 'registry.json').write_text(json.dumps({'extensions': [
            {'id': 'flac', 'enabled': True, 'hooks': ['audio-source']}]}), encoding='utf-8')
        self.assertTrue(self.host.needed())
        self.assertFalse(self.host.running())

    def test_relay_adds_the_token_and_accept_and_hides_the_source_address(self):
        status, value = self.host.relay('POST', '/v1/audio', {'track': {'id': 'a', 'url': 'https://cdn.example/a.flac'}})
        self.assertEqual(200, status)
        self.assertTrue(value['stream']['media'].startswith('/ext/media/'))
        self.assertNotIn('url', value['stream'])
        self.assertNotIn('headers', value['stream'])
        _, seen = self.host.call('GET', '/v1/health')
        self.assertEqual(ACCEPT, seen['seen'][0]['accept'])

    def test_the_data_folder_goes_in_the_environment_never_on_the_command_line(self):
        # Java reads its command line in the Windows code page: a Thai or Hangul user folder would arrive as "?".
        data = self.area / 'ทดสอบ 한글' / 'extensions'
        host = ExtensionHost('0.0-test', data=data, command=self.host.command)
        try:
            _, seen = host.call('GET', '/v1/health')
            self.assertEqual(str(data), seen['data'])
            self.assertNotIn('--data', seen['args'])
            self.assertTrue(all(a.isascii() for a in seen['args']), seen['args'])
        finally:
            host.stop()

    def test_the_sign_in_window_goes_in_the_environment_never_on_the_command_line(self):
        window = self.area / 'ทดสอบ 한글' / 'webview-auth.ps1'
        window.parent.mkdir(parents=True)
        window.write_text('# test', encoding='utf-8')
        host = ExtensionHost('0.0-test', data=self.area / 'data', command=self.host.command, auth=window)
        try:
            _, seen = host.call('GET', '/v1/health')
            self.assertEqual(str(window), seen['auth'])
            self.assertTrue(all(a.isascii() for a in seen['args']), seen['args'])
        finally:
            host.stop()

    def test_without_the_sign_in_window_the_runner_is_not_told_of_one(self):
        with mock.patch.dict(os.environ, {'HANGUL_EXT_AUTH': str(self.area / 'missing.ps1')}):
            host = ExtensionHost('0.0-test', data=self.area / 'data', command=self.host.command)
            try:
                self.assertIsNone(host.auth)
                self.assertIsNone(host.call('GET', '/v1/health')[1]['auth'])
            finally:
                host.stop()

    def test_the_installed_sign_in_window_is_found_beside_the_helper(self):
        with mock.patch.dict(os.environ, {'HANGUL_EXT_AUTH': ''}):
            self.assertEqual(Path(extension_host.ROOT) / 'webview-auth.ps1', extension_host.auth_window())

    def test_a_system_proxy_never_carries_the_runner_calls(self):
        with mock.patch.dict(os.environ, {'HTTP_PROXY': 'http://127.0.0.1:9', 'http_proxy': 'http://127.0.0.1:9', 'NO_PROXY': '', 'no_proxy': ''}):
            self.assertEqual(200, self.host.call('GET', '/v1/health', timeout=10)[0])

    def test_a_runner_that_ends_soon_after_ready_waits_before_the_next_start(self):
        quitter = self.area / 'quitter.py'
        quitter.write_text('print("READY 9", flush=True)', encoding='utf-8')
        now = [0.0]
        host = ExtensionHost(data=self.area / 'data', command=[sys.executable, str(quitter)], clock=lambda: now[0])
        try:
            host.ensure()
            host.process.wait(10)
            now[0] = 1.0
            with self.assertRaises(RunnerUnavailable):
                host.ensure()
            self.assertEqual(1, host.failures)
        finally:
            host.stop()

    def test_only_known_runner_paths_are_allowed(self):
        self.assertEqual('/v1/order', self.host.allowed('POST', '/v1/order'))
        self.assertEqual('/v1/session', self.host.allowed('POST', '/v1/session'))
        self.assertEqual('/v1/extensions/app.x/enabled', self.host.allowed('POST', '/v1/extensions/app.x/enabled'))
        self.assertEqual('/v1/attempts/latest?track=abc', self.host.allowed('GET', '/v1/attempts/latest?track=abc'))
        for path in ('/v1/shutdown', '/v1/extensions/../x/remove', '/v1/extensions/a/b/remove', '/v1/order?x=1',
                     '/v1/extensions/../enabled', '/v1/extensions/App.X/enabled', '/v1/extensions/nodot/enabled'):
            self.assertIsNone(self.host.allowed('POST', path), path)

    def test_the_store_paths_pass_only_their_own_queries(self):
        self.assertEqual('/v1/store', self.host.allowed('GET', '/v1/store'))
        self.assertEqual('/v1/store?force=1', self.host.allowed('GET', '/v1/store?force=1'))
        self.assertEqual('/v1/store/downloads?repo=alice/good', self.host.allowed('GET', '/v1/store/downloads?repo=alice/good'))
        self.assertEqual('/v1/store/downloads?repo=alice%2Fgood', self.host.allowed('GET', '/v1/store/downloads?repo=alice%2Fgood'))
        self.assertEqual('/v1/store/repos', self.host.allowed('POST', '/v1/store/repos'))
        self.assertEqual('/v1/store/install', self.host.allowed('POST', '/v1/store/install'))
        for method, path in (('GET', '/v1/store?force=1&x=2'), ('GET', '/v1/store?force=0'), ('GET', '/v1/store/downloads?repo=a/b&x=1'),
                             ('GET', '/v1/store/downloads?repo=https://evil.example/a'), ('GET', '/v1/store/downloads?other=a/b'),
                             ('GET', '/v1/store/downloads?repo=a/b/c'), ('POST', '/v1/store?force=1'), ('POST', '/v1/store/install?x=1'),
                             ('GET', '/v1/store/repos'), ('GET', '/v1/store/install'), ('POST', '/v1/store/other')):
            self.assertIsNone(self.host.allowed(method, path), (method, path))
        _, value = self.host.call('GET', '/v1/store?force=1')
        self.assertEqual('/v1/store?force=1', value['path'], 'the store query reaches the runner as it is')

    def test_media_relay_sends_the_source_headers_and_range(self):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Source)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            media = self.host.register({'url': f'http://127.0.0.1:{server.server_port}/a.flac', 'headers': {'X-Key': 'secret', 'Host': 'evil'}})
            with self.host.open_media(media, 'bytes=100-') as response:
                self.assertEqual(206, response.status)
                self.assertEqual(Source.body[100:], response.read())
            refused = self.host.register({'url': f'http://127.0.0.1:{server.server_port}/a.flac', 'headers': {}})
            with self.host.open_media(refused) as response:
                self.assertEqual(403, response.code)
            with self.assertRaises(LookupError):
                self.host.open_media('unknown')
            here = f'http://127.0.0.1:{server.server_port}'
            moved = lambda to: self.host.register({'url': here + '/to/' + urllib.parse.quote(to, safe=''), 'headers': {'X-Key': 'secret'}})
            # The same host keeps the extension's headers; another host does not get them.
            with self.host.open_media(moved(here + '/a.flac')) as response:
                self.assertEqual(200, response.status)
            with self.host.open_media(moved(f'http://localhost:{server.server_port}/a.flac')) as response:
                self.assertEqual(403, response.code)
            # An address on this computer or network is never followed (the test host allows only 127.0.0.1).
            with self.host.open_media(moved(f'http://10.0.0.1:{server.server_port}/a.flac')) as response:
                self.assertEqual(302, response.code)
        finally:
            server.shutdown()
            server.server_close()

    def test_a_dash_answer_gives_the_page_its_plan_and_one_address_whose_parts_are_relayed(self):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Source)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            here = f'http://127.0.0.1:{server.server_port}'
            template = TIDAL.replace('https://cdn.example', here)
            status, value = self.host.relay('POST', '/v1/audio', {'track': {'id': 'a', 'manifest': mpd(flac(template))}})
            self.assertEqual(200, status)
            stream = value['stream']
            self.assertEqual({'codec', 'quality', 'expiresAt', 'dash', 'media'}, set(stream))
            self.assertEqual(63, len(stream['dash']['segments']))
            self.assertNotIn(here, json.dumps(value), 'no source address, header or manifest reaches the page')
            media = stream['media'][len('/ext/media/'):]
            Source.paths.clear()
            with self.host.open_media(media, part='init') as response:
                self.assertEqual(200, response.status)
            with self.host.open_media(media, 'bytes=100-', part=62) as response:
                self.assertEqual(206, response.status)
                self.assertEqual(Source.body[100:], response.read())
            self.assertEqual(['/a/0.mp4?token=t&x=1', '/a/63.mp4?token=t&x=1'], Source.paths, 'with the source headers (else 403) and the range')
            for part in (None, 63, -1, 'other'):
                with self.subTest(part), self.assertRaises(LookupError):
                    self.host.open_media(media, part=part)
            plain = self.host.relay('POST', '/v1/audio', {'track': {'id': 'b', 'url': here + '/a.flac'}})[1]['stream']['media']
            with self.assertRaises(LookupError):
                self.host.open_media(plain[len('/ext/media/'):], part='init')
        finally:
            server.shutdown()
            server.server_close()

    def test_a_dash_answer_the_helper_does_not_play_is_no_answer_and_says_why(self):
        refused = mpd(flac(TIDAL), kind='dynamic')
        status, value = self.host.relay('POST', '/v1/audio', {'track': {'id': 'track0000000000000000a', 'manifest': refused}})
        self.assertEqual((200, False, 'not-playable', None), (status, value['found'], value['reason'], value['stream']))
        note = self.host.call('GET', '/v1/health')[1]['seen'][-1]
        self.assertEqual('track0000000000000000a', note['trackId'])
        self.assertEqual('Spotify', note['fallback'])
        self.assertTrue(note['open']['error'].startswith('DASH manifest not played: not a static MPD'), note)

    def test_the_runner_calls_never_ask_to_close_the_connection(self):
        # AdGuard's local filtering resets or stalls answers to `Connection: close` (2026-11-03).
        self.assertIsNone(self.host.call('GET', '/v1/extensions')[1]['connection'])
        self.assertIsNone(self.host.call('POST', '/v1/session', {'source': None})[1]['connection'])

    def test_a_runner_that_does_not_answer_is_not_told_as_a_failed_start(self):
        with self.assertRaises(RunnerUnavailable) as raised:
            self.host.call('GET', '/v1/hang', timeout=1)
        self.assertEqual('runner-no-answer', str(raised.exception))
        self.assertEqual(0, self.host.failures)
        self.assertTrue(self.host.running())
        self.assertEqual(200, self.host.call('GET', '/v1/health')[0])

    def test_a_runner_that_never_gets_ready_backs_off(self):
        broken = self.area / 'broken.py'
        broken.write_text('print("nope", flush=True)', encoding='utf-8')
        now = [0.0]
        host = ExtensionHost(data=self.area / 'data', command=[sys.executable, str(broken)], clock=lambda: now[0], start_timeout=5)
        with self.assertRaises(RunnerUnavailable):
            host.ensure()
        # Within the wait it is not started again.
        with self.assertRaises(RunnerUnavailable):
            host.ensure()
        self.assertEqual(1, host.failures)
        now[0] = 6.0
        with self.assertRaises(RunnerUnavailable):
            host.ensure()
        self.assertEqual(2, host.failures)

    def test_a_runner_log_that_is_not_utf8_never_blocks_it(self):
        # Java writes its log in the Windows code page; an unread pipe would fill and stop every request.
        noisy = self.area / 'noisy.py'
        noisy.write_text(textwrap.dedent('''
            import http.server, sys
            class H(http.server.BaseHTTPRequestHandler):
                def log_message(self, *a): pass
                def do_GET(self):
                    sys.stdout.buffer.write(b'ext: nessun abbinamento \\x96 caff\\xe8\\n' * 4000); sys.stdout.buffer.flush()
                    self.send_response(200); self.send_header('Content-Length', '2'); self.end_headers(); self.wfile.write(b'{}')
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
            print('READY', server.server_port, flush=True)
            server.serve_forever()
        '''), encoding='utf-8')
        host = ExtensionHost(data=self.area / 'data', command=[sys.executable, str(noisy)])
        try:
            for _ in range(3):
                self.assertEqual(200, host.call('GET', '/v1/health', timeout=10)[0])
        finally:
            host.stop()

    def test_missing_runtime_is_reported_not_started(self):
        host = ExtensionHost(data=self.area / 'data', command=None)
        with self.assertRaises(RunnerUnavailable) as raised:
            host.ensure()
        self.assertEqual('runner-missing', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
