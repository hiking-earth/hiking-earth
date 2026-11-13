import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from official_feed_xml import item_publication_date, parse_rss


class OfficialFeedXml(unittest.TestCase):
    def test_accepts_basic_rss(self):
        root = parse_rss(b'<rss version="2.0"><channel><item><title>Trail notice</title></item></channel></rss>')
        self.assertEqual(root.findtext('./channel/item/title'), 'Trail notice')

    def test_rejects_doctype_independent_of_xml_encoding(self):
        for encoding in ('utf-8', 'utf-16'):
            document = f'<?xml version="1.0" encoding="{encoding}"?><!DOCTYPE rss [<!ENTITY x "expanded">]><rss><channel><item><title>&x;</title></item></channel></rss>'
            payload = document.encode(encoding)
            with self.subTest(encoding=payload[:4]):
                with self.assertRaisesRegex(ValueError, 'doctype'):
                    parse_rss(payload)

    def test_reads_rss_and_dublin_core_publication_dates(self):
        root = parse_rss(b'''<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><channel>
          <item><pubDate>Mon, 19 Oct 2026 12:00:00 +0000</pubDate></item>
          <item><dc:date>2026-10-19T12:00:00+00:00</dc:date></item>
          <item><dcterms:issued>2026-10-19T12:00:00Z</dcterms:issued></item>
        </channel></rss>''')
        items = root.findall('./channel/item')
        self.assertEqual(item_publication_date(items[0]), '2026-10-19T12:00:00+00:00')
        self.assertEqual(item_publication_date(items[1]), '2026-10-19T12:00:00+00:00')
        self.assertEqual(item_publication_date(items[2]), '2026-10-19T12:00:00+00:00')

    def test_reads_atom_dates_and_never_guesses_missing_or_invalid_dates(self):
        root = parse_rss(b'''<rss xmlns:atom="http://www.w3.org/2005/Atom"><channel>
          <item><atom:published>2026-10-19T12:00:00Z</atom:published></item>
          <item><atom:updated>2026-10-19T12:00:00+00:00</atom:updated></item>
          <item><pubDate>not-a-date</pubDate></item><item />
        </channel></rss>''')
        items = root.findall('./channel/item')
        self.assertEqual(item_publication_date(items[0]), '2026-10-19T12:00:00+00:00')
        self.assertEqual(item_publication_date(items[1]), '2026-10-19T12:00:00+00:00')
        self.assertEqual(item_publication_date(items[2]), 'not-a-date')
        self.assertIsNone(item_publication_date(items[3]))

    def test_uses_a_valid_alternate_source_date_when_pubdate_is_invalid(self):
        root = parse_rss(b'''<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
          <item><pubDate>unknown</pubDate><dc:date>2026-10-19T12:00:00Z</dc:date></item>
        </channel></rss>''')
        self.assertEqual(
            item_publication_date(root.find('./channel/item')),
            '2026-10-19T12:00:00+00:00',
        )


if __name__ == '__main__':
    unittest.main()
