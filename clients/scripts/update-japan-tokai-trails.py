#!/usr/bin/env python3
"""Refresh official Tokai Nature Trail GPX references from Japan's MOE.

This feed is discovery/reference material. The official notice warns of
remaining positional error and says it does not supply detours around closures.
The reduced lines are therefore never treated as live access or navigation.
"""
import datetime as dt
import html.parser
import json
import math
import os
import pathlib
import re
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'shared/data/catalog/japan-tokai-trails.json'
SOURCE_URL = 'https://www.env.go.jp/nature/long-trail.html'
LICENSE_URL = 'https://www.env.go.jp/mail.html'
PDL_URL = 'https://www.digital.go.jp/resources/open_data/public_data_license_v1.0'
ATTRIBUTION = '出典：環境省「東海自然歩道GPSデータ」；環境省ウェブサイト内容使用条件 PDL1.0。线路参考由徒步地球抽稀整理；原始数据由相关都府县协作提供。'
MAX_HTML = 2_000_000
MAX_ZIP = 5_000_000
MAX_GPX = 10_000_000
MAX_TRACKS = 150
MAX_TOTAL_POINTS = 14_000


class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []
        self.anchor = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'a':
            self.anchor = {'href': dict(attrs).get('href', ''), 'text': []}

    def handle_data(self, data):
        if self.anchor is not None:
            self.anchor['text'].append(data)

    def handle_endtag(self, tag):
        if tag.lower() == 'a' and self.anchor is not None:
            self.found.append(self.anchor)
            self.anchor = None


def download(url, budget, accepted_hosts):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'HikingEarth/0.2 (+https://github.com/hiking-earth/clients)',
        'Accept': 'text/html,application/zip,application/octet-stream,*/*;q=0.5',
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        parsed = urllib.parse.urlparse(response.url)
        if parsed.scheme != 'https' or parsed.hostname not in accepted_hosts or parsed.port or parsed.username or parsed.password:
            raise ValueError('unexpected Japan MOE source redirect')
        body = response.read(budget + 1)
    if len(body) > budget:
        raise ValueError('Japan MOE source exceeds its download budget')
    return body


def latest_zip_url():
    document = download(SOURCE_URL, MAX_HTML, {'www.env.go.jp'})
    parser = Links()
    parser.feed(document.decode('utf-8'))
    candidates = []
    for item in parser.found:
        label = unicodedata.normalize('NFKC', ''.join(item['text']))
        href = urllib.parse.urljoin(SOURCE_URL, item['href'])
        parsed = urllib.parse.urlparse(href)
        if ('東海自然歩道GPSデータ' in label and parsed.scheme == 'https'
                and parsed.hostname == 'www.env.go.jp' and parsed.port is None
                and re.fullmatch(r'/content/[0-9]+\.zip', parsed.path)):
            candidates.append(href)
    if len(candidates) != 1:
        raise ValueError('Japan MOE landing page did not identify exactly one official Tokai GPX archive')
    return candidates[0]


def parse_publication_date(readme):
    normalized = unicodedata.normalize('NFKC', readme)
    match = re.search(r'掲載日\s*[:：]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日', normalized)
    if not match:
        raise ValueError('Japan MOE GPX notice has no recognized publication date')
    return dt.date(*(int(value) for value in match.groups())).isoformat()


def simplify(points, limit):
    if len(points) < 2:
        raise ValueError('Japan MOE GPX contains a line with fewer than two points')
    # Reserve one slot for preserving the final source point.
    stride = max(1, math.ceil(len(points) / max(1, limit - 1)))
    reduced = points[::stride]
    if reduced[-1] != points[-1]:
        reduced.append(points[-1])
    return [[round(lon, 6), round(lat, 6)] for lon, lat in reduced]


