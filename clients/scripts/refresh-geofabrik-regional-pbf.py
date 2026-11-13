#!/usr/bin/env python3
"""Refresh bounded South America or Oceania Geofabrik extracts as OSM discoveries.

Uses only official non-overlapping subregion tables, excludes oversized parent
extracts, and imports complete relation members as pending discovery records.
"""
import argparse
import datetime as dt
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from pbf_reconciliation import parse_importer_result

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADER = ROOT / 'scripts/download-geofabrik-pbf.py'
IMPORTER = ROOT / 'scripts/import-osm-pbf-catalog.py'
CATALOG = ROOT / 'shared/data/catalog/osm.json'
HOSTS = {'download.geofabrik.de', 'download.openstreetmap.fr'}
OSM_FR_CANADA_PAGES = {
    'ontario': 'https://download.openstreetmap.fr/extracts/north-america/canada/ontario/',
    'quebec': 'https://download.openstreetmap.fr/extracts/north-america/canada/quebec/',
}
MAX_SOURCE_BYTES = 900_000_000
MAX_PAGE_BYTES = 2_000_000
REGIONS = {
    'south-america': {
        'page': 'https://download.geofabrik.de/south-america.html',
        'prefix': '/south-america/',
        'children': ('https://download.geofabrik.de/south-america/brazil.html',),
        'skip': {'brazil'},
        'skip_children': set(),
    },
    'oceania': {
        'page': 'https://download.geofabrik.de/australia-oceania.html',
        'prefix': '/australia-oceania/',
        'children': ('https://download.geofabrik.de/australia-oceania/australia.html',),
        'skip': {'australia'},
        # Geofabrik's NSW extract includes ACT and Jervis Bay; don't also import
        # the separately listed ACT extract, which would overlap it.
        'skip_children': {'australia/act'},
    },
    'north-america': {
        'page': 'https://download.geofabrik.de/north-america.html',
        'prefix': '/north-america/',
        'children': (
            'https://download.geofabrik.de/north-america/canada.html',
            'https://download.geofabrik.de/north-america/us.html',
            'https://download.geofabrik.de/north-america/canada/british-columbia.html',
            'https://download.geofabrik.de/north-america/canada/nunavut.html',
            'https://download.geofabrik.de/north-america/us/california.html',
        ),
        'skip': {'canada', 'us'},
        # Split oversized regions where Geofabrik provides non-overlapping
        # children. Ontario and Quebec currently publish no children and stay
        # out of the free-runner job rather than exceeding its per-file cap.
        'skip_children': {
            'canada/british-columbia', 'canada/nunavut', 'canada/ontario',
            'canada/quebec', 'us/california',
        },
    },
    'central-america': {
        'page': 'https://download.geofabrik.de/central-america.html',
        'prefix': '/central-america/',
        'children': (),
        # The parent extract also contains Puerto Rico and the US Virgin
        # Islands, which are already covered by the North America US list.
        # Import the page's non-overlapping country subregions instead.
        'skip': {'central-america'},
        'skip_children': set(),
    },
    'antarctica': {
        'page': 'https://download.geofabrik.de/antarctica.html',
        'prefix': '/',
        'children': (),
        'skip': set(),
        'skip_children': set(),
    },
    'china': {
        'page': 'https://download.geofabrik.de/asia/china.html',
        'prefix': '/asia/',
        'children': (),
        'source_prefix': 'china/',
        # Guangdong's official extract includes Hong Kong and Macao, so keep
        # that complete extract and avoid importing overlapping duplicates.
        'skip': {'hong-kong', 'macao', 'macau'},
        'skip_children': set(),
    },
    'japan': {
        'page': 'https://download.geofabrik.de/asia/japan.html',
        'prefix': '/asia/',
        'children': (),
        'source_prefix': 'japan/',
        'skip': set(),
        'skip_children': set(),
    },
}


class PbfLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.table_depth = 0
        self.links = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table' and attrs.get('id') == 'subregions':
            self.table_depth = 1
        elif self.table_depth:
            if tag == 'table':
                self.table_depth += 1
            if tag == 'a':
                href = attrs.get('href', '')
                if href.endswith('-latest.osm.pbf'):
                    self.links.add(href)
        elif tag == 'a':
            # read_official_page only returns this section when the official
            # page explicitly says that no subregions are defined.
            href = attrs.get('href', '')
            if href.endswith('-latest.osm.pbf'):
                self.links.add(href)

    def handle_endtag(self, tag):
        if self.table_depth and tag == 'table':
            self.table_depth -= 1


class DirectoryPbfLinkParser(HTMLParser):
    """Collect latest-file links from a plain Apache directory index."""
    def __init__(self):
        super().__init__()
        self.links = set()

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        href = dict(attrs).get('href', '')
        if re.fullmatch(r'[a-z0-9]+(?:_[a-z0-9]+)*-latest\.osm\.pbf', href):
            self.links.add(href)

