#!/usr/bin/env python3
"""Refresh USGS National Digital Trails as a bounded discovery catalog.

Only USGS records explicitly labeled Terra Trail and Hiker/Pedestrian are
included. The aggregated data are public domain; source originators are kept.
Every route remains 待核验 and simplified lines are never navigation geometry.
"""
import argparse
import time
import urllib.error
import datetime as dt
import json
import math
import os
import pathlib
import tempfile
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'shared/data/catalog/usgs-trails.json'
BASE = 'https://partnerships.nationalmap.gov/arcgis/rest/services/USGSTrails/MapServer/0'
LICENSE_URL = 'https://www.usgs.gov/national-digital-trails/how-access-or-view-usgs-trails-dataset'
ATTRIBUTION = ('U.S. Geological Survey National Digital Trails. USGS public-domain aggregate; '
               'the original source originator is retained for each record.')
PAGE_SIZE = 500
MAX_FEATURES = 150000
MAX_BODY = 12_000_000
MAX_CATALOG_BYTES = 400_000_000
FIELDS = ('objectid,permanentidentifier,name,namealternate,sourceoriginator,trailtype,'
          'hikerpedestrian,nationaltraildesignation,lengthmiles,seasonopen,publisheddate,'
          'sourceeditdate,routetype')


DEADLINE = None


