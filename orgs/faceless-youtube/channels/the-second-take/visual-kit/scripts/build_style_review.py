# Builds a self-contained style+movement review gallery (data-URI images, lightbox) for the iteration pass.
import base64, os

KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
ITER = os.path.join(KIT, "_style_iter")
REFS = os.path.join(KIT, "refs", "base")

def datauri(p):
    return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()

# reference (current locked) + the 6 iteration frames
REF_BASE   = datauri(os.path.join(REFS, "base.png"))
REF_RECOIL = datauri(os.path.join(REFS, "action-recoil.png"))
IMG = {k: datauri(os.path.join(ITER, k + ".png")) for k in
       ["d1_hold","d1_snap","d2_hold","d2_snap","d3_hold","d3_snap"]}

DIRS = [
  ("d1", "Clean, pushed",   "Current flat-cel finish, bolder outline + saturation. The safe, reproducible keeper.", False),
  ("d2", "Hand-inked + halftone", "Rough ink line, halftone shading, paper grain — the HeyHistorically authored feel.", True),
  ("d3", "Bold graphic",    "Thicker outline, limited flat palette. Barely separated from Clean this pass.", False),
]

cols = ""
for key, name, desc, rec in DIRS:
    rec_tag = '<span class="rec">recommended to explore</span>' if rec else ''
    cols += f"""
    <article class="col{' col--rec' if rec else ''}">
      <header class="col__head">
        <div class="col__id">{key.upper()}</div>
        <h2>{name}</h2>
        <p>{desc}</p>
        {rec_tag}
      </header>
      <figure class="shot">
        <img src="{IMG[key+'_hold']}" alt="{name} — deadpan hold" loading="lazy">
        <figcaption>deadpan hold</figcaption>
      </figure>
      <figure class="shot">
        <img src="{IMG[key+'_snap']}" alt="{name} — shock snap" loading="lazy">
        <figcaption>shock snap</figcaption>
      </figure>
    </article>"""

