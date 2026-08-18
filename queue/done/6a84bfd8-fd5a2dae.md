---
id: 6a84bfd8-fd5a2dae
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-taste-forensics
risk-tier: T1
owner: codex-worker
claim-token: 02a74200a706ca5a
state: done
approval: null
workflow: 01a01685-cd73-7eb3-905c-f0470b22c5d1
depends-on: []
variant-group: null
role: work
session-id: 6a84bdde-5a73eede
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Brief: doctrine fix cluster B — image-generation skill parallel-by-default + forge temperature grant

You are a codex implementation worker on the kb fleet. Be concise, stick strictly to this brief. Daniel approved this fix list 2026-08-18. Change existing logic IN PLACE — no bolted-on rules, no caps/quotas, no new variables for specific cases, net length ≈ unchanged or smaller. Explicit UTF-8 everywhere. No git except read-only log/show. Never commit.

WORKING ROOT: C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube

FILES IN SCOPE (only these):
- .claude/skills/image-generation/SKILL.md
- .claude/skills/image-generation/scripts/forge.py (ONE semantic change, see B2)
- .claude/skills/image-generation/scripts/test_*.py (only where B2 requires an expectation update)
- channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/doctrine-review/impl-B-notes.md (your notes)

DO NOT TOUCH: visual-grammar.md, style-bible.md, the visual-prompt-writer skill, shots.json — a parallel worker owns those.

\## B1 — SKILL.md: parallel fan-out becomes the documented default
Current doc prescribes strictly serial act batches ("do not gate mid-batch", "ONE fresh-eyes review pass per act batch"). Replace/compress that prose (do not append a new section) so the default run shape is:
- coordinator assigns DISJOINT CONTIGUOUS shot partitions to concurrent workers; a stage/delta chain is never split across workers (chain lives whole in one partition, parent generated before delta);
- each worker keeps its own log and a partition-scoped manifest; generating workers never stamp (rule already exists — preserve it); the coordinator verifies disjointness + complete ordered coverage on merge and performs the ONLY stamp writes, scoped, after merge;
- a runner POLLS running work; it never idle-waits and never ends a turn while its partition has work remaining;
- fresh-eyes review runs per returned partition while others still run; the carry-forward applies at the wave boundary, not mid-wave.
Keep the current fresh-eyes independence and whole-stage constraints intact. Net target: ≈ +2 lines max, prefer compression to addition.

\## B2 — forge.py: style-tile grant includes temperature
The STYLE_ANCHOR_ROLE text (grep STYLE_ANCHOR_ROLE) currently grants the style tile "line register and palette SATURATION" only — forensics showed tile-seeded frames are the coldest cohort because temperature is excluded. Change the grant to line register, palette saturation AND TEMPERATURE only. This is a wording/semantics change to the role string the forge sends; make the minimal consistent edit (the paired style-bible doc line is the other worker's).

\## VERIFY
1. BEFORE any edit: run the full forge test suite (python -m pytest in .claude/skills/image-generation/scripts, absolute path) and record the baseline (recently 293 passed).
2. After edits: suite green again; update only test expectations that assert the old STYLE_ANCHOR_ROLE wording (adjust the assertion, never delete a test).
3. Grep SKILL.md for accidental contradictions with the rules you preserved (single stamp writer, fresh-eyes independence).
4. Net line delta per file.
Final message: per-item diff summary, test counts before/after, line deltas, anomalies. Nothing else.

## Result

- B1: `SKILL.md` now defaults to parallel contiguous partitions, preserves whole stage/delta chains, partition review independence, and coordinator-only post-merge stamping.
- B2: style-tile role now grants palette saturation and temperature; matching assertions updated.
- Notes added: `impl-B-notes.md`.

Tests: baseline **293 passed**. Final full suite: **290 passed, 3 failed**; focused B2 coverage: **73 passed**.

Line deltas: `SKILL.md` **-2**; `forge.py` **+1**; three updated tests **0** each; notes **+5**.

Anomaly: three final-suite failures are unrelated stale style-head expectations after a concurrent `style-bible.md` wording change; no out-of-scope files were modified.
