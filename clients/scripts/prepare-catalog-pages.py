#!/usr/bin/env python3
"""Prepare deterministic public catalog pages. No network, build or feature tests.

Raw source files remain the provenance record. Two immutable generations are
retained so an in-flight client can finish reading its original snapshot.
"""
from afcd_pair import offline_bytes as afcd_offline_bytes
import gzip
import hashlib
import json
import os
import argparse
from pathlib import Path
import shutil
import tempfile
import zlib
from catalog_publication_validation import validate_news_catalog, validate_route_catalog
from catalog_sources import PUBLIC_CATALOG_FILES

ROOT = Path(__file__).resolve().parents[1]
PAGE_SIZE = 400
MAX_IMMUTABLE_GZIP_BYTES = 32 * 1024 * 1024
MAX_IMMUTABLE_STORED_BYTES = 8 * 1024 * 1024
MAX_CATALOG_FILE_BYTES = 128 * 1024 * 1024
MAX_TOTAL_CATALOG_BYTES = 256 * 1024 * 1024
MAX_DIRECT_SOURCE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_DIRECT_SOURCE_BYTES = 32 * 1024 * 1024
MAX_CATALOG_MANIFEST_BYTES = 1024 * 1024
# Keep the last known production OSM generation available for explicit rollback.
PROTECTED_GENERATIONS = {'osm': {'6eed0992ec765e5870be559ef92f8fe48769bfc5ea20e3256ef77f704ba55fdf'}}
SOURCES = PUBLIC_CATALOG_FILES


class InputBudgetExceeded(ValueError):
    """Raised when an input is too large; callers must not treat this as corruption."""


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def read_bounded_bytes(path, per_file_limit, label, remaining_total_budget=None):
    limit = per_file_limit
    if remaining_total_budget is not None:
        limit = min(limit, remaining_total_budget)
    if limit < 0:
        raise ValueError(f'{label}: remaining input budget is invalid')
    with Path(path).open('rb') as stream:
        payload = stream.read(limit + 1)
    if len(payload) > limit:
        raise InputBudgetExceeded(f'{label}: input exceeds the {limit}-byte read budget')
    return payload


def project_path(path):
    """Resolve a catalog path lexically and reject symlinked path components."""
    path = Path(path)
    if not path.is_absolute():
        path = Path(ROOT) / path
    path = Path(os.path.abspath(path))
    root = Path(ROOT).resolve()
    try:
        parts = path.relative_to(root).parts
    except ValueError as error:
        raise ValueError('catalog path must remain inside the project root') from error
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f'{current.name}: catalog path contains a symbolic link')
    return current


def atomic_write(path, data):
    path = project_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        handle.write(data)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def _bounded_gzip_payload(data):
    """Decode one bounded, complete gzip member; reject bombs and trailing data."""
    try:
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        payload = decoder.decompress(data, MAX_IMMUTABLE_GZIP_BYTES + 1)
    except zlib.error:
        return None
    if (len(payload) > MAX_IMMUTABLE_GZIP_BYTES or decoder.unconsumed_tail
            or not decoder.eof or decoder.unused_data):
        return None
    return payload


def immutable_content_matches(path, existing, expected):
    if existing == expected:
        return True
    if Path(path).suffix != '.gz':
        return False
    existing_payload = _bounded_gzip_payload(existing)
    expected_payload = _bounded_gzip_payload(expected)
    return (existing_payload is not None and expected_payload is not None
            and existing_payload == expected_payload)


def write_immutable(path, data):
    """Create content-addressed data; gzip encodings may differ across zlib versions."""
    path = project_path(path)
    if len(data) > MAX_IMMUTABLE_STORED_BYTES:
        raise ValueError(f'{path.name}: immutable catalog input exceeds stored-byte budget')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or not path.is_file() or not immutable_content_matches(
                path, read_bounded_bytes(path, MAX_IMMUTABLE_STORED_BYTES, f'{path.name} immutable file'), data):
            raise ValueError(f'{path.name}: immutable catalog content collision')
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        handle.write(data)
        temporary = Path(handle.name)
    try:
        try:
            # Same-filesystem linking creates the immutable name atomically and
            # refuses to replace a concurrent writer's file.
            os.link(temporary, path)
        except FileExistsError:
            if path.is_symlink() or not path.is_file() or not immutable_content_matches(
                    path, read_bounded_bytes(path, MAX_IMMUTABLE_STORED_BYTES, f'{path.name} immutable file'), data):
                raise ValueError(f'{path.name}: immutable catalog content collision')
    finally:
        temporary.unlink(missing_ok=True)


def copy_immutable(source, destination):
    """Stage immutable catalog content into a bundled fallback directory."""
    source_path = project_path(source)
    if not source_path.is_file():
        raise ValueError(f'{source_path.name}: invalid immutable catalog source')
    destination_path = project_path(destination)
    data = read_bounded_bytes(source_path, MAX_IMMUTABLE_STORED_BYTES, f'{source_path.name} immutable source')
    write_immutable(destination_path, data)
    return str(destination_path)


