import json

V = r"orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh"
manifest_path = f"{V}/assets/scenes/manifest.json"
new_entries_path = f"{V}/scratchpad/scenes-t1/entries-wA-retry1.json"
combined_path = f"{V}/scratchpad/scenes-t1/combined-spec-wA-retry1.json"

# fresh re-read right before writing
current = json.load(open(manifest_path, encoding="utf-8"))
mine = json.load(open(new_entries_path, encoding="utf-8"))
mine_ids = {e["shot_id"] for e in mine}

kept = [e for e in current["shots"] if e["shot_id"] not in mine_ids]
combined = kept + mine

json.dump(combined, open(combined_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("kept:", len(kept), "mine:", len(mine), "combined:", len(combined))
