---
schema-version: 1
id: 6a9df962-ffced53f
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p8
risk-tier: T1
owner: codex-worker
claim-token: c3009b2febc99717
state: done
approval: null
workflow: 01a0790c-a873-7a30-b7bb-69b0994294a5
depends-on: []
variant-group: null
role: work
session-id: 6a9df6f0-45ee5f6d
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: b6192c2e4823a16eee118a14f7f7d6f72984b5fc
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p8`
(branch `claude/prospecting-p8`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no output
within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never pip install,
never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/.
Use `--basetemp .pytest-tmp-t13 -p no:cacheprovider`. Stop at 35 minutes. First edit by command 4.
ENV NOTE: sandbox may report py3.12 / no tzdata / denied temp — host is 3.13.7; proceed.
FROZEN: every P1–P6 file (schema.sql, schema_p2/p4/p6.sql, store.py, executor.py, fetcher.py, linkedin_lane.py, linkedin_parsers.py,
everything under operator/, personalizer/, discovery/, manager/, existing tests, existing fixtures, existing templates, runbook.md).
`schema_p8.sql` is COMPLETE after Task 2 — do not edit it; if you believe a schema change is needed, STOP and report.
No test may write into `scripts/prospecting/`. No PII (synthetic names only, `.test` hosts, far-future dates with injected now).
No network in tests (`KB_PROSPECTING_NO_NETWORK=1`). No model calls. New code only under `scripts/prospecting/affinity/`,
`scripts/prospecting/tests/test_affinity_*.py`, `orgs/prospecting/fixtures/affinity/`, `orgs/prospecting/templates/v2/`,
`orgs/prospecting/runbook-p8.md`, `orgs/prospecting/doctrine.md`, `orgs/prospecting/evals-draft/prospecting-affinity/`.

\# Build brief — Plan Task 13: eval-card drafts and `gate_manifest_p8.json`
READ: `docs/superpowers/plans/2026-09-06-prospecting-p8-affinity.md` "## Header" then "## Task 13" in full (it contains the real test
code and implementation code — implement exactly that, completing any elided bodies in the same style), plus the spec sections it
cites in `docs/superpowers/specs/2026-09-06-prospecting-affinity-design.md`, plus the earlier-task modules it imports (already
present in `scripts/prospecting/affinity/`). Where plan and spec disagree, the plan wins (it was verified against code); where the
plan cites a P1–P6 function, open that function and match its real signature.
Files per the plan: see the plan
Steps: write the failing test(s) first, run to see them fail, implement, run to green. Test command:
`the pytest command in the task`
(PowerShell: `$env:KB_PROSPECTING_NO_NETWORK='1'; py -3 -m pytest …`). Then also run every existing `test_affinity_*.py` to prove
earlier tasks still pass. Report: files created, public functions with signatures, test counts, and any plan/spec/code
disagreement you hit and how you resolved it. No PII in the report.

## Result

Implemented Task 13.

Created:

- [P8 gate manifest](/C:/Users/danie/kb-worktrees/prospecting-p8/scripts/prospecting/gate_manifest_p8.json)
- 10 draft eval cards in [prospecting-affinity](/C:/Users/danie/kb-worktrees/prospecting-p8/orgs/prospecting/evals-draft/prospecting-affinity)

Public functions added: none.

Verification:

- Existing affinity suite: `88 passed`
- Manifest/card structural check: 10 cards, 61 artifacts, 8 fixtures.

The manifest has the complete P8 artifact/fixture/criteria structure and `minimum_enumerated_tests: 829` (741 inherited + 88 affinity tests). As Task 13 specifies, its cumulative ordered `tests` list and tree-derived `artifact_hashes` remain for the boss’s recording step; I did not run the foreground gate.

Resolution notes:

- The task says ten cards but lists six scorer checks. I combined required and disqualifier behavior into one eligibility-gates card, yielding five researcher and five scorer cards.
- The recompute card targets the existing no-op recompute node; it is the available Task 5–8 node closest to the stated fit-spec-change boundary.
- No Task 13 pytest was added because the plan explicitly assigns this task’s verification to the boss-run gate.
