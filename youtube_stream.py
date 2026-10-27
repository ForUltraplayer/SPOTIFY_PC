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
from urllib.parse import parse_qs, urlsplit

_jobs = threading.BoundedSemaphore(1)
_cache = {}
_lock = threading.Lock()
APP_ROOT = Path(__file__).resolve().parent


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


def run_extractor(command, timeout=45):
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
    if data.get('id') != video_id or data.get('availability') not in ('public', 'unlisted') or data.get('age_limit', 0):
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
            'expires_at': expiry, 'title': str(data.get('title') or video_id)[:300]}


def youtube_stream(video_id):
    if not isinstance(video_id, str) or not re.fullmatch(r'[\w-]{11}', video_id, flags=re.ASCII):
        raise ValueError('올바른 YouTube 영상 ID가 필요합니다.')
    now = time.time()
    with _lock:
        cached = _cache.get(video_id)
        if cached and cached['expires_at'] > now + 60 and cached['_cached_until'] > now:
            return {k: v for k, v in cached.items() if not k.startswith('_')}
    if not _jobs.acquire(blocking=False):
        raise RuntimeError('다른 영상의 대체 스트림을 확인 중입니다. 잠시 후 다시 시도해 주세요.')
    try:
        engine, runtime_args = resolve_engine()
        command = [*engine, '--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--no-cache-dir',
                   '--skip-download', '--dump-single-json', '--no-playlist',
                   '--no-warnings', '--socket-timeout', '10', '--retries', '0', *runtime_args,
                   'https://www.youtube.com/watch?v=' + video_id]
        code, output = run_extractor(command)
        if code or len(output) > 8_000_000:
            raise LookupError('공개 영상의 스트림을 확인하지 못했습니다. 로그인 제한이나 엔진 상태를 확인해 주세요.')
        result = select_stream(json.loads(output), video_id)
        with _lock:
            _cache[video_id] = {**result, '_cached_until': time.time() + 300}
            while len(_cache) > 32:
                _cache.pop(next(iter(_cache)))
        return result
    except subprocess.TimeoutExpired as error:
        raise LookupError('대체 스트림 조회 시간이 초과됐습니다. 다시 재생해 주세요.') from error
    finally:
        _jobs.release()
