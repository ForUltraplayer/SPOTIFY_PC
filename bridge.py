# @file bridge.py
# @author: ForUltraplayer
# @brief Read existing Japanese/Korean lyric pairs and match them to ivLyrics lines.
"""Loopback lyric reader with web-authored readings and an opt-in offline fallback."""
import argparse
import ctypes
from collections import deque
from ctypes import wintypes
import difflib
import hashlib
import html
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache
from phonetics import japanese_to_hangul, kana_to_hangul
from youtube_stream import youtube_stream
from playlist_files import save_export
from playback_control import PlaybackControlSession

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
try:
    import pykakasi
except ImportError:
    pykakasi = None
_kana_converter = None
_kana_lock = threading.Lock()
_request_context = threading.local()

VERSION = "0.7.0"
PROTOCOL = 1
CAPABILITIES = ('youtube-links-v1', 'mixed-playlists-v1', 'playback-control-v1', 'lyric-sync-v1')
INSTALLATION_ID = hashlib.sha256(os.path.normcase(str(Path(__file__).resolve().parent)).encode('utf-8')).hexdigest()[:16]
MATCHING_VERSION = "0.3.1"  # Search changes do not invalidate compatible client pronunciation caches.
PORT = 19643
ORIGIN = "https://xpui.app.spotify.com"
DESKTOP_ORIGINS = frozenset(('http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost',
                             'http://spotify-hangul-overlay.localhost'))
CONTROL_PATHS = frozenset(('/playback-state', '/playback-command'))
JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
HANGUL = re.compile(r"[가-힣]")
# Equivalent old/new Japanese glyphs encountered in existing lyric providers.
# This affects matching only; the fetched author's reading is never rewritten.
GLYPH_EQUIVALENTS = str.maketrans({
    "歸": "帰", "拂": "払", "戾": "戻", "敎": "教", "隱": "隠", "殘": "残",
    "當": "当", "氣": "気", "會": "会", "黑": "黒", "變": "変", "淸": "清",
    "顏": "顔", "淚": "涙", "體": "体", "廣": "広", "聲": "声", "實": "実",
    "覺": "覚", "繼": "継", "續": "続", "戀": "恋", "惡": "悪", "發": "発",
    "邊": "辺", "點": "点", "國": "国", "區": "区", "滿": "満", "亂": "乱",
    "從": "従", "專": "専", "兩": "両", "應": "応", "眞": "真", "樂": "楽",
    "處": "処", "戰": "戦", "爭": "争", "爲": "為", "橫": "横", "樣": "様", "噓": "嘘",
})
STATE = Path(os.environ.get("LOCALAPPDATA", str(Path(__file__).parent))) / "ivLyricsHangul"
ARTIST_NAMES = {"kenshi yonezu": "요네즈 켄시", "米津玄師": "요네즈 켄시", "yoasobi": "YOASOBI"}
MAX_HTML = 3_000_000
BLOCKS = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "hr", "table", "td", "th"}
SKIP = {"script", "style", "rt", "rp", "sup", "nav", "footer", "noscript"}
COVER_MARKER = re.compile(r"\bcover(?:ed)?\b|歌ってみた|カバー|커버(?:곡)?", re.I)


class SupersededLookup(Exception):
    """A newer foreground track owns the lookup budget; this is not a source miss."""


def title_candidates(title, artist):
    """Keep original-title alternatives; candidate lyrics still need validation."""
    original = unicodedata.normalize('NFKC', title).strip()
    text = original.translate(str.maketrans({'【': '[', '】': ']', '「': '[', '」': ']'}))
    artists = [normalize(part) for part in re.split(r'[,/&、]', artist) if len(normalize(part)) >= 3]
    def clean_bracket(match):
        inner = match.group(1)
        if COVER_MARKER.search(inner) or normalize(inner) in artists:
            return ' '
        return match.group(0)
    text = re.sub(r'\[([^\]]*)\]|\(([^()]*)\)',
                  lambda match: clean_bracket(match) if match.group(1) is not None
                  else (' ' if COVER_MARKER.search(match.group(2)) or normalize(match.group(2)) in artists else match.group(0)), text)
    text = re.sub(r'\s*[\[(]\s*(?:feat\.?|ft\.?)\s+[^\])]*[\])]', '', text, flags=re.I)
    text = re.sub(r'\s*[-–—]\s*(?:feat\.?|ft\.?)\s+.*$', '', text, flags=re.I)
    text = re.sub(r'^\s*(?:cover(?:ed)?\s+(?:of\s+)?|カバー[:：\s]+|커버[:：\s]+)', '', text, flags=re.I)
    text = re.sub(r'\s*(?:[/|—–-]\s*)?(?:covered\s+by|cover\s+by)\b.*$', '', text, flags=re.I)
    text = re.sub(r'\s*[-(]\s*(?:remaster|live|radio|instrumental|edit|acoustic).*', '', text, flags=re.I)
    text = re.sub(r'\s*(?:[/|—–-]\s*)?(?:cover(?:\s+ver(?:sion)?\.?)?|歌ってみた|カバー|커버(?:곡)?)\s*$', '', text, flags=re.I)
    parts = [part.strip(' -/|') for part in re.split(r'\s+[-–—|/]\s*|\s*[/／]\s*', text)]
    known_artists = {normalize(name) for name in ARTIST_NAMES} | {normalize(name) for name in ARTIST_NAMES.values()}
    useful = [part for part in parts if part and normalize(part) not in artists + list(known_artists)]
    candidates = [part for part in useful if JAPANESE.search(part)] + useful + [text.strip(), original]
    return list(dict.fromkeys(candidate for candidate in candidates
                              if candidate and (candidate == original or not COVER_MARKER.fullmatch(candidate))))[:5]


