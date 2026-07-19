# CAST test: does the shared FORM spin up DISTINCT, consistent characters? (cast-driven story world, not a solo narrator)
# Stage 1: 4 distinct characters seeded off narrator base for FORM/STYLE only (new identity: hair, tone, build, outfit).
# Stage 2: 2 expressions on MacGregor (seed off his own base) + a group lineup (seed off all 4) — the distinctness tell.
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

OUT = os.path.join(KIT, "_cast_test"); os.makedirs(OUT, exist_ok=True)
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

FORM = (
 "SHARED DESIGN FORM — every character uses this EXACT art style and form as the reference image:\n"
 "- SAME art style: clean FLAT cel-shaded cartoon; an even MEDIUM-THICK dark warm brown-black (#241a12) outline "
 "on everything; gentle soft cel shading; warm palette; rounded friendly shapes; no realistic detail.\n"
 "- SAME head FORM: a smooth rounded EGG/OVAL head; large simple expressive eyes with small dark pupils; thin "
 "simple brows; NO nose; a simple mouth. Expression comes from eyes + brows + mouth.\n"
 "- SAME body language: rounded, slightly stubby proportions; small simple hands.\n"
 "This is the FAMILY look. Characters differ ONLY by head/skin tone, HAIR and facial hair, build, outfit, age and "
 "expression — but ALWAYS in this exact form. No text, no words, no letters, no labels, no logos.")

STUDIO = " Full body, ONE character, front view, plain soft light-grey studio background, nothing else."

CHARS = {
 "con_macgregor": ("A NEW character in the shared family form. Head/skin tone: warm light TAN, flat. HAIR: dark brown "
   "hair swept back with long 1820s SIDEBURNS. A confident SMUG smirk, one brow slightly raised, narrowed knowing "
   "eyes; NO nose. OUTFIT: an ornate early-1800s military dandy coat — deep red with gold trim, high collar, "
   "epaulettes and a medal. Slightly taller, confident build. Standing proud." + STUDIO),
 "investor_mark": ("A NEW character in the shared family form. Head/skin tone: PALE cream, flat. HAIR: thin grey hair "
   "combed over, small round SPECTACLES. An ANXIOUS but hopeful expression, raised worried brows, wide hopeful eyes; "
   "NO nose. OUTFIT: a plain dark early-1800s tailcoat with a white cravat. Older, slightly stooped build." + STUDIO),
 "banker": ("A NEW character in the shared family form. Head/skin tone: cream, flat. HAIR: bald on top with tufts of "
   "grey side-hair, bushy grey muttonchops and a thick grey MOUSTACHE. A stern SKEPTICAL frown, lowered brows, "
   "half-lidded doubtful eyes; NO nose. OUTFIT: a formal black City-banker coat with a waistcoat and watch-chain. "
   "Stout, heavy build. Arms crossed." + STUDIO),
 "settler_woman": ("A NEW character in the shared family form. Head/skin tone: warm light-brown, flat. HAIR: brown hair "
   "tied back under a simple cloth BONNET. A WORRIED yet hopeful expression, soft raised brows; NO nose. OUTFIT: a "
   "plain long early-1800s emigrant's dress with a wool shawl. Slight build, holding a small bundle." + STUDIO),
}

def gen(name, refs, prompt, aspect="2:3"):
    p = os.path.join(OUT, name + ".png")
    if os.path.exists(p): return f"  skip {name}"
    parts = [ip(b) for b in refs] + [{"text": FORM + "\n\nCHARACTER: " + prompt}]
    try:
        open(p,"wb").write(nano(parts, aspect)); return f"  OK  {name}"
    except Exception as e:
        return f"  ERR {name}: {str(e)[:160]}"

if __name__ == "__main__":
    print(f"model={MODEL}  CAST TEST -> {OUT}", flush=True)
    # Stage 1: four distinct characters (seed = narrator base, for FORM only)
    print("stage 1: characters", flush=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for line in ex.map(lambda kv: gen(kv[0], [REF_BASE], kv[1]), CHARS.items()): print(line, flush=True)
    # Stage 2: MacGregor expression range (seed off HIS base) + group lineup (seed off all four)
    print("stage 2: expressions + lineup", flush=True)
    mac = rd(os.path.join(OUT, "con_macgregor.png"))
    print(gen("macgregor_worried", [mac],
        "This EXACT same tan-toned, dark-haired, sideburned con-man in the red-and-gold military coat, but now a "
        "WORRIED, cornered expression — wide eyes, raised brows, a tight grimace, a bead of sweat. Same form and style."
        + STUDIO), flush=True)
    print(gen("macgregor_delighted", [mac],
        "This EXACT same tan-toned, dark-haired, sideburned con-man in the red-and-gold military coat, now DELIGHTED and "
        "greedy — a big grin, crescent happy eyes, rubbing his hands together. Same form and style." + STUDIO), flush=True)
    four = [rd(os.path.join(OUT, n + ".png")) for n in CHARS]
    print(gen("lineup", four,
        "A LINEUP of these FOUR different characters standing side by side in a row, full body, in the SAME shared "
        "cartoon form and outline — clearly FOUR DISTINCT people: (1) the tan-toned dark-haired sideburned con-man in "
        "the red-and-gold military coat; (2) the pale grey-haired investor with spectacles in a dark tailcoat; (3) the "
        "stout bald-with-grey-side-hair moustached banker in black with arms crossed; (4) the light-brown-toned woman "
        "with a bonnet and shawl. Evenly spaced, plain soft light-grey studio background. No text.", "16:9"), flush=True)
    print("done", flush=True)
