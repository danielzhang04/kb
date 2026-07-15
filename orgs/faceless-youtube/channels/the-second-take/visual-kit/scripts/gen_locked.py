# WARM-FACE lock. Seeds ONLY off the approved bald frames (warmface/base + warmface/v1_suit_smug).
# One fixed exact STYLE descriptor, reused verbatim every generation. Verify every output is BALD + cream face.
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

OUT = os.path.join(KIT, "sweep2", "warmface_final"); os.makedirs(OUT, exist_ok=True)
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

# ---- APPROVED bald references (NOT warmface_v2, NOT v3 which drifted to hair) ----
REF_BASE = rd(os.path.join(KIT, "sweep2", "warmface", "base.png"))          # bald cream egg head, worried
REF_SUIT = rd(os.path.join(KIT, "sweep2", "warmface", "v1_suit_smug.png"))  # SAME bald head, smug, suit

# ---- ONE fixed, exact style descriptor. Reused VERBATIM in every prompt. ----
STYLE = (
 "LOCKED CHARACTER MODEL SHEET — reproduce the character in the reference images EXACTLY. Non-negotiable traits:\n"
 "- HEAD: perfectly BALD, smooth EGG/OVAL-shaped head. NO hair, no hairline, no stubble — completely bald.\n"
 "- FACE COLOUR: the whole head and face is ONE UNIFORM FLAT PALE-CREAM colour (about #f3e3c8). NO skin tone, "
 "NO blush, NO shading gradient on the face — flat pale cream only.\n"
 "- FEATURES: large round WHITE eyes with small dark round pupils, set fairly wide apart; thin dark-brown curved "
 "eyebrows; a small simple mouth. ALL expression comes from eyes + eyebrows + mouth only.\n"
 "- OUTLINE: a clean, even, MEDIUM-THICK warm DARK-BROWN outline (not black) around everything.\n"
 "- RENDER: clean warm FLAT colours with gentle soft cel shading; warm brown palette.\n"
 "- BODY: rounded, slightly short and stubby proportions, small simple hands.\n"
 "This is the SAME single character every time — keep the identical head shape, cream face colour, eye style and "
 "outline weight. No text, no words, no letters, no labels, no logos.")

STUDIO = " Full body, ONE single character, front view, on a plain soft light-grey studio background, nothing else."

def gen(name, refs, prompt, aspect="2:3"):
    p = os.path.join(OUT, name + ".png")
    if os.path.exists(p): return f"  skip {name}"
    parts = [ip(b) for b in refs] + [{"text": STYLE + "\n\nSCENE: " + prompt}]
    try:
        open(p,"wb").write(nano(parts, aspect)); return f"  OK  {name}"
    except Exception as e:
        return f"  ERR {name}: {str(e)[:140]}"

def stage_base():
    return gen("01_base", [REF_BASE, REF_SUIT],
      "This exact bald cream-faced character standing in a relaxed neutral pose, arms at his sides, a calm "
      "NEUTRAL pleasant expression (eyes open and steady, mouth a small flat line). He wears a plain brown "
      "hoodie and brown trousers, like the reference. This is the channel's recurring narrator base pose." + STUDIO,
      "2:3")

