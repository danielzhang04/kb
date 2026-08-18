import json, os

ROOT = r"C:/Users/danie/kb-worktrees/boss-taste-forensics"
V = os.path.join(ROOT, "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh")
manifest_path = os.path.join(V, "assets/scenes/manifest.json")

shas = {
    "L12": "0f2e81e836b850e4e3d205f4048dcb8533c15dd16c87266dc55a859873cfe68c",
    "L14": "021766a33a3d11d620587c55bfb9a8d4ba5764a02112e43be55f0d5324515680",
}

seeds = {
    "L12": [
        {"path": "channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/L11.png", "role": "parent", "character": None},
        {"path": "channels/the-second-take/visual-kit/refs/pc-boxy/pc-boxy.png", "role": "canonical", "character": "pc-boxy"},
        {"path": "channels/the-second-take/visual-kit/refs/env/prop-drive.png", "role": "prop", "character": "prop-drive"},
    ],
    "L14": [
        {"path": "channels/the-second-take/visual-kit/refs/pc-boxy/pc-boxy.png", "role": "canonical", "character": "pc-boxy"},
        {"path": "channels/the-second-take/visual-kit/refs/base/expr-caught.png", "role": "expression", "character": "pc-boxy"},
        {"path": "channels/the-second-take/visual-kit/refs/env/prop-drive.png", "role": "prop", "character": "prop-drive"},
    ],
}

retry_cause = {
    "L12": 'r1 defect fixed by exact replace \u2014 from: "the bedside lamp is out and the whole room has gone deep blue dark" -> to: "the bedside lamp is switched off, its shade and stand still visible as a dark unlit silhouette exactly where established in the held set, and the whole room has gone deep blue dark, held at the exact same framing and crop as before"',
    "L14": 'r1 defect fixed by exact replace \u2014 from: "the oversized `prop-drive` body, which stands stage-left..." -> to: "...its same cream-buff body, teal trim and rounded drive-shaped top exactly as established, not a plain metal filing cabinet... Both its stubby arms, side by side, are pressed flat together against that SAME second drawer at hip height..." (fixed prop identity + drawer engagement; retry introduced a NEW rig defect \u2014 fingered hands \u2014 not present in the original; retry exhausted, kept as best attempt, PARKED)',
}

notes = {
    "L12": "`pc-boxy` no_hands -> canonical; RETRY overlay from `L12`; promoted from _staging/L12-fix.png (sha256 %s, verified match on copy: True) to canonical assets/scenes/L12.png per chain-parent resolution law; verify record: fresh-eyes retry review round 1, pass (all-clean)." % shas["L12"],
    "L14": "`pc-boxy` no_hands -> canonical; RETRY overlay from `L14`; promoted from _staging/L14-fix.png (sha256 %s, verified match on copy: True) to canonical assets/scenes/L14.png per chain-parent resolution law (best-attempt kept, not verified); verify record: fresh-eyes retry review round 1, FAIL (rig: pc-boxy drawn with fingered hands instead of established stub arms). Retry exhausted \u2014 no third attempt. suspected_mechanism_layer: vpw_authoring \u2014 the shot's \"shoving\" action verb pulls toward hand-based manipulation, in tension with pc-boxy's no-hands canon; a future fix should re-author the action (e.g. body-check / lean-against instead of shove-with-hands) rather than a further prompt-only retry on the same mechanism." % shas["L14"],
}

techniques = {
    "L12": "(e) Seeded delta-chain \u2014 in-chain parent + held canonical [bedside-table stage DELTA] (RETRY r1, verified)",
    "L14": "(b) Seeded composition \u2014 locked character(s) in composed environment (RETRY r1, exhausted, PARKED \u2014 best attempt kept)",
}

d = json.load(open(manifest_path, encoding="utf-8"))
for e in d["shots"]:
    sid = e.get("shot_id")
    if sid in ("L12", "L14"):
        e["seeds"] = seeds[sid]
        e["technique"] = techniques[sid]
        e["retry_cause"] = retry_cause[sid]
        e["notes"] = notes[sid]
        # review_status / parked_reasons already written by stamp_review.py -- left untouched.

json.dump(d, open(manifest_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("updated L12/L14 manifest rows in place")
