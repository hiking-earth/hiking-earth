from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalog_collection_status import news_source_status


class CollectionStatusTests(unittest.TestCase):
    now = datetime(2026, 10, 7, tzinfo=timezone.utc)

    def test_current_feed_verification_and_collection_health_are_separate(self):
        result = news_source_status(
            {'id': 'feed', 'feedAcceptance': 'accepted', 'feedVerifiedAt': '2026-10-07'},
            {'lastError': 'upstream unavailable', 'lastSuccess': '2026-10-06T00:00:00Z'},
            12, self.now,
        )
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['feedVerificationStatus'], 'current')
        self.assertTrue(result['feedVerified'])
        self.assertEqual(result['records'], 12)

    def test_expired_and_invalid_verification_dates_are_reported(self):
        for verified_at, expected in [('2026-07-08', 'verification-expired'),
                                      ('2026-W41-3', 'invalid-verification-date'),
                                      ('2026-10-08', 'future-verification-date'),
                                      (None, 'invalid-verification-date')]:
            result = news_source_status(
                {'id': 'feed', 'feedAcceptance': 'accepted', 'feedVerifiedAt': verified_at},
                {}, 0, self.now,
            )
            self.assertEqual(result['feedVerificationStatus'], expected)
            self.assertFalse(result['feedVerified'])

    def test_legacy_and_pending_sources_are_not_misreported_as_verified(self):
        legacy = news_source_status({'id': 'legacy'}, {'lastSuccess': '2026-10-07T00:00:00Z'}, 4, self.now)
        pending = news_source_status({'id': 'pending', 'feedAcceptance': 'pending-unified-verification'}, {}, 0, self.now)
        self.assertIsNone(legacy['feedVerified'])
        self.assertEqual(legacy['feedVerificationStatus'], 'legacy-no-explicit-acceptance')
        self.assertFalse(pending['feedVerified'])
        self.assertEqual(pending['feedVerificationStatus'], 'not-accepted')


if __name__ == '__main__':
    unittest.main()
