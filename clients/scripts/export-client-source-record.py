#!/usr/bin/env python3
"""Export source identity for a handoff; never run client code or acceptance tests."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'desktop/src-tauri/src/main.rs',
    'desktop/src-tauri/src/location.rs',
    'desktop/src-tauri/src/map_network.rs',
    'desktop/src-tauri/tauri.conf.json',
    'app/src/services/desktop-location.ts',
    'app/src/services/account.ts',
    'app/src/services/account-core.ts',
    'shared/content/scenic-review.ts',
    'shared/content/scenic-clock.ts',
    'app/src/services/basemap-catalog.ts',
    'app/src/services/gear-backend.ts',
    'shared/maps/route-map-style.ts',
    '.github/workflows/route-catalog-scheduler.yml',
)


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, check=True).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--compare-ref', help='Local Git ref only; fetch separately before using it')
    parser.add_argument('--expected-comparison-commit', help='Exact commit independently read from the remote')
    args = parser.parse_args()
    if bool(args.compare_ref) != bool(args.expected_comparison_commit):
        parser.error('Comparison requires both --compare-ref and --expected-comparison-commit')
    # Resolve once, so a later moving branch cannot mix multiple revisions.
    comparison = git('rev-parse', '--verify', args.compare_ref + '^{commit}').decode().strip() if args.compare_ref else None
    if comparison and comparison != args.expected_comparison_commit:
        raise ValueError('Comparison ref differs from expected remote commit; refresh it explicitly')
    rows = []
    for name in FILES:
        path = ROOT / name
        if path.is_symlink():
            raise ValueError('Source symlinks must be reviewed before exporting')
        data = path.read_bytes() if path.is_file() else None
        row = {'path': name, 'workingSha256': digest(data) if data is not None else None}
        if comparison:
            entry = git('ls-tree', comparison, '--', name)
            remote = git('show', comparison + ':' + name) if entry else None
            row.update(comparisonSha256=digest(remote) if remote is not None else None,
                       differs=data != remote)
        rows.append(row)
    record = {
        'schemaVersion': 1, 'kind': 'source-only-handoff',
        'workingBaseCommit': git('rev-parse', 'HEAD').decode().strip(),
        'workingTreeDirty': bool(git('status', '--porcelain')),
        'comparisonCommit': comparison, 'files': rows,
        'functionalAcceptance': False, 'deploymentVerified': False,
        'note': 'File hashes identify selected source inputs only. Missing or different files do not prove runtime behavior. Comparison ref freshness depends on a separate fetch.',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


if __name__ == '__main__':
    main()
