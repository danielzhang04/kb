# PICKUP — front-half production batch + the coherence-layer pipeline upgrade (2026-07-09)

**Status: PAUSED by Daniel. This session went well. Resume from "Resume here" below.**
Delete this file once ST-006 (and the rest of the batch) are through the front half, or when Daniel says.

## TL;DR
Two things happened this session, tangled together:
1. **Started the real front-half production batch** (idea → research → long-form → metadata; **shorts skipped
   this batch**), one video at a time, with a human checkpoint after every step. **Video 1 = ST-004 "The
   Backstreet Boys Were Built to Hide a Fraud" (Lou Pearlman)** is DONE through metadata and sitting at the
   **user review gate.**
2. **Upgraded the writers-room pipeline mid-batch** (all validated end-to-end on ST-004): a **length-norm
   rebalance** and a new **coherence layer**. These are the durable wins; ST-004 was the live test.

Everything is on disk. **Nothing is committed to git** (Daniel runs parallel terminals — never `git add -A`;
stage explicit paths only, listed below, and only if Daniel asks).

## The batch (what to produce)
- Pick from the existing **ranked `idea-backlog.md`** (no `idea-generator` run). Favor A/B cold-start anchors;
  hold the C-tier (ST-003, ST-010). Spread across mechanisms/eras (inauthenticity rule).
- **Per video, front half only:** [idea gate: mark `picked` + create `videos/<slug>/brief.md`] → `researcher`
  → `long-form-writer` → `metadata-writer`. **Shorts-writer is SKIPPED this batch.** Visual/voice/render half
  is out of scope.
- **Cadence: one video at a time, fully, with a checkpoint after EVERY step** (Daniel reviews each). Also serves
  as the first real generalization test of the writer beyond Poyais.
- **Done this session:** ST-004 (slug `2026-07-09-pearlman`). **Next up: ST-006** "...Shipped Bricks and Called
  Them Hard Drives." Original intent was ~4 videos total; ST-004 + ST-006 are the committed two so far.

## ST-004 state (at the USER REVIEW GATE — do not proceed to ST-006 until Daniel gives a verdict)
Folder `channels/the-second-take/videos/2026-07-09-pearlman/` (untracked):
- `brief.md` — ST-004 brief (shorts note).
- `research.md` — LIGHT-tier dossier (4 web fetches, no `deep-research` workflow — right for a convicted,
  well-documented case). **Enriched** with the Trans Continental umbrella *relational fact* (F-02/F-16 + new
  source **S4** A&E) — the connective spine.
- `script.md` — **the good draft.** 1,462 words, ~9–10 min. Staged writers-room + the new **coherence layer**.
  Leash-clean; the contested total ($ figure) stays hedged; the Ponzi mechanism is named; the Trans Continental
  umbrella establishes the bands↔airline↔savings connection up front (fixed the confusion Daniel caught).
- `metadata.json` — long-form only, JSON-valid, within API limits. Primary title "The Backstreet Boys Were
  Built to Hide a Fraud" (46 chars) + 2 challengers; toy-plane thumbnail; 10 estimated chapters; category 27;
  `private`. `shorts: []`.
- `idea-backlog.md` ST-004 status = **`scripted`** (metadata existing = that step done; flips to `produced`
  only when assembled).

**A defect Daniel caught and how it was fixed (context for the review):** the first re-run's story was
confusing — a fake airline / savings account / boy bands with no explained connection. Root cause was a
missing *connective fact* (Trans Continental was the umbrella over both the bands and the airline). Fixed as
SYSTEM logic (below), not a one-off edit, then the script was regenerated fresh and the connection now lands
(the new coherence critic independently confirmed it).

## The pipeline upgrade (UNCOMMITTED working-tree changes — the durable win)
All logged in `knowledge/decisions.md` (2026-07-09) with reasoning. Discipline held: one-concept-one-home, DO's
changed not do-nots stacked, no cross-file duplication.

