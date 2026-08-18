import json, os

ROOT = r"C:/Users/danie/kb-worktrees/boss-taste-forensics"
V = os.path.join(ROOT, "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh")
merged_path = os.path.join(V, "assets/_review/merged.json")

mine = {
    "L12": {"f": "clean", "s": "clean", "r": "clean", "worst": "clean",
            "why": "RETRY round 1 (L12-fix), fresh-eyes review: lamp fixture now reads as a dark unlit silhouette in the exact same position/crop as approved L11, room goes convincingly deep blue while the drive keeps its own warm glow, everything else held pixel-identical to the parent. Clean on all 3 axes."},
    "L14": {"f": "arms cross/stack at two different heights rather than pressing side-by-side flat together at hip height",
            "s": "clean",
            "r": "pc-boxy drawn with articulated fingered hands gripping the drawer instead of its established stubby, handless arms (no_hands rig break)",
            "worst": "rig",
            "why": "RETRY round 1 (L14-fix), fresh-eyes review: the prop-drive redesign (cream-buff body, teal trim) is fixed and on-model, and both arms now reach the same drawer (up from one arm on/one arm off), but the retry introduced a NEW rig-identity defect -- pc-boxy is drawn with human-style fingered hands, which its established design explicitly does not have (stub arms only). This was the ONE sanctioned retry; it is now exhausted -- kept as the best attempt (fixes 2 of 3 original defects) but PARKED, not verified. suspected_mechanism_layer: vpw_authoring -- the shot's own action verb (\"shoving\" a drawer shut) inherently pulls the render toward hand-based manipulation, in tension with pc-boxy's no-hands canon; a future re-author should replace the shoving/pressing verb with a stub-arm-compatible action (e.g. pc-boxy body-checking or leaning its whole side against the drawer) rather than a third prompt-only retry on the same mechanism."},
}

# Re-read fresh immediately before writing (shared file policy). SCOPE: only L12/L14 (never
# previously written to merged.json by me -- round 1 deliberately held them back).
d = json.load(open(merged_path, encoding="utf-8"))
existing_ids = {e.get("id") for e in d}
for sid, v in mine.items():
    if sid in existing_ids:
        d = [e for e in d if e.get("id") != sid]
    d.append({"id": sid, **v})

json.dump(d, open(merged_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("wrote", merged_path, "total entries", len(d))
