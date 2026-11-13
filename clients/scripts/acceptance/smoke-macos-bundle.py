#!/usr/bin/env python3
"""Launch a packaged macOS app briefly and preserve bounded smoke evidence."""

import hashlib
import json
import os
import pathlib
import signal
import subprocess
import tempfile


bundles = [bundle.resolve() for bundle in pathlib.Path(os.environ["APP_BUNDLE_DIR"]).glob("*.app")]
if len(bundles) != 1:
    raise SystemExit("Expected exactly one packaged macOS application")

binary = bundles[0] / "Contents" / "MacOS" / "hiking-earth-desktop"
if not binary.is_file():
    raise SystemExit("Packaged macOS executable is missing")

result = {
    "schemaVersion": 1,
    "sourceCommit": os.environ["GITHUB_SHA"],
    "platform": os.environ["BUILD_TARGET"],
    "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
    "scope": "Packaged application process launch only, not UI or business acceptance",
    "observedSeconds": 20,
    "passed": False,
}
process = None
try:
    with tempfile.TemporaryDirectory(prefix="hiking-earth-mac-smoke-") as home:
        process = subprocess.Popen(
            [str(binary)],
            cwd=str(bundles[0].parent),
            env={**os.environ, "HOME": home},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            process.wait(timeout=result["observedSeconds"])
            result["exitCode"] = process.returncode
            raise RuntimeError("Packaged application exited during launch observation")
        except subprocess.TimeoutExpired:
            result["passed"] = True
finally:
    if process is not None and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    result["cleanupSucceeded"] = process is None or process.poll() is not None
    evidence = pathlib.Path("runtime-evidence/macos-launch.json")
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps(result, indent=2) + "\n")

if not result["passed"] or not result["cleanupSucceeded"]:
    raise SystemExit("Packaged macOS launch check failed")
