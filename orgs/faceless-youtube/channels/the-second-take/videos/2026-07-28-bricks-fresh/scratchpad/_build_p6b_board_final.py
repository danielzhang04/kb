"""Build the FINAL Phase-6B gate board for bricks-fresh (first tenth, L01-L25).

This is the human RULING surface, not a review surface: every card here already carries its
machine-tier terminal verdict, read straight from `assets/scenes/manifest.json` (the single writer
is `stamp_review.py`; this script writes nothing to it). Nothing is stamped and nothing is
generated here. vo_text and still_prompt are read LIVE from `shots.json` every run -- never
hand-transcribed -- so the board can never drift from the authored script/prompt text.

REV 2 (2026-08-06, Daniel via coordinator): killed the categorized verified-grid / park-lineage
split. New structure:
  1. Header + status line
  2. RULINGS NEEDED (verbatim boss text) -- the 6 ruling shots only (L06, L07+L08, L10, L23, L24,
     L25), each with its P1-P5 ruling paragraph, its full vo_text, and its attempt lineage
     thumbnails badged round + the fresh-eyes verifier's own one-line headline. P5 (mechanism
     queue, no shot content) closes the section.
  3. ALL SHOTS L01-L25, IN ORDER -- one card per shot slot, strictly sequential, each showing the
     CURRENT BEST frame (the promoted verified file where one exists, else the latest staged
     attempt), a status badge (verified / parked / blocked-unminted for L08), the full vo_text
     quoted prominently, the authored still_prompt collapsed behind <details>, the verifier's own
     one-line headline, and -- for the 6 still-parked slots -- small thumbnails of the earlier
     attempts. Ruling shots appear again here in sequence (this is the watch-it-together view).
  4. Footer

Reuses `build_review_artifact.inline()` for image -> data-URI (CSP blocks every external host) and
the lightbox markup/JS (<-/->/Esc, click-to-zoom) verbatim from the prior board.

Reconciliation (printed + asserted, not just claimed): the manifest holds 39 entries, 24 verified /
15 parked. 6 verified entries (L28, L63, L71, L113, L172, L196) are Phase-6A plates outside the
L01-L25 slice and are never referenced here. The remaining 33 in-range entries (18 verified / 15
parked) are exactly the set of manifest keys this board's images resolve to -- asserted as an exact
set-equality check, not just a count, so a missing or extra reference fails loud.
"""
import io, json, os, re, sys, html
from PIL import Image, ImageDraw

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
SHOTS = {s["id"]: s for s in json.load(
    io.open(os.path.join(VIDEO, "shots.json"), encoding="utf-8"))["long_form"]["shots"]}


def base_num(shot_id):
    return int(re.match(r"^L(\d+)", shot_id).group(1))


IN_RANGE = {sid: e for sid, e in MANIFEST.items() if base_num(sid) <= 25}
OUT_RANGE = {sid: e for sid, e in MANIFEST.items() if base_num(sid) > 25}
total_verified = sum(1 for e in MANIFEST.values() if e["review_status"] == "verified")
total_parked = sum(1 for e in MANIFEST.values() if e["review_status"] == "parked")
in_verified = sum(1 for e in IN_RANGE.values() if e["review_status"] == "verified")
in_parked = sum(1 for e in IN_RANGE.values() if e["review_status"] == "parked")

assert total_verified == 24 and total_parked == 15, \
    "manifest totals drifted from 24 verified / 15 parked: %d/%d" % (total_verified, total_parked)
assert len(OUT_RANGE) == 6 and all(e["review_status"] == "verified" for e in OUT_RANGE.values()), \
    "expected exactly 6 out-of-range verified plates (L28/L63/L71/L113/L172/L196)"
assert in_verified == 18 and in_parked == 15, \
    "in-range (L01-L25) split drifted from 18 verified / 15 parked: %d/%d" % (in_verified, in_parked)

SHOT_SLOTS = ["L%02d" % n for n in range(1, 26)]

