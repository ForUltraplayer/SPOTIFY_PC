# @file patch_ivlyrics_sync.py
# @author: ForUltraplayer
# @brief Apply guarded local sync UI and identity fixes to a pinned ivLyrics source tree.
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKER = '/* SpotifyHangul accessible track sync v1 */'
UPSTREAM_OVERLAY_URL = 'https://ivlis.kr/ivLyrics/extensions/#overlay'
FORK_OVERLAY_URL = 'https://github.com/ForUltraplayer/ivLyrics-overlay/releases/latest'


def replace_once(source, old, new, name):
    if source.count(old) != 1:
        raise ValueError('ivLyrics sync contract changed: ' + name)
    return source.replace(old, new, 1)


def overlay_download_sources(sources):
    """Point the overlay download button and its fallbacks at this project's overlay fork."""
    result = dict(sources)
    for name, old, new, anchor in (
        ('LyricsService.js', "return '" + UPSTREAM_OVERLAY_URL + "';", "return '" + FORK_OVERLAY_URL + "';", 'overlay download url'),
        ('Settings.js', "getDownloadUrl?.() || '" + UPSTREAM_OVERLAY_URL + "';", "getDownloadUrl?.() || '" + FORK_OVERLAY_URL + "';", 'settings overlay download fallback'),
        ('SetupWizard.js', 'getDownloadUrl?.() || "' + UPSTREAM_OVERLAY_URL + '"', 'getDownloadUrl?.() || "' + FORK_OVERLAY_URL + '"', 'setup wizard overlay download fallback'),
    ):
        result[name] = replace_once(result[name], old, new, anchor)
    return result


def thumbnail_ad_filter(sources):
    """Stop the video ad blocker from emptying thumbnails of videos whose ID contains "ad"."""
    result = dict(sources)
    result['VideoBackgroundDepend.js'] = replace_once(result['VideoBackgroundDepend.js'],
        r'        /ytimg\.com\/.*ad/i,', r'        /ytimg\.com\/(?!vi(?:_webp)?\/).*ad/i,', 'ytimg ad pattern')
    return result


def patched_sources(sources, core, ui):
    """Validate every upstream anchor before producing any filesystem writes."""
    if any(MARKER in text for text in sources.values()):
        raise ValueError('Apply sync patch to pristine pinned sources, not a patched tree')
    result = dict(sources)
    result['index.js'] = replace_once(result['index.js'],
        'const MAX_TRACK_SYNC_OFFSET = 10000;', 'const MAX_TRACK_SYNC_OFFSET = 60000;', 'track offset bound')
    result['index.js'] = replace_once(result['index.js'],
        'if (!trackUri.startsWith("spotify:") || !Number.isFinite(numericOffset)) {',
        'if (!(trackUri.startsWith("spotify:") || /^youtube:video:[\\w-]{11}$/.test(trackUri)) || !Number.isFinite(numericOffset)) {',
        'offset backup video identity')
    result['Pages.js'] = replace_once(result['Pages.js'],
        'const getCurrentTrackUri = () => Spicetify.Player?.data?.item?.uri || "";',
        'const getCurrentTrackUri = () => window.SpotifyHangulSyncController?.resolveTrack()?.uri || Spicetify.Player?.data?.item?.uri || "";',
        'displayed playback offset owner')
    options = result['OptionsMenu.js']
    options = replace_once(options,
        'const clampSyncOffset = (value) => {\n  const numericValue = Number(value);\n  return Number.isFinite(numericValue)\n    ? Math.max(-10000, Math.min(10000, Math.round(numericValue)))\n    : 0;\n};',
        'const clampSyncOffset = (value) => {\n  const numericValue = Number(value);\n  return Number.isFinite(numericValue)\n    ? Math.max(-60000, Math.min(60000, Math.round(numericValue)))\n    : 0;\n};\nconst clampGlobalSyncOffset = value => Math.max(-10000, Math.min(10000, clampSyncOffset(value)));',
        'track clamp and separate global bound')
    options = replace_once(options, 'return `${safeOffset > 0 ? "+" : ""}${safeOffset}ms`;',
        'return window.SpotifyHangulSync.formatOffset(safeOffset);', 'human direction format')
    for old, new, name in (
        ('clampSyncOffset(Utils.getGlobalSyncOffset?.() || 0)', 'clampGlobalSyncOffset(Utils.getGlobalSyncOffset?.() || 0)', 'global initial bound'),
        ('setGlobalOffset(clampSyncOffset(event.detail?.offset));', 'setGlobalOffset(clampGlobalSyncOffset(event.detail?.offset));', 'global event bound'),
        ('const changeGlobalOffset = (nextOffset) => {\n    const safeOffset = clampSyncOffset(nextOffset);',
         'const changeGlobalOffset = (nextOffset) => {\n    const safeOffset = clampGlobalSyncOffset(nextOffset);', 'global write bound'),
        ('const TrackSyncAdjustPill = react.memo(', 'const HangulTrackSyncEditor = window.SpotifyHangulSyncUI.create(react);\n\nconst TrackSyncAdjustPill = react.memo(', 'editor component boundary'),
        ('(showsVideo ? VIDEO_SYNC_STEPS_MS : [-100, -50, -10, "current", 10, 50, 100])',
         '(showsVideo ? VIDEO_SYNC_STEPS_MS : [-1000, -100, "current", 100, 1000])', 'coarse and fine lyric steps'),
        (': `${step > 0 ? "+" : "−"}${absoluteStep}ms`;',
         ': `${Number((absoluteStep / 1000).toFixed(3))} 초 ${step > 0 ? "먼저" : "나중에"}`;', 'step direction wording'),
        ('showsVideo ? "✓ 0s" : "✓ 0ms"', 'showsVideo ? "✓ 0s" : "✓ 보정 없음"', 'reset wording'),
        ('    modeSwitch,\n    react.createElement(\n      "div",\n      { className: "lyrics-track-sync-controls" },',
         '    !showsVideo && lyricsAdjustable ? react.createElement(HangulTrackSyncEditor, { trackUri }) : null,\n    modeSwitch,\n    react.createElement(\n      "div",\n      { className: "lyrics-track-sync-controls" },', 'existing quick sync editor mount'),
    ):
        options = replace_once(options, old, new, name)
    result = thumbnail_ad_filter(overlay_download_sources(result))
    prefix = MARKER + '\n' + core + '\n' + ui + '\n'
    result['OptionsMenu.js'] = prefix + options
    for name in ('index.js', 'Pages.js'):
        result[name] = MARKER + '\n' + result[name]
    return result


def patch_tree(directory):
    directory = Path(directory)
    names = ('index.js', 'Pages.js', 'OptionsMenu.js', 'LyricsService.js', 'Settings.js', 'SetupWizard.js', 'VideoBackgroundDepend.js')
    sources = {name: (directory / name).read_text(encoding='utf-8-sig') for name in names}
    result = patched_sources(sources, (ROOT / 'ivlyrics-sync.js').read_text(encoding='utf-8'),
                             (ROOT / 'ivlyrics-sync-ui.js').read_text(encoding='utf-8'))
    for name, text in result.items():
        (directory / name).write_text(text, encoding='utf-8', newline='\n')
    return list(result)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    print(patch_tree(parser.parse_args().directory))
