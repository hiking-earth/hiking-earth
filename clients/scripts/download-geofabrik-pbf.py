#!/usr/bin/env python3
"""Download a pinned Geofabrik PBF with resumable, verified HTTP ranges."""
import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

HOSTS = {"download.geofabrik.de", "download.openstreetmap.fr"}
USER_AGENT = "HikingEarthPbfFetcher/1.0 (+https://github.com/hiking-earth/clients)"
MAX_BYTES = 20 * 1024 * 1024 * 1024
MAX_CHECKSUM_BYTES = 4096


def valid_url(value):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "https" and parsed.hostname in HOSTS
                and not parsed.username and not parsed.password
                and parsed.port is None and not parsed.query and not parsed.fragment)
    except (TypeError, ValueError):
        return False


def request(url, headers=None):
    response = urlopen(Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})}), timeout=45)
    if (not valid_url(response.geturl())
            or urlsplit(response.geturl()).hostname != urlsplit(url).hostname):
        response.close()
        raise ValueError("PBF source redirected outside the approved HTTPS extract hosts")
    return response


def discover_size(url):
    with request(url, {"Range": "bytes=0-0", "Accept-Encoding": "identity"}) as response:
        if response.status != 206 or response.headers.get("Content-Range") is None:
            raise ValueError("Geofabrik did not honor the one-byte range request")
        match = re.fullmatch(r"bytes 0-0/([1-9][0-9]*)", response.headers["Content-Range"].strip())
        if not match or len(response.read(2)) != 1:
            raise ValueError("Geofabrik range metadata is malformed")
        size = int(match.group(1))
    if size > MAX_BYTES:
        raise ValueError(f"PBF exceeds {MAX_BYTES} byte safety limit")
    return size


