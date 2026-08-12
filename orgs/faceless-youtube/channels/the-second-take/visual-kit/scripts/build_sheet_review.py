# Builds a self-contained gallery of the EXISTING locked narrator model sheet (refs/base/*.png). Zero generation.
import base64, os
from io import BytesIO
try:
    from PIL import Image; _PIL = True
except Exception:
    _PIL = False
KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
R = os.path.join(KIT, "refs", "base")
def datauri(p, w=620):  # downscale so the whole gallery stays under the 16MB artifact cap
    if _PIL:
        im = Image.open(p).convert("RGB"); im.thumbnail((w, w * 2))
        buf = BytesIO(); im.save(buf, "JPEG", quality=88, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()
def have(n): return os.path.exists(os.path.join(R, n + ".png"))
def uri(n): return datauri(os.path.join(R, n + ".png"))

EXPR = [  # curated calm -> exaggerated
 ("expr-deadpan","Deadpan"),("expr-skeptical","Skeptical"),("expr-thinking","Thinking"),
 ("expr-talking","Talking"),("expr-confused","Confused"),("expr-worried","Worried"),
 ("expr-annoyed","Annoyed"),("expr-fear","Fear"),
 ("expr-despair","Despair"),("expr-surprised","Surprised"),("expr-smug","Smug"),
 ("expr-greedy","Greedy"),("expr-delighted","Delighted"),
]
ACT = [
 ("action-present","Present"),("action-leanpoint","Lean-point"),("action-accuse","Accuse"),
 ("action-offering","Offering"),("action-armscrossed","Arms crossed"),("action-shrug","Shrug"),
 ("action-walk","Walk"),("action-celebrate","Celebrate"),("action-slump","Slump"),
 ("action-recoil","Recoil"),("action-headinhands","Head in hands"),
]

def cards(items):
    out = ""
    for n, label in items:
        if not have(n): continue
        out += f"""
      <figure class="card"><img src="{uri(n)}" alt="{label}" loading="lazy"><figcaption>{label}</figcaption></figure>"""
    return out

BASE = uri("base") if have("base") else ""
n_expr = sum(1 for n,_ in EXPR if have(n))
n_act  = sum(1 for n,_ in ACT if have(n))

HTML = f"""<title>The Second Take — Narrator Model Sheet</title>
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
  h2 {{ font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin:30px 0 14px; font-weight:700; }}
  h2 span {{ color:var(--accent); }}
  .note {{ margin:0; padding:15px 18px; background:var(--accent-soft); border:1px solid var(--accent);
    border-radius:14px; max-width:82ch; font-size:14.5px; }}
  .note b {{ color:var(--accent); }}
  .base {{ display:flex; gap:18px; align-items:center; margin:18px 0 4px; padding:14px 16px; background:var(--panel);
    border:1px solid var(--hair); border-radius:14px; box-shadow:var(--shadow); }}
  .base img {{ height:180px; border-radius:10px; background:var(--card); border:1px solid var(--hair); cursor:zoom-in; }}
  .base span {{ font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700; }}
  .grid {{ display:grid; grid-template-columns:repeat(5,1fr); gap:14px; }}
  @media (max-width:900px) {{ .grid {{ grid-template-columns:repeat(3,1fr); }} }}
  @media (max-width:560px) {{ .grid {{ grid-template-columns:repeat(2,1fr); }} }}
  .card {{ margin:0; background:var(--panel); border:1px solid var(--hair); border-radius:12px; overflow:hidden; box-shadow:var(--shadow); }}
  .card img {{ width:100%; height:auto; display:block; background:var(--card); cursor:zoom-in; }}
  figcaption {{ padding:8px 10px 10px; font-size:12.5px; font-weight:700; letter-spacing:.02em; color:var(--muted); }}
  .foot {{ margin-top:24px; color:var(--muted); font-size:12.5px; }}
  .lb {{ position:fixed; inset:0; background:#0b0906ee; display:none; align-items:center; justify-content:center;
    padding:3vmin; z-index:50; cursor:zoom-out; }}
  .lb.open {{ display:flex; }} .lb img {{ max-width:96vw; max-height:94vh; border-radius:10px; box-shadow:0 20px 60px #000a; }}
  :focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
</style>

<div class="wrap">
  <p class="eyebrow">The Second Take · visual-kit · existing model sheet</p>
  <h1>Narrator reaction library &mdash; what we already have</h1>
  <div class="note">
    <b>Judge against:</b> the <b>restrained dial</b> (dry, unimpressed insider &mdash; small reactions most of
    the time, rare big takes) and a <b>small&rarr;exaggerated range</b>. Because the facial rig is now shared,
    whatever we tune here <b>maps onto the whole cast.</b> Mark what's too polite, what's missing, and which
    ones need a bigger "snap" sibling. Nothing here is newly generated &mdash; these are the locked refs.
  </div>

  <div class="base"><img src="{BASE}" alt="base"><span>base &mdash; the neutral rig<br>everything seeds off this</span></div>

  <h2>Expressions <span>({n_expr})</span> &mdash; calm &rarr; exaggerated</h2>
  <div class="grid">{cards(EXPR)}
  </div>

  <h2>Body / poses <span>({n_act})</span> &mdash; simple movements</h2>
  <div class="grid">{cards(ACT)}
  </div>

  <p class="foot">Locked refs from refs/base/ · click any frame to enlarge · reactions here map onto every cast member (shared rig)</p>
</div>

<div class="lb" id="lb" aria-hidden="true"><img id="lbimg" src="" alt=""></div>
<script>
  const lb=document.getElementById('lb'), lbimg=document.getElementById('lbimg');
  document.querySelectorAll('.card img, .base img').forEach(function(im){{
    function open(){{ lbimg.src=im.src; lbimg.alt=im.alt; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); }}
    im.addEventListener('click', open);
    im.addEventListener('keydown', function(e){{ if(e.key==='Enter'||e.key===' ') {{ e.preventDefault(); open(); }} }});
  }});
  function close(){{ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); lbimg.src=''; }}
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){{ if(e.key==='Escape') close(); }});
</script>
"""
out_dir = os.path.join(KIT, "_model_sheet"); os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "review.html")
open(out, "w", encoding="utf-8").write(HTML)
print("wrote", out, f"({len(HTML)//1024} KB)  expr={n_expr} act={n_act}")