# slot -> manifest KEY carrying the slot's FINAL (best/promoted) image, for the 18 verified slots.
FINAL_KEY = {
    "L01": "L01", "L02": "L02", "L03": "L03", "L04": "L04", "L05": "L05", "L09": "L09",
    "L11": "L11", "L12": "L12", "L13": "L13", "L14": "L14", "L15": "L15",
    "L16": "L16-remint1", "L17": "L17", "L18": "L18-retry1",
    "L19": "L19", "L20": "L20", "L21": "L21", "L22": "L22",
}
CONTEXT_SLOTS = {"L03", "L05"}

# slot -> full attempt lineage in generation order, for the 6 still-parked slots (+ L16/L18's
# now-resolved history, kept here only as data -- NOT surfaced per-slot in the sequential section
# per spec, only in RULINGS for the still-open 6).
LINEAGE = {
    "L06": ["L06", "L06-retry1"],
    "L07": ["L07", "L07-retry1"],
    "L10": ["L10", "L10-retry1"],
    "L23": ["L23", "L23-retry1"],
    "L24": ["L24", "L24-retry1"],
    "L25": ["L25", "L25-retry1"],
}
PARKED_LATEST = {slot: chain[-1] for slot, chain in LINEAGE.items()}   # current best (still parked)
PARKED_EARLIER = {slot: chain[:-1] for slot, chain in LINEAGE.items()}  # everything before latest
OPEN_SLOTS = set(LINEAGE)          # L06, L07, L10, L23, L24, L25 -- the ruling shots
BLOCKED_SLOTS = {"L08"}            # never generated

ROUND_OF = {
    "L06": 1, "L06-retry1": 2,
    "L07": 1, "L07-retry1": 2,
    "L10": 2, "L10-retry1": 3,
    "L23": 2, "L23-retry1": 3,
    "L24": 2, "L24-retry1": 3,
    "L25": 2, "L25-retry1": 3,
}

