# Wave A — supervised live-fire runbook (human steps only)

**Owner:** Daniel, in a session he is actively watching. **Human steps only — no code, no coordination
writes from the build.** This is the LAST step of Wave A.

**Do not start** until `docs/runbooks/2026-07-20-wave-a-acceptance-runbook.md` is fully green (7/7 happy
path + every fault row). The synthetic acceptance is the gate to this.

The live-fire runs ONE real, low-risk (T1) cadence — `self-lint-report` — through the governed executor on
the **real** dashboard state, Daniel watching, and stops. Per D0-A it rides the existing launch route (the
canonical card is minted by the launch path); the `queueBridge` is exercised only by the synthetic
acceptance, not here.

---

## Preconditions (verify every one, in order)

1. **Acceptance green.** T7 acceptance passed 7/7 and every fault row matched. If not, stop.
2. **Preamble clean.** `python scripts/preamble.py` exits 0: no `STOP` file, budget under the daily guard,
   `ANTHROPIC_API_KEY` unset everywhere in the daemon's environment.
3. **`kb-codex-runner` DISABLED.** Confirm the scheduled task is disabled (it stays disabled through and
   after this wave). `schtasks /query /tn kb-codex-runner` shows `Disabled`.
4. **`claude` subscription auth.** The daemon host's `claude` CLI is logged in under the subscription; no
   `ANTHROPIC_API_KEY` in the daemon process env (the worker adapter strips it regardless).
5. **Clean tree, watched terminal.** You are at the repo root, tree clean, watching the dashboard + logs.
6. **The definition is present.** `orgs/kb-ops/workflows/self-lint-report.md` exists (id `self-lint-report`,
   profile `producer`, one stage `report`, action `report:self-lint`, risk `T1`, target
   `orgs/kb-ops/output`). It parses + compiles (verified at build).

## The flip (Daniel-only, one line, watched session)

The activation gate is Daniel's alone. Set it for the daemon you are about to watch — **not** committed into
`pm2.config.cjs`, **not** exported into any other session:

```bash
# In the daemon's own environment, in the session you are watching:
export DASHBOARD_EXECUTION_ACTIVATED=1
# then (re)start ONLY this watched daemon instance so it constructs the executor:
#   node --experimental-strip-types dashboard/server/index.ts    (or your watched pm2 instance)
```

Confirm at boot: the daemon logs it is listening; the executor is now constructed (gate on). Nothing
recurring was enabled — only this one daemon instance now has the gate.

## Launch the cadence (one run, via the launch route)

Launch the `self-lint-report` workflow **once** through the existing workflows launch route — the dashboard
UI "Launch" action for `self-lint-report`, or an authenticated `POST /api/workflows/self-lint-report/launch`
from your watched session. The launch path mints the canonical card, publishes it, and (gate on) hands
Manager + Worker startup to the automatic executor.

Do **not** launch anything else. Do **not** file additional cards. One run.

## What to watch (live)

- A `runRef` is created; publication transitions `publishing → published`.
- A lifecycle event: "approved run published; automatic executor owns Manager and Worker startup".
- A real `claude -p` worker child spawns (one), reads the repo read-only, and writes exactly one report to
  `orgs/kb-ops/output/self-lint-report-<today>.md`.
- The stage settles to `succeeded`; the run reaches `succeeded`.

## Success checks (all must hold)

1. **Canonical `## Result` + done.** The minted canonical card carries a `## Result` and has transitioned to
   `done` in `queue/done/` (written by the untouched canonical integrator inside the ops transaction).
2. **One report, nothing else.** `git status` shows exactly the new `orgs/kb-ops/output/self-lint-report-<today>.md`
   (plus the queue/ledger/audit coordination writes). No other repo file changed, moved, or deleted.
3. **Fleet ledger row.** `ledgers/cost/dashboard-engine-<today>.tsv` has one new row for this run with
   `billing = subscription` and `usd = 0.0` (subscription reports $0 — a derived zero, never invented).
4. **Audit trail.** The `control-run-launch` audit row is present with the run's `runRef` and
   `policyBaseCommit`.

If all four hold, the live-fire passed. Wave A is complete.

## Abort / rollback (if anything drifts)

At the first sign of anything unexpected — a second worker, a write outside `orgs/kb-ops/output`, a stuck
`publishing` state, budget movement, or any prompt to handle a credential/spend/publish:

1. **Stop the run.** Use the dashboard Stop control (or `cancelAutomatic` for the `runRef`). The worker
   process tree is killed.
2. **Unset the gate and restart the daemon inert:**
   ```bash
   unset DASHBOARD_EXECUTION_ACTIVATED
   # restart the watched daemon — it now constructs no executor and can spawn no claude
   ```
3. **Confirm inert.** The restarted daemon boots gate-off: no broker/engine, `/healthz` 200, no executor
   fields. (This is the same inert posture the T6 boot smoke asserts.)
4. Leave the partial run's canonical card / Human Requests in place for inspection; reconcile by `runRef`
   later. Do **not** retry unattended.

## After the live-fire (re-enable NOTHING recurring)

- **Unset the gate** in the daemon session: `unset DASHBOARD_EXECUTION_ACTIVATED`, restart inert. The gate
  is never written into `pm2.config.cjs`; the daemon's default posture stays byte-for-byte inert.
- **`kb-codex-runner` stays DISABLED.** Re-enable it only later, deliberately, as a separate decision.
- **No cadence, no poller, no schedule is turned on by this wave.** The queue bridge is not wired into the
  daemon; the executor exists only while Daniel holds the gate in a watched session. Wave A ends here.
