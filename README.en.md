# Spotify Hangul Lyrics (Windows)

[한국어](README.md) | **English**

Shows the **Korean (Hangul) pronunciation of Japanese songs** in the lyrics view of the Spotify desktop app for Windows. It finds Hangul pronunciation written by people on the web, matches it line by line against Spotify's Japanese lyrics, and displays it alongside.

> [!NOTE]
> The current version is **0.6.1 beta**. A fresh install, uninstall and Hangul lyrics display have been confirmed on the current PC. The user also confirmed a successful 0.6.0 install on another PC. Version 0.6.1 adds bounded reading retries and GitHub self-updates; a listening review of every song is still pending.

**[⬇ Download the installer (SpotifyHangul-0.6.1-Setup.exe)](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.6.1)**

Existing users can close Spotify and run **SpotifyHangul-0.6.1-Update.exe** from the same release page. This small launcher finds the installed folder and downloads the full Setup.exe (about 65 MB).

## At a glance

| Item | Details |
| --- | --- |
| What it does | Shows Japanese lyrics with Hangul pronunciation in Spotify's lyrics view |
| Pronunciation source | Existing human-written Hangul pronunciation on Haneum and Namuwiki |
| Target | Windows x64, verified on Windows 11 |
| Built on | [SpotX](https://github.com/SpotX-Official/SpotX) + [Spicetify](https://github.com/spicetify/cli) + [ivLyrics](https://github.com/ivLis-Studio/ivLyrics) |
| Install | A single EXE that sets up Spotify and SpotX automatically and bundles Python, Spicetify and ivLyrics |
| Cost | No paid API key needed; a Spotify login is required |
| Android | Separate app: [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID) |

## How it works

The installer downloads the official Spotify x64 files, sets them up in the install folder you choose, and applies SpotX first. It then applies Spicetify and the ivLyrics lyrics app to feed in Hangul pronunciation. Your existing Spotify files are left untouched, and the integrated build uses its own Spicetify settings and backup.

```text
Integrated Spotify desktop app (with SpotX)
 └─ Spicetify (tool that adds extensions to Spotify)
     ├─ ivLyrics (lyrics app that shows original lyrics and pronunciation)
     └─ Hangul pronunciation extension (this project)
          └─ Local helper (runs only on this PC)
               └─ Looks up Haneum and Namuwiki, then matches against the original lyrics
```

The local helper is a small program that reads web pages Spotify cannot read directly. It starts when you open Spotify from the desktop shortcut and exits by itself about 30 seconds after Spotify closes. It is not registered as a service and does not start at boot.

## Features

**Pronunciation display**

- Matches Japanese lyrics and Hangul pronunciation from Haneum and Namuwiki line by line against Spotify's lyrics
- Uses a source only when it matches at least 85% of the Japanese lines and at least 5 lines (songs with only 3 to 4 Japanese lines must match every line)
- Remembers sources that passed the match so the next playback shows faster
- Lets you set the source URL per song (**한글 발음 자료**, "Hangul pronunciation sources", in the profile menu)

**Fallbacks when lyrics are not found**

- Retries without the feat. part of the title, or with the lead artist of a joint credit
- Checks title, artist, album and length to reject lyrics from a different recording (version tags such as Live are kept)
- For covers, finds the original song from the title and matches its lyrics, while keeping the timing of the current recording
- When a lyrics server is busy (429, 5xx), treats it as a temporary error and backs off only that server
- Retries failed pronunciation lookups up to three extra times at two-second intervals, with a 60-second total budget; cancels when the track changes

**Optional features**

- Automatic pronunciation: converts lines missing from the source with a dictionary (off by default; the number of generated lines is shown in the source settings)
- Title copy: copy the full title by right-clicking the song title in the bottom playback bar, from the song menu, or from the profile menu

## Installation

### Step 1: Run the all-in-one installer

**You do not need to install or run Spotify, SpotX or Python beforehand.** You only need an internet connection.

1. Download `SpotifyHangul-0.6.1-Setup.exe` from the [0.6.1 release page](https://github.com/ForUltraplayer/SPOTIFY_PC/releases/tag/v0.6.1) and run it.
2. Keep the default folder (`%LOCALAPPDATA%\Programs\SpotifyHangul`) or choose an empty dedicated folder. To update an existing installation, choose the same folder.
3. The installer downloads the official Spotify x64 files (about 150 MB), checks their size, SHA-256 and Spotify AB signature, then sets up SpotX and the lyrics features.

Administrator rights are not required, but you need write access to the install folder. The beta EXE is not code-signed. If you already have extensions, themes or ivLyrics, they are copied into the integrated build's own settings folder on the first install. Later changes to your existing settings are not synced automatically.

Automatic updates of the integrated Spotify are blocked to keep the patches in place; new Spotify versions arrive with a new integrated installer. No antivirus exclusions or boot-time autostart are added. The Microsoft Store version is not removed automatically, and running both side by side has not been verified yet. See [integration design and verification scope](docs/SPOTX_INTEGRATION.md) (Korean).

### Step 2: Use it

1. Open the integrated Spotify with the **Spotify 한글 가사** shortcut on the desktop. If another Spotify is running, the shortcut closes the previous client it recognizes and opens the integrated one.
2. Open the **ivLyrics** view in Spotify.
3. In the ivLyrics settings, turn on the original lyrics and Hangul pronunciation display.
4. If needed, set a per-song source URL and automatic pronunciation under **한글 발음 자료** ("Hangul pronunciation sources") in the profile menu.

> [!IMPORTANT]
> If you open Spotify with the regular Spotify shortcut, the local helper does not start and no pronunciation is shown. Always use the **Spotify 한글 가사** shortcut.

### Updating and uninstalling

- **First update for existing users**: close Spotify and run Update.exe, or install Setup.exe into the same folder.
- **Automatic updates after 0.6.1**: the desktop shortcut checks GitHub at startup, at least eight hours apart, downloads a release in the background, verifies the repository URL, SHA-256, size and file version, and installs before a later launch once Spotify has fully closed. Offline checks do not block playback. The same failed installation is not retried forever. No Windows service or boot-time task is added.
- **Changing the Spotify version**: the integrated Spotify does not update itself. Replace it with a new integrated installer. A new installer is also needed if the official download changes and the hash check fails.
- **Uninstall**: remove **Spotify 한글 가사** from Windows **Settings > Apps > Installed apps**. This removes the integrated Spotify, Spicetify and ivLyrics in the install folder. Your existing Spotify, user profile and personal pronunciation cache are kept.

## Limitations

- Not every song has Hangul pronunciation available. Lookups can fail because of site responses, page structure or differences in how lyrics are written.
- Automatic pronunciation can differ from how kanji are actually sung.
- Sources written per sentence can repeat the same pronunciation across several playback lines.
- Compatibility can change with Spotify and Spicetify updates.
- Windows ARM64 has not been verified.

## Verified environment

| Component | Verified version |
| --- | --- |
| Windows | 11 x64 |
| Spotify | 1.3.6.1921, official files with SpotX applied |
| SpotX | 3cfbdfd1fac3dc755155e434116e28b51acfec07 |
| Spicetify | 2.46.3 |
| ivLyrics | 7.0.16 |
| Bundled Python | CPython 3.13.17 |

Detailed results and open items are in the [verification record](docs/VERIFICATION.md) (Korean).

## Stored data

| Data | Location | Retention |
| --- | --- | --- |
| Retrieved Hangul pronunciation | `%LOCALAPPDATA%\ivLyricsHangul\cache.json` | Up to 500 songs, 30 days |
| Source URLs that matched the original lyrics | `%LOCALAPPDATA%\ivLyricsHangul\aliases.json` | Up to 500 songs, 30 days |
| Failed lookups | Local helper memory | 10 minutes |
| ivLyrics' own cache | `ivLyricsCache` in Spotify's internal IndexedDB | 365 days by default |

The personal cache is kept apart from the install folder and is not deleted on update or uninstall. Account information and the personal cache are never included in releases. Locations and how to stop the helper manually are in the [operations guide](docs/OPERATIONS.md) (Korean).

## For developers

<details>
<summary>Tests, source release and installer build</summary>

The development PC needs Python and Node.js. Dependencies are installed into the project's own `vendor` folder.

```powershell
python -m pip install --target vendor -r requirements.txt
python -m unittest discover -s . -p test_bridge.py -v
node --test test_extension.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_installer.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_bootstrap.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test_auto_update.ps1
```

The following commands create the source release and installer in `dist/`. External release files are pinned to official download URLs and SHA-256 hashes.

```powershell
python scripts/build_spotx_adapter.py
python scripts/prepare_release.py
python scripts/fetch_distribution_inputs.py
python scripts/build_installer.py
```

The local helper looks for Python in this order: the `IVLYRICS_HANGUL_PYTHON` environment variable, `runtime/pythonw.exe`, `python-path.txt`, then a real Python on PATH. If startup fails, the error is written to `start-error.txt` in the install folder.

| Path | Role |
| --- | --- |
| `bridge.py` | Local helper: web lookup, matching against Japanese lyrics, local HTTP responses |
| `phonetics.py` | Dictionary-based automatic pronunciation |
| `hangul-lyrics.js` | Spicetify extension: feeds pronunciation to ivLyrics, caching, title copy |
| `start.ps1`, `stop.ps1` | Start the helper and Spotify, stop the helper |
| `installer/` | NSIS installer and Spicetify integration script |
| `scripts/` | Release preparation, external input download, installer build |

See the [release guide](docs/RELEASE.md) (Korean) for the release process and what is included.

</details>

## License

The source of this project is licensed under GPL-3.0-or-later. Licenses and corresponding sources of the bundled third-party components are listed in [third-party components](THIRD_PARTY_NOTICES.md) and the [license review](docs/LICENSE_REVIEW.md) (Korean). The software license does not grant any right to redistribute the lyrics themselves.

The `android/` folder in this repository is history from before the Android app was split out. Android development and APK releases happen in [SPOTIFY_ANDROID](https://github.com/ForUltraplayer/SPOTIFY_ANDROID).

The [current Android beta APK](https://github.com/ForUltraplayer/SPOTIFY_ANDROID/releases/tag/v2.0.1-hangul.4) provides playback and Hangul lyrics in one app. Its README and release notes describe a failed Google login case and the email login alternative using a Spotify password. Apple and Facebook login have not been tested on a device.
