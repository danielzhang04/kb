"""ROUND 2 — emit scenes-manifest entries for the 9 frames the round-2 review ruled.

The 4 retry frames and the 5 resume frames were deliberately NOT recorded when they were generated
(a generating pass records nothing it has not had ruled). The round-2 verdicts are now in, so the
stamp needs real targets: `stamp_review.py` would otherwise auto-create bare `{"shot_id": ...}`
entries carrying no file, no seeds and no C-11 provenance.

`forge.py manifest` rewrites the whole manifest from the entries spec it is given, so this driver
carries the 25 existing entries through VERBATIM (read back from the live manifest, including the
`review_status` stamp_review.py already wrote — carrying a stamped value forward is preservation,
not authorship) and appends the 9 new ones as `unreviewed`. stamp_review.py then writes the verdict,
as its single-writer rule requires.

C-11 counters are copied PROGRAMMATICALLY from the specs that derived each frame — the 4 retries
from `p6b-retry-slate.json`, the 5 resume frames from `p6b-slate3.json` — never re-derived by eye.
`--from-batch` reads only one spec, and these come from two, so the copy happens here and forge's
own validator still checks every value is a real non-negative hop count.

Files stay in `_staging` at this step; promotion happens only for what the stamp verifies.
"""
import io, json, os, hashlib

ORG = r"C:\Users\danie\kb\orgs\faceless-youtube"
VIDEO = os.path.join(ORG, r"channels\the-second-take\videos\2026-07-28-bricks-fresh")
STAGING = os.path.join(ORG, r"channels\the-second-take\visual-kit\_staging")
SCENES = os.path.join(VIDEO, "assets", "scenes")
SCRATCH = os.path.join(VIDEO, "scratchpad")

RETRIES = ["L06-retry1", "L07-retry1", "L16-retry1", "L18-retry1"]
RESUME = ["L10", "L22", "L23", "L24", "L25"]

retry_slate = {i["name"]: i for i in
               json.load(io.open(os.path.join(SCRATCH, "p6b-retry-slate.json"), encoding="utf-8"))}
slate3 = {i["name"]: i for i in
          json.load(io.open(os.path.join(SCRATCH, "p6b-slate3.json"), encoding="utf-8"))}

PARKED_ORIGINAL = {"L06-retry1": "L06", "L07-retry1": "L07",
                   "L16-retry1": "L16", "L18-retry1": "L18"}


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def technique(item):
    seeds = item.get("seed") or []
    if item.get("stage_role") == "delta":
        return "(e) seeded delta-chain — seeds its in-chain parent"
    if item.get("plate"):
        return "(c) character-free scene — derived place plate, bible descriptor + style suffix"
    if any("assets/scenes/" in s.replace("\\", "/") for s in seeds):
        return "(b) seeded composition — seeds the promoted place plate"
    return "(c) character-free / environment gen"


# --- carry the 25 existing entries through verbatim -------------------------------------------
live = json.load(io.open(os.path.join(SCENES, "manifest.json"), encoding="utf-8"))
entries = list(live.get("shots") or [])
print("carried through verbatim (already stamped): %d entries" % len(entries))
have = {e["shot_id"] for e in entries}

# --- append the 9 newly-ruled frames ----------------------------------------------------------
for sid in RETRIES + RESUME:
    if sid in have:
        raise SystemExit("entry already exists, refusing to duplicate: " + sid)
    src = os.path.join(STAGING, sid + ".png")
    if not os.path.exists(src):
        raise SystemExit("missing frame: " + src)
    is_retry = sid in RETRIES
    item = retry_slate[sid] if is_retry else slate3[sid]
    spec = "p6b-retry-slate.json" if is_retry else "p6b-slate3.json"

    if is_retry:
        note = ("Phase 6B SURGICAL RETRY of the parked original %s, generated 2026-08-06 at 1K/16:9 "
                "under the era 2-voice prompt. Authored as a forge-retry-overlay@2 manifest and "
                "$0-validated at changed_spans=1 (one exact-replace authority; every passing clause "
                "byte-identical). The parked original stays archived at _staging/%s.png and is NOT "
                "superseded unless this retry verifies."
                % (PARKED_ORIGINAL[sid], PARKED_ORIGINAL[sid]))
    else:
        note = ("Phase 6B resume-lane frame, generated 2026-08-06 at 1K/16:9 under the era 2-voice "
                "prompt, after the provider recovered from the sustained HTTP 503 outage. Landed "
                "first attempt, no re-issue.")

    entries.append({
        "shot_id": sid,
        "file": "assets/scenes/%s.png" % sid,
        "files": ["assets/scenes/%s.png" % sid],
        "technique": technique(item),
        "seeds": item.get("seed") or [],
        "flagged": False,
        "review_status": "unreviewed",      # stamp_review.py is the ONLY writer of a verdict
        "parked_reasons": [],
        "retry_cause": ("round-1 fresh-eyes park on %s" % PARKED_ORIGINAL[sid]) if is_retry else None,
        "notes": note + (" Staged at _staging/%s.png (sha256 %s). C-11 counters copied "
                         "programmatically from %s (parent_depth=%s, lineage=%s)."
                         % (sid, sha(src)[:16], spec,
                            item.get("parent_depth"), item.get("lineage"))),
        "parent_depth": item["parent_depth"],
        "lineage": item["lineage"],
    })

out = os.path.join(SCRATCH, "p6b-round2-entries.json")
with io.open(out, "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("entries spec -> %s (%d total: %d carried + %d new)"
      % (out, len(entries), len(have), len(RETRIES) + len(RESUME)))
