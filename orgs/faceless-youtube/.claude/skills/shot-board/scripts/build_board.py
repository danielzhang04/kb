#!/usr/bin/env python3
"""build_board — the Gate-2 shot-board generator.

Reads a finished-storyboard video folder and writes ONE self-contained HTML page,
`<video_dir>/assets/board.html` (default; gitignored like all media-derived output). At
Gate 2 a human reviews every generated still against the script and the motion intent on
this single page: each shot card shows the downscaled scene still, the script lines it
covers, its motion intent, and — the point of the surface — the machine's honest
`review_status` badge (verified / parked+reasons / unreviewed) so a parked or unreviewed
frame can NEVER hide behind a pretty thumbnail.

The board is pure derivation: it reads shots.json, shots.motion.json, assets/library and
assets/scenes (+ their manifests) and emits HTML. It writes nothing else and reaches no
network — every image is inlined as a downscaled JPEG data-URI, CSS is embedded, no JS.
The orchestrator (not this script) publishes the file as the per-video Claude artifact.

Badge semantics MIRROR render.py::_entry_review_reason (the source of truth) — restated
here, never imported, so the two stay a checked pair:
  * review_status authoritative when present: "verified" → shippable; "parked" →
    parked + parked_reasons; anything else ("unreviewed"/unknown) → unreviewed.
  * review_status absent → legacy boolean gate: verified.scene AND verified.rig both true
    → verified, else unreviewed.
  * no manifest entry at all → unreviewed.

CLI:  py -3 build_board.py <video_dir> [-o out.html]

Stdlib + Pillow only. No network, ever.
"""
from __future__ import annotations

import argparse
import base64
import html
import io
import json
import sys
from pathlib import Path

from PIL import Image

THUMB_WIDTH = 480       # downscale target width (px) for the shot still
JPEG_QUALITY = 70       # PIL JPEG quality for the embedded data-URI


