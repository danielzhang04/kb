"""Build the self-contained Wave-1-v2 seed board; writes only seed-board.html."""
from __future__ import annotations

import base64
import html
import io
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
VIDEO = HERE.parents[1]
CHANNEL = VIDEO.parents[1]
ORG = CHANNEL.parents[1]
KIT = CHANNEL / "visual-kit"
REFS = KIT / "refs"
OUTPUT = HERE / "seed-board.html"
MAX_BYTES = 14 * 1024 * 1024
DATE = "2026-08-13"

# The board deliberately carries the four human-relevant callouts, not every verified retry.
FLAGS = {
    "drive-maker": "plays both the anonymous drive trade (L18-L21) and Maxtor (L233/L234) — Daniel taste call",
    "brick-foreman": "50-shot spine of acts 3-7",
    "trial-judge": "full-rim readers accepted by Daniel ruling 2026-08-13 (round-0 frame); registry/shots amended to match",
    "hr-officer": "re-run canonical verified pair w12; superseded frame retained as inset",
}
REMINTS = ("action-offering", "action-slump", "expr-laughing", "handshake")
PROMOTED_PLATES = (("L84", "audit-room", "w8"), ("L114", "colorado-brick-yard", "w8"),
                   ("L198", "jury-courtroom", "w8"), ("L65", "wiles-office", "w12"),
                   ("L112", "rented-warehouse", "w12"))
ORIGINAL_SCENES = ("L28", "L29", "L33", "L38", "L44", "L46", "L169")


def one_line(value: str) -> str:
    return " ".join(value.split())


def shot_mentions(shot: dict, slug: str) -> bool:
    if re.search(rf"`{re.escape(slug)}`", shot.get("still_prompt", "")):
        return True

    def contains(value: object) -> bool:
        if isinstance(value, str):
            return value == slug
        if isinstance(value, dict):
            return any(contains(key) or contains(item) for key, item in value.items())
        if isinstance(value, list):
            return any(contains(item) for item in value)
        return False

    return contains(shot.get("figures"))


