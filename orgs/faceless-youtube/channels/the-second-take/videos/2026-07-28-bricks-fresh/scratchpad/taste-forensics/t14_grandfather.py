"""Task 14 grandfather stamping — the 10 standing assets the L01-L27 tranche seeds.

Same standing-asset class, same boss authority, same truthful provenance, same
sanctioned tools as g4_grandfather.py — see that file for the full procedure.

Difference from g4_grandfather_2.py: the P12 guard reads the store by its REAL
keys. Post-10a the store is keyed kit-relative by PATH ("refs/base/expr-shock.png"),
not by bare name, so the old guard silently matched nothing. Fixed here, and the
guard asserts it found both rows before anything is written.
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

# The 10 assets the act-1 dry batch refused for want of a review record.
NAMES = ["expr-surprised", "expr-talking", "expr-caught",
         "carry-by-handle", "action-present", "back-to-viewer",
         "action-shrug", "hold-one-hand",
         "prop-drive", "prop-beige-pc"]
REVIEWER = ("grandfathered 2026-08-13 - boss ruling per Daniel G2 trust statement "
            "(2026-08-12); standing asset in use across prior operator-reviewed runs, "
            "predates the P3 gate")
DATE = "2026-08-13"

P12_KEYS = ("refs/base/expr-shock.png", "refs/base/expr-pleading.png")


def store_p12_rows():
    with io.open(STORE, encoding="utf-8") as f:
        j = json.load(f)
    figs = j.get("figures", {})
    return {k: figs[k] for k in P12_KEYS if k in figs}, len(figs)


def main():
    before_p12, before_n = store_p12_rows()
    assert len(before_p12) == 2, f"P12 FAIL rows missing before stamping - abort (found {list(before_p12)})"
    for k, v in before_p12.items():
        assert v["verdicts"].get("human-veto") == "fail", f"{k} is not a FAIL - abort"

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

    skel = os.path.join(HERE, "t14-grandfather-verdicts.json")
    board = os.path.join(HERE, "t14-grandfather-board.html")
    cmd = [sys.executable, os.path.join(SCRIPTS, "build_review_artifact.py"),
           "--video", VIDEO, "--staging", STAGING, "--out", board,
           "--figures-out", skel, "--assets", *paths]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-1500:])
    if r.returncode != 0:
        print(r.stderr[-1500:])
        raise SystemExit(f"skeleton build failed rc={r.returncode}")

    j = json.load(io.open(skel, encoding="utf-8"))
    recs = j if isinstance(j, list) else j.get("figures", j)
    stamped = 0
    it = recs.items() if isinstance(recs, dict) else ((x.get("name"), x) for x in recs)
    for name, rec in it:
        stem = os.path.splitext(os.path.basename(str(name)))[0]
        if stem not in NAMES:
            continue
        assert rec.get("canonical_sha256"), f"{name}: skeleton carries no digest"
        v = rec.get("verdicts") or {}
        rec["verdicts"] = {k: "pass" for k in (list(v.keys()) or ["rig", "flat-cel-hazard"])}
        rec["reviewer"] = REVIEWER
        rec["date"] = DATE
        stamped += 1
    assert stamped == len(NAMES), f"skeleton missing assets: stamped {stamped}/{len(NAMES)}"
    with io.open(skel, "w", encoding="utf-8") as f:
        json.dump(j, f, indent=1)

    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "stamp_review.py"),
                        "--figures", skel, STAGING], capture_output=True, text=True)
    print(r.stdout[-1500:])
    if r.returncode != 0:
        print(r.stderr[-1500:])
        raise SystemExit(f"stamp failed rc={r.returncode}")

    after_p12, after_n = store_p12_rows()
    assert after_p12 == before_p12, "P12 FAIL rows changed - MUST NOT HAPPEN"
    print(f"store rows: {before_n} -> {after_n}; P12 FAILs intact; {stamped} grandfathered")


if __name__ == "__main__":
    main()
