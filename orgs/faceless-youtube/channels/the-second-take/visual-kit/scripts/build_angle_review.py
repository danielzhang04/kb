# Builds a self-contained review gallery (data-URI images, lightbox) for the angle/depth/env stress test.
import base64, os

KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
T = os.path.join(KIT, "_angle_test")
def datauri(p): return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()

REF = datauri(os.path.join(KIT, "refs", "base", "base.png"))

# (file, stressor, verdict-class, verdict)
FRAMES = [
 ("1_three_quarter",     "Angle · 3/4",              "pass", "Fully on-model."),
 ("2_profile",           "Angle · profile",          "note", "On-model, but a no-nose egg in pure profile reads slightly featureless. Prefer 3/4."),
 ("3_rear_three_quarter","Angle · rear 3/4",         "pass", "Holds. Tiny gloss highlight on the head (minor flat-shading nit)."),
 ("4_far_small",         "Scale · far / small",      "pass", "Face stays on-model even at ~20% frame height."),
 ("5_closeup",           "Scale · extreme close-up", "pass", "Strong — every feature holds at close range."),
 ("6_env_boardroom",     "Environment · boardroom",  "pass", "Integrates cleanly against a built scene."),
 ("7_env_street_far",    "Depth + environment",      "weak", "WEAKEST: recognizable, but brows thicken, eyes shrink, face flatter. The real-video worst case."),
 ("8_low_angle",         "Angle · low / worm's-eye", "pass", "Holds. Minor brow thickening."),
]
IMG = {f: datauri(os.path.join(T, f + ".png")) for f, *_ in FRAMES}

cards = ""
for f, stress, cls, verdict in FRAMES:
    cards += f"""
    <figure class="card card--{cls}">
      <img src="{IMG[f]}" alt="{stress}" loading="lazy">
      <figcaption>
        <span class="tag">{stress}</span>
        <span class="verdict verdict--{cls}">{verdict}</span>
      </figcaption>
    </figure>"""

