#!/usr/bin/env python3
"""Field/vocabulary lint for audio-plan.json. Anchor RESOLUTION is checked at build time by the shared
resolvers; this validates kinds, required fields, and pool membership. Derived check only."""
import json, sys


def lint(plan, sfx_pools, music_pools):
    errors = []
    for i, c in enumerate(plan.get("cues", [])):
        tag = f"cue[{i}]"
        kind = c.get("kind")
        if kind == "sfx":
            if not c.get("anchor"):
                errors.append(f"{tag}: sfx needs anchor")
            if not c.get("role"):
                errors.append(f"{tag}: sfx needs role")
            elif c["role"] not in sfx_pools:
                errors.append(f"{tag}: role '{c['role']}' not in sfx_pools")
            # `variant` PIN (optional): an exact file stem, resolves to audio/sfx/<variant>.mp3 (overrides
            # pool rotation + consistent_sfx). Need NOT be in the pool list (may be an on-disk alternate).
            # Existence is enforced at build (HARD ERROR if absent); lint checks only the shape.
            if "variant" in c and not (isinstance(c["variant"], str) and c["variant"].strip()):
                errors.append(f"{tag}: sfx variant must be a non-empty file stem")
            # `fade_out_s` (optional): ramps the SFX tail to silence over its last N seconds (P16 — a
            # long applause/riser rings out instead of hard-cutting). Must be a non-negative number.
            if "fade_out_s" in c and not (isinstance(c["fade_out_s"], (int, float))
                                          and not isinstance(c["fade_out_s"], bool) and c["fade_out_s"] >= 0):
                errors.append(f"{tag}: sfx fade_out_s must be a non-negative number")
        elif kind == "pause":
            if not c.get("anchor"):
                errors.append(f"{tag}: pause needs anchor")
            if not c.get("pause_s"):
                errors.append(f"{tag}: pause needs pause_s")
            if c.get("in_pause") and not c.get("pause_s"):
                errors.append(f"{tag}: in_pause requires pause_s")
        elif kind == "music":
            if not c.get("from_anchor"):
                errors.append(f"{tag}: music needs from_anchor")
            if not c.get("mood"):
                errors.append(f"{tag}: music needs mood")
            elif c["mood"] not in music_pools:
                errors.append(f"{tag}: mood '{c['mood']}' not in music_pools")
            # `track` PIN (optional): an exact bed stem, resolves to audio/beds/<track>.mp3 (overrides
            # mood-pool index selection). Need NOT be in the mood's pool. Existence enforced at build
            # (HARD ERROR if absent); lint checks only the shape.
            if "track" in c and not (isinstance(c["track"], str) and c["track"].strip()):
                errors.append(f"{tag}: music track must be a non-empty bed stem")
            # `fade_out_s` (optional): per-cue fade-out override (seconds) for THIS segment's end — e.g. a
            # longer fade INTO a title card; absent -> the global music_fade_s.out segment-end fade. Number >= 0.
            if "fade_out_s" in c and not (isinstance(c["fade_out_s"], (int, float))
                                          and not isinstance(c["fade_out_s"], bool) and c["fade_out_s"] >= 0):
                errors.append(f"{tag}: music fade_out_s must be a non-negative number")
        elif kind == "dry":
            if not c.get("from_anchor"):
                errors.append(f"{tag}: dry needs from_anchor")
        else:
            errors.append(f"{tag}: unknown kind '{kind}' (expected sfx|pause|music|dry)")
    return errors


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: lint_audio_plan.py <audio-plan.json> <audio-tokens.json>")
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    tokens = json.load(open(sys.argv[2], encoding="utf-8"))
    errs = lint(plan, tokens.get("sfx_pools") or {}, tokens.get("music_pools") or {})
    for e in errs:
        print("ERR", e)
    print(f"{len(errs)} error(s)")
    sys.exit(1 if errs else 0)