def image_data(path: Path, max_edge: int) -> str:
    with Image.open(path) as source:
        image = source.copy()
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=86, method=6)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def build(max_edge: int) -> tuple[str, dict[str, int], list[str]]:
    registry = json.loads((KIT / "registry" / "registry.json").read_text(encoding="utf-8"))
    shots = json.loads((VIDEO / "shots.json").read_text(encoding="utf-8"))["long_form"]["shots"]
    images: list[Path] = []
    anomalies: list[str] = []

    def image_card(path: Path | None, caption: str, section: str, extra: str = "") -> str:
        safe_caption = html.escape(caption)
        if path is None or not path.is_file():
            anomalies.append(f"MISSING: {caption}")
            return f'<article class="card {extra}"><div class="missing">MISSING</div><p>{safe_caption}</p></article>'
        images.append(path)
        return (f'<article class="card {extra}"><img class="board-image" data-section="{section}" '
                f'src="{image_data(path, max_edge)}" alt="{safe_caption}" loading="lazy"><p>{safe_caption}</p></article>')

    def inset(path: Path | None, caption: str, section: str) -> str:
        if path is None or not path.is_file():
            anomalies.append(f"MISSING: {caption}")
            return '<div class="inset missing-inset">MISSING inset</div>'
        images.append(path)
        return (f'<div class="inset"><img class="board-image" data-section="{section}" src="{image_data(path, max_edge)}" '
                f'alt="{html.escape(caption)}" loading="lazy"><span>{html.escape(caption)}</span></div>')

    characters = registry["characters"]
    cast = []
    for slug, row in characters.items():
        count = sum(shot_mentions(shot, slug) for shot in shots)
        if count:
            cast.append((slug, row, count, ORG / row["base"]))
    cast.sort(key=lambda item: (-item[2], item[0]))
    if len(cast) != 17:
        anomalies.append(f"CAST INVENTORY: expected 17, found {len(cast)}")

    cast_cards = []
    for slug, row, count, base_path in cast:
        flag = FLAGS.get(slug)
        flag_html = f'<div class="flag-note">{html.escape(flag)}</div>' if flag else ""
        backup = base_path.with_name("hr-officer-superseded-2026-08-13.png") if slug == "hr-officer" else None
        inset_html = inset(backup, "superseded 2026-08-13 (Daniel re-run)", "cast") if slug == "hr-officer" else ""
        if base_path.is_file():
            images.append(base_path)
            visual = (f'<img class="board-image main-cast" data-section="cast" src="{image_data(base_path, max_edge)}" '
                      f'alt="{html.escape(slug)}" loading="lazy">')
        else:
            anomalies.append(f"MISSING: {slug}")
            visual = '<div class="missing">MISSING</div>'
        cast_cards.append(
            '<article class="cast-card ' + ("flagged" if flag else "") + '"><div class="cast-visual">' + visual + inset_html + '</div>'
            + f'<div class="meta"><strong>{html.escape(slug)}</strong><span>{count} shots</span>'
            + f'<div class="line" title="{html.escape(one_line(row.get("role", "")))}">{html.escape(one_line(row.get("role", "")))}</div>'
            + f'<div class="line costume" title="{html.escape(one_line(row.get("costume", "")))}">{html.escape(one_line(row.get("costume", "")))}</div>{flag_html}</div></article>')

    crowd_promoted = VIDEO / "assets" / "library" / "crowd-exemplar.png"
    crowd_seed = REFS / "base" / "crowd-exemplar.png"
    crowd_r1 = KIT / "_staging" / "crowd-exemplar-reroll-candidate.png"
    crowd_r2 = KIT / "_staging" / "crowd-exemplar-reroll-r2-candidate.png"
    old_crowd = KIT / "_staging" / "crowd-exemplar.png"
    crowd_headline = image_card(crowd_promoted, "promoted r3 headline — verified 11/11 (pair A3/B3); 5 figures per channel-seed precedent", "crowd", "headline")
    crowd_seed_card = image_card(crowd_seed, "channel seed", "crowd")
    crowd_failures = "".join((image_card(old_crowd, "task-14 exemplar — 4.4 heads (proportion fail)", "crowd", "failed"),
                              image_card(crowd_r1, "r1 — leggy 3.91 (proportion drift)", "crowd", "failed"),
                              image_card(crowd_r2, "r2 — uniform 1.5-HW legs + ears (rig/proportion fail)", "crowd", "failed")))

    plate_cards = "".join(image_card(VIDEO / "assets" / "scenes" / f"{sid}.png",
                                      f"{place} · {sid} · verified pair {wave}", "plates", "promoted")
                         for sid, place, wave in PROMOTED_PLATES)
    parked_l86 = ('<article class="parked"><h3>L86 — PARKED</h3><div class="pair-images">'
                  + image_card(KIT / "_staging" / "L86.png", "L86 original round", "plates", "parked-card")
                  + image_card(KIT / "_staging" / "L86-w11-retry.png", "L86 retry round", "plates", "parked-card")
                  + '</div><p>carton sheen failed flat-cel twice (identical mechanism); retry spent; ruling requested: accept-as-is / mechanism change (seed a clean carton frame) / re-author wrap prose</p></article>')

    base_paths = sorted((REFS / "base").glob("*.png"))
    deleted = {"expr-pleading.png", "expr-shock.png", "action-tugofwar.png"}
    present_deleted = deleted & {path.name for path in base_paths}
    if present_deleted:
        anomalies.append("DELETED-BY-RULING unexpectedly present: " + ", ".join(sorted(present_deleted)))
    primitive_cards = []
    for path in base_paths:
        remint_note = ""
        if path.stem in REMINTS:
            old = path.with_name(path.stem + "-pre-rerun-2026-08-13.png")
            remint_note = '<div class="remint">re-minted 2026-08-13</div>' + inset(old, old.stem, "primitives")
        primitive_cards.append(image_card(path, path.stem, "primitives")[:-10] + remint_note + '</article>')

    env_paths = sorted((REFS / "env").glob("*.png"))
    env_cards = "".join(image_card(path, path.stem, "env") for path in env_paths)
    scene_ids = ORIGINAL_SCENES + tuple(sid for sid, _, _ in PROMOTED_PLATES)
    scene_cards = "".join(image_card(VIDEO / "assets" / "scenes" / f"{sid}.png", sid, "scenes") for sid in scene_ids)

    counts = {"cast": len(cast), "flags": len(FLAGS), "crowd": 5, "plates": 6, "primitives": len(base_paths),
              "env": len(env_paths), "scenes": len(scene_ids), "images": len(images)}
    rendered = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bricks Seed Board</title><style>
