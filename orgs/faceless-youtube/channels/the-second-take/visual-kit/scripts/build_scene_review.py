# Scene-style-lock + flash-vs-pro review gallery (downscaled data-URIs, lightbox).
import base64, os
from io import BytesIO
try:
    from PIL import Image; _PIL = True
except Exception:
    _PIL = False
KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
S = os.path.join(KIT, "_scene_test")
def datauri(name, w=1000):
    p = os.path.join(S, name + ".png")
    if _PIL:
        im = Image.open(p).convert("RGB"); im.thumbnail((w, w))
        buf = BytesIO(); im.save(buf, "JPEG", quality=88, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()

HTML = f"""<title>The Second Take — Scene Style + Flash vs Pro</title>
<style>
  :root {{ --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555; --hair:#d4cdbf;
    --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --warn:#a8641c; --warn-soft:#a8641c1a; --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212; }}
  @media (prefers-color-scheme:dark) {{ :root {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8;
    --muted:#a99f8d; --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820; --warn:#d69a52; --warn-soft:#d69a5222; --shadow:0 1px 2px #0006, 0 10px 30px #0007; }} }}
  :root[data-theme="light"] {{ --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555; --hair:#d4cdbf; --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --warn:#a8641c; --warn-soft:#a8641c1a; --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212; }}
  :root[data-theme="dark"] {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8; --muted:#a99f8d; --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820; --warn:#d69a52; --warn-soft:#d69a5222; --shadow:0 1px 2px #0006, 0 10px 30px #0007; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--ground); color:var(--ink); font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:1200px; margin:0 auto; padding:clamp(20px,4vw,44px); }}
  .eyebrow {{ font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); font-weight:700; margin:0 0 8px; }}
  h1 {{ font-size:clamp(25px,3.6vw,38px); line-height:1.1; margin:0 0 12px; letter-spacing:-.02em; text-wrap:balance; font-weight:800; }}
  h2 {{ font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin:34px 0 14px; font-weight:700; }}
  .verdict-box {{ margin:0; padding:16px 20px; background:var(--accent-soft); border:1px solid var(--accent); border-radius:14px; max-width:84ch; }}
  .verdict-box b {{ color:var(--accent); }}
  .cmp {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
  @media (max-width:760px) {{ .cmp {{ grid-template-columns:1fr; }} }}
  .card {{ margin:0; background:var(--panel); border:1px solid var(--hair); border-radius:14px; overflow:hidden; box-shadow:var(--shadow); }}
  .card.win {{ border-color:var(--accent); box-shadow:0 0 0 1px var(--accent), var(--shadow); }}
  .card img {{ width:100%; height:auto; display:block; background:var(--card); cursor:zoom-in; }}
  figcaption {{ padding:11px 14px 13px; display:flex; flex-direction:column; gap:3px; }}
  .tag {{ font-size:12px; font-weight:800; letter-spacing:.05em; color:var(--accent); }}
  .desc {{ font-size:13px; color:var(--muted); line-height:1.45; }}
  .stack {{ display:flex; flex-direction:column; gap:16px; }}
  .foot {{ margin-top:24px; color:var(--muted); font-size:12.5px; }}
  .lb {{ position:fixed; inset:0; background:#0b0906ee; display:none; align-items:center; justify-content:center; padding:3vmin; z-index:50; cursor:zoom-out; }}
  .lb.open {{ display:flex; }} .lb img {{ max-width:97vw; max-height:95vh; border-radius:10px; box-shadow:0 20px 60px #000a; }}
  :focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
</style>

<div class="wrap">
  <p class="eyebrow">The Second Take · visual-kit · scene-style lock</p>
  <h1>Story shots in 2D &mdash; and flash vs pro</h1>
  <div class="verdict-box">
    <b>Two answers at once.</b> (1) <b>The 2D world style locks cleanly</b> &mdash; composed story shots (ship,
    island, beach, flag), not just backdrops, all cohesive with the character look. (2) <b>Flash holds the
    STYLE; pro holds specific-character IDENTITY better</b> (flash made MacGregor go bald / grow a beard).
    <b>Plan:</b> flash for scenes/props/environments/incidental (the bulk, ~4&ndash;5&times; cheaper), pro only
    for locked-character frames, composite the character over a flash scene where identity must read. Cuts
    image spend ~70&ndash;80%.
  </div>

  <h2>Model compare &mdash; same prompt, ship toward camera</h2>
  <div class="cmp">
    <figure class="card">
      <img src="{datauri('ship_toward__flash')}" alt="ship flash">
      <figcaption><span class="tag">FLASH &mdash; ~4&ndash;5&times; cheaper</span><span class="desc">Great style. Scenery outline a touch thinner, mild sky gradient. Character close, recognizable-ish.</span></figcaption>
    </figure>
    <figure class="card win">
      <img src="{datauri('ship_toward__pro')}" alt="ship pro">
      <figcaption><span class="tag">PRO &mdash; more unified</span><span class="desc">Outline weight unified across ship + character + waves; flatter, crisper. Best when a specific character must read.</span></figcaption>
    </figure>
  </div>

  <h2>Flash story shots &mdash; does the world style hold across beats?</h2>
  <div class="stack">
    <figure class="card">
      <img src="{datauri('island_reveal__flash')}" alt="island reveal">
      <figcaption><span class="tag">Island reveal (flash)</span><span class="desc">Best pure-style shot &mdash; ready to use. (minor: it drew a border frame; crop it.)</span></figcaption>
    </figure>
    <figure class="card">
      <img src="{datauri('natives_beach__flash')}" alt="natives beach">
      <figcaption><span class="tag">Natives on the beach (flash)</span><span class="desc">Composition + style great; natives auto-rendered in our family form. Caveat: MacGregor drifted BALD (identity, not style).</span></figcaption>
    </figure>
    <figure class="card">
      <img src="{datauri('flag_plant__flash')}" alt="flag plant">
      <figcaption><span class="tag">Planting the flag (flash)</span><span class="desc">Heroic beat, on-brand. Caveat: MacGregor gained a beard (identity drift).</span></figcaption>
    </figure>
  </div>

  <p class="foot">flash = gemini-2.5-flash-image · pro = gemini-3-pro-image · seeded off MacGregor + base for style · click any frame to enlarge</p>
</div>

<div class="lb" id="lb" aria-hidden="true"><img id="lbimg" src="" alt=""></div>
<script>
  const lb=document.getElementById('lb'), lbimg=document.getElementById('lbimg');
  document.querySelectorAll('.card img').forEach(function(im){{
    function open(){{ lbimg.src=im.src; lbimg.alt=im.alt; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); }}
    im.addEventListener('click', open);
    im.addEventListener('keydown', function(e){{ if(e.key==='Enter'||e.key===' ') {{ e.preventDefault(); open(); }} }});
  }});
  function close(){{ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); lbimg.src=''; }}
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){{ if(e.key==='Escape') close(); }});
</script>
"""
out = os.path.join(S, "review.html")
open(out, "w", encoding="utf-8").write(HTML)
print("wrote", out, f"({len(HTML)//1024} KB)")
