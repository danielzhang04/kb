#!/usr/bin/env python3
"""Build the standalone W2 R2 engine-duel evidence board.

Adapted from ../w2-slice/build_duel_board.py: same 10 fig-* card specs
re-minted through the sanctioned harness (run r2), fresh verifier pair.
"""
import base64
import html
import io
import json
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[5]
OUT = HERE / "duel-board.html"
ITEMS = HERE / "fig-items.json"
VERDICTS = HERE / "verdicts" / "merged.json"
MAX_BYTES = 10 * 1024 * 1024
FINAL_EDGE = 900
REF_EDGE = 400
THUMB_EDGE = 300


def ascii_text(value):
    """Keep all generated markup and visible text strictly ASCII."""
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")
    return value.replace("--", "-")


def load_cards():
    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    verdict_data = json.loads(VERDICTS.read_text(encoding="utf-8"))
    if not isinstance(items, list) or len(items) != 10:
        raise ValueError("Expected exactly 10 W2 r2 items")

    verdicts = {(entry["arm"], entry["card"]): entry for entry in verdict_data["cards"]}
    cards = []
    for item in items:
        name = item["name"]
        roles = {role["role"]: PROJECT / role["path"] for role in item["seed_roles"]}
        if set(roles) - {"canonical", "expression", "pose"} or "canonical" not in roles or "pose" not in roles:
            raise ValueError(f"Unexpected seed roles for {name}: {sorted(roles)}")
        arms = {}
        for arm in ("pro", "flash"):
            final = HERE / arm / f"{name}.png"
            verdict = verdicts.get((arm, name))
            if not verdict or not final.is_file():
                raise FileNotFoundError(f"Missing final or verdict for {arm}/{name}")
            arms[arm] = {"path": final, "verdict": verdict}
        for role, path in roles.items():
            if not path.is_file():
                raise FileNotFoundError(f"Missing {role} reference for {name}: {path}")
        cast = next(role["character"] for role in item["seed_roles"] if role["role"] == "canonical")
        cards.append({"name": name, "cast": cast, "roles": roles, "arms": arms})

    if len(verdicts) != 20 or len({card["name"] for card in cards}) != 10:
        raise ValueError("Input card/verdict count mismatch")
    return sorted(cards, key=lambda card: (card["cast"], card["name"]))


