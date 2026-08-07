"""Build the 6c2 gate board for bricks-fresh (second tenth, L26-L50).

Pattern: `_build_p6b_board_final.py` (the previous slice's builder, layout ratified by Daniel --
"keep this layout for future board updates"). Same shape: RULINGS NEEDED on top, then ALL SHOTS
strictly sequential, each with its full vo_text (read LIVE from shots.json), best frame, status
badge, collapsible still_prompt. Adapted for 6c2 (L26-L50).

Nothing is stamped and nothing is generated here. vo_text/still_prompt are read LIVE from
shots.json every run -- never hand-transcribed. Status/frames are read LIVE from
assets/scenes/manifest.json -- the single writer is the STAGE-4 promotion pass in this worker's
genlog; this script writes nothing to it.
"""
import io, json, os, re, sys, html, base64
from PIL import Image, ImageDraw

ORG = r"C:\Users\danie\kb\orgs\faceless-youtube"
SCRIPTS = os.path.join(ORG, r".claude\skills\image-generation\scripts")
sys.path.insert(0, SCRIPTS)
import build_review_artifact as B  # noqa: E402  (reused: inline() image->data-URI encoder, CSS/JS)

VIDEO = os.path.join(ORG, r"channels\the-second-take\videos\2026-07-28-bricks-fresh")
SCENES = os.path.join(VIDEO, "assets", "scenes")
SCRATCH = os.path.join(VIDEO, "scratchpad")
STAGING = os.path.join(ORG, r"channels\the-second-take\visual-kit\_staging")

MANIFEST = {e["shot_id"]: e for e in json.load(
    io.open(os.path.join(SCENES, "manifest.json"), encoding="utf-8"))["shots"]}
SHOTS = {s["id"]: s for s in json.load(
    io.open(os.path.join(VIDEO, "shots.json"), encoding="utf-8"))["long_form"]["shots"]}

SHOT_SLOTS = ["L%02d" % n for n in range(26, 51)]

assert len(MANIFEST) == 25, "manifest holds %d entries, expected 25 (L26-L50)" % len(MANIFEST)
verified = {sid: e for sid, e in MANIFEST.items() if e["review_status"] == "verified"}
parked = {sid: e for sid, e in MANIFEST.items() if e["review_status"] == "parked"}
unreviewed = {sid: e for sid, e in MANIFEST.items() if e["review_status"] == "unreviewed"}
assert len(verified) == 23 and len(parked) == 2 and len(unreviewed) == 0, \
    "expected 23 verified / 2 parked / 0 unreviewed, got %d/%d/%d" % (
        len(verified), len(parked), len(unreviewed))
assert set(parked) == {"L34", "L39"}, "expected exactly L34/L39 parked, got %s" % sorted(parked)

# ---------------------------------------------------------------------------
# Retried shots -- one-line "r1 defect -> fix" note, sourced verbatim from manifest.json's own
# `retry_cause` field (the promotion pass's own record, not re-authored here).
# ---------------------------------------------------------------------------
RETRIED = {sid: e["retry_cause"] for sid, e in MANIFEST.items() if e.get("retry_cause")}

# Parked-shot candidate PNG filename in visual-kit/_staging/ -- parsed live out of the manifest's
# own `notes` field ("candidate at visual-kit/_staging/<file>"), never hand-copied.
_CANDIDATE_RE = re.compile(r"candidate at visual-kit/_staging/(\S+\.png)")


def candidate_file(entry):
    m = _CANDIDATE_RE.search(entry.get("notes") or "")
    if not m:
        raise SystemExit("no candidate file parsed from parked notes: %r" % entry.get("notes"))
    return m.group(1)


# Diagnosed-next-move text for a parked shot -- parsed live out of the manifest's own `notes`
# field ("Diagnosed next move: ..." sentence), never hand-authored here.
_NEXTMOVE_RE = re.compile(r"Diagnosed next move:\s*(.*)", re.S)


def next_move_text(entry):
    m = _NEXTMOVE_RE.search(entry.get("notes") or "")
    return (m.group(1).strip() if m else (entry.get("notes") or "")).strip()

