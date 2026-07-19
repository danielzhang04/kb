# Builds the Warm-Face lock Style Lab: big frames + click-to-enlarge lightbox, self-contained data URIs.
import os, base64, subprocess, html

KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
SRC = os.path.join(KIT, "sweep2", "warmface_final")
TH  = os.path.join(KIT, "sweep2", "_thumbs_final"); os.makedirs(TH, exist_ok=True)

def uri(name, w):
    out = os.path.join(TH, f"{name}_{w}.jpg")
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",os.path.join(SRC,name+".png"),
                    "-vf",f"scale={w}:-1:flags=lanczos","-q:v","4",out], check=True)
    return "data:image/jpeg;base64," + base64.b64encode(open(out,"rb").read()).decode()

# section -> list of (file, label, note); portraits embed at 760, scenes at 1120
NARRATOR = ("01_base", "The narrator", "The channel's recurring host. Bald pale-cream egg head, big "
            "expressive eyes, medium-thick warm brown outline, calm neutral read. Everything else is seeded off this frame.")
OUTFITS = [
 ("02_suit_smug",     "Suit · skeptical",   "Navy suit, arms crossed, a knowing smirk — the ‘I've seen this before’ register."),
 ("03_hoodie_worried","Hoodie · worried",   "Maroon hoodie, fidgeting, brows up, a bead of sweat — the ‘this is bad’ read."),
 ("04_shirt_explain", "Shirt · explaining", "Rolled sleeves, hand out, mouth open mid-sentence — the teaching beat."),
]
SCENES = [
 ("05_present_chart",   "Presenting a chart", "Beside a crashing red trend line, with the channel’s red accent glow."),
 ("06_street_two",      "On the street (cast)","Handing coffee to a second character — the bald cream-face style holds across two people."),
 ("07_warzone_reporter","Field reporter",     "Flak jacket and mic over a stylised conflict backdrop — clean, never gory."),
 ("08_bank_teller",     "At the bank (cast)",  "Skeptical at the counter, a stern teller behind glass. Cool teal interior."),
]
BACKS = [
 ("09_map_arrows","Map with flows",   "No characters. Bold red/teal arrows sweeping a stylised map — pure B-roll plate."),
 ("10_city_park", "City park",        "No characters. An establishing scene in the same warm palette and outline."),
 ("11_props",     "Money props",      "No characters. A flat-lay kit — bank, piggy, briefcase, coins, up/down arrows."),
]

def figure(item, w):
    name, label, note = item
    u = uri(name, w)
    return f'''      <figure class="card">
        <button class="frame" data-src="{u}" aria-label="Enlarge: {html.escape(label)}">
          <img src="{u}" alt="{html.escape(label)}" loading="lazy">
        </button>
        <figcaption><b>{html.escape(label)}</b><span>{html.escape(note)}</span></figcaption>
      </figure>'''

def grid(items, w, cls):
    return f'    <div class="grid {cls}">\n' + "\n".join(figure(i, w) for i in items) + "\n    </div>"

hero = uri(NARRATOR[0], 900)

