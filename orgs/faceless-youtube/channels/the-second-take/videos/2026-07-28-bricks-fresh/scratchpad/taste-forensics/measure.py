#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Track B measurement -- bricks taste-forensics wave, Task 4.

Deterministic, re-runnable, read-only on everything except its own two outputs.

Reads:
  - taste-forensics/beat-map.json, generations-index.json      (Task 0/1, via _build_elicit_board)
  - taste-forensics/_build_elicit_board.py                      (Task 1's board builder -- IMPORTED,
    never modified, for its board-embed-anchored pixel resolution: frames_for()/BoardIndex/
    Registry/pool_index. Carried finding (progress.md, Task 1): beat-map render paths != judged
    pixels for 92/228 board cards; frames_for() is the sourcing rule that cannot show a frame
    Daniel never judged, so it is reused verbatim rather than re-derived.)
  - shots.json (current 246-shot doctrine file)                 -> prose text, place/place_owner,
    shot_class, for every one of the 246 shots (plate-reuse counting needs the whole file, not
    just the 50 boarded beats -- H1's test explicitly wants "every plate cameo").
  - assets/scenes/manifest.json (6c2 tenth, L26-L50, current)    -> seed_topology + figure/tier
    for gen-C c6c2 frames (role-tagged seed schema: figure/crowd/place/environment/...).
  - assets/_archive-pre-regen-2026-08-06/manifest.json (p6b)     -> seed_topology best-effort for
    gen-C p6b frames (flat seed-path-list schema, predates role tags -- no figure/tier data
    survives in this record for that generation; disclosed per-record, not silently guessed).
  - scratchpad/p6b_ink.py's ink_stats() methodology              -> MIRRORED (not imported: it is
    file-path-only), so median_sat / ink_r_minus_b are directly comparable to the
    scratchpad/6c2-w2verify-*.json baselines named in the brief.

Writes:
  - taste-forensics/measurements.json
  - taste-forensics/separations.md

Run:  python measure.py    (from this directory; every path is absolute-resolved)
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# 0. Import the Task-1 board builder as a library (never executes its __main__).
# ---------------------------------------------------------------------------

_spec = importlib.util.spec_from_file_location(
    "_build_elicit_board", os.path.join(HERE, "_build_elicit_board.py"))
beb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(beb)

OUT_JSON = os.path.join(HERE, "measurements.json")
OUT_MD = os.path.join(HERE, "separations.md")

# ---------------------------------------------------------------------------
# 1. Ink / saturation measurement -- mirrors scratchpad/p6b_ink.py's ink_stats(),
#    applied to an already-decoded PIL image (from the Registry) instead of re-reading
#    a path, so results are directly comparable to the 6c2-w2verify-*.json baselines.
# ---------------------------------------------------------------------------


