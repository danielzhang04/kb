import json, hashlib, os

V = r"orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh"
spec = json.load(open(f"{V}/scratchpad/scenes-t1/spec-wA.json", encoding="utf-8"))

TECH_B = "(b) Seeded composition — locked character(s) in composed environment"
TECH_C = "(c) Character-free scene — cast-free composition"

named_char_shots = {"L01", "L05", "L06", "L07"}

entries = []
for item in spec:
    sid = item["name"]
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
            note_bits.append("`pc-boxy` character canonical seeded directly (no pose primitive; STEP-1 not required)")
    staged = f"_staging/{sid}.png"
    staged_full = f"orgs/faceless-youtube/channels/the-second-take/visual-kit/{staged}"
    sha = hashlib.sha256(open(staged_full, "rb").read()).hexdigest() if os.path.exists(staged_full) else "MISSING"
    entries.append({
        "shot_id": sid,
        "file": f"assets/scenes/{sid}.png",
        "technique": technique,
        "seeds": seeds,
        "flagged": False,
        "review_status": "unreviewed",
        "parked_reasons": [],
        "retry_cause": None,
        "parent_depth": 0,
        "lineage": 0,
        "notes": "; ".join(note_bits) + f"; generated to _staging/{sid}.png (sha256 {sha}), worker A round 1"
    })

out = f"{V}/scratchpad/scenes-t1/entries-wA-r1.json"
json.dump(entries, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote", out, len(entries), "entries")