:root{{color-scheme:dark;--bg:#090909;--panel:#111;--line:#303030;--text:#eee;--muted:#aaa;--yellow:#f1d34b;--red:#ff6464}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.35 ui-sans-serif,system-ui,sans-serif}}header,main{{max-width:1600px;margin:auto;padding:22px}}header{{border-bottom:1px solid var(--line)}}h1{{margin:0 0 4px;font-size:25px}}h2{{margin:0;font-size:19px}}h3{{margin:0 0 8px;font-size:15px}}p,.sub,.counts,.section-note{{color:var(--muted)}}.counts{{font-size:12px}}section{{padding:24px 0;border-bottom:1px solid var(--line)}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:14px}}.card,.cast-card,.parked{{background:var(--panel);border:1px solid var(--line);min-width:0}}.card img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#050505;cursor:zoom-in}}.card p{{margin:7px 8px 8px;overflow-wrap:anywhere;color:var(--muted);font-size:12px}}.cast-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:14px}}.cast-card{{display:grid;grid-template-columns:120px 1fr}}.cast-visual{{position:relative}}.main-cast{{display:block;width:100%;aspect-ratio:2/3;object-fit:contain;background:#050505;cursor:zoom-in}}.meta{{padding:10px;min-width:0}}.meta strong{{display:block}}.meta>span,.line{{color:var(--muted);font-size:12px}}.line{{margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.costume{{color:#ccc}}.flagged{{border-color:var(--yellow)}}.flag-note{{margin-top:9px;color:var(--yellow);font-size:12px}}.inset{{position:relative;margin:6px;max-width:104px;border:1px solid #666;background:#050505}}.inset img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;cursor:zoom-in}}.inset span,.remint{{display:block;padding:3px 5px;color:var(--muted);font-size:10px;overflow-wrap:anywhere}}.cast-visual>.inset{{position:absolute;right:0;bottom:0;margin:4px;width:58px}}.pair-images{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}.crowd-layout{{display:grid;grid-template-columns:minmax(320px,2fr) minmax(200px,1fr);gap:12px;margin-top:14px}}.headline{{border-color:var(--yellow)}}.headline img{{aspect-ratio:16/10}}.failed-strip{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}}.failed img{{aspect-ratio:16/9;max-height:135px}}.promoted{{border-color:#719c74}}.parked{{margin-top:14px;padding:12px;border-color:var(--red)}}.parked h3{{color:var(--red)}}.parked p{{margin:10px 0 0}}.parked-card{{border-color:#7a4b4b}}.missing{{min-height:130px;display:grid;place-items:center;padding:12px;color:var(--red);font-weight:800;border:2px solid var(--red)}}.missing-inset{{font-size:10px}}#lightbox{{display:none;position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.96);padding:30px}}#lightbox.open{{display:grid;place-items:center}}#lightbox img{{max-width:94vw;max-height:88vh;object-fit:contain}}#lightbox .light-caption{{color:var(--muted);margin-top:9px;text-align:center}}#lightbox button{{position:fixed;background:#161616;color:var(--text);border:1px solid #555;font:inherit;padding:8px 11px;cursor:pointer}}#lb-close{{top:16px;right:16px}}#lb-prev{{left:16px;top:50%}}#lb-next{{right:16px;top:50%}}@media(max-width:600px){{header,main{{padding:14px}}.cast-grid,.crowd-layout,.failed-strip,.pair-images{{grid-template-columns:1fr}}.cast-card{{grid-template-columns:100px 1fr}}#lb-prev,#lb-next{{top:auto;bottom:18px}}#lb-prev{{left:25%}}#lb-next{{right:25%}}}}</style></head><body>
<header><h1>Bricks Seed Board</h1><p class="sub">2026-07-28-bricks-fresh · Wave-1 final assembly · {DATE} · every shown canonical may seed from.</p><p class="counts">cast {counts["cast"]} · flags {counts["flags"]} · crowd {counts["crowd"]} · enviro plates {counts["plates"]} · refs/base {counts["primitives"]} · props + env {counts["env"]} · approved scenes {counts["scenes"]} · embeds {counts["images"]}</p></header><main>
<section id="cast"><h2>Cast canonicals ({counts["cast"]})</h2><div class="cast-grid">{''.join(cast_cards)}</div></section>
<section id="crowd"><h2>Crowd anchor ({counts["crowd"]})</h2><div class="crowd-layout">{crowd_headline}{crowd_seed_card}</div><h3>Failed rounds — compact mechanism record</h3><div class="failed-strip">{crowd_failures}</div></section>
<section id="plates"><h2>Enviro plates (6)</h2><p class="section-note">L84 note: ~10 chairs render against authored 8. L112 note: unauthored yellow diagonal floor stripe echoes L86 lane paint; this place is meant to read unmarked.</p><div class="grid">{plate_cards}</div>{parked_l86}</section>
<section id="primitives"><h2>Primitives — refs/base ({counts["primitives"]})</h2><p class="section-note">Re-enumerated from refs/base/*.png. expr-pleading, expr-shock, action-tugofwar removed by Daniel ruling. 18 grandfather stamps remain; four re-mints are paired to their pre-rerun frame.</p><div class="grid">{''.join(primitive_cards)}</div></section>
<section id="env"><h2>Props + env ({counts["env"]})</h2><div class="grid">{env_cards}</div></section>
<section id="scenes"><h2>Approved scene frames ({counts["scenes"]})</h2><p class="section-note">Original 7 plus five newly promoted Wave-1 plates.</p><div class="grid">{scene_cards}</div></section>
<section id="resting"><p class="section-note">channel-wide resting re-mint 2026-08-13 touched 3 prior-video canonicals; pre-resting backups on disk; revert available</p></section>
</main><div id="lightbox" aria-hidden="true"><button id="lb-close" aria-label="Close">Esc</button><button id="lb-prev" aria-label="Previous">←</button><div><img id="lb-image" alt=""><div id="lb-caption" class="light-caption"></div></div><button id="lb-next" aria-label="Next">→</button></div><script>(()=>{{const b=document.getElementById('lightbox'),i=document.getElementById('lb-image'),c=document.getElementById('lb-caption');let a=[],n=0;function o(x){{n=(x+a.length)%a.length;const e=a[n];i.src=e.src;i.alt=e.alt;c.textContent=e.alt;b.classList.add('open');b.setAttribute('aria-hidden','false')}}document.querySelectorAll('.board-image').forEach(e=>e.addEventListener('click',()=>{{a=[...document.querySelectorAll('.board-image[data-section="'+e.dataset.section+'"]')];o(a.indexOf(e))}}));function q(){{b.classList.remove('open');b.setAttribute('aria-hidden','true');i.removeAttribute('src')}}document.getElementById('lb-close').onclick=q;document.getElementById('lb-prev').onclick=()=>o(n-1);document.getElementById('lb-next').onclick=()=>o(n+1);document.addEventListener('keydown',e=>{{if(!b.classList.contains('open'))return;if(e.key==='Escape')q();if(e.key==='ArrowLeft')o(n-1);if(e.key==='ArrowRight')o(n+1)}});b.addEventListener('click',e=>{{if(e.target===b)q()}}) }})();</script></body></html>'''
    return rendered, counts, anomalies


def verify(output: str, counts: dict[str, int]) -> None:
    sources = re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', output)
    assert len(sources) == counts["images"], (len(sources), counts["images"])
    assert all(source.startswith("data:image/") for source in sources)
    assert "file://" not in output.lower()
    sections = Counter(re.findall(r'<img\b[^>]*\bdata-section="([^"]+)"', output))
    assert sections["cast"] == counts["cast"] + 1, sections
    assert sections["plates"] == 7 and sections["scenes"] == 12, sections
    assert "<title>Bricks Seed Board</title>" in output
    assert "Enviro plates (6)" in output and "Poyais" not in output
    assert "expr-pleading, expr-shock, action-tugofwar removed by Daniel ruling" in output


def main() -> None:
    rendered, counts, anomalies = build(640)
    edge = 640
    if len(rendered.encode("utf-8")) >= MAX_BYTES:
        rendered, counts, anomalies = build(512)
        edge = 512
    verify(rendered, counts)
    assert len(rendered.encode("utf-8")) < MAX_BYTES, "seed board exceeds 14 MB"
    OUTPUT.write_text(rendered, encoding="utf-8")
    verify(OUTPUT.read_text(encoding="utf-8"), counts)
    print(json.dumps({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size, "max_edge": edge,
                      "counts": counts, "anomalies": anomalies}, indent=2))


if __name__ == "__main__":
    main()
