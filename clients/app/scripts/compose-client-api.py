"""Prepare the authenticated HTTP package without replacing canonical handlers.

Run before deployment. Does not invoke any endpoint or alter cloud data.
"""
from pathlib import Path
import argparse
import re
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check-only', action='store_true', help='Check source boundaries without preparing catalog snapshots')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1] / 'cloudfunctions'
destination = root / 'client-api' / 'business'
names = ['catalog-feed', 'route-manage', 'social-manage', 'companion-create', 'companion-list', 'companion-join', 'companion-report', 'companion-manage', 'team-manage', 'library-manage', 'community-moderate',
         'team-create', 'team-join', 'team-leave', 'team-stop', 'team-report',
         'team-locations', 'team-current', 'track-sync', 'track-manage', 'sos-trigger', 'guide-list', 'offline-map-request']
if len(names) != len(set(names)):
    raise RuntimeError('Duplicate HTTP business handler in composition list')

router = (root / 'client-api' / 'index.js').read_text()

def router_set(constant):
    match = re.search(rf"const {constant} = new Set\(\[([\s\S]*?)\]\);", router)
    if not match:
        raise RuntimeError(f'Missing {constant} in the HTTP gateway')
    return re.findall(r"'([^']+)'", match.group(1))

router_handlers = router_set('handlers')
if len(router_handlers) != len(set(router_handlers)) or set(router_handlers) != set(names):
    missing = sorted(set(router_handlers) - set(names))
    unreachable = sorted(set(names) - set(router_handlers))
    raise RuntimeError(f'HTTP gateway and business composition differ; missing={missing}, unreachable={unreachable}')
public_handlers = router_set('publicHandlers')
if len(public_handlers) != len(set(public_handlers)) or not set(public_handlers).issubset(names):
    raise RuntimeError('HTTP public handler list must be unique and included in business composition')

# HTTP/session-aware handlers are canonical source, not generated copies of
# standalone legacy callable functions. In particular social-manage's legacy
# entry intentionally fails closed and must never replace its gateway handler.
gateway = root / 'client-api'

def validate_business_sources():
    for name in names:
        entry = destination / name / 'index.js'
        if entry.is_symlink() or not entry.is_file():
            raise RuntimeError(f'Missing canonical HTTP handler: {name}; refusing standalone fallback')
        source = entry.read_text()
        if 'getWXContext' in source:
            raise RuntimeError(f'Unverified platform identity access in HTTP handler: {name}')
        if 'UNIFIED_ACCOUNT_REQUIRED' in source:
            raise RuntimeError(f'Legacy disabled entry found in canonical HTTP handler: {name}')

    # Include local helper dependencies such as owner-admin, route-access-audit
    # and affiliate source adapters. SDK/builtin imports and the router's
    # whitelisted dynamic business imports are handled by their own contracts.
    for entry in gateway.rglob('*'):
        relative = entry.relative_to(gateway)
        if {'node_modules', '.git', 'snapshots'}.intersection(relative.parts):
            continue
        if entry.suffix not in {'.js', '.cjs'}:
            continue
        if entry.is_symlink():
            raise RuntimeError(f'Linked cloud source rejected: {relative}')
        if not entry.is_file():
            continue
        for dependency in re.findall(r"require\(\s*['\"](\.{1,2}/[^'\"]+)['\"]\s*\)", entry.read_text()):
            target = (entry.parent / dependency).resolve()
            if not target.is_relative_to(gateway.resolve()):
                raise RuntimeError(f'Local dependency leaves cloud package: {relative}')
            candidates = [target, Path(str(target) + '.js'), Path(str(target) + '.cjs'),
                          Path(str(target) + '.json'), target / 'index.js']
            if not any(candidate.is_file() and not candidate.is_symlink() for candidate in candidates):
                raise RuntimeError(f'Missing local dependency in {relative}: {dependency}')

validate_business_sources()
# Catalog preparation updates only catalog snapshots. It must never regenerate
# or replace canonical business code. Keep the existing deployment command path.
if not args.check_only:
    subprocess.run([sys.executable, str(Path(__file__).resolve().parents[2] / 'scripts/prepare-catalog-pages.py')], check=True)
    validate_business_sources()
operation = 'Checked' if args.check_only else 'Prepared'
print(f'{operation} {len(names)} canonical HTTP handlers; implementations and local helpers preserved.')
