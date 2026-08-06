"""Build the FINAL Phase-6B gate board for bricks-fresh (first tenth, L01-L25).

This is the human RULING surface, not a review surface: every card here already carries its
machine-tier terminal verdict, read straight from `assets/scenes/manifest.json` (the single writer
is `stamp_review.py`; this script writes nothing to it). Nothing is stamped and nothing is
generated here.

Supersedes `_build_p6b_board.py` (the round-3 fresh-eyes REVIEW board, now stale: its "unruled"
framing no longer holds now that round-3 verdicts are in). This driver keeps that script's two
techniques verbatim:
  * `build_review_artifact.inline()` for image -> data-URI (CSP blocks every external host)
  * the lightbox markup/JS (<-/->/Esc, click-to-zoom)
but restructures the PAGE itself around Daniel's ruling need instead of a flat review grid:

  1. Header + status line
  2. RULINGS NEEDED (verbatim boss text, most prominent)
  3. Verified grid — the 18 shot-slots (16 scene frames + 2 context plates) with a FINAL verdict
  4. Park lineage — the 8 shot-slots that ever parked, each shown as its full attempt history in
     generation order (original -> retry -> remint), badged per-attempt with round + the fresh-eyes
     verifier's own one-line headline (quoted verbatim from p6b-verify*.md, never re-worded here)
  5. Footer with pointers

Scope reconciliation (printed at the end, also asserted so a drift fails loud): the manifest holds
39 entries, 24 verified / 15 parked. Of those, 6 verified entries (L28, L63, L71, L113, L172, L196)
are Phase-6A plates OUTSIDE the L01-L25 slice this board covers and are not shown. The remaining 33
in-range entries split 18 verified / 15 parked, which is exactly what this board displays: 18 cards
in the verified grid (16 scene frames + 2 context plates) and all 15 parked entries across 8 park
lineages (L16 and L18's lineages each resolve to a verified final frame, shown in both the grid
and, for narrative completeness, as the last card of their own lineage row).
"""
import io, json, os, re, sys, html

ORG = r"C:\Users\danie\kb\orgs\faceless-youtube"
SCRIPTS = os.path.join(ORG, r".claude\skills\image-generation\scripts")
sys.path.insert(0, SCRIPTS)
import build_review_artifact as B  # noqa: E402  (reused: inline() image->data-URI encoder)

VIDEO = os.path.join(ORG, r"channels\the-second-take\videos\2026-07-28-bricks-fresh")
KIT = os.path.join(ORG, r"channels\the-second-take\visual-kit")
STAGING = os.path.join(KIT, "_staging")
SCENES = os.path.join(VIDEO, "assets", "scenes")
SCRATCH = os.path.join(VIDEO, "scratchpad")

MANIFEST = {e["shot_id"]: e for e in json.load(
    io.open(os.path.join(SCENES, "manifest.json"), encoding="utf-8"))["shots"]}


def base_num(shot_id):
    return int(re.match(r"^L(\d+)", shot_id).group(1))


IN_RANGE = {sid: e for sid, e in MANIFEST.items() if base_num(sid) <= 25}
OUT_RANGE = {sid: e for sid, e in MANIFEST.items() if base_num(sid) > 25}

total_verified = sum(1 for e in MANIFEST.values() if e["review_status"] == "verified")
total_parked = sum(1 for e in MANIFEST.values() if e["review_status"] == "parked")
in_verified = sum(1 for e in IN_RANGE.values() if e["review_status"] == "verified")
in_parked = sum(1 for e in IN_RANGE.values() if e["review_status"] == "parked")

assert total_verified == 24 and total_parked == 15, \
    "manifest totals drifted from the expected 24 verified / 15 parked: %d/%d" % (total_verified, total_parked)
assert len(OUT_RANGE) == 6 and all(e["review_status"] == "verified" for e in OUT_RANGE.values()), \
    "expected exactly 6 out-of-range (L28/L63/L71/L113/L172/L196) entries, all verified"