# ---------------------------------------------------------------------------
# RULINGS NEEDED -- 5 items, boss-authored text (verbatim from the dispatch brief).
# ---------------------------------------------------------------------------
RULINGS = [
    ("R-A", "L28 NEUTRAL-INK SEED",
     "Children track the seed's ink, not prose or cards -- measured R\u2212B: seed +3.0; children "
     "+1.1\u2026+2.1 after an explicitly-warm retry clause, versus warm-passing cards elsewhere in "
     "the batch at +19\u2026+42. Options: (1) accept the act's cool-neutral interior tone as "
     "authored mood, or (2) re-mint L28 warm and re-seed its 5 children (~$0.23 + "
     "re-verification, invalidates 5 passing frames)."),
    ("R-B", "TERRY-JOHNSON BROW AUTHORITY",
     "The canonical reference sheet draws pale blond brows; the STEP-1 card draws dark brown. L30 "
     "obeyed the card, L31 obeyed the canonical -- both individually passed, so the face flickers "
     "between two adjacent frames across a hard cut. Which source is authority going forward?"),
    ("R-C", "DELTA MECHANISM HOLDS PLACE, NOT FACE",
     "Across all 3 parent/child comparisons available in this slice (L28\u2192L29 place seed, "
     "L30\u2192L31 chain, L33\u2192L34 chain), environment/palette/props held tightly (1.48-3.67% "
     "px changed, confined to the authored addition plus outline jitter) while figures were "
     "re-drawn unauthored in every single case: L31 moved terry-johnson's eyeline and brow colour "
     "(inside the <=2 delta cap); L34's original mint re-drew both ibm-suit and miniscribe-rep "
     "from scratch (3 changes, over the cap). Mechanism question for the next doctrine window -- "
     "proposal: pin figure crops from the parent at delta-mint time, or keep accepting-and-"
     "verifying each delta by eye."),
    ("R-D", "ACT SATURATION SPLIT",
     "Factory-interior frames measure median_sat 0.043-0.133; the bank office (L49/L50) measures "
     "0.62-0.66; the era prior is ~0.19. Every frame is individually compliant with its own "
     "authored palette, but the act as a body will read flat-then-loud rather than one continuous "
     "colour world. Act-level colour-budget ruling wanted, not a per-frame fix."),
    ("R-E", "L33 DOOR-STATE SPEC CONFLICT",
     "L33's own prose says the roller door is 'up on grey daylight'; its L28 seed draws the door "
     "shut. The generator obeyed the seed over the prose (the frame otherwise passed). Ruling: "
     "accept seed authority as the standing rule for prose-vs-seed conflicts, or re-author the "
     "affected prose to match what seeds actually carry?"),
]

# Which shot(s)/frames each ruling shows, and any small data table.
RULING_SHOTS = {
    "R-A": ["L28", "L44", "L46", "L36"],
    "R-B": ["L30", "L31"],
    "R-C": [],  # mechanism-only, cites R-C's own numbers, no fresh images beyond R-B's L30/L31
    "R-D": ["L32", "L44", "L49", "L50"],
    "R-E": ["L33"],
}
# Keyed by (ruling id, shot id): the same shot can appear in two rulings with
# different evidence text (L44 is R-A's ink no-op AND R-D's saturation example).
RULING_CAPTION = {
    ("R-A", "L28"): "place seed -- ink R\u2212B +3.0 (neutral, not warm)",
    ("R-A", "L44"): "L28 child, warm-ink retry clause applied -- R\u2212B +1.1 (no-op)",
    ("R-A", "L46"): "L28 child, warm-ink retry clause applied -- R\u2212B +2.1 (no-op)",
    ("R-A", "L36"): "NOT an L28 child -- warm-passing comparison, R\u2212B +30.0",
    ("R-B", "L30"): "obeys the STEP-1 card: dark brown brows",
    ("R-B", "L31"): "obeys the canonical ref sheet: pale blond brows",
    ("R-D", "L32"): "factory interior, median_sat 0.043 (lowest in the slice)",
    ("R-D", "L44"): "factory interior, median_sat 0.13 (top of the interior band)",
    ("R-D", "L49"): "bank office, median_sat 0.64",
    ("R-D", "L50"): "bank office, median_sat 0.66",
    ("R-E", "L33"): "door drawn SHUT (seed L28) though L33's own prose says 'up on grey daylight'",
}

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
SEQ_W, SEQ_Q = 900, 80
RUL_W, RUL_Q = 520, 80

