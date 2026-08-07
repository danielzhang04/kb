"""ROUND 3 — emit scenes-manifest ENTRIES for the 5 round-3 correction frames.

The entries-vs-spec distinction, stated once because it is easy to fumble: `forge.py manifest
--kind scenes --batch <X>` wants X to be the **ENTRY list** (`shot_id` + `file` + the manifest keys),
NOT the gen spec list (`name` + `payload` + `seed`). The gen specs are what `--from-batch` reads, and
it reads them only to inherit C-11's `parent_depth`/`lineage` by matching spec `name` to entry
`shot_id`. Handing forge the spec list directly fails on `entry #0 missing required key(s): shot_id,
file`.

`--from-batch` reads exactly ONE spec file and these five frames come from five, so the C-11
counters are copied here PROGRAMMATICALLY from each frame's own spec — never re-derived by eye —
and forge's own validator still checks each is a real non-negative hop count.

`forge.py manifest` rewrites the whole manifest from the entry list it is given, so the 34 existing
entries are carried through VERBATIM (read back from the live manifest, including the
`review_status` values `stamp_review.py` already wrote — carrying a stamped value forward is
preservation, not authorship). The 5 new entries land as `unreviewed`; `stamp_review.py` then writes
their verdicts, as its single-writer rule requires.
"""
import hashlib
import io
import json
import os

ORG = r"C:\Users\danie\kb\orgs\faceless-youtube"
VIDEO = os.path.join(ORG, r"channels\the-second-take\videos\2026-07-28-bricks-fresh")
STAGING = os.path.join(ORG, r"channels\the-second-take\visual-kit\_staging")
SCENES = os.path.join(VIDEO, "assets", "scenes")
SCRATCH = os.path.join(VIDEO, "scratchpad")

# frame -> (its gen spec, the parked frame(s) it corrects, the file it is recorded at)
ROUND3 = [
    ("L10-retry1", "p6b-r2-L10-retry1.json", ["L10"], "assets/scenes/L10-retry1.png"),
    ("L23-retry1", "p6b-r2-L23-retry1.json", ["L23"], "assets/scenes/L23-retry1.png"),
    ("L24-retry1", "p6b-r3-L24-retry1.json", ["L24"], "assets/scenes/L24-retry1.png"),
    ("L25-retry1", "p6b-r3-L25-retry1.json", ["L25"], "assets/scenes/L25-retry1.png"),
    # VERIFIED and promoted: it takes over the shot's canonical path, exactly as the verified
    # L18-retry1 took over assets/scenes/L18.png in round 2.
    ("L16-remint1", "p6b-r3-L16-remint1.json", ["L16", "L16-retry1"], "assets/scenes/L16.png"),
]

AUTHORITY = {
    "L10-retry1": "ROUND-3 surgical retry of the parked L10, authored as a forge-retry-overlay@2 "
                  "entry and $0-validated at changed_spans=1 (one exact-replace authority; every "
                  "passing clause byte-identical). Seeds the promoted verified scenes/L05.png.",
    "L23-retry1": "ROUND-3 surgical retry of the parked L23, authored as a forge-retry-overlay@2 "
                  "entry and $0-validated at changed_spans=1. RE-BASED onto the promoted verified "
                  "scenes/L22.png — round 2 had seeded the unreviewed _staging copy.",
    "L24-retry1": "ROUND-3 re-issue of the parked L24, carrying TWO authorities that forge's retry "
                  "overlay cannot express in one entry (`_retry_scene` permits exactly one): a "
                  "parent RE-BASE onto _staging/L23-retry1.png plus one exact single-occurrence "
                  "content replace with bytes outside the span asserted byte-identical. Built from "
                  "forge's own native L24 request (p6b-native-L2425.json) by "
                  "scratchpad/_build_p6b_r3.py; seed roles and delta prose from forge's own "
                  "_seed_role / _dedupe_seed_roles / placement_delta. The explicit parent was "
                  "required because forge's walk resolved NO parent for L24 at all — on_disk() "
                  "reads only assets/scenes/ and the parked L23 was never promoted.",
    "L25-retry1": "ROUND-3 re-issue of the parked L25, same two-authority slate form as L24-retry1: "
                  "parent RE-BASE onto _staging/L24-retry1.png plus one exact single-occurrence "
                  "content replace.",
    "L16-remint1": "ROUND-3 CHANGED-MECHANISM RE-MINT of the parked L16 — not a second retry. Built "
                   "from L16's ORIGINAL p6b-slate.json entry, byte-identical in prose and seeds "
                   "(square-to-frame frieze, rank carrying past both frame edges, Tier-A "
                   "de-vantaged, style tile only); only the output name differs. Provenance: L16's "
                   "parking defect was cyan ink (174.2deg / R-B -1.0), a GENERATOR-SIDE fault, and "
                   "the R1 warm-ink fix has since landed, so the original staging was re-run under "
                   "the corrected mechanism rather than re-argued in prose.",
}

