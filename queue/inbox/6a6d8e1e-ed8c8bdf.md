---
id: 6a6d8e1e-ed8c8bdf
project: kb
action: audit:weekly-findings-2026-08-01
target: .
risk-tier: T1
owner: null
claim-token: null
state: inbox
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: null
runtime: null
model: null
---

## Work order

Weekly-audit findings from dispatcher-cloud's 2026-08-01 (Sat) run (kb `weekly-audit`
cadence, card 6a6d8ce3-389fce18). UNOWNED — awaits dispatch. This is an audit report, not
instructions. Last week's findings card `6a645395-d5322124` (2026-07-25) is STILL OPEN in
inbox; this card cross-references it rather than repeating unchanged items.

### 1. Cadence coverage this week (2026-07-26 .. 2026-08-01)
- `nightly-review` (kb, daily, cloud) — RAN 7/7 days (dispatch rows every day
  07-26..08-01). Healthy.
- `weekly-audit` (kb, weekly:sat, cloud) — RAN today 08-01 (this run). Healthy.
- `grades-reconcile` (kb, weekly:sat, DESKTOP) — NO run evidence this week. No
  `ledgers/grades/FROZEN` sentinel, no memory note of a clean desktop reconcile.
- `daemon-dirs-sync` (kb, daily, DESKTOP) — **NEW cadence since last week's audit; NO run
  evidence this week.** No desktop dispatch ledger exists (only `dispatcher-cloud-*`). Its
  non-execution is the direct cause of the persistent daemon-dir drift (see §3).
- `self-lint-report` (kb-ops, daily, DESKTOP) — DORMANT by design (orgs/kb-ops/STATE.md:
  manual launch only). Not a regression.
- faceless-youtube / atlas `nightly-review` — DISABLED (commented out in their HEARTBEAT).
  Not gaps.

Summary: all CLOUD cadences healthy; all three DESKTOP cadences produced nothing this week —
the desktop scheduler appears to be down (no `codex-worker`/desktop dispatch rows since
2026-07-22).

### 2. Grades <-> activity reconciliation
Both ledgers are EMPTY for the audit window (0 grades rows and 0 activity rows across
2026-07-22..08-01; last rows are 2026-07-21, the atlas V1 build wave). Nothing to reconcile
— no orphans on either side. Note for context: 12 cards moved to `done/` and 28 `cost` rows
were logged on 07-31 (codex-worker executions, subscription-billed $0.0). These are the
codex execution path (cost-logged only); they are not inspector-graded tasks, so their
absence from the grades/activity ledgers is expected, not an orphan. No reconciliation
discrepancy.

### 3. Gaps & improvement proposals (dispatch-ready)
P1. DESKTOP SCHEDULER DOWN (human decision — HEARTBEAT.md is human-edited only). WORSENED
    vs last week. Three declared desktop cadences are not firing: `grades-reconcile`
    (weekly), `daemon-dirs-sync` (daily), `self-lint-report` (daily, dormant-by-design).
    The concrete harm this week: because `daemon-dirs-sync` is not running, the main->ops
    daemon-dir drift is never auto-reconciled, so each nightly run re-reports it and files
    (or, tonight, references) a wake-me card — the drift from the 2026-07-31 fyt merge is
    still open (9 files, byte-identical to 07-31). Decide one of: (a) restore/enable the
    desktop scheduler, (b) mirror `daemon-dirs-sync` + `grades-reconcile` to cloud tier
    (note: `daemon-dirs-sync --sync` needs the dashboard-ops worktree, which the cloud VM
    lacks — a cloud port would need refs-fallback --sync support), or (c) accept manual-only
    and stop the nightly drift-report churn. NOT filed to approvals (improvement proposal,
    not a blocking gate; raise via HEARTBEAT edit).
P2. STALE done-in-inbox HOUSEKEEPING (recurring, now 4 cards, was 3). `state:done` nightly
    cards stranded in `queue/inbox/`: 6a5dbb3e-295a9d2b, 6a5f0cef-53d31df4, 6a605e40-ca81f0c8,
    6a65a3cd-dabf5d57. Root cause still unfixed. Proposal: janitor sweep moving state:done
    files inbox/->done/, or fix the transition site that leaves the source file unlinked.
P3. HALTED CARD in queue/working/: 6a6bc3dd-5494006b (codex `iter-smoke-t2`, state:halted)
    sits in working/ (STATE_DIR maps halted->working/, so this is expected placement, but
    the terminal halted card has been parked there since ~07-31). Proposal: confirm it is a
    genuine terminal halt and archive it, or re-dispatch if the smoke test still matters.
P4. LEDGER HYGIENE (carried from last week, unactioned): delete stray
    `ledgers/activity/inspector-2026-07-20.tsv` (legacy `inspector` identity + non-standard
    single-column schema; its one row is duplicated in the canonical ledger).
P5. sync_daemon_dirs.py MISSING ON OPS + PERSISTENT DRIFT — already tracked by wake cards
    6a605ebb-d86dff79 (missing script) and 6a6c3d8e-08b1da38 (07-31 fyt drift). Listed for
    completeness; no duplicate filed this run (tonight's --check output is byte-identical to
    6a6c3d8e's).

### 4. Human-decision items
No NEW blocking gate filed to queue/approvals/. The one systemic decision (P1, desktop
scheduler) is a proposal raised here + surfaced to Daniel via the run's wake channel;
HEARTBEAT.md is human-edited only, so this audit does not force it through an approval card.
Existing open human items (engagement-fold bridge, budget-gate 6a5e482a, delivery-gate flip
6a5c7274, daemon-dir sync/mirror wakes) are unchanged and already carded.

## Result
(unowned audit report — awaits dispatch; proposals P1-P5 are the actionable output. Headline:
the DESKTOP SCHEDULER is down, and its daily `daemon-dirs-sync` cadence not firing is what
keeps the daemon-dir drift open night after night.)
