import importlib.util
from pathlib import Path
import struct
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'update-swisstopo-wanderwege.py'
spec = importlib.util.spec_from_file_location('update_swisstopo_wanderwege', SCRIPT)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def gpkg_line(points):
    header = b'GP' + bytes((0, 0)) + struct.pack('<i', 2056)
    wkb = bytes((1,)) + struct.pack('<II', 2, len(points))
    wkb += b''.join(struct.pack('<dd', x, y) for x, y in points)
    return header + wkb


class FakeTransformer:
    def __init__(self, coordinates):
        self.coordinates = iter(coordinates)

    def transform(self, _x, _y, errcheck=False):
        if not errcheck:
            raise AssertionError('transform must request checked projection')
        return next(self.coordinates)


class SwisstopoGeometryTests(unittest.TestCase):
    def test_named_segment_converts_and_simplifies_valid_wgs84_line(self):
        line = gpkg_line([(2_600_000, 1_200_000), (2_600_100, 1_200_100)])
        transformer = FakeTransformer([(8.0, 46.0), (8.1, 46.1)])
        self.assertEqual([[8.0, 46.0], [8.1, 46.1]], updater.decode_wgs84_line(line, transformer))

    def test_invalid_geopackage_line_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'invalid GeoPackage geometry header'):
            updater.decode_wgs84_line(b'bad', FakeTransformer([]))

    def test_named_segment_outside_coverage_is_rejected(self):
        line = gpkg_line([(2_600_000, 1_200_000), (2_600_100, 1_200_100)])
        transformer = FakeTransformer([(11.0, 49.0), (11.1, 49.1)])
        with self.assertRaisesRegex(ValueError, 'outside SwissTLM3D coverage'):
            updater.decode_wgs84_line(line, transformer)


if __name__ == '__main__':
    unittest.main()
