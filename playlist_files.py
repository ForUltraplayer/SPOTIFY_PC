# @file playlist_files.py
# @brief Save validated mixed playlist snapshots in the app-owned export folder without arbitrary paths.
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit
import uuid
from messages import text

FORMAT = 'SpotifyHangulMixedPlaylist'
MAX_BYTES = 3_000_000
MAX_TRACKS = 2000
IMAGE_HOSTS = {'i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com',
               'image-cdn-fa.spotifycdn.com', 'image-cdn.spotifycdn.com'}


def _text(value, limit, fallback=''):
    if value is None:
        return fallback
    if not isinstance(value, str) or '\0' in value:
        raise ValueError('playlist_text_invalid')
    try:
        units = len(value.encode('utf-16-le')) // 2
    except UnicodeEncodeError as error:
        raise ValueError('playlist_unicode_invalid') from error
    if units > limit:
        raise ValueError('playlist_text_invalid')
    return value


def _duration(value):
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 31536000:
        raise ValueError('track_duration_invalid')
    return value


def _image(value):
    if not value:
        return ''
    value = _text(value, 1200)
    if re.fullmatch(r'spotify:image:[a-fA-F0-9]{20,64}', value):
        return value
    url = urlsplit(value)
    if url.scheme != 'https' or url.hostname not in IMAGE_HOSTS or url.username or url.password or url.port:
        raise ValueError('image_host_not_allowed')
    return 'https://' + url.hostname + url.path


def validate_document(value):
    if not isinstance(value, dict) or value.get('format') != FORMAT or type(value.get('schema')) is not int or value.get('schema') != 1:
        raise ValueError('playlist_file_unsupported')
    source = value.get('playlist')
    if not isinstance(source, dict):
        raise ValueError('playlist_data_missing')
    native, links = source.get('nativeTracks'), source.get('tracks')
    if not isinstance(native, list) or not isinstance(links, list) or len(native) > MAX_TRACKS or len(links) > MAX_TRACKS:
        raise ValueError('playlist_too_many_tracks')
    tracks = []
    for index, track in enumerate(native):
        if not isinstance(track, dict) or track.get('kind') != 'spotify' or not re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', str(track.get('uri', ''))):
            raise ValueError('spotify_track_uri_invalid')
        entry = _text(track.get('entryKey'), 180, track['uri'] + '#' + str(index))
        if not entry or re.search(r'[\x00-\x1f]', entry):
            raise ValueError('spotify_entry_key_invalid')
        tracks.append({'kind': 'spotify', 'uri': track['uri'], 'title': _text(track.get('title'), 300, 'Spotify'),
                       'artist': _text(track.get('artist'), 200), 'duration': _duration(track.get('duration')),
                       'entryKey': entry, 'album': _text(track.get('album'), 300), 'image': _image(track.get('image'))})
    youtube = []
    for track in links:
        if not isinstance(track, dict) or track.get('kind') != 'youtube' or not re.fullmatch(r'[A-Za-z0-9_-]{11}', str(track.get('videoId', ''))):
            raise ValueError('youtube_id_invalid')
        item = {'kind': 'youtube', 'videoId': track['videoId'], 'title': _text(track.get('title'), 300, track['videoId']),
                'artist': _text(track.get('artist'), 200, 'YouTube'), 'duration': _duration(track.get('duration'))}
        if track.get('after') is not None:
            item['after'] = _text(track['after'], 180)
        if track.get('lyricTitle') is not None:
            item.update(lyricTitle=_text(track['lyricTitle'], 300), lyricArtist=_text(track.get('lyricArtist'), 200))
        youtube.append(item)
    native_keys = {track['entryKey'] for track in tracks}
    if len(native_keys) != len(tracks) or len({track['videoId'] for track in youtube}) != len(youtube):
        raise ValueError('entry_key_duplicate')
    playlist = {'name': _text(source.get('name'), 100, text('imported_playlist_name')), 'nativeTracks': tracks, 'tracks': youtube}
    if source.get('sourceUri') is not None:
        if not isinstance(source['sourceUri'], str) or not re.fullmatch(r'spotify:playlist:[A-Za-z0-9]{22}', source['sourceUri']):
            raise ValueError('source_playlist_uri_invalid')
        playlist['sourceUri'] = source['sourceUri']
    before = [item for item in youtube if item.get('after') == '']
    middle = [item for track in tracks for item in [track, *[link for link in youtube if link.get('after') == track['entryKey']]]]
    tail = [item for item in youtube if item.get('after') != '' and item.get('after') not in native_keys]
    defaults = [('yt:' + item['videoId']) if item['kind'] == 'youtube' else ('sp:' + item['entryKey']) for item in before + middle + tail]
    order = source.get('order', [])
    if not isinstance(order, list) or len(order) > MAX_TRACKS * 2:
        raise ValueError('mixed_order_invalid')
    selected = []
    for key in order:
        if not isinstance(key, str) or len(key) > 183 or not re.fullmatch(r'(sp|yt):[^\x00-\x1f]+', key):
            raise ValueError('mixed_order_entry_invalid')
        if key in defaults and key not in selected:
            selected.append(key)
    playlist['order'] = selected + [key for key in defaults if key not in selected]
    exported_at = _text(value.get('exportedAt'), 40, datetime.now(timezone.utc).isoformat())
    result = {'format': FORMAT, 'schema': 1, 'exportedAt': exported_at, 'playlist': playlist}
    if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode('utf-8')) > MAX_BYTES:
        raise ValueError('playlist_file_too_large')
    return result


def save_export(params, state_dir):
    document = validate_document(params)
    payload = json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')
    if len(payload) > MAX_BYTES:
        raise ValueError('playlist_file_too_large')
    root = Path(state_dir).resolve()
    folder = root / 'exports'
    folder.mkdir(parents=True, exist_ok=True)
    resolved_folder = folder.resolve()
    # Packaged Windows processes can expose one directory through AppData and
    # package LocalCache aliases. Check directory identity, not path spelling.
    try:
        owned = resolved_folder.parent.samefile(root)
    except OSError as error:
        raise ValueError('export_folder_unverified') from error
    if not owned:
        raise ValueError('export_folder_outside')
    folder = resolved_folder
    filename = 'SpotifyHangul-playlist-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex + '.json'
    target = folder / filename
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='wb', prefix='.playlist-', suffix='.tmp', dir=folder, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return {'path': str(target), 'filename': filename, 'bytes': len(payload)}
