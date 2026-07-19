# Reaction-library delta + 3 nose-bug fixes. All seeded off the clean base rig; NO-NOSE hammered; verify every output.
# Built on the base TEMPLATE so the reactions map onto the whole cast. Writes to _delta/ (scratch) -> promote after verify.
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

OUT = os.path.join(KIT, "_delta"); os.makedirs(OUT, exist_ok=True)
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

STYLE = (
 "Keep the SAME character/form as the reference EXACTLY. Locked traits:\n"
 "- perfectly BALD smooth egg/oval head; ONE uniform flat pale-cream (#f5ead6) face; medium-thick dark warm "
 "brown-black (#241a12) outline; clean flat cel cartoon; brown hoodie + trousers; small simple hands.\n"
 "- Same eye style/size/position, thin brows, simple mouth. Expression from eyes + brows + mouth ONLY.\n"
 "*** CRITICAL: absolutely NO NOSE. The area between the eyes and the mouth is smooth blank cream — no nose, "
 "no nostrils, no nose-shadow, no bump. This is non-negotiable. ***")
STUDIO = " Full body, ONE single character, front view, plain soft light-grey studio background, nothing else. No text."

# (name, prompt) — 3 fixes + 9 delta, all seeded off base
TASKS = [
 # --- fixes for the nose-bug frames ---
 ("fix-present",   "Standing and PRESENTING — one arm out with an open upturned palm gesturing to the side, an explaining "
                   "open-mouth expression, brows up. Calm and clear."),
 ("fix-shrug",     "SHRUGGING — both arms bent with palms turned up, shoulders raised, brows raised, a small 'who knows' mouth."),
 ("fix-thinking",  "THINKING — one hand up touching the chin, eyes glancing upward, a small pursed pondering mouth, one brow raised."),
 # --- delta expressions (map onto all cast) ---
 ("shock",         "An EXTREME shocked BIG-TAKE — jaw dropped WIDE open, eyes huge and perfectly round, brows shot right up. "
                   "The one big reaction. Arms slightly raised in alarm."),
 ("despair",       "Utterly CRUSHED and defeated — eyes half-lidded and downcast, brows sloping up in the middle, a deep sad "
                   "frown, shoulders sagging. Hollow, hopeless."),
 ("fear",          "FRIGHTENED / alarmed — eyes wide with small shrinking pupils, brows up and pinched together, an open "
                   "nervous grimace mouth, a single sweat bead, leaning back slightly."),
 ("greedy",        "GREEDY and scheming — narrowed gleeful eyes, arched brows, a sly wide closed grin, both hands rubbing "
                   "together in front. Delighted and untrustworthy."),
 ("pleading",      "Earnest and PLEADING — big soft hopeful eyes, brows raised together, a small vulnerable mouth, both "
                   "hands clasped together at the chest."),
 # --- delta poses ---
 ("accuse",        "ACCUSING — leaning forward, one arm thrust out pointing a finger sharply at the viewer, an angry "
                   "open-mouth shout, hard glaring brows."),
 ("head-in-hands", "DESPAIRING pose — both hands up covering the face / holding the head, body slumped forward, elbows out."),
 ("offering",      "OFFERING / persuading — both hands held out forward presenting a small pouch, palms up, a warm "
                   "persuasive smile, leaning in slightly."),
 ("celebrate",     "TRIUMPHANT — both arms thrown straight up in celebration, a big joyful open grin, up on the toes, "
                   "leaning back with the win."),
]

def gen(name, prompt, aspect="2:3"):
    p = os.path.join(OUT, name + ".png")
    if os.path.exists(p): return f"  skip {name}"
    parts = [ip(REF_BASE), {"text": STYLE + "\n\nPOSE/EXPRESSION: " + prompt + STUDIO}]
    try:
        open(p,"wb").write(nano(parts, aspect)); return f"  OK  {name}"
    except Exception as e:
        return f"  ERR {name}: {str(e)[:160]}"

if __name__ == "__main__":
    print(f"model={MODEL}  DELTA + FIXES ({len(TASKS)}) -> {OUT}", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda t: gen(*t), TASKS): print(line, flush=True)
    print("done", flush=True)
