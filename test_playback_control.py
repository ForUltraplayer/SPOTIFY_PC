# @file test_playback_control.py
# @author: ForUltraplayer
# @brief Verify expiring playback authorization, source identity and single-consumption command delivery.
from concurrent.futures import ThreadPoolExecutor
import json
import unittest
from unittest.mock import patch
import uuid
from playback_control import PlaybackControlSession


SPOTIFY = 'spotify:track:6x7SB38tuekpu4xpH9OIPY'
YOUTUBE = 'youtube:video:rKQptWhAvO0'


class PlaybackControlTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.session = PlaybackControlSession(clock=lambda: self.now)
        self.instance = str(uuid.uuid4())
        self.registration = self.session.register(self.instance)
        self.token = self.registration['token']

    def state(self, uri=YOUTUBE, **changes):
        return {'trackUri': uri, 'position': 25000, 'duration': 194000, 'isPlaying': True,
                'source': 'youtube' if uri.startswith('youtube:') else 'spotify', **changes}

    def test_registration_renewal_keeps_token_and_changes_expiry(self):
        self.assertEqual(self.registration['expiresAt'], 1900000)
        self.assertEqual(self.registration['bridgeUrl'], 'http://127.0.0.1:19643')
        self.assertGreaterEqual(len(self.token), 40)
        self.session.publish(self.token, self.state())
        queued = self.session.enqueue(self.token, 'pause', YOUTUBE)
        self.now += 5
        renewal = self.session.register(self.instance.upper())
        self.assertEqual(renewal['token'], self.token)
        self.assertEqual(renewal['expiresAt'], 1905000)
        self.assertEqual(self.session.drain(self.token)['commands'][0]['id'], queued['id'])

    def test_new_instance_revokes_token_clears_commands_and_resets_state(self):
        self.session.publish(self.token, self.state())
        self.session.enqueue(self.token, 'next', YOUTUBE)
        replacement = self.session.register(str(uuid.uuid4()))
        self.assertNotEqual(replacement['token'], self.token)
        with self.assertRaises(PermissionError): self.session.state(self.token)
        self.assertEqual(self.session.drain(replacement['token']), {'commands': []})
        self.assertIsNone(self.session.state(replacement['token']))

    def test_unregistered_invalid_nonascii_and_expired_tokens_are_rejected(self):
        for token in (None, '', 'bad-token', '한글', 'x' * 129):
            with self.subTest(token_type=type(token).__name__):
                with self.assertRaises(PermissionError): self.session.authorize(token)
        with self.assertRaises(PermissionError): PlaybackControlSession().authorize(self.token)
        self.now += self.session.SESSION_TTL
        for method in (lambda: self.session.state(self.token), lambda: self.session.publish(self.token, self.state()),
                       lambda: self.session.enqueue(self.token, 'next', YOUTUBE), lambda: self.session.drain(self.token)):
            with self.assertRaises(PermissionError): method()

    def test_nonregister_calls_do_not_extend_session_ttl_and_comparison_is_constant_time(self):
        with patch('playback_control.secrets.compare_digest', wraps=__import__('secrets').compare_digest) as compare:
            self.session.publish(self.token, self.state())
            self.session.state(self.token)
            self.session.enqueue(self.token, 'pause', YOUTUBE)
            self.session.drain(self.token)
            self.assertEqual(compare.call_count, 4)
        self.now = 1900
        with self.assertRaises(PermissionError): self.session.state(self.token)

    def test_state_is_allowlisted_copied_and_does_not_expose_authorization(self):
        value = self.state(secret='do-not-leak', token='do-not-leak')
        result = self.session.publish(self.token, value)
        result['trackUri'] = SPOTIFY
        self.assertEqual(self.session.state(self.token)['trackUri'], YOUTUBE)
        self.assertNotIn('secret', json.dumps(self.session.state(self.token)))
        self.assertNotIn(self.token, json.dumps(self.session.state(self.token)))
        self.assertEqual(self.session.state(self.token)['updatedAt'], 1000000)

    def test_state_validation_rejects_unknown_sources_uris_numbers_and_boolean_numbers(self):
        invalid = [self.state(trackUri='https://example.test/video'), self.state(trackUri='youtube:video:' + 'x' * 300),
                   self.state(source='other'), self.state(source='spotify'), self.state(isPlaying=1),
                   self.state(position=float('nan')), self.state(duration=float('inf')), self.state(position=-1),
                   self.state(position=True), self.state(duration=2 ** 53), self.state(position=10 ** 1000), self.state(position='0')]
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(ValueError): self.session.publish(self.token, value)
        with self.assertRaises(ValueError): self.session.publish(self.token, None)

    def test_publish_normalizes_fractional_milliseconds_and_clamps_end_jitter(self):
        result = self.session.publish(self.token, self.state(position=194004.9, duration=194000.1))
        self.assertEqual(result['position'], 194000)
        self.assertEqual(result['duration'], 194000)

    def test_commands_are_delivered_in_order_once_and_contain_no_private_fields(self):
        self.session.publish(self.token, self.state())
        identifiers = [self.session.enqueue(self.token, action, YOUTUBE)['id'] for action in ('pause', 'play', 'next')]
        commands = self.session.drain(self.token)['commands']
        self.assertEqual([command['id'] for command in commands], identifiers)
        self.assertEqual([command['action'] for command in commands], ['pause', 'play', 'next'])
        self.assertEqual(set(commands[0]), {'id', 'action', 'trackUri'})
        self.assertEqual(self.session.drain(self.token), {'commands': []})

    def test_stale_uri_and_unsupported_actions_do_not_enter_queue(self):
        self.session.publish(self.token, self.state())
        with self.assertRaises(LookupError): self.session.enqueue(self.token, 'next', SPOTIFY)
        with self.assertRaises(ValueError): self.session.enqueue(self.token, 'seek', YOUTUBE)
        with self.assertRaises(ValueError): self.session.enqueue(self.token, 'next', '../private')
        self.assertEqual(self.session.drain(self.token), {'commands': []})

    def test_commands_expire_at_ten_seconds_and_publish_track_change_discards_them(self):
        self.session.publish(self.token, self.state())
        self.session.enqueue(self.token, 'next', YOUTUBE)
        self.now += 10
        self.assertEqual(self.session.drain(self.token), {'commands': []})
        self.session.publish(self.token, self.state())
        self.session.enqueue(self.token, 'next', YOUTUBE)
        self.session.publish(self.token, self.state(SPOTIFY))
        self.assertEqual(self.session.drain(self.token), {'commands': []})

    def test_bounded_queue_rejects_overflow_without_losing_existing_commands(self):
        self.session.publish(self.token, self.state())
        for _ in range(16): self.session.enqueue(self.token, 'toggle', YOUTUBE)
        with self.assertRaises(RuntimeError): self.session.enqueue(self.token, 'next', YOUTUBE)
        self.assertEqual(len(self.session.drain(self.token)['commands']), 16)

    def test_concurrent_enqueues_and_drains_consume_each_command_only_once(self):
        self.session.publish(self.token, self.state())
        with ThreadPoolExecutor(max_workers=8) as workers:
            issued = list(workers.map(lambda _: self.session.enqueue(self.token, 'pause', YOUTUBE)['id'], range(16)))
            drained = list(workers.map(lambda _: self.session.drain(self.token)['commands'], range(8)))
        received = [command['id'] for batch in drained for command in batch]
        self.assertCountEqual(received, issued)
        self.assertEqual(len(set(received)), len(issued))

    def test_malformed_instance_does_not_replace_existing_authorization(self):
        for value in (None, '', 'not-a-uuid', self.instance.replace('-', ''), 'x' * 500):
            with self.assertRaises(ValueError): self.session.register(value)
        self.assertTrue(self.session.authorize(self.token))

    def test_state_and_commands_are_disabled_until_a_fresh_publish(self):
        self.assertIsNone(self.session.state(self.token))
        with self.assertRaises(LookupError): self.session.enqueue(self.token, 'pause', YOUTUBE)
        self.session.publish(self.token, self.state())
        self.now += 4.999
        self.assertEqual(self.session.state(self.token)['trackUri'], YOUTUBE)
        self.now += 0.001
        self.assertIsNone(self.session.state(self.token))
        with self.assertRaises(LookupError): self.session.enqueue(self.token, 'next', YOUTUBE)
        self.assertEqual(self.session.drain(self.token), {'commands': []})
        self.session.publish(self.token, self.state())
        self.assertEqual(self.session.state(self.token)['trackUri'], YOUTUBE)
        self.assertTrue(self.session.enqueue(self.token, 'pause', YOUTUBE)['queued'])

    def test_registration_renewal_does_not_make_old_state_fresh_again(self):
        self.session.publish(self.token, self.state())
        self.now += 6
        self.session.register(self.instance)
        self.assertIsNone(self.session.state(self.token))
        with self.assertRaises(LookupError): self.session.enqueue(self.token, 'toggle', YOUTUBE)


if __name__ == '__main__':
    unittest.main()