assert in_verified == 18 and in_parked == 15, \
    "in-range (L01-L25) split drifted from 18 verified / 15 parked: %d/%d" % (in_verified, in_parked)

# ---------------------------------------------------------------------------
# Verified grid — slot -> the manifest KEY carrying that slot's FINAL image.
# L16 and L18 each parked twice/once before a later attempt cleared them; every other slot in this
# list landed verified on its own first-listed manifest key.
# ---------------------------------------------------------------------------
GRID_NOTE = {
    "L03": "PROMOTED CONTEXT PLATE — Daniel board-v2 ruling R3, night-scene exception. Median sat "
           "0.0902 sits below the R1 floor BY DESIGN; L22-L25 inherit this as their night baseline.",
    "L05": "PROMOTED CONTEXT PLATE — Daniel board-v2 ruling R5. The staged style-tile-copy was "
           "REJECTED; this is the PREVIOUS computer-shop plate, restored by hand ($0, no batch "
           "spec). 2K where its seven siblings run 1K — a taste call over tier consistency.",
    "L01": "Round-1 PASS. Crowd sits off the authored back-wall arrangement but the staging intent "
           "(dark screen centred, unobstructed) holds; sat 0.7176, the batch's chromatic high.",
    "L02": "Round-1 PASS. Strongest delta in the whole batch — only the maze-grid screen changes, "
           "the entire held set carries frame-for-frame off L01.",
    "L04": "Round-1 PASS. Commuter stream crosses the near pavement rather than the far side, but "
           "the ironic no-one-looks-at-the-newsstand payload lands exactly as authored.",
    "L09": "Round-1 PASS. Winged computer 'flying off the shelves' idiom lands; minor door-colour "
           "drift off L05 on a non-payload element.",
    "L11": "Round-1 PASS. pc-boxy + prop-drive service-bench composite; the occluded right arm was "
           "judged plausible occlusion, not amputation — the reviewer's closest anatomy call.",
    "L12": "Round-1 PASS. Drive-vault base; the 'four courses' scale pin under-delivers (~2.5) but "
           "the readability purpose it was written for (L14's folders) is met regardless.",
    "L13": "Round-1 PASS. Vault door swings open on empty ruled shelves; exemplary continuity hold "
           "off L12, nothing outside the authored change moved.",
    "L14": "Round-1 PASS. Top two shelves fill with folders and sleeves, both correctly blank — the "
           "batch's highest-risk unrequested-text surface, and it is clean.",
    "L15": "Round-1 PASS. Curtain closes the bottom shelf; the drive-vault chain closes with "
           "near-perfect continuity end to end.",
    "L16": "ROUND-3 changed-mechanism RE-MINT (L16-remint1) — SUPERSEDES two parked attempts. Ink "
           "16.8deg/+18.0 lands on the #241a12 target, the frieze runs square to frame, the rank "
           "clears both frame edges, the Tier-A vantage repair holds. Full history in Park Lineage.",
    "L17": "Round-1 PASS. The plate glass splits into two side panels rather than one running pane "
           "— a staging drift the reviewer flagged as the closest call they let pass in the batch.",
    "L18": "ROUND-2 surgical retry (L18-retry1) — SUPERSEDES its parked original. Slabs stand "
           "locked up per the R-12 geometry, the held set and the 1980s crowd both fully restored. "
           "Full history in Park Lineage. MANIFEST TRAP: the parked L18 record still points at "
           "this same file — a seed/gate lookup can resolve the wrong status (recorded, not repaired).",
    "L19": "Round-1 PASS. Clears the grey-drain bar on measurement (warm ink, three chromatic "
           "anchors) despite an authored cool-concrete palette and two minor staging drifts.",
    "L20": "Round-1 PASS. Second-best delta in the batch; the rake-in-banknotes idiom reads even "
           "though the heap renders as a thinner scatter than authored.",
    "L21": "Round-1 PASS. Picks-and-shovels stall repopulated as rewritten; the sky renders a "
           "stronger dawn-orange than the authored palette but stays era-correct and chromatic.",
    "L22": "Round-2 PASS. Brick-tease chain root off the L03 night plate; median sat 0.0902 matches "
           "L03 to four decimals — authored darkness, not a grey-drain regression.",
}