CSS = B.CSS + """
.wrap{max-width:1400px}
h2{font-size:20px;margin:36px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line)}
.statusline{background:var(--card);border:1px solid var(--line);border-radius:9px;
 padding:12px 16px;margin:0 0 8px;font-size:14px;line-height:1.6}
.rulings{background:rgba(192,57,43,.06);border:2px solid var(--flag);border-radius:12px;
 padding:6px 20px 18px;margin:18px 0 8px}
.rulings h2{border-bottom-color:var(--flag);color:var(--flag)}
.ruling{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--flag);
 border-radius:8px;padding:12px 16px;margin:14px 0}
.ruling .rid{display:inline-block;font-weight:700;color:var(--flag);margin-right:8px}
.ruling .rtitle{font-weight:650}
.ruling p.body{margin:8px 0 14px;line-height:1.6}
.lineage-row{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap;margin:8px 0}
.lineage-row .card{flex:1 1 260px;max-width:300px}
.vo-line{margin:0 0 10px;padding:8px 12px;border-left:3px solid var(--mut);
 font-style:italic;background:rgba(128,128,128,.06);border-radius:0 6px 6px 0}
details.prompt{margin:8px 0 0;font-size:13px}
details.prompt summary{cursor:pointer;color:var(--mut);font-weight:650}
details.prompt p{margin:6px 0 0;line-height:1.55;color:var(--fg)}
.retrynote{margin:8px 0 0;padding:8px 12px;border-left:3px solid #2f9e44;font-size:12.5px;
 line-height:1.55;background:rgba(47,158,68,.07);border-radius:0 6px 6px 0}
.badge2{display:inline-block;font-size:11px;border-radius:20px;padding:2px 9px;font-weight:650}
.b-verified{background:#1e7a3c;color:#fff}
.b-parked{background:#c0392b;color:#fff}
.parkednote{margin:8px 0 0;padding:8px 12px;border-left:3px solid #c0392b;font-size:12.5px;
 line-height:1.55;background:rgba(192,57,43,.07);border-radius:0 6px 6px 0}
.parkednote .pk-title{margin:0 0 4px;font-weight:700;color:#c0392b;font-size:11px;
 letter-spacing:.03em;text-transform:uppercase}
.parkednote ul{margin:0 0 8px 18px;padding:0}
.parkednote li{margin:0 0 3px}
.parkednote p.pk-next{margin:0}
.seq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:26px}
.seq-grid .card{max-width:100%}
.cap{font-size:12px;color:var(--mut);margin-top:4px;font-style:italic}
footer{margin:50px 0 10px;padding-top:18px;border-top:1px solid var(--line);
 color:var(--mut);font-size:13px;line-height:1.7}
footer a,footer code{color:var(--fg)}
.reconcile{font-size:12.5px;color:var(--mut);margin:4px 0 0}
"""


def vo_block(sh):
    vo = (sh.get("vo_text") or "").strip()
    if not vo or sh.get("synthetic"):
        return ('<p class="vo-missing">NO SCRIPT LINE -- this shot carries no natural vo_text '
                '(synthetic/empty in shots.json).</p>')
    return '<blockquote class="vo-line">\u201c%s\u201d</blockquote>' % html.escape(vo)


def prompt_details(sh):
    sp = (sh.get("still_prompt") or "").strip()
    if not sp:
        return ""
    return ('<details class="prompt"><summary>authored still_prompt</summary>'
            '<p>%s</p></details>' % html.escape(sp))


def parked_note_html(entry):
    reasons = entry.get("parked_reasons") or []
    reasons_html = "".join("<li>%s</li>" % html.escape(r) for r in reasons)
    return ('<div class="parkednote"><p class="pk-title">Fail cause</p><ul>%s</ul>'
            '<p class="pk-title">Diagnosed next move</p><p class="pk-next">%s</p></div>'
            % (reasons_html, html.escape(next_move_text(entry))))


