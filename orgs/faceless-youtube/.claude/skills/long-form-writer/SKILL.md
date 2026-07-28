---
name: long-form-writer
description: Writes the long-form voiceover script for a picked (and, on research channels, researched) video. Use to script/write/draft a long-form video or run the long-form scripting step — any niche. Reads the picked brief + research.md (if present) + dna.md + storytelling-grammar; writes script.md as pure voiceover prose. Runs after researcher/idea gate, before shorts, metadata, visuals, voiceover. Do NOT use it for shorts, ideas, research, or metadata.
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
  `channels/<name>/example-scripts.md` (the approved excerpts: the voice bar) where the channel has one.
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
   design the retention arc now (grammar §2.6). Set the humor register off `dna.md`'s dial, and gather
   the video's **cultural material** here, because it belongs to the writer and never to the researcher:
   the era anchors (what does everyone picture when they hear 1983?), the candidate modern comparisons,
   and the joke angles the story invites. On a company story, gather what the **rise beat** needs while
   you are here (grammar §2.7): how big they got, who they sold to, and the modern company their peak
   revenue can be measured against, so the climb is on hand before the fall is written. **WebSearch is
   licensed at this step**, for era texture and for
   checking that a reference is universally understood (the bar: a general viewer pictures it instantly;
   the approved excerpts in `channels/<name>/example-scripts.md` are the calibration). Anything the
   script then states as fact still lives on the leash.
3. **The spine.** 8–14 beats in plain English, one line each, no `[F-NN]` tags, no jargon; note beside
   each which facts are on hand and which era anchor, comparison, or joke angle that beat carries. Read
   it back cold for followability (grammar §3.7) and fix by resequencing, never a bolted-on patch. For a major scheme sequence, a compact planning card:
   `question → sourced action/mechanism → narrator angle → what it enables → next question`; a spoken
   `Step N` only per grammar §1.5. **Lock the spine before drafting.**

### 3b — Story pass: casual, ledger set aside

Draft the whole script to the spine in the channel's voice (grammar §1 + the approved excerpts), as
if telling it out loud. Write to the *story*, not fact-coverage. No fact-checking here — checking
mid-draft is what flattens the voice.

### 3c — Leash pass: now check every claim

Trace every factual claim to its `[F-NN]`. **The narration never hedges** (grammar §4): a claim goes in
as the strongest version the ledger supports, stated flat, or it comes out. Contested and `Conf: low`
facts are resolved *here, in selection*, never by softening the voiceover, and "by one account,"
"sources disagree," and "reportedly" never reach the audio. Where the record genuinely cannot answer a
*why* the story needs, the fix is the narrator's transparent speculation ("Don't ask me why. Maybe…"),
not a confession about sourcing. Date-sensitive mechanics carry their "as of <year>".

The casual draft stays the voice source of truth: make the **smallest local factual correction** and
preserve sentence order, block structure, conversational joints, repetitions, slang, comic rhythm, and
narrator presence. A claim that can't be fixed locally gets flagged to the writer, never laundered into
documentary exposition. Optional inline `<!--F-NN-->` traces are allowed; **strip every one before
final output.**

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

## Step 4 — Shape & header (every mode)

The craft lives in the grammar — apply it, don't re-derive it. The execution contract:

- **`script.md` is pure voiceover prose:** the words the narrator says, in paragraphs, and nothing
  else. No pause or beat cues, no visual anchors, no stage directions, no bracketed markup of any
  kind. Default sentence gaps are the render engine's; a deliberate pause is `audio-director`'s call;
  visual segmentation belongs to `visual-prompt-writer`, which reads the prose. Pacing inside the
  script is punctuation (new sentence/colon = cut-in; ellipsis = held beat; comma = catch); never an
  em/en dash. Paragraphs are idea blocks, not one-line drops (grammar §1.1).
- **Runtime header:** **`Estimated runtime: MM:SS` is REQUIRED, never `TBD`** — words ÷ the **channel
  voice's measured wpm** from `dna.md` (fallback 150). That rate is gross, so it already embeds the
  narrator's natural pausing; nothing is added on top. `lint_script.py --wpm <N>` prints the exact
  string to paste and hard-fails without it. Header `Target length` is the channel norm (grammar §2.3)
  — 8–10 min for this channel via `dna.md` — not the brief's aspirational band.
- **Sources:** on research channels, the `[S#]` entries actually used go at the bottom of `script.md`.
- **Policy gate:** apply the niche policy gate where one exists (business-money **defamation
  discipline** per grammar §4; micro-health ≥2 sources; engineering analysis-not-gore; AI-disclosure
  line where required).

## Step 5 — Status + handoff

Set the idea to **`scripted`** in `idea-backlog.md` (preserve everything else). The folder is ready
for `shorts-writer` and, in parallel, `metadata-writer` → `visual-prompt-writer` → `voiceover` →
`render-builder`.

## Output to the user

Short: the folder path, title + estimated runtime, the mode used, and — on research channels — a
one-line leash note (any claim cut for lack of a source). `script.md` is the source of truth.

## Output contract (what downstream reads)

- `videos/<slug>/script.md` — header (source idea ID, target length, voice, **`Estimated runtime:
  MM:SS`**) + the voiceover prose + Sources on gated niches. No cues, no brackets, no timestamps, no
  `<!--F-NN-->` traces or outline comments: everything below the header is speakable. Downstream
  stages that still expect authored cues are recorded debt in `knowledge/decisions.md` and
  `docs/STATUS.md`, not a reason to write them here.
- `videos/<slug>/brief.md` — the copied idea brief.
- Shorts are **not** written here — `shorts-writer` owns `videos/<slug>/shorts/`.
