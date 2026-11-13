#!/usr/bin/env python3
"""Merge newer production PBF discoveries into the scheduled collector input.

The regional PBF refresh workflows publish their source catalog on main, while
the six-hour collector runs newer code from the development branch. Merge only
the OSM discovery rows and PBF provenance so a later collector run cannot
publish a freshly timestamped but older route set over production.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'shared/data/catalog/osm.json'
PBF_REPORT = re.compile(r'^docs/release/osm-(africa|asia|europe|south-america|oceania|north-america|central-america|antarctica|china|japan)-pbf-refresh-(\d{4}-\d{2}-\d{2})\.json$')


def parse_time(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label}: missing timestamp')
    try:
        parsed = dt.datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError as error:
        raise ValueError(f'{label}: invalid timestamp') from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f'{label}: timestamp must include timezone')
    return parsed.astimezone(dt.timezone.utc)


def merge_rows(production, current, identity_key, stamp_key, label, preserve_missing_fields=()):
    merged = {}
    for rows, preferred in ((production, False), (current, True)):
        if not isinstance(rows, list):
            raise ValueError(f'{label}: expected a list')
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or not isinstance(row.get(identity_key), str) or not row[identity_key]:
                raise ValueError(f'{label}[{index}]: invalid stable identity')
            identity = row[identity_key]
            stamp = parse_time(row.get(stamp_key), f'{label}[{identity}].{stamp_key}')
            prior = merged.get(identity)
            if prior is None or stamp > prior[0] or (stamp == prior[0] and preferred):
                selected = dict(row)
                if prior is not None:
                    for field in preserve_missing_fields:
                        if field not in selected and field in prior[1]:
                            selected[field] = prior[1][field]
                merged[identity] = (stamp, selected)
            elif prior is not None and prior[1] is not row:
                selected = dict(prior[1])
                for field in preserve_missing_fields:
                    if field not in selected and field in row:
                        selected[field] = row[field]
                merged[identity] = (prior[0], selected)
    return [row for _, row in sorted(merged.values(), key=lambda pair: pair[1][identity_key])]


def report_completion(report):
    runs = report.get('runs') if isinstance(report.get('runs'), list) else []
    last_run = report.get('lastRun') if isinstance(report.get('lastRun'), dict) else (runs[-1] if runs and isinstance(runs[-1], dict) else {})
    return last_run.get('completedAt') or report.get('completedAt') or last_run.get('startedAt') or report.get('startedAt')


def read_production_file(ref, path):
    return subprocess.check_output(['git', 'show', f'{ref}:{path}'], cwd=ROOT)


def import_newer_reports(ref):
    names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', ref, '--', 'docs/release'], cwd=ROOT, text=True).splitlines()
    by_region = {}
    for name in names:
        match = PBF_REPORT.fullmatch(name)
        if match:
            region, date = match.groups()
            if date > by_region.get(region, ('', ''))[0]:
                by_region[region] = (date, name)
    for region, (_, production_path) in by_region.items():
        production = json.loads(read_production_file(ref, production_path))
        candidates = sorted((ROOT / 'docs/release').glob(f'osm-{region}-pbf-refresh-*.json'))
        current = None
        if candidates:
            current = json.loads(candidates[-1].read_text(encoding='utf-8'))
        if current is not None:
            production_stamp = parse_time(report_completion(production), f'{production_path}.completedAt')
            current_stamp = parse_time(report_completion(current), f'{candidates[-1]}.completedAt')
            if production_stamp <= current_stamp:
                continue
        target = ROOT / production_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(read_production_file(ref, production_path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--production-ref', default='origin/main')
    args = parser.parse_args()
    subprocess.check_call(['git', 'fetch', '--no-tags', '--depth=1', 'origin', '+refs/heads/main:refs/remotes/origin/main'], cwd=ROOT)
    production = json.loads(read_production_file(args.production_ref, 'shared/data/catalog/osm.json'))
    current = json.loads(CATALOG.read_text(encoding='utf-8'))
    for field in ('schemaVersion', 'license', 'attribution', 'licenseUrl'):
        if production.get(field) != current.get(field):
            raise ValueError(f'OSM production/current {field} differs; refusing to merge')
    current['routes'] = merge_rows(production.get('routes'), current.get('routes'), 'id', 'fetchedAt', 'OSM routes', ('pbfSources',))
    current['pbfImports'] = merge_rows(production.get('pbfImports', []), current.get('pbfImports', []), 'sourceId', 'importedAt', 'OSM PBF imports')[-200:]
    production_cursors = production.get('sourceCursors') if isinstance(production.get('sourceCursors'), dict) else {}
    current_cursors = current.get('sourceCursors') if isinstance(current.get('sourceCursors'), dict) else {}
    cursors = dict(production_cursors)
    for region, value in current_cursors.items():
        if region not in cursors or parse_time(value, f'current source cursor {region}') >= parse_time(cursors[region], f'production source cursor {region}'):
            cursors[region] = value
    current['sourceCursors'] = cursors
    generated = [parse_time(value, label) for value, label in ((production.get('generatedAt'), 'production generatedAt'), (current.get('generatedAt'), 'current generatedAt'))]
    current['generatedAt'] = max(generated).isoformat().replace('+00:00', 'Z')
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=CATALOG.parent, prefix=CATALOG.name + '.', suffix='.tmp', delete=False) as handle:
        handle.write(json.dumps(current, ensure_ascii=False, indent=2) + '\n')
        temporary = Path(handle.name)
    try:
        os.replace(temporary, CATALOG)
    finally:
        temporary.unlink(missing_ok=True)
    import_newer_reports(args.production_ref)
    print(f"Merged production OSM state: {len(current['routes'])} discovery rows, {len(current['pbfImports'])} PBF provenance rows")


if __name__ == '__main__':
    main()