GRID_KEY = {  # slot id -> manifest key holding the slot's final image
    "L03": "L03", "L05": "L05", "L01": "L01", "L02": "L02", "L04": "L04", "L09": "L09",
    "L11": "L11", "L12": "L12", "L13": "L13", "L14": "L14", "L15": "L15",
    "L16": "L16-remint1", "L17": "L17", "L18": "L18-retry1",
    "L19": "L19", "L20": "L20", "L21": "L21", "L22": "L22",
}
CONTEXT_SLOTS = {"L03", "L05"}
GRID_ORDER = sorted(GRID_KEY, key=base_num)

# ---------------------------------------------------------------------------
# Park lineage — 8 slots that ever parked, in generation order. L16 and L18's lineages RESOLVE
# (last card verified); the other 6 remain open and are exactly the RULINGS NEEDED slots.
# One-line headlines are the fresh-eyes verifier's OWN words, quoted verbatim from the per-round
# verify docs' Tally sections (p6b-verify.md / p6b-verify2.md / p6b-verify3.md) — never re-worded.
# ---------------------------------------------------------------------------
LINEAGE = {
    "L06": ["L06", "L06-retry1"],
    "L07": ["L07", "L07-retry1"],
    "L16": ["L16", "L16-retry1", "L16-remint1"],
    "L18": ["L18", "L18-retry1"],
    "L10": ["L10", "L10-retry1"],
    "L23": ["L23", "L23-retry1"],
    "L24": ["L24", "L24-retry1"],
    "L25": ["L25", "L25-retry1"],
}
LINEAGE_HEADING = {
    "L06": "L06 \u2014 store-1983 delta (the duplicated dateline) \u2014 NEEDS RULING (P1)",
    "L07": "L07 \u2014 store-rush base (counter vantage + banknote) \u2014 NEEDS RULING (P2, blocks L08)",
    "L16": "L16 \u2014 crowd-multiplication shelf (the cyan-ink park) \u2014 RESOLVED at round 3",
    "L18": "L18 \u2014 shopfront-brawl delta (the flat-slabs park) \u2014 RESOLVED at round 2",
    "L10": "L10 \u2014 ironic-counterpoint overnight queue \u2014 NEEDS RULING (P3)",
    "L23": "L23 \u2014 brick-tease delta 1, the reveal (carton scale) \u2014 NEEDS RULING (P4, set with L24/L25)",
    "L24": "L24 \u2014 brick-tease delta 2, the row (carton scale) \u2014 NEEDS RULING (P4, set with L23/L25)",
    "L25": "L25 \u2014 brick-tease delta 3, chain close (carton scale + lettering surface) \u2014 NEEDS RULING (P4, set with L23/L24)",
}
ROUND_OF = {
    "L06": 1, "L06-retry1": 2,
    "L07": 1, "L07-retry1": 2,
    "L16": 1, "L16-retry1": 2, "L16-remint1": 3,
    "L18": 1, "L18-retry1": 2,
    "L10": 2, "L10-retry1": 3,
    "L23": 2, "L23-retry1": 3,
    "L24": 2, "L24-retry1": 3,
    "L25": 2, "L25-retry1": 3,
}
# Verbatim one-line verifier headlines, sourced from each round's Tally section.
HEADLINE = {
    "L06": "an unauthored second '1983' tent card duplicates the established diegetic literal.",
    "L06-retry1": "the double '1983' is fixed, but the sole authored delta (the crate) moved onto "
                  "the counter top at its FAR end, where L05's own prose puts the window card; a "
                  "passing attribute regressed. [verifier: mildest park in the set, a defensible "
                  "human waiver]",
    "L07": "the authored counter-height vantage was not delivered; one banknote floats with no "
           "hand; the '1983' card is redrawn truncated to '83'; the crate is not at the counter's "
           "near end.",
    "L07-retry1": "three of four defects fixed, but the frame now draws a SECOND counter with a "
                  "SECOND brass till, the foreground till carries garbled unauthored glyphs, and "
                  "the counter-height vantage is still not delivered.",
    "L16": "cool blue-black ink (hue 172deg, the only inversion in the batch) and the authored "
           "beige cases rendered grey, collapsing the 'beige on grey' palette.",
    "L16-retry1": "warm ink and beige cases landed, but the authored square-to-frame shelf became "
                  "a deep oblique, the rank no longer runs past both frame edges, the Tier-A "
                  "vantage repair was undone and the lit centre bay weakened.",
    "L16-remint1": "PASS \u2014 all round-1 + round-2 defects closed at once; warm ink 16.8deg/+18.0, "
                   "frieze square to frame, rank off both edges, Tier-A vantage held, nothing "
                   "regressed. Supersedes L16.png and L16-retry1.png.",
    "L18": "the phone slabs lie flat instead of standing locked up (the R-12 geometry), and the "
           "frame re-invented its parent's set, crowd and period instead of holding them.",
    "L18-retry1": "PASS \u2014 the one clean recovery in the set. All four round-1 defects are closed "
                  "and nothing measurable broke.",
    "L10": "the overnight queue with its chairs, sleeping bags and flasks is staged INSIDE the "
           "shop instead of beyond the window glass, inverting the shot's still-interior/"
           "packed-street device; the 'wide from behind the counter' vantage was also not delivered.",
    "L10-retry1": "correction not taken (queue still inside the shop, breath on indoor figures); "
                  "ink COOL-INVERTED at 217.7deg/-3.8; vantage still the L05 camera; the 'unlit "
                  "warm brown inside' palette regressed to cold.",
    "L23": "the opened carton is ~3x the ranked carton it replaces and the brick fills about a "
           "third of it, against an authored 'filling the box exactly' and a next-beat narration "
           "of 'little boxes'.",
    "L23-retry1": "brick fill fixed (36% to 74%); the open box is still ~3.4x the ranked carton it "
                  "replaces and overhangs its own pallet, so the authored 'front carton on that "
                  "row' and 'filling the box exactly' are not met.",
    "L24": "the same scale defect propagated to all three pallets, plus two held crew members "
           "gained headwear and clothing against the parent.",
    "L24-retry1": "wardrobe drift CLOSED; but each top row renders as one pallet-width open box "
                  "holding three bricks, not individual cartons with one brick each \u2014 and the VO "
                  "on this frame says 'little boxes'.",
    "L25": "the inherited scale defect, 'HARD DRIVE' on only the three front boxes rather than "
           "every open carton, and the persisting crew drift. Lettering register itself is clean.",
    "L25-retry1": "'HARD DRIVE' renders three times on the SEALED film-wrapped courses, spanning "
                  "carton seams, with no open carton lettered at all \u2014 the authored clause unmet a "
                  "second time. Lettering craft itself is clean.",
}