def valid_url(value):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == 'https' and parsed.hostname in HOSTS
                and not parsed.username and not parsed.password and parsed.port is None
                and not parsed.query and not parsed.fragment)
    except (TypeError, ValueError):
        return False


def read_official_page(url):
    request = Request(url, headers={'User-Agent': 'HikingEarthPbfFetcher/1.0 (+https://github.com/hiking-earth/clients)'})
    # Regional source index pages can be slow under shared download limits;
    # use a longer bounded wait so the scheduled refresh does not fail before
    # it can choose the next source batch.
    with urlopen(request, timeout=90) as response:
        if not valid_url(response.geturl()) or urlsplit(response.geturl()).hostname != urlsplit(url).hostname:
            raise ValueError('OSM extract source redirected outside its approved source host')
        payload = response.read(MAX_PAGE_BYTES + 1)
    if len(payload) > MAX_PAGE_BYTES:
        raise ValueError(f'Geofabrik source page exceeds {MAX_PAGE_BYTES} bytes')
    html = payload.decode('utf-8')
    if urlsplit(url).hostname == 'download.openstreetmap.fr':
        return html
    # Some regional pages (notably China) also contain a hidden historical
    # file-index table with the same id before the live subregion table. Start
    # searching after the visible "Sub Regions" heading when it exists.
    heading = html.find('<h3>Sub Regions</h3>')
    start = html.find('<table id="subregions"', heading if heading >= 0 else 0)
    if start < 0:
        no_subregions = 'No sub regions are defined for this region.'
        if heading >= 0 and no_subregions in html[heading:]:
            common = html.find('<h3>Commonly Used Formats</h3>')
            other = html.find('<h3>Other Formats and Auxiliary Files</h3>', common)
            if common >= 0 and other > common:
                return html[common:other]
        raise ValueError(f'Geofabrik subregion table missing: {url}')
    end_candidates = [position for marker in ('<h3>Special Sub Regions</h3>', '</table>')
                      if (position := html.find(marker, start)) >= 0]
    if not end_candidates:
        raise ValueError(f'Geofabrik subregion table end missing: {url}')
    # The first table close is sufficient for table-scoped parsing. The HTML
    # parser still tracks nested tables and will ignore later special groups.
    end = min(end_candidates)
    return html[start:end]


def list_sources(region):
    config = REGIONS[region]
    sources = {}
    pages = (config['page'], *config['children'])
    for page in pages:
        parser = PbfLinkParser()
        parser.feed(read_official_page(page))
        page_directory = page.rsplit('/', 1)[0] + '/'
        for href in sorted(parser.links):
            # Geofabrik pages link from their containing region directory,
            # not from the .html page URL (which would duplicate the region).
            url = urljoin(page_directory, href)
            if not valid_url(url):
                raise ValueError(f'Geofabrik supplied an unexpected PBF URL: {url}')
            path = urlsplit(url).path
            prefix = config['prefix']
            if not path.startswith(prefix):
                raise ValueError(f'Geofabrik link is outside the expected region: {url}')
            source_path = path[len(prefix):].removesuffix('-latest.osm.pbf').strip('/')
            source_prefix = config.get('source_prefix', '')
            if source_prefix and not source_path.startswith(source_prefix):
                raise ValueError(f'Geofabrik link is outside the expected source prefix: {url}')
            slug = source_path[len(source_prefix):] if source_prefix else source_path
            if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*', slug):
                raise ValueError(f'Geofabrik supplied an invalid source identifier: {source_path}')
            if '/' not in slug and slug in config['skip']:
                continue
            if slug in config['skip_children']:
                continue
            if slug in sources:
                raise ValueError(f'Overlapping official tables define duplicate source {slug}')
            sources[slug] = {'url': url, 'page': page}
    if region == 'north-america':
        for area, page in OSM_FR_CANADA_PAGES.items():
            parser = DirectoryPbfLinkParser()
            parser.feed(read_official_page(page))
            for href in sorted(parser.links):
                # The mirror publishes a latest symlink and a checksum for the
                # canonical filename, not for the *-latest alias.
                canonical_href = href.replace('-latest.osm.pbf', '.osm.pbf')
                url = urljoin(page, canonical_href)
                parsed = urlsplit(url)
                expected_prefix = f'/extracts/north-america/canada/{area}/'
                if (not valid_url(url) or parsed.hostname != 'download.openstreetmap.fr'
                        or not parsed.path.startswith(expected_prefix)):
                    raise ValueError(f'OSM France supplied an unexpected Canada PBF URL: {url}')
                source_name = href.removesuffix('-latest.osm.pbf')
                slug = f'canada/{area}/{source_name}'
                if slug in sources:
                    raise ValueError(f'Overlapping official tables define duplicate source {slug}')
                sources[slug] = {'url': url, 'page': page}
    if not sources:
        raise ValueError(f'Geofabrik region contains no bounded extracts: {region}')
    return sources


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def run(command):
    process = subprocess.Popen(command, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, bufsize=1)
    output = []
    assert process.stdout is not None
    for line in process.stdout:
        output.append(line)
        print(line, end='', flush=True)
    result = process.wait()
    if result:
        raise RuntimeError(f'command exited {result}: {Path(command[1]).name}\n{"".join(output)[-2000:]}')
    return ''.join(output)


