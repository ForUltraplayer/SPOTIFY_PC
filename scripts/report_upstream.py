# @file report_upstream.py
# @brief Keep one GitHub issue per changed upstream component with its release notes, commits and changed files.
import json
import os
import re
import subprocess
import tempfile
from dependencies import ROOT, load
from upstream_updates import api, check

REPO = os.environ.get('GITHUB_REPOSITORY', 'ForUltraplayer/SPOTIFY_PC')
NAMES = {'spotify': 'Spotify', 'spicetify': 'Spicetify', 'ivlyrics': 'ivLyrics', 'spotx': 'SpotX', 'yt_dlp': 'yt-dlp', 'node': 'Node.js'}
AUTOMATIC = ('spicetify', 'ivlyrics')
LABEL = 'upstream'


def gh(*args):
    return subprocess.run(['gh', *args], cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf-8').stdout


def fence(text, limit):
    """Upstream text goes in a code fence, so an @name notifies nobody and #123 links nothing here."""
    text = (text or '').strip() or '(없음)'
    if len(text) > limit: text = text[:limit]+'\n…(이하 생략)'
    tick = '`' * max(3, max(map(len, re.findall(r'`+', text)), default=0)+1)
    return tick+'text\n'+text+'\n'+tick


def report(row, item, get=api):
    """(title prefix, title, body) for one component whose upstream moved."""
    name = NAMES[row['component']]
    if row['component'] == 'spotify':
        return ('원본 업데이트: Spotify ', '원본 업데이트: Spotify 설치 파일 '+str(row['bytes'])+' 바이트',
                '공식 설치 파일의 크기가 '+str(item['bytes'])+' 바이트에서 '+str(row['bytes'])+' 바이트로 바뀌었다. '
                '크기만으로 버전을 확정할 수 없으므로 배포 서명과 SHA-256, SpotX와 Spicetify 적용을 확인한 뒤 components.json을 직접 고친다.\n')
    repo, commit = item['repository'], item.get('track') == 'commit'
    head = row['latest'] if commit else row['url'].rsplit('/', 1)[1]
    base = item.get('revision') or 'v'+item['version']
    shown = row['latest'][:7] if commit else row['latest']
    compare = get(repo+'/compare/'+base+'...'+head)
    commits, files = compare.get('commits', []), compare.get('files', [])
    text = ('**'+name+'** '+(base[:7] if commit else item['version'])+' → '+shown+'\n\n'
            '| 항목 | 내용 |\n| --- | --- |\n| 원본 | '+row['url']+' |\n'
            '| 비교 | https://github.com/'+repo+'/compare/'+base+'...'+head+' |\n'
            '| 규모 | 커밋 '+str(compare['ahead_by'])+'개, 바뀐 파일 '+str(len(files))+('개 이상' if len(files) >= 300 else '개')+' |\n'
            '| 반영 | '+('자동 초안 워크플로가 이 버전으로 초안 릴리스를 만든다. 초안을 설치해 확인한 뒤 공개한다.' if row['component'] in AUTOMATIC
                       else '자동 반영 대상이 아니다. 반영하려면 따로 요청한다.')+' |\n')
    if not commit: text += '\n### 원본 릴리스 노트\n\n'+fence(get(repo+'/releases/tags/'+head).get('body'), 6000)+'\n'
    subjects = [c['commit']['message'].split('\n', 1)[0] for c in reversed(commits)][:60]
    text += '\n### 커밋 (최신순, '+str(compare['ahead_by'])+'개 중 '+str(len(subjects))+'개)\n\n'+fence('\n'.join(subjects), 8000)+'\n'
    text += '\n### 바뀐 파일 (최대 100개)\n\n'+fence('\n'.join(f['filename'] for f in files[:100]), 6000)+'\n'
    return '원본 업데이트: '+name+' ', '원본 업데이트: '+name+' '+shown, text


def publish(prefix, title, text, run=gh):
    """Create the issue, or move this component's open issue to the new version with a comment so it notifies."""
    issues = json.loads(run('issue', 'list', '--repo', REPO, '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,title,state'))
    # A version already reported, open or closed, is not reported again.
    if any(issue['title'] == title for issue in issues): return 'known'
    with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8') as file: file.write(text)
    try:
        current = next((issue for issue in issues if issue['state'] == 'OPEN' and issue['title'].startswith(prefix)), None)
        if current:
            run('issue', 'edit', str(current['number']), '--repo', REPO, '--title', title, '--body-file', file.name)
            run('issue', 'comment', str(current['number']), '--repo', REPO, '--body', title.removeprefix('원본 업데이트: ')+'(으)로 갱신했다.')
            return 'updated'
        run('issue', 'create', '--repo', REPO, '--title', title, '--label', LABEL, '--body-file', file.name)
        return 'created'
    finally: os.unlink(file.name)


def main():
    data = load()
    rows = [row for row in check(data)['components'] if row['status'] == 'candidate' and row['component'] in NAMES]
    if rows: gh('label', 'create', LABEL, '--repo', REPO, '--color', '0E8A16', '--description', '원본 구성 요소 변경 알림', '--force')
    for row in rows:
        prefix, title, text = report(row, data['components'][row['component']])
        print(title+': '+publish(prefix, title, text))


if __name__ == '__main__':
    main()
