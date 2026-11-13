import datetime as dt
import json
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from official_content_policy import (apply_bounded_metadata_policy, apply_metadata_policy, bounded_withheld_history,
                                     build_official_news_snapshot,
                                     feed_review_snapshot,
                                     replace_source_snapshot, review_and_replace_source_snapshot,
                                     SourceSnapshotReviewError,
                                     synchronize_source_states, has_schema_version_1,
                                     validate_official_source_registry)

class MetadataPolicy(unittest.TestCase):
    def test_registry_schema_requires_exact_integer_version(self):
        self.assertTrue(has_schema_version_1({'schemaVersion': 1}))
        for value in [True, 1.0, '1', None]:
            with self.subTest(value=value):
                self.assertFalse(has_schema_version_1({'schemaVersion': value}))
    now = dt.datetime(2026, 10, 7, tzinfo=dt.timezone.utc)
    def test_all_feed_failures_still_create_a_fresh_policy_review_snapshot(self):
        snapshot = build_official_news_snapshot(
            [{'id': 's', 'lastError': 'timeout'}], [self.row()], self.now, 1, 1)
        self.assertEqual(snapshot['generatedAt'], self.now.isoformat())
        self.assertEqual(snapshot['collectionStatus'], {
            'state': 'all-attempted-sources-failed', 'reviewedAt': self.now.isoformat(),
            'attemptedSourceCount': 1, 'failedSourceCount': 1,
            'cachedItemsRevalidated': True,
        })
        self.assertEqual(snapshot['sources'][0]['lastError'], 'timeout')
        self.assertEqual([row['id'] for row in snapshot['items']], ['a'])

    sources = [{'id': 's', 'reuse': 'metadata-links-only', 'url': 'https://official.example/rss',
                'articleHosts': ['official.example'], 'format': 'rss',
                'evidenceUrl': 'https://official.example/feed-policy',
                'licenseEvidenceUrl': 'https://official.example/terms',
                'feedAcceptance': 'accepted', 'feedVerifiedAt': '2026-10-07'}]
    sources[0]['feedReview'] = feed_review_snapshot(sources[0])
    def row(self, **patch):
        return {'id':'a','sourceId':'s','verified':True,'sourceUrl':self.sources[0]['url'],
                'url':'https://official.example/a','title':'Notice','region':'Region','sourceLabel':'Official',
                'publishedAt':self.now.isoformat(),'fetchedAt':self.now.isoformat(),**patch}
    def test_traceable_fresh_metadata(self):
        rows, rejected = apply_metadata_policy([self.row()], self.sources, self.now)
        self.assertEqual(len(rows), 1); self.assertEqual(rejected, [])
    def test_metadata_policy_filters_before_visible_item_limit(self):
        stale = self.row(id='stale-metadata', fetchedAt=(self.now-dt.timedelta(days=91)).isoformat())
        fresh = [self.row(id=f'fresh-{index}', publishedAt=(self.now-dt.timedelta(seconds=index+1)).isoformat())
                 for index in range(500)]
        rows, withheld = apply_bounded_metadata_policy([stale, *fresh], self.sources, self.now, 500)
        self.assertEqual(len(rows), 500)
        self.assertEqual(rows[0]['id'], 'fresh-0')
        self.assertEqual(len(withheld), 1)
        self.assertEqual(withheld[0]['reason'], 'metadata-freshness-expired')
    def test_valid_items_beyond_visible_limit_are_preserved_for_review_history(self):
        fresh = [self.row(id=f'fresh-{index}', publishedAt=(self.now-dt.timedelta(seconds=index+1)).isoformat())
                 for index in range(501)]
        rows, withheld = apply_bounded_metadata_policy(fresh, self.sources, self.now, 500)
        self.assertEqual(len(rows), 500)
        self.assertEqual(len(withheld), 1)
        self.assertEqual(withheld[0]['record']['id'], 'fresh-500')
        self.assertEqual(withheld[0]['reason'], 'publication-cap-exceeded')
    def test_bounded_withheld_history_keeps_newest_reviewed_publications(self):
        history = [{'reviewedAt': self.now.isoformat(), 'reason': 'publication-cap-exceeded',
                    'record': self.row(id=f'overflow-{index}',
                        publishedAt=(self.now-dt.timedelta(seconds=index)).isoformat())}
                   for index in range(501)]
        kept = bounded_withheld_history(history, 500)
        self.assertEqual(len(kept), 500)
        self.assertEqual(kept[0]['record']['id'], 'overflow-0')
        self.assertNotIn('overflow-500', {item['record']['id'] for item in kept})
    def test_withhold_and_preserve_original(self):
        cases = [({'fetchedAt':(self.now-dt.timedelta(days=91)).isoformat()},'metadata-freshness-expired'),
                 ({'url':'https://other.example/a'},'article-host-mismatch'),
                 ({'url':'https://official.example:8443/a'},'article-host-mismatch'),
                 ({'imageUrl':'https://official.example/image'},'unsupported-content-rights'),
                 ({'sourceId':'removed'},'source-not-approved'),
                 ({'fetchedAt':(self.now+dt.timedelta(days=1)).isoformat()},'future-freshness-date'),
                 ({'sourceUrl':'https://other.example/rss'},'provenance-mismatch')]
        for patch, reason in cases:
            original=self.row(**patch)
            rows, rejected=apply_metadata_policy([original],self.sources,self.now)
            self.assertFalse(rows); self.assertEqual(rejected[0]['reason'],reason)
            self.assertEqual(rejected[0]['record'],original)
    def test_withhold_items_from_feed_pending_unified_verification(self):
        sources = [{**self.sources[0], 'feedAcceptance':'pending-unified-verification'}]
        original = self.row()
        rows, rejected = apply_metadata_policy([original], sources, self.now)
        self.assertFalse(rows)
        self.assertEqual(rejected[0]['reason'], 'source-feed-not-accepted')
        self.assertEqual(rejected[0]['record'], original)
    def test_feed_acceptance_requires_current_verification_date(self):
        cases = [({}, 'source-feed-verification-invalid'),
                 ({'feedVerifiedAt':'2026-W41-3'}, 'source-feed-verification-invalid'),
                 ({'feedVerifiedAt':'2026-10-08'}, 'source-feed-verification-future'),
                 ({'feedVerifiedAt':'2026-07-08'}, 'source-feed-verification-expired')]
        for patch, reason in cases:
            source = {key: value for key, value in self.sources[0].items()
                      if key not in ('feedVerifiedAt', 'feedReview')}
            source.update({'feedAcceptance':'accepted', **patch})
            rows, rejected = apply_metadata_policy([self.row()], [source], self.now)
            self.assertFalse(rows)
            self.assertEqual(rejected[0]['reason'], reason)
        source = {**self.sources[0], 'feedAcceptance':'accepted', 'feedVerifiedAt':'2026-07-09'}
        rows, rejected = apply_metadata_policy([self.row()], [source], self.now)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rejected, [])
    def test_feed_review_is_bound_to_the_current_source_configuration(self):
        source = {**self.sources[0], 'feedAcceptance':'accepted', 'feedVerifiedAt':'2026-10-07'}
        source['feedReview'] = feed_review_snapshot(source)
        for patch, reason in [({'url':'https://official.example/new-rss'}, 'source-feed-configuration-changed'),
                              ({'articleHosts':['news.official.example']}, 'source-feed-configuration-changed'),
                              ({'reuse':'full-content'}, 'source-not-approved'),
                              ({'region':'Different region'}, 'source-feed-configuration-changed')]:
            changed = {**source, **patch}
            rows, rejected = apply_metadata_policy([self.row()], [changed], self.now)
            self.assertFalse(rows)
            self.assertEqual(rejected[0]['reason'], reason)
    def test_accepted_feed_requires_https_license_evidence(self):
        for value, reason in [(None, 'source-license-evidence-required'),
                              ('http://official.example/terms', 'source-license-evidence-invalid'),
                              ('https://official.example:8443/terms', 'source-license-evidence-invalid')]:
            source = {**self.sources[0]}
            if value is None:
                source.pop('licenseEvidenceUrl')
            else:
                source['licenseEvidenceUrl'] = value
            source['feedReview'] = feed_review_snapshot(source)
            rows, rejected = apply_metadata_policy([self.row()], [source], self.now)
            self.assertFalse(rows)
            self.assertEqual(rejected[0]['reason'], reason)
    def test_invalid_source_and_date(self):
        for row in [None, self.row(sourceId=[]), self.row(fetchedAt='bad'), self.row(fetchedAt='2026-10-07T00:00:00'),
                    self.row(publishedAt='bad'), self.row(publishedAt='2026-10-07T00:00:00')]:
            rows,rejected=apply_metadata_policy([row],self.sources,self.now)
            self.assertFalse(rows); self.assertEqual(len(rejected),1)
    def test_expiry_boundary_and_unapproved_body(self):
        rows,_=apply_metadata_policy([self.row(fetchedAt=(self.now-dt.timedelta(days=90)).isoformat())],self.sources,self.now)
        self.assertEqual(len(rows),1)
        rows,rejected=apply_metadata_policy([self.row(publishedAt=(self.now-dt.timedelta(days=91)).isoformat())],self.sources,self.now)
        self.assertFalse(rows); self.assertEqual(rejected[0]['reason'],'publication-expired')
        rows,rejected=apply_metadata_policy([self.row(body='article text')],self.sources,self.now)
        self.assertFalse(rows); self.assertEqual(rejected[0]['reason'],'unsupported-content-rights')
    def test_successful_feed_snapshot_retires_missing_records_only_for_its_source(self):
        prior=[self.row(id='old-a'),self.row(id='old-b',sourceId='other')]
        current=[self.row(id='new-a')]
        visible,retired=replace_source_snapshot(prior,'s',current)
        self.assertEqual([row['id'] for row in visible],['old-b','new-a'])
        self.assertEqual([row['id'] for row in retired],['old-a'])
    def test_empty_successful_snapshot_retires_only_that_source(self):
        prior=[self.row(id='old-a'),self.row(id='old-b',sourceId='other')]
        visible,retired=replace_source_snapshot(prior,'s',[])
        self.assertEqual([row['id'] for row in visible],['old-b'])
        self.assertEqual([row['id'] for row in retired],['old-a'])
    def test_expired_publication_is_retired_before_page_preparation(self):
        expired=self.row(id='expired',publishedAt=(self.now-dt.timedelta(days=91)).isoformat())
        other=self.row(id='other-source',sourceId='other')
        visible,retired,rejected,expired_ids,expired_rows=review_and_replace_source_snapshot(
            [expired,other],'s',[expired],{'s':self.sources[0]},self.now)
        self.assertEqual([row['id'] for row in visible],['other-source'])
        self.assertEqual([row['id'] for row in retired],['expired'])
        self.assertEqual(expired_ids,{'expired'})
        self.assertEqual([row['id'] for row in expired_rows],['expired'])
        self.assertEqual(rejected,[])
    def test_fully_rejected_feed_keeps_prior_source_snapshot(self):
        prior=self.row(id='known-good')
        malformed=self.row(id='known-good',sourceUrl='https://wrong.example/rss')
        with self.assertRaisesRegex(SourceSnapshotReviewError,'prior source snapshot retained') as raised:
            review_and_replace_source_snapshot([prior],'s',[malformed],{'s':self.sources[0]},self.now)
        self.assertEqual(raised.exception.rejected[0]['reason'],'provenance-mismatch')
        self.assertEqual(raised.exception.expired_ids,frozenset())
        self.assertEqual(raised.exception.expired_rows,())
    def test_failed_review_retains_expiry_and_rejection_evidence(self):
        prior=self.row(id='known-good')
        malformed=self.row(id='known-good',sourceUrl='https://wrong.example/rss')
        expired=self.row(id='old-expired',publishedAt=(self.now-dt.timedelta(days=91)).isoformat())
        with self.assertRaises(SourceSnapshotReviewError) as raised:
            review_and_replace_source_snapshot([prior],'s',[malformed,expired],{'s':self.sources[0]},self.now)
        self.assertEqual(raised.exception.rejected[0]['reason'],'provenance-mismatch')
        self.assertEqual(raised.exception.expired_ids,frozenset({'old-expired'}))
        self.assertEqual(raised.exception.expired_rows[0]['id'],'old-expired')
    def test_withhold_missing_attribution_future_publication_and_invalid_center(self):
        for patch, reason in [({'region':' '},'missing-attribution'),
                              ({'publishedAt':(self.now+dt.timedelta(days=1)).isoformat()},'future-publication-date'),
                              ({'center':[181,0]},'invalid-center')]:
            rows,rejected=apply_metadata_policy([self.row(**patch)],self.sources,self.now)
            self.assertFalse(rows); self.assertEqual(rejected[0]['reason'],reason)
