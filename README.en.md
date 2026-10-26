# SpotX + ivLyrics + Hangul Pronunciation (Windows)

[한국어](README.md) | **English**

Shows the Korean (Hangul) pronunciation of Japanese songs in the Spotify desktop lyrics view. Pronunciation is pulled from Haneum and Namuwiki and matched line by line against Spotify's lyrics.

Built on [SpotX](https://github.com/SpotX-Official/SpotX) + [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics). Current version: 0.6.1 beta.

**[⬇ Download (v0.6.1)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.6.1)**

Android version: [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID)

## Install

No need to install Spotify, SpotX or Python first.

1. Download and run `SpotifyHangul-0.6.1-Setup.exe`.
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

## Update / Uninstall

- **0.6.1 and later**: the shortcut checks for new versions and updates automatically (every 8 hours, applied after Spotify closes).
- **0.6.0 and earlier**: close Spotify and run `SpotifyHangul-0.6.1-Update.exe`, or reinstall Setup.exe into the same folder.
- **Uninstall**: Windows Settings > Apps > Installed apps > **Spotify 한글 가사**. Your existing Spotify and pronunciation cache are kept.

Spotify's own auto-update is blocked to keep the patches. New Spotify versions come with new installer releases.

## Known issues

- Songs without Hangul pronunciation online won't show any.
- Automatic pronunciation may not match how kanji are actually sung.
- Spotify or Spicetify updates can break compatibility.
- Windows ARM64 and coexistence with the Store version are untested.

## Tested on

Windows 11 x64 / Spotify 1.3.6.1921 / Spicetify 2.46.3 / ivLyrics 7.0.16

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

Build output goes to `dist/`.

```powershell
python scripts/build_spotx_adapter.py
python scripts/prepare_release.py
python scripts/fetch_distribution_inputs.py
python scripts/build_installer.py
```

| Path | Role |
| --- | --- |
| `bridge.py` | Local helper (source lookup, matching) |
| `phonetics.py` | Automatic pronunciation |
| `hangul-lyrics.js` | Spicetify extension |
| `start.ps1`, `stop.ps1` | Start / stop |
| `installer/` | NSIS installer |
| `scripts/` | Release and build scripts |

Release process: [docs/RELEASE.md](docs/RELEASE.md) (Korean).

</details>

## License

GPL-3.0-or-later. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled components. This does not grant any right to redistribute lyrics.
