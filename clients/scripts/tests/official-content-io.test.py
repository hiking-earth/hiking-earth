from pathlib import Path
import sys
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from official_content_io import encode_json_bounded, read_json_bounded


class OfficialContentIOTests(unittest.TestCase):
    def test_bounded_json_reader_accepts_input_at_or_below_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'snapshot.json'
            path.write_bytes(b'{"items":[]}')
            self.assertEqual(read_json_bounded(path, 12, 'snapshot'), {'items': []})

    def test_bounded_json_reader_rejects_over_limit_without_reading_unbounded(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'snapshot.json'
            path.write_bytes(b'{"items":[]}more bytes')
            with self.assertRaisesRegex(ValueError, 'exceeds the 12-byte budget'):
                read_json_bounded(path, 12, 'snapshot')

    def test_bounded_json_reader_rejects_invalid_utf8(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'snapshot.json'
            path.write_bytes(b'{"name":"\xff"}')
            with self.assertRaisesRegex(ValueError, 'not valid UTF-8'):
                read_json_bounded(path, 128, 'snapshot')

    def test_bounded_encoder_rejects_output_over_limit(self):
        with self.assertRaisesRegex(ValueError, 'exceeds the 4-byte budget'):
            encode_json_bounded({'items': []}, 4, 'snapshot')


if __name__ == '__main__':
    unittest.main()
