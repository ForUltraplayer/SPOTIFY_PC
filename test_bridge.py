# @file test_bridge.py
# @brief Verify extraction, safe matching, cache behavior, and source URL restrictions.
import tempfile
import json
import unittest
import threading
from pathlib import Path
from bridge import (LyricDocument, extract_pairs, align_lines, match_pairs, Reader, allowed_url,
                    pykakasi, monitor_lifetime, title_candidates, lyric_search_queries, HaneumDocument, SupersededLookup)
from phonetics import kana_to_hangul, japanese_to_hangul
import urllib.parse
from unittest.mock import Mock, MagicMock, patch
from bridge import youtube_metadata
from youtube_stream import select_stream, youtube_stream


class YouTubeStreamTests(unittest.TestCase):
    def fixture(self):
        return {'id': '_-uHa5KiR90', 'availability': 'public', 'age_limit': 0, 'duration': 244,
                'formats': [{'format_id': '251', 'vcodec': 'none', 'acodec': 'opus', 'abr': 136,
                             'has_drm': False, 'url': 'https://r1.googlevideo.com/videoplayback?expire=2000'}]}

    def test_opus_selection_excludes_aac_drm_and_external_hosts(self):
        data = self.fixture()
        data['formats'] += [{**data['formats'][0], 'abr': 999, 'has_drm': True},
                            {**data['formats'][0], 'abr': 999, 'url': 'https://googlevideo.com.evil.test/x'},
                            {**data['formats'][0], 'abr': 999, 'acodec': 'mp4a.40.2'}]
        self.assertEqual(select_stream(data, '_-uHa5KiR90', now=1000)['bitrate_kbps'], 136)

    def test_private_age_restricted_and_changed_id_are_not_resolved(self):
        for changes in ({'availability': 'private'}, {'age_limit': 18}, {'id': 'abcdefghijk'}):
            with self.subTest(changes=changes), self.assertRaises(LookupError):
                select_stream({**self.fixture(), **changes}, '_-uHa5KiR90', now=1000)

    def test_expired_or_unsupported_audio_is_not_returned(self):
        with self.assertRaises(LookupError):
            select_stream(self.fixture(), '_-uHa5KiR90', now=1990)
        data = self.fixture()
        data['formats'][0]['acodec'] = 'mp4a.40.2'
        with self.assertRaises(LookupError):
            select_stream(data, '_-uHa5KiR90', now=1000)

    def test_stream_rejects_urls_before_starting_an_external_process(self):
        with patch('youtube_stream.subprocess.run') as run:
            for value in ('https://youtube.com/watch?v=_-uHa5KiR90', '../private', '', None):
                with self.assertRaises(ValueError):
                    youtube_stream(value)
            run.assert_not_called()


PAIRS = [("月の道を歩く", "츠키노 미치오 아루쿠"), ("青い鳥が飛ぶ", "아오이 토리가 토부"),
         ("明日の空を見る", "아시타노 소라오 미루"), ("遠い街へ向かう", "토오이 마치에 무카우"),
         ("静かな夜に歌う", "시즈카나 요루니 우타우")]
TEXT = "\n".join(original for original, _ in PAIRS)
HTML = "<html><title>테스트 곡</title><script>무관한 내용</script>" + "".join(
    f"<div><span lang='ja'>{original}</span><br>{reading}<br>테스트 해석입니다</div>"
    for original, reading in PAIRS) + "</html>"
HANEUM_HTML = ''.join(f'<div class="border-b pb-5"><p>{reading}</p><p>{original}</p><p>테스트 해석입니다</p></div>'
                      for original, reading in PAIRS)


class HelperServerTests(unittest.TestCase):
    def test_windows_duplicate_helper_cannot_share_the_port(self):
        import bridge
        self.assertEqual(bridge.HelperServer.allow_reuse_address, bridge.os.name != 'nt')
        # A burst of polls must not overflow the listen backlog and get reset ("Failed to fetch").
        self.assertGreaterEqual(bridge.HelperServer.request_queue_size, 128)
        if bridge.os.name != 'nt':
            self.skipTest('Windows socket sharing only')
        first = bridge.HelperServer(('127.0.0.1', 0), bridge.BaseHTTPRequestHandler)
        try:
            with self.assertRaises(OSError):
                bridge.HelperServer(first.server_address, bridge.BaseHTTPRequestHandler)
        finally:
            first.server_close()

    def test_connections_stay_open_across_requests(self):
        # Network filters reset loopback responses the server closes first, so the helper keeps
        # connections alive; a rejected request's body must not leak into the next request.
        import bridge, http.client, socket
        servers = []
        class Recorded(bridge.HelperServer):
            def __init__(self, *args):
                super().__init__(*args)
                servers.append(self)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        with patch.object(bridge, 'HelperServer', Recorded):
            threading.Thread(target=bridge.serve, kwargs={'port': port, 'lifetime': False}, daemon=True).start()
            for _ in range(100):
                if servers:
                    break
                threading.Event().wait(0.05)
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        try:
            body = json.dumps({'video_id': 'x' * 30})
            requests = [('GET', '/health', None, {}),
                        ('POST', '/youtube/metadata', body, {'Content-Type': 'application/json'}),
                        ('POST', '/missing', body, {'X-Hangul-Lyrics-Client': 'ivlyrics'}),
                        ('OPTIONS', '/youtube/metadata', None, {'Origin': bridge.ORIGIN}),
                        ('GET', '/health', None, {})]
            statuses = []
            for method, path, payload, headers in requests:
                connection.request(method, path, body=payload, headers=headers)
                response = connection.getresponse()
                response.read()
                statuses.append(response.status)
                self.assertFalse(response.will_close, path)
            self.assertEqual(statuses, [200, 403, 404, 204, 200])
        finally:
            connection.close()
            servers[0].shutdown()


    def test_process_check_finds_this_interpreter_by_image_name(self):
        import bridge, sys
        if bridge.os.name != 'nt':
            self.skipTest('Windows process snapshot only')
        self.assertTrue(bridge.process_running(Path(sys.executable).name.casefold()))
        self.assertFalse(bridge.process_running('no-such-hangul-process.exe'))


