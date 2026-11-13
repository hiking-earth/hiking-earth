#!/usr/bin/env python3
"""Collect Argyll and Bute Council's OGL adopted core-path references.

The council describes these as public access routes for multiple user types;
they are retained as discovery references, not as verified hiking or nav data.
"""
import datetime as dt
import json
import math
import os
import pathlib
import re
import tempfile
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'shared/data/catalog/scotland-argyll-corepaths.json'
BASE = 'https://arcgis.argyll-bute.gov.uk/arcgis/rest/services/Open_Data/MapServer/27'
LICENSE_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
ATTRIBUTION = 'Contains spatial data licensed under Open Government Licence v3.0 from Argyll and Bute Council. Source: Adopted Core Paths.'
PAGE_SIZE = 40
MAX_BODY = 15_000_000
FIELDS = 'OBJECTID,PATH_NO,PATH_NAME,PATH_GRADE,LEAFLET,WALK_LENGTH,LOCAL_INFO,ADD_INFO,PATH_INFO,PUB_NOTE,PUB_ROAD'


def get(params):
    request = urllib.request.Request(BASE + '/query?' + urllib.parse.urlencode(params), headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        if urllib.parse.urlparse(response.url).hostname != 'arcgis.argyll-bute.gov.uk':
            raise ValueError('unexpected Argyll and Bute service redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Argyll and Bute response exceeds 15 MB source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('Argyll and Bute core-path query failed')
    return result


def clean_text(value, limit=500):
    if not isinstance(value, str):
        return None
    text = ' '.join(value.replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def metric_distance(value):
    text = clean_text(value, 500)
    if not text:
        return None
    match = re.search(r'(?:^|/)\s*(\d+(?:\.\d+)?)\s*km(?:\s*/|$)', text, re.IGNORECASE)
    if not match:
        return None
    distance = float(match.group(1))
    return round(distance, 2) if math.isfinite(distance) and distance > 0 else None


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('Argyll and Bute core path has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Argyll and Bute geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 150))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    identity_data = get({'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'})
    object_ids = identity_data.get('objectIds')
    if not isinstance(object_ids, list) or not object_ids or len(object_ids) > 5000:
        raise ValueError('Argyll and Bute object ID response is empty or exceeds source budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids):
        raise ValueError('Argyll and Bute object IDs are invalid')
    if len(set(object_ids)) != len(object_ids):
        raise ValueError('Argyll and Bute object IDs are not unique')
    object_ids = sorted(object_ids)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    routes = []
    for start in range(0, len(object_ids), PAGE_SIZE):
        batch = object_ids[start:start + PAGE_SIZE]
        page = get({
            'objectIds': ','.join(str(value) for value in batch),
            'outFields': FIELDS,
            'returnGeometry': 'true',
            'outSR': '4326',
            'maxAllowableOffset': '0.00015',
            'geometryPrecision': '6',
            'f': 'json',
        })
        features = page.get('features')
        if not isinstance(features, list) or len(features) != len(batch):
            raise ValueError(f'Argyll and Bute page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('OBJECTID') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('Argyll and Bute page has missing, unexpected, or duplicate IDs')
            found.add(object_id)
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(paths, list) or not paths:
                raise ValueError(f'Argyll and Bute core path {object_id} has no line geometry')
            reference_paths = [simplify(path) for path in paths]
            points = [point for path in reference_paths for point in path]
            if len(points) > 15000:
                raise ValueError(f'Argyll and Bute core path {object_id} exceeds reference geometry budget')
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            path_number = clean_text(attrs.get('PATH_NO'), 80)
            name = clean_text(attrs.get('PATH_NAME')) or (f'核心步道 {path_number}' if path_number else None)
            if not name:
                raise ValueError(f'Argyll and Bute core path {object_id} has no display name or reference number')
            walk_length = clean_text(attrs.get('WALK_LENGTH'))
            distance = metric_distance(walk_length)
            routes.append({
                'id': f'scotland-argyll-{object_id}',
                'name': name,
                'region': '英国·苏格兰·阿盖尔-比特',
                'center': center,
                'sourceUrl': BASE,
                'fetchedAt': now,
                'sourceTags': {
                    'pathNumber': path_number,
                    'grade': clean_text(attrs.get('PATH_GRADE'), 120),
                    'leaflet': clean_text(attrs.get('LEAFLET'), 120),
                    'distanceKm': distance,
                    'walkLength': walk_length,
                    'localInfo': clean_text(attrs.get('LOCAL_INFO')),
                    'additionalInfo': clean_text(attrs.get('ADD_INFO')),
                    'pathInfo': clean_text(attrs.get('PATH_INFO')),
                    'publicNote': clean_text(attrs.get('PUB_NOTE')),
                    'publicRoad': clean_text(attrs.get('PUB_ROAD')),
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'Argyll and Bute page {start // PAGE_SIZE} did not return all requested IDs')
        print(f'Argyll and Bute source rows {len(routes)} / {len(object_ids)}', flush=True)
    if len(routes) != len(object_ids):
        raise ValueError('Argyll and Bute source was not fully collected; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('scotland-argyll-')))
    return {
        'schemaVersion': 1,
        'generatedAt': now,
        'sourceUrl': BASE,
        'license': 'Open Government Licence v3.0',
        'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'Routes are council-adopted core access paths for multiple user types. All remain 待核验 as hiking plans; dataset inclusion does not establish current surface condition, suitability, closures, or navigation accuracy.',
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
    print(f'Collected {len(result["routes"])} Argyll and Bute core-path discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