def lyric_search_queries(text):
    """Use at most two distinctive original lyric lines to resolve renamed covers."""
    queries = []
    for line in text.splitlines():
        line = clean_line(line).translate(GLYPH_EQUIVALENTS)
        if len(normalize(line)) >= 10 and JAPANESE.search(line) and not HANGUL.search(line):
            if normalize(line) not in {normalize(query) for query in queries}:
                queries.append(line[:100])
        if len(queries) == 2:
            break
    return queries


def related_title_links(document, titles, final_url=''):
    """Follow a same-name song link from a generic/disambiguation document."""
    keys = {normalize(title) for title in titles}
    # A Japanese alias can redirect to a Hangul disambiguation page. Compare
    # against its observed destination name as well, not a guessed transliteration.
    destination = urllib.parse.unquote(urllib.parse.urlsplit(final_url).path.removeprefix('/w/'))
    if destination:
        keys.add(normalize(destination.split('(', 1)[0]))
    links = []
    for path in document.links:
        name = urllib.parse.unquote(urllib.parse.urlsplit(path).path.removeprefix('/w/'))
        base = name.split('(', 1)[0].strip()
        if '(' in name and normalize(base) in keys:
            url = 'https://namu.wiki' + path
            if url not in links:
                links.append(url)
    return links[:4]


def without_grouping_label(value):
    return re.sub(r'^\s*(?:〔문장\s*전체〕|\[문장\s*전체\])\s*', '', value) if isinstance(value, str) else value


def allowed_url(url):
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or parsed.port not in (None, 443)
            or not (host in ("namu.wiki", "haneum.site") or host.endswith(".tistory.com"))
            or (host == "haneum.site" and not re.fullmatch(r'/songs(?:/[^/]+)?', parsed.path))):
        raise ValueError("한음, 나무위키 또는 티스토리의 HTTPS 가사 주소만 사용할 수 있습니다.")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        allowed_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(CheckedRedirect)


