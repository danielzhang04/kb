"""Build the self-contained Wave-1-v3 seed board; writes only seed-board.html."""
from __future__ import annotations

import base64
import html
import io
import json
import re
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
DATE = "2026-08-14"
FLAGS = {
    "drive-maker": "plays both the anonymous drive trade (L18-L21) and Maxtor (L233/L234) — Daniel taste call",
    "brick-foreman": "50-shot spine of acts 3-7",
    "trial-judge": "full-rim readers accepted by Daniel ruling 2026-08-13 (round-0 frame); registry/shots amended to match",
    "hr-officer": "re-run canonical verified pair w12; superseded frame retained as inset",
}
REMINTS = ("action-offering", "action-slump", "expr-laughing", "handshake")
PLATES = (
    ("L28", "miniscribe-floor", "G4 standing exemplar", None),
    ("L65", "wiles-office", "w21", "~24%"),
    ("L84", "audit-room", "w23", "~29%"),
    ("L86", "miniscribe-warehouse", "w21", "~33%"),
    ("L112", "rented-warehouse", "w12", None),
    ("L114", "colorado-brick-yard", "w8", None),
    ("L198", "jury-courtroom", "w21", "~28.5%"),
)
CAST_SCENES = ("L29", "L33", "L38", "L44", "L46", "L169")
PROPS = ("prop-drive.png", "prop-beige-pc.png")
STYLE_ANCHORS = (
    ("scene-style-tile.png", "register seed only — line weight and palette; never content"),
    ("lettering-marker-italic.png", "lettering seed only — diegetic marker register; never content"),
)


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