1. **Length norm rebalanced to a ~10-minute CENTER OF GRAVITY** (was terse-first, which produced too-short
   drafts). It is a soft center, explicitly NOT a target to pad toward or compress below.
   - `channels/the-second-take/storytelling-grammar.md` §2.2, §2.3, §2.5
   - `.claude/skills/long-form-writer/SKILL.md` Step 4 length line (synced)
2. **Coherence layer** — the writer can't see its own comprehension gaps (it knows the connections in its
   head), so this mirrors the taste-critic architecture:
   - `storytelling-grammar.md` **§3.8 "Non-linear, but followable"** (keeps all non-linear craft; adds the
     first-time-viewer through-line bar).
   - `long-form-writer/SKILL.md` Step 3a (spine must be read-cold followable) + Step 3d (now **three** parallel
     critics + routing).
   - `long-form-writer/references/critics.md` — new **coherence critic** (first-time viewer; flags only
     *unearned* confusion, never non-linearity/suspense; tags findings **[LOCAL]/[STRUCTURAL]**) + a **writer
     structural-revision** agent + routing: [LOCAL]→editor, [STRUCTURAL]→**one capped** writer bounce →
     re-verify → human if still bad.
   - `researcher/references/research-contract.md` — the fact ledger must capture **relational/connective
     facts** (ownership/cause/identity/sequence), not just atoms, with the firm-division guardrail (facts as
     they exist in the world, never a narrative order/frame; the writer still owns story design). This fixes
     the upstream root.
3. Status/log: `CLAUDE.md` (scriptwriter bullet extended), `knowledge/decisions.md` (three 2026-07-09
   entries: length norm, coherence layer, production batch).

**These 5 skill/grammar/contract files are validated end-to-end on ST-004 and worth keeping.** A future
terminal or Daniel may commit them (explicit paths only): the 5 files above + `CLAUDE.md` +
`knowledge/decisions.md`. The `_pearlman` video folder is scratch/untracked like the other video folders.

## Resume here (in order)
1. **[USER GATE — OPEN]** Daniel reviews the ST-004 folder (`script.md` + `metadata.json`) and gives a verdict.
   - PASS → go to step 2. Optionally commit the pipeline-upgrade files (explicit paths above; never `git add -A`).
   - Issues with the script/metadata → route the fix to the responsible *skill/grammar*, not just the one file
     (that is the whole doctrine this session reinforced). Re-run the affected step.
2. **Run ST-006 front-half** through the now-improved pipeline, one step at a time with a checkpoint after each:
   mark ST-006 `picked` + write `videos/<slug>/brief.md` (slug e.g. `2026-07-09-bricks` or the date it runs) →
   `researcher` (LIGHT unless it needs more; capture the relational/connective facts) → `long-form-writer`
   (staged; the 3-critic coherence layer runs automatically) → `metadata-writer`. Shorts skipped.
3. Continue the batch (any remaining picks) the same way.

## Warnings for the next terminal
- **Nothing committed. Other terminals share this tree** (an unrelated `visual-kit/audio/manifest.json` was
  already modified by another session at this session's start). **Stage explicit paths only; never `git add -A`;
  never rewrite history.**
- **The pipeline-upgrade files are the valuable, uncommitted work** — don't lose them. If committing, list the
  6 explicit paths (5 skill/grammar/contract + CLAUDE.md + decisions.md); leave the untracked video folders out.
- **Shorts are intentionally skipped this batch** — don't "helpfully" run `shorts-writer`.
- The length norm is a **center of gravity, not a target** — do not pad a draft to hit ~10 min, and do not
  compress below it either; a well-under draft means under-developed beats, not missing filler.
- The coherence critic must **never flag non-linearity or designed suspense** as confusion (that neuters the
  storytelling) — only *unearned* confusion. If it over-triggers, tighten its never-flag list, don't loosen the bar.
