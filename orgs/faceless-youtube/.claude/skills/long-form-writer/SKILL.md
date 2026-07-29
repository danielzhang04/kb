---
name: long-form-writer
description: Writes the long-form voiceover script for a picked (and, on research channels, researched) video. Use to script/write/draft a long-form video or run the long-form scripting step — any niche. Reads the picked brief + research.md (if present) + dna.md + storytelling-grammar; writes script.md as pure voiceover prose. Runs after researcher/idea gate, before shorts, metadata, visuals, voiceover. Do NOT use it for shorts, ideas, research, or metadata.
---

# long-form-writer

Turn one picked idea into a **production-ready long-form voiceover script**. One skill for every
channel; the niche is data in `channels/<name>/`, never forked into code. `script.md` is the contract
everything downstream reads: **true** (leashed to the ledger on research channels), carrying the
channel's POV, and sounding like a real person telling a story. **The craft is not here** — voice,
story, structure, and staging live in the channel's `storytelling-grammar.md`; this skill applies it.

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
4. **Regen mode.** A `videos/<slug>/verdict.rN.md` means this run is the **round-(N+1) regen** of a
   script Daniel has already reviewed. Archive the existing `script.md` as `script.rN.md` (never edit
   the archive again), then treat the sheet as a **binding overlay** on the normal flow: its
   **blockquoted lines are Daniel-verbatim, locked deliverables** the writer places and no downstream
   agent rewrites (`references/critics.md`, verdict overlay), and its directives steer the outline at
   3a. **Generalizable lessons must already be in doctrine before the regen runs** — fix the skill,
   never the artifact. If the sheet implies a grammar or critic rule that is not written down yet,
   **stop and surface the doctrine gap** instead of hand-patching this one script.

## Step 1 — Read

- **The idea brief** in `idea-backlog.md`. On the deep path its promises are hypotheses until research
  verifies them.
- **`videos/<slug>/research.md`** — the source of truth for facts; select from it per grammar §2.2 (a
  ceiling, never a floor). Its **Viability verification** block is the canonical story/packaging
  contract — its supported or revised stake, mechanism, payload, cold open, and titles override
  conflicting brief text; never reuse anything under **Unsupported promises**.
- **`channels/<name>/storytelling-grammar.md`** — the craft law. Read every run, plus
  `channels/<name>/example-scripts.md` (the approved excerpts: absorb them for tone, joke grade, pull
  species, and density; a register, not a quarry). **Where the bar already renders the beat you are
  drafting, its phrasing is the default** (grammar §1 intro).
- **`channels/<name>/dna.md`** — length band, locked lever, narrator persona, humor dial.
- **Policy** (consumed at Step 4): `knowledge/playbook.md` + the policy quirk in
  `knowledge/research/niche-playbooks/<niche>.md`.

## Step 2 — Folder

Ensure `channels/<name>/videos/<YYYY-MM-DD>-<slug>/` exists with `brief.md` (the copied brief) in it.

---

## Step 3 (staged) — the writers-room · `long_form: staged`

### 3a — Outline: story → plot → spine

Top-down and story-first; never build up from fact-clusters (walking the research in order is the
flat-explainer failure).
1. **The story.** In a few sentences: what story would you tell a friend, which events earn a place?
2. **The plot.** Sequence to land hardest, not by the calendar — choose the shape from grammar §3 and
   design the retention arc now (grammar §2.6). Set the humor register off `dna.md`'s dial, and gather
   the video's **cultural material** here, because it belongs to the writer and never to the researcher:
   the era anchors (what does everyone picture when they hear 1983?), the candidate modern comparisons,
   which skew heavily to named cultural references (grammar §1.4), and the joke angles the story
   invites. On a company story, gather what the **rise beat** needs (grammar §2.7): how big they got,
   who they sold to, and the modern company their peak revenue measures against, so the climb is on
   hand before the fall is written, told once and never re-climbed. **WebSearch is licensed here**, for
   era texture and for checking a reference is universally understood; anything stated as fact still
   lives on the leash.
3. **The spine.** 8–14 beats in plain English, one line each, no `[F-NN]` tags, no jargon; note beside
   each which facts are on hand and which era anchor, comparison, or joke angle that beat carries. For
   the title scheme, plan it on a card in **grammar §3.2's staged order**:
   `pressure → the corner they are in → the decision as a moment → the act with its audacious detail →
   "how did nobody notice?" → the mechanism as the punchline → escalation`; a spoken `Step N` only per
   grammar §1.5. **Then read the spine back cold and gate it:** (a) every mechanism beat sits AFTER the
   act it explains, (b) the climb is told once (§2.7), (c) scale lands inside the first third (§2.2),
   (d) a first-time viewer can follow the causal through-line (§3.7). A spine failing any check is
   resequenced now, never patched with a bolted-on beat. **Lock the spine before drafting.**

**On a regen** (Step 0.4), the sheet's directives are inputs to the plot and spine alongside the grammar;
every locked line gets a home in the spine, goes in verbatim at 3b, and passes through 3c–3e untouched.

