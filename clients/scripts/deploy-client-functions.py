#!/usr/bin/env python3
"""Deploy source with logged-in CloudBase CLI; preserve prior remote code.
Not a business test. Stops at first failure and never prints credentials.
"""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--cloudbase-cli', required=True)
parser.add_argument('--node', default='node')
parser.add_argument('--env', default='cloud1-d9g4fl3fu2491914f')
parser.add_argument('--backup-dir', required=True)
parser.add_argument('--command-timeout', type=int, default=180,
                    help='Per-CLI-command timeout in seconds (1..900); timeout is not proof that the remote update failed')
parser.add_argument('--functions', nargs='+', default=None,
                    help='Functions to deploy; defaults to every cloudbaserc.json function except init-db')
args = parser.parse_args()
if not 1 <= args.command_timeout <= 900:
    parser.error('--command-timeout must be between 1 and 900 seconds')
base = [args.node, args.cloudbase_cli]


def run(command):
    try:
        return subprocess.run(command, cwd=ROOT / 'app', capture_output=True, text=True,
                              timeout=args.command_timeout)
    except subprocess.TimeoutExpired as error:
        # Keep any login/transport output in the caller's private diagnostics,
        # never print it. An update may have reached the remote service, so a
        # timeout must remain a failed attempted mutation and enter rollback.
        def decoded(value):
            return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else (value or '')
        return subprocess.CompletedProcess(
            command, 124, decoded(error.stdout), decoded(error.stderr)
            + '\nCLI command timed out; remote state may be uncertain. Preserve backups and source readback.\n')


def source_files(folder):
    return [path for path in folder.rglob('*')
            if path.is_file() and not {'node_modules', '.git'}.intersection(path.relative_to(folder).parts)]


def save_diagnostic(path, result):
    path.write_text(result.stdout + '\n' + result.stderr)
    os.chmod(path, 0o600)


def download_readback(name, label):
    for attempt in range(3):
        target = backup / f'{name}-{label}-readback-{attempt + 1}'
        result = run(base + ['fn', 'code', 'download', name, str(target), '-e', args.env, '--json'])
        save_diagnostic(backup / f'{name}-{label}-readback-{attempt + 1}.log', result)
        if not result.returncode:
            return target
        if attempt < 2:
            time.sleep(5 * (attempt + 1))
    return None


def first_source_mismatch(source, readback):
    expected = {file.relative_to(source).parts: hashlib.sha256(file.read_bytes()).digest()
                for file in source_files(source)}
    candidates = source_files(readback)
    prefix = None
    for relative, digest in expected.items():
        matches = [candidate for candidate in candidates
                   if candidate.relative_to(readback).parts[-len(relative):] == relative
                   and hashlib.sha256(candidate.read_bytes()).digest() == digest]
        if not matches:
            return pathlib.PurePath(*relative).as_posix()
        candidate_prefix = matches[0].relative_to(readback).parts[:-len(relative)]
        if prefix is None:
            prefix = candidate_prefix
        elif candidate_prefix != prefix:
            return 'downloaded files have inconsistent roots'
    normalized = {file.relative_to(readback).parts[len(prefix or ()):]
                  for file in candidates
                  if file.relative_to(readback).parts[:len(prefix or ())] == (prefix or ())}
    if normalized != set(expected):
        extra = sorted(normalized - set(expected))
        missing = sorted(set(expected) - normalized)
        if extra:
            return 'unexpected remote file ' + pathlib.PurePath(*extra[0]).as_posix()
        if missing:
            return 'missing remote file ' + pathlib.PurePath(*missing[0]).as_posix()
    return None


subprocess.run(['python3', str(ROOT / 'app/scripts/compose-client-api.py')], check=True)
backup = pathlib.Path(args.backup_dir).expanduser().resolve()
backup.mkdir(parents=True, exist_ok=False)
os.chmod(backup, 0o700)
allowed = {folder.name for folder in (ROOT / 'app/cloudfunctions').iterdir() if folder.is_dir()}
config = json.loads((ROOT / 'app/cloudbaserc.json').read_text())
identity_helpers = [
    ROOT / 'app/cloudfunctions/login/identity-ownership.js',
    ROOT / 'app/cloudfunctions/client-api/identity-ownership.js',
]
if any(not path.is_file() for path in identity_helpers):
    raise SystemExit('Identity ownership helper missing from a standalone cloud-function package; no functions were updated.')
if len({hashlib.sha256(path.read_bytes()).digest() for path in identity_helpers}) != 1:
    raise SystemExit('Standalone identity ownership helpers differ; synchronize them before deployment.')
configured_rows = config.get('functions', [])
if not isinstance(configured_rows, list) or any(not isinstance(item, dict) or not isinstance(item.get('name'), str) for item in configured_rows):
    raise SystemExit('Invalid CloudBase function configuration; no functions were updated.')
configured_names = [item['name'] for item in configured_rows]
if len(configured_names) != len(set(configured_names)):
    raise SystemExit('Duplicate CloudBase function configuration; no functions were updated.')
configured = set(configured_names)
if args.functions is None:
    args.functions = [name for name in configured_names if name != 'init-db']
if len(args.functions) != len(set(args.functions)):
    raise SystemExit('Duplicate function names are not allowed')
for name in args.functions:
    if name not in allowed or name == 'init-db':
        raise SystemExit('Unknown or provisioning-only function: ' + name)

if 'gear-scan' in args.functions:
    prepared = subprocess.run([args.node, str(ROOT / 'scripts/prepare-gear-function.cjs')], cwd=ROOT)
    if prepared.returncode:
        raise SystemExit('Gear model preparation failed; no functions were updated.')