class OfficialSourceCaps(unittest.TestCase):
    def test_partial_refresh_synchronizes_registry_metadata_and_preserves_history(self):
        registered = [
            {'id': 'current', 'licenseEvidenceUrl': 'https://official.example/license',
             'feedReview': {'url': 'https://official.example/feed'}},
            {'id': 'new', 'licenseEvidenceUrl': 'https://new.example/license'},
        ]
        previous = [
            {'id': 'current', 'licenseEvidenceUrl': None, 'feedReview': {'url': 'old'},
             'lastSuccess': '2026-10-10T00:00:00Z', 'lastCollectedCount': 4,
             'lastError': 'temporary timeout', 'untrustedExtra': 'discard'},
            {'id': 'removed', 'lastSuccess': '2026-10-01T00:00:00Z'},
        ]
        result = synchronize_source_states(registered, previous)
        self.assertEqual([row['id'] for row in result], ['current', 'new'])
        self.assertEqual(result[0]['licenseEvidenceUrl'], registered[0]['licenseEvidenceUrl'])
        self.assertEqual(result[0]['feedReview'], registered[0]['feedReview'])
        self.assertEqual(result[0]['lastSuccess'], previous[0]['lastSuccess'])
        self.assertEqual(result[0]['lastCollectedCount'], 4)
        self.assertEqual(result[0]['lastError'], 'temporary timeout')
        self.assertNotIn('untrustedExtra', result[0])
        self.assertEqual(result[1], registered[1])

    def test_official_registry_review_snapshots_include_current_license_evidence(self):
        config_path=pathlib.Path(__file__).resolve().parents[2]/'shared/data/content/official-sources.json'
        config=json.loads(config_path.read_text(encoding='utf-8'))
        sources=config['sources']
        by_id={source['id']:source for source in sources}
        self.assertEqual(len(sources),6)
        for source in sources:
            with self.subTest(source=source['id']):
                self.assertEqual(source.get('feedReview'),feed_review_snapshot(source))
        for identity in ('nps-grand-canyon-news','nps-grand-canyon-backcountry','nps-yellowstone-news'):
            self.assertEqual(by_id[identity].get('licenseEvidenceUrl'),
                             'https://www.nps.gov/aboutus/disclaimer.htm')
        self.assertEqual(by_id['hk-government-outdoor-news'].get('licenseEvidenceUrl'),
                         'https://data.gov.hk/en/terms-and-conditions')

    def test_registry_structure_and_field_budgets(self):
        config_path=pathlib.Path(__file__).resolve().parents[2]/'shared/data/content/official-sources.json'
        config=json.loads(config_path.read_text(encoding='utf-8'))
        sources, default_cap=validate_official_source_registry(config)
        self.assertTrue(sources)
        self.assertEqual(default_cap, 100)
        for mutate, error in (
                (lambda value: value['sources'][0].update(id='x'*65), 'source ID'),
                (lambda value: value['sources'][0].update(label='x'*257), 'attribution'),
                (lambda value: value['sources'][0].update(articleHosts=['a.example']*33), 'source hosts'),
                (lambda value: value['sources'][0].update(url='https://other.example/rss'), 'source URL'),
                (lambda value: value['sources'][0].pop('licenseEvidenceUrl'), 'license evidence'),
                (lambda value: value['sources'][0].update(titleKeywords=['x'*121]), 'title filter')):
            changed=json.loads(json.dumps(config))
            mutate(changed)
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                validate_official_source_registry(changed)

    def test_each_configured_feed_is_capped_at_one_hundred_items(self):
        config_path=pathlib.Path(__file__).resolve().parents[2]/'shared/data/content/official-sources.json'
        config=json.loads(config_path.read_text(encoding='utf-8'))
        self.assertTrue(config['sources'])
        per_feed_cap=config.get('maxItemsPerFeed',100)
        self.assertGreaterEqual(per_feed_cap,1)
        self.assertLessEqual(per_feed_cap,100)
        for source in config['sources']:
            with self.subTest(source=source['id']):
                self.assertLessEqual(source.get('maxItems',per_feed_cap),per_feed_cap)
if __name__ == '__main__': unittest.main()