# ---------------------------------------------------------------------------
# RULINGS NEEDED — verbatim boss-authored text. Reproduced exactly; not summarized, not reworded.
# ---------------------------------------------------------------------------
RULINGS = [
    ("P1", "L06 WAIVER",
     "retry fixed the duplicated '1983' but moved the crate to the counter's far end (round-1 "
     "passed its floor placement). Verifier: mildest park in the set, defensible human waiver. "
     "Accept L06-retry1, or park the slot for a future mechanism-window re-mint?"),
    ("P2", "L07 + L08",
     "both L07 attempts parked (second brass till + garbled till glyphs on the retry); L08 was "
     "never minted \u2014 doctrine-blocked on its parked parent. Rule L07 (waive one attempt / park "
     "both), which unblocks or parks L08."),
    ("P3", "L10",
     "both attempts parked; retry has three independent fails including a COOL ink inversion "
     "recurring AFTER the R1 fix. Verifier: not waivable. Park the slot pending the mechanism "
     "window?"),
    ("P4", "L23/L24/L25 SET",
     "one inherited cause \u2014 the hero carton renders ~3.4\u00d7 the ranked cartons (the authored "
     "\u201cexactly\u201d scale gag loses its subject). Everything else closed (wardrobe fixed, "
     "night-chain continuity best in video, 'HARD DRIVE' craft clean but on the wrong surface in "
     "L25). Waive as a set, or one L23 re-roll at correct scale + re-base L24/L25 (~$0.12) at the "
     "next window?"),
    ("P5", "MECHANISM QUEUE (no gen ruling, confirm priorities)",
     "(a) R1 ink fix not total \u2014 cool inversion recurred; ink measure stays on every future "
     "verification; (b) forge silently degrades shots with unresolvable parents to root plates "
     "(3 occurrences) \u2014 fail-loud fix owed; (c) scenes manifest allows two records pointing at "
     "one file (L18, now L16 same pattern) with the parked record shadowing the verified one for "
     "seed resolution; (d) retry mechanism cannot express re-base+correct; (e) style tile carries "
     "a content element ('1983' tent card) that bled into L06 \u2014 content-free register exemplar "
     "candidate."),
]

# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
GRID_W, GRID_Q = 900, 82
LIN_W, LIN_Q = 460, 80

CSS = B.CSS + """
.wrap{max-width:1400px}
h2{font-size:20px;margin:36px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line)}
h3{font-size:15px;margin:26px 0 10px;color:var(--fg)}
.statusline{background:var(--card);border:1px solid var(--line);border-radius:9px;
 padding:12px 16px;margin:0 0 8px;font-size:14px}
.rulings{background:rgba(192,57,43,.06);border:2px solid var(--flag);border-radius:12px;
 padding:6px 20px 18px;margin:18px 0 8px}
.rulings h2{border-bottom-color:var(--flag);color:var(--flag)}
.ruling{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--flag);
 border-radius:8px;padding:12px 16px;margin:14px 0}
.ruling .rid{display:inline-block;font-weight:700;color:var(--flag);margin-right:8px}
.ruling .rtitle{font-weight:650}
.ruling p{margin:8px 0 0;line-height:1.6}
.badge2{display:inline-block;font-size:11px;border-radius:20px;padding:2px 9px;font-weight:650}
.b-verified{background:#1e7a3c;color:#fff}
.b-context{background:#2f5fa8;color:#fff}
.b-final{background:#1e7a3c;color:#fff}
.b-parked{background:var(--flag);color:#fff}
.round-chip{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:20px;
 padding:1px 8px;margin-left:6px}
.lineage-group{margin-bottom:8px}
.lineage-status{font-size:13px;font-weight:650;padding:2px 10px;border-radius:20px;
 display:inline-block;margin-left:10px;vertical-align:middle}
.lineage-open{background:rgba(192,57,43,.15);color:var(--flag)}
.lineage-resolved{background:rgba(30,122,60,.15);color:#1e7a3c}
.lineage-row{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap}
.lineage-row .card{flex:1 1 380px;max-width:460px}
.lineage-note{font-size:13px;color:var(--mut);margin:8px 0 0;font-style:italic}
footer{margin:50px 0 10px;padding-top:18px;border-top:1px solid var(--line);
 color:var(--mut);font-size:13px;line-height:1.7}
footer a,footer code{color:var(--fg)}
.reconcile{font-size:12.5px;color:var(--mut);margin:4px 0 0}
"""


