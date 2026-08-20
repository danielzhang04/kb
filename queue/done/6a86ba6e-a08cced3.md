---
id: 6a86ba6e-a08cced3
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\vm-movement-p1
risk-tier: T1
owner: codex-worker
claim-token: 741334f64976d6f0
state: done
approval: null
workflow: 01a01e3d-51be-7ac2-bd2e-deacc1b61921
depends-on: []
variant-group: null
role: work
session-id: 6a86b79c-768efc14
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Fix worker: Phase-1 Task 1 review findings (3 items, nothing else)

Cwd = build worktree C:/Users/danie/kb-worktrees/vm-movement-p1. Task-1 files exist
uncommitted. GIT IS OFF-LIMITS (no fetch/switch/add/commit; boss commits). Fix
EXACTLY these three review findings; touch nothing else.

1. BLOCKER — tests/fixtures/control-plane/v1-review-rows.json: its reviewLoops[0] has
   only 4 of the 15 required LegacyStoreReviewLoopMigrationRow fields
   (dashboard/server/control/store.ts:350-367) and reviewReceipts[0] only 3 of the
   LegacyStoreReviewReceiptMigrationRow fields (:369-390), with stages: [] — so
   migrateLegacyStoreLoop (store.ts:2524-2554) throws 'invalid control-plane review
   loop' on subjectStageRef lookup before anything is exercised. Rewrite the fixture
   with COMPLETE legacy rows + the stage pair the loop references, modeled on the
   real scenario at dashboard/server/control/store.test.ts:1884-1946, so the decode
   path runs to completion.
2. BLOCKER — tests/fixtures/control-plane/v1-quarantined-legacy.json: same defect
   inside the quarantine bundle (4/15 loop fields, stages: []). Rewrite the
   quarantined rows to the same complete-row standard (quarantine branch shape per
   store.test.ts:848-860).
3. MAJOR — scripts/generate_control_plane_schema.py:202-213: dead, broken main()
   (never called; its argparse lacks --check). Delete the function; keep the working
   __main__ block.

Prove it: for each rewritten fixture, run a quick node/py one-liner or targeted test
demonstrating the fixture now decodes through the legacy migration path without
throwing (e.g. drive createFileControlPlaneStore or the relevant migrate function
over the fixture bytes in a temp dir), plus rerun:
- python -m pytest -q tests/test_control_plane_schema.py
- python scripts/generate_control_plane_schema.py --check
- npx vitest run server/control/generated/controlPlaneSchema.test.ts (from dashboard/)

Final message ≤15 lines: per-finding disposition + the decode-proof evidence + test
results.

## Result

- Fixed `v1-review-rows.json`: complete legacy loop/receipt rows, stage pair, attempts, generations, and supersession evidence.
- Fixed `v1-quarantined-legacy.json`: complete quarantined legacy loop/receipt rows plus supporting stage/generation evidence.
- Removed the dead `main()` from `generate_control_plane_schema.py`.
- Decode proof: active fixture migrated to generic loop/receipt/request `1/1/1` without throwing.
- Decode proof: quarantined fixture migrated to generic loop/receipt/request `1/1/1` without throwing.
- `python -m pytest -q tests/test_control_plane_schema.py` — 7 passed.
- `python scripts/generate_control_plane_schema.py --check` — passed.
- `npx vitest run server/control/generated/controlPlaneSchema.test.ts` — 1 passed.
