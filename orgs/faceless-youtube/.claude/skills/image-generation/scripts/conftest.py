"""Shared TEST fixture support for the image-generation scripts (pytest auto-imports this).

P3 (2026-08-12) made the pre-gen review gate class-agnostic: a plate, environment, prop, crowd
exemplar, pose/expression primitive or in-batch card may not seed a scene without an all-pass
record in `<kit>/_staging/review.json`. Every batch fixture therefore needs the channel's standing
library to be REVIEWED, which is the normal state of a channel that has run its Pass-1 gate once.

`stamp_all_pass` writes exactly what `stamp_review.py --figures` would have written, in the shape
`forge.figure_review_record` reads. It lives here rather than in each test file so one definition
of "reviewed" serves every suite — a per-file copy is how the board and the gate drift apart.

The gate's REFUSALS are proved by tests that deliberately skip this helper (or stamp a failing or
stale record); the helper only supplies the reviewed baseline the other assertions assume.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forge          # the gate's own digest reader, so a fixture can never disagree with it


def _pngs(target):
    if os.path.isfile(target):
        return [target] if target.lower().endswith(".png") else []
    out = []
    for base, _dirs, files in os.walk(target):
        out.extend(os.path.join(base, f) for f in files if f.lower().endswith(".png"))
    return out


def stamp_all_pass(staging_dir, *targets, reviewer="fixture", date="2026-08-12", verdict="pass"):
    """Record an all-pass review verdict for every PNG under `targets` (files or dirs).

    Keyed by FILE STEM — the one key shape the store uses for every asset class — with
    `canonical_sha256` read off the bytes on disk, so the record is current by construction.
    Merges additively into any existing store, exactly as the real writer does. Returns the store.
    """
    path = os.path.join(staging_dir, "review.json")
    try:
        with open(path, encoding="utf-8") as f:
            store = json.load(f)
    except (OSError, ValueError):
        store = {}
    if not isinstance(store, dict):
        store = {}
    figures = store.setdefault("figures", {})
    for target in targets:
        if not target or not os.path.exists(target):
            continue
        for frame in _pngs(target):
            figures[os.path.splitext(os.path.basename(frame))[0]] = {
                "canonical_sha256": forge.frame_digest(frame),
                "expression_sha256": None,
                "verdicts": {"rig": verdict, "flat-cel-hazard": verdict},
                "reviewer": reviewer,
                "date": date,
            }
    os.makedirs(staging_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=1)
    return store


def stamp_kit(k, *extra):
    """The reviewed-channel baseline: every ref the kit ships, plus any per-test frames."""
    return stamp_all_pass(k.staging, os.path.join(k.kit, "refs"), *extra)