def card_html(sid, path, badge_html, note, max_w, quality):
    uri, nb = B.inline(path, max_w, quality)
    return ('<figure class="card"><img loading="lazy" src="%s" alt="%s">'
            '<div class="meta"><div class="hd"><span class="id">%s</span>%s</div>'
            '<p class="anim">%s</p></div></figure>'
            % (uri, html.escape(sid), html.escape(sid), badge_html, html.escape(note))), nb


def build():
    total_bytes = 0
    parts = []

    parts.append("<title>bricks-fresh \u2014 Phase 6B board FINAL (first tenth, L01\u2013L25)</title>")
    parts.append("<style>%s</style>" % CSS)
    parts.append('<div class="wrap">')
    parts.append("<h1>bricks-fresh \u2014 Phase 6B board FINAL (first tenth, L01\u2013L25)</h1>")
    parts.append(
        '<p class="statusline">18 of 25 shot-slots verified (16 scene frames + 2 context plates) '
        '&middot; machine tier closed &mdash; all retry budgets spent &middot; phase spend $1.872 '
        'of $3.00</p>')

    # -- RULINGS NEEDED --------------------------------------------------
    parts.append('<section class="rulings"><h2>RULINGS NEEDED</h2>')
    for rid, title, body in RULINGS:
        parts.append(
            '<div class="ruling"><span class="rid">%s</span><span class="rtitle">%s</span>'
            '<p>%s</p></div>' % (html.escape(rid), html.escape(title), html.escape(body)))
    parts.append("</section>")

    # -- Verified grid -----------------------------------------------------
    parts.append("<h2>Verified \u2014 final (18 shot-slots: 16 scene frames + 2 context plates)</h2>")
    parts.append('<div class="grid">')
    for slot in GRID_ORDER:
        key = GRID_KEY[slot]
        entry = MANIFEST[key]
        assert entry["review_status"] == "verified", "%s (%s) is not verified in the manifest" % (slot, key)
        path = os.path.join(VIDEO, entry["file"])
        if not os.path.exists(path):
            raise SystemExit("missing promoted file for %s: %s" % (slot, path))
        is_ctx = slot in CONTEXT_SLOTS
        badge = '<span class="badge2 %s">%s</span>' % (
            "b-context" if is_ctx else "b-verified",
            "CONTEXT PLATE" if is_ctx else "VERIFIED")
        if key != slot:
            badge += '<span class="round-chip">final: %s</span>' % html.escape(key)
        html_frag, nb = card_html(slot, path, badge, GRID_NOTE[slot], GRID_W, GRID_Q)
        parts.append(html_frag)
        total_bytes += nb
    parts.append("</div>")

    # -- Park lineage --------------------------------------------------------
    parts.append("<h2>Park lineage \u2014 full attempt history (8 shot-slots, 15 parked entries + "
                  "2 resolving final frames)</h2>")
    OPEN_SLOTS = {"L06", "L07", "L10", "L23", "L24", "L25"}
    for slot in ["L06", "L07", "L16", "L18", "L10", "L23", "L24", "L25"]:
        chain = LINEAGE[slot]
        status_cls = "lineage-open" if slot in OPEN_SLOTS else "lineage-resolved"
        status_txt = "NEEDS RULING" if slot in OPEN_SLOTS else "RESOLVED"
        parts.append('<div class="lineage-group"><h3>%s<span class="lineage-status %s">%s</span></h3>'
                     % (html.escape(LINEAGE_HEADING[slot]), status_cls, status_txt))
        parts.append('<div class="lineage-row">')
        for key in chain:
            entry = MANIFEST[key]
            path = os.path.join(STAGING, key + ".png")
            if not os.path.exists(path):
                raise SystemExit("missing lineage frame: " + path)
            status = entry["review_status"]
            is_final = (status == "verified")
            badge = '<span class="badge2 %s">%s</span><span class="round-chip">ROUND %d</span>' % (
                "b-final" if is_final else "b-parked",
                "VERIFIED (FINAL)" if is_final else "PARKED",
                ROUND_OF[key])
            html_frag, nb = card_html(key, path, badge, HEADLINE[key], LIN_W, LIN_Q)
            parts.append(html_frag)
            total_bytes += nb
        parts.append("</div>")
        if slot == "L07":
            parts.append('<p class="lineage-note">L08 was never generated \u2014 doctrine-blocked '
                          "on its parked parent L07. No image exists for it; it unblocks or parks "
                          "with whatever ruling L07 receives (see RULINGS P2).</p>")
        parts.append("</div>")

    # -- Reconciliation note -------------------------------------------------
    parts.append(
        '<p class="reconcile">Badge reconciliation: manifest.json holds 39 entries, %d verified / '
        '%d parked. 6 verified entries (L28, L63, L71, L113, L172, L196) are Phase-6A plates '
        'outside the L01\u2013L25 slice and are not shown on this board. Of the 33 in-range entries, '
        "%d verified / %d parked \u2014 exactly the 18 cards in the Verified grid above and the 15 "
        "parked entries spread across the 8 Park Lineage groups (each group's own final resolved "
        "frame, where present, is the same manifest entry already counted in the Verified grid)."
        % (total_verified, total_parked, in_verified, in_parked))

    # -- Footer ---------------------------------------------------------------
    parts.append(
        "<footer>Generated 2026-08-06 &middot; bricks-fresh Phase 6B, first tenth (L01\u2013L25) "
        "&middot; source of truth: <code>assets/scenes/manifest.json</code> &middot; full "
        "narrative + spend ledger: <code>scratchpad/p6b-report.md</code> &middot; generation log: "
        "<code>scratchpad/p6b-genlog.md</code> &middot; fresh-eyes verdicts: "
        "<code>scratchpad/p6b-verify.md</code> (round 1), <code>p6b-verify2.md</code> (round 2), "
        "<code>p6b-verify3.md</code> (round 3, final) &middot; builder: "
        "<code>scratchpad/_build_p6b_board_final.py</code></footer>")

    parts.append("</div>")  # .wrap

    # -- lightbox + JS (verbatim mechanics from build_review_artifact.py) --------------------
    parts.append(
        "<div id=lb><button class=nav id=prev>\u2039</button><img id=lbi>"
        "<div id=lbm></div><button class=nav id=next>\u203a</button>"
        "<button id=cls class=nav style='width:auto;padding:0 14px;border-radius:8px'>Esc</button>"
        "<span class=hint>\u2190 / \u2192 to step &middot; Esc to close</span></div>")
    js = B.JS.replace(
        "const fb=document.getElementById('fb');let on=false;\n"
        "fb.onclick=()=>{on=!on;fb.setAttribute('aria-pressed',on);\n"
        "  cards.forEach(c=>c.style.display=(!on||c.classList.contains('flag'))?'':'none')};\n",
        "")
    parts.append("<script>%s</script>" % js)

    return "".join(parts), total_bytes


page, nb = build()
out_html = os.path.join(SCRATCH, "p6b-board.html")
io.open(out_html, "w", encoding="utf-8").write(page)

card_count = len(GRID_ORDER) + sum(len(v) for v in LINEAGE.values())
size_mb = os.path.getsize(out_html) / 1e6
print("board: %s" % out_html)
print("  cards: %d (grid=%d, lineage=%d) | inlined images: %.2f MB | page size: %.2f MB"
      % (card_count, len(GRID_ORDER), sum(len(v) for v in LINEAGE.values()), nb / 1e6, size_mb))
print("  manifest totals: %d verified / %d parked (39 entries)" % (total_verified, total_parked))
print("  in-range (L01-L25, 33 entries): %d verified / %d parked" % (in_verified, in_parked))
print("  out-of-range (Phase-6A plates, not shown): %d, all verified" % len(OUT_RANGE))
if size_mb > 15:
    print("  WARNING: page exceeds the 15MB self-contained budget")
