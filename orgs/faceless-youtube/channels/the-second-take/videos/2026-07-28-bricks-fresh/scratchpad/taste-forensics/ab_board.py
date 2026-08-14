#!/usr/bin/env python3
"""Assemble the three-way engine duel board (pro / flash / codex) as one HTML file."""
import base64, io, json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
AB = os.path.join(HERE, "ab-out")
CODEX = r"C:\Users\danie\kb-worktrees\boss-codex-image-engine\scratch-codex-image-engine\ab-codex-arm\p10-staging"
SCENES = os.path.abspath(os.path.join(HERE, "..", "..", "assets", "scenes"))
OUT = os.path.join(HERE, "ab-board.html")

def uri(path, width=640):
    im = Image.open(path)
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "WEBP", quality=82)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

def img(path, alt, section):
    return (f'<img class="board-image" data-section="{section}" src="{uri(path)}" '
            f'alt="{alt}" loading="lazy">')

spec = json.load(open(os.path.join(HERE, "ab-test-items.json"), encoding="utf-8"))
items = {i["id"]: i for i in spec["items"]}

def duel_card(item_id, label, note=""):
    it = items[item_id]
    cells = []
    for arm, cls in (("pro", "arm-pro"), ("flash", "arm-flash")):
        p = os.path.join(AB, f'{it["output_name"]}__{arm}.png')
        if os.path.isfile(p):
            cells.append(f'<figure class="{cls}">{img(p, f"{label} — {arm}", "duel")}'
                         f'<figcaption>{arm}</figcaption></figure>')
        else:
            cells.append(f'<figure class="{cls}"><div class="missing">NO IMAGE<br>'
                         f'<span>flash returned 200 with no image part, twice</span></div>'
                         f'<figcaption>{arm}</figcaption></figure>')
    n = f'<p class="note">{note}</p>' if note else ""
    return (f'<article class="duel"><h3>{label}</h3>'
            f'<p class="meta">{it["kind"]} · aspect {it["aspect_ratio"]} · '
            f'{len(it["seeds"])} seeds · prompt {len(it["prompt"])} ch</p>'
            f'<div class="pair">{"".join(cells)}</div>{n}</article>')

duels = [
    duel_card("fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333", "drive-maker · carry-by-handle · deadpan"),
    duel_card("fig-brick-foreman--back-to-viewer--7a3b93be", "brick-foreman · back-to-viewer"),
    duel_card("fig-brick-foreman--hold-one-hand--expr-deadpan--ecc1ee75", "brick-foreman · hold-one-hand · deadpan",
              "pro needed one re-issue (503 first try). flash returned 200-with-no-image twice — reproducible incapacity on this 3-seed card."),
    duel_card("L06", "L06 · pc-boxy + crowd scene"),
    duel_card("L16", "L16 · pc-boxy vs rival, multi-figure scene"),
]

codex_l28 = os.path.join(CODEX, "L28-p10-match-r1.png")
codex_l27 = os.path.join(CODEX, "L27-p10-match-r1.png")
pro_l28 = os.path.join(SCENES, "L28.png")
codex_section = f'''
<article class="duel"><h3>L28 · miniscribe-floor plate — codex vs promoted pro</h3>
<p class="meta">same still_prompt spec; pro side is the Wave-1 PROMOTED plate (verified), codex side is fresh via p10_matched</p>
<div class="pair">
<figure class="arm-pro">{img(pro_l28, "L28 — pro (promoted)", "codex")}<figcaption>pro (promoted Wave-1 plate)</figcaption></figure>
<figure class="arm-codex">{img(codex_l28, "L28 — codex", "codex")}<figcaption>codex engine ($0)</figcaption></figure>
</div></article>
<article class="duel"><h3>L27 · codex engine solo</h3>
<p class="meta">no pro counterpart exists yet (act-1 scenes generate in the scene waves); shown for register judgment only</p>
<div class="pair one">
<figure class="arm-codex">{img(codex_l27, "L27 — codex", "codex")}<figcaption>codex engine ($0)</figcaption></figure>
</div></article>'''

