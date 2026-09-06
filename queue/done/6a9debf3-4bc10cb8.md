---
schema-version: 1
id: 6a9debf3-4bc10cb8
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p8
risk-tier: T1
owner: codex-worker
claim-token: fe4e70b7ee75ef42
state: done
approval: null
workflow: 01a078d3-9af1-7641-99ea-c33e77893c5d
depends-on: []
variant-group: null
role: work
session-id: 6a9de84d-e1406c1f
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
Use `--basetemp .pytest-tmp-t4 -p no:cacheprovider`. Stop at 35 minutes. First edit by command 4.
ENV NOTE: sandbox may report py3.12 / no tzdata / denied temp — host is 3.13.7; proceed.
FROZEN: every P1–P6 file (schema.sql, schema_p2/p4/p6.sql, store.py, executor.py, fetcher.py, linkedin_lane.py, linkedin_parsers.py,
everything under operator/, personalizer/, discovery/, manager/, existing tests, existing fixtures, existing templates, runbook.md).
`schema_p8.sql` is COMPLETE after Task 2 — do not edit it; if you believe a schema change is needed, STOP and report.
No test may write into `scripts/prospecting/`. No PII (synthetic names only, `.test` hosts, far-future dates with injected now).
No network in tests (`KB_PROSPECTING_NO_NETWORK=1`). No model calls. New code only under `scripts/prospecting/affinity/`,
`scripts/prospecting/tests/test_affinity_*.py`, `orgs/prospecting/fixtures/affinity/`, `orgs/prospecting/templates/v2/`,
`orgs/prospecting/runbook-p8.md`, `orgs/prospecting/doctrine.md`, `orgs/prospecting/evals-draft/prospecting-affinity/`.

\# Build brief — Plan Task 4: `affinity/fitspec.py` and `affinity/ask_compile.py`
READ: `docs/superpowers/plans/2026-09-06-prospecting-p8-affinity.md` "## Header" then "## Task 4" in full (it contains the real test
code and implementation code — implement exactly that, completing any elided bodies in the same style), plus the spec sections it
cites in `docs/superpowers/specs/2026-09-06-prospecting-affinity-design.md`, plus the earlier-task modules it imports (already
present in `scripts/prospecting/affinity/`). Where plan and spec disagree, the plan wins (it was verified against code); where the
plan cites a P1–P6 function, open that function and match its real signature.
Files per the plan: Create `scripts/prospecting/affinity/fitspec.py`,
`scripts/prospecting/affinity/ask_compile.py`,
`scripts/prospecting/tests/test_affinity_fitspec.py`,
`scripts/prospecting/tests/test_affinity_ask_compile.py`,
`orgs/prospecting/fixtures/affinity/fit-specs.json`.
Steps: write the failing test(s) first, run to see them fail, implement, run to green. Test command:
`KB_PROSPECTING_NO_NETWORK=1 py -3 -m pytest scripts/prospecting/tests/test_affinity_fitspec.py scripts/prospecting/tests/test_affinity_ask_compile.py -q -p no:cacheprovider --basetemp .pytest-tmp-t4`
(PowerShell: `$env:KB_PROSPECTING_NO_NETWORK='1'; py -3 -m pytest …`). Then also run every existing `test_affinity_*.py` to prove
earlier tasks still pass. Report: files created, public functions with signatures, test counts, and any plan/spec/code
disagreement you hit and how you resolved it. No PII in the report.

## Result

Implemented Task 4.

Created:
- `scripts/prospecting/affinity/fitspec.py`
- `scripts/prospecting/affinity/ask_compile.py`
- `scripts/prospecting/tests/test_affinity_fitspec.py`
- `scripts/prospecting/tests/test_affinity_ask_compile.py`
- `orgs/prospecting/fixtures/affinity/fit-specs.json`

Public interfaces match the plan: fit-spec validation/hash/render/store/approve, `ApproveResult`, prompt/job/response compilation, and `CompileOutcome`.

Verification:
- Focused Task 4 suite: **7 passed**
- All affinity tests: **21 passed, 1 failed**

The affinity-wide failure is in the existing frozen LinkedIn/background test: `test_background_parse_recovers_education_and_prior_employer` finds education but no employer. I left its module, test, and fixture unchanged.

No plan/spec/code disagreement encountered. `schema_p8.sql` was not edited.
