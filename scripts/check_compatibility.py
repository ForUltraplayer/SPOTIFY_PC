# @file check_compatibility.py
# @author: ForUltraplayer
# @brief Gate installer builds and component promotion on digest-bound regression and upstream contract checks.
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from dependencies import ROOT, load, verify, fingerprint, source_fingerprint
from patch_ivlyrics_sync import patch_tree


def run(command, env=None):
    subprocess.run(command, cwd=ROOT, check=True, timeout=240, env=env)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, default=ROOT / 'components.json')
    parser.add_argument('--report', type=Path, default=ROOT / 'work/compatibility.json')
    args = parser.parse_args()
    data = load(args.manifest)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = {'result': 'failed', 'manifest': fingerprint(data), 'baseline': fingerprint(load()),
              'source': source_fingerprint(), 'runtime_playback': 'pending', 'ui_tests_required': True,
              'time': datetime.now(timezone.utc).isoformat()}
    try:
        for name, asset in data['artifacts'].items():
            verify(ROOT / 'work/downloads' / name, asset)
        for name, asset in data.get('test_fixtures', {}).items():
            verify(ROOT / 'work/downloads' / name, asset)
        iv = data['components']['ivlyrics']
        with tempfile.TemporaryDirectory(prefix='contracts-', dir=ROOT / 'work') as area:
            with zipfile.ZipFile(ROOT / 'work/downloads' / iv['source_artifact']) as archive:
                # Read only the exact files exercised by the contract check; never execute archive installers.
                for name in ('index.js', 'Pages.js', 'OptionsMenu.js', 'Utils.js', 'LyricsService.js', 'AIAddonManager.js', 'LyricsAddonManager.js', 'Addon_Lyrics_LyricsPlus.js'):
                    matches = [entry for entry in archive.namelist() if entry.count('/') == 1 and entry.endswith('/'+name)]
                    if len(matches) != 1: raise ValueError('Upstream layout changed: '+name)
                    Path(area, name).write_bytes(archive.read(matches[0]))
            patch_tree(area)
            run(['node', 'scripts/check_ivlyrics.cjs', area])
            run(['node', '--test', 'test_extension.cjs', 'test_youtube_library.cjs', 'test_youtube_overlay.cjs',
                 'test_youtube_ivlyrics.cjs', 'test_youtube_navigation.cjs', 'test_youtube_desktop.cjs',
                 'test_ivlyrics_sync.cjs', 'test_ivlyrics_sync_ui.cjs', 'test_ivlyrics_sync_patch.cjs', 'test_youtube_now_playing.cjs'],
                env=dict(os.environ, IVLYRICS_SOURCE_DIR=area, IVLYRICS_REQUIRE_UI_TESTS='1'))
            cli = data['components']['spicetify']
            with zipfile.ZipFile(ROOT / 'work/downloads' / cli['artifact']) as archive:
                Path(area, 'spicetify.exe').write_bytes(archive.read('spicetify.exe'))
            version = subprocess.check_output([str(Path(area, 'spicetify.exe')), '--version'], timeout=15, text=True).strip()
            if version.lstrip('v') != cli['version']: raise ValueError('Spicetify executable version mismatch')
        spotx = data['components']['spotx']
        receipt = json.loads((ROOT / 'third_party/spotx/upstream.json').read_text())
        if receipt['revision'] != spotx['revision']: raise ValueError('Regenerate and review the SpotX adapter')
        for name, digest in receipt['files'].items():
            import hashlib
            if hashlib.sha256((ROOT / 'third_party/spotx' / name).read_bytes()).hexdigest() != digest:
                raise ValueError('SpotX adapter changed: '+name)
        run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_bridge.py'])
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_dependencies.py'])
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_release_sources.py'])
        run([sys.executable, '-m', 'unittest', 'test_playlist_files', 'test_youtube_stream', 'test_playback_control', 'test_playback_http'])
        for name in ('test_installer.ps1', 'test_bootstrap.ps1', 'test_auto_update.ps1', 'test_managed_ivlyrics.ps1', 'test_start.ps1',
                     'test_desktop_overlay.ps1', 'test_payload_transaction.ps1'):
            command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/'+name]
            if name == 'test_auto_update.ps1':
                command += ['-VerifiedInstaller', str(ROOT/'work/downloads'/next(iter(data['test_fixtures'])))]
            run(command)
        report['result'] = 'passed'
    finally:
        args.report.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
