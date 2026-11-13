#!/usr/bin/env python3
"""Collect NSW NPWS walking-track reference segments from the official layer.

Only the source's Walking Track and Walking Route asset classes are included.
These remain discovery references, not confirmation of current access or
navigation rights. The portal licenses reuse with attribution.
"""
import datetime as dt
import json
import math
import os
import pathlib
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'shared/data/catalog/nsw-npws.json'
BASE = 'https://services7.arcgis.com/9nlQUywsHzFwAwIM/arcgis/rest/services/NPWS_Tracks/FeatureServer/0'
DATASET_URL = 'https://data.nsw.gov.au/data/dataset/asset-infrastructure-track-section8bfcf'
LICENSE_URL = 'https://data.nsw.gov.au/data/dataset/asset-infrastructure-track-section8bfcf'
LICENSE = 'Creative Commons Attribution'
ATTRIBUTION = '© State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2017. Source: NSW NPWS Asset Infrastructure – Track Section.'
WHERE = 'SubtypeCD IN (1101,1102)'
FIELDS = 'FID,SubtypeCD,SAPEquipID,AssetName,AssetType,LengthM,Branch,ModifiedDa,VerDate,d_SubtypeC,d_AssetTyp,Shape__Length'
PAGE_SIZE = 100
MAX_BODY = 20_000_000


def get(params):
    body = None
    for attempt in range(3):
        request = urllib.request.Request(BASE + '/query?' + urllib.parse.urlencode(params), headers={
            'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
            'Accept': 'application/json',
        })
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                if urllib.parse.urlparse(response.url).hostname != 'services7.arcgis.com':
                    raise ValueError('unexpected NSW NPWS service redirect')
                body = response.read(MAX_BODY + 1)
            break
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    if len(body) > MAX_BODY:
        raise ValueError('NSW NPWS response exceeds 20 MB source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('NSW NPWS query failed')
    return result


def clean_text(value, limit=300):
    if not isinstance(value, str):
        return None
    text = ' '.join(value.replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('NSW NPWS line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('NSW NPWS geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 150))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    identity_data = get({'where': WHERE, 'returnIdsOnly': 'true', 'f': 'json'})
    object_ids = identity_data.get('objectIds')
    if not isinstance(object_ids, list) or not object_ids or len(object_ids) > 10000:
        raise ValueError('NSW NPWS ID response is empty or exceeds source budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids):
        raise ValueError('NSW NPWS object IDs are invalid')
    if len(set(object_ids)) != len(object_ids):
        raise ValueError('NSW NPWS object IDs are not unique')
    object_ids = sorted(object_ids)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    routes = []
    for start in range(0, len(object_ids), PAGE_SIZE):
        batch = object_ids[start:start + PAGE_SIZE]
        page = get({
            'objectIds': ','.join(str(value) for value in batch),
            'where': WHERE,
            'outFields': FIELDS,
            'returnGeometry': 'true',
            'outSR': '4326',
            'maxAllowableOffset': '0.00015',
            'geometryPrecision': '6',
            'f': 'json',
        })
        features = page.get('features')
        if not isinstance(features, list) or len(features) != len(batch):
            raise ValueError(f'NSW NPWS page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('FID') if isinstance(attrs, dict) else None
            subtype = attrs.get('SubtypeCD') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found or subtype not in (1101, 1102):
                raise ValueError('NSW NPWS page has missing, unexpected, duplicate, or disallowed asset IDs')
            found.add(object_id)
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(paths, list) or not paths:
                raise ValueError(f'NSW NPWS segment {object_id} has no line geometry')
            reference_paths = [simplify(path) for path in paths]
            points = [point for path in reference_paths for point in path]
            if len(points) > 15000:
                raise ValueError(f'NSW NPWS segment {object_id} exceeds reference geometry budget')
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            name = clean_text(attrs.get('AssetName')) or f'NSW NPWS {"步道" if subtype == 1101 else "步行路线"}路段 {object_id}'
            length = attrs.get('LengthM')
            distance = round(length / 1000, 2) if isinstance(length, (int, float)) and not isinstance(length, bool) and math.isfinite(length) and length > 0 else None
            routes.append({
                'id': f'nsw-npws-{object_id}',
                'name': name,
                'region': '澳大利亚·新南威尔士州',
                'center': center,
                'sourceUrl': BASE,
                'fetchedAt': now,
                'sourceTags': {
                    'distanceKm': distance,
                    'assetClass': 'Walking Track' if subtype == 1101 else 'Walking Route',
                    'assetType': clean_text(attrs.get('d_AssetTyp')),
                    'branch': clean_text(attrs.get('Branch'), 120),
                    'sourceModifiedAt': attrs.get('ModifiedDa'),
                    'sourceVersionDate': clean_text(attrs.get('VerDate'), 80),
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'NSW NPWS page {start // PAGE_SIZE} did not return all requested IDs')
        print(f'NSW NPWS source rows {len(routes)} / {len(object_ids)}', flush=True)
    if len(routes) != len(object_ids):
        raise ValueError('NSW NPWS source was not fully collected; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('nsw-npws-')))
    return {
        'schemaVersion': 1,
        'generatedAt': now,
        'sourceUrl': BASE,
        'datasetUrl': DATASET_URL,
        'license': LICENSE,
        'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'All records remain 待核验. This is an NPWS asset track-segment dataset; it includes walking tracks/routes but does not certify current access, public permission, closure state, or navigability. Only official Walking Track and Walking Route asset classes are included.',
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
    print(f'Collected {len(result["routes"])} NSW NPWS discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