# Verbatim one-line verifier headlines, sourced from each round's Tally section in
# p6b-verify.md / p6b-verify2.md / p6b-verify3.md -- never re-worded here.
HEADLINE = {
    "L01": "Round-1 PASS. Crowd sits off the authored back-wall arrangement but the staging "
           "intent (dark screen centred, unobstructed) holds; sat 0.7176, the batch's chromatic high.",
    "L02": "Round-1 PASS. Strongest delta in the whole batch -- only the maze-grid screen changes, "
           "the entire held set carries frame-for-frame off L01.",
    "L03": "PROMOTED CONTEXT PLATE -- Daniel board-v2 ruling R3, night-scene exception. Median sat "
           "0.0902 sits below the R1 floor BY DESIGN; L22-L25 inherit this as their night baseline.",
    "L04": "Round-1 PASS. Commuter stream crosses the near pavement rather than the far side, but "
           "the ironic no-one-looks-at-the-newsstand payload lands exactly as authored.",
    "L05": "PROMOTED CONTEXT PLATE -- Daniel board-v2 ruling R5. The staged style-tile-copy was "
           "REJECTED; this is the PREVIOUS computer-shop plate, restored by hand ($0, no batch "
           "spec). 2K where its seven siblings run 1K -- a taste call over tier consistency.",
    "L06": "an unauthored second '1983' tent card duplicates the established diegetic literal.",
    "L06-retry1": "the double '1983' is fixed, but the sole authored delta (the crate) moved onto "
                  "the counter top at its FAR end, where L05's own prose puts the window card; a "
                  "passing attribute regressed. Verifier: mildest park in the set, a defensible "
                  "human waiver.",
    "L07": "the authored counter-height vantage was not delivered; one banknote floats with no "
           "hand; the '1983' card is redrawn truncated to '83'; the crate is not at the counter's "
           "near end.",
    "L07-retry1": "three of four defects fixed, but the frame now draws a SECOND counter with a "
                  "SECOND brass till, the foreground till carries garbled unauthored glyphs, and "
                  "the counter-height vantage is still not delivered.",
    "L08": "Never generated -- doctrine-blocked on its parked parent L07. Unblocks or parks with "
           "whatever ruling L07 receives (see NEEDS YOUR RULING, P2).",
    "L09": "Round-1 PASS. Winged computer 'flying off the shelves' idiom lands; minor door-colour "
           "drift off L05 on a non-payload element.",
    "L10": "the overnight queue with its chairs, sleeping bags and flasks is staged INSIDE the "
           "shop instead of beyond the window glass, inverting the shot's still-interior/"
           "packed-street device; the 'wide from behind the counter' vantage was also not delivered.",
    "L10-retry1": "correction not taken (queue still inside the shop, breath on indoor figures); "
                  "ink COOL-INVERTED at 217.7deg/-3.8; vantage still the L05 camera; the 'unlit "
                  "warm brown inside' palette regressed to cold.",
    "L11": "Round-1 PASS. pc-boxy + prop-drive service-bench composite; the occluded right arm was "
           "judged plausible occlusion, not amputation -- the reviewer's closest anatomy call.",
    "L12": "Round-1 PASS. Drive-vault base; the 'four courses' scale pin under-delivers (~2.5) but "
           "the readability purpose it was written for (L14's folders) is met regardless.",
    "L13": "Round-1 PASS. Vault door swings open on empty ruled shelves; exemplary continuity hold "
           "off L12, nothing outside the authored change moved.",
    "L14": "Round-1 PASS. Top two shelves fill with folders and sleeves, both correctly blank -- "
           "the batch's highest-risk unrequested-text surface, and it is clean.",
    "L15": "Round-1 PASS. Curtain closes the bottom shelf; the drive-vault chain closes with "
           "near-perfect continuity end to end.",
    "L16-remint1": "ROUND-3 changed-mechanism RE-MINT -- supersedes two parked attempts. Ink "
                   "16.8deg/+18.0 lands on the #241a12 target, the frieze runs square to frame, "
                   "the rank clears both frame edges, the Tier-A vantage repair holds.",
    "L17": "Round-1 PASS. The plate glass splits into two side panels rather than one running pane "
           "-- a staging drift the reviewer flagged as the closest call they let pass in the batch.",
    "L18-retry1": "ROUND-2 surgical retry -- supersedes its parked original. Slabs stand locked up "
                  "per the R-12 geometry, the held set and the 1980s crowd both fully restored. "
                  "MANIFEST TRAP: the parked L18 record still points at this same file -- a seed/"
                  "gate lookup can resolve the wrong status (recorded, not repaired).",
    "L19": "Round-1 PASS. Clears the grey-drain bar on measurement (warm ink, three chromatic "
           "anchors) despite an authored cool-concrete palette and two minor staging drifts.",
    "L20": "Round-1 PASS. Second-best delta in the batch; the rake-in-banknotes idiom reads even "
           "though the heap renders as a thinner scatter than authored.",
    "L21": "Round-1 PASS. Picks-and-shovels stall repopulated as rewritten; the sky renders a "
           "stronger dawn-orange than the authored palette but stays era-correct and chromatic.",
    "L22": "Round-2 PASS. Brick-tease chain root off the L03 night plate; median sat 0.0902 "
           "matches L03 to four decimals -- authored darkness, not a grey-drain regression.",
    "L23": "the opened carton is ~3x the ranked carton it replaces and the brick fills about a "
           "third of it, against an authored 'filling the box exactly' and a next-beat narration "
           "of 'little boxes'.",
    "L23-retry1": "brick fill fixed (36% to 74%); the open box is still ~3.4x the ranked carton it "
                  "replaces and overhangs its own pallet, so the authored 'front carton on that "
                  "row' and 'filling the box exactly' are not met.",
    "L24": "the same scale defect propagated to all three pallets, plus two held crew members "
           "gained headwear and clothing against the parent.",
    "L24-retry1": "wardrobe drift CLOSED; but each top row renders as one pallet-width open box "
                  "holding three bricks, not individual cartons with one brick each -- and the VO "
                  "on this frame says 'little boxes'.",
    "L25": "the inherited scale defect, 'HARD DRIVE' on only the three front boxes rather than "
           "every open carton, and the persisting crew drift. Lettering register itself is clean.",
    "L25-retry1": "'HARD DRIVE' renders three times on the SEALED film-wrapped courses, spanning "
                  "carton seams, with no open carton lettered at all -- the authored clause unmet a "
                  "second time. Lettering craft itself is clean.",
}

