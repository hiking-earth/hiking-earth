#!/usr/bin/env python3
"""Prepare a stable manifest from an already published, reviewed GitHub release.

This script never publishes a release or embeds credentials. It only updates the
local manifest after the supplied acceptance report matches the public release.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from release_acceptance import (require_iphone_acceptance, require_platform_evidence,
                                require_source_manifest_version, require_release_manifest_metadata,
                                require_desktop_updater_hashes, REQUIRED_RELEASE_PLATFORMS,
                                has_schema_version_1, require_client_version,
                                parse_client_version)


REPOSITORY = "hiking-earth/clients"
ANDROID_ASSET_LIMIT = 200 * 1024 * 1024


def stop(message: str) -> None:
    raise SystemExit(message)


def read_remote_json(*args: str) -> dict:
    return json.loads(subprocess.check_output(["gh", "api", *args], text=True))


def replace_manifest_atomically(output: pathlib.Path, payload: str) -> None:
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=output.parent,
                                         prefix=output.name + ".", suffix=".tmp", delete=False) as stream:
            temporary_path = pathlib.Path(stream.name)
            os.chmod(temporary_path, output.stat().st_mode & 0o777)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, output)
    except Exception:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag")
    parser.add_argument("--android-asset", required=True)
    parser.add_argument("--version-code", type=int, required=True)
    parser.add_argument("--ios-url")
    parser.add_argument("--acceptance-report", type=pathlib.Path, required=True)
    args = parser.parse_args()

    version = args.tag.removeprefix("v")
    version_parts = require_client_version(version)
    if args.version_code <= 0:
        stop("invalid release version")
    root = pathlib.Path(__file__).resolve().parents[1]
    native_manifest = json.loads((root / "app/src/manifest.json").read_text(encoding="utf-8"))
    require_source_manifest_version(native_manifest, version, args.version_code)
    if args.ios_url and not re.fullmatch(r"https://(?:apps\.apple\.com|testflight\.apple\.com)/[^\s]+", args.ios_url):
        stop("invalid iOS store entry")

    report = json.loads(args.acceptance_report.read_text(encoding="utf-8"))
    source_commit = report.get("sourceCommit")
    platforms = report.get("platforms")
    if (not has_schema_version_1(report) or report.get("complete") is not True
            or not isinstance(source_commit, str) or not re.fullmatch(r"[a-f0-9]{40}", source_commit)
            or not isinstance(platforms, dict)):
        stop("Complete acceptance report with pinned source commit required")
    if any(not isinstance(platforms.get(name), dict) or platforms[name].get("status") != "passed"
           for name in REQUIRED_RELEASE_PLATFORMS):
        stop("Unified acceptance is incomplete; stable manifest was not changed")
    require_platform_evidence(platforms, REQUIRED_RELEASE_PLATFORMS)
    require_desktop_updater_hashes(platforms)
    require_iphone_acceptance(platforms, args.ios_url)
    if (report.get("version") != version or type(report.get("versionCode")) is not int
            or report.get("versionCode") != args.version_code):
        stop("Acceptance version differs from requested release")

    release = read_remote_json("repos", REPOSITORY, "releases", "tags", args.tag)
    tag_commit = read_remote_json("repos", REPOSITORY, "commits", args.tag).get("sha")
    if tag_commit != source_commit:
        stop("Release tag differs from the accepted source commit")
    if release.get("draft") is not False or release.get("prerelease") is not False:
        stop("only a published stable release can be promoted")
    published_at, notes = require_release_manifest_metadata(release)
    assets = release.get("assets")
    if not isinstance(assets, list):
        stop("Release asset list is invalid")
    matches = [item for item in assets if isinstance(item, dict) and item.get("name") == args.android_asset]
    if len(matches) != 1:
        stop("Expected exactly one Android APK asset with the requested name")
    asset = matches[0]
    if (pathlib.Path(args.android_asset).name != args.android_asset or not args.android_asset.endswith(".apk")
            or not isinstance(asset.get("size"), int)
            or isinstance(asset.get("size"), bool)
            or asset["size"] <= 0 or asset["size"] > ANDROID_ASSET_LIMIT
            or not isinstance(asset.get("browser_download_url"), str)
            or not re.fullmatch(r"https://github\.com/hiking-earth/clients/releases/download/[^/]+/[^?#]+",
                                asset["browser_download_url"])):
        stop("APK asset metadata is invalid or exceeds the download limit")

    with tempfile.TemporaryDirectory(prefix="hiking-release-") as temporary:
        subprocess.run(["gh", "release", "download", args.tag, "--repo", REPOSITORY,
                        "--pattern", args.android_asset, "--dir", temporary], check=True)
        artifact_path = pathlib.Path(temporary) / args.android_asset
        data = artifact_path.read_bytes()
        if len(data) != asset["size"]:
            stop("asset size mismatch")
        subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("check-package-budget.py")),
                        str(artifact_path)], check=True)
        sha = hashlib.sha256(data).hexdigest()
        if sha != platforms["android"].get("artifactSha256"):
            stop("Published APK differs from the accepted Android artifact")

    output = root / "shared/releases/stable.json"
    prior = json.loads(output.read_text(encoding="utf-8"))
    if not has_schema_version_1(prior) or not isinstance(prior.get("ready"), bool):
        stop("Existing stable manifest is invalid; preserve it and repair manually")
    if prior["ready"]:
        previous_version = prior.get("version", "")
        previous_code = prior.get("versionCode")
        previous_parts = parse_client_version(previous_version)
        if (previous_parts is None
                or not isinstance(previous_code, int) or isinstance(previous_code, bool) or previous_code <= 0):
            stop("Existing published manifest version is invalid")
        if (version_parts <= previous_parts
                or args.version_code <= previous_code):
            stop("Stable release version and versionCode must both advance")

    prior.update({
        "schemaVersion": 1,
        "channel": "stable",
        "ready": True,
        "version": version,
        "versionCode": args.version_code,
        "publishedAt": published_at,
        "notes": notes,
        "android": {"url": asset["browser_download_url"], "sha256": sha, "size": len(data)},
        "ios": {"url": args.ios_url} if args.ios_url else None,
    })
    payload = json.dumps(prior, ensure_ascii=False, indent=2) + "\n"
    replace_manifest_atomically(output, payload)
    print("Prepared release manifest:", version, sha,
          "Commit only after unified acceptance; this does not publish a release.")


if __name__ == "__main__":
    main()
