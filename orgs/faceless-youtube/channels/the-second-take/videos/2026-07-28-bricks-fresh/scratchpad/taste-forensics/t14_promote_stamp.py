"""Task 14 - promote the passing mints and stamp them through the sanctioned writer.

PROMOTION
  7 cast canonicals -> <kit>/refs/<char>/<char>.png   (the path each registry row's `base` names)
  crowd exemplar    -> <video>/assets/library/crowd-exemplar.png
                       (forge.py:2076-2086: the video's own frame outranks the channel's standing
                        refs/base/crowd-exemplar.png, which stays as the fallback)

STAMPING
  The verdicts JSON is BUILT HERE from the two verifiers' own axis rulings and handed to
  `stamp_review.py --figures`, the single sanctioned writer of <kit>/_staging/review.json.

  It is deliberately NOT built by `build_review_artifact.py --assets`. That builder boards every
  asset the video still owes a ruling on - not only the ones you named - and emits every row with
  BLANK verdicts and a default "fresh-eyes" reviewer. Earlier in this task that behaviour merged
  two blank rows over two genuinely PARKED records and silently erased what they said. Building
  the payload here means exactly the intended keys are written and nothing rides along.

  Keys are `forge.store_key` (path relative to the KIT), so the video's library exemplar keys
  through `../videos/<slug>/...` and can never collide with the channel's `refs/base/` frame -
  the stem collision forge.py:1656-1659 calls out by name.

  Each record's `canonical_sha256` is taken from the PROMOTED bytes, after the copy, so the
  digest law compares the record against the file that will actually seed.
"""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys

WT = r"C:\Users\danie\kb-worktrees\boss-taste-forensics"
ORG = os.path.join(WT, "orgs", "faceless-youtube")
KIT = os.path.join(ORG, "channels", "the-second-take", "visual-kit")
SCRIPTS = os.path.join(ORG, ".claude", "skills", "image-generation", "scripts")
VIDEO = os.path.join(ORG, "channels", "the-second-take", "videos", "2026-07-28-bricks-fresh")
STAGING = os.path.join(KIT, "_staging")
STORE = os.path.join(STAGING, "review.json")
HERE = os.path.dirname(os.path.abspath(__file__))

sys.path.insert(0, SCRIPTS)
import forge  # noqa: E402

REVIEWER = "sonnet-verifier-pair task-14 2026-08-13"
DATE = "2026-08-13"

# Which staged frame is each asset's winner: the retry where one was run and passed, else round 0.
# ONLY all-pass frames appear here. Everything else is PARKED and is deliberately absent - a park
# means no promotion and no stamp, and no agent clears its own park.
WINNER = {
    "drive-maker": "drive-maker-r1",     # r0 failed ears; r1 clean on all 8 axes
    "bond-investor": "bond-investor",    # clean first try
    "tv-chef": "tv-chef",                # clean first try
    "crowd-exemplar": "crowd-exemplar",  # clean first try, both verifiers
}

# PARKED - one retry spent, still failing. Their `refs/<char>/<char>.png` is deliberately NOT
# created, so any shot seeding them fails loud at batch time, which is the correct pre-mint signal.
# None of the four is reached by the L01-L27 tranche.
PARKED = {
    "trial-judge": "r0 identity FAIL (full-rim not half-moon); r1 SAME identity FAIL plus a new "
                   "ear. Position obeyed both times, lens SHAPE never did.",
    "return-customer": "r0 no_nose_no_ears FAIL (both ears under the beanie); r1 fixed the ears "
                       "and came back with a diamond-lattice quilt texture -> flat_cel_render FAIL.",
    "brick-co-seller": "r0 no_nose_no_ears FAIL (nose AND ear); r1 fixed both and came back with "
                       "a mottled blended apron stain -> flat_cel_render FAIL.",
    "hr-officer": "r0 no_nose_no_ears FAIL (ear beside the bun); r1 fixed it and came back with a "
                  "herringbone tweed weave on the skirt -> flat_cel_render FAIL.",
}

VERDICT_FILES = ["t14-verdicts-A.json", "t14-verdicts-B.json",
                 "t14-verdicts-A2.json", "t14-verdicts-B2.json"]


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_axes():
    """stem -> {axis: verdict}, merged across every verifier that ruled on that stem."""
    merged = {}
    for fn in VERDICT_FILES:
        p = os.path.join(HERE, fn)
        if not os.path.isfile(p):
            print(f"  (no {fn} - skipped)")
            continue
        j = json.load(io.open(p, encoding="utf-8"))
        for stem, rec in j.items():
            merged.setdefault(stem, {}).update(rec.get("axes") or {})
    return merged


def main():
    axes = load_axes()
    dest_of, promoted = {}, []

    # ---- resolve + check every winner BEFORE copying anything
    plan = []
    for asset, stem in WINNER.items():
        src = os.path.join(STAGING, stem + ".png")
        assert os.path.isfile(src), f"staged frame missing: {src}"
        a = axes.get(stem)
        assert a, f"no verifier verdicts for {stem}"
        bad = [k for k, v in a.items() if v != "pass"]
        assert not bad, f"{stem} is NOT all-pass ({bad}) - refusing to promote"
        assert len(a) >= 6, f"{stem}: only {len(a)} axes ruled - expected both verifiers"
        if asset == "crowd-exemplar":
            dst = os.path.join(VIDEO, "assets", "library", "crowd-exemplar.png")
        else:
            dst = os.path.join(KIT, "refs", asset, asset + ".png")
        plan.append((asset, stem, src, dst, a))

    # ---- copy
    for asset, stem, src, dst, a in plan:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        dest_of[asset] = dst
        promoted.append(asset)
        print(f"  promoted {stem}.png -> {os.path.relpath(dst, ORG)}")

    # ---- build the verdicts payload from the PROMOTED bytes
    payload = {"figures": {}}
    for asset, stem, src, dst, a in plan:
        key = forge.store_key(dst, KIT)
        payload["figures"][key] = {
            "canonical_sha256": sha256(dst),
            "expression_sha256": None,
            "verdicts": dict(a),
            "reviewer": REVIEWER,
            "date": DATE,
        }
        print(f"  key {key}  ({len(a)} axes)")

    out = os.path.join(HERE, "t14-stamp.json")
    with io.open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)

    before = len(json.load(io.open(STORE, encoding="utf-8"))["figures"])
    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "stamp_review.py"),
                        "--figures", out, STAGING], capture_output=True, text=True)
    print(r.stdout[-800:])
    if r.returncode != 0:
        print(r.stderr[-800:])
        raise SystemExit(f"stamp failed rc={r.returncode}")

    store = json.load(io.open(STORE, encoding="utf-8"))["figures"]
    # the two P12 vetoes must still be FAIL
    for k in ("refs/base/expr-shock.png", "refs/base/expr-pleading.png"):
        assert store[k]["verdicts"].get("human-veto") == "fail", f"{k} lost its veto"
    for asset, stem, src, dst, a in plan:
        key = forge.store_key(dst, KIT)
        assert key in store and store[key]["canonical_sha256"] == sha256(dst), f"{key} not current"
    print(f"\nstore rows: {before} -> {len(store)}; {len(promoted)} promoted + stamped; "
          f"P12 FAILs intact")


if __name__ == "__main__":
    main()
