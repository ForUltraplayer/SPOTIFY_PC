# @file playback_control.py
# @brief Authorize a short-lived local playback session and deliver bounded track-specific commands in memory.
from collections import deque
import math
import re
import secrets
import threading
import time
import uuid


class PlaybackControlSession:
    SESSION_TTL = 15 * 60
    COMMAND_TTL = 10
    STATE_TTL = 5
    MAX_COMMANDS = 16
    ACTIONS = frozenset(('previous', 'toggle', 'pause', 'play', 'next'))
    BRIDGE_URL = 'http://127.0.0.1:19643'
    MAX_MILLISECONDS = 2 ** 53 - 1

    def __init__(self, clock=None):
        self._clock = clock or time.time
        self._lock = threading.Lock()
        self._instance = None
        self._token = None
        self._expires_at = 0
        self._commands = deque()
        self._state = self._empty_state()
        self._published_at = None

    @staticmethod
    def _empty_state():
        return {'trackUri': None, 'position': 0, 'duration': 0, 'isPlaying': False,
                'source': None, 'updatedAt': 0}

    @staticmethod
    def _instance_id(instance):
        if not isinstance(instance, str) or len(instance) != 36:
            raise ValueError('instance_uuid_invalid')
        try:
            parsed = uuid.UUID(instance)
        except (ValueError, AttributeError) as error:
            raise ValueError('instance_uuid_invalid') from error
        if str(parsed) != instance.lower():
            raise ValueError('instance_uuid_invalid')
        return str(parsed)

    @staticmethod
    def _uri(value):
        if not isinstance(value, str) or len(value) > 100:
            raise ValueError('track_uri_invalid')
        if re.fullmatch(r'spotify:(?:track|episode):[A-Za-z0-9]{22}', value, flags=re.ASCII):
            return value
        if re.fullmatch(r'youtube:video:[A-Za-z0-9_-]{11}', value, flags=re.ASCII):
            return value
        raise ValueError('track_uri_unsupported')

    @classmethod
    def _milliseconds(cls, value):
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or value < 0 or value > cls.MAX_MILLISECONDS or not math.isfinite(value)):
            raise ValueError('milliseconds_invalid')
        return int(value)

    def _authorize(self, token, now):
        if (not isinstance(token, str) or not token or len(token) > 128 or not token.isascii()
                or not secrets.compare_digest(token, self._token or '') or now >= self._expires_at):
            raise PermissionError('control_session_invalid')

    def _prune(self, now):
        self._commands = deque(command for command in self._commands
                               if now < command['createdAt'] + self.COMMAND_TTL
                               and command['trackUri'] == self._state['trackUri'])

    def register(self, instance):
        instance = self._instance_id(instance)
        with self._lock:
            now = self._clock()
            if self._instance != instance:
                self._instance = instance
                self._token = secrets.token_urlsafe(32)
                self._commands.clear()
                self._state = self._empty_state()
                self._published_at = None
            self._expires_at = now + self.SESSION_TTL
            self._prune(now)
            return {'token': self._token, 'expiresAt': int(self._expires_at * 1000),
                    'bridgeUrl': self.BRIDGE_URL}

    def authorize(self, token):
        with self._lock:
            self._authorize(token, self._clock())
            return True

    def publish(self, token, state):
        with self._lock:
            now = self._clock()
            self._authorize(token, now)
            if not isinstance(state, dict):
                raise ValueError('playback_state_format_invalid')
            uri = self._uri(state.get('trackUri'))
            source = state.get('source')
            if source not in ('spotify', 'youtube') or not uri.startswith(source + ':'):
                raise ValueError('playback_source_mismatch')
            if not isinstance(state.get('isPlaying'), bool):
                raise ValueError('is_playing_not_boolean')
            position = self._milliseconds(state.get('position'))
            duration = self._milliseconds(state.get('duration'))
            if duration:
                position = min(position, duration)
            if uri != self._state['trackUri']:
                self._commands.clear()
            self._state = {'trackUri': uri, 'position': position, 'duration': duration,
                           'isPlaying': state['isPlaying'], 'source': source, 'updatedAt': int(now * 1000)}
            self._published_at = now
            self._prune(now)
            return dict(self._state)

    def state(self, token):
        with self._lock:
            now = self._clock()
            self._authorize(token, now)
            if self._published_at is None or now >= self._published_at + self.STATE_TTL:
                return None
            return dict(self._state)

    def enqueue(self, token, action, trackUri):
        with self._lock:
            now = self._clock()
            self._authorize(token, now)
            if not isinstance(action, str) or action not in self.ACTIONS:
                raise ValueError('playback_action_unsupported')
            uri = self._uri(trackUri)
            if self._published_at is None or now >= self._published_at + self.STATE_TTL:
                raise LookupError('playback_state_stale')
            if uri != self._state['trackUri']:
                raise LookupError('playback_track_changed')
            self._prune(now)
            if len(self._commands) >= self.MAX_COMMANDS:
                raise RuntimeError('command_queue_full')
            command_id = str(uuid.uuid4())
            self._commands.append({'id': command_id, 'action': action, 'trackUri': uri, 'createdAt': now})
            return {'queued': True, 'id': command_id}

    def drain(self, token):
        with self._lock:
            now = self._clock()
            self._authorize(token, now)
            self._prune(now)
            commands = [{key: command[key] for key in ('id', 'action', 'trackUri')}
                        for command in self._commands]
            self._commands.clear()
            return {'commands': commands}
