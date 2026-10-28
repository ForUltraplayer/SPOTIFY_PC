# @file youtube_stream.py
# @author: ForUltraplayer
# @brief Resolve short-lived public Opus stream references without audio files, cookies or DRM handling.
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import urllib.error
from urllib.parse import parse_qs, urlsplit
import urllib.request

_jobs = threading.BoundedSemaphore(1)
_cache = {}
_lock = threading.Lock()
APP_ROOT = Path(__file__).resolve().parent
# A skipped track's extraction can still hold the engine; wait for it instead of failing the new track at once.
BUSY_WAIT = 25
# Persist only yt-dlp's player-script and signature cache so later lookups skip the cold JS solve.
CACHE_DIR = Path(os.environ.get('LOCALAPPDATA', str(APP_ROOT))) / 'ivLyricsHangul' / 'yt-dlp-cache'


def resolve_engine(app_root=None):
    root = Path(app_root) if app_root is not None else APP_ROOT
    tools = root / 'tools'
    if (root / 'install-marker.json').is_file():
        python = root / 'runtime/python.exe'
        node = tools / 'node.exe'
        required = (python, node, root / 'vendor/yt_dlp/__init__.py', root / 'vendor/yt_dlp_ejs/__init__.py',
                    root / 'vendor/yt_dlp_ejs/yt/solver/core.min.js', root / 'vendor/yt_dlp_ejs/yt/solver/lib.min.js')
        if not all(path.is_file() for path in required):
            raise LookupError('설치된 YouTube 재생 도구가 누락됐습니다. 설치 파일로 복구해 주세요.')
        return [str(python), '-I', '-B', '-m', 'yt_dlp'], ['--no-js-runtimes', '--js-runtimes', 'node:' + str(node)]
    # Source development retains the pre-existing installed-tool path; managed
    # releases above never substitute an arbitrary executable from PATH.
    executable = tools / 'yt-dlp.exe'
    executable = str(executable) if executable.is_file() else shutil.which('yt-dlp')
    if not executable:
        raise LookupError('개발용 대체 스트림 엔진 yt-dlp를 찾지 못했습니다.')
    runtime_args = []
    for runtime in ('deno', 'node'):
        candidate = tools / (runtime + '.exe')
        candidate = str(candidate) if candidate.is_file() else shutil.which(runtime)
        if candidate:
            runtime_args = ['--no-js-runtimes', '--js-runtimes', runtime + ':' + candidate]
            break
    return [executable], runtime_args