def image_data(path: Path, edge: int) -> str:
    with Image.open(path) as source:
        image = source.copy()
    image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=86, method=6)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def build(edge: int) -> tuple[str, dict[str, int], list[str]]:
    registry = json.loads((KIT / "registry" / "registry.json").read_text(encoding="utf-8"))
    shots = json.loads((VIDEO / "shots.json").read_text(encoding="utf-8"))["long_form"]["shots"]
    images: list[Path] = []
    anomalies: list[str] = []

    def card(path: Path | None, caption: str, section: str, extra: str = "") -> str:
        safe = html.escape(caption)
        if path is None or not path.is_file():
            anomalies.append(f"MISSING: {caption}")
            return f'<article class="card {extra}"><div class="missing">MISSING</div><p>{safe}</p></article>'
        images.append(path)
        return (f'<article class="card {extra}"><img class="board-image" data-section="{section}" '
                f'src="{image_data(path, edge)}" alt="{safe}" loading="lazy"><p>{safe}</p></article>')

    def inset(path: Path | None, caption: str, section: str) -> str:
        if path is None or not path.is_file():
            anomalies.append(f"MISSING: {caption}")
            return '<div class="inset missing-inset">MISSING inset</div>'
        images.append(path)
        return (f'<div class="inset"><img class="board-image" data-section="{section}" src="{image_data(path, edge)}" '
                f'alt="{html.escape(caption)}" loading="lazy"><span>{html.escape(caption)}</span></div>')

    cast = []
    for slug, row in registry["characters"].items():
        count = sum(shot_mentions(shot, slug) for shot in shots)
        if count:
            cast.append((slug, row, count, ORG / row["base"]))
    cast.sort(key=lambda item: (-item[2], item[0]))
    assert len(cast) == 17, f"cast inventory expected 17, found {len(cast)}"
    cast_cards = []
    for slug, row, count, base_path in cast:
        flag = FLAGS.get(slug)
        backup = base_path.with_name("hr-officer-superseded-2026-08-13.png") if slug == "hr-officer" else None
        visual = card(base_path, slug, "cast").replace('<article class="card ">', '<article class="card cast-image">')
        visual = visual[:-10] + (inset(backup, "superseded 2026-08-13 (Daniel re-run)", "cast") if backup else "") + "</article>"
        flag_html = f'<div class="flag-note">{html.escape(flag)}</div>' if flag else ""
        cast_cards.append('<article class="cast-card ' + ("flagged" if flag else "") + '"><div class="cast-visual">' + visual +
                          '</div><div class="meta"><strong>' + html.escape(slug) + f'</strong><span>{count} shots</span>' +
                          f'<div class="line">{html.escape(one_line(row.get("role", "")))}</div>' +
                          f'<div class="line costume">{html.escape(one_line(row.get("costume", "")))}</div>{flag_html}</div></article>')

    crowd_headline = card(VIDEO / "assets" / "library" / "crowd-exemplar.png", "promoted r3 headline — verified 11/11 (pair A3/B3); 5 figures per channel-seed precedent", "crowd", "headline")
    crowd_seed = card(REFS / "base" / "crowd-exemplar.png", "channel seed", "crowd")
    crowd_failures = "".join((
        card(KIT / "_staging" / "crowd-exemplar.png", "task-14 exemplar — 4.4 heads (proportion fail)", "crowd", "failed"),
        card(KIT / "_staging" / "crowd-exemplar-reroll-candidate.png", "r1 — leggy 3.91 (proportion drift)", "crowd", "failed"),
        card(KIT / "_staging" / "crowd-exemplar-reroll-r2-candidate.png", "r2 — uniform 1.5-HW legs + ears (rig/proportion fail)", "crowd", "failed"),
    ))

    plate_cards = "".join(card(VIDEO / "assets" / "scenes" / f"{sid}.png",
                                 f"{place} · {sid} · {round_name}" + (f" · zone {zone}" if zone else "") +
                                 "; history: round 3 after composition-law + payload re-author", "plates", "promoted")
                           for sid, place, round_name, zone in PLATES)

    base_paths = sorted((REFS / "base").glob("*.png"))
    deleted = {"expr-pleading.png", "expr-shock.png", "action-tugofwar.png"}
    assert not (deleted & {path.name for path in base_paths}), "deleted-by-ruling refs unexpectedly present"
    primitive_cards = []
    for path in base_paths:
        caption = path.stem
        if path.stem == "handshake":
            caption += " — re-rolled per Daniel head/eye ruling, verified w19"
        rendered = card(path, caption, "primitives")
        if path.stem in REMINTS:
            old = path.with_name(path.stem + "-pre-rerun-2026-08-13.png")
            rendered = rendered[:-10] + '<div class="remint">re-minted 2026-08-13</div>' + inset(old, old.stem, "primitives") + "</article>"
        primitive_cards.append(rendered)

    prop_cards = "".join(card(REFS / "env" / name, Path(name).stem, "props") for name in PROPS)
    anchor_cards = "".join(card(REFS / "env" / name, caption, "anchors") for name, caption in STYLE_ANCHORS)
    scene_cards = "".join(card(VIDEO / "assets" / "scenes" / f"{sid}.png", f"{sid} — cast-bearing — NOT plates; G4-verified", "scenes") for sid in CAST_SCENES)
    owed_rows = (
        ("L96", "audit-room", "designated variant A; figure-free; place-anchor wiring owed at Pass-1"),
        ("L230", "jury-courtroom", "designated variant A; crowd present; re-judge and prefer a figure-free frame before anchor wiring"),
        ("L232", "miniscribe-floor", "designated variant A; figure-free; place-anchor wiring owed at Pass-1"),
        ("Wave 2", "134 cards", "deferred after Wave-1 close-out"),
    )
    owed_html = "".join(f"<tr><td>{html.escape(a)}</td><td>{html.escape(b)}</td><td>{html.escape(c)}</td></tr>" for a, b, c in owed_rows)
    counts = {"cast": len(cast), "flags": len(FLAGS), "crowd": 5, "plates": len(PLATES), "primitives": len(base_paths),
              "props": len(PROPS), "anchors": len(STYLE_ANCHORS), "scenes": len(CAST_SCENES), "images": len(images)}
    content = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bricks Seed Board</title><style>
