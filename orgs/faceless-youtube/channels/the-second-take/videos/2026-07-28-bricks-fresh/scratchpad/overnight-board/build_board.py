#!/usr/bin/env python3
"""Build the overnight-run review board for 2026-07-28-bricks-fresh.

One self-contained board.html covering the whole overnight run:
  1. header summary
  2. scene tenth L01-L25 (what Daniel most wants to see)
  3. Wave-2 figure cards, grouped by character
  4. findings for rulings (text)

Lightbox/theme pattern adapted from ../w2-r2/build_duel_board.py
(click-to-fullscreen, </> or arrow-key nav while zoomed, Esc, explicit colors).

Data sources (read-only):
  assets/_review/merged.json           - scene-tenth per-shot verdicts (L01-L25 range)
  scratchpad/scenes-t1/progress-w{A,B,C}.md - parked/blocked reasons for shots with no image
  visual-kit/_staging/*.png            - actual Wave-2 figure card files on disk
  visual-kit/_staging/review.json      - figures verdict map (authoritative where present)
  scratchpad/w2-full/remaining.json    - batch status snapshot (fallback + deferred list)
"""
import base64
import html
import io
import json
import os
import unicodedata
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parents[1]          # .../videos/2026-07-28-bricks-fresh
CHANNEL = VIDEO.parents[1]       # .../channels/the-second-take
KIT = CHANNEL / "visual-kit"
STAGING = KIT / "_staging"
SCENES = VIDEO / "assets" / "scenes"

OUT = HERE / "board.html"
MAX_BYTES = 16 * 1024 * 1024

SCENE_EDGE = 640
FIG_EDGE = 384
JPEG_Q = 70

SCENE_ORDER = [f"L{n:02d}" for n in range(1, 26)]


def ascii_text(value):
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    return value.replace("--", "-")


def jpeg_uri(path, max_edge, quality=JPEG_Q):
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        if max(image.size) > max_edge:
            ratio = max_edge / max(image.size)
            image = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")


# ---------------------------------------------------------------------------
# Section 2: scene tenth L01-L25
# ---------------------------------------------------------------------------

def load_scene_tenth():
    merged = json.loads((VIDEO / "assets" / "_review" / "merged.json").read_text(encoding="utf-8"))
    by_id = {entry["id"]: entry for entry in merged}

    blockers = {}
    for tag in ("wA", "wB", "wC"):
        path = VIDEO / "scratchpad" / "scenes-t1" / f"progress-{tag}.md"
        if path.is_file():
            blockers[tag] = path.read_text(encoding="utf-8", errors="ignore")

    rows = []
    for sid in SCENE_ORDER:
        img_path = SCENES / f"{sid}.png"
        entry = by_id.get(sid)
        if img_path.is_file() and entry is not None:
            worst = entry.get("worst", "clean")
            verified = worst == "clean"
            rows.append({
                "id": sid, "kind": "image", "verified": verified,
                "img": img_path, "why": entry.get("why", ""),
                "axes": {k: entry[k] for k in ("r", "f", "s") if k in entry},
                "worst": worst,
            })
        else:
            reason = ""
            if sid in ("L16", "L17"):
                reason = ("PARKED before any generation, $0 spend. L16's still_prompt names a 'rival' "
                          "personified computer with no Wave-1 canonical, and separately names pose "
                          "primitive action-powerstance on pc-boxy (a no-hands rig) -- pc-boxy's own "
                          "registry note bans seeding a human-torso pose frame onto it. L17 is stage_role: "
                          "delta of L16 and parks with its base per the one-retry/base-blocks-delta rule. "
                          "Needs a VPW re-author (new canonical + handless-compatible action) before any spend.")
            elif sid == "L22":
                reason = ("Blocked on its STEP-1 figure card fig-brick-foreman--back-to-viewer--7a3b93be: "
                          "rig FAIL (ear-shaped notch cut into hair, both sides), recorded in "
                          "visual-kit/_staging/review.json. Forge correctly refused to reuse a stale FAILED "
                          "review record for a different context digest and scheduled a fresh STEP-1 mint, "
                          "but that mint did not land clean before the provider limit -- needs a re-mint.")
            rows.append({"id": sid, "kind": "blocked", "verified": False, "reason": reason})
    return rows


