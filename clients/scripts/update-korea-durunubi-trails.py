#!/usr/bin/env python3
"""Collect Korean Tourism Organization DuruNubi GPX discovery references.

The source is free and permits reuse without restrictions, but requires a
DATA.GO.KR service key. Every imported row stays pending verification; GPX
tracks are reduced reference geometry and never establish live access or safe
navigation.
"""
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
from pathlib import Path
import re
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'shared/data/catalog/korea-durunubi-trails.json'
DATASET_URL = 'https://www.data.go.kr/data/15101974/openapi.do'
COURSE_ENDPOINT = 'https://apis.data.go.kr/B551011/Durunubi/courseList'
LICENSE = 'DATA.GO.KR 이용허락범위 제한 없음'
ATTRIBUTION = 'Source: Korea Tourism Organization, DuruNubi Korea Dulle Trail API. Reuse scope: no restrictions, per DATA.GO.KR dataset 15101974.'
LICENSE_URL = DATASET_URL
API_HOST = 'apis.data.go.kr'
GPX_HOST = 'www.durunubi.kr'
PAGE_SIZE = 100
MAX_COURSES = 500
MAX_GPX_BYTES = 5 * 1024 * 1024
MAX_GPX_POINTS = 100_000
MAX_TRACKS = 150
MAX_OUTPUT_POINTS = 15_000
COURSE_ID = re.compile(r'^T_CRS_MNG[0-9]{1,20}$')
ROUTE_ID = re.compile(r'^T_THEME_MNG[0-9]{1,20}$')


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never forward the API service key or source requests to redirects."""
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


_SAFE_OPENER = urllib.request.build_opener(NoRedirectHandler)


def _open_no_redirect(request, timeout=30):
    return _SAFE_OPENER.open(request, timeout=timeout)


def bounded_read(response, limit, allowed_hosts):
    final = urllib.parse.urlparse(response.geturl())
    if (final.scheme != 'https' or final.hostname not in allowed_hosts
            or final.port or final.username or final.password):
        raise ValueError('DuruNubi source redirected outside the approved HTTPS host')
    body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError('DuruNubi source response exceeds its byte budget')
    return body


def _items(value):
    if value is None:
        return []
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list) and all(isinstance(row, dict) for row in value):
        return value
    raise ValueError('DuruNubi API items have an unsupported shape')


def parse_api_page(payload):
    try:
        document = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError('DuruNubi API response is not valid JSON') from error
    response = document.get('response') if isinstance(document, dict) else None
    header = response.get('header') if isinstance(response, dict) else None
    body = response.get('body') if isinstance(response, dict) else None
    if not isinstance(header, dict) or str(header.get('resultCode')) not in ('00', '0000'):
        raise ValueError('DuruNubi API returned an unsuccessful status')
    if not isinstance(body, dict):
        raise ValueError('DuruNubi API response body is missing')
    total = body.get('totalCount')
    if isinstance(total, bool) or not isinstance(total, int) or not 0 <= total <= MAX_COURSES:
        raise ValueError('DuruNubi route count exceeds the approved budget')
    items = body.get('items')
    rows = _items(items.get('item') if isinstance(items, dict) else None)
    if len(rows) > PAGE_SIZE or len(rows) > total:
        raise ValueError('DuruNubi API page exceeds its row budget')
    return total, rows


def _safe_gpx_url(value):
    if not isinstance(value, str) or len(value) > 1200:
        raise ValueError('DuruNubi GPX URL is missing or too large')
    parsed = urllib.parse.urlparse(value)
    query = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
    file_paths = query.get('filePath', [])
    if (parsed.scheme != 'https' or parsed.hostname != GPX_HOST or parsed.port
            or parsed.username or parsed.password or parsed.path != '/editImgUp.do'
            or len(file_paths) != 1 or not file_paths[0].startswith('/data/koreamobility/')
            or not file_paths[0].lower().endswith('.gpx')
            or '..' in Path(file_paths[0]).parts):
        raise ValueError('DuruNubi GPX URL is outside the approved official download pattern')
    # Normalize percent-encoded paths so every client validator receives the
    # same allowlisted form; discard unrelated query parameters.
    safe_path = urllib.parse.quote(file_paths[0], safe='/-._~')
    return urllib.parse.urlunparse(('https', GPX_HOST, parsed.path, '',
                                    f'filePath={safe_path}', ''))


def parse_gpx(payload):
    if not isinstance(payload, bytes) or not payload or len(payload) > MAX_GPX_BYTES:
        raise ValueError('DuruNubi GPX is empty or exceeds its byte budget')
    if re.search(br'<!\s*(?:DOCTYPE|ENTITY)', payload, re.I):
        raise ValueError('DuruNubi GPX must not contain document type or entity declarations')
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise ValueError('DuruNubi GPX is malformed XML') from error
    if root.tag not in ('gpx', '{http://www.topografix.com/GPX/1/0}gpx',
                        '{http://www.topografix.com/GPX/1/1}gpx') or root.attrib.get('version') not in ('1.0', '1.1'):
        raise ValueError('DuruNubi geometry is not a recognized GPX document')
    tracks, source_points = [], 0
    for track in root:
        if not track.tag.endswith('}trk'):
            continue
        for segment in track:
            if not segment.tag.endswith('}trkseg'):
                continue
            points = []
            for point in segment:
                if not point.tag.endswith('}trkpt'):
                    continue
                try:
                    lat, lon = float(point.attrib['lat']), float(point.attrib['lon'])
                except (KeyError, TypeError, ValueError) as error:
                    raise ValueError('DuruNubi GPX has an invalid coordinate') from error
                if (not math.isfinite(lat) or not math.isfinite(lon)
                        or not 33.0 <= lat <= 39.7 or not 124.0 <= lon <= 132.0):
                    raise ValueError('DuruNubi GPX coordinate is outside South Korea bounds')
                points.append((lon, lat))
                source_points += 1
                if source_points > MAX_GPX_POINTS:
                    raise ValueError('DuruNubi GPX exceeds its point-count budget')
            if points:
                if len(points) < 2:
                    raise ValueError('DuruNubi GPX has a one-point track segment')
                tracks.append(points)
                if len(tracks) > MAX_TRACKS:
                    raise ValueError('DuruNubi GPX exceeds its track-segment budget')
    if not tracks:
        raise ValueError('DuruNubi GPX contains no track geometry')
    per_path_limit = max(2, min(151, MAX_OUTPUT_POINTS // len(tracks)))
    reference_paths = []
    for points in tracks:
        stride = max(1, math.ceil(len(points) / (per_path_limit - 1)))
        reduced = points[::stride]
        if reduced[-1] != points[-1]:
            reduced.append(points[-1])
        reference_paths.append([[round(lon, 6), round(lat, 6)] for lon, lat in reduced])
    return tracks, reference_paths, source_points


def _text(value, limit=300):
    if value is None:
        return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise ValueError('DuruNubi route metadata has an unsupported scalar')
    text = ' '.join(str(value).replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def normalize_course(row, fetched_at, gpx_payload):
    if not isinstance(row, dict):
        raise ValueError('DuruNubi course row is not an object')
    course_id = _text(row.get('crsIdx'), 80)
    route_id = _text(row.get('routeIdx'), 80)
    if not course_id or not COURSE_ID.fullmatch(course_id) or not route_id or not ROUTE_ID.fullmatch(route_id):
        raise ValueError('DuruNubi course or route identifier is malformed')
    name, region = _text(row.get('crsKorNm'), 200), _text(row.get('sigun'), 100)
    if not name or not region:
        raise ValueError('DuruNubi course is missing its name or administrative region')
    gpx_url = _safe_gpx_url(row.get('gpxpath'))
    tracks, paths, point_count = parse_gpx(gpx_payload)
    points = [point for track in tracks for point in track]
    distance = row.get('crsDstnc')
    try:
        distance = float(distance)
    except (TypeError, ValueError):
        raise ValueError('DuruNubi course distance is missing or invalid')
    if distance is not None and (not math.isfinite(distance) or not 0 < distance <= 1000):
        raise ValueError('DuruNubi course distance is outside the accepted range')
    duration = row.get('crsTotlRqrmHour')
    try:
        duration = int(duration)
    except (TypeError, ValueError):
        raise ValueError('DuruNubi course duration is missing or invalid')
    if duration is not None and not 0 < duration <= 100_000:
        raise ValueError('DuruNubi course duration is outside the accepted range')
    return {
        'id': f'korea-durunubi-{course_id.removeprefix("T_CRS_MNG")}',
        'name': name,
        'region': f'韩国·{region}',
        'center': [round(sum(point[0] for point in points) / len(points), 6),
                   round(sum(point[1] for point in points) / len(points), 6)],
        'status': '待核验', 'sourceUrl': COURSE_ENDPOINT, 'fetchedAt': fetched_at,
        'sourceTags': {
            'courseCode': course_id, 'routeCode': route_id, 'distanceKm': distance,
            'durationMinutes': duration, 'difficulty': _text(row.get('crsLevel'), 80),
            'cycle': _text(row.get('crsCycle'), 80), 'sourceModifiedAt': _text(row.get('modifiedtime'), 32),
            'gpxReferenceUrl': gpx_url, 'sourcePointCount': point_count,
        },
        'referencePaths': paths,
    }


def _request_json(params, service_key, opener):
    query = urllib.parse.urlencode({**params, 'serviceKey': service_key, '_type': 'json'})
    url = f'{COURSE_ENDPOINT}?{query}'
    request = urllib.request.Request(url, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with opener(request, timeout=30) as response:
        return bounded_read(response, 2 * 1024 * 1024, {API_HOST})


def collect(service_key, opener=None, now=None):
    if not isinstance(service_key, str) or len(service_key.strip()) < 8 or len(service_key) > 2048:
        raise ValueError('DURUNUBI_SERVICE_KEY is missing or malformed')
    opener = opener or _open_no_redirect
    fetched_at = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).isoformat()
    first = _request_json({'numOfRows': PAGE_SIZE, 'pageNo': 1, 'MobileOS': 'ETC', 'MobileApp': 'HikingEarth'}, service_key, opener)
    total, first_rows = parse_api_page(first)
    rows = list(first_rows)
    pages = math.ceil(total / PAGE_SIZE)
    if pages > 5:
        raise ValueError('DuruNubi pagination exceeds its page budget')
    for page in range(2, pages + 1):
        payload = _request_json({'numOfRows': PAGE_SIZE, 'pageNo': page, 'MobileOS': 'ETC', 'MobileApp': 'HikingEarth'}, service_key, opener)
        page_total, page_rows = parse_api_page(payload)
        if page_total != total:
            raise ValueError('DuruNubi total count changed during pagination')
        rows.extend(page_rows)
    if len(rows) != total:
        raise ValueError('DuruNubi pages do not reconcile to the advertised total')
    seen, normalized, withheld = set(), [], {}
    fetchable = []
    for row in rows:
        course_id = _text(row.get('crsIdx'), 80) if isinstance(row, dict) else None
        if not course_id or course_id in seen:
            raise ValueError('DuruNubi API contains duplicate or missing course IDs')
        seen.add(course_id)
        fetchable.append((course_id, row))

    def fetch_one(item):
        course_id, row = item
        try:
            gpx_url = _safe_gpx_url(row.get('gpxpath'))
            request = urllib.request.Request(gpx_url, headers={
                'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
                'Accept': 'application/gpx+xml,application/xml,*/*;q=0.5',
            })
            with opener(request, timeout=30) as response:
                gpx = bounded_read(response, MAX_GPX_BYTES, {GPX_HOST})
            return course_id, normalize_course(row, fetched_at, gpx), None
        except (ValueError, OSError, TimeoutError) as error:
            return course_id, None, 'invalid-or-unavailable-course-reference'

    # Keep concurrency modest to respect the free public API while finishing
    # the known ~284-course GPX set within the workflow's bounded step window.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for _, route, reason in pool.map(fetch_one, fetchable):
            if route is not None:
                normalized.append(route)
            elif reason:
                withheld[reason] = withheld.get(reason, 0) + 1
    routes = normalized
    if total != len(routes) + sum(withheld.values()):
        raise ValueError('DuruNubi source, catalog, and withheld counts do not reconcile')
    return {
        'schemaVersion': 1, 'generatedAt': fetched_at, 'sourceUrl': COURSE_ENDPOINT,
        'datasetUrl': DATASET_URL, 'sourcePublishedAt': fetched_at,
        'sourceFeatureCount': total, 'catalogRouteCount': len(routes),
        'withheldRecords': sum(withheld.values()), 'withheldReasons': withheld,
        'license': LICENSE, 'attribution': ATTRIBUTION, 'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'All DuruNubi rows remain 待核验. GPX tracks are simplified discovery references only; they do not establish current opening, legal access, or safe navigation.',
        'routes': routes,
    }


def write_catalog(data):
    from catalog_publication_validation import validate_route_catalog
    validate_route_catalog('korea-durunubi-trails', data)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    with tempfile.NamedTemporaryFile(dir=TARGET.parent, delete=False) as handle:
        handle.write(encoded)
        temporary = Path(handle.name)
    os.replace(temporary, TARGET)
    return len(encoded)


def main():
    key = os.environ.get('DURUNUBI_SERVICE_KEY', '')
    if not key:
        raise SystemExit('DURUNUBI_SERVICE_KEY is required; no network request was made')
    data = collect(key)
    size = write_catalog(data)
    print(f'Korea DuruNubi trail references: {data["catalogRouteCount"]}/{data["sourceFeatureCount"]}; '
          f'withheld={data["withheldRecords"]}; {size} bytes', flush=True)


if __name__ == '__main__':
    main()
