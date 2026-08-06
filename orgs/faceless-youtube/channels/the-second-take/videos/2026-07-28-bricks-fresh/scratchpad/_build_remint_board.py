"""Build the remint C-6 board over the 12 reminted assets.

The stock `build_review_artifact.py` CLI does not fit this mix: its scene cards are collected from
`<video>/assets/scenes|plates/`, and the reminted plates live ONLY in `<kit>/_staging` (this video's
`assets/scenes/` is empty — nothing has been promoted yet), while `--staging` would add a card for
EVERY pending `fig-*` in the channel-wide staging dir, not the 4 this remint minted.

So this driver IMPORTS that module and calls its own `collect` helpers, `build()` renderer and
`figure_verdict_skeleton()` — the board and the skeleton are produced by the tool's own code paths,
not hand-rolled HTML or a hand-typed schema. Only the CARD SELECTION is ours.

Every verdict is left EMPTY: boss + Daniel fill them.
"""
import io, json, os, sys

SCRIPTS = r"C:\Users\danie\kb-worktrees\boss-bricks-reset\orgs\faceless-youtube\.claude\skills\image-generation\scripts"
sys.path.insert(0, SCRIPTS)
import build_review_artifact as B  # noqa: E402

VIDEO = r"C:\Users\danie\kb-worktrees\boss-bricks-reset\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh"
STAGING = r"C:\Users\danie\kb\orgs\faceless-youtube\channels\the-second-take\visual-kit\_staging"
SCRATCH = os.path.join(VIDEO, "scratchpad")

PLATES = ["L03", "L05", "L28", "L63", "L71", "L113", "L172", "L196"]
FIGS = [
    "fig-auditor-rep--action-present--expr-deadpan",
    "fig-qt-wiles--action-accuse--expr-deadpan",
    "fig-qt-wiles--action-present--expr-delighted",
    "fig-qt-wiles--action-armscrossed--expr-crestfallen",
]
MINTER = {  # provenance shown on each card
    "L05": "dead worker — $0 stage (Daniel's pick, no provider call)",
    "L03": "dead worker", "L28": "dead worker", "L63": "dead worker", "L71": "dead worker",
    "L113": "resume worker", "L172": "resume worker", "L196": "resume worker",
}

S = B.shot_index(VIDEO)
M = B.motion_index(VIDEO)
LIB = B.library_assets(VIDEO)
named_by_shot = B.named_figures_by_shot(LIB)
seated = B.seated_shots(S, B.identity_names(LIB))
canon_file = B.canonical_files(LIB)
owner_of = B.owner_literal_by_place(S.values())

# L28 failed the fresh-eyes era-register review and took its ONE surgical retry, so it renders as TWO
# cards — the retry as the live L28, and the preserved attempt 1 beside it for before/after.
L28_VARIANTS = [
    (os.path.join(STAGING, "L28-retry1.png"),
     "scene (RETRY 1 - LIVE L28, staged)",
     "REMINT resume worker, attempt 2. Surgical retry against the two MODEL-DEVIATION failures only "
     "(camera elevation + outline line weight): one exact-replace of the Framing span, changed_spans=1. "
     "CAMERA: corrected - eye-level from the aisle, horizon mid-frame, bench tops read edge-on. "
     "LINE WEIGHT: still FAILING by measurement - ink luminance 44.5 vs the archived prior's 23.0 "
     "(#241a12 is 28.2), and ink coverage FELL 11.65% -> 8.90%. The one sanctioned retry is spent, so "
     "the register question goes to the human. PALETTE was deliberately NOT touched: 'beige, steel "
     "grey, cool white tube light' is AUTHORED in the shot and is the human's separate ruling."),
    (os.path.join(SCRATCH, "L28-remint-attempt1.png"),
     "scene (ATTEMPT 1 - FAILED review, preserved evidence)",
     "REMINT dead worker, attempt 1. Failed the fresh-eyes era-register review on three criteria: "
     "thin cool-grey hairline outline; deep oblique ELEVATED camera looking down the bench line, "
     "contradicting the authored 'wide static eye-level from the aisle'; and the cool grey palette "
     "(AUTHORED - not a defect anyone may silently correct). Superseded as live by retry 1."),
]

cards = []
for sid in PLATES:
    s = S.get(sid, {})
    named = named_by_shot.get(sid, [])
    canon_refs = [(n, canon_file[n]) for n in named
                  if n in canon_file and os.path.exists(canon_file[n])]
    if sid == "L28":
        variants = L28_VARIANTS
    else:
        variants = [(os.path.join(STAGING, sid + ".png"),
                     "scene (staged, not yet promoted)",
                     "REMINT %s - staged in <kit>/_staging, awaiting this ruling before promotion"
                     % MINTER.get(sid, "?"))]
    for path, label, reason in variants:
        if not os.path.exists(path):
            raise SystemExit("missing staged plate: " + path)
        cards.append(dict(
            sid=sid, label=label, path=path,
            cls=s.get("shot_class") or "",
            vo=s.get("vo_text") or "",
            anim=B.describe_animation(M.get(sid)),
            flagged=(sid == "L28"),
            reason=reason,
            review_status="unreviewed",
            invariants=B.applicable_invariants(s, sid, named, seated, owner_of),
            canon=canon_refs,
        ))

pending = {f: (p, w) for f, p, w in B.pending_figures(STAGING)}
fig_triples = []
for fid in FIGS:
    path = os.path.join(STAGING, fid + ".png")
    if not os.path.exists(path):
        raise SystemExit("missing staged figure: " + path)
    why = pending.get(fid, (path, "no C-6 record yet"))[1]
    fig_triples.append((fid, path, why))
    char = B.figure_character(fid)
    canon = canon_file.get(char)
    cards.append(dict(
        sid=fid, label="step-1 figure", path=path,
        cls="step-1 figure", vo="",
        anim="reference frame — no animation",
        flagged=True, reason="REMINT resume worker — " + why,
        review_status="unreviewed",
        invariants=list(B.FIGURE_INVARIANTS.items()),
        canon=[(char, canon)] if canon and os.path.exists(canon) else [],
    ))

page, nb = B.build(
    cards,
    "bricks-fresh — remint C-6 board",
    "12 reminted assets (8 place plates + 4 STEP-1 cards) · L28 shown as retry 1 (LIVE) + attempt 1 "
    "(failed review, preserved) · all verdicts EMPTY — boss + Daniel rule",
    1600, 82)
out_html = os.path.join(SCRATCH, "remint-c6-board.html")
io.open(out_html, "w", encoding="utf-8").write(page)

skel = B.figure_verdict_skeleton(fig_triples, reviewer="")
out_json = os.path.join(SCRATCH, "remint-c6-figures.json")
with io.open(out_json, "w", encoding="utf-8") as f:
    json.dump(skel, f, ensure_ascii=False, indent=1)
    f.write("\n")

print("board: %s (%d cards, %.1f MB inlined, %.1f MB page)"
      % (out_html, len(cards), nb / 1e6, os.path.getsize(out_html) / 1e6))
print("figures: %s (%d figures, every verdict empty)" % (out_json, len(skel["figures"])))
for fid in FIGS:
    print("   pending-reason:", fid, "->", pending.get(fid, (None, "NOT pending"))[1])
