"""Boss-executed stamp for the promoted pc-boxy canonical (boss ruling 2026-08-13).

Machine-tier spirit satisfied (symmetric-for-its-geometry, static, neutral, nothing
held); 3/4 turn accepted as inherited seed geometry (old canonical carries it too);
frontality = optional Daniel follow-up. Same sanctioned skeleton->stamp path as
g4_grandfather.py.
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
FRAME = os.path.join(KIT, "refs", "pc-boxy", "pc-boxy.png")

REVIEWER = ("boss ruling 2026-08-13: machine-tier spirit satisfied (symmetric/static/"
            "neutral/nothing held); 3/4 turn accepted as inherited geometry; frontality "
            "= optional Daniel follow-up. Verifier pair a2fc4d0bd5897b5f4/aae7a7b2c481a45c4 "
            "passed all axes except resting_stance frontality, overruled per spirit law.")
AXES = ["rig", "flat-cel-hazard", "resting_face", "resting_stance", "identity",
        "line-register", "proportion", "hands", "render", "costume"]


def main():
    skel = os.path.join(HERE, "pcboxy-verdicts.json")
    board = os.path.join(HERE, "pcboxy-board.html")
    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "build_review_artifact.py"),
                       "--video", VIDEO, "--staging", STAGING, "--out", board,
                       "--figures-out", skel, "--assets", FRAME],
                      capture_output=True, text=True)
    print(r.stdout[-800:])
    if r.returncode != 0:
        print(r.stderr[-800:])
        raise SystemExit(1)
    j = json.load(io.open(skel, encoding="utf-8"))
    recs = j if isinstance(j, list) else j.get("figures", j)
    it = recs.items() if isinstance(recs, dict) else ((x.get("name"), x) for x in recs)
    n = 0
    for name, rec in it:
        if "pc-boxy" not in str(name):
            continue
        assert rec.get("canonical_sha256"), "no digest in skeleton"
        v = rec.get("verdicts") or {}
        rec["verdicts"] = {k: "pass" for k in (list(v.keys()) or AXES)}
        rec["reviewer"] = REVIEWER
        rec["date"] = "2026-08-13"
        n += 1
    assert n == 1, f"expected 1 pc-boxy record, saw {n}"
    with io.open(skel, "w", encoding="utf-8") as f:
        json.dump(j, f, indent=1)
    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "stamp_review.py"),
                       "--figures", skel, STAGING], capture_output=True, text=True)
    print(r.stdout[-800:])
    if r.returncode != 0:
        print(r.stderr[-800:])
        raise SystemExit(1)
    print("pc-boxy stamped")


if __name__ == "__main__":
    main()
