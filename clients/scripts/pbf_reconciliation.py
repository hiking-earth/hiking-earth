"""Validate structured per-route evidence emitted by the OSM PBF importer."""
import json
import re

MAX_RECONCILIATION_CHANGE_RECORDS = 10_000


def parse_importer_result(output):
    result = None
    for line in reversed(output.splitlines()):
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict):
            result = candidate
            break
    if result is None or result.get('reconciliationComplete') is not True:
        raise ValueError('PBF importer omitted completed reconciliation evidence')

    changes = result.get('reconciliationChanges')
    removed = result.get('removedRelations')
    released = result.get('releasedRelations')
    if (not isinstance(changes, list) or len(changes) > MAX_RECONCILIATION_CHANGE_RECORDS
            or type(removed) is not int or removed < 0
            or type(released) is not int or released < 0
            or len(changes) != removed + released):
        raise ValueError('PBF importer returned incomplete reconciliation evidence')

    seen = set()
    source_id = result.get('sourceId')
    if not isinstance(source_id, str):
        raise ValueError('PBF importer returned an invalid reconciliation source')
    action_counts = {'catalog-removed': 0, 'source-released': 0}
    for change in changes:
        if not isinstance(change, dict):
            raise ValueError('PBF reconciliation change is malformed')
        route_id = change.get('routeId')
        match = re.fullmatch(r'osm-relation-([1-9][0-9]*)', route_id) if isinstance(route_id, str) else None
        relation_id = change.get('osmRelationId')
        if (not match or type(relation_id) is not int or relation_id != int(match.group(1))
                or change.get('sourceId') != source_id
                or change.get('sourceUrl') != f'https://www.openstreetmap.org/relation/{match.group(1)}'
                or change.get('action') not in action_counts or route_id in seen):
            raise ValueError('PBF reconciliation change is invalid or duplicated')
        seen.add(route_id)
        action_counts[change['action']] += 1
    if action_counts['catalog-removed'] != removed or action_counts['source-released'] != released:
        raise ValueError('PBF reconciliation action counts do not match importer counters')
    return result