class LaunchEndpointTests(unittest.TestCase):
    # Every test replaces the process launcher; nothing here starts the real overlay or updater.
    def setUp(self):
        import bridge
        self.bridge = bridge
        self.area = Path(tempfile.mkdtemp())
        self.addCleanup(__import__('shutil').rmtree, self.area, True)
        self.popen = patch.object(bridge.subprocess, 'Popen').start()
        self.running = patch.object(bridge, 'process_running', return_value=False).start()
        patch.dict(bridge.os.environ, {'LOCALAPPDATA': str(self.area), 'SystemRoot': r'C:\Windows'}).start()
        self.addCleanup(patch.stopall)

    def install_overlay(self):
        executable = self.area / 'lyrics-plus-overlay' / 'lyrics-plus-overlay.exe'
        executable.parent.mkdir()
        executable.write_bytes(b'')
        return executable

    def detached_flags(self):
        return getattr(self.bridge.subprocess, 'DETACHED_PROCESS', 0) | getattr(self.bridge.subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)

    def test_overlay_starts_detached_from_the_fixed_install_path_once(self):
        self.assertEqual(self.bridge.launch_overlay(), 'missing')
        self.popen.assert_not_called()
        executable = self.install_overlay()
        self.assertEqual(self.bridge.launch_overlay(), 'started')
        self.popen.assert_called_once()
        args, kwargs = self.popen.call_args
        self.assertEqual(args[0], [str(executable)])
        self.assertEqual(Path(kwargs['cwd']), executable.parent)
        self.assertEqual(kwargs['creationflags'], self.detached_flags())
        self.assertTrue(kwargs['close_fds'])
        self.running.assert_called_with('lyrics-plus-overlay.exe')
        self.running.return_value = True
        self.assertEqual(self.bridge.launch_overlay(), 'running')
        self.popen.assert_called_once()

    def test_overlay_without_local_app_data_is_missing(self):
        with patch.dict(self.bridge.os.environ, {'LOCALAPPDATA': ''}):
            self.assertEqual(self.bridge.launch_overlay(), 'missing')
        self.popen.assert_not_called()

    def test_update_check_runs_the_installed_updater_hidden_outside_the_install_folder(self):
        root = self.area / 'SpotifyHangul'
        root.mkdir()
        with patch.object(self.bridge, '__file__', str(root / 'bridge.py')):
            self.assertFalse(self.bridge.launch_update_check())
            self.popen.assert_not_called()
            (root / 'auto-update.ps1').write_text('', encoding='utf-8')
            self.assertTrue(self.bridge.launch_update_check())
        args, kwargs = self.popen.call_args
        system = Path(r'C:\Windows') / 'System32'
        self.assertEqual(args[0], [str(system / 'WindowsPowerShell' / 'v1.0' / 'powershell.exe'),
                                   '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
                                   '-File', str(root / 'auto-update.ps1'), '-Mode', 'Check', '-IgnoreInterval', '-Manual',
                                   '-InstallRoot', str(root)])
        # A windowless console, not DETACHED_PROCESS, and no conhost --headless whose empty stdin ends it at once.
        self.assertEqual(kwargs['creationflags'], 0x08000000 | 0x00000200)
        self.assertNotEqual(Path(kwargs['cwd']).resolve(), root.resolve())

    def test_endpoints_share_a_keep_alive_connection_and_reject_foreign_callers(self):
        import http.client, socket
        bridge = self.bridge
        servers = []
        class Recorded(bridge.HelperServer):
            def __init__(self, *args):
                super().__init__(*args)
                servers.append(self)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        with patch.object(bridge, 'HelperServer', Recorded):
            threading.Thread(target=bridge.serve, kwargs={'port': port, 'lifetime': False}, daemon=True).start()
            for _ in range(100):
                if servers:
                    break
                threading.Event().wait(0.05)
        self.addCleanup(lambda: servers[0].shutdown())
        client = {'Origin': bridge.ORIGIN, 'X-Hangul-Lyrics-Client': 'ivlyrics'}
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        self.addCleanup(connection.close)
        def post(path, body=None, headers=client):
            connection.request('POST', path, body=body, headers=headers)
            response = connection.getresponse()
            payload = json.loads(response.read())
            self.assertFalse(response.will_close, path)
            return response.status, payload
        self.assertEqual(post('/overlay/launch'), (404, {'status': 'missing'}))
        self.install_overlay()
        self.assertEqual(post('/overlay/launch', '{"path": "C:/Windows/System32/calc.exe"}',
                              {**client, 'Content-Type': 'application/json'}), (200, {'status': 'started'}))
        self.running.return_value = True
        self.assertEqual(post('/overlay/launch'), (200, {'status': 'running'}))
        self.assertEqual(self.popen.call_count, 1)
        self.assertEqual(Path(self.popen.call_args[0][0][0]).name, 'lyrics-plus-overlay.exe')
        for headers in ({**client, 'Origin': 'https://evil.example'}, {'Origin': bridge.ORIGIN}):
            self.assertEqual(post('/overlay/launch', '{}', headers)[0], 403)
            self.assertEqual(post('/update/check', '{}', headers)[0], 403)
        self.assertEqual(post('/overlay/launch', 'x' * 5000)[0], 400)
        with patch.object(bridge, 'launch_update_check', return_value=True) as update:
            self.assertEqual(post('/update/check', '{}', {**client, 'Content-Type': 'application/json'}), (202, {'status': 'started'}))
            self.assertEqual(post('/update/check')[1], {'status': 'started'})
        self.assertEqual(update.call_count, 2)
        with patch.object(bridge, 'launch_update_check', return_value=False):
            self.assertEqual(post('/update/check'), (404, {'status': 'missing', 'error': '업데이트 프로그램이 설치되지 않았습니다.'}))
        self.popen.side_effect = OSError('denied')
        self.running.return_value = False
        self.assertEqual(post('/overlay/launch')[0], 500)
        connection.request('GET', '/health')
        health = json.loads(connection.getresponse().read())
        self.assertIn('overlay-launch-v1', health['capabilities'])
        self.assertIn('update-check-v1', health['capabilities'])