def card_html(sid, path, badge_html, extra_html, max_w, quality, caption=None):
    uri, nb = B.inline(path, max_w, quality)
    cap = ('<p class="cap">%s</p>' % html.escape(caption)) if caption else ""
    return ('<figure class="card"><img loading="lazy" src="%s" alt="%s">'
            '<div class="meta"><div class="hd"><span class="id">%s</span>%s</div>'
            '%s%s</div></figure>' % (uri, html.escape(sid), html.escape(sid), badge_html,
                                      extra_html, cap)), nb


def placeholder_uri(text_lines, w=900, h=506):
    im = Image.new("RGB", (w, h), (60, 55, 45))
    d = ImageDraw.Draw(im)
    d.rectangle([8, 8, w - 9, h - 9], outline=(154, 147, 138), width=2)
    y = h // 2 - 11 * len(text_lines)
    for line in text_lines:
        tw = d.textlength(line)
        d.text(((w - tw) / 2, y), line, fill=(240, 236, 228))
        y += 22
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), buf.tell()


def wrap_lines(text, width=52):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


DISPLAYED_KEYS = set()


def build():
    total_bytes = 0
    parts = []

    parts.append("<title>bricks-fresh \u2014 6c2 gate board (second tenth, L26\u2013L50)</title>")
    parts.append("<style>%s</style>" % CSS)
    parts.append('<div class="wrap">')
    parts.append("<h1>bricks-fresh \u2014 6c2 gate board (second tenth, L26\u2013L50)</h1>")
    parts.append(
        '<p class="statusline">23/25 verified &amp; promoted &middot; 2 parked with mechanism '
        'diagnoses &middot; machine tier closed &middot; spend $2.301/$5.00</p>')

    # ================= 1. RULINGS NEEDED =================
    parts.append('<section class="rulings"><h2>NEEDS YOUR RULING</h2>')
    for rid, title, body in RULINGS:
        parts.append(
            '<div class="ruling"><span class="rid">%s</span><span class="rtitle">%s</span>'
            '<p class="body">%s</p>' % (html.escape(rid), html.escape(title), html.escape(body)))
        shots_for_ruling = RULING_SHOTS[rid]
        if shots_for_ruling:
            parts.append('<div class="lineage-row">')
            for sid in shots_for_ruling:
                entry = MANIFEST[sid]
                assert entry["review_status"] == "verified", "%s not verified, cannot show in %s" % (sid, rid)
                path = os.path.join(VIDEO, entry["file"])
                if not os.path.exists(path):
                    raise SystemExit("missing ruling frame: " + path)
                badge = '<span class="badge2 b-verified">VERIFIED</span>'
                frag, nb = card_html(sid, path, badge, "", RUL_W, RUL_Q, RULING_CAPTION.get((rid, sid)))
                parts.append(frag)
                total_bytes += nb
                DISPLAYED_KEYS.add(sid)
            parts.append("</div>")
        parts.append("</div>")  # .ruling
    parts.append("</section>")

    # ================= 2. ALL SHOTS L26-L50, IN ORDER =================
    parts.append("<h2>ALL SHOTS L26\u2013L50, IN ORDER</h2>")
    parts.append('<div class="seq-grid">')
    for slot in SHOT_SLOTS:
        sh = SHOTS[slot]
        vo_html = vo_block(sh)
        prompt_html = prompt_details(sh)
        entry = MANIFEST[slot]

        retry_html = ""
        if slot in RETRIED:
            retry_html = '<p class="retrynote">r1 defect \u2192 fix: %s</p>' % html.escape(RETRIED[slot])

        if slot in parked:
            badge = '<span class="badge2 b-parked">PARKED</span>'
            cand_path = os.path.join(STAGING, candidate_file(entry))
            if not os.path.exists(cand_path):
                raise SystemExit("missing parked candidate frame for %s: %s" % (slot, cand_path))
            extra = "%s%s%s" % (vo_html, prompt_html, parked_note_html(entry))
            frag, nb = card_html(slot, cand_path, badge, extra, SEQ_W, SEQ_Q,
                                  caption="PARKED candidate -- not promoted, staging file untouched")
            DISPLAYED_KEYS.add(slot)
            total_bytes += nb
            parts.append(frag)
            continue

        assert entry["review_status"] == "verified", "%s not verified in manifest" % slot
        path = os.path.join(VIDEO, entry["file"])
        if not os.path.exists(path):
            raise SystemExit("missing frame for %s: %s" % (slot, path))
        DISPLAYED_KEYS.add(slot)
        badge = '<span class="badge2 b-verified">VERIFIED</span>'
        extra = "%s%s%s" % (vo_html, prompt_html, retry_html)
        frag, nb = card_html(slot, path, badge, extra, SEQ_W, SEQ_Q)
        parts.append(frag)
        total_bytes += nb
    parts.append("</div>")  # .seq-grid

    # ================= Reconciliation =================
    expected_displayed = set(verified) | set(parked)
    missing = expected_displayed - DISPLAYED_KEYS
    assert not missing, "manifest keys never displayed: %s" % sorted(missing)
    parts.append(
        '<p class="reconcile">Badge reconciliation: manifest.json holds 25 entries for L26\u2013L50, '
        '23 verified / 2 parked (L34, L39 -- mechanism-diagnosed fails, not transport failures; '
        'machine tier closed, 0 unreviewed). Every verified key on this board is asserted (not '
        'just counted) to carry the badge its manifest.json review_status actually holds; ruling '
        'frames are the same promoted assets/scenes/*.png files shown again in the sequential '
        'section below, never a separate copy. Parked cards show the visual-kit/_staging/ '
        'candidate frame named in the manifest\u2019s own notes -- never promoted, never moved.</p>')

    # ================= Footer =================
    parts.append(
        "<footer>Generated 2026-08-07 &middot; bricks-fresh Phase 6c, second tenth (L26\u2013L50) "
        "&middot; source of truth: <code>assets/scenes/manifest.json</code> &middot; generation "
        "log: <code>scratchpad/6c2-genlog.md</code> &middot; fresh-eyes verdicts: "
        "<code>scratchpad/6c2-w2verify-a.json</code> (round 1, L26-L37), "
        "<code>6c2-w2verify-b.json</code> (round 1, L39-L50), "
        "<code>6c2-w2verify-r1.json</code> (retry round 1), "
        "<code>6c2-w2verify-r2.json</code> (retry round 2, final -- L34/L38/L39-fix/L45-fix) "
        "&middot; builder: <code>scratchpad/_build_6c2_board.py</code></footer>")

    parts.append("</div>")  # .wrap

    # ================= lightbox + JS (verbatim mechanics, Daniel's standing rule) =================
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
out_html = os.path.join(SCRATCH, "6c2-board.html")
io.open(out_html, "w", encoding="utf-8").write(page)

