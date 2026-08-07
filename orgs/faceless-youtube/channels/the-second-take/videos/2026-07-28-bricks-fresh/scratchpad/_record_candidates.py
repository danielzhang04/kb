"""STEP 1 — emit scenes-manifest entries for the 17 phase-6b candidates.

`forge.py manifest` rewrites the whole manifest from the entries spec it is given, so this driver
carries the 8 already-promoted plate entries through VERBATIM (read back from the live manifest,
including the `review_status` stamp_review.py already wrote — carrying a stamped value forward is
preservation, not authorship) and appends the 17 new candidates as `unreviewed`.

C-11 counters: the 14 slice-1 candidates deliberately state NO counters, so
`manifest --from-batch p6b-slate.json` fills them from the spec that derived them — no chance of a
hand-stated value silently diverging. The 3 slice-2 candidates (L06/L07/L09) come from a different
spec (`p6b-slate2.json`), which `--from-batch` cannot also read, so their counters are copied
PROGRAMMATICALLY from that file — never re-derived by eye.

Files stay in `_staging` at this step; promotion happens after the stamp.
"""
import io, json, os, hashlib

ORG = r"C:\Users\danie\kb\orgs\faceless-youtube"
VIDEO = os.path.join(ORG, r"channels\the-second-take\videos\2026-07-28-bricks-fresh")
STAGING = os.path.join(ORG, r"channels\the-second-take\visual-kit\_staging")
SCENES = os.path.join(VIDEO, "assets", "scenes")
SCRATCH = os.path.join(VIDEO, "scratchpad")

SLICE1 = ["L01", "L02", "L04", "L11", "L12", "L13", "L14",
          "L15", "L16", "L17", "L18", "L19", "L20", "L21"]      # counters via --from-batch
SLICE2 = ["L06", "L07", "L09"]                                   # counters copied from slate2
REISSUED = {"L19", "L20"}

slate1 = {i["name"]: i for i in
          json.load(io.open(os.path.join(SCRATCH, "p6b-slate.json"), encoding="utf-8"))}
slate2 = {i["name"]: i for i in
          json.load(io.open(os.path.join(SCRATCH, "p6b-slate2.json"), encoding="utf-8"))}


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def technique(item, sid):
    seeds = item.get("seed") or []
    if item.get("stage_role") == "delta":
        return "(e) seeded delta-chain — seeds its in-chain parent"
    if item.get("plate"):
        return "(c) character-free scene — derived place plate, bible descriptor + style suffix"
    if any("assets/scenes/" in s.replace("\\", "/") for s in seeds):
        return "(b) seeded composition — seeds the promoted place plate"
    return "(c) character-free / environment gen"


# --- carry the 8 promoted plate entries through verbatim -------------------------------------
live = json.load(io.open(os.path.join(SCENES, "manifest.json"), encoding="utf-8"))
entries = list(live.get("shots") or [])
carried = [e["shot_id"] for e in entries]
print("carried through verbatim (already stamped): %s" % ", ".join(carried))

# --- append the 17 candidates ----------------------------------------------------------------
for sid in SLICE1 + SLICE2:
    src = os.path.join(STAGING, sid + ".png")
    if not os.path.exists(src):
        raise SystemExit("missing candidate: " + src)
    item = slate1.get(sid) or slate2[sid]
    e = {
        "shot_id": sid,
        "file": "assets/scenes/%s.png" % sid,
        "files": ["assets/scenes/%s.png" % sid],
        "technique": technique(item, sid),
        "seeds": item.get("seed") or [],
        "flagged": False,
        "review_status": "unreviewed",      # stamp_review.py is the ONLY writer of a verdict
        "parked_reasons": [],
        "retry_cause": None,
        "notes": "Phase 6B candidate, generated 2026-08-06 at 1K/16:9 under the era 2-voice prompt. "
                 "Staged at _staging/%s.png (sha256 %s). %s"
                 % (sid, sha(src)[:16],
                    "Attempt 2 — attempt 1 failed on a transient provider HTTP 503."
                    if sid in REISSUED else "Landed first attempt."),
    }
    if sid in SLICE2:                        # counters copied from the OTHER spec
        e["parent_depth"] = slate2[sid]["parent_depth"]
        e["lineage"] = slate2[sid]["lineage"]
        e["notes"] += (" C-11 counters copied from p6b-slate2.json (parent_depth=%s, lineage=%s); "
                       "seeds the promoted, verified place plate."
                       % (e["parent_depth"], e["lineage"]))
    entries.append(e)

out = os.path.join(SCRATCH, "p6b-candidate-entries.json")
with io.open(out, "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("entries spec -> %s (%d total: %d carried + %d new)"
      % (out, len(entries), len(carried), len(SLICE1) + len(SLICE2)))