def collect_archive(archive, archive_url):
    with zipfile.ZipFile(BytesIO(archive)) as package:
        gpx_members = [entry for entry in package.infolist()
                       if not entry.is_dir() and pathlib.PurePosixPath(entry.filename).name == entry.filename
                       and entry.filename.lower().endswith('.gpx')]
        note_members = [entry for entry in package.infolist()
                        if not entry.is_dir() and pathlib.PurePosixPath(entry.filename).name == entry.filename
                        and entry.filename.lower().endswith('.txt')]
        if (len(gpx_members) != 1 or len(note_members) != 1
                or gpx_members[0].file_size > MAX_GPX or note_members[0].file_size > 100_000):
            raise ValueError('Japan MOE archive has an unexpected or oversized file layout')
        readme = package.read(note_members[0]).decode('utf-8-sig')
        publication_date = parse_publication_date(readme)
        root = ET.fromstring(package.read(gpx_members[0]))
    namespace = {'g': 'http://www.topografix.com/GPX/1/1'}
    if root.tag != '{http://www.topografix.com/GPX/1/1}gpx' or root.attrib.get('version') != '1.1':
        raise ValueError('Japan MOE source is not a GPX 1.1 document')
    tracks = []
    source_points = 0
    for track in root.findall('g:trk', namespace):
        paths = []
        track_points = 0
        for segment in track.findall('g:trkseg', namespace):
            points = []
            for point in segment.findall('g:trkpt', namespace):
                lat, lon = point.attrib.get('lat'), point.attrib.get('lon')
                try:
                    lat, lon = float(lat), float(lon)
                except (TypeError, ValueError) as error:
                    raise ValueError('Japan MOE GPX has invalid coordinates') from error
                if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
                    raise ValueError('Japan MOE GPX has coordinates outside WGS84 bounds')
                points.append((lon, lat))
            if points:
                if len(points) < 2:
                    raise ValueError('Japan MOE GPX contains a one-point segment')
                paths.append(points)
                track_points += len(points)
        if paths:
            tracks.append(paths)
            source_points += track_points
    if not tracks or len(tracks) > MAX_TRACKS or source_points < 1000:
        raise ValueError('Japan MOE GPX track count or geometry size is implausible')

    # Keep the three substantial source tracks separate. Group only the many
    # short supplementary tracks, preserving every source path in that record.
    groups = [([0], 'main', '东海自然步道本线')]
    if len(tracks) > 1:
        groups.append(([1], 'supplement-1', '东海自然步道线路补充 1'))
    if len(tracks) > 2:
        groups.append(([2], 'supplement-2', '东海自然步道线路补充 2'))
    if len(tracks) > 3:
        groups.append((list(range(3, len(tracks))), 'supplementary-sections', f'东海自然步道补充区段（{len(tracks) - 3}段）'))

    generated = dt.datetime.now(dt.timezone.utc).isoformat()
    routes = []
    for index, (track_indexes, kind, name) in enumerate(groups, 1):
        source_paths = [path for track_index in track_indexes for path in tracks[track_index]]
        per_path_limit = max(2, min(150, MAX_TOTAL_POINTS // len(source_paths)))
        reference_paths = [simplify(path, per_path_limit) for path in source_paths]
        if sum(map(len, reference_paths)) > MAX_TOTAL_POINTS:
            raise ValueError('Japan MOE reference geometry exceeds its published point budget')
        all_points = [point for path in source_paths for point in path]
        center = [round(sum(point[position] for point in all_points) / len(all_points), 6) for position in (0, 1)]
        routes.append({
            'id': f'japan-tokai-trail-{index}', 'name': name,
            'region': '日本·东海自然步道', 'center': center,
            'sourceUrl': SOURCE_URL, 'fetchedAt': generated, 'status': '待核验',
            'sourceTags': {
                'geometryGroup': kind,
                'sourceTrackCount': len(track_indexes),
                'sourceSegmentCount': len(source_paths),
                'sourcePointCount': len(all_points),
                'sourcePublishedAt': publication_date,
            },
            'referencePaths': reference_paths,
        })
    return {
        'schemaVersion': 1, 'generatedAt': generated, 'sourceUrl': SOURCE_URL,
        'datasetUrl': SOURCE_URL, 'sourceFileUrl': archive_url,
        'sourcePublishedAt': publication_date,
        'sourceTrackCount': len(tracks),
        'sourceSegmentCount': sum(route['sourceTags']['sourceSegmentCount'] for route in routes),
        'sourcePointCount': source_points,
        'license': '日本政府公共数据利用规则 PDL1.0', 'attribution': ATTRIBUTION,
        'licenseUrl': LICENSE_URL, 'publicDataLicenseUrl': PDL_URL,
        'routeStatusPolicy': 'Environment Ministry of Japan published this GPX as GPS-usable Tokai Nature Trail route information and says prefectures cooperated in improving it. Its notice warns residual positional error may remain and says closed sections are not provided with detours. This catalog simplifies the source geometry for discovery display. All records remain 待核验; the simplified lines do not establish current opening, legal access, or safe navigation. Check the Ministry source page and local-government notices before travel.',
        'routes': routes,
    }


def collect():
    archive_url = latest_zip_url()
    archive = download(archive_url, MAX_ZIP, {'www.env.go.jp'})
    return collect_archive(archive, archive_url)


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
    print(f'Collected {sum(route["sourceTrackCount"] for route in result["routes"])} official GPX tracks into {len(result["routes"])} discovery records; all status remains 待核验; {len(payload)} bytes', flush=True)


if __name__ == '__main__':
    main()
