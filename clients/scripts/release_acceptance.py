"""Acceptance structure for the agreed free iPhone PWA delivery path.

These checks require evidence references; reviewers still need to inspect them.
They do not perform device testing or certify the referenced evidence.
"""
from datetime import datetime
import re


IPHONE_CHECKS = ('installation', 'offlineRestore', 'permissionWithdrawal', 'update')
CLIENT_VERSION_COMPONENT_MAX = 9007199254740991
CLIENT_VERSION_PATTERN = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
REQUIRED_RELEASE_PLATFORMS = (
    'android', 'h5', 'weixin', 'web', 'windows', 'macos',
    'macos-aarch64', 'macos-x86_64', 'linux',
)
DESKTOP_UPDATER_HASH_PLATFORMS = ('windows', 'macos-aarch64', 'macos-x86_64', 'linux')


def has_schema_version_1(value):
    return (isinstance(value, dict) and type(value.get('schemaVersion')) is int
            and value.get('schemaVersion') == 1)


def parse_client_version(value):
    """Match the three-part version syntax and safe-integer bounds used by clients."""
    if not isinstance(value, str):
        return None
    match = CLIENT_VERSION_PATTERN.fullmatch(value)
    if not match:
        return None
    parts = tuple(int(part) for part in match.groups())
    return parts if all(part <= CLIENT_VERSION_COMPONENT_MAX for part in parts) else None


def require_client_version(value):
    parts = parse_client_version(value)
    if parts is None:
        raise SystemExit('Release version must use three canonical numeric components within client safe-integer bounds')
    return parts


def require_source_manifest_version(native_manifest, version, version_code):
    """Fail closed unless a release tag and code match the native source manifest."""
    require_client_version(version)
    manifest_version = native_manifest.get('versionName') if isinstance(native_manifest, dict) else None
    manifest_code = native_manifest.get('versionCode') if isinstance(native_manifest, dict) else None
    if (manifest_version != version or not isinstance(manifest_code, (str, int))
            or isinstance(manifest_code, bool) or not str(manifest_code).isdigit()
            or not isinstance(version_code, int) or isinstance(version_code, bool)
            or int(manifest_code) != version_code):
        raise SystemExit('Release tag/versionCode must match app/src/manifest.json before promotion')


def require_desktop_package_version(tauri_config, version):
    """Fail closed unless the packaged desktop app version matches the release tag."""
    package_version = tauri_config.get('version') if isinstance(tauri_config, dict) else None
    if package_version != version:
        raise SystemExit('Desktop release tag must match desktop/src-tauri/tauri.conf.json')


def require_release_manifest_metadata(release):
    """Validate GitHub release metadata against the native updater's manifest bounds."""
    if not isinstance(release, dict):
        raise SystemExit('Published release metadata is invalid')
    published_at = release.get('published_at')
    if not isinstance(published_at, str) or not published_at.endswith('Z'):
        raise SystemExit('Published release must include a UTC publication timestamp')
    try:
        parsed = datetime.fromisoformat(published_at[:-1] + '+00:00')
    except ValueError:
        raise SystemExit('Published release timestamp is invalid')
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        raise SystemExit('Published release timestamp must be UTC')

    body = release.get('body')
    if body is None or body == '' or (isinstance(body, str) and not body.strip()):
        notes = '徒步地球功能更新'
    elif isinstance(body, str):
        notes = body
    else:
        raise SystemExit('Published release notes are invalid')
    # JavaScript clients validate String.length (UTF-16 code units), not Unicode
    # code points. Match that limit so promotion cannot publish a rejected manifest.
    if len(notes.encode('utf-16-le')) // 2 > 12000:
        raise SystemExit('Published release notes exceed the client manifest limit')
    return published_at, notes


def require_iphone_acceptance(platforms, store_url=None):
    ios = platforms.get('ios') if isinstance(platforms, dict) else None
    if not isinstance(ios, dict) or ios.get('status') != 'passed':
        raise SystemExit('Actual iPhone acceptance required; owner signing hold is not PWA acceptance')
    delivery = ios.get('delivery')
    if delivery not in ('pwa', 'native'):
        raise SystemExit('iPhone acceptance must identify pwa or native delivery')
    if store_url and delivery != 'native':
        raise SystemExit('PWA acceptance cannot advertise a native iOS store entry')
    if ios.get('device') != 'physical-iphone':
        raise SystemExit('iPhone acceptance requires a physical iPhone, not desktop emulation')
    checks = ios.get('checks')
    if not isinstance(checks, dict):
        raise SystemExit('iPhone acceptance checks are missing')
    for name in IPHONE_CHECKS:
        row = checks.get(name)
        if (not isinstance(row, dict) or row.get('status') != 'passed'
                or not isinstance(row.get('evidence'), list) or not row['evidence']
                or any(not isinstance(item, str) or not item.strip() for item in row['evidence'])):
            raise SystemExit('iPhone check requires passed status and evidence: ' + name)


def require_platform_evidence(platforms, names):
    """Require reviewable per-platform references, not a bare passed flag."""
    for name in names:
        row = platforms.get(name) if isinstance(platforms, dict) else None
        evidence = row.get('evidence') if isinstance(row, dict) else None
        if (not isinstance(row, dict) or row.get('status') != 'passed'
                or not isinstance(evidence, list) or not evidence
                or any(not isinstance(item, str) or not item.strip() for item in evidence)):
            raise SystemExit('Platform acceptance requires passed status and evidence: ' + name)


def require_desktop_updater_hashes(platforms):
    """Require a pinned desktop updater artifact for every supported architecture."""
    for name in DESKTOP_UPDATER_HASH_PLATFORMS:
        row = platforms.get(name) if isinstance(platforms, dict) else None
        digest = row.get('updaterArtifactSha256') if isinstance(row, dict) else None
        if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise SystemExit('Desktop updater SHA-256 is required for platform: ' + name)
