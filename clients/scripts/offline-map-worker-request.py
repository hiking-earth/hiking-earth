"""Send authenticated offline-map worker requests only to a configured HTTPS endpoint."""
import json
import re
import urllib.request
from urllib.parse import urlsplit


MAX_RESPONSE_BYTES = 1024 * 1024
MAX_REQUEST_BYTES = 2 * 1024 * 1024


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_endpoint(endpoint):
    if (not isinstance(endpoint, str) or not endpoint or len(endpoint) > 2048
            or any(ord(char) <= 0x20 or ord(char) == 0x7f for char in endpoint)
            or '\\' in endpoint or '#' in endpoint):
        raise ValueError('offline-map worker endpoint is invalid')
    try:
        parsed = urlsplit(endpoint)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError as error:
        raise ValueError('offline-map worker endpoint is invalid') from error
    if (parsed.scheme != 'https' or not hostname or parsed.username is not None
            or parsed.password is not None or parsed.fragment):
        raise ValueError('offline-map worker requires a credential-free HTTPS endpoint')
    return endpoint


def post_offline_map_worker(action, data, *, endpoint, token, timeout=30):
    endpoint = validate_endpoint(endpoint)
    if (action not in {'offline-map.worker.next', 'offline-map.worker.complete'}
            or not isinstance(data, dict) or 'workerToken' in data
            or not isinstance(token, str) or re.fullmatch(r'[a-f0-9]{64}', token) is None):
        raise ValueError('offline-map worker request is invalid')
    body = json.dumps({'action': action, 'data': {'workerToken': token, **data}},
                      ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError('offline-map worker request exceeds the size limit')
    request = urllib.request.Request(endpoint, data=body,
        headers={'Content-Type': 'application/json'}, method='POST')
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(request, timeout=timeout) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except Exception as error:
        raise RuntimeError(f'{action} failed: {type(error).__name__}') from None
    if len(payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError(f'{action} response exceeds the size limit')
    try:
        result = json.loads(payload.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError(f'{action} returned invalid JSON') from None
    if not isinstance(result, dict) or result.get('ok') is not True or not isinstance(result.get('data'), dict):
        raise RuntimeError(f'{action} was not accepted')
    return result
