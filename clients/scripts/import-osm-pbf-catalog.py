#!/usr/bin/env python3
"""Import named hiking route discoveries from a local, reference-complete OSM PBF.

This adds discovery metadata and a bounds-center only. It does not create a
navigable track or infer opening/access status. Source files are never modified.
"""
import argparse
import atexit
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
from importlib.machinery import SourceFileLoader
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "shared/data/catalog/osm.json"
REGIONS = (
    "china", "hong-kong", "macao", "europe", "north-america", "japan",
    "oceania", "south-america", "africa", "central-america", "antarctica",
    "south-asia", "asia",
)
TAG_ALLOWLIST = (
    "distance", "ascent", "descent", "network", "operator", "website",
    "description", "access", "ref", "difficulty", "name:zh",
)
MAX_IMPORT_BYTES = 20 * 1024 * 1024 * 1024
MAX_CATALOG_RECORDS = 250_000
MAX_RECONCILIATION_CHANGE_RECORDS = 10_000
OSM_CATALOG_LOCK = SourceFileLoader(
    "hiking_osm_catalog_lock", str(Path(__file__).with_name("update-route-catalog.py"))
).load_module()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_source_url(value):
    if value is None:
        return True
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username
                and not parsed.password and parsed.port is None and not parsed.query
                and not parsed.fragment)
    except (TypeError, ValueError):
        return False


def validate_reconciliation_receipt(pbf, source_url, pbf_size, digest):
    """Require the pinned downloader's complete, checksum-verified receipt before withdrawals."""
    if not valid_source_url(source_url) or urlsplit(source_url).hostname not in {
            "download.geofabrik.de", "download.openstreetmap.fr"}:
        raise ValueError("Source reconciliation requires a pinned HTTPS extract URL on an approved host")
    receipt_path = pbf.with_name(pbf.name + ".download.json")
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Source reconciliation requires the verified downloader receipt; catalog left unchanged") from exc
    if not isinstance(receipt, dict):
        raise ValueError("Verified downloader receipt is malformed; catalog left unchanged")
    receipt_bytes = receipt.get("bytes")
    chunk_bytes = receipt.get("chunkBytes")
    chunks = receipt.get("chunks")
    if (receipt.get("schemaVersion") != 1
            or receipt.get("downloadStatus") != "verified"
            or receipt.get("url") != source_url
            or type(receipt_bytes) is not int or receipt_bytes != pbf_size
            or receipt.get("sha256") != digest
            or not isinstance(receipt.get("md5"), str) or not re.fullmatch(r"[a-f0-9]{32}", receipt["md5"])
            or not isinstance(receipt.get("verifiedAt"), str) or parse_timestamp(receipt["verifiedAt"]) is None
            or type(chunk_bytes) is not int or chunk_bytes <= 0
            or not isinstance(chunks, dict)):
        raise ValueError("Downloader receipt does not attest this complete PBF snapshot; catalog left unchanged")
    expected_count = (pbf_size + chunk_bytes - 1) // chunk_bytes
    if (set(chunks) != {str(index) for index in range(expected_count)}
            or any(not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value)
                   for value in chunks.values())):
        raise ValueError("Downloader receipt has incomplete chunk verification; catalog left unchanged")


def parse_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo is not None else None


def classify_region(region, lon, lat):
    """Keep PBF imports aligned with the OSM incremental collector labels."""
    if region == "china" and 113.75 <= lon <= 114.55 and 22.05 <= lat <= 22.65:
        return "hong-kong"
    if region == "china" and 113.48 <= lon <= 113.60 and 22.10 <= lat <= 22.26:
        return "macao"
    return region


def valid_pbf_sources(value):
    return (isinstance(value, list)
            and all(isinstance(source, str) and re.fullmatch(r"[a-z0-9][a-z0-9/_-]{0,99}", source)
                    for source in value)
            and len(set(value)) == len(value))


def reconciliation_change(identity, row, source_id, action):
    match = re.fullmatch(r"osm-relation-([1-9][0-9]*)", identity)
    if not match or action not in {"source-released", "catalog-removed"}:
        raise ValueError("Cannot produce traceable evidence for an OSM reconciliation change")
    return {
        "routeId": identity,
        "osmRelationId": int(match.group(1)),
        "action": action,
        "sourceId": source_id,
        "sourceUrl": f"https://www.openstreetmap.org/relation/{match.group(1)}",
        "previousName": row.get("name") if isinstance(row.get("name"), str) else None,
        "previousRegion": row.get("region") if isinstance(row.get("region"), str) else None,
        "previousStatus": row.get("status") if isinstance(row.get("status"), str) else None,
        "previousFetchedAt": row.get("fetchedAt") if isinstance(row.get("fetchedAt"), str) else None,
    }