class ReaderTests(unittest.TestCase):
    def test_foreground_retry_bypasses_a_miss_and_recovers_existing_readings(self):
        calls = []
        def fetch(url):
            calls.append(url)
            if len(calls) == 1:
                raise OSError('temporary source failure')
            return HTML, url
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            params = dict(title='Test', artist='Artist', text=TEXT, source_url='https://namu.wiki/w/Test',
                          track_id='test', foreground=True)
            with self.assertRaises(LookupError):
                reader.resolve(params)
            with self.assertRaises(LookupError):
                reader.resolve(params)
            self.assertEqual(len(calls), 1)
            recovered = reader.resolve({**params, 'retry_attempt': 1})
            self.assertEqual(recovered['phonetic'], [reading for _, reading in PAIRS])
            self.assertEqual(len(calls), 2)
            self.assertFalse(reader.negative)
            self.assertTrue(reader.resolve(params)['cache'])
            self.assertEqual(len(calls), 2)

    def test_source_retries_are_bounded_even_if_the_ui_is_reopened(self):
        fetch = Mock(return_value=('<html>No readings</html>', 'https://namu.wiki/w/Test'))
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            params = dict(title='Test', artist='Artist', text=TEXT, source_url='https://namu.wiki/w/Test',
                          track_id='test', foreground=True)
            for attempt in (0, 1, 2, 3, 0, 1, 2, 3):
                with self.assertRaises(LookupError):
                    reader.resolve({**params, 'retry_attempt': attempt})
            self.assertEqual(fetch.call_count, 4)
            for invalid in (True, -1, 4, '1'):
                with self.assertRaises(ValueError):
                    reader.resolve({**params, 'retry_attempt': invalid})
            self.assertEqual(fetch.call_count, 4)

    def test_prefetch_does_not_bypass_negative_reading_cache(self):
        fetch = Mock(return_value=('<html>No readings</html>', 'https://namu.wiki/w/Test'))
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            params = dict(title='Test', artist='Artist', text=TEXT, source_url='https://namu.wiki/w/Test')
            for attempt in (0, 1, 2):
                with self.assertRaises(LookupError):
                    reader.resolve({**params, 'retry_attempt': attempt})
            self.assertEqual(fetch.call_count, 1)

    def test_extract_triples_and_ignore_furigana_footnotes(self):
        document = LyricDocument()
        document.feed(HTML.replace("月", "<ruby>月<rt>つき</rt></ruby>").replace("<br>", "<a href='#fn-1'>[1]</a><br>"))
        self.assertEqual(extract_pairs(document), PAIRS)

    def test_translation_only_is_not_a_pronunciation(self):
        document = LyricDocument()
        document.feed("".join(f"<p>{original}<br>한국어 해석입니다</p>" for original, _ in PAIRS))
        self.assertEqual(extract_pairs(document), [])

    def test_repeat_count_annotations_do_not_break_original_reading_meaning_triples(self):
        document = LyricDocument()
        document.feed('<p>歌いたい<span>X16</span><br>우타이타이<span>X16</span><br>노래하고 싶어<span>X16</span></p>'
                      .replace('<span>', '<div>').replace('</span>', '</div>') + HTML)
        pairs = extract_pairs(document)
        self.assertIn(('歌いたい', '우타이타이'), pairs)
        text = '\n'.join(['歌いたい'] * 35 + [original for original, _ in PAIRS])
        result = match_pairs(text, pairs)
        self.assertTrue(result['valid'])
        self.assertEqual(result['matched'], 40)
        self.assertEqual(result['phonetic'][:35], ['우타이타이'] * 35)

    def test_exact_match_keeps_blank_and_english_lines(self):
        result = align_lines("\n" + TEXT + "\nHello world\n", PAIRS)
        self.assertTrue(result['valid'])
        self.assertEqual(result['phonetic'], [""] + [reading for _, reading in PAIRS] + ['Hello world', ''])

    @unittest.skipUnless(pykakasi, 'Optional local Japanese comparison dictionary is not installed')
    def test_wrapped_korean_meaning_is_not_accepted_as_reading(self):
        document = LyricDocument()
        document.feed(''.join(f'<p>{original}<br>달빛 아래에서 걷고 있습니다<br>한국어 해석을 이어서 적습니다</p>'
                              for original, _ in PAIRS))
        self.assertEqual(extract_pairs(document), [])

    def test_split_timestamps_reuse_full_sentence_without_guessing(self):
        text = TEXT.replace("月の道を歩く", "月の道\nを歩く")
        result = align_lines(text, PAIRS)
        self.assertTrue(result['valid'])
        self.assertEqual(result['grouped_lines'], [0, 1])
        self.assertEqual(result['phonetic'][:2], [PAIRS[0][1]] * 2)

    def test_combined_timestamps_join_existing_readings(self):
        result = align_lines(TEXT.replace("月の道を歩く\n青い鳥が飛ぶ", "月の道を歩く青い鳥が飛ぶ"), PAIRS)
        self.assertTrue(result['valid'])
        self.assertEqual(result['phonetic'][0], PAIRS[0][1] + ' ' + PAIRS[1][1])

    def test_wrong_song_and_partial_chorus_fail_closed(self):
        self.assertFalse(align_lines(TEXT, [("愛している", "아이시테이루")])['valid'])
        self.assertFalse(align_lines(TEXT, PAIRS[:2])['valid'])

    def test_equivalent_japanese_glyphs_and_kana_only_affect_matching(self):
        rows = [("帰るように涙を払う", "카에루 요오니 나미다오 하라우"), *PAIRS]
        result = align_lines("歸るように淚を拂う\n" + TEXT, rows)
        self.assertTrue(result['valid'])
        self.assertEqual(result['phonetic'][0], rows[0][1])

    @unittest.skipUnless(pykakasi, 'Optional local Japanese comparison dictionary is not installed')
    def test_kana_and_kanji_spelling_reuse_authored_reading(self):
        rows = [('君が弱くはないのわかってた', '키미가 요와쿠와 나이노 와캇테타'), *PAIRS]
        original = '君が弱くはないの分かってた\n' + TEXT
        result = match_pairs(original, rows)
        self.assertTrue(result['valid'])
        self.assertEqual(result['phonetic'][0], rows[0][1])

    def test_minor_missing_line_is_explicit(self):
        larger = PAIRS * 2 + [("知らない言葉を探す", "시라나이 코토바오 사가스")]
        result = align_lines("\n".join(original for original, _ in larger), PAIRS)
        self.assertTrue(result['valid'])
        self.assertEqual(result['phonetic'][-1], '(발음 자료 없음)')

    def test_url_restrictions_include_redirect_destinations(self):
        for url in ['http://namu.wiki/w/test', 'https://127.0.0.1/', 'https://namu.wiki.evil.example/',
                    'https://x.tistory.com.evil.example/', 'https://user:pass@namu.wiki/', 'https://namu.wiki:8443/']:
            with self.assertRaises(ValueError):
                allowed_url(url)
        self.assertEqual(allowed_url('https://namu.wiki/w/test#section'), 'https://namu.wiki/w/test')
        self.assertEqual(allowed_url('https://example.tistory.com/1'), 'https://example.tistory.com/1')

    def test_bilingual_spotify_title_uses_japanese_document_name(self):
        reader = Reader('unused-test-state', lambda _: ('<html></html>', 'https://namu.wiki/'))
        first = next(reader.candidates('ピースサイン - Peace Sign', 'Kenshi Yonezu'))
        self.assertTrue(first.endswith('%E3%83%94%E3%83%BC%E3%82%B9%E3%82%B5%E3%82%A4%E3%83%B3'))

    def test_cover_titles_keep_the_song_and_remove_performer_metadata(self):
        cases = [
            ('Lemon (Kenshi Yonezu Cover)', 'A Cover Singer', 'Lemon'),
            ('Lemon - Covered by Example', 'Example', 'Lemon'),
            ('【Example】夜に駆ける / YOASOBI【歌ってみた】', 'Example', '夜に駆ける'),
            ('Kenshi Yonezu - Lemon (cover)', 'Example', 'Lemon'),
            ('커버: Lemon', 'Example', 'Lemon'),
            ('Lemon - Acoustic Cover', 'Example', 'Lemon'),
            ('モニタリング (feat. Hatsune Miku)', 'DECO*27', 'モニタリング'),
            ('モニタリング - feat. 初音ミク', 'DECO*27', 'モニタリング'),
        ]
        for title, artist, expected in cases:
            with self.subTest(title=title):
                self.assertEqual(title_candidates(title, artist)[0], expected)
        # A slash or corner bracket inside the title is kept unless it separates an artist.
        self.assertEqual(title_candidates('ハロ／ハワユ', 'ナノウ')[0], 'ハロ/ハワユ')
        self.assertEqual(title_candidates('W / X / Y', 'Tani Yuuki')[0], 'W / X / Y')
        self.assertEqual(title_candidates('Be The MUSIC! (feat. 「Rising」一同)', 'Example')[0], 'Be The MUSIC!')
        self.assertIn('Cover Girl', title_candidates('Cover Girl', 'Example'))
        self.assertEqual(title_candidates('Cover', 'Example'), ['Cover'])

    def test_cover_matches_original_even_when_artist_is_different(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return HTML, url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='Test Song (Original Artist cover)', artist='Cover Artist', text=TEXT))
        self.assertTrue(result['valid'])
        self.assertTrue(any(url.endswith('/Test%20Song') for url in calls))
        self.assertEqual(result['artist'], 'Cover Artist')
        self.assertEqual(result['phonetic'], [reading for _, reading in PAIRS])

    def test_shortened_and_repeated_cover_keeps_its_own_line_order(self):
        selected = [PAIRS[3], PAIRS[1], PAIRS[1], PAIRS[0], PAIRS[4]]
        result = match_pairs('\n'.join(original for original, _ in selected), PAIRS)
        self.assertTrue(result['valid'])
        self.assertEqual(result['phonetic'], [reading for _, reading in selected])

    def test_renamed_cover_falls_back_to_original_lyric_search(self):
        original = '月の道を歩く遠い街へ向かう'
        pairs = [(original, '츠키노 미치오 아루쿠 토오이 마치에 무카우'), *PAIRS]
        text = '\n'.join(line for line, _ in pairs)
        page = ''.join(f'<p>{line}<br>{reading}<br>테스트 해석입니다</p>' for line, reading in pairs)
        queries = []
        def fetch(url):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get('q', [''])[0]
            if query:
                queries.append(query)
                return ('<a href="/w/OriginalSong">원곡</a>' if query == original else '<html></html>'), url
            return (page if url.endswith('/OriginalSong') else '<html></html>'), url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='Different Cover Title', artist='Other Singer', text=text))
        self.assertIn(original, queries)
        self.assertTrue(result['source_url'].endswith('/OriginalSong'))
        self.assertEqual(len(result['phonetic']), len(pairs))

    def test_cover_follows_original_song_link_in_same_name_article(self):
        calls = []
        def fetch(url):
            calls.append(url)
            if url.endswith('/TestSong'):
                return '<a href="/w/TestSong(OriginalArtist)">동명의 원곡</a>', url
            return HTML, url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='TestSong (cover)', artist='Other Singer', text=TEXT))
        self.assertEqual(len([url for url in calls if url.startswith('https://namu.wiki/')]), 2)
        self.assertTrue(result['source_url'].endswith('/TestSong(OriginalArtist)'))
        self.assertEqual(result['matched'], 5)

    def test_lyric_search_queries_are_distinctive_and_bounded(self):
        first = '月の道を歩く遠い街へ向かう'
        second = '青い鳥が飛ぶ明日の空を見る'
        self.assertEqual(lyric_search_queries('ああ\n' + first + '\n' + first + '\n' + second + '\n' + TEXT), [first, second])

    def test_legacy_cache_label_is_hidden_without_deleting_lyrics(self):
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, lambda url: (HTML, url))
            params = dict(title='test', artist='artist', text=TEXT)
            first = reader.resolve(params)
            record = next(iter(reader.cache.values()))
            record['phonetic'][0] = '〔문장 전체〕' + record['phonetic'][0]
            second = reader.resolve(params)
            self.assertEqual(second['phonetic'][0], PAIRS[0][1])
            self.assertEqual(len(first['phonetic']), len(second['phonetic']))
            self.assertEqual(first['source_url'], second['source_url'])

    def test_success_cache_preserves_line_contract_and_provenance(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return HTML, url
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            params = dict(title='test', artist='artist', text='\n' + TEXT + '\n')
            first = reader.resolve(params)
            initial_calls = len(calls)
            second = reader.resolve(params)
            self.assertFalse(first['cache'])
            self.assertTrue(second['cache'])
            self.assertEqual(len(calls), initial_calls)
            self.assertEqual(len(first['phonetic']), len(params['text'].split('\n')))
            self.assertEqual(first['source_url'], calls[-1])
            self.assertTrue((Path(directory) / 'cache.json').is_file())

    def test_negative_cache_prevents_repeated_network_retries(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return '<html>자료 없음</html>', url
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            for _ in range(2):
                with self.assertRaises(LookupError):
                    reader.resolve(dict(title='test', artist='artist', text=TEXT))
            self.assertEqual(len(calls), 4)  # Haneum, direct title, title search, body-title search; first request only.

    def test_original_title_in_body_finds_translated_korean_document_and_learns_alias(self):
        calls = []
        def fetch(url):
            calls.append(url)
            parsed = urllib.parse.urlsplit(url)
            query = urllib.parse.parse_qs(parsed.query)
            if query.get('q') == ['Foreign Title'] and query.get('target') == ['content']:
                return '<a href="/w/다른한글제목">원제 Foreign Title</a>', url
            if urllib.parse.unquote(parsed.path) == '/w/다른한글제목':
                return HTML, url
            return '<html></html>', url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='Foreign Title', artist='Artist', text=TEXT))
            self.assertEqual(urllib.parse.unquote(result['source_url']), 'https://namu.wiki/w/다른한글제목')
            self.assertEqual(result['matched'], 5)
            self.assertTrue((Path(directory) / 'aliases.json').exists())
            reloaded = Reader(directory, fetch)
            self.assertEqual(next(reloaded.candidates('Foreign Title', 'Artist')), result['source_url'])
            self.assertNotEqual(next(reloaded.candidates('Foreign Title', 'Other Artist')), result['source_url'])

    def test_learned_alias_is_not_identity_proof_for_different_lyrics(self):
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, lambda url: (HTML, url))
            reader.resolve(dict(title='Test', artist='Artist', text=TEXT))
            # A later lyric variant must be compared again even with a learned address.
            different = '\n'.join(['知らない物語を探し続ける'] * 6)
            with self.assertRaises(LookupError):
                Reader(directory, lambda url: (HTML, url)).resolve(dict(title='Test', artist='Artist', text=different))

    def test_expired_alias_is_not_used_as_a_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, lambda url: ('<html></html>', url))
            key = reader.alias_key('Test', 'Artist')
            (Path(directory) / 'aliases.json').write_text(json.dumps({key: {
                'source_url': 'https://namu.wiki/w/Stale', 'checked_at': 1}}), encoding='utf-8')
            self.assertFalse(next(Reader(directory, reader.fetcher).candidates('Test', 'Artist')).endswith('/Stale'))

    def test_haneum_paragraph_order_and_meaning_validation(self):
        document = HaneumDocument()
        document.feed(HANEUM_HTML)
        self.assertEqual(extract_pairs(document), PAIRS)
        document = HaneumDocument()
        document.feed(HANEUM_HTML.replace(PAIRS[0][1], '오늘은 날씨가 아주 좋습니다'))
        self.assertNotIn(PAIRS[0], extract_pairs(document))

    def test_haneum_search_uses_literal_links_without_executing_page_code(self):
        document = LyricDocument()
        document.feed('''<div onclick="location.href='/songs/test'"></div>
            <div onclick="location.href='https://evil.example/'"></div>
            <div onclick="alert(1);location.href='/songs/other'"></div>''')
        self.assertEqual(document.links, ['/songs/test'])
        for url in ['https://haneum.site.evil.example/songs/test', 'https://haneum.site/admin', 'https://haneum.site:8443/songs/test']:
            with self.assertRaises(ValueError):
                allowed_url(url)
        self.assertEqual(allowed_url('https://haneum.site/songs/test#lyrics'), 'https://haneum.site/songs/test')

    def test_haneum_discovery_preserves_cover_identity_and_reuses_cache(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return (HANEUM_HTML if '/songs/original' in url else '<div onclick="location.href=\'/songs/original\'"></div>'), url
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            params = dict(title='Test (cover)', artist='Cover Singer', text=TEXT)
            result = reader.resolve(params)
            again = reader.resolve(params)
        self.assertEqual(result['source_url'], 'https://haneum.site/songs/original')
        self.assertEqual(result['artist'], 'Cover Singer')
        self.assertEqual(result['phonetic'], [reading for _, reading in PAIRS])
        self.assertTrue(again['cache'])
        self.assertEqual(len([url for url in calls if 'haneum.site' in url]), 2)

    def test_wrong_haneum_song_does_not_override_original_lyrics(self):
        wrong = '<div class="border-b"><p>사랑해</p><p>愛している</p><p>너를 사랑해</p></div>'
        def fetch(url):
            if url.startswith('https://haneum.site/songs?'):
                return '<div onclick="location.href=\'/songs/wrong\'"></div>', url
            return (wrong if 'haneum.site' in url else HTML), url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='Test', artist='Other Artist', text=TEXT))
        self.assertTrue(result['source_url'].startswith('https://namu.wiki/'))
        self.assertEqual(result['phonetic'], [reading for _, reading in PAIRS])

    @unittest.skipUnless(pykakasi, 'Local dictionary is required')
    def test_automatic_is_opt_in_and_negative_cache_can_use_it(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return '<html>자료 없음</html>', url
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            params = dict(title='Test', artist='Artist', text=TEXT + '\nHello World\n')
            with self.assertRaises(LookupError):
                reader.resolve(params)
            count = len(calls)
            result = reader.resolve({**params, 'automatic_fallback': True})
            self.assertEqual(len(calls), count)
            self.assertEqual(result['reading_kind'], 'automatic')
            self.assertEqual(result['matched'], 0)
            self.assertEqual(len(result['generated_lines']), 5)
            self.assertEqual(result['phonetic'][-2:], ['Hello World', ''])
            self.assertEqual(result['source_url'], '')
            self.assertFalse((Path(directory) / 'cache.json').exists())
            with self.assertRaises(LookupError):
                reader.resolve(params)

    @unittest.skipUnless(pykakasi, 'Local dictionary is required')
    def test_automatic_missing_rows_never_overwrite_authored_cache(self):
        text = TEXT + '\n' + TEXT + '\n新しい世界'
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, lambda url: (HTML, url))
            params = dict(title='Test', artist='Artist', text=text)
            result = reader.resolve({**params, 'automatic_fallback': True})
            self.assertEqual(result['reading_kind'], 'mixed')
            self.assertEqual(result['generated_lines'], [10])
            self.assertEqual(result['matched'], 10)
            self.assertEqual(result['phonetic'][-1], '아타라시이세카이')
            original = reader.resolve(params)
            self.assertEqual(original['phonetic'][-1], '(발음 자료 없음)')
            self.assertEqual(original['reading_kind'], 'authored')

    def test_kana_conversion_handles_mora_and_keeps_non_japanese(self):
        # Follows authored lyric conventions: long vowels dropped, っ as ㅅ, ん as ㄴ, じょ as 조.
        for kana, expected in [('キャット', '캿토'), ('スーパー', '수파'), ('しんぶん', '신분'),
                               ('フィナーレ', '피나레'), ('アイデンティティ', '아이덴티티'),
                               ('どうして', '도시테'), ('とうきょう', '토쿄'), ('ねえ', '네'), ('ゲーム', '게이무'),
                               ('ショッピング', '숏핀구'), ('じょうしき', '조시키'), ('いい', '이이'),
                               ('Love 123!', 'Love 123!')]:
            self.assertEqual(kana_to_hangul(kana), expected)

    def test_token_boundaries_and_verb_endings_follow_the_whole_line(self):
        class Tokens:
            def __init__(self, tokens): self.tokens = tokens
            def convert(self, _text): return [{'orig': o, 'hira': h} for o, h in self.tokens]
        # A sokuon split from its syllable by tokenization still becomes a final consonant.
        self.assertEqual(japanese_to_hangul('わっ', Tokens([('わ', 'わ'), ('っ', 'っ')])), '왓')
        # A kanji verb's okurigana う is spoken; a volitional ょう is a long vowel.
        self.assertEqual(japanese_to_hangul('思う', Tokens([('思う', 'おもう')])), '오모우')
        self.assertEqual(japanese_to_hangul('遊びましょう', Tokens([('遊びましょう', 'あそびましょう')])), '아소비마쇼')
        self.assertEqual(japanese_to_hangul('今日', Tokens([('今日', 'きょう')])), '쿄')

    def test_automatic_setting_rejects_truthy_strings(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                Reader(directory).resolve(dict(title='Test', text=TEXT, automatic_fallback='false'))

    def test_verified_partial_document_is_returned_without_searching_other_sources(self):
        calls = []
        text = TEXT + '\n' + TEXT + '\n新しい世界'
        def fetch(url):
            calls.append(url)
            return HTML, url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='Test', artist='Artist', text=text))
        self.assertTrue(result['valid'])
        self.assertEqual(result['matched'], 10)
        self.assertEqual(len(calls), 1)

    def test_new_foreground_cancels_older_lookup_without_negative_caching(self):
        entered, proceed = threading.Event(), threading.Event()
        outcome = []
        def fetch(url):
            if url.endswith('/Old'):
                entered.set()
                if not proceed.wait(2):
                    raise AssertionError('test synchronization timed out')
            return HTML, url
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, fetch)
            def old_request():
                try:
                    reader.resolve(dict(title='Old', artist='Artist', text=TEXT, track_id='old', foreground=True))
                except Exception as error:
                    outcome.append(error)
            thread = threading.Thread(target=old_request)
            thread.start()
            self.assertTrue(entered.wait(2))
            latest = reader.resolve(dict(title='New', artist='Artist', text=TEXT, track_id='new', foreground=True))
            proceed.set()
            thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertTrue(latest['valid'])
            self.assertIsInstance(outcome[0], SupersededLookup)
            self.assertFalse(reader.negative)

    def test_legacy_callers_do_not_supersede_foreground_lookups(self):
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, lambda url: (HTML, url))
            reader.resolve(dict(title='Test', artist='Artist', text=TEXT, track_id='active', foreground=True))
            epoch = reader.lookup_epoch
            reader.resolve(dict(title='Legacy', artist='Artist', text=TEXT))
            self.assertEqual(reader.lookup_epoch, epoch)

    def test_first_acceptable_source_does_not_hide_a_more_complete_source(self):
        larger = PAIRS * 2 + [('新しい世界', '아타라시이세카이')]
        text = '\n'.join(original for original, _ in larger)
        complete = HTML + '<p>新しい世界<br>아타라시이세카이<br>새로운 세계라는 뜻입니다</p>'
        def fetch(url):
            if 'haneum.site/songs?' in url:
                return '<div onclick="location.href=\'/songs/partial\'"></div>', url
            return (HANEUM_HTML if 'haneum.site' in url else complete), url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='Test', artist='Artist', text=text))
        self.assertEqual(result['matched'], 11)
        self.assertTrue(result['source_url'].startswith('https://namu.wiki/'))

    def test_old_partial_cache_is_refreshed_and_preserved_if_network_fails(self):
        text = TEXT + '\n' + TEXT + '\n新しい世界'
        with tempfile.TemporaryDirectory() as directory:
            reader = Reader(directory, lambda url: (HTML, url))
            params = dict(title='Test', artist='Artist', text=text)
            first = reader.resolve(params)
            record = next(iter(reader.cache.values()))
            record.pop('matching_version')
            def unavailable(url):
                raise OSError('Network unavailable')
            reader.fetcher = unavailable
            second = reader.resolve(params)
            self.assertTrue(second['refresh_failed'])
            self.assertEqual(first['phonetic'], second['phonetic'])

    def test_japanese_alias_follows_observed_hangul_redirect_name(self):
        calls = []
        def fetch(url):
            calls.append(url)
            if '/songs?' in url:
                return '<html></html>', url
            if url.endswith('/' + urllib.parse.quote('別名')):
                return '<a href="/w/한글제목(원곡)">원곡</a>', 'https://namu.wiki/w/한글제목?from=別名'
            return HTML, url
        with tempfile.TemporaryDirectory() as directory:
            result = Reader(directory, fetch).resolve(dict(title='別名', artist='Cover Artist', text=TEXT))
        self.assertEqual(result['source_url'], 'https://namu.wiki/w/한글제목(원곡)')

    def test_stutter_before_geminate_only_changes_comparison_not_authored_reading(self):
        source = [('歌っていたいんだってば', '우탓테 이타인닷테바'), *PAIRS]
        result = align_lines('歌っていたいんだだだってば\n' + TEXT, source)
        self.assertTrue(result['valid'])
        self.assertEqual(result['matched'], 6)
        self.assertEqual(result['phonetic'][0], source[0][1])

    @unittest.skipUnless(pykakasi, 'Local dictionary is required')
    def test_dictionary_matching_also_repairs_gaps_in_an_already_valid_song(self):
        source = [('私は歌う', '와타시와 우타우'), *PAIRS, *PAIRS]
        text = '\n'.join(original for original, _ in source).replace('私は歌う', 'わたしは歌う')
        self.assertTrue(align_lines(text, source)['valid'])
        result = match_pairs(text, source)
        self.assertEqual(result['matched'], 11)
        self.assertEqual(result['phonetic'][0], source[0][1])

    def test_reader_exits_after_spotify_process_disappears(self):
        calls = iter([True, False, True] + [False] * 100)
        server = Mock()
        monitor_lifetime(server, check=lambda: next(calls), interval=0.001, idle_timeout=0.003)
        server.shutdown.assert_called_once()

    def test_reader_exits_if_spotify_never_starts(self):
        server = Mock()
        monitor_lifetime(server, check=lambda: False, interval=0.001, idle_timeout=0.003, startup_timeout=0.002)
        server.shutdown.assert_called_once()


