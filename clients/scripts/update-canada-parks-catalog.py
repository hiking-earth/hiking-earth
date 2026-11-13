#!/usr/bin/env python3
"""Collect Parks Canada trail discoveries from its public weekly-updated layer.

The Open Government Licence permits reuse with attribution. The source warns
that coverage is incomplete, so records remain pending discovery references.
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
TARGET = ROOT / 'shared/data/catalog/canada-parks.json'
BASE = 'https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Trails_Sentiers_APCA_V2_FGP/FeatureServer/0'
LICENSE_URL = 'https://open.canada.ca/en/open-government-licence-canada/'
ATTRIBUTION = 'Contains information licensed under the Open Government Licence – Canada. Source: Parks Canada (Trails APCA).'
PAGE_SIZE = 40
MAX_BODY = 20_000_000
FIELDS = 'OBJECTID,Noms_Alt_Names,Name_Official_e,Nom_Officiel_f,Trail_system_reseau_de_sentiers,URL_e,URL_f,Shape__Length'
OFFICIAL_HOSTS = {'pc.gc.ca', 'www.pc.gc.ca', 'parks.canada.ca', 'www.parks.canada.ca'}


def get(params):
    request = urllib.request.Request(BASE + '/query?' + urllib.parse.urlencode(params), headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        if urllib.parse.urlparse(response.url).hostname != 'services2.arcgis.com':
            raise ValueError('unexpected Parks Canada service redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Parks Canada response exceeds 20 MB source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('Parks Canada query failed')
    return result


def clean_text(value, limit=500):
    if not isinstance(value, str):
        return None
    text = ' '.join(value.replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def official_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    parsed = urllib.parse.urlparse(value)
    host = (parsed.hostname or '').lower().rstrip('.')
    if parsed.scheme != 'https' or host not in OFFICIAL_HOSTS or parsed.username or parsed.password or parsed.port:
        return None
    return value


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('Parks Canada line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Parks Canada geometry is not valid WGS84')
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
        raise ValueError('Parks Canada object ID response is empty or exceeds source budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids):
        raise ValueError('Parks Canada object IDs are invalid')
    if len(set(object_ids)) != len(object_ids):
        raise ValueError('Parks Canada object IDs are not unique')
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
            raise ValueError(f'Parks Canada page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('OBJECTID') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('Parks Canada page has missing, unexpected, or duplicate IDs')
            found.add(object_id)
            geometry = feature.get('geometry')
            paths = geometry.get('paths') if isinstance(geometry, dict) else None
            if not isinstance(paths, list) or not paths:
                raise ValueError(f'Parks Canada trail {object_id} has no line geometry')
            reference_paths = [simplify(path) for path in paths]
            points = [point for path in reference_paths for point in path]
            if len(points) > 15000:
                raise ValueError(f'Parks Canada trail {object_id} exceeds reference geometry budget')
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            english = clean_text(attrs.get('Name_Official_e'))
            french = clean_text(attrs.get('Nom_Officiel_f'))
            alternate = clean_text(attrs.get('Noms_Alt_Names'))
            name = english or french or alternate
            if not name:
                raise ValueError(f'Parks Canada trail {object_id} has no usable name')
            length = attrs.get('Shape__Length')
            distance = round(length / 1000, 2) if isinstance(length, (int, float)) and not isinstance(length, bool) and math.isfinite(length) and length > 0 else None
            url_en = official_url(attrs.get('URL_e'))
            url_fr = official_url(attrs.get('URL_f'))
            routes.append({
                'id': f'parkscanada-{object_id}',
                'name': name,
                'region': '加拿大',
                'center': center,
                'sourceUrl': BASE,
                'fetchedAt': now,
                'sourceTags': {
                    'distanceKm': distance,
                    'nameFrench': french,
                    'alternateName': alternate,
                    'trailSystem': clean_text(attrs.get('Trail_system_reseau_de_sentiers')),
                    'officialUrlEn': url_en,
                    'officialUrlFr': url_fr,
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'Parks Canada page {start // PAGE_SIZE} did not return all requested IDs')
        print(f'Parks Canada source rows {len(routes)} / {len(object_ids)}', flush=True)
    if len(routes) != len(object_ids):
        raise ValueError('Parks Canada source was not fully collected; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('parkscanada-')))
    return {
        'schemaVersion': 1,
        'generatedAt': now,
        'sourceUrl': BASE,
        'license': 'Open Government Licence - Canada',
        'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL,
        'routeStatusPolicy': 'All routes stay 待核验. Parks Canada states that the trail dataset is not necessarily complete and is updated weekly.',
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
    print(f'Collected {len(result["routes"])} Parks Canada discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
