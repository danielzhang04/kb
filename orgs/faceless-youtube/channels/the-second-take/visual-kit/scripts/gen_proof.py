# Architecture proof assets: canonical SHIP (flash) + rig-locked MacGregor (pro) + empty SHORE PLATE (flash).
# Ship + character are isolated on a plain flat bg (no shadow) so they can be keyed + composited. Verify each.
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

OUT = os.path.join(KIT, "_proof"); os.makedirs(OUT, exist_ok=True)
MODELS = {"flash": "gemini-2.5-flash-image", "pro": "gemini-3-pro-image"}
def url(m): return f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={env['GEMINI_API_KEY']}"
def nano(model, parts, aspect):
    payload = {"contents":[{"parts":parts}], "generationConfig":{"responseModalities":["IMAGE"],"imageConfig":{"aspectRatio":aspect}}}
    req = urllib.request.Request(url(model), data=json.dumps(payload).encode(), headers={"Content-Type":"application/json"}, method="POST")
    for a in range(5):
        try:
            with urllib.request.urlopen(req, context=CTX, timeout=300) as r:
                j = json.load(r)
            for p in j.get("candidates",[{}])[0].get("content",{}).get("parts",[]):
                if "inlineData" in p: return base64.b64decode(p["inlineData"]["data"])
            raise RuntimeError("no image")
        except urllib.error.HTTPError as e:
            if e.code in (429,500,503) and a<4: time.sleep(12); continue
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='ignore')[:160]}")
        except (urllib.error.URLError, TimeoutError):
            if a<4: time.sleep(8); continue
            raise
def ip(b): return {"inlineData":{"mimeType":"image/png","data":b}}
def rd(p): return base64.b64encode(open(p,"rb").read()).decode()

REF_MAC  = rd(os.path.join(KIT, "_cast_test", "con_macgregor.png"))
REF_BASE = rd(os.path.join(KIT, "refs", "base", "base.png"))

STYLE_ONLY = ("Draw in the SAME 2D flat cel cartoon style as the reference image: an even MEDIUM-THICK dark warm "
  "brown-black (#241a12) outline on everything, simple flat colours with gentle soft cel shading, rounded simple "
  "shapes, no realistic detail, no photo texture.")
ISOLATE = (" Centered, isolated on a PLAIN FLAT solid light-grey background (#e7e3da), NO ground line, NO drop "
  "shadow, NO other objects, nothing else — an isolated asset for cut-out compositing. No text, no words, no labels.")

# (name, model, refs, prompt, aspect)
TASKS = [
 ("ship", "flash", [REF_BASE],
   STYLE_ONLY + " Subject: a single 1820s wooden three-masted SAILING SHIP, side view (bow to the right), full "
   "cream-white sails, brown wooden hull, a small plain flag at the top." + ISOLATE, "16:9"),
 ("macgregor", "pro", [REF_MAC, REF_BASE],
   "This EXACT character — the tan-toned, dark-haired, sideburned con-man in the red-and-gold military coat and "
   "dark trousers with tall boots — full body, standing confidently with one hand raised. "
   "CRITICAL RIG (keep exactly): a smooth EGG-shaped head, NO NOSE, NO EARS, large simple cartoon eyes, thin brows, "
   "the SAME proportions as the base template. " + STYLE_ONLY + ISOLATE, "2:3"),
 ("shore_plate", "flash", [REF_BASE],
   STYLE_ONLY + " Subject: an EMPTY wide coastal scene — a grassy green clifftop/headland in the foreground, the "
   "blue sea and horizon beyond, a warm daytime sky with a few simple soft clouds. Absolutely NO people, NO "
   "characters, NO ship — just the empty landscape as a background plate. No text.", "16:9"),
]

def gen(name, model, refs, prompt, aspect):
    p = os.path.join(OUT, name + ".png")
    if os.path.exists(p): return f"  skip {name}"
    parts = [ip(b) for b in refs] + [{"text": prompt}]
    try:
        b = nano(MODELS[model], parts, aspect); open(p,"wb").write(b)
        return f"  OK  {name} [{model}] ({len(b)//1024} KB)"
    except Exception as e:
        return f"  ERR {name}: {str(e)[:160]}"

if __name__ == "__main__":
    print(f"PROOF ASSETS ({len(TASKS)}) -> {OUT}", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda t: gen(*t), TASKS): print(line, flush=True)
    print("done", flush=True)