def imported_record(source_id):
    data = json.loads(CATALOG.read_text(encoding='utf-8'))
    return next((row for row in data.get('pbfImports', []) if row.get('sourceId') == source_id), None)


def catalog_state():
    raw = CATALOG.read_bytes()
    data = json.loads(raw)
    return {'sha256': hashlib.sha256(raw).hexdigest(),
            'routes': {row['id']: row for row in data.get('routes', [])}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', required=True, choices=tuple(REGIONS))
    parser.add_argument('--source', action='append', help='Refresh one discovered source slug; repeat to select several.')
    parser.add_argument('--batch-size', type=int,
                        help='Refresh up to this many least-recently-attempted sources; incompatible with explicit source selection.')
    parser.add_argument('--canada-area', choices=tuple(OSM_FR_CANADA_PAGES),
                        help='Refresh only the selected OSM France provincial subregion directory.')
    parser.add_argument('--downloader-python', default=sys.executable)
    parser.add_argument('--importer-python', default=sys.executable)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    sources = list_sources(args.region)
    if args.batch_size is not None and (not 1 <= args.batch_size <= 25 or args.source or args.canada_area):
        parser.error('--batch-size must be 1–25 and cannot be combined with --source or --canada-area')
    if args.canada_area:
        if args.region != 'north-america' or args.source:
            parser.error('--canada-area requires --region north-america and cannot be combined with --source')
        prefix = f'canada/{args.canada_area}/'
        selected = [slug for slug in sources if slug.startswith(prefix)]
        if not selected:
            parser.error(f'no bounded OSM France sources found for {args.canada_area}')
    elif args.source:
        unknown = sorted(set(args.source) - sources.keys())
        if unknown:
            parser.error(f'unknown source slug(s): {", ".join(unknown)}')
        selected = args.source
    elif args.batch_size is not None:
        latest_attempt = {}
        for prior_path in sorted((ROOT / 'docs/release').glob(f'osm-{args.region}-pbf-refresh-*.json')):
            try:
                prior = json.loads(prior_path.read_text(encoding='utf-8'))
            except (OSError, json.JSONDecodeError):
                continue
            for row in prior.get('sources', []):
                if not isinstance(row, dict) or not isinstance(row.get('sourceId'), str):
                    continue
                stamp = row.get('startedAt')
                if isinstance(stamp, str) and stamp > latest_attempt.get(row['sourceId'], ''):
                    latest_attempt[row['sourceId']] = stamp
        selected = sorted(sources, key=lambda slug: (
            latest_attempt.get(f'{args.region}/{slug}', ''), slug
        ))[:args.batch_size]
    else:
        selected = list(sources)
    output_dir = (args.output_dir or Path(tempfile.gettempdir()) / f'hiking-earth-{args.region}-pbf').expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    before = catalog_state()
    date = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    report_path = ROOT / 'docs/release' / f'osm-{args.region}-pbf-refresh-{date}.json'
    old_sources, old_runs = [], []
    if report_path.is_file():
        try:
            prior = json.loads(report_path.read_text(encoding='utf-8'))
            if prior.get('schemaVersion') == 1 and prior.get('region') == args.region:
                old_sources, old_runs = prior.get('sources', []), prior.get('runs', [])
                if prior.get('startedAt') and not any(run.get('startedAt') == prior.get('startedAt') for run in old_runs):
                    old_runs.append(prior.get('lastRun') or {key: prior.get(key) for key in ('startedAt', 'completedAt', 'successCount', 'failureCount')})
        except (OSError, json.JSONDecodeError):
            old_sources, old_runs = [], []

    report = {'schemaVersion': 1, 'startedAt': utc_now(), 'region': args.region,
              'sourcePage': REGIONS[args.region]['page'], 'sourceLicense': 'ODbL-1.0',
              'attribution': '© OpenStreetMap contributors', 'sourceByteCap': MAX_SOURCE_BYTES,
              'configuredSourceCount': len(sources), 'sources': []}
    failures = 0
    for source_index, slug in enumerate(selected):
        if source_index:
            time.sleep(2)
        source_id, source = f'{args.region}/{slug}', sources[slug]
        pbf = output_dir / (slug.replace('/', '-') + '-latest.osm.pbf')
        row = {'sourceId': source_id, 'sourceUrl': source['url'], 'sourcePage': source['page'],
               'sourceByteCap': MAX_SOURCE_BYTES, 'startedAt': utc_now()}
        print(f'\n### {source_id}', flush=True)
        try:
            run([args.downloader_python, str(DOWNLOADER), '--url', source['url'],
                 '--output', str(pbf), '--max-bytes', str(MAX_SOURCE_BYTES),
                 '--workers', '2', '--chunk-mib', '8', '--attempts', '3'])
            prior = imported_record(source_id)
            checkpoint = pbf.with_name(pbf.name + '.download.json')
            if prior and prior.get('sha256') and 'reconciliationComplete' in prior and checkpoint.is_file():
                if prior['sha256'] == json.loads(checkpoint.read_text(encoding='utf-8')).get('sha256'):
                    row.update({'result': 'unchanged', 'import': prior})
                    report['sources'].append(row)
                    for suffix in ('', '.download.json', '.lock'):
                        candidate = Path(str(pbf) + suffix) if suffix else pbf
                        candidate.unlink(missing_ok=True)
                    continue
            import_output = run([args.importer_python, str(IMPORTER), '--pbf', str(pbf),
                                 '--region', args.region, '--source-id', source_id, '--source-url', source['url'],
                                 '--reconcile-source'])
            import_result = parse_importer_result(import_output)
            row.update({'result': 'imported', 'import': imported_record(source_id),
                        'reconciliationEvidenceVersion': 1,
                        'reconciliationObservedAt': utc_now(),
                        'reconciliationChanges': import_result['reconciliationChanges']})
            for suffix in ('', '.download.json', '.lock'):
                candidate = Path(str(pbf) + suffix) if suffix else pbf
                candidate.unlink(missing_ok=True)
        except Exception as error:
            if 'No named hiking/foot route relations with direct way members were found' in str(error):
                row.update({'result': 'empty', 'reason': 'no-named-hiking-relations'})
                print(f'{source_id} has no named hiking relations; no route record is expected', flush=True)
                for suffix in ('', '.download.json', '.lock'):
                    candidate = Path(str(pbf) + suffix) if suffix else pbf
                    candidate.unlink(missing_ok=True)
            else:
                failures += 1
                row.update({'result': 'failed', 'error': str(error),
                            'checkpointPreserved': pbf.with_name(pbf.name + '.download.json').exists()})
                print(f'{source_id} failed; the previous snapshot is retained: {error}', file=sys.stderr, flush=True)
        report['sources'].append(row)

    report['completedAt'] = utc_now()
    report['failureCount'] = failures
    report['successCount'] = len(selected) - failures
    report['runs'] = old_runs + [{key: report.get(key) for key in ('startedAt', 'completedAt', 'successCount', 'failureCount')}]
    report['sources'] = old_sources + report['sources']
    after = catalog_state()
    before_routes, after_routes = before['routes'], after['routes']
    common = before_routes.keys() & after_routes.keys()
    report['catalogDelta'] = {'beforeCount': len(before_routes), 'afterCount': len(after_routes),
        'addedIds': len(after_routes.keys() - before_routes.keys()),
        'removedIds': len(before_routes.keys() - after_routes.keys()),
        'updatedIds': sum(before_routes[key] != after_routes[key] for key in common),
        'beforeSha256': before['sha256'], 'afterSha256': after['sha256']}
    latest = {}
    for item in report['sources']:
        latest[item.get('sourceId', '')] = item
    counts = {}
    for item in latest.values():
        result = item.get('result', 'unknown')
        counts[result] = counts.get(result, 0) + 1
    run_record = {'startedAt': report['startedAt'], 'completedAt': report['completedAt'],
                  'selectedSourceIds': [f'{args.region}/{slug}' for slug in selected],
                  'successCount': report['successCount'], 'failureCount': failures,
                  'catalogDelta': report['catalogDelta']}
    report['lastRun'] = run_record
    report['runs'][-1]['catalogDelta'] = report['catalogDelta']
    report['uniqueSourceCount'] = len(latest)
    report['aggregateLatestSourceCounts'] = counts
    report['accessVerified'] = False
    report['navigableGeometryAdded'] = False
    report['note'] = ('Official OSM regional extracts are discovery references only. '
                      'Route opening, legal access, current conditions, and navigable geometry are not verified.')
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'\nReport: {report_path}', flush=True)
    print(f"Sources succeeded: {report['successCount']}; failed: {failures}", flush=True)
    return 1 if failures == len(selected) else 0


if __name__ == '__main__':
    raise SystemExit(main())