def scene_card(row):
    if row["kind"] == "image":
        badge = "verified" if row["verified"] else "parked"
        badge_label = "VERIFIED" if row["verified"] else "PARKED"
        axes_txt = ", ".join(f"{k}:{v}" for k, v in row.get("axes", {}).items())
        detail = f"worst={row['worst']}" + (f" ({axes_txt})" if axes_txt else "")
        alt = ascii_text(f"{row['id']} {badge_label}: {row['why']}")
        return f'''<article class="scard {badge}">
  <div class="image-frame"><img class="board-image" src="{jpeg_uri(row['img'], SCENE_EDGE)}" alt="{html.escape(alt, quote=True)}" loading="lazy"><span class="stamp">{badge_label}</span></div>
  <header><strong>{html.escape(row['id'])}</strong><span class="tag {badge}">{badge_label}</span></header>
  <p class="detail">{html.escape(ascii_text(detail))}</p>
  <p class="why">{html.escape(ascii_text(row['why']))}</p>
  <p class="path">full res: assets/scenes/{html.escape(row['id'])}.png</p>
</article>'''
    else:
        alt = ascii_text(f"{row['id']} BLOCKED: {row['reason']}")
        return f'''<article class="scard blocked">
  <div class="no-image"><span class="stamp">NO IMAGE</span><strong>{html.escape(row['id'])}</strong></div>
  <header><strong>{html.escape(row['id'])}</strong><span class="tag blocked">PARKED - NO GEN</span></header>
  <p class="why">{html.escape(ascii_text(row['reason']))}</p>
</article>'''


# ---------------------------------------------------------------------------
# Section 3: Wave-2 figure cards
# ---------------------------------------------------------------------------

def parse_char(fig_stem):
    # fig_stem like "fig-<character>--<rest...>"
    body = fig_stem[len("fig-"):] if fig_stem.startswith("fig-") else fig_stem
    return body.split("--", 1)[0]


def load_figure_cards():
    review = json.loads((STAGING / "review.json").read_text(encoding="utf-8")).get("figures", {})
    remaining_path = VIDEO / "scratchpad" / "w2-full" / "remaining.json"
    remaining_items = {}
    if remaining_path.is_file():
        remaining_items = json.loads(remaining_path.read_text(encoding="utf-8")).get("items", {})

    all_files = sorted(os.listdir(STAGING))
    plain_cards = [f for f in all_files if f.startswith("fig-") and f.endswith(".png")]
    flagged_rejected = [f for f in all_files
                         if f.startswith(("_staging_flagged_", "_staging_rejected_")) and f.endswith(".png")]

    by_char = defaultdict(list)
    covered_stems = set()

    for f in plain_cards:
        stem = f[:-4]
        covered_stems.add(stem)
        key = f"_staging/{f}"
        rev = review.get(key)
        rem = remaining_items.get(stem)
        if rev is not None:
            verdicts = rev.get("verdicts", {})
            allpass = bool(verdicts) and all(v == "pass" for v in verdicts.values())
            badge = "verified" if allpass else "parked"
            tags = [] if allpass else [k for k, v in verdicts.items() if v == "fail"]
            source = "review.json"
        elif rem is not None and rem.get("status") == "done_verified":
            badge, tags, source = "verified", [], "remaining.json (done_verified)"
        elif rem is not None and rem.get("status") == "parked":
            badge = "parked"
            tags = rem.get("failed_invariants", []) or ["parked"]
            source = "remaining.json (parked)"
        else:
            badge, tags, source = "unreviewed", [], "no verdict record found"
        by_char[parse_char(stem)].append({
            "file": f, "path": STAGING / f, "badge": badge, "tags": tags, "source": source, "note": rem.get("note") if rem else "",
        })

    for f in flagged_rejected:
        base = f
        for prefix in ("_staging_flagged_", "_staging_rejected_"):
            if base.startswith(prefix):
                base = base[len(prefix):]
        stem = base[:-4]
        covered_stems.add(stem)
        key = f"_staging/{f}"
        rev = review.get(key)
        if rev is not None:
            tags = [k for k, v in rev.get("verdicts", {}).items() if v == "fail"] or ["fail"]
            source = "review.json"
        else:
            tags = ["rejected candidate, no formal verdict record on this filename"]
            source = "filename only (see remaining.json / progress logs)"
        kind = "flagged" if f.startswith("_staging_flagged_") else "rejected"
        by_char[parse_char(stem)].append({
            "file": f, "path": STAGING / f, "badge": "parked", "tags": tags, "source": source,
            "note": f"{kind} candidate frame kept for defect reference; not the current staged card",
        })

    deferred_by_char = defaultdict(list)
    for stem, rem in remaining_items.items():
        if stem in covered_stems:
            continue
        status = rem.get("status")
        if status in ("not_yet_attempted", "generation_failed_needs_regen"):
            deferred_by_char[parse_char(stem)].append({"stem": stem, "status": status, "note": rem.get("note", "")})

    return by_char, deferred_by_char


