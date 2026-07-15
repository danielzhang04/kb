#!/usr/bin/env python3
"""Phase 3B authored music placement. Loads music-cues.json + resolves each cue/dry anchor to a word
time via the SHARED matcher (G4; a cue = a pseudo-shot with vo_ref=anchor). Resolve on the timeline
build_motion passes (the SHIFTED, post-breath word-timings) so segment times align with the shots.
Pure resolve + a thin loader; build_motion does the wiring. See references/audio-plan-schema.md."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import _NORM, match_shots_to_tokens   # noqa: E402  (the ONE shared vo_ref matcher, G4)


def load_music_cues(video_dir) -> tuple:
    p = Path(video_dir) / "music-cues.json"
    if not p.exists():
        return [], []
    d = json.loads(p.read_text(encoding="utf-8"))
    return (d.get("cues") or []), (d.get("dry") or [])


def _anchor_starts(items, key, word_timings):
    toks = [(_NORM(w), float(t)) for w, t in (word_timings or [])]
    toks = [(w, t) for w, t in toks if w]
    pseudo = [{"id": f"{key}{i}", "vo_ref": it.get(key, "")} for i, it in enumerate(items)]
    return match_shots_to_tokens(pseudo, toks)


def resolve_music_cues(cues, dry, word_timings) -> tuple:
    """(resolved_cues [{mood, at_s, level_db?}], resolved_dry [{at_s, to_s?}]). Unresolved anchors are
    dropped (lint catches them earlier). Each list is independently monotonic (matcher is cursor-advancing)."""
    rc = []
    for c, m in zip(cues, _anchor_starts(cues, "from_anchor", word_timings)):
        if m["start"] is not None:
            e = {"mood": c.get("mood"), "at_s": round(float(m["start"]), 3)}
            if c.get("level_db") is not None:
                e["level_db"] = c["level_db"]
            rc.append(e)
    rd = []
    from_m = _anchor_starts(dry, "from_anchor", word_timings)
    to_m = _anchor_starts(dry, "to_anchor", word_timings)
    for i, d in enumerate(dry):
        if from_m[i]["start"] is not None:
            span = {"at_s": round(float(from_m[i]["start"]), 3)}
            if d.get("to_anchor") and to_m[i]["start"] is not None:
                span["to_s"] = round(float(to_m[i]["start"]), 3)
            rd.append(span)
    return rc, rd
