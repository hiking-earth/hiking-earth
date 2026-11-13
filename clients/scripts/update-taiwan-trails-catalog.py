#!/usr/bin/env python3
"""Fetch Taiwan's free official hiking-trail discovery dataset.

Rows remain 待核验. Government service/access codes are retained as source
metadata only; they do not establish live access or turn lines into navigation.
"""
import datetime as dt
import io
import json
import math
import os
from pathlib import Path
import re
import tempfile
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATASET_URL = 'https://data.gov.tw/dataset/41653'
SOURCE_URL = 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Trail-json.zip'
LICENSE_URL = 'https://data.gov.tw/license'
LICENSE = 'Open Government Data License, version 1.0'
ATTRIBUTION = ('Source: Taiwan Tourism Administration, Ministry of Transportation and Communications, '
               'Trail dataset (Tourism Data Standard v2.1). Released under the Open Government Data License, version 1.0.')
TARGET = ROOT / 'shared/data/catalog/taiwan-trails.json'
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024
MAX_MEMBER_BYTES = 12 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED = 20 * 1024 * 1024
MAX_COMPRESSION_RATIO = 150
MAX_ROUTES = 500
MAX_PATHS_PER_ROUTE = 150
MAX_POINTS_PER_PATH = 151
MAX_POINTS_PER_ROUTE = 15000
_NUMBER = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$')
_WKT = re.compile(r'^\s*(MULTI)?LINESTRING(?:\s+Z)?\s*\((.*)\)\s*$', re.I | re.S)