def figure_card(item):
    badge = item["badge"]
    label = badge.upper()
    chips = "".join(f'<span class="chip">{html.escape(ascii_text(t))}</span>' for t in item["tags"])
    alt = ascii_text(f"{item['file']} {label}: {', '.join(item['tags']) or 'clean'}")
    note = item.get("note") or ""
    return f'''<figure class="fcard {badge}">
  <div class="image-frame"><img class="board-image" src="{jpeg_uri(item['path'], FIG_EDGE)}" alt="{html.escape(alt, quote=True)}" loading="lazy"><span class="stamp">{label}</span></div>
  <figcaption><strong>{html.escape(ascii_text(item['file']))}</strong>
  <div class="chips">{chips}</div>
  {f'<p class="note">{html.escape(ascii_text(note))}</p>' if note else ''}
  <p class="src">source: {html.escape(ascii_text(item['source']))}</p></figcaption>
</figure>'''


def char_section(char, cards, deferred):
    v = sum(1 for c in cards if c["badge"] == "verified")
    p = sum(1 for c in cards if c["badge"] == "parked")
    u = sum(1 for c in cards if c["badge"] == "unreviewed")
    d = len(deferred)
    cards_sorted = sorted(cards, key=lambda c: (c["badge"] != "parked", c["file"]))
    cards_html = "".join(figure_card(c) for c in cards_sorted)
    deferred_html = ""
    if deferred:
        items_html = "".join(
            f'<li><strong>{html.escape(ascii_text(x["stem"]))}</strong> - {html.escape(ascii_text(x["status"]))}'
            f'{": " + html.escape(ascii_text(x["note"])) if x["note"] else ""}</li>'
            for x in sorted(deferred, key=lambda x: x["stem"])
        )
        deferred_html = f'''<div class="deferred-block"><strong>{d} deferred (no image exists)</strong>
        <p class="muted">Blocked behind unreviewed Pass-2 place plates for this character; not yet minted.</p>
        <ul>{items_html}</ul></div>'''
    return f'''<section class="charsec">
  <header><h2>{html.escape(ascii_text(char))}</h2>
    <span class="counts">{v} verified / {p} parked{f' / {u} unreviewed' if u else ''}{f' / {d} deferred' if d else ''}</span>
  </header>
  <div class="cardgrid">{cards_html}</div>
  {deferred_html}
</section>'''


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

FINDINGS = [
    ("a", "Wave-1 base pose primitive hands (action-recoil / surrender)",
     "The shared Wave-1 base pose primitives action-recoil and surrender render 5-digit hands on the "
     "generated figure. Intermittent but repeated: 5 parked cards across runs this session carry this "
     "exact defect (e.g. fig-miniscribe-rep--action-recoil x2, fig-brick-foreman--action-recoil, "
     "fig-brick-foreman--surrender, plus one more from an earlier wave). It recurs across different "
     "characters sharing the same base primitive, which points at the primitive itself, not a per-card "
     "fluke. Needs a Wave-1 asset re-mint ruling before more cards are spent against these two poses."),
    ("b", "Grip-pose prop leak vs clean_card retry",
     "Grip/hold poses leak the held prop's shape into the base pose reference (a forge-side clean_card "
     "defect). The clean_card retry mechanism works -- it removes the leaked prop -- but it also softens "
     "the pose itself toward a neutral stance, losing some of the authored gesture. This is currently "
     "being accepted as a trade (clean card over dirty pose) and recurs on 4 poses this session."),
    ("c", "L16 authoring gap: personified computer with a hand-rig pose",
     "L16's still_prompt names a 'rival' personified computer with no Wave-1 canonical asset at all, and "
     "separately calls for pose primitive action-powerstance on pc-boxy -- a no-hands rig whose own "
     "registry note explicitly bans seeding a human-torso pose frame onto it. Two independent authoring "
     "defects on one shot. Needs a shots.json re-author (new canonical + a handless-compatible action) "
     "before this shot can be attempted again; L17 (its delta) is blocked behind it."),
    ("d", "L14: same class of issue, action verb implies hands",
     "L14's authored action verb ('shoving' a drawer) inherently pulls the render toward hand-based "
     "manipulation, in tension with pc-boxy's no-hands canon. The one sanctioned retry fixed 2 of 3 "
     "original defects (redesign + both arms reaching) but introduced fingered hands as a new rig-identity "
     "break; retry budget is exhausted. Same fix as (c): a future re-author should swap the verb for a "
     "stub-arm-compatible action (e.g. body-checking / leaning) rather than a third prompt-only retry on "
     "the same mechanism."),
    ("e", "L25 lettering register: possibly systemic",
     "L25's carton lettering spells correctly (HARD DRIVE, confirmed twice) but the typeface register is "
     "STILL not fixed after its one sanctioned retry: bold/upright/uniform-stroke with a level baseline, "
     "no lean, no baseline bounce vs the locked hand-marker exemplar. Parked rather than re-rolled per "
     "doctrine (unchanged mechanism). Flagged as possibly systemic -- the engine/mechanism may not "
     "reliably render lean+baseline-bounce from prose alone even with the stencil word removed. Worth a "
     "channel-level look; other lettering shots may share this risk."),
    ("f", "stamp_review.py old-schema footgun (repaired)",
     "An old-schema footgun in stamp_review.py caused collateral downgrades on review records during this "
     "session; it was caught and repaired in place, but it's the kind of defect that could silently "
     "re-corrupt review state on a future run. Worth a dedicated hardening pass (schema validation on "
     "read/write) rather than trusting the same script not to regress."),
]