HTML = f"""<title>The Second Take — Angle / Depth / Environment Stress Test</title>
<style>
  :root {{
    --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555; --hair:#d4cdbf;
    --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --warn:#a8641c; --warn-soft:#a8641c1a;
    --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212;
  }}
  @media (prefers-color-scheme:dark) {{
    :root {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8; --muted:#a99f8d; --hair:#33291f;
      --accent:#54c3b8; --accent-soft:#54c3b820; --warn:#d69a52; --warn-soft:#d69a5222;
      --shadow:0 1px 2px #0006, 0 10px 30px #0007; }}
  }}
  :root[data-theme="light"] {{ --ground:#e7e3da; --panel:#f7f4ee; --card:#efeae0; --ink:#241a12; --muted:#6f6555;
    --hair:#d4cdbf; --accent:#1f6f6b; --accent-soft:#1f6f6b1a; --warn:#a8641c; --warn-soft:#a8641c1a;
    --shadow:0 1px 2px #241a1214, 0 8px 24px #241a1212; }}
  :root[data-theme="dark"] {{ --ground:#17130f; --panel:#201a14; --card:#26201a; --ink:#f2e9d8; --muted:#a99f8d;
    --hair:#33291f; --accent:#54c3b8; --accent-soft:#54c3b820; --warn:#d69a52; --warn-soft:#d69a5222;
    --shadow:0 1px 2px #0006, 0 10px 30px #0007; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--ground); color:var(--ink);
    font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:1180px; margin:0 auto; padding:clamp(20px,4vw,44px); }}
  .eyebrow {{ font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); font-weight:700; margin:0 0 8px; }}
  h1 {{ font-size:clamp(25px,3.6vw,38px); line-height:1.1; margin:0 0 12px; letter-spacing:-.02em; text-wrap:balance; font-weight:800; }}
  .verdict-box {{ margin:0 0 8px; padding:16px 20px; background:var(--accent-soft); border:1px solid var(--accent);
    border-radius:14px; max-width:78ch; }}
  .verdict-box b {{ color:var(--accent); }}
  .ref {{ display:flex; gap:16px; align-items:center; margin:22px 0 26px; padding:12px 16px; background:var(--panel);
    border:1px solid var(--hair); border-radius:12px; box-shadow:var(--shadow); }}
  .ref img {{ height:96px; border-radius:8px; background:var(--card); border:1px solid var(--hair); cursor:zoom-in; }}
  .ref span {{ font-size:12px; letter-spacing:.13em; text-transform:uppercase; color:var(--muted); font-weight:700; }}
  .grid {{ display:grid; grid-template-columns:repeat(2,1fr); gap:18px; }}
  @media (max-width:720px) {{ .grid {{ grid-template-columns:1fr; }} }}
  .card {{ margin:0; background:var(--panel); border:1px solid var(--hair); border-radius:16px; overflow:hidden;
    box-shadow:var(--shadow); display:flex; flex-direction:column; }}
  .card--weak {{ border-color:var(--warn); box-shadow:0 0 0 1px var(--warn), var(--shadow); }}
  .card img {{ width:100%; height:auto; display:block; background:var(--card); cursor:zoom-in; }}
  figcaption {{ padding:12px 14px 14px; display:flex; flex-direction:column; gap:6px; }}
  .tag {{ font-size:11px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:var(--accent); }}
  .card--weak .tag {{ color:var(--warn); }}
  .verdict {{ font-size:13.5px; color:var(--muted); line-height:1.45; }}
  .verdict--weak {{ color:var(--ink); }}
  .foot {{ margin-top:24px; color:var(--muted); font-size:12.5px; }}
  .lb {{ position:fixed; inset:0; background:#0b0906ee; display:none; align-items:center; justify-content:center;
    padding:3vmin; z-index:50; cursor:zoom-out; }}
  .lb.open {{ display:flex; }}
  .lb img {{ max-width:96vw; max-height:94vh; border-radius:10px; box-shadow:0 20px 60px #000a; }}
  :focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
</style>

<div class="wrap">
  <p class="eyebrow">The Second Take · visual-kit · robustness test</p>
  <h1>Does the lock hold across angle, depth &amp; environment?</h1>
  <div class="verdict-box">
    <b>Verdict: robust.</b> Identity held recognizably across all 8 — every angle, both scales, and inside
    built scenes, off a single base seed. Fragile details: <b>thin brows</b> (thicken under low/far angles) and
    the <b>flat no-gloss face</b>. Biggest drift is the <b>far + busy-environment</b> combo (frame 7) — which is
    why the shot rule should be: generate character and background as <b>separate layers, composited</b>.
  </div>
  <div class="ref">
    <img src="{REF}" alt="locked base reference" tabindex="0">
    <span>Locked base &mdash; the single seed every frame was generated from</span>
  </div>
  <div class="grid">{cards}
  </div>
  <p class="foot">Nano Banana (gemini-3-pro-image) · one stressor isolated per frame · click any frame to enlarge · full findings in _angle_test/notes.md</p>
</div>

<div class="lb" id="lb" aria-hidden="true"><img id="lbimg" src="" alt=""></div>
<script>
  const lb=document.getElementById('lb'), lbimg=document.getElementById('lbimg');
  document.querySelectorAll('.card img, .ref img').forEach(function(im){{
    function open(){{ lbimg.src=im.src; lbimg.alt=im.alt; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); }}
    im.addEventListener('click', open);
    im.addEventListener('keydown', function(e){{ if(e.key==='Enter'||e.key===' ') {{ e.preventDefault(); open(); }} }});
  }});
  function close(){{ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); lbimg.src=''; }}
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){{ if(e.key==='Escape') close(); }});
</script>
"""
out = os.path.join(T, "review.html")
open(out, "w", encoding="utf-8").write(HTML)
print("wrote", out, f"({len(HTML)//1024} KB)")
