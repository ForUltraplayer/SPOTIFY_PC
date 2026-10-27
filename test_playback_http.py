# @file test_playback_http.py
# @author: ForUltraplayer
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
    def request(cls, method, path, body=None, origin='https://xpui.app.spotify.com', token=None, client=True):
        headers = {'Content-Type': 'application/json'}
        if origin is not None:
            headers['Origin'] = origin
        if token:
            headers['X-Hangul-Overlay-Token'] = token
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

    def test_desktop_preflight_is_limited_to_control_paths(self):
        code, headers, _ = self.request('OPTIONS', '/playback-command', origin='http://tauri.localhost')
        self.assertEqual(code, 204)
        self.assertIn('X-Hangul-Overlay-Token', headers['Access-Control-Allow-Headers'])
        self.assertEqual(self.request('OPTIONS', '/resolve', origin='http://tauri.localhost')[0], 403)


if __name__ == '__main__':
    unittest.main()
