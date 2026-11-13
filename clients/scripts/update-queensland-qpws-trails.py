#!/usr/bin/env python3
"""Collect Queensland QPWS walking-track references as discovery data only."""
import datetime as dt
import json
import math
import os
from pathlib import Path
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LAYER_URL = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/ParksTerrestrialProtectedAreas/MapServer/5'
DATASET_URL = 'https://www.data.qld.gov.au/dataset/queensland-parks-and-wildlife-service-access'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
ATTRIBUTION = ('Contains Queensland Government data from Queensland Parks and Wildlife Service (QPWS) Estate access. '
               '© The State of Queensland (Department of Environment and Science) 2020. Licensed under CC BY 4.0.')
TARGET = ROOT / 'shared/data/catalog/queensland-qpws-trails.json'
WHERE = "subcat = 'Tracks and Trails'"
PAGE_SIZE = 100
MAX_FEATURES = 10000
MAX_RESPONSE = 16_000_000
MAX_VERTICES_PER_PATH = 150
MAX_VERTICES_PER_ROUTE = 15000


def request_json(url, attempts=3):
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={
            'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
            'Accept': 'application/json',
        })
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                final = urllib.parse.urlparse(response.url)
                if (final.scheme != 'https' or final.hostname != 'spatial-gis.information.qld.gov.au'
                        or final.port or final.username or final.password):
                    raise ValueError('unexpected Queensland GIS redirect')
                body = response.read(MAX_RESPONSE + 1)
            if len(body) > MAX_RESPONSE:
                raise ValueError('Queensland GIS response exceeds 16 MB')
            data = json.loads(body)
            if not isinstance(data, dict) or 'error' in data:
                raise ValueError('Queensland GIS returned an error')
            return data
        except (OSError, TimeoutError):
            if attempt + 1 == attempts:
                raise
            time.sleep(2 ** attempt)


def query(params):
    return request_json(LAYER_URL + '/query?' + urllib.parse.urlencode(params))


def clean(value, limit=300):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError('Queensland source property has an unsupported value')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Queensland source property is not finite')
    text = ' '.join(str(value).replace('\x00', ' ').split())
    return text[:limit] or None


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('Queensland trail path has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                       for v in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Queensland trail geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / MAX_VERTICES_PER_PATH))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    identity_data = query({'where': WHERE, 'returnIdsOnly': 'true', 'f': 'json'})
    object_ids = identity_data.get('objectIds')
    if not isinstance(object_ids, list) or not object_ids or len(object_ids) > MAX_FEATURES:
        raise ValueError('Queensland source IDs are empty or exceed the source budget')
    if (any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids)
            or len(set(object_ids)) != len(object_ids)):
        raise ValueError('Queensland source IDs are invalid or duplicated')
    object_ids = sorted(object_ids)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    routes = []
    withheld = {}
    fields = 'objectid,name,access_,subcat,assettype,assetgroup,material,maintain,owner,status,vetting,comments,wheelchair,fireline,gw,ped,horse,tb,mtb,traffic,class,st_length(shape)'
    for start in range(0, len(object_ids), PAGE_SIZE):
        batch = object_ids[start:start + PAGE_SIZE]
        page = query({
            'objectIds': ','.join(str(value) for value in batch), 'where': WHERE,
            'outFields': fields, 'returnGeometry': 'true', 'outSR': '4326',
            'geometryPrecision': '6', 'f': 'json',
        })
        features = page.get('features')
        if not isinstance(features, list) or len(features) != len(batch):
            raise ValueError(f'Queensland source page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            identity = attrs.get('objectid') if isinstance(attrs, dict) else None
            if identity not in batch or identity in found or attrs.get('subcat') != 'Tracks and Trails':
                raise ValueError('Queensland source page contains a missing, duplicate, or non-trail ID')
            found.add(identity)
            name = clean(attrs.get('name'), 200)
            if not name:
                # An official feature without a public name is not a usable
                # route listing. Count it as withheld instead of publishing a
                # fabricated "unnamed trail <id>" card.
                withheld['unnamed-source-feature'] = withheld.get('unnamed-source-feature', 0) + 1
                continue
            geometry = feature.get('geometry')
            raw_paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(raw_paths, list) or not raw_paths or len(raw_paths) > 100:
                raise ValueError(f'Queensland named trail {identity} has missing or invalid line geometry')
            try:
                reference_paths = [simplify(path) for path in raw_paths]
            except ValueError as error:
                raise ValueError(f'Queensland named trail {identity} has invalid line geometry') from error
            points = [point for path in reference_paths for point in path]
            if len(points) > MAX_VERTICES_PER_ROUTE:
                withheld['geometry-over-budget'] = withheld.get('geometry-over-budget', 0) + 1
                continue
            length = attrs.get('st_length(shape)')
            distance_km = round(length / 1000, 2) if isinstance(length, (int, float)) and math.isfinite(length) and length > 0 else None
            tags = {
                'sourceSubcategory': clean(attrs.get('subcat')),
                'sourceAssetType': clean(attrs.get('assettype')),
                'sourceAssetGroup': clean(attrs.get('assetgroup')),
                'sourceStatus': clean(attrs.get('status')),
                'accessRestriction': clean(attrs.get('access_')),
                'pedestrianAccess': clean(attrs.get('ped')),
                'greatWalk': clean(attrs.get('gw')),
                'trailClass': clean(attrs.get('class')),
                'maintainedByQpws': clean(attrs.get('maintain')),
                'sourceOwner': clean(attrs.get('owner')),
                'sourceVetting': clean(attrs.get('vetting')),
                'wheelchairAccess': clean(attrs.get('wheelchair')),
                'sourceComment': clean(attrs.get('comments')),
                'sourceLengthMeters': str(round(length, 1)) if isinstance(length, (int, float)) and math.isfinite(length) and length > 0 else None,
                'sourceId': str(identity),
            }
            routes.append({
                'id': f'queensland-qpws-{identity}', 'name': name,
                'region': '澳大利亚·昆士兰州',
                'center': [round(sum(point[i] for point in points) / len(points), 6) for i in (0, 1)],
                'status': '待核验', 'sourceUrl': LAYER_URL, 'fetchedAt': now,
                'sourceTags': tags, 'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'Queensland source page {start // PAGE_SIZE} did not reconcile all requested IDs')
        print(f'Queensland QPWS walking paths {min(start + len(batch), len(object_ids))} / {len(object_ids)}', flush=True)
    if len(routes) + sum(withheld.values()) != len(object_ids):
        raise ValueError('Queensland source records did not reconcile; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('queensland-qpws-')))
    return {
        'schemaVersion': 1, 'generatedAt': now, 'sourceUrl': LAYER_URL,
        'datasetUrl': DATASET_URL, 'license': 'Creative Commons Attribution 4.0 International',
        'attribution': ATTRIBUTION, 'licenseUrl': LICENSE_URL,
        'sourceFeatureCount': len(object_ids), 'catalogRouteCount': len(routes),
        'withheldRecords': sum(withheld.values()), 'withheldReasons': withheld,
        'routeStatusPolicy': ('All records remain 待核验. Queensland QPWS subcategory Tracks and Trails is a source classification, '
            'not confirmation of current access, public permission, closure state, route completeness, or navigation suitability. '
            'Source access/status fields are retained for reference; check current local notices before travel. Simplified lines are not navigation guidance.'),
        'routes': routes,
    }


def main():
    result = collect()
    payload = (json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=TARGET.parent, prefix=TARGET.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    try:
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Queensland QPWS references: {len(result["routes"])}/{result["sourceFeatureCount"]}; '
          f'withheld={result["withheldRecords"]}; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