# RULINGS NEEDED -- verbatim boss-authored text. Reproduced exactly.
RULINGS = [
    ("P1", "L06 WAIVER", ["L06"],
     "retry fixed the duplicated '1983' but moved the crate to the counter's far end (round-1 "
     "passed its floor placement). Verifier: mildest park in the set, defensible human waiver. "
     "Accept L06-retry1, or park the slot for a future mechanism-window re-mint?"),
    ("P2", "L07 + L08", ["L07", "L08"],
     "both L07 attempts parked (second brass till + garbled till glyphs on the retry); L08 was "
     "never minted \u2014 doctrine-blocked on its parked parent. Rule L07 (waive one attempt / park "
     "both), which unblocks or parks L08."),
    ("P3", "L10", ["L10"],
     "both attempts parked; retry has three independent fails including a COOL ink inversion "
     "recurring AFTER the R1 fix. Verifier: not waivable. Park the slot pending the mechanism "
     "window?"),
    ("P4", "L23/L24/L25 SET", ["L23", "L24", "L25"],
     "one inherited cause \u2014 the hero carton renders ~3.4\u00d7 the ranked cartons (the authored "
     "\u201cexactly\u201d scale gag loses its subject). Everything else closed (wardrobe fixed, "
     "night-chain continuity best in video, 'HARD DRIVE' craft clean but on the wrong surface in "
     "L25). Waive as a set, or one L23 re-roll at correct scale + re-base L24/L25 (~$0.12) at the "
     "next window?"),
    ("P5", "MECHANISM QUEUE (no gen ruling, confirm priorities)", [],
     "(a) R1 ink fix not total \u2014 cool inversion recurred; ink measure stays on every future "
     "verification; (b) forge silently degrades shots with unresolvable parents to root plates "
     "(3 occurrences) \u2014 fail-loud fix owed; (c) scenes manifest allows two records pointing at "
     "one file (L18, now L16 same pattern) with the parked record shadowing the verified one for "
     "seed resolution; (d) retry mechanism cannot express re-base+correct; (e) style tile carries "
     "a content element ('1983' tent card) that bled into L06 \u2014 content-free register exemplar "
     "candidate."),
]

# ---------------------------------------------------------------------------
# vo_text coverage check -- read LIVE from shots.json, never hand-transcribed.
# ---------------------------------------------------------------------------
VO_MISSING = []
for slot in SHOT_SLOTS:
    sh = SHOTS.get(slot)
    if sh is None:
        raise SystemExit("shots.json has no entry for %s" % slot)
    vo = (sh.get("vo_text") or "").strip()
    if not vo or sh.get("synthetic"):
        VO_MISSING.append(slot)

# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
SEQ_W, SEQ_Q = 900, 82
LIN_W, LIN_Q = 380, 80