def build_tasks():
    BASE = rd(os.path.join(OUT, "01_base.png"))
    r = [BASE, REF_SUIT]  # base (neutral, correct) + the approved suit frame, both bald
    T = []
    # outfits + expressions (SAME bald head)
    T.append(("02_suit_smug", r,
      "This exact bald cream-faced character wearing a brown business suit and tie, arms crossed, a confident "
      "SMUG smirk with narrowed knowing eyes (like the suit reference)." + STUDIO, "2:3"))
    T.append(("03_hoodie_worried", r,
      "This exact bald cream-faced character in a brown hoodie, hands fidgeting, a WORRIED anxious expression — "
      "wide eyes, raised brows, a small bead of sweat." + STUDIO, "2:3"))
    T.append(("04_shirt_explain", r,
      "This exact bald cream-faced character wearing a brown buttoned shirt with rolled sleeves, mouth open "
      "mid-sentence, one hand raised gesturing, an ENTHUSIASTIC lively teaching expression — but STILL COMPLETELY "
      "BALD with the same pale-cream face, NO hair." + STUDIO, "2:3"))
    # scenes / cast / contexts (16:9)
    T.append(("05_present_chart", r,
      "Wide scene. This exact bald cream-faced character stands beside a large simple line CHART on a stand and "
      "gestures at a bold red trend line crashing downward; an explaining expression. Warm cream background with "
      "a soft red accent glow. No text or numbers on the chart, just the line and axes.", "16:9"))
    T.append(("06_street_two", r,
      "Wide scene, TWO characters IN THIS EXACT STYLE talking on a city sidewalk — BOTH have the bald pale-cream "
      "egg head, big expressive eyes and warm brown outline. The narrator (brown hoodie) on the left hands a "
      "paper coffee cup to a second bald cream-faced character on the right (wearing a mustard cardigan, a "
      "surprised look). Simple flat cartoon street behind them, warm afternoon colours. No text.", "16:9"))
    T.append(("07_warzone_reporter", r,
      "Wide scene. This exact bald cream-faced character as a nervous TV field-reporter in a flak jacket holding "
      "a microphone, in front of a SIMPLIFIED flat cartoon conflict-zone background: distant grey smoke, a broken "
      "wall, a small red flag, muted brown-grey palette. Stylised and clean, NOT gory. No text.", "16:9"))
    T.append(("08_bank_teller", r,
      "Wide scene, TWO characters IN THIS EXACT STYLE at a bank counter — BOTH bald pale-cream egg heads with the "
      "warm brown outline. The narrator stands on the near side looking skeptical; a stern bald teller sits behind "
      "a glass window. Cool teal-and-grey interior with warm wood accents. No text or numbers.", "16:9"))
    return T

# no-character plates seed off the neutral base for STYLE (line + palette), not identity
def bg_tasks():
    BASE = rd(os.path.join(OUT, "01_base.png"))
    r = [BASE]
    return [
     ("09_map_arrows", r,
      "NO characters, NO people. A simple stylised flat cartoon MAP in the SAME art style as the reference — the "
      "SAME clean medium-thick warm dark-brown outline and warm flat colours: green land, blue water, a few small "
      "city dots, and several bold RED and TEAL curved ARROWS sweeping across pointing between cities. Warm cream "
      "border. No text, no words, no labels.", "16:9"),
     ("10_city_park", r,
      "NO characters, NO people. A cozy flat cartoon CITY PARK in the SAME art style and outline as the reference: "
      "round trees, a wooden bench, a small pond, a curving path, warm afternoon light, clean flat colours. No text.", "16:9"),
     ("11_props", r,
      "NO characters, NO people. A neat flat-lay of money-explainer PROPS in the SAME art style and outline as the "
      "reference: a stack of coins, a small bank building, a piggy bank, a rolled banknote, a briefcase, one up "
      "and one down arrow — warm flat colours, plain cream background. No text, no numbers, no labels.", "16:9"),
    ]

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "base"
    if mode == "base":
        print(f"model={MODEL}  BASE (seeded off approved bald frames)", flush=True)
        print(stage_base(), flush=True)
    elif mode == "chars":
        tasks = build_tasks()
        print(f"model={MODEL}  CHARS+SCENES ({len(tasks)})", flush=True)
        with ThreadPoolExecutor(max_workers=3) as ex:
            for line in ex.map(lambda t: gen(*t), tasks): print(line, flush=True)
    elif mode == "bg":
        tasks = bg_tasks()
        print(f"model={MODEL}  BG PLATES ({len(tasks)})", flush=True)
        with ThreadPoolExecutor(max_workers=3) as ex:
            for line in ex.map(lambda t: gen(*t), tasks): print(line, flush=True)
    print("done", flush=True)