@lru_cache(maxsize=256)
def youtube_metadata(video_id):
    """Resolve public metadata only; never fetch or persist media files."""
    if not isinstance(video_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise ValueError('YouTube 영상 ID가 올바르지 않습니다.')
    url = 'https://www.youtube.com/oembed?' + urllib.parse.urlencode({
        'url': 'https://www.youtube.com/watch?v=' + video_id, 'format': 'json'})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            raise ValueError('YouTube 메타데이터 주소가 변경되었습니다.')

    request = urllib.request.Request(url, headers={'User-Agent': 'SpotifyHangulLyrics', 'Accept': 'application/json'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError('YouTube 메타데이터 크기를 초과했습니다.')
        data = json.loads(raw)
    return {'video_id': video_id, 'title': str(data.get('title') or video_id)[:300],
            'author': str(data.get('author_name') or 'YouTube')[:200]}


def fetch_page(url):
    if getattr(_request_context, 'cancelled', lambda: False)():
        raise SupersededLookup('새 곡의 발음 조회로 전환했습니다.')
    url = allowed_url(url)
    req = urllib.request.Request(url, headers={
        "User-Agent": "SpotifyHangulLyrics/0.3 (lyric reader)",
        "Accept": "text/html", "Accept-Encoding": "identity",
    })
    remaining = getattr(_request_context, 'deadline', time.monotonic() + 6) - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("자료 조회 시간이 지났습니다.")
    with OPENER.open(req, timeout=min(6, remaining)) as response:
        content_type = response.headers.get_content_type()
        if content_type not in ("text/html", "application/xhtml+xml"):
            raise ValueError("가사 HTML 문서가 아닙니다.")
        data = response.read(MAX_HTML + 1)
        if len(data) > MAX_HTML:
            raise ValueError("가사 문서의 크기 제한을 초과했습니다.")
        return data.decode(response.headers.get_content_charset() or "utf-8", errors="replace"), response.url


class LyricDocument(HTMLParser):
    """Preserve visible line boundaries; omit furigana and footnote bodies."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.links, self.stack, self.title = [], [], [], []
        self.ignored = 0
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        skip = tag in SKIP or (tag == "a" and re.match(r"#(?:r?fn|footnote)", attrs.get("href", "")))
        if tag not in {"br", "hr", "img", "meta", "link", "input", "source", "wbr"}:
            self.stack.append((tag, bool(skip)))
            if skip:
                self.ignored += 1
        if tag == "title":
            self.in_title = True
        if self.ignored:
            return
        if tag in BLOCKS:
            self.parts.append("\n")
        if tag == "a" and attrs.get("href", "").startswith("/w/"):
            path = attrs["href"].split("#", 1)[0]
            if path not in self.links:
                self.links.append(path)
        # Haneum's public search cards use a literal onclick URL, not an anchor.
        # Read only this exact URL shape; never evaluate page-supplied JavaScript.
        song = re.fullmatch(r"location\.href=['\"](/songs/[^'\"?#]+)['\"];?", attrs.get('onclick', ''))
        href = song.group(1) if song else attrs.get('href', '')
        if re.fullmatch(r'/songs/[^/?#]+', href) and href not in self.links:
            self.links.append(href)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                self.ignored -= sum(skip for _, skip in self.stack[index:])
                del self.stack[index:]
                break
        if not self.ignored and tag in BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if not self.ignored:
            self.parts.append(data)

    def lines(self):
        return [clean_line(line) for line in "".join(self.parts).splitlines() if clean_line(line)]


class HaneumDocument(HTMLParser):
    """Read direct paragraph triples only inside a Haneum lyric row."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.paragraph = None
        self.paragraphs = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == 'div':
            if self.depth:
                self.depth += 1
            elif 'border-b' in dict(attrs).get('class', '').split():
                self.depth = 1
                self.paragraphs = []
        elif tag == 'p' and self.depth == 1:
            self.paragraph = []

    def handle_endtag(self, tag):
        if tag == 'p' and self.paragraph is not None:
            self.paragraphs.append(clean_line(''.join(self.paragraph)))
            self.paragraph = None
        elif tag == 'div' and self.depth:
            self.depth -= 1
            if not self.depth and len(self.paragraphs) == 3:
                reading, original, translation = self.paragraphs
                self.rows.append((original, reading, translation))

    def handle_data(self, data):
        if self.paragraph is not None:
            self.paragraph.append(data)

    def lines(self):
        return [value for row in self.rows for value in row]


def clean_line(text):
    return re.sub(r"\s+", " ", re.sub(r"\[\d+\]", "", text.replace("\u200b", ""))).strip()


def normalize(text):
    text = unicodedata.normalize("NFKC", clean_line(text)).translate(GLYPH_EQUIVALENTS).casefold()
    text = "".join(chr(ord(c) - 0x60) if '\u30a1' <= c <= '\u30f6' else c for c in text)
    text = text.replace('匂い', 'におい')  # Same word, kana/kanji spelling in the observed source/provider.
    # Some providers transcribe a vocal stutter before a geminate literally
    # (e.g. だだだって), while authored lyric tables keep だって. Matching only.
    text = re.sub(r'([か-もや-ろ])\1+(?=っ)', r'\1', text)
    return "".join(c for c in text if c.isalnum())


@lru_cache(maxsize=4096)
def kana_key(text):
    global _kana_converter
    with _kana_lock:
        if _kana_converter is None:
            _kana_converter = pykakasi.kakasi()
        return normalize(''.join(token['hira'] for token in _kana_converter.convert(normalize(text))))


@lru_cache(maxsize=4096)
def reading_similarity(original, reading):
    """Reject meaning text masquerading as a reading; never generate display text."""
    kana_key(original)
    with _kana_lock:
        japanese = ''.join(token['hepburn'] for token in _kana_converter.convert(normalize(original)))
    onsets = ['g', 'k', 'n', 'd', 't', 'r', 'm', 'b', 'p', 's', 's', '', 'j', 'j', 'ch', 'k', 't', 'p', 'h']
    vowels = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
    finals = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'r', 'k', 'm', 'p', 'r', 'r', 'p', 'r', 'm', 'p', 'p', 't', 't', 'n', 't', 't', 'k', 't', 'p', 'h']
    latin = []
    for char in reading:
        value = ord(char) - 0xAC00
        if 0 <= value < 11172:
            latin.append(onsets[value // 588] + vowels[(value % 588) // 28] + finals[value % 28])
        elif char.isascii() and char.isalpha():
            latin.append(char.lower())
    def sound_key(value):
        for before, after in [('shi', 'si'), ('chi', 'ti'), ('tsu', 'cu'), ('cheu', 'cu'),
                              ('fu', 'hu'), ('ji', 'zi'), ('syo', 'sio'), ('sho', 'sio'),
                              ('eu', 'u'), ('eo', 'o'), ('ou', 'o')]:
            value = value.replace(before, after)
        value = value.translate(str.maketrans({'g': 'k', 'd': 't', 'b': 'p'}))
        return re.sub(r'(.)\1+', r'\1', value)
    return difflib.SequenceMatcher(None, sound_key(japanese), sound_key(''.join(latin))).ratio()


def extract_pairs(document):
    # Lyric tables often put a repeat count in its own span/line between the
    # original, reading and meaning. It is annotation, not another lyric row.
    lines = [line for line in document.lines() if not re.fullmatch(r'[xX×]\s*\d{1,3}', line)]
    pairs = []
    for index, original in enumerate(lines[:-2]):
        reading = lines[index + 1]
        translation = lines[index + 2]
        if HANGUL.search(original) or not JAPANESE.search(original):
            continue
        if not HANGUL.search(reading) or JAPANESE.search(reading):
            continue
        # A bilingual Japanese/Korean translation is not a pronunciation source.
        # Require the common original / reading / meaning structure.
        if not HANGUL.search(translation) or JAPANESE.search(translation):
            continue
        if len(original) > 350 or len(reading) > 500 or len(normalize(original)) < 2:
            continue
        if pykakasi and reading_similarity(original, reading) < 0.45:
            continue
        pairs.append((original, reading))
    return pairs


def align_lines(text, pairs, normalizer=normalize):
    """Accept only near-complete original-text matches, never use Korean translations."""
    rows = [(normalizer(original), reading) for original, reading in pairs]
    lookup = {}
    for key, reading in rows:
        lookup.setdefault(key, reading)
    # Spotify sometimes combines two consecutive source lines into one line.
    for width in (2, 3):
        for start in range(len(rows) - width + 1):
            group = rows[start:start + width]
            lookup.setdefault("".join(key for key, _ in group), " ".join(reading for _, reading in group))
    originals = text.replace("\r\n", "\n").split("\n")
    # Whole-song character alignment handles a provider splitting one source
    # sentence across timestamps. Keep the author's full reading, rather than
    # inventing syllable boundaries for kanji or guessing where to cut Hangul.
    song_keys = [normalizer(line) if JAPANESE.search(line) else "" for line in originals]
    song_stream = "".join(song_keys)
    page_stream = "".join(key for key, _ in rows)
    character_map = {}
    for block in difflib.SequenceMatcher(None, song_stream, page_stream, autojunk=False).get_matching_blocks():
        for offset in range(block.size):
            character_map[block.a + offset] = block.b + offset
    page_rows, position = [], 0
    for key, reading in rows:
        page_rows.append((position, position + len(key), reading))
        position += len(key)
    output, total, matched, missing, grouped, song_position = [], 0, 0, [], [], 0
    for index, original in enumerate(originals):
        key = normalizer(original)
        if not original.strip():
            output.append("")
            continue
        if not JAPANESE.search(original):
            output.append(original)  # Preserve English hooks and section labels.
            continue
        total += 1
        reading = lookup.get(key)
        if reading is None and len(key) >= 6:
            candidates = [(difflib.SequenceMatcher(None, key, row).ratio(), value)
                          for row, value in rows if 0.9 <= len(row) / max(1, len(key)) <= 1.1]
            candidates.sort(reverse=True)
            if candidates and candidates[0][0] >= 0.94:
                # Ambiguous equal matches must not silently select a different reading.
                best = [value for score, value in candidates if score == candidates[0][0]]
                if len(set(best)) == 1:
                    reading = candidates[0][1]
        if not reading and key:
            positions = [character_map[pos] for pos in range(song_position, song_position + len(key))
                         if pos in character_map]
            if len(positions) / len(key) >= 0.94:
                first, last = min(positions), max(positions) + 1
                selected = [(start, end, value) for start, end, value in page_rows if start < last and end > first]
                if selected and len(selected) <= 3 and last - first <= len(key) * 1.2:
                    whole_sentence = selected[0][0] < first or selected[-1][1] > last
                    reading = " ".join(value for _, _, value in selected)
                    if whole_sentence:
                        grouped.append(index)
        song_position += len(key)
        if reading:
            matched += 1
            output.append(reading)
        else:
            output.append("(발음 자료 없음)")
            missing.append(index)
    coverage = matched / total if total else 0
    valid = total >= 3 and matched >= min(5, total) and coverage >= 0.85
    return {"phonetic": output, "matched": matched, "total": total, "grouped_lines": grouped,
            "coverage": round(coverage, 4), "missing_lines": missing, "valid": valid}


def match_pairs(text, pairs):
    aligned = align_lines(text, pairs)
    if aligned['coverage'] < 1 and pykakasi and pairs:
        # Kana readings are used solely to compare original Japanese spellings.
        # Display output is always the already-written Korean source text.
        by_reading = align_lines(text, pairs, kana_key)
        if by_reading['coverage'] > aligned['coverage']:
            by_reading['matching'] = 'local-japanese-dictionary'
            return by_reading
    return aligned


def with_offline_fallback(result, text, enabled):
    """Keep authored provenance and counts intact; separately report generated rows."""
    result = {**result, 'reading_kind': 'authored', 'generated_lines': []}
    if not enabled or not pykakasi:
        return result
    lines = text.split('\n')
    phonetic = list(result.get('phonetic', lines))
    missing = result.get('missing_lines', [i for i, line in enumerate(lines) if JAPANESE.search(line)])
    generated, unresolved = [], []
    global _kana_converter
    with _kana_lock:
        if _kana_converter is None:
            _kana_converter = pykakasi.kakasi()
        for index in missing:
            reading = japanese_to_hangul(lines[index], _kana_converter)
            if HANGUL.search(reading):
                phonetic[index] = reading
                generated.append(index)
                if JAPANESE.search(reading):
                    unresolved.append(index)
            else:
                phonetic[index] = '(발음 자료 없음)'
                unresolved.append(index)
    if generated:
        result.update(phonetic=phonetic, generated_lines=generated, unresolved_lines=unresolved,
                      reading_kind='mixed' if result.get('matched', 0) else 'automatic', valid=True)
    return result


class Reader:
    def __init__(self, state=STATE, fetcher=fetch_page):
        self.state = Path(state)
        self.fetcher = fetcher
        self.lock = threading.Lock()
        self.jobs = threading.BoundedSemaphore(2)
        self.negative = {}
        self.retry_counts = {}
        self.last = None
        self.cache = {}
        self.aliases = {}
        self.lookup_epoch = 0
        self.foreground_track = ''
        try:
            self.cache = json.loads((self.state / "cache.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        try:
            aliases = json.loads((self.state / 'aliases.json').read_text(encoding='utf-8'))
            if isinstance(aliases, dict):
                self.aliases = aliases
        except (OSError, ValueError):
            pass

    def save(self):
        self.state.mkdir(parents=True, exist_ok=True)
        temporary = self.state / "cache.tmp"
        temporary.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.state / "cache.json")
        if self.aliases:
            temporary = self.state / 'aliases.tmp'
            temporary.write_text(json.dumps(self.aliases, ensure_ascii=False), encoding='utf-8')
            temporary.replace(self.state / 'aliases.json')

    @staticmethod
    def alias_key(title, artist):
        return hashlib.sha256(json.dumps([normalize(title_candidates(title, artist)[0]), normalize(artist)],
                                        ensure_ascii=False).encode()).hexdigest()

    def candidates(self, title, artist, text=''):
        with self.lock:
            alias = self.aliases.get(self.alias_key(title, artist))
        if (isinstance(alias, dict) and isinstance(alias.get('checked_at'), (int, float))
                and time.time() - alias['checked_at'] < 30 * 86400):
            # A learned address is only a candidate. resolve still validates its
            # current lyrics; another artist's same-name song is never accepted by title.
            address = alias.get('source_url', '')
            parsed = urllib.parse.urlsplit(address)
            if parsed.hostname == 'namu.wiki' and parsed.path.startswith('/w/'):
                yield allowed_url(address)
        titles = title_candidates(title, artist)
        artist_context = (artist + ' ' + title).casefold()
        # Try the original-title document before a catalogue search, as on mobile.
        for name in titles[:3]:
            yield "https://namu.wiki/w/" + urllib.parse.quote(name, safe="")
            for artist_alias, korean in ARTIST_NAMES.items():
                if artist_alias.casefold() in artist_context:
                    yield "https://namu.wiki/w/" + urllib.parse.quote(f"{name}({korean})", safe="")
        queries = list(titles[:2])
        if all('\u30a0' <= char <= '\u30ff' or char.isspace() for char in titles[0]):
            queries.append(kana_to_hangul(titles[0]))
        for query in dict.fromkeys(queries):
            try:
                document = LyricDocument()
                document.feed(self.fetcher('https://haneum.site/songs?' + urllib.parse.urlencode({'q': query}))[0])
                for path in [path for path in document.links if path.startswith('/songs/')][:4]:
                    yield 'https://haneum.site' + path
            except (OSError, ValueError):
                pass
        # Search the normal public document search; do not bypass access challenges.
        # The translated document name can be unrelated to either the Japanese
        # or English title. Search original-title mentions in the article body
        # before falling back to exact lyric fragments.
        searches = [(titles[0], 'title'), *((name, 'content') for name in titles[:2]),
                    *((line, 'content') for line in lyric_search_queries(text))]
        for query, target in searches:
            search = "https://namu.wiki/Search?" + urllib.parse.urlencode({'q': query, 'namespace': '문서', 'target': target})
            try:
                document = LyricDocument()
                document.feed(self.fetcher(search)[0])
                for path in document.links[:5]:
                    yield "https://namu.wiki" + path
            except (OSError, ValueError):
                pass

    def resolve(self, params):
        title, artist = (str(params.get(key, "")).strip() for key in ("title", "artist"))
        text = str(params.get("text", "")).replace("\r\n", "\n")
        if not title or not text.strip() or len(text) > 40000 or len(title) > 300 or len(artist) > 500:
            raise ValueError("곡명과 원문 가사를 확인해 주세요.")
        source_url = allowed_url(params["source_url"]) if params.get("source_url") else ""
        automatic = params.get('automatic_fallback', False)
        if not isinstance(automatic, bool):
            raise ValueError('자동 발음 설정이 올바르지 않습니다.')
        track_id = params.get('track_id', '')
        foreground = params.get('foreground', False)
        if not isinstance(track_id, str) or len(track_id) > 200 or not isinstance(foreground, bool):
            raise ValueError('곡 식별 정보가 올바르지 않습니다.')
        retry_attempt = params.get('retry_attempt', 0)
        if type(retry_attempt) is not int or not 0 <= retry_attempt <= 3:
            raise ValueError('자동 재조회 횟수가 올바르지 않습니다.')
        key = hashlib.sha256(json.dumps([title, artist, text, source_url], ensure_ascii=False).encode()).hexdigest()
        cached_result, refresh_cached, negative = None, None, False
        with self.lock:
            if foreground and track_id and self.foreground_track != track_id:
                self.foreground_track = track_id
                self.lookup_epoch += 1
            epoch = self.lookup_epoch
            cached = self.cache.get(key)
            if cached and time.time() - cached.get("checked_at", 0) < 30 * 86400:
                cached_result = {**cached, 'phonetic': [without_grouping_label(line) for line in cached['phonetic']], "cache": True}
                if cached.get('coverage', 1) < 1 and cached.get('matching_version') != MATCHING_VERSION:
                    refresh_cached, cached_result = cached_result, None
            negative = self.negative.get(key, 0) > time.time()
            if not negative:
                self.retry_counts.pop(key, None)
            retry_allowed = negative and foreground and retry_attempt > self.retry_counts.get(key, 0)
            if retry_allowed:
                negative = False
        if cached_result:
            self.last = with_offline_fallback(cached_result, text, automatic)
            return self.last
        if negative and not automatic:
            raise LookupError("이 곡과 일치하는 한글 발음 자료를 찾지 못했습니다. 자료 주소를 직접 지정할 수 있습니다.")
        if not self.jobs.acquire(blocking=False):
            raise RuntimeError("다른 곡의 발음 자료를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.")
        try:
            # Busy responses do not spend a source retry. Repeated UI mounts
            # cannot turn the three extra attempts into unlimited cache bypasses.
            with self.lock:
                if retry_allowed:
                    if retry_attempt <= self.retry_counts.get(key, 0):
                        raise LookupError('이 곡의 자동 재조회 횟수를 모두 사용했습니다.')
                    self.retry_counts[key] = retry_attempt
                    if len(self.retry_counts) > 500:
                        self.retry_counts.pop(next(iter(self.retry_counts)))
            def superseded():
                return bool(track_id) and epoch != self.lookup_epoch and self.foreground_track != track_id
            def check_current():
                if superseded():
                    raise SupersededLookup('새 곡의 발음 조회로 전환했습니다.')
            visited, failures, best = set(), [], {}
            selected = None
            deadline = time.monotonic() + 32
            _request_context.deadline = deadline
            _request_context.cancelled = superseded
            urls = iter([] if negative and not refresh_cached else [source_url] if source_url else self.candidates(title, artist, text))
            pending = deque([refresh_cached['source_url']] if refresh_cached and not source_url else [])
            while time.monotonic() < deadline and len(visited) < 20:
                check_current()
                try:
                    url = pending.popleft() if pending else next(urls)
                except StopIteration:
                    break
                if time.monotonic() > deadline:
                    break
                if url in visited:
                    continue
                visited.add(url)
                try:
                    markup, final_url = self.fetcher(url)
                    document = LyricDocument()
                    document.feed(markup)
                    if urllib.parse.urlsplit(final_url).hostname == 'haneum.site':
                        haneum = HaneumDocument()
                        haneum.feed(markup)
                        pairs = extract_pairs(haneum)
                    else:
                        pairs = extract_pairs(document)
                    aligned = match_pairs(text, pairs)
                    check_current()
                    if aligned['coverage'] > best.get('coverage', -1):
                        best = {'source_url': final_url, 'matched': aligned['matched'], 'total': aligned['total'],
                                'coverage': aligned['coverage'], 'pairs': len(pairs)}
                    if not aligned["valid"]:
                        if not source_url:
                            pending.extend(candidate for candidate in related_title_links(document, title_candidates(title, artist), final_url)
                                           if candidate not in visited and candidate not in pending)
                        continue
                    if refresh_cached and aligned['coverage'] < refresh_cached['coverage']:
                        continue
                    result = {**aligned, "title": title, "artist": artist, "source_url": final_url, 'matching_version': MATCHING_VERSION,
                              "source_title": "".join(document.title), "checked_at": time.time(), "cache": False}
                    if not selected or result['coverage'] > selected['coverage']:
                        selected = result
                    # A verified authored result is ready for display. Do not
                    # hold it for four seconds while visiting lower-priority pages.
                    break
                except (OSError, ValueError) as error:
                    failures.append(f"{urllib.parse.urlsplit(url).hostname}: {type(error).__name__}")
            if selected:
                with self.lock:
                    self.cache[key] = selected
                    self.negative.pop(key, None)
                    self.retry_counts.pop(key, None)
                    parsed = urllib.parse.urlsplit(selected['source_url'])
                    if parsed.hostname == 'namu.wiki' and parsed.path.startswith('/w/'):
                        self.aliases[self.alias_key(title, artist)] = {
                            'source_url': urllib.parse.urlunsplit(('https', 'namu.wiki', parsed.path, '', '')),
                            'checked_at': time.time()}
                        if len(self.aliases) > 500:
                            oldest = min(self.aliases, key=lambda k: self.aliases[k].get('checked_at', 0))
                            del self.aliases[oldest]
                    if len(self.cache) > 500:
                        oldest = min(self.cache, key=lambda k: self.cache[k].get("checked_at", 0))
                        del self.cache[oldest]
                    try:
                        self.save()
                    except OSError:
                        selected['cache_saved'] = False
                self.last = with_offline_fallback(selected, text, automatic)
                return self.last
            check_current()
            with self.lock:
                self.negative[key] = time.time() + 600
                self.last = {"title": title, "status": "not_found", "attempts": len(visited), "errors": failures, 'best': best}
            if refresh_cached:
                self.last = with_offline_fallback({**refresh_cached, 'refresh_failed': True}, text, automatic)
                return self.last
            result = with_offline_fallback({'title': title, 'artist': artist, 'matched': 0,
                'total': sum(bool(JAPANESE.search(line)) for line in text.split('\n')), 'coverage': 0,
                'source_url': '', 'source_title': '기기 내부 자동 발음', 'cache': False, 'valid': False}, text, automatic)
            if result['valid']:
                self.last = result
                return result
            raise LookupError("원문과 85% 이상 일치하는 한글 발음 자료를 찾지 못했습니다. 자료 주소를 직접 지정해 주세요.")
        finally:
            if hasattr(_request_context, 'deadline'):
                del _request_context.deadline
            if hasattr(_request_context, 'cancelled'):
                del _request_context.cancelled
            self.jobs.release()


def spotify_running():
    if os.name != "nt":
        return True
    class Entry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", wintypes.LONG), ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == wintypes.HANDLE(-1).value:
        return True  # Enumeration failure must not interrupt a running player.
    try:
        entry = Entry()
        entry.dwSize = ctypes.sizeof(entry)
        ok = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            if entry.szExeFile.casefold() == "spotify.exe":
                return True
            ok = kernel.Process32NextW(snapshot, ctypes.byref(entry))
        return False
    finally:
        kernel.CloseHandle(snapshot)


def monitor_lifetime(server, check=spotify_running, interval=5, idle_timeout=30, startup_timeout=120):
    deadline, absent_since = time.monotonic() + startup_timeout, None
    while True:
        time.sleep(interval)
        if check():
            deadline = 0
            absent_since = None
        elif time.monotonic() > deadline:
            absent_since = absent_since or time.monotonic()
            if time.monotonic() - absent_since >= idle_timeout:
                server.shutdown()
                return


def serve(port=PORT, lifetime=True):
    reader = Reader()
    playback = PlaybackControlSession()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # No lyric text or requests in logs.

        def send_json(self, code, value):
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if code == 429:
                self.send_header('Retry-After', '1')
            origin = self.headers.get('Origin')
            if origin == ORIGIN or (self.path in CONTROL_PATHS and origin in DESKTOP_ORIGINS):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def valid_origin(self):
            return self.headers.get("Origin") in (None, ORIGIN) and self.headers.get("Host") in (
                f"127.0.0.1:{port}", f"localhost:{port}")

        def valid_control_origin(self):
            return self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}') and (
                self.headers.get('Origin') == ORIGIN or
                (self.path in CONTROL_PATHS and self.headers.get('Origin') in DESKTOP_ORIGINS))

        def control_request(self, method):
            if not self.valid_control_origin():
                return self.send_json(403, {'error': '허용되지 않은 재생 제어 요청입니다.'})
            token = self.headers.get('X-Hangul-Overlay-Token')
            try:
                if self.path == '/playback-session' and method == 'POST':
                    if self.headers.get('X-Hangul-Lyrics-Client') != 'ivlyrics':
                        raise PermissionError('재생 연결 클라이언트가 올바르지 않습니다.')
                else:
                    playback.authorize(token)
                if method == 'GET':
                    if self.path == '/playback-state':
                        return self.send_json(200, {'state': playback.state(token)})
                    if self.path == '/playback-commands':
                        return self.send_json(200, playback.drain(token))
                    return self.send_json(405, {'error': '지원하지 않는 요청 방식입니다.'})
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096:
                    raise ValueError('재생 제어 요청 크기가 올바르지 않습니다.')
                params = json.loads(self.rfile.read(length))
                if not isinstance(params, dict):
                    raise ValueError('재생 제어 형식이 올바르지 않습니다.')
                if self.path == '/playback-session':
                    result = playback.register(params.get('instance'))
                elif self.path == '/playback-state' and self.headers.get('Origin') == ORIGIN:
                    result = {'state': playback.publish(token, params)}
                elif self.path == '/playback-command':
                    result = playback.enqueue(token, params.get('action'), params.get('trackUri'))
                else:
                    return self.send_json(405, {'error': '지원하지 않는 요청 방식입니다.'})
                return self.send_json(200, result)
            except PermissionError as error:
                return self.send_json(403, {'error': str(error)})
            except LookupError as error:
                return self.send_json(409, {'error': str(error)})
            except (ValueError, TypeError) as error:
                return self.send_json(400, {'error': str(error)})
            except RuntimeError as error:
                return self.send_json(429, {'error': str(error)})

        def do_OPTIONS(self):
            control = self.path.startswith('/playback-')
            if not (self.valid_control_origin() if control else self.valid_origin()):
                return self.send_json(403, {"error": "허용되지 않은 요청입니다."})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers.get('Origin') or ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Hangul-Lyrics-Client, X-Hangul-Overlay-Token" if control else "Content-Type, X-Hangul-Lyrics-Client")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def do_GET(self):
            if self.path in ('/playback-state', '/playback-commands'):
                return self.control_request('GET')
            if not self.valid_origin():
                return self.send_json(403, {"error": "허용되지 않은 요청입니다."})
            static = {'/youtube/player': ('youtube-player.html', 'text/html; charset=utf-8'),
                      '/youtube/extension.js': ('youtube-links.js', 'text/javascript; charset=utf-8'),
                      '/youtube/ivlyrics.js': ('youtube-ivlyrics.js', 'text/javascript; charset=utf-8'),
                      '/youtube/library.js': ('youtube-library.js', 'text/javascript; charset=utf-8'),
                      '/youtube/overlay.js': ('youtube-overlay-controls.js', 'text/javascript; charset=utf-8'),
                      '/youtube/desktop.js': ('youtube-desktop-bridge.js', 'text/javascript; charset=utf-8')}
            static.update({'/youtube/now-playing.js': ('youtube-now-playing.js', 'text/javascript; charset=utf-8'),
                           '/youtube/now-playing.css': ('youtube-now-playing.css', 'text/css; charset=utf-8')})
            asset = static.get(urllib.parse.urlsplit(self.path).path)
            if asset:
                try:
                    data = (Path(__file__).parent / asset[0]).read_bytes()
                except FileNotFoundError:
                    return self.send_json(404, {'error': '링크 음악 파일이 설치되지 않았습니다.'})
                self.send_response(200)
                self.send_header('Content-Type', asset[1])
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
                if self.headers.get('Origin') == ORIGIN:
                    self.send_header('Access-Control-Allow-Origin', ORIGIN)
                self.end_headers()
                return self.wfile.write(data)
            if self.path != "/health":
                return self.send_json(404, {"error": "경로가 없습니다."})
            last = reader.last or {}
            return self.send_json(200, {"app": "ivLyricsHangul", "version": VERSION, "pid": os.getpid(),
                                       "protocol": PROTOCOL, "capabilities": CAPABILITIES, "installation_id": INSTALLATION_ID,
                                       "cached": len(reader.cache), "last": {key: last[key] for key in
                                       ("title", "source_url", "matched", "total", "coverage", "status", "cache",
                                        "reading_kind", "generated_lines", "unresolved_lines", "attempts", "best", "errors") if key in last}})

        def do_POST(self):
            if self.path in ('/playback-session', '/playback-state', '/playback-command'):
                return self.control_request('POST')
            if not self.valid_origin() or self.headers.get("X-Hangul-Lyrics-Client") != "ivlyrics":
                return self.send_json(403, {"error": "허용되지 않은 요청입니다."})
            if self.path not in ("/resolve", "/youtube/metadata", "/youtube/stream", "/youtube/export"):
                return self.send_json(404, {"error": "경로가 없습니다."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= (3_000_000 if self.path == '/youtube/export' else 100000):
                    raise ValueError("요청 크기가 올바르지 않습니다.")
                params = json.loads(self.rfile.read(length))
                if not isinstance(params, dict):
                    raise ValueError("요청 형식이 올바르지 않습니다.")
                if self.path == '/youtube/metadata':
                    result = youtube_metadata(params.get('video_id'))
                elif self.path == '/youtube/stream':
                    result = youtube_stream(params.get('video_id'))
                elif self.path == '/youtube/export':
                    result = save_export(params, STATE)
                else:
                    result = reader.resolve(params)
                self.send_json(200, result)
            except SupersededLookup as error:
                self.send_json(409, {"error": str(error), 'superseded': True})
            except LookupError as error:
                self.send_json(404, {"error": str(error)})
            except (ValueError, TypeError) as error:
                self.send_json(400, {"error": str(error)})
            except RuntimeError as error:
                self.send_json(429, {"error": str(error)})
            except Exception:
                self.send_json(500, {"error": "발음 자료를 읽는 중 오류가 발생했습니다."})
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    if lifetime:
        threading.Thread(target=monitor_lifetime, args=(server,), daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--keep-alive-for-test", action="store_true")
    args = parser.parse_args()
    serve(args.port, not args.keep_alive_for_test)
