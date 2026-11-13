#!/usr/bin/env python3
"""Collect the New Zealand DOC official walking/tramping line layer.

The service supplies approximate track centrelines. These are published only
as discovery/reference geometry with attribution; open status and navigation
permission are never inferred from this dataset.
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
TARGET = ROOT / 'shared/data/catalog/nzdoc.json'
BASE = 'https://services1.arcgis.com/3JjYDyG3oajxU6HO/ArcGIS/rest/services/DOC_Walking_Experiences/FeatureServer/1'
ATTRIBUTION_PREFIX = 'Crown Copyright: Department of Conservation Te Papa Atawhai '
PAGE_SIZE = 40
MAX_BODY = 20_000_000
FIELDS = 'OBJECTID,name,difficulty,completionTime,hasAlerts,walkingAndTrampingWebPage,Shape__Length'


def get(params):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(BASE + '/query?' + query, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        if urllib.parse.urlparse(response.url).hostname != 'services1.arcgis.com':
            raise ValueError('unexpected DOC service redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('DOC response exceeds 20 MB source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('DOC query failed')
    return result


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('DOC line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('DOC geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 150))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    identity_data = get({'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'})
    object_ids = identity_data.get('objectIds')
    if not isinstance(object_ids, list) or not object_ids or len(object_ids) > 20000:
        raise ValueError('DOC object ID response is empty or exceeds the source budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids):
        raise ValueError('DOC object IDs are invalid')
    if len(set(object_ids)) != len(object_ids):
        raise ValueError('DOC object IDs are not unique')
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
            # Simplify in WGS84 for a compact reference display; source lines
            # remain approximate and are explicitly non-navigational.
            'maxAllowableOffset': '0.00015',
            'geometryPrecision': '6',
            'f': 'json',
        })
        features = page.get('features')
        if not isinstance(features, list) or len(features) != len(batch):
            raise ValueError(f'DOC page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('OBJECTID') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('DOC page contains missing, unexpected, or duplicate IDs')
            found.add(object_id)
            name = attrs.get('name')
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(name, str) or not name.strip() or not isinstance(paths, list) or not paths:
                raise ValueError(f'DOC route {object_id} is missing its name or line geometry')
            reference_paths = [simplify(path) for path in paths]
            points = [point for path in reference_paths for point in path]
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            length = attrs.get('Shape__Length')
            distance_km = round(length / 1000, 2) if isinstance(length, (int, float)) and not isinstance(length, bool) and math.isfinite(length) and length > 0 else None
            official_url = attrs.get('walkingAndTrampingWebPage')
            if official_url:
                parsed = urllib.parse.urlparse(official_url)
                if parsed.scheme != 'https' or parsed.hostname != 'www.doc.govt.nz' or parsed.username or parsed.password or parsed.port:
                    official_url = None
            routes.append({
                'id': f'nzdoc-{object_id}',
                'name': name.strip(),
                'region': '新西兰',
                'center': center,
                'sourceUrl': BASE,
                'fetchedAt': now,
                'sourceTags': {
                    'distanceKm': distance_km,
                    'difficulty': attrs.get('difficulty') if isinstance(attrs.get('difficulty'), str) else None,
                    'estimatedTime': attrs.get('completionTime') if isinstance(attrs.get('completionTime'), str) else None,
                    'hasAlerts': attrs.get('hasAlerts') if isinstance(attrs.get('hasAlerts'), str) else None,
                    'officialUrl': official_url,
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'DOC page {start // PAGE_SIZE} did not return the requested IDs')
        print(f'DOC source rows {len(routes)} / {len(object_ids)}', flush=True)
    if len(routes) != len(object_ids):
        raise ValueError('DOC source was not fully collected; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('nzdoc-')))
    result = {
        'schemaVersion': 1,
        'generatedAt': now,
        'sourceUrl': BASE,
        'license': 'CC-BY-3.0-NZ',
        'attribution': ATTRIBUTION_PREFIX + str(dt.datetime.now(dt.timezone.utc).year),
        'licenseUrl': 'https://www.doc.govt.nz/our-work/maps-and-data/terms-and-conditions/',
        'routeStatusPolicy': 'All routes stay 待核验. The source page directs walkers to confirm local closures before travel.',
        'routes': routes,
    }
    return result


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
    print(f'Collected {len(result["routes"])} official New Zealand reference routes; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
