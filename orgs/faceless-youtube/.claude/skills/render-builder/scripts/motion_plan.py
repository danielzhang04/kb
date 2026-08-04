"""Validates a shots.motion.json plan against the schema + the animation menu."""
from menu import valid_animation

_SLIDE_EDGES = {"left", "right", "top", "bottom"}
_APPEAR_STYLES = {"pop", "fade", "slam"}
_CAMERA_MOVES = {"push", "pull"}
_CAMERA_PANS = _SLIDE_EDGES


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _coord(v):
    return isinstance(v, (list, tuple)) and len(v) == 2 and all(_num(x) for x in v)


def _cutout_param_errors(sid, lid, atype, anim):
    """Shape-check a cutout animation's params (type-check happened already). Every message
    contains the word 'param' + the offending key so lint/tests can assert on it."""
    e = []
    def bad(key, why):
        e.append(f"{sid}/{lid}: {atype} param '{key}' {why}")
    if "anchor" in anim and not (isinstance(anim["anchor"], str) and anim["anchor"].strip()):
        bad("anchor", "must be a non-empty string of verbatim VO words")
    # anchor_origin overrides the engine's per-type vertical transform origin (LayerView vOriginPct);
    # distinct from `anchor` (VO words). Valid on every cutout animation type.
    if "anchor_origin" in anim and anim["anchor_origin"] not in ("center", "bottom"):
        bad("anchor_origin", "must be 'center' or 'bottom'")
    if atype == "slide":
        if not _coord(anim.get("to")):
            bad("to", "must be a 2-element numeric [x,y] coord")
        if not (_num(anim.get("dur_s")) and anim["dur_s"] > 0):
            bad("dur_s", "must be a number > 0")
        if "from_edge" in anim and anim["from_edge"] not in _SLIDE_EDGES:
            bad("from_edge", f"must be one of {sorted(_SLIDE_EDGES)}")
    elif atype == "path":
        pts = anim.get("points")
        if not (isinstance(pts, (list, tuple)) and len(pts) == 3 and all(_coord(p) for p in pts)):
            bad("points", "must be exactly three 2-element numeric [x,y] coords")
        if not (_num(anim.get("dur_s")) and anim["dur_s"] > 0):
            bad("dur_s", "must be a number > 0")
        if "draw_line" in anim and not isinstance(anim["draw_line"], bool):
            bad("draw_line", "must be a boolean")
        # Dotted-line density tuning (engine draws the route as circles). Only meaningful when the
        # line is drawn — mirror the `static` requires-draw_line rule.
        if "dot_count" in anim:
            if not (isinstance(anim["dot_count"], int) and not isinstance(anim["dot_count"], bool)
                    and anim["dot_count"] > 0):
                bad("dot_count", "must be an integer > 0")
            elif not anim.get("draw_line"):
                bad("dot_count", "requires draw_line:true (it tunes the engine-drawn route dots)")
        if "dot_r" in anim:
            if not (_num(anim["dot_r"]) and anim["dot_r"] > 0):
                bad("dot_r", "must be a number > 0")
            elif not anim.get("draw_line"):
                bad("dot_r", "requires draw_line:true (it tunes the engine-drawn route dots)")
        # `static` (completed-route persistence) only makes sense when the line is drawn.
        if "static" in anim:
            if not isinstance(anim["static"], bool):
                bad("static", "must be a boolean")
            elif anim["static"] and not anim.get("draw_line"):
                bad("static", "requires draw_line:true (it persists an engine-drawn route)")
    elif atype == "bob":
        if "at" in anim and not _coord(anim["at"]):
            bad("at", "must be a 2-element numeric [x,y] coord")
    elif atype == "appear":
        if "at" in anim and not _coord(anim["at"]):
            bad("at", "must be a 2-element numeric [x,y] coord")
        if "at_s" in anim and not _num(anim["at_s"]):
            bad("at_s", "must be a number (shot-relative seconds)")
        if "style" in anim and anim["style"] not in _APPEAR_STYLES:
            bad("style", f"must be one of {sorted(_APPEAR_STYLES)}")
    return e


def _card_errors(plan):
    """Shape-check the plan-level chapter CARDS + the end card's post-VO hold (P03, 2026-07-17).
    Cards are full-screen text-over-dark beats emitted as `chapter-card` overlays by
    build_motion.apply_cards; each is ANCHOR-based (verbatim VO words → at_s), never an absolute second.
    Every message contains the word 'card' so lint/tests can assert on it."""
    e = []
    pvh = plan.get("post_vo_hold_s")
    if pvh is not None and not (_num(pvh) and pvh > 0):
        e.append("card post_vo_hold_s must be a number > 0 (seconds the end card holds past the last VO word)")
    cards = plan.get("cards")
    if cards is None:
        return e
    if not isinstance(cards, list):
        e.append("cards must be a list of chapter-card objects")
        return e
    for i, c in enumerate(cards):
        tag = f"card[{i}]"
        if not isinstance(c, dict):
            e.append(f"{tag}: must be an object")
            continue
        if not (isinstance(c.get("text"), str) and c["text"].strip()):
            e.append(f"{tag}: 'text' must be a non-empty string (the card copy)")
        end_card = c.get("end_card")
        if end_card is not None and not isinstance(end_card, bool):
            e.append(f"{tag}: 'end_card' must be a boolean")
        # A normal card needs a verbatim VO anchor; the end card may omit it (falls back to the last shot).
        if not c.get("end_card") and not (isinstance(c.get("anchor"), str) and c["anchor"].strip()):
            e.append(f"{tag}: 'anchor' must be a non-empty string of verbatim VO words")
        elif "anchor" in c and not (isinstance(c["anchor"], str) and c["anchor"].strip()):
            e.append(f"{tag}: 'anchor' must be a non-empty string of verbatim VO words")
        if "hold_s" in c and not (_num(c["hold_s"]) and c["hold_s"] > 0):
            e.append(f"{tag}: 'hold_s' must be a number > 0 (the card's on-screen window)")
        if "fade_s" in c and not (_num(c["fade_s"]) and c["fade_s"] > 0):
            e.append(f"{tag}: 'fade_s' must be a number > 0")
    return e


