import json
import sys
import unittest
from pathlib import Path
from datetime import datetime
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalog_publication_validation import validate_news_catalog

class CachedReviewTests(unittest.TestCase):
    def catalog(self):
        return json.loads((Path(__file__).resolve().parents[2] / 'shared/data/content/official-news.json').read_text())

    def test_zero_fetch_review_is_accepted(self):
        data = self.catalog()
        self.assertEqual(validate_news_catalog(data, now=datetime.fromisoformat(data['generatedAt'])), len(data['items']))

    def test_review_cannot_claim_network_attempts(self):
        data = self.catalog()
        data['collectionStatus']['attemptedSourceCount'] = 1
        with self.assertRaisesRegex(ValueError, 'source outcomes'):
            validate_news_catalog(data, now=datetime.fromisoformat(data['generatedAt']))

if __name__ == '__main__':
    unittest.main()
