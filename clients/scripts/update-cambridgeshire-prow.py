#!/usr/bin/env python3
"""Collect the daily Cambridgeshire County Council public-rights-of-way layer.

This is an indicative interpretation of the Definitive Map, not a legal
record, exact alignment, current access check, or navigation track.
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
TARGET = ROOT / 'shared/data/catalog/cambridgeshire-prow.json'
ENDPOINT = 'https://maps.cambridgeshire.gov.uk/GetOWS.ashx'
PARAMS = {
    'SERVICE': 'WFS', 'VERSION': '2.0.0', 'MAPSOURCE': 'CCC/INSPIRE',
    'REQUEST': 'GetFeature', 'TYPENAME': 'public_rights_of_way',
    'OUTPUTFORMAT': 'GEOJSON', 'SRSNAME': 'EPSG:4326',
}
SOURCE_URL = ENDPOINT + '?' + urllib.parse.urlencode(PARAMS)
LICENSE_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
LICENSE = 'Open Government Licence v3.0'
ATTRIBUTION = 'Contains information licensed under the Open Government Licence v3.0 from Cambridgeshire County Council. Source: Public Rights of Way.'
MAX_BODY = 20_000_000
MAX_RECORDS = 20_000
MAX_FEATURE_POINTS = 50_000


def fetch():
    request = urllib.request.Request(SOURCE_URL, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/geo+json, application/json',
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        final = urllib.parse.urlparse(response.url)
        if (final.scheme != 'https' or final.hostname != 'maps.cambridgeshire.gov.uk'
                or final.port):
            raise ValueError('unexpected Cambridgeshire PROW redirect')
        media_type = response.headers.get('Content-Type', '').lower()
        if 'json' not in media_type:
            raise ValueError('Cambridgeshire PROW source did not return GeoJSON')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Cambridgeshire PROW response exceeds source budget')
    data = json.loads(body)
    if not isinstance(data, dict) or data.get('type') != 'FeatureCollection':
        raise ValueError('Cambridgeshire PROW response is not a feature collection')
    features = data.get('features')
    matched = data.get('numberMatched')
    if (not isinstance(features, list) or not features or len(features) > MAX_RECORDS
            or isinstance(matched, bool) or not isinstance(matched, int)
            or matched != len(features)):
        raise ValueError('Cambridgeshire PROW source snapshot is incomplete or over budget')
    return features


def text_value(value, limit=300):
    if not isinstance(value, str):
        return None
    normalized = ' '.join(''.join(' ' if ord(char) < 32 or ord(char) == 127 else char
                                  for char in value).split())
    return normalized[:limit] or None


def numeric_value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def simplify(line):
    if not isinstance(line, list) or len(line) < 2:
        raise ValueError('Cambridgeshire PROW line has fewer than two points')
    points = []
    for coordinate in line:
        if not isinstance(coordinate, list) or len(coordinate) < 2:
            raise ValueError('Cambridgeshire PROW coordinate is invalid')
        longitude, latitude = coordinate[:2]
        if (numeric_value(longitude) is None or numeric_value(latitude) is None
                or not -1 <= longitude <= 1 or not 51 <= latitude <= 53.5):
            raise ValueError('Cambridgeshire PROW geometry is not WGS84 within the source area')
        point = [round(longitude, 6), round(latitude, 6)]
        if not points or points[-1] != point:
            points.append(point)
    if len(points) < 2:
        raise ValueError('Cambridgeshire PROW line collapsed during coordinate normalization')
    stride = max(1, math.ceil(len(points) / 151))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    features = fetch()
    generated = dt.datetime.now(dt.timezone.utc).isoformat()
    seen = set()
    routes = []
    for feature in features:
        if not isinstance(feature, dict) or feature.get('type') != 'Feature':
            raise ValueError('Cambridgeshire PROW has a malformed feature')
        props = feature.get('properties')
        geometry = feature.get('geometry')
        identity = props.get('ogc_fid') if isinstance(props, dict) else None
        if isinstance(identity, bool) or not isinstance(identity, int) or identity <= 0 or identity in seen:
            raise ValueError('Cambridgeshire PROW has missing, invalid, or duplicate feature IDs')
        seen.add(identity)
        if not isinstance(geometry, dict):
            raise ValueError(f'Cambridgeshire PROW {identity} has no geometry')
        if geometry.get('type') == 'LineString':
            lines = [geometry.get('coordinates')]
        elif geometry.get('type') == 'MultiLineString':
            lines = geometry.get('coordinates')
        else:
            raise ValueError(f'Cambridgeshire PROW {identity} geometry is not a line')
        if not isinstance(lines, list) or not lines or len(lines) > 100:
            raise ValueError(f'Cambridgeshire PROW {identity} geometry part count is invalid')
        paths = [simplify(line) for line in lines]
        points = [point for line in paths for point in line]
        if len(points) > MAX_FEATURE_POINTS:
            raise ValueError(f'Cambridgeshire PROW {identity} geometry exceeds its point budget')
        center = [round(sum(point[index] for point in points) / len(points), 6)
                  for index in (0, 1)]
        name = text_value(props.get('name')) or f"公共通行权路段 {identity}"
        routes.append({
            'id': f'cambridgeshire-prow-{identity}',
            'name': name,
            'region': '英国·英格兰·剑桥郡',
            'center': center,
            'sourceUrl': SOURCE_URL,
            'fetchedAt': generated,
            'status': '待核验',
            'sourceTags': {
                'sourceStatus': text_value(props.get('status'), 100),
                'parish': text_value(props.get('parish'), 200),
                'pathNumber': text_value(props.get('pathno'), 100),
                'parishNumber': text_value(props.get('parishno'), 100),
                'district': text_value(props.get('district'), 200),
                'lengthKm': numeric_value(props.get('length')),
            },
            'referencePaths': paths,
        })
    routes.sort(key=lambda row: int(row['id'].removeprefix('cambridgeshire-prow-')))
    return {
        'schemaVersion': 1,
        'generatedAt': generated,
        'sourceUrl': SOURCE_URL,
        'license': LICENSE,
        'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'Cambridgeshire County Council says this is a daily-updated electronic working interpretation of the Definitive Map, not the legal record; it can contain errors and anomalies and must not determine exact alignment. All records remain 待核验; geometry is discovery reference only, not navigation guidance.',
        'routes': routes,
    }


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
    print(f'Collected {len(result["routes"])} Cambridgeshire public-rights-of-way discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