def _camera_errors(sid, cam):
    """Validate the planner-facing camera exception. Stage placement is checked separately because
    it needs shots.json's ordered stage metadata."""
    if not isinstance(cam, dict):
        return [f"{sid}: camera must be an object"]
    e = []
    move = cam.get("move")
    if move not in _CAMERA_MOVES:
        e.append(f"{sid}: camera.move must be one of {sorted(_CAMERA_MOVES)}")
    pan = cam.get("pan")
    if pan is not None and pan not in _CAMERA_PANS:
        e.append(f"{sid}: camera.pan must be null or one of {sorted(_CAMERA_PANS)}")
    intensity = cam.get("intensity", 1.0)
    if not (_num(intensity) and 0 < intensity <= 1.0):
        e.append(f"{sid}: camera.intensity must be a number in (0,1]")
    return e


def camera_stage_errors(plan, shots_meta):
    """A stage camera is read from its first frame by the engine. Reject a later delta / later
    same-stage declaration rather than accepting a move that the renderer would ignore."""
    meta = {s.get("id"): (i, s) for i, s in enumerate(shots_meta or []) if s.get("id")}
    e = []
    for entry in (plan or {}).get("shots", []):
        if not entry.get("camera") or entry.get("id") not in meta:
            continue
        i, shot = meta[entry["id"]]
        stage = shot.get("stage")
        previous = shots_meta[i - 1] if i else None
        if shot.get("stage_role") == "delta" or (stage and previous and previous.get("stage") == stage):
            e.append(f"{entry['id']}: camera may be declared only on a stage-start/base shot — "
                     "a later delta's camera is ignored by CameraStage")
    return e


def validate_plan(plan, menu):
    errors = _card_errors(plan)
    if "baseline_life" in plan and not isinstance(plan["baseline_life"], bool):
        errors.append("baseline_life must be a boolean when present")
    for shot in plan.get("shots", []):
        sid = shot.get("id", "<no id>")
        bg = shot.get("background")
        if not isinstance(bg, dict) or bg.get("mode") not in ("plate", "delta-chain"):
            errors.append(f"{sid}: background missing/invalid (need mode plate|delta-chain)")
        if "camera" in shot:
            errors.extend(_camera_errors(sid, shot["camera"]))
        for layer in shot.get("layers", []):
            lid = layer.get("id", "<no id>")
            src = layer.get("source")
            if src != "cutout":
                errors.append(f"{sid}/{lid}: source must be cutout")
                continue
            # Optional per-layer `seed`: the reference this cutout is generated FROM — a path
            # (the video's own plate, a canonical PNG) or a registry vocabulary name. image-gen
            # resolves it; the plan only guarantees it is a real string, since an unseeded cutout
            # invents its own register and lands off-style against a flat-cel plate.
            if "seed" in layer and not (isinstance(layer["seed"], str) and layer["seed"].strip()):
                errors.append(f"{sid}/{lid}: seed must be a non-empty string — a reference path "
                              f"or a registry vocabulary name")
            anim = layer.get("animation")
            if anim is not None:
                atype = anim.get("type")
                if not valid_animation(menu, src, atype):
                    errors.append(f"{sid}/{lid}: animation '{atype}' not on the {src} menu")
                else:
                    errors.extend(_cutout_param_errors(sid, lid, atype, anim))
    return errors


def cutout_layer_ids(plan):
    """Shot ids the plan materializes as plate+cutout (a plain layered shot OR a hybrid). These have
    NO scenes/<id>.png — image-gen writes plates/<id>.png + cutouts/<id>-<layer>.png instead — so the
    render-builder scene gate (render.resolve_scene_files) must EXEMPT them."""
    ids = set()
    for shot in (plan or {}).get("shots", []):
        layers = shot.get("layers", [])
        if any(l.get("source") == "cutout" for l in layers):
            ids.add(shot.get("id"))
        elif not layers and (((shot.get("background") or {}).get("plate"))
                             or ((shot.get("background") or {}).get("plate_prompt"))):
            # Plate-only passthrough: no scenes/<id>.png exists either — the plan's background
            # plate (explicit path, or plates/<id>.png materialized from plate_prompt) IS the
            # visual (wired by build_motion.apply_motion_plan). Exempt from the gate.
            ids.add(shot.get("id"))
    return ids
