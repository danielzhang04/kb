#!/usr/bin/env python3
"""Mechanical lint for shots.motion.json. Reuses the render-builder menu + schema validator, then adds
cross-checks against shots.json. Derived check ONLY — no authoring semantics.

Checks (all HARD, exit 1 on any error):
  * schema + animation-menu (via motion_plan.validate_plan) — incl. `source` must be `cutout`
    (the retired engine device family is an invalid layer source).
  * every plan shot id exists in shots.json; a plate background carries plate|plate_prompt;
    a cutout layer carries a non-empty cutout_prompt.
  * a hybrid (delta-chain + cutout) may not seed its plate off another hybrid (no baked composite).
  * DELTA-VS-LAYER lineage (needs shots.json stage metadata; the mechanical shadow of the doctrine):
      - a PASSTHROUGH delta-chain (layers []) needs a stage AND an earlier same-stage frame to chain
        from — a base is a plate, not a chain.
      - a scenes/<ref>.png plate that REUSES another shot's baked scene must reference an EARLIER shot
        and may not cross a stage boundary (the re-base rule: a re-base seeds the prior stage's own
        base, never chains across stages or forward in time). plates/<id>.png and a self-reference
        (my own baked scene) are exempt.
"""
import json, sys, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "render-builder" / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "visual-prompt-writer" / "scripts"))
from menu import load_menu           # noqa: E402
from motion_plan import validate_plan  # noqa: E402
# The SUPPLIED-TEXT law, imported rather than reimplemented. motion-planner authors
# `cutout_prompt`/`plate_prompt` independently of visual-prompt-writer, so it is a SECOND
# authoring surface for the same defect — and in fact the one that shipped it: the Wells
# Fargo boulder's invented "1" came from a cutout_prompt reading "a large marker scorecard
# number painted on its face". One implementation, two callers; a copy here would rot.
from lint_shots import unsupplied_text_requests  # noqa: E402


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


def _has_cutout(shot):
    return any(l.get("source") == "cutout" for l in shot.get("layers", []))


def _order_stage(shots_meta):
    """From the ordered shots.json meta rows, return (order: id->index, stage: id->stage-or-None)."""
    order, stage = {}, {}
    for i, s in enumerate(shots_meta or []):
        sid = s.get("id")
        if sid is None:
            continue
        order[sid] = i
        st = s.get("stage")
        stage[sid] = st if st else None
    return order, stage


def _lineage_errors(plan, order, stage):
    """The delta-vs-layer lineage backstops (A1 + A2). Scoped to what the EXISTING fields carry:
    shots.json shot order + per-shot `stage`; the motion plan's background.mode/plate/layers."""
    errors = []
    for shot in plan.get("shots", []):
        sid = shot.get("id")
        bg = shot.get("background") or {}
        mode = bg.get("mode")
        plate = bg.get("plate") or ""

        # A2 — scenes/<ref>.png plate that reuses ANOTHER shot's baked scene. plates/<id>.png (a fresh
        # plate) and a self-reference (my own baked scene) are exempt; only a cross-shot scene reuse
        # carries a lineage obligation.
        m = re.match(r"scenes/(.+)\.png$", plate)
        ref = m.group(1) if m else None
        if ref and ref != sid:
            if sid in order and ref in order and order[ref] >= order[sid]:
                errors.append(f"{sid}: reuses scenes/{ref}.png but '{ref}' is not an EARLIER shot — "
                              f"a chain seeds a prior frame, never forward in time")
            elif stage.get(sid) and stage.get(ref) and stage.get(sid) != stage.get(ref):
                errors.append(f"{sid}: reuses scenes/{ref}.png across stages ('{ref}' is stage "
                              f"'{stage[ref]}', '{sid}' is stage '{stage[sid]}') — a re-base seeds the "
                              f"prior stage's OWN base, it may not chain across stages")

        # A1 — a PASSTHROUGH delta-chain (no cutout layer: it shows a prior baked scene directly) needs
        # a stage lineage. A hybrid (delta-chain + cutout) composites plate+cutout at render and is
        # governed by A2's plate check instead, so it is not caught here.
        if mode == "delta-chain" and not _has_cutout(shot):
            st = stage.get(sid)
            if not st:
                errors.append(f"{sid}: delta-chain passthrough has no stage — a chain needs a stage lineage")
            elif sid in order and not any(
                    stage.get(o) == st and order.get(o, order[sid]) < order[sid]
                    for o in order if o != sid):
                errors.append(f"{sid}: delta-chain passthrough is the first frame of stage '{st}' — no "
                              f"earlier in-stage frame to chain from (a base is a plate, not a chain)")
    return errors


def lint(plan, shots_ids, shots_meta=None, suffix=""):
    errors = list(validate_plan(plan, load_menu()))
    for shot in plan.get("shots", []):
        sid = shot.get("id", "<no id>")
        # SUPPLIED-TEXT law (HARD): a prompt may not ask the engine to render text,
        # a number, a name or a date without supplying that value verbatim inline.
        for field, prompt in ([("plate_prompt", (shot.get("background") or {}).get("plate_prompt"))]
                              + [(f"{(l or {}).get('id')}.cutout_prompt", (l or {}).get("cutout_prompt"))
                                 for l in shot.get("layers", [])]):
            for excerpt in unsupplied_text_requests(prompt or "", suffix):
                errors.append(
                    f"{sid}/{field}: asks the engine to render text without supplying its value "
                    f"-> {excerpt!r}. The engine WILL invent one. Quote the literal inline next to "
                    f"the element (from research.md's fact ledger), or cut the element.")
        if sid not in shots_ids:
            errors.append(f"{sid}: not a shot id in shots.json")
        bg = shot.get("background") or {}
        if bg.get("mode") == "plate" and not (bg.get("plate") or bg.get("plate_prompt")):
            errors.append(f"{sid}: plate background needs plate or plate_prompt")
        for layer in shot.get("layers", []):
            # A `reuse` layer points at an already-materialized cutout PNG (image-gen does not
            # regenerate it), so it legitimately carries no cutout_prompt — exempt it.
            if (layer.get("source") == "cutout"
                    and not (layer.get("cutout_prompt") or "").strip()
                    and not (layer.get("reuse") or "").strip()):
                errors.append(f"{sid}/{layer.get('id')}: cutout layer needs a non-empty cutout_prompt "
                              f"(or a `reuse` pointing at a materialized cutout)")

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

    if shots_meta is not None:
        order, stage = _order_stage(shots_meta)
        errors.extend(_lineage_errors(plan, order, stage))
    return errors


def _shots_meta(shots_json):
    """The ordered shots.json shot rows we lineage-check against — id + stage, in shot order."""
    shots = shots_json.get("shots") or (shots_json.get("long_form") or {}).get("shots") or []
    return [{"id": s.get("id"), "stage": s.get("stage")} for s in shots]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: lint_motion_plan.py <shots.motion.json> <shots.json>")
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    shots_json = json.load(open(sys.argv[2], encoding="utf-8"))
    meta = _shots_meta(shots_json)
    ids = {m["id"] for m in meta if m.get("id") is not None}
    errs = lint(plan, ids, meta, shots_json.get("global_prompt_suffix") or "")
    for e in errs:
        print("ERR", e)
    print(f"{len(errs)} error(s)")
    sys.exit(1 if errs else 0)
