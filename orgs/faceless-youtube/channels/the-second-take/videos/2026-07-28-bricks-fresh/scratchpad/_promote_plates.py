"""STEP 1 — promote the 8 board-approved plates from <kit>/_staging into <video>/assets/scenes.

Copies the approved bytes, then builds the scenes-manifest ENTRIES spec that
`forge.py manifest --kind scenes` wraps and validates.

C-11 provenance counters are COPIED PROGRAMMATICALLY from the remint `batch` specs that derived
them (never re-derived by eye, per the SKILL's manifest contract). Every one of the 7 spec'd plates
carries parent_depth=0 / lineage=0 because each is a ROOT plate with no place parent — exactly what
`forge._scene_provenance` returns for `if not place_frame`. L05 has NO batch spec (it is the
human-restored archived first-pass frame, Daniel's R5 ruling, a $0 manual copy-in that never went
through `batch`), so its counters are STATED as the same root values, and its note names the
archive source and the ruling.

review_status is deliberately written as "unreviewed" here — `stamp_review.py` is the ONLY writer
of a verdict, and it runs as a separate step over a merged ruling file.
"""
import io, json, os, shutil, hashlib

ORG = r"C:\Users\danie\kb\orgs\faceless-youtube"
VIDEO = os.path.join(ORG, r"channels\the-second-take\videos\2026-07-28-bricks-fresh")
STAGING = os.path.join(ORG, r"channels\the-second-take\visual-kit\_staging")
SCENES = os.path.join(VIDEO, "assets", "scenes")
SCRATCH = os.path.join(VIDEO, "scratchpad")

# shot_id -> (source file in _staging, the batch spec that derived its counters, spec item name)
PLATES = {
    "L03":  ("L03.png",         "remint-plates-slate.json", "L03"),
    "L05":  ("L05.png",         None,                       None),
    "L28":  ("L28-retry1.png",  "remint-L28-retry.json",    "L28-retry1"),
    "L63":  ("L63.png",         "remint-plates-slate.json", "L63"),
    "L71":  ("L71.png",         "remint-plates-slate.json", "L71"),
    "L113": ("L113.png",        "remint-plates-slate.json", "L113"),
    "L172": ("L172.png",        "remint-plates-slate.json", "L172"),
    "L196": ("L196.png",        "remint-plates-slate.json", "L196"),
}

RULING = {
    "L03":  "Daniel board-v2 ruling R3 — night-scene exception granted; accepted as-is, no re-mint.",
    "L05":  "Daniel board-v2 ruling R5 — the staged style-tile-copy was REJECTED; this slot is the "
            "PREVIOUS computer-shop plate restored from `_staging/_pre-remint-archive-2026-08-05/"
            "L05.png`. Never went through `batch` (a $0 manual copy-in), so its C-11 counters are "
            "stated as root values (parent_depth 0 / lineage 0) rather than copied from a spec. "
            "Frame is 2K while the other seven are 1K — Daniel's taste call went to the prior frame "
            "over 1K tier consistency.",
    "L28":  "Daniel board-v2 ruling R2 — L28-retry1 ACCEPTED for this video, with the line-weight "
            "question absorbed into the systemic R1 fix rather than a further per-plate retry. "
            "RESIDUAL, openly unresolved: ink luminance measures 44.5 vs the archived prior's 23.0 "
            "(#241a12 is 28.2) and ink coverage fell 11.43% -> 8.90%. The R1 fix (ea71f99) is a "
            "style-layer change to the GENERATOR and does not retroactively alter these pixels. "
            "Verified here on the human's explicit acceptance, not on a clean measurement. "
            "Live file is L28-retry1.png, promoted as L28.png.",
    "L172": "Daniel board-v2 ruling R4 — remint accepted (after > before). The three-tiers-of-"
            "face-finish observation was surfaced but deliberately not routed to a new rule.",
    "L63":  "Daniel board-v2 plain pass — correct outline, camera, palette; vantage mildly high but "
            "reads as staged.",
    "L71":  "Daniel board-v2 plain pass — strongest line weight in the set; set the anonymous-extra "
            "convention for this video.",
    "L113": "Daniel board-v2 plain pass — warmest frame in the set; correct on every criterion.",
    "L196": "Daniel board-v2 plain pass — correct on every criterion; empty room, no anatomy or "
            "identity to check.",
}


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def spec_item(spec_file, item_name):
    spec = json.load(io.open(os.path.join(SCRATCH, spec_file), encoding="utf-8"))
    items = spec if isinstance(spec, list) else spec.get("entries", [])
    for it in items:
        if isinstance(it, dict) and it.get("name") == item_name:
            return it
    raise SystemExit("spec item %s not found in %s" % (item_name, spec_file))


os.makedirs(SCENES, exist_ok=True)
entries = []
for sid, (src_name, spec_file, item_name) in PLATES.items():
    src = os.path.join(STAGING, src_name)
    if not os.path.exists(src):
        raise SystemExit("missing approved plate: " + src)
    dst = os.path.join(SCENES, sid + ".png")
    shutil.copy2(src, dst)

    if spec_file:
        it = spec_item(spec_file, item_name)
        depth, lin = it.get("parent_depth"), it.get("lineage")
        seeds = it.get("seed") or []
        prov = "counters COPIED from %s item `%s`" % (spec_file, item_name)
        technique = "(c) character-free / environment gen — era remint"
    else:
        depth, lin = 0, 0
        seeds = []
        prov = ("no batch spec — counters STATED as root values (the `_scene_provenance` result for "
                "a frame with no place parent, identical to all 7 spec'd siblings)")
        technique = "(a) reuse — human-restored archived first-pass frame, $0, no provider call"

    entries.append({
        "shot_id": sid,
        "file": "assets/scenes/%s.png" % sid,
        "files": ["assets/scenes/%s.png" % sid],
        "technique": technique,
        "seeds": seeds,
        "flagged": False,
        "review_status": "unreviewed",   # stamp_review.py is the ONLY writer of a verdict
        "parked_reasons": [],
        "retry_cause": ("one surgical retry against camera elevation + outline line weight; "
                        "changed_spans=1" if sid == "L28" else None),
        "parent_depth": depth,
        "lineage": lin,
        "notes": "%s Promoted from <kit>/_staging/%s (sha256 %s). C-11 provenance: %s."
                 % (RULING[sid], src_name, sha(src)[:16], prov),
    })
    print("  %-5s <- %-18s depth=%s lineage=%s  %s" % (sid, src_name, depth, lin, prov))

out = os.path.join(SCRATCH, "p6b-scenes-entries.json")
with io.open(out, "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("\nentries spec -> %s (%d entries)" % (out, len(entries)))
