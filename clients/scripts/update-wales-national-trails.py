#!/usr/bin/env python3
"""Collect Natural Resources Wales National Trails as licensed references.

The published linework is discovery material only: it does not establish
current opening, legal access, safety, or suitability for navigation.
"""
import datetime as dt
import json
import math
import os
import pathlib
import tempfile
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'shared/data/catalog/wales-trails.json'
BASE = 'https://datamap.gov.wales/geoserver/ows'
SOURCE_URL = BASE + '?' + urllib.parse.urlencode({
    'outputFormat': 'application/json', 'request': 'GetFeature', 'service': 'WFS',
    'srsName': 'EPSG:4326', 'typename': 'inspire-nrw:NRW_NATIONAL_TRAIL', 'version': '1.0.0',
})
DATASET_URL = 'https://datamap.gov.wales/layers/inspire-nrw:NRW_NATIONAL_TRAIL/metadata_detail'
LICENSE_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
ATTRIBUTION = ('Contains Natural Resources Wales information © Natural Resources Wales and Database Right. '
               'All rights Reserved. Contains Ordnance Survey Data. Ordnance Survey Licence number '
               'AC0000849444. Crown Copyright and Database Right.')
MAX_BODY = 8_000_000
MAX_RECORDS = 100


def simplify(raw):
    if not isinstance(raw, list) or len(raw) < 2:
        raise ValueError('Wales line has fewer than two vertices')
    points = []
    for point in raw:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                       for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Wales geometry is not WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 150))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    request = urllib.request.Request(SOURCE_URL, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        parsed = urllib.parse.urlparse(response.url)
        if parsed.scheme != 'https' or parsed.hostname != 'datamap.gov.wales' or parsed.port or parsed.username or parsed.password:
            raise ValueError('unexpected Natural Resources Wales redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Wales response exceeds 8 MB source budget')
    payload = json.loads(body)
    features = payload.get('features') if isinstance(payload, dict) else None
    crs = payload.get('crs', {}).get('properties', {}).get('name', '') if isinstance(payload, dict) else ''
    if (payload.get('type') != 'FeatureCollection' or crs not in ('urn:ogc:def:crs:EPSG::4326', 'EPSG:4326')
            or not isinstance(features, list) or not features or len(features) > MAX_RECORDS):
        raise ValueError('Wales feature response is empty, unbounded, or not WGS84')
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    routes, seen = [], set()
    for feature in features:
        properties = feature.get('properties') if isinstance(feature, dict) else None
        identity = properties.get('id') if isinstance(properties, dict) else None
        name = properties.get('name') if isinstance(properties, dict) else None
        geometry = feature.get('geometry') if isinstance(feature, dict) else None
        if isinstance(identity, bool) or not isinstance(identity, int) or identity <= 0 or identity in seen:
            raise ValueError('Wales source IDs are missing, invalid, or duplicated')
        if not isinstance(name, str) or not name.strip() or len(name) > 160:
            raise ValueError(f'Wales trail {identity} has no safe name')
        kind = geometry.get('type') if isinstance(geometry, dict) else None
        coordinates = geometry.get('coordinates') if isinstance(geometry, dict) else None
        if kind == 'LineString':
            raw_paths = [coordinates]
        elif kind == 'MultiLineString':
            raw_paths = coordinates
        else:
            raise ValueError(f'Wales trail {identity} has unsupported geometry')
        if not isinstance(raw_paths, list) or not raw_paths or len(raw_paths) > 100:
            raise ValueError(f'Wales trail {identity} has an invalid path count')
        paths = [simplify(path) for path in raw_paths]
        points = [point for path in paths for point in path]
        if len(points) > 15_000:
            raise ValueError(f'Wales trail {identity} exceeds its geometry budget')
        center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
        seen.add(identity)
        routes.append({
            'id': f'wales-trail-{identity}', 'name': name.strip(), 'region': '英国·威尔士',
            'center': center, 'sourceUrl': SOURCE_URL, 'fetchedAt': now,
            'sourceTags': {'sourceStatus': properties.get('status') if isinstance(properties.get('status'), str) else None},
            'referencePaths': paths,
        })
    routes.sort(key=lambda row: int(row['id'].removeprefix('wales-trail-')))
    return {'schemaVersion': 1, 'generatedAt': now, 'sourceUrl': SOURCE_URL, 'datasetUrl': DATASET_URL,
            'license': 'Open Government Licence for Public Sector Information (OGL)',
            'attribution': ATTRIBUTION, 'licenseUrl': LICENSE_URL,
            'routeStatusPolicy': 'All records remain 待核验. Natural Resources Wales says these are National Trail references maintained with local authorities and landowners. Source status is preserved as source metadata only and does not establish current opening or legal access; simplified linework is not navigation guidance.',
            'routes': routes}


def main():
    result = collect()
    payload = (json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=TARGET.parent, prefix=TARGET.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(payload)
        temporary = pathlib.Path(handle.name)
    try:
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Collected {len(result["routes"])} Natural Resources Wales trail references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
