# Proof review: 3 isolated layers -> 1 composite, showing the layered architecture. Downscaled data-URIs + lightbox.
import base64, os
from io import BytesIO
from PIL import Image
KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
P = os.path.join(KIT, "_proof")
def duri(name, w=900):
    im = Image.open(os.path.join(P, name + ".png")).convert("RGB"); im.thumbnail((w, w))
    buf = BytesIO(); im.save(buf, "JPEG", quality=88, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

HTML = f"""<title>The Second Take — Layered Architecture Proof</title>
<style>
  :root {{ --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555; --hair:#d4cdbf;
    --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212; }}
  @media (prefers-color-scheme:dark) {{ :root {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8;
    --muted:#a99f8d; --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820; --shadow:0 1px 2px #0006, 0 10px 30px #0007; }} }}
  :root[data-theme="light"] {{ --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555; --hair:#d4cdbf; --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212; }}
  :root[data-theme="dark"] {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8; --muted:#a99f8d; --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820; --shadow:0 1px 2px #0006, 0 10px 30px #0007; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--ground); color:var(--ink); font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:1160px; margin:0 auto; padding:clamp(20px,4vw,44px); }}
  .eyebrow {{ font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); font-weight:700; margin:0 0 8px; }}
  h1 {{ font-size:clamp(25px,3.6vw,38px); line-height:1.1; margin:0 0 12px; letter-spacing:-.02em; text-wrap:balance; font-weight:800; }}
  h2 {{ font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin:32px 0 14px; font-weight:700; }}
  .verdict-box {{ margin:0; padding:16px 20px; background:var(--accent-soft); border:1px solid var(--accent); border-radius:14px; max-width:84ch; }}
  .verdict-box b {{ color:var(--accent); }}
  .hero {{ margin:16px 0 4px; border:2px solid var(--accent); border-radius:16px; overflow:hidden; background:var(--panel); box-shadow:var(--shadow); }}
  .hero img {{ width:100%; display:block; cursor:zoom-in; }}
  .hero-cap {{ padding:10px 16px; font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); font-weight:700; }}
  .row {{ display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }}
  @media (max-width:720px) {{ .row {{ grid-template-columns:1fr; }} }}
  .card {{ margin:0; background:var(--panel); border:1px solid var(--hair); border-radius:14px; overflow:hidden; box-shadow:var(--shadow); }}
  .card img {{ width:100%; height:auto; display:block; background:#cfcabd; cursor:zoom-in; }}
  figcaption {{ padding:10px 13px 12px; }}
  .tag {{ font-size:12px; font-weight:800; letter-spacing:.05em; color:var(--accent); }}
  .desc {{ font-size:12.5px; color:var(--muted); display:block; margin-top:2px; }}
  .foot {{ margin-top:24px; color:var(--muted); font-size:12.5px; }}
  .lb {{ position:fixed; inset:0; background:#0b0906ee; display:none; align-items:center; justify-content:center; padding:3vmin; z-index:50; cursor:zoom-out; }}
  .lb.open {{ display:flex; }} .lb img {{ max-width:97vw; max-height:95vh; border-radius:10px; box-shadow:0 20px 60px #000a; }}
  :focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
</style>

<div class="wrap">
  <p class="eyebrow">The Second Take · visual-kit · architecture proof</p>
  <h1>Layered pipeline: 3 assets &rarr; 1 scene</h1>
  <div class="verdict-box">
    <b>Proven.</b> A cheap-<b>flash</b> environment plate + a <b>pro</b> rig-locked character + a <b>flash</b>
    canonical element, keyed and composited into one coherent, on-model scene &mdash; <b>zero drift</b>, because
    nothing was free-drawn inside the scene. This fixes the natives problem, keeps recurring elements consistent,
    and puts most volume on the cheap model. Real compositing happens in Remotion later; this is the still-stage proof.
  </div>

  <h2>Result &mdash; composited scene</h2>
  <div class="hero"><img src="{duri('composite', 1200)}" alt="composite"><div class="hero-cap">flash plate + pro MacGregor + flash ship &mdash; assembled</div></div>

  <h2>The three isolated layers</h2>
  <div class="row">
    <figure class="card"><img src="{duri('shore_plate')}" alt="plate"><figcaption><span class="tag">Plate &mdash; FLASH</span><span class="desc">Empty environment. (border-frame artifact cropped in composite.)</span></figcaption></figure>
    <figure class="card"><img src="{duri('macgregor')}" alt="macgregor"><figcaption><span class="tag">Character &mdash; PRO</span><span class="desc">Rig held: no nose, no ears, egg head. (hair over-suppressed &mdash; needs a re-roll.)</span></figcaption></figure>
    <figure class="card"><img src="{duri('ship')}" alt="ship"><figcaption><span class="tag">Element &mdash; FLASH</span><span class="desc">Canonical locked ship &mdash; reusable in any shot at any scale.</span></figcaption></figure>
  </div>

  <p class="foot">flash = gemini-2.5-flash-image · pro = gemini-3-pro-image · keyed via flood-fill + composited (PIL) · click to enlarge</p>
</div>

<div class="lb" id="lb" aria-hidden="true"><img id="lbimg" src="" alt=""></div>
<script>
  const lb=document.getElementById('lb'), lbimg=document.getElementById('lbimg');
  document.querySelectorAll('.hero img, .card img').forEach(function(im){{
    function open(){{ lbimg.src=im.src; lbimg.alt=im.alt; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); }}
    im.addEventListener('click', open);
    im.addEventListener('keydown', function(e){{ if(e.key==='Enter'||e.key===' ') {{ e.preventDefault(); open(); }} }});
  }});
  function close(){{ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); lbimg.src=''; }}
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){{ if(e.key==='Escape') close(); }});
</script>
"""
out = os.path.join(P, "review.html")
open(out, "w", encoding="utf-8").write(HTML)
print("wrote", out, f"({len(HTML)//1024} KB)")
