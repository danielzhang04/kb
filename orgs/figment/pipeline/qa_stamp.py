#!/usr/bin/env python3
"""qa_stamp.py — figment's three-state review stamp writer.

Ported from faceless-youtube's `stamp_review.py` (see orgs/figment/pipeline/reuse-from-fyt.md).
Preserved EXACTLY: the three honest states, fail-closed classification, single-writer design,
pure stdlib. Adapted: FYT's cartoon-rig axes (fidelity/style/rig) and DSG-lite lettering
checklist are dropped entirely — figment's review axes are identity / realism / hands /
lighting (see orgs/figment/pipeline/trial-protocol.md).

Why it exists (same lesson FYT learned the hard way): a review gate that has no honest
"not yet looked at" state gets hand-waved to `verified` under time pressure. This script is
the ONLY writer of `review_status` / `parked_reasons` / `safety_failed` / `safety_reasons`
onto a figment batch manifest — the grader (human or agent) never edits the manifest
directly, it only produces a rulings file that this script converts.

**Seven axes, two independent verdicts (P1 step 1.5 / design §2.4a).** The four
`QUALITY_AXES` (identity/realism/hands/lighting) drive `review_status`
(verified|parked) exactly as before — an axis simply absent from a ruling means "not
evaluated" and is treated leniently (pass by omission), same as always. The three
`SAFETY_VALUES` axes (adult_read/garment_integrity/real_person_resemblance,
GUARDRAILS 1/2/4) are a SEPARATE, MANDATORY verdict: every one of the three must be
present and a valid enum value on every ruling, or `classify`/`stamp` raise before any
atomic write — a missing safety axis is a malformed judge output, never a silent pass.
Their combined result is `safety_failed` (bool) + `safety_reasons` (list), written
alongside `review_status`/`parked_reasons` but never merged into them: **`review_status`
stays orthogonal to the safety axes** — a safety failure never forces `review_status`
to "parked", and downstream lifecycle quarantine (`pipeline/expand/batch_state.py`)
reads `safety_failed` directly rather than inferring it from `review_status`.

Batch manifest schema (tolerant of a bare list or a `{"images": [...]}` wrapper):
    {
      "images": [
        {
          "image_id": "img_0001",         # required — the join key
          "path": "img_0001.png",         # informational, untouched by this script
          "arm": "A",                     # informational, untouched by this script
          "prompt_setup_id": "P1",        # informational, untouched by this script
          "review_status": "unreviewed",  # written ONLY by this script: verified|parked
          "parked_reasons": [],           # written ONLY by this script
          "safety_failed": false,         # written ONLY by this script
          "safety_reasons": []            # written ONLY by this script
        }, ...
      ]
    }
Only `image_id`, `review_status`, `parked_reasons`, `safety_failed`, and `safety_reasons`
are load-bearing for this script. `path` / `arm` / `prompt_setup_id` (and anything else
present) are preserved byte-identical. `blind_pool.py`'s pool manifest is a minimal
instance of this same schema with `arm` and `prompt_setup_id` omitted (blind grading has
no arm to show); this script does not care.

Rulings file (the grader's output; tolerant of a bare list or a `{"rulings": [...]}` wrapper):
    [
      {
        "image_id": "img_0001",
        "identity": "pass",        # pass | soft-fail | hard-fail   (QUALITY_AXES)
        "realism": "pass",
        "hands": "hard-fail",
        "lighting": "pass",
        "adult_read": "pass",              # pass | ambiguous | fail   (SAFETY, mandatory)
        "garment_integrity": "pass",       # pass | fail               (SAFETY, mandatory)
        "real_person_resemblance": "clear", # clear | flag              (SAFETY, mandatory)
        "why": "left hand has six fingers in the mirror reflection"  # optional
      }, ...
    ]

Ruling -> `review_status` map (QUALITY_AXES only, unchanged from before P1):
  * every axis present on the ruling is "pass"           -> verified, parked_reasons: []
  * any axis present is "soft-fail" or "hard-fail"        -> parked, one reason per bad axis
  * a ruling naming NO quality axis at all                -> parked ("unspecified defect")
  * a quality axis value not pass|soft-fail|hard-fail     -> HARD ERROR (never silently a pass)

Ruling -> `safety_failed` map (SAFETY_VALUES, new in P1, always evaluated):
  * `adult_read` anything but "pass"                      -> safety_failed: true
  * `garment_integrity` anything but "pass"                -> safety_failed: true
  * `real_person_resemblance == "flag"`                    -> safety_failed: true
  * any of the three missing, null, or an out-of-enum value -> HARD ERROR, fail-closed
    (this includes a legacy ruling authored before the safety axes existed — it is
    correct for that to fail closed rather than silently pass safety)

A ruling naming an image_id absent from the manifest is always a HARD ERROR (typo or a
mismatched rulings/manifest pair) — unchanged from before P1.

An entry the rulings file never mentions is left exactly as-is (usually "unreviewed") —
this script only writes what it was actually told to judge.

Usage:
    py -3 qa_stamp.py <rulings.json> <manifest.json>

Emits one summary line: `stamped: N verified, M parked, K still unreviewed`.
"""
import argparse
import json
import os
import sys
from pathlib import Path

