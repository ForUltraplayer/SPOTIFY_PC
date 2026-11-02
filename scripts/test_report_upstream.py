# @file test_report_upstream.py
# @brief Check upstream change issues: safe quoting of upstream text, report contents and one open issue per component.
import json
import unittest
import report_upstream


class ReportUpstreamTest(unittest.TestCase):
    def test_fence_outlasts_backticks_inside_and_truncates(self):
        text = report_upstream.fence('@someone fixed #12 ```code```', 1000)
        self.assertTrue(text.startswith('````text\n') and text.endswith('\n````'))
        self.assertIn('…(이하 생략)', report_upstream.fence('x' * 20, 5))
        self.assertIn('(없음)', report_upstream.fence(None, 10))

    def test_release_report_has_notes_commits_and_files(self):
        calls = []
        def get(path):
            calls.append(path)
            if '/compare/' in path:
                return {'ahead_by': 2, 'commits': [{'commit': {'message': 'old\n\nbody'}}, {'commit': {'message': 'new'}}],
                        'files': [{'filename': 'Utils.js'}]}
            return {'body': 'Notes @user'}
        row = {'component': 'ivlyrics', 'latest': '7.0.19', 'url': 'https://github.com/ivLis-Studio/ivLyrics/releases/tag/v7.0.19'}
        prefix, title, text = report_upstream.report(row, {'repository': 'ivLis-Studio/ivLyrics', 'version': '7.0.18', 'revision': 'abc'}, get)
        self.assertEqual(('원본 업데이트: ivLyrics ', '원본 업데이트: ivLyrics 7.0.19'), (prefix, title))
        self.assertEqual(['ivLis-Studio/ivLyrics/compare/abc...v7.0.19', 'ivLis-Studio/ivLyrics/releases/tags/v7.0.19'], calls)
        self.assertIn('```text\nnew\nold\n```', text)
        self.assertIn('```text\nNotes @user\n```', text)
        self.assertIn('Utils.js', text)
        self.assertIn('자동 초안', text)

    def test_commit_tracked_report_uses_short_revisions(self):
        row = {'component': 'spotx', 'latest': 'c'*40, 'url': 'https://github.com/x/y/commit/'+'c'*40}
        get = lambda path: {'ahead_by': 0, 'commits': [], 'files': []}
        prefix, title, text = report_upstream.report(row, {'repository': 'x/y', 'track': 'commit', 'revision': 'a'*40}, get)
        self.assertEqual('원본 업데이트: SpotX '+'c'*7, title)
        self.assertNotIn('릴리스 노트', text)
        self.assertIn('따로 요청', text)

    def run_publish(self, issues, title='원본 업데이트: SpotX bbbbbbb'):
        calls = []
        def run(*args):
            calls.append(args[:2])
            return json.dumps(issues) if args[:2] == ('issue', 'list') else ''
        return report_upstream.publish('원본 업데이트: SpotX ', title, 'body', run), calls

    def test_publish_creates_moves_or_skips(self):
        self.assertEqual(('created', [('issue', 'list'), ('issue', 'create')]), self.run_publish([]))
        result, calls = self.run_publish([{'number': 3, 'title': '원본 업데이트: SpotX aaaaaaa', 'state': 'OPEN'}])
        self.assertEqual(('updated', [('issue', 'list'), ('issue', 'edit'), ('issue', 'comment')]), (result, calls))
        # A closed issue of the same version means the owner already saw it.
        self.assertEqual('known', self.run_publish([{'number': 2, 'title': '원본 업데이트: SpotX bbbbbbb', 'state': 'CLOSED'}])[0])
        # A closed older issue is not reopened; the new version gets its own issue.
        self.assertEqual('created', self.run_publish([{'number': 1, 'title': '원본 업데이트: SpotX aaaaaaa', 'state': 'CLOSED'}])[0])


if __name__ == '__main__':
    unittest.main()