:root{{color-scheme:dark;--bg:#090909;--panel:#111;--line:#303030;--text:#eee;--muted:#aaa;--yellow:#f1d34b;--red:#ff6464}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.35 ui-sans-serif,system-ui,sans-serif}}header,main{{max-width:1600px;margin:auto;padding:22px}}header{{border-bottom:1px solid var(--line)}}h1{{margin:0 0 4px;font-size:25px}}h2{{margin:0;font-size:19px}}h3{{margin:18px 0 8px;font-size:14px}}p,.sub,.counts,.section-note{{color:var(--muted)}}.counts{{font-size:12px}}section{{padding:24px 0;border-bottom:1px solid var(--line)}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:14px}}.card,.cast-card{{background:var(--panel);border:1px solid var(--line);min-width:0}}.card img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#050505;cursor:zoom-in}}.card p{{margin:7px 8px 8px;overflow-wrap:anywhere;color:var(--muted);font-size:12px}}.cast-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:14px}}.cast-card{{display:grid;grid-template-columns:120px 1fr}}.cast-visual{{position:relative}}.cast-image{{border:0}}.cast-image img{{aspect-ratio:2/3}}.cast-image p{{display:none}}.meta{{padding:10px;min-width:0}}.meta strong{{display:block}}.meta>span,.line{{color:var(--muted);font-size:12px}}.line{{margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.costume{{color:#ccc}}.flagged{{border-color:var(--yellow)}}.flag-note{{margin-top:9px;color:var(--yellow);font-size:12px}}.inset{{position:relative;margin:6px;max-width:104px;border:1px solid #666;background:#050505}}.inset img{{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;cursor:zoom-in}}.inset span,.remint{{display:block;padding:3px 5px;color:var(--muted);font-size:10px;overflow-wrap:anywhere}}.cast-visual>.inset{{position:absolute;right:0;bottom:0;margin:4px;width:58px}}.crowd-layout{{display:grid;grid-template-columns:minmax(320px,2fr) minmax(200px,1fr);gap:12px;margin-top:14px}}.headline{{border-color:var(--yellow)}}.headline img{{aspect-ratio:16/10}}.failed-strip{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}}.failed img{{aspect-ratio:16/9;max-height:135px}}.promoted{{border-color:#719c74}}.missing{{min-height:130px;display:grid;place-items:center;padding:12px;color:var(--red);font-weight:800;border:2px solid var(--red)}}table{{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}}th,td{{text-align:left;vertical-align:top;padding:8px;border:1px solid var(--line)}}th{{color:var(--muted);font-weight:600}}#lightbox{{display:none;position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.96);padding:30px}}#lightbox.open{{display:grid;place-items:center}}#lightbox img{{max-width:94vw;max-height:88vh;object-fit:contain}}#lightbox .light-caption{{color:var(--muted);margin-top:9px;text-align:center}}#lightbox button{{position:fixed;background:#161616;color:var(--text);border:1px solid #555;font:inherit;padding:8px 11px;cursor:pointer}}#lb-close{{top:16px;right:16px}}#lb-prev{{left:16px;top:50%}}#lb-next{{right:16px;top:50%}}@media(max-width:600px){{header,main{{padding:14px}}.cast-grid,.crowd-layout,.failed-strip{{grid-template-columns:1fr}}.cast-card{{grid-template-columns:100px 1fr}}#lb-prev,#lb-next{{top:auto;bottom:18px}}#lb-prev{{left:25%}}#lb-next{{right:25%}}}}</style></head><body>
<header><h1>Bricks Seed Board</h1><p class="sub">2026-07-28-bricks-fresh · Wave-1 close-out · {DATE} · categories are intentionally non-mixed.</p><p class="counts">cast {counts["cast"]} · flags {counts["flags"]} · crowd {counts["crowd"]} · enviro plates {counts["plates"]} · refs/base {counts["primitives"]} · props {counts["props"]} · style anchors {counts["anchors"]} · cast-bearing scenes {counts["scenes"]} · embeds {counts["images"]}</p></header><main>
<section id="cast"><h2>Cast canonicals ({counts["cast"]})</h2><div class="cast-grid">{''.join(cast_cards)}</div></section>
<section id="crowd"><h2>Crowd anchor ({counts["crowd"]})</h2><div class="crowd-layout">{crowd_headline}{crowd_seed}</div><h3>Failed rounds — compact mechanism record</h3><div class="failed-strip">{crowd_failures}</div></section>
<section id="plates"><h2>Enviro plates ({counts["plates"]}, cast-free ONLY)</h2><p class="section-note">History captions identify the round-3 composition-law + payload re-author class. These are places, never cast-bearing scene frames.</p><div class="grid">{plate_cards}</div></section>
<section id="primitives"><h2>Primitives — refs/base ({counts["primitives"]})</h2><p class="section-note">Re-enumerated from refs/base/*.png. expr-pleading, expr-shock, action-tugofwar removed by Daniel ruling. 18 grandfather stamps remain; four re-mints are paired to their pre-rerun frame.</p><div class="grid">{''.join(primitive_cards)}</div></section>
<section id="props"><h2>Props ({counts["props"]})</h2><p class="section-note">Only recurring prop refs; environment and style references are intentionally elsewhere.</p><div class="grid">{prop_cards}</div></section>
<section id="anchors"><h2>Style anchors ({counts["anchors"]})</h2><p class="section-note">Register and lettering seeds only — never narrative content, layout, or place.</p><div class="grid">{anchor_cards}</div></section>
<section id="scenes"><h2>Approved cast-bearing scene frames ({counts["scenes"]})</h2><p class="section-note">G4-verified cast-bearing frames — NOT plates.</p><div class="grid">{scene_cards}</div></section>
<section id="poyais"><p class="section-note">Poyais footnote: the restored Poyais-era mechanism remains the shared style register; it is not a content reference or a license to mix scene categories.</p></section>
<section id="owed"><h2>Owed later</h2><table><thead><tr><th>Item</th><th>Scope</th><th>Status</th></tr></thead><tbody>{owed_html}</tbody></table></section>
</main><div id="lightbox" aria-hidden="true"><button id="lb-close" aria-label="Close">Esc</button><button id="lb-prev" aria-label="Previous">←</button><div><img id="lb-image" alt=""><div id="lb-caption" class="light-caption"></div></div><button id="lb-next" aria-label="Next">→</button></div><script>(()=>{{const b=document.getElementById('lightbox'),i=document.getElementById('lb-image'),c=document.getElementById('lb-caption');let a=[],n=0;function o(x){{n=(x+a.length)%a.length;const e=a[n];i.src=e.src;i.alt=e.alt;c.textContent=e.alt;b.classList.add('open');b.setAttribute('aria-hidden','false')}}document.querySelectorAll('.board-image').forEach(e=>e.addEventListener('click',()=>{{a=[...document.querySelectorAll('.board-image[data-section="'+e.dataset.section+'"])];o(a.indexOf(e))}}));function q(){{b.classList.remove('open');b.setAttribute('aria-hidden','true');i.removeAttribute('src')}}document.getElementById('lb-close').onclick=q;document.getElementById('lb-prev').onclick=()=>o(n-1);document.getElementById('lb-next').onclick=()=>o(n+1);document.addEventListener('keydown',e=>{{if(!b.classList.contains('open'))return;if(e.key==='Escape')q();if(e.key==='ArrowLeft')o(n-1);if(e.key==='ArrowRight')o(n+1)}});b.addEventListener('click',e=>{{if(e.target===b)q()}}) }})();</script></body></html>'''
    return content, counts, anomalies


def verify(output: str, counts: dict[str, int]) -> None:
    sources = re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', output)
    assert len(sources) == counts["images"], (len(sources), counts["images"])
    assert all(source.startswith("data:image/") for source in sources)
    assert "file://" not in output.lower()
    sections = Counter(re.findall(r'<img\b[^>]*\bdata-section="([^"]+)"', output))
    expected = {"cast": counts["cast"] + 1, "crowd": counts["crowd"], "plates": 7,
                "primitives": counts["primitives"] + 4, "props": 2, "anchors": 2, "scenes": 6}
    assert dict(sections) == expected, (dict(sections), expected)
    assert "Enviro plates (7, cast-free ONLY)" in output
    assert "cast-bearing — NOT plates" in output
    assert "PARKED" not in output and "Props (2)" in output and "Wave 2" in output and "134 cards" in output
    for sid in (*[item[0] for item in PLATES], *CAST_SCENES):
        assert sid in output, sid


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
    print(json.dumps({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size, "max_edge": edge, "counts": counts,
                      "anomalies": anomalies}, indent=2))


if __name__ == "__main__":
    main()
