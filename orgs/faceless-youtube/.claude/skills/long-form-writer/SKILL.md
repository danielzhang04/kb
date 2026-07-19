---
name: long-form-writer
description: >-
  Writes the LONG-FORM voiceover script for a picked (and, on research channels, researched) video in
  this project — the earner, 8–45 min depending on niche. Use whenever the user wants to script/write/
  draft the long-form video, "write the script", "script this idea", turn a research dossier + brief
  into the long-form VO, or run the long-form scripting step — for ANY niche. Reads the picked brief +
  (if present) videos/<slug>/research.md + dna.md + the channel's storytelling-grammar + the universal &
  niche playbooks, and writes videos/<slug>/script.md with [B-ROLL]/[PAUSE] cues. Runs a staged
  writers-room (spine → casual story pass → leash pass → editor → humanize) on `long_form: staged`
  channels, and a single strong pass on `long_form: single`. On research channels it is LEASHED to the
  fact-ledger — it states only what research.md sourced. Runs AFTER `researcher` (deep path) or the idea
  gate (plain path) and BEFORE `shorts-writer` / metadata-writer / visual-prompt-writer / voiceover. Do
  NOT use it to write the shorts (that's `shorts-writer`), generate ideas (`idea-generator`), do the
  research (`researcher`), or pick titles/tags (`metadata-writer`).
---

# long-form-writer

Turn one picked idea — grounded in real research where the channel demands it — into a
**production-ready long-form voiceover script**. This is the earner; it deserves the most craft in the
pipeline. One skill for every channel; the niche is **data** in `channels/<name>/`, never forked into code.

## Mental model

`idea-generator` decided *what*; `researcher` found *what's true*; you decide *exactly how it's told* over
8–45 minutes without sagging, drifting, or inventing. Your `script.md` is the contract everything downstream
reads. It has to be **true** (leashed to the ledger on research channels), carry the channel's original POV
(the policy moat), and — the whole game — **sound like a real person telling a story**, not an AI narrating
an essay.

## The one thing that makes this skill work: write casual first, check facts second

The failure this skill exists to prevent is a script that is *accurate and lifeless* — a flat recital that
stuffs in every sourced fact, reaches for the formal word, and ends every paragraph on a little thesis. That
happens when the writer drafts with its head full of a fact-ledger and a rulebook. You cannot write "like
telling a friend" while staring at forty numbered facts.

So the order is deliberate:

1. **Distill the research into a short, plain-English story spine** (a handful of beats, no `[F-NN]` tags, no
   jargon) — then **set the ledger aside.**
2. **Write the whole story to that spine in the channel's casual voice**, as if telling it out loud. This is
   where the life comes from, and it has to happen *before* fact-checking, or the facts shape the voice
   instead of the other way around.
3. **Then bring the ledger back and check every claim.** Accuracy is enforced *after* the story exists, so
   the story is never bent to fact-coverage.

**On a channel with a `storytelling-grammar.md`, that doc's §0 is a finished gold script. That is your bar.
Read it, internalize its rhythm, and write to match it.** This skill does **not** restate the craft — the
grammar doc is the law; here you'll find the *process* and the skill-only execution (leash, markup, retention,
length, handoff).

## Step 0 — Identify channel + idea + mode

1. **Channel** from the request → `channels/<name>/`.
2. **Which idea?** The `picked` idea in `idea-backlog.md` (given an ID, use it; several `picked` → highest-
   scored or ask). **None `picked` → stop** and tell the user to pick one (the Stage-0 human idea gate is
   intentional).
3. **Read the `Pipeline` block in `dna.md`:** `long_form: staged` → run Steps 3a–3e. `single` → run Step
   3-single. Default to `single` if absent. `research: deep` → a `research.md` must already exist and you are
   **leashed** to it; if it's missing, stop and say to run `researcher` first. `research: none` → no ledger;
   work from the brief + playbooks.

## Step 1 — Read

