#!/usr/bin/env python3
"""Freesound APIv2 client for sfx-forge. Fetch is thin; parse is pure (testable, T2).
CC0 is enforced at query AND re-verified per result (T7). Key stays out of returned data (T6)."""
import json, ssl, sys, time, urllib.parse, urllib.request
from pathlib import Path

_FIELDS = "id,name,license,duration,previews,tags,username"
# Allowed licenses for monetized YouTube: CC0 (no attribution) + CC-BY (credit line in the description,
# no Content-ID). CC-BY-NC (NonCommercial) is EXCLUDED — not usable on a monetized channel (T7).
_LIC = {"cc0": "creativecommons.org/publicdomain/zero/1.0", "cc-by": "creativecommons.org/licenses/by/"}


def license_kind(result: dict) -> str:
    lic = result.get("license") or ""
    if _LIC["cc0"] in lic:
        return "cc0"
    if _LIC["cc-by"] in lic:      # by/3.0, by/4.0 — but NOT by-nc/... (that substring won't match 'by/')
        return "cc-by"
    return "other"


def is_allowed(result: dict) -> bool:
    """True for CC0 or CC-BY (both safe on monetized YouTube); False for NC / unknown (T7)."""
    return license_kind(result) in ("cc0", "cc-by")

# Windows Python doesn't use the OS cert store; Freesound's CDN chain fails default verification
# ("certificate has expired"). Point urllib at certifi's current CA bundle (fallback: default ctx).
try:
    import certifi
    _CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _CTX = None


def is_cc0(result: dict) -> bool:
    return license_kind(result) == "cc0"


def parse_search(payload: dict) -> list:
    out = []
    for r in payload.get("results", []):
        prev = (r.get("previews") or {}).get("preview-hq-mp3") or (r.get("previews") or {}).get("preview-lq-mp3")
        if not prev:
            continue
        out.append({"id": int(r["id"]), "name": r.get("name", ""), "license": r.get("license", ""),
                    "duration": float(r.get("duration", 0.0)), "preview_url": prev,
                    "tags": r.get("tags", []), "username": r.get("username", "")})
    return out


def _default_transport(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30, context=_CTX) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search(query, api_key, page_size=40, extra_filter="", _transport=None) -> list:
    transport = _transport or _default_transport
    filt = 'license:("Creative Commons 0" OR "Attribution")' + ((" " + extra_filter) if extra_filter else "")
    qs = urllib.parse.urlencode({"query": query, "filter": filt, "fields": _FIELDS,
                                 "page_size": page_size, "token": api_key})
    return parse_search(transport(f"https://freesound.org/apiv2/search/text/?{qs}"))


def download_preview(result, cache_dir, _opener=None, attempts=3):
    """Download the preview to <cache>/<id>.mp3. Idempotent (T3). Resilient: retries transient
    network errors with backoff, and returns None (never raises) on persistent failure so one bad
    download can't crash a whole multi-role run. Returns the Path on success."""
    cache_dir = Path(cache_dir); cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"{result['id']}.mp3"
    if dest.exists():
        return dest
    opener = _opener or (lambda u: urllib.request.urlopen(u, timeout=60, context=_CTX).read())
    for i in range(attempts):
        try:
            dest.write_bytes(opener(result["preview_url"]))
            return dest
        except Exception as e:
            if i == attempts - 1:
                sys.stderr.write(f"  ! download failed for #{result['id']} ({type(e).__name__}) — skipped\n")
                return None
            time.sleep(0.6 * (i + 1))
    return None
