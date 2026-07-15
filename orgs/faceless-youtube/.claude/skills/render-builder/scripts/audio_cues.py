#!/usr/bin/env python3
"""Authored content-cue layer (Phase 2b). Loads audio-cues.json + resolves each cue's verbatim VO-phrase
`anchor` to a word time via the SHARED matcher (a cue = a pseudo-shot with vo_ref=anchor), then splits into
pause-gaps (silence BEFORE the anchor) + role-events (SFX ON the anchor = the gap end). Pure resolve + a thin
loader; build_motion does the wiring. See references/audio-plan-schema.md."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import _NORM, match_shots_to_tokens   # noqa: E402  (the ONE shared vo_ref matcher, G1)


def load_cues(video_dir) -> list:
    p = Path(video_dir) / "audio-cues.json"
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return data.get("cues") or []


def resolve_cues(cues, word_timings) -> list:
    """Each cue + `at_s` (ORIGINAL timeline). Cursor-advancing (repeated anchors hit successive words);
    an unresolved anchor is dropped. Cues stay in authored (narration) order."""
    toks = [(_NORM(w), float(t)) for w, t in (word_timings or [])]
    toks = [(w, t) for w, t in toks if w]
    pseudo = [{"id": f"cue{i}", "vo_ref": c.get("anchor", "")} for i, c in enumerate(cues)]
    matched = match_shots_to_tokens(pseudo, toks)
    out = []
    for c, m in zip(cues, matched):
        if m["start"] is not None:
            out.append({**c, "at_s": round(float(m["start"]), 3)})
    return out


def cue_pause_gaps(resolved) -> list:
    """Silence gaps at each cue with a pause_s (inserted BEFORE the anchor word). ORIGINAL-timeline at_s."""
    return [{"at_s": c["at_s"], "dur_s": float(c["pause_s"]), "source": "cue"}
            for c in resolved if c.get("pause_s")]


def cue_role_events(resolved, gaps) -> list:
    """SFX role-events at the anchor word, SHIFTED past the breath gaps. Two placements:
      - default (G2): shift past every gap at-or-before the anchor (incl. the cue's OWN pause) -> the SFX
        lands at the gap END, ON the word, after any silence (the number-reveal punch, cash, sting).
      - `in_pause: true`: shift past only the gaps STRICTLY before the anchor (exclude the cue's own pause)
        -> the SFX lands at the gap START, IN the silence, BEFORE the word drops (an interrupt sound: a
        record scratch, a buzzer). It survives the full-stop (which only drops events strictly inside a gap).
    Role-less cues (pure pauses) emit nothing here."""
    out = []
    for c in resolved:
        if not c.get("role"):
            continue
        earlier = (lambda g: g["at_s"] < c["at_s"]) if c.get("in_pause") else (lambda g: g["at_s"] <= c["at_s"])
        at = c["at_s"] + sum(g["dur_s"] for g in (gaps or []) if earlier(g))
        e = {"at_s": round(at, 3), "role": c["role"]}
        if c.get("gain_db") is not None:
            e["gain_db"] = c["gain_db"]
        if c.get("sync"):
            e["sync"] = c["sync"]   # element-sync: build_audio.snap_element_sfx snaps it to the cut/overlay
        out.append(e)
    return out
