"""Promotion and scoped C-6/P3 stamp for task 17.

Builds only the four intended records from the verifier verdict files and Daniel's
written ruling.  The payload is temporary: stamp_review.py is the sole store writer.
"""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

WT = r"C:\Users\danie\kb-worktrees\boss-taste-forensics"
ORG = os.path.join(WT, "orgs", "faceless-youtube")
KIT = os.path.join(ORG, "channels", "the-second-take", "visual-kit")
VIDEO = os.path.join(ORG, "channels", "the-second-take", "videos", "2026-07-28-bricks-fresh")
STAGING = os.path.join(KIT, "_staging")
SCRIPTS = os.path.join(ORG, ".claude", "skills", "image-generation", "scripts")
HERE = os.path.dirname(os.path.abspath(__file__))
DATE = "2026-08-13"
CAST_REVIEWER = "sonnet verifier A (resting face + registry identity) + sonnet verifier B (rig invariants + flat cel), task-16 2026-08-13"
JUDGE_REVIEWER = "round-0 verifier A (resting face + identity) + round-0 verifier B (rig invariants + flat cel); identity: Daniel ruling 2026-08-13 - full-rim readers accepted as canonical (round-0 frame); registry/shots half-moon spec amended to match"

sys.path.insert(0, SCRIPTS)
import forge  # noqa: E402


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verdicts(filename):
    return json.load(io.open(os.path.join(HERE, filename), encoding="utf-8"))


def main():
    t16a, t16b = verdicts("t16-verdicts-A.json"), verdicts("t16-verdicts-B.json")
    t14a, t14b = verdicts("t14-verdicts-A.json"), verdicts("t14-verdicts-B.json")
    plan = [
        ("return-customer", "return-customer-r2-flat-fill-candidate.png", "refs/return-customer/return-customer.png", {**t16a["return-customer"]["axes"], **t16b["return-customer"]["axes"]}, CAST_REVIEWER),
        ("brick-co-seller", "brick-co-seller-r2-flat-fill-candidate.png", "refs/brick-co-seller/brick-co-seller.png", {**t16a["brick-co-seller"]["axes"], **t16b["brick-co-seller"]["axes"]}, CAST_REVIEWER),
        ("hr-officer", "hr-officer-r2-flat-fill-candidate.png", "refs/hr-officer/hr-officer.png", {**t16a["hr-officer"]["axes"], **t16b["hr-officer"]["axes"]}, CAST_REVIEWER),
        ("trial-judge", "trial-judge.png", "refs/trial-judge/trial-judge.png", {**t14a["trial-judge"]["axes"], **t14b["trial-judge"]["axes"], "identity_per_registry": "pass"}, JUDGE_REVIEWER),
    ]
    for asset, filename, rel_dst, axes, reviewer in plan:
        assert all(v == "pass" for v in axes.values()), f"{asset}: non-pass axis"
        src, dst = os.path.join(STAGING, filename), os.path.join(KIT, rel_dst)
        assert os.path.isfile(src), f"missing {src}"
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        print(f"promoted {filename} -> {rel_dst}")

    payload = {"figures": {}}
    for asset, filename, rel_dst, axes, reviewer in plan:
        dst = os.path.join(KIT, rel_dst)
        key = forge.store_key(dst, KIT)
        payload["figures"][key] = {
            "canonical_sha256": sha256(dst),
            "expression_sha256": None,
            "verdicts": axes,
            "reviewer": reviewer,
            "date": DATE,
        }
    print(json.dumps(payload, ensure_ascii=True, indent=1))
    fd, stamp = tempfile.mkstemp(prefix="t17-stamp-", suffix=".json", dir=HERE)
    os.close(fd)
    try:
        with io.open(stamp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "stamp_review.py"), "--figures", stamp, STAGING], capture_output=True, text=True)
        print((r.stdout or "").strip())
        if r.returncode:
            print((r.stderr or "").strip(), file=sys.stderr)
            raise SystemExit(r.returncode)
    finally:
        if os.path.exists(stamp):
            os.unlink(stamp)
    store = json.load(io.open(os.path.join(STAGING, "review.json"), encoding="utf-8"))["figures"]
    for asset, filename, rel_dst, axes, reviewer in plan:
        key = forge.store_key(os.path.join(KIT, rel_dst), KIT)
        assert store[key]["canonical_sha256"] == sha256(os.path.join(KIT, rel_dst))
        assert store[key]["verdicts"] == axes
    print("verified 4 promoted digest-current records")


if __name__ == "__main__":
    main()
