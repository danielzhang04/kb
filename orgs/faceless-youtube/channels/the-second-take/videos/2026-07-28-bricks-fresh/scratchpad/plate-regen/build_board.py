#!/usr/bin/env python3
"""Build the warm-neutrals doctrine remint review board (Phase 3, 2026-08-18).

OLD vs NEW side by side: the scene-style-tile at top, then the 7 place plates.
Lightbox/theme pattern copied from ../overnight-board/build_board.py (click-to-
fullscreen, </> arrow-key nav while zoomed, Esc, explicit colors).

Self-contained, all images inlined as base64 JPEG, target < 16 MB.
"""
import base64
import html
import io
import json
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parents[1]
CHANNEL = VIDEO.parents[1]
KIT = CHANNEL / "visual-kit"

OLD = HERE / "old"
SCENES = VIDEO / "assets" / "scenes"
STAGING = KIT / "_staging"

OUT = HERE / "board.html"
MAX_BYTES = 16 * 1024 * 1024
EDGE = 700
JPEG_Q = 78


def jpeg_uri(path, max_edge=EDGE, quality=JPEG_Q):
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        if max(image.size) > max_edge:
            ratio = max_edge / max(image.size)
            image = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")


TILE_OLD = OLD / "scene-style-tile.png"
TILE_NEW = KIT / "refs" / "env" / "scene-style-tile.png"

PLACES = [
    {
        "id": "L28", "place": "miniscribe-floor", "state": "verified",
        "summary": "Assembly floor. First attempt still read grey-teal despite the bible clause "
                   "(measured R-B -12.4 old -> a first 1K pass at R-B +42.2 was the winning frame). "
                   "Warm cream/tan benches, shelving and walls; MINISCRIBE signage correct ink.",
    },
    {
        "id": "L65", "place": "wiles-office", "state": "verified",
        "summary": "Executive office. Passed clean on the first generation, no retry needed "
                   "(R-B +39.5 old -> +47.4 new). Warm wood desk, cream walls, palm-lined window.",
    },
    {
        "id": "L84", "place": "audit-room", "state": "parked",
        "new_path": STAGING / "L84-warmretry.png",
        "summary": "Meeting room. ONE sanctioned retry applied (palette/light span exact-replace) -- "
                   "improved (R-B -25.2 old -> -14.3 new) but STILL net cool-biased: the authored teal "
                   "floor + chair cushions (kept as the one deliberate cool accent, per the retry text) "
                   "dominate enough of the frame that the overall read has not crossed into warm-biased. "
                   "Retry budget exhausted per doctrine -- flagged for Daniel's ruling rather than "
                   "re-rolled a second time. NOT promoted; the live assets/scenes/L84.png is still the "
                   "OLD pre-doctrine frame (never downgrade a pre-existing verified entry).",
    },
    {
        "id": "L86", "place": "miniscribe-warehouse", "state": "verified",
        "summary": "Warehouse aisle. ONE sanctioned retry applied (palette/light span exact-replace): "
                   "R-B -1.4 old(-ish) -> +40.2 new. An initial by-eye read flagged the MINISCRIBE "
                   "lettering as rendering in red; Pillow colour-distance sampling against the locked "
                   "#241a12 ink refuted that (302 px match to the locked ink, 0 px anywhere near the red "
                   "#d7402b accent) -- retracted as a by-eye misjudgement, not a real defect.",
    },
    {
        "id": "L112", "place": "rented-warehouse", "state": "verified",
        "summary": "Empty rented unit. Passed clean on the first generation (R-B -16.4 old -> +25.7 new), "
                   "warm cream/khaki panels despite the authored 'Cool grey-cream palette' text.",
    },
    {
        "id": "L114", "place": "colorado-brick-yard", "state": "verified",
        "summary": "Brick yard. Already warm-authored; passed clean on the first generation "
                   "(R-B +68.8 old -> +36.4 new, both solidly warm). Ochre-red-cream palette held.",
    },
    {
        "id": "L198", "place": "jury-courtroom", "state": "verified",
        "summary": "Courtroom well. Passed clean on the first generation (R-B +22.9 old -> +42.5 new). "
                   "Warm oak panelling and floor dominate; the authored teal trim reads as one "
                   "deliberate accent, same pattern the doctrine explicitly allows.",
    },
]