# --------------------------------------------------------------------------- #
# data loading
# --------------------------------------------------------------------------- #
def _load_json(path: Path):
    """Parsed JSON, or None if absent/unparseable (the board degrades, never crashes)."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _shots(shots_json: dict) -> list:
    """Long-form shots in story order. Tolerates a missing/oddly-shaped file."""
    if not isinstance(shots_json, dict):
        return []
    lf = shots_json.get("long_form") or {}
    shots = lf.get("shots") if isinstance(lf, dict) else None
    return shots if isinstance(shots, list) else []


def _index_by(items, key: str) -> dict:
    """{entry[key]: entry} for a list of dicts, skipping keyless entries."""
    out = {}
    for e in items or []:
        if isinstance(e, dict) and e.get(key):
            out[e[key]] = e
    return out


# --------------------------------------------------------------------------- #
# review badge — mirrors render.py::_entry_review_reason
# --------------------------------------------------------------------------- #
def review_badge(entry):
    """(status, reasons) for a scenes/manifest.json entry (or None for no entry).

    status ∈ {"verified", "parked", "unreviewed"}; reasons is the parked_reasons list
    (only non-empty for "parked"). See module docstring for the mirrored contract."""
    if not isinstance(entry, dict):
        return "unreviewed", []
    rs = entry.get("review_status")
    if rs is not None:
        if rs == "verified":
            return "verified", []
        if rs == "parked":
            reasons = entry.get("parked_reasons") or ["no reasons recorded"]
            return "parked", list(reasons)
        return "unreviewed", []
    v = entry.get("verified") or {}
    if v.get("scene") is True and v.get("rig") is True:
        return "verified", []
    return "unreviewed", []


def _lint_flags(entry) -> list:
    """Extra honesty signals worth surfacing next to the badge (never a crash source)."""
    flags = []
    if isinstance(entry, dict):
        if entry.get("flagged"):
            flags.append("flagged")
        if entry.get("blocking"):
            flags.append("blocking")
    return flags


# --------------------------------------------------------------------------- #
# imagery — downscaled JPEG data-URIs (self-contained, no external refs)
# --------------------------------------------------------------------------- #
def _resolve_scene_path(video_dir: Path, shot_id: str, entry) -> Path:
    """The still for a shot: manifest `file` (relative to video_dir) if present, else the
    scenes/<id>.png naming convention."""
    if isinstance(entry, dict):
        f = entry.get("file")
        if isinstance(f, str) and f:
            return video_dir / f
    return video_dir / "assets" / "scenes" / f"{shot_id}.png"


def image_data_uri(path: Path, max_width: int = THUMB_WIDTH,
                   quality: int = JPEG_QUALITY):
    """A downscaled JPEG `data:` URI for `path`, or None when the image is absent/invalid
    (the caller then renders a MISSING placeholder). Never raises."""
    try:
        if not path.exists():
            return None
        with Image.open(path) as im:
            im = im.convert("RGB")
            if im.width > max_width:
                h = max(1, round(im.height * max_width / im.width))
                im = im.resize((max_width, h), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=quality, optimize=True)
    except (OSError, ValueError):
        return None
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


# --------------------------------------------------------------------------- #
# motion intent — a plain-language restatement of shots.motion.json for a shot
# --------------------------------------------------------------------------- #
def motion_intent(entry) -> str:
    """Human-readable motion intent from a shots.motion.json shot entry. Camera is always
    locked in this project, so 'motion' == element-layer motion + background mode."""
    if not isinstance(entry, dict):
        return "hold (no motion plan entry)"
    bg = entry.get("background") or {}
    mode = bg.get("mode") if isinstance(bg, dict) else None
    layers = entry.get("layers") or []
    if mode == "delta-chain":
        base = "moving background (delta-chain)"
    elif mode == "plate":
        base = "static plate"
    else:
        base = f"background: {mode}" if mode else "static plate"
    if not layers:
        return f"hold · {base}"
    parts = []
    for lyr in layers:
        if not isinstance(lyr, dict):
            continue
        lid = lyr.get("id") or "layer"
        anim = lyr.get("animation") or {}
        atype = anim.get("type") if isinstance(anim, dict) else None
        parts.append(f"{lid}: {atype}" if atype else str(lid))
    return f"{base} · animated: " + ", ".join(parts) if parts else f"hold · {base}"


# --------------------------------------------------------------------------- #
# script-line coverage for a shot
# --------------------------------------------------------------------------- #
def covered_lines(shot: dict) -> str:
    """The script text this shot covers — the VO line(s), plus any on-screen text."""
    txt = (shot.get("vo_text") or shot.get("vo_ref") or "").strip()
    ost = (shot.get("on_screen_text") or "").strip()
    if ost:
        return (txt + f"  [on-screen: {ost}]").strip()
    return txt or "(no script line recorded)"


# --------------------------------------------------------------------------- #
# HTML rendering
# --------------------------------------------------------------------------- #
_CSS = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif;
  background: #0f1113; color: #e7e7e7; padding: 24px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: #9aa0a6; margin: 0 0 24px; font-size: 13px; }
h2 { font-size: 16px; margin: 28px 0 12px; border-bottom: 1px solid #2a2e33; padding-bottom: 6px; }
.cast { display: flex; flex-wrap: wrap; gap: 12px; }
.ref { width: 150px; background: #1a1d21; border: 1px solid #2a2e33; border-radius: 8px;
  padding: 8px; }
.ref img { width: 100%; border-radius: 4px; display: block; background: #000; }
.ref .rid { font-weight: 600; font-size: 12px; margin: 6px 0 2px; word-break: break-word; }
.ref .rdesc { font-size: 11px; color: #9aa0a6; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.card { background: #1a1d21; border: 1px solid #2a2e33; border-radius: 10px; overflow: hidden;
  display: flex; flex-direction: column; }
.card .still { width: 100%; display: block; background: #000; aspect-ratio: 16/9; object-fit: cover; }
.missing { width: 100%; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center;
  background: repeating-linear-gradient(45deg, #2a1416, #2a1416 12px, #351a1d 12px, #351a1d 24px);
  color: #ff9a9a; font-weight: 700; letter-spacing: 2px; }
.body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.hdr { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sid { font-weight: 700; font-size: 13px; }
.beat { font-size: 11px; color: #9aa0a6; }
.badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  text-transform: uppercase; letter-spacing: .5px; }
.badge.verified { background: #123a24; color: #7ee2a8; }
.badge.parked { background: #4a2410; color: #ffb27a; }
.badge.unreviewed { background: #3a2a10; color: #ffd97a; }
.flag { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px;
  background: #402; color: #ff9a9a; text-transform: uppercase; }
.reasons { margin: 0; padding-left: 18px; color: #ffb27a; font-size: 12px; }
.lines { font-size: 13px; color: #d7d7d7; }
.motion { font-size: 12px; color: #9aa0a6; }
.label { color: #6f757b; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
"""


def _e(s) -> str:
    return html.escape("" if s is None else str(s))


