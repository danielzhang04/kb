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

# The shots.json v1 marker (visual-prompt-writer/scripts/lint_shots.py:SCHEMA_V1). A shots.json
# that explicitly declares this is the only thing that predates the DSG-lite checklist by
# definition (the real 2026-07-19-wells-fargo shots.json does); anything else — an explicit v2,
# a missing key, a typo — is the current schema and requires `dsg` on every ruling. Same
# fail-closed law as HIGH-5's lint_shots.py fix; duplicated as a literal rather than imported
# across the skill boundary (visual-prompt-writer vs image-generation are separate skills).
_SHOTS_SCHEMA_V1 = "faceless-youtube/shots@1"


def _require_dsg_for(video_dir: Path) -> bool:
    """Whether every ruling for this video must carry a `dsg` checklist (MEDIUM-10). Reads
    `<video_dir>/shots.json`'s `schema` field the same fail-closed way lint_shots.py's HIGH-5 fix
    reads it: only an EXPLICIT `_SHOTS_SCHEMA_V1` earns the legacy no-op path.

    A video directory with NO shots.json at all is not a real pipeline state — VPW always writes
    it before image-generation runs, so by the time this script runs it is guaranteed present —
    it only happens in an isolated/test invocation that never set one up. Defaulting False there
    (rather than fail-closed True) keeps this a no-op for that case instead of silently changing
    behaviour for every caller that has no opinion on schema version at all."""
    shots_path = video_dir / "shots.json"
    if not shots_path.exists():
        return False
    try:
        schema = json.loads(shots_path.read_text(encoding="utf-8")).get("schema")
    except (json.JSONDecodeError, AttributeError, OSError):
        schema = None
    return schema != _SHOTS_SCHEMA_V1


def _ruling_id(ruling: dict):
    """The shot id a ruling addresses (merged.json uses `id`; tolerate `shot_id`)."""
    return ruling.get("id") or ruling.get("shot_id")


def _dsg_failures(ruling: dict, require_dsg: bool = False):
    """The FAILED items of a ruling's DSG-lite checklist — the dependency-ordered decomposition of
    the assembled prompt into atomic facts (entities -> attributes -> relations -> lettering) that
    the fidelity judge answers one by one. Each item is
    `{id, parent, q, verdict: "pass"|"fail"|"skipped", note}`.

    FAIL-CLOSED (2026-07-30): "pass"/"skipped" (case-insensitive) is not a defect; "fail"
    (case-insensitive) is a defect; ANY other value — a near-miss spelling ("failed"), a
    boolean, or a missing `verdict` key entirely — is a malformed judge output and HARD-ERRORS
    naming the item, rather than being waved through as a pass. The old contract silently
    treated everything but exactly "fail" as clean, which means a judge that returned garbage
    shipped the frame anyway. `dsg` itself is genuinely additive: a ruling with NO `dsg` key
    (or `dsg: None`) predates the checklist and stays a no-op, but once the field is present it
    must be well-formed — a non-list `dsg`, or a non-dict item, is malformed the same way.

    MEDIUM-10 (audit follow-up): `ruling.get("dsg")` is `None` for BOTH an absent key and an
    explicit `dsg: null`, which made a fidelity judge that silently failed to emit its checklist
    indistinguishable from a genuine pre-checklist ruling — both verified. `require_dsg` (set by
    `main()` from the VIDEO's shots.json `schema`, fail-closed the same way HIGH-5 fixed
    lint_shots.py: only an explicit `faceless-youtube/shots@1` earns the no-op path) tells them
    apart: when False (a real legacy file, or no schema info at all), a missing/null `dsg` is
    still the documented no-op; when True (the current schema), it is treated as a DEFECT — the
    shot PARKS with a named reason, same as any other defect, never a hard error, since it is this
    one shot's evidence that's incomplete, not the whole batch's data that's malformed."""
    items = ruling.get("dsg")
    if items is None:
        if require_dsg:
            rid = _ruling_id(ruling) or "?"
            return [f"dsg: ruling {rid!r} carries no DSG-lite checklist at all. This video's "
                    f"shots.json declares the current schema, which requires one on every ruling "
                    f"— either the fidelity judge silently failed to emit it, or this ruling is "
                    f"stale from before the checklist ran. Parking rather than assuming clean."]
        return []
    rid = _ruling_id(ruling) or "?"
    if not isinstance(items, list):
        raise ValueError(f"malformed dsg field on ruling {rid!r}: expected a list, "
                         f"got {type(items).__name__}: {items!r}")
    out = []
    for it in items:
        if not isinstance(it, dict):
            raise ValueError(f"malformed dsg item on ruling {rid!r}: expected an object, "
                             f"got {type(it).__name__}: {it!r}")
        item_id = it.get("id", "?")
        verdict_raw = it.get("verdict")
        verdict = str(verdict_raw).lower() if verdict_raw is not None else ""
        if verdict in ("pass", "skipped"):
            continue
        if verdict == "fail":
            label = it.get("q") or item_id or "unnamed check"
            note = it.get("note")
            out.append(f"dsg {item_id}: {label}" + (f" — {note}" if note else ""))
            continue
        raise ValueError(f"malformed dsg verdict on item {item_id!r} of ruling {rid!r}: "
                         f"{verdict_raw!r} (expected pass|fail|skipped)")
    return out


