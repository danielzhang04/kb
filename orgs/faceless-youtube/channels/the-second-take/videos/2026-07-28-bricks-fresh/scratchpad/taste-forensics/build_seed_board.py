"""Build the self-contained pre-generation seed board. Reads assets only; writes seed-board.html."""
from __future__ import annotations

import base64
import html
import io
import json
import re
import subprocess
from collections import Counter, defaultdict
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
VETOED_EXPRESSIONS = {"expr-shock", "expr-pleading"}
P12_VETO_CAPTION = "VETOED (P12) — FAIL-stamped, refused by the pre-gen gate by name; file retained by design"
FLAGS = {
    "drive-maker": "plays both the anonymous drive trade (L18-L21) and Maxtor (L233/L234) — Daniel taste call",
    "brick-foreman": "50-shot spine of acts 3-7",
    "trial-judge": "full-rim readers accepted by Daniel ruling 2026-08-13 (round-0 frame); registry/shots amended to match",
    "return-customer": "flat-fill retry, verified 2026-08-13 (2 disjoint verifier pairs)",
    "brick-co-seller": "flat-fill retry, verified 2026-08-13 (2 disjoint verifier pairs)",
    "hr-officer": "flat-fill retry, verified 2026-08-13 (2 disjoint verifier pairs)",
}


def one_line(value: str) -> str:
    return " ".join(value.split())


def shot_mentions(shot: dict, slug: str) -> bool:
    """Count canonical references from the current prompt-backed shot inventory.

    The live shots file stores named cast in `still_prompt`; `figures` currently only
    holds crowd flags. Check both shapes so a future structured migration keeps working.
    """
    if re.search(rf"`{re.escape(slug)}`", shot.get("still_prompt", "")):
        return True

    def contains(value: object) -> bool:
        if isinstance(value, str):
            return value == slug
        if isinstance(value, dict):
            return any(contains(k) or contains(v) for k, v in value.items())
        if isinstance(value, list):
            return any(contains(v) for v in value)
        return False

    return contains(shot.get("figures"))


