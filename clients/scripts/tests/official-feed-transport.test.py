import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / 'official_feed_transport.py'
spec = importlib.util.spec_from_file_location('official_feed_transport', MODULE_PATH)
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class OfficialFeedRedirectTests(unittest.TestCase):
    def test_allows_https_redirects_to_same_host(self):
        self.assertTrue(transport.is_allowed_feed_redirect(
            'https://feeds.example.gov/notices.xml',
            'https://feeds.example.gov/notices-v2.xml',
        ))
        self.assertTrue(transport.is_allowed_feed_redirect(
            'https://feeds.example.gov/notices.xml',
            'https://FEEDS.EXAMPLE.GOV/notices.xml',
        ))

    def test_rejects_cross_host_or_unsafe_redirects(self):
        for target in (
            'https://attacker.example/notices.xml',
            'http://feeds.example.gov/notices.xml',
            'https://user@feeds.example.gov/notices.xml',
            'https://feeds.example.gov:8443/notices.xml',
            '//attacker.example/notices.xml',
        ):
            with self.subTest(target=target):
                self.assertFalse(transport.is_allowed_feed_redirect(
                    'https://feeds.example.gov/notices.xml', target,
                ))

    def test_redirect_handler_rejects_target_before_following_it(self):
        handler = transport.SameOriginHTTPSRedirectHandler(
            'https://feeds.example.gov/notices.xml',
        )
        with self.assertRaisesRegex(ValueError, 'unexpected redirect domain'):
            handler.redirect_request(
                None, None, 302, 'Found', {},
                'https://attacker.example/notices.xml',
            )


if __name__ == '__main__':
    unittest.main()
