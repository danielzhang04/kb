# Style + movement iteration pass. Holds character IDENTITY fixed, varies RENDER (3 dirs) x POSE (hold/snap).
# Seeds off the LOCKED narrator base + action-recoil (identity + movement reference). Verify every output.
import json, os, ssl, base64, urllib.request, urllib.error, time, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = r"C:\Users\danie\faceless-youtube"
KIT  = os.path.join(ROOT, "channels", "the-second-take", "visual-kit")
env = {}
for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k] = v
try:
    import certifi; CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()

OUT = os.path.join(KIT, "_style_iter"); os.makedirs(OUT, exist_ok=True)
MODEL = "gemini-3-pro-image"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={env['GEMINI_API_KEY']}"

def nano(parts, aspect="2:3"):
    payload = {"contents":[{"parts":parts}], "generationConfig":{"responseModalities":["IMAGE"],"imageConfig":{"aspectRatio":aspect}}}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers={"Content-Type":"application/json"}, method="POST")
    for a in range(5):
        try:
            with urllib.request.urlopen(req, context=CTX, timeout=300) as r:
                j = json.load(r)
            for p in j.get("candidates",[{}])[0].get("content",{}).get("parts",[]):
                if "inlineData" in p: return base64.b64decode(p["inlineData"]["data"])
            raise RuntimeError("no image")
        except urllib.error.HTTPError as e:
            if e.code in (429,500,503) and a<4: time.sleep(12); continue
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='ignore')[:140]}")
        except (urllib.error.URLError, TimeoutError):
            if a<4: time.sleep(8); continue
            raise
def ip(b): return {"inlineData":{"mimeType":"image/png","data":b}}
def rd(p): return base64.b64encode(open(p,"rb").read()).decode()

REF_BASE   = rd(os.path.join(KIT, "refs", "base", "base.png"))          # locked identity, neutral
REF_RECOIL = rd(os.path.join(KIT, "refs", "base", "action-recoil.png")) # locked movement reference

# ---- IDENTITY: fixed across ALL directions (this is the locked character; do NOT change it) ----
IDENTITY = (
 "Keep the SAME single character as the reference images EXACTLY. Character identity (never changes):\n"
 "- HEAD: perfectly BALD, smooth EGG/OVAL head. NO hair, no hairline, no stubble.\n"
 "- FACE COLOUR: the whole head/face is ONE uniform FLAT pale-cream colour (#f5ead6). No skin tone, no blush, no gradient.\n"
 "- FEATURES: large round white eyes with small dark pupils, thin dark-brown brows, NO NOSE, a simple mouth. "
 "All expression from eyes + brows + mouth only.\n"
 "- OUTFIT: plain brown hoodie and brown trousers; small simple hands.\n"
 "This is the SAME guy every frame.")

# ---- RENDER: the variable we are comparing ----
RENDER = {
 "d1": ("KEEPER-PUSHED render: clean FLAT cel-shaded cartoon; an even MEDIUM-THICK dark warm brown-black (#241a12) "
        "outline; crisp bold flat colours with gentle soft cel shading and slightly punchier saturation. A polished, "
        "confident vector-cartoon finish."),
 "d2": ("HAND-INKED render: a ROUGH hand-drawn cartoon look — a slightly uneven, textured dark brown-black INK outline "
        "with a natural hand-drawn wobble (not a clean vector line); flat warm colours with visible HALFTONE dots / light "
        "cross-hatch shading and a subtle paper grain; warm dramatic lighting. Authored, illustrated, HeyHistorically-style. "
        "NOT a clean smooth vector."),
 "d3": ("BOLD-GRAPHIC render: a punchy graphic-poster look — a VERY THICK dark outline; a limited high-contrast flat "
        "palette of just a few colours; hard-edged flat shapes with minimal shading; strong sticker / graphic-novel punch."),
}

# ---- POSE: hold vs snap, to read movement inside each render ----
POSE = {
 "hold": ("POSE: standing in a calm DEADPAN neutral hold — arms at his sides, steady half-lidded unimpressed eyes, "
          "mouth a small flat line. Understated and still."),
 "snap": ("POSE: an EXTREME shock-snap reaction — whole body recoiling backward off-balance, BOTH hands thrown up, eyes "
          "huge and round, brows shot way up, mouth wide open mid-gasp. Big exaggerated cartoon motion with a few motion "
          "lines; proportions may squash/stretch for the action. Push it hard."),
}

STUDIO = " Full body, ONE single character, front view, on a plain soft light-grey studio background, nothing else. No text, no words, no labels."

def gen(name, prompt, aspect="2:3"):
    p = os.path.join(OUT, name + ".png")
    if os.path.exists(p): return f"  skip {name}"
    parts = [ip(REF_BASE), ip(REF_RECOIL), {"text": prompt}]
    try:
        open(p,"wb").write(nano(parts, aspect)); return f"  OK  {name}"
    except Exception as e:
        return f"  ERR {name}: {str(e)[:160]}"

def tasks():
    T = []
    for d in ("d1","d2","d3"):
        for ps in ("hold","snap"):
            prompt = IDENTITY + "\n\n" + RENDER[d] + "\n\n" + POSE[ps] + STUDIO
            T.append((f"{d}_{ps}", prompt, "2:3"))
    return T

if __name__ == "__main__":
    T = tasks()
    print(f"model={MODEL}  STYLE-ITER ({len(T)} imgs) -> {OUT}", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda t: gen(*t), T): print(line, flush=True)
    print("done", flush=True)
