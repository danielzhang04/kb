#!/usr/bin/env python3
"""Mechanical lint for shots.motion.json. Reuses the render-builder menu + schema validator, then adds
cross-checks against shots.json. Derived check ONLY — no authoring semantics."""
import json, sys, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "render-builder" / "scripts"))
from menu import load_menu           # noqa: E402
from motion_plan import validate_plan  # noqa: E402


def _hybrid_ids(plan):
    """Shot ids that are HYBRIDS — a delta-chain shot carrying a discrete-overlay cutout. A hybrid
    composites plate+cutout only at render, so it produces NO baked composite for a later delta to
    seed from."""
    ids = set()
    for shot in plan.get("shots", []):
        bg = shot.get("background") or {}
        if bg.get("mode") == "delta-chain" and any(
                l.get("source") == "cutout" for l in shot.get("layers", [])):
            ids.add(shot.get("id"))
    return ids


def lint(plan, shots_ids):
    errors = list(validate_plan(plan, load_menu()))
    for shot in plan.get("shots", []):
        sid = shot.get("id", "<no id>")
        if sid not in shots_ids:
            errors.append(f"{sid}: not a shot id in shots.json")
        bg = shot.get("background") or {}
        if bg.get("mode") == "plate" and not (bg.get("plate") or bg.get("plate_prompt")):
            errors.append(f"{sid}: plate background needs plate or plate_prompt")
        for layer in shot.get("layers", []):
            if layer.get("source") == "cutout" and not (layer.get("cutout_prompt") or "").strip():
                errors.append(f"{sid}/{layer.get('id')}: cutout layer needs a non-empty cutout_prompt")

    hybrids = _hybrid_ids(plan)
    for shot in plan.get("shots", []):
        if shot.get("id") not in hybrids:
            continue
        plate = ((shot.get("background") or {}).get("plate")) or ""
        m = re.match(r"scenes/(.+)\.png$", plate)
        base_id = m.group(1) if m else None
        if base_id and base_id in hybrids:
            errors.append(
                f"{shot.get('id')}: delta-chain base '{base_id}' is itself a hybrid — "
                f"a hybrid produces no baked composite to seed from")
    return errors


def _shots_ids(shots_json):
    shots = shots_json.get("shots") or (shots_json.get("long_form") or {}).get("shots") or []
    return {s.get("id") for s in shots}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: lint_motion_plan.py <shots.motion.json> <shots.json>")
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    ids = _shots_ids(json.load(open(sys.argv[2], encoding="utf-8")))
    errs = lint(plan, ids)
    for e in errs:
        print("ERR", e)
    print(f"{len(errs)} error(s)")
    sys.exit(1 if errs else 0)
