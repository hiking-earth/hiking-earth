#!/usr/bin/env python3
"""Prepare a new static fallback directory; never replace a live site."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = root / 'static-fallback'
    names = ['index.html', 'blue-marble-mercator-4096.webp',
             'blue-marble-mercator-4096.webp.provenance.json']
    files = [source / name for name in names]
    if any(path.is_symlink() or not path.is_file() for path in files):
        raise ValueError('Fallback source missing or linked')
    if sum(path.stat().st_size for path in files) > 10 * 1024 * 1024:
        raise ValueError('Static fallback exceeds its 10 MiB preparation budget')
    provenance = json.loads(files[2].read_text())
    if provenance.get('generatedAssetSha256') != sha(files[1]) or provenance.get('generatedAssetBytes') != files[1].stat().st_size:
        raise ValueError('Earth image does not match its source record')
    output = args.output.resolve()
    # Create a new delivery folder, and leave partial output for diagnosis.
    output.mkdir(parents=True, exist_ok=False)
    for path in files:
        shutil.copyfile(path, output / path.name)
        if sha(output / path.name) != sha(path):
            raise ValueError('Copied fallback resource differs')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', 'static-fallback', 'scripts/prepare-static-fallback.py'], cwd=root, text=True)
    record = {'schemaVersion': 1, 'kind': 'static-fallback', 'project': 'hiking-earth-web-static-fallback', 'sourceCommit': commit,
              'sourceDirty': bool(dirty.strip()), 'functionalAcceptance': False,
              'preparationDoesNotProveDeployment': True,
              'files': [{'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path)} for path in files]}
    (output / 'source-record.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    (output / '.nojekyll').write_text('')

if __name__ == '__main__':
    main()
