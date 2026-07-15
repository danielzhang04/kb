# Robustness stress test: does the LOCKED identity hold across angle / depth / in-environment?
# Isolates one stressor per frame. Seeds off refs/base/base.png. Verify every output by looking.
import json, os, ssl, base64, urllib.request, urllib.error, time
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

OUT = os.path.join(KIT, "_angle_test"); os.makedirs(OUT, exist_ok=True)
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

REF_BASE = rd(os.path.join(KIT, "refs", "base", "base.png"))

IDENTITY = (
 "Keep the SAME single character as the reference image EXACTLY — this is a LOCKED character model.\n"
 "- HEAD: perfectly BALD, smooth EGG/OVAL head. NO hair, hairline, or stubble.\n"
 "- FACE COLOUR: the whole head/face is ONE uniform FLAT pale-cream colour (#f5ead6). No skin tone, no blush, no gradient.\n"
 "- FEATURES: large round white eyes with small dark pupils, thin dark-brown brows, NO NOSE, a simple mouth. "
 "Expression from eyes + brows + mouth only.\n"
 "- OUTLINE: an even MEDIUM-THICK dark warm brown-black (#241a12) outline on everything.\n"
 "- RENDER: clean FLAT cel-shaded cartoon with gentle soft cel shading, warm palette; rounded slightly stubby "
 "proportions, small simple hands.\n"
 "- OUTFIT: plain brown hoodie and brown trousers.\n"
 "This is the SAME guy every time. No text, no words, no letters, no labels, no logos.")

# (name, scene, aspect, stressor)
TASKS = [
 ("1_three_quarter", "Full body, this exact character standing relaxed in a 3/4 VIEW (turned about 45 degrees so we "
   "see one side of the head and body), calm neutral expression, on a plain soft light-grey studio background.",
   "2:3", "angle: 3/4"),
 ("2_profile", "Full body, this exact character in a full SIDE PROFILE view, facing to the left so we see the side of "
   "the head and one eye, standing neutrally, plain soft light-grey studio background. Still NO nose — keep the smooth "
   "egg-shaped profile.", "2:3", "angle: profile (no-nose test)"),
 ("3_rear_three_quarter", "Full body, this exact character seen from BEHIND at a 3/4 rear angle — we mostly see the back "
   "of the bald cream egg head and the back of the hoodie, head turned slightly so just a sliver of the face shows. "
   "Plain soft light-grey studio background.", "2:3", "angle: rear 3/4 (hardest)"),
 ("4_far_small", "WIDE shot with a lot of empty space. This exact character stands SMALL in the lower-centre of the "
   "frame, occupying only about 20% of the height, full body, neutral pose. Plain soft light-grey studio background. "
   "Keep the face fully on-model even though he is small in frame.", "16:9", "scale: far / small"),
 ("5_closeup", "EXTREME CLOSE-UP of this exact character's head and shoulders filling the frame — the bald cream egg "
   "head large and centred, a calm skeptical expression. Plain soft light-grey background. Keep every locked feature "
   "exact at close range.", "2:3", "scale: extreme close-up"),
 ("6_env_boardroom", "This exact character in a MEDIUM shot, standing INSIDE a simple flat-cartoon corporate BOARDROOM "
   "— a long dark-wood table, a teal accent wall, a window with soft daylight, warm wood accents. He looks unimpressed. "
   "Same locked flat-cel character placed against the built scene. No text.", "16:9", "environment: boardroom"),
 ("7_env_street_far", "WIDE street scene. This exact character walks SMALL-ish (about 30% of the frame height) along a "
   "simple flat-cartoon city sidewalk — shopfronts, a lamppost, a warm afternoon palette. Full body, mid-stride. Keep "
   "him on-model at this distance. No text.", "16:9", "combined: depth + environment"),
 ("8_low_angle", "Full body, this exact character seen from a LOW CAMERA ANGLE looking UP at him (worm's-eye view so he "
   "looms slightly larger), a confident pose. Plain soft light-grey studio background.", "2:3", "angle: low / worm's-eye"),
]

def gen(name, scene, aspect, _):
    p = os.path.join(OUT, name + ".png")
    if os.path.exists(p): return f"  skip {name}"
    parts = [ip(REF_BASE), {"text": IDENTITY + "\n\nSCENE: " + scene}]
    try:
        open(p,"wb").write(nano(parts, aspect)); return f"  OK  {name}"
    except Exception as e:
        return f"  ERR {name}: {str(e)[:160]}"

if __name__ == "__main__":
    print(f"model={MODEL}  ANGLE/DEPTH/ENV STRESS TEST ({len(TASKS)}) -> {OUT}", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda t: gen(*t), TASKS): print(line, flush=True)
    print("done", flush=True)
