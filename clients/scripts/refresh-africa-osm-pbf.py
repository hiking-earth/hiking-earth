#!/usr/bin/env python3
"""Refresh Africa's official Geofabrik country extracts as OSM discoveries.

Only the non-overlapping country table is used. Every source is checksum-
verified and byte-capped before import. Imports remain discovery-only.
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
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from pbf_reconciliation import parse_importer_result

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADER = ROOT / 'scripts/download-geofabrik-pbf.py'
IMPORTER = ROOT / 'scripts/import-osm-pbf-catalog.py'
CATALOG = ROOT / 'shared/data/catalog/osm.json'
SOURCE_PAGE = 'https://download.geofabrik.de/africa.html'
MAX_SOURCE_BYTES = 900_000_000
MAX_PAGE_BYTES = 2_000_000
HOST = 'download.geofabrik.de'


class PbfLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.table_depth = 0
        self.sources = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table' and attrs.get('id') == 'subregions':
            self.table_depth = 1
        elif self.table_depth:
            if tag == 'table': self.table_depth += 1
            if tag == 'a':
                href = attrs.get('href', '')
                if href.endswith('-latest.osm.pbf'):
                    self.sources.add(href)

    def handle_endtag(self, tag):
        if self.table_depth and tag == 'table':
            self.table_depth -= 1


def valid_url(value):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == 'https' and parsed.hostname == HOST
                and not parsed.username and not parsed.password and parsed.port is None
                and not parsed.query and not parsed.fragment)
    except (TypeError, ValueError):
        return False


def list_sources():
    request = Request(SOURCE_PAGE, headers={'User-Agent': 'HikingEarthPbfFetcher/1.0 (+https://github.com/hiking-earth/clients)'})
    with urlopen(request, timeout=30) as response:
        final_url = response.geturl()
        if not valid_url(final_url):
            raise ValueError('Geofabrik redirected outside its official download host')
        payload = response.read(MAX_PAGE_BYTES + 1)
    if len(payload) > MAX_PAGE_BYTES:
        raise ValueError('Geofabrik Africa source page exceeds the configured size limit')
    html = payload.decode('utf-8')
    start, end = html.find('<table id="subregions"'), html.find('<h3>Special Sub Regions</h3>')
    if start < 0 or end <= start:
        raise ValueError('Geofabrik Africa non-overlapping subregion table was not found')
    parser = PbfLinkParser()
    parser.feed(html[start:end])
    sources = {}
    for href in sorted(parser.sources):
        # Geofabrik's aggregate pages use links relative to the containing
        # region directory (for example africa/algeria-latest...), while the
        # page URL itself ends in .html. Resolve against its directory.
        page_directory = SOURCE_PAGE.rsplit('/', 1)[0] + '/'
        url = urljoin(page_directory, href)
        if not valid_url(url):
            raise ValueError('Geofabrik supplied an unexpected PBF URL')
        filename = urlsplit(url).path.rsplit('/', 1)[-1]
        slug = filename.removesuffix('-latest.osm.pbf')
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
            raise ValueError('Geofabrik supplied an invalid country identifier')
        sources[slug] = url
    if not sources:
        raise ValueError('Geofabrik Africa country table contains no PBF links')
    return sources


def select_batch_sources(sources, latest_attempt, latest_result, batch_size, retry_failed=False):
    eligible = [slug for slug in sources if retry_failed
                or latest_result.get(f'africa/{slug}') != 'failed']
    return sorted(eligible, key=lambda slug: (
        latest_attempt.get(f'africa/{slug}', ''), slug
    ))[:batch_size]


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
    sources = list_sources()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', action='append', choices=tuple(sources),
                        help='Refresh one country extract; repeat to select several. Defaults to all countries.')
    parser.add_argument('--batch-size', type=int,
                        help='Refresh up to this many least-recently-attempted sources; incompatible with --source.')
    parser.add_argument('--retry-failed', action='store_true',
                        help='Allow batch selection to retry sources whose latest recorded attempt failed.')
    parser.add_argument('--downloader-python', default=sys.executable)
    parser.add_argument('--importer-python', default=sys.executable)
    parser.add_argument('--output-dir', type=Path,
                        default=Path(tempfile.gettempdir()) / 'hiking-earth-africa-pbf')
    args = parser.parse_args()
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.batch_size is not None and (not 1 <= args.batch_size <= 25 or args.source):
        parser.error('--batch-size must be 1–25 and cannot be combined with --source')
    selected = args.source or list(sources)
    if args.batch_size is not None:
        latest_attempt, latest_result = {}, {}
        for prior_path in sorted((ROOT / 'docs/release').glob('osm-africa-pbf-refresh-*.json')):
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
                    latest_result[row['sourceId']] = row.get('result')
        selected = select_batch_sources(
            sources, latest_attempt, latest_result, args.batch_size,
            retry_failed=args.retry_failed,
        )
    before = catalog_state()
    report_path = ROOT / 'docs/release' / f'osm-africa-pbf-refresh-{dt.datetime.now(dt.timezone.utc):%Y-%m-%d}.json'
    old_sources, old_runs = [], []
    if report_path.is_file():
        try:
            prior = json.loads(report_path.read_text(encoding='utf-8'))
            if prior.get('schemaVersion') == 1 and prior.get('region') == 'africa':
                old_sources, old_runs = prior.get('sources', []), prior.get('runs', [])
                if prior.get('startedAt') and not any(run.get('startedAt') == prior.get('startedAt') for run in old_runs):
                    old_runs.append(prior.get('lastRun') or {key: prior.get(key) for key in ('startedAt', 'completedAt', 'successCount', 'failureCount')})
        except (OSError, json.JSONDecodeError):
            old_sources, old_runs = [], []

    report = {'schemaVersion': 1, 'startedAt': utc_now(), 'region': 'africa',
              'sourcePage': SOURCE_PAGE, 'sourceLicense': 'ODbL-1.0',
              'attribution': '© OpenStreetMap contributors',
              'sourceByteCap': MAX_SOURCE_BYTES, 'configuredSourceCount': len(sources), 'sources': []}
    failures = 0
    for slug in selected:
        source_id, url = f'africa/{slug}', sources[slug]
        pbf = output_dir / f'{slug}-latest.osm.pbf'
        row = {'sourceId': source_id, 'sourceUrl': url, 'sourcePage': SOURCE_PAGE,
               'sourceByteCap': MAX_SOURCE_BYTES, 'startedAt': utc_now()}
        print(f'\n### {source_id}', flush=True)
        try:
            run([args.downloader_python, str(DOWNLOADER), '--url', url,
                 '--output', str(pbf), '--max-bytes', str(MAX_SOURCE_BYTES),
                 '--workers', '2', '--chunk-mib', '8', '--attempts', '3'])
            prior = imported_record(source_id)
            checkpoint = pbf.with_name(pbf.name + '.download.json')
            if prior and prior.get('sha256') and 'reconciliationComplete' in prior and checkpoint.is_file():
                if prior['sha256'] == json.loads(checkpoint.read_text(encoding='utf-8')).get('sha256'):
                    row.update({'result': 'unchanged', 'import': prior})
                    report['sources'].append(row)
                    for suffix in ('', '.download.json', '.lock'):
                        (Path(str(pbf) + suffix) if suffix else pbf).unlink(missing_ok=True)
                    continue
            import_output = run([args.importer_python, str(IMPORTER), '--pbf', str(pbf),
                                 '--region', 'africa', '--source-id', source_id, '--source-url', url,
                                 '--reconcile-source'])
            import_result = parse_importer_result(import_output)
            row.update({'result': 'imported', 'import': imported_record(source_id),
                        'reconciliationEvidenceVersion': 1,
                        'reconciliationObservedAt': utc_now(),
                        'reconciliationChanges': import_result['reconciliationChanges']})
            for suffix in ('', '.download.json', '.lock'):
                (Path(str(pbf) + suffix) if suffix else pbf).unlink(missing_ok=True)
        except Exception as error:
            if 'No named hiking/foot route relations with direct way members were found' in str(error):
                row.update({'result': 'empty', 'reason': 'no-named-hiking-relations'})
                for suffix in ('', '.download.json', '.lock'):
                    (Path(str(pbf) + suffix) if suffix else pbf).unlink(missing_ok=True)
                print(f'{source_id} has no named hiking relations; no route record is expected', flush=True)
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
                  'selectedSourceIds': [f'africa/{slug}' for slug in selected],
                  'successCount': report['successCount'], 'failureCount': failures,
                  'catalogDelta': report['catalogDelta']}
    report['lastRun'] = run_record
    report['runs'][-1]['catalogDelta'] = report['catalogDelta']
    report['uniqueSourceCount'] = len(latest)
    report['aggregateLatestSourceCounts'] = counts
    report['accessVerified'] = False
    report['navigableGeometryAdded'] = False
    report['note'] = ('Non-overlapping official country extracts are OSM discovery references only. '
                      'Route opening, legal access, current conditions, and navigable geometry are not verified.')
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'\nReport: {report_path}', flush=True)
    print(f"Sources succeeded: {report['successCount']}; failed: {failures}", flush=True)
    return 1 if failures == len(selected) else 0


if __name__ == '__main__':
    raise SystemExit(main())