def clean(value, limit=300):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError('Taiwan trail source has an unsupported scalar')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Taiwan trail source has a non-finite scalar')
    text = ' '.join(str(value).replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def _split_multi(body):
    """Split MULTILINESTRING members while rejecting unbalanced delimiters."""
    parts, depth, start = [], 0, None
    for index, char in enumerate(body):
        if char == '(':
            if depth == 0:
                start = index + 1
            depth += 1
        elif char == ')':
            depth -= 1
            if depth < 0:
                raise ValueError('Taiwan trail WKT has unbalanced parentheses')
            if depth == 0:
                parts.append(body[start:index])
                start = None
        elif depth == 0 and char not in ' ,\t\r\n':
            raise ValueError('Taiwan trail WKT has unexpected content between paths')
    if depth != 0 or not parts:
        raise ValueError('Taiwan trail WKT has unbalanced or empty paths')
    return parts


def simplify_wkt(geometry):
    if not isinstance(geometry, str) or len(geometry) > 1_000_000:
        raise ValueError('Taiwan trail geometry is missing or too large')
    match = _WKT.fullmatch(geometry)
    if not match:
        raise ValueError('Taiwan trail geometry must be a WGS84 LineString')
    is_multi = bool(match.group(1))
    bodies = _split_multi(match.group(2)) if is_multi else [match.group(2)]
    if len(bodies) > MAX_PATHS_PER_ROUTE:
        raise ValueError('Taiwan trail has too many line parts')
    paths = []
    for body in bodies:
        points = []
        for item in body.split(','):
            values = item.strip().split()
            if len(values) not in (2, 3) or any(not _NUMBER.fullmatch(value) for value in values):
                raise ValueError('Taiwan trail WKT has an invalid coordinate')
            lon, lat = float(values[0]), float(values[1])
            if (not math.isfinite(lon) or not math.isfinite(lat)
                    or not 117 <= lon <= 123 or not 20 <= lat <= 27):
                raise ValueError('Taiwan trail coordinate is outside the expected Taiwan bounds')
            points.append([round(lon, 6), round(lat, 6)])
        if len(points) < 2:
            raise ValueError('Taiwan trail line has fewer than two vertices')
        stride = max(1, math.ceil(len(points) / MAX_POINTS_PER_PATH))
        reduced = points[::stride]
        if reduced[-1] != points[-1]:
            reduced.append(points[-1])
        paths.append(reduced)
    if sum(map(len, paths)) > MAX_POINTS_PER_ROUTE:
        raise ValueError('Taiwan trail geometry exceeds the per-route point budget')
    return paths


def read_source_archive(payload):
    if not isinstance(payload, bytes) or not payload or len(payload) > MAX_ARCHIVE_BYTES:
        raise ValueError('Taiwan trail ZIP is empty or exceeds the 4 MB download budget')
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
        infos = archive.infolist()
        if len(infos) > 32 or len({item.filename for item in infos}) != len(infos):
            raise ValueError('Taiwan trail ZIP has too many or duplicate entries')
        total = 0
        for item in infos:
            path = Path(item.filename)
            if (path.is_absolute() or '..' in path.parts or item.flag_bits & 1
                    or item.file_size > MAX_MEMBER_BYTES):
                raise ValueError('Taiwan trail ZIP contains an unsafe or oversized member')
            total += item.file_size
            if total > MAX_TOTAL_UNCOMPRESSED:
                raise ValueError('Taiwan trail ZIP exceeds the uncompressed data budget')
            if item.file_size and item.file_size / max(1, item.compress_size) > MAX_COMPRESSION_RATIO:
                raise ValueError('Taiwan trail ZIP member exceeds the compression-ratio budget')
        info = next((item for item in infos if item.filename == 'TrailList.json'), None)
        if not info:
            raise ValueError('Taiwan trail ZIP does not contain TrailList.json')
        return json.loads(archive.read(info).decode('utf-8-sig'))
    except (zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError('Taiwan trail ZIP or JSON is corrupt') from error


def collect(payload, now=None):
    document = read_source_archive(payload)
    trails = document.get('Trails') if isinstance(document, dict) else None
    source_updated = document.get('UpdateTime') if isinstance(document, dict) else None
    if (not isinstance(trails, list) or not 0 < len(trails) <= MAX_ROUTES
            or not isinstance(source_updated, str) or not source_updated.strip()):
        raise ValueError('Taiwan trail source is missing update metadata or exceeds the route budget')
    try:
        updated_at = dt.datetime.fromisoformat(source_updated.replace('Z', '+00:00'))
    except ValueError as error:
        raise ValueError('Taiwan trail source update time is invalid') from error
    if updated_at.tzinfo is None or updated_at.utcoffset() is None:
        raise ValueError('Taiwan trail source update time must include a timezone')
    fetched_at = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).isoformat()
    routes, withheld = [], {}
    seen = set()
    for row in trails:
        if not isinstance(row, dict):
            raise ValueError('Taiwan trail source row is not an object')
        identity = clean(row.get('TrailID'), 120)
        if not identity or not re.fullmatch(r'Trail_[A-Za-z0-9_-]{1,100}', identity) or identity in seen:
            raise ValueError('Taiwan trail IDs are missing, duplicated, or malformed')
        seen.add(identity)
        name = clean(row.get('TrailName'), 200)
        try:
            paths = simplify_wkt(row.get('Geometry'))
        except ValueError as error:
            if row.get('Geometry') in (None, ''):
                withheld['missing-source-geometry'] = withheld.get('missing-source-geometry', 0) + 1
                continue
            raise ValueError(f'Taiwan named trail {identity} has invalid geometry') from error
        if not name:
            withheld['unnamed-source-trail'] = withheld.get('unnamed-source-trail', 0) + 1
            continue
        postal = row.get('PostalAddress')
        if not isinstance(postal, dict):
            postal = {}
        city, town = clean(postal.get('City'), 80), clean(postal.get('Town'), 80)
        region = '台湾' + (f'·{city}' if city else '') + (f'·{town}' if town else '')
        points = [point for path in paths for point in path]
        routes.append({
            'id': f'taiwan-trail-{identity.removeprefix("Trail_")}',
            'name': name, 'region': region,
            'center': [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)],
            'status': '待核验', 'sourceUrl': SOURCE_URL, 'fetchedAt': fetched_at,
            'sourceTags': {
                'sourceServiceStatus': clean(row.get('ServiceStatus')),
                'sourcePublicAccess': clean(row.get('IsPublicAccess')),
                'sourceFreeAccess': clean(row.get('IsAccessibleForFree')),
                'sourcePermitStop': clean(row.get('HasPermitStop')),
                'sourceTrailClass': clean(row.get('TrailClass')),
            },
            'referencePaths': paths,
        })
    if len(routes) + sum(withheld.values()) != len(trails):
        raise ValueError('Taiwan trail source and output counts do not reconcile')
    routes.sort(key=lambda row: row['id'])
    return {
        'schemaVersion': 1, 'generatedAt': fetched_at, 'sourceUrl': SOURCE_URL,
        'datasetUrl': DATASET_URL, 'license': LICENSE, 'licenseUrl': LICENSE_URL,
        'attribution': ATTRIBUTION, 'sourcePublishedAt': updated_at.isoformat(),
        'sourceUpdateIntervalSeconds': document.get('UpdateInterval'),
        'sourceFeatureCount': len(trails), 'catalogRouteCount': len(routes),
        'withheldRecords': sum(withheld.values()), 'withheldReasons': withheld,
        'routeStatusPolicy': ('All rows remain 待核验. Taiwan Tourism Administration source access and service codes are preserved only as source metadata; '
            'they do not establish current access, permission, opening status, or navigation suitability. '
            'Simplified source lines are reference geometry, not navigation guidance; verify current official local notices before travel.'),
        'routes': routes,
    }


def fetch_source():
    request = urllib.request.Request(SOURCE_URL, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/zip, application/octet-stream',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        final = urllib.parse.urlparse(response.url)
        if (final.scheme != 'https' or final.hostname != 'media.taiwan.net.tw'
                or final.port or final.username or final.password):
            raise ValueError('unexpected Taiwan trail source redirect')
        payload = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise ValueError('Taiwan trail source exceeds the 4 MB download budget')
    return payload


def write_catalog(data, target=TARGET):
    payload = (json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=target.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    try:
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return len(payload)


def main():
    from catalog_publication_validation import validate_route_catalog
    result = collect(fetch_source())
    validate_route_catalog('taiwan-trails', result)
    size = write_catalog(result)
    print(f'Taiwan official trail references: {result["catalogRouteCount"]}/{result["sourceFeatureCount"]}; '
          f'withheld={result["withheldRecords"]}; {size} bytes', flush=True)


if __name__ == '__main__':
    main()