def run_extractor(command, timeout=60):
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding='utf-8',
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    try:
        output, _errors = process.communicate(timeout=timeout)
        return process.returncode, output
    except subprocess.TimeoutExpired as error:
        # Terminate the owned tree before its parent exits, including a JS runtime.
        try:
            if os.name == 'nt':
                subprocess.run([str(Path(os.environ['SystemRoot']) / 'System32/taskkill.exe'),
                                '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=10,
                               creationflags=subprocess.CREATE_NO_WINDOW)
        except (subprocess.TimeoutExpired, OSError):
            pass
        finally:
            try:
                process.kill()
                process.communicate(timeout=10)
            except (subprocess.TimeoutExpired, OSError):
                # Do not retain pipes even if the OS refuses a child-tree termination.
                process.stdout.close()
                process.stderr.close()
        raise error


def select_stream(data, video_id, now=None):
    now = time.time() if now is None else now
    if data.get('id') != video_id or data.get('availability') not in ('public', 'unlisted', None) or data.get('age_limit', 0):
        raise LookupError('로그인이나 연령 확인이 없는 공개 영상만 대체 재생할 수 있습니다.')
    candidates = []
    for fmt in data.get('formats', []):
        url = urlsplit(fmt.get('url') or '')
        if (fmt.get('vcodec') != 'none' or 'opus' not in str(fmt.get('acodec', '')).lower()
                or fmt.get('has_drm') is not False or url.scheme != 'https' or url.username or url.password or url.port
                or not (url.hostname or '').endswith('.googlevideo.com')):
            continue
        bitrate = float(fmt.get('abr') or 0)
        if math.isfinite(bitrate) and 0 <= bitrate <= 2000:
            candidates.append(fmt)
    if not candidates:
        raise LookupError('Spotify에서 지원하는 공개 Opus 스트림을 찾지 못했습니다.')
    best = max(candidates, key=lambda f: float(f.get('abr') or 0))
    expiry = float(parse_qs(urlsplit(best['url']).query).get('expire', [now + 180])[0])
    duration = float(data.get('duration') or 0)
    if not math.isfinite(expiry) or not math.isfinite(duration) or not 0 < duration <= 31_536_000:
        raise LookupError('영상의 재생 정보가 올바르지 않습니다.')
    if expiry <= now + 20:
        raise LookupError('영상 스트림 주소가 만료되었습니다. 다시 재생해 주세요.')
    return {'video_id': video_id, 'url': best['url'], 'codec': 'opus',
            'bitrate_kbps': float(best.get('abr') or 0), 'duration': duration,
            'expires_at': expiry, 'title': str(data.get('title') or video_id)[:300], 'itag': str(best.get('format_id') or '')}


# YouTube's own player turns a loud video down to its loudness target (only down, never up), while
# the direct Opus stream plays as published, so loud songs sounded louder in audio mode. The watch
# page carries the value the player uses, per format when YouTube measured each format.
PLAYER_RESPONSE = re.compile(r'var ytInitialPlayerResponse\s*=\s*')


def player_response(video_id, opener=urllib.request.urlopen):
    """The watch page's player data, or None when it cannot be read."""
    request = urllib.request.Request('https://www.youtube.com/watch?v=' + video_id, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134 Safari/537.36'})
    try:
        with opener(request, timeout=8) as response:
            page = response.read(4_000_000).decode('utf-8', 'replace')
        match = PLAYER_RESPONSE.search(page)
        return json.JSONDecoder().raw_decode(page, match.end())[0] if match else None
    except (OSError, ValueError):
        return None


def volume_gain(player, itag):
    """The volume factor YouTube's player applies to this format: 1.0 unless the video is too loud."""
    player = player if isinstance(player, dict) else {}
    formats = (player.get('streamingData') or {}).get('adaptiveFormats') or []
    values = [fmt.get('loudnessDb') for fmt in formats if str(fmt.get('itag')) == str(itag)]
    values.append(((player.get('playerConfig') or {}).get('audioConfig') or {}).get('loudnessDb'))
    loudness = next((float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(value)
                     and -60 <= value <= 60), 0.0)
    return round(10 ** (-loudness / 20), 4) if loudness > 0 else 1.0


# A freshly issued googlevideo URL answers 403 for roughly 1-4 s (measured 2026-10-28 on
# four public videos), so an immediate <audio> load fails while a retry works.
READY_WAIT = 10


def wait_until_served(url, deadline=None, opener=urllib.request.urlopen, sleep=time.sleep, clock=time.monotonic):
    """Return True once a two-byte range request succeeds; give up quietly at the deadline."""
    deadline = clock() + (READY_WAIT if deadline is None else deadline)
    while True:
        request = urllib.request.Request(url, headers={'Range': 'bytes=0-1', 'User-Agent': 'Mozilla/5.0'})
        try:
            with opener(request, timeout=5) as response:
                if response.status in (200, 206):
                    return True
        except urllib.error.HTTPError as error:
            if error.code != 403:
                return False
        except OSError:
            return False
        if clock() + 0.5 > deadline:
            return False
        sleep(0.5)


def youtube_stream(video_id):
    if not isinstance(video_id, str) or not re.fullmatch(r'[\w-]{11}', video_id, flags=re.ASCII):
        raise ValueError('올바른 YouTube 영상 ID가 필요합니다.')
    now = time.time()
    with _lock:
        cached = _cache.get(video_id)
        if cached and cached['expires_at'] > now + 60 and cached['_cached_until'] > now:
            return {k: v for k, v in cached.items() if not k.startswith('_')}
    if not _jobs.acquire(timeout=BUSY_WAIT):
        raise RuntimeError('다른 영상의 대체 스트림을 확인 중입니다. 잠시 후 다시 시도해 주세요.')
    try:
        # Read the watch page alongside the extractor so the lookup takes no longer.
        page = {}
        reader = threading.Thread(target=lambda: page.update(player=player_response(video_id)), daemon=True)
        reader.start()
        engine, runtime_args = resolve_engine()
        command = [*engine, '--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--cache-dir', str(CACHE_DIR),
                   '--skip-download', '--dump-single-json', '--no-playlist',
                   '--no-warnings', '--socket-timeout', '10', '--retries', '2', '--extractor-retries', '2', *runtime_args,
                   'https://www.youtube.com/watch?v=' + video_id]
        code, output = run_extractor(command)
        if code or len(output) > 8_000_000:
            raise LookupError('공개 영상의 스트림을 확인하지 못했습니다. 로그인 제한이나 엔진 상태를 확인해 주세요.')
        result = select_stream(json.loads(output), video_id)
        wait_until_served(result['url'])
        reader.join(timeout=5)
        result['volume_gain'] = volume_gain(page.get('player'), result['itag'])
        with _lock:
            _cache[video_id] = {**result, '_cached_until': time.time() + 300}
            while len(_cache) > 32:
                _cache.pop(next(iter(_cache)))
        return result
    except subprocess.TimeoutExpired as error:
        raise LookupError('대체 스트림 조회 시간이 초과됐습니다. 다시 재생해 주세요.') from error
    finally:
        _jobs.release()
