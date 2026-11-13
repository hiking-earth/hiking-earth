#!/usr/bin/env python3
"""Collect licensed Wikimedia Commons image candidates for later human review.

This tool never downloads image bytes and never writes to the approved image
catalog. Commons metadata is user-supplied and is not proof of all image rights.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "HikingEarth/0.2 (https://hiking-earth.nanyu20050927.chatgpt.site; contact: 2308582955@qq.com)"
MAX_QUERIES = 81
MAX_RESULTS_PER_QUERY = 20
MAX_RESPONSE_BYTES = 2_000_000
MAX_REQUEST_ATTEMPTS = 3
RETRYABLE_HTTP_STATUSES = {408, 500, 502, 503, 504}
ALLOWED_LICENSES: dict[str, tuple[str, set[str]]] = {
    "https://creativecommons.org/licenses/by/4.0/": ("CC BY 4.0", {"creative commons attribution 4.0 international"}),
    "https://creativecommons.org/licenses/by-sa/4.0/": ("CC BY-SA 4.0", {
        "creative commons attribution-share alike 4.0 international",
        "creative commons attribution-sharealike 4.0 international",
    }),
    "https://creativecommons.org/licenses/by/3.0/": ("CC BY 3.0", {"creative commons attribution 3.0 unported"}),
    "https://creativecommons.org/licenses/by-sa/3.0/": ("CC BY-SA 3.0", {
        "creative commons attribution-share alike 3.0 unported",
        "creative commons attribution-sharealike 3.0 unported",
    }),
    "https://creativecommons.org/publicdomain/zero/1.0/": ("CC0 1.0", {"cc0 1.0 universal"}),
}


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain_text(value: Any, limit: int = 1200) -> str:
    if not isinstance(value, str):
        return ""
    parser = _TextOnly()
    parser.feed(value)
    return " ".join(" ".join(parser.parts).split())[:limit]


def safe_url(value: Any, expected_host: str) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        return ""
    try:
        parsed = urlparse(value.strip())
        port = parsed.port
    except ValueError:
        return ""
    if parsed.scheme != "https" or parsed.hostname != expected_host or parsed.username or parsed.password or port:
        return ""
    return value.strip()


def _metadata_value(metadata: dict[str, Any], key: str) -> str:
    item = metadata.get(key)
    return plain_text(item.get("value")) if isinstance(item, dict) else ""


def license_record(metadata: dict[str, Any]) -> dict[str, str] | None:
    short_name = _metadata_value(metadata, "LicenseShortName").casefold()
    usage_terms = _metadata_value(metadata, "UsageTerms").casefold()
    license_url = _metadata_value(metadata, "LicenseUrl")
    if not license_url.endswith("/"):
        license_url += "/"
    allowed = ALLOWED_LICENSES.get(license_url)
    if not allowed:
        return None
    canonical_short, accepted_terms = allowed
    if short_name != canonical_short.casefold() or usage_terms not in accepted_terms:
        return None
    return {"name": canonical_short, "url": license_url}


def candidate_from_page(page: dict[str, Any], region: str, match_regions: list[str], query: str) -> dict[str, Any] | None:
    if page.get("ns") != 6 or not isinstance(page.get("pageid"), int):
        return None
    title = page.get("title")
    if not isinstance(title, str) or not title.startswith("File:") or len(title) > 512:
        return None
    info_rows = page.get("imageinfo")
    if not isinstance(info_rows, list) or not info_rows or not isinstance(info_rows[0], dict):
        return None
    info = info_rows[0]
    mime = info.get("mime")
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        return None
    thumb_url = safe_url(info.get("thumburl") or info.get("url"), "upload.wikimedia.org")
    file_sha1 = info.get("sha1")
    if not thumb_url or not isinstance(file_sha1, str) or not re.fullmatch(r"[a-f0-9]{40}", file_sha1):
        return None
    ext = info.get("extmetadata")
    if not isinstance(ext, dict):
        return None
    license_info = license_record(ext)
    if not license_info:
        return None
    author = _metadata_value(ext, "Artist")
    if not author:
        return None
    page_title = quote(title.replace(" ", "_"), safe=":_()-.,')")
    source_url = f"https://commons.wikimedia.org/wiki/{page_title}"
    image_id = f"commons-{page['pageid']}-{file_sha1[:12]}"
    return {
        "id": image_id,
        "region": region,
        "regions": [region],
        "matchRegions": match_regions,
        "title": _metadata_value(ext, "ObjectName") or title.removeprefix("File:"),
        "imageUrl": thumb_url,
        "sourceUrl": source_url,
        "author": author,
        "license": license_info["name"],
        "licenseUrl": license_info["url"],
        "description": _metadata_value(ext, "ImageDescription"),
        "changes": "未编辑原图；如需裁切或修改，必须记录变更并遵守对应许可。",
        "fileSha1": file_sha1,
        "checkedAt": datetime.now(timezone.utc).date().isoformat(),
        "reviewStatus": "pending-human-review",
        "reviewRequired": ["核对文件页与摄影者", "核对景观确属该地区", "检查人物/隐私及其他权利", "确认署名和展示范围"],
        "discoveryQuery": query,
        "discoveryQueries": [query],
        "autoPublish": False,
    }


def load_config(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schemaVersion") != 1 or not isinstance(data.get("queries"), list):
        raise ValueError("scenic image query config schema is invalid")
    queries = data["queries"]
    if not queries or len(queries) > MAX_QUERIES:
        raise ValueError(f"query count must be between 1 and {MAX_QUERIES}")
    seen: set[str] = set()
    for item in queries:
        if not isinstance(item, dict):
            raise ValueError("query entry must be an object")
        region, query, aliases = item.get("region"), item.get("query"), item.get("matchRegions")
        if not isinstance(region, str) or not region.strip() or len(region) > 120:
            raise ValueError("query entry region is invalid")
        if not isinstance(query, str) or not query.strip() or len(query) > 180:
            raise ValueError("query entry search text is invalid")
        if not isinstance(aliases, list) or not aliases or len(aliases) > 20 or any(not isinstance(v, str) or not v.strip() or len(v) > 120 for v in aliases):
            raise ValueError("query entry matchRegions is invalid")
        key = region.strip().casefold()
        if key in seen:
            raise ValueError(f"duplicate region query: {region}")
        seen.add(key)
    return queries


def search_commons(query: str) -> list[dict[str, Any]]:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrsearch": query,
        "gsrlimit": str(MAX_RESULTS_PER_QUERY),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|sha1|mime",
        "iiurlwidth": "1600",
    }
    request = Request(f"{API_URL}?{urlencode(params)}", headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(MAX_REQUEST_ATTEMPTS):
        try:
            with urlopen(request, timeout=20) as response:
                if response.status != 200:
                    if response.status in RETRYABLE_HTTP_STATUSES and attempt + 1 < MAX_REQUEST_ATTEMPTS:
                        time.sleep(min(2 ** attempt, 4))
                        continue
                    raise RuntimeError(f"Commons API returned HTTP {response.status}")
                payload = response.read(MAX_RESPONSE_BYTES + 1)
            break
        except HTTPError as error:
            # A 403 or 429 is an explicit policy/throttling response. Stop the
            # batch rather than retrying and making the upstream load worse.
            if error.code in {403, 429}:
                retry_after = error.headers.get("Retry-After", "") if error.headers else ""
                suffix = f"; Retry-After={retry_after}" if retry_after else ""
                error.close()
                raise RuntimeError(f"Commons API returned HTTP {error.code}{suffix}; stopping this batch") from error
            if error.code in RETRYABLE_HTTP_STATUSES and attempt + 1 < MAX_REQUEST_ATTEMPTS:
                error.close()
                time.sleep(min(2 ** attempt, 4))
                continue
            error.close()
            raise RuntimeError(f"Commons API returned HTTP {error.code}") from error
        except (URLError, TimeoutError, OSError) as error:
            if attempt + 1 < MAX_REQUEST_ATTEMPTS:
                time.sleep(min(2 ** attempt, 4))
                continue
            raise RuntimeError(f"Commons API request failed after {MAX_REQUEST_ATTEMPTS} attempts: {error}") from error
    else:
        raise RuntimeError(f"Commons API request failed after {MAX_REQUEST_ATTEMPTS} attempts")
    if len(payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError("Commons API response exceeds 2 MB")
    data = json.loads(payload.decode("utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("Commons API payload is not an object")
    if isinstance(data.get("error"), dict):
        code = data["error"].get("code", "unknown")
        info = plain_text(data["error"].get("info"), 240)
        raise RuntimeError(f"Commons API error {code}: {info}")
    query_data = data.get("query", {})
    if not isinstance(query_data, dict):
        raise RuntimeError("Commons API query payload is invalid")
    pages = query_data.get("pages", [])
    if not isinstance(pages, list):
        raise RuntimeError("Commons API pages payload is invalid")
    return pages


def merge_existing(previous_path: Path, fresh: list[dict[str, Any]]) -> list[dict[str, Any]]:
    previous: list[dict[str, Any]] = []
    if previous_path.exists():
        data = json.loads(previous_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("schemaVersion") != 1 or not isinstance(data.get("candidates"), list):
            raise ValueError("existing scenic image candidate queue is malformed; refusing to overwrite")
        # Keep the full review history, including approved/rejected decisions and
        # records no longer returned by search. Discovery must never erase a
        # human decision merely because an item was absent from one API response.
        if any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in data["candidates"]):
            raise ValueError("existing scenic image candidate queue contains invalid entries; refusing to overwrite")
        previous = data["candidates"]
    merged = {item["id"]: item for item in previous if isinstance(item.get("id"), str)}
    for item in fresh:
        old = merged.get(item["id"], {})
        combined = {**old, **item}
        combined["firstSeenAt"] = old.get("firstSeenAt", item["checkedAt"])
        # Preserve reviewer-owned fields and decision state when a candidate is
        # rediscovered; machine metadata refreshes must not undo human review.
        for key in ("reviewStatus", "reviewedAt", "reviewedBy", "reviewNotes", "decision", "decisionReason", "manualOverrides"):
            if key in old:
                combined[key] = old[key]
        array_fields = {
            "regions": (old.get("regions", [old.get("region")] if isinstance(old.get("region"), str) else []), item.get("regions", [])),
            "matchRegions": (old.get("matchRegions", []), item.get("matchRegions", [])),
            "discoveryQueries": ([old.get("discoveryQuery")] if isinstance(old.get("discoveryQuery"), str) else [], item.get("discoveryQueries", [])),
        }
        for key, (old_values, new_values) in array_fields.items():
            values: list[str] = []
            if not isinstance(old_values, list):
                old_values = []
            if not isinstance(new_values, list):
                new_values = []
            for value in (*old_values, *new_values):
                if isinstance(value, str) and value and value not in values:
                    values.append(value)
            if values:
                combined[key] = values
        combined["region"] = combined.get("regions", [item["region"]])[0]
        combined["matchRegions"] = combined.get("matchRegions", item["matchRegions"])
        combined["discoveryQuery"] = combined.get("discoveryQueries", [item["discoveryQuery"]])[0]
        material_fields = ("title", "imageUrl", "sourceUrl", "author", "license", "licenseUrl", "description", "fileSha1", "regions", "matchRegions", "discoveryQueries")
        material_change = not old or any(old.get(key) != combined.get(key) for key in material_fields)
        review_critical_fields = ("title", "imageUrl", "sourceUrl", "author", "license", "licenseUrl", "description", "fileSha1", "regions", "matchRegions")
        review_invalidated = bool(old.get("reviewStatus") and any(old.get(key) != combined.get(key) for key in review_critical_fields))
        combined["checkedAt"] = item["checkedAt"] if material_change else old.get("checkedAt", item["checkedAt"])
        combined["lastSeenAt"] = item["checkedAt"] if material_change else old.get("lastSeenAt", old.get("checkedAt", item["checkedAt"]))
        if review_invalidated:
            combined["previousReviewStatus"] = old["reviewStatus"]
            combined["reviewStatus"] = "pending-human-review"
            combined["reviewInvalidatedAt"] = item["checkedAt"]
            combined["reviewInvalidationReason"] = "Source, rights metadata, description, or region mapping changed; review again."
        combined["autoPublish"] = False
        merged[item["id"]] = combined
    return sorted(merged.values(), key=lambda item: (item.get("region", ""), item.get("title", ""), item.get("id", "")))


def merge_discovered_candidate(previous: dict[str, Any] | None, fresh: dict[str, Any]) -> dict[str, Any]:
    if previous is None:
        return fresh
    merged = {**previous, **fresh}
    for key in ("regions", "matchRegions", "discoveryQueries"):
        values: list[str] = []
        for source in (previous.get(key, []), fresh.get(key, [])):
            if isinstance(source, list):
                for value in source:
                    if isinstance(value, str) and value and value not in values:
                        values.append(value)
        merged[key] = values
    merged["region"] = merged["regions"][0]
    merged["discoveryQuery"] = merged["discoveryQueries"][0]
    return merged


def atomic_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        Path(temp_name).replace(path)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("shared/data/content/scenic-image-searches.json"))
    parser.add_argument("--output", type=Path, default=Path("shared/data/content/scenic-image-candidates.json"))
    args = parser.parse_args()
    queries = load_config(args.config)
    previous_data: dict[str, Any] | None = None
    if args.output.exists():
        previous_data = json.loads(args.output.read_text(encoding="utf-8"))
    fresh: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(queries):
        if index:
            time.sleep(1.0)
        pages = search_commons(item["query"].strip())
        for page in pages:
            candidate = candidate_from_page(page, item["region"].strip(), item["matchRegions"], item["query"].strip())
            if candidate:
                candidate_id = candidate["id"]
                fresh[candidate_id] = merge_discovered_candidate(fresh.get(candidate_id), candidate)
    candidates = merge_existing(args.output, list(fresh.values()))
    previous_candidates = previous_data.get("candidates") if isinstance(previous_data, dict) else None
    queue_changed = candidates != previous_candidates
    atomic_write(args.output, {
        "schemaVersion": 1,
        "generatedAt": (
            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            if queue_changed or not isinstance(previous_data, dict)
            else previous_data.get("generatedAt", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        ),
        "source": "Wikimedia Commons MediaWiki Action API; metadata candidates only",
        "licenseAllowlist": sorted(value[0] for value in ALLOWED_LICENSES.values()),
        "candidates": candidates,
        "publicationPolicy": "pending-human-review; candidate metadata alone never authorizes publication",
    })
    print(f"Collected {len(fresh)} license-filtered candidates; retained {len(candidates)} pending review items. Nothing was published or downloaded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
