import json, os

ROOT = r"C:/Users/danie/kb-worktrees/boss-taste-forensics"
V = os.path.join(ROOT, "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh")

manifest_path = os.path.join(V, "assets/scenes/manifest.json")
d = json.load(open(manifest_path, encoding="utf-8"))
mine = {"L10", "L11", "L12", "L13", "L14", "L15"}
existing = [e for e in d["shots"] if e.get("shot_id") not in mine]

spec = json.load(open(os.path.join(V, "scratchpad/scenes-t1/wB-spec.json"), encoding="utf-8"))
spec_by_name = {i["name"]: i for i in spec}

techniques = {
    "L10": "(d) One-shot single-character \u2014 pc-boxy at desk with prop-drive",
    "L11": "(b) Seeded composition \u2014 locked character in composed environment [bedside-table stage BASE]",
    "L12": "(e) Seeded delta-chain \u2014 in-chain parent + held canonical [bedside-table stage DELTA]",
    "L13": "(c) Character-free scene \u2014 cast-free composition, prop-drive blown up",
    "L14": "(b) Seeded composition \u2014 locked character(s) in composed environment",
    "L15": "(c) Character-free scene \u2014 crowd-bearing composition (no cast, crowd + props)",
}

shas = {
    "L10": "cae641485c0e17dabed5b575e849a85fed10fa08fcef1b7f55aa1e73df7c219d",
    "L11": "146e1777f2aa49c6cf329a2e7b1c00c2f7b4199254d2f944c48eb33bab0561ce",
    "L12": "cf0cf2f4cb42181fb8186e7d7e6eefa612ad978dcd8ff3b22d7a5f825efa5d82",
    "L13": "65ce0569ea470d927300a0ebc93372ffb03391518df97bdf5855d61c4a3b2d0e",
    "L14": "248040317c38f78ba729d2d3c7b46b9a2afd46f7b155db6196a5707e858827ca",
    "L15": "015ef4cf295ad63af5a4c0c9b6c9774e7418eb2e802c6f7fd5ac06701b8c77b6",
}

new_entries = []
for sid in ["L10", "L11", "L12", "L13", "L14", "L15"]:
    item = spec_by_name[sid]
    entry = {
        "shot_id": sid,
        "file": f"assets/scenes/{sid}.png",
        "technique": techniques[sid],
        "seeds": item["seed_roles"],
        "flagged": False,
        "review_status": "unreviewed",
        "parked_reasons": [],
        "retry_cause": None,
        "notes": f"why: {item['why']}; promoted from _staging/{sid}.png (sha256 {shas[sid]}, verified match on copy: True)",
    }
    new_entries.append(entry)

combined = existing + new_entries
out = {
    "video_slug": d.get("video_slug"),
    "generated": d.get("generated"),
    "notes": d.get("notes"),
    "shots": combined,
}
out_path = os.path.join(V, "scratchpad/scenes-t1/wB-manifest-entries.json")
json.dump(out, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("wrote", out_path, "total entries", len(combined))
