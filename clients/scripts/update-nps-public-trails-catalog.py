#!/usr/bin/env python3
"""Collect NPS public-distribution hiking/pedestrian trail references.

This is a discovery archive only. NPS cautions that GIS data are not legal
documents and may be incomplete or inaccurate. Every record stays 待核验;
the simplified source lines are not navigation tracks.
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
TARGET = ROOT / 'shared/data/catalog/nps-public-trails.json'
BASE = 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0'
DISCLAIMER_URL = 'https://www.nps.gov/subjects/gisandmapping/data-disclaimers.htm'
ATTRIBUTION = 'U.S. National Park Service, Public Trails dataset. NPS public-distribution data; no named layer-specific license. See source and NPS data disclaimer.'
PAGE_SIZE = 100
MAX_FEATURES = 50000
MAX_BODY = 20_000_000
FIELDS = 'OBJECTID,FEATUREID,UNITCODE,UNITNAME,TRLNAME,TRLALTNAME,TRLSTATUS,TRLSURFACE,TRLTYPE,TRLCLASS,TRLUSE,PUBLICDISPLAY,EDITDATE,SOURCEDATE'


def get(params):
    request = urllib.request.Request(BASE + '/query?' + urllib.parse.urlencode(params), headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        if urllib.parse.urlparse(response.url).hostname != 'mapservices.nps.gov':
            raise ValueError('unexpected NPS service redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('NPS response exceeds 20 MB source budget')
    result = json.loads(body)
    if not isinstance(result, dict) or 'error' in result:
        raise ValueError('NPS trail query failed')
    return result


def clean_text(value, limit=300):
    if not isinstance(value, str):
        return None
    text = ' '.join(value.replace('\x00', ' ').split()).strip()
    return text[:limit] or None


def simplify(path):
    if not isinstance(path, list) or len(path) < 2:
        raise ValueError('NPS line has fewer than two vertices')
    points = []
    for point in path:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('NPS geometry is not valid WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 150))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return reduced


def collect():
    # PUBLICDISPLAY is the service's public-map distribution filter. Trail use
    # is only a source label; it does not establish current legal access.
    where = "PUBLICDISPLAY = 'Public Map Display' AND (TRLUSE LIKE '%Hiker%' OR TRLUSE LIKE '%Pedestrian%')"
    identity_data = get({'where': where, 'returnIdsOnly': 'true', 'f': 'json'})
    object_ids = identity_data.get('objectIds')
    if not isinstance(object_ids, list) or not object_ids or len(object_ids) > MAX_FEATURES:
        raise ValueError('NPS object ID response is empty or exceeds source budget')
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in object_ids):
        raise ValueError('NPS object IDs are invalid')
    if len(set(object_ids)) != len(object_ids):
        raise ValueError('NPS object IDs are not unique')
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
            'maxAllowableOffset': '0.00015',
            'geometryPrecision': '6',
            'f': 'json',
        })
        features = page.get('features')
        if not isinstance(features, list) or len(features) != len(batch):
            raise ValueError(f'NPS page {start // PAGE_SIZE} is incomplete')
        found = set()
        for feature in features:
            attrs = feature.get('attributes') if isinstance(feature, dict) else None
            object_id = attrs.get('OBJECTID') if isinstance(attrs, dict) else None
            if object_id not in batch or object_id in found:
                raise ValueError('NPS page has missing, unexpected, or duplicate IDs')
            found.add(object_id)
            trail_use = clean_text(attrs.get('TRLUSE'))
            if attrs.get('PUBLICDISPLAY') != 'Public Map Display' or not trail_use or not any(term in trail_use.lower() for term in ('hiker', 'pedestrian')):
                raise ValueError('NPS page returned a record outside the public hiking/pedestrian filter')
            name = clean_text(attrs.get('TRLNAME')) or clean_text(attrs.get('TRLALTNAME'))
            unit = clean_text(attrs.get('UNITNAME')) or clean_text(attrs.get('UNITCODE')) or '美国国家公园'
            if not name:
                # A unit name plus object ID is not an official trail name.
                withheld['unnamed-source-feature'] = withheld.get('unnamed-source-feature', 0) + 1
                continue
            paths = feature.get('geometry', {}).get('paths') if isinstance(feature.get('geometry'), dict) else None
            if not isinstance(paths, list) or not paths:
                raise ValueError(f'NPS named trail {object_id} has missing line geometry')
            if len(paths) > 100:
                raise ValueError(f'NPS named trail {object_id} has too many geometry parts')
            try:
                reference_paths = [simplify(path) for path in paths]
            except ValueError as error:
                raise ValueError(f'NPS named trail {object_id} has invalid line geometry') from error
            points = [point for path in reference_paths for point in path]
            if len(points) > 15000:
                withheld['geometry-over-budget'] = withheld.get('geometry-over-budget', 0) + 1
                continue
            center = [round(sum(point[index] for point in points) / len(points), 6) for index in (0, 1)]
            routes.append({
                'id': f'nps-trail-{object_id}',
                'name': name,
                'region': f'美国·{unit}',
                'center': center,
                'status': '待核验',
                'sourceUrl': BASE,
                'fetchedAt': now,
                'sourceTags': {
                    'featureId': clean_text(attrs.get('FEATUREID')),
                    'sourceStatus': clean_text(attrs.get('TRLSTATUS')),
                    'surface': clean_text(attrs.get('TRLSURFACE')),
                    'trailType': clean_text(attrs.get('TRLTYPE')),
                    'trailClass': clean_text(attrs.get('TRLCLASS')),
                    'trailUse': trail_use,
                    'sourceEditedAt': clean_text(attrs.get('EDITDATE')),
                    'sourceDate': clean_text(attrs.get('SOURCEDATE')),
                },
                'referencePaths': reference_paths,
            })
        if found != set(batch):
            raise ValueError(f'NPS page {start // PAGE_SIZE} did not return all requested IDs')
        print(f'NPS public trail rows {len(routes)} / {len(object_ids)}', flush=True)
    if len(routes) + sum(withheld.values()) != len(object_ids):
        raise ValueError('NPS source response did not account for every requested ID; previous catalog retained')
    routes.sort(key=lambda row: int(row['id'].removeprefix('nps-trail-')))
    return {
        'schemaVersion': 1,
        'generatedAt': now,
        'sourceUrl': BASE,
        'license': 'U.S. federal public-distribution dataset; no named layer-specific license',
        'attribution': ATTRIBUTION,
        'licenseUrl': DISCLAIMER_URL,
        'sourceFeatureCount': len(object_ids),
        'catalogRouteCount': len(routes),
        'withheldRecords': sum(withheld.values()),
        'withheldReasons': withheld,
        'routeStatusPolicy': f'All routes stay 待核验. {len(routes)} of {len(object_ids)} public IDs have usable line geometry; {sum(withheld.values())} rows were withheld with reasons recorded. Public Map Display and source trail-use labels do not prove current access, permission, safety, or navigability. NPS states these data are not legal documents and provides no accuracy or completeness warranty.',
        'routes': routes,
    }


def main():
    result = collect()
    payload = (json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    if len(payload) > 100_000_000:
        raise ValueError('NPS catalog exceeds the 100 MB published-source budget')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=TARGET.parent, prefix=TARGET.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(payload)
        temporary = pathlib.Path(handle.name)
    try:
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Collected {len(result["routes"])} NPS discovery references; status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
