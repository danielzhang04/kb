---
id: 6a8608c7-aadde0fb
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-clones\bricks-arc
risk-tier: T1
owner: codex-worker
claim-token: a6b8adaacd14632b
state: done
approval: null
workflow: 01a01b84-d13b-77f0-be1d-22ba0c18662a
depends-on: []
variant-group: null
role: work
session-id: 6a860550-34cbaf0c
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief: VPW full run — fresh-context critic leg (skill Step 8)

You are a codex FRESH-CONTEXT critic on the kb fleet — you have no authoring context and must not read the authors' notes (scratchpad/vpw2/vpw-log.md, fragments, plan.md are OFF-LIMITS except partitions.json for act ranges). Judge the artifact cold, per the skill's critic role. READ-ONLY except your one report. UTF-8. Read-only git allowed. Never commit.

WORKING ROOT: C:/Users/danie/kb-clones/bricks-arc/orgs/faceless-youtube

JUDGE: channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json (243 shots, fresh full VPW output) against:
- .claude/skills/visual-prompt-writer/references/critics.md — run EVERY critic question over the whole file (plan-level + per-shot sampling: all of L01-L25 shot-by-shot, plus ≥3 random shots per act and every chain base).
- channels/the-second-take/visual-kit/visual-grammar.md + style-bible.md (current doctrine).
- channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-audit/taste-ground-truth.md — Daniel's decoded taste; treat its "still missing majorly" note as the standing failure to guard against: prompts must STAGE the scale gestalt (small figures, deep structured world, air), not assert it in stock phrases.
- Monotony rubric: vantage/depth-shape/palette-temperature/staging-device repetition across the whole 243 (count repeated sentence templates and staging tokens; the last re-pass produced a "clearly smaller"/"receding rows" tic — check whether this file repeats any device into a new tic).
- The five judgment flags from assembly: L112 warehouse-before-disclosure, L132 customer-one-early, L243 9.4s hold, L85 long span, L207/L208 seated supports. Rule on each.

OUTPUT → channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw2/critic-verdict.md (incremental): per-critic-question results, monotony counts, per-flag rulings, defect list {id, defect, severity, exact fix intent}, and VERDICT: SHIP / SHIP-WITH-EDITS (list) / REJECT (why).
Final message: verdict + defect list + monotony counts. Nothing else.

## Result

\## VERDICT: REJECT

Systemic staging monotony reproduces the standing taste failure, affecting well over one-third of the file. L243 also has a blocking 9.4s real hold.

\## Defect list

- `PLAN-01` — BLOCKER: Fractional scale and corridor templates replace genuinely staged scale.
- `PLAN-02` — MAJOR: A4 repeats the courthouse palette sentence ten times.
- `L03` — MAJOR: Pac-Man visual misses the corporate-scam payload.
- `L09` — MODERATE: Lone phone misses the release-craze analogy.
- `L23–L25` — MAJOR: Stray crowd declarations contaminate figureless shots.
- `L35–L40, L43` — MAJOR: Stale chain metadata and late revenue payloads.
- `L76` — MODERATE: Factory frame misses the “What a dick” reaction.
- `L118–L120` — MAJOR: Boxing chain never shows the brick inside the box.
- `L132–L134` — MODERATE: Customer pallet appears implicitly during the wrap delta.
- `L203` — MODERATE: “Signed” ledger contradicts blank/unlettered fields.
- `L207–L208` — MAJOR: Seated support passes, but reversal lands one shot late.
- `L235` — MINOR: Layered-path mechanism leaks into scene prose.
- `L243` — BLOCKER: Static 9.4s final hold must be split or re-anchored.

\## Monotony counts

- Old tics: `clearly smaller` 0; `receding rows` 0; any `reced*` 0.
- `frame height`: 55.
- One-fifth variants: 32; one-quarter variants: 18.
- Any scale-signature wording: 73.
- `aisle`: 52; `lane`: 55; `row`: 57; union: 125/243.
- Table/plinth/pedestal: 78.
- Open-air proxy: 83; depth-architecture proxy: 95.
- Explicit vantage: 22/243; top/high: 15; low angle: 1; wide: 9; close/detail: 0.
- Clear-face template: 64.
- Warm-family wording: 60; cool/cold: 18; `muted`: 53.
- `Courthouse oak, parchment cream…` opener: 10.
- Required delta-close template: 108.
