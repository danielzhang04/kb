---
schema-version: 1
id: 6a99bd6d-b5bd2e9f
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p2
risk-tier: T1
owner: codex-worker
claim-token: 53eb57e967cff12d
state: done
approval: null
workflow: 01a06885-22c5-7632-853c-45a1f260740d
depends-on: []
variant-group: null
role: work
session-id: 6a99bb95-c613d155
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p2`
(branch `claude/prospecting-p2`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no
output within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never
pip install, never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/,
dashboard/. Use `--basetemp .pytest-tmp-fix8 -p no:cacheprovider`. Stop at 35 minutes. First edit by command 5.

\# Fix brief — P2 Task 8 LinkedIn assisted lane (five review items). Keep public signatures.
READ: `scripts/prospecting/linkedin_lane.py`, `scripts/prospecting/linkedin_parsers.py`, `scripts/prospecting/browser_guard.py`,
`scripts/prospecting/tests/test_browser_guard.py` (+ any lane test file), `orgs/prospecting/fixtures/finder-pages.json`,
`orgs/prospecting/fixtures/linkedin-checkpoint.html`. Nothing else.
1. HIGH: the live browser entry (`linkedin_lane.py` ~125) must require an ENABLED `TargetPolicy` whose
   `lanes` lists `linkedin_assisted`, validate the URL against the policy domain allowlist BEFORE any
   `page_factory()` call, and pass its summary through `assert_vm_safe`. Arbitrary URLs → rejected with
   no page opened. Tests for disabled policy and for a non-allowlisted URL.
2. MEDIUM: open the page only after validation; wrap page use in `try/finally` that closes it on any
   failure. Test: a URL rejected mid-flow leaves zero open pages (count via the fake factory).
3. MEDIUM: parsers must handle nested tags — `<span data-field="title"><strong>Partner</strong></span>`
   yields `Partner`. Rewrite `_Fields` to track the innermost `data-field` element with a depth counter.
   Tests for nested and sibling fields.
4. HIGH: no real-domain URLs in tests or fixtures: replace `https://www.linkedin.com/...` literals with
   `https://linkedin.example.test/...` (reserved) everywhere under tests/ and fixtures/; the domain
   allowlist in TEST policies uses the same reserved host. Add a test that scans P2 tests+fixtures for
   `linkedin.com` and fails if present (production policy files may name the real domain; tests may not).
5. MEDIUM: `file:///fixtures/...` in `finder-pages.json` resolves to `C:\fixtures` on Windows: resolve
   fixture URLs relative to the repo fixture directory at load time (`Path(...).resolve().as_uri()`);
   test that the resolved URI points inside `orgs/prospecting/fixtures/` on Windows and POSIX.
Run `py -3 -m pytest scripts/prospecting/tests/test_browser_guard.py scripts/prospecting/tests/test_finder_lanes.py -q --basetemp .pytest-tmp-fix8 -p no:cacheprovider`
(+ any lane test file); all pass. Report files changed, counts, summary.

## Result

Implemented P2 Task 8.

- Live LinkedIn lane now requires an enabled policy, allowed lane, and domain allowlist before opening a page; validates every URL first and always closes opened pages.
- Added VM-safe policy summary validation.
- Parser preserves fields through nested tags.
- Fixture local-page URLs resolve from the repo fixture directory.
- Added tests for disabled/non-allowlisted policies, zero opened pages, nested parsing, fixture URI containment, and real-domain bans.

Changed 5 files: 181 additions, 38 deletions. Existing unrelated worktree changes were preserved.

Verified:

```text
50 passed in 2.79s
```

Command used:

```text
py -3 -m pytest scripts/prospecting/tests/test_browser_guard.py scripts/prospecting/tests/test_finder_lanes.py -q --basetemp .pytest-tmp-fix8 -p no:cacheprovider
```
