#!/usr/bin/env python3
"""Build the overnight-run review board for 2026-07-28-bricks-fresh.

One self-contained board.html covering the whole overnight run:
  1. header summary
  2. scene tenth L01-L25 (what Daniel most wants to see)
  3. Wave-2 figure cards, grouped by character: a live cardgrid (state comes
     ONLY from the live card's own review.json/remaining.json verdict) plus,
     where applicable, a separate "failed cards (no verified replacement)"
     group for stems that only exist as a quarantined flagged/rejected copy
  4. findings for rulings (text)

NOTE (2026-08-18): the Wave-1 seed assets section was removed per Daniel's
ruling -- registry.json is channel-wide and was surfacing another video's
characters (Bolivar, MacGregor, Mosquito King) on this board.

Lightbox/theme pattern adapted from ../w2-r2/build_duel_board.py
(click-to-fullscreen, </> or arrow-key nav while zoomed, Esc, explicit colors).

Data sources (read-only):
  assets/_review/merged.json                - scene-tenth per-shot verdicts (L01-L25 range)
  scratchpad/scenes-t1/progress-w{A,B,C}.md - parked/blocked reasons for shots with no image
  shots.json                                - long_form.shots[] vo_text -- script/VO text per shot
  visual-kit/_staging/*.png                 - Wave-2 LIVE figure card files (plain fig-*.png),
                                               plus a few flagged/rejected copies that happen to
                                               live inside _staging (quarantined earlier attempts)
  visual-kit/_staging_flagged_*.png,
  visual-kit/_staging_rejected_*.png        - MORE quarantined Wave-2 copies, sitting in the
                                               visual-kit ROOT, not inside _staging/. These are
                                               earlier-attempt snapshots (e.g. pre-clean_card-retry
                                               frames), not a second opinion on a live card with the
                                               same stem -- dropped from the board when a live twin
                                               exists, kept in their own group when it doesn't.
  visual-kit/_staging/review.json           - figures verdict map (authoritative where present)
  scratchpad/w2-full/remaining.json         - batch status snapshot (fallback + deferred list)

Writes (in addition to board.html):
  scratchpad/overnight-board/failed-cards.json - every Wave-2 card whose current
    state is not verified (parked / flagged / rejected), machine-readable, for
    a re-mint wave. See build_failed_cards_export().
"""
import base64
import html
import io
import json
import os
import unicodedata
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parents[1]          # .../videos/2026-07-28-bricks-fresh
CHANNEL = VIDEO.parents[1]       # .../channels/the-second-take
KIT = CHANNEL / "visual-kit"
STAGING = KIT / "_staging"
SCENES = VIDEO / "assets" / "scenes"
SHOTS_PATH = VIDEO / "shots.json"

OUT = HERE / "board.html"
FAILED_CARDS_OUT = HERE / "failed-cards.json"
MAX_BYTES = 16 * 1024 * 1024

SCENE_EDGE = 640
FIG_EDGE = 384
JPEG_Q = 70

SCENE_ORDER = [f"L{n:02d}" for n in range(1, 26)]


def ascii_text(value):
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    return value.replace("--", "-")


@lru_cache(maxsize=None)
def _encode_jpeg(path_str, max_edge, quality):
    with Image.open(path_str) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        if max(image.size) > max_edge:
            ratio = max_edge / max(image.size)
            image = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")


def jpeg_uri(path, max_edge, quality=JPEG_Q):
    # quality is captured at call time (not def time) by callers that read the
    # module-level constant fresh on each call, so the adaptive size loop in
    # main() can tighten it between attempts; the lru_cache key includes it.
    return _encode_jpeg(str(path), max_edge, quality)


# ---------------------------------------------------------------------------
# Section 2: scene tenth L01-L25
# ---------------------------------------------------------------------------

