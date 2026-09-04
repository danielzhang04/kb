---
schema-version: 1
id: 6a9b4cc0-de8efa31
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p6
risk-tier: T1
owner: codex-worker
claim-token: 741e39bb10eea08b
state: done
approval: null
workflow: 01a06ea0-3a17-7b40-9b1c-20bd53777ffa
depends-on: []
variant-group: null
role: work
session-id: 6a9b4bcb-3de9a564
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 2239637cd2dd7211223a712a037ce51b4dadc612
---

## Work order

ROUND 3 (boss): round-2 findings at `docs/superpowers/plans/2026-09-04-prospecting-p6-DISCOVER-REVIEW-2.md`; the fix landed (persisted domain task + resumable polling with backoff, typed skipped_budget for continuation/budget refusals, per-campaign firm cap across pages/runs, 50-credit account ceiling from operator settings, honest title classes, executor-path tests). Re-check each round-2 item RESOLVED / STILL OPEN with evidence; then add anything new and material. PASS is the expected outcome if nothing material remains.

You are a codex ADVERSARIAL REVIEWER (read-only sandbox) in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p6`.
Never edit, never commit. Deliver as FINAL MESSAGE. Stop at 25 minutes. READ BUDGET: `scripts/prospecting/discovery/*.py`,
`scripts/prospecting/operator/vendors.py`, `scripts/prospecting/tests/test_snov_domain_lane.py`, fixtures
`orgs/prospecting/fixtures/vendor/snov/domain-search-*.json`, and signatures only of `scripts/prospecting/lanes/__init__.py`,
`scripts/prospecting/list_builder.py` (`_persist_batch`, lane construction), `scripts/prospecting/providers/{base,snov}.py`,
`scripts/prospecting/store.py` (finder_page fields, reservations). Never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/.

\# Adversarial review — Snov domain-search discovery lane (Daniel runs it on 30 real NYC VC firms today)
Rules: credentials only inside the HTTP call frame, never retained/logged/returned; every Snov call through a claimed
typed `finder_page` exec_request with a credit reservation, settled per page; PII stays on the desktop (people names,
emails go to the store only; stdout counts only); title filter comes from the campaign policy; dedup via the P2
identity key; commit only on adapter success; frozen P1–P5 files untouched.
Answer with file:line evidence, ranked HIGH/MEDIUM/LOW:
1. Correctness against the real Snov v1 API (OAuth client-credentials token, `get-domain-search` request/response
   shapes, pagination `lastId`, credit accounting): what will break on the first live call?
2. Budget: can a run exceed the campaign credit budget or the free tier (50 credits) — per-page reservations, page
   limit, retries, token calls counted?
3. PII/credential leakage on any path incl. HTTP errors (urllib errors embed URLs/bodies).
4. Data quality: title filter false negatives/positives (e.g. "Associate Partner", "Senior Associate", "Managing Director"),
   email status mapping, dedup of the same person across pages/firms, employment linkage.
5. Vacuous tests; anything that stays green if the adapter were broken.
End with `## Verdict: PASS | FIX` and an exact, minimal fix list.

## Result

\## MEDIUM

- Cross-campaign state is not scoped to the active finder run. [`snov_domain.py:212`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:212) marks a company completed if *any* Snov page succeeded, so a later campaign skips it entirely. [`snov_domain.py:228`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:228) also returns observations from every prior Snov run as this run’s batch. Trigger: run a second campaign over a previously processed firm. Outcome: under-delivery and stale people attributed/counting toward the new run. No regression covers this.

- Email-task polling remains non-resumable on a poll transport error. After Snov accepts the email search, [`vendors.py:342-356`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/operator/vendors.py:342) lets a poll `VendorHttpError` escape; persistence occurs only after the transport returns at [`vendors.py:382-404`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/operator/vendors.py:382). The executor then rejects it as a vendor HTTP error ([`vendors.py:273-274`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/operator/vendors.py:273)), leaving no `snov_email_search` task record to resume. This loses the accepted task’s result and leaves its reservation unresolved.

\## LOW

- No credential or PII leak found in the inspected HTTP-error paths. Both transports reduce urllib failures to provider/status only ([`vendors.py:458-460`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/operator/vendors.py:458)); credentials are nulled in the call frame ([`vendors.py:466-468`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/operator/vendors.py:466)).

- The legacy v1/`lastId` fixtures are no longer the live integration. The lane correctly uses OAuth client credentials and the documented v2 prospect start/result flow ([`vendors.py:462-493`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/operator/vendors.py:462)); Snov’s current docs specify `v2/domain-search/prospects/start`, numeric `page`, and `links.next`, not v1 `get-domain-search`/`lastId`. [Snov API docs](https://snov.io/api)

\## Round-2 recheck

| Round-2 item | Status | Evidence |
|---|---|---|
| Persist domain task; backoff/resume without releasing accepted work | RESOLVED | Task state persists and becomes `uncertain` at [`snov_domain.py:431-456`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:431); transport polls with backoff at [`vendors.py:485-493`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/operator/vendors.py:485). |
| Continuation/budget refusal is typed `skipped_budget` and completed page settles | RESOLVED | [`snov_domain.py:545-556`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:545); executor-path regression at [`test_snov_domain_lane.py:307-319`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/tests/test_snov_domain_lane.py:307). |
| Per-campaign firm cap across pages/runs | RESOLVED | Prior campaign selections feed selection at [`snov_domain.py:337-357`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:337) and cap remaining choices at [`snov_domain.py:465-470`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:465). |
| 50-credit account ceiling | RESOLVED | Account usage/setting guard at [`snov_domain.py:99-117`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:99), enforced for initial and continuation pages at [`snov_domain.py:136-137`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:136) and [`snov_domain.py:555-556`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:555). OAuth requests are not credit-bearing per Snov’s docs. |
| Honest title classes | RESOLVED | Explicit Associate Partner exclusion, Senior Associate, Principal/Partner, and Managing Director handling at [`snov_domain.py:252-285`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/discovery/snov_domain.py:252). |
| Executor-path tests | RESOLVED | Tests now exercise the registered executor for rate limits, cap refusal, domain resume, 30-page cap, and per-firm selection ([`test_snov_domain_lane.py:262-407`](/C:/Users/danie/kb-worktrees/prospecting-p6/scripts/prospecting/tests/test_snov_domain_lane.py:262)). |
| Prior claim that email async persistence/resume was fully resolved | STILL OPEN | Poll-error path above is unpersisted and untested. |

Focused pytest could not start: the read-only sandbox has no writable temporary directory.

Minimal fixes:

1. Scope “completed” and prior-observation queries to `self._run_id`; keep only the existing per-campaign selection query cross-run.
2. Catch email poll transport errors after task creation, persist `task_hash`/`result_url`, transition to `uncertain`, and add an executor-path regression.

\## Verdict: FIX
