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
4. **Depiction is a DECISION, not a transcription.** The hardest, most-upstream call — made *before*
   composition or prompt wording — is *what each shot should depict*. The failure mode is a shot that
   literally draws the sentence. Real channels almost never do that: **non-literal is the default;
   literal depiction is reserved for concrete physical action/objects.** You classify each VO line's
   *narration type* and pick a *shot class* from the visual-narration grammar (universal.md **§13a** +
   the channel's `visual-kit/visual-grammar.md`), then **invent** a fresh on-style shot in that class —
   never clone the grammar's examples. This is Step 2.5 and it governs every shot you write.
5. **A prompt states its FACTS — including the ones that make it rich.** A `still_prompt` carries the
   facts that are load-bearing for the beat's meaning — layout (what's where), orientation (who faces
   whom; a vehicle points where it travels), targets (what a gesture/highlight refers to, named precisely
   — "the northern half of South America", never "the continent"), casting/costume, **framing/scale (the
   composition its class + payload demand — `visual-kit/visual-grammar.md §2`), each character's
   expression (from the beat/register)**, and — equally load-bearing, *not* decoration — the shot's
   **committed scene palette** (2–3 colours + the one red accent), its **light/atmosphere** (dawn,
   spotlight, radiant glow — light is a character, not an afterthought), and its **depth** (a
   fore/mid/background reading, filled edge-to-edge — *no dead air, no lone object on an empty field*).
   Anonymous figures route by SIZE (`style-bible.md`'s three-tier rig model): a **small/many/background**
   crowd is stated **on the CROWD RIG** — write the `style-bible.md §2d` crowd-rig clause verbatim into the
   `still_prompt` (round heads, dot eyes, one simple mouth, no noses/ears/teeth, same proportions, varied
   era clothing) so they hold uniformly at scale; a **LARGE/foreground anonymous** figure (a lone settler
   who IS the shot, a clerk) instead gets the `style-bible.md §2e` base-rig clause authored into its
   `still_prompt` (the FULL rig, a generic fitting outfit/hair, no seed). A *named* figure in the same shot
   is cast (full rig, seeded), never folded into either anonymous clause. Name concrete elements, not categories ("colonnaded cream buildings, a domed bank,
   a distant palace", not "a city"). Write it so **a stranger could verify the image against the prompt.**
   A load-bearing fact left implied is a defect — a thin, palette-less, sparse prompt renders thin and
   basic (the failure this reframe fixes); an inventory of objects that *don't* carry the beat is bloat,
   also a defect. The downstream scene gate checks the image against these claims — richness included.

## Load-bearing rules (a run that misses one ships broken output)

**The seven authoring laws (canonical names — the taste/logic core).** These are the named laws the
Step 8 critic reviews and that `references/critics.md` refers to; use these exact names everywhere and
nowhere coin a variant set:
**held tableau · scene facts · acting · casting · delta decisiveness · hook bar · disclosure order** — all under the
overarching frame *author intent, never mechanism* (engine-reality). The critic realizes them as its
six per-shot questions + its plan-level checks (delta decisiveness + disclosure order, alongside the stage-grouping semantic check); the 1:1 map lives in `critics.md`. The eight **numbered
mechanical rules below are a different list** — the render-contract rules that silently break the
render if skipped. They are restated in context further down; collected here so no run misses them.

1. **Held-tableau law (rule 1 above), on EVERY still** — including shorts `first_frame`s. Test each
   `still_prompt`: would this frame read as deliberate if printed and framed? Mid-action freezes fail.
2. **Scene-facts discipline (rule 5 above), on EVERY still** — load-bearing facts stated, verifiable,
   precise; nothing decorative that could mislead (unmotivated scenery is a defect).
3. **Enumerations/lists → progressive reveal, made VISIBLE the way the engine can render it today**
   (§13a-i-c). A "no church, no paved roads, no rivers of gold" line must **not** be silently dropped
   and **not** collapse to one static frame. A reveal that has to be seen is carried one of two
   renderable ways: **(a) a stage delta chain** — a `base` frame holds the set and each named element is
   struck/added in its own `delta` frame with its own verbatim `vo_ref` (one change per delta, ≤3 deltas
   per chain); or **(b) baked diegetic text** — where the text IS the payload, quote it verbatim in the
   `still_prompt`, kept SHORT (1–4 words), designed into the scene (a stamp, a ledger line, a sign). There
   is **no engine text overlay** and **no motion field** to carry a reveal — those are deleted.
4. **Cadence enforcement — this kills stretch-to-fill** (§13a-ii, BINDING). Minimum shot count =
   `Estimated runtime ÷ 8s`; a healthy hook zone runs closer to `÷ 4s`. Make **Σ `duration_s` ≈
   `Estimated runtime`** so the whole VO track is covered. **A shot may exceed ~8s ONLY if it carries a
   progressive within-shot reveal** — otherwise split it or cut. **The stretch-to-fill failure:** if
   you under-produce the list, its durations sum short of the VO, so `render-builder` re-times to the
   VO track and **stretches each shot** — leaving one visual dead on screen for 15–25s and silently
   destroying the cadence you engineered. Densify; never lengthen holds to close the gap.
5. **Literal-check gate (Step 2.5).** Any shot that merely draws the *words* of an abstract, relational,
   quantitative, or claim-type line FAILS — reclassify to a non-literal class.
6. **Every prompt carries the `global_prompt_suffix`** (the house style), on every long-form, thumbnail,
   and shorts prompt.
7. **Anchor fidelity + narration order (lint-enforced).** Every `vo_ref` is a **verbatim** copy of its
   VO line's opening words (≥4 words, exact wording + order), and shots are authored in **strict
   narration order**. `render-builder` times each cut by matching `vo_ref`'s first 4 normalized words
   against the real VO word-stream (`render.py::retime_by_timings`) — a paraphrased or out-of-order
   anchor never matches, mis-places that shot, and enough misses **silently drop the whole video to
   crude proportional timing**. Run `scripts/lint_shots.py` (Step 7): it mirrors that matcher, HARD-fails
   on either defect (and on the delta-chain structural caps — ≤3 deltas, exactly one `base` first per
   stage), and then derives the review-only `vo_text` coverage + `shot_counts`.
8. **The shot critic runs before any pixel is bought (Step 8, mandatory).** A fresh-eyes subagent
   reviews the finished `shots.json` per `references/critics.md`; you edit through its findings and
   re-lint. Skipping it ships plan-level logic errors into paid generation.
9. **All in-video text is diegetic + baked (TEXT law).** There are no engine text overlays — every word
   on screen is designed into the generated image (a stamp, a sign, a ledger, a banner). Authored text is
   quoted **VERBATIM** in the `still_prompt`, kept **SHORT** (1–4 words proven, digits/comma OK), and the
   image-gen review transcribes it letter-by-letter — a garbled render is a blocking flag. Where the text
   IS the payload, this is how a reveal is made visible (rule 3b). The lettering STYLE is pinned
   channel-wide (a locked exemplar image-gen seeds automatically — style-bible §6): never describe fonts,
   lettering, or handwriting style in a `still_prompt`.
10. **Supplied-text law — NEVER name a text element without supplying its value (lint-enforced, HARD).**
   Rule 9 governs text you *chose* to author. This rule governs the far more dangerous case: **referring
   to on-screen text by DESCRIPTION instead of by VALUE.** A prompt that says *"a large marker scorecard
   number painted on its face"*, *"one prominent number"*, or *"a customer's name marker-written across
   the top"* has instructed the engine to render glyphs and told it nothing about which — so **the engine
   invents them, every time.** It rendered `1` for the first and `3.5` for the second. On this channel's
   Wells Fargo documentary — a real, named, living person and a documented SEC case — that mechanism put
   an **invented criminal charge on screen against a real person**, alongside ~20 other fabricated
   on-screen facts. The prompt looked completely reasonable; nothing downstream could catch it, because
   by the time the value exists it is pixels and the frame looks intentional.
   **The rule:** a prompt may never instruct the engine to render text, a figure, a name or a date
   without supplying that value **verbatim, inline, adjacent to its own element**. If the value cannot be
   sourced from `research.md`'s fact ledger, **OMIT the element entirely rather than gesture at it** — or
   author it as deliberately blank ("the metric field left COMPLETELY EMPTY", "a single BLANK name line"),
   which is a legitimate composition. **Do NOT invent a plausible value to satisfy the rule** — that is
   the same fabrication with an extra step. Worked examples + the three resolutions:
   `references/shots-schema.md §4`. `scripts/lint_shots.py` HARD-fails it; `motion-planner` carries the
   identical law for `cutout_prompt`/`plate_prompt`, which is where the boulder's invented `1` was authored.

**Intent, never mechanism.** You author *what a shot depicts*; the engine owns the treatment (camera,
entrance, timing) and the `audio-director` owns the sound. Never author mechanism anywhere in the file —
no easing names, amplitudes, spring values, camera moves, or audio choices. (The old `ken_burns`/
`within_shot_motion` motion fields are deleted — the engine animates nothing inside a still frame.)

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
  (write shots that reuse them where they fit) — and pull the house style / `global_prompt_suffix`
  ingredients from **`visual-kit/style-bible.md §6`** (the committed recipe) when the channel has one.
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

## Step 2 — Set the house style (once, top of the file)
Before writing shots, distill `dna.md`'s visual style + `<niche>.md` conventions into the file's
`house_style` block and a **`global_prompt_suffix`** — a short, consistent style string appended to
every generation prompt (palette, medium, lighting, era, texture, "no on-screen faces" if faceless).
This is how one channel's videos come out looking authored rather than assembled.

**Read `dna.md`'s locked visual register and commit to it (universal.md §13):** the winning axis is
*distinctive + coherent + matched to the content*, so pick ONE lane and hold it —
- **Stylized / illustrated** (abstract niches — finance, what-if, mechanisms, explainer): a **single
  locked style-token in every prompt** (e.g. "flat 2D crayon-doodle," "clean flat-vector") buys instant
  brand coherence AND hides AI-artifact tells; cheaper and more automatable. Usually the *better* lane
  for abstract subjects, not just the cheaper one.
- **Real footage / screencap / archival** (authenticity niches — ai-tools demos, internet-lore
  evidence): use real stock/captures where the value IS the realism.
- **BAN the uncanny middle: generic semi-photoreal AI B-roll** (the "cinematic dread stock-AI" look).
  It reads as slop *and* carries no identity — the worst quadrant. Don't split the difference: commit to
  the stylized signature OR to real footage. If `dna.md`'s visual register is `TODO`/unspecified, pick
  the lane the niche implies (abstract → stylized-signature) and flag it. If `dna.md`'s visual style is
  still `TODO` (no committed channel), infer a coherent house style from the niche file, write it into
  the block, and flag `house_style_source: "inferred — set dna.md Visual style"`.

## Step 2.5 — Decide WHAT each shot depicts (the narration→shot grammar)
Governs every shot in Steps 3 and 5; runs *per VO line, before any prompt*. Default failure = drawing
the sentence literally (real channels almost never do). **The grammar itself lives in one place — do not
re-derive it here.** The narration-type → shot-class **table** is `universal.md` **§13a**; the channel's
staging application is `visual-kit/visual-grammar.md` (+ `registry.json` for what exists). This step is
the *procedure* that applies them, per line, in order:

1. **Classify → pick a class.** Name the line's narration TYPE, look up the matching shot CLASS in the
   **§13a table**, and record the class using its **canonical name from the `shot_class` enum in
   `references/shots-schema.md` §1** — that enum is the single source of truth for the class names (do
   not coin variants or re-list them here). Do not reproduce the §13a table from memory; read §13a.
2. **Invent a FRESH, on-style shot in that class** for *this* story. **The class carries its
   composition — realize it** (physicalized-imbalance → relative size; staged-interaction → an active
   interaction, never two figures parked; per `visual-grammar.md §2`); a shot staged as a generic
   centered medium shot has ignored its class. Examples in the grammar illustrate the class, never
   template it — don't reflex to "a genie" or "a handshake-with-emoji." Two same-typed lines must produce
   visibly different images. **(The anti-slop guardrail — classify then INVENT — is the point of this step.)**
3. **Literal-check gate (mandatory).** If a shot merely draws the *words* of an abstract, relational,
   quantitative, or claim-type line, it FAILS → reclassify to a non-literal class. Literal is allowed
   **only** for a concrete physical action or real object.
4. **Cast it.** Every story-named or story-referenced figure — **including inside diegetic media** (a
   brochure's prince who IS the story's con-man, a portrait, a poster) — routes through the channel
   registry: name the registry asset in the prompt so `image-generation` seeds it. A role must read at
   a glance (a king reads as a king via 1–2 signifiers); named cast wear their pinned canonical
   outfits unless the shot deliberately authors a change. **A recurring identifiable GROUP** (a specific
   named band/duo/troupe that reappears — its members must stay consistent) is cast too: ONE `cast` entry
   naming the group, with no `pose_ref`/`expression_ref` (a group is not single-figure-posed; image-gen
   locks it as a group-character and seeds it). **Anonymous** figures (different nonrecurring people) stay
   prose in the `still_prompt`, never cast, and route by SIZE per the three-tier rig model: a
   **small/many/background** crowd gets the **`style-bible.md §2d` crowd-rig clause** written verbatim
   (round heads, dot eyes, one simple mouth, no noses/ears/teeth) → simplified rig; a **LARGE/foreground**
   anonymous figure gets the **`style-bible.md §2e` base-rig clause** written into its `still_prompt` (the
   FULL rig, a generic fitting outfit/hair, no seed). VPW authors both clauses (as it authors §2d). If a
   group member later acts alone in a hero shot, cast that member as an individual.
   **Recurring props are declared like cast.** A specific identifiable object that recurs across shots and
   must look the SAME each time (the guidebook, a named banknote, a signed deed) is named in the shot's
   **`props` array** (its library name). A recurring prop named in the prose but omitted from `props` is an
   authoring gap, exactly like an uncast named figure. A one-off object (used in a single shot, no match
   requirement) stays in the `still_prompt` prose only — no `props` entry, no slot.
5. **Stage the tableau + act it — by SELECTING library assets, not describing them.** Mirror step 4's
   casting: for each prominent figure, choose its **`pose_ref`** (the held body pose/gesture that carries the
   action's meaning) and/or **`expression_ref`** (the face for this beat/register) **from the registry
   vocabulary**, and record them on the shot's `cast` entry. These are SEEDED by `image-generation` (style-bible §5
   one-run multi-seed) — so the pose/hands and the expression are the assets' job, **not** the `still_prompt`'s.
   Scene-first ordering: the shot's meaning/scene drives which pose/expression fits, never the reverse.
   `pose_ref`/`expression_ref` are each optional (a plain standing figure needs neither). A two-figure
   interaction (a clasp) uses an **interaction** asset — the same kind of `pose_ref`, just one that shows two
   figures — referenced by BOTH figures' `cast` entries. **The shot's `cast` ORDER binds the slots: the first
   entry is the left figure, the second is the right** (image-gen seeds two identities into the template by
   that order). If the registry lacks the interaction, surface it (below) as `kind: interaction`, no special path.
   - **Reuse-or-surface:** if the registry has a close-enough pose/expression/interaction, reference it (the
     `still_prompt` may still adjust the figure's *placement/angle*; the asset supplies the *hand/face*). If
     nothing is close, add a NEW entry to top-level `needed_assets` (`kind` + `slug` + `wants` + `why`) — then
     the gate (below) handles it.
6. **State the facts (scene + placement only) — and supply every value you name.** Before writing any
   element that carries text, a number, a name or a date, get its literal from `research.md`'s fact ledger
   and quote it inline next to that element (cite the `[F-NN]` id in `notes`). **If the ledger has no such
   fact, cut the element** — never write "a scorecard number", "one prominent number", "a customer's name"
   and leave the engine to fill it (Load-bearing rule 10; this is a HARD lint failure, and it is how a
   fabricated criminal charge reached a real person's frame). Otherwise: write the `still_prompt` so every load-bearing SCENE fact is
   explicit and checkable — layout, geography, who stands where, what a highlight/prop targets, the figure's
   narrative ACTION and PLACEMENT. **Do NOT describe the body pose, hand/finger mechanics, or facial
   expression** — those are seeded via `pose_ref`/`expression_ref` (step 5); authoring them here too is
   double-authoring (single-home map, `style-bible §5`). Everything in frame earns its place; nothing
   decorative that could mislead.
7. **Realize any reveal structurally.** An enumeration or reveal that must be SEEN is realized by stage
   deltas or baked diegetic text (rule 3) — never by a motion note or a text overlay (both deleted).
   Intent only — the engine owns realization; audio is authored separately by the `audio-director`.
8. **Record on the shot.** Set `narration_type` + `shot_class` (auditable; forces the
   classify-then-invent discipline).
9. **Channel translation** (the channel `visual-grammar.md`'s lever/register section): render the cast
   on the locked rig; make ironic-counterpoint the signature move when the lever is vindication; hold
   humor to the channel's dial (evergreen, no memes — even where reference channels use meme cutaways);
   use the desaturated-own-style "gravity register," never real footage, for grim beats
   (uncanny-middle ban, §13).

**Anti-slop guardrail:** the grammar is the reusable asset; the images are disposable and story-specific.
If the shot list starts reusing one depiction across videos, you've rebuilt the phrasebook — vary the
content, keep the relationship.

### The pose/expression gate (hard stop before generation)

When any shot's `pose_ref`/`expression_ref` names an asset the registry LACKS, VPW records it in
`needed_assets` (with `kind` + `slug` + **`wants`** = what to draw + `why`) and **ends its run there — it does
NOT proceed toward generation.** Then a HUMAN:
- **approves** → the pose/expression/interaction is generated on the base + rig-gated, registered, and a later
  invocation resumes; OR
- **vetoes** (too niche/hard) → VPW **restages that beat using ONLY existing library assets** — it may not
  request a new asset for a vetoed beat (the convergence rule; no endless surface→veto loop). If a beat truly
  cannot be staged from existing assets, VPW flags THAT beat back to the human.
- **Interactions are handled uniformly** — a `kind: interaction` entry, same gate; nothing special.
This is the only path new base assets enter the library — never ad-hoc generation inside a scene (`style-bible §7`).

## Step 3 — Long-form shot list (expand the cues, then densify)
Walk the script top to bottom and produce an ordered shot list where **every VO stretch has a
visual** and the visual intensity tracks the beat structure. **Run Step 2.5 on every shot** — the
`[B-ROLL]` cue tells you *where* a visual lands and its *meaning*; Step 2.5 decides *what it depicts*
(the cue is rarely a literal instruction).

Tag each shot with `beat` = narrative **position** (`hook` · `second-gate` · `premise` · `body` ·
`mid-arm` · `climax` · `withheld-peak` · `close` — §9 skeleton; authoring/review metadata, don't invent
names). It's review metadata only — the engine doesn't read it.

- **Expand each `[B-ROLL]` cue** into a full shot: run **Step 2.5** on its VO line (classify → cast →
  stage the tableau → state the facts), then write the `still_prompt`. Set
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
  confirm a progressive in-shot reveal — never to cram more meaning into one prompt (§10).
- **Densify to the cadence.** The script's cues are the *floor*, not the ceiling. Insert additional
  shots (`from_cue: false`) so there is a **new cut every 3–8s and a new stimulus every 30–45s**
  (§10), and weight density **highest in the first 60s** (the 55% cliff zone). A 20-second VO passage
  with one cue needs 3–5 shots, not one. Never leave static ambient B-roll under the first 3–5s
  (anti-pattern 8).
- **Stage the run — held evolving stages (the anti-choppiness lever).** After inventing the
  shots, group **consecutive shots that share ONE setting/subject** into a `stage`: give them a common
  `stage` id, mark the first `stage_role: "base"` and the rest `"delta"`, and on each delta author
  `changed_elements` — **exactly ONE** world-change vs the prior frame (`"+ cathedral rises"`, `"- ship"`,
  `"MacGregor gains epaulettes"`, `"MacGregor's smugness drops to alarm"`), **anchored to its own word**:
  if the VO introduces a bank on "bank" and a coin on "its own money", that is TWO deltas (each its own shot
  + verbatim `vo_ref` on the word its element lands on), never one delta that adds both — bundling two at
  one cut blurs the reveal and mis-times the second against its word. A beat that adds several things at
  once is several fast deltas or a hard cut to a new base. A delta is the still-era
  progressive reveal: the set persists, one thing changes — that continuity (not a new scene each cut)
  is what reads like the reference channels. **An ADDITIVE beat is a shared-`stage` delta — author the
  addition, not the whole scene:** when a beat adds a discrete element to a scene already established (a
  character entering the held swamp; a 5-STAR stamp landing on the guidebook), keep the SAME `stage`, mark
  the shot `stage_role: "delta"`, and name ONLY the added element in `changed_elements` (`"+ MacGregor
  enters, stage-left"`, `"+ red 5-STAR stamp on the guidebook"`) — do NOT re-describe the established set in
  the delta's `still_prompt`; it persists from the base frame, you are adding one layerable thing.
  (Downstream, the motion-planner may realize this as plate-reuse + a matted cutout rather than a full
  re-gen, from the same `stage` + `changed_elements` — you author only the intent.) **Deltas are DECISIVE:** if the beat is a world-flip, the
  frame flips (a full palette turn, the paradise fully gone) — never a timid partial coexistence that
  makes the reveal mushy. **Hard-cut to a NEW stage only when the setting/subject/register genuinely
  changes.** Cap a chain at **≤3 deltas**, then a fresh base or a hard cut. **Timing:** delta frames
  run fast (1.5–3s); the base/hold frame holds longer (4–12s). **Author INTENT only** — name *what
  changes*, never *how it's produced* (no "seed off the previous frame", no `chain_from`;
  `image-generation` owns the mechanism, and the same metadata later drives a Remotion layer-move
  unchanged). Each frame stays a full shot with its own verbatim `vo_ref`; a shot with no shared
  `stage` is a standalone hard cut, as before.
- **Disclosure order — an image never reveals ahead of the narration (plan-level law).** A shot may
  contain only what the VO has already introduced by that shot's `vo_ref` position. When the script
  **deliberately withholds** a payload for a later beat (a character's identity, a fate, a twist
  object/number/place), that entity does **not** appear in any earlier shot — in **any pose or form**;
  the fix is to re-author the shot (or rework its stage chain) with the entity absent, never to obscure
  it. It's a cross-shot sequencing property, so the Step-8 critic enforces it at plan level
  (`references/critics.md`); an ordinary first-introduction is not withholding and is not a defect.
- **Cover the VO runtime — sum the durations, don't leave gaps.** The runtime source of truth is the
  script header's **`Estimated runtime`** (words ÷ 150 wpm — the project constant); make **Σ
  `duration_s` ≈ that runtime** (if the header is missing, compute VO words ÷ 150 yourself). This is
  load-bearing: `render-builder` re-times shots against the VO track, so a list whose durations sum
  short of the VO forces it to *stretch* every shot — which silently breaks the 3–8s cadence you just
  engineered. Concretely: minimum shot count is `runtime ÷ 8s`; a healthy hook zone runs closer to
  `÷ 4s`. If your shots sum well under the runtime, you have too few — densify, don't just lengthen
  holds. (If the script's declared runtime disagrees with its own word count, trust the word count and
  flag it — a mismatch is a scriptwriter bug, not something to design around.)
- **Diagram-first niches may hold longer per cut** (engineering, some finance/health): a single
  annotated schematic that *progressively reveals* (arrows draw on, labels tick, callouts appear) can
  legitimately hold 10–14s because the **in-shot annotation is the 30–45s stimulus refresh** — the cut
  is not the only stimulus. In those shots set a longer `duration_s` and author the reveal in the
  intent note. Event shots (a failure, a reveal, a silence beat) still stay short (3–6s). Do **not**
  use this to justify a sparse list of static holds — motion-graphics niches (§13) still cut fast.
- **Visual question before narration (§1b) — and the hook-frame bar.** The hook shot (and each
  new-loop opening) presents something whose meaning is unexplained — the frame poses the question the
  VO answers a beat later. **The hook shot is held to a scroll-stop standard: the most arresting
  staging of the beat, not the first competent one.** If the hook tableau would look at home anywhere
  mid-video, restage it — push the absurdity, the scale, or the wrongness that IS the story's promise.
- **Reveal staging — a character enters on their NAME.** A character's first appearance (a reveal) is
  anchored to the **naming moment** — its `vo_ref` is the VO line that names the character, so the figure
  lands on their name, not a beat early (respects disclosure order: a withheld character appears in NO
  earlier shot). Stage the reveal with intent: a big reveal gets a **dramatic staging** (spotlight, low
  angle, the figure arriving into a held scene — the gold-stage exemplar), a minor one a clean
  introduction. Use the character's **canonical / default expression** unless the beat authors a specific
  one (a reveal is an entrance, not yet a reaction).
- **Escalate to the beats.** Reserve your most striking imagery for the hook, the mid-video re-arm
  (55–65%), and the **withheld peak** in the final 20% (the script tees these up — the visual must
  pay them off). Use **match-cut callbacks** (§6a): echo an early frame late for completion payoff.
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
short shot too** (classify → cast → tableau → facts → intent note) — shorts are the densest,
most-cloned surface, so the non-literal grammar + anti-slop guardrail matter most here:
- **First frame IS the thumbnail** (§8/§11) — a pattern-interrupt tableau *already carrying the
  beat's tension* (a held pose loaded with the story's wrongness — not a freeze of motion), with the
  short's on-frame caption text (3–7 words) **baked into the image** (diegetic, quoted verbatim, kept
  short — TEXT law) that wins the swipe decision in ~1.3–1.8s. No static/ambient opening (anti-pattern 8).
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
- **Don't add facts the script withheld.** Prompts — including any **baked diegetic text** — illustrate
  the VO and do not introduce new claims. Never put a **casualty count, date, name, or statistic on
  screen that the script chose to omit** (in analysis-not-gore niches the script often deliberately
  withholds the death toll — honor that omission, don't re-introduce the number as baked text). Baked
  in-image text is a visual echo of what's said, not an addition to it.
- **House-style consistency:** every prompt must carry the `global_prompt_suffix`. A frame that would
  look off-brand is a slop tell — cut or restyle it.

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
>~8s of VO on one anchor) mean **densify** there or confirm a progressive in-shot reveal — do not fix
them by widening the image's scope.

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
- `house_style` + `global_prompt_suffix` — the channel signature every prompt inherits.
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