HTML = f"""<title>The Second Take — Style &amp; Movement Iteration</title>
<style>
  :root {{
    --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0;
    --ink:#241a12; --muted:#6f6555; --hair:#d4cdbf;
    --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --cream:#f5ead6;
    --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212;
    --maxw:1180px;
  }}
  @media (prefers-color-scheme:dark) {{
    :root {{
      --ground:#17130f; --panel:#201a14; --card:#26201a;
      --ink:#f2e9d8; --muted:#a99f8d; --hair:#33291f;
      --accent:#54c3b8; --accent-soft:#54c3b820; --cream:#f5ead6;
      --shadow:0 1px 2px #0006, 0 10px 30px #0007;
    }}
  }}
  :root[data-theme="light"] {{
    --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12;
    --muted:#6f6555; --hair:#d4cdbf; --accent:#1f6f6b; --accent-soft:#1f6f6b1a;
    --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212;
  }}
  :root[data-theme="dark"] {{
    --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8;
    --muted:#a99f8d; --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820;
    --shadow:0 1px 2px #0006, 0 10px 30px #0007;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--ground); color:var(--ink);
    font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:var(--maxw); margin:0 auto; padding:clamp(20px,4vw,44px); }}
  .eyebrow {{ font-size:12px; letter-spacing:.16em; text-transform:uppercase;
    color:var(--accent); font-weight:700; margin:0 0 8px; }}
  h1 {{ font-size:clamp(26px,4vw,40px); line-height:1.1; margin:0 0 10px;
    letter-spacing:-.02em; text-wrap:balance; font-weight:800; }}
  .lede {{ max-width:60ch; color:var(--muted); margin:0 0 6px; font-size:17px; }}
  .lede b {{ color:var(--ink); }}

  .ref {{ display:flex; gap:18px; align-items:center; margin:26px 0 30px;
    padding:16px 18px; background:var(--panel); border:1px solid var(--hair);
    border-radius:14px; box-shadow:var(--shadow); }}
  .ref__label {{ font-size:12px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--muted); font-weight:700; max-width:14ch; }}
  .ref__strip {{ display:flex; gap:12px; }}
  .ref__strip img {{ height:120px; width:auto; border-radius:8px; cursor:zoom-in;
    background:var(--card); border:1px solid var(--hair); }}

  .grid {{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }}
  @media (max-width:820px) {{ .grid {{ grid-template-columns:1fr; }} }}
  .col {{ background:var(--panel); border:1px solid var(--hair); border-radius:16px;
    padding:16px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow); }}
  .col--rec {{ border-color:var(--accent); box-shadow:0 0 0 1px var(--accent), var(--shadow); }}
  .col__head h2 {{ font-size:19px; margin:2px 0 6px; letter-spacing:-.01em; }}
  .col__head p {{ margin:0; color:var(--muted); font-size:13.5px; line-height:1.5; }}
  .col__id {{ font-size:12px; font-weight:800; letter-spacing:.14em; color:var(--accent); }}
  .rec {{ display:inline-block; margin-top:10px; font-size:11px; font-weight:700;
    letter-spacing:.1em; text-transform:uppercase; color:var(--accent);
    background:var(--accent-soft); padding:4px 9px; border-radius:999px; }}
  .shot {{ margin:0; display:flex; flex-direction:column; gap:6px; }}
  .shot img {{ width:100%; height:auto; display:block; border-radius:10px; cursor:zoom-in;
    background:var(--card); border:1px solid var(--hair); transition:transform .12s ease; }}
  @media (prefers-reduced-motion:no-preference) {{ .shot img:hover {{ transform:translateY(-2px); }} }}
  .shot figcaption {{ font-size:11px; letter-spacing:.1em; text-transform:uppercase;
    color:var(--muted); font-weight:600; }}

  .note {{ margin:30px 0 0; padding:18px 20px; background:var(--accent-soft);
    border:1px solid var(--accent); border-radius:14px; font-size:15px; max-width:74ch; }}
  .note b {{ color:var(--accent); }}
  .foot {{ margin-top:26px; color:var(--muted); font-size:12.5px; letter-spacing:.02em; }}

  /* lightbox */
  .lb {{ position:fixed; inset:0; background:#0b0906ee; display:none;
    align-items:center; justify-content:center; padding:3vmin; z-index:50; cursor:zoom-out; }}
  .lb.open {{ display:flex; }}
  .lb img {{ max-width:96vw; max-height:94vh; border-radius:10px; box-shadow:0 20px 60px #000a; }}
  :focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
</style>

<div class="wrap">
  <p class="eyebrow">The Second Take &middot; visual-kit</p>
  <h1>Style &amp; movement iteration</h1>
  <p class="lede">Same locked character (bald cream egg-head, no nose), three <b>render directions</b>
    &times; two <b>poses</b> &mdash; a deadpan hold and an extreme shock-snap &mdash; so you can judge the
    finish and how far it moves at once. Pick a direction; next I push its movement range, then environments.</p>

  <div class="ref">
    <div class="ref__label">Today&rsquo;s locked base</div>
    <div class="ref__strip">
      <img src="{REF_BASE}" alt="current locked base" tabindex="0">
      <img src="{REF_RECOIL}" alt="current locked recoil" tabindex="0">
    </div>
    <p class="ref__label" style="max-width:26ch;color:var(--muted)">what we&rsquo;re iterating away from / pushing further</p>
  </div>

  <div class="grid">{cols}
  </div>

  <div class="note">
    <b>My read:</b> identity held in all six (bald, cream, no nose, no drift). The real fork is
    <b>D1 Clean</b> vs <b>D2 Hand-inked</b> &mdash; D2&rsquo;s ink line + halftone give the snap a hand-drawn
    energy D1 lacks, and it reproduced without losing the character. <b>D3</b> didn&rsquo;t separate from D1
    this pass. Tell me a direction (or &ldquo;D2 but less grain&rdquo; etc.) and I&rsquo;ll run the movement batch on it.
  </div>
  <p class="foot">Nano Banana (gemini-3-pro-image) &middot; seeded off the locked base + recoil &middot; click any frame to enlarge</p>
</div>

<div class="lb" id="lb" aria-hidden="true"><img id="lbimg" src="" alt=""></div>
<script>
  const lb = document.getElementById('lb'), lbimg = document.getElementById('lbimg');
  document.querySelectorAll('.shot img, .ref__strip img').forEach(function(im){{
    function open(){{ lbimg.src = im.src; lbimg.alt = im.alt; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); }}
    im.addEventListener('click', open);
    im.addEventListener('keydown', function(e){{ if(e.key==='Enter'||e.key===' ') {{ e.preventDefault(); open(); }} }});
  }});
  function close(){{ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); lbimg.src=''; }}
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){{ if(e.key==='Escape') close(); }});
</script>
"""

out = os.path.join(ITER, "review.html")
open(out, "w", encoding="utf-8").write(HTML)
print("wrote", out, f"({len(HTML)//1024} KB)")