def _render_cast(video_dir: Path, library: dict) -> str:
    assets = library.get("assets") if isinstance(library, dict) else None
    cards = []
    for a in assets or []:
        if not isinstance(a, dict):
            continue
        rid = a.get("name") or a.get("id") or "(unnamed)"
        desc = a.get("notes") or a.get("description") or ""
        img_rel = a.get("file")
        uri = image_data_uri(video_dir / img_rel) if isinstance(img_rel, str) else None
        img = (f'<img src="{uri}" alt="{_e(rid)}">' if uri
               else '<div class="missing" style="border-radius:4px">MISSING</div>')
        cards.append(
            f'<div class="ref">{img}'
            f'<div class="rid">{_e(rid)}</div>'
            f'<div class="rdesc">{_e(desc)}</div></div>'
        )
    inner = "".join(cards) if cards else '<p class="sub">No library manifest found.</p>'
    return f'<section id="cast-props"><h2>Cast &amp; props</h2><div class="cast">{inner}</div></section>'


def _render_shot(video_dir: Path, shot: dict, motion_idx: dict, scenes_idx: dict) -> str:
    sid = shot.get("id") or "?"
    entry = scenes_idx.get(sid)
    status, reasons = review_badge(entry)
    flags = _lint_flags(entry)
    uri = image_data_uri(_resolve_scene_path(video_dir, sid, entry))
    still = (f'<img class="still" src="{uri}" alt="{_e(sid)}">' if uri
             else '<div class="still missing">MISSING</div>')
    flag_html = "".join(f'<span class="flag">{_e(f)}</span>' for f in flags)
    reasons_html = ""
    if reasons:
        reasons_html = ('<ul class="reasons">'
                        + "".join(f"<li>{_e(r)}</li>" for r in reasons)
                        + "</ul>")
    beat = shot.get("beat") or ""
    return (
        f'<article class="card" data-shot-id="{_e(sid)}">'
        f'{still}'
        f'<div class="body">'
        f'<div class="hdr"><span class="sid">{_e(sid)}</span>'
        f'<span class="beat">{_e(beat)}</span>'
        f'<span class="badge {status}">{status}</span>{flag_html}</div>'
        f'{reasons_html}'
        f'<div class="lines"><span class="label">covers</span> {_e(covered_lines(shot))}</div>'
        f'<div class="motion"><span class="label">motion</span> {_e(motion_intent(motion_idx.get(sid)))}</div>'
        f'</div></article>'
    )


def build_html(video_dir: Path) -> str:
    """The full self-contained board HTML for a video folder."""
    video_dir = Path(video_dir)
    slug = video_dir.name
    shots_json = _load_json(video_dir / "shots.json") or {}
    slug = shots_json.get("video_slug") or slug
    motion_json = _load_json(video_dir / "shots.motion.json") or {}
    scenes_manifest = _load_json(video_dir / "assets" / "scenes" / "manifest.json") or {}
    library = _load_json(video_dir / "assets" / "library" / "manifest.json") or {}

    shots = _shots(shots_json)
    motion_idx = _index_by(motion_json.get("shots") if isinstance(motion_json, dict) else [], "id")
    scenes_idx = _index_by(scenes_manifest.get("shots") if isinstance(scenes_manifest, dict) else [],
                           "shot_id")

    # Badge tally for the header summary.
    tally = {"verified": 0, "parked": 0, "unreviewed": 0}
    for sh in shots:
        st, _ = review_badge(scenes_idx.get(sh.get("id")))
        tally[st] = tally.get(st, 0) + 1

    cast_html = _render_cast(video_dir, library)
    shot_html = "".join(_render_shot(video_dir, sh, motion_idx, scenes_idx) for sh in shots)

    return (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{_e(slug)}</title><style>{_CSS}</style></head><body>"
        f"<h1>{_e(slug)} — shot board</h1>"
        f'<p class="sub">Gate 2 · {len(shots)} shots · '
        f'{tally["verified"]} verified · {tally["parked"]} parked · '
        f'{tally["unreviewed"]} unreviewed</p>'
        f"{cast_html}"
        f'<h2>Shots ({len(shots)})</h2><div class="shots">{shot_html}</div>'
        "</body></html>\n"
    )


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Build the Gate-2 shot board (self-contained board.html) for a video folder.")
    ap.add_argument("video_dir", help="path to channels/<name>/videos/<slug>/")
    ap.add_argument("-o", "--output", default=None,
                    help="output HTML path (default: <video_dir>/assets/board.html)")
    args = ap.parse_args(argv)

    video_dir = Path(args.video_dir)
    if not video_dir.is_dir():
        print(f"error: not a directory: {video_dir}", file=sys.stderr)
        return 2
    out = Path(args.output) if args.output else video_dir / "assets" / "board.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    html_doc = build_html(video_dir)
    out.write_text(html_doc, encoding="utf-8")
    size = out.stat().st_size
    print(f"wrote {out} ({size / 1_000_000:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