def compare_card(entry_id, title, subtitle, old_path, new_path, state, summary):
    badge = state.upper()
    old_uri = jpeg_uri(old_path)
    new_uri = jpeg_uri(new_path)
    alt_old = html.escape(f"{title} OLD (pre-doctrine)", quote=True)
    alt_new = html.escape(f"{title} NEW (warm-neutrals doctrine)", quote=True)
    return f'''<article class="pcard {state}">
  <header><strong>{html.escape(title)}</strong><span class="tag {state}">{badge}</span></header>
  <p class="sub">{html.escape(subtitle)}</p>
  <div class="pair">
    <div class="half"><span class="halflabel">OLD</span><img class="board-image" src="{old_uri}" alt="{alt_old}" loading="lazy"></div>
    <div class="half"><span class="halflabel new">NEW</span><img class="board-image" src="{new_uri}" alt="{alt_new}" loading="lazy"></div>
  </div>
  <p class="summary">{html.escape(summary)}</p>
</article>'''


def render():
    tile_card = compare_card("tile", "scene-style-tile (channel style anchor)",
                              "Re-minted first per the seed law -- every cast-free plate downstream seeds this. "
                              "Verified warm by eye and by measurement before any plate regenerated.",
                              TILE_OLD, TILE_NEW, "verified",
                              "1980s home-electronics retail shop: fore/mid/background depth read "
                              "(counter foreground, shelving+ladder midground, storefront+stockroom "
                              "background). Measured mean R-B +88.2 (new) vs +65.2 (old) -- stronger warm "
                              "bias, no grey-teal drift. 1 provider call, $0.039, landed first try.")

    place_cards = "".join(
        compare_card(p["id"], f'{p["id"]} -- {p["place"]}', "place plate (first approved frame for this place)",
                     OLD / f'{p["id"]}.png', p.get("new_path", SCENES / f'{p["id"]}.png'),
                     p["state"], p["summary"])
        for p in PLACES
    )

    verified_n = sum(1 for p in PLACES if p["state"] == "verified") + 1  # +1 tile
    parked_n = sum(1 for p in PLACES if p["state"] == "parked")

    header = f'''<header class="top">
  <h1>Warm-neutrals doctrine remint -- plate review board</h1>
  <p class="muted">2026-07-28-bricks-fresh, the-second-take. Doctrine commit 33676421: style-bible S2b
  neutrals now TINTED WARM (a cold scene cools its LIGHT, never its neutrals), S5 fore/mid/background
  depth read restored, the style tile now grants line register + palette saturation AND temperature.
  This board is the approval gate -- nothing downstream (the rest of the video's plates/scenes) regenerates
  until this is ruled on.</p>
  <div class="summary">
    <div><strong>TILE + PLATES</strong>{verified_n} verified (ready to ship) / {parked_n} parked (flagged for your ruling)</div>
    <div><strong>SPEND</strong>11 provider calls (1 tile + 7 plates + 3 sanctioned retries) x $0.039/1K call = $0.429 est., against a $6.00 cap</div>
    <div><strong>REVIEW STORES</strong>video merged.json/scenes-manifest: 30 verified / 9 parked / 16 unreviewed, UNCHANGED pre-to-post (no pre-existing verified entry was downgraded); channel-wide seed-review store (visual-kit/_staging/review.json): +1 record (the tile)</div>
    <div><strong>OPEN ITEM</strong>L84 (audit-room) did not clear the warm-bias bar after its one sanctioned retry -- see its card below for the ruling this needs</div>
  </div>
</header>'''

    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Warm-Neutrals Plate Remint Board</title>