html = f'''<title>Engine Duel Board</title>
<style>
:root{{color-scheme:dark;--bg:#0a0a0a;--panel:#121212;--line:#2e2e2e;--text:#ececec;--muted:#a8a8a8;--pro:#719c74;--flash:#c9a24a;--codex:#7a8fb8;--red:#ff6b6b}}
body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 ui-sans-serif,system-ui,sans-serif}}
header,main{{max-width:1500px;margin:auto;padding:20px}}
header{{border-bottom:1px solid var(--line)}}
h1{{margin:0 0 4px;font-size:24px}} h2{{font-size:18px;margin:0 0 4px}} h3{{margin:0 0 2px;font-size:15px}}
.sub,.meta,.note{{color:var(--muted);font-size:12px;margin:2px 0}}
.note{{color:var(--flash)}}
section{{padding:22px 0;border-bottom:1px solid var(--line)}}
.duel{{background:var(--panel);border:1px solid var(--line);padding:12px;margin-top:14px}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}}
.pair.one{{grid-template-columns:minmax(0,1fr) }}
figure{{margin:0;min-width:0}}
figure img{{display:block;width:100%;background:#050505;cursor:zoom-in;border:1px solid var(--line)}}
figcaption{{font-size:12px;color:var(--muted);padding:5px 2px}}
.arm-pro figcaption{{color:var(--pro)}} .arm-flash figcaption{{color:var(--flash)}} .arm-codex figcaption{{color:var(--codex)}}
.missing{{aspect-ratio:2/3;display:grid;place-items:center;text-align:center;border:2px solid var(--red);color:var(--red);font-weight:700;font-size:14px}}
.missing span{{font-weight:400;font-size:11px;color:var(--muted)}}
table{{border-collapse:collapse;margin-top:12px;font-size:12px;font-variant-numeric:tabular-nums}}
th,td{{text-align:left;padding:7px 10px;border:1px solid var(--line);vertical-align:top}} th{{color:var(--muted);font-weight:600}}
#lightbox{{display:none;position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.96);padding:30px}}
#lightbox.open{{display:grid;place-items:center}}
#lightbox img{{max-width:94vw;max-height:88vh;object-fit:contain}}
#lightbox .light-caption{{color:var(--muted);margin-top:9px;text-align:center}}
#lightbox button{{position:fixed;background:#161616;color:var(--text);border:1px solid #555;font:inherit;padding:8px 11px;cursor:pointer}}
#lb-close{{top:16px;right:16px}} #lb-prev{{left:16px;top:50%}} #lb-next{{right:16px;top:50%}}
@media(max-width:700px){{.pair{{grid-template-columns:1fr}}}}
</style>
<header><h1>Engine Duel Board</h1>
<p class="sub">2026-07-28-bricks-fresh · 2026-08-14 · same-spec A/B: identical prompts, seeds (sha-pinned), aspect, 1K · gemini-3-pro-image ($0.134/gen) vs gemini-2.5-flash-image ($0.039/gen) vs codex engine (subscription, $0)</p></header>
<main>
<section><h2>Same-spec duel — pro vs flash (5 Wave-2 items)</h2>
<p class="sub">3 STEP-1 figure cards + 2 act-1 scenes, all from the dry-proven act-1 spec. Every pair below was generated from byte-identical prompts and the same seed files.</p>
{"".join(duels)}</section>
<section><h2>Codex engine arm</h2>
<p class="sub">p10_matched composer is scene-only today (its 8 proven shots); it cannot compose STEP-1 figure cards or L06/L16 yet — that build gap is a finding, not an omission.</p>
{codex_section}</section>
<section><h2>Scorecard</h2>
<table>
<tr><th>arm</th><th>attempted</th><th>delivered</th><th>failures</th><th>cost this test</th><th>Wave-2 full-run projection (383 gens, first pass)</th></tr>
<tr><td>gemini-3-pro-image</td><td>6 calls / 5 items</td><td>5/5</td><td>one 503, cleared on re-issue</td><td>$0.804</td><td>$51.3</td></tr>
<tr><td>gemini-2.5-flash-image</td><td>6 calls / 5 items</td><td>4/5</td><td>200-no-image twice on the same card (mechanism, not transient)</td><td>$0.234</td><td>$14.9</td></tr>
<tr><td>codex engine (p10)</td><td>2 calls / 2 shots</td><td>2/2</td><td>none; scene-only coverage</td><td>$0</td><td>$0, but needs card-composer build + slower gens</td></tr>
</table>
<p class="sub">Test spend $1.038 nominal of $1.50 cap. Flash was style-rejected once already (visual-kit lock); this board is its re-hearing on current doctrine. Judge identity fidelity, flat-cel register, outline weight, palette discipline — zoom everything.</p>
</section></main>
<div id="lightbox" aria-hidden="true"><div><img id="lb-image" alt=""><div class="light-caption" id="lb-caption"></div></div>
<button id="lb-close">Esc</button><button id="lb-prev">&#8249;</button><button id="lb-next">&#8250;</button></div>
<script>(()=>{{const b=document.getElementById('lightbox'),i=document.getElementById('lb-image'),c=document.getElementById('lb-caption');let a=[],n=0;function o(x){{n=(x+a.length)%a.length;const e=a[n];i.src=e.src;i.alt=e.alt;c.textContent=e.alt;b.classList.add('open');b.setAttribute('aria-hidden','false')}}document.querySelectorAll('.board-image').forEach(e=>e.addEventListener('click',()=>{{a=[...document.querySelectorAll('.board-image[data-section="'+e.dataset.section+'"]')];o(a.indexOf(e))}}));function q(){{b.classList.remove('open');b.setAttribute('aria-hidden','true');i.removeAttribute('src')}}document.getElementById('lb-close').onclick=q;document.getElementById('lb-prev').onclick=()=>o(n-1);document.getElementById('lb-next').onclick=()=>o(n+1);document.addEventListener('keydown',e=>{{if(!b.classList.contains('open'))return;if(e.key==='Escape')q();if(e.key==='ArrowLeft')o(n-1);if(e.key==='ArrowRight')o(n+1)}});b.addEventListener('click',e=>{{if(e.target===b)q()}})}})();</script>'''

open(OUT, "w", encoding="utf-8").write(html)
n_imgs = html.count('class="board-image"')
print(f"wrote {OUT}: {os.path.getsize(OUT)} bytes, {n_imgs} embeds")
