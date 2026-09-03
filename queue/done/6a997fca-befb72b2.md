---
schema-version: 1
id: 6a997fca-befb72b2
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p2
risk-tier: T1
owner: codex-worker
claim-token: 6fb9feb3a3c139a8
state: done
approval: null
workflow: 01a06797-39be-7a10-a15b-5606d128680a
depends-on: []
variant-group: null
role: work
session-id: 6a997eba-565a67d0
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 0d9b93ef1435fcc7092e1a4fd902a941f5a6d3e9
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p2`
(branch `claude/prospecting-p2`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no
output within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never
pip install, never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/,
dashboard/. Use `--basetemp .pytest-tmp-fix2 -p no:cacheprovider`. Stop at 30 minutes. First edit by command 5.

\# Fix brief — P2 Tasks 1-2: two host test failures + two review items
READ: `scripts/prospecting/capture.py`, `scripts/prospecting/finder_base.py`,
`scripts/prospecting/tests/test_finder_lanes.py`; `scripts/prospecting/schema.sql` ONLY the
`campaign` table CHECKs. Nothing else. Keep public signatures unchanged (Task 3 builds on them).
1. HOST FAILURE `test_finder_base_public_names_are_directly_imported_and_exercised`: the fixture
   inserts a campaign whose `approval_tier` is not in ('T0','T1','T2','T3') → CHECK failure. Use
   `'T0'` and satisfy every other campaign CHECK (read the schema).
2. HOST FAILURE `test_cursor_rollback_reopen_and_repeat_at_most_one_page`: Windows `WinError 32`
   on `cursor.sqlite` during tmp cleanup — a connection is still open. Close every connection
   (context managers / explicit `close()` in `finally`) before the tmp dir is torn down.
3. REVIEW: `capture.py:~125` stores `json.dumps(canonical)` (a quoted string) as the observation
   value; store the canonical URL string itself (or the exact JSON shape the schema demands —
   check `source_observation.value` type/CHECK and match it without double-encoding). Test that the
   persisted value equals the canonical URL.
4. REVIEW: `capture_urls` builds CSV by string interpolation → record injection with commas/
   newlines. Use `csv.writer`/`csv.reader` (or the structured-row intake path) and add a test with
   a URL containing a comma and a newline proving exactly one row is captured.
Run `py -3 -m pytest scripts/prospecting/tests/test_finder_lanes.py scripts/prospecting/tests/test_p2_prerequisite.py -q --basetemp .pytest-tmp-fix2 -p no:cacheprovider`; all pass (sandbox temp-dir issues aside — report them). Report files changed, counts, summary.

## Result

Completed in 2 files:

- `scripts/prospecting/capture.py`: `capture_urls` now builds input with `csv.writer`, preventing comma/newline record injection.
- `scripts/prospecting/tests/test_finder_lanes.py`:
  - Campaign fixture now satisfies `approval_tier='T0'` and 64-character `policy_hash` checks.
  - Connections close reliably via `finally`, including reopen paths.
  - Added CSV comma/newline regression coverage.
  - Added observation assertion that extracts to the exact canonical URL, preserving the schema-required JSON scalar without double-encoding.

Verification:

```text
28 passed, 1 skipped in 1.73s
```

The specified test run completed without a sandbox temp-directory failure. No commit or git-ref changes were made.
