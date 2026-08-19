import json, hashlib, shutil, os

VIDEO = r"C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh"
STAGING = r"C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube\channels\the-second-take\visual-kit\_staging"

APPROVED = ["L02", "L04", "L06", "L11", "L16", "L17", "L20", "L21"]

TECHNIQUE = {
    "L02": "(c) Character-free scene -- cast-free composition (crowd) -- v2 doctrine regen",
    "L04": "(c) Character-free scene -- cast-free composition (lettering + style tile) -- v2 doctrine regen",
    "L06": "(b) Seeded composition -- locked prop in composed environment (crowd) -- v2 doctrine regen",
    "L11": "(b) Seeded composition -- locked character in composed environment [bedside-table stage BASE] -- v2 doctrine regen",
    "L16": "(b) Seeded composition -- locked characters in composed environment [pc-ring stage BASE] -- v2 doctrine regen",
    "L17": "(e) Seeded delta-chain -- in-chain parent + held canonicals [pc-ring stage DELTA] -- v2 doctrine regen, parent is the FRESH same-wave L16",
    "L20": "(b) Seeded composition -- locked character(s) in composed environment (crowd) [supply-stall stage BASE] -- v2 doctrine regen, STEP-1 figure re-minted (costume-digest change)",
    "L21": "(e) Seeded delta-chain -- supply-stall delta -- v2 doctrine regen, parent is the FRESH same-wave L20 (discarded a stale-parent-contaminated first attempt)",
}
NOTES = "scene-regen-w3 2026-08-19: superseded pre-doctrine (f8aa5e52) frame under the freshly re-authored shots.json."

spec = json.load(open(os.path.join(VIDEO, "scratchpad", "scene-regen-w3", "spec.json"), encoding="utf-8"))
spec_by_name = {it["name"]: it for it in spec if isinstance(it, dict)}

manifest_path = os.path.join(VIDEO, "assets", "scenes", "manifest.json")
manifest = json.load(open(manifest_path, encoding="utf-8"))
by_id = {e.get("shot_id"): e for e in manifest["shots"]}

report = []
for sid in APPROVED:
    src = os.path.join(STAGING, sid + ".png")
    dst = os.path.join(VIDEO, "assets", "scenes", sid + ".png")
    src_sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
    shutil.copy2(src, dst)
    dst_sha = hashlib.sha256(open(dst, "rb").read()).hexdigest()
    assert src_sha == dst_sha, f"{sid}: sha256 mismatch after copy!"
    it = spec_by_name[sid]
    entry = by_id[sid]
    entry["file"] = f"assets/scenes/{sid}.png"
    entry["technique"] = TECHNIQUE[sid]
    entry["seeds"] = it.get("seed_roles")
    entry["flagged"] = False
    entry["review_status"] = "unreviewed"
    entry["parked_reasons"] = []
    entry["retry_cause"] = None
    entry["parent_depth"] = it.get("parent_depth", 0)
    entry["lineage"] = it.get("lineage", 0)
    entry["notes"] = NOTES
    report.append(f"{sid}: promoted, sha256={dst_sha[:12]}...")

json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), indent=2)
print("\n".join(report))
print(f"manifest entries: {len(manifest['shots'])}")