class YouTubeMetadataTests(unittest.TestCase):
    def setUp(self):
        youtube_metadata.cache_clear()

    def test_metadata_rejects_arbitrary_urls_before_network_access(self):
        with patch('bridge.urllib.request.build_opener') as opener:
            for value in ('https://127.0.0.1/', '../private', '', None, 'rKQptWhAvO0/other'):
                with self.assertRaises(ValueError):
                    youtube_metadata(value)
            opener.assert_not_called()

    def test_metadata_uses_fixed_public_oembed_and_caches_only_metadata(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({'title': 'cover', 'author_name': 'performer'}).encode()
        with patch('bridge.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = response
            first = youtube_metadata('rKQptWhAvO0')
            self.assertEqual(first, {'video_id': 'rKQptWhAvO0', 'title': 'cover', 'author': 'performer'})
            self.assertEqual(youtube_metadata('rKQptWhAvO0'), first)
            opener.return_value.open.assert_called_once()
            request = opener.return_value.open.call_args.args[0]
            self.assertTrue(request.full_url.startswith('https://www.youtube.com/oembed?'))

    def test_metadata_response_size_is_bounded(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'x' * 65537
        with patch('bridge.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = response
            with self.assertRaises(ValueError):
                youtube_metadata('rKQptWhAvO0')

    def test_private_or_removed_video_is_a_not_found_lookup(self):
        with patch('bridge.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = urllib.error.HTTPError('u', 404, 'Not Found', {}, None)
            with self.assertRaises(LookupError):
                youtube_metadata('rKQptWhAvO0')
            opener.return_value.open.side_effect = urllib.error.HTTPError('u', 503, 'Unavailable', {}, None)
            with self.assertRaises(urllib.error.HTTPError):
                youtube_metadata('rKQptWhAvO1')


if __name__ == '__main__':
    unittest.main()