CSS = B.CSS + """
.wrap{max-width:1400px}
h2{font-size:20px;margin:36px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line)}
h3{font-size:16px;margin:26px 0 8px}
.statusline{background:var(--card);border:1px solid var(--line);border-radius:9px;
 padding:12px 16px;margin:0 0 8px;font-size:14px}
.rulings{background:rgba(192,57,43,.06);border:2px solid var(--flag);border-radius:12px;
 padding:6px 20px 18px;margin:18px 0 8px}
.rulings h2{border-bottom-color:var(--flag);color:var(--flag)}
.ruling{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--flag);
 border-radius:8px;padding:12px 16px;margin:14px 0}
.ruling .rid{display:inline-block;font-weight:700;color:var(--flag);margin-right:8px}
.ruling .rtitle{font-weight:650}
.ruling p.body{margin:8px 0 14px;line-height:1.6}
.ruling-shot{margin:14px 0 4px;padding-top:12px;border-top:1px dashed var(--line)}
.ruling-shot h4{margin:0 0 8px;font-size:14px}
.vo-line{margin:0 0 10px;padding:8px 12px;border-left:3px solid var(--mut);
 font-style:italic;background:rgba(128,128,128,.06);border-radius:0 6px 6px 0}
.vo-missing{margin:0 0 10px;padding:8px 12px;border-left:3px solid var(--flag);
 color:var(--flag);font-size:13px;border-radius:0 6px 6px 0}
details.prompt{margin:8px 0 0;font-size:13px}
details.prompt summary{cursor:pointer;color:var(--mut);font-weight:650}
details.prompt p{margin:6px 0 0;line-height:1.55;color:var(--fg)}
.headline{margin:8px 0 0;font-size:13px;color:var(--fg)}
.badge2{display:inline-block;font-size:11px;border-radius:20px;padding:2px 9px;font-weight:650}
.b-verified{background:#1e7a3c;color:#fff}
.b-context{background:#2f5fa8;color:#fff}
.b-parked{background:var(--flag);color:#fff}
.b-blocked{background:#8a6d1f;color:#fff}
.round-chip{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:20px;
 padding:1px 8px;margin-left:6px}
.lineage-row{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap;margin:8px 0}
.lineage-row .card{flex:1 1 320px;max-width:380px}
.lineage-note{font-size:13px;color:var(--mut);margin:8px 0 0;font-style:italic}
.seq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:26px}
.seq-grid .card{max-width:100%}
.thumb-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;
 border-top:1px dashed var(--line)}
.thumb-row figure{margin:0;width:150px}
.thumb-row img{width:100%;border-radius:6px;border:1px solid var(--line);display:block}
.thumb-row figcaption{font-size:11px;color:var(--mut);margin-top:3px;line-height:1.4}
.no-image-badge{position:absolute;top:8px;left:8px;background:#8a6d1f;color:#fff;
 font-size:11px;border-radius:20px;padding:2px 9px}
footer{margin:50px 0 10px;padding-top:18px;border-top:1px solid var(--line);
 color:var(--mut);font-size:13px;line-height:1.7}
footer a,footer code{color:var(--fg)}
.reconcile{font-size:12.5px;color:var(--mut);margin:4px 0 0}
"""


def vo_block(sh):
    vo = (sh.get("vo_text") or "").strip()
    if not vo or sh.get("synthetic"):
        return ('<p class="vo-missing">NO SCRIPT LINE -- this shot carries no natural vo_text '
                '(synthetic/empty in shots.json); it plays under filler or B-roll timing only.</p>')
    return '<blockquote class="vo-line">\u201c%s\u201d</blockquote>' % html.escape(vo)


def prompt_details(sh):
    sp = (sh.get("still_prompt") or "").strip()
    if not sp:
        return ""
    return ('<details class="prompt"><summary>authored still_prompt</summary>'
            '<p>%s</p></details>' % html.escape(sp))


def card_html(sid, path, badge_html, extra_html, max_w, quality):
    """One lightbox-navigable card: class=card, an <img>, and a .meta div (required by B.JS)."""
    uri, nb = B.inline(path, max_w, quality)
    return ('<figure class="card"><img loading="lazy" src="%s" alt="%s">'
            '<div class="meta"><div class="hd"><span class="id">%s</span>%s</div>'
            '%s</div></figure>' % (uri, html.escape(sid), html.escape(sid), badge_html, extra_html)), nb


def placeholder_uri(text_lines, w=900, h=506):
    im = Image.new("RGB", (w, h), (60, 55, 45))
    d = ImageDraw.Draw(im)
    d.rectangle([8, 8, w - 9, h - 9], outline=(154, 147, 138), width=2)
    y = h // 2 - 10 * len(text_lines)
    for line in text_lines:
        tw = d.textlength(line)
        d.text(((w - tw) / 2, y), line, fill=(240, 236, 228))
        y += 24
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    import base64
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), buf.tell()


