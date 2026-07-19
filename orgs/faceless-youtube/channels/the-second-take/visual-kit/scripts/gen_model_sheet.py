# PHASE 1 — build the narrator MODEL SHEET into the canonical registry (refs/base/).
# Promotes the locked base, reuses the validated stress frames, and generates the rest of the
# expression turnaround + starter action set. Seeds every frame off the locked base. INVARIANTS held;
# pose/expression/proportions flex.
import json, os, ssl, base64, urllib.request, urllib.error, time, shutil
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

REFS = os.path.join(KIT, "refs", "base"); os.makedirs(REFS, exist_ok=True)
FACE = os.path.join(KIT, "_face_explore"); STRESS = os.path.join(KIT, "_base_stress")
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

# 1) promote locked base + reuse validated frames
def promote():
    pairs = [
     (os.path.join(FACE,"1_calmer.png"),      "base.png"),
     (os.path.join(STRESS,"e1_surprised.png"),"expr-surprised.png"),
     (os.path.join(STRESS,"e2_smug.png"),     "expr-smug.png"),
     (os.path.join(STRESS,"e3_worried.png"),  "expr-worried.png"),
     (os.path.join(STRESS,"a1_recoil.png"),   "action-recoil.png"),
     (os.path.join(STRESS,"a2_leanpoint.png"),"action-leanpoint.png"),
    ]
    for src, dst in pairs:
        d = os.path.join(REFS, dst)
        if not os.path.exists(d): shutil.copy(src, d)
    print("  promoted base + 5 validated frames", flush=True)

INV = (
 "Keep this the SAME single character as the reference — INVARIANTS that never change: SAME perfectly "
 "bald smooth egg-shaped head; SAME flat cream head colour (#f5ead6); SAME dark warm brown-black outline "
 "(#241a12); SAME simple cartoon eyes + thin brows and NO nose; SAME clean FLAT cel cartoon style, even "
 "medium-thick line; SAME brown hoodie + trousers. Reads unmistakably as the same guy. No text, plain "
 "soft light-grey studio background.")
EXPR = " FLEX: same relaxed standing full-body pose; change ONLY the facial expression to: "
ACT  = (" FLEX: a dynamic new full-body ACTION pose — you MAY exaggerate/stretch/squash the body in a "
        "lively hand-animated cartoon way, staying the same character. The action: ")

NEW = [
 ("expr-talking",  EXPR+"TALKING mid-sentence — mouth open in a natural speaking shape, eyes engaged, one brow slightly up; relaxed and explaining."),
 ("expr-skeptical",EXPR+"SKEPTICAL — one eyebrow raised high, the other low, eyes side-glancing, mouth a flat unimpressed line."),
 ("expr-thinking", EXPR+"THINKING — eyes looking up to one side, one hand raised to the chin, brows slightly knit, mouth small and pursed."),
 ("expr-delighted",EXPR+"DELIGHTED — a big genuine open smile, eyes happy and slightly squinting, brows up."),
 ("expr-deadpan",  EXPR+"DEADPAN — half-lidded level eyes, flat straight brows, a small flat mouth. Bored and dry."),
 ("expr-annoyed",  EXPR+"ANNOYED — brows pushed down and together, eyes narrowed, mouth a flat grimace. Mildly angry, not shouting."),
 ("action-present",ACT+"he PRESENTS — turned slightly, one arm extended out to the side, open palm gesturing to something beside him, a pleasant explaining look."),
 ("action-walk",   ACT+"he WALKS mid-stride across the frame, casual and confident, one hand gesturing mid-explanation, leaning into the step."),
 ("action-shrug",  ACT+"he SHRUGS — both hands raised palms-up at his sides, shoulders up, head tilted, brows up, a 'who knows' look. Slightly exaggerated."),
 ("action-slump",  ACT+"he SLUMPS in defeat — shoulders dropped, body sagging forward, arms hanging, head down. Exaggerated cartoon dejection."),
]

def gen(name, delta, base_b64):
    p = os.path.join(REFS, name + ".png")
    if os.path.exists(p): return f"  skip {name}"
    parts = [ip(base_b64), {"text": INV + delta}]
    try:
        open(p,"wb").write(nano(parts, "2:3")); return f"  OK  {name}"
    except Exception as e:
        return f"  ERR {name}: {str(e)[:140]}"

if __name__ == "__main__":
    promote()
    BASE = rd(os.path.join(REFS, "base.png"))
    print(f"model={MODEL}  MODEL SHEET — {len(NEW)} new frames (seeded off locked base)", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda t: gen(t[0], t[1], BASE), NEW): print(line, flush=True)
    print("done", flush=True)
