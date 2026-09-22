# Schedule-dispatch tick (daemon-internal)

Ruling: `queue/inbox/2c3d4e5f-708192a3.md` (decide:vm-dispatch-tick-source), approved by Daniel
2026-09-17, **amended 2026-09-21** (review finding B-1). The original design — a systemd timer
(`kb-dispatch.timer`) driving `scripts/dispatch.py` every 5 minutes as its own unattended process —
was **withdrawn** before ever being started on prod: `dispatch.py` writes queue cards and ledger rows
as bare, uncommitted filesystem changes (no git step, no `KB_COORDINATION_PUBLICATION` awareness), and
on the VM (`KB_COORDINATION_PUBLICATION=outbox`, origin `disabled://`) the first tick with anything due
would have left an untracked file that no outbox bundle carries — tripping
`deploy/apply_ops_reconciliation.py`'s dirty-checkout guard and freezing EVERY later coordination write
until a human cleaned it up by hand. `dashboard/server/control/queueBridge.ts`'s
`publishBridgeWakeCard` documents the identical failure mode for a different caller
(`agent_runner.py#wake_me`) that hit exactly this before being fixed.

## What fires, and how often

There is no separate systemd unit, account, or provisioning step. The **dashboard daemon itself**
runs a schedule tick on an interval, from `dashboard/server/schedules/tick.ts`
(`startScheduleTick`/`runScheduleTick`), wired in `dashboard/server/index.ts#buildApp` alongside the
human-request sweeper and merge-poll timers.

- **Gated on publication mode.** The tick only ever fires when
  `KB_COORDINATION_PUBLICATION=outbox` (the VM) — `resolveScheduleTickIntervalMs` (`server/index.ts`)
  returns `0` (disabled) in any other mode, regardless of the interval env var. Desktop/dev never
  ticks.
