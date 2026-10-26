# @file test_dependencies.py
# @author: ForUltraplayer
# @brief Check manifest integrity and ensure detection failures cannot become successful promotions.
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from dependencies import load, fingerprint, verify
from upstream_updates import check, promote, stage


class DependenciesTest(unittest.TestCase):
    def test_manifest_rejects_artifact_traversal(self):
        data = copy.deepcopy(load())
        data['artifacts']['../outside.zip'] = next(iter(data['artifacts'].values()))
        with tempfile.TemporaryDirectory() as area:
            path = Path(area, 'components.json')
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError): load(path)

    def test_digest_and_size_are_both_checked(self):
        with tempfile.TemporaryDirectory() as area:
            path = Path(area, 'source.zip'); path.write_bytes(b'changed')
            with self.assertRaises(ValueError): verify(path, {'bytes': 7, 'sha256': '0'*64})

    def test_outage_is_not_reported_as_current(self):
        data = {'components': {'ivlyrics': {'repository': 'a/b', 'version': '1.0.0'}}}
        result = check(data, get=lambda _: (_ for _ in ()).throw(OSError()))
        self.assertEqual('unavailable', result['components'][0]['status'])

    def test_commit_tracking_does_not_follow_old_release_tags(self):
        data = {'components': {'spotx': {'repository': 'a/b', 'revision': 'old', 'track': 'commit'}}}
        result = check(data, get=lambda url: [{'sha': 'new'}])
        self.assertEqual('candidate', result['components'][0]['status'])
        self.assertEqual('new', result['components'][0]['latest'])

    def test_unchanged_size_is_not_claimed_as_verified(self):
        result = check({'components': {'spotify': {'url': 'https://example.com', 'bytes': 10}}}, head=lambda _: 10)
        self.assertEqual('size-unchanged', result['components'][0]['status'])

    def test_failed_or_stale_proof_cannot_promote(self):
        with tempfile.TemporaryDirectory() as area:
            candidate = Path(area, 'candidate.json'); candidate.write_text(json.dumps(load()))
            report = Path(area, 'report.json')
            for proof in ({'result': 'failed'}, {'result': 'passed', 'manifest': fingerprint(load()), 'baseline': 'old'}):
                report.write_text(json.dumps(proof))
                with self.assertRaises(ValueError): promote(candidate, report)

    def test_older_candidate_is_rejected_before_network_access(self):
        with patch('upstream_updates.api') as api:
            with self.assertRaises(ValueError): stage('spicetify', 'v0.0.1', Path('unused'))
            api.assert_not_called()


if __name__ == '__main__': unittest.main()
