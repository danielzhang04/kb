---
id: 6a7cbfdd-a5b0e342
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: ca7e0f490fab4178
state: done
approval: null
workflow: 019ff748-b0c6-78a0-ade8-1dfd771b31d5
depends-on: []
variant-group: null
role: work
session-id: 6a7cbea1-f1a146da
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Task C12 — run_item: staging discipline through forge's own primitives

Arc worktree is your cwd, branch `claude/codex-image-engine`, HEAD 359470b. Implementer for
Task C12 — high-stakes: this is the single-writer staging seam; a defect here lets two
runners corrupt each other's frames. Plan:
`orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-codex-image-engine.md` lines
3207–3419 — READ THE RANGE FIRST. Verbatim tests + implementation; TDD red-then-green,
paste real outputs.

Scope:
- Modify `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py`
- Modify `orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py`
- Append Task C12 report to
  `.superpowers/sdd/2026-08-11-codex-image-engine/task-C12-report.md` (gitignored).

Rules: NO edits to `_fake_codex.py`, `forge.py` (zero-diff law — you CONSUME its staging
primitives, never reimplement or patch them), `measure.py`, plan, spec. NO codex calls, NO
network, NO commit/push.

Verified drift (adapt silently, don't count as deviation):
- Plan's `== 67 passed ==` is STALE: suite is at 81; expect 87 after your 6 tests.
- The forge import surface ALREADY includes `_reserve_staging_output`,
  `_publish_staging_png`, `_release_staging_lock`, `_staging_png`, `_existing_staging_png`
  (forge_codex.py:31-34; AST pin at test:387+). NO pin growth should be needed — if you
  find you need a symbol the pin lacks, STOP and report BLOCKED.
- Test helpers `make_kit` (test:362), `_item_L29` (test:728), `_png` (test:888),
  `fake_prefix` exist — use them as the plan's tests do.
- The plan's `from dataclasses import dataclass, field` imports `field` unused — import
  only what you use.

Anything else contradicting the plan: adapt minimally + flag; unresolvable → BLOCKED.

Acceptance criteria:
1. Genuine red run (missing `RunOptions`); paste tail.
2. Plan's 6 tests verbatim (modulo drift above); implementation per plan (`RunOptions`
   dataclass, `run_item` with the exact compose→reserve→reverify→generate→validate→
   publish→log ordering, lock released in finally, SKIP/DRY/ERR/OK statuses).
3. Full suite green: 87 (paste tail).
4. `git diff --stat` — exactly the two named files.
5. Entropy scan `grep -noE "[A-Za-z0-9+/_-]{120,}"` (or rg equivalent) on both changed
   files: zero hits.
6. forge.py zero diff.

Final message: line 1 `C12 DONE` or `C12 BLOCKED: <why>`; red tail, green tail, diff stat,
deviations.

## Result

C12 DONE

Red tail:

```text
status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
              ^^^^^^^^^^^
AttributeError: module 'forge_codex' has no attribute 'run_item'
```

Green tail:

```text
ok  test_run_item_respects_a_concurrent_lock
ok  test_run_item_skips_an_existing_survivor_without_a_subprocess
...
== 87 passed ==
```

Diff stat:

```text
.../scripts/forge_codex.py      | 65 +++++++++++++++
.../scripts/test_forge_codex.py | 92 ++++++++++++++++++++++
2 files changed, 157 insertions(+)
```

- Entropy scan: zero hits.
- `forge.py`: zero diff.
- `git diff --check`: clean.
- No commit, push, network, or Codex calls.
- Report: [task-C12-report.md](C:/Users/danie/kb-worktrees/boss-codex-image-engine/.superpowers/sdd/2026-08-11-codex-image-engine/task-C12-report.md)

Deviation: the plan predicted missing `RunOptions`, but Python resolves `fc.run_item` before evaluating its arguments, so the genuine red necessarily reported missing `run_item`. The report records this discrepancy; no placeholder was used to manufacture the expected error.
