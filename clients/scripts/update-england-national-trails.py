#!/usr/bin/env python3
"""Collect Natural England's openly licensed National Trails (England) layer.

The geometries are published as official route references, not as proof of
current access, conditions, or legal navigation permission.
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
TARGET = ROOT / 'shared/data/catalog/england-trails.json'
BASE = 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/National_Trails_England/FeatureServer/0'
DATASET_URL = 'https://www.data.gov.uk/dataset/ac8c851c-99a0-4488-8973-6c8863529c45/national-trails-england3'
LICENSE_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
PORTAL_ATTRIBUTION = '© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right'
PAGE_SIZE = 40
MAX_BODY = 12_000_000
MAX_RECORDS = 100
FIELDS = 'OBJECTID_1,OBJECTID,Name,Opened,Start,End_,Length_Km,Length_Mil,Updated,Last_VR'


def get(params):
    url = BASE + '/query?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        parsed = urllib.parse.urlparse(response.url)
        if parsed.scheme != 'https' or parsed.hostname != 'services.arcgis.com' or parsed.port or parsed.username or parsed.password:
            raise ValueError('unexpected Natural England service redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Natural England response exceeds 12 MB source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('Natural England query failed')
    return result


def clean_text(value, limit=300):
    if not isinstance(value, str):
        return None
    text = ' '.join(value.replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def source_date(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    try:
        return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('Natural England line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Natural England geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 150))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    identity_data = get({'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'})
    object_ids = identity_data.get('objectIds')
    if not isinstance(object_ids, list) or not object_ids or len(object_ids) > MAX_RECORDS:
        raise ValueError('Natural England object ID response is empty or exceeds the 100-record source budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids):
        raise ValueError('Natural England object IDs are invalid')
    if len(set(object_ids)) != len(object_ids):
        raise ValueError('Natural England object IDs are not unique')
    object_ids = sorted(object_ids)
    now = dt.datetime.now(dt.timezone.utc)
    fetched_at = now.isoformat()
    attribution = f'{PORTAL_ATTRIBUTION} {now.year}.'
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
            raise ValueError(f'Natural England page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('OBJECTID_1') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('Natural England page has missing, unexpected, or duplicate IDs')
            found.add(object_id)
            name = clean_text(attrs.get('Name'), 120)
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not name or not isinstance(paths, list) or not paths:
                raise ValueError(f'Natural England trail {object_id} is missing its name or line geometry')
            reference_paths = [simplify(path) for path in paths]
            points = [point for path in reference_paths for point in path]
            if len(points) > 15_000:
                raise ValueError(f'Natural England trail {object_id} exceeds the reference geometry budget')
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            length = attrs.get('Length_Km')
            distance = round(length, 2) if isinstance(length, (int, float)) and not isinstance(length, bool) and math.isfinite(length) and length > 0 else None
            routes.append({
                'id': f'england-trail-{object_id}',
                'name': name,
                'region': '英国·英格兰',
                'center': center,
                'sourceUrl': BASE,
                'fetchedAt': fetched_at,
                'sourceTags': {
                    'distanceKm': distance,
                    'start': clean_text(attrs.get('Start'), 120),
                    'end': clean_text(attrs.get('End_'), 120),
                    'openedDate': source_date(attrs.get('Opened')),
                    'sourceUpdatedAt': source_date(attrs.get('Updated')),
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'Natural England page {start // PAGE_SIZE} did not return the requested IDs')
        print(f'Natural England source rows {len(routes)} / {len(object_ids)}', flush=True)
    if len(routes) != len(object_ids):
        raise ValueError('Natural England source was not fully collected; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('england-trail-')))
    return {
        'schemaVersion': 1,
        'generatedAt': fetched_at,
        'sourceUrl': BASE,
        'datasetUrl': DATASET_URL,
        'license': 'Open Government Licence v3.0',
        'attribution': attribution,
        'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'All records remain 待核验. Natural England provides National Trails England geometry for public distribution, but its data disclaimer says it is dynamic, not a legal document, and is supplied without a warranty of accuracy, reliability, or completeness. Verify the current trail route and local notices before travel; these simplified references are not navigation tracks.',
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
    print(f'Collected {len(result["routes"])} Natural England trail references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