# Freeze all local deployment sources before touching the remote environment.
sources = {}
for name in args.functions:
    source = backup / 'sent-source' / name
    shutil.copytree(ROOT / 'app/cloudfunctions' / name, source,
                    ignore=shutil.ignore_patterns('node_modules', '.git'))
    if name == 'gear-scan':
        dependencies = ROOT / 'app/cloudfunctions/gear-scan/node_modules'
        if not dependencies.is_dir():
            raise SystemExit('Run npm ci in gear-scan before deployment; no functions were updated.')
        shutil.copytree(dependencies, source / 'node_modules')
    sources[name] = source

# Resolve existing versus new functions from the structured function listing;
# a failed download must never be mistaken for a missing function.
remote_names = set()
offset = 0
page_size = 100
while True:
    result = run(base + ['fn', 'list', '-l', str(page_size), '-o', str(offset), '-e', args.env, '--json'])
    diagnostic = backup / ('function-list-' + str(offset) + '.log')
    diagnostic.write_text(result.stdout + '\n' + result.stderr)
    os.chmod(diagnostic, 0o600)
    if result.returncode:
        raise SystemExit('Could not list remote functions; no functions were updated. Private diagnostic retained.')
    try:
        payload = json.loads(result.stdout)
        page = payload['data']
        # CLI 2 returns an array; CLI 3 wraps the same rows in Functions.
        if isinstance(page, dict):
            page = page['Functions']
        if not isinstance(page, list) or any(not isinstance(row, dict) for row in page):
            raise ValueError('unexpected function listing')
        names = [row.get('FunctionName') or row.get('name') for row in page]
        if any(not isinstance(name, str) or not name for name in names) or len(names) != len(set(names)):
            raise ValueError('invalid function names')
        if remote_names.intersection(names):
            raise ValueError('function pagination did not advance')
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise SystemExit('Could not parse remote function listing; no functions were updated. Private diagnostic retained.')
    remote_names.update(names)
    if len(page) < page_size:
        break
    offset += page_size

missing = sorted(set(args.functions) - remote_names)
if not set(missing).issubset(configured):
    raise SystemExit('A new function has no CloudBase configuration; no functions were updated.')
(backup / 'new-functions.json').write_text(json.dumps(missing, ensure_ascii=False, indent=2) + '\n')

# Complete every existing-function backup first. A CLI outage or permission
# problem must stop the batch before any function code is changed.
for name in args.functions:
    if name not in remote_names:
        continue
    result = run(base + ['fn', 'code', 'download', name, str(backup / name), '-e', args.env, '--json'])
    diagnostic = backup / (name + '-backup.log')
    diagnostic.write_text(result.stdout + '\n' + result.stderr)
    os.chmod(diagnostic, 0o600)
    if result.returncode:
        raise SystemExit('Backup failed for ' + name + '; no functions were updated. Private diagnostic retained.')

attempted = []
try:
    for name in args.functions:
        source = sources[name]
        attempted.append(name)
        if name in remote_names:
            command = base + ['fn', 'code', 'update', name, '--dir', str(source), '-e', args.env, '--json']
        else:
            command = base + ['fn', 'deploy', name, '--dir', str(source), '-e', args.env,
                              '--install-dependency', 'true', '--yes', '--json']
        try:
            result = run(command)
        except OSError:
            # No process was launched; this function has not been mutated.
            attempted.pop()
            raise
        save_diagnostic(backup / (name + '-deploy.log'), result)
        if result.returncode:
            raise RuntimeError('Source deployment failed for ' + name)

        readback = download_readback(name, 'candidate')
        if readback is None:
            raise RuntimeError('Remote source readback failed for ' + name)
        mismatch = first_source_mismatch(source, readback)
        if mismatch:
            raise RuntimeError('Remote content mismatch for ' + name + '/' + mismatch)
        prior = backup / name if name in remote_names else 'new function'
        print('Deployed and remote files verified:', name, 'Prior version:', prior, flush=True)
except BaseException as failure:
    rollback_failures = []
    for name in reversed(attempted):
        if name not in remote_names:
            continue
        try:
            prior = backup / name
            rollback = run(base + ['fn', 'code', 'update', name, '--dir', str(prior), '-e', args.env, '--json'])
            save_diagnostic(backup / (name + '-rollback.log'), rollback)
            if rollback.returncode:
                rollback_failures.append(name + ' (restore command failed)')
                continue
            restored = download_readback(name, 'rollback')
            if restored is None:
                rollback_failures.append(name + ' (restore readback failed)')
                continue
            mismatch = first_source_mismatch(prior, restored)
            if mismatch:
                rollback_failures.append(name + ' (restore mismatch: ' + mismatch + ')')
        except BaseException:
            rollback_failures.append(name + ' (restore raised an error)')

    new_functions = [name for name in attempted if name not in remote_names]
    detail = f'Deployment batch failed: {failure}. '
    if rollback_failures:
        detail += 'Rollback could not be verified for: ' + ', '.join(rollback_failures) + '. '
    elif any(name in remote_names for name in attempted):
        detail += 'Every attempted existing function was restored and readback-verified. '
    if new_functions:
        detail += 'New functions were not automatically deleted and need inspection: ' + ', '.join(new_functions) + '. '
    detail += 'Private backups and diagnostics are retained at the requested backup directory.'
    raise SystemExit(detail) from failure

print('Deployment commands succeeded; verify remote file hashes and perform unified acceptance separately.')