def fetch_md5(url):
    with request(url, {"Accept-Encoding": "identity"}) as response:
        raw = response.read(MAX_CHECKSUM_BYTES + 1)
    if len(raw) > MAX_CHECKSUM_BYTES:
        raise ValueError("Geofabrik checksum sidecar exceeds limit")
    match = re.fullmatch(rb"\s*([a-fA-F0-9]{32})\s+\*?([^\s]+)\s*", raw)
    if not match:
        raise ValueError("Geofabrik MD5 sidecar format is not recognized")
    return match.group(1).decode("ascii").lower()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def fetch_chunk(url, fd, start, end, total, attempts):
    expected = end - start + 1
    last_error = None
    for attempt in range(attempts):
        try:
            with request(url, {"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"}) as response:
                content_range = f"bytes {start}-{end}/{total}"
                if response.status != 206 or response.headers.get("Content-Range", "").strip() != content_range:
                    raise ValueError(f"server returned an unexpected range for bytes {start}-{end}")
                data = response.read(expected + 1)
            if len(data) != expected:
                raise IOError(f"short range {start}-{end}: received {len(data)} of {expected} bytes")
            offset = 0
            while offset < len(data):
                written = os.pwrite(fd, data[offset:], start + offset)
                if written <= 0:
                    raise OSError("PBF range write made no progress")
                offset += written
            return hashlib.sha256(data).hexdigest()
        except (OSError, TimeoutError, ValueError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(f"range {start}-{end} failed after {attempts} attempts: {last_error}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Pinned OSM .osm.pbf URL from an approved extract host")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--md5-url", help="Provider MD5 sidecar; defaults to URL + .md5")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--chunk-mib", type=int, default=8)
    parser.add_argument("--attempts", type=int, default=3, help="Attempts per range before preserving state and stopping")
    parser.add_argument("--rounds", type=int, default=1,
                        help="Split at most three per-range attempts across bounded rounds")
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES,
                        help="Reject larger extracts before allocating a partial download")
    args = parser.parse_args()
    if not valid_url(args.url) or not args.url.lower().endswith(".osm.pbf"):
        parser.error("--url must be a pinned HTTPS .osm.pbf URL on download.geofabrik.de or download.openstreetmap.fr")
    checksum_url = args.md5_url or (args.url + ".md5")
    if not valid_url(checksum_url):
        parser.error("--md5-url must be HTTPS on an approved extract host")
    if type(args.workers) is not int or not 1 <= args.workers <= 12:
        parser.error("--workers must be 1..12")
    if type(args.chunk_mib) is not int or not 1 <= args.chunk_mib <= 32:
        parser.error("--chunk-mib must be 1..32")
    if type(args.attempts) is not int or not 1 <= args.attempts <= 3:
        parser.error("--attempts must be 1..3")
    if type(args.rounds) is not int or not 1 <= args.rounds <= args.attempts:
        parser.error("--rounds must be 1..attempts (at most 3)")
    if type(args.max_bytes) is not int or not 1 <= args.max_bytes <= MAX_BYTES:
        parser.error(f"--max-bytes must be 1..{MAX_BYTES}")

    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    part = output.with_name(output.name + ".part")
    state_path = output.with_name(output.name + ".download.json")
    lock_path = output.with_name(output.name + ".lock")
    chunk_size = args.chunk_mib * 1024 * 1024
    with lock_path.open("a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SystemExit("Another download already owns this output path") from exc
        if output.exists():
            raise SystemExit("Output already exists; preserve it and choose a new path")

        size = discover_size(args.url)
        if size > args.max_bytes:
            raise SystemExit(f"PBF is {size} bytes; configured source cap is {args.max_bytes} bytes")
        expected_md5 = fetch_md5(checksum_url)
        required_free = size + 128 * 1024 * 1024
        if shutil.disk_usage(output.parent).free < required_free:
            raise SystemExit(f"Insufficient free space; need {required_free} bytes")
        config = {"schemaVersion": 1, "url": args.url, "bytes": size,
                  "md5": expected_md5, "chunkBytes": chunk_size}
        if state_path.exists():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if not isinstance(state, dict) or any(state.get(key) != value for key, value in config.items()):
                raise SystemExit("Existing checkpoint does not match this URL/size/checksum/chunk size; preserved")
            chunks = state.get("chunks")
            count = (size + chunk_size - 1) // chunk_size
            if (not isinstance(chunks, dict)
                    or any(not str(key).isdecimal() or not 0 <= int(key) < count
                           or not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value)
                           for key, value in chunks.items())):
                raise SystemExit("Invalid checkpoint; preserved")
            if not part.is_file() or part.stat().st_size != size:
                raise SystemExit("Checkpoint exists but partial file is missing or has wrong size; preserved")
        else:
            if part.exists():
                raise SystemExit("Orphan partial file exists without a checkpoint; preserved for inspection")
            chunks = {}
            count = (size + chunk_size - 1) // chunk_size
            with part.open("wb") as partial:
                partial.truncate(size)
                partial.flush()
                os.fsync(partial.fileno())
            state = {**config, "chunks": chunks}
            atomic_json(state_path, state)

        fd = os.open(part, os.O_RDWR)
        try:
            count = (size + chunk_size - 1) // chunk_size
            for round_index in range(args.rounds):
                pending = []
                for index in range(count):
                    start = index * chunk_size
                    end = min(start + chunk_size, size) - 1
                    known = chunks.get(str(index))
                    if isinstance(known, str) and re.fullmatch(r"[a-f0-9]{64}", known):
                        existing = os.pread(fd, end - start + 1, start)
                        if len(existing) == end - start + 1 and hashlib.sha256(existing).hexdigest() == known:
                            continue
                    chunks.pop(str(index), None)
                    pending.append((index, start, end))
                if not pending:
                    break
                print(f"round {round_index + 1}/{args.rounds}: verified={count - len(pending)}/{count}; pending={len(pending)}", flush=True)
                with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                    futures = {pool.submit(fetch_chunk, args.url, fd, start, end, size, max(1, args.attempts // args.rounds)): (index, start, end)
                               for index, start, end in pending}
                    completed = 0
                    try:
                        for future in concurrent.futures.as_completed(futures):
                            index, start, end = futures[future]
                            try:
                                chunks[str(index)] = future.result()
                            except Exception as exc:
                                print(f"range {index + 1}/{count} pending after retries: {exc}", flush=True)
                                continue
                            completed += 1
                            state["chunks"] = chunks
                            atomic_json(state_path, state)
                            print(f"range {index + 1}/{count} saved ({completed}/{len(pending)} this round)", flush=True)
                    finally:
                        state["chunks"] = chunks
                        atomic_json(state_path, state)
                if len(chunks) < count and round_index + 1 < args.rounds:
                    time.sleep(15 * (round_index + 1))
            os.fsync(fd)
        except BaseException:
            raise
        finally:
            os.close(fd)

        if len(chunks) != count:
            raise SystemExit(f"{count-len(chunks)} PBF ranges remain; successful ranges are checkpointed")
        actual_md5 = hashlib.md5(usedforsecurity=False)
        actual_sha256 = hashlib.sha256()
        with part.open("rb") as source:
            for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                actual_md5.update(block)
                actual_sha256.update(block)
        if actual_md5.hexdigest() != expected_md5:
            raise SystemExit("Full PBF MD5 differs from Geofabrik sidecar; partial and checkpoint preserved")
        state["sha256"] = actual_sha256.hexdigest()
        state["verifiedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        state["downloadStatus"] = "verified"
        atomic_json(state_path, state)
        os.replace(part, output)
        print(json.dumps({"output": str(output), "bytes": size, "md5": expected_md5,
                          "sha256": state["sha256"], "checkpoint": str(state_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
