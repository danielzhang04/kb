---
name: long-form-writer
description: Writes the long-form voiceover script for a picked (and, on research channels, researched) video. Use to script/write/draft a long-form video or run the long-form scripting step — any niche. Reads the picked brief + research.md (if present) + dna.md + storytelling-grammar; writes script.md with [B-ROLL]/[PAUSE] cues. Runs after researcher/idea gate, before shorts, metadata, visuals, voiceover. Do NOT use it for shorts, ideas, research, or metadata.
---

# long-form-writer

Turn one picked idea into a **production-ready long-form voiceover script**. One skill for every
channel; the niche is data in `channels/<name>/`, never forked into code. `script.md` is the contract
everything downstream reads: **true** (leashed to the ledger on research channels), carrying the
channel's POV, and sounding like a real person telling a story.

**The craft is not here.** Voice, story, structure, and staging live in the channel's
`storytelling-grammar.md`; this skill is the process that applies it.

## The core principle: write casual first, check facts second

Drafting with a head full of fact-ledger produces accurate-and-lifeless scripts. So the story is
designed and drafted in the channel's voice with the ledger set aside, and accuracy is enforced after
the story exists (Steps 3a–3c). The facts never shape the voice; the voice carries the facts.

## Step 0 — Identify channel + idea + mode

1. **Channel** from the request → `channels/<name>/`.
2. **Idea:** the `picked` idea in `idea-backlog.md` (given an ID, use it; several picked →
   highest-scored or ask). None picked → **stop**; the idea gate is human.
3. **`dna.md` `Pipeline` block:** `long_form: staged` → Steps 3a–3e; `single` → Step 3-single
   (default if absent). `research: deep` → a `research.md` must exist and you are **leashed** to it
   (missing → stop; run `researcher` first). `research: none` → no ledger; work from the brief.

## Step 1 — Read

- **The idea brief** in `idea-backlog.md`. On the deep path its promises are hypotheses until research
  verifies them.
- **`videos/<slug>/research.md`** — the source of truth for facts; select from it per grammar §2.2 (a
  ceiling, never a floor). Its **Viability verification** block is the canonical story/packaging
  contract — its supported or revised stake, mechanism, payload, cold open, and titles override
  conflicting brief text; never reuse anything under **Unsupported promises**.
- **`channels/<name>/storytelling-grammar.md`** — the craft law. Read every run, plus
  `references/personable-calibration.md` (the voice reference) where the channel routes to it.
- **`channels/<name>/dna.md`** — length band, locked lever, narrator persona, humor dial.
- **Policy** (consumed at Step 6): `knowledge/playbook.md` + the policy quirk in
  `knowledge/research/niche-playbooks/<niche>.md`.

## Step 2 — Folder

Ensure `channels/<name>/videos/<YYYY-MM-DD>-<slug>/` exists with `brief.md` (the copied idea brief) in
it.

---

## Step 3 (staged) — the writers-room · `long_form: staged`

### 3a — Outline: story → plot → spine

Top-down and story-first; never build the outline up from fact-clusters — walking the research in
order is the flat-explainer failure.

1. **The story.** In a few sentences: what story would you tell a friend? Which events earn a place,
   at what level of detail.
2. **The plot.** Sequence to land hardest, not by the calendar — choose the shape from grammar §3 and
   design the retention arc now (grammar §2.6). Set the humor register off `dna.md`'s dial.
3. **The spine.** 8–14 beats in plain English, one line each, no `[F-NN]` tags, no jargon; note beside
   each which facts are on hand. Read it back cold for followability (grammar §3.7) and fix by
   resequencing, never a bolted-on patch. For a major scheme sequence, a compact planning card:
   `question → sourced action/mechanism → narrator angle → what it enables → next question`; a spoken
   `Step N` only per grammar §1.5. **Lock the spine before drafting.**

### 3b — Story pass: casual, ledger set aside

Draft the whole script to the spine in the channel's voice (grammar §1 + the calibration excerpt), as
if telling it out loud. Write to the *story*, not fact-coverage. No fact-checking here — checking
mid-draft is what flattens the voice.

