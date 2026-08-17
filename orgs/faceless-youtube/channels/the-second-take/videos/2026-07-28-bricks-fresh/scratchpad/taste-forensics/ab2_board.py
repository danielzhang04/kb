#!/usr/bin/env python3
"""Build the round-2, three-way image comparison board."""
import base64
import html
import io
import json
import os
from pathlib import Path

from PIL import Image, ImageOps


HERE = Path(__file__).resolve().parent
AB_OUT = HERE / "ab-out"
CODEX_OUT = Path(
    r"C:\Users\danie\kb-worktrees\boss-codex-image-engine\scratch-codex-image-engine"
    r"\ab-codex-arm\ab2"
)
OUT = HERE / "ab2-board.html"
ARMS = (
    ("pro", "$0.134/gen", "arm-pro"),
    ("flash", "$0.039/gen", "arm-flash"),
    ("codex", "$0, subscription", "arm-codex"),
)


def output_path(item, arm):
    """Resolve the frozen output name without assuming whether it owns ab2-."""
    directory = AB_OUT if arm in {"pro", "flash"} else CODEX_OUT
    output_name = item["output_name"]
    names = [f"{output_name}__{arm}.png"]
    if not output_name.startswith("ab2-"):
        names.insert(0, f"ab2-{output_name}__{arm}.png")
    matches = [directory / name for name in names if (directory / name).is_file()]
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected one {arm} output for {item['id']}; found {len(matches)}: {matches}"
        )
    return matches[0]


