#!/usr/bin/env python3
"""Collect Norfolk County Council public-rights-of-way discovery references.

The published lines are indicative interpretations of the Definitive Map,
not exact legal alignments, live access checks, or navigation geometry.
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
TARGET = ROOT / 'shared/data/catalog/norfolk-prow.json'
BASE = 'https://maps.norfolk.gov.uk/arcgis/rest/services/layers_ext/highways/MapServer/2'
LICENSE_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
ATTRIBUTION = 'Contains Norfolk County Council Public Rights of Way data. © Norfolk County Council and © Crown copyright and database rights 2019 Ordnance Survey 100019340. Licensed under Open Government Licence v3.0; source metadata also lists Creative Commons Attribution.'
PAGE_SIZE = 200
MAX_BODY = 8_000_000
MAX_RECORDS = 50_000
FIELDS = 'OBJECTID,NE_UNIQUE,ROAD_NAME,NE_DESCR,ROAD_CLASS,PRIMARY_RO,PARISH,LINKCODE,SECTION_NU,ADMIN_UNIT,DATE_ADOPT'


def get(params):
    request = urllib.request.Request(BASE + '/query?' + urllib.parse.urlencode(params), headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        parsed = urllib.parse.urlparse(response.url)
        if parsed.scheme != 'https' or parsed.hostname != 'maps.norfolk.gov.uk' or parsed.port:
            raise ValueError('unexpected Norfolk rights-of-way service redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Norfolk public-rights-of-way response exceeds source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('Norfolk public-rights-of-way query failed')
    return result


def clean_text(value, limit=300):
    if not isinstance(value, str):
        return None
    value = ' '.join(''.join(' ' if ord(char) < 32 or ord(char) == 127 else char for char in value).split())
    return value[:limit] or None


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('Norfolk right-of-way line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                       for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Norfolk right-of-way geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 151))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    identities = get({'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'}).get('objectIds')
    if not isinstance(identities, list) or not identities or len(identities) > MAX_RECORDS:
        raise ValueError('Norfolk public-rights-of-way identity set is empty or over budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in identities):
        raise ValueError('Norfolk public-rights-of-way identity set is invalid')
    if len(set(identities)) != len(identities):
        raise ValueError('Norfolk public-rights-of-way IDs are not unique')
    identities = sorted(identities)
    generated = dt.datetime.now(dt.timezone.utc).isoformat()
    routes = []
    for start in range(0, len(identities), PAGE_SIZE):
        batch = identities[start:start + PAGE_SIZE]
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
        if not isinstance(features, list) or len(features) != len(batch) or page.get('exceededTransferLimit'):
            raise ValueError(f'Norfolk public-rights-of-way page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('OBJECTID') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('Norfolk public-rights-of-way page has missing, unexpected, or duplicate IDs')
            found.add(object_id)
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(paths, list) or not paths:
                raise ValueError(f'Norfolk public right of way {object_id} has no line geometry')
            reference_paths = [simplify(path) for path in paths]
            if len(reference_paths) > 100:
                raise ValueError(f'Norfolk public right of way {object_id} has too many geometry parts')
            points = [point for path in reference_paths for point in path]
            if len(points) > 15_000:
                raise ValueError(f'Norfolk public right of way {object_id} exceeds geometry budget')
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            name = clean_text(attrs.get('ROAD_NAME')) or clean_text(attrs.get('NE_DESCR')) or f'公共通行权路段 {object_id}'
            routes.append({
                'id': f'norfolk-prow-{object_id}',
                'name': name,
                'region': '英国·英格兰·诺福克',
                'center': center,
                'sourceUrl': BASE,
                'fetchedAt': generated,
                'status': '待核验',
                'sourceTags': {
                    'sourceId': clean_text(attrs.get('NE_UNIQUE'), 100),
                    'pathClass': clean_text(attrs.get('ROAD_CLASS'), 50),
                    'primaryRight': clean_text(attrs.get('PRIMARY_RO'), 50),
                    'parish': clean_text(attrs.get('PARISH'), 100),
                    'linkCode': clean_text(attrs.get('LINKCODE'), 100),
                    'section': clean_text(attrs.get('SECTION_NU'), 50),
                    'administrativeUnit': clean_text(attrs.get('ADMIN_UNIT'), 50),
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'Norfolk public-rights-of-way page {start // PAGE_SIZE} is incomplete')
        print(f'Norfolk public rights of way {len(routes)} / {len(identities)}', flush=True)
    if len(routes) != len(identities):
        raise ValueError('Norfolk source snapshot is incomplete; prior catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('norfolk-prow-')))
    return {
        'schemaVersion': 1,
        'generatedAt': generated,
        'sourceUrl': BASE,
        'license': 'Open Government Licence v3.0; data.gov.uk lists Creative Commons Attribution',
        'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'These are Norfolk public-rights-of-way interpretation records. Approximate linework is not a legal alignment, live access status, complete trail, or navigation guidance; all records remain 待核验.',
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
    print(f'Collected {len(result["routes"])} Norfolk public-rights-of-way discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
