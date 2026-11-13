#!/usr/bin/env python3
"""Collect Victoria's official walking-track references as discovery data only."""
import datetime as dt
import json
import math
import os
from pathlib import Path
import tempfile
import urllib.parse
import urllib.request

ENDPOINT = 'https://opendata.maps.vic.gov.au/geoserver/wfs'
DATASET_URL = 'https://discover.data.vic.gov.au/dataset/recreation-tracks'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
ATTRIBUTION = ('Contains Victorian Government data from Recreation Tracks, Department of Energy, '
               'Environment and Climate Action. Licensed under CC BY 4.0.')
LAYER = 'open-data-platform:recweb_tracks'
TARGET = Path(__file__).resolve().parents[1] / 'shared/data/catalog/victoria-recreation-tracks.json'
PAGE_SIZE = 100
MAX_FEATURES = 2000
MAX_BODY = 24_000_000


def get_page(start):
    params = {
        'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature',
        'typeNames': LAYER, 'count': PAGE_SIZE, 'startIndex': start,
        'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
    }
    url = ENDPOINT + '?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'application/geo+json, application/json',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        parsed = urllib.parse.urlparse(response.url)
        if (parsed.scheme != 'https' or parsed.hostname != 'opendata.maps.vic.gov.au'
                or parsed.port or parsed.username or parsed.password):
            raise ValueError('unexpected Victorian WFS redirect')
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise ValueError('Victorian WFS response exceeds source budget')
    data = json.loads(body)
    features = data.get('features') if isinstance(data, dict) else None
    if data.get('type') != 'FeatureCollection' or not isinstance(features, list):
        raise ValueError('Victorian WFS response is not a FeatureCollection')
    matched = data.get('numberMatched')
    returned = data.get('numberReturned', len(features))
    if isinstance(matched, bool) or not isinstance(matched, int) or not 0 < matched <= MAX_FEATURES:
        raise ValueError('Victorian WFS matched count is invalid or exceeds safety limit')
    if returned != len(features):
        raise ValueError('Victorian WFS returned count does not match feature count')
    return matched, features


def clean(value, limit=300):
    if value is None:
        return None
    if isinstance(value, (dict, list, bool)):
        raise ValueError('Victorian source property has an unsupported value')
    text = str(value).strip()
    if len(text) > limit:
        return text[:limit]
    return text or None


def simplify(raw):
    if not isinstance(raw, list) or len(raw) < 2:
        raise ValueError('line has fewer than two vertices')
    points = []
    for point in raw:
        if (not isinstance(point, list) or len(point) < 2
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                       for v in point[:2])
                or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('geometry is not finite WGS84')
        points.append([round(point[0], 6), round(point[1], 6)])
    stride = max(1, math.ceil(len(points) / 150))
    result = points[::stride]
    if result[-1] != points[-1]:
        result.append(points[-1])
    return result


def collect():
    first_count, first = get_page(0)
    all_features = list(first)
    for start in range(PAGE_SIZE, first_count, PAGE_SIZE):
        matched, page = get_page(start)
        if matched != first_count or len(page) != min(PAGE_SIZE, first_count - start):
            raise ValueError('Victorian WFS pages are incomplete or changed during collection')
        all_features.extend(page)
    if len(all_features) != first_count:
        raise ValueError('Victorian WFS response does not reconcile with numberMatched')

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    seen, walking, routes, withheld = set(), [], [], {}
    for feature in all_features:
        props = feature.get('properties') if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            raise ValueError('Victorian WFS feature has no properties')
        identity = clean(props.get('serial_no'), 80)
        if not identity or identity in seen:
            raise ValueError('Victorian track IDs are missing or duplicated')
        seen.add(identity)
        if clean(props.get('w_activity')) != 'Y':
            continue
        walking.append((identity, props, feature.get('geometry')))

    for identity, props, geometry in walking:
        name = clean(props.get('name'), 160)
        if not name:
            withheld['unnamed-source-feature'] = withheld.get('unnamed-source-feature', 0) + 1
            continue
        kind = geometry.get('type') if isinstance(geometry, dict) else None
        coords = geometry.get('coordinates') if isinstance(geometry, dict) else None
        if kind == 'LineString':
            raw_paths = [coords]
        elif kind == 'MultiLineString':
            raw_paths = coords
        else:
            withheld['unsupported-geometry'] = withheld.get('unsupported-geometry', 0) + 1
            continue
        if not isinstance(raw_paths, list) or not raw_paths or len(raw_paths) > 100:
            raise ValueError(f'Victorian named walking track {identity} has an invalid path count')
        try:
            paths = [simplify(path) for path in raw_paths]
        except ValueError as error:
            raise ValueError(f'Victorian named walking track {identity} has invalid line geometry') from error
        points = [point for path in paths for point in path]
        if len(points) > 15000:
            withheld['geometry-over-budget'] = withheld.get('geometry-over-budget', 0) + 1
            continue
        tags = {
            'assetClass': clean(props.get('asset_class')),
            'maintainedBy': clean(props.get('maintained_by')),
            'walkingActivity': clean(props.get('w_activity')),
            'walkingComment': clean(props.get('w_comment')),
            'walkingGrade': clean(props.get('w_grade')),
            'walkingDistance': clean(props.get('w_distance')),
            'walkingDistanceUnit': clean(props.get('w_dist_unit')),
            'walkingDuration': clean(props.get('w_duration')),
            'walkingDurationUnit': clean(props.get('w_dur_unit')),
            'closureStatus': clean(props.get('closure_status')),
            'closureReason': clean(props.get('closure_reason')),
            'sourceEditedAt': clean(props.get('edit_date')),
        }
        center = [round(sum(p[i] for p in points) / len(points), 6) for i in (0, 1)]
        routes.append({
            'id': f'vic-recreation-track-{identity}', 'name': name,
            'region': '澳大利亚·维多利亚州', 'center': center,
            'status': '待核验', 'sourceUrl': ENDPOINT, 'fetchedAt': now,
            'sourceTags': tags, 'referencePaths': paths,
        })
    routes.sort(key=lambda row: row['id'])
    if len(routes) + sum(withheld.values()) != len(walking):
        raise ValueError('Victorian walking records do not reconcile; previous catalog retained')
    return {
        'schemaVersion': 1, 'generatedAt': now, 'sourceUrl': ENDPOINT,
        'datasetUrl': DATASET_URL,
        'license': 'Creative Commons Attribution 4.0 International',
        'attribution': ATTRIBUTION, 'licenseUrl': LICENSE_URL,
        'sourceFeatureCount': len(walking), 'catalogRouteCount': len(routes),
        'withheldRecords': sum(withheld.values()), 'withheldReasons': withheld,
        'excludedNonWalkingRecords': first_count - len(walking),
        'routeStatusPolicy': ('All records remain 待核验. The Victorian source identifies walking activity but its '
            'track geometry and closure fields do not establish current public access, opening status, '
            'route completeness, or navigation suitability. Check the managing authority before travel; '
            'simplified reference lines are not navigation guidance.'),
        'routes': routes,
    }


def main():
    result = collect()
    payload = (json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=TARGET.parent, prefix=TARGET.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    os.replace(temporary, TARGET)
    print(f"Victoria walking references: {len(result['routes'])}/{result['sourceFeatureCount']} walking features; "
          f"withheld={result['withheldRecords']}; excluded non-walking={result['excludedNonWalkingRecords']}")


if __name__ == '__main__':
    main()