def image_data(path: Path, max_edge: int) -> str:
    """Embed a max-edge WebP data URI, preserving alpha when the source has it."""
    with Image.open(path) as source:
        image = source.copy()
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=88, method=6)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def build(max_edge: int) -> tuple[str, dict[str, int], list[str]]:
    registry = json.loads((KIT / "registry" / "registry.json").read_text(encoding="utf-8"))
    shots_doc = json.loads((VIDEO / "shots.json").read_text(encoding="utf-8"))
    shots = shots_doc["long_form"]["shots"]
    images: list[Path] = []
    anomalies: list[str] = []

    def image_card(path: Path | None, caption: str, section: str, extra: str = "") -> str:
        caption = html.escape(caption)
        classes = "card " + extra
        if path is None or not path.is_file():
            anomalies.append(f"MISSING: {caption}")
            return f'<article class="{classes}"><div class="missing">MISSING</div><p>{caption}</p></article>'
        images.append(path)
        uri = image_data(path, max_edge)
        law_label = '<div class="veto-label">VETOED (P12)</div>' if extra == "veto-present" else ""
        return (
            f'<article class="{classes}"><img class="board-image" data-section="{section}" '
            f'src="{uri}" alt="{caption}" loading="lazy">{law_label}<p>{caption}</p></article>'
        )

    characters = registry["characters"]
    cast = []
    for slug, row in characters.items():
        count = sum(shot_mentions(shot, slug) for shot in shots)
        if count:
            base_path = ORG / row["base"]
            cast.append((slug, row, count, base_path))
    cast.sort(key=lambda item: (-item[2], item[0]))
    if len(cast) != 17:
        anomalies.append(f"CAST INVENTORY: expected 17 current-video canonicals, found {len(cast)}")

    cast_cards = []
    for slug, row, count, base_path in cast:
        flag = FLAGS.get(slug)
        flag_html = f'<div class="flag-note">{html.escape(flag)}</div>' if flag else ""
        visual = image_card(base_path, slug, "cast", "flagged" if flag else "")
        cast_cards.append(
            '<article class="cast-card ' + ("flagged" if flag else "") + '">'
            + visual
            + f'<div class="meta"><strong>{html.escape(slug)}</strong><span>{count} shots</span>'
            + f'<div class="line" title="{html.escape(one_line(row.get("role", "")))}">{html.escape(one_line(row.get("role", "")))}</div>'
            + f'<div class="line costume" title="{html.escape(one_line(row.get("costume", "")))}">{html.escape(one_line(row.get("costume", "")))}</div>{flag_html}</div></article>'
        )

    resting_pairs = []
    for slug in ("macgregor", "hastie", "hastie-wife"):
        current = ORG / characters[slug]["base"]
        backups = sorted(current.parent.glob(f"{current.stem}-pre-resting-2026-08-13.png"))
        backup = backups[0] if backups else None
        resting_pairs.append(
            '<article class="pair"><div class="pair-name">' + html.escape(slug) + '</div><div class="pair-images">'
            + image_card(current, f"{slug} — current", "resting")
            + image_card(backup, f"{slug} — pre-resting backup", "resting")
            + '</div></article>'
        )

    crowd_promoted = VIDEO / "assets" / "library" / "crowd-exemplar.png"
    crowd_seed = REFS / "base" / "crowd-exemplar.png"
    crowd_r1 = KIT / "_staging" / "crowd-exemplar-reroll-candidate.png"
    crowd_r2 = KIT / "_staging" / "crowd-exemplar-reroll-r2-candidate.png"
    # The task-14 per-video exemplar was git-committed before r3 superseded it.
    # Recover it only long enough to make the self-contained board, then remove it.
    repo = next(parent for parent in HERE.parents if (parent / ".git").exists())
    task14_temp = HERE / "_task-14-superseded-crowd-exemplar.png"
    task14_rel = (crowd_promoted).relative_to(repo).as_posix()
    try:
        try:
            task14_temp.write_bytes(subprocess.run(
                ["git", "show", f"1a94fa5:{task14_rel}"], cwd=repo,
                check=True, capture_output=True,
            ).stdout)
        except subprocess.CalledProcessError:
            # Video assets are gitignored in this checkout. A one-run caller may
            # supply the pre-promotion bytes at this exact temporary path.
            if not task14_temp.is_file():
                raise
        crowd_headline = image_card(
            crowd_promoted,
            "verified 11/11 (pair A3/B3), seeded-restyle of the channel frame; 5 figures per channel-seed precedent; NOTE: fig-3 dark head tone measures ~25 warm of #7a4f33 (unambiguous but inheritable) — taste glance",
            "crowd", "crowd-headline",
        )
        crowd_seed_card = image_card(crowd_seed, "channel seed", "crowd")
        crowd_failed_cards = "".join([
            image_card(task14_temp, "task-14 exemplar — 4.4 heads (proportion fail)", "crowd", "crowd-failed"),
            image_card(crowd_r1, "r1 — leggy 3.91 (proportion drift)", "crowd", "crowd-failed"),
            image_card(crowd_r2, "r2 — uniform 1.5-HW legs + ears (rig/proportion fail)", "crowd", "crowd-failed"),
        ])
    finally:
        task14_temp.unlink(missing_ok=True)

    expression_paths = sorted((REFS / "base").glob("expr-*.png"))
    expr_cards = []
    veto_present = []
    for path in expression_paths:
        slug = path.stem
        extra = "veto-present" if slug in VETOED_EXPRESSIONS else ""
        if slug in VETOED_EXPRESSIONS:
            veto_present.append(slug)
        caption = P12_VETO_CAPTION if slug in VETOED_EXPRESSIONS else slug
        expr_cards.append(image_card(path, caption, "expressions", extra))
    for slug in sorted(VETOED_EXPRESSIONS - set(veto_present)):
        expr_cards.append('<article class="card"><div class="law-ok">ABSENT-BY-LAW</div><p>' + slug + '</p></article>')

    primitive_groups: dict[str, list[Path]] = defaultdict(list)
    for path in sorted((REFS / "base").glob("*.png")):
        # crowd-exemplar is already shown in its dedicated contrast section; base.png
        # remains here because it is the rig anchor and can seed a new character mint.
        if path.name == "crowd-exemplar.png" or path.stem.startswith("expr-"):
            continue
        primitive_groups[path.stem.split("-", 1)[0]].append(path)
    primitive_html = []
    for prefix in sorted(primitive_groups):
        cards = "".join(image_card(path, path.stem, "primitives") for path in primitive_groups[prefix])
        primitive_html.append(f'<div class="primitive-group"><h3>{html.escape(prefix)} ({len(primitive_groups[prefix])})</h3><div class="grid">{cards}</div></div>')

    env_paths = sorted((REFS / "env").glob("*.png"))
    env_cards = "".join(image_card(path, path.stem, "env") for path in env_paths)

    scene_ids = ["L28", "L29", "L33", "L38", "L44", "L46", "L169"]
    scene_cards = "".join(image_card(VIDEO / "assets" / "scenes" / f"{shot_id}.png", shot_id, "scenes") for shot_id in scene_ids)

    places: dict[str, list[str]] = defaultdict(list)
    for shot in shots:
        if shot.get("place"):
            places[shot["place"]].append(shot["id"])
    p6_places = [(place, ids) for place, ids in sorted(places.items(), key=lambda item: (-len(item[1]), item[0])) if len(ids) > 5]
    p6_text = "; ".join(f"{place} ({len(ids)})" for place, ids in p6_places)
    act1_cards = [
        "drive-maker — carry-by-handle / expr-deadpan",
        "drive-maker — hold-both-hands / expr-greedy",
        "drive-maker — action-present / expr-smug",
        "brick-foreman — back-to-viewer / no expr",
        "brick-foreman — action-shrug / expr-deadpan",
        "brick-foreman — hold-one-hand / expr-deadpan (L24)",
        "brick-foreman — hold-one-hand / expr-deadpan (L26)",
    ]
    owed_rows = [
        ("L96", "audit-room", "designated variant A; figure-free; place-anchor wiring owed at Pass-1"),
        ("L230", "jury-courtroom", "designated variant A; crowd present; re-judge and prefer a figure-free frame before anchor wiring"),
        ("L232", "miniscribe-floor", "designated variant A; figure-free; place-anchor wiring owed at Pass-1"),
        ("P6 variants", p6_text, "figure-free variants owed in their acts for the five long-run places"),
        ("Act-1 R1", "L01-L27", "7 STEP-1 cards owed: " + "; ".join(act1_cards) + ". Task 15: all seven returned HTTP 429; 0 images returned, 0 billable."),
    ]
    owed_html = "".join(
        f'<tr><td>{html.escape(a)}</td><td>{html.escape(b)}</td><td>{html.escape(c)}</td></tr>' for a, b, c in owed_rows
    )

    counts = {
        "cast": len(cast), "resting": 6, "crowd": 5, "expressions": len(expression_paths),
        "primitives": sum(map(len, primitive_groups.values())), "env": len(env_paths), "scenes": len(scene_ids),
    }
    total_images = len(images)
    content = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bricks Seed Board</title>