def load_shot_vo_map():
    """id -> narration/VO text the shot plays over, from shots.json long_form.shots[].

    Schema inspected on this video: each shot has both `vo_ref` (a shorter,
    often mid-sentence-truncated caption fragment) and `vo_text` (the full
    narration line for that beat) -- vo_text is the actual script/VO text the
    image plays over, so that's the field used here. Falls back to vo_ref if
    vo_text is ever absent on some future video; callers treat a missing id
    or an empty result as "no script span found" rather than omitting it.
    """
    if not SHOTS_PATH.is_file():
        return {}
    data = json.loads(SHOTS_PATH.read_text(encoding="utf-8"))
    shots = data.get("long_form", {}).get("shots", [])
    return {s["id"]: (s.get("vo_text") or s.get("vo_ref") or "") for s in shots if s.get("id")}


def load_scene_tenth():
    merged = json.loads((VIDEO / "assets" / "_review" / "merged.json").read_text(encoding="utf-8"))
    by_id = {entry["id"]: entry for entry in merged}
    vo_map = load_shot_vo_map()

    blockers = {}
    for tag in ("wA", "wB", "wC"):
        path = VIDEO / "scratchpad" / "scenes-t1" / f"progress-{tag}.md"
        if path.is_file():
            blockers[tag] = path.read_text(encoding="utf-8", errors="ignore")

    rows = []
    for sid in SCENE_ORDER:
        script = vo_map.get(sid) or "no script span found"
        img_path = SCENES / f"{sid}.png"
        entry = by_id.get(sid)
        if img_path.is_file() and entry is not None:
            worst = entry.get("worst", "clean")
            verified = worst == "clean"
            rows.append({
                "id": sid, "kind": "image", "verified": verified,
                "img": img_path, "why": entry.get("why", ""),
                "axes": {k: entry[k] for k in ("r", "f", "s") if k in entry},
                "worst": worst, "script": script,
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
            rows.append({"id": sid, "kind": "blocked", "verified": False, "reason": reason, "script": script})
    return rows


def scene_card(row):
    script = row.get("script") or "no script span found"
    script_html = f'<p class="script"><span class="scriptlabel">SCRIPT</span> {html.escape(ascii_text(script))}</p>'
    if row["kind"] == "image":
        badge = "verified" if row["verified"] else "parked"
        badge_label = "VERIFIED" if row["verified"] else "PARKED"
        axes_txt = ", ".join(f"{k}:{v}" for k, v in row.get("axes", {}).items())
        detail = f"worst={row['worst']}" + (f" ({axes_txt})" if axes_txt else "")
        alt = ascii_text(f"{row['id']} {badge_label}: {row['why']} | SCRIPT: {script}")
        return f'''<article class="scard {badge}">
  <div class="image-frame"><img class="board-image" src="{jpeg_uri(row['img'], SCENE_EDGE, JPEG_Q)}" alt="{html.escape(alt, quote=True)}" loading="lazy"><span class="stamp">{badge_label}</span></div>
  <header><strong>{html.escape(row['id'])}</strong><span class="tag {badge}">{badge_label}</span></header>
  {script_html}
  <p class="detail">{html.escape(ascii_text(detail))}</p>
  <p class="why">{html.escape(ascii_text(row['why']))}</p>
  <p class="path">full res: assets/scenes/{html.escape(row['id'])}.png</p>
</article>'''
    else:
        alt = ascii_text(f"{row['id']} BLOCKED: {row['reason']}")
        return f'''<article class="scard blocked">
  <div class="no-image"><span class="stamp">NO IMAGE</span><strong>{html.escape(row['id'])}</strong></div>
  <header><strong>{html.escape(row['id'])}</strong><span class="tag blocked">PARKED - NO GEN</span></header>
  {script_html}
  <p class="why">{html.escape(ascii_text(row['reason']))}</p>
</article>'''


# ---------------------------------------------------------------------------
# Section 3: Wave-2 figure cards
# ---------------------------------------------------------------------------

def parse_char(fig_stem):
    # fig_stem like "fig-<character>--<rest...>"
    body = fig_stem[len("fig-"):] if fig_stem.startswith("fig-") else fig_stem
    return body.split("--", 1)[0]


LIVE_BADGE_ORDER = ["parked", "unreviewed", "verified"]      # worst-first
FAILED_BADGE_ORDER = ["rejected", "flagged"]                 # worst-first


def _strip_wave2_prefix(filename):
    for prefix in ("_staging_flagged_", "_staging_rejected_"):
        if filename.startswith(prefix):
            return filename[len(prefix):-4]
    if filename.startswith("fig-") and filename.endswith(".png"):
        return filename[:-4]
    return None


def load_figure_cards():
    """Wave-2 figure cards, split by whether a LIVE (currently-staged plain
    fig-*.png) card exists for a given stem.

    Per Daniel's 2026-08-18 ruling: the root-prefixed _staging_flagged_/
    _staging_rejected_ files are quarantined EARLIER-ATTEMPT snapshots (e.g.
    pre-clean_card-retry frames), not a second opinion on a live card sharing
    the same stem. So:
      - A stem WITH a live plain card shows ONLY its live review.json/
        remaining.json verdict -- no merged "ALSO FLAGGED/REJECTED" chips.
        Any flagged/rejected copy of that same stem is dropped from the board
        entirely (superseded, dead) -- never even loaded into a card dict.
      - A stem with NO live plain card (only flagged/rejected copies) is kept,
        badged flagged/rejected, and returned separately so the caller can
        render it in its own "failed cards (no verified replacement)" group.

    Returns (live_by_char, failed_by_char, deferred_by_char).
    """
    review = json.loads((STAGING / "review.json").read_text(encoding="utf-8")).get("figures", {})
    remaining_path = VIDEO / "scratchpad" / "w2-full" / "remaining.json"
    remaining_items = {}
    if remaining_path.is_file():
        remaining_items = json.loads(remaining_path.read_text(encoding="utf-8")).get("items", {})

    plain_by_stem = {}
    flagged_by_stem = defaultdict(list)
    rejected_by_stem = defaultdict(list)

    def _bucket(filename, path):
        stem = _strip_wave2_prefix(filename)
        if stem is None:
            return
        if filename.startswith("_staging_flagged_"):
            flagged_by_stem[stem].append((filename, path))
        elif filename.startswith("_staging_rejected_"):
            rejected_by_stem[stem].append((filename, path))
        elif filename.startswith("fig-"):
            plain_by_stem.setdefault(stem, (filename, path))

    for f in sorted(os.listdir(STAGING)):
        if f.endswith(".png"):
            _bucket(f, STAGING / f)
    for f in sorted(os.listdir(KIT)):
        if f.endswith(".png") and f.startswith(("_staging_flagged_", "_staging_rejected_")):
            _bucket(f, KIT / f)

    live_by_char = defaultdict(list)
    failed_by_char = defaultdict(list)
    covered_stems = set()

    for stem, (filename, path) in sorted(plain_by_stem.items()):
        covered_stems.add(stem)
        rem = remaining_items.get(stem)
        rev = review.get(f"_staging/{filename}")
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
        note = (rem.get("note") if rem else "") or ""
        live_by_char[parse_char(stem)].append({
            "stem": stem, "file": filename, "path": path, "badge": badge,
            "tags": tags, "source": source, "note": note,
        })

    # Failed-only: stems with NO live plain twin -- these are the only
    # quarantined flagged/rejected copies that actually render on the board.
    no_twin_stems = (set(flagged_by_stem) | set(rejected_by_stem)) - set(plain_by_stem)
    for stem in sorted(no_twin_stems):
        covered_stems.add(stem)
        has_rejected = stem in rejected_by_stem
        filename, path = (rejected_by_stem[stem] if has_rejected else flagged_by_stem[stem])[0]
        rem = remaining_items.get(stem)
        rev = review.get(f"_staging/{filename}")
        badge = "rejected" if has_rejected else "flagged"
        # Reason precedence: review.json axes first (most authoritative on
        # WHY a specific frame failed), then remaining.json's failed_invariants,
        # then an honest "no record" fallback -- never a filename guess.
        if rev is not None:
            tags = [k for k, v in rev.get("verdicts", {}).items() if v == "fail"] or ["fail"]
            source = "review.json"
        elif rem is not None and rem.get("failed_invariants"):
            tags = rem["failed_invariants"]
            source = "remaining.json (parked)"
        else:
            tags = ["no formal verdict record for this stem"]
            source = "filename only (see remaining.json / progress logs)"
        note = (rem.get("note") if rem else "") or "quarantined candidate frame, superseded or never promoted; no live staged twin"
        failed_by_char[parse_char(stem)].append({
            "stem": stem, "file": filename, "path": path, "badge": badge,
            "tags": tags, "source": source, "note": note,
        })

    deferred_by_char = defaultdict(list)
    for stem, rem in remaining_items.items():
        if stem in covered_stems:
            continue
        status = rem.get("status")
        if status in ("not_yet_attempted", "generation_failed_needs_regen"):
            deferred_by_char[parse_char(stem)].append({"stem": stem, "status": status, "note": rem.get("note", "")})

    return live_by_char, failed_by_char, deferred_by_char


def figure_card(item):
    badge = item["badge"]
    label = badge.upper()
    chips = "".join(f'<span class="chip">{html.escape(ascii_text(t))}</span>' for t in item["tags"])
    alt = ascii_text(f"{item['file']} {label}: {', '.join(item['tags']) or 'clean'}")
    note = item.get("note") or ""
    return f'''<figure class="fcard {badge}">
  <div class="image-frame"><img class="board-image" src="{jpeg_uri(item['path'], FIG_EDGE, JPEG_Q)}" alt="{html.escape(alt, quote=True)}" loading="lazy"><span class="stamp">{label}</span></div>
  <figcaption><strong>{html.escape(ascii_text(item['file']))}</strong>
  <div class="chips">{chips}</div>
  {f'<p class="note">{html.escape(ascii_text(note))}</p>' if note else ''}
  <p class="src">source: {html.escape(ascii_text(item['source']))}</p></figcaption>
</figure>'''


def char_section(char, live_cards, failed_cards, deferred):
    live_counts = {b: sum(1 for c in live_cards if c["badge"] == b) for b in LIVE_BADGE_ORDER}
    failed_counts = {b: sum(1 for c in failed_cards if c["badge"] == b) for b in FAILED_BADGE_ORDER}
    d = len(deferred)

    live_sorted = sorted(live_cards, key=lambda c: (LIVE_BADGE_ORDER.index(c["badge"]), c["file"]))
    live_html = "".join(figure_card(c) for c in live_sorted)

    failed_html = ""
    if failed_cards:
        failed_sorted = sorted(failed_cards, key=lambda c: (FAILED_BADGE_ORDER.index(c["badge"]), c["file"]))
        failed_cards_html = "".join(figure_card(c) for c in failed_sorted)
        failed_counts_txt = " / ".join(f"{failed_counts[b]} {b}" for b in FAILED_BADGE_ORDER if failed_counts[b])
        failed_html = f'''<div class="failedblock">
  <header><strong>Failed cards (no verified replacement)</strong><span class="counts">{failed_counts_txt}</span></header>
  <p class="muted">Quarantined candidate frames with NO live staged twin for this stem -- an
  earlier attempt superseded by a live card is dropped from the board entirely; these never
  got a live replacement, so they stay visible here as their own state, separate from the
  live grid above.</p>
  <div class="cardgrid">{failed_cards_html}</div>
</div>'''

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

    header_counts = " / ".join(f"{live_counts[b]} {b}" for b in LIVE_BADGE_ORDER if live_counts[b]) or "0 live cards"
    if failed_cards:
        header_counts += f" / {len(failed_cards)} failed (no live twin)"
    if d:
        header_counts += f" / {d} deferred"

    return f'''<section class="charsec">
  <header><h2>{html.escape(ascii_text(char))}</h2>
    <span class="counts">{header_counts}</span>
  </header>
  <div class="cardgrid">{live_html}</div>
  {failed_html}
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


def render(scene_rows, live_by_char, failed_by_char, deferred_by_char, size_text):
    scene_v = sum(1 for r in scene_rows if r["verified"])
    scene_p = len(scene_rows) - scene_v
    scene_html = "".join(scene_card(r) for r in scene_rows)

    all_live = [c for cards in live_by_char.values() for c in cards]
    all_failed = [c for cards in failed_by_char.values() for c in cards]
    live_counts = {b: sum(1 for c in all_live if c["badge"] == b) for b in LIVE_BADGE_ORDER}
    failed_counts = {b: sum(1 for c in all_failed if c["badge"] == b) for b in FAILED_BADGE_ORDER}
    fig_d = sum(len(v) for v in deferred_by_char.values())
    fig_tally = " / ".join(f"{live_counts[b]} {b}" for b in LIVE_BADGE_ORDER if live_counts[b])
    if all_failed:
        fig_tally += " / " + " / ".join(f"{failed_counts[b]} {b} (no live twin)" for b in FAILED_BADGE_ORDER if failed_counts[b])
    if fig_d:
        fig_tally += f" / {fig_d} deferred"

    chars = sorted(set(live_by_char) | set(failed_by_char) | set(deferred_by_char))
    char_html = "".join(
        char_section(c, live_by_char.get(c, []), failed_by_char.get(c, []), deferred_by_char.get(c, []))
        for c in chars
    )

    findings_html = findings_section()

    header = f'''<header class="top">
  <h1>Overnight review board - bricks-fresh</h1>
  <p class="muted">2026-07-28-bricks-fresh, the-second-take. Embedded board: {size_text}. Grid tallies below are computed live from files on disk + review records; they may drift a little from the run's own running totals as later batches land.</p>
  <div class="summary">
    <div><strong>WAVE-2 FIGURE CARDS (run totals)</strong>97 verified / 11 parked / 26 deferred (blocked behind unreviewed Pass-2 place plates)<br><span class="muted">this board's live grid tally -- live cards show ONLY their own live verdict, quarantined flagged/rejected copies with no live twin are counted separately: {fig_tally}</span></div>
    <div><strong>SCENE TENTH (L01-L25, run totals)</strong>17 verified / 8 parked<br><span class="muted">this board's live grid tally: {scene_v} verified / {scene_p} parked</span></div>
    <div><strong>SPEND (est.)</strong>Wave-2 figure cards ~$26.7 | scenes (this tenth) ~$5.1 | earlier r2 engine duel ~$1.73</div>
    <div><strong>FORGE FIXES SHIPPED THIS SESSION</strong>P8 gesture clause; clean_card retry; ground-line removed</div>
  </div>
</header>'''

    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bricks-Fresh Overnight Review Board</title>
<style>
:root{{--bg:#091018;--panel:#111c28;--panel2:#17283a;--line:#34495d;--text:#f3f7fb;--muted:#adc0d2;--ok:#83dfa1;--bad:#ff897d;--warn:#ffd36a;--ref:#9ac9ff;--flag:#ffa94d;--reject:#ff5f7e}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}}
h1,h2,h3,h4,p{{margin:0}}.top,main{{max-width:1900px;margin:auto}}
.top{{padding:22px 20px;background:#0d1722;border-bottom:1px solid var(--line)}}h1{{font-size:28px}}.muted{{color:var(--muted);margin-top:5px}}
.summary{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:16px}}
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
.script{{font-size:12px;color:var(--muted);background:#0a141e;border:1px solid #223244;border-left:3px solid var(--ref);padding:6px 8px;margin:6px 0;font-style:italic}}
.scriptlabel{{display:inline-block;font-style:normal;font-weight:800;letter-spacing:.05em;color:var(--ref);font-size:9px;margin-right:6px}}
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
.fcard.flagged .stamp{{color:var(--flag)}}.fcard.rejected .stamp{{color:var(--reject)}}
.fcard.flagged{{border-color:#80591f}}.fcard.rejected{{border-color:#80295a}}
.chips{{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}}
.chip{{padding:2px 5px;border-radius:8px;background:#3a2024;border:1px solid #803b41;color:#ffc3bd;font-size:9px}}
.note,.src{{color:#8ba0b4;font-size:9px;margin-top:3px}}
.deferred-block{{margin:0 14px 14px;padding:10px 12px;background:#1c1620;border:1px dashed #6a3350}}
.deferred-block ul{{margin:6px 0 0;padding-left:18px;font-size:11px;color:var(--muted)}}
.failedblock{{margin:0 14px 14px;padding:10px 12px;background:#1c1013;border:1px dashed #80295a}}
.failedblock>header{{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}}
.failedblock>header strong{{color:var(--reject);font-size:12px;letter-spacing:.03em;text-transform:uppercase}}
.failedblock .cardgrid{{padding:10px 0 0}}
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
<section class="figcards"><h2>Wave-2 figure cards (every card, every verdict)</h2>{char_html}</section>
{findings_html}
</main>
<div id="lightbox" aria-hidden="true"><div><img id="lb-image" alt=""><div id="lb-caption"></div></div><button id="lb-close" type="button">Esc</button><button id="lb-prev" type="button" aria-label="Previous image">&lt;</button><button id="lb-next" type="button" aria-label="Next image">&gt;</button></div>
<script>(()=>{{const box=document.getElementById('lightbox'),image=document.getElementById('lb-image'),caption=document.getElementById('lb-caption'),images=[...document.querySelectorAll('.board-image')];let index=0;const show=next=>{{index=(next+images.length)%images.length;const current=images[index];image.src=current.src;image.alt=current.alt;caption.textContent=current.alt;box.classList.add('open');box.setAttribute('aria-hidden','false')}};const close=()=>{{box.classList.remove('open');box.setAttribute('aria-hidden','true');image.removeAttribute('src')}};images.forEach((node,i)=>node.addEventListener('click',()=>show(i)));document.getElementById('lb-close').addEventListener('click',close);document.getElementById('lb-prev').addEventListener('click',()=>show(index-1));document.getElementById('lb-next').addEventListener('click',()=>show(index+1));document.addEventListener('keydown',event=>{{if(!box.classList.contains('open'))return;if(event.key==='Escape')close();if(event.key==='ArrowLeft')show(index-1);if(event.key==='ArrowRight')show(index+1)}});box.addEventListener('click',event=>{{if(event.target===box)close()}})}})();</script>
</body></html>'''


def verify_document(document, scene_rows, live_by_char, failed_by_char):
    if not document.isascii():
        raise AssertionError("Board is not ASCII")
    expected_scene_images = sum(1 for r in scene_rows if r["kind"] == "image")
    expected_fig_images = sum(len(v) for v in live_by_char.values()) + sum(len(v) for v in failed_by_char.values())
    expected_total = expected_scene_images + expected_fig_images
    image_count = document.count('class="board-image"')
    embedded_count = document.count("data:image/jpeg;base64,")
    if (image_count, embedded_count) != (expected_total, expected_total):
        raise AssertionError(f"Expected {expected_total} embedded images, got {image_count}/{embedded_count}")
    if "<title>Bricks-Fresh Overnight Review Board</title>" not in document:
        raise AssertionError("Missing required title")
    if "wave1" in document.lower() or "seed assets" in document.lower():
        raise AssertionError("Wave-1 section should have been removed entirely but a trace was found")


# Adaptive byte-budget ladder: quality first, then edge, scene edge as last resort.
# Never drops images -- only degrades JPEG quality/resolution of the embed.
SIZE_ATTEMPTS = [
    (70, 384, 640),
    (55, 384, 640),
    (45, 384, 640),
    (35, 384, 640),
    (35, 320, 640),
    (35, 256, 640),
    (30, 256, 560),
    (25, 224, 480),
]


def build_failed_cards_export(live_by_char, failed_by_char):
    """Every Wave-2 card whose CURRENT state is not verified, for a re-mint
    wave. State comes from the same review.json/remaining.json parsing used
    for the on-board badge -- never a filename guess.

    Live "unreviewed" cards (no review.json or remaining.json record at all)
    are intentionally excluded: the brief's own state enumeration is
    parked/flagged/rejected, and "unreviewed" means "not yet judged," not
    "failed" -- re-minting an unreviewed-but-possibly-fine card would waste
    spend. (Moot on this run: 0 unreviewed cards currently exist.)
    """
    entries = []
    for char in sorted(set(live_by_char) | set(failed_by_char)):
        for c in live_by_char.get(char, []):
            if c["badge"] != "parked":
                continue
            entries.append({
                "stem": c["stem"], "character": char, "state": c["badge"],
                "file": str(c["path"]),
                "reason": "; ".join(c["tags"]) if c["tags"] else (c.get("note") or "no formal verdict record found"),
            })
        for c in failed_by_char.get(char, []):
            entries.append({
                "stem": c["stem"], "character": char, "state": c["badge"],
                "file": str(c["path"]),
                "reason": "; ".join(c["tags"]) if c["tags"] else (c.get("note") or "no formal verdict record found"),
            })
    return entries


def main():
    global JPEG_Q, FIG_EDGE, SCENE_EDGE

    scene_rows = load_scene_tenth()
    live_by_char, failed_by_char, deferred_by_char = load_figure_cards()

    fitted = False
    for quality, fig_edge, scene_edge in SIZE_ATTEMPTS:
        JPEG_Q, FIG_EDGE, SCENE_EDGE = quality, fig_edge, scene_edge

        size_text = "calculating"
        for _ in range(4):
            OUT.write_text(
                render(scene_rows, live_by_char, failed_by_char, deferred_by_char, size_text),
                encoding="ascii",
            )
            next_size = f"{OUT.stat().st_size:,} bytes"
            if next_size == size_text:
                break
            size_text = next_size
        else:
            raise RuntimeError("Board byte-size display did not stabilize")

        size = OUT.stat().st_size
        if size < MAX_BYTES:
            fitted = True
            break
        print(f"attempt q={quality} fig_edge={fig_edge} scene_edge={scene_edge} "
              f"-> {size:,} bytes (over 16 MiB budget, tightening and retrying)")

    if not fitted:
        raise AssertionError(f"Board exceeds 16 MiB even at minimum adaptive settings: {OUT.stat().st_size:,} bytes")

    document = OUT.read_text(encoding="ascii")
    verify_document(document, scene_rows, live_by_char, failed_by_char)

    failed_cards = build_failed_cards_export(live_by_char, failed_by_char)
    with open(FAILED_CARDS_OUT, "w", encoding="utf-8") as fh:
        json.dump(failed_cards, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    all_live = [c for cards in live_by_char.values() for c in cards]
    all_failed = [c for cards in failed_by_char.values() for c in cards]
    live_counts = {b: sum(1 for c in all_live if c["badge"] == b) for b in LIVE_BADGE_ORDER}
    failed_counts = {b: sum(1 for c in all_failed if c["badge"] == b) for b in FAILED_BADGE_ORDER}
    fig_d = sum(len(v) for v in deferred_by_char.values())
    scene_v = sum(1 for r in scene_rows if r["verified"])
    scene_p = len(scene_rows) - scene_v
    print(f"wrote {OUT}: {OUT.stat().st_size:,} bytes "
          f"(settings: JPEG_Q={JPEG_Q}, FIG_EDGE={FIG_EDGE}, SCENE_EDGE={SCENE_EDGE})")
    print(f"scene tenth: {scene_v} verified / {scene_p} parked (of {len(scene_rows)})")
    print("figure cards (wave-2) LIVE: " + " / ".join(f"{live_counts[b]} {b}" for b in LIVE_BADGE_ORDER)
          + f" = {len(all_live)} live cards")
    print("figure cards (wave-2) FAILED (no live twin): "
          + " / ".join(f"{failed_counts[b]} {b}" for b in FAILED_BADGE_ORDER) + f" = {len(all_failed)} failed cards")
    print(f"deferred (no image exists): {fig_d}")
    print(f"wrote {FAILED_CARDS_OUT}: {len(failed_cards)} entries")
    print(f"characters: {sorted(set(live_by_char) | set(failed_by_char) | set(deferred_by_char))}")


if __name__ == "__main__":
    main()