def jpeg_uri(path, max_edge, quality=76):
    """Return a size-capped JPEG data URI, preserving aspect ratio."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        if max(image.size) > max_edge:
            ratio = max_edge / max(image.size)
            image = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)
        if max(image.size) > max_edge:
            raise AssertionError(f"Image edge cap failed for {path}")
        encoded = io.BytesIO()
        image.save(encoded, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")


def image_figure(path, label, detail, css_class, edge):
    alt = ascii_text(f"{label}: {detail}")
    return (
        f'<figure class="{css_class}"><img class="board-image" src="{jpeg_uri(path, edge)}" '
        f'alt="{html.escape(alt, quote=True)}" loading="lazy"><figcaption>{html.escape(ascii_text(label))}'
        f'<span>{html.escape(ascii_text(detail))}</span></figcaption></figure>'
    )


def arm_figure(arm, arm_data):
    verdict = arm_data["verdict"]
    status = verdict["status"]
    if status not in {"VERIFIED", "PARKED"}:
        raise ValueError(f"Unexpected status {status}")
    axes = ", ".join(verdict["fail_axes"]) or "no failed axes"
    chips = "".join(f'<span class="chip">{html.escape(ascii_text(axis))}</span>' for axis in verdict["fail_axes"])
    notes = " ".join(ascii_text(note) for note in verdict["notes"]) or "No verifier notes."
    return f'''<article class="arm arm-{arm} {status.lower()}">
  <div class="arm-heading"><strong>{arm.upper()}</strong><b>{status}</b></div>
  <div class="image-frame"><img class="board-image" src="{jpeg_uri(arm_data['path'], FINAL_EDGE)}" alt="{arm.upper()} {status}: {html.escape(ascii_text(axes), quote=True)}" loading="lazy"><span class="stamp">{status}</span></div>
  <div class="chips">{chips}</div><p class="notes">{html.escape(notes)}</p>
</article>'''


def item_section(card):
    canonical = image_figure(card["roles"]["canonical"], "CANONICAL REF", f"{card['cast']} identity", "reference", REF_EDGE)
    expression = (
        image_figure(card["roles"]["expression"], "EXPRESSION REF", "expression shape", "thumb", THUMB_EDGE)
        if "expression" in card["roles"] else '<div class="no-thumb"><strong>EXPRESSION REF</strong><span>none supplied</span></div>'
    )
    pose = image_figure(card["roles"]["pose"], "POSE REF", "body and hand placement", "thumb", THUMB_EDGE)
    return f'''<section class="item" id="{html.escape(ascii_text(card['name']), quote=True)}">
  <header><h2>{html.escape(ascii_text(card['cast']))}</h2><p>{html.escape(ascii_text(card['name']))}</p></header>
  <div class="columns"><div>{arm_figure('pro', card['arms']['pro'])}</div><div>{arm_figure('flash', card['arms']['flash'])}</div><div>{canonical}</div></div>
  <div class="reference-row">{expression}{pose}</div>
</section>'''


def render(cards, size_text):
    sections = "".join(item_section(card) for card in cards)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>W2 R2 Engine Duel</title>
<style>
:root{{--bg:#091018;--panel:#111c28;--panel2:#17283a;--line:#34495d;--text:#f3f7fb;--muted:#adc0d2;--pro:#9ce7aa;--flash:#ffd36a;--ref:#9ac9ff;--ok:#83dfa1;--bad:#ff897d}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}}h1,h2,p{{margin:0}}.top,main,.verdict{{max-width:1800px;margin:auto}}.top{{padding:22px 20px;background:#0d1722;border-bottom:1px solid var(--line)}}h1{{font-size:30px}}.muted{{color:var(--muted);margin-top:5px}}.summary{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}}.summary div{{padding:12px;background:var(--panel);border:1px solid var(--line)}}.summary strong{{display:block;margin-bottom:4px}}.summary .drift{{grid-column:1/-1;background:#241621;border-color:#6a3350}}main{{padding:22px 20px 0}}.item{{margin-bottom:22px;background:#0d1722;border:1px solid var(--line)}}.item header{{padding:13px 16px;background:var(--panel2);border-bottom:1px solid var(--line)}}h2{{font-size:17px;text-transform:uppercase}}.item header p{{color:var(--muted);font-size:12px;margin-top:4px;overflow-wrap:anywhere}}.columns{{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(170px,.52fr);gap:14px;padding:16px 16px 10px}}.arm,figure{{margin:0;padding:8px;background:var(--panel);border:1px solid var(--line)}}.arm img,figure img{{display:block;width:100%;background:#030609;cursor:zoom-in}}.image-frame{{position:relative}}.stamp{{position:absolute;top:10px;right:10px;padding:4px 7px;border:2px solid currentColor;background:rgba(6,12,18,.88);font-size:12px;font-weight:850;letter-spacing:.07em}}.arm-heading{{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;letter-spacing:.04em}}.arm-pro strong{{color:var(--pro)}}.arm-flash strong{{color:var(--flash)}}.verified{{border-color:#397b4e}}.verified b,.verified .stamp{{color:var(--ok)}}.parked{{border-color:#853d3a}}.parked b,.parked .stamp{{color:var(--bad)}}.chips{{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}}.chip{{padding:2px 6px;border-radius:10px;background:#3a2024;border:1px solid #803b41;color:#ffc3bd;font-size:11px}}.notes{{margin-top:8px;color:var(--muted);font-size:12px}}figcaption{{padding-top:7px;font-size:12px;font-weight:750;color:var(--ref)}}figcaption span{{display:block;font-weight:500;color:var(--muted);margin-top:2px}}.reference-row{{display:flex;gap:10px;flex-wrap:wrap;padding:0 16px 16px}}.thumb,.no-thumb{{width:min(300px,100%);padding:8px;background:var(--panel);border:1px solid var(--line)}}.no-thumb{{display:grid;gap:3px;color:var(--muted);font-size:12px}}.no-thumb strong{{color:var(--ref)}}.verdict{{margin-top:4px;padding:18px 20px;background:#213a35;border-top:2px solid #6fba9f;color:#e8fff5;font-weight:650}}.override{{display:block;margin-top:9px;padding:9px;border:1px dashed #9ce7aa;color:#fff}}#lightbox{{display:none;position:fixed;inset:0;z-index:10;padding:28px 64px;background:rgba(0,0,0,.96)}}#lightbox.open{{display:grid;place-items:center}}#lightbox img{{display:block;max-width:92vw;max-height:85vh;object-fit:contain;background:#030609}}#lb-caption{{margin-top:9px;color:var(--muted);text-align:center}}#lightbox button{{position:fixed;border:1px solid #626d7a;background:#171c23;color:var(--text);padding:8px 12px;font:22px/1 system-ui,sans-serif;cursor:pointer}}#lb-close{{top:16px;right:16px;font-size:14px!important}}#lb-prev{{left:16px;top:50%}}#lb-next{{right:16px;top:50%}}@media(max-width:760px){{.summary,.columns{{grid-template-columns:1fr}}#lightbox{{padding:20px}}}}
</style></head><body>
<header class="top"><h1>W2 R2 Engine Duel</h1><p class="muted">W6 coordinator harness re-mint (run r2), K=2, forge-only generation, same 10 fig-* card specs as the w2-slice round-1 duel. Embedded board: {size_text}.</p><div class="summary"><div><strong>HARNESS RESULTS</strong>Pro: 10/10 staged, 10 calls, 0 retries, $1.34. Flash: 10/10 staged, 10 calls, 0 retries, $0.39.</div><div><strong>STRICT FRESH-EYES MERGE (R2)</strong>Verifier pair A identity/rig and B fidelity/style: pro 0/10 verified, flash 0/10. Excluding systemic B:framing ground-line: pro 5/10, flash 0/10.</div><div><strong>MECHANISM 1: OBJECT NOUNS</strong>Engine-independent, forge-side: beat-clause object nouns still override the clean-card fence. Pro leaked objects on 4/10 cards (was 3/10 in r1); flash on 6/10 (unchanged).</div><div><strong>MECHANISM 2: GROUND LINE</strong>Engine-independent, forge-side: the thin visible ground line was lost in 18/20 cards this round (was 14/20 in r1) - the defect worsened, not improved, on re-mint.</div><div class="drift"><strong>ROUND-1 TO ROUND-2 DRIFT</strong>Round-1 duel (w2-slice, same 10 specs): pro 1/10 strict, flash 0/10 strict; excluding ground-line pro 3/10, flash 2/10. Round-2 re-mint on identical specs: pro 0/10 strict (down from 1/10), flash 0/10 strict (flat); excluding ground-line pro 5/10 (up from 3/10), flash 0/10 (down from 2/10). Re-minting from the same specs did not fix either forge mechanism, and flash's ground-line rate got strictly worse.</div></div></header>
<main>{sections}</main><footer class="verdict"><strong>ENGINE RULING (DANIEL)</strong> pro remains stronger on content axes but strict-passed 0/10 this round (was 1/10 in r1); flash strict-passed 0/10 both rounds. Both arms are still blocked by the two forge mechanisms above, and mechanism 2 (ground line) got worse on re-mint - fix forge before spending on another re-mint.<span class="override">OVERRIDE: ________________________________________________</span></footer>
<div id="lightbox" aria-hidden="true"><div><img id="lb-image" alt=""><div id="lb-caption"></div></div><button id="lb-close" type="button">Esc</button><button id="lb-prev" type="button" aria-label="Previous image">&lt;</button><button id="lb-next" type="button" aria-label="Next image">&gt;</button></div>
<script>(()=>{{const box=document.getElementById('lightbox'),image=document.getElementById('lb-image'),caption=document.getElementById('lb-caption'),images=[...document.querySelectorAll('.board-image')];let index=0;const show=next=>{{index=(next+images.length)%images.length;const current=images[index];image.src=current.src;image.alt=current.alt;caption.textContent=current.alt;box.classList.add('open');box.setAttribute('aria-hidden','false')}};const close=()=>{{box.classList.remove('open');box.setAttribute('aria-hidden','true');image.removeAttribute('src')}};images.forEach((node,i)=>node.addEventListener('click',()=>show(i)));document.getElementById('lb-close').addEventListener('click',close);document.getElementById('lb-prev').addEventListener('click',()=>show(index-1));document.getElementById('lb-next').addEventListener('click',()=>show(index+1));document.addEventListener('keydown',event=>{{if(!box.classList.contains('open'))return;if(event.key==='Escape')close();if(event.key==='ArrowLeft')show(index-1);if(event.key==='ArrowRight')show(index+1)}});box.addEventListener('click',event=>{{if(event.target===box)close()}})}})();</script></body></html>'''


def verify_document(document):
    if not document.isascii():
        raise AssertionError("Board is not ASCII")
    image_count = document.count('class="board-image"')
    embedded_count = document.count("data:image/jpeg;base64,")
    if (image_count, embedded_count) != (49, 49):
        raise AssertionError(f"Expected 49 embedded board images, got {image_count}/{embedded_count}")
    if document.count("<section class=\"item\"") != 10:
        raise AssertionError("Expected 10 card sections")
    if "<title>W2 R2 Engine Duel</title>" not in document:
        raise AssertionError("Missing required title")


def main():
    cards = load_cards()
    for card in cards:
        for arm in card["arms"].values():
            Image.open(arm["path"]).verify()
        for path in card["roles"].values():
            Image.open(path).verify()

    size_text = "calculating"
    for _ in range(4):
        OUT.write_text(render(cards, size_text), encoding="ascii")
        next_size = f"{OUT.stat().st_size:,} bytes"
        if next_size == size_text:
            break
        size_text = next_size
    else:
        raise RuntimeError("Board byte-size display did not stabilize")

    document = OUT.read_text(encoding="ascii")
    verify_document(document)
    if OUT.stat().st_size >= MAX_BYTES:
        raise AssertionError(f"Board exceeds 10 MiB: {OUT.stat().st_size:,} bytes")
    print(f"wrote {OUT}: {OUT.stat().st_size:,} bytes; 49 embedded JPEGs")


if __name__ == "__main__":
    main()
