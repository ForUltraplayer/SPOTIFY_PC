# @file upstream_updates.py
# @author: ForUltraplayer
# @brief Detect upstream changes, stage immutable candidates and promote only inspected component manifests.
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
from dependencies import ROOT, load, fingerprint, source_fingerprint, verify


def request(url, method='GET'):
    headers = {'User-Agent': 'SpotifyHangul-maintenance', 'Accept': 'application/vnd.github+json'}
    if url.startswith('https://api.github.com/') and os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer '+os.environ['GH_TOKEN']
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers, method=method), timeout=45)


def api(path):
    with request('https://api.github.com/repos/'+path) as response:
        return json.load(response)


def check(data, get=api, head=None):
    results = []
    for name, item in data['components'].items():
        if 'repository' not in item: continue
        repo = item['repository']
        current = item.get('revision') if item.get('track') == 'commit' else item['version']
        try:
            if item.get('track') == 'commit':
                latest = get(repo+'/commits?per_page=1')[0]
                version = latest['sha']
                url = 'https://github.com/'+repo+'/commit/'+version
            else:
                latest = get(repo+'/releases/latest')
                version = latest['tag_name'].removeprefix('v')
                url = latest['html_url']
            result = {'component': name, 'current': current, 'latest': version,
                      'status': 'current' if current == version else 'candidate', 'url': url}
            if item.get('watch_prereleases'):
                beta = next((r for r in get(repo+'/releases?per_page=20') if r['prerelease'] and not r['draft']), None)
                if beta: result['beta'] = {'tag': beta['tag_name'], 'url': beta['html_url']}
            results.append(result)
        except Exception as error:
            results.append({'component': name, 'status': 'unavailable', 'error': type(error).__name__})
    if 'spotify' in data['components']:
        item = data['components']['spotify']
        try:
            if head is None:
                with request(item['url'], 'HEAD') as response: size = int(response.headers.get('Content-Length', 0))
            else: size = head(item['url'])
            results.append({'component': 'spotify', 'status': 'candidate' if size != item['bytes'] else 'size-unchanged',
                            'bytes': size, 'note': 'Size alone does not prove version or digest equality.'})
        except Exception as error:
            results.append({'component': 'spotify', 'status': 'unavailable', 'error': type(error).__name__})
    return {'checked_at': datetime.now(timezone.utc).isoformat(), 'manifest': fingerprint(data), 'components': results}


def download(name, url, expected=None, size=None):
    destination = ROOT / 'work/downloads' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    with request(url) as response:
        body = response.read(60 * 1024 * 1024 + 1)
    if len(body) > 60 * 1024 * 1024 or not body.startswith(b'PK'): raise ValueError('Invalid candidate archive')
    digest = hashlib.sha256(body).hexdigest()
    if expected and digest != expected: raise ValueError('Candidate digest differs from GitHub')
    if size and len(body) != size: raise ValueError('Candidate size differs from GitHub')
    # Immutable names are not silently overwritten when upstream reuses a version.
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        raise ValueError('Candidate artifact name already contains different bytes')
    destination.write_bytes(body)
    return {'url': url, 'sha256': digest, 'bytes': len(body)}


def stage(component, tag, output):
    if component not in ('spicetify', 'ivlyrics') or not re.fullmatch(r'v?\d+\.\d+\.\d+', tag):
        raise ValueError('Automatic staging supports stable Spicetify/ivLyrics releases only')
    data = copy.deepcopy(load())
    item = data['components'][component]
    repo = item['repository']
    version = tag.removeprefix('v')
    if tuple(map(int, version.split('.'))) <= tuple(map(int, item['version'].split('.'))):
        raise ValueError('Candidate must be newer than the selected version')
    release = api(repo+'/releases/tags/'+tag)
    if release['draft'] or release['prerelease']: raise ValueError('Not a stable release')
    revision = api(repo+'/commits/'+tag)['sha']
    for key in ('artifact', 'source_artifact'):
        if key in item: data['artifacts'].pop(item[key])
    if component == 'spicetify':
        name = 'spicetify-'+version+'-windows-x64.zip'
        asset = next(a for a in release['assets'] if a['name'] == name)
        digest = asset.get('digest', '')
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest): raise ValueError('GitHub asset has no SHA-256')
        expected_url = 'https://github.com/'+repo+'/releases/download/'+tag+'/'+name
        if asset['browser_download_url'] != expected_url: raise ValueError('Unexpected asset URL')
        data['artifacts'][name] = download(name, expected_url, digest[7:], asset['size'])
        item['artifact'] = name
    name = ('ivLyrics' if component == 'ivlyrics' else 'spicetify')+'-'+version+'-source.zip'
    data['artifacts'][name] = download(name, 'https://codeload.github.com/'+repo+'/zip/'+revision)
    item.update(version=version, revision=revision, source_artifact=name)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
    load(output)


def promote(candidate, report_path):
    data = load(candidate)
    proof = json.loads(report_path.read_text(encoding='utf-8'))
    if proof.get('result') != 'passed' or proof.get('manifest') != fingerprint(data) or proof.get('baseline') != fingerprint(load()) or proof.get('source') != source_fingerprint():
        raise ValueError('Candidate, baseline or source changed after inspection')
    for name, asset in data['artifacts'].items(): verify(ROOT / 'work/downloads' / name, asset)
    (ROOT / 'components.json').write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
    print('Candidate promoted to source manifest. Re-run compatibility before building. Playback validation remains required.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('check', 'stage', 'promote'))
    parser.add_argument('--component')
    parser.add_argument('--tag')
    parser.add_argument('--candidate', type=Path, default=ROOT / 'work/candidate-components.json')
    parser.add_argument('--report', type=Path, default=ROOT / 'work/compatibility-candidate.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'work/upstream-status.json')
    args = parser.parse_args()
    if args.action == 'stage': stage(args.component, args.tag, args.candidate)
    elif args.action == 'promote': promote(args.candidate, args.report)
    else:
        result = check(load())
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
        for row in result['components']:
            print(row['component']+': '+row['status']+' '+row.get('latest', ''))
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
                summary.write('## Upstream component status\n\n')
                for row in result['components']:
                    summary.write('- '+row['component']+': '+row['status']+' '+row.get('latest', '')+'\n')
        if any(row['status'] == 'unavailable' for row in result['components']): raise SystemExit(1)


if __name__ == '__main__': main()
