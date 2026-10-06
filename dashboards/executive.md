# Executive Dashboard
_Generated: 2026-10-06 06:19 UTC by dispatcher-cloud_

## Action required
- **65d8f246-8a461521** — figment — `GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed` — **T3** (human ruling required)
- **6ab76543-b01ea7d5** — kb — `wake:human-decision` — **T1**

## Queue
| state | count |
|-------|-------|
| inbox | 120 |
| working | 3 |
| approvals | 2 |
| done | 1623 |
| archived | 10 |
| paused | 0 |

## Last 24h
- **Cadences:** `nightly-review` dispatched both nights — today `6ac492a5-e5d73418` (this run), yesterday `6ac342db-3c8869e3`.
- **Cost:** $0.00 billed. Daily limit $30.00 (governance/budget.yaml); full budget remaining. Yesterday's 4 cost rows were all subscription-billed $0.00 (3× `claude-opus-4-8` dispatch/nightly-review/dashboard-regen steps; 1× codex `gpt-5.6-sol` with `codex_exit=1`). Today: dispatch logged, dashboard-regen in progress.
- **Notable:** nightly dispatcher healthy — preamble OK, pyyaml OK, `sync_skills --check` clean. Daemon-dir drift gate again reports drift (see Anomalies).

## Projects
- **atlas** — Omni-interface foundation + adversarial remediation complete locally on `codex/atlas-enhancements-20260820` (commit 280a67a9 + unstaged remediation diff). Diff >400 lines → project contract requires Daniel review before commit; handoff `handoffs/2026-08-20-atlas-omni-remediation-review.md`. V1 "Hands" wave previously passed all three gates.
- **faceless-youtube** — PARKED, no active work. Repo STATE is stale (2026-07-19); last real activity was the Bricks Variant-D arc in external clone `claude/bricks-variant-vd` (tip 4bc82dc2, pushed).
- **figment** — One resumable `figment_train.py pipeline --creator <id>` drives anchor→…→video with a printed GATE at each gradeable stage; `detail`/`video` are now real gradeable stages; single gate writer (`identity_gate.write_gate_document`). One working card in flight (d126c410, Track 1 replication) and the T3 eye-gate above awaiting operator.
- **kb-ops** — Production VM (`kb`, 100.89.73.118) LIVE on release `e8ac49ad`; daemon-internal schedule tick every 5 min (outbox mode, dirty-checkout skip), `cadence` execution profile live. Ops history linear; live tick proof 2026-09-23.
- **prospecting** — P1–P8 built across worktrees `prospecting-p{1..8}`, **all branches UNPUSHED**. P8 affinity gate 953/953 at HEAD 52067386; live-tested against real desktop store (campaign camp_3147b42db58c4c15), all Gate P8-B criteria green.

## Anomalies
- **Daemon-dir drift (16th consecutive night).** `scripts/sync_daemon_dirs.py` is present on `origin/main` but absent from `origin/ops`, so routines/nightly.md step 2b's literal `--check` on the ops checkout fails (EXIT 2); run via main's copy in refs-fallback mode. Drift = one ops-only file `orgs/kb-ops/workflows/acceptance-run.md` (on ops, not main). Gate reports, never blocks — run continued. 15 open priors in inbox; desktop fix + one human ruling still owed.
- **Stale working card.** `d126c410-9bc54280` (figment Track 1 replication) has been in `working` since boss-session rulings dated 2026-09-03 — well past 48h.
- **Halted card in working/.** `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`) sits in `working/` in terminal state `halted`.
- **Inbox backlog.** 120 cards in `inbox/` (large `wf-*` and `wake-daniel-*` accumulation, including the 15 open daemon-dir wake cards).