### 3c — Leash pass: now check every claim

Trace every factual claim to its `[F-NN]`; cut or hedge anything unsourced (`Conf: low` → hedge or
cut); date-sensitive mechanics carry their "as of <year>". The casual draft stays the voice source of
truth: make the **smallest local factual correction** and preserve sentence order, conversational
joints, repetitions, slang, comic rhythm, and narrator presence. A claim that can't be fixed locally
gets flagged to the writer, never laundered into documentary exposition. Optional inline `<!--F-NN-->`
traces are allowed; **strip every one before final output.** Put the **Sources** list (the `[S#]`
entries actually used) at the bottom of `script.md`, and apply the niche policy gate where one exists
(business-money **defamation discipline** per grammar §4; micro-health ≥2 sources; engineering
analysis-not-gore; AI-disclosure line where required).

### 3d — Critics + humanize (`references/critics.md`)

Fresh, single-mandate agents — the writer can't catch its own taste flaws. Run exactly per
`critics.md`: mechanical lint (`scripts/lint_script.py`), four parallel flag-only critics (taste,
leash, coherence, raw-versus-leashed), one editor applying line fixes in voice, at most one structural
writer bounce, then the **`humanizer` skill as the closing pass** (keep its edits), re-lint. Taste and
leash are subtractive; coherence is the one structural lane. Still confusing after the bounce →
surface to the human.

### 3e — Accept

The editor's revision is the working draft. Settle any unresolved taste-vs-leash conflict (keep the
fact). Then Step 4.

---

## Step 3 (single) — one strong pass · `long_form: single`

Write the full script in one disciplined pass with the same voice and spine discipline, leash-check if
a `research.md` exists, run the `humanizer` skill, then Step 4.

---

## Step 4 — Markup & shape (every mode)

The craft lives in the grammar — apply it, don't re-derive it. The execution contract:

- **Pause cues**, sparingly: `[BEAT]` ~0.3s · `[PAUSE]` ~0.6s · `[PAUSE:LONG]` ~1.2s before a reveal.
  Pacing otherwise lives in punctuation (new sentence/colon = cut-in; ellipsis = held beat; comma =
  catch); never an em/en dash. (v3 channels may use `[aside: dry]`/`[emote: sighs]`; stripped on v2.)
- **`[B-ROLL]` cues are meaning anchors, not the shot list.** Cue the beat's meaning/emotion
  (`[B-ROLL: the promise everyone believed]`), not a literal picture — `visual-prompt-writer` reads
  them as its spine and owns shot count, pacing, and durations. Surface claims in the narrator's
  reported form so the visual can unmask them; reach for vivid verbs/idioms the visual can draw
  literally.
- **Runtime header:** **`Estimated runtime: MM:SS` is REQUIRED, never `TBD`** — computed at the
  **channel voice's measured wpm** from `dna.md` (fallback 150). `lint_script.py --wpm <N>` prints the
  exact string to paste and hard-fails without it. Header `Target length` is the channel norm (grammar
  §2.3), not the brief's aspirational band.

## Step 5 — Status + handoff

Set the idea to **`scripted`** in `idea-backlog.md` (preserve everything else). The folder is ready
for `shorts-writer` and, in parallel, `metadata-writer` → `visual-prompt-writer` → `voiceover` →
`render-builder`.

## Output to the user

Short: the folder path, title + estimated runtime, the mode used, and — on research channels — a
one-line leash note (any claim cut for lack of a source). `script.md` is the source of truth.

## Output contract (what downstream reads)

- `videos/<slug>/script.md` — header (source idea ID, target length, voice, **`Estimated runtime:
  MM:SS`**) + the VO script with `[B-ROLL]`/pause cues + Sources on gated niches. No `<!--F-NN-->`
  traces or outline comments. Beat timestamps (if any) from cumulative words ÷ 150, never round
  numbers.
- `videos/<slug>/brief.md` — the copied idea brief.
- Shorts are **not** written here — `shorts-writer` owns `videos/<slug>/shorts/`.
