---
id: 6a6c3b2d-ed1a8e0e
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb\orgs\faceless-youtube\channels\the-second-take
risk-tier: T1
owner: codex-worker
claim-token: 4597065556d97394
state: done
approval: null
workflow: 019fb6ae-12b1-7a70-8c70-6b7f07dffe13
depends-on: []
variant-group: null
role: work
session-id: 6a6c34ba-2604d5fb
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task: tranche-A gen leg 1 — STEP-1 figures + place plates ONLY. Staged, logged, no composites.

You are a codex worker for the kb fleet. Cold start; this brief is all you know.

\## Spend authorization

Daniel (2026-07-31): "I want to run the pipeline on let's say 1/5th of the remainder. Build an
artifact for review. If good, I'll release the other 4/5." Tranche-A cap $5.86; $0.54 already
spent upstream. This leg's budget: 11 STEP-1 figure gens (1K tier, $0.039 each) + 20 place-plate
gens (2K, $0.134 each) ≈ **$3.11 hard cap**. Generate each item ONCE. NO retries — a defective
frame gets FLAGGED in the log and left in staging (retry is a human/boss call, not yours).

\## Context

Channel: `orgs/faceless-youtube/channels/the-second-take` (= your cwd). Video:
`videos/2026-07-28-bricks-fresh`. Repair-wave tranche A = 27 shots (listed in
`videos/2026-07-28-bricks-fresh/scratchpad/tranche-a.json`). shots.json was re-authored and passes
the seeding law for all 27 ids. The qt-wiles canonical at `visual-kit/refs/qt-wiles/qt-wiles.png`
was re-minted TODAY (businessman) and is current — every qt-wiles STEP-1 figure seeds it fresh.

\## Read first

1. `../../.claude/skills/image-generation/SKILL.md` — the governing skill: two-step recipe (STEP-1
   figure isolation), plate law (`plate: true` runs unseeded, candidate batch, human-picked),
   attribute routing, §3 rig checklist, staging conventions. FOLLOW ITS COMMAND SHAPES — batch
   specs come from `forge.py batch`, never hand-rolled.
2. `visual-kit/style-bible.md` §2–§5 (descriptors, rig-hold, crowd clause, seed recipe).
3. `videos/2026-07-28-bricks-fresh/scratchpad/tranche-a.json` — the tranche definition.

\## Do

1. Derive the batch spec at $0:
   `py -3 "C:/Users/danie/kb/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py" batch --kit visual-kit --batch videos/2026-07-28-bricks-fresh/shots.json --shots L26,L27,L28,L49,L50,L60,L61,L62,L66,L67,L68,L78,L91,L100,L101,L107,L108,L109,L160,L161,L162,L183,L184,L190,L191,L205,L215 --out videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-spec.json`
2. From that spec execute ONLY:
   a. All STEP-1 figure gens (expect 11, 1K tier).
   b. The plate gens for the tranche's 12 PLACE-FIRST shots:
      - Recurring (2 candidates each, per the skill's plate-candidate flow, staged with candidate
        suffixes): L26, L49, L66, L100, L107, L160, L183, L190.
      - Standalone (1 gen each): L78, L91, L205, L215.
3. Do NOT generate composites/delta/scene gens (they wait on the human's plate picks). Do NOT
   register anything, do NOT touch manifests or refs/. Everything lands in `visual-kit/_staging/`.
4. After EVERY gen, append a row to
   `videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-genlog.md` (create it, one line per gen:
   name, tier, cost, seeds used, §3 rig verdict where a figure is present, defect flag + reason if
   any). Write incrementally — this log must survive even if you die mid-run.
5. §3-check every figure-bearing output against the qt-wiles/brick-foreman/etc canonical it seeds.
   Flag, never retry.

\## Report (final message)

Totals (gens, $), the log path, any flags, and `git status --short` scoped to what you changed
(expect: the spec json + genlog under scratchpad/, staged PNGs are gitignored).

## Result

Stopped safely after persistent generator failures.

- 9 STEP‑1 requests issued: $0.351 reserved; 6 PNGs landed ($0.234).
- 0 place plates generated; no composites, manifests, or refs were touched.
- Log: [tranche-a-genlog.md](C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-genlog.md)
- Spec: [tranche-a-spec.json](C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-spec.json)

Flags: Terry and the foreman hold-both-hands frames violate no-props isolation; three later STEP‑1 requests returned no PNG (two timeouts, one empty worker exit). No retries were issued.

Scoped `git status --short`:

```text
?? videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-genlog.md
?? videos/2026-07-28-bricks-fresh/scratchpad/tranche-a-spec.json
```