def findings_section():
    items = "".join(
        f'<article class="finding"><h3>({letter}) {html.escape(ascii_text(title))}</h3>'
        f'<p>{html.escape(ascii_text(body))}</p></article>'
        for letter, title, body in FINDINGS
    )
    return f'<section class="findings"><h2>Findings for rulings</h2>{items}</section>'


def render(scene_rows, fig_by_char, deferred_by_char, size_text):
    scene_v = sum(1 for r in scene_rows if r["verified"])
    scene_p = len(scene_rows) - scene_v
    scene_html = "".join(scene_card(r) for r in scene_rows)

    all_fig_cards = [c for cards in fig_by_char.values() for c in cards]
    fig_v = sum(1 for c in all_fig_cards if c["badge"] == "verified")
    fig_p = sum(1 for c in all_fig_cards if c["badge"] == "parked")
    fig_u = sum(1 for c in all_fig_cards if c["badge"] == "unreviewed")
    fig_d = sum(len(v) for v in deferred_by_char.values())

    chars = sorted(set(fig_by_char) | set(deferred_by_char))
    char_html = "".join(char_section(c, fig_by_char.get(c, []), deferred_by_char.get(c, [])) for c in chars)

    findings_html = findings_section()

    header = f'''<header class="top">
  <h1>Overnight review board - bricks-fresh</h1>
  <p class="muted">2026-07-28-bricks-fresh, the-second-take. Embedded board: {size_text}. Grid tallies below are computed live from files on disk + review records; they may drift a little from the run's own running totals as later batches land.</p>
  <div class="summary">
    <div><strong>WAVE-2 FIGURE CARDS (run totals)</strong>97 verified / 11 parked / 26 deferred (blocked behind unreviewed Pass-2 place plates)<br><span class="muted">this board's live grid tally: {fig_v} verified / {fig_p} parked{f' / {fig_u} unreviewed' if fig_u else ''} / {fig_d} deferred</span></div>
    <div><strong>SCENE TENTH (L01-L25, run totals)</strong>17 verified / 8 parked<br><span class="muted">this board's live grid tally: {scene_v} verified / {scene_p} parked</span></div>
    <div><strong>SPEND (est.)</strong>Wave-2 figure cards ~$26.7 | scenes (this tenth) ~$5.1 | earlier r2 engine duel ~$1.73</div>
    <div><strong>FORGE FIXES SHIPPED THIS SESSION</strong>P8 gesture clause; clean_card retry; ground-line removed</div>
  </div>
</header>'''

    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bricks-Fresh Overnight Review Board</title>