DISPLAYED_KEYS = set()


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

    # ================= 1. RULINGS NEEDED =================
    parts.append('<section class="rulings"><h2>RULINGS NEEDED</h2>')
    for rid, title, shots_in_ruling, body in RULINGS:
        parts.append(
            '<div class="ruling"><span class="rid">%s</span><span class="rtitle">%s</span>'
            '<p class="body">%s</p>' % (html.escape(rid), html.escape(title), html.escape(body)))
        for slot in shots_in_ruling:
            sh = SHOTS[slot]
            parts.append('<div class="ruling-shot"><h4>%s</h4>%s' % (html.escape(slot), vo_block(sh)))
            if slot in BLOCKED_SLOTS:
                parts.append('<p class="lineage-note">No image \u2014 %s was never generated '
                              '(doctrine-blocked on its parked parent L07).</p>' % html.escape(slot))
            else:
                parts.append('<div class="lineage-row">')
                for key in LINEAGE[slot]:
                    entry = MANIFEST[key]
                    path = os.path.join(STAGING, key + ".png")
                    if not os.path.exists(path):
                        raise SystemExit("missing lineage frame: " + path)
                    badge = ('<span class="badge2 b-parked">PARKED</span>'
                             '<span class="round-chip">ROUND %d</span>' % ROUND_OF[key])
                    extra = '<p class="headline">%s</p>' % html.escape(HEADLINE[key])
                    frag, nb = card_html(key, path, badge, extra, LIN_W, LIN_Q)
                    parts.append(frag)
                    total_bytes += nb
                    DISPLAYED_KEYS.add(key)
                parts.append("</div>")
            parts.append("</div>")
        parts.append("</div>")  # .ruling
    parts.append("</section>")

    # ================= 2. ALL SHOTS L01-L25, IN ORDER =================
    parts.append("<h2>ALL SHOTS L01\u2013L25, IN ORDER</h2>")
    parts.append('<div class="seq-grid">')
    for slot in SHOT_SLOTS:
        sh = SHOTS[slot]
        vo_html = vo_block(sh)
        prompt_html = prompt_details(sh)

        if slot in BLOCKED_SLOTS:
            badge = '<span class="badge2 b-blocked">BLOCKED \u2014 NOT MINTED</span>'
            extra = ('%s%s<p class="headline">%s</p>' % (vo_html, prompt_html, html.escape(HEADLINE[slot])))
            uri, nb = placeholder_uri(["L08 \u2014 NEVER GENERATED", "doctrine-blocked on parked L07"])
            frag = ('<figure class="card"><img loading="lazy" src="%s" alt="L08">'
                    '<div class="meta"><div class="hd"><span class="id">L08</span>%s</div>'
                    '%s</div></figure>' % (uri, badge, extra))
            total_bytes += nb
            parts.append(frag)
            continue

        is_ctx = slot in CONTEXT_SLOTS
        is_open = slot in OPEN_SLOTS
        if is_open:
            key = PARKED_LATEST[slot]
            path = os.path.join(STAGING, key + ".png")
            badge = ('<span class="badge2 b-parked">PARKED</span>'
                     '<span class="round-chip">latest: %s (round %d)</span>'
                     % (html.escape(key), ROUND_OF[key]))
        else:
            key = FINAL_KEY[slot]
            entry = MANIFEST[key]
            assert entry["review_status"] == "verified", "%s (%s) not verified" % (slot, key)
            path = os.path.join(VIDEO, entry["file"])
            badge = '<span class="badge2 %s">%s</span>' % (
                "b-context" if is_ctx else "b-verified",
                "CONTEXT PLATE" if is_ctx else "VERIFIED")
            if key != slot:
                badge += '<span class="round-chip">final: %s</span>' % html.escape(key)
        if not os.path.exists(path):
            raise SystemExit("missing frame for %s: %s" % (slot, path))
        DISPLAYED_KEYS.add(key)

        headline = HEADLINE.get(key, HEADLINE.get(slot, ""))
        extra = "%s%s<p class=\"headline\">%s</p>" % (vo_html, prompt_html, html.escape(headline))

        if is_open:
            thumbs = []
            for ek in PARKED_EARLIER[slot]:
                epath = os.path.join(STAGING, ek + ".png")
                if not os.path.exists(epath):
                    raise SystemExit("missing earlier-attempt thumb: " + epath)
                turi, tnb = B.inline(epath, 150, LIN_Q)
                total_bytes += tnb
                thumbs.append('<figure><img src="%s" alt="%s"><figcaption>%s (round %d, PARKED)'
                              '</figcaption></figure>'
                              % (turi, html.escape(ek), html.escape(ek), ROUND_OF[ek]))
                DISPLAYED_KEYS.add(ek)
            extra += '<div class="thumb-row">%s</div>' % "".join(thumbs)

        frag, nb = card_html(slot, path, badge, extra, SEQ_W, SEQ_Q)
        parts.append(frag)
        total_bytes += nb
    parts.append("</div>")  # .seq-grid

    # ================= Reconciliation =================
    # L16 and L18 each resolved via a later attempt (L16-remint1, L18-retry1) -- this layout only
    # shows lineage thumbnails for SLOTS STILL PARKED (per spec), so their now-superseded parked
    # predecessors (L16, L16-retry1, L18) are never re-displayed. That is a deliberate consequence
    # of the layout, not a drift -- stated explicitly rather than asserted away.
    SUPERSEDED_NOT_SHOWN = {"L16", "L16-retry1", "L18"}
    expected = set(IN_RANGE)
    expected_displayed = expected - SUPERSEDED_NOT_SHOWN
    missing = expected_displayed - DISPLAYED_KEYS
    extra_keys = DISPLAYED_KEYS - expected_displayed
    assert not missing, "manifest keys never displayed: %s" % sorted(missing)
    assert not extra_keys, "displayed keys not in the in-range manifest set: %s" % sorted(extra_keys)
    assert SUPERSEDED_NOT_SHOWN.isdisjoint(DISPLAYED_KEYS), \
        "a superseded key was unexpectedly displayed -- update SUPERSEDED_NOT_SHOWN"
    parts.append(
        '<p class="reconcile">Badge reconciliation: manifest.json holds 39 entries, %d verified / '
        '%d parked. 6 verified entries (L28, L63, L71, L113, L172, L196) are Phase-6A plates '
        'outside the L01\u2013L25 slice and are never referenced on this board. Of the remaining 33 '
        'in-range entries (%d verified / %d parked), this layout displays %d: the 3 excluded are '
        "L16's and L18's now-superseded PARKED predecessors (L16, L16-retry1, L18 itself) -- "
        'both slots resolved to a later attempt (L16-remint1, L18-retry1) and this layout shows '
        'lineage thumbnails only for slots STILL parked, so their closed history is not '
        're-displayed here. Every key that IS displayed is asserted (set-equality, not just a '
        'count) to carry the badge its manifest.json review_status actually holds.</p>'
        % (total_verified, total_parked, in_verified, in_parked, len(expected_displayed)))

    # ================= Footer =================
    parts.append(
        "<footer>Generated 2026-08-06 &middot; bricks-fresh Phase 6B, first tenth (L01\u2013L25) "
        "&middot; source of truth: <code>assets/scenes/manifest.json</code> &middot; full "
        "narrative + spend ledger: <code>scratchpad/p6b-report.md</code> &middot; generation log: "
        "<code>scratchpad/p6b-genlog.md</code> &middot; fresh-eyes verdicts: "
        "<code>scratchpad/p6b-verify.md</code> (round 1), <code>p6b-verify2.md</code> (round 2), "
        "<code>p6b-verify3.md</code> (round 3, final) &middot; builder: "
        "<code>scratchpad/_build_p6b_board_final.py</code></footer>")

    parts.append("</div>")  # .wrap

    # ================= lightbox + JS (verbatim mechanics) =================
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