- **The idea brief** in `idea-backlog.md` — format, angle/POV, payload, title options, why-original.
- **`videos/<slug>/research.md`** (if present) — **your source of truth for facts, and a POOL to draw from,
  not a checklist to cover.** The `[F-NN]` ledger is a **ceiling, not a floor**: state only what it sources,
  but use only what serves the story (a great script uses maybe half of it; discarding inert facts is
  expected and good). It also hands you the story material — cast, motive, the claim↔reality pairs, the light
  human cost, myths to bust — and flags what to hedge. **You design the story yourself** (Step 3a); the
  research supplies facts, not a plan. Treat a gap in the ledger as a wall, not a suggestion.
- **`channels/<name>/storytelling-grammar.md`** (if present) — **the craft law + the gold exemplar (§0).
  Read every run.** It governs voice, story shape, and staging; where it conflicts with generic doctrine, it
  wins. (A channel without one falls back to `universal.md` §5b/§5d/§1d-V.)
- **`channels/<name>/dna.md`** — length band, the locked lever, the narrator persona and default humor band,
  and any recurring structure.
- **`channels/<name>/watchability-rubric.md`** (if present) — the scored bar the draft is measured against;
  write toward it.
- **`universal.md`** (skim, don't drown) — the load-bearing bits: §1-P (payload rule), §2b (the 90-second
  AI-fatigue wall), §4/§5 (the hook + second gate), §6a/§6b (retention cadence + mid-video re-arm on long
  videos), §12 (anti-patterns). The channel's grammar doc already carries most of this for The Second Take.
- **`knowledge/research/niche-playbooks/<niche>.md`** — beat-template, length band, and any **policy quirk**
  (business-money YMYL + defamation; engineering analysis-not-gore; micro-health two-source; horror no-closure).
- `knowledge/playbook.md` (policy) · `performance.md` (copy hook/pacing shapes that worked).

## Step 2 — Set up the folder

Ensure `channels/<name>/videos/<YYYY-MM-DD>-<slug>/` exists. Make sure `brief.md` (the copied idea brief) is
present; copy it in if not. The folder stays self-contained.

---

## Step 3 (staged) — the writers-room · `long_form: staged`

### 3a — Outline: design the STORY, then the PLOT, then a plain spine

Work **top-down and story-first** (grammar §2–§3). Never build the outline up from fact-clusters; walking the
research in order is the flat-explainer failure.

1. **The story.** In a few sentences: what story would you tell a friend? The organizing frame, the arc, the
   handful of events worth telling. Select the *level of detail* per beat (never everything the research has)
   and *which* facts earn a place.
2. **The plot, non-linear.** Sequence to land hardest, not by the calendar. Choose the shape off grammar §3 —
   a paradox-hook + rewind, a named organizing frame, and a **cross-cutting plan** that consolidates threads
   rather than ping-ponging (grammar §3.3). Mark where the comedy runs hot and where it goes off (§1.4).
3. **Write the spine.** Turn the plot into **8–14 beats in plain English, one line each, no `[F-NN]` tags and
   no jargon** — just what happens, in the order you'll tell it. Note beside each beat which facts are on hand
   (a ceiling, not a checklist). *This spine, not the ledger, is what you draft from.* It must also be
   **followable** (grammar §3.8): read it back cold, as someone who knows nothing going in, and confirm they
   could track what happened and how each piece connects, jumps and cross-cuts included. If a connection only
   works because *you* already know it, fix the spine now by resequencing or introducing it earlier, never with
   a patch bolted on later. Lock it before drafting.

### 3b — Story pass: write it casual, ledger set aside

Draft the whole thing to the spine in the channel's voice (grammar §1, matched to the §0 exemplar), in
flowing runs of connected scenes, as if telling it out loud. Write to the *story*, not to fact-coverage.
Every beat ends on a fact or an action and flows on; the story concludes only once, at the very end. Apply
the markup and pacing below as you go. Do **not** stop to fact-check here — that's the next pass, and checking
mid-draft is what flattens the voice.

### 3c — Leash pass: now check every claim

Go back over the draft and trace every factual claim to its `[F-NN]`. Cut or hedge anything unsourced; a
`Conf: low` fact gets a hedge or goes. The leash is a **ceiling** (state only sourced facts), **not a floor**
(you need not use them all). Correct anything the draft got wrong against the ledger; where the research is
thin, keep the beat general rather than invent (grammar §4). You may leave a light inline `<!--F-07-->` trace
on a hard claim for the editor/compliance, but **strip every trace before final output.**

