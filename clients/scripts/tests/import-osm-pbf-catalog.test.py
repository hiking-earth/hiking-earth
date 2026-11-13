import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'import-osm-pbf-catalog.py'
spec = importlib.util.spec_from_file_location('import_osm_pbf_catalog', SCRIPT)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class PbfRegionClassificationTests(unittest.TestCase):
    def test_mainland_china_coordinates_keep_china_region(self):
        self.assertEqual(importer.classify_region('china', 116.4, 39.9), 'china')

    def test_hong_kong_and_macao_match_incremental_collector_bounds(self):
        self.assertEqual(importer.classify_region('china', 114.1, 22.3), 'hong-kong')
        self.assertEqual(importer.classify_region('china', 113.55, 22.18), 'macao')

    def test_other_regions_are_not_reclassified(self):
        self.assertEqual(importer.classify_region('japan', 139.7, 35.6), 'japan')
        self.assertEqual(importer.classify_region('asia', 100.5, 13.7), 'asia')


if __name__ == '__main__':
    unittest.main()