def ink_stats_im(im, pct=3.0):
    im = im.convert("RGB")
    rgb = np.asarray(im, dtype=np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    thr = np.percentile(lum, pct)
    m = lum <= thr
    hsv = np.asarray(im.convert("HSV"), dtype=np.float32)
    hue_deg = hsv[:, :, 0][m] * 360.0 / 255.0
    ang = np.deg2rad(hue_deg)
    mean_hue = float(np.rad2deg(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360.0)
    return dict(
        ink_hue_deg=round(mean_hue, 2),
        ink_r_minus_b=round(float((r[m] - b[m]).mean()), 2),
        ink_lum=round(float(lum[m].mean()), 2),
        median_sat=round(float(np.median(hsv[:, :, 1] / 255.0)), 4),
    )


# ---------------------------------------------------------------------------
# 2. Prose features -- a documented, deterministic PROXY (not NLP-grade parsing).
#    words = whitespace token count of the authored prompt, as written.
#    staging_clauses = non-empty segments after splitting on commas/semicolons/sentence
#      breaks, backtick rig-tokens stripped first (those are asset references, not staging).
#    distinct_props = unique noun-phrases captured after an article/number word, deduped,
#      capped at 3 words each. A proxy for "how many distinct things are named in the frame",
#      not a grounded object list -- see separations.md Methodology for the exact regex.
# ---------------------------------------------------------------------------

_ARTICLE_RE = re.compile(
    r"\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|the)\s+"
    r"([a-z][a-z\-]*(?:\s+[a-z][a-z\-]*){0,3})",
    re.IGNORECASE,
)
_STOP_PROPS = {"same", "single", "few", "little", "lot", "very", "whole"}
_TRIM_RE = re.compile(
    r"\b(?:and|that|which|running|standing|holding|filling|carrying|rising|falling)\b")


def prose_features(text):
    if not text:
        return dict(words=0, staging_clauses=0, distinct_props=0, prop_list=[])
    words = len(text.split())
    stripped = re.sub(r"`[^`]*`", " ", text)  # drop backticked rig tokens - not staging prose
    clause_parts = re.split(r"[,;]|\.(?=\s|$)", stripped)
    staging_clauses = len([c for c in clause_parts if c.strip()])
    props = set()
    for m in _ARTICLE_RE.finditer(stripped):
        phrase = m.group(1).lower().strip()
        phrase = _TRIM_RE.split(phrase)[0].strip()
        phrase = " ".join(phrase.split()[:3])
        if phrase and phrase not in _STOP_PROPS:
            props.add(phrase)
    return dict(words=words, staging_clauses=staging_clauses, distinct_props=len(props),
                prop_list=sorted(props))


# ---------------------------------------------------------------------------
# 3. H6 shot-type scoping -- Daniel's verbatim scoping note (elicit-answers.md P08-L10):
#    "when I talk about detail, I'm talking more about the shots where it's environment
#    based or a literal scene. For the prop-focus or non-human focus/non environment focus
#    shots, that's not necessarily a problem." Operationalized as a generalized rule over
#    the shots-schema.md `shot_class` enum (never a per-shot special case, per Daniel's
#    Amendment 2): the three classes that are explicitly object/prop close-ups with no
#    staged scene are exempt; every other class stages a scene/environment/figure-in-space
#    and is in scope.
# ---------------------------------------------------------------------------

PROP_FOCUS_EXEMPT_CLASSES = {"symbolic-stand-in-object", "number-glued-to-object", "diegetic-device"}


def h6_scope(shot_class):
    if shot_class in PROP_FOCUS_EXEMPT_CLASSES:
        return "prop-focus-exempt"
    return "environment-scene"


# ---------------------------------------------------------------------------
# 4. Seed topology + figure/tier -- from source manifests, per generation family.
#    C-family/c6c2 (L26-L50): assets/scenes/manifest.json, role-tagged seed schema.
#    C-family/p6b   (L01-L25): assets/_archive-pre-regen-2026-08-06/manifest.json,
#      flat seed-path-list schema (predates role tags) -- seed_type/chain_depth still
#      recoverable, figure_count/tier_mix are NOT (disclosed via figure_unavailable_reason).
#    A-family (pre-reset, both ranges): no comparable seed manifest survives at all.
# ---------------------------------------------------------------------------


def load_manifest(rel):
    ap = beb.resolve(rel, beb.PIXEL_ROOTS)
    if ap is None:
        return None
    with open(ap, "r", encoding="utf-8") as fh:
        return json.load(fh)


def classify_c6c2_seeds(entry):
    figures = []
    crowd = False
    for sd in entry.get("seeds", []):
        role = sd.get("role")
        if role == "figure":
            figures.append(sd.get("character"))
        elif role == "crowd":
            crowd = True
    n_base = sum(1 for c in figures if c == "base")
    n_cast = sum(1 for c in figures if c and c != "base")
    return (n_base + n_cast), dict(base=n_base, cast=n_cast, crowd_present=crowd)


def p6b_lookup(p6b_manifest, new_l):
    if new_l in p6b_manifest:
        return p6b_manifest[new_l], "exact"
    variants = sorted(k for k in p6b_manifest if k.startswith(new_l + "-"))
    if variants:
        return p6b_manifest[variants[-1]], "variant:%s" % variants[-1]
    return None, "missing"


# ---------------------------------------------------------------------------
# 5. Main
# ---------------------------------------------------------------------------


def main():
    ctx = beb.load_ctx()
    reg = beb.Registry()
    cur = ctx["cur"]

    c6c2_raw = load_manifest("assets/scenes/manifest.json")
    c6c2_manifest = {s["shot_id"]: s for s in (c6c2_raw or {}).get("shots", [])}
    p6b_raw = load_manifest("assets/_archive-pre-regen-2026-08-06/manifest.json")
    p6b_manifest = {s["shot_id"]: s for s in (p6b_raw or {}).get("shots", [])}

    # Plate-reuse map over ALL 246 current shots -- "every plate cameo" (H1's test), not
    # just the 25-beat 6c2 board scope.
    plate_counts = {}
    for sid, s in cur.items():
        p = s.get("place")
        if p:
            plate_counts[p] = plate_counts.get(p, 0) + 1

    boarded = []
    for row in ctx["beats"]:
        n = beb.lnum(row.get("new_L") or "")
        if n is not None and n in (beb.P6B_RANGE | beb.C6C2_RANGE):
            boarded.append(row)
    boarded.sort(key=lambda r: beb.lnum(r["new_L"]))
    assert len(boarded) == 50, "expected 50 boarded beats L01-L50 (P6B+6c2), got %d" % len(boarded)

    records = []
    unmeasurable = []
    for row in boarded:
        bid = row["beat_id"]
        new_l = row["new_L"]
        n = beb.lnum(new_l)
        _old_st, new_st = beb.status_of(row)
        liked = (new_st == "named")
        range_name = "p6b" if n in beb.P6B_RANGE else "c6c2"

        try:
            idxs = beb.frames_for(ctx, reg, bid, families=("A", "C"))
        except SystemExit as e:
            unmeasurable.append(dict(beat_id=bid, new_L=new_l, reason="frames_for() failed: %s" % e))
            continue
        if not idxs:
            unmeasurable.append(dict(beat_id=bid, new_L=new_l, reason="frames_for() returned no frames"))
            continue

        cur_shot = cur.get(new_l, {})
        place = cur_shot.get("place")
        prose = prose_features(cur_shot.get("still_prompt"))
        scope = h6_scope(cur_shot.get("shot_class"))

        for idx in idxs:
            rec = reg.rec(idx)
            fam = beb.gen_family(rec["gen_tag"])
            ink = ink_stats_im(rec["im"])

            seed_topology = dict(seed_type=None, place_plate_id=place, chain_depth=None,
                                  plate_reuse_count=(plate_counts.get(place, 0) if place else 0),
                                  source=None, note=None)
            figure_count = None
            tier_mix = None
            fig_reason = None

            if fam == "C" and range_name == "c6c2":
                entry = c6c2_manifest.get(new_l)
                if entry:
                    seed_topology["seed_type"] = entry.get("technique")
                    seed_topology["chain_depth"] = entry.get("parent_depth")
                    seed_topology["source"] = "assets/scenes/manifest.json"
                    figure_count, tier_mix = classify_c6c2_seeds(entry)
                    seed_place_paths = [sd.get("path") for sd in entry.get("seeds", [])
                                        if sd.get("role") == "place"]
                    if seed_place_paths and not place:
                        seed_topology["note"] = ("manifest carries a place seed but shots.json "
                                                  "place field is null: %r" % seed_place_paths)
                else:
                    seed_topology["note"] = "no assets/scenes/manifest.json entry for %s" % new_l
                    fig_reason = "no c6c2 manifest entry"
            elif fam == "C" and range_name == "p6b":
                entry, how = p6b_lookup(p6b_manifest, new_l)
                if entry:
                    seed_topology["seed_type"] = entry.get("technique")
                    seed_topology["chain_depth"] = entry.get("parent_depth")
                    seed_topology["source"] = ("assets/_archive-pre-regen-2026-08-06/manifest.json "
                                                "(%s)" % how)
                    if how != "exact":
                        seed_topology["note"] = ("manifest lookup used %s, not an exact %s entry"
                                                  % (how, new_l))
                else:
                    seed_topology["note"] = "no p6b archive manifest entry for %s or its retries" % new_l
                fig_reason = ("p6b archive manifest predates the role-tagged figure/crowd seed "
                              "schema (flat path list, no role/character keys) - figure_count/"
                              "tier_mix not derivable from source records for this generation")
            else:  # fam == "A", pre-reset doctrine
                seed_topology["note"] = "pre-reset (gen-A) doctrine - no comparable seed manifest survives"
                fig_reason = ("pre-reset (gen-A) doctrine has no seed manifest; figure/tier not "
                              "measurable from source records")

            records.append(dict(
                beat_id=bid,
                new_L=new_l,
                old_L=row.get("old_L"),
                range=range_name,
                liked=liked,
                generation=rec["gen_tag"],
                frame_source=rec["provenance"],
                shot_class=cur_shot.get("shot_class"),
                h6_scope=scope,
                seed_topology=seed_topology,
                median_sat=ink["median_sat"],
                ink_r_minus_b=ink["ink_r_minus_b"],
                ink_hue_deg=ink["ink_hue_deg"],
                figure_count=figure_count,
                tier_mix=tier_mix,
                figure_unavailable_reason=fig_reason,
                prose=prose,
            ))

    records.sort(key=lambda r: (beb.lnum(r["new_L"]), r["generation"]))

    measured_beats = sorted({r["new_L"] for r in records}, key=beb.lnum)
    coverage = dict(
        boarded_beats=50,
        measured_beats=len(measured_beats),
        measured_beat_ids=measured_beats,
        unmeasurable=unmeasurable,
        total_generation_records=len(records),
        by_range=dict(
            p6b=dict(boarded=25, measured=len({r["new_L"] for r in records if r["range"] == "p6b"})),
            c6c2=dict(boarded=25, measured=len({r["new_L"] for r in records if r["range"] == "c6c2"})),
        ),
        by_liked=dict(
            liked=len({r["new_L"] for r in records if r["liked"]}),
            disliked=len({r["new_L"] for r in records if not r["liked"]}),
        ),
        by_generation_family=dict(
            A=len([r for r in records if beb.gen_family(r["generation"]) == "A"]),
            C=len([r for r in records if beb.gen_family(r["generation"]) == "C"]),
        ),
    )

    out = dict(
        methodology=dict(
            pixel_resolution="board-embed-anchored via _build_elicit_board.frames_for() "
                              "(BoardIndex + pool_index best_pool_match); mirrors Task 1's carried "
                              "finding that beat-map render paths != judged pixels for 92/228 cards",
            ink_method="mirrors scratchpad/p6b_ink.py ink_stats(): darkest-3% circular-mean hue, "
                       "mean R-B, median HSV saturation over the whole frame",
            prose_method="deterministic proxy over the authored still_prompt text; see "
                        "separations.md Methodology for the exact regex definitions",
            liked_disliked_source="beb.status_of() against the G0-locked P6B_LIKED/C6C2_LIKED sets "
                                  "(_build_elicit_board.py ground truth, Daniel-confirmed at G0)",
        ),
        coverage=coverage,
        records=records,
    )

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write("\n")

    print("wrote %s (%d generation-records across %d/%d boarded beats)"
          % (OUT_JSON, len(records), len(measured_beats), 50))
    if unmeasurable:
        print("UNMEASURABLE beats: %r" % unmeasurable)
    return out


if __name__ == "__main__":
    main()
