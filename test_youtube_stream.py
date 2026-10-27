# @file test_youtube_stream.py
# @author: ForUltraplayer
# @brief Verify public-only Opus selection, bounded resolver attempts and nonpersistent stream references.
import json
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import zipfile
import youtube_stream as streams
from scripts.youtube_toolchain import prepare_youtube_tools


VIDEO = '_-uHa5KiR90'


def media(format_id='251', codec='opus', bitrate=136, **extra):
    return dict(format_id=format_id, acodec=codec, vcodec='none', abr=bitrate,
                url='https://rr1.googlevideo.com/videoplayback?expire=5000', has_drm=False, **extra)


def metadata(formats=None, **extra):
    return dict(id=VIDEO, availability='public', age_limit=0, duration=244,
                title='public cover', formats=formats if formats is not None else [media()], **extra)


class PublicStreamTests(unittest.TestCase):
    def setUp(self):
        streams._cache.clear()
        streams._jobs = threading.BoundedSemaphore(1)

    def test_input_never_becomes_an_arbitrary_extractor_url_or_option(self):
        with patch('youtube_stream.run_extractor') as run:
            for value in (None, '', '--cookies', 'https://127.0.0.1/private', '../private', 'a' * 12):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    streams.youtube_stream(value)
            run.assert_not_called()

    def test_only_correct_public_or_unlisted_identity_without_age_check_is_allowed(self):
        for changes in ({'id': 'abcdefghijk'}, {'availability': 'private'},
                        {'availability': 'premium_only'}, {'age_limit': 18}):
            data = metadata(); data.update(changes)
            with self.subTest(changes=changes), self.assertRaises(LookupError):
                streams.select_stream(data, VIDEO, now=1000)
        data = metadata(); data['availability'] = 'unlisted'
        self.assertEqual(streams.select_stream(data, VIDEO, now=1000)['video_id'], VIDEO)

    def test_highest_supported_opus_is_selected_instead_of_aac_or_encrypted_media(self):
        encrypted = media('bad', bitrate=320); encrypted['has_drm'] = True
        data = metadata([media('250', bitrate=70), media(), media('140', 'mp4a.40.2', 256), encrypted])
        selected = streams.select_stream(data, VIDEO, now=1000)
        self.assertEqual(selected['codec'], 'opus')
        self.assertEqual(selected['bitrate_kbps'], 136)
        self.assertEqual(selected['duration'], 244)

    def test_unknown_encryption_state_is_not_treated_as_verified_drm_free(self):
        candidate = media(); candidate['has_drm'] = None
        with self.assertRaises(LookupError):
            streams.select_stream(metadata([candidate]), VIDEO, now=1000)

    def test_nonfinite_duration_expiry_and_bitrate_do_not_reach_the_player(self):
        for field, value in (('duration', float('nan')), ('duration', float('inf')),
                             ('expiry', 'nan'), ('expiry', 'inf'), ('abr', float('nan'))):
            candidate = media(); data = metadata([candidate])
            if field == 'duration': data['duration'] = value
            elif field == 'expiry': candidate['url'] = 'https://rr1.googlevideo.com/audio?expire=' + value
            else: candidate['abr'] = value
            with self.subTest(field=field, value=str(value)), self.assertRaises(LookupError):
                streams.select_stream(data, VIDEO, now=1000)

    def test_signed_reference_must_stay_on_the_https_googlevideo_media_host(self):
        urls = ('http://rr1.googlevideo.com/audio', 'https://rr1.googlevideo.com.evil.test/audio',
                'https://googlevideo.com/audio', 'https://u:p@rr1.googlevideo.com/audio',
                'https://rr1.googlevideo.com:444/audio', 'file:///C:/private')
        for url in urls:
            candidate = media(); candidate['url'] = url
            with self.subTest(url=url), self.assertRaises(LookupError):
                streams.select_stream(metadata([candidate]), VIDEO, now=1000)

    def test_expiring_reference_is_rejected_before_returning_it_to_the_player(self):
        candidate = media(); candidate['url'] = 'https://rr1.googlevideo.com/audio?expire=1010'
        with self.assertRaises(LookupError):
            streams.select_stream(metadata([candidate]), VIDEO, now=1000)

    def test_resolver_uses_no_cookie_config_or_media_download_and_caches_only_live_references(self):
        with patch('youtube_stream.Path.is_file', return_value=False), \
                patch('youtube_stream.shutil.which', side_effect=lambda name: '/tools/' + name), \
                patch('youtube_stream.time.time', return_value=1000), \
                patch('youtube_stream.run_extractor', return_value=(0, json.dumps(metadata()))) as run:
            first = streams.youtube_stream(VIDEO)
            second = streams.youtube_stream(VIDEO)
            self.assertEqual(first, second)
            self.assertNotIn('_cached_until', second)
            run.assert_called_once()
            args = run.call_args.args[0]
            self.assertIn('--ignore-config', args)
            self.assertIn('--skip-download', args)
            self.assertIn('--no-playlist', args)
            self.assertIn('--no-plugin-dirs', args)
            self.assertIn('--no-remote-components', args)
            self.assertIn('--no-cache-dir', args)
            self.assertFalse(any('cookie' in arg for arg in args))
            self.assertEqual(args[-1], 'https://www.youtube.com/watch?v=' + VIDEO)

    def test_managed_package_uses_only_its_embedded_module_and_pinned_node(self):
        with tempfile.TemporaryDirectory(prefix='YouTube 한글 ') as area:
            root = Path(area)
            for name in ('install-marker.json', 'runtime/python.exe', 'tools/node.exe',
                         'vendor/yt_dlp/__init__.py', 'vendor/yt_dlp_ejs/__init__.py',
                         'vendor/yt_dlp_ejs/yt/solver/core.min.js', 'vendor/yt_dlp_ejs/yt/solver/lib.min.js'):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'fixture')
            with patch('youtube_stream.shutil.which') as which:
                command, runtime = streams.resolve_engine(root)
            which.assert_not_called()
            self.assertEqual(command, [str(root / 'runtime/python.exe'), '-I', '-B', '-m', 'yt_dlp'])
            self.assertEqual(runtime, ['--no-js-runtimes', '--js-runtimes', 'node:' + str(root / 'tools/node.exe')])

    def test_incomplete_managed_package_never_substitutes_system_or_local_standalone_engine(self):
        with tempfile.TemporaryDirectory() as area:
            root = Path(area)
            (root / 'install-marker.json').write_text('{}')
            (root / 'tools').mkdir()
            (root / 'tools/yt-dlp.exe').write_bytes(b'external standalone fixture')
            with patch('youtube_stream.shutil.which', return_value='external.exe') as which:
                with self.assertRaisesRegex(LookupError, '누락'):
                    streams.resolve_engine(root)
            which.assert_not_called()

    def test_busy_engine_does_not_start_an_unbounded_second_process(self):
        streams._jobs.acquire()
        try:
            with patch('youtube_stream.run_extractor') as run, self.assertRaises(RuntimeError):
                streams.youtube_stream(VIDEO)
            run.assert_not_called()
        finally:
            streams._jobs.release()

    def test_timeout_releases_the_request_slot_and_does_not_return_extractor_diagnostics(self):
        with patch('youtube_stream.Path.is_file', return_value=False), \
                patch('youtube_stream.shutil.which', side_effect=lambda name: '/tools/' + name), \
                patch('youtube_stream.run_extractor', side_effect=subprocess.TimeoutExpired('extractor', 45)):
            with self.assertRaisesRegex(LookupError, '시간이 초과'):
                streams.youtube_stream(VIDEO)
        self.assertTrue(streams._jobs.acquire(blocking=False))
        streams._jobs.release()

    def test_extractor_returns_stdout_without_exposing_stderr_and_has_a_deadline(self):
        process = Mock(returncode=0)
        process.communicate.return_value = ('{"public":"metadata"}', 'diagnostic-with-synthetic-token')
        with patch('youtube_stream.subprocess.Popen', return_value=process) as popen:
            self.assertEqual(streams.run_extractor(['owned-extractor']), (0, '{"public":"metadata"}'))
        process.communicate.assert_called_once_with(timeout=45)
        self.assertEqual(popen.call_args.args[0], ['owned-extractor'])
        process.kill.assert_not_called()

    def test_extractor_timeout_kills_and_reaps_owned_parent_before_reraising(self):
        original = subprocess.TimeoutExpired(['owned-extractor'], 0.1)
        process = Mock(pid=500123)
        process.poll.return_value = None
        process.communicate.side_effect = [original, ('', '')]
        with patch('youtube_stream.subprocess.Popen', return_value=process), \
                patch('youtube_stream.subprocess.run') as taskkill:
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                streams.run_extractor(['owned-extractor'], timeout=0.1)
        self.assertIs(caught.exception, original)
        process.kill.assert_called_once()
        self.assertEqual(process.communicate.call_count, 2)
        if streams.os.name == 'nt':
            args = taskkill.call_args.args[0]
            self.assertTrue(args[0].lower().endswith('taskkill.exe'))
            self.assertEqual(args[1:], ['/PID', '500123', '/T', '/F'])
            self.assertEqual(taskkill.call_args.kwargs['timeout'], 10)
        else:
            taskkill.assert_not_called()

    @unittest.skipUnless(streams.os.name == 'nt', 'Windows owned-process-tree cleanup')
    def test_taskkill_failure_still_kills_parent_and_preserves_original_timeout(self):
        for failure in (OSError('synthetic taskkill failure'), subprocess.TimeoutExpired('taskkill', 10)):
            original = subprocess.TimeoutExpired(['owned-extractor'], 0.1)
            process = Mock(pid=500123)
            process.poll.return_value = None
            process.communicate.side_effect = [original, ('', '')]
            with self.subTest(failure=type(failure).__name__), \
                    patch('youtube_stream.subprocess.Popen', return_value=process), \
                    patch('youtube_stream.subprocess.run', side_effect=failure):
                with self.assertRaises(subprocess.TimeoutExpired) as caught:
                    streams.run_extractor(['owned-extractor'], timeout=0.1)
                self.assertIs(caught.exception, original)
                process.kill.assert_called_once()
                self.assertEqual(process.communicate.call_count, 2)

    def test_unresponsive_cleanup_closes_owned_pipes_without_replacing_original_timeout(self):
        original = subprocess.TimeoutExpired(['owned-extractor'], 0.1)
        process = Mock(pid=500123)
        process.communicate.side_effect = [original, subprocess.TimeoutExpired('cleanup', 10)]
        with patch('youtube_stream.subprocess.Popen', return_value=process), \
                patch('youtube_stream.subprocess.run'):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                streams.run_extractor(['owned-extractor'], timeout=0.1)
        self.assertIs(caught.exception, original)
        process.stdout.close.assert_called_once()
        process.stderr.close.assert_called_once()