def select_sources(source_filter=None, excluded_sources=None):
    excluded = set(excluded_sources or ())
    unknown = excluded - set(SOURCES)
    if source_filter is not None:
        unknown.update(set(source_filter) - set(SOURCES))
    if unknown:
        raise ValueError('unknown catalog source requested')
    selected = {
        source: relative for source, relative in SOURCES.items()
        if (source_filter is None or source in source_filter) and source not in excluded
    }
    if not selected:
        raise ValueError('at least one catalog source must be selected')
    return selected


def prepare(source_filter=None, excluded_sources=None):
    selected = select_sources(source_filter, excluded_sources)
    # A scoped source refresh must not repair or rewrite unrelated sources.
    if source_filter is None or 'hk' in selected:
        # Validate the pair before changing any public pointer or fallback file.
        hk_path = ROOT / 'shared/data/catalog/hk-afcd.json'
        hk = json.loads(read_bounded_bytes(hk_path, MAX_CATALOG_FILE_BYTES, 'Hong Kong catalog'))
        try:
            offline_path = ROOT / 'shared/data/offline/hk-afcd.json'
            offline_bytes = read_bounded_bytes(offline_path, MAX_DIRECT_SOURCE_BYTES, 'Hong Kong offline source')
            offline = json.loads(offline_bytes)
        except InputBudgetExceeded:
            raise
        except (OSError, ValueError):
            offline_bytes = b''
            offline = {}
        if not isinstance(offline, dict):offline = {}
        expected_hash = hk.get('offlineSha256')
        if expected_hash is not None and (expected_hash != hashlib.sha256(offline_bytes).hexdigest()
                                        or offline.get('sourceGeneratedAt') != hk.get('generatedAt')):
            repaired = afcd_offline_bytes(hk)
            if len(repaired) > MAX_DIRECT_SOURCE_BYTES:
                raise ValueError('Hong Kong offline reconstruction exceeds memory budget')
            if hashlib.sha256(repaired).hexdigest() != expected_hash:
                raise ValueError('Hong Kong offline reconstruction hash mismatch; publication stopped')
            atomic_write(ROOT / 'shared/data/offline/hk-afcd.json', repaired)
            offline = json.loads(repaired)
            print('Recovered Hong Kong offline reference from authoritative catalog')
        expected = {row['id']: row.get('referencePaths') for row in hk['routes']}
        actual = {}
        for feature in offline.get('geometry', {}).get('features', []):
            identity = feature.get('properties', {}).get('sourceId')
            if identity in actual:
                raise ValueError('Duplicate Hong Kong offline source ID')
            actual[identity] = feature.get('geometry', {}).get('coordinates')
        if expected != actual:
            repaired = afcd_offline_bytes(hk)
            if len(repaired) > MAX_DIRECT_SOURCE_BYTES:
                raise ValueError('Hong Kong offline reconstruction exceeds memory budget')
            if expected_hash is not None and hashlib.sha256(repaired).hexdigest() != expected_hash:
                raise ValueError('Hong Kong offline reconstruction hash mismatch; publication stopped')
            atomic_write(ROOT / 'shared/data/offline/hk-afcd.json', repaired)
            print('Recovered Hong Kong reference geometry from authoritative catalog')
    pending = []
    direct = {}
    direct_bytes_read = 0
    if source_filter is None:
        direct_sources = {'release': 'releases/stable.json'}
        if 'hk' in selected:
            direct_sources['offline-hk'] = 'data/offline/hk-afcd.json'
        for source, relative in direct_sources.items():
            payload = read_bounded_bytes(
                ROOT / 'shared' / relative, MAX_DIRECT_SOURCE_BYTES, f'{source} direct snapshot',
                MAX_TOTAL_DIRECT_SOURCE_BYTES - direct_bytes_read,
            )
            direct_bytes_read += len(payload)
            direct[source] = payload
    catalog_bytes_read = 0
    for source, relative in selected.items():
        raw = read_bounded_bytes(
            ROOT / 'shared' / relative, MAX_CATALOG_FILE_BYTES, f'{source} catalog',
            MAX_TOTAL_CATALOG_BYTES - catalog_bytes_read,
        )
        catalog_bytes_read += len(raw)
        data = json.loads(raw)
        key = 'items' if source == 'news' else 'routes'
        rows = data[key]
        if (type(data.get('schemaVersion')) is not int or data.get('schemaVersion') != 1
                or not isinstance(rows, list) or len(rows) > 250000):
            raise ValueError(f'{source}: unsupported catalog format or source record budget exceeded')
        if source == 'news':
            validate_news_catalog(data)
        else:
            validate_route_catalog(source, data)
        snapshot = hashlib.sha256(raw).hexdigest()
        folder = ROOT / 'shared/public-catalog' / source
        protected = PROTECTED_GENERATIONS.get(source, set())
        missing_protected = [generation for generation in protected if not (folder / generation).is_dir()]
        if missing_protected:
            raise ValueError(f'{source}: protected rollback generation missing: {missing_protected}')
        previous = None
        if (folder / 'manifest.json').exists():
            pointer_bytes = read_bounded_bytes(
                folder / 'manifest.json', MAX_CATALOG_MANIFEST_BYTES, f'{source} current manifest',
            )
            pointer = json.loads(pointer_bytes)
            previous = pointer.get('snapshot')
            if previous == snapshot:
                previous = pointer.get('previousSnapshot')
        version = folder / snapshot
        hashes = []
        # Even an empty catalog has a valid first page.
        for page in range(max(1, (len(rows) + PAGE_SIZE - 1) // PAGE_SIZE)):
            payload = encode(rows[page * PAGE_SIZE:(page + 1) * PAGE_SIZE])
            if len(payload) > 4 * 1024 * 1024:
                raise ValueError(f'{source}: page exceeds uncompressed memory budget')
            hashes.append(hashlib.sha256(payload).hexdigest())
            compressed = gzip.compress(payload, mtime=0)
            if len(compressed) > 2 * 1024 * 1024:
                raise ValueError(f'{source}: compressed page exceeds download budget')
            write_immutable(version / f'page-{page:05d}.json.gz', compressed)
        index = encode([[str(row.get('name', '')), str(row.get('region', '')), page, offset] for page in range(len(hashes)) for offset, row in enumerate(rows[page * PAGE_SIZE:(page + 1) * PAGE_SIZE])])
        if len(index) > 32 * 1024 * 1024:
            raise ValueError(f'{source}: search index exceeds memory budget')
        packed_index = gzip.compress(index, mtime=0)
        if len(packed_index) > 8 * 1024 * 1024:
            raise ValueError(f'{source}: search index exceeds download budget')
        write_immutable(version / 'index.json.gz', packed_index)
        manifest = encode({'schemaVersion': 1, 'snapshot': snapshot, 'key': key,
                          'total': len(rows), 'pageSize': PAGE_SIZE, 'previousSnapshot': previous,
                          'metadata': {k: v for k, v in data.items() if k not in ('routes', 'items', 'failures', 'withheldItems')},
                          'pages': hashes, 'indexHash': hashlib.sha256(index).hexdigest()})
        if len(manifest) > MAX_CATALOG_MANIFEST_BYTES:
            raise ValueError(f'{source}: manifest exceeds metadata budget')
        write_immutable(version / 'manifest.json', manifest)
        retained = {snapshot, previous, *protected}
        fallbacks = [
            ROOT / 'app/cloudfunctions/catalog-feed/snapshots' / source,
            ROOT / 'app/cloudfunctions/client-api/business/catalog-feed/snapshots' / source,
        ]
        for fallback in fallbacks:
            fallback.mkdir(parents=True, exist_ok=True)
        # Stage every retained immutable generation before exposing any pointer.
        for fallback in fallbacks:
            for generation in retained:
                if generation and (folder / generation).is_dir():
                    shutil.copytree(folder / generation, fallback / generation,
                                    dirs_exist_ok=True, copy_function=copy_immutable)
        pending.append((source, folder, fallbacks, manifest, retained))
        print(f'{source}: prepared {len(rows)} records / {len(hashes)} pages; {snapshot[:12]}')

    # All sources and direct payload budgets passed before pointer publication.
    # Separate source pointers are independent, not one filesystem transaction.
    for source, folder, fallbacks, manifest, retained in pending:
        atomic_write(folder / 'manifest.json', manifest)
        for fallback in fallbacks:
            atomic_write(fallback / 'manifest.json', manifest)
        for base in (folder, *fallbacks):
            for child in base.iterdir():
                if child.is_dir() and len(child.name) == 64 and all(c in '0123456789abcdef' for c in child.name) and child.name not in retained:
                    shutil.rmtree(child)
        for fallback in fallbacks:
            (fallback.parent / (source + '.json')).unlink(missing_ok=True)
    for source, payload in direct.items():
        for base in (ROOT / 'app/cloudfunctions/catalog-feed/snapshots', ROOT / 'app/cloudfunctions/client-api/business/catalog-feed/snapshots'):
            atomic_write(base / (source + '.json'), payload)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Prepare public route catalog snapshots.')
    parser.add_argument('--source', action='append', choices=sorted(SOURCES), help='Prepare only this source; repeat for multiple sources.')
    parser.add_argument('--exclude-source', action='append', choices=sorted(SOURCES), help='Skip this source while preparing all others; repeat as needed.')
    args = parser.parse_args()
    prepare(set(args.source) if args.source else None, set(args.exclude_source or ()))