def data_uri(path, max_edge=900, quality=76):
    """Downscale and JPEG-encode an image for a compact self-contained artifact."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        if max(image.size) > max_edge:
            scale = max_edge / max(image.size)
            image = image.resize(
                (round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS
            )
        encoded = io.BytesIO()
        image.save(encoded, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")


def environment_plate(item):
    for seed in item.get("seeds", []):
        path = seed.get("path", "").replace("\\", "/")
        if "/assets/scenes/" in path:
            return Path(path).name
    return "none"


def item_metadata(item):
    kind = html.escape(item["kind"])
    item_id = html.escape(item["id"])
    source = html.escape(item.get("source_shot_id", "not specified"))
    if item["kind"] == "step-1-figure-card":
        cast = html.escape(item.get("cast", "not specified"))
        return (
            f'<h2><code>{item_id}</code></h2>'
            f'<p class="meta">kind: {kind} · cast: {cast} · source shot: {source}</p>'
        )
    plate = html.escape(environment_plate(item))
    return (
        f'<h2><code>{item_id}</code></h2>'
        f'<p class="meta">kind: {kind} · source shot: {source} · env plate seed: {plate}</p>'
    )


def card(item, arm, rate, css_class):
    path = output_path(item, arm)
    alt = html.escape(f"{item['id']} — {arm} ({rate})", quote=True)
    source = data_uri(path)
    return (
        f'<figure class="{css_class}">'
        f'<img class="board-image" src="{source}" alt="{alt}" loading="lazy">'
        f'<figcaption>{html.escape(arm)} ({html.escape(rate)})</figcaption>'
        f'</figure>'
    )


def render(items, final_size):
    figure_items = [item for item in items if item["kind"] == "step-1-figure-card"]
    scene_items = [item for item in items if item["kind"] != "step-1-figure-card"]

    def section(item):
        cards = "".join(card(item, *arm) for arm in ARMS)
        return f'<section class="item">{item_metadata(item)}<div class="arms">{cards}</div></section>'

    sections = "".join(section(item) for item in figure_items + scene_items)
    return f'''<title>A/B Round 2 — Three-Way Comparison Board</title>
<style>
:root {{ color-scheme: dark; --bg:#0b0d10; --panel:#15191f; --line:#303741; --text:#f1f4f7; --muted:#aab4c0; --pro:#84c98a; --flash:#f0c261; --codex:#9ebcf0; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--text); font:14px/1.45 ui-sans-serif,system-ui,sans-serif; }}
header, main {{ max-width:1800px; margin:auto; padding:20px; }}
header {{ border-bottom:1px solid var(--line); }}
h1 {{ margin:0 0 4px; font-size:25px; }} h2 {{ margin:0; font-size:14px; overflow-wrap:anywhere; }}
p {{ margin:4px 0; }} .muted, .meta {{ color:var(--muted); font-size:12px; }}
.summary {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:15px; }}
.summary div {{ background:var(--panel); border:1px solid var(--line); padding:10px; }}
.summary strong {{ display:block; margin-bottom:3px; }}
.item {{ padding:18px 0; border-bottom:1px solid var(--line); }}
.arms {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:10px; }}
figure {{ margin:0; min-width:0; background:var(--panel); border:1px solid var(--line); padding:8px; }}
figure img {{ display:block; width:100%; background:#050607; cursor:zoom-in; }}
figcaption {{ padding-top:6px; font-size:13px; font-weight:650; }}
.arm-pro figcaption {{ color:var(--pro); }} .arm-flash figcaption {{ color:var(--flash); }} .arm-codex figcaption {{ color:var(--codex); }}
#lightbox {{ display:none; position:fixed; inset:0; z-index:10; padding:28px 64px; background:rgba(0,0,0,.96); }}
#lightbox.open {{ display:grid; place-items:center; }}
#lightbox img {{ display:block; max-width:92vw; max-height:85vh; object-fit:contain; }}
#lb-caption {{ margin-top:9px; color:var(--muted); text-align:center; }}
#lightbox button {{ position:fixed; border:1px solid #626d7a; background:#171c23; color:var(--text); padding:8px 12px; font:22px/1 system-ui,sans-serif; cursor:pointer; }}
#lb-close {{ top:16px; right:16px; font-size:14px !important; }} #lb-prev {{ left:16px; top:50%; }} #lb-next {{ right:16px; top:50%; }}
@media (max-width:760px) {{ .summary,.arms {{ grid-template-columns:1fr; }} #lightbox {{ padding:20px; }} }}
</style>
<header>
  <h1>A/B Round 2 — Three-Way Comparison Board</h1>
  <p class="muted">2026-08-17 · frozen-spec comparison · figure cards first, then scenes</p>
  <div class="summary">
    <div><strong>Delivery</strong>10 items × 3 arms · 30/30 delivered</div>
    <div><strong>Arm totals</strong>pro $1.34 · flash $0.39 · codex $0</div>
    <div><strong>Codex sizing deviation</strong>near-2:3 1027–1029×1529–1531; near-16:9 1672×941; no exact 1K preset</div>
  </div>
  <p class="muted">Embedded, re-encoded JPEG board size: {final_size}</p>
</header>
<main>{sections}</main>
<div id="lightbox" aria-hidden="true">
  <div><img id="lb-image" alt=""><div id="lb-caption"></div></div>
  <button id="lb-close" type="button">Esc</button><button id="lb-prev" type="button" aria-label="Previous image">‹</button><button id="lb-next" type="button" aria-label="Next image">›</button>
</div>
<script>(() => {{
  const box = document.getElementById('lightbox'), image = document.getElementById('lb-image'), caption = document.getElementById('lb-caption');
  const images = [...document.querySelectorAll('.board-image')]; let index = 0;
  const show = (next) => {{ index = (next + images.length) % images.length; const current = images[index]; image.src = current.src; image.alt = current.alt; caption.textContent = current.alt; box.classList.add('open'); box.setAttribute('aria-hidden', 'false'); }};
  const close = () => {{ box.classList.remove('open'); box.setAttribute('aria-hidden', 'true'); image.removeAttribute('src'); }};
  images.forEach((node, i) => node.addEventListener('click', () => show(i)));
  document.getElementById('lb-close').addEventListener('click', close);
  document.getElementById('lb-prev').addEventListener('click', () => show(index - 1));
  document.getElementById('lb-next').addEventListener('click', () => show(index + 1));
  document.addEventListener('keydown', (event) => {{ if (!box.classList.contains('open')) return; if (event.key === 'Escape') close(); if (event.key === 'ArrowLeft') show(index - 1); if (event.key === 'ArrowRight') show(index + 1); }});
  box.addEventListener('click', (event) => {{ if (event.target === box) close(); }});
}})();</script>
'''


def main():
    with (HERE / "ab2-test-items.json").open(encoding="utf-8") as source:
        items = json.load(source)["items"]
    if len(items) != 10:
        raise ValueError(f"Expected 10 items, found {len(items)}")

    # Stabilize the displayed byte count after base64 encoding is complete.
    size_text = "calculating"
    for _ in range(4):
        document = render(items, size_text)
        OUT.write_text(document, encoding="utf-8")
        next_size = f"{OUT.stat().st_size:,} bytes"
        if next_size == size_text:
            break
        size_text = next_size
    else:
        raise RuntimeError("Board byte-size display did not stabilize")

    text = OUT.read_text(encoding="utf-8")
    image_count = text.count('class="board-image"')
    if image_count != 30 or text.count('data:image/jpeg;base64,') != 30:
        raise AssertionError(f"Expected 30 embedded images, found {image_count}")
    if OUT.stat().st_size >= 10 * 1024 * 1024:
        raise AssertionError(f"Board is too large: {OUT.stat().st_size} bytes")
    print(f"wrote {OUT}: {OUT.stat().st_size} bytes; {image_count} embedded images; missing inputs: none")


if __name__ == "__main__":
    main()
