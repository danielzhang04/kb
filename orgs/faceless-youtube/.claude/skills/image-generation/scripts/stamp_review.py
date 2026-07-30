#!/usr/bin/env python3
"""stamp_review.py — the honest three-state stamp writer.

The batched image review (three concurrent mandate agents) produces a MERGED ruling list at
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
"""
import json
import os
import sys
from pathlib import Path

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


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        print("usage: py -3 stamp_review.py <video_dir>", file=sys.stderr)
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
