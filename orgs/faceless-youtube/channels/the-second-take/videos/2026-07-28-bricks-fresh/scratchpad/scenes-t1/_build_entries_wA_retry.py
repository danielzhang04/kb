import json, hashlib, os

V = r"orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh"
spec = json.load(open(f"{V}/scratchpad/scenes-t1/retry-spec-wA-r1.json", encoding="utf-8"))
overlay = json.load(open(f"{V}/scratchpad/scenes-t1/retry-overlay-wA-r1.json", encoding="utf-8"))
overlay_by_shot = {e["shot"]: e for e in overlay["entries"]}

TECH_B = "(b) Seeded composition — locked character(s) in composed environment"
TECH_C = "(c) Character-free scene — cast-free composition"
named_char_shots = {"L05", "L07"}

entries = []
for item in spec:
    fix_name = item["name"]  # e.g. L03-fix
    sid = fix_name.replace("-fix", "")
    seeds = item["seed_roles"]
    technique = TECH_B if sid in named_char_shots else TECH_C
    note_bits = []
    for s in seeds:
        if s["character"] == "lettering-marker-italic":
            note_bits.append("LETTERING — text-bearing prompt; §5 exemplar `lettering-marker-italic` derived")
        if s["character"] == "scene-style-tile":
            note_bits.append("STYLE TILE — cast-free frame; §5 anchor `scene-style-tile` derived (line register + palette only)")
        if s["character"] == "prop-beige-pc":
            note_bits.append("`prop-beige-pc` match-prop canonical seeded")
        if s["character"] == "pc-boxy" and s["role"] == "canonical":
            note_bits.append("`pc-boxy` character canonical seeded directly (fresh regen off canonical, not off the flagged r1 frame)")
    staged = f"_staging/{fix_name}.png"
    staged_full = f"orgs/faceless-youtube/channels/the-second-take/visual-kit/{staged}"
    sha = hashlib.sha256(open(staged_full, "rb").read()).hexdigest() if os.path.exists(staged_full) else "MISSING"
    ov = overlay_by_shot[sid]
    retry_cause = f"r1 defect fixed by exact replace — from: \"{ov['replace']['from'][:120]}\" -> to: \"{ov['replace']['to'][:180]}\""
    entries.append({
        "shot_id": sid,
        "file": f"assets/scenes/{sid}.png",
        "technique": technique,
        "seeds": seeds,
        "flagged": False,
        "review_status": "unreviewed",
        "parked_reasons": [],
        "retry_cause": retry_cause,
        "parent_depth": 0,
        "lineage": 0,
        "notes": "; ".join(note_bits) + f"; RETRY overlay from `{sid}` (worker A round 1 retry); promoted from _staging/{fix_name}.png (sha256 {sha}) to canonical assets/scenes/{sid}.png"
    })

out = f"{V}/scratchpad/scenes-t1/entries-wA-retry1.json"
json.dump(entries, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote", out, len(entries), "entries")
