# SpotX + ivLyrics + Hangul Pronunciation (Windows)

[한국어](README.md) | **English**

Shows the Korean (Hangul) pronunciation of Japanese songs in the Spotify desktop lyrics view. Pronunciation is pulled from Haneum and Namuwiki and matched line by line against Spotify's lyrics. YouTube links can also play in the same playlists as Spotify tracks.

Built on [SpotX](https://github.com/SpotX-Official/SpotX) + [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics). Public version: 0.7.8.

> An unofficial hobby project. Maintenance and updates are not guaranteed, so please read the [Disclaimer](#disclaimer) first.

**[⬇ Download (v0.7.8)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.7.8)** · [Release history](https://github.com/ForUltraplayer/SPOTIFY_PC/releases)

## Install

No need to install Spotify, SpotX or Python first. The installer includes Python and Node.

1. Download and run `SpotifyHangul-0.7.8-Setup.exe`.
2. Pick an install folder (default: `%LOCALAPPDATA%\Programs\SpotifyHangul`).
3. The installer downloads the official Spotify files (~150 MB).

No admin rights needed. The beta EXE is not code-signed.

## Usage

1. Launch with the **Spotify 한글 가사** desktop shortcut.
2. Open the **ivLyrics** view in Spotify.
3. In ivLyrics settings, turn on original lyrics and Hangul pronunciation.

Per-song source URLs and automatic pronunciation are under **한글 발음 자료** in the profile menu.

> [!IMPORTANT]
> Opened from the regular Spotify shortcut, pronunciation and YouTube tracks don't work. Always use the **Spotify 한글 가사** shortcut. On PCs that used 0.5.x, if the original Spotify's "open automatically after you log on" setting is on, that Spotify opens first when Windows starts. Turn it off in Spotify's settings or in Windows Settings > Apps > Startup.

## Features

**Hangul pronunciation**

- Matches Haneum/Namuwiki pronunciation to Spotify lyrics line by line (used only when 85%+ of Japanese lines match)
- Remembers matched sources for faster display next time
- Falls back to searching without feat., by lead artist, or by the original song for covers
- Retries failed lookups (up to 3 times, 2 s apart)
- Automatic pronunciation for lines missing from the source (off by default, following Haneum/Namuwiki conventions)
- Per-track lyric timing in seconds, with undo

**YouTube links**

- Play YouTube links alongside Spotify tracks, with playlist import and export
- Switch between audio streaming and the video player, using the existing playback bar and ivLyrics
- Shares Spotify's volume and plays at about the same loudness

**Other**

- Copy song title (right-click the title in the playback bar, song menu, profile menu)
- Installed version and manual update check in the profile menu
- Restores previous files and installation registration after failed or interrupted installs

See [YouTube integration](docs/YOUTUBE_LINKS.md) and [operations](docs/OPERATIONS.md) for implementation details and limits (Korean).

<details>
<summary>0.7.x changes</summary>

- 0.7.2: fix first YouTube audio playback failures (wait until a fresh stream URL is served, then retry once if it still fails)
- 0.7.2: align automatic pronunciation with authored Korean conventions (long vowels dropped, sokuon as ㅅ)
- 0.7.3: start without a helper error when the shortcut is pressed twice or right after installation
- 0.7.3: no PowerShell window on launch, and Spotify opens sooner
- 0.7.3: fix "Failed to fetch" and YouTube module load failures on PCs running network filters such as AdGuard
- 0.7.3: fix missing thumbnails for YouTube videos whose ID contains "ad"
- 0.7.4: ask before updating, then download with progress, install, and relaunch
- 0.7.4: show the installed version and check for updates from Spotify's profile menu
- 0.7.4: start the installed desktop overlay when lyrics open (or 「가사 열기」 on a YouTube track) while **Desktop overlay** is on
- 0.7.5: YouTube audio mode no longer plays louder than Spotify songs; it applies the YouTube player's loudness normalization
- 0.7.5: the volume slider now gives YouTube audio and video about the same loudness as Spotify songs at the same position
- 0.7.5: Spotify songs and YouTube links share one volume; a change made on a YouTube link carries over to the next Spotify song
- 0.7.6: more reliable automatic updates; new versions are still found if the release repository address changes
- 0.7.8: fixes installs that ended with "Installation failed" on PCs with a long Windows user name, among others
- 0.7.8: the installer and updater appear in English on Windows that is not set to Korean, and an unusable installation folder is refused as soon as it is chosen (from the 0.7.7 pre-release)

</details>

## Desktop lyrics overlay

The desktop lyrics overlay is installed separately. Download the installer of the modified build with playback buttons (`lyrics-plus-overlay_…_x64-setup.exe`) from the [ivLyrics-overlay fork releases](https://github.com/ForUltraplayer/ivLyrics-overlay/releases/latest), install it, then turn on **General > Desktop overlay** in the ivLyrics settings. While it is on, the overlay starts when lyrics open or when you press 「가사 열기」 on a YouTube track.

The original overlay repository does not declare a license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component notices.

## Update / Uninstall

- **Automatic updates**: the shortcut checks for new versions when launched, at least 4 hours after the previous check. If one is found it asks first; on Yes it downloads, closes Spotify, installs, and relaunches. The profile menu entry 「업데이트 확인」 checks right away.
- **Manual install / update**: close Spotify and the overlay, then run `SpotifyHangul-0.7.8-Setup.exe` into the same folder.
- **Uninstall**: Windows Settings > Apps > Installed apps > **Spotify 한글 가사**. Your existing Spotify and pronunciation cache are kept.

Spotify's own auto-update is blocked to keep the patches. New Spotify versions come with new installer releases.

<details>
<summary>Upgrading from older versions</summary>

- 0.6.0, 0.6.1 and 0.6.3 upgrade directly. The first upgrade from 0.6.3 downloads about 150 MB of official Spotify files again.
- 0.7.3 and earlier download silently every 8 hours without asking and apply before the next launch.
- From 0.7.0 the updater selects only GitHub releases not marked as prerelease.
- The overlay bundled with 0.7.0 is removed from the install folder on update; a separately installed overlay is left alone.

</details>

## Known issues

- Songs without Hangul pronunciation online won't show any.
- Automatic pronunciation may not match how kanji are actually sung.
- YouTube video mode can't go below the video player's minimum volume, so at very low slider positions it can be louder than Spotify songs.
- Spotify or Spicetify updates can break compatibility.
- First launch on a separate clean PC, Windows 10, Windows ARM64 and coexistence with the Store version are untested.

## Tested on

Windows 11 x64 / Spotify 1.3.6.1921 / Spicetify 2.46.4 / ivLyrics 7.0.16

## Stored data

Pronunciation cache lives in `%LOCALAPPDATA%\ivLyricsHangul\` (up to 500 songs, 30 days). It's not removed on update or uninstall.

More in [operations](docs/OPERATIONS.md), [verification](docs/VERIFICATION.md), [integration](docs/SPOTX_INTEGRATION.md) and [distribution preparation](docs/DISTRIBUTION_PLAN.md) (Korean).

## Development

<details>
<summary>Tests and build</summary>

Requires Python and Node.js.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p "test_*.py"
node --test (Get-ChildItem test_*.cjs).Name
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

## Disclaimer

- This is an unofficial hobby project, provided as is without any warranty. Maintenance, updates and replies to issues happen when time allows and may stop without notice. Spotify changes can break features at any time.
- This project is not affiliated with, endorsed by or sponsored by Spotify AB. Spotify is a trademark of Spotify AB.
- The installer applies SpotX patches to the official Spotify client and blocks its automatic updates. Modifying the client and blocking ads may go against the [Spotify Terms of Use](https://www.spotify.com/us/legal/end-user-agreement/), and Spotify may restrict accounts that do so. Use it at your own risk.
- Lyrics and Hangul readings belong to their respective rights holders. This project does not distribute lyrics; they are only looked up and cached on your own PC.
- YouTube playback is subject to the YouTube Terms of Service.
- Parts will be taken down on request from a rights holder. Please reach out through [Issues](https://github.com/ForUltraplayer/SPOTIFY_PC/issues).

## License

GPL-3.0-or-later. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled components. This does not grant any right to redistribute lyrics.
