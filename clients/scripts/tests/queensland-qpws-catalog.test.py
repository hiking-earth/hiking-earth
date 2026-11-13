import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'update-queensland-qpws-trails.py'
spec = importlib.util.spec_from_file_location('update_queensland_qpws_trails', SCRIPT)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def feature(identity, name, geometry):
    return {
        'attributes': {'objectid': identity, 'subcat': 'Tracks and Trails', 'name': name},
        'geometry': geometry,
    }


class QueenslandCatalogSafetyTests(unittest.TestCase):
    def collect_with(self, ids, features):
        responses = iter(({'objectIds': ids}, {'features': features}))
        original = updater.query
        updater.query = lambda _params: next(responses)
        try:
            return updater.collect()
        finally:
            updater.query = original

    def test_unnamed_features_are_withheld_instead_of_given_fabricated_names(self):
        data = self.collect_with([1, 2], [
            feature(1, 'Named track', {'paths': [[[150, -24], [150.1, -24.1]]]}),
            feature(2, '   ', None),
        ])
        self.assertEqual(1, len(data['routes']))
        self.assertEqual('Named track', data['routes'][0]['name'])
        self.assertEqual(1, data['withheldRecords'])
        self.assertEqual({'unnamed-source-feature': 1}, data['withheldReasons'])

    def test_named_feature_without_geometry_aborts_collection(self):
        with self.assertRaisesRegex(ValueError, 'named trail 1 has missing or invalid line geometry'):
            self.collect_with([1], [feature(1, 'Named track', None)])

    def test_named_feature_with_invalid_geometry_aborts_collection(self):
        with self.assertRaisesRegex(ValueError, 'named trail 1 has invalid line geometry'):
            self.collect_with([1], [feature(1, 'Named track', {'paths': [[[150, -24], [181, -24]]]} )])


if __name__ == '__main__':
    unittest.main()