# Quality review axes: figment's own (identity / realism / hands / lighting), NOT
# FYT's fidelity/style/rig — see the module docstring and reuse-from-fyt.md.
QUALITY_AXES = ("identity", "realism", "hands", "lighting")
AXES = (
    ("identity", "identity match"),
    ("realism", "realism / anti-gloss"),
    ("hands", "hands + detail integrity"),
    ("lighting", "lighting plausibility"),
)
_VALID_STATES = ("pass", "soft-fail", "hard-fail")

# Safety axes: mandatory on every ruling, GUARDRAILS 1/2/4, design §2.4a. Each axis
# has its own enum — never conflate them with the quality axes' pass/soft-fail/hard-fail.
SAFETY_AXES = ("adult_read", "garment_integrity", "real_person_resemblance")
SAFETY_VALUES = {
    "adult_read": {"pass", "ambiguous", "fail"},
    "garment_integrity": {"pass", "fail"},
    "real_person_resemblance": {"clear", "flag"},
}
# The subset of each safety axis's enum that trips safety_failed (anything but the
# named "ok" value(s)).
_SAFETY_FAIL_VALUES = {
    "adult_read": {"ambiguous", "fail"},
    "garment_integrity": {"fail"},
    "real_person_resemblance": {"flag"},
}


def _ruling_id(ruling: dict):
    """The image id a ruling addresses (`image_id` is canonical; tolerate `id`)."""
    return ruling.get("image_id") or ruling.get("id")


def _axis_states(ruling: dict) -> dict:
    """Return `{axis: normalized_state}` for every axis actually present on `ruling`.

    FAIL-CLOSED: a present axis value that is not (case-insensitively) one of
    pass/soft-fail/hard-fail is a malformed judge output and HARD-ERRORS naming the
    ruling, the axis, and the bad value — never waved through as a pass. An axis key
    that is simply absent (or explicitly `null`) is treated as "not evaluated", not
    an error — that is a legitimate partial-review shape, e.g. a second pass that only
    re-checks the axis that failed the first time.
    """
    rid = _ruling_id(ruling) or "?"
    out = {}
    for axis, _label in AXES:
        if axis not in ruling or ruling[axis] is None:
            continue
        raw = ruling[axis]
        state = raw.strip().lower() if isinstance(raw, str) else None
        if state not in _VALID_STATES:
            raise ValueError(
                f"malformed axis verdict on ruling {rid!r}: {axis}={raw!r} "
                f"(expected one of {_VALID_STATES})"
            )
        out[axis] = state
    return out


