# Poyais Round-2 Crop-Battery Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the round-2 rework of the ~22-shot Poyais ledger through the redesigned gen/verify
flow (spec: `docs/superpowers/specs/2026-07-16-round2-crop-battery-redesign.md`), ending with a
republished board (same artifact URL) carrying every frame + composited layers + crop sheets.

**Architecture:** Orchestrator (this terminal, Fable) does hygiene, tooling, dispatch, manifest
merges, board publish. All gen + review grunt work runs in **Opus 4.8 subagents** (`model: "opus"`,
each agent's FIRST log line states its model id; orchestrator rejects a unit whose log lacks it).
Verify = localizer agent → deterministic `crop_battery.py` → separate judge agent, evidence-cited.

**Tech Stack:** Python 3 + PIL (tooling), `forge.py` / image-generation skill Pass 2 (gen),
Claude Agent tool (units), Artifact tool (board).

## Global Constraints

- **Agents:** grunt work = Opus 4.8 (`model: "opus"`); NEVER Fable for units. Model stated in first
  log line; agents log to scratchpad incrementally (append per step), never final-message-only.
- **Encoding:** every ad-hoc file read/write passes explicit UTF-8 (`encoding="utf-8"`); verify bulk
  text edits by codepoint (operating-law §F-encoding).
- **Supersede-first:** before overwriting any `assets/**/*.png`, move the current file to
  `assets/<same-dir>/_superseded-2026-07-16-r2/` (a NEW r2 folder — round-1 backups in
  `_superseded-2026-07-16/` must not be clobbered).
- **Manifest:** units NEVER write `assets/scenes/manifest.json`; each returns a proposed-entries JSON
  file; ONLY the orchestrator merges, and only after the battery + review pass.
- **Gen law (spec §2):** seed cap ≤4; regen-first (no identity pass over a defective frame);
  `--aspect 16:9` on every scene/plate; cutout gens 2:3/4:3/3:2 on magenta field; every scene/plate
  carries a style anchor; crowd-bearing gens seed `refs/base/crowd-exemplar.png` (after P2 gate).
- **Git:** stage explicit paths only; never `git add -A` / `commit -a`.
- **Board:** republish to the SAME artifact URL
  `https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5`.
- **Paths:** `VID = channels/the-second-take/videos/2026-07-04-poyais` ·
  `SKILL = .claude/skills/image-generation` · `SCRATCH = C:\Users\danie\AppData\Local\Temp\claude\
  C--Users-danie-faceless-youtube\ce0c259c-1ce8-48b3-bae0-550f28bc08e6\scratchpad`.
- **Regen ledger (22):** L30 L48 L61 L62 L63 L67 L68 L77 L81 L86 L87 L93 L95 L96 L103 L108 L109
  L114 L115 L116 L117 L118. Board-only (NO regen): L78 L79 L80 (+ L107 unless Task 0 finds the
  cutout contradicts the authored fact).

---

### Task 0: P0 hygiene — void stamps, L107 fact check

**Files:**
- Create: `SCRATCH\void_stamps_r2.py`
- Modify: `VID\assets\scenes\manifest.json` (orchestrator-only)

**Interfaces:**
- Produces: manifest entries for the 22 regen-ledger shots with
  `verified: {scene: false, rig: false}` + `notes` appended `"round2: round-1 stamp voided (verify stack failed human gate)"`.

- [ ] **Step 1: Write and run the void script**

```python
# -*- coding: utf-8 -*-
import json
VID = r"C:\Users\danie\faceless-youtube\channels\the-second-take\videos\2026-07-04-poyais"
MAN = VID + r"\assets\scenes\manifest.json"
LEDGER = ["L30","L48","L61","L62","L63","L67","L68","L77","L81","L86","L87","L93","L95","L96",
          "L103","L108","L109","L114","L115","L116","L117","L118"]
doc = json.load(open(MAN, encoding="utf-8"))
n = 0
for e in doc["shots"]:
    if e.get("shot_id") in LEDGER:
        e["verified"] = {"scene": False, "rig": False}
        e["notes"] = (e.get("notes") or "") + " | round2: round-1 stamp voided (verify stack failed human gate)"
        n += 1
json.dump(doc, open(MAN, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("voided", n)
```

Run: `py -3 SCRATCH\void_stamps_r2.py` → Expected: `voided 22` (L30 may be absent if chunk-1
manifest is separate — if `voided 21`, locate L30's manifest entry and void it there too).

- [ ] **Step 2: L107 fact check** — read L107's `still_prompt`/`vo_text` in `VID\shots.json` and
view `VID\assets\cutouts\L107-poyais-officer.png`. If the authored fact says the officer is ON THE
GROUND and the cutout is standing/hunched → add `L107-poyais-officer` cutout regen to Task 6 (U2);
else record "board-only" in the run log `SCRATCH\run-log-r2.md`.

- [ ] **Step 3: Start run log** — create `SCRATCH\run-log-r2.md` with date, ledger, decisions.

### Task 1: `crop_battery.py` (deterministic crops + contact sheets + diff)

**Files:**
- Create: `.claude/skills/image-generation/scripts/crop_battery.py`

**Interfaces:**
- Consumes: `--frame <png> --boxes <json>` — boxes JSON:
  `{"figures":[{"name":"macgregor","face":[x0,y0,x1,y1],"hands":[[x0,y0,x1,y1],...]}]}`
  (normalized 0–1, top-left origin).
- Produces: `<outdir>/<stem>--<figure>--face.png`, `...--hand1.png` … at 3–4× zoom (min output side
  360px), plus `<outdir>/<stem>--SHEET.png` (labeled contact sheet). `--diff old.png new.png
  --boxes-old a.json --boxes-new b.json` → paired before/after sheet `<stem>--DIFF.png`.

- [ ] **Step 1: Write the script**

```python
# -*- coding: utf-8 -*-
"""crop_battery.py — deterministic face/hand crop battery (round-2 verify law).
Crops are the EVIDENCE a judge agent cites; a rig ruling without a crop path is inadmissible."""
import argparse, json, os, sys
from PIL import Image, ImageDraw, ImageFont

MIN_SIDE = 360          # upscale so a face crop is judgeable
PAD = 0.06              # relative padding around each box

def _load(p):
    return Image.open(p).convert("RGB")

def _crop(im, box):
    W, H = im.size
    x0, y0, x1, y1 = box
    pw, ph = (x1 - x0) * PAD + 0.005, (y1 - y0) * PAD + 0.005
    px0, py0 = max(0, int((x0 - pw) * W)), max(0, int((y0 - ph) * H))
    px1, py1 = min(W, int((x1 + pw) * W)), min(H, int((y1 + ph) * H))
    if px1 <= px0 or py1 <= py0:
        return None
    c = im.crop((px0, py0, px1, py1))
    s = max(1.0, MIN_SIDE / min(c.width, c.height))
    if s > 1.0:
        c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
    return c

def battery(frame, boxes, outdir, tag=""):
    im = _load(frame)
    stem = os.path.splitext(os.path.basename(frame))[0] + (f"--{tag}" if tag else "")
    os.makedirs(outdir, exist_ok=True)
    made = []  # (label, path, PIL)
    for fig in boxes["figures"]:
        name = fig["name"].replace(" ", "-")
        parts = [("face", fig.get("face"))] + [(f"hand{i+1}", hb) for i, hb in enumerate(fig.get("hands") or [])]
        for label, box in parts:
            if not box:
                continue
            c = _crop(im, box)
            if c is None:
                print(f"WARN degenerate box {name}/{label}", file=sys.stderr); continue
            p = os.path.join(outdir, f"{stem}--{name}--{label}.png")
            c.save(p)
            made.append((f"{name}/{label}", p, c))
            print("crop:", p)
    return stem, made

def sheet(stem, made, outdir, suffix="SHEET"):
    if not made:
        return None
    cell_w = max(m[2].width for m in made)
    cell_h = max(m[2].height for m in made) + 34
    cols = min(4, len(made))
    rows = (len(made) + cols - 1) // cols
    S = Image.new("RGB", (cols * cell_w + 16, rows * cell_h + 16), (24, 24, 24))
    d = ImageDraw.Draw(S)
    try:
        f = ImageFont.truetype("arial.ttf", 22)
    except OSError:
        f = ImageFont.load_default()
    for i, (label, _, c) in enumerate(made):
        x = 8 + (i % cols) * cell_w
        y = 8 + (i // cols) * cell_h
        S.paste(c, (x, y))
        d.text((x + 4, y + c.height + 4), label, fill=(255, 235, 160), font=f)
    p = os.path.join(outdir, f"{stem}--{suffix}.png")
    S.save(p)
    print("sheet:", p)
    return p

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame"); ap.add_argument("--boxes")
    ap.add_argument("--diff", nargs=2, metavar=("OLD", "NEW"))
    ap.add_argument("--boxes-old"); ap.add_argument("--boxes-new")
    ap.add_argument("--outdir", required=True)
    a = ap.parse_args()
    if a.diff:
        so, mo = battery(a.diff[0], json.load(open(a.boxes_old, encoding="utf-8")), a.outdir, "before")
        sn, mn = battery(a.diff[1], json.load(open(a.boxes_new, encoding="utf-8")), a.outdir, "after")
        sheet(sn.replace("--after", ""), mo + mn, a.outdir, "DIFF")
    else:
        stem, made = battery(a.frame, json.load(open(a.boxes, encoding="utf-8")), a.outdir)
        sheet(stem, made, a.outdir)
```

- [ ] **Step 2: Smoke-test on a real frame** — hand-author `SCRATCH\test-boxes-L67.json` (eyeball
MacGregor's face + both hands in `VID\assets\scenes\L67.png` at rough normalized coords), run:
`py -3 .claude\skills\image-generation\scripts\crop_battery.py --frame VID\assets\scenes\L67.png
--boxes SCRATCH\test-boxes-L67.json --outdir SCRATCH\battery-test` →
Expected: 3 crops + 1 SHEET png; open the sheet and confirm the face crop actually contains the
face (bad coords = adjust test json, not the script, unless the crop math is wrong).

- [ ] **Step 3: Commit** —
`git add .claude/skills/image-generation/scripts/crop_battery.py && git commit -m "feat(image-generation): crop_battery.py — deterministic rig-evidence crops (round-2 verify law)"`

### Task 2: Board builder v2 (fixed layer compositing + crop sheets)

**Files:**
- Create: `SCRATCH\build_board_r2.py` (session tooling — not repo)
- Consumes: `VID\shots.json`, `VID\shots.motion.json`, `SCRATCH\board-flags-r2.json`,
  `SCRATCH\crops\<sid>\*--SHEET.png` (when present)

- [ ] **Step 1: Write the builder** — copy round-1
`...\1945d41a-6f2e-40b2-bc2e-253bcdac82a7\scratchpad\build_board_rework36.py` and change ONLY:

```python
# (a) FIXED layer path resolution — mirror build_motion.py:179
        for L in layers:
            if L.get("source") != "cutout":
                continue
            c_rel = (L.get("reuse") or "").strip() or f"cutouts/{sid}-{L['id']}.png"
            if not c_rel.startswith("assets/"):
                c_rel = "assets/" + c_rel
            # ... existing open/resize/paste logic unchanged
```

```python
# (b) after the <img> in each card: embed the crop sheet when one exists (collapsible)
    sheet_glob = os.path.join(HERE, "crops", sid)
    sheets = sorted(glob.glob(os.path.join(sheet_glob, "*--SHEET.png"))) if os.path.isdir(sheet_glob) else []
    crops_html = ""
    if sheets:
        s_src, s_bytes = uri(Image.open(sheets[-1]).convert("RGB"), max_w=680)
        total_kb += s_bytes / 1024
        crops_html = f'<details class="crops"><summary>rig crops</summary><img loading="lazy" src="{s_src}"></details>'
```

plus `import glob`, title/subtitle → "rework round 2", flags file → `board-flags-r2.json`, and CSS
addition `details.crops{margin:6px 0 0}details.crops img{width:100%}`.

- [ ] **Step 2: Seed `board-flags-r2.json`** — carry over round-1 taste cards still unruled
(from round-1 `board-flags.json`: serif hull/map lettering L53/L57/L62/L112 · L54 'LAW' ·
L102 squatness · L108 plaque · L77 palette · L75 CHILE) + `"_subtitle": "Rework round 2 — crop-battery flow. Board bug fixed: plate+layers cards now composite their cutouts."`

- [ ] **Step 3: Verify the fix** — run the builder; Expected log: `L78: composited`,
`L79: composited`, `L80: composited`, `L107: composited` (not bare-plate), zero MISSING for
L48–L125. Open `SCRATCH\full-sequence-board.html` locally and eyeball L78 (bubble present) +
L107 (officer + anger mark present).

### Task 3: P2 crowd exemplar (Opus agent + HUMAN GATE)

**Files:**
- Create: `channels/the-second-take/visual-kit/refs/base/crowd-exemplar.png` (after gate)
- Create: `SCRATCH\units-r2\u0-crowd-exemplar.md` (brief), `SCRATCH\logs-r2\u0.md` (agent log)

**Interfaces:**
- Produces: the gated `refs/base/crowd-exemplar.png` every crowd-bearing Task-6 gen seeds.

- [ ] **Step 1: Dispatch the exemplar agent** (`model: "opus"`) with brief: invoke the
image-generation skill single-asset loop; generate THREE candidates
`SCRATCH\crowd-exemplar-{a,b,c}.png` — each: "a sample GROUP of five anonymous background people
standing in a loose row, varied 1820s London dress (bonnets, top hats, shawls, waistcoats), every
figure on the CROWD RIG: round cream-family heads, DOT EYES, one simple mouth, NO noses, NO ears,
the EXACT same squat head-to-body proportion as the base rig — large round head, short compact
body; flat-cel 2.5D house style, even #241a12 outline, plain pale background" — seeds =
`refs/base/base.png` + `refs/env/env-exterior-muted.png` (≤4), aspect `4:3`, `--mode environment`.
First log line = model id. Log each gen to `SCRATCH\logs-r2\u0.md` incrementally.
- [ ] **Step 2: Verify agent model** — check first log line says an Opus 4.8 model id; if not,
kill + re-dispatch.
- [ ] **Step 3: HUMAN GATE** — publish the three candidates as a small NEW artifact (this is a
decision board, distinct from the main board); AskUserQuestion: pick a/b/c or re-roll (ONE re-roll
round budgeted).
- [ ] **Step 4: Install** — copy the pick to `refs/base/crowd-exemplar.png`; add a `crowd-exemplar`
row to `visual-kit/registry/registry.json` (follow existing entry shape); commit both explicit paths.

### Task 4: Localizer + judge protocol briefs

**Files:**
- Create: `SCRATCH\briefs-r2\localizer.md`, `SCRATCH\briefs-r2\judge.md`

- [ ] **Step 1: Write `localizer.md`:** input = list of frame paths (+ per-frame cast names from
shots.json). For EVERY human figure visible (named, §2e, and each distinct crowd figure up to the 8
most prominent): return `SCRATCH\crops\<sid>\boxes.json` in the crop_battery schema — `name`
(cast name or `anon1..n`/`crowd1..n`), `face` box, `hands` boxes for every VISIBLE hand. Normalized
0–1 coords. You LOCATE only — you never judge. State your model id as your first output line.
- [ ] **Step 2: Write `judge.md`:** input = the crop files + sheets for a set of shots + bible §3
checklist + each figure's tier (full rig vs crowd rig). For EVERY crop return a structured row:
`{shot, figure, crop_path, invariant, verdict PASS/FAIL, one-clause reason}` — invariants: round
head · no nose · no ears · four-digit hand (count aloud: fingers you see + thumb) · squat
proportion · identity-match-vs-canonical (seeded figures: compare against the named
`refs/<char>/<char>-base.png`). A ruling WITHOUT its crop_path is invalid. You judge CROPS, never
the full frame; full-frame impressions are inadmissible. Write rows incrementally to
`SCRATCH\verdicts-r2\<unit>.json`. First output line = model id. You did not generate these frames;
be adversarial — a nose on the no-nose rig is BLOCKING regardless of size.

### Task 5: Author unit briefs (U1–U4)

**Files:**
- Create: `SCRATCH\units-r2\u1-macgregor-solo.md`, `u2-mixed-figures.md`, `u3-crowd.md`,
  `u4-chain.md`

Common brief header (verbatim in each): Opus 4.8; first log line = model id; log incrementally to
`SCRATCH\logs-r2\u<N>.md`; invoke the image-generation skill and follow Pass 2 EXCEPT the round-2
overrides: **seed cap ≤4 · regen-first (NEVER seed a defective frame for a rig fix) · style anchor
mandatory · crowd gens seed `refs/base/crowd-exemplar.png` · supersede-first to
`_superseded-2026-07-16-r2\` · NO manifest writes — emit proposed entries to
`SCRATCH\proposed-manifest-u<N>.json` · read each shot's authored facts from `VID\shots.json`
(still_prompt is authority; re-author HOW, never WHETHER a fact appears) · two-gen identity pass
DEFAULT on scene-heavy single-character shots · one re-authored retry max, then flag.**

Unit shot lists:
- **U1 (MacGregor solo regens):** L61, L62, L63, L67, L108, L118 — fresh regens, seeds =
  macgregor canonical + ONE pose + ONE expr (+ lettering anchor on text shots). No eye bags (L61's
  came from a pass over a defective frame — that path is banned).
- **U2 (mixed figures):** L48 (two §2e anons, handoff template + base, de-ear), L81 (MacGregor +
  nation personifications on CHARACTER rig with normal head size + background crowd),
  L109 (woman §2e — four-digit hands), L114 (**targeted fix ONLY** — keep framing per human call;
  before/after DIFF mandatory), L115 (foreground investor on FULL §2e rig, not crowd rig),
  L116+L117 (regen both; the two soldiers/guards seeded from ONE shared source frame so they match
  across shots; no nose L116, no ears L117), + L107 officer cutout IF Task 0 flagged it.
- **U3 (crowd — BLOCKED on Task 3 gate):** L30 (chunk-1 tall redcoat — squat rig), L68 (broker
  frenzy crowd), L77 (inspector LOOKING AT the fine print + no ears), L86→L87 (chain: regen L86
  base then L87 delta off the NEW L86), L93 (rainy camp), L103 (pictogram grid on base-rig house
  figure, miniaturized).
- **U4 (chain content):** L95 (delta off L94: the leftover chest/crate REMOVED, camp held),
  L96 (delta off the NEW L95: EXACTLY TEN crosses — human-confirmed count — tents hold color, no
  white-tent seed defect).

- [ ] **Step 1: Write the four briefs** with the header + per-shot rows (defect, treatment, seeds).
- [ ] **Step 2: Note dependencies in run log:** U1/U2/U4 dispatch immediately; U3 waits on Task 3.

### Task 6: Dispatch + battery-verify units

- [ ] **Step 1: Dispatch U1, U2, U4** (parallel, `model: "opus"`, `run_in_background`); after Task 3
gate: dispatch U3. Verify each agent's model line on first log write; kill + re-dispatch on mismatch.
- [ ] **Step 2: Per unit completion — battery cycle:** dispatch a localizer agent (Task-4 brief) on
the unit's output frames → run `crop_battery.py` per frame → dispatch a fresh judge agent (Task-4
brief) on the crops. FAILs → SendMessage the unit its failed shots + judge rows for ONE re-authored
retry (fresh gen, re-authored prompt, NEVER seeded off the failed frame) → re-run localizer+battery+
judge on retries. Still failing → `flagged` with reason.
- [ ] **Step 3: L114 regression diff:** run `crop_battery.py --diff` on before/after with both box
sets; judge rules on the DIFF sheet (every figure, not just the fixed hand).
- [ ] **Step 4: Orchestrator merges manifests** — apply each `proposed-manifest-u<N>.json` into
`VID\assets\scenes\manifest.json` (UTF-8, orchestrator-only); stamps stay `verified:false` until
Task 7.

### Task 7: P4 consolidated review + stamping

- [ ] **Step 1: Dispatch two fresh-eyes reviewers** (`model: "opus"`, whole reworked batch):
**fidelity** (facts vs still_prompt, letter-by-letter text transcription) + **style/taste** (beat +
recipe + rich/thin bar). The identity/rig axis is COVERED by the Task-6 battery verdicts — do not
re-litigate it full-frame.
- [ ] **Step 2: Merge flags** (battery + fidelity + style); flagged frames that already used their
one retry stay flagged for the human board.
- [ ] **Step 3: Stamp** — orchestrator sets `verified: {scene: true, rig: true}` ONLY on shots
passing ALL of: battery clean (or human-kept), fidelity clean, style clean. Write the stamp
provenance into `notes`: `"round2: battery+review passed"`.

### Task 8: Final board + handoffs + codification

- [ ] **Step 1: Build + republish the board** — run `build_board_r2.py` (crop sheets for all
reworked shots in `SCRATCH\crops\`), publish via Artifact tool with
`url: https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5` (SAME URL), favicon
unchanged. Board carries: all L48–L125 cards with composited layers, rig-crop `<details>` on
reworked cards, FLAG badges from `board-flags-r2.json` incl. the re-surfaced taste calls, L30 card
appended (chunk-1, reworked).
- [ ] **Step 2: Codification agent** (`model: "opus"`, doctrine edits per spec §6, follow
`.claude/skills/README.md` design rules + integrate-don't-append): bible §2d (crowd-exemplar
seeding) · §3 (crop-battery law REPLACES the no-hand-crops clause) · §5/§8 (seed cap;
fix-pass-never-seeds-defective-frame) · image-generation SKILL.md Pass-2 + review section ·
`knowledge/decisions.md` dated entry with rejected alternatives. Orchestrator reviews the diff
before commit.
- [ ] **Step 3: Handoffs (orchestrator):** update `docs/handoffs/STATUS.md` (queued-work bullet →
round-2 state); write `docs/handoffs/2026-07-16-chunks36-rework-round2-done-pickup.md` (what ran,
gate items, key paths); update `index.html` "Last updated" if knowledge/status changed materially.
- [ ] **Step 4: Commit** — explicit paths: the bible, SKILL.md, decisions.md, STATUS.md, new
pickup, index.html, manifest-bearing video files if tracked. Message:
`feat(poyais): chunks 3-6 rework round 2 — crop-battery flow executed`.
- [ ] **Step 5: Tell Daniel** — board URL + what changed + the open gate items (crowd exemplar
already gated in Task 3; now: full-board gate, taste calls, any still-flagged frames).

## Self-Review (done at authoring)

- Spec coverage: §1→Tasks 0/2 (board fix, stamp void), §2→Tasks 3/5/6 (gen law in briefs),
  §3→Tasks 1/4/6/7 (battery pipeline, stamping), §4 phases→Tasks 0–8, §5 budget noted in briefs,
  §6→Task 8. No gaps.
- Placeholders: none — scripts complete, briefs' per-shot content enumerated in Task 5.
- Consistency: `crop_battery.py` CLI matches Task 4/6 usage; boxes schema identical in Tasks 1/4;
  ledger list identical in Task 0 and Global Constraints.