<style>
:root{{--bg:#091018;--panel:#111c28;--panel2:#17283a;--line:#34495d;--text:#f3f7fb;--muted:#adc0d2;--ok:#83dfa1;--bad:#ff897d;--warn:#ffd36a;--ref:#9ac9ff}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}}
h1,h2,h3,p{{margin:0}}.top,main{{max-width:1900px;margin:auto}}
.top{{padding:22px 20px;background:#0d1722;border-bottom:1px solid var(--line)}}h1{{font-size:28px}}.muted{{color:var(--muted);margin-top:5px}}
.summary{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:16px}}
.summary div{{padding:12px;background:var(--panel);border:1px solid var(--line);font-size:13px}}
.summary strong{{display:block;margin-bottom:5px;color:var(--ref);letter-spacing:.03em}}
main{{padding:22px 20px 60px}}
h2{{font-size:19px;text-transform:uppercase;letter-spacing:.03em;color:var(--ref);margin-bottom:12px}}
section.scenes{{margin-bottom:34px}}
.scene-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}}
.scard{{background:#0d1722;border:1px solid var(--line);padding:10px}}
.scard header{{display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px}}
.scard header strong{{font-size:15px}}
.tag{{padding:3px 8px;font-size:11px;font-weight:800;letter-spacing:.05em;border-radius:3px}}
.tag.verified{{background:#123222;color:var(--ok);border:1px solid #397b4e}}
.tag.parked,.tag.blocked{{background:#3a2024;color:var(--bad);border:1px solid #803b41}}
.detail{{font-size:11px;color:var(--muted);margin-bottom:4px}}
.why{{font-size:12px;color:var(--muted)}}
.path{{font-size:10px;color:#6a8098;margin-top:6px}}
.image-frame{{position:relative}}
.board-image{{display:block;width:100%;background:#030609;cursor:zoom-in}}
.stamp{{position:absolute;top:8px;right:8px;padding:3px 6px;border:2px solid currentColor;background:rgba(6,12,18,.88);font-size:11px;font-weight:850;letter-spacing:.06em}}
.scard.verified .stamp{{color:var(--ok)}}.scard.parked .stamp,.scard.blocked .stamp{{color:var(--bad)}}
.no-image{{aspect-ratio:16/9;display:grid;place-items:center;gap:6px;background:#1a1216;border:1px dashed #803b41;color:var(--bad);font-weight:800}}
.charsec{{margin-bottom:30px;background:#0d1722;border:1px solid var(--line)}}
.charsec>header{{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--panel2);border-bottom:1px solid var(--line)}}
.charsec h2{{margin:0;font-size:16px}}.counts{{font-size:12px;color:var(--muted)}}
.cardgrid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;padding:14px}}
.fcard{{margin:0;padding:6px;background:var(--panel);border:1px solid var(--line)}}
.fcard img{{width:100%}}
.fcard figcaption{{padding-top:6px;font-size:10px;color:var(--muted);overflow-wrap:anywhere}}
.fcard figcaption strong{{display:block;color:var(--text);font-size:10px;margin-bottom:3px}}
.fcard.verified .stamp{{color:var(--ok)}}.fcard.parked .stamp{{color:var(--bad)}}.fcard.unreviewed .stamp{{color:var(--warn)}}
.chips{{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}}
.chip{{padding:2px 5px;border-radius:8px;background:#3a2024;border:1px solid #803b41;color:#ffc3bd;font-size:9px}}
.note,.src{{color:#8ba0b4;font-size:9px;margin-top:3px}}
.deferred-block{{margin:0 14px 14px;padding:10px 12px;background:#1c1620;border:1px dashed #6a3350}}
.deferred-block ul{{margin:6px 0 0;padding-left:18px;font-size:11px;color:var(--muted)}}
.findings{{margin-top:10px;padding:18px;background:#0d1722;border:1px solid var(--line)}}
.finding{{margin-bottom:16px}}.finding h3{{font-size:14px;color:var(--warn);margin-bottom:5px}}
.finding p{{font-size:13px;color:var(--muted)}}
#lightbox{{display:none;position:fixed;inset:0;z-index:10;padding:28px 64px;background:rgba(0,0,0,.96)}}
#lightbox.open{{display:grid;place-items:center}}
#lightbox img{{display:block;max-width:92vw;max-height:85vh;object-fit:contain;background:#030609}}
#lb-caption{{margin-top:9px;color:var(--muted);text-align:center;max-width:80vw}}
#lightbox button{{position:fixed;border:1px solid #626d7a;background:#171c23;color:var(--text);padding:8px 12px;font:22px/1 system-ui,sans-serif;cursor:pointer}}
#lb-close{{top:16px;right:16px;font-size:14px!important}}#lb-prev{{left:16px;top:50%}}#lb-next{{right:16px;top:50%}}
@media(max-width:760px){{.summary,.scene-grid{{grid-template-columns:1fr}}#lightbox{{padding:20px}}}}
</style></head><body>
{header}
<main>
<section class="scenes"><h2>Scene tenth (L01-L25)</h2><div class="scene-grid">{scene_html}</div></section>
<section class="figcards"><h2>Wave-2 figure cards</h2>{char_html}</section>
{findings_html}
</main>
<div id="lightbox" aria-hidden="true"><div><img id="lb-image" alt=""><div id="lb-caption"></div></div><button id="lb-close" type="button">Esc</button><button id="lb-prev" type="button" aria-label="Previous image">&lt;</button><button id="lb-next" type="button" aria-label="Next image">&gt;</button></div>
<script>(()=>{{const box=document.getElementById('lightbox'),image=document.getElementById('lb-image'),caption=document.getElementById('lb-caption'),images=[...document.querySelectorAll('.board-image')];let index=0;const show=next=>{{index=(next+images.length)%images.length;const current=images[index];image.src=current.src;image.alt=current.alt;caption.textContent=current.alt;box.classList.add('open');box.setAttribute('aria-hidden','false')}};const close=()=>{{box.classList.remove('open');box.setAttribute('aria-hidden','true');image.removeAttribute('src')}};images.forEach((node,i)=>node.addEventListener('click',()=>show(i)));document.getElementById('lb-close').addEventListener('click',close);document.getElementById('lb-prev').addEventListener('click',()=>show(index-1));document.getElementById('lb-next').addEventListener('click',()=>show(index+1));document.addEventListener('keydown',event=>{{if(!box.classList.contains('open'))return;if(event.key==='Escape')close();if(event.key==='ArrowLeft')show(index-1);if(event.key==='ArrowRight')show(index+1)}});box.addEventListener('click',event=>{{if(event.target===box)close()}})}})();</script>
</body></html>'''


def verify_document(document, scene_rows, fig_by_char):
    if not document.isascii():
        raise AssertionError("Board is not ASCII")
    expected_scene_images = sum(1 for r in scene_rows if r["kind"] == "image")
    expected_fig_images = sum(len(v) for v in fig_by_char.values())
    expected_total = expected_scene_images + expected_fig_images
    image_count = document.count('class="board-image"')
    embedded_count = document.count("data:image/jpeg;base64,")
    if (image_count, embedded_count) != (expected_total, expected_total):
        raise AssertionError(f"Expected {expected_total} embedded images, got {image_count}/{embedded_count}")
    if "<title>Bricks-Fresh Overnight Review Board</title>" not in document:
        raise AssertionError("Missing required title")


def main():
    scene_rows = load_scene_tenth()
    fig_by_char, deferred_by_char = load_figure_cards()

    size_text = "calculating"
    for _ in range(4):
        OUT.write_text(render(scene_rows, fig_by_char, deferred_by_char, size_text), encoding="ascii")
        next_size = f"{OUT.stat().st_size:,} bytes"
        if next_size == size_text:
            break
        size_text = next_size
    else:
        raise RuntimeError("Board byte-size display did not stabilize")

    document = OUT.read_text(encoding="ascii")
    verify_document(document, scene_rows, fig_by_char)
    if OUT.stat().st_size >= MAX_BYTES:
        raise AssertionError(f"Board exceeds 16 MiB: {OUT.stat().st_size:,} bytes")

    fig_v = sum(1 for cards in fig_by_char.values() for c in cards if c["badge"] == "verified")
    fig_p = sum(1 for cards in fig_by_char.values() for c in cards if c["badge"] == "parked")
    fig_u = sum(1 for cards in fig_by_char.values() for c in cards if c["badge"] == "unreviewed")
    fig_d = sum(len(v) for v in deferred_by_char.values())
    scene_v = sum(1 for r in scene_rows if r["verified"])
    scene_p = len(scene_rows) - scene_v
    print(f"wrote {OUT}: {OUT.stat().st_size:,} bytes")
    print(f"scene tenth: {scene_v} verified / {scene_p} parked (of {len(scene_rows)})")
    print(f"figure cards: {fig_v} verified / {fig_p} parked / {fig_u} unreviewed / {fig_d} deferred")
    print(f"characters: {sorted(set(fig_by_char) | set(deferred_by_char))}")


if __name__ == "__main__":
    main()
