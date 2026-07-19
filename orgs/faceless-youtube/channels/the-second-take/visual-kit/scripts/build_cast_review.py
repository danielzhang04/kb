# Builds a self-contained review gallery (data-URI images, lightbox) for the cast test.
import base64, os
KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
C = os.path.join(KIT, "_cast_test")
def datauri(p): return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()

REF = datauri(os.path.join(KIT, "refs", "base", "base.png"))
LINEUP = datauri(os.path.join(C, "lineup.png"))
CHARS = [
 ("con_macgregor", "The con-man", "MacGregor — tan, dark hair + sideburns, red military coat, smug."),
 ("investor_mark", "The investor", "Pale, grey combover, spectacles, tailcoat, anxious."),
 ("banker",        "The banker",   "Cream, bald-top + grey beard/moustache, black formal, stern."),
 ("settler_woman", "The emigrant", "Warm brown, bonnet + shawl, worried-hopeful. (gender + hair)"),
]
EXPR = [
 ("macgregor_worried",   "MacGregor — worried"),
 ("macgregor_delighted", "MacGregor — delighted"),
]
IMG = {f: datauri(os.path.join(C, f + ".png")) for f, *_ in CHARS + EXPR}

char_cards = ""
for f, name, desc in CHARS:
    char_cards += f"""
    <figure class="card">
      <img src="{IMG[f]}" alt="{name}" loading="lazy">
      <figcaption><span class="tag">{name}</span><span class="desc">{desc}</span></figcaption>
    </figure>"""
expr_cards = ""
for f, name in EXPR:
    expr_cards += f"""
    <figure class="card card--sm">
      <img src="{IMG[f]}" alt="{name}" loading="lazy">
      <figcaption><span class="tag">{name}</span></figcaption>
    </figure>"""

HTML = f"""<title>The Second Take — Cast Test</title>
<style>
  :root {{ --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555; --hair:#d4cdbf;
    --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212; }}
  @media (prefers-color-scheme:dark) {{ :root {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8;
    --muted:#a99f8d; --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820; --shadow:0 1px 2px #0006, 0 10px 30px #0007; }} }}
  :root[data-theme="light"] {{ --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555;
    --hair:#d4cdbf; --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212; }}
  :root[data-theme="dark"] {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8; --muted:#a99f8d;
    --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820; --shadow:0 1px 2px #0006, 0 10px 30px #0007; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--ground); color:var(--ink);
    font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:1180px; margin:0 auto; padding:clamp(20px,4vw,44px); }}
  .eyebrow {{ font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); font-weight:700; margin:0 0 8px; }}
  h1 {{ font-size:clamp(25px,3.6vw,38px); line-height:1.1; margin:0 0 12px; letter-spacing:-.02em; text-wrap:balance; font-weight:800; }}
  h2 {{ font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin:34px 0 14px; font-weight:700; }}
  .verdict-box {{ margin:0; padding:16px 20px; background:var(--accent-soft); border:1px solid var(--accent);
    border-radius:14px; max-width:80ch; }}
  .verdict-box b {{ color:var(--accent); }}
  .hero {{ margin:16px 0 4px; border:1px solid var(--hair); border-radius:16px; overflow:hidden; background:var(--panel); box-shadow:var(--shadow); }}
  .hero img {{ width:100%; display:block; cursor:zoom-in; background:var(--card); }}
  .hero-cap {{ padding:10px 16px; font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:700; }}
  .grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }}
  .pair {{ display:grid; grid-template-columns:repeat(2,minmax(0,320px)); gap:16px; }}
  @media (max-width:820px) {{ .grid {{ grid-template-columns:repeat(2,1fr); }} }}
  @media (max-width:520px) {{ .grid, .pair {{ grid-template-columns:1fr; }} }}
  .card {{ margin:0; background:var(--panel); border:1px solid var(--hair); border-radius:14px; overflow:hidden; box-shadow:var(--shadow); }}
  .card img {{ width:100%; height:auto; display:block; background:var(--card); cursor:zoom-in; }}
  figcaption {{ padding:11px 13px 13px; display:flex; flex-direction:column; gap:4px; }}
  .tag {{ font-size:12px; font-weight:800; letter-spacing:.06em; color:var(--accent); }}
  .desc {{ font-size:12.5px; color:var(--muted); line-height:1.4; }}
  .ref {{ display:flex; gap:14px; align-items:center; margin:22px 0 0; padding:12px 16px; background:var(--panel);
    border:1px solid var(--hair); border-radius:12px; box-shadow:var(--shadow); }}
  .ref img {{ height:84px; border-radius:8px; background:var(--card); border:1px solid var(--hair); cursor:zoom-in; }}
  .ref span {{ font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700; }}
  .foot {{ margin-top:24px; color:var(--muted); font-size:12.5px; }}
  .lb {{ position:fixed; inset:0; background:#0b0906ee; display:none; align-items:center; justify-content:center;
    padding:3vmin; z-index:50; cursor:zoom-out; }}
  .lb.open {{ display:flex; }} .lb img {{ max-width:96vw; max-height:94vh; border-radius:10px; box-shadow:0 20px 60px #000a; }}
  :focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
</style>

<div class="wrap">
  <p class="eyebrow">The Second Take · visual-kit · cast test</p>
  <h1>One design concept &rarr; a distinct cast</h1>
  <div class="verdict-box">
    <b>Verdict: it works.</b> Four instantly-distinct people, one shared style; the reaction range carries onto
    a cast member (MacGregor worried / delighted). <b>One decision:</b> to make age &amp; gender read, the model
    varied head-shape/facial-structure — so this is a <b>family of rounded heads</b>, not the narrator's pure egg.
    Recommend adopting that (shared style + no-nose + proportions; head-shape varies). The con-man drifted most
    toward a realistic head — I'd rein him back a touch.
  </div>

  <h2>The tell — group lineup</h2>
  <div class="hero"><img src="{LINEUP}" alt="cast lineup"><div class="hero-cap">Do they read as four different people in one world? &mdash; yes</div></div>

  <h2>The cast (Poyais — real video-1 assets)</h2>
  <div class="grid">{char_cards}
  </div>

  <h2>Reaction range carries onto a cast member</h2>
  <div class="pair">{expr_cards}
  </div>

  <div class="ref"><img src="{REF}" alt="narrator base"><span>Narrator base &mdash; the pure-egg form the cast is derived from (bald = his trait)</span></div>
  <p class="foot">Nano Banana (gemini-3-pro-image) · characters seeded off the base for form only · click any frame to enlarge · full notes in _cast_test/notes.md</p>
</div>

<div class="lb" id="lb" aria-hidden="true"><img id="lbimg" src="" alt=""></div>
<script>
  const lb=document.getElementById('lb'), lbimg=document.getElementById('lbimg');
  document.querySelectorAll('.card img, .hero img, .ref img').forEach(function(im){{
    function open(){{ lbimg.src=im.src; lbimg.alt=im.alt; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); }}
    im.addEventListener('click', open);
    im.addEventListener('keydown', function(e){{ if(e.key==='Enter'||e.key===' ') {{ e.preventDefault(); open(); }} }});
  }});
  function close(){{ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); lbimg.src=''; }}
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){{ if(e.key==='Escape') close(); }});
</script>
"""
out = os.path.join(C, "review.html")
open(out, "w", encoding="utf-8").write(HTML)
print("wrote", out, f"({len(HTML)//1024} KB)")