- **Interval:** `DASHBOARD_SCHEDULE_TICK_MS`, default `300000` (5 minutes, matching the withdrawn
  timer's `OnCalendar=*:0/5`). `DASHBOARD_SCHEDULE_TICK_MS=0` disables it even in outbox mode. The VM
  unit (`deploy/systemd/kb-dashboard.service`) refuses drop-ins (see the sshd/prod-window guard
  posture elsewhere in this repo for why), so if this ever needs to be set on prod, the env line goes
  directly in the unit fragment, not a drop-in.
- **Does not fire immediately on boot** — only on the first interval elapse after the daemon has
  finished startup/hydration (`runScheduleBootMigrations` completes in `start()` before `buildApp`,
  where the tick timer is created, ever runs).

## What one tick does

1. Take a BASELINE snapshot via `git status --porcelain=v1 -z --untracked-files=all` **before**
   touching anything — including before `dispatch.py` is ever invoked (2026-09-21 amendment, re-review
   finding B-1b). If the baseline is non-empty — the ops checkout already has a tracked or untracked
   change sitting in it, from some OTHER writer, at the moment this tick fired — the whole tick is
   **skipped**: `dispatch.py` is never run, nothing is reverted, deleted, or committed, and every
   baseline path is left exactly as found. This is logged every tick it recurs (see Observability
   below) because it is an operator-visible alarm, not a routine no-op: the checkout needs a human to
   look at whatever left it dirty.
2. Only when the baseline is clean: inside `withOpsTransaction` (the daemon's single-writer
   ops-checkout lock — no other coordination write in this process can interleave), spawn
   `scripts/dispatch.py` as a subprocess:
   ```
   python3 -B /opt/kb-releases/current/scripts/dispatch.py --tier cloud --agent dispatcher-cloud
   ```
   argv and cwd exactly as the withdrawn systemd unit ran it — cwd is the **ops checkout**
   (`surfaceCtx.repoRoot`, `/var/lib/kb/ops` on the VM), so `dispatch.py`'s own `Path.cwd()` resolves
   queue/ledgers against live coordination state; the script path resolves from
   `defaultPlatformRoot()` (`DASHBOARD_PLATFORM_ROOT`, `/opt/kb-releases/current` on the VM unit) — the
   same release-root resolution every other python shell-out in this codebase uses
   (`createPythonScheduleClaimRenderer`, `runPythonSync`). This reuses `dispatch.py`'s existing
   cron/claim logic unchanged — it is **not** reimplemented in TypeScript.
3. Take an AFTER snapshot the same way, and re-derive exactly what changed as `after − baseline`
   (never the raw after-snapshot alone — a single post-run status read cannot tell "dispatch.py wrote
   this" apart from "this was already dirty," which is exactly the bug B-1b fixed). Since the baseline
   is guaranteed empty on this path (a dirty baseline already short-circuited the tick in step 1), every
   changed path is this tick's own. If **anything** outside `queue/**` or `ledgers/dispatch/**` changed,
   the whole tick is refused: every changed path (tracked and untracked) is reverted (`git checkout --`
   / delete), nothing is committed, and the refusal is logged. This is a defensive check against a
   `dispatch.py` bug or an out-of-band write racing in between the two snapshots — `dispatch_stored_schedules`
   and `release_dependents` are only ever supposed to touch those two prefixes.
4. Otherwise, commit exactly that path set through `commitPreparedCoordination` — the SAME governed
   writer `publishBridgeWakeCard` uses for the wake-me card fix, with the SAME publication-mode
   handling and the SAME asymmetric failure discipline: a failure **before** the commit lands cleans
   up (revert everything, log, let the next tick retry); a failure **after** the commit lands (e.g. the
   outbox spool step) never deletes a now-tracked path — it only logs loudly with the commit sha, since
   deleting would re-stage exactly the dirty-checkout freeze this whole design exists to prevent.

### Clearing a `skipped: checkout-dirty-before-tick` alarm

This means something other than this tick left the ops checkout dirty — most likely a bare
`cards.save`/`ledger.append` write from a different in-process path, or an interrupted prior
transaction. The tick will keep skipping (and keep logging) every interval until a human resolves it:

1. `journalctl -u kb-dashboard | grep schedule-tick` to see the `first=<path>` and, if truncated,
   `git -C /var/lib/kb/ops status --porcelain=v1` for the full list.
2. Decide whether the dirty path(s) are a legitimate uncommitted write in flight (wait, or commit them
   through the normal governed-write path) or genuine debris (clean up by hand, matching the same
   dirty-checkout guard the drain's own reconciliation step already documents for this failure shape).
3. Once the checkout is clean, the next tick proceeds normally — no restart or manual re-arm needed.

## Exactly-once / overlap handling

- **In-process flag**: `startScheduleTick` skips a tick entirely if the previous one is still running
  — no queuing, no overlap.
- **`withOpsTransaction`**: even without the flag, the daemon's single-writer ops lock would serialize
  two overlapping ticks; the flag exists so a slow tick doesn't queue a redundant `dispatch.py` spawn
  behind it.
- Underneath both, `dispatch.py`'s own claim/advance state machine (unchanged by this ruling) is what
  makes a REPLAYED tick a no-op for an individual occurrence: a claim already past `card-saved` or
  `ledger-appended` returns that phase directly rather than re-writing the card or re-appending the
  ledger row (`scripts/dispatch.py:dispatch_claimed_occurrence`). Proven end-to-end over the real
  Unix-socket server in
  `tests/test_schedule_store.py:test_double_tick_dispatches_the_due_occurrence_exactly_once_over_the_real_socket`.

### `nextAt` advance (F7 fix, 2026-09-22)

A schedule's own `nextAt` (the field `dispatch_stored_schedules`'s `covered_next_at` gate reads to
decide whether an occurrence is still due) advances the first time that occurrence's claim reaches
phase `card-saved` — `dashboard/server/control/store.ts#advanceScheduleOccurrence`. Before this fix
**nothing in the production dispatch path ever advanced it**: the only code that wrote
`schedule.nextAt` was `completeStoredScheduleOccurrence`, reached only when a RUN minted from the
card later transitions to a terminal lifecycle (`transitionRun`) — and `dispatch.py` never calls that
at all (its own state machine stops at `ledger-appended`), while a launched run can sit non-terminal
indefinitely (e.g. parked behind an unrelated activation gate, independent of the schedule itself). A
cron row's `nextAt` could therefore stay pinned at a stale value forever, and every tick re-reported
`due=1` for the same already-dispatched occurrence (p13 rehearsal finding F7 — the standing
`self-lint-report` daily cadence, `18 3 * * *`). The `card-saved` boundary was chosen deliberately: the
trigger card is durably on disk by then, so the schedule's due pointer can move on regardless of
whether a run is ever minted from it or how long that run takes to finish. The later
`completeStoredScheduleOccurrence` write on run-terminal still fires when reached and is a no-op (same
value) against an already-advanced `nextAt` — the two paths do not conflict.

## Failure / retry

A failed tick (subprocess non-zero exit, a foreign-path refusal, a pre-commit git failure) commits
nothing and logs an error line; the checkout is always left clean. The next scheduled tick (at most
`DASHBOARD_SCHEDULE_TICK_MS` later) retries — no exponential backoff, matching the original ruling.

## Observability

```
journalctl -u kb-dashboard | grep schedule-tick
```

Each tick logs exactly one summary line:

```
schedule-tick: due=<n> dispatched=<n> paths=<n> committed=<sha|none>
```

`due`/`dispatched` are parsed from `dispatch.py`'s own `"dispatched N card(s)"` stdout line (every
entry it returns was both due and processed in the same call, so there is no separate "due" count to
report). `paths` is the number of relpaths committed this tick (`0` on a no-op or a refused tick).
`committed` is the coordination commit sha, or `none`. Any failure additionally logs a second line
(`schedule-tick error: ...`) with the detail.

A tick that skipped because the baseline was already dirty (see "Clearing a
`skipped: checkout-dirty-before-tick` alarm" above) logs a **different** line shape instead of the
summary line above — every tick it recurs, since it is a standing alarm, not a one-off:

```
schedule-tick: skipped checkout-dirty-before-tick paths=<n> first=<path>
```

`paths` is the number of dirty baseline paths found; `first` is the first one (for a quick look without
a separate `git status`).

## Disable

Set `DASHBOARD_SCHEDULE_TICK_MS=0` in the unit fragment (`deploy/systemd/kb-dashboard.service`;
drop-ins are refused, so this line goes directly in the unit) and restart `kb-dashboard.service`.
Disabling does not touch already-claimed occurrences or the schedules themselves — they stay armed;
it only stops new ticks from firing.

## Sandbox posture

There is no separate unit, so there is no separate sandbox to reason about: the tick runs inside the
`kb-dashboard.service` process itself, under that unit's existing `User=`/`Group=`/`ReadOnlyPaths=`/
`ReadWritePaths=` (`/var/lib/kb/ops` `/var/lib/kb/state`). The subprocess it spawns
(`scripts/dispatch.py`) only ever writes `queue/` cards and `ledgers/dispatch/` rows inside the ops
checkout, enforced by this module's own path-scope guard (step 2 above) rather than by systemd
`ReadWritePaths` narrowing, since there is no longer a separate unit to narrow.

## Provisioning

None. No account, unit file, or `bootstrap_vm.py`/`validate_vm_runtime.py` step exists for this
anymore — the withdrawn `kb-dispatch.service`/`kb-dispatch.timer` pair, `provision_dispatch_timer()`,
and `validate_dispatch_units()` were all removed as part of the 2026-09-21 amendment. The tick ships
and activates with every dashboard release; there is nothing to provision separately, and nothing to
start as a gated production-window step — it starts (or stays disabled) with the daemon, governed
entirely by `KB_COORDINATION_PUBLICATION` and `DASHBOARD_SCHEDULE_TICK_MS`.
