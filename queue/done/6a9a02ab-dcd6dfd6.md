---
schema-version: 1
id: 6a9a02ab-dcd6dfd6
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p6
risk-tier: T1
owner: codex-worker
claim-token: 401ede3ee02c4375
state: done
approval: null
workflow: 01a06996-86c3-7002-9a17-9e77c181bb9a
depends-on: []
variant-group: null
role: work
session-id: 6a9a01a4-302c8c94
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 14c3e705b004e0f48e723984bf5e4f75314062f3
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p6`
(branch `claude/prospecting-p6`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no output
within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never pip install,
never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/.
Use `--basetemp .pytest-tmp-f5 -p no:cacheprovider`. Stop at 20 minutes. First edit by command 4.
ENV NOTE: sandbox may report py3.12 / deny temp; host is 3.13.7. No PII literals.

\# Fix brief — P6 Task 5 touched FROZEN P1 test file and misplaced a module
1. `scripts/prospecting/tests/test_contracts.py` is a Phase-1 artifact (recorded by hash) — it has been
   restored. The tests Task 5 added to it are saved as a unified diff at
   `scripts/prospecting/tests/.p6-test_contracts.diff` (read it, then delete that file). Port every added
   test into NEW `scripts/prospecting/tests/test_p6_followups.py` (P6-owned), adjusting imports.
2. `scripts/prospecting/campaigner/t1_release.py` is a P6 module inside the frozen P4 package: `git mv` it
   to `scripts/prospecting/approval/followups_t1.py` (keep contents), fix every import (tests, manifest
   artifacts list, `p6_contracts.py` if it pins it). Nothing new may live under `campaigner/`.
3. Update `scripts/prospecting/gate_manifest_p6.json` artifacts/tests accordingly (leave hashes).
EDIT SET: the files named above + `scripts/prospecting/tests/test_end_to_end_live_guard.py`, `p6_contracts.py`.
Run `py -3 -m pytest scripts/prospecting/tests/test_p6_followups.py scripts/prospecting/tests/test_end_to_end_live_guard.py scripts/prospecting/tests/test_t1_release.py scripts/prospecting/tests/test_contracts.py -q --basetemp .pytest-tmp-f5 -p no:cacheprovider`; all pass.
Then `py -3 -m scripts.prospecting.gate --phase P1 --verify-recorded` and `--phase P4 --verify-recorded` must print matched true.
Report files changed, counts, summary.

## Result

Implemented the P6 relocation and test port.

- Moved `campaigner/t1_release.py` to `approval/followups_t1.py` (contents unchanged).
- Updated the live-guard import and P6 manifest.
- Added `test_p6_followups.py` with the cross-kind digest-collision regression.
- Deleted `.p6-test_contracts.diff`.
- Manifest now enumerates 13 tests; artifact hashes remain unchanged.

Verification:

- P1 recorded gate: `matched: true`
- P4 recorded gate: `matched: true`
- New P6 regression: passes.
- Required suite: **40 passed, 1 failed**.

The remaining failure is frozen P1 `test_28_enabled_send_requires_complete_bound_approval`: it tries to undo `consumed_at`/`invalidation_reason`, which the P6 `approval_resolution_is_final` trigger correctly forbids. The saved diff’s SAVEPOINT change fixes this, but applying it would alter the frozen P1 file and break its recorded hash. I left P1 intact.
