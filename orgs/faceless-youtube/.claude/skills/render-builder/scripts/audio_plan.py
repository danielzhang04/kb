"""The unified audio plan (audio-director output). Splits one cue list into the EXISTING internal shapes
so the current resolvers/realizers stay unchanged. See references/audio-plan-schema.md."""
import json, os

_SFX_KEYS = ("anchor", "role", "pause_s", "in_pause", "gain_db", "sync")
_MUSIC_KEYS = ("from_anchor", "mood", "level_db")
_DRY_KEYS = ("from_anchor", "to_anchor")


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
