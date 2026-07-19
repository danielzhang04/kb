#!/usr/bin/env python3
"""Fetch casual-comedic seed tracks from Incompetech (Kevin MacLeod, CC-BY) into audio/incoming/<bucket>/.
Direct mp3 URL pattern verified 2026-07-11. Idempotent; a 404/failed download is skipped + reported (G8).
Writes sources.json per bucket (provenance for the CC-BY credit line). Seeds are DATA (music-buckets.json)."""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BUCKETS = Path(__file__).parent.parent / "music-buckets.json"
ROOT = Path(__file__).resolve().parents[4]
_ARTIST = "Kevin MacLeod (incompetech.com)"


def track_url(name, template):
    return template.format(name=urllib.parse.quote(name))


def _download(url, dest, attempts=3):
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "music-forge/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) < 10000:      # a 404 HTML body, not an mp3
                return False
            dest.write_bytes(data); return True
        except Exception:
            if i == attempts - 1:
                return False
    return False


def fetch_bucket(bucket, cfg, out_dir, download=_download, template=None):
    template = template or "https://incompetech.com/music/royalty-free/mp3-royaltyfree/{name}.mp3"
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    saved, failed, sources = [], [], {}
    src_path = out_dir / "sources.json"
    if src_path.exists():
        sources = json.loads(src_path.read_text(encoding="utf-8"))
    for name in cfg.get("incompetech_seeds", []):
        dest = out_dir / f"{name}.mp3"
        ok = dest.exists() or download(track_url(name, template), dest)
        if ok:
            saved.append(name)
            sources[f"{name}.mp3"] = {"title": name, "artist": _ARTIST, "license": "CC-BY",
                                      "url": f"https://incompetech.com/music/royalty-free/index.html"}
        else:
            failed.append(name)
    src_path.write_text(json.dumps(sources, indent=2) + "\n", encoding="utf-8")
    return {"saved": saved, "failed": failed, "sources": sources}


def main(channel):
    cfg_all = json.loads(BUCKETS.read_text(encoding="utf-8"))
    tmpl = cfg_all["defaults"]["incompetech_url"]
    base = ROOT / "channels" / channel / "visual-kit" / "audio" / "incoming"
    for bucket, cfg in cfg_all["buckets"].items():
        res = fetch_bucket(bucket, cfg, base / bucket, template=tmpl)
        print(f"  {bucket}: saved {len(res['saved'])}, failed {res['failed']}")


if __name__ == "__main__":
    main(sys.argv[1])
