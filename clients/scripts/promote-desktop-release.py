#!/usr/bin/env python3
"""Publish a verified desktop candidate only after the unified acceptance gate."""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit
from release_acceptance import (require_iphone_acceptance, require_platform_evidence,
                                has_schema_version_1, require_source_manifest_version,
                                require_desktop_package_version, REQUIRED_RELEASE_PLATFORMS,
                                require_client_version, parse_client_version)

REPO = "hiking-earth/clients"
PLATFORMS = {
    "windows-x86_64": ".msi",
    "darwin-aarch64": ".app.tar.gz",
    "darwin-x86_64": ".app.tar.gz",
    "linux-x86_64": ".AppImage",
}
DESKTOP_REPORT_KEYS = {
    "windows-x86_64": "windows",
    "darwin-aarch64": "macos-aarch64",
    "darwin-x86_64": "macos-x86_64",
    "linux-x86_64": "linux",
}


def gh_json(*args):
    return json.loads(subprocess.check_output(["gh", "api", *args], text=True))


def stop(message):
    raise SystemExit(message)


def merge_desktop_download_manifest(stable, version, platforms):
    if not has_schema_version_1(stable) or not isinstance(stable.get("ready"), bool):
        stop("Existing stable manifest is invalid; preserve it and repair manually")
    candidate = require_client_version(version)
    current = parse_client_version(stable.get("version"))
    if current is None:
        stop("Existing stable manifest version is invalid; preserve it and repair manually")
    if candidate < current:
        stop("Desktop download manifest cannot move behind the stable app version")
    if not isinstance(platforms, dict) or set(platforms) != set(DESKTOP_REPORT_KEYS.values()):
        stop("Complete verified desktop download metadata is required")
    return {
        **stable,
        "desktop": {
            "version": version,
            "platforms": platforms,
        },
    }


def stage_stable_manifest(path, stable):
    """Durably prepare the local manifest before changing the public release."""
    payload = json.dumps(stable, ensure_ascii=False, indent=2) + "\n"
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, prefix=path.name + ".",
                                         suffix=".tmp", delete=False) as stream:
            temporary_path = pathlib.Path(stream.name)
            os.chmod(temporary_path, path.stat().st_mode & 0o777)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        return temporary_path
    except Exception:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise


def prepare_stable_manifest(path, version, platforms):
    """Validate and durably stage the manifest without replacing its current version."""
    stable = json.loads(path.read_text(encoding="utf-8"))
    updated = merge_desktop_download_manifest(stable, version, platforms)
    return stage_stable_manifest(path, updated)


