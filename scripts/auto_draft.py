# @file auto_draft.py
# @brief Turn new stable Spicetify/ivLyrics releases into a tested draft release the owner installs before publishing.
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from dependencies import ROOT, load
from upstream_updates import check, stage, promote

# Only these have an immutable stage step; SpotX, Node and Spotify still change by hand.
STAGEABLE = {'spicetify': 'Spicetify', 'ivlyrics': 'ivLyrics'}
CANDIDATE = ROOT / 'work/candidate-components.json'
REPORT = ROOT / 'work/compatibility-candidate.json'
REPO = os.environ.get('GITHUB_REPOSITORY', 'ForUltraplayer/SPOTIFY_PC')


def run(*command):
    subprocess.run(command, cwd=ROOT, check=True)


def output(*command):
    return subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf-8').stdout


def candidates(status):
    """(component, upstream tag, version) for each stageable component with a newer stable release."""
    return [(row['component'], row['url'].rsplit('/', 1)[1], row['latest']) for row in status['components']
            if row['component'] in STAGEABLE and row['status'] == 'candidate']


def edit(path, replacements):
    """Replace each (old, new) pair; a pattern that is missing means the file changed shape, so stop."""
    with open(ROOT / path, encoding='utf-8', newline='') as file: text = file.read()
    for old, new in replacements:
        if old not in text: raise ValueError(path+': '+old+' not found')
        text = text.replace(old, new)
    with open(ROOT / path, 'w', encoding='utf-8', newline='') as file: file.write(text)


def add_history(path, line):
    """Append [line] after the last "- x.y.z: " entry of the README history."""
    with open(ROOT / path, encoding='utf-8', newline='') as file: lines = file.read().split('\n')
    last = max(i for i, row in enumerate(lines) if re.match(r'- \d+\.\d+\.\d+: ', row))
    lines.insert(last + 1, line)
    with open(ROOT / path, 'w', encoding='utf-8', newline='') as file: file.write('\n'.join(lines))


def bump(old, new, changes):
    edit('bridge.py', [('VERSION = "'+old+'"', 'VERSION = "'+new+'"')])
    edit('hangul-lyrics.js', [("version: '"+old+"',", "version: '"+new+"',")])
    edit('release.json', [('"version": "'+old+'"', '"version": "'+new+'"'), ('"helper_version": "'+old+'"', '"helper_version": "'+new+'"')])
    # The READMEs name the public version, which stays behind release.json while a pre-release is out.
    with open(ROOT / 'README.md', encoding='utf-8') as file:
        found = re.search(r'공개 버전은 (\d+\.\d+\.\d+)입니다', file.read())
    if not found: raise ValueError('README.md: the public version sentence not found')
    public = found.group(1)
    links = [('(v'+public+')', '(v'+new+')'), ('/tag/v'+public, '/tag/v'+new), ('SpotifyHangul-'+public+'-Setup.exe', 'SpotifyHangul-'+new+'-Setup.exe')]
    edit('README.md', [('공개 버전은 '+public+'입니다', '공개 버전은 '+new+'입니다')] + links)
    edit('README.en.md', [('Public version: '+public+'.', 'Public version: '+new+'.')] + links)
    add_history('README.md', '- '+new+': '+', '.join(changes)+' 적용')
    add_history('README.en.md', '- '+new+': '+', '.join(changes))


def notes(old, new, rows, previous):
    """Release page text: the changes, then the install and known-issue sections of the last release."""
    sections = {}
    for part in previous.replace('\r\n', '\n').split('### ')[1:]:
        title, _, body = part.partition('\n')
        sections[title.strip()] = body.strip().replace('SpotifyHangul-'+old+'-Setup', 'SpotifyHangul-'+new+'-Setup')
    repository = lambda c: load()['components'][c]['repository']
    text = '### 변경 사항\n\n'+'\n'.join('- '+STAGEABLE[c]+' '+v+' 적용 ([원본 릴리스](https://github.com/'+repository(c)+'/releases/tag/'+t+'))' for c, t, v in rows)+'\n'
    for title in ('설치와 업데이트', '알려진 문제'):
        if sections.get(title): text += '\n### '+title+'\n\n'+sections[title]+'\n'
    english = '\n'.join('- '+STAGEABLE[c]+' '+v+'.' for c, t, v in rows)
    install = sections.get('English', '').partition('**Install:**')
    return text+'\n### English\n\n'+english+('\n\n**Install:**'+install[2] if install[1] else '')+'\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Build locally; push no branch and create no release')
    args = parser.parse_args()
    rows = candidates(check(load()))
    if not rows and not args.dry_run:
        print('No new stable Spicetify or ivLyrics release.'); return
    # Without a candidate a dry run still bumps and builds, so the pipeline can be tried on the runner.
    release = json.loads((ROOT / 'release.json').read_text(encoding='utf-8'))
    old = release['version']
    major, minor, patch = map(int, old.split('.'))
    new = f'{major}.{minor}.{patch + 1}'
    tag, branch = 'v'+new, 'auto/v'+new
    if not args.dry_run and tag in output('gh', 'api', 'repos/'+REPO+'/releases', '--paginate', '-q', '.[].tag_name').split():
        # An unpublished draft waits for the owner; a newer upstream release joins after it is published or deleted.
        print(tag+' already exists as a release or draft.'); return
    for component, upstream, version in rows:
        stage(component, upstream, CANDIDATE)
        run(sys.executable, 'scripts/check_compatibility.py', '--manifest', str(CANDIDATE), '--report', str(REPORT))
        promote(CANDIDATE, REPORT)
    bump(old, new, [STAGEABLE[c]+' '+v for c, t, v in rows] or ['dry run'])
    run(sys.executable, 'scripts/check_compatibility.py')
    out = ROOT / 'work/release-candidates' / (new+'-auto')
    run(sys.executable, 'scripts/prepare_release.py', '--output-dir', str(out))
    run(sys.executable, 'scripts/build_installer.py', '--output-dir', str(out), '--source-archive', str(out / ('SpotifyHangul-'+new+'-source-preview.zip')))
    setup = out / ('SpotifyHangul-'+new+'-Setup.exe')
    previous = '' if args.dry_run else output('gh', 'api', 'repos/'+REPO+'/releases/latest', '-q', '.body')
    (out / 'release-notes.md').write_text(notes(old, new, rows, previous), encoding='utf-8')
    if args.dry_run:
        print('Dry run: '+str(setup)); return
    bot = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com']
    run('git', 'switch', '-c', branch)
    run('git', 'add', 'components.json', 'release.json', 'bridge.py', 'hangul-lyrics.js', 'README.md', 'README.en.md')
    run('git', *bot, 'commit', '-m', 'Release '+new+': '+', '.join(STAGEABLE[c]+' '+v for c, t, v in rows)+' (automatic draft)')
    # The branch is this job's own; a draft deleted earlier may have left one behind.
    run('git', 'push', '--force', 'origin', 'HEAD:refs/heads/'+branch)
    run('gh', 'release', 'create', tag, '--repo', REPO, '--draft', '--target', branch, '--title', tag,
        '--notes-file', str(out / 'release-notes.md'), str(setup))
    print('Draft '+tag+' created from '+branch)


if __name__ == '__main__':
    main()
