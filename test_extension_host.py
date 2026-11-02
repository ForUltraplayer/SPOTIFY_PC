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
from extension_host import ExtensionHost, RunnerUnavailable, ACCEPT

FAKE_RUNNER = textwrap.dedent('''
    import http.server, json, os, sys
    args = sys.argv[1:]
    token = args[args.index('--token') + 1]
    seen = []
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def answer(self, code, value):
            data = json.dumps(value).encode()
            self.send_response(code); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            if self.headers.get('X-Hangul-Token') != token: return self.answer(401, {'error': 'token'})
            self.answer(200, {'path': self.path, 'seen': seen, 'args': args, 'data': os.environ.get('HANGUL_EXT_DATA')})
        def do_POST(self):
            if self.headers.get('X-Hangul-Token') != token: return self.answer(401, {'error': 'token'})
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])) or b'{}')
            seen.append(body)
            if self.path == '/v1/audio':
                return self.answer(200, {'found': True, 'extension': 'x', 'stream': {'url': body['track']['url'], 'headers': {'X-Key': 'secret'}, 'codec': 'flac'}})
            self.answer(200, {'path': self.path, 'body': body})
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    print('READY', server.server_port, flush=True)
    server.serve_forever()
''')


class Source(http.server.BaseHTTPRequestHandler):
    body = bytes(range(256)) * 40

    def log_message(self, *_):
        pass

    def do_GET(self):
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