def require_version_advance(version, pages, already_published_tag=None):
    """Advance stable versions, except a retry of the exact already-published tag."""
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        stop("Published release inventory is invalid")
    candidate = require_client_version(version)
    matching_tag_count = 0
    for page in pages:
        for release in page:
            if not isinstance(release, dict):
                stop("Published release record is invalid")
            if release.get("draft") is True or release.get("prerelease") is True:
                continue
            if release.get("draft") is not False or release.get("prerelease") is not False:
                stop("Published release status is ambiguous")
            tag = release.get("tag_name")
            prior = parse_client_version(tag[1:]) if isinstance(tag, str) and tag.startswith('v') else None
            if prior is None:
                stop("Published stable release has no comparable semantic version")
            if candidate < prior:
                stop("Desktop stable version must advance beyond every published stable release")
            if candidate == prior:
                if tag != already_published_tag:
                    stop("Desktop stable version must advance beyond every published stable release; this version already belongs to another published release")
                matching_tag_count += 1
    if matching_tag_count > 1:
        stop("Published release inventory contains duplicate candidate versions")
    if already_published_tag is not None and matching_tag_count != 1:
        stop("Published release inventory does not contain the exact candidate tag")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", help="Existing desktop candidate tag, for example v0.2.1")
    parser.add_argument("--acceptance-report", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if not isinstance(args.tag, str) or not args.tag.startswith('v') or parse_client_version(args.tag[1:]) is None:
        stop("Expected a stable semantic-version tag such as v0.2.1")

    report = json.loads(args.acceptance_report.read_text())
    if not isinstance(report, dict) or not isinstance(report.get("platforms"), dict):
        stop("Acceptance report must contain an object with per-platform evidence")
    source_commit = report.get("sourceCommit")
    version = args.tag[1:]
    platforms = report["platforms"]
    if not has_schema_version_1(report) or report.get("complete") is not True:
        stop("Complete unified acceptance report required; candidate remains draft")
    if not re.fullmatch(r"[a-f0-9]{40}", str(source_commit or "")):
        stop("Acceptance report must pin the complete source commit")
    if report.get("version") != version:
        stop("Acceptance version differs from requested desktop release")
    if type(report.get("versionCode")) is not int:
        stop("Acceptance report must include the native integer versionCode")
    root = pathlib.Path(__file__).resolve().parents[1]
    native_manifest = json.loads((root / "app/src/manifest.json").read_text(encoding="utf-8"))
    require_source_manifest_version(native_manifest, version, report["versionCode"])
    tauri_config = json.loads((root / "desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    require_desktop_package_version(tauri_config, version)
    if any(not isinstance(platforms.get(name), dict) or platforms[name].get("status") != "passed"
           for name in REQUIRED_RELEASE_PLATFORMS):
        stop("Unified acceptance is incomplete; desktop release remains draft")
    require_platform_evidence(platforms, REQUIRED_RELEASE_PLATFORMS)
    require_iphone_acceptance(platforms)

    release = gh_json(f"repos/{REPO}/releases/tags/{args.tag}")
    if type(release.get("draft")) is not bool or release.get("prerelease") is not False:
        stop("Expected a draft or already-published non-prerelease candidate")
    already_published = release["draft"] is False
    commit = gh_json(f"repos/{REPO}/commits/{args.tag}").get("sha")
    if commit != source_commit:
        stop("Candidate tag does not resolve to the accepted source commit")
    assets = release.get("assets")
    if not isinstance(assets, list):
        stop("Release asset list is invalid")
    by_name = {}
    for asset in assets:
        name = asset.get("name") if isinstance(asset, dict) else None
        if isinstance(name, str):
            if name in by_name:
                stop(f"Duplicate release asset: {name}")
            by_name[name] = asset
    if "latest.json" not in by_name:
        stop("Verified desktop latest.json is missing; candidate remains draft")

    verified_downloads = {}
    with tempfile.TemporaryDirectory(prefix="hiking-desktop-release-") as temporary:
        work = pathlib.Path(temporary)
        subprocess.run(["gh", "release", "download", args.tag, "--repo", REPO,
                        "--pattern", "latest.json", "--dir", str(work)], check=True)
        manifest = json.loads((work / "latest.json").read_text())
        if not isinstance(manifest, dict) or manifest.get("version") != version or not isinstance(manifest.get("platforms"), dict):
            stop("Desktop updater manifest version or platform map is invalid")
        for platform, suffix in PLATFORMS.items():
            report_key = DESKTOP_REPORT_KEYS[platform]
            expected_sha = platforms[report_key].get("updaterArtifactSha256")
            if not isinstance(expected_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_sha):
                stop(f"Acceptance report must pin the tested updater artifact SHA-256 for {report_key}")
            entry = manifest["platforms"].get(platform)
            if not isinstance(entry, dict) or not isinstance(entry.get("signature"), str) or not entry["signature"].strip():
                stop(f"Updater manifest entry is missing for {platform}")
            url = entry.get("url")
            parsed = urlsplit(url) if isinstance(url, str) else None
            parts = [unquote(part) for part in parsed.path.split("/")] if parsed else []
            if (not parsed or parsed.scheme != "https" or parsed.hostname != "github.com"
                    or parsed.username or parsed.password or parsed.port
                    or parsed.query or parsed.fragment
                    or len(parts) != 7 or parts[1:5] != ["hiking-earth", "clients", "releases", "download"]
                    or parts[-3:-1] != ["download", args.tag]):
                stop(f"Updater URL is not pinned to release {args.tag}: {platform}")
            artifact_name = parts[-1]
            if pathlib.PurePosixPath(artifact_name).name != artifact_name or not artifact_name.endswith(suffix):
                stop(f"Unexpected updater artifact name for {platform}")
            signature_name = artifact_name + ".sig"
            artifact_meta, signature_meta = by_name.get(artifact_name), by_name.get(signature_name)
            if not artifact_meta or not signature_meta:
                stop(f"Release is missing updater artifact or signature for {platform}")
            # Draft assets can use GitHub's temporary untagged URL; the
            # manifest above is pinned to the final tag and exact asset name.
            subprocess.run(["gh", "release", "download", args.tag, "--repo", REPO,
                            "--pattern", artifact_name, "--pattern", signature_name,
                            "--dir", str(work)], check=True)
            subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("check-package-budget.py")),
                            str(work / artifact_name)], check=True, capture_output=True, text=True)
            signature_file = work / signature_name
            if signature_file.read_text().strip() != entry["signature"].strip():
                stop(f"Updater signature differs from the signed release asset for {platform}")
            verified = subprocess.run(["node", str(root / "scripts/verify-desktop-updater.mjs"), str(work / artifact_name)],
                                      check=True, capture_output=True, text=True)
            verification = json.loads(verified.stdout)
            if (verification.get("signatureVerified") is not True
                    or verification.get("sha256") != expected_sha
                    or verification.get("size") != artifact_meta.get("size")):
                stop(f"Release asset differs from the updater artifact accepted for {report_key}")
            verified_downloads[report_key] = {
                "url": entry["url"],
                "sha256": expected_sha,
                "size": artifact_meta["size"],
            }

        inventory = gh_json(f"repos/{REPO}/releases?per_page=100", "--paginate", "--slurp")
        require_version_advance(version, inventory, args.tag if already_published else None)
        # Validate and durably stage every local manifest change before the
        # irreversible GitHub publication request. A bad stable.json or a
        # local disk write failure must leave the candidate as a draft.
        stable_path = root / "shared/releases/stable.json"
        stable_before = stable_path.read_bytes()
        staged_stable_path = prepare_stable_manifest(stable_path, version, verified_downloads)
        try:
            patch_args = ("-f", "make_latest=true") if already_published else ("-F", "draft=false", "-f", "make_latest=true")
            published = gh_json(f"repos/{REPO}/releases/{release['id']}", "-X", "PATCH", *patch_args)
            if published.get("draft") is not False or published.get("tag_name") != args.tag:
                stop("GitHub did not confirm publication; inspect release state before retrying")
            published_assets = {a.get("name"): a for a in published.get("assets", [])}
            for platform in PLATFORMS:
                entry = manifest["platforms"][platform]
                name = unquote(urlsplit(entry["url"]).path.rsplit("/", 1)[-1])
                if published_assets.get(name, {}).get("browser_download_url") != entry["url"]:
                    stop(f"Published updater URL differs for {platform}; inspect release before retrying")
            latest = gh_json(f"repos/{REPO}/releases/latest")
            if latest.get("tag_name") != args.tag:
                stop("Release published, but GitHub latest channel does not point to the accepted tag")
            if stable_path.read_bytes() != stable_before:
                stop("Stable manifest changed during promotion; inspect the published release and reconcile manually")
            os.replace(staged_stable_path, stable_path)
            staged_stable_path = None
        finally:
            if staged_stable_path is not None:
                staged_stable_path.unlink(missing_ok=True)
    print(f"Published verified desktop release {args.tag} from {source_commit}")


if __name__ == "__main__":
    main()
