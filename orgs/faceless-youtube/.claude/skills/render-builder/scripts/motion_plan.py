"""Validates a shots.motion.json plan against the schema + the animation menu."""
from menu import valid_animation

_ENGINE_KINDS = {"text", "stat-card", "counter", "meter", "chapter-card", "definition-card", "reveal"}

_DEVICE_CONTENT = {
    "stat-card": ["text"],
    "counter": ["from", "to"],
    "meter": ["label", "fraction"],
    "chapter-card": ["text"],
    "definition-card": ["term", "def"],
    "reveal": ["items"],
}

_SLIDE_EDGES = {"left", "right", "top", "bottom"}
_APPEAR_STYLES = {"pop", "fade", "slam"}


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


def validate_plan(plan, menu):
    errors = []
    for shot in plan.get("shots", []):
        sid = shot.get("id", "<no id>")
        bg = shot.get("background")
        if not isinstance(bg, dict) or bg.get("mode") not in ("plate", "delta-chain"):
            errors.append(f"{sid}: background missing/invalid (need mode plate|delta-chain)")
        for layer in shot.get("layers", []):
            lid = layer.get("id", "<no id>")
            src = layer.get("source")
            if src not in ("cutout", "engine"):
                errors.append(f"{sid}/{lid}: source must be cutout|engine")
                continue
            if src == "engine":
                kind = layer.get("kind")
                if kind not in _ENGINE_KINDS:
                    errors.append(f"{sid}/{lid}: engine layer needs a valid kind")
                elif kind in _DEVICE_CONTENT:
                    content = layer.get("content")
                    if not isinstance(content, dict):
                        errors.append(f"{sid}/{lid}: {kind} needs a content object")
                    else:
                        for f in _DEVICE_CONTENT[kind]:
                            if f not in content:
                                errors.append(f"{sid}/{lid}: {kind} content missing '{f}'")
            anim = layer.get("animation")
            if anim is not None:
                atype = anim.get("type")
                if not valid_animation(menu, src, atype):
                    errors.append(f"{sid}/{lid}: animation '{atype}' not on the {src} menu")
                elif src == "cutout":
                    errors.extend(_cutout_param_errors(sid, lid, atype, anim))
    return errors


def cutout_layer_ids(plan):
    """Shot ids the plan materializes as plate+cutout (a plain layered shot OR a hybrid). These have
    NO scenes/<id>.png — image-gen writes plates/<id>.png + cutouts/<id>-<layer>.png instead — so the
    render-builder scene gate (render.resolve_scene_files) must EXEMPT them."""
    ids = set()
    for shot in (plan or {}).get("shots", []):
        if any(l.get("source") == "cutout" for l in shot.get("layers", [])):
            ids.add(shot.get("id"))
    return ids
