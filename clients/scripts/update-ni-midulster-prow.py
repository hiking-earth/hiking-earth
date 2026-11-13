#!/usr/bin/env python3
"""Collect Mid Ulster Public Rights of Way as OGL discovery references.

The official linework is simplified for route discovery and display only.
Source status fields are preserved as metadata and never treated as live
opening, safety, or navigation confirmation.
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
TARGET = ROOT / 'shared/data/catalog/ni-midulster-prow.json'
BASE = 'https://services1.arcgis.com/IBPnlgK2X1Ngocds/arcgis/rest/services/PROW/FeatureServer/0'
LICENSE_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'
ATTRIBUTION = 'Contains information licensed under the Open Government Licence v3.0 from OpenDataNI and Mid Ulster District Council. Source: Public Rights of Way.'
PAGE_SIZE = 100
MAX_BODY = 10_000_000
MAX_RECORDS = 5000
FIELDS = 'OBJECTID,STATUS,CONDITION,COUNCIL,DATE,ASSERTED,LOCATION,Length'


def get(params):
    request = urllib.request.Request(BASE + '/query?' + urllib.parse.urlencode(params), headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        parsed = urllib.parse.urlparse(response.url)
        if parsed.scheme != 'https' or parsed.hostname != 'services1.arcgis.com' or parsed.port:
            raise ValueError('unexpected Northern Ireland rights-of-way service redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Northern Ireland public-rights-of-way response exceeds source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('Northern Ireland public-rights-of-way query failed')
    return result


def clean_text(value, limit=300):
    if not isinstance(value, str):
        return None
    value = ' '.join(''.join(' ' if ord(char) < 32 or ord(char) == 127 else char for char in value).split())
    return value[:limit] or None


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('Northern Ireland right-of-way line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                       for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Northern Ireland right-of-way geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 151))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    identities = get({'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'}).get('objectIds')
    if not isinstance(identities, list) or not identities or len(identities) > MAX_RECORDS:
        raise ValueError('Northern Ireland public-rights-of-way identity set is empty or over budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in identities):
        raise ValueError('Northern Ireland public-rights-of-way identity set is invalid')
    if len(set(identities)) != len(identities):
        raise ValueError('Northern Ireland public-rights-of-way IDs are not unique')
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
        if not isinstance(features, list) or len(features) != len(batch):
            raise ValueError(f'Northern Ireland public-rights-of-way page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('OBJECTID') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('Northern Ireland public-rights-of-way page has missing, unexpected, or duplicate IDs')
            found.add(object_id)
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(paths, list) or not paths:
                raise ValueError(f'Northern Ireland public right of way {object_id} has no line geometry')
            reference_paths = [simplify(path) for path in paths]
            points = [point for path in reference_paths for point in path]
            if len(points) > 15_000:
                raise ValueError(f'Northern Ireland public right of way {object_id} exceeds geometry budget')
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            name = clean_text(attrs.get('LOCATION')) or f'公共通行权道路 {object_id}'
            length = attrs.get('Length')
            if isinstance(length, bool) or not isinstance(length, (int, float)) or not math.isfinite(length) or length < 0:
                length = None
            routes.append({
                'id': f'ni-midulster-{object_id}',
                'name': name,
                'region': '英国·北爱尔兰·米德阿尔斯特',
                'center': center,
                'sourceUrl': BASE,
                'fetchedAt': generated,
                'status': '待核验',
                'sourceTags': {
                    'sourceStatus': clean_text(attrs.get('STATUS'), 100),
                    'condition': clean_text(attrs.get('CONDITION'), 100),
                    'council': clean_text(attrs.get('COUNCIL'), 100),
                    'authorityDate': clean_text(attrs.get('DATE'), 50),
                    'asserted': clean_text(attrs.get('ASSERTED'), 20),
                    'lengthM': round(length, 2) if length is not None else None,
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'Northern Ireland public-rights-of-way page {start // PAGE_SIZE} is incomplete')
        print(f'Northern Ireland public rights of way {len(routes)} / {len(identities)}', flush=True)
    if len(routes) != len(identities):
        raise ValueError('Northern Ireland source snapshot is incomplete; prior catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('ni-midulster-')))
    return {
        'schemaVersion': 1,
        'generatedAt': generated,
        'sourceUrl': BASE,
        'license': 'Open Government Licence v3.0',
        'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'These are Mid Ulster public-rights-of-way source records. Source condition and assertion fields are historical/source metadata only; all records remain 待核验 and linework is simplified display reference, not current legal access or navigation guidance.',
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
    print(f'Collected {len(result["routes"])} Northern Ireland public-rights-of-way discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
