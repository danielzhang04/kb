---
schema-version: 1
id: 6a9df6a9-fadd7b59
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p8
risk-tier: T1
owner: codex-worker
claim-token: 8e2ea9d984ffe4d4
state: done
approval: null
workflow: 01a07904-a04c-7680-b34f-7107cb365d84
depends-on: []
variant-group: null
role: work
session-id: 6a9df4e1-2893441a
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
Use `--basetemp .pytest-tmp-t12 -p no:cacheprovider`. Stop at 35 minutes. First edit by command 4.
ENV NOTE: sandbox may report py3.12 / no tzdata / denied temp — host is 3.13.7; proceed.
FROZEN: every P1–P6 file (schema.sql, schema_p2/p4/p6.sql, store.py, executor.py, fetcher.py, linkedin_lane.py, linkedin_parsers.py,
everything under operator/, personalizer/, discovery/, manager/, existing tests, existing fixtures, existing templates, runbook.md).
`schema_p8.sql` is COMPLETE after Task 2 — do not edit it; if you believe a schema change is needed, STOP and report.
No test may write into `scripts/prospecting/`. No PII (synthetic names only, `.test` hosts, far-future dates with injected now).
No network in tests (`KB_PROSPECTING_NO_NETWORK=1`). No model calls. New code only under `scripts/prospecting/affinity/`,
`scripts/prospecting/tests/test_affinity_*.py`, `orgs/prospecting/fixtures/affinity/`, `orgs/prospecting/templates/v2/`,
`orgs/prospecting/runbook-p8.md`, `orgs/prospecting/doctrine.md`, `orgs/prospecting/evals-draft/prospecting-affinity/`.

\# Build brief — Plan Task 12: `affinity/cli.py`, `__main__.py`, runbook and doctrine
READ: `docs/superpowers/plans/2026-09-06-prospecting-p8-affinity.md` "## Header" then "## Task 12" in full (it contains the real test
code and implementation code — implement exactly that, completing any elided bodies in the same style), plus the spec sections it
cites in `docs/superpowers/specs/2026-09-06-prospecting-affinity-design.md`, plus the earlier-task modules it imports (already
present in `scripts/prospecting/affinity/`). Where plan and spec disagree, the plan wins (it was verified against code); where the
plan cites a P1–P6 function, open that function and match its real signature.
Files per the plan: Create `scripts/prospecting/affinity/cli.py`, `scripts/prospecting/affinity/__main__.py`,
`scripts/prospecting/tests/test_affinity_cli.py`,
`scripts/prospecting/tests/test_affinity_pii_guard.py`, `orgs/prospecting/runbook-p8.md`,
`orgs/prospecting/doctrine.md`.
Steps: write the failing test(s) first, run to see them fail, implement, run to green. Test command:
`KB_PROSPECTING_NO_NETWORK=1 py -3 -m pytest scripts/prospecting/tests/test_affinity_cli.py scripts/prospecting/tests/test_affinity_pii_guard.py -q -p no:cacheprovider --basetemp .pytest-tmp-t12`
(PowerShell: `$env:KB_PROSPECTING_NO_NETWORK='1'; py -3 -m pytest …`). Then also run every existing `test_affinity_*.py` to prove
earlier tasks still pass. Report: files created, public functions with signatures, test counts, and any plan/spec/code
disagreement you hit and how you resolved it. No PII in the report.

## Result

Implemented Task 12.

Created:
- `scripts/prospecting/affinity/cli.py`
- `scripts/prospecting/affinity/__main__.py`
- `scripts/prospecting/tests/test_affinity_cli.py`
- `scripts/prospecting/tests/test_affinity_pii_guard.py`
- `orgs/prospecting/runbook-p8.md`
- `orgs/prospecting/doctrine.md`

Public interface:
- `main(argv: Sequence[str] | None = None) -> int`

Verification:
- Focused Task 12 suite: 11 passed
- All `test_affinity_*.py`: 88 passed

The CLI supports all required verbs, emits only PII-guarded JSON summaries, rejects unsafe file locations, and uses fixed refusal codes.

One plan/code mismatch: Task 12’s narrative says to resolve `camp_…` to a UUID before compilation, but the existing `compile_fit_spec` interface and Task 4’s own test use the `camp_…` campaign ID directly. I followed the implemented interface and its verified test contract.