page = f'''<title>The Second Take — Warm-Face, locked</title>
<style>
  :root {{
    --paper:#f2e9d7; --card:#fbf5ea; --ink:#2c2016; --muted:#7c6d5b; --line:#e3d6bf;
    --outline:#3a2a1e; --accent:#d8402f; --accent-soft:#f6e4dd;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --paper:#181410; --card:#221c16; --ink:#efe6d6; --muted:#a4917a; --line:#39301f;
      --outline:#0d0a07; --accent:#f0603f; --accent-soft:#33231d; }}
  }}
  :root[data-theme="light"] {{
    --paper:#f2e9d7; --card:#fbf5ea; --ink:#2c2016; --muted:#7c6d5b; --line:#e3d6bf;
    --outline:#3a2a1e; --accent:#d8402f; --accent-soft:#f6e4dd;
  }}
  :root[data-theme="dark"] {{
    --paper:#181410; --card:#221c16; --ink:#efe6d6; --muted:#a4917a; --line:#39301f;
    --outline:#0d0a07; --accent:#f0603f; --accent-soft:#33231d;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--paper); color:var(--ink);
    font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }}
  .wrap {{ max-width:1120px; margin:0 auto; padding:clamp(28px,5vw,64px) clamp(16px,4vw,44px); }}
  header {{ border-bottom:3px solid var(--outline); padding-bottom:24px; margin-bottom:8px; }}
  .eyebrow {{ text-transform:uppercase; letter-spacing:.2em; font-size:12px; font-weight:700;
    color:var(--accent); margin:0 0 12px; }}
  h1 {{ font-family:Georgia,"Times New Roman",serif; font-weight:700; font-size:clamp(30px,5.4vw,50px);
    line-height:1.02; margin:0; text-wrap:balance; letter-spacing:-.01em; }}
  .lede {{ color:var(--muted); max-width:68ch; margin:16px 0 0; font-size:clamp(15px,1.6vw,17px); }}
  .lede b {{ color:var(--ink); }}
  h2 {{ font-family:Georgia,serif; font-size:clamp(19px,2.4vw,24px); margin:44px 0 4px;
    display:flex; align-items:baseline; gap:12px; }}
  h2 .n {{ font-size:13px; font-weight:700; color:var(--accent); letter-spacing:.14em; }}
  .sub {{ color:var(--muted); font-size:14px; margin:0 0 20px; }}
  .grid {{ display:grid; gap:clamp(16px,2.4vw,28px); }}
  .cols3 {{ grid-template-columns:repeat(3,1fr); }}
  .cols2 {{ grid-template-columns:repeat(2,1fr); }}
  @media (max-width:760px) {{ .cols3 {{ grid-template-columns:repeat(2,1fr); }} }}
  @media (max-width:520px) {{ .cols3, .cols2 {{ grid-template-columns:1fr; }} }}
  .card {{ display:flex; flex-direction:column; gap:11px; margin:0; }}
  .frame {{ padding:0; border:3px solid var(--outline); border-radius:7px; overflow:hidden;
    background:var(--card); cursor:zoom-in; display:block; width:100%;
    box-shadow:0 2px 0 var(--line); transition:transform .12s ease, box-shadow .12s ease; }}
  .frame:hover {{ transform:translateY(-2px); box-shadow:0 6px 0 var(--line); }}
  .frame:focus-visible {{ outline:3px solid var(--accent); outline-offset:2px; }}
  .frame img {{ width:100%; height:100%; object-fit:cover; display:block; }}
  .hero .frame {{ max-width:420px; }}
  figcaption {{ display:flex; flex-direction:column; gap:3px; }}
  figcaption b {{ font-size:15px; }}
  figcaption span {{ color:var(--muted); font-size:13.5px; line-height:1.5; }}
  .heroblock {{ display:grid; grid-template-columns:420px 1fr; gap:clamp(20px,4vw,44px);
    align-items:center; margin-top:28px; }}
  @media (max-width:680px) {{ .heroblock {{ grid-template-columns:1fr; }} .hero .frame {{ max-width:none; }} }}
  .heronote h2 {{ margin-top:0; }}
  .heronote p {{ color:var(--muted); max-width:46ch; }}
  .hint {{ display:inline-flex; align-items:center; gap:7px; font-size:13px; color:var(--muted);
    border:1px solid var(--line); border-radius:20px; padding:5px 13px; margin-top:6px; }}
  .hint b {{ color:var(--accent); }}
  footer {{ margin-top:52px; padding-top:20px; border-top:3px solid var(--outline);
    color:var(--muted); font-size:13px; }}
  footer code {{ background:var(--card); border:1px solid var(--line); border-radius:4px; padding:1px 6px; }}
  /* lightbox */
  #lb {{ position:fixed; inset:0; background:rgba(20,14,8,.86); display:none; z-index:50;
    align-items:center; justify-content:center; padding:clamp(16px,4vw,48px); cursor:zoom-out; }}
  #lb.on {{ display:flex; }}
  #lb img {{ max-width:100%; max-height:100%; border:4px solid #f6efe0; border-radius:8px;
    box-shadow:0 20px 60px rgba(0,0,0,.5); }}
  #lb .x {{ position:absolute; top:18px; right:22px; color:#f6efe0; font-size:30px; line-height:1;
    background:none; border:none; cursor:pointer; font-family:system-ui; }}
  @media (prefers-reduced-motion:reduce) {{ .frame {{ transition:none; }} }}
</style>
<div class="wrap">
  <header>
    <p class="eyebrow">The Second Take · character + style lock</p>
    <h1>Warm-Face is the look. Here it is, running.</h1>
    <p class="lede">You picked <b>Warm-Face</b> — the blank pale-cream oval head with simple, expressive
      features and a thick, confident warm outline. This is that design finalised: one recurring narrator,
      proven across outfits, expressions, scenes, a second cast member, and background plates with no one in
      them. If the same person and the same line survive all of that, the style is recreatable — which is
      the whole requirement. <span class="hint">&#128269; <b>Click any image</b> to see it full size.</span></p>
  </header>

  <section class="hero">
    <div class="heroblock">
      <figure class="card">
        <button class="frame" data-src="{hero}" aria-label="Enlarge: the narrator">
          <img src="{hero}" alt="The narrator base design">
        </button>
      </figure>
      <div class="heronote">
        <h2>The narrator</h2>
        <p>{html.escape(NARRATOR[2])}</p>
      </div>
    </div>
  </section>

  <h2><span class="n">01</span> Outfits &amp; expressions</h2>
  <p class="sub">Same person, three registers — the emotional range the scripts will actually call for.</p>
{grid(OUTFITS, 760, "cols3")}

  <h2><span class="n">02</span> Scenes &amp; cast</h2>
  <p class="sub">Him in context, plus a second character. The style has to hold when the world fills in.</p>
{grid(SCENES, 1120, "cols2")}

  <h2><span class="n">03</span> Backgrounds — no character</h2>
  <p class="sub">The same outline and palette on pure B-roll plates — maps, establishing scenes, prop kits.</p>
{grid(BACKS, 1120, "cols3")}

  <footer>gemini-3-pro-image · full-res PNGs in <code>visual-kit/sweep2/warmface_final/</code>.
    Next step once you sign off: lock it (Recraft style-token / fixed Nano reference set) and write it into
    <code>style.md</code> + <code>dna.md</code>.</footer>
</div>

<div id="lb" role="dialog" aria-modal="true" aria-label="Enlarged image">
  <button class="x" aria-label="Close">×</button>
  <img alt="">
</div>
<script>
  (function() {{
    var lb = document.getElementById('lb'), img = lb.querySelector('img');
    function open(src) {{ img.src = src; lb.classList.add('on'); document.body.style.overflow='hidden'; }}
    function close() {{ lb.classList.remove('on'); img.src=''; document.body.style.overflow=''; }}
    document.querySelectorAll('.frame').forEach(function(b) {{
      b.addEventListener('click', function() {{ open(b.getAttribute('data-src')); }});
    }});
    lb.addEventListener('click', close);
    document.addEventListener('keydown', function(e) {{ if (e.key === 'Escape') close(); }});
  }})();
</script>
'''

open(os.path.join(KIT, "style-lab.html"), "w", encoding="utf-8").write(page)
print("wrote", len(page), "bytes")
