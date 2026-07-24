# Wave A — synthetic acceptance runbook (human-supervised)

**Owner:** Daniel, in a session he is actively watching. **Not** an unattended step.
**Precedes:** the live-fire (`docs/plans/2026-07-20-wave-a-live-fire-runbook.md`). Do this first; only if
every check here is PASS do you proceed to the live-fire.

This proves the whole Wave-A dispatch chain — map → compile → import+approve → `executeApprovedLaunch` →
gated `runAutomatic` → real `claude -p` worker → canonical `## Result` writeback → the real
`defaultReconcileTriggerCard` git mechanics → the `settleFleetCostLedger` post-run seam — on a **synthetic,
low-risk, no-op** run against **throwaway** roots. Nothing here writes real project state.

---

## Why it is safe to run (isolation is code-enforced)

- The harness (`dashboard/server/control/synthetic-acceptance.ts`) `git clone --local`s the repo into a
  temp dir, creates a local `ops` branch there, and **re-points the clone's `origin` at a fresh throwaway
  BARE mirror** — replacing the `origin` that `git clone` set to the real repo. The canonical `## Result`
  writeback and the `defaultReconcileTriggerCard` push therefore land in the throwaway mirror and
  **provably cannot reach the real repo** (the remote is a different repository, not the real one guarded
  only by git defaults). `assertCoordinationRemoteIsolated` aborts the run if the coordination remote ever
  resolves back to the real repo path.
- `DASHBOARD_STATE_ROOT` points at a separate temp dir, so the control-plane state, worktrees, and fleet
  ledger are throwaway too. The harness prints all three throwaway paths (repo / mirror / state).
- The synthetic work order is a single-file write with **no** web / tool / spend / publish intent.
- The harness **refuses** unless `DASHBOARD_EXECUTION_ACTIVATED=1` is already set in its process **and**
  `--confirm-live` is passed. It never sets the gate itself and never touches the live daemon / pm2 env.

## Preconditions (check every one)

1. `python scripts/preamble.py` exits 0 (no `STOP` file; budget OK; `ANTHROPIC_API_KEY` unset in this shell).
2. `kb-codex-runner` scheduled task is **DISABLED** (it stays disabled through this whole wave).
3. You are at the repo root on a clean tree, in a terminal you will watch to completion.
4. `claude` CLI is logged in under subscription auth (no `ANTHROPIC_API_KEY` env var anywhere in this shell).

## Run it (copy-paste)

```bash
# 1. Set the gate FOR THIS SHELL ONLY (never in pm2.config.cjs, never exported to the live daemon).
export DASHBOARD_EXECUTION_ACTIVATED=1

# 2. Drive the synthetic acceptance. --confirm-live acknowledges a real `claude` will spawn.
node --experimental-strip-types dashboard/server/control/synthetic-acceptance.ts --confirm-live
```

## Expected transcript (happy path)

Each line is printed by the harness. **All must be PASS**:

```
PASS  synthetic trigger card minted + committed (throwaway repo) — <card-id>
PASS  gate ON: runAutomatic + controlBroker constructed
PASS  dispatchClaimedCard launched the run (real claude -p spawned) — outcome=launched status=201
PASS  run reached a terminal state — state=succeeded
PASS  synthetic stage committed the exact approved output on canonical lineage
PASS  canonical card written to queue/done with a ## Result — 1 done card(s) with ## Result
PASS  trigger card reconciled out of inbox/working — reconciled=true
PASS  fleet cost ledger row emitted (billing:subscription) — 1 row(s)

ACCEPTANCE PASS — 8/8 checks
```

The `claude -p smoke` is inside `dispatchClaimedCard launched … (real claude -p spawned)` +
`run reached a terminal state — state=succeeded`: a real `claude -p` child ran under subscription auth,
wrote its one file, and the engine settled the stage to `succeeded`. If that check is `state=failed`,
inspect the throwaway repo path the harness prints before re-running.

## Fault injection (D7) — run each, confirm the expected line/state

These are performed against the **throwaway** roots the harness prints (or a fresh harness run). Drive each
through the control-plane store/route the same way the daemon would; assert the outcome, then move on. None
of these touch real state.

| # | Fault | How to inject | Expected result / transcript |
|---|---|---|---|
| 1 | **Daemon restart mid-run** | Kill the harness process after `launched` but before terminal; re-run `dispatchClaimedCard` for the same card id (same throwaway repo/state). | The idempotent replay returns **200** (`outcome=replayed`), the trigger card is **reconciled** (never re-dispatched forever), and the run is not duplicated. `PASS  trigger card reconciled out of inbox/working`. |
| 2 | **Stop** | While the stage is running, call `cancelAutomatic({subject, runRef, idempotencyKey, reason})`. | Run transitions to `stopped`; the worker process tree is killed; a `stopped` terminal state is observed; no fleet row for an unsettled stage. |
| 3 | **Retry** | After a `failed` stage, re-launch with `predecessorRunRef=<failed runRef>` and the matching `expectedPredecessorVersion`. | New run created; predecessor must be quiescent (`succeeded/failed/stopped`) or you get **409 `retry-predecessor-not-quiescent`**. On success a fresh attempt runs. |
| 4 | **Reroute** | On a running/failed stage, call the store `rerouteAttempt` with a new `{runtime, model, idempotencyKey}`. | A new attempt supersedes the old under the same stage; the old attempt is superseded, not duplicated; idempotent on the same key. |
| 5 | **HumanRequest round-trip** | Launch a synthetic with a `## …` that trips a governance gate (e.g. an `external-publication` intent), so `executeApprovedLaunch` returns **202 `waitingHuman`**; then resolve the Human Request `approved` and re-drive. | 202 with an open Human Request; after `approved` + re-drive, the run releases and proceeds. `outcome=gated`→ then reconciled on the follow-up 200. |
| 6 | **Publication fault** | Make the canonical commit fail (e.g. point `opsGit` at a repo whose push is rejected / read-only queue dir) for one launch. | Run enters `reconcile-required` / `waiting-human` (never a partial publish); a `Launch reconciliation required` Human Request is created; **no** fleet row for the unpublished run. Re-drive after clearing the fault reconciles by `runRef`. |

Cross-checks that must hold across ALL faults:

- The **trigger card never spins forever**: any terminal-or-parked run reconciles the trigger card exactly
  once (the review-fixed 200/replayed path).
- Fleet cost rows are `billing: subscription`, `usd: 0.0` — never an invented dollar amount.
- No write ever lands outside the throwaway repo / throwaway state root.

## Teardown

- The harness deletes its throwaway dirs on a clean PASS. On any FAIL it leaves them and prints the paths —
  inspect, then `rm -rf` them yourself.
- **Unset the gate in your shell**: `unset DASHBOARD_EXECUTION_ACTIVATED`. The gate must never persist into
  a non-watched session, and it is never written into `pm2.config.cjs`.
- Re-enable **nothing** recurring. `kb-codex-runner` stays DISABLED. The live daemon's gate remains unset.

## Exit criteria

`ACCEPTANCE PASS — 8/8` on the happy path **and** every fault row above shows its expected result. Only then
proceed to `docs/plans/2026-07-20-wave-a-live-fire-runbook.md`.
