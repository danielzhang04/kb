import json, os

ROOT = r"C:/Users/danie/kb-worktrees/boss-taste-forensics"
V = os.path.join(ROOT, "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh")
merged_path = os.path.join(V, "assets/_review/merged.json")

# stamp_review.py's classifier requires explicit per-axis "f"/"s"/"r" (fidelity/style/rig) fields;
# {id, worst, why} alone reads as "missing verdict" on all 3 axes and force-parks even a clean shot.
mine = {
    "L10": {"f": "clean", "s": "clean", "r": "clean", "worst": "clean",
            "why": "Fresh-eyes review: no-hands pc-boxy on-model (expr-talking register correct), panel/drive/desk props all present and placed correctly, cream-teal-charcoal palette locked, no stray text. Clean on all 3 axes."},
    "L11": {"f": "clean", "s": "clean", "r": "clean", "worst": "clean",
            "why": "Fresh-eyes review: pc-boxy on-model with correct expr-delighted register, drive hugged to chest per spec, bedroom staging (bed/blank headboard wall/curtained window/cropped bedpost) matches exactly, blue-amber-cream palette correct. Clean on all 3 axes."},
    "L13": {"f": "clean", "s": "clean", "r": "clean", "worst": "clean",
            "why": "Fresh-eyes review: character-free prop-drive scale-up shot, all 3 named drawer contents (folders/photo tin/cassette stack) present, cream-buff-teal palette correct, no stray character or text. Clean on all 3 axes."},
    "L15": {"f": "clean", "s": "clean", "r": "crowd figures on adult proportions + one individuated headwear silhouette (rig)", "worst": "rig",
            "why": "Fresh-eyes review FAIL (rig only; fidelity/style clean): crowd figures read with normal adult body proportions instead of the locked squat crowd-rig proportion, and one figure wears a distinct dark full head/shoulder covering not shared by the rest of the group (violates the 2-3-repeating-silhouette crowd rule). No retry attempted: the defect traces to the forge-derived \u00a72d crowd-rig policy clause's effectiveness, not to any authored still_prompt text \u2014 no legitimate single-clause authored-payload retry lever exists for this shot. Flagged for human/root-cause review rather than a guessed re-roll."},
}

# Re-read fresh immediately before writing (shared file policy). SCOPE: only my own 4 ids
# (L10/L11/L13/L15) are touched here -- L12/L14 held back for the retry round, and every OTHER
# shot's entry in this shared file is left byte-identical (out of my L10-L17 partition).
d = json.load(open(merged_path, encoding="utf-8"))
existing_ids = {e.get("id") for e in d}
for sid, v in mine.items():
    if sid in existing_ids:
        d = [e for e in d if e.get("id") != sid]
    d.append({"id": sid, **v})

json.dump(d, open(merged_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("wrote", merged_path, "total entries", len(d))