def _is_clean(states: dict) -> bool:
    """A ruling is clean iff at least one axis was actually evaluated and every axis that
    WAS evaluated is "pass". A ruling naming zero axes is never clean by default — silence
    is not evidence, the same fail-closed law FYT's stamp_review.py applies to a bare
    ruling with no axis info at all. (An axis a grader simply didn't touch is treated as
    pass by omission, same leniency FYT's `axes_clean` carries forward — only the
    all-axes-absent case is non-clean.)
    """
    if not states:
        return False
    return all(v == "pass" for v in states.values())


def _reasons(ruling: dict, states: dict) -> list:
    """Defect strings for a parked ruling: one `"<axis>: <state>"` per non-pass axis, then
    the grader's free-text `why` if present. Never empty — falls back to a named reason so
    the gate always has something to print."""
    reasons = [f"{axis}: {state}" for axis, state in states.items() if state != "pass"]
    why = ruling.get("why")
    if isinstance(why, str) and why.strip():
        reasons.append(why.strip())
    if not reasons:
        reasons.append("unspecified defect — ruling names no review axis")
    return reasons


def _safety_states(ruling: dict) -> dict:
    """Return `{axis: normalized_state}` for all three `SAFETY_AXES`. Unlike
    `_axis_states`, every safety axis is MANDATORY: missing, `null`, or an
    out-of-enum value HARD-ERRORS rather than being treated as "not evaluated" —
    GUARDRAILS 1/2/4 have no honest default, so there is no lenient case here."""
    rid = _ruling_id(ruling) or "?"
    out = {}
    for axis in SAFETY_AXES:
        if axis not in ruling or ruling[axis] is None:
            raise ValueError(
                f"missing required safety axis on ruling {rid!r}: {axis!r} is "
                f"mandatory (expected one of {sorted(SAFETY_VALUES[axis])}) — a "
                f"legacy ruling with no safety axes at all fails closed here, it is "
                f"never silently treated as passing safety"
            )
        raw = ruling[axis]
        state = raw.strip().lower() if isinstance(raw, str) else None
        if state not in SAFETY_VALUES[axis]:
            raise ValueError(
                f"malformed safety verdict on ruling {rid!r}: {axis}={raw!r} "
                f"(expected one of {sorted(SAFETY_VALUES[axis])})"
            )
        out[axis] = state
    return out


def _safety_failed(states: dict) -> bool:
    return any(states[axis] in _SAFETY_FAIL_VALUES[axis] for axis in SAFETY_AXES)


def _safety_reasons(states: dict) -> list:
    return [
        f"{axis}: {state}"
        for axis, state in states.items()
        if state in _SAFETY_FAIL_VALUES[axis]
    ]


def classify(ruling: dict):
    """Map one grader ruling to `(review_status, parked_reasons, safety_failed,
    safety_reasons)`. The safety axes are validated (and can raise) even when the
    quality-axis outcome alone would already be `parked` — every ruling must carry a
    complete, valid safety verdict, full stop."""
    if not isinstance(ruling, dict):
        raise ValueError(
            f"malformed ruling entry: expected an object, got {type(ruling).__name__}: {ruling!r}"
        )
    safety_states = _safety_states(ruling)  # mandatory — raises fail-closed first
    safety_failed = _safety_failed(safety_states)
    safety_reasons = _safety_reasons(safety_states)

    states = _axis_states(ruling)
    if _is_clean(states):
        return "verified", [], safety_failed, safety_reasons
    return "parked", _reasons(ruling, states), safety_failed, safety_reasons


def _images(manifest):
    """The list of image entries. The manifest is normally `{"images": [...]}`; tolerate a
    bare list too (mirrors FYT's `_entries` tolerance)."""
    if isinstance(manifest, dict):
        return manifest.setdefault("images", [])
    return manifest


def _rulings(data):
    """The ruling list. Normally a bare array; tolerate `{"rulings": [...]}`."""
    if isinstance(data, dict):
        return data.get("rulings") or data.get("images") or []
    return data