SUPERSEDES = {
    "L16-remint1": "SUPERSEDES the parked original L16 AND the parked round-1 retry L16-retry1: "
                   "this frame is VERIFIED and is promoted to assets/scenes/L16.png, so it is the "
                   "frame the render gate ships for shot L16. Both superseded frames stay archived "
                   "in _staging (L16.png, L16-retry1.png) and neither is promoted. "
                   "KNOWN MANIFEST TRAP, recorded not repaired (same shape as the L18 precedent "
                   "from round 2): the parked entry `shot_id: L16` ALSO carries "
                   "`file: assets/scenes/L16.png`, so two records now point at this one path. "
                   "forge's `_scene_manifest_entry` returns the FIRST record whose `file` matches, "
                   "walking `shots` in order — which is the PARKED one. Anything that seeds "
                   "assets/scenes/L16.png will therefore read a parked status and hit "
                   "`_scene_provenance`'s parked refusal, even though the bytes on disk are this "
                   "verified re-mint. No forge change was attempted; the durable fix is one record "
                   "per file path, and it is the boss's call.",
}


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


live = json.load(io.open(os.path.join(SCENES, "manifest.json"), encoding="utf-8"))
entries = list(live.get("shots") or [])
have = {e["shot_id"] for e in entries}
print("carried through verbatim (already stamped): %d entries" % len(entries))

for sid, spec_file, corrects, rel_file in ROUND3:
    if sid in have:
        raise SystemExit("entry already exists, refusing to duplicate: " + sid)
    src = os.path.join(STAGING, sid + ".png")
    if not os.path.exists(src):
        raise SystemExit("missing frame: " + src)
    spec = json.load(io.open(os.path.join(SCRATCH, spec_file), encoding="utf-8"))
    item = next(i for i in spec if i["name"] == sid)
    note = (AUTHORITY[sid]
            + " Generated 2026-08-06 at 1K/16:9 under the era 2-voice prompt; landed first attempt, "
              "no re-issue. Staged at _staging/%s.png (sha256 %s). C-11 counters copied "
              "programmatically from %s (parent_depth=%s, lineage=%s)."
              % (sid, sha(src)[:16], spec_file, item.get("parent_depth"), item.get("lineage")))
    if sid in SUPERSEDES:
        note += " " + SUPERSEDES[sid]
    entries.append({
        "shot_id": sid,
        "file": rel_file,
        "files": [rel_file],
        "technique": technique(item),
        "seeds": item.get("seed") or [],
        "flagged": False,
        "review_status": "unreviewed",     # stamp_review.py is the ONLY writer of a verdict
        "parked_reasons": [],
        "retry_cause": "round-2 fresh-eyes park on " + ", ".join(corrects),
        "notes": note,
        "parent_depth": item["parent_depth"],
        "lineage": item["lineage"],
    })

out = os.path.join(SCRATCH, "p6b-round3-entries.json")
with io.open(out, "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("entries spec -> %s (%d total: %d carried + %d new)"
      % (out, len(entries), len(have), len(ROUND3)))