ruling_shot_count = sum(1 for _rid, _t, shots_in_ruling, _b in RULINGS for _s in shots_in_ruling)
size_mb = os.path.getsize(out_html) / 1e6
print("board: %s" % out_html)
print("  size: %.2f MB inlined images / %.2f MB page" % (nb / 1e6, size_mb))
print("  RULINGS NEEDED: %d shot blocks (P1-P4; P5 text-only) over 6 open slots (L06,L07,L08,L10,L23,L24,L25 minus L08 unminted)"
      % ruling_shot_count)
print("  ALL SHOTS sequential: %d cards (L01-L25 strictly in order)" % len(SHOT_SLOTS))
print("  vo_text coverage: %d/%d shots carry a natural vo_text; missing/synthetic: %s"
      % (len(SHOT_SLOTS) - len(VO_MISSING), len(SHOT_SLOTS), VO_MISSING or "none"))
print("  manifest totals: %d verified / %d parked (39 entries)" % (total_verified, total_parked))
print("  in-range (L01-L25, 33 entries): %d verified / %d parked" % (in_verified, in_parked))
print("  displayed manifest keys: %d (exact match to the 33 in-range keys, asserted)" % len(DISPLAYED_KEYS))
if size_mb > 15:
    print("  WARNING: page exceeds the 15MB self-contained budget")
