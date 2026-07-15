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
