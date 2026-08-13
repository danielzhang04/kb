#!/usr/bin/env python3
"""stamp_review.py — the honest three-state stamp writer.

The single fresh-eyes review pass for an act batch produces a MERGED ruling list at
`<video_dir>/assets/_review/merged.json`. This script is the ONLY writer of the render gate's
verdict: it converts those merged rulings into per-shot `review_status` on
`<video_dir>/assets/scenes/manifest.json`.

Why it exists: in fyt-run-001 the conductor hand-wrote `verified: true` on 119 defective frames
because honesty had no representation — a "parked" state didn't exist. Task 2 (df0c18e) gave the
manifest three states — `review_status: "unreviewed" | "verified" | "parked"` plus
`parked_reasons: [str]` — and taught `render.py`'s gate to ship only `verified` and to error
`"parked: <reasons>"` on parked. This script writes that field honestly from the review's own
rulings. **Generating agents never run it; the conductor/orchestrator runs it AFTER the review.**

Ruling -> status map:
  * a fully-clean ruling  -> `verified`   (parked_reasons: [])
  * ANY defect ruling     -> `parked`     with the ruling's defect strings as parked_reasons
  * ANY failed DSG-lite checklist item (`dsg`) -> `parked`, whatever the axis severities say

It never writes the legacy `verified: {scene, rig}` boolean shape. Entries the review did not
cover are left byte-identical. Layered shots reviewed via their plate/cutout (present in
merged.json but absent from the manifest) get a fresh entry created.

Usage (run with native `py -3`):
    py -3 stamp_review.py <video_dir>

Emits one summary line: `stamped: N verified, M parked`.

---

C-6 (2026-08-04 doctrine reset) extends this same single-writer script with a SECOND, independent
path: the verified-asset-reuse record store (`visual-kit/_staging/review.json`, one channel-wide
file, distinct from any video's `assets/scenes/manifest.json`). Forge's gate reads it before an
asset's pixels seed a scene slate; a missing/failed/stale record refuses rather than grandfathering
an unreviewed frame. This script remains the ONLY writer of that file too — a generating agent
never touches it.

P3 (2026-08-12) widened WHICH assets that store answers for: every class whose pixels seed a scene
— staged STEP-1 cards, place plates, environment references, props, the crowd exemplar, and
pose/expression primitives. Nothing about this merge changes for them. The record shape is the
same and the key is the asset frame's KIT-RELATIVE PATH (`forge.store_key`), which
`build_review_artifact.py` resolves once and this merge takes verbatim from its input. The kit is
the anchor because the store lives at `<kit>/_staging`: a repo-root-anchored key reads differently
in a worktree with no `.env` marker than in the primary checkout, so the board would write keys the
gate could not find. A file STEM was the key until 2026-08-13 and is not an identity — a video's
`assets/library/crowd-exemplar.png` and the channel's `refs/base/crowd-exemplar.png` were one
record. Any legacy key shape is migrated by DIGEST on the read below, and the migrated form lands
on disk with this write. The `"figures"` wrapper key is kept verbatim — renaming it would strand
every verdict already recorded. The one class outside the store is a named cast member's own
canonical, exempted by the G2 cast-mint ruling.

Usage:
    py -3 stamp_review.py --figures <input.json> <staging_dir>

`<input.json>` is the ASSET-VERDICTS INPUT — a fresh-eyes review pass's ruling on one or more
seeding assets, merged here, never written directly. It is produced by
`build_review_artifact.py --staging <kit>/_staging [--assets <frame.png> ...]`, which renders a
card per asset forge would refuse and writes this file as a SKELETON: every pending asset id, its
`canonical_sha256` already computed from the bytes on disk, and every verdict left EMPTY for the
pass to fill. That board + this merge are the two halves of the loop — without the merge, the next
batch refuses every asset the last one minted. Shape (a bare `{asset_id: record, ...}` mapping is
also accepted, no `"figures"` wrapper required):

    {"figures": {
      "<asset id — the frame's KIT-relative path: refs/env/prop-drive.png, _staging/fig-….png>": {
        "canonical_sha256": "<sha256 of the reviewed canonical PNG>",
        "expression_sha256": "<sha256 of the expression seed, or null>",
        "verdicts": {"<invariant-slug>": "pass|fail", ...},
        "reviewer": "fresh-eyes",
        "date": "YYYY-MM-DD"
      }
    }}

Each record REPLACES any prior entry for the same asset id wholesale (a re-review always
supersedes the one on file — same id, new sha/verdicts). A record missing a required field
(`canonical_sha256`, `verdicts`, `reviewer`, `date`) is skipped with a stderr warning; the rest of
the batch still merges. Output is normalized to exactly the shape above regardless of what extra
keys the input carries. `<staging_dir>/review.json` is created on first use; existing entries for
assets NOT present in this input are left untouched (additive merge, not a full-file replace).

Emits one summary line: `asset-review: N merged into <path>`.

This path is fully independent of the scene-stamping path above: different CLI form (`--figures`
first), different input, different output file, different store shape. The scene-stamping
behaviour above is byte-for-byte unchanged by this extension.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forge          # same skill, same dir: the gate's own store reader, never a second one

# Ruling axes: manifest/review shorthand -> human label used in parked_reasons.
_AXES = (("f", "fidelity"), ("s", "style"), ("r", "rig"))


def _ruling_id(ruling: dict):
    """The shot id a ruling addresses (merged.json uses `id`; tolerate `shot_id`)."""
    return ruling.get("id") or ruling.get("shot_id")


def _dsg_failures(ruling: dict):
    """The FAILED items of a ruling's DSG-lite checklist — the dependency-ordered decomposition of
    the assembled prompt into atomic facts (entities -> attributes -> relations -> lettering) that
    the fidelity judge answers one by one. Each item is
    `{id, parent, q, verdict: "pass"|"fail"|"skipped", note}`; only "fail" is a defect, because a
    "skipped" child was short-circuited by a parent that already carries one."""
    items = ruling.get("dsg")
    if not isinstance(items, list):
        return []
    out = []
    for it in items:
        if not isinstance(it, dict) or str(it.get("verdict", "")).lower() != "fail":
            continue
        label = it.get("q") or it.get("id") or "unnamed check"
        note = it.get("note")
        out.append(f"dsg {it.get('id', '?')}: {label}" + (f" — {note}" if note else ""))
    return out


def _is_clean(ruling: dict) -> bool:
    """A ruling is clean iff it carries no defect. `worst` is authoritative when present
    (aggregate of the axes); "clean" is the no-defect sentinel. Absent `worst` -> all axes clean.
    Conservative by design: only a fully-clean ruling verifies — any severity (even LOW) parks.

    A failed DSG-lite item overrides a clean aggregate. The per-item checklist and the axis
    severities are written by the same judge in one pass, so the aggregate can lag the items it was
    summarizing — and a frame whose adherence check FAILED must never reach the render gate because
    a summary field said `clean`. The items are the evidence; the aggregate is the opinion."""
    if _dsg_failures(ruling):
        return False
    worst = ruling.get("worst")
    if worst is not None:
        return worst == "clean"
    return all(ruling.get(k, "clean") == "clean" for k, _ in _AXES)


def _reasons(ruling: dict):
    """Defect strings for a parked ruling: one `"<axis>: <SEVERITY>"` per non-clean axis, then each
    FAILED DSG-lite item (named, so the gate prints which atomic fact the image missed), then the
    review narrative (`why`) if any. Never empty for a defect — falls back to the worst severity so
    the render gate always has something to print."""
    reasons = []
    for key, label in _AXES:
        v = ruling.get(key)
        if isinstance(v, str) and v and v != "clean":
            reasons.append(f"{label}: {v}")
    reasons.extend(_dsg_failures(ruling))
    why = ruling.get("why")
    if isinstance(why, str) and why.strip():
        reasons.append(why.strip())
    if not reasons:
        worst = ruling.get("worst")
        reasons.append(f"worst: {worst}" if worst else "unspecified defect")
    return reasons


def classify(ruling: dict):
    """Map one merged ruling to `(review_status, parked_reasons)`.
    clean -> ("verified", []);  any defect -> ("parked", [reason, ...])."""
    if _is_clean(ruling):
        return "verified", []
    return "parked", _reasons(ruling)


def _entries(manifest):
    """The list of shot entries. The manifest is {..., shots: [...]}; tolerate a bare list."""
    if isinstance(manifest, dict):
        return manifest.setdefault("shots", [])
    return manifest


def _rulings(data):
    """The ruling list. merged.json is a bare array; tolerate {rulings|shots: [...]}."""
    if isinstance(data, dict):
        return data.get("rulings") or data.get("shots") or []
    return data


def stamp(manifest, rulings):
    """Write `review_status` + `parked_reasons` onto every reviewed shot's entry, IN PLACE.

    Entries are matched to rulings by shot id. A ruling with no matching entry (a layered shot
    reviewed via its plate/cutout) gets a fresh minimal entry created. Entries with no ruling are
    left untouched. Returns `(n_verified, m_parked)`."""
    entries = _entries(manifest)
    by_id = {}
    for e in entries:
        sid = e.get("shot_id") or e.get("id")
        if sid and sid not in by_id:
            by_id[sid] = e

    n_verified = m_parked = 0
    for ruling in _rulings(rulings):
        rid = _ruling_id(ruling)
        if not rid:
            continue
        status, reasons = classify(ruling)
        entry = by_id.get(rid)
        if entry is None:                      # layered shot absent from manifest -> create it
            entry = {"shot_id": rid}
            entries.append(entry)
            by_id[rid] = entry
        entry["review_status"] = status
        entry["parked_reasons"] = reasons
        if status == "verified":
            n_verified += 1
        else:
            m_parked += 1
    return n_verified, m_parked


_FIGURE_REQUIRED = ("canonical_sha256", "verdicts", "reviewer", "date")


def _figure_input_records(data):
    """The asset-verdicts input's `asset_id -> record` mapping. Accepts `{"figures": {...}}` (the
    same shape as the store) or a bare `{asset_id: record, ...}` mapping with no wrapper key."""
    if not isinstance(data, dict):
        return {}
    figs = data.get("figures", data)
    return figs if isinstance(figs, dict) else {}


def merge_figure_records(store: dict, input_data) -> int:
    """Merge each `asset_id -> record` in the asset-verdicts input into `store["figures"]`, IN
    PLACE, normalizing every merged record to exactly the C-6 pinned shape (`canonical_sha256`,
    `expression_sha256`, `verdicts`, `reviewer`, `date`) regardless of extra input keys.

    A record for an asset id already on file is REPLACED wholesale — a re-review always supersedes
    the prior one for that id. Entries for asset ids NOT present in this input are left untouched
    (additive merge, never a full-file replace). A record missing a required field is skipped with
    a stderr warning; the rest of the batch still merges. Returns the count of records merged."""
    figures = store.setdefault("figures", {})
    n = 0
    for asset_id, rec in _figure_input_records(input_data).items():
        if not isinstance(rec, dict) or any(k not in rec for k in _FIGURE_REQUIRED):
            print(f"skip {asset_id}: record must carry {_FIGURE_REQUIRED}", file=sys.stderr)
            continue
        figures[asset_id] = {
            "canonical_sha256": rec["canonical_sha256"],
            "expression_sha256": rec.get("expression_sha256"),
            "verdicts": dict(rec.get("verdicts") or {}),
            "reviewer": rec["reviewer"],
            "date": rec["date"],
        }
        n += 1
    return n


def _atomic_write_json(path: Path, data) -> None:
    """Write `data` as JSON to `path` atomically (temp file in the same dir, then os.replace)."""
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _main_figures(argv) -> int:
    """The C-6/P3 asset-verdicts merge path: `--figures <input.json> <staging_dir>`."""
    if len(argv) != 2:
        print("usage: py -3 stamp_review.py --figures <input.json> <staging_dir>", file=sys.stderr)
        return 2
    input_path, staging_dir = Path(argv[0]), Path(argv[1])
    if not input_path.exists():
        print(f"no asset-verdicts input at {input_path}", file=sys.stderr)
        return 1
    input_data = json.loads(input_path.read_text(encoding="utf-8"))
    review_path = staging_dir / "review.json"
    store = json.loads(review_path.read_text(encoding="utf-8")) if review_path.exists() else {}
    if not isinstance(store, dict):
        store = {}
    # The one-time key migration, persisted — over the dict ALREADY LOADED one line above, never a
    # second read of the same file. `forge.review_store` answers `{}` for a store it cannot read,
    # so re-reading here would replace 35 curated rows with nothing if that read failed at that
    # instant. One reader, one read, then the migration on what it returned. Only keys move:
    # verdicts, reviewer, date and `canonical_sha256` all cross byte-for-byte, and a record no
    # candidate frame matches keeps its key rather than being dropped.
    store["figures"] = forge.migrate_review_store(
        store.get("figures"), str(staging_dir), str(staging_dir.parent))
    n = merge_figure_records(store, input_data)
    _atomic_write_json(review_path, store)
    print(f"asset-review: {n} merged into {review_path}")
    return 0


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "--figures":
        return _main_figures(argv[1:])
    if len(argv) != 1:
        print("usage: py -3 stamp_review.py <video_dir>\n"
              "       py -3 stamp_review.py --figures <input.json> <staging_dir>", file=sys.stderr)
        return 2
    video_dir = Path(argv[0])
    merged_path = video_dir / "assets" / "_review" / "merged.json"
    manifest_path = video_dir / "assets" / "scenes" / "manifest.json"
    if not merged_path.exists():
        print(f"no merged review at {merged_path}", file=sys.stderr)
        return 1
    if not manifest_path.exists():
        print(f"no scene manifest at {manifest_path}", file=sys.stderr)
        return 1

    rulings = json.loads(merged_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    n_verified, m_parked = stamp(manifest, rulings)
    _atomic_write_json(manifest_path, manifest)
    print(f"stamped: {n_verified} verified, {m_parked} parked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
