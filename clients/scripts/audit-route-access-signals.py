#!/usr/bin/env python3
"""Create a deterministic review queue from route-source closure/access signals.

This is triage only: source tags and text cannot prove current access rights.
It never changes a route's status, geometry, or publication eligibility.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from catalog_sources import PUBLIC_CATALOG_FILES, PUBLIC_CATALOG_LABELS

MAX_REVIEW_ITEMS = 20000
MAX_REVIEW_CANDIDATE_BYTES = 47 * 1024 * 1024
MAX_REVIEW_CHUNK_ITEMS = 100
MAX_REVIEW_CHUNK_BYTES = 1024 * 1024
MAX_REVIEW_MANIFEST_BYTES = 1024 * 1024
MAX_LEGACY_REPORT_ITEMS = 2000
MAX_LEGACY_REPORT_BYTES = 3 * 1024 * 1024
MAX_CATALOG_FILE_BYTES = 128 * 1024 * 1024
MAX_TOTAL_CATALOG_BYTES = 256 * 1024 * 1024
MAX_RECONCILIATION_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_RECONCILIATION_BYTES = 64 * 1024 * 1024
ROUTE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
PBF_REGIONS = ('africa', 'asia', 'europe', 'south-america', 'oceania', 'north-america', 'central-america', 'antarctica', 'china', 'japan')
PBF_REGION_LABELS = {
    'africa': '非洲', 'asia': '亚洲', 'europe': '欧洲', 'south-america': '南美洲',
    'oceania': '大洋洲', 'north-america': '北美洲', 'central-america': '中美洲',
    'antarctica': '南极洲', 'china': '中国', 'japan': '日本',
}
NEGATIVE_TEXT = re.compile(
    r'\b(closed|closure|restricted|prohibited|no access|not permitted|suspended|'
    r'temporarily unavailable|hiking not allowed|cerrad[oa]s?|cierre|prohibid[oa]s?|'
    r'acceso restringido|sin acceso|fermé|fermée|ferme|fermee|fermeture|interdit(?:e|s|es)?|'
    r'accès restreint|accès interdit|geschlossen|gesperrt|sperrung|zugang verboten|'
    r'chiuso|chiusa|chiusura|vietato|vietata|fechado|fechada|proibido|proibida|'
    r'acesso restrito|gesloten|afgesloten|verboden|toegang beperkt|stengt|stängd|avstängd|'
    r'zamknięty|zamknięta|zakaz wstępu)\b|'
    r'закрыт[аоы]?|проход запрещ[её]н|закрыто для прохода|'
    r'关闭|封闭|封閉|禁止通行|禁止進入|禁止进入|限制通行|暂停开放|暫停開放|暂不开放|暫不開放|不允许徒步|不允許徒步|'
    r'通行止め|立入禁止|通行禁止|利用禁止|入山禁止|폐쇄|통행금지|출입금지|접근제한',
    re.IGNORECASE,
)
STATUS_KEYS = re.compile(r'(?:access|foot(?:access)?|clos(?:e|ed|ure)|open|status|restrict(?:ion|ed)?|hiking|pedestrian)', re.I)
FREE_TEXT_SIGNAL_KEYS = {
    'description', 'note', 'notes', 'summary', 'accessnote', 'accessnotes',
    'closurenote', 'closureinfo', 'hikingnote',
}
NEGATIVE_BOOLEAN_KEYS = {'hikingrestricted', 'closed', 'isclosed', 'accessdenied', 'restricted'}
POSITIVE_BOOLEAN_KEYS = {'hikingaccepted', 'pedestrianaccess', 'open', 'isopen'}
NEGATIVE_STATUS_VALUES = {
    'closed', 'restricted', 'prohibited', 'forbidden', 'notpermitted',
    'private', 'blocked', 'denied', 'inactive', 'seasonalclosed',
    'temporarilyclosed', 'underconstruction',
}
LIMITED_ACCESS_KEYS = {'access', 'foot', 'footaccess', 'hikingaccess', 'pedestrianaccess', 'accessrestriction'}
LIMITED_ACCESS_VALUES = {
    'permit', 'customers', 'destination', 'discouraged', 'licence', 'license',
    'forestry', 'agricultural', 'delivery', 'emergency', 'managementonly',
}
NO_ACCESS_KEYS = {'access', 'foot', 'footaccess', 'hikingaccess', 'pedestrianaccess'}
CONDITIONAL_ACCESS_KEYS = {
    'accessconditional', 'footconditional', 'hikingconditional', 'pedestrianaccessconditional',
}
NEGATIVE_BOOLEAN_TEXT_VALUES = {'yes', 'true', '1'}
FALSE_STATUS_VALUES = {'no', 'false', '0'}
ROUTE_STATUS_FIELDS = (
    'status', 'access', 'foot', 'footAccess', 'accessStatus', 'closure', 'closureStatus',
    'restriction', 'hikingAccess', 'pedestrianAccess', 'hikingRestricted',
    'isClosed', 'isOpen', 'open', 'restricted', 'accessDenied',
)
ROUTE_TEXT_FIELDS = (
    'description', 'note', 'notes', 'summary', 'accessNote', 'accessNotes',
    'closureNote', 'closureInfo', 'hikingNote',
)


def _signals(route):
    tags = route.get('sourceTags')
    tags = tags if isinstance(tags, dict) else {}
    fields = dict(tags)
    # Some source adapters normalize restrictions onto the route row rather
    # than preserving them inside sourceTags. Review both representations.
    for field in (*ROUTE_STATUS_FIELDS, *ROUTE_TEXT_FIELDS):
        if field in route:
            fields.setdefault(field, route[field])
    findings = []
    for field, value in fields.items():
        if not isinstance(field, str):
            continue
        key = re.sub(r'[^a-z]', '', field.lower())
        if not STATUS_KEYS.search(field) and key not in FREE_TEXT_SIGNAL_KEYS:
            continue
        if isinstance(value, bool):
            if ((key in NEGATIVE_BOOLEAN_KEYS and value)
                    or (key in POSITIVE_BOOLEAN_KEYS and not value)
                    or (key in {'access', 'foot', 'footaccess', 'hikingaccess'} and not value)):
                findings.append({'field': field, 'value': value, 'reason': 'negative-access-signal'})
            continue
        if isinstance(value, (str, int, float)):
            text = str(value).strip()
            if not text:
                continue
            normalized_value = re.sub(r'[^a-z0-9]', '', text.lower())
            false_means_restricted = (
                key in POSITIVE_BOOLEAN_KEYS
                or key in {'access', 'foot', 'footaccess', 'hikingaccess'}
                or key.startswith('accessstatus')
            )
            affirmative_means_restricted = key in NEGATIVE_BOOLEAN_KEYS
            structured_negative = (
                normalized_value in NEGATIVE_STATUS_VALUES
                or (false_means_restricted and normalized_value in FALSE_STATUS_VALUES)
                or (affirmative_means_restricted and normalized_value in NEGATIVE_BOOLEAN_TEXT_VALUES)
                or (key in LIMITED_ACCESS_KEYS and normalized_value in LIMITED_ACCESS_VALUES)
                or (key in NO_ACCESS_KEYS and normalized_value == 'none')
                or key in CONDITIONAL_ACCESS_KEYS
            )
            if NEGATIVE_TEXT.search(text) or structured_negative:
                findings.append({'field': field, 'value': text[:240], 'reason': 'negative-access-signal'})
    return findings


def _encode_report(report):
    return json.dumps(report, ensure_ascii=False, indent=2) + '\n'


def _canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _read_json_bounded(path, per_file_limit, remaining_total_budget, label):
    limit = min(per_file_limit, remaining_total_budget)
    if limit < 0:
        raise ValueError(f'{label}: remaining input budget is invalid')
    with path.open('rb') as stream:
        payload = stream.read(limit + 1)
    if len(payload) > limit:
        raise ValueError(f'{label}: JSON input exceeds the {limit}-byte read budget')
    try:
        return json.loads(payload.decode('utf-8')), len(payload)
    except UnicodeDecodeError as error:
        raise ValueError(f'{label}: JSON input is not valid UTF-8') from error


def write_chunk_bundle(report, chunks_dir):
    chunks_dir.mkdir(parents=True, exist_ok=True)
    chunks = []
    current = []
    candidate_bytes = 0
    listed_count = 0

    def flush():
        nonlocal current, candidate_bytes
        if not current:
            return
        index = len(chunks)
        encoded = _canonical_json(current)
        payload = encoded.encode('utf-8')
        if len(payload) > MAX_REVIEW_CHUNK_BYTES:
            raise ValueError(f'route review chunk {index} exceeds the byte limit')
        (chunks_dir / f'page-{index:03d}.json').write_bytes(payload)
        chunks.append({'index': index, 'count': len(current), 'bytes': len(payload),
                       'sha256': hashlib.sha256(payload).hexdigest()})
        current = []
        candidate_bytes += len(payload)

    for candidate in report['reviewCandidates']:
        trial = current + [candidate]
        if current and (len(trial) > MAX_REVIEW_CHUNK_ITEMS
                        or len(_canonical_json(trial).encode('utf-8')) > MAX_REVIEW_CHUNK_BYTES):
            flush()
            trial = [candidate]
        if len(_canonical_json(trial).encode('utf-8')) > MAX_REVIEW_CHUNK_BYTES:
            raise ValueError('a route review candidate exceeds the per-chunk byte limit')
        current = trial
        listed_count += 1
    flush()

    manifest = {
        'schemaVersion': 2,
        'generatedAt': report['generatedAt'],
        'policy': report['policy'],
        'sources': report['sources'],
        'reviewCandidateCount': report['reviewCandidateCount'],
        'listedCount': listed_count,
        'reviewCandidatesTruncated': report['reviewCandidateCount'] > listed_count,
        'chunkSize': MAX_REVIEW_CHUNK_ITEMS,
        'chunks': chunks,
        'candidateBytes': candidate_bytes,
    }
    core = _canonical_json(manifest).encode('utf-8')
    manifest['snapshot'] = hashlib.sha256(core).hexdigest()
    encoded_manifest = _canonical_json(manifest).encode('utf-8')
    if len(encoded_manifest) > MAX_REVIEW_MANIFEST_BYTES:
        raise ValueError('route review manifest exceeds the byte limit')
    return manifest


def legacy_report(report):
    candidates = report['reviewCandidates'][:MAX_LEGACY_REPORT_ITEMS]
    result = {**report, 'reviewCandidates': candidates}
    low, high = 0, len(candidates)
    while low < high:
        middle = (low + high + 1) // 2
        result['reviewCandidates'] = candidates[:middle]
        if len(_encode_report(result).encode('utf-8')) <= MAX_LEGACY_REPORT_BYTES:
            low = middle
        else:
            high = middle - 1
    result['reviewCandidates'] = candidates[:low]
    result['reviewCandidatesTruncated'] = report['reviewCandidateCount'] > low
    if len(_encode_report(result).encode('utf-8')) > MAX_LEGACY_REPORT_BYTES:
        raise ValueError('legacy route review report exceeds its byte limit')
    return result


def audit_catalogs(catalog_dir, now=None, reconciliation_dir=None):
    now = now or datetime.now(timezone.utc)
    result = {
        'schemaVersion': 1,
        'generatedAt': now.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'policy': 'discovery-only; no access permission inferred or granted',
        'sources': {},
        'reviewCandidates': [],
        'reviewCandidatesTruncated': False,
    }
    total_flagged = 0
    retained_candidate_bytes = 0
    route_id_sources = {}
    catalog_bytes_read = 0
    for source in sorted(key for key in PUBLIC_CATALOG_FILES if key != 'news'):
        relative = PUBLIC_CATALOG_FILES[source].removeprefix('data/catalog/')
        path = catalog_dir / relative
        data, bytes_read = _read_json_bounded(
            path, MAX_CATALOG_FILE_BYTES,
            MAX_TOTAL_CATALOG_BYTES - catalog_bytes_read, f'{source} catalog',
        )
        catalog_bytes_read += bytes_read
        routes = data.get('routes')
        if not isinstance(routes, list):
            raise ValueError(f'{source}: routes must be a list')
        statuses = Counter()
        flagged = 0
        for row in routes:
            if not isinstance(row, dict):
                raise ValueError(f'{source}: route row must be an object')
            route_id = row.get('id')
            if not isinstance(route_id, str) or not ROUTE_ID.fullmatch(route_id):
                raise ValueError(f'{source}: route id is missing or outside the review API format')
            prior_source = route_id_sources.get(route_id)
            if prior_source is not None:
                raise ValueError(f'duplicate route id {route_id!r} across {prior_source} and {source}')
            route_id_sources[route_id] = source
            statuses[str(row.get('status') or 'missing')] += 1
            signals = _signals(row)
            if not signals:
                continue
            flagged += 1
            total_flagged += 1
            candidate = {
                    'sourceId': source,
                    'sourceLabel': PUBLIC_CATALOG_LABELS.get(source, source),
                    'routeId': row.get('id'),
                    'name': row.get('name'),
                    'region': row.get('region'),
                    'sourceUrl': row.get('sourceUrl'),
                    'findings': signals,
                    'disposition': 'human-review-required',
                }
            candidate_bytes = len(_canonical_json(candidate).encode('utf-8'))
            if (len(result['reviewCandidates']) < MAX_REVIEW_ITEMS
                    and retained_candidate_bytes + candidate_bytes <= MAX_REVIEW_CANDIDATE_BYTES):
                result['reviewCandidates'].append(candidate)
                retained_candidate_bytes += candidate_bytes
        result['sources'][source] = {
            'label': PUBLIC_CATALOG_LABELS.get(source, source),
            'routeCount': len(routes),
            'statusCounts': dict(sorted(statuses.items())),
            'negativeSignalCount': flagged,
            'sourceChangeCount': 0,
            'disposition': 'discovery-only',
        }

    total_source_changes = 0
    reconciliation_bytes_read = 0
    if reconciliation_dir is not None:
        for region in PBF_REGIONS:
            reports = sorted(reconciliation_dir.glob(f'osm-{region}-pbf-refresh-*.json'))
            if not reports:
                continue
            # Retain the latest occurrence of each source membership event across
            # archived refresh reports so an empty later import cannot erase review work.
            candidates_by_event = {}
            for report_path in reports:
                try:
                    refresh, bytes_read = _read_json_bounded(
                        report_path, MAX_RECONCILIATION_FILE_BYTES,
                        MAX_TOTAL_RECONCILIATION_BYTES - reconciliation_bytes_read,
                        f'{report_path} PBF report',
                    )
                    reconciliation_bytes_read += bytes_read
                except (OSError, ValueError) as error:
                    raise ValueError(f'{report_path}: invalid PBF refresh report') from error
                if (not isinstance(refresh, dict) or type(refresh.get('schemaVersion')) is not int
                        or refresh.get('schemaVersion') != 1 or refresh.get('region') != region):
                    raise ValueError(f'{report_path}: PBF refresh report identity is invalid')
                completed_at = refresh.get('completedAt')
                try:
                    completed = datetime.fromisoformat(completed_at.replace('Z', '+00:00'))
                except (AttributeError, TypeError, ValueError) as error:
                    raise ValueError(f'{report_path}: PBF refresh completion time is invalid') from error
                if completed.tzinfo is None:
                    raise ValueError(f'{report_path}: PBF refresh completion time lacks a timezone')
                report_change_time = completed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
                source_rows = refresh.get('sources')
                if not isinstance(source_rows, list):
                    raise ValueError(f'{report_path}: PBF source list is missing')
                # Refresh reports append current source rows to preserved history.
                # Keep evidence from every successful import here: a later failed
                # retry in the same report must not erase an earlier reconciliation.
                for row in source_rows:
                    if not isinstance(row, dict) or not isinstance(row.get('sourceId'), str):
                        raise ValueError(f'{report_path}: PBF source row is invalid')
                    source_id = row['sourceId']
                    has_changes = 'reconciliationChanges' in row
                    changes = row.get('reconciliationChanges')
                    evidence_version = row.get('reconciliationEvidenceVersion')
                    if evidence_version is not None and (type(evidence_version) is not int or evidence_version != 1):
                        raise ValueError(f'{report_path}: PBF reconciliation evidence version is invalid')
                    if (row.get('result') == 'imported' and evidence_version == 1
                            and (not has_changes or not isinstance(changes, list)
                                 or not isinstance(row.get('reconciliationObservedAt'), str))):
                        raise ValueError(f'{report_path}: imported PBF source lacks reconciliation evidence')
                    if evidence_version == 1:
                        if row.get('result') != 'imported':
                            raise ValueError(f'{report_path}: versioned PBF evidence is attached to a non-imported source')
                        try:
                            observed = datetime.fromisoformat(row['reconciliationObservedAt'].replace('Z', '+00:00'))
                        except (AttributeError, TypeError, ValueError) as error:
                            raise ValueError(f'{report_path}: PBF reconciliation observation time is invalid') from error
                        if observed.tzinfo is None:
                            raise ValueError(f'{report_path}: PBF reconciliation observation time lacks a timezone')
                        if observed > completed:
                            raise ValueError(f'{report_path}: PBF reconciliation observation time is after report completion')
                        change_time = observed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
                    else:
                        # Archived v1 reports only carried a report-level time.
                        change_time = report_change_time
                    if row.get('result') != 'imported' and changes:
                        raise ValueError(f'{report_path}: non-imported PBF source contains reconciliation evidence')
                    if not isinstance(changes, list):
                        if has_changes and changes is not None:
                            raise ValueError(f'{report_path}: PBF reconciliation evidence is malformed')
                        continue
                    for change in changes:
                        if not isinstance(change, dict):
                            raise ValueError(f'{report_path}: PBF reconciliation change is malformed')
                        route_id = change.get('routeId')
                        match = re.fullmatch(r'osm-relation-([1-9][0-9]*)', route_id) if isinstance(route_id, str) else None
                        action = change.get('action')
                        expected_url = f"https://www.openstreetmap.org/relation/{match.group(1)}" if match else None
                        relation_id = change.get('osmRelationId')
                        if (not match or not ROUTE_ID.fullmatch(route_id)
                                or type(relation_id) is not int or relation_id != int(match.group(1))
                                or change.get('sourceId') != source_id
                                or change.get('sourceUrl') != expected_url
                                or change.get('previousFetchedAt') is not None
                                  and not isinstance(change.get('previousFetchedAt'), str)
                                or action not in {'source-released', 'catalog-removed'}):
                            raise ValueError(f'{report_path}: PBF reconciliation change is invalid')
                        event_id = (source_id, route_id, action, change.get('previousFetchedAt'))
                        source_key = f'osm-pbf-{region}'
                        label = f"OpenStreetMap Geofabrik · {PBF_REGION_LABELS[region]}"
                        candidate = {
                            'sourceId': source_key,
                            'sourceLabel': label,
                            'routeId': route_id,
                            'name': change.get('previousName') if isinstance(change.get('previousName'), str) else route_id,
                            'region': change.get('previousRegion') if isinstance(change.get('previousRegion'), str) else PBF_REGION_LABELS[region],
                            'sourceUrl': expected_url,
                            'sourceChangeAt': change_time,
                            'findings': [{'field': 'sourceMembership', 'value': action,
                                          'reason': 'source-membership-change'}],
                            'disposition': 'human-review-required',
                        }
                        prior = candidates_by_event.get(event_id)
                        if prior is None or change_time > prior['sourceChangeAt']:
                            candidates_by_event[event_id] = candidate

            if not candidates_by_event:
                continue
            source_key = f'osm-pbf-{region}'
            label = f"OpenStreetMap Geofabrik · {PBF_REGION_LABELS[region]}"
            summary = result['sources'].setdefault(source_key, {
                'label': label, 'routeCount': 0, 'statusCounts': {},
                'negativeSignalCount': 0, 'sourceChangeCount': 0,
                'disposition': 'discovery-only',
            })
            for event_id in sorted(candidates_by_event):
                candidate = candidates_by_event[event_id]
                candidate_bytes = len(_canonical_json(candidate).encode('utf-8'))
                if (len(result['reviewCandidates']) < MAX_REVIEW_ITEMS
                        and retained_candidate_bytes + candidate_bytes <= MAX_REVIEW_CANDIDATE_BYTES):
                    result['reviewCandidates'].append(candidate)
                    retained_candidate_bytes += candidate_bytes
                total_source_changes += 1
                summary['sourceChangeCount'] += 1
                summary['routeCount'] = max(summary['routeCount'], summary['sourceChangeCount'])

    total_candidates = total_flagged + total_source_changes
    result['reviewCandidatesTruncated'] = total_candidates > len(result['reviewCandidates'])
    result['reviewCandidateCount'] = total_candidates
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog-dir', type=Path, default=ROOT / 'shared/data/catalog')
    parser.add_argument('--reconciliation-dir', type=Path, default=ROOT / 'docs/release',
                        help='Directory containing latest regional Geofabrik PBF refresh reports')
    parser.add_argument('--output', type=Path, help='Optional JSON output; stdout is used by default')
    parser.add_argument('--chunks-dir', type=Path, help='Optional directory for bounded route-review page files')
    parser.add_argument('--summary-file', type=Path, help='Optional GitHub Actions job summary path')
    args = parser.parse_args()
    report = audit_catalogs(args.catalog_dir, reconciliation_dir=args.reconciliation_dir)
    manifest = write_chunk_bundle(report, args.chunks_dir) if args.chunks_dir else None
    output_report = manifest if manifest else legacy_report(report)
    encoded = _encode_report(output_report)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding='utf-8')
    else:
        print(encoded, end='')
        print(f"Route access triage: {report['reviewCandidateCount']} candidates; "
          f"listed {len(report['reviewCandidates'])}; discovery publication does not grant access.",
          file=sys.stderr)
    if args.summary_file:
        lines = [
            '### Automatic route risk and source-change review',
            '',
            'Access signals and source membership changes require human review. Source disappearance does not establish closure, legal access, or navigation safety.',
            '',
            '| Source | Discovery records | Access signals | PBF source changes |',
            '|---|---:|---:|---:|',
        ]
        for source, row in report['sources'].items():
            lines.append(f"| {row['label']} | {row['routeCount']} | {row['negativeSignalCount']} | {row['sourceChangeCount']} |")
        lines.extend(['', f"Review candidates total: {report['reviewCandidateCount']}; listed: {len(report['reviewCandidates'])}; chunks: {len(manifest['chunks']) if manifest else 'not generated'}; truncated: {str(report['reviewCandidatesTruncated']).lower()}.", ''])
        args.summary_file.parent.mkdir(parents=True, exist_ok=True)
        with args.summary_file.open('a', encoding='utf-8') as stream:
            stream.write('\n'.join(lines))


if __name__ == '__main__':
    main()