def stamp(manifest, rulings):
    """Write `review_status` + `parked_reasons` + `safety_failed` + `safety_reasons`
    onto every ruled image's manifest entry, IN PLACE. Entries are matched to rulings
    by `image_id`. Returns `(n_verified, m_parked, n_unreviewed)` — the return arity
    is unchanged from before P1; `safety_failed` is read by the caller off the
    manifest entry itself (as `pipeline/expand/batch_state.py`'s reducer does), not
    off this return value.

    Unlike FYT's `stamp_review.py` (which fabricates a fresh manifest entry for a ruling
    with no matching shot — layered plates/cutouts reviewed under a different id than the
    manifest uses), a ruling here that names an `image_id` absent from the manifest HARD
    ERRORS instead. Figment's manifest is flat (no layered-shot indirection), so an
    unmatched id is virtually always a grader typo or a mismatched rulings/manifest pair —
    silently creating a phantom entry would hide exactly that mistake, which the fail-closed
    law this script exists to enforce says never do.
    """
    entries = _images(manifest)
    by_id = {}
    for e in entries:
        if not isinstance(e, dict):
            raise ValueError(
                f"malformed manifest image entry: expected an object, got {type(e).__name__}: {e!r}"
            )
        iid = e.get("image_id") or e.get("id")
        if iid and iid not in by_id:
            by_id[iid] = e

    n_verified = m_parked = 0
    for ruling in _rulings(rulings):
        if not isinstance(ruling, dict):
            raise ValueError(
                f"malformed ruling entry: expected an object, got {type(ruling).__name__}: {ruling!r}"
            )
        rid = _ruling_id(ruling)
        if not rid:
            continue
        if rid not in by_id:
            raise ValueError(
                f"ruling names image_id {rid!r}, which is not in the manifest — a grader "
                f"typo or a mismatched rulings/manifest pair. Fix the ruling or the "
                f"manifest rather than silently creating a phantom entry."
            )
        status, reasons, safety_failed, safety_reasons = classify(ruling)
        entry = by_id[rid]
        entry["review_status"] = status
        entry["parked_reasons"] = reasons
        entry["safety_failed"] = safety_failed
        entry["safety_reasons"] = safety_reasons
        if status == "verified":
            n_verified += 1
        else:
            m_parked += 1

    n_unreviewed = sum(
        1 for e in entries if e.get("review_status") not in ("verified", "parked")
    )
    return n_verified, m_parked, n_unreviewed


def _atomic_write_json(path: Path, data) -> None:
    """Write `data` as JSON to `path` atomically (temp file in the same dir, then
    os.replace) — the single-writer discipline this script exists to provide would be
    pointless if a crash mid-write could corrupt the manifest."""
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


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="qa_stamp.py",
        description=(
            "Stamp a figment batch manifest's review_status/parked_reasons from a "
            "grader's rulings file. The ONLY writer of those two fields — run it after "
            "grading, never hand-edit the manifest."
        ),
    )
    ap.add_argument("rulings", type=Path, help="path to the grader's rulings JSON")
    ap.add_argument("manifest", type=Path, help="path to the batch manifest JSON (edited in place)")
    return ap


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)

    if not args.rulings.exists():
        print(f"no rulings file at {args.rulings}", file=sys.stderr)
        return 1
    if not args.manifest.exists():
        print(f"no manifest at {args.manifest}", file=sys.stderr)
        return 1

    rulings = json.loads(args.rulings.read_text(encoding="utf-8"))
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))

    try:
        n_verified, m_parked, n_unreviewed = stamp(manifest, rulings)
    except ValueError as e:
        # fail-closed: malformed or ambiguous review data must be loud, never waved through
        print(f"malformed review data — {e}", file=sys.stderr)
        return 1

    _atomic_write_json(args.manifest, manifest)
    print(f"stamped: {n_verified} verified, {m_parked} parked, {n_unreviewed} still unreviewed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
