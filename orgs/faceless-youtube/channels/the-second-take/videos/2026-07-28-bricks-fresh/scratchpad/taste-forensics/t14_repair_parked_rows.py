"""Task 14 repair — restore the two PARKED STEP-1 card rows my grandfather pass clobbered.

WHAT HAPPENED. `build_review_artifact.py --assets <paths>` also boards every asset the
video still owes a ruling on, and `asset_verdict_skeleton` (build_review_artifact.py:391-409)
emits EVERY row blank with the default reviewer "fresh-eyes" — it never reads the existing
store. My grandfather script only rewrote the 10 rows it owned and passed the other 2
through verbatim, so `stamp_review.py` merged two blank-verdict rows over the existing
records for:

  _staging/fig-miniscribe-rep--action-slump--expr-worried--def769f5.png
  _staging/fig-miniscribe-rep--hold-both-hands--expr-greedy--b1cd8a27.png

The gate outcome never changed (blank is not "pass", so both still refuse), but the rows
stopped SAYING anything, which is how a real defect gets lost.

WHAT THIS WRITES. Both cards are documented PARKED ON POSE in two independent places that
my run never touched — `assets/scenes/manifest.json` (`review_status: "parked"`, L48 / L39)
and `assets/_review/merged.json`: "the card came back in the canonical's default upright
stance; one sanctioned P10 `defect: pose` retry ... did not move the body, and a fresh
verifier pair confirmed the second fail". This restores a row that MATCHES that record:
an explicit `pose: fail` plus a reviewer string naming the real provenance and the
clobber. It only ever tightens the gate — no axis is set to "pass".
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
STAGING = os.path.join(KIT, "_staging")
STORE = os.path.join(STAGING, "review.json")
HERE = os.path.dirname(os.path.abspath(__file__))

KEYS = ["_staging/fig-miniscribe-rep--action-slump--expr-worried--def769f5.png",
        "_staging/fig-miniscribe-rep--hold-both-hands--expr-greedy--b1cd8a27.png"]
REVIEWER = ("parked on pose - P10 defect:pose retry did not move the body, fresh verifier "
            "pair confirmed the second fail (provenance: assets/scenes/manifest.json L48/L39 "
            "+ assets/_review/merged.json). Row RECONSTRUCTED 2026-08-13 by task-14 after its "
            "grandfather skeleton blanked the verdicts; no axis set to pass, park stands.")
DATE = "2026-08-13"


def main():
    store = json.load(io.open(STORE, encoding="utf-8"))
    figs = store["figures"]
    out = {"figures": {}}
    for k in KEYS:
        assert k in figs, f"row vanished: {k}"
        rec = json.loads(json.dumps(figs[k]))
        v = rec.get("verdicts") or {}
        assert all(x != "pass" for x in v.values()), f"{k}: refusing to touch a passing row"
        v = {a: (r if r else "fail") for a, r in v.items()}
        v["pose"] = "fail"
        rec["verdicts"] = v
        rec["reviewer"] = REVIEWER
        rec["date"] = DATE
        out["figures"][k] = rec

    skel = os.path.join(HERE, "t14-repair-verdicts.json")
    with io.open(skel, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "stamp_review.py"),
                        "--figures", skel, STAGING], capture_output=True, text=True)
    print(r.stdout[-800:])
    if r.returncode != 0:
        print(r.stderr[-800:])
        raise SystemExit(f"stamp failed rc={r.returncode}")

    after = json.load(io.open(STORE, encoding="utf-8"))["figures"]
    for k in KEYS:
        assert after[k]["verdicts"]["pose"] == "fail", f"{k}: repair did not land"
        assert "pass" not in after[k]["verdicts"].values(), f"{k}: a pass leaked in"
    print(f"repaired {len(KEYS)} parked rows; store rows: {len(after)}")


if __name__ == "__main__":
    main()
