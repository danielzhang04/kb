"""G4 grandfather stamping — boss-executed, sanctioned tools only.

Resolves the 16 gate-refused standing assets to their registry files, emits the
pre-keyed skeleton via build_review_artifact (canonical_sha256 computed off the
bytes on disk — never hand-authored), fills PASS verdicts with truthful
provenance, and stamps through stamp_review.py (the only sanctioned writer).
The two P12 FAIL rows are never touched (verified before and after).
"""
import io
import json
import os
import subprocess
import sys

WT = r"C:\Users\danie\kb-worktrees\boss-taste-forensics"
ORG = os.path.join(WT, "orgs", "faceless-youtube")
KIT = os.path.join(ORG, "channels", "the-second-take", "visual-kit")
SCRIPTS = os.path.join(ORG, ".claude", "skills", "image-generation", "scripts")
VIDEO = os.path.join(ORG, "channels", "the-second-take", "videos", "2026-07-28-bricks-fresh")
HERE = os.path.dirname(os.path.abspath(__file__))
STAGING = os.path.join(KIT, "_staging")
STORE = os.path.join(STAGING, "review.json")

NAMES = [
    "lettering-marker-italic", "scene-style-tile", "crowd-exemplar", "handshake",
    "expr-delighted", "expr-smug", "expr-deadpan", "expr-worried", "expr-greedy",
    "expr-annoyed", "action-powerstance", "action-armscrossed", "action-offering",
    "action-thumbsdown", "action-slump", "hold-both-hands",
]
REVIEWER = ("grandfathered 2026-08-13 - boss ruling per Daniel G2 trust statement "
            "(2026-08-12); standing asset in use across prior operator-reviewed runs, "
            "predates the P3 gate")
DATE = "2026-08-13"


def store_p12_rows():
    with io.open(STORE, encoding="utf-8") as f:
        j = json.load(f)
    figs = j.get("figures", {})
    return {k: figs[k] for k in ("expr-shock", "expr-pleading") if k in figs}, len(figs)


def main():
    before_p12, before_n = store_p12_rows()
    assert len(before_p12) == 2, "P12 FAIL rows missing before stamping — abort"

    reg = json.load(io.open(os.path.join(KIT, "registry", "registry.json"), encoding="utf-8"))
    rows = reg["assets"] if isinstance(reg, dict) and "assets" in reg else reg
    by_name = {r["name"]: r for r in rows}
    missing = [n for n in NAMES if n not in by_name]
    assert not missing, f"not in registry: {missing}"
    paths = []
    for n in NAMES:
        p = os.path.join(ORG, *by_name[n]["file"].split("/"))
        assert os.path.isfile(p), f"asset file missing on disk: {p}"
        paths.append(p)

    skel = os.path.join(HERE, "g4-grandfather-verdicts.json")
    board = os.path.join(HERE, "g4-grandfather-board.html")
    cmd = [sys.executable, os.path.join(SCRIPTS, "build_review_artifact.py"),
           "--video", VIDEO, "--staging", STAGING, "--out", board,
           "--figures-out", skel, "--assets", *paths]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-2000:])
    if r.returncode != 0:
        print(r.stderr[-2000:])
        raise SystemExit(f"skeleton build failed rc={r.returncode}")

    j = json.load(io.open(skel, encoding="utf-8"))
    recs = j if isinstance(j, list) else j.get("figures", j)
    stamped = 0
    it = recs.items() if isinstance(recs, dict) else ((x.get("name"), x) for x in recs)
    for name, rec in it:
        if name not in NAMES:
            continue
        assert rec.get("canonical_sha256"), f"{name}: skeleton carries no digest"
        v = rec.get("verdicts") or {}
        rec["verdicts"] = {k: "pass" for k in (v.keys() or ["rig", "flat-cel-hazard"])}
        rec["reviewer"] = REVIEWER
        rec["date"] = DATE
        stamped += 1
    assert stamped == len(NAMES), f"skeleton missing assets: stamped {stamped}/{len(NAMES)}"
    with io.open(skel, "w", encoding="utf-8") as f:
        json.dump(j, f, indent=1)

    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "stamp_review.py"),
                        "--figures", skel, STAGING], capture_output=True, text=True)
    print(r.stdout[-2000:])
    if r.returncode != 0:
        print(r.stderr[-2000:])
        raise SystemExit(f"stamp failed rc={r.returncode}")

    after_p12, after_n = store_p12_rows()
    assert after_p12 == before_p12, "P12 FAIL rows changed — MUST NOT HAPPEN"
    print(f"store rows: {before_n} -> {after_n}; P12 FAILs intact; {stamped} grandfathered")


if __name__ == "__main__":
    main()
