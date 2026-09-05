---
schema-version: 1
id: 6a9b5e9b-79ee5eba
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p6
risk-tier: T1
owner: codex-worker
claim-token: ed04c9a135742d73
state: done
approval: null
workflow: 01a06edf-e16d-72d1-985d-ac7bb9432ccb
depends-on: []
variant-group: null
role: work
session-id: 6a9b5c1e-6bb8cd15
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 2239637cd2dd7211223a712a037ce51b4dadc612
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p6`
(branch `claude/prospecting-p6`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no output
within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never pip install,
never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/.
Use `--basetemp .pytest-tmp-fill2 -p no:cacheprovider`. Stop at 30 minutes. First edit by command 4.
ENV NOTE: sandbox may deny temp; host is 3.13.7. FROZEN: every P1–P5 file; never ALTER a P1 table. No PII. No network in tests.

\# Fix brief — `operator fill` must be self-contained (real run: 0 searches, 42 firms marked short)
On a fresh store `fill` inspected only people already present and marked every firm `no_confident_email`
without discovering anyone. The loop must own discovery. EDIT SET: `scripts/prospecting/operator/fill.py`,
`scripts/prospecting/operator/cli.py`, `scripts/prospecting/tests/test_operator_fill.py`, `schema_p6.sql` (additive),
plus any items from `docs/superpowers/plans/2026-09-04-prospecting-p6-FILL-REVIEW.md` if that file exists (read it first).
1. Each round, for every firm below target: run discovery for that firm through the registered `snov_domain`
   lane (queue `finder_page` requests up to `max-candidates-per-firm`, deeper pages only when the first page's
   title matches are exhausted), drain the executor, then queue email searches for unsearched candidates in
   class order, drain again, re-evaluate. Do not mark a firm `no_confident_email` until it has been discovered to
   `max-candidates` AND every candidate's search finished without a confident email.
2. `fill_firm` rows are never terminal on their own: a re-run re-evaluates from the store (a firm marked short
   earlier becomes `met` if confident emails now exist) — fix any terminal marking.
3. Counts-only summary adds `firms_discovered`, `candidates_found`, `searches_run`, `credits`.
4. Tests: fresh store → fill performs discovery → drains → searches → delivers (fixture transports through the
   executor path); re-run after a partial crash resumes without re-buying; firm marked short is re-evaluated.
Run `py -3 -m pytest scripts/prospecting/tests/test_operator_fill.py scripts/prospecting/tests/test_operator.py -q --basetemp .pytest-tmp-fill2 -p no:cacheprovider`; all pass.
Report files changed, counts, summary.

## Result

Implemented self-contained `operator fill`.

Changed:

- `fill.py`: queues Snov domain discovery, drains executor work, batches email searches, resumes pending work, and re-evaluates all firms on every run.
- `cli.py`: requires Snov, uses the registered executor path, drains it fully, and applies the Snov account ceiling to fill email requests.
- `snov_domain.py` + `schema_p6.sql`: add resumable fill-owned discovery state and defer deeper pages until prior title matches are exhausted.
- `test_operator_fill.py`: fresh-store discovery-to-delivery, crash-resume/no-rebuy, and re-evaluation of a previously short firm.

Counts-only fill summaries now include `firms_discovered`, `candidates_found`, `searches_run`, and `credits`.

Verification passed:

```text
20 passed in 8.28s
```

using the requested pytest command.
