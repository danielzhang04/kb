"""The unified audio plan (audio-director output). Splits one cue list into the EXISTING internal shapes
so the current resolvers/realizers stay unchanged. See references/audio-plan-schema.md."""
import json, os

_SFX_KEYS = ("anchor", "role", "pause_s", "in_pause", "gain_db", "sync", "variant", "fade_out_s")
_MUSIC_KEYS = ("from_anchor", "mood", "level_db", "track", "fade_out_s")
_DRY_KEYS = ("from_anchor", "to_anchor")
_KINDS = ("sfx", "pause", "music", "dry")


def split_plan(plan):
    """Re-bucket the unified cue list into (audio_cues, music_cues, music_dry) — the shapes
    resolve_cues / resolve_music_cues already accept. `sfx`+`pause` -> audio_cues; `music` -> music_cues;
    `dry` -> music_dry."""
    audio_cues, music_cues, music_dry = [], [], []
    for c in plan.get("cues", []):
        kind = c.get("kind")
        if kind in ("sfx", "pause"):
            audio_cues.append({k: c[k] for k in _SFX_KEYS if k in c})
        elif kind == "music":
            music_cues.append({k: c[k] for k in _MUSIC_KEYS if k in c})
        elif kind == "dry":
            music_dry.append({k: c[k] for k in _DRY_KEYS if k in c})
    return audio_cues, music_cues, music_dry


def load_audio_plan(video_dir):
    p = os.path.join(str(video_dir), "audio-plan.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _kind_counts(audio_cues, music_cues, music_dry):
    """Count authored/resolved effects in the existing internal cue shapes.

    Legacy audio-cues may combine a pause and role on one item, so count effects rather than rows.
    Unified plans normally keep those as two rows; both shapes produce the same four-kind summary.
    """
    return {
        "sfx": sum(1 for c in (audio_cues or []) if c.get("role")),
        "pause": sum(1 for c in (audio_cues or []) if c.get("pause_s") is not None),
        "music": len(music_cues or []),
        "dry": len(music_dry or []),
    }


def _union_seconds(spans, piece_end_s):
    """Duration of the union of resolved {at_s,to_s?} spans, clamped to the piece."""
    end = max(0.0, float(piece_end_s or 0.0))
    intervals = []
    for span in spans or []:
        start = min(end, max(0.0, float(span.get("at_s", 0.0))))
        stop = min(end, max(start, float(span.get("to_s", end))))
        if stop > start:
            intervals.append((start, stop))
    merged = []
    for start, stop in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], stop))
        else:
            merged.append((start, stop))
    return round(sum(stop - start for start, stop in merged), 3)


def build_audio_qa(*, authored_audio, authored_music, authored_dry,
                   resolved_audio, resolved_music, resolved_dry,
                   audio_spec, cue_gaps, piece_end_s, source):
    """Derived review data joining authored cues to anchor resolution and final realization.

    This is never generation input. The automatic default bed is visible in presence seconds but is
    deliberately absent from authored/resolved counts.
    """
    authored = _kind_counts(authored_audio, authored_music, authored_dry)
    resolved = _kind_counts(resolved_audio, resolved_music, resolved_dry)
    unresolved = {kind: max(0, authored[kind] - resolved[kind]) for kind in _KINDS}
    spec = audio_spec or {}
    return {
        "source": source,
        "authored_by_kind": authored,
        "resolved_by_kind": resolved,
        "unresolved_by_kind": unresolved,
        "resolved_pause_s": round(sum(float(g.get("dur_s", 0.0)) for g in (cue_gaps or [])), 3),
        "resolved_dry_s": _union_seconds(resolved_dry, piece_end_s),
        "music_present_s": round(sum(float(m.get("dur_s", 0.0))
                                      for m in (spec.get("music_states") or [])), 3),
        "default_bed": authored["music"] == 0 and bool(spec.get("music_states")),
        "silent_drops": {
            "sfx_missing": int(spec.get("sfx_missing", 0) or 0),
            "music_missing": int(spec.get("music_missing", 0) or 0),
        },
        "sfx_tail_overshoots": len(spec.get("sfx_tail_warnings") or []),
    }