<style>
:root {{ color-scheme: dark; --bg:#090909; --panel:#111; --line:#303030; --text:#eeeeee; --muted:#a9a9a9; --yellow:#f1d34b; --amber:#d4aa5c; --red:#ff5555; }}
* {{ box-sizing:border-box }} body {{ margin:0; background:var(--bg); color:var(--text); font:14px/1.35 ui-sans-serif,system-ui,sans-serif }}
header,main {{ max-width:1600px; margin:auto; padding:22px }} header {{ border-bottom:1px solid var(--line) }} h1 {{ margin:0 0 4px; font-size:25px }} h2 {{ margin:0; font-size:19px }} h3 {{ color:var(--muted); font-size:13px; margin:18px 0 8px; text-transform:uppercase; letter-spacing:.06em }}
.sub,.section-note,.counts {{ margin:5px 0 0; color:var(--muted) }} .counts {{ font-size:12px }} section {{ padding:24px 0; border-bottom:1px solid var(--line) }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:12px; margin-top:14px }} .card,.cast-card,.pair {{ background:var(--panel); border:1px solid var(--line); min-width:0 }}
.card img,.cast-card img {{ display:block; width:100%; aspect-ratio:1/1; object-fit:contain; background:#050505; cursor:zoom-in }} .card p {{ margin:7px 8px 8px; overflow-wrap:anywhere; color:var(--muted); font-size:12px }}
.cast-grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; margin-top:14px }} .cast-card {{ display:grid; grid-template-columns:120px 1fr }} .cast-card .card {{ border:0 }} .cast-card .card img {{ aspect-ratio:2/3 }} .cast-card .card p {{ display:none }} .meta {{ padding:10px; min-width:0 }} .meta strong {{ display:block; overflow-wrap:anywhere }} .meta>span {{ color:var(--muted); font-size:12px }}
.line {{ margin-top:7px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px }} .costume {{ color:#c8c8c8 }} .flagged {{ border-color:var(--yellow) }} .flag-note {{ margin-top:9px; color:var(--yellow); font-size:12px }}
.pairs {{ display:grid; gap:12px; margin-top:14px }} .pair {{ padding:10px }} .pair-name {{ margin-bottom:7px; font-weight:700 }} .pair-images {{ display:grid; grid-template-columns:repeat(2,minmax(0,220px)); gap:10px }}
.missing,.veto-present,.law-ok {{ min-height:130px; display:grid; place-items:center; padding:12px; font-weight:800; text-align:center }} .missing {{ color:var(--red); border:2px solid var(--red) }} .veto-present {{ border-color:var(--amber); background:#1a1814 }} .law-ok {{ color:var(--muted) }}
.veto-present img {{ border-bottom:2px solid var(--amber) }} .veto-label {{ color:var(--amber); padding:7px 8px 0; font-size:11px; font-weight:800; text-align:center }} .crowd-layout {{ display:grid; grid-template-columns:minmax(320px,2fr) minmax(200px,1fr); gap:12px; margin-top:14px }} .crowd-headline {{ border-color:var(--yellow) }} .crowd-headline img {{ aspect-ratio:16/10 }} .failed-strip {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:10px }} .crowd-failed img {{ aspect-ratio:16/9; max-height:135px; object-fit:contain }} table {{ width:100%; border-collapse:collapse; margin-top:14px; font-size:12px }} th,td {{ text-align:left; vertical-align:top; padding:8px; border:1px solid var(--line) }} th {{ color:var(--muted); font-weight:600 }}
#lightbox {{ display:none; position:fixed; inset:0; z-index:10; background:rgba(0,0,0,.96); padding:30px }} #lightbox.open {{ display:grid; place-items:center }} #lightbox img {{ max-width:94vw; max-height:88vh; object-fit:contain }} #lightbox .light-caption {{ color:var(--muted); margin-top:9px; text-align:center }} #lightbox button {{ position:fixed; background:#161616; color:var(--text); border:1px solid #555; font:inherit; padding:8px 11px; cursor:pointer }} #lb-close {{ top:16px; right:16px }} #lb-prev {{ left:16px; top:50% }} #lb-next {{ right:16px; top:50% }}
@media (max-width:600px) {{ header,main {{ padding:14px }} .cast-grid,.crowd-layout,.failed-strip {{ grid-template-columns:1fr }} .cast-card {{ grid-template-columns:100px 1fr }} .pair-images {{ grid-template-columns:repeat(2,minmax(0,1fr)) }} #lb-prev,#lb-next {{ top:auto; bottom:18px }} #lb-prev {{ left:25% }} #lb-next {{ right:25% }} }}
</style></head><body>
<header><h1>Bricks Seed Board</h1><p class="sub">2026-07-28-bricks-fresh · 2026-08-13 · every existing pixel generation may seed from.</p><p class="counts">cast {counts["cast"]} · resting {counts["resting"]} · crowd {counts["crowd"]} · expressions {counts["expressions"]} · primitives {counts["primitives"]} · props + env {counts["env"]} · approved scenes {counts["scenes"]} · embeds {total_images}</p></header>
<main>
<section id="cast"><h2>Cast canonicals ({counts["cast"]})</h2><div class="cast-grid">{''.join(cast_cards)}</div></section>
<section id="resting"><h2>Channel-wide resting re-mints (3)</h2><p class="section-note">channel-level re-mint; revert available on request</p><div class="pairs">{''.join(resting_pairs)}</div></section>
<section id="crowd"><h2>Crowd anchor ({counts["crowd"]})</h2><div class="crowd-layout">{crowd_headline}{crowd_seed_card}</div><h3>Failed rounds — compact mechanism record</h3><div class="failed-strip">{crowd_failed_cards}</div></section>
<section id="expressions"><h2>Expressions ({counts["expressions"]})</h2><p class="section-note">P12 veto: expr-shock and expr-pleading are FAIL-stamped and refused by the pre-gen gate by name; retained files are intentional.</p><div class="grid">{''.join(expr_cards)}</div></section>
<section id="primitives"><h2>Poses / actions / interactions / holds ({counts["primitives"]})</h2>{''.join(primitive_html)}</section>
<section id="env"><h2>Props + env ({counts["env"]})</h2><div class="grid">{env_cards}</div></section>
<section id="scenes"><h2>Approved scene frames ({counts["scenes"]})</h2><p class="section-note">G4-verified existing pixels the batch can seed.</p><div class="grid">{scene_cards}</div></section>
<section id="owed"><h2>Owed later</h2><table><thead><tr><th>Item</th><th>Scope</th><th>Status</th></tr></thead><tbody>{owed_html}</tbody></table></section>
</main>
<div id="lightbox" aria-hidden="true"><button id="lb-close" aria-label="Close">Esc</button><button id="lb-prev" aria-label="Previous">←</button><div><img id="lb-image" alt=""><div id="lb-caption" class="light-caption"></div></div><button id="lb-next" aria-label="Next">→</button></div>
<script>
(() => {{ const box=document.getElementById('lightbox'), image=document.getElementById('lb-image'), caption=document.getElementById('lb-caption'); let items=[], index=0;
function openItem(i) {{ index=(i+items.length)%items.length; const el=items[index]; image.src=el.src; image.alt=el.alt; caption.textContent=el.alt; box.classList.add('open'); box.setAttribute('aria-hidden','false'); }}
document.querySelectorAll('.board-image').forEach(el => el.addEventListener('click',() => {{ items=[...document.querySelectorAll('.board-image[data-section="'+el.dataset.section+'"]')]; openItem(items.indexOf(el)); }}));
function close() {{ box.classList.remove('open'); box.setAttribute('aria-hidden','true'); image.removeAttribute('src'); }} document.getElementById('lb-close').onclick=close; document.getElementById('lb-prev').onclick=()=>openItem(index-1); document.getElementById('lb-next').onclick=()=>openItem(index+1);
document.addEventListener('keydown',e => {{ if(!box.classList.contains('open')) return; if(e.key==='Escape') close(); if(e.key==='ArrowLeft') openItem(index-1); if(e.key==='ArrowRight') openItem(index+1); }}); box.addEventListener('click',e => {{ if(e.target===box) close(); }}); }})();
</script></body></html>'''
    return content, {**counts, "images": total_images}, anomalies


def verify(output: str, expected_images: int, expected_sections: dict[str, int]) -> None:
    sources = re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', output)
    assert len(sources) == expected_images, (len(sources), expected_images)
    assert all(src.startswith("data:image/") for src in sources)
    assert "file://" not in output.lower()
    sections = Counter(re.findall(r'<img\b[^>]*\bdata-section="([^"]+)"', output))
    assert dict(sections) == expected_sections, (dict(sections), expected_sections)


def main() -> None:
    html_640, counts, anomalies = build(640)
    rendered = html_640
    edge = 640
    if len(rendered.encode("utf-8")) >= MAX_BYTES:
        rendered, counts, anomalies = build(512)
        edge = 512
    sections = {
        "cast": counts["cast"], "resting": counts["resting"], "crowd": counts["crowd"],
        "expressions": counts["expressions"], "primitives": counts["primitives"],
        "env": counts["env"], "scenes": counts["scenes"],
    }
    verify(rendered, counts["images"], sections)
    assert len(rendered.encode("utf-8")) < MAX_BYTES, "seed board exceeds 14 MB at 512px"
    OUTPUT.write_text(rendered, encoding="utf-8")
    # Re-open the delivered artifact; do not treat the pre-write string as verification.
    verify(OUTPUT.read_text(encoding="utf-8"), counts["images"], sections)
    print(json.dumps({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size, "max_edge": edge, "counts": counts, "anomalies": anomalies}, indent=2))


if __name__ == "__main__":
    main()
