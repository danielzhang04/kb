# Blind-generation comparison — plan (2026-07-29)

**Goal:** measure what the production scripting pipeline generates for the bricks story with ZERO
access to bricks exemplars or verdicts, compare two blind samples against the accepted round-4
script through every codified lens, and land generalized (never bricks-specific) doctrine fixes.

**Success condition:** two uncontaminated blind scripts; a lens-based defect inventory that
separates systematic gaps (present in both samples) from variance (one sample); Daniel's checkpoint
on the findings list; then slim, replace-first edits to the pipeline files that do not remove
functionality he likes.

**Why two runs of the SAME pipeline (staged + critics + humanizer), not two variants:** the target
is "what does the production path produce blind" — two samples make twice-occurring defects read as
systematic doctrine gaps and once-occurring ones read as sampling variance. Deliberately different
variants would confound that attribution.

**Ground truth:** `channels/the-second-take/videos/2026-07-28-bricks-fresh/script.md` (accepted
2026-07-29, commit 0a2cce5, 1,632 words / 9:20).

## Contamination control (the heart of the design)

The doctrine files quote the approved bricks script throughout; a blind writer following those
quotes would reproduce the target. Therefore the blind runs use SANITIZED EXPERIMENT COPIES
(scratchpad only, marked, never merged): laws verbatim, bricks-derived quotes replaced with Poyais
equivalents or neutral Salad-Oil (1963) illustrations, or dropped. Zero-leakage verified by grep
(MiniScribe, brick, Wiles, Colorado, Coopers, TSA, masonry, 26,000, …).

Blind conductors get ONLY: sanitized grammar/critics/example-scripts (scratchpad paths), SKILL.md,
lint, `dna.md`, and copies of `research.md` + `brief.md` in their own scratch folders
(`videos/2026-07-29-bricks-blind-a/`, `-b/`). Explicit do-not-read list: the `2026-07-28-bricks-fresh/`
folder, every `verdict.*`/`script.*` from prior rounds, original grammar/critics/example-scripts,
`knowledge/decisions.md`, `docs/STATUS.md`, `idea-backlog.md`. `research.md` stays in scope: it is
the story input, not exemplar prose. No `verdict.rN.md` in the scratch folders, so SKILL Step 0.4
regen mode does not trigger.

## Phases

0. **Setup.** Commit accepted script (done: 0a2cce5). Opus sanitizer builds the three BLIND copies
   with grep evidence. Sonnet compiles `lens-battery.md` from grammar §1–6, critic hunt/never-flag
   lists, example-scripts notes, decisions r1–r4, verdict sheet, dna. Boss grades both.
1. **Two blind runs, parallel.** Two independent Opus conductors, identical briefs except folder,
   no shared state, full staged pipeline with all subagents on opus, incremental disk writes, no git.
2. **Comparison.** Fresh Opus comparator scores A, B, and the ideal against the lens battery,
   flagging per finding: which sample(s), systematic-vs-variance, and anything the blind runs did
   BETTER than the ideal (protected: "don't remove functionality we DO like"). Boss adds an
   independent read (four rounds of Daniel's taste calls in context). Boss synthesizes the
   generalized findings + proposed edit map (which file, which §, replace-what).
3. **CHECKPOINT with Daniel:** findings + edit map + open questions. No doctrine edits before it.
4. **Edit wave (post-approval).** Opus doctrine worker(s), replace-first, stable § numbers, line
   caps as caps-with-priority, learnings routed to their owning files (grammar = craft law,
   critics = enforcement, SKILL = process, playbook/dna only if policy/channel-data). Includes the
   deferred arc-close item: bank accepted round-4 bricks blocks into `example-scripts.md`.
   Then: fresh-agent probe, boss dedup/consistency grade, commit, sweep scratch folders + BLIND
   copies + r4 work files (cleanup gate with Daniel for r1–r3 archives).

## Housekeeping riding on this arc

- Handoff `handoffs/2026-07-29-fyt-scripting-r4.md` deleted on ops (picked up this session).
- Boss lessons appended to `memory/claude-boss.md` (ops) at session close.
- Worktree `fyt-writer-r2` + branch `claude/fyt-writer-grammar-slim` remain; merge is Daniel's.
