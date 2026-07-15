# Scene-style-lock test + flash-vs-pro cost/quality compare. Composed Poyais STORY SHOTS in 2D cartoon style.
# Most beats on cheap FLASH; beat 1 on BOTH flash + pro to compare. Verify every output.
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

OUT = os.path.join(KIT, "_scene_test"); os.makedirs(OUT, exist_ok=True)
MODELS = {"flash": "gemini-2.5-flash-image", "pro": "gemini-3-pro-image"}

def url(model): return f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={env['GEMINI_API_KEY']}"
def nano(model, parts, aspect="16:9"):
    payload = {"contents":[{"parts":parts}], "generationConfig":{"responseModalities":["IMAGE"],"imageConfig":{"aspectRatio":aspect}}}
    req = urllib.request.Request(url(model), data=json.dumps(payload).encode(), headers={"Content-Type":"application/json"}, method="POST")
    for a in range(5):
        try:
            with urllib.request.urlopen(req, context=CTX, timeout=300) as r:
                j = json.load(r)
            for p in j.get("candidates",[{}])[0].get("content",{}).get("parts",[]):
                if "inlineData" in p: return base64.b64decode(p["inlineData"]["data"])
            raise RuntimeError("no image in response")
        except urllib.error.HTTPError as e:
            if e.code in (429,500,503) and a<4: time.sleep(12); continue
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='ignore')[:160]}")
        except (urllib.error.URLError, TimeoutError):
            if a<4: time.sleep(8); continue
            raise
def ip(b): return {"inlineData":{"mimeType":"image/png","data":b}}
def rd(p): return base64.b64encode(open(p,"rb").read()).decode()

# seeds: MacGregor cast frame (identity) + base (style/form). Cast frame still lives in _cast_test.
REF_MAC  = rd(os.path.join(KIT, "_cast_test", "con_macgregor.png"))
REF_BASE = rd(os.path.join(KIT, "refs", "base", "base.png"))

WORLD = (
 "Render the ENTIRE scene in the SAME 2D cartoon style as the reference images: a clean FLAT cel-shaded "
 "cartoon; an even MEDIUM-THICK dark warm brown-black (#241a12) outline on EVERYTHING — characters, objects, "
 "scenery; simple flat colours with gentle soft cel shading; rounded simple shapes; NO realistic detail, NO "
 "photo texture — a storybook 2D illustration. Any character keeps the family form: egg-shaped head, big simple "
 "eyes, NO nose. No text, no words, no labels.")

# (name, prompt, [models])
BEATS = [
 ("ship_toward", "A wooden 1820s sailing SHIP sailing straight TOWARD the camera across open ocean, sails full of "
   "wind, small white-capped waves. On the deck stands the tan-toned dark-haired sideburned con-man in his "
   "red-and-gold military coat, one hand raised confidently. Warm daylight sky. A dramatic head-on story shot.",
   ["flash","pro"]),
 ("island_reveal", "Wide seascape. The same wooden sailing ship seen from the side sailing left-to-right across the "
   "ocean; on the horizon ahead a lush green tropical ISLAND with palm trees is coming into view. Warm hopeful "
   "morning light, calm sea. A story establishing shot.", ["flash"]),
 ("natives_beach", "A tropical BEACH. The tan-toned con-man in the red-and-gold military coat has just landed and "
   "stands on the sand at left; a few friendly island natives in simple grass skirts walk toward him from the right; "
   "palm trees, a couple of simple thatched huts and green hills behind. Warm afternoon light. A story moment.",
   ["flash"]),
 ("flag_plant", "The con-man in the red-and-gold military coat triumphantly PLANTING a flagpole with a simple plain "
   "flag into a grassy clifftop of new land, chest out, one boot up on a rock; wilderness and sea behind him; a "
   "slightly low heroic angle. A triumphant story beat.", ["flash"]),
]

def gen(name, model, prompt):
    p = os.path.join(OUT, f"{name}__{model}.png")
    if os.path.exists(p): return f"  skip {name}__{model}"
    parts = [ip(REF_MAC), ip(REF_BASE), {"text": WORLD + "\n\nSTORY SHOT: " + prompt}]
    try:
        b = nano(MODELS[model], parts, "16:9"); open(p,"wb").write(b)
        return f"  OK  {name}__{model}  ({len(b)//1024} KB)"
    except Exception as e:
        return f"  ERR {name}__{model}: {str(e)[:170]}"

if __name__ == "__main__":
    jobs = [(n, m, pr) for (n, pr, models) in BEATS for m in models]
    print(f"SCENE TEST ({len(jobs)} gens: flash x{sum(1 for j in jobs if j[1]=='flash')}, pro x{sum(1 for j in jobs if j[1]=='pro')}) -> {OUT}", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda j: gen(*j), jobs): print(line, flush=True)
    print("done", flush=True)
