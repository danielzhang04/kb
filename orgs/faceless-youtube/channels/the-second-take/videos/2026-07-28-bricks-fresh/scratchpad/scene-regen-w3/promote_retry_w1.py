import json, hashlib, shutil, os

VIDEO = r"C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh"
STAGING = r"C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube\channels\the-second-take\visual-kit\_staging"

# shot_id -> (staged retry filename stem, technique note, retry_cause, seed_roles)
retry_spec = json.load(open(os.path.join(VIDEO, "scratchpad", "scene-regen-w3", "retry-spec-w1.json"), encoding="utf-8"))
by_name = {it["name"]: it for it in retry_spec if isinstance(it, dict)}

PLAN = {
    "L03": {
        "staged": "L03-retry1",
        "technique": "(c) Character-free scene -- cast-free composition (crowd) -- v2 doctrine regen, ONE sanctioned content retry",
        "retry_cause": "rig FAIL: bald near-foreground crowd heads drew a `C`-shaped ear mark + nose bump at extreme close crop (bible S3 no-nose/no-ears); surgically rewrote the 'foreground a cropped band of near heads...' clause to state flat/featureless cheeks explicitly at that crop scale. Verified clean after retry (ear/nose gone, 4-digit hands confirmed).",
    },
    "L07": {
        "staged": "L07-w3retry1",
        "technique": "(b) Seeded composition -- locked prop in composed environment (crowd) -- v2 doctrine regen, ONE sanctioned content retry",
        "retry_cause": "fidelity+rig FAIL: crowd rendered at near-named-cast scale filling both frame flanks (violated 'clearly smaller crowd... at the far side') with individuated angry brows/open-shout mouths per figure (violated crowd-rig uniform-simple-face invariant); surgically rewrote the 'background at the far side of those tables...' clause with explicit relative-scale anchor (roughly a third the counter unit's height, packed into one tight distant knot, never spreading to the side edges) and explicit uniform-face restatement, dropping the mood adjective that was driving individuated expressions. Verified clean after retry.",
    },
}

report = []
for sid, plan in PLAN.items():
    it = by_name[plan["staged"]]
    src = os.path.join(STAGING, plan["staged"] + ".png")
    dst = os.path.join(VIDEO, "assets", "scenes", sid + ".png")
    src_sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
    shutil.copy2(src, dst)
    dst_sha = hashlib.sha256(open(dst, "rb").read()).hexdigest()
    assert src_sha == dst_sha, f"{sid}: sha256 mismatch after copy!"

    manifest_path = os.path.join(VIDEO, "assets", "scenes", "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    entry = next(e for e in manifest["shots"] if e.get("shot_id") == sid)
    entry["file"] = f"assets/scenes/{sid}.png"
    entry["technique"] = plan["technique"]
    entry["seeds"] = it.get("seed_roles")
    entry["flagged"] = False
    entry["review_status"] = "unreviewed"
    entry["parked_reasons"] = []
    entry["retry_cause"] = plan["retry_cause"]
    entry["parent_depth"] = it.get("parent_depth", 0)
    entry["lineage"] = it.get("lineage", 0)
    entry["notes"] = "scene-regen-w3 2026-08-19: superseded pre-doctrine (f8aa5e52) frame; ONE sanctioned content retry applied and verified clean."
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), indent=2)
    report.append(f"{sid}: promoted (retry), sha256={dst_sha[:12]}...")

print("\n".join(report))