def _is_clean(ruling: dict, require_dsg: bool = False) -> bool:
    """A ruling is clean iff it carries no defect. `worst` is authoritative when present
    (aggregate of the axes); "clean" is the no-defect sentinel. Absent `worst` -> all axes clean.
    Conservative by design: only a fully-clean ruling verifies — any severity (even LOW) parks.

    A failed DSG-lite item overrides a clean aggregate. The per-item checklist and the axis
    severities are written by the same judge in one pass, so the aggregate can lag the items it was
    summarizing — and a frame whose adherence check FAILED must never reach the render gate because
    a summary field said `clean`. The items are the evidence; the aggregate is the opinion.

    MEDIUM-10 (audit follow-up): a ruling carrying NONE of `worst`/`f`/`s`/`r` at all (a bare
    `{"id": "L5"}`) used to default every axis to "clean" and verify — that is silence, not
    evidence, and the operating law disallows it. Only a ruling with at least one axis actually
    present is eligible for the "missing axis defaults to clean" convenience below."""
    if _dsg_failures(ruling, require_dsg):
        return False
    worst = ruling.get("worst")
    if worst is not None:
        return worst == "clean"
    if not any(k in ruling for k, _ in _AXES):
        return False
    return all(ruling.get(k, "clean") == "clean" for k, _ in _AXES)


def _reasons(ruling: dict, require_dsg: bool = False):
    """Defect strings for a parked ruling: one `"<axis>: <SEVERITY>"` per non-clean axis, then each
    FAILED DSG-lite item (named, so the gate prints which atomic fact the image missed), then the
    review narrative (`why`) if any. Never empty for a defect — falls back to the worst severity so
    the render gate always has something to print."""
    reasons = []
    for key, label in _AXES:
        v = ruling.get(key)
        if isinstance(v, str) and v and v != "clean":
            reasons.append(f"{label}: {v}")
    reasons.extend(_dsg_failures(ruling, require_dsg))
    why = ruling.get("why")
    if isinstance(why, str) and why.strip():
        reasons.append(why.strip())
    if not reasons:
        worst = ruling.get("worst")
        reasons.append(f"worst: {worst}" if worst else "unspecified defect")
    return reasons


def classify(ruling: dict, require_dsg: bool = False):
    """Map one merged ruling to `(review_status, parked_reasons)`.
    clean -> ("verified", []);  any defect -> ("parked", [reason, ...]).

    `require_dsg` (default False, preserving the schema-agnostic classification this function
    always had) is threaded through by `stamp()`/`main()` from the video's shots.json — see
    `_dsg_failures`."""
    if _is_clean(ruling, require_dsg):
        return "verified", []
    return "parked", _reasons(ruling, require_dsg)


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


def stamp(manifest, rulings, require_dsg: bool = False):
    """Write `review_status` + `parked_reasons` onto every reviewed shot's entry, IN PLACE.

    Entries are matched to rulings by shot id. A ruling with no matching entry (a layered shot
    reviewed via its plate/cutout) gets a fresh minimal entry created. Entries with no ruling are
    left untouched. Returns `(n_verified, m_parked)`.

    `require_dsg` — see `_dsg_failures` — is computed once by `main()` from the video's
    shots.json and applied uniformly to every ruling in this batch."""
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
        status, reasons = classify(ruling, require_dsg)
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
    require_dsg = _require_dsg_for(video_dir)
    try:
        n_verified, m_parked = stamp(manifest, rulings, require_dsg)
    except ValueError as e:
        # fail-closed: a malformed DSG-lite item must be loud, never silently waved through
        print(f"malformed review data — {e}", file=sys.stderr)
        return 1
    _atomic_write_json(manifest_path, manifest)
    print(f"stamped: {n_verified} verified, {m_parked} parked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