def append_reconciliation_change(changes, identity, row, source_id, action):
    if len(changes) >= MAX_RECONCILIATION_CHANGE_RECORDS:
        raise ValueError(
            f"Reconciliation would change more than {MAX_RECONCILIATION_CHANGE_RECORDS} records; "
            "catalog left unchanged so the change set can be reviewed in bounded batches")
    changes.append(reconciliation_change(identity, row, source_id, action))


def reject_empty_source_reconciliation(candidates, catalog_rows, source_id):
    if candidates:
        return
    if any(isinstance(row.get("pbfSources"), list) and source_id in row["pbfSources"]
           for row in catalog_rows):
        raise ValueError(
            "Complete extract contains no named hiking relations for a source with existing records; "
            "catalog left unchanged for review")


def valid_catalog(path):
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict) or value.get("schemaVersion") != 1 or not isinstance(value.get("routes"), list):
        raise ValueError("Existing OSM catalog has an unsupported schema; left unchanged")
    identities = set()
    for row in value["routes"]:
        identity = row.get("id") if isinstance(row, dict) else None
        match = re.fullmatch(r"osm-relation-([1-9][0-9]*)", identity) if isinstance(identity, str) else None
        center = row.get("center") if isinstance(row, dict) else None
        tags = row.get("sourceTags") if isinstance(row, dict) else None
        if (not match or identity in identities
                or not isinstance(row.get("name"), str) or not row["name"].strip()
                or not isinstance(row.get("originalName"), str) or not row["originalName"].strip()
                or row.get("region") not in REGIONS
                or not isinstance(center, list) or len(center) != 2
                or any(not isinstance(point, (int, float)) or isinstance(point, bool) or not math.isfinite(point) for point in center)
                or abs(center[0]) > 180 or abs(center[1]) > 90
                or row.get("sourceUrl") != f"https://www.openstreetmap.org/relation/{match.group(1)}"
                or not isinstance(tags, dict) or any(not isinstance(key, str) or not isinstance(tag, str) for key, tag in tags.items())
                or not isinstance(row.get("status"), str) or parse_timestamp(row.get("fetchedAt")) is None
                or ("lastSeenCycle" in row and not isinstance(row["lastSeenCycle"], str))
                or ("pbfSources" in row and not valid_pbf_sources(row["pbfSources"]))):
            raise ValueError("Existing OSM catalog has an invalid route row; left unchanged")
        identities.add(identity)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbf", required=True, type=Path, help="Local .osm.pbf regional extract")
    parser.add_argument("--region", required=True, choices=REGIONS, help="Existing app discovery-region key")
    parser.add_argument("--source-id", required=True, help="Stable extract ID, e.g. china/guangdong")
    parser.add_argument("--source-url", help="Optional HTTPS source URL for the extract")
    parser.add_argument("--reconcile-source", action="store_true",
                        help="Remove this complete extract's attribution from absent records; only applies when every candidate relation is complete")
    parser.add_argument("--catalog", type=Path, default=DEST, help="OSM discovery catalog JSON")
    args = parser.parse_args()

    pbf = args.pbf.expanduser().resolve()
    catalog_path = args.catalog.expanduser().resolve()
    if pbf.suffix.lower() != ".pbf" or not pbf.is_file():
        raise SystemExit("Input must be an existing .osm.pbf file")
    pbf_size = pbf.stat().st_size
    if pbf_size <= 0 or pbf_size > MAX_IMPORT_BYTES:
        raise SystemExit(f"PBF size must be between 1 byte and {MAX_IMPORT_BYTES} bytes")
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    required_free = max(2 * 1024 * 1024 * 1024, pbf_size * 6)
    for volume in {Path(tempfile.gettempdir()), catalog_path.parent}:
        if shutil.disk_usage(volume).free < required_free:
            raise SystemExit(f"Insufficient free space at {volume}; need at least {required_free} bytes for safe PBF processing")
    if not re.fullmatch(r"[a-z0-9][a-z0-9/_-]{0,99}", args.source_id):
        raise SystemExit("--source-id must be a stable lowercase slug using letters, digits, slash, _ or -")
    if args.source_url:
        if not valid_source_url(args.source_url):
            raise SystemExit("--source-url must be HTTPS and cannot contain credentials, a custom port, query parameters, or fragments")

    try:
        import osmium
        from osmium.replication import get_replication_header
    except ImportError as exc:
        raise SystemExit("Install the pinned reader dependency: python3 -m pip install -r scripts/requirements-pbf.txt") from exc

    # Serialize catalog reads and atomic replacement against both OSM update
    # scripts, so an extract cannot overwrite a newer concurrent snapshot.
    atexit.register(OSM_CATALOG_LOCK.acquire_catalog_run_lock())
    snapshot = valid_catalog(catalog_path) if catalog_path.exists() else {
        "schemaVersion": 1, "routes": [], "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        "licenseUrl": "https://www.openstreetmap.org/copyright",
    }
    imports = snapshot.get("pbfImports", [])
    if not isinstance(imports, list):
        raise SystemExit("Existing PBF import provenance is invalid; catalog left unchanged")
    source_ids = set()
    for item in imports:
        numeric_fields = ("bytes", "candidateRelations", "importedRelations", "skippedIncompleteRelations", "skippedNestedRelations")
        if isinstance(item, dict) and "reconciliationComplete" in item:
            numeric_fields += ("releasedRelations", "removedRelations", "protectedRelations")
        if (not isinstance(item, dict)
                or not isinstance(item.get("sourceId"), str) or not re.fullmatch(r"[a-z0-9][a-z0-9/_-]{0,99}", item["sourceId"])
                or item["sourceId"] in source_ids
                or item.get("region") not in REGIONS or not valid_source_url(item.get("sourceUrl"))
                or (item.get("sourceTimestamp") is not None and parse_timestamp(item.get("sourceTimestamp")) is None)
                or not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
                or parse_timestamp(item.get("importedAt")) is None
                or any(not isinstance(item.get(field), int) or isinstance(item.get(field), bool) or item[field] < 0 for field in numeric_fields)
                or item["bytes"] <= 0 or item["bytes"] > MAX_IMPORT_BYTES
                or item["importedRelations"] > item["candidateRelations"]
                or item["skippedIncompleteRelations"] > item["candidateRelations"]
                or ("reconciliationComplete" in item and not isinstance(item["reconciliationComplete"], bool))):
            raise SystemExit("Existing PBF import provenance is invalid; catalog left unchanged")
        source_ids.add(item["sourceId"])
    existing_by_id = {row["id"]: row for row in snapshot["routes"]}
    digest = sha256_file(pbf)
    prior_import = next((row for row in imports if isinstance(row, dict)
                         and row.get("sourceId") == args.source_id and row.get("sha256") == digest), None)
    if prior_import and (not args.reconcile_source or "reconciliationComplete" in prior_import):
        print(json.dumps({"skipped": "same sourceId and PBF SHA-256 already imported", "sourceId": args.source_id}))
        return
    if args.reconcile_source:
        validate_reconciliation_receipt(pbf, args.source_url, pbf_size, digest)
    try:
        source_time = get_replication_header(str(pbf)).timestamp
        if source_time and source_time.tzinfo is None:
            source_time = source_time.replace(tzinfo=dt.timezone.utc)
        source_timestamp = source_time.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z") if source_time else None
    except (RuntimeError, ValueError):
        source_timestamp = None

    temp_dir = Path(tempfile.mkdtemp(prefix="hiking-osm-pbf-"))
    try:
        from collections import defaultdict

        candidates = {}
        ways_to_routes = defaultdict(list)
        rejected_nested = 0
        rejected_nested_ids = set()
        unnamed_route_ids = set()

        class RelationReader(osmium.SimpleHandler):
            def relation(self, relation):
                nonlocal rejected_nested
                tags = dict(relation.tags)
                if tags.get("type") != "route" or tags.get("route") not in ("hiking", "foot"):
                    return
                rid = relation.id
                name = tags.get("name", "").strip()
                if not name:
                    unnamed_route_ids.add(rid)
                    return
                way_ids = set()
                has_nested = False
                for member in relation.members:
                    if member.type == "w":
                        way_ids.add(member.ref)
                    elif member.type == "r":
                        has_nested = True
                if has_nested or not way_ids:
                    rejected_nested += 1
                    rejected_nested_ids.add(rid)
                    return
                candidates[rid] = {
                    "name": tags.get("name:zh", name).strip() or name,
                    "originalName": name,
                    "tags": {key: tags[key] for key in TAG_ALLOWLIST if key in tags},
                    "expectedWays": len(way_ids),
                    "bounds": [math.inf, math.inf, -math.inf, -math.inf],
                    "resolvedWays": 0,
                    "resolvedNodes": 0,
                    "expectedNodes": 0,
                }
                for way_id in way_ids:
                    ways_to_routes[way_id].append(rid)

        relation_scan_started = time.monotonic()
        print(json.dumps({"phase": "scan-relations", "status": "started", "sourceId": args.source_id}), flush=True)
        RelationReader().apply_file(str(pbf), locations=False)
        print(json.dumps({
            "phase": "scan-relations", "status": "complete", "candidates": len(candidates),
            "nestedRejected": rejected_nested, "elapsedSeconds": round(time.monotonic() - relation_scan_started, 1),
        }), flush=True)
        if not candidates and not (args.reconcile_source and rejected_nested == 0):
            raise ValueError("No named hiking/foot route relations with direct way members were found")
        if args.reconcile_source:
            reject_empty_source_reconciliation(candidates, snapshot["routes"], args.source_id)

        location_index = temp_dir / "node-locations.data"

        class RouteWayReader(osmium.SimpleHandler):
            def way(self, way):
                route_ids = ways_to_routes.get(way.id)
                if not route_ids:
                    return
                nodes = list(way.nodes)
                for rid in route_ids:
                    row = candidates[rid]
                    row["resolvedWays"] += 1
                    row["expectedNodes"] += len(nodes)
                    bounds = row["bounds"]
                    for node in nodes:
                        if not node.location.valid():
                            continue
                        lon, lat = node.lon, node.lat
                        bounds[0] = min(bounds[0], lon)
                        bounds[1] = min(bounds[1], lat)
                        bounds[2] = max(bounds[2], lon)
                        bounds[3] = max(bounds[3], lat)
                        row["resolvedNodes"] += 1

        # A disk-backed index avoids keeping every regional node coordinate in RAM.
        processor = osmium.FileProcessor(str(pbf)).with_locations(f"sparse_file_array,{location_index}")
        processor = processor.with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
        processor = processor.with_filter(osmium.filter.IdFilter(ways_to_routes.keys()).enable_for(osmium.osm.WAY))
        way_reader = RouteWayReader()
        way_scan_started = time.monotonic()
        matched_ways = 0
        progress_stop = threading.Event()

        def report_way_scan_progress():
            while not progress_stop.wait(30):
                print(json.dumps({
                    "phase": "resolve-way-nodes", "status": "in-progress",
                    "matchedWays": matched_ways,
                    "elapsedSeconds": round(time.monotonic() - way_scan_started, 1),
                }), flush=True)

        progress_thread = threading.Thread(
            target=report_way_scan_progress, name="osm-pbf-progress", daemon=True,
        )
        progress_thread.start()
        print(json.dumps({
            "phase": "resolve-way-nodes", "status": "started", "candidateRelations": len(candidates),
            "referencedWays": len(ways_to_routes),
        }), flush=True)
        try:
            for obj in processor:
                way_reader.way(obj)
                matched_ways += 1
                if matched_ways % 100_000 == 0:
                    print(json.dumps({
                        "phase": "resolve-way-nodes", "status": "progress", "matchedWays": matched_ways,
                        "elapsedSeconds": round(time.monotonic() - way_scan_started, 1),
                    }), flush=True)
        finally:
            progress_stop.set()
            progress_thread.join(timeout=1)
        print(json.dumps({
            "phase": "resolve-way-nodes", "status": "complete", "matchedWays": matched_ways,
            "elapsedSeconds": round(time.monotonic() - way_scan_started, 1),
        }), flush=True)

        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        staged = {}
        incomplete = 0
        incomplete_ids = set()
        for rid, row in candidates.items():
            west, south, east, north = row["bounds"]
            if (row["resolvedWays"] != row["expectedWays"]
                    or row["expectedNodes"] < 2
                    or row["resolvedNodes"] != row["expectedNodes"]
                    or not all(math.isfinite(v) for v in (west, south, east, north))):
                incomplete += 1
                incomplete_ids.add(rid)
                continue
            key = f"osm-relation-{rid}"
            old = existing_by_id.get(key)
            source_tags = dict(old.get("sourceTags", {})) if old else {}
            source_tags.update(row["tags"])
            pbf_sources = set(old.get("pbfSources", [])) if old else set()
            pbf_sources.add(args.source_id)
            old_region = old.get("region") if old else None
            region = old_region if old_region in REGIONS else classify_region(args.region, (west + east) / 2, (south + north) / 2)
            staged[key] = {
                "id": key,
                "name": row["name"],
                "originalName": row["originalName"],
                "region": region,
                "center": [(west + east) / 2, (south + north) / 2],
                "sourceUrl": f"https://www.openstreetmap.org/relation/{rid}",
                "sourceTags": source_tags,
                "pbfSources": sorted(pbf_sources),
                "fetchedAt": now,
                "status": old.get("status", "待核验") if old else "待核验",
            }
        if not staged and not args.reconcile_source:
            raise ValueError("No reference-complete named route records; existing catalog left unchanged")

        merged = dict(existing_by_id)
        merged.update(staged)
        reconciliation_complete = False
        released_relations = 0
        removed_relations = 0
        protected_relations = 0
        reconciliation_changes = []
        if args.reconcile_source:
            reconciliation_complete = True
            protected_ids = {f"osm-relation-{rid}" for rid in incomplete_ids | rejected_nested_ids | unnamed_route_ids}
            for identity, old in list(merged.items()):
                if identity in staged:
                    continue
                source_ids = old.get("pbfSources")
                if not isinstance(source_ids, list) or args.source_id not in source_ids:
                    # Legacy records without source provenance cannot be
                    # safely attributed to this extract and remain intact.
                    continue
                if identity in protected_ids:
                    protected_relations += 1
                    continue
                remaining = [source_id for source_id in source_ids if source_id != args.source_id]
                if remaining:
                    append_reconciliation_change(
                        reconciliation_changes, identity, old, args.source_id, "source-released")
                    updated = dict(old)
                    updated["pbfSources"] = remaining
                    merged[identity] = updated
                    released_relations += 1
                else:
                    append_reconciliation_change(
                        reconciliation_changes, identity, old, args.source_id, "catalog-removed")
                    del merged[identity]
                    removed_relations += 1
            if len(reconciliation_changes) != released_relations + removed_relations:
                raise ValueError("OSM reconciliation change evidence does not match its counters; catalog left unchanged")
        if len(merged) > MAX_CATALOG_RECORDS:
            raise ValueError(f"Merged OSM catalog would exceed the {MAX_CATALOG_RECORDS}-record distribution limit")
        snapshot.update({
            "schemaVersion": 1,
            "generatedAt": now,
            "license": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors",
            "licenseUrl": "https://www.openstreetmap.org/copyright",
            "routes": sorted(merged.values(), key=lambda row: row["id"]),
            "coverageNote": "OSM discovery records only; PBF member-node references were complete for imported relations. Bounds centers are not navigable tracks or access verification.",
        })
        imports = [row for row in imports if not (isinstance(row, dict) and row.get("sourceId") == args.source_id)]
        import_record = {
            "sourceId": args.source_id,
            "region": args.region,
            "sourceUrl": args.source_url,
            "sourceTimestamp": source_timestamp,
            "sha256": digest,
            "bytes": pbf_size,
            "importedAt": now,
            "candidateRelations": len(candidates),
            "importedRelations": len(staged),
            "skippedIncompleteRelations": incomplete,
            "skippedNestedRelations": rejected_nested,
        }
        if args.reconcile_source:
            import_record.update({
                "reconciliationComplete": reconciliation_complete,
                "releasedRelations": released_relations,
                "removedRelations": removed_relations,
                "protectedRelations": protected_relations,
            })
        imports.append(import_record)
        snapshot["pbfImports"] = imports[-200:]

        temporary_catalog = None
        try:
            with tempfile.NamedTemporaryFile(mode="wb", dir=catalog_path.parent, delete=False) as handle:
                temporary_catalog = Path(handle.name)
                handle.write((json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_catalog, catalog_path)
        finally:
            if temporary_catalog is not None:
                temporary_catalog.unlink(missing_ok=True)
        print(json.dumps({
            "sourceId": args.source_id,
            "sourceSha256": digest,
            "candidateRelations": len(candidates),
            "importedRelations": len(staged),
            "skippedIncompleteRelations": incomplete,
            "skippedNestedRelations": rejected_nested,
            "reconciliationComplete": reconciliation_complete if args.reconcile_source else None,
            "releasedRelations": released_relations if args.reconcile_source else None,
            "removedRelations": removed_relations if args.reconcile_source else None,
            "protectedRelations": protected_relations if args.reconcile_source else None,
            "reconciliationChanges": reconciliation_changes if args.reconcile_source else None,
            "catalogCount": len(merged),
            "catalog": str(catalog_path),
        }, ensure_ascii=False))
    finally:
        for path in temp_dir.iterdir():
            path.unlink(missing_ok=True)
        temp_dir.rmdir()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as exc:
        raise SystemExit(f"OSM PBF import stopped safely: {exc}") from exc