### 3d — The critic layer: fresh eyes that edit  (`references/critics.md`)

The writer cannot reliably catch its own taste flaws — it already made the call when it wrote the line, so
grandeur buttons and dwell sail straight through a self-edit. So this pass is done by **fresh, single-mandate
agents with no attachment to the draft.** It is thin by design: a mechanical lint, three parallel critics that
*flag only*, an editor that *applies* line-level fixes in-voice, and a single capped writer pass for structural
coherence. **Read `references/critics.md` — it holds the exact prompts and the orchestration; run them, don't
paraphrase them.** In one cycle:

1. **Mechanical lint** — run `scripts/lint_script.py <script.md>`. It deterministically flags em/en dashes,
   VO quotes, leftover `<!--F-NN-->` traces, and the word count. (Second person is *not* linted — whether a
   "you" casts the viewer or is the generic impersonal "you" is a judgment call for the taste critic.)
2. **Three critics, in parallel** (dispatch as subagents): the **taste critic** (voice/buttons/dwell/analogy/
   register/viewer-casting), the **leash critic** (every claim traces to an `[F-NN]`, hedges, no invented
   color), and the **coherence critic** (a first-time viewer: unearned confusion, unestablished connections,
   used-before-introduced, never flagging non-linearity or designed suspense). Each returns a findings list,
   the coherence one tagged **[LOCAL]** or **[STRUCTURAL]**, and **edits nothing**.
3. **Route on severity (details in `critics.md`).** Line-level findings (taste + leash + [LOCAL] coherence) →
   **the editor** (one subagent) applies them in voice → revised `script.md` + changelog. Any **[STRUCTURAL]**
   coherence finding → **one** writer structural-revision pass (reworks sequence/framing from all three
   findings lists, leashed) → a single re-verify. At most one structural bounce; if it's still confusing,
   surface to the human.
4. **Re-lint** the output to confirm no new dash/quote/trace crept in.

Taste and leash are **subtractive** — if they flatten the voice, the taste critic is over-triggering (loosen
its "never flag" list). Coherence is the one **additive/structural** lane, capped at a single writer bounce,
and it over-triggers the same way (flagging non-linearity or suspense as confusion) — tighten its never-flag
list if so. If subagents aren't available, run the three critic prompts as separate deliberate re-reads, then
edit — but prefer real subagents; the fresh context is the whole point.

### 3e — Accept

The editor's revised script is the working draft. Read its changelog; if it left any taste-vs-leash conflict
unresolved, settle it (keep the fact). Then Step 4.

---

## Step 3 (single) — one strong pass · `long_form: single`

Write the full script in one disciplined pass to the same voice and spine discipline, then leash-check if a
`research.md` exists, then Step 4. Use for lighter niches where the writers-room isn't worth the cost.

---

## Step 4 — Craft, markup, and shape (every mode)

**The craft lives in `storytelling-grammar.md` — apply it; don't re-derive it here.** What follows is the
skill-only execution and a few positive checks that reliably catch the pipeline's misses:

- **The de-button check (mechanical, so it actually gets done):** read the last sentence of every paragraph.
  It should end on a concrete noun, a name, a number, or an action. If it ends on a general statement *about*
  the story, fold it forward or cut it. The tells that slip through are summary lines dressed as endings:
  "It was just the biggest version of it," "the fake country and the real ones died the exact same death,"
  "the country they had bought had no government, because it had no country." The story concludes once, at the
  end. (Grammar §1.2, made into a check you can run. A dry *factual* aside like "And him? He was fine." is the
  GOOD kind — keep it.)
- **The read-aloud check:** read each line as if saying it to a friend. Anything you'd never actually say —
  cut or plain it down. (Catches the literary/jargon tells, §1.1/§1.5.)
- **Payload:** every beat carries a fact, number, or concrete detail, and the feeling rides on it. A line that
  survives with zero information removed is filler; cut it or rewrite it into the mechanism.
- **Pacing lives in punctuation, not em dashes.** New sentence or colon = a cut-in; ellipsis = a held beat;
  comma = a catch. Pause cues, used sparingly: **`[BEAT]`** (~0.3s), **`[PAUSE]`** (~0.6s), **`[PAUSE:LONG]`**
  (~1.2s before a reveal). (Comedic v3 channels may use `[aside: dry]`/`[emote: sigh]`; stripped on v2.)
