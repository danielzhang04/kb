---
name: visual-prompt-writer
description: >-
  Writes the complete visual plan for a scripted video in this project — the long-form B-roll shot
  list (a still-frame plan + motion-intent metadata, densified to the retention cadence), the
  thumbnail generation prompts (turning metadata's thumbnail CONCEPT into actual pixel-gen prompts),
  and every scripted short's visual prompts — emitted as one videos/<slug>/shots.json that feeds
  image-generation (the stills), render-builder (the Remotion motion engine), and publish-queue (the
  thumbnail). Use this whenever the user wants visual prompts, a shot list, a storyboard, "what to
  show on screen", B-roll, image generation prompts, a thumbnail prompt, scene visuals, or wants to
  "do the visuals"/"build the shot list"/"prompt the images" for a video or short — for ANY niche.
  Runs AFTER long-form-writer + shorts-writer + metadata-writer and BEFORE voiceover /
  image-generation / render-builder. Reads script.md ([B-ROLL] cues) + metadata.json (thumbnail
  concepts) + shorts/*.md + dna.md + the universal & niche playbooks. Do NOT use it to write the
  script (long-form-writer / shorts-writer), pick titles/tags (metadata-writer), or generate/assemble
  the actual pixels (image-generation / render-builder / voiceover).
---

# visual-prompt-writer

Turn ONE scripted video into a **complete, render-ready visual plan** — the long-form shot list, the
thumbnail generation prompts, and every scripted short's visuals — for one faceless-YouTube channel.
One skill for every channel; the niche is **data** in `channels/<name>/`, never forked into code.

## Mental model

`long-form-writer` decided *what is said* and left `[B-ROLL]` cues where a visual should land.
`metadata-writer` decided *how the video is found and clicked* and left thumbnail **concepts** —
deliberately stopping short of pixels. You are the bridge between words and pixels: you write the
**still-frame plan plus intent metadata** that the downstream pipeline realizes — `image-generation`
produces each shot's verified still; the local **Remotion engine** (render-builder's default) turns
the plan into motion.

**Know what the engine can actually do — and author only that.** What renders per shot today: the
verified still — **with any in-video text baked into the image** (diegetic stamps, signs, ledgers,
banners) — a camera that is **always locked** (no derived moves), an idle micro-motion baseline,
animated cutout **layers** (a matted element that slides / paths / appears / bobs, or a route the engine
draws on — planned downstream by `motion-planner`, not authored here), and burned word-highlight
captions on shorts. There are **no engine text overlays and no device kit** — both are retired; all
on-screen text is diegetic, designed into the generated image. A stage delta = the next still simply
*has* the new element (the change arrives **AT the cut**). You author **intent, never mechanism**: what a
beat wants and on which word — never easing names, amplitudes, spring values, or camera treatments. A
shot whose meaning *depends* on mechanism you can't author is broken output; restage it as a tableau, a
delta chain, or a baked-text beat.

Your output is a machine contract, so **five fundamentals** make each still a valid unit (distinct from
— and feeding — the **seven authoring laws** named canonically under *Load-bearing rules*, which the
Step 8 critic reviews):

1. **Every still is a HELD TABLEAU.** It must read as a deliberate composition when frozen for its
   full duration — the pose vocabulary is held poses that carry action meaning (a salute, a planted
   stance, presenting a deed, a held point); a freeze of continuous motion (mid-stride, mid-shuffle,
   mid-sweep) is broken output. The beat's change arrives at a cut or via motion intent — never baked
   into the pose.
2. **Retention-engineered, not decorative.** Visuals are a primary retention lever (§6a), not
   illustration. You *densify* past the script's cues to hit the §10 cadence (new cut every 3–8s, new
   stimulus every 30–45s) and front-load the first 60s. A "visual question" precedes the narration
   (§1b tactic 6) — the first frame must make the viewer *need* the answer.
3. **On the house style, every frame.** §13: a locked visual signature is a **monetization
   prerequisite**, not a style choice — templated stock B-roll is a policy trigger (the July-2025
   inauthentic-content rule). Every prompt inherits the channel's `dna.md` house style so the whole
   video looks like one author made it.

## Step 0 — Identify channel + video
1. **Channel** from the request → `channels/<name>/`.
2. **Which video?** The scripted one: a `videos/<slug>/` folder with a `script.md`. Given a slug/ID,
   use it. Several scripted with no `shots.json` → do the one named, or the most recently scripted, or
   ask. **No `script.md` → stop** and tell the user to script the video first (there is nothing to
   visualize without a script — the `[B-ROLL]` cues are your spine).

## Step 1 — Read (always)
- **`videos/<slug>/script.md`** — the source of truth. The inline **`[B-ROLL: …]`** cues are your
  base shot list; the VO text tells you *what each shot must depict and when* (so a shot lands on the
  line it illustrates); the beat structure (hook → second gate → body → mid-arm → withheld peak →
  close) tells you where to escalate visual intensity. Any `[PAUSE]` marks a beat a visual reveal can
  land on.
- **`videos/<slug>/metadata.json`** — the `long_form.thumbnail` block (primary + 2 challenger
  **concepts**: text overlay + visual concept) and each short's block. You turn these concepts into
  pixel-gen prompts — **do not re-invent the concept**, honor what metadata-writer committed (the
  title/thumbnail are one asset). Also read `shorts[]` for the archetype/status of each short.
  *If `metadata.json` is missing* (skill run out of order), derive thumbnail concepts from `script.md`
  + `brief.md` yourself and flag `thumbnail_source: "derived-from-script (metadata.json absent — reconcile)"`.
  **`thumbnail_source` lives inside the `thumbnail` block only** (see the schema) — do not also write it
  at the top level.
- **`videos/<slug>/shorts/short-NN.md`** — each short's `[B-ROLL]` cues (weighted to the first 3s),
  archetype, caption/on-screen text, and `publish`|`bench` status. Write visuals for **every** short
  (the library stays ready); carry the status.
- **`channels/<name>/dna.md`** — the **locked house style** (Voice & style → *Visual style*: palette,
  footage type, motion vs stills; Branding → *Thumbnail style*), the **locked emotional lever**, and
  audience/region. This governs every prompt; §13 says it is the monetization moat.
- **`knowledge/research/niche-playbooks/universal.md`** — read every run. Load-bearing here: **§1b**
  (tactic 6: visual anchor before context; first frame is a visual question), **§6a** (visual pattern
  interrupt every 30–45s; match-cut callbacks), **§8** (2026 thumbnail rules — the thumbnail spec),
  **§10** (cut/stimulus cadence), **§12** (anti-pattern 8: no static ambient B-roll in the first 3–5s;
  anti-pattern 2: no logo splash), **§13** (lock one house style; where AI is visually weak → hybrid),
  and **§13a — the visual-narration grammar** (the narration-type → shot-class table = Step 2.5's
  decision procedure; §13a-i within-shot choreography, authored here as *intent* — the still itself
  stays a held tableau per this file's law; **§13a-ii cut cadence** = the stretch-to-fill kill rule —
  BINDING, read every run).
- **`channels/<name>/visual-kit/visual-grammar.md`** (if the channel has one) — the channel's
  **staging law**: staging conventions (who's on screen, how emotion is acted — the tableau pose menu,
  eye-line rule, expression-by-beat register mapping, role legibility), the payload-driven composition
  guidance (§2), and the lever/register translation that maps each shot-class onto *this channel's* locked
  style/lever/humor. Read it when present; it overrides the generic §13a for channel specifics but
  does not replace §13a-ii's binding pacing law. Alongside it read
  **`visual-kit/registry/registry.json`** — the live index of the channel's existing cast/props/plates
  (write shots that reuse them where they fit) — and pull the house-style ingredients from
  **`visual-kit/style-bible.md §6`** (the committed recipe) when the channel has one.
- **`knowledge/research/niche-playbooks/<niche>.md`** — match from `dna.md`'s niche. Its visual
  conventions, signature format, and any **policy quirk** that constrains imagery (engineering
  disasters: **analysis-not-gore** — diagrams/annotated stills, never rendered casualties;
  horror/internet-lore: suggestion over depiction; micro-health: clinical/no body-horror; business:
  no defamatory depiction of real people).
- **`knowledge/playbook.md`** — policy: originality (no cloning a specific rival's frames/format),
  AI-synthetic disclosure, YMYL labeling.
- **`.claude/skills/visual-prompt-writer/references/shots-schema.md`** (in this skill) — the exact
  `shots.json` structure, the field → engine mapping, the **source-tag taxonomy**, and prompt-writing
  patterns. **Follow it exactly** so downstream maps 1:1 with no interpretation.
- `channels/<name>/performance.md` (if it has data) — reuse visual shapes / thumbnail styles that have
  proven retention/CTR for *this* channel; drop ones that flopped.


## Canonical rule homes

- Depiction, figure/crowd staging, poses/expressions, and camera/composition: `channels/<name>/visual-kit/visual-grammar.md`.
- Palette, style register, the empty/absent suffix lock, and review criteria: `channels/<name>/visual-kit/style-bible.md`.
- Chain/delta, cadence/coverage, and supplied lettering: `references/shots-schema.md`.
- Prompt assembly order: `image-generation/scripts/forge.py::assemble_prompt`.

## Step 3 — Long-form shot list (expand the cues, then densify)
Walk the script top to bottom and produce an ordered shot list where **every VO stretch has a
visual** and the visual intensity tracks the beat structure. **Run Step 2.5 on every shot** — the
`[B-ROLL]` cue tells you *where* a visual lands and its *meaning*; Step 2.5 decides *what it depicts*
(the cue is rarely a literal instruction).

Tag each shot with `beat` = narrative **position** (`hook` · `second-gate` · `premise` · `body` ·
`mid-arm` · `climax` · `withheld-peak` · `close` — §9 skeleton; authoring/review metadata, don't invent
names). It's review metadata only — the engine doesn't read it.

- **Expand each `[B-ROLL]` cue** into a full shot: decide subject → acting participants → occupancy →
  shot class → cast tokens → tableau → drawable facts, then write the `still_prompt`. Set
  `from_cue: true`. Anchor it with a `vo_ref` — the **opening words of that VO line,
  copied VERBATIM from `script.md`** (≥4 words, exact wording and order; never reword, summarize, or
  swap a pronoun for a name). `render-builder` times the cut by matching the **first 4 normalized
  words** of `vo_ref` against the real VO word-stream — a paraphrase never matches, so the shot
  mis-times.
- **Author shots in strict narration order (invariant).** Each shot's `vo_ref` must sit **at or after**
  the previous shot's position in `script.md`. A densify insert goes at the *true* script position of
  the line it illustrates — never before an earlier line. Out-of-order anchors trip render-builder's
  monotonic check and drop the whole piece to proportional timing. (`scripts/lint_shots.py` enforces
  both this and the verbatim rule.)
- **`vo_text` is DERIVED — never authored, never a depiction brief.** Do not write `vo_text` yourself;
  `lint_shots.py --write` (Step 7) fills each shot's `vo_text` = the verbatim script span it covers (its
  anchor to the next shot's), purely so you and the human can *see* coverage. **Never make a shot's
  image try to "represent" its whole span** — the image is anchored to its one moment (Step 2.5). A
  `vo_text` that comes out long (>~8s of VO on one anchor) is a signal to **densify** (add a cut) or
  confirm a story-needed held state change or a non-empty hold_reason — never to cram more meaning into one prompt (§10).
- **Densify to the cadence.** The script's cues are the *floor*, not the ceiling. Insert additional
  shots (`from_cue: false`) so there is a **new cut every 3–8s and a new stimulus every 30–45s**
  (§10), and weight density **highest in the first 60s** (the 55% cliff zone). A 20-second VO passage
  with one cue needs 3–5 shots, not one. Never leave static ambient B-roll under the first 3–5s
  (anti-pattern 8).

**Partitioning and stage decision.** Lock only contiguous act partitions plus cast and place
boundaries before authoring; do not predeclare a closed stage list. Author the shots first, then apply
the schema's hold-camera criterion to consecutive beats. Keep each resulting stage wholly inside one
partition. For every resulting stage, record `field + basis` in the plan lock, put a `Palette basis:`
sentence in the base shot's existing `notes`, and replace lower-value base-prompt words with the
drawable light/material facts that realize that field. A standalone shot is its own stage; a same-place
re-base starts a distinct stage. The coordinator merges partitions in narration order, then runs one
official lint and one independent critic pass.

- **Tag a source for every shot** (`ai-gen` / `stock` / `hybrid` / `chart` / `screencap` / `archival`
  — taxonomy in the schema). Doctrine: pure-AI B-roll reads uncanny (§13 / tools.md) — **blend real
  stock** for anything meant to look real (places, people, events), reserve full AI-gen for
  stylized/impossible/illustrative shots, and use `chart`/`screencap` for data and receipts (the
  "show the work" tactic, §1b). Give `stock`/`hybrid` shots a `stock_query`.

## Step 4 — Thumbnail generation prompts (from metadata's concepts)
For the long-form primary **and both challengers**, convert each `metadata.json` thumbnail *concept*
into a full `gen_prompt`, honoring **§8**:
- **Proof-of-human beats fully-AI by 18–22%** — prefer a real/photographic subject + AI or graphic
  background (hybrid) over a fully-AI plastic-skin portrait (algorithmically penalized). Where the
  channel is faceless with no subject, use its **locked signature subject/artifact** instead.
- **Neo-minimalism:** one dominant subject, **≥50% negative space, ≤2 primary colors**,
  channel-consistent palette. **Zero-text often wins**; if text helps, carry metadata's thumbnail
  `text` at **≤3 words, no all-caps**. **You own the ≤3-word cap, not metadata-writer** — its
  thumbnail `text` is a *concept promise* and may run longer (e.g. 4 words); if it exceeds 3 words,
  **trim it to ≤3 or drop to zero-text**, and note the change in the shot's `composition`. Don't
  restate the title — the thumbnail delivers the promise visually while leaving the question open
  (title + thumbnail = one asset).
- Use the working 2026 devices where they fit the concept: **single-artifact focus + red circle on
  the anomaly**, before/after split (only if the delta is visually obvious), **numbers as visual
  objects** (a stack of cash, dozens of pills) not text. Avoid the dead list (§8c): open-mouth shock,
  rainbow arrows, cluttered five-element frames, all-caps.
- Set `source: "hybrid"` (or the channel default) and respect the niche policy quirk.

## Step 5 — Shorts visuals
For every short, write a `first_frame` block **and** an ordered shot list. **Run Step 2.5 on every
short shot too** (subject → acting participants → occupancy → shot class → cast tokens → tableau →
drawable facts → intent note) — shorts are the densest,
most-cloned surface, so the non-literal grammar + anti-slop guardrail matter most here:
- **First frame IS the thumbnail** (§8/§11) — a pattern-interrupt tableau *already carrying the
  beat's tension* (a held pose loaded with the story's wrongness — not a freeze of motion), with the
  short's on-frame caption text **baked into the image** (diegetic, quoted verbatim, **≤4 words —
  rule 11 L-3, which is a HARD lint failure and applies here identically**) that wins the swipe decision
  in ~1.3–1.8s. *(This cap read "3–7 words" until the lint was built and caught the file's own shorts
  captions — `'IT STARTED WITH A RHYME'` and `'THEY CALLED THE ETHICS LINE'`, both 5 — contradicting
  rule 9's proven 1–4. The proven number wins: a caption the engine garbles loses the swipe outright.
  No shorts frames had been generated, so nothing was re-rendered to close this.)* No static/ambient opening (anti-pattern 8).
- **A cut every 2–4 seconds** (§11c) — shorts are visually denser than long-form. Same per-shot
  fields as long-form.
- **9:16 aspect.** Match the channel house style and locked lever (cross-lever visuals poison the
  brand). Carry the short's `archetype` + `publish`|`bench` status.

## Step 6 — Policy, originality & consistency (not optional)
- **Originality moat (July-2025):** compose *original* frames carrying the channel's POV. Never
  instruct "recreate <rival>'s thumbnail/shot" or clone a specific rival's signature format — that is
  the exact inauthentic-content trigger. Generic archetypes are fine; cloning a named channel is not.
- **AI-synthetic disclosure:** realistic AI/altered footage must be disclosed at upload (the machine
  flag lives in `metadata.json`); note `synthetic: true` on any photoreal AI shot so render-builder /
  publish-queue can honor it. For YMYL niches (health/finance) assume the viewer sees the label first.
- **Niche imagery gate:** engineering = analysis-not-gore (annotated diagrams, not casualties);
  horror/lore = suggestion over depiction; health = clinical, no body-horror; business = no
  defamatory depiction of real, named people. Flag any borderline shot in its `notes`.

## Step 7 — Write the file + lint
Write **`videos/<slug>/shots.json`** per `references/shots-schema.md` (one file: `house_style` +
`long_form` + `thumbnail` + `shorts[]`; set the file's own `status: "shots-drafted"`). Timings are
estimates until render — mark `timing_status: "estimated-from-script — re-time after render"`.

**Then run the lint (mandatory):**
`python .claude/skills/visual-prompt-writer/scripts/lint_shots.py videos/<slug>/shots.json --write`.
It validates every `vo_ref` against `script.md` (verbatim + narration order, mirroring render-builder's
matcher) and, on a clean pass, injects the **derived** `vo_text` coverage + `shot_counts`. **Any HARD
failure means render sync will degrade — fix it before handoff** (re-copy the exact opening words from
`script.md`; move the out-of-order shot to its true script position). Heads-up warnings (a shot covering
>~8s of VO on one anchor) mean **densify** there or confirm a story-needed held state change or a
non-empty hold_reason — do not fix them by widening the image's scope.

## Step 8 — Shot critic (mandatory; before any generation token is spent)
Dispatch the **fresh-eyes shot critic** per `references/critics.md`: one subagent with no share in
this run's authoring context, given `shots.json` + `script.md` + the channel staging law + the seven
authoring laws, answering the charter's generalized questions (scene logic · tableau · casting ·
acting · staging interest · renderability). Edit `shots.json` through its findings (you rewrite —
the critic never writes prompts), then **re-run `lint_shots.py --write`**. Note any finding you
rejected, with the reason, for the run summary. Only after this does the folder move on — leave the
idea-backlog lifecycle status at **`scripted`** (*files are the memory*; the idea flips to `produced`
only when the video is fully assembled). The folder is then ready for `voiceover` +
`image-generation` (pass 1/2 off this file) → `render-builder` → `compliance-check` → `publish-queue`.

## Output to the user
Short summary only: the `shots.json` path, the long-form shot count (and how many are densified
inserts vs. cue expansions), the thumbnail primary one-liner, the count of shorts visualized (with
total short shots), **confirmation `lint_shots.py` passed** (anchors verbatim + in narration order;
`vo_text` coverage + `shot_counts` written) plus any densify heads-up it raised, and **the critic
pass result** (N findings, how each was addressed or why rejected). `shots.json` is the source of
truth; keep the chat brief.
- **If `needed_assets` is non-empty:** STOP and surface the wanted poses/expressions/interactions (each with
  its `kind` + `wants` + `why`) for the human gate — do **not** hand off to `image-generation`. The run ends
  at the gate; a later invocation resumes once the assets are generated+approved (or vetoed beats restaged).

## Output contract (what image-generation + render-builder + publish-queue read)
`videos/<slug>/shots.json` — a single JSON object:
- `house_style` — the channel signature; `global_prompt_suffix` is empty/absent because Forge dispatches none.
- `long_form.shots[]` — ordered; each with `id`, `beat`, `start_hint`, `duration_s`,
  `vo_ref`, `from_cue`, `narration_type`, `shot_class`, `cast?`, `props?`, `source`, `still_prompt`,
  `stage?`/`stage_role?`/`changed_elements?`, `stock_query?`, `synthetic`, `notes` (+ the derived
  `vo_text` after lint). **The full field list and
  the exact field→engine mapping are canonical in `references/shots-schema.md` §1–§2 — this is a
  summary, not the contract.**
- `thumbnail.{primary,challengers[2]}` — each with `text_overlay`, `gen_prompt`, `composition`, `source`.
- `shorts[]` — one per short: `file`, `archetype`, `status`, `first_frame`, `shots[]`.
The field → engine mapping is documented in `references/shots-schema.md` so downstream maps 1:1 with
no interpretation.