### 3b — Story pass: casual, ledger set aside

Draft **act by act** (the acts fall out of the spine: the setup, the scheme, the unraveling, two to four
of them). Before each act, re-read `example-scripts.md` to re-tune the ear, then write that act to the
spine in the channel's voice (grammar §1), telling it out loud. Write to the *story*, not fact-coverage;
no fact-checking here, since checking mid-draft is what flattens the voice. The register decays over one
long pass, and the re-read between acts is what holds the back half at the front half's level.

### 3c — Leash pass: now check every claim

Trace every factual claim to its `[F-NN]`. **The narration never hedges** (grammar §4): a claim goes in
as the strongest version the ledger supports, stated flat, or it comes out. Contested facts, `Conf: low`
facts, and ledger ranges are resolved *here, in selection* (a range becomes one flat number), never by
softening the voiceover; "by one account," "sources disagree," and "reportedly" never reach the audio. Where the record cannot answer a *why* the
story needs, the fix is the narrator's transparent speculation ("Don't ask me why. Maybe…"), not a
confession about sourcing. Date-sensitive mechanics carry their "as of <year>".

The casual draft stays the voice source of truth: make the **smallest local factual correction** and
preserve sentence order, block structure, conversational joints, repetitions, slang, comic rhythm, and
narrator presence. A claim that can't be fixed locally gets flagged to the writer, never laundered into
exposition. Inline `<!--F-NN-->` traces are optional; **strip every one before final output.**

### 3d — Critics + humanize (`references/critics.md`)

Fresh, single-mandate agents — the writer can't catch its own taste flaws. Run exactly per
`critics.md`: mechanical lint (`scripts/lint_script.py`), four parallel flag-only critics (taste,
leash, coherence, raw-versus-leashed), one editor applying line fixes in voice, at most one structural
writer bounce, then the **`humanizer` skill as the closing pass** (keep its edits), re-lint. On a
regen, every agent (humanizer included) gets the verdict overlay: locked lines are preserved, never
rewritten. Still confusing after the bounce → surface to the human.

### 3e — Accept

The editor's revision is the working draft. Settle any unresolved taste-vs-leash conflict (keep the
fact); on a regen, confirm every locked verdict line survived verbatim. Then Step 4.

**Step 3 (single) · `long_form: single`** — one disciplined pass with the same voice and spine
discipline, leash-check if a `research.md` exists, run the `humanizer` skill, then Step 4.

---

## Step 4 — Shape & header (every mode)

The craft lives in the grammar — apply it, don't re-derive it. The execution contract:
- **`script.md` is pure voiceover prose:** the words the narrator says, in paragraphs, and nothing
  else. No pause or beat cues, no visual anchors, no stage directions, no bracketed markup. Default
  sentence gaps are the render engine's; a deliberate pause is `audio-director`'s call; visual
  segmentation belongs to `visual-prompt-writer`, which reads the prose. Pacing inside the script is
  punctuation (new sentence/colon = cut-in; ellipsis = held beat; comma = catch), never an em/en dash.
  Paragraphs are idea blocks, not one-line drops (grammar §1.1).
- **Runtime header:** **`Estimated runtime: MM:SS` is REQUIRED, never `TBD`** — words ÷ the **channel
  voice's measured wpm** from `dna.md` (fallback 150), a gross rate that already embeds the narrator's
  pausing. `lint_script.py --wpm <N>` prints the exact string to paste and hard-fails without it.
  Header `Target length` is the channel norm (grammar §2.3), not the brief's aspirational band.
- **Sources:** on research channels, the `[S#]` entries actually used go at the bottom of `script.md`.
- **Policy gate:** apply the niche policy gate where one exists (business-money **defamation
  discipline** per grammar §4; micro-health ≥2 sources; engineering analysis-not-gore; AI-disclosure).

## Step 5 — Status + handoff

Set the idea to **`scripted`** in `idea-backlog.md` (preserve everything else). The folder is ready for
`shorts-writer` and, in parallel, `metadata-writer` → `visual-prompt-writer` → `voiceover` → `render-builder`.

## Output to the user

Short: the folder path, title + estimated runtime, the mode used (name the round on a regen), and on
research channels a one-line leash note (any claim cut for lack of a source).

## Output contract (what downstream reads)

- `videos/<slug>/script.md` — header (source idea ID, target length, voice, **`Estimated runtime:
  MM:SS`**) + the voiceover prose + Sources on gated niches. No cues, no brackets, no timestamps, no
  `<!--F-NN-->` traces or outline comments: everything below the header is speakable. Downstream stages
  that still expect authored cues are recorded debt, not a reason to write them here.
- `videos/<slug>/script.rN.md` — on a regen, the archived prior round, never edited afterward.
- `videos/<slug>/brief.md` — the copied idea brief. Shorts are **not** written here; `shorts-writer`
  owns `videos/<slug>/shorts/`.
