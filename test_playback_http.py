# @file test_playback_http.py
# @brief Verify real loopback HTTP pairing, cross-origin isolation, and consume-once playback commands.
import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
import uuid


class PlaybackHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.process = subprocess.Popen([sys.executable, 'bridge.py', '--port', str(cls.port), '--keep-alive-for-test'],
                                       cwd=Path(__file__).parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(80):
            try:
                if cls.request('GET', '/health', origin=None)[0] == 200:
                    return
            except OSError:
                pass
            if cls.process.poll() is not None:
                break
            time.sleep(0.1)
        cls.process.kill()
        cls.process.wait()
        raise RuntimeError('Test loopback helper did not start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)

    @classmethod
    def request(cls, method, path, body=None, origin='https://xpui.app.spotify.com', token=None, client=True, language=None):
        headers = {'Content-Type': 'application/json'}
        if origin is not None:
            headers['Origin'] = origin
        if token:
            headers['X-Hangul-Overlay-Token'] = token
        if language:
            headers['X-Hangul-Language'] = language
        if client:
            headers['X-Hangul-Lyrics-Client'] = 'ivlyrics'
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=3)
        try:
            connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
            response = connection.getresponse()
            payload = response.read()
            return response.status, dict(response.headers), json.loads(payload) if payload else None
        finally:
            connection.close()

    def register(self):
        code, _, session = self.request('POST', '/playback-session', {'instance': str(uuid.uuid4())})
        self.assertEqual(code, 200)
        return session['token']

    def test_health_identifies_the_required_packaged_protocol_without_exposing_paths(self):
        code, _, health = self.request('GET', '/health', origin=None)
        self.assertEqual(code, 200)
        self.assertEqual(health['protocol'], 1)
        self.assertTrue({'youtube-links-v1', 'mixed-playlists-v1', 'playback-control-v1', 'lyric-sync-v1'}.issubset(health['capabilities']))
        self.assertRegex(health['installation_id'], r'^[a-f0-9]{16}$')
        self.assertNotIn(str(Path(__file__).parent), json.dumps(health))

    def test_full_native_and_youtube_command_roundtrip(self):
        for uri, source in [('spotify:track:' + 'A' * 22, 'spotify'), ('youtube:video:rKQptWhAvO0', 'youtube')]:
            with self.subTest(source=source):
                token = self.register()
                state = {'trackUri': uri, 'source': source, 'position': 47000, 'duration': 194000, 'isPlaying': True}
                self.assertEqual(self.request('POST', '/playback-state', state, token=token)[0], 200)
                code, headers, body = self.request('GET', '/playback-state', origin='http://tauri.localhost', token=token)
                self.assertEqual(code, 200)
                self.assertEqual(headers['Access-Control-Allow-Origin'], 'http://tauri.localhost')
                self.assertEqual(body['state']['position'], 47000)
                code, _, command = self.request('POST', '/playback-command', {'action': 'toggle', 'trackUri': uri},
                                                origin='http://tauri.localhost', token=token)
                self.assertEqual(code, 200)
                code, _, drained = self.request('GET', '/playback-commands', token=token)
                self.assertEqual(code, 200)
                self.assertEqual(drained['commands'][0]['id'], command['id'])
                self.assertEqual(self.request('GET', '/playback-commands', token=token)[2]['commands'], [])

    def test_registration_requires_spotify_origin_and_client(self):
        for origin, client in [(None, True), ('http://tauri.localhost', True), ('https://evil.test', True),
                               ('https://xpui.app.spotify.com', False)]:
            self.assertEqual(self.request('POST', '/playback-session', {'instance': str(uuid.uuid4())},
                                          origin=origin, client=client)[0], 403)

    def test_owned_overlay_origin_requires_the_same_memory_token(self):
        origin = 'http://spotify-hangul-overlay.localhost'
        token = self.register()
        state = {'trackUri': 'youtube:video:rKQptWhAvO0', 'source': 'youtube', 'position': 1000,
                 'duration': 194000, 'isPlaying': True}
        self.assertEqual(self.request('POST', '/playback-state', state, token=token)[0], 200)
        self.assertEqual(self.request('GET', '/playback-state', origin=origin)[0], 403)
        code, headers, _ = self.request('GET', '/playback-state', origin=origin, token=token)
        self.assertEqual(code, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], origin)
        self.assertEqual(self.request('POST', '/playback-command', {'action': 'toggle', 'trackUri': state['trackUri']},
                                      origin=origin, token=token)[0], 200)
        self.assertEqual(self.request('GET', '/playback-state', origin='http://spotify-hangul-overlay.localhost.evil.test', token=token)[0], 403)

    def test_desktop_token_does_not_grant_other_helper_routes_or_publication(self):
        token = self.register()
        for method, path in [('GET', '/health'), ('GET', '/youtube/extension.js'), ('POST', '/resolve'),
                              ('GET', '/playback-commands'), ('POST', '/playback-session')]:
            self.assertEqual(self.request(method, path, {}, origin='http://tauri.localhost', token=token)[0], 403)
        self.assertEqual(self.request('POST', '/playback-state', {}, origin='http://tauri.localhost', token=token)[0], 405)

    def test_wrong_token_stale_uri_and_malformed_data_are_rejected(self):
        token = self.register()
        self.assertEqual(self.request('GET', '/playback-state', token='wrong')[0], 403)
        self.assertEqual(self.request('GET', '/playback-state', origin='https://evil.test', token=token)[0], 403)
        self.assertEqual(self.request('POST', '/playback-state', {}, token=token)[0], 400)
        self.assertEqual(self.request('POST', '/playback-command', {'action': 'next', 'trackUri': 'youtube:video:rKQptWhAvO0'},
                                      origin='http://tauri.localhost', token=token)[0], 409)

    def test_extension_player_module_is_served_beside_the_runner_routes(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request('GET', '/ext/player.js', headers={'Origin': 'https://xpui.app.spotify.com'})
            response = connection.getresponse()
            data = response.read()
            self.assertEqual(response.status, 200)
            self.assertTrue(response.headers['Content-Type'].startswith('text/javascript'))
            self.assertIn(b'SpotifyHangulExtensionPlayer', data)
        finally:
            connection.close()
        code, _, state = self.request('GET', '/ext/state')
        self.assertEqual(code, 200)
        self.assertIn('audio', state)
        self.assertEqual(self.request('GET', '/ext/media/unknown-address')[0], 404)
        code, headers, _ = self.request('OPTIONS', '/ext/media/unknown-address')
        self.assertEqual(code, 204)
        self.assertIn('Range', headers['Access-Control-Allow-Headers'])

    def test_desktop_preflight_is_limited_to_control_paths(self):
        code, headers, _ = self.request('OPTIONS', '/playback-command', origin='http://tauri.localhost')
        self.assertEqual(code, 204)
        self.assertIn('X-Hangul-Overlay-Token', headers['Access-Control-Allow-Headers'])
        self.assertIn('X-Hangul-Language', headers['Access-Control-Allow-Headers'])

    def test_control_errors_answer_in_the_requested_language_with_a_code(self):
        # The real helper process: the header decides, whatever this PC's Windows display language is.
        for language, expected in (('ko', '재생 제어 세션이 올바르지 않거나 만료됐습니다.'),
                                   ('en', 'The playback control session is not valid or has expired.')):
            code, _, body = self.request('GET', '/playback-state', origin='http://tauri.localhost', token='stale', language=language)
            self.assertEqual((code, body), (403, {'error': expected, 'code': 'control_session_invalid'}), language)
        code, _, body = self.request('POST', '/playback-session', {'instance': 'not-a-uuid'}, language='en')
        self.assertEqual((code, body), (400, {'error': 'A valid playback instance UUID is required.', 'code': 'instance_uuid_invalid'}))
        self.assertEqual(self.request('OPTIONS', '/resolve', origin='http://tauri.localhost')[0], 403)


class ExtensionMediaRouteTests(unittest.TestCase):
    """The helper's /ext routes in this process, with a fake runner and a source on this computer."""

    def setUp(self):
        import bridge, http.server, tempfile, threading
        from unittest.mock import patch
        import extension_host
        import test_extension_host as fakes
        area = Path(tempfile.mkdtemp())
        (area / 'runner.py').write_text(fakes.FAKE_RUNNER, encoding='utf-8')
        host = extension_host.ExtensionHost('0.0-test', data=area / 'data', command=[sys.executable, str(area / 'runner.py')],
                                            check_host=lambda name: name == '127.0.0.1')
        self.addCleanup(host.stop)
        source =http.server.ThreadingHTTPServer(('127.0.0.1', 0), fakes.Source)
        threading.Thread(target=source.serve_forever, daemon=True).start()
        self.addCleanup(source.server_close)
        self.addCleanup(source.shutdown)
        self.here = f'http://127.0.0.1:{source.server_port}'
        self.fakes, self.origin = fakes, bridge.ORIGIN
        servers = []

        class Recorded(bridge.HelperServer):
            def __init__(self, *args):
                super().__init__(*args)
                servers.append(self)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            self.port = probe.getsockname()[1]
        with patch.object(bridge, 'HelperServer', Recorded), patch.object(bridge, 'ExtensionHost', lambda *_: host):
            threading.Thread(target=bridge.serve, kwargs={'port': self.port, 'lifetime': False}, daemon=True).start()
            for _ in range(100):
                if servers:
                    break
                time.sleep(0.05)
        self.addCleanup(lambda: servers[0].shutdown())

    def get(self, path, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        try:
            connection.request('GET', path, headers={'Origin': self.origin, **(headers or {})})
            response = connection.getresponse()
            return response.status, dict(response.headers), response.read()
        finally:
            connection.close()

    def test_a_dash_answer_is_played_by_its_parts_through_the_helper(self):
        fakes = self.fakes
        manifest = fakes.mpd(fakes.flac(fakes.TIDAL.replace('https://cdn.example', self.here)))
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=20)
        try:
            connection.request('POST', '/ext/audio', body=json.dumps({'track': {'id': 'a', 'manifest': manifest}}),
                               headers={'Origin': self.origin, 'X-Hangul-Lyrics-Client': 'ivlyrics', 'Content-Type': 'application/json'})
            response = connection.getresponse()
            answer = json.loads(response.read())
        finally:
            connection.close()
        self.assertEqual(200, response.status)
        self.assertNotIn(self.here, json.dumps(answer))
        media, plan = answer['stream']['media'], answer['stream']['dash']
        self.assertEqual(('audio/mp4; codecs="flac"', 63), (plan['mime'], len(plan['segments'])))
        code, headers, body = self.get(media + '/init')
        self.assertEqual(200, code)
        self.assertEqual(fakes.Source.body, body)
        self.assertEqual(self.origin, headers['Access-Control-Allow-Origin'])
        code, headers, body = self.get(media + '/62', {'Range': 'bytes=10-'})
        self.assertEqual(206, code)
        self.assertEqual(fakes.Source.body[10:], body)
        self.assertIn('Content-Range', headers['Access-Control-Expose-Headers'])
        for path in (media, media + '/63', media + '/x', media + '/1/2', media + '/-1'):
            self.assertEqual(404, self.get(path)[0], path)


if __name__ == '__main__':
    unittest.main()