size_mb = os.path.getsize(out_html) / 1e6
ruling_frame_count = sum(len(v) for v in RULING_SHOTS.values())
print("board: %s" % out_html)
print("  size: %.2f MB inlined images / %.2f MB page" % (nb / 1e6, size_mb))
print("  NEEDS YOUR RULING: %d items (R-A..R-E), %d frames embedded across them"
      % (len(RULINGS), ruling_frame_count))
print("  ALL SHOTS sequential: %d cards (L26-L50 strictly in order)" % len(SHOT_SLOTS))
print("  vo_text coverage: %d/%d shots carry a natural vo_text; missing/synthetic: %s"
      % (len(SHOT_SLOTS) - len(VO_MISSING), len(SHOT_SLOTS), VO_MISSING or "none"))
print("  manifest: %d verified / %d parked / %d unreviewed (25 entries)"
      % (len(verified), len(parked), len(unreviewed)))
print("  retried shots with r1-defect-to-fix notes: %d (%s)" % (len(RETRIED), sorted(RETRIED)))
print("  displayed verified frames: %d (exact match to the 23 verified keys, asserted)" % len(DISPLAYED_KEYS & set(verified)))
print("  displayed parked frames: %d (exact match to the 2 parked keys, asserted): %s"
      % (len(DISPLAYED_KEYS & set(parked)), sorted(parked)))
if size_mb > 14:
    print("  WARNING: page exceeds the 14MB self-contained budget")
