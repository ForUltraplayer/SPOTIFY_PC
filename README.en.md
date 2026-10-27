# SpotX + ivLyrics + Hangul Pronunciation (Windows)

[한국어](README.md) | **English**

Shows the Korean (Hangul) pronunciation of Japanese songs in the Spotify desktop lyrics view. Pronunciation is pulled from Haneum and Namuwiki and matched line by line against Spotify's lyrics.

Built on [SpotX](https://github.com/SpotX-Official/SpotX) + [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics). Public version: 0.7.2 beta.

**[⬇ Download (v0.7.2)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.7.2)**

0.7.0 installs update to 0.7.2 automatically when launched from the shortcut. Users on 0.6.0, 0.6.1, or 0.6.3 can also upgrade directly. To install manually, close Spotify, then run the 0.7.2 Setup.exe into the existing installation folder.

> [!NOTE]
> From 0.7.2 the desktop lyrics overlay is no longer bundled. A modified build with playback buttons is available separately from the [ivLyrics-overlay fork releases](https://github.com/ForUltraplayer/ivLyrics-overlay/releases). The original overlay repository does not declare a license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component notices.

## Install

No need to install Spotify, SpotX or Python first.

1. Download and run `SpotifyHangul-0.7.2-Setup.exe`.
2. Pick an install folder (default: `%LOCALAPPDATA%\Programs\SpotifyHangul`).
3. The installer downloads the official Spotify files (~150 MB).

No admin rights needed. The beta EXE is not code-signed.

## Usage

1. Launch with the **Spotify 한글 가사** desktop shortcut.
2. Open the **ivLyrics** view in Spotify.
3. In ivLyrics settings, turn on original lyrics and Hangul pronunciation.

> [!IMPORTANT]
> The regular Spotify shortcut won't show pronunciation. Always use the **Spotify 한글 가사** shortcut.

Per-song source URLs and automatic pronunciation are under **한글 발음 자료** in the profile menu.

## Features

- Matches Haneum/Namuwiki pronunciation to Spotify lyrics line by line (used only when 85%+ of Japanese lines match)
- Remembers matched sources for faster display next time
- Falls back to searching without feat., by lead artist, or by the original song for covers
- Retries failed lookups (up to 3 times, 2 s apart)
- Automatic pronunciation for lines missing from the source (off by default)
- Copy song title (right-click the title in the playback bar, song menu, profile menu)

<details>
<summary>Additional features in 0.7.x</summary>

- Play YouTube links alongside Spotify tracks, with playlist import and export
- Switch between audio streaming and the video player, using the existing playback bar and ivLyrics
- Adjust per-track lyric timing in seconds, with undo
- Start a separately installed desktop overlay with the app and connect its playback buttons
- Restore previous files and installation registration after failed or interrupted installs
- 0.7.2: fix first YouTube audio playback failures (wait until a fresh stream URL is served, then retry once if it still fails)
- 0.7.2: align automatic pronunciation with authored Korean conventions (long vowels dropped, sokuon as ㅅ)

Local installers include Python and Node. Place `lyrics-plus-overlay.exe` in `%LOCALAPPDATA%\lyrics-plus-overlay\` to have the shortcut start the desktop overlay too. First launch on a separate clean PC remains untested. See [YouTube integration](docs/YOUTUBE_LINKS.md), [distribution preparation](docs/DISTRIBUTION_PLAN.md), and [verification](docs/VERIFICATION.md) for implementation details and limits (Korean).

</details>

## Update / Uninstall

- **Manual install / update**: close Spotify and the overlay, then run `SpotifyHangul-0.7.2-Setup.exe` into the same folder.
- **Automatic updates**: the shortcut checks for and downloads new versions when launched, at least 8 hours after the previous check. Updates apply before the next launch after Spotify closes. From 0.7.0 the updater selects only GitHub releases not marked as prerelease. The overlay bundled with 0.7.0 is removed from the install folder on update; a separately installed overlay is left alone.
- **Uninstall**: Windows Settings > Apps > Installed apps > **Spotify 한글 가사**. Your existing Spotify and pronunciation cache are kept.

Spotify's own auto-update is blocked to keep the patches. New Spotify versions come with new installer releases.

The first migration to isolated preprocessing state in 0.6.3 downloads about 150 MB of official Spotify files again.

## Known issues

- Songs without Hangul pronunciation online won't show any.
- Automatic pronunciation may not match how kanji are actually sung.
- Spotify or Spicetify updates can break compatibility.
- Windows ARM64 and coexistence with the Store version are untested.

## Tested on

Windows 11 x64 / Spotify 1.3.6.1921 / Spicetify 2.46.4 / ivLyrics 7.0.16

## Stored data

Pronunciation cache lives in `%LOCALAPPDATA%\ivLyricsHangul\` (up to 500 songs, 30 days). It's not removed on update or uninstall.

More in [operations](docs/OPERATIONS.md), [verification](docs/VERIFICATION.md) and [integration](docs/SPOTX_INTEGRATION.md) (Korean).

## Development

<details>
<summary>Tests and build</summary>

Requires Python and Node.js.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_installer.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_bootstrap.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_auto_update.ps1
```

From 0.7.2 the installer no longer bundles the desktop overlay, so it builds from the repository and public downloads alone. Use a new candidate directory under `work/`.

```powershell
python scripts/build_spotx_adapter.py
python scripts/fetch_distribution_inputs.py
npm ci --ignore-scripts --prefix tests/ui
python scripts/check_compatibility.py
python scripts/prepare_release.py --output-dir work/release-candidates/candidate-1
python scripts/build_installer.py --output-dir work/release-candidates/candidate-1
```

| Path | Role |
| --- | --- |
| `bridge.py` | Local helper (source lookup, matching) |
| `phonetics.py` | Automatic pronunciation |
| `hangul-lyrics.js` | Spicetify extension |
| `start.ps1`, `stop.ps1` | Start / stop |
| `installer/` | NSIS installer |
| `scripts/` | Release and build scripts |
| `overlay/` | Independent WPF prototype source, excluded from the product |

Release process: [docs/RELEASE.md](docs/RELEASE.md) (Korean).

Version 0.6.2 centralizes component versions and digests in `components.json`. See [component maintenance](docs/DEPENDENCIES.md) for ivLyrics replacement, upstream detection and compatibility checks (Korean).

</details>

## License

GPL-3.0-or-later. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled components. This does not grant any right to redistribute lyrics.
