---
id: 6a86aafa-7afceb9a
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube
risk-tier: T1
owner: codex-worker
claim-token: 8c7d30a36dc0729e
state: done
approval: null
workflow: 01a01e06-0378-7761-b4d8-1ea2d91b251d
depends-on: []
variant-group: null
role: work
session-id: 6a86a973-5dbdad9c
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Brief: doctrine drift ledger — every change since poyais-final, forward walk, burden-of-proof classification

You are a codex forensics worker on the kb fleet. READ-ONLY except your report. Read-only git REQUIRED. No network. UTF-8.

WORKING ROOT: C:/Users/danie/kb-clones/bricks-arc/orgs/faceless-youtube

\## Owner's framing (binding)
"When we were at the end of poyais, literally it was really good, with some problems that I wanted to fix. Since then, I feel like it's just gotten more troublesome." Every doctrine change since poyais-final therefore carries the burden of proof. Also binding: "adding features, or adding hyper-specific parameters to prompting, just potentially fucks it up more."

\## Task
Walk FORWARD from the poyais-final state (~2026-07-18/20; identify the anchor sha) to HEAD, commit by commit, over the doctrine stack: .claude/skills/visual-prompt-writer/** , .claude/skills/image-generation/** (SKILL.md + forge/stamp prompt-assembly code paths; skip pure test churn), channels/the-second-take/visual-kit/** , channels/the-second-take/example-shots.md.

For EVERY substantive change (batch trivially-related hunks): a ledger row —
- sha, date, file(s), one-line what-changed (load-bearing phrase before → after)
- TRIGGER: what prompted it (commit msg, handoff, run failure, Daniel feedback — cite; "unknown" is a valid honest answer)
- CLASS: evidence-backed-fix (a named failure it fixed, which stayed fixed) / speculative-addition (no failure named) / hyper-specific-parameter (narrow-case rule, cap, quota, phrase-level fence) / contradiction-patch (added to override other doctrine text instead of editing it) / churn (later reverted or superseded — name where)
- OUTCOME: did later evidence validate it, indict it, or is it untested?

\## Synthesis
- Counts per class per file; the churn chains (change → counter-change → counter-counter-change sequences — these are the oscillations the owner wants ended).
- The TROUBLE CURVE: per month, additions vs deletions vs churn — does the record support "more troublesome since poyais"?
- The keep-list: post-poyais changes with genuine validated-fix status (these survive any recut).
- The indicted-list: changes evidence later indicted (these are recut deletions).

OUTPUT → doctrine-recon/drift-ledger.md
Final message: row count, class counts, churn-chain count with the 3 worst named, keep-list size, indicted-list size, one-line trouble-curve verdict. Nothing else.

## Result

- Rows: 65
- Classes: 25 fixes, 6 speculative additions, 11 hyper-specific parameters, 11 contradiction patches, 12 churn
- Churn chains: 3 worst — plate/scale ownership; figure-tier/performer policy; prompt-register/style hardening
- Keep-list: 20 commits
- Indicted-list: 16 commits/clusters
- Trouble curve: supports “more troublesome since Poyais”—August added 30 rules versus 13 contractions, with unresolved churn and no matching visual proof.