<style>
:root{{--bg:#091018;--panel:#111c28;--panel2:#17283a;--line:#34495d;--text:#f3f7fb;--muted:#adc0d2;--ok:#83dfa1;--bad:#ff897d;--warn:#ffd36a;--ref:#9ac9ff}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}}
h1,h2,h3,p{{margin:0}}.top,main{{max-width:1500px;margin:auto}}
.top{{padding:22px 20px;background:#0d1722;border-bottom:1px solid var(--line)}}h1{{font-size:26px}}.muted{{color:var(--muted);margin-top:6px}}
.summary{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:16px}}
.summary div{{padding:12px;background:var(--panel);border:1px solid var(--line);font-size:13px}}
.summary strong{{display:block;margin-bottom:5px;color:var(--ref);letter-spacing:.03em}}
main{{padding:22px 20px 60px;display:flex;flex-direction:column;gap:18px}}
.pcard{{background:#0d1722;border:1px solid var(--line);padding:14px}}
.pcard header{{display:flex;justify-content:space-between;align-items:center}}
.pcard header strong{{font-size:17px}}
.tag{{padding:3px 10px;font-size:11px;font-weight:800;letter-spacing:.05em;border-radius:3px}}
.tag.verified{{background:#123222;color:var(--ok);border:1px solid #397b4e}}
.tag.parked{{background:#3a2024;color:var(--bad);border:1px solid #803b41}}
.sub{{font-size:12px;color:var(--muted);margin-top:4px}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}}
.half{{position:relative}}
.halflabel{{position:absolute;top:8px;left:8px;padding:3px 8px;font-size:11px;font-weight:850;letter-spacing:.06em;background:rgba(6,12,18,.88);border:2px solid var(--bad);color:var(--bad);z-index:1}}
.halflabel.new{{border-color:var(--ok);color:var(--ok)}}
.board-image{{display:block;width:100%;background:#030609;cursor:zoom-in;border:1px solid var(--line)}}
.summary_p,.summary{{}}
.pcard .summary{{font-size:13px;color:var(--muted);margin-top:12px}}
#lightbox{{display:none;position:fixed;inset:0;z-index:10;padding:28px 64px;background:rgba(0,0,0,.96)}}
#lightbox.open{{display:grid;place-items:center}}
#lightbox img{{display:block;max-width:92vw;max-height:85vh;object-fit:contain;background:#030609}}
#lb-caption{{margin-top:9px;color:var(--muted);text-align:center;max-width:80vw}}
#lightbox button{{position:fixed;border:1px solid #626d7a;background:#171c23;color:var(--text);padding:8px 12px;font:22px/1 system-ui,sans-serif;cursor:pointer}}
#lb-close{{top:16px;right:16px;font-size:14px!important}}#lb-prev{{left:16px;top:50%}}#lb-next{{right:16px;top:50%}}
@media(max-width:760px){{.summary,.pair{{grid-template-columns:1fr}}#lightbox{{padding:20px}}}}
</style></head><body>
{header}
<main>
{tile_card}
{place_cards}
</main>
<div id="lightbox" aria-hidden="true"><div><img id="lb-image" alt=""><div id="lb-caption"></div></div><button id="lb-close" type="button">Esc</button><button id="lb-prev" type="button" aria-label="Previous image">&lt;</button><button id="lb-next" type="button" aria-label="Next image">&gt;</button></div>
<script>(()=>{{const box=document.getElementById('lightbox'),image=document.getElementById('lb-image'),caption=document.getElementById('lb-caption'),images=[...document.querySelectorAll('.board-image')];let index=0;const show=next=>{{index=(next+images.length)%images.length;const current=images[index];image.src=current.src;image.alt=current.alt;caption.textContent=current.alt;box.classList.add('open');box.setAttribute('aria-hidden','false')}};const close=()=>{{box.classList.remove('open');box.setAttribute('aria-hidden','true');image.removeAttribute('src')}};images.forEach((node,i)=>node.addEventListener('click',()=>show(i)));document.getElementById('lb-close').addEventListener('click',close);document.getElementById('lb-prev').addEventListener('click',()=>show(index-1));document.getElementById('lb-next').addEventListener('click',()=>show(index+1));document.addEventListener('keydown',event=>{{if(!box.classList.contains('open'))return;if(event.key==='Escape')close();if(event.key==='ArrowLeft')show(index-1);if(event.key==='ArrowRight')show(index+1)}});box.addEventListener('click',event=>{{if(event.target===box)close()}})}})();</script>
</body></html>'''


def main():
    document = render()
    OUT.write_text(document, encoding="utf-8")
    size = OUT.stat().st_size
    if size >= MAX_BYTES:
        raise AssertionError(f"Board exceeds 16 MiB: {size:,} bytes")
    print(f"wrote {OUT}: {size:,} bytes")


if __name__ == "__main__":
    main()