def get(params):
    request = urllib.request.Request(BASE + '/query?' + urllib.parse.urlencode(params), headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    for attempt in range(3):
        remaining = DEADLINE - time.monotonic() if DEADLINE is not None else 45
        if remaining <= 0:
            raise TimeoutError('USGS collection time budget exhausted; previous catalog retained')
        try:
            with urllib.request.urlopen(request, timeout=min(45, remaining)) as response:
                if urllib.parse.urlparse(response.url).hostname != 'partnerships.nationalmap.gov':
                    raise ValueError('unexpected USGS service redirect')
                body = response.read(MAX_BODY + 1)
            break
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        delay = 2 ** attempt
        if DEADLINE is not None and time.monotonic() + delay >= DEADLINE:
            raise TimeoutError('USGS retry exceeds collection time budget')
        time.sleep(delay)
    if len(body) > MAX_BODY:
        raise ValueError('USGS response exceeds the 12 MB page budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('USGS trail query failed')
    return result


def clean_text(value, limit=300):
    if not isinstance(value, str):
        return None
    text = ' '.join(value.replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def date_text(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        try:
            return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    return clean_text(value)


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('USGS line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                       for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('USGS geometry is not valid WGS84')
        points.append([round(point[0], 5), round(point[1], 5)])
    stride = max(1, math.ceil(len(points) / 150))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    where = "trailtype = 'Terra Trail' AND hikerpedestrian = 'Y'"
    identity_data = get({'where': where, 'returnIdsOnly': 'true', 'f': 'json'})
    object_ids = identity_data.get('objectIds')
    if not isinstance(object_ids, list) or not object_ids or len(object_ids) > MAX_FEATURES:
        raise ValueError('USGS object ID response is empty or exceeds the 150,000 record budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids):
        raise ValueError('USGS object IDs are invalid')
    if len(set(object_ids)) != len(object_ids):
        raise ValueError('USGS object IDs are not unique')
    object_ids = sorted(object_ids)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    routes = []
    withheld = {}
    for start in range(0, len(object_ids), PAGE_SIZE):
        batch = object_ids[start:start + PAGE_SIZE]
        page = get({
            'objectIds': ','.join(str(value) for value in batch),
            'outFields': FIELDS,
            'returnGeometry': 'true',
            'outSR': '4326',
            'maxAllowableOffset': '0.0002',
            'geometryPrecision': '5',
            'f': 'json',
        })
        features = page.get('features')
        if not isinstance(features, list) or len(features) != len(batch):
            raise ValueError(f'USGS page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('objectid') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('USGS page has missing, unexpected, or duplicate IDs')
            found.add(object_id)
            if attrs.get('trailtype') != 'Terra Trail' or attrs.get('hikerpedestrian') != 'Y':
                raise ValueError('USGS page returned a record outside the pedestrian filter')
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(paths, list) or not paths:
                withheld['missing-line-geometry'] = withheld.get('missing-line-geometry', 0) + 1
                continue
            if len(paths) > 50:
                withheld['geometry-over-budget'] = withheld.get('geometry-over-budget', 0) + 1
                continue
            try:
                reference_paths = [simplify(path) for path in paths]
            except ValueError:
                withheld['invalid-line-geometry'] = withheld.get('invalid-line-geometry', 0) + 1
                continue
            points = [point for path in reference_paths for point in path]
            if len(points) > 15000:
                withheld['geometry-over-budget'] = withheld.get('geometry-over-budget', 0) + 1
                continue
            name = clean_text(attrs.get('name')) or clean_text(attrs.get('namealternate'))
            if not name:
                name = f'未命名步道 {object_id}'
            originator = clean_text(attrs.get('sourceoriginator')) or '来源机构未注明'
            center = [round(sum(point[index] for point in points) / len(points), 5) for index in (0, 1)]
            length = attrs.get('lengthmiles')
            routes.append({
                'id': f'usgs-trail-{object_id}',
                'name': name,
                'region': f'美国·{originator}',
                'center': center,
                'status': '待核验',
                'sourceUrl': BASE,
                'fetchedAt': now,
                'sourceTags': {
                    'sourceOriginator': originator,
                    'sourceObjectId': str(object_id),
                    'sourcePermanentIdentifier': clean_text(attrs.get('permanentidentifier')),
                    'trailType': clean_text(attrs.get('trailtype')),
                    'hikerPedestrian': clean_text(attrs.get('hikerpedestrian')),
                    'nationalTrailDesignation': clean_text(attrs.get('nationaltraildesignation')),
                    'lengthMiles': str(length) if isinstance(length, (int, float)) and math.isfinite(length) else None,
                    'seasonOpen': clean_text(attrs.get('seasonopen')),
                    'sourcePublishedAt': date_text(attrs.get('publisheddate')),
                    'sourceEditedAt': date_text(attrs.get('sourceeditdate')),
                    'routeType': clean_text(attrs.get('routetype')),
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'USGS page {start // PAGE_SIZE} did not return all requested IDs')
        print(f'USGS hiking references {len(routes)} / {len(object_ids)}', flush=True)
    if len(routes) + sum(withheld.values()) != len(object_ids):
        raise ValueError('USGS source response did not account for every requested ID; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('usgs-trail-')))
    return {
        'schemaVersion': 1,
        'generatedAt': now,
        'sourceUrl': BASE,
        'license': 'USGS public-domain aggregate; source originator retained',
        'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL,
        'sourceFeatureCount': len(object_ids),
        'catalogRouteCount': len(routes),
        'withheldRecords': sum(withheld.values()),
        'withheldReasons': withheld,
        'routeStatusPolicy': f'All routes stay 待核验. {len(routes)} of {len(object_ids)} USGS Terra Trail pedestrian IDs have usable line geometry; {sum(withheld.values())} rows were withheld with reasons recorded. USGS public-domain aggregation and source activity labels do not prove current access, permission, safety, or navigability. Original source originator is retained.',
        'routes': routes,
    }


def main():
    global DEADLINE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, help='New candidate file; never overwrites an existing candidate')
    parser.add_argument('--max-seconds', type=int, default=1200)
    args = parser.parse_args()
    if not 60 <= args.max_seconds <= 3600:
        parser.error('max-seconds must be between 60 and 3600')
    if args.output and args.output.exists():
        raise FileExistsError('Candidate output exists; preserve it and choose a new path')
    DEADLINE = time.monotonic() + args.max_seconds
    result = collect()
    payload = (json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    if len(payload) > MAX_CATALOG_BYTES:
        raise ValueError('USGS catalog exceeds the 400 MB source budget; previous catalog retained')
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as stream:
            stream.write(payload)
        print(f'Wrote discovery candidate only: {len(result["routes"])} references; no publication', flush=True)
        return
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=TARGET.parent, prefix=TARGET.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(payload)
        temporary = pathlib.Path(handle.name)
    try:
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Collected {len(result["routes"])} USGS discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
