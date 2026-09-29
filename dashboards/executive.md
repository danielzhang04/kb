# Executive Dashboard
_Generated: 2026-09-29 06:22 UTC by dispatcher-cloud_

## Action required
- `65d8f246-8a461521` — figment — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — kb — wake:human-decision — **T1**
- **13 open `sync-daemon-dirs` wake-me cards** in inbox (2026-08-15 through 2026-09-25) — desktop fix owed: restore `scripts/sync_daemon_dirs.py` to `ops` and rule on the `orgs/kb-ops/workflows/acceptance-run.md` drift. Tonight's recurrence was NOT filed as a 14th duplicate (inbox saturated; standing decision). See Anomalies.

## Queue
| state | count |
|---|---|
| inbox | 117 |
| working | 3 |
| approvals | 2 |
| done | 1618 |

_(working includes this run's `6abb58ee-6903610f` nightly-review card, in-flight → done at run close; the other two are the long-stranded cards under Anomalies.)_

## Last 24h
- **Cadences run:** `nightly-review` fired 2026-09-29 (card `6abb58ee-6903610f`, this run) and 2026-09-28 (card `6aba08c2-25befb04`).
- **Cost:** $0.00 spent against the $30.00/day ceiling (`governance/budget.yaml`) — all steps on subscription billing log $0.0. Budget fully remaining.
- **Notable:** preamble OK; `sync_skills.py --check` clean (no skills drift). Daemon-dir drift-check ran only in cloud refs-fallback mode (script still absent from `ops`) and reported the same single-file drift as prior nights.

## Projects
- **atlas** — Adversarial remediation ready for Daniel review on `codex/atlas-enhancements-20260820` (foundation `280a67a9` + unstaged re-reviewed diff); Atlas 235 passed, security/code re-review PASS. Diff >400 lines, so contract requires Daniel review before commit; remote push also awaits Daniel's `origin` approval.
- **faceless-youtube** — PARKED, no active work in flight. STATE.md stale (dated 2026-07-19); last real activity was the Bricks Variant-D arc tracked outside the main checkout.
- **figment** — One resumable `figment_train.py pipeline` command drives anchor→dataset→smoke→train→tester→gen→detail→video, halting at each gradeable stage for a ruling; `detail`/`video` now first-class stages; single gate writer (`identity_gate.write_gate_document`).
- **kb-ops** — Production VM LIVE on release `e8ac49ad` (PR #204 collector merged 2026-09-23, deployed 05:55Z). Daemon-internal 5-min schedule tick proven live 2026-09-23; ops history linear.
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. P8 affinity gate 953/953 at HEAD `52067386`; live-tested against real desktop store (campaign `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **2 stale `working/` cards (both >48h):**
  - `6a6bc3dd-5494006b` (kb-ops, owner codex-worker, `iter-smoke-t2`) — state `halted` but still parked in `working/` since 2026-07-30. Needs sweep to a terminal state.
  - `d126c410-9bc54280` (figment, owner figment-expand, `figment:track1:replicate`) — state `working` since 2026-09-07; likely stranded.
- **Daemon-dir drift-check gate degraded:** `scripts/sync_daemon_dirs.py` present on `origin/main` but absent on `origin/ops`, so the routine's literal `--check` fails (EXIT=2); ran via refs-fallback. Drift: single ops-only file `orgs/kb-ops/workflows/acceptance-run.md`. 13 open wake-me cards track this — desktop reconcile owed. No new card filed tonight (standing decision to stop duplicating on a saturated inbox).
- **Inbox backlog:** 117 cards in `queue/inbox/` (many `wf-*` and long-open wake-me cards) — a triage/sweep pass is owed.
