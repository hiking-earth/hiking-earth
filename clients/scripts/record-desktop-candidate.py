#!/usr/bin/env python3
"""Record candidate artifact bytes and source identity, without running the app."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    parser.add_argument('--bundle-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    # Fail closed on source changes; generated/ignored build outputs are allowed.
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root, text=True)
    if dirty.strip():
        raise ValueError('Candidate source changed after checkout; preserve logs and rebuild from an identified commit')
    source_paths = [
        'desktop/src-tauri/src/location.rs', 'desktop/src-tauri/src/main.rs',
        'desktop/src-tauri/Cargo.lock', 'desktop/src-tauri/Info.plist',
        'desktop/src-tauri/tauri.conf.json', 'desktop/src-tauri/tauri.candidate.conf.json',
        'app/src/services/desktop-location.ts', 'app/package-lock.json',
    ]
    sources = {name: digest(root / name) for name in source_paths}
    bundles = args.bundle_dir.resolve(strict=True)
    rows = []
    for path in sorted(bundles.rglob('*')):
        if path.is_symlink():
            continue
        if path.is_file() and path.name.lower().endswith(('.dmg', '.msi', '.deb', '.appimage')):
            resolved = path.resolve(strict=True)
            if not resolved.is_relative_to(bundles):
                raise ValueError('Artifact outside bundle directory')
            rows.append({'path': path.relative_to(bundles).as_posix(),
                         'bytes': path.stat().st_size, 'sha256': digest(path)})
    if not rows:
        raise ValueError('No installer artifacts found')
    if any(row['bytes'] >= 500_000_000 for row in rows):
        raise ValueError('Candidate installer exceeds the 500 MB hard limit')
    result = {'schemaVersion': 1, 'candidate': True, 'tested': False, 'published': False,
              'sourceCommit': commit, 'target': args.target, 'sourceSha256': sources,
              'workflowRunId': os.environ.get('GITHUB_RUN_ID'),
              'workflowRunAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
              'updaterArtifacts': False, 'artifacts': rows,
              'note': 'Source hashes prove included inputs, not GPS runtime behavior, installed size, or platform acceptance.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

if __name__ == '__main__':
    main()
