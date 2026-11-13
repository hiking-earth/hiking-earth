#!/usr/bin/env python3
"""Import named SwissTLM3D hiking references from swisstopo's free OGD export.

Only named walking-network features are listed. The source is a signposted
network, not a route-status feed; all entries remain 待核验 and the simplified
lines are discovery references, never navigation guidance.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import pathlib
import sqlite3
import struct
import tempfile
import urllib.parse
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'shared/data/catalog/swisstopo-wanderwege.json'
DOWNLOAD_URL = ('https://data.geo.admin.ch/ch.swisstopo.swisstlm3d-wanderwege/'
                'swisstlm3d-wanderwege/swisstlm3d-wanderwege_2056_5728.gpkg.zip')
DATASET_URL = 'https://opendata.swiss/en/dataset/swisstlm3d-wanderwege'
LICENSE_URL = 'https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste'
ATTRIBUTION = 'Federal Office of Topography swisstopo (SwissTLM3D hiking trails).'
LICENSE = 'swisstopo Open Government Data (OGD): free reuse, redistribution, adaptation and commercial use with source attribution; fair-use limits apply to services.'
MAX_ARCHIVE_BYTES = 250_000_000
MAX_GPKG_BYTES = 600_000_000
MAX_FEATURES = 500_000
MAX_NAMED_FEATURES = 20_000
MAX_ROUTES = 10_000
MAX_ROUTE_POINTS = 15_000
MAX_ROUTE_PATHS = 150
ALLOWED_TYPES = {'Wanderweg', 'Bergwanderweg', 'Alpinwanderweg'}


def fetch_archive(directory, prior_modified_at='', prior_etag=''):
    headers = {
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/zip, application/octet-stream',
    }
    if isinstance(prior_etag, str) and prior_etag.strip():
        headers['If-None-Match'] = prior_etag.strip()[:200]
    if isinstance(prior_modified_at, str) and prior_modified_at.strip():
        headers['If-Modified-Since'] = prior_modified_at.strip()[:200]
    request = urllib.request.Request(DOWNLOAD_URL, headers=headers)
    try:
        response_context = urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return None, prior_modified_at, prior_etag
        raise
    with response_context as response:
        final = urllib.parse.urlparse(response.url)
        if final.scheme != 'https' or final.hostname != 'data.geo.admin.ch' or final.port or final.username or final.password:
            raise ValueError('unexpected swisstopo download redirect')
        length = response.headers.get('Content-Length')
        if length and (not length.isdigit() or int(length) > MAX_ARCHIVE_BYTES):
            raise ValueError('swisstopo archive exceeds the 250 MB download budget')
        path = directory / 'swisstopo.gpkg.zip'
        size = 0
        with path.open('xb') as target:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    raise ValueError('swisstopo archive exceeds the 250 MB download budget')
                target.write(chunk)
        if length and size != int(length):
            raise ValueError('swisstopo download ended before its declared byte count')
        return path, response.headers.get('Last-Modified', ''), response.headers.get('ETag', '')


def extract_gpkg(archive, directory):
    with zipfile.ZipFile(archive) as source:
        entries = [entry for entry in source.infolist() if not entry.is_dir()]
        if len(entries) != 1 or pathlib.PurePosixPath(entries[0].filename).name != 'SWISSTLM3D_WANDERWEGE.gpkg':
            raise ValueError('unexpected swisstopo archive contents')
        entry = entries[0]
        if entry.file_size > MAX_GPKG_BYTES or entry.compress_size > MAX_ARCHIVE_BYTES:
            raise ValueError('swisstopo GeoPackage exceeds its source budget')
        target = directory / 'SWISSTLM3D_WANDERWEGE.gpkg'
        with source.open(entry) as src, target.open('xb') as dst:
            copied = 0
            while True:
                chunk = src.read(8 * 1024 * 1024)
                if not chunk:
                    break
                copied += len(chunk)
                if copied > MAX_GPKG_BYTES:
                    raise ValueError('swisstopo GeoPackage exceeds its source budget')
                dst.write(chunk)
        if copied != entry.file_size:
            raise ValueError('swisstopo GeoPackage extracted incompletely')
        return target


def decode_gpkg_lines(blob):
    if not isinstance(blob, bytes) or len(blob) < 13 or blob[:2] != b'GP' or blob[2] != 0:
        raise ValueError('invalid GeoPackage geometry header')
    flags = blob[3]
    if flags & 0b11000000:
        raise ValueError('unsupported GeoPackage geometry flags')
    envelope_type = (flags >> 1) & 0b111
    envelope_lengths = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    if envelope_type not in envelope_lengths:
        raise ValueError('unsupported GeoPackage envelope type')
    offset = 8 + envelope_lengths[envelope_type]
    if offset + 9 > len(blob):
        raise ValueError('truncated GeoPackage line geometry')
    endian = blob[offset]
    if endian not in (0, 1):
        raise ValueError('invalid WKB byte order')
    order = '<' if endian == 1 else '>'
    geometry_type = struct.unpack_from(order + 'I', blob, offset + 1)[0]
    base_type = geometry_type % 1000 if geometry_type >= 1000 else geometry_type
    dimensions = 2 + ((geometry_type // 1000) if geometry_type >= 1000 else ((geometry_type >> 29) & 0b111))
    dimensions = min(max(dimensions, 2), 4)
    if base_type != 2:
        raise ValueError('swisstopo feature is not a LineString')
    count = struct.unpack_from(order + 'I', blob, offset + 5)[0]
    if count < 2 or count > 2_000_000 or len(blob) != offset + 9 + count * dimensions * 8:
        raise ValueError('invalid or over-budget swisstopo line geometry')
    coords = []
    cursor = offset + 9
    for _ in range(count):
        x, y = struct.unpack_from(order + 'dd', blob, cursor)
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError('non-finite swisstopo coordinate')
        coords.append((x, y))
        cursor += dimensions * 8
    return coords


def simplify(points):
    if len(points) <= 151:
        selected = points
    else:
        stride = math.ceil((len(points) - 1) / 150)
        selected = points[::stride]
        if selected[-1] != points[-1]:
            selected.append(points[-1])
    return [[round(lon, 6), round(lat, 6)] for lon, lat in selected]


def decode_wgs84_line(blob, transformer):
    projected = decode_gpkg_lines(blob)
    geographic = []
    for x, y in projected:
        lon, lat = transformer.transform(x, y, errcheck=True)
        if not (5.7 <= lon <= 10.8 and 45.5 <= lat <= 48.2):
            raise ValueError('point outside SwissTLM3D coverage')
        geographic.append((lon, lat))
    return simplify(geographic)


def clean_name(value):
    if not isinstance(value, str):
        return ''
    return ' '.join(value.replace('\x00', ' ').split()).strip()[:254]


def collect(gpkg, source_modified_at='', source_etag=''):
    try:
        from pyproj import Transformer
    except ImportError as error:
        raise RuntimeError('pyproj is required to convert official EPSG:2056 linework to WGS84') from error
    transformer = Transformer.from_crs('EPSG:2056', 'EPSG:4326', always_xy=True)
    uri = gpkg.resolve().as_uri() + '?mode=ro&immutable=1'
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    try:
        layer = db.execute("SELECT table_name,srs_id FROM gpkg_contents WHERE data_type='features'").fetchall()
        geometry = db.execute('SELECT table_name,column_name,geometry_type_name,srs_id FROM gpkg_geometry_columns').fetchall()
        if (len(layer) != 1 or layer[0]['table_name'] != 'tlm_strassen_strasse' or layer[0]['srs_id'] != 2056
                or len(geometry) != 1 or geometry[0]['table_name'] != 'tlm_strassen_strasse'
                or geometry[0]['column_name'] != 'geom' or geometry[0]['geometry_type_name'] != 'LINESTRING'
                or geometry[0]['srs_id'] != 2056):
            raise ValueError('swisstopo GeoPackage layer schema changed')
        table = 'tlm_strassen_strasse'
        where = "wanderwege IN ('Wanderweg','Bergwanderweg','Alpinwanderweg')"
        feature_count = db.execute(f'SELECT count(*) FROM {table} WHERE {where}').fetchone()[0]
        if not isinstance(feature_count, int) or not 0 < feature_count <= MAX_FEATURES:
            raise ValueError('swisstopo hiking network count is empty or exceeds source budget')
        named_count = db.execute(f"SELECT count(*) FROM {table} WHERE {where} AND name IS NOT NULL AND trim(name)!=''").fetchone()[0]
        if not isinstance(named_count, int) or not 0 < named_count <= MAX_NAMED_FEATURES:
            raise ValueError('swisstopo named hiking segment count is empty or exceeds source budget')
        rows = db.execute(f"SELECT id,name,wanderwege,geom FROM {table} WHERE {where} AND name IS NOT NULL AND trim(name)!='' ORDER BY id")
        grouped = {}
        withheld = {}
        observed_ids = set()
        for row in rows:
            ident = row['id']
            name = clean_name(row['name'])
            kind = row['wanderwege']
            if isinstance(ident, bool) or not isinstance(ident, int) or ident <= 0 or ident in observed_ids:
                raise ValueError('swisstopo named trail IDs are missing or duplicated')
            observed_ids.add(ident)
            if not name or kind not in ALLOWED_TYPES:
                raise ValueError(f'swisstopo named hiking segment {ident} has invalid source properties')
            try:
                path = decode_wgs84_line(row['geom'], transformer)
            except Exception as error:
                raise ValueError(f'swisstopo named hiking segment {ident} has invalid or out-of-area geometry') from error
            key = name.casefold()
            record = grouped.setdefault(key, {'name': name, 'types': set(), 'ids': [], 'paths': [], 'points': [], 'seenPaths': set()})
            signature = hashlib.sha256(json.dumps(path, separators=(',', ':')).encode()).hexdigest()
            if signature not in record['seenPaths']:
                record['paths'].append(path)
                record['seenPaths'].add(signature)
                record['points'].extend(path)
            record['types'].add(kind)
            record['ids'].append(ident)
        if len(observed_ids) != named_count:
            raise ValueError('swisstopo named feature query did not reconcile')
    finally:
        db.close()

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    routes = []
    for key, record in sorted(grouped.items()):
        if len(routes) >= MAX_ROUTES:
            raise ValueError('swisstopo grouped route count exceeds source budget')
        if len(record['paths']) > MAX_ROUTE_PATHS or len(record['points']) > MAX_ROUTE_POINTS:
            withheld['named-route-over-budget'] = withheld.get('named-route-over-budget', 0) + len(record['ids'])
            continue
        center = [round(sum(point[i] for point in record['points']) / len(record['points']), 6) for i in (0, 1)]
        route_key = hashlib.sha256(key.encode('utf-8')).hexdigest()[:24]
        routes.append({
            'id': f'swiss-trail-{route_key}', 'name': record['name'],
            'region': '瑞士·瑞士TLM3D徒步网络', 'center': center,
            'status': '待核验', 'sourceUrl': DOWNLOAD_URL, 'fetchedAt': now,
            'sourceTags': {
                'trailTypes': sorted(record['types']),
                'sourceSegmentCount': len(record['ids']),
                'sourceSegmentIds': sorted(record['ids']),
            },
            'referencePaths': record['paths'],
        })
    routes.sort(key=lambda row: row['id'])
    catalog_segments = sum(row['sourceTags']['sourceSegmentCount'] for row in routes)
    excluded_unnamed = feature_count - named_count
    withheld_total = sum(withheld.values()) + excluded_unnamed
    aggregated = max(0, catalog_segments - len(routes))
    if catalog_segments + excluded_unnamed + sum(withheld.values()) != feature_count:
        raise ValueError('swisstopo source segment counts do not reconcile; previous catalog retained')
    return {
        'schemaVersion': 1, 'generatedAt': now, 'sourceUrl': DOWNLOAD_URL,
        'datasetUrl': DATASET_URL, 'sourceModifiedAt': source_modified_at or None,
        'sourceETag': source_etag or None,
        'license': LICENSE, 'attribution': ATTRIBUTION, 'licenseUrl': LICENSE_URL,
        'sourceFeatureCount': feature_count, 'namedSourceFeatureCount': named_count,
        'catalogSourceFeatureCount': catalog_segments,
        'catalogRouteCount': len(routes), 'aggregatedSourceFeatureCount': aggregated,
        'withheldRecords': withheld_total,
        'withheldReasons': {'unnamed-walking-network-segment': excluded_unnamed, **withheld},
        'routeStatusPolicy': ('All entries remain 待核验. SwissTLM3D identifies signposted walking-network segments and may name only some grouped references; its hiking classification does not establish current opening, public access, complete itinerary, safety or permission. Check local authorities and current notices before travel. Simplified reference linework is not navigation guidance.'),
        'routes': routes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=pathlib.Path, help='Use a previously downloaded GeoPackage for one-time import')
    parser.add_argument('--source-modified-at', default='')
    parser.add_argument('--source-etag', default='')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='hiking-earth-swisstopo-') as name:
        temp = pathlib.Path(name)
        if args.input:
            gpkg = args.input.resolve()
            if not gpkg.is_file() or gpkg.is_symlink() or gpkg.stat().st_size > MAX_GPKG_BYTES:
                raise ValueError('input GeoPackage is missing, linked or over budget')
            modified, etag = args.source_modified_at, args.source_etag
        else:
            previous = {}
            if TARGET.is_file() and not TARGET.is_symlink():
                try:
                    previous = json.loads(TARGET.read_text(encoding='utf-8'))
                    if not isinstance(previous, dict):
                        previous = {}
                except (OSError, ValueError):
                    previous = {}
            archive, modified, etag = fetch_archive(
                temp, previous.get('sourceModifiedAt', ''), previous.get('sourceETag', ''))
            if archive is None:
                print('swisstopo hiking network unchanged (HTTP 304); prior validated catalog retained')
                return
            gpkg = extract_gpkg(archive, temp)
        result = collect(gpkg, modified, etag)
    payload = (json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    if len(payload) > 100_000_000:
        raise ValueError('swisstopo catalog exceeds the 100 MB source budget; previous catalog retained')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=TARGET.parent, prefix=TARGET.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(payload)
        temporary = pathlib.Path(handle.name)
    os.replace(temporary, TARGET)
    print(f'swisstopo named hiking references: {result["catalogRouteCount"]} grouped names from '
          f'{result["catalogSourceFeatureCount"]}/{result["sourceFeatureCount"]} named/all network segments; '
          f'withheld={result["withheldRecords"]}; {len(payload)} bytes')


if __name__ == '__main__':
    main()