class ToolchainPackagingTests(unittest.TestCase):
    def setUp(self):
        self.area = tempfile.TemporaryDirectory()
        self.addCleanup(self.area.cleanup)
        self.root = Path(self.area.name) / 'payload'
        self.cache = Path(self.area.name) / 'cache'
        self.cache.mkdir(); self.root.mkdir()
        self.manifest = {'components': {}, 'artifacts': {}}
        for name, version in (('yt_dlp', '2026.10.26'), ('yt_dlp_ejs', '0.8.0'), ('node', '24.22.1')):
            component = {'version': version, 'artifact': name + '.zip', 'source_artifact': name + '.tar.gz'}
            self.manifest['components'][name] = component
            source = self.cache / component['source_artifact']
            with tarfile.open(source, 'w:gz') as archive:
                data = b'original source license'
                member = tarfile.TarInfo(name + '/LICENSE'); member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            artifact = self.cache / component['artifact']
            with zipfile.ZipFile(artifact, 'w') as archive:
                if name == 'node':
                    archive.writestr('node.exe', b'MZ fixture')
                    archive.writestr('LICENSE', b'MIT License Node.js V8 original notices')
                elif name == 'yt_dlp_ejs':
                    archive.writestr('yt_dlp_ejs/yt/solver/core.min.js', b'core fixture')
                    archive.writestr('yt_dlp_ejs/yt/solver/lib.min.js', b'/*! Name: meriyah; Name: astring; original notices */library fixture')
                else: archive.writestr('yt_dlp/__init__.py', b'')
            for path in (source, artifact): self.register(path)
        node = self.manifest['components']['node']; node['binary_member'] = 'node.exe'; node['license_member'] = 'LICENSE'
        self.manifest['components']['yt_dlp']['required_ejs_version'] = '0.8.0'
        for name in ('yt_dlp', 'yt_dlp_ejs'):
            module = self.root / 'vendor' / name / '__init__.py'
            module.parent.mkdir(parents=True); module.write_bytes(b'')
        with zipfile.ZipFile(self.cache / self.manifest['components']['yt_dlp_ejs']['artifact']) as archive:
            for name in archive.namelist():
                target = self.root / 'vendor' / name
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(archive.read(name))

    def register(self, path):
        self.manifest['artifacts'][path.name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}

    def test_verified_inputs_generate_notices_and_explicit_no_path_fallback_receipt(self):
        result = prepare_youtube_tools(self.root, self.cache, self.manifest)
        self.assertFalse(result['remote_components']); self.assertFalse(result['system_path_fallback'])
        self.assertEqual(result['versions']['yt_dlp_ejs'], '0.8.0')
        self.assertIn(b'Name: meriyah', (self.root / 'licenses/YouTube-EJS-BUNDLED-LICENSES.txt').read_bytes())
        self.assertEqual(json.loads((self.root / 'tools/youtube-toolchain.json').read_text())['engine'], 'embedded-python-module')

    def test_corrupt_runtime_archive_is_rejected_before_any_executable_runs(self):
        (self.cache / self.manifest['components']['node']['artifact']).write_bytes(b'corrupted')
        with self.assertRaises(ValueError):
            prepare_youtube_tools(self.root, self.cache, self.manifest)

    def test_missing_python_module_does_not_silently_create_a_partial_toolchain(self):
        (self.root / 'vendor/yt_dlp/__init__.py').unlink()
        with self.assertRaisesRegex(ValueError, 'not installed'):
            prepare_youtube_tools(self.root, self.cache, self.manifest)

    def test_modified_installed_solver_is_not_accepted_as_the_pinned_ejs_wheel(self):
        (self.root / 'vendor/yt_dlp_ejs/yt/solver/core.min.js').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'differ from the pinned wheel'):
            prepare_youtube_tools(self.root, self.cache, self.manifest)


if __name__ == '__main__':
    unittest.main()
