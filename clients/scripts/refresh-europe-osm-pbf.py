#!/usr/bin/env python3
"""Refresh bounded Geofabrik Europe country extracts into the OSM discovery catalog.

This is a data collection job, not a route-opening or navigation approval job.
Every imported relation remains pending independent verification.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from pbf_reconciliation import parse_importer_result

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADER = ROOT / 'scripts/download-geofabrik-pbf.py'
IMPORTER = ROOT / 'scripts/import-osm-pbf-catalog.py'
CATALOG = ROOT / 'shared/data/catalog/osm.json'
MAX_SOURCE_BYTES = 1_000_000_000

# Direct, non-aggregate country/territory extracts only. The overlapping Alps,
# DACH, Britain-and-Ireland, Great Britain and UK aggregates are excluded.
# Large country extracts use their official non-overlapping children. French
# overseas territories are intentionally handled as separate global regions.
# Geofabrik lists Nordrhein-Westfalen as 872 MiB (about 914 MB decimal), so the
# Europe-only one-billion-byte cap includes it while still bounding each file.
COUNTRIES = (
    'albania', 'andorra', 'austria', 'azores', 'belarus', 'belgium', 'bosnia-herzegovina',
    'bulgaria', 'croatia', 'cyprus', 'denmark', 'estonia', 'faroe-islands',
    'finland', 'georgia', 'greece', 'guernsey-jersey', 'hungary', 'iceland',
    'ireland-and-northern-ireland', 'isle-of-man', 'kosovo', 'latvia',
    'liechtenstein', 'lithuania', 'luxembourg', 'macedonia', 'malta',
    'moldova', 'monaco', 'montenegro', 'portugal', 'romania', 'serbia',
    'slovakia', 'slovenia', 'sweden', 'switzerland', 'turkey', 'ukraine',
)
SOURCES = {slug: f'https://download.geofabrik.de/europe/{slug}-latest.osm.pbf'
           for slug in COUNTRIES}
SUBREGIONS = {
    'germany': (
        'baden-wuerttemberg', 'bayern', 'brandenburg',
        'hamburg', 'hessen', 'mecklenburg-vorpommern', 'niedersachsen',
        'nordrhein-westfalen',
        'rheinland-pfalz', 'saarland', 'sachsen', 'sachsen-anhalt',
        'schleswig-holstein', 'thueringen',
    ),
    'france': (
        'alsace', 'aquitaine', 'auvergne', 'basse-normandie', 'bourgogne',
        'bretagne', 'centre', 'champagne-ardenne', 'corse', 'franche-comte',
        'guadeloupe', 'guyane', 'haute-normandie', 'ile-de-france',
        'languedoc-roussillon', 'limousin', 'lorraine', 'martinique',
        'mayotte', 'midi-pyrenees', 'nord-pas-de-calais', 'pays-de-la-loire',
        'picardie', 'poitou-charentes', 'provence-alpes-cote-d-azur',
        'reunion', 'rhone-alpes',
    ),
    'spain': (
        'andalucia', 'aragon', 'asturias', 'cantabria', 'castilla-la-mancha',
        'castilla-y-leon', 'cataluna', 'ceuta', 'extremadura', 'galicia',
        'islas-baleares', 'la-rioja', 'madrid', 'melilla', 'murcia',
        'navarra', 'pais-vasco', 'valencia',
    ),
    'russia': (
        # Geofabrik marks Kaliningrad as a potentially overlapping special
        # extract and says Crimea is already included in the Ukraine PBF.
        'central-fed-district', 'far-eastern-fed-district',
        'north-caucasus-fed-district',
        'northwestern-fed-district', 'siberian-fed-district', 'south-fed-district',
        'ural-fed-district', 'volga-fed-district',
    ),
    'czech-republic': (
        'jihocesky', 'jihomoravsky', 'karlovarsky', 'kralovehradecky',
        'liberecky', 'moravskoslezky', 'olomoucky', 'pardubicky',
        'plzensky', 'praha', 'stredocesky', 'ustecky', 'vysocina', 'zlinsky',
    ),
    'netherlands': (
        'drenthe', 'flevoland', 'friesland', 'gelderland', 'groningen',
        'limburg', 'noord-brabant', 'noord-holland', 'overijssel', 'utrecht',
        'zeeland', 'zuid-holland',
    ),
    'poland': (
        'dolnoslaskie', 'kujawsko-pomorskie', 'lodzkie', 'lubelskie',
        'lubuskie', 'malopolskie', 'mazowieckie', 'opolskie', 'podkarpackie',
        'podlaskie', 'pomorskie', 'slaskie', 'swietokrzyskie',
        'warminsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie',
    ),
    # Official Geofabrik children are disjoint; parent country extracts are
    # deliberately not included for these source sets.
    'italy': ('centro', 'isole', 'nord-est', 'nord-ovest', 'sud'),
    'norway': (
        'nord-norge', 'ostlandet', 'sorlandet', 'svalbard-janmayen',
        'trondelag', 'vestlandet',
    ),
    # Great Britain is split at the official Geofabrik leaf level. England's
    # parent extract exceeds the free single-file cap, so use its listed areas.
    'united-kingdom': (
        'scotland', 'wales',
        'england/bedfordshire', 'england/berkshire', 'england/bristol',
        'england/buckinghamshire', 'england/cambridgeshire', 'england/cheshire',
        'england/cornwall', 'england/cumbria', 'england/derbyshire',
        'england/devon', 'england/dorset', 'england/durham',
        'england/east-sussex', 'england/east-yorkshire-with-hull',
        'england/essex', 'england/gloucestershire', 'england/greater-london',
        'england/greater-manchester', 'england/hampshire',
        'england/herefordshire', 'england/hertfordshire', 'england/isle-of-wight',
        'england/kent', 'england/lancashire', 'england/leicestershire',
        'england/lincolnshire', 'england/merseyside', 'england/norfolk',
        'england/north-yorkshire', 'england/northamptonshire',
        'england/northumberland', 'england/nottinghamshire', 'england/oxfordshire',
        'england/rutland', 'england/shropshire', 'england/somerset',
        'england/south-yorkshire', 'england/staffordshire', 'england/suffolk',
        'england/surrey', 'england/tyne-and-wear', 'england/warwickshire',
        'england/west-midlands', 'england/west-sussex', 'england/west-yorkshire',
        'england/wiltshire', 'england/worcestershire',
    ),
}
for country, regions in SUBREGIONS.items():
    for region in regions:
        key = f'{country}/{region}'
        base = f'europe/{country}' if country != 'russia' else 'russia'
        SOURCES[key] = f'https://download.geofabrik.de/{base}/{region}-latest.osm.pbf'


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
        tail = ''.join(output)[-2000:]
        raise RuntimeError(f'command exited {result}: {Path(command[1]).name}\n{tail}')
    return ''.join(output)


def imported_record(source_id):
    data = json.loads(CATALOG.read_text(encoding='utf-8'))
    return next((row for row in data.get('pbfImports', [])
                 if row.get('sourceId') == source_id), None)


def catalog_state():
    raw = CATALOG.read_bytes()
    data = json.loads(raw)
    routes = {row['id']: row for row in data.get('routes', [])}
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'routes': routes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', action='append', choices=tuple(SOURCES),
                        help='Refresh one source; repeat to select several. Defaults to all bounded sources.')
    parser.add_argument('--source-set', choices=('all', 'subregions', *SUBREGIONS), default='all',
                        help='Refresh all sources, one country subdivision set, or all subdivisions.')
    parser.add_argument('--batch-size', type=int,
                        help='Refresh up to this many least-recently-attempted sources; incompatible with explicit selection.')
    parser.add_argument('--downloader-python', default=sys.executable)
    parser.add_argument('--importer-python', default=sys.executable)
    parser.add_argument('--output-dir', type=Path,
                        default=Path(tempfile.gettempdir()) / 'hiking-earth-europe-pbf')
    args = parser.parse_args()
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.source and args.source_set != 'all':
        parser.error('--source and --source-set cannot be combined')
    if args.batch_size is not None and (not 1 <= args.batch_size <= 25 or args.source or args.source_set != 'all'):
        parser.error('--batch-size must be 1–25 and cannot be combined with --source or --source-set')
    if args.source:
        selected = args.source
    elif args.source_set == 'all':
        selected = list(SOURCES)
    elif args.source_set == 'subregions':
        selected = [source for source in SOURCES if '/' in source]
    else:
        selected = [source for source in SOURCES if source.startswith(args.source_set + '/')]
    if args.batch_size is not None:
        latest_attempt = {}
        for prior_path in sorted((ROOT / 'docs/release').glob('osm-europe-pbf-refresh-*.json')):
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
        selected = sorted(SOURCES, key=lambda slug: (
            latest_attempt.get(f'europe/{slug}', ''), slug
        ))[:args.batch_size]
    before_catalog = catalog_state()
    report_path = ROOT / 'docs/release' / f'osm-europe-pbf-refresh-{dt.datetime.now(dt.timezone.utc):%Y-%m-%d}.json'
    old_sources, old_runs = [], []
    if report_path.is_file():
        try:
            previous = json.loads(report_path.read_text(encoding='utf-8'))
            if previous.get('schemaVersion') == 1 and previous.get('region') == 'europe':
                old_sources = previous.get('sources', [])
                old_runs = previous.get('runs', [])
                if previous.get('startedAt'):
                    if not any(run.get('startedAt') == previous.get('startedAt') for run in old_runs):
                        old_runs.append(previous.get('lastRun') or {key: previous.get(key) for key in
                                         ('startedAt', 'completedAt', 'successCount', 'failureCount')})
        except (OSError, json.JSONDecodeError):
            old_sources, old_runs = [], []
    report = {'schemaVersion': 1, 'startedAt': utc_now(), 'region': 'europe',
              'sourcePage': 'https://download.geofabrik.de/europe.html',
              'sourceLicense': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors',
              'sourceByteCap': MAX_SOURCE_BYTES, 'sources': []}
    failures = 0

    for slug in selected:
        source_id, url = f'europe/{slug}', SOURCES[slug]
        source_name = slug.replace('/', '-')
        pbf = output_dir / f'{source_name}-latest.osm.pbf'
        row = {'sourceId': source_id, 'sourceUrl': url,
               'sourcePage': url.replace('-latest.osm.pbf', '.html'),
               'sourceByteCap': MAX_SOURCE_BYTES, 'startedAt': utc_now()}
        print(f'\n### {source_id}', flush=True)
        try:
            run([args.downloader_python, str(DOWNLOADER), '--url', url,
                 '--output', str(pbf), '--max-bytes', str(MAX_SOURCE_BYTES),
                 '--workers', '2', '--chunk-mib', '8', '--attempts', '3'])
            imported = imported_record(source_id)
            checkpoint = pbf.with_name(pbf.name + '.download.json')
            if imported and imported.get('sha256') and 'reconciliationComplete' in imported and checkpoint.is_file():
                check = json.loads(checkpoint.read_text(encoding='utf-8'))
                if imported['sha256'] == check.get('sha256'):
                    row.update({'result': 'unchanged', 'import': imported})
                    report['sources'].append(row)
                    for suffix in ('', '.download.json', '.lock'):
                        (Path(str(pbf) + suffix) if suffix else pbf).unlink(missing_ok=True)
                    continue
            import_output = run([args.importer_python, str(IMPORTER), '--pbf', str(pbf),
                                 '--region', 'europe', '--source-id', source_id, '--source-url', url,
                                 '--reconcile-source'])
            import_result = parse_importer_result(import_output)
            reconciliation_changes = import_result['reconciliationChanges']
            row.update({'result': 'imported', 'import': imported_record(source_id),
                        'reconciliationEvidenceVersion': 1,
                        'reconciliationObservedAt': utc_now(),
                        'reconciliationChanges': reconciliation_changes})
            for suffix in ('', '.download.json', '.lock'):
                (Path(str(pbf) + suffix) if suffix else pbf).unlink(missing_ok=True)
        except Exception as error:
            if 'No named hiking/foot route relations with direct way members were found' in str(error):
                row.update({'result': 'empty', 'reason': 'no-named-hiking-relations'})
                for suffix in ('', '.download.json', '.lock'):
                    (Path(str(pbf) + suffix) if suffix else pbf).unlink(missing_ok=True)
                report['sources'].append(row)
                print(f'{source_id} has no named hiking relations; no route record is expected', flush=True)
                continue
            failures += 1
            row.update({'result': 'failed', 'error': str(error),
                        'checkpointPreserved': pbf.with_name(pbf.name + '.download.json').exists()})
            print(f'{source_id} failed; other sources will continue: {error}', file=sys.stderr, flush=True)
        report['sources'].append(row)

    report['completedAt'] = utc_now()
    report['failureCount'] = failures
    report['successCount'] = len(selected) - failures
    report['sources'] = old_sources + report['sources']
    after_catalog = catalog_state()
    before_routes = before_catalog['routes']
    after_routes = after_catalog['routes']
    common = before_routes.keys() & after_routes.keys()
    report['catalogDelta'] = {
        'beforeCount': len(before_routes),
        'afterCount': len(after_routes),
        'addedIds': len(after_routes.keys() - before_routes.keys()),
        'removedIds': len(before_routes.keys() - after_routes.keys()),
        'updatedIds': sum(before_routes[key] != after_routes[key] for key in common),
        'beforeSha256': before_catalog['sha256'],
        'afterSha256': after_catalog['sha256'],
    }
    current_run = {
        'startedAt': report['startedAt'],
        'completedAt': report['completedAt'],
        'selectedSourceIds': [f'europe/{slug}' for slug in selected],
        'successCount': report['successCount'],
        'failureCount': failures,
        'catalogDelta': report['catalogDelta'],
    }
    report['runs'] = old_runs + [current_run]
    report['lastRun'] = current_run
    report['aggregateSourceCounts'] = {}
    for source in report['sources']:
        result = source.get('result', 'unknown')
        report['aggregateSourceCounts'][result] = report['aggregateSourceCounts'].get(result, 0) + 1
    latest_by_source = {}
    for source in report['sources']:
        latest_by_source[source.get('sourceId', '')] = source
    report['aggregateLatestSourceCounts'] = {}
    for source in latest_by_source.values():
        result = source.get('result', 'unknown')
        report['aggregateLatestSourceCounts'][result] = report['aggregateLatestSourceCounts'].get(result, 0) + 1
    report['uniqueSourceCount'] = len(latest_by_source)
    report['accessVerified'] = False
    report['note'] = ('Discovery references only. Route opening, legal access, current conditions, '
                      'and navigable geometry require separate evidence and review.')
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'\nReport: {report_path}', flush=True)
    print(f"Sources succeeded: {report['successCount']}; failed: {failures}", flush=True)
    return 1 if failures == len(selected) else 0


if __name__ == '__main__':
    raise SystemExit(main())
