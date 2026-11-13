"""Constrain redirects made while retrieving approved official feeds."""
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler


def is_allowed_feed_redirect(source_url, target_url):
    """Allow only HTTPS redirects to the exact configured feed hostname."""
    source = urlparse(source_url)
    target = urlparse(target_url)
    return (
        source.scheme == 'https'
        and bool(source.hostname)
        and not source.username
        and not source.password
        and source.port is None
        and target.scheme == 'https'
        and target.hostname is not None
        and target.hostname.lower().rstrip('.') == source.hostname.lower().rstrip('.')
        and not target.username
        and not target.password
        and target.port is None
    )


class SameOriginHTTPSRedirectHandler(HTTPRedirectHandler):
    """Reject unsafe redirect targets before urllib sends another request."""

    def __init__(self, source_url):
        super().__init__()
        self.source_url = source_url

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_allowed_feed_redirect(self.source_url, newurl):
            raise ValueError('unexpected redirect domain')
        return super().redirect_request(req, fp, code, msg, headers, newurl)