- **`[B-ROLL]` cues are MEANING ANCHORS, not the shot list.** Mark `[B-ROLL: <the beat's meaning/emotion>]`
  where a visual lands. `visual-prompt-writer` owns the shot count, pacing, and durations and densifies each
  anchor into many shots — so cue the *meaning* (`[B-ROLL: the promise everyone believed]`), not a literal
  picture. Two habits make the best visuals possible: surface the claim/spin in the narrator's reported
  speech so the visual can unmask it, and reach for vivid verbs/idioms the visual can draw literally.
- **Retention:** open on the intrigue in the first lines (no "welcome back," no logo); give a real reason to
  stay inside the first ~15s. On longer videos (>10 min) keep new stimulus coming, re-arm around the middle,
  and hold your single best fact for the final stretch rather than front-loading everything. On a tight
  8–10-min story, good economy and a strong close do most of this work.
- **Aim for the story's natural length (grammar §2.3: a ~10-minute center of gravity, soft); length is a
  byproduct of developed beats, not padding and not terseness.** ~150 wpm (project constant); runtime ≈ words
  ÷ 150. If it lands well under, you're under-developing beats that deserve color, not missing filler; add a
  real cut *thread*, never filler (grammar §2.3). **Header runtime is REQUIRED, never `TBD`:** put
  **`Estimated runtime: MM:SS`** from actual word count ÷ 150 (`lint_script.py` prints the exact string to paste
  and HARD-fails if it's missing or unfilled). The header's **`Target length`** is the channel norm
  (**`~10 min center of gravity`**), NOT the idea brief's aspirational band — don't copy a "12–15 min" from the
  brief into the header.

## Step 5 — Humanize

Bake it in from the first draft (contractions, varied sentence length, concrete nouns, active present tense),
then run a focused pass: kill the AI-tells ("in today's video," "delve," "tapestry," "moreover," "it's
important to note"), the empty intensifiers (*literally/insane/crazy*), the over-signposting ("here's the
thing," "where it gets interesting"), the rhetorical-question tic (≤1 per ~200 words), the reflexive
rule-of-three, and "not X but Y." Run the de-button and read-aloud checks (Step 4). Scan for and remove every
em/en dash. Then **run the `humanizer` skill as a final pass** and keep its edits.

## Step 6 — Accuracy & policy

- Keep the channel's **original POV/framework** (the July-2025 policy moat).
- **Leash (research channels):** the script states nothing outside the ledger; every hard claim traces to an
  `[F-NN]`; `Conf: low` is hedged; date-sensitive mechanics carry their "as of <year>". Put the **Sources**
  list (the `[S#]` entries actually used) at the bottom of `script.md`.
- **Niche gate** where one exists: micro-health ≥2 sources; engineering analysis-not-gore; business-money
  **defamation discipline** (present documented facts, let the conclusion be the viewer's inference, never the
  channel's accusation). Add the AI/synthetic-content disclosure line where required.

## Step 7 — Update status + hand off

Set the idea's status in `idea-backlog.md` to **`scripted`** (preserve everything else). The folder is ready
for **`shorts-writer`** and, in parallel, `metadata-writer` → `visual-prompt-writer` → `voiceover` →
`render-builder`.

## Output to the user

Short summary: the folder path, the title + estimated runtime, the mode used, and — on research channels — a
one-line note that it's leashed and any claim the editor had to cut for lack of a source. Keep the chat brief;
`script.md` is the source of truth.

## Output contract (what downstream reads)

- `videos/<slug>/script.md` — header (source idea ID, target length, voice, **`Estimated runtime: MM:SS`**
  from actual words ÷ 150) + the VO script with `[B-ROLL]`/pause cues + the Sources list on gated niches. **No
  `<!--F-NN-->` traces or outline comments left in the final file.** Beat timestamps (if any) from cumulative
  words ÷ 150, never round numbers.
- `videos/<slug>/brief.md` — the copied idea brief (kept present).
- (Shorts are **not** written here — `shorts-writer` owns `videos/<slug>/shorts/`.)
