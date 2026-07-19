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


def _needle(anchor: str) -> tuple:
    """The matcher's key for an anchor: its first 4 normalized words (same as match_shots_to_tokens)."""
    return tuple([x for x in (_NORM(w) for w in (anchor or "").split()) if x][:4])


def resolve_cues(cues, word_timings) -> list:
    """Each RESOLVED cue + `at_s` (ORIGINAL timeline). Cursor-advancing so repeated DISTINCT anchors hit
    successive words; BUT a run of CONSECUTIVE cues sharing the IDENTICAL anchor phrase all resolve to the
    SAME beat — a `pause` and its punctuating `sfx` authored as two cues on one anchor (either order) both
    land there, instead of the second hunting a next occurrence that doesn't exist and vanishing (the
    same-anchor drop bug: sting/record_scratch lost on the Poyais render). The cursor does not advance past
    a just-matched anchor until every sibling on that anchor has matched it. Cues stay in authored order.

    NO SILENT DROPS: a cue whose anchor fails to resolve is NOT quietly removed — it emits a LOUD warning
    (stderr) naming its anchor + role/pause, and is reported in the returned count via `len(cues)` vs the
    result. It is excluded from the returned list only so the downstream pause/role realizers stay clean."""
    toks = [(_NORM(w), float(t)) for w, t in (word_timings or [])]
    toks = [(w, t) for w, t in toks if w]
    # Group CONSECUTIVE cues that share a non-empty identical anchor needle → one match, fanned to all.
    groups = []   # (needle, [cue indices])
    for i, c in enumerate(cues):
        key = _needle(c.get("anchor", ""))
        if groups and key and groups[-1][0] == key:
            groups[-1][1].append(i)
        else:
            groups.append((key, [i]))
    pseudo = [{"id": f"grp{g}", "vo_ref": cues[idxs[0]].get("anchor", "")}
              for g, (key, idxs) in enumerate(groups)]
    matched = match_shots_to_tokens(pseudo, toks)   # ONE shared vo_ref matcher (G1); cursor still monotonic
    out, unresolved = [], []
    for (key, idxs), m in zip(groups, matched):
        for i in idxs:
            c = cues[i]
            if m["start"] is not None:
                out.append({**c, "at_s": round(float(m["start"]), 3)})
            else:
                unresolved.append(c)
    for c in unresolved:
        kind = "pause" if c.get("pause_s") else "sfx"
        role = c.get("role") or f"pause_s={c.get('pause_s')}"
        sys.stderr.write(
            f"  ! WARNING: audio cue DROPPED — {kind} '{role}' anchor "
            f"{c.get('anchor')!r} did not resolve to any VO word (check the verbatim phrase).\n")
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
        if c.get("fade_out_s") is not None:
            e["fade_out_s"] = c["fade_out_s"]   # SFX tail fade-out envelope (P16); forwarded to the event
        if c.get("variant"):
            e["variant"] = c["variant"]   # per-cue PIN: exact file, overrides pool rotation + consistent_sfx
        if c.get("sync"):
            e["sync"] = c["sync"]   # element-sync: build_audio.snap_element_sfx snaps it to the cut/overlay
        if c.get("anchor"):
            e["anchor"] = c["anchor"]   # carried only for the SFX-tail overshoot WARN label; stripped before render
        out.append(e)
    return out
