# Schedule-dispatch tick (kb-dispatch.timer)

Ruling: `queue/inbox/2c3d4e5f-708192a3.md` (decide:vm-dispatch-tick-source), approved by Daniel
2026-09-17. Fixes the 2026-09-16 finding: a dashboard-stored schedule (`self-lint-report`, cron
`20 5 * * *` ET, id `96db76e4`) was armed but never fired, because nothing on the VM invoked
`scripts/dispatch.py`. The dispatcher Routine is an agent cadence, not a clock — it cannot launch
itself.

## What fires, and how often

`kb-dispatch.timer` fires `kb-dispatch.service` on `OnCalendar=*:0/5` — every 5 minutes, on the
hour boundary (`:00`, `:05`, `:10`, ...). `Persistent=true`: a tick missed while the VM was down
fires once on the next boot rather than being silently skipped until the next boundary.

`kb-dispatch.service` is a `Type=oneshot` unit that runs, as the `kb-dashboard` user/group (the
same identity `kb-dashboard.service` already runs as):

```
flock -n /run/kb-dispatch/tick.lock \
  python3 -B /opt/kb-releases/current/scripts/dispatch.py --tier cloud --agent dispatcher-cloud
```

`dispatch.py`'s `main()` calls `dispatch_stored_schedules`: it reads the daemon's live schedule
snapshot over the Unix socket (`scripts/schedule_store.py` ->
`/run/kb-dashboard/schedules.sock`), and for each **armed** schedule whose cron has a due
occurrence, claims it (optimistic-concurrency CAS on the schedule's `version`), writes the queue
card, appends the dispatch-ledger row, and advances the daemon's claim/advance state machine
through `card-saved` -> `ledger-appended`. `release_dependents()` (the `depends-on` queue-card DAG
release pass) runs first, unconditionally, on every tick.

## Exactly-once / overlap handling

Two independent guards, either one alone is sufficient:

1. **systemd**: a `Type=oneshot` unit will not start a second instance while the first is still
   running; a timer firing during an in-flight tick is coalesced, not queued.
2. **`flock -n`**: belt-and-suspenders for anything outside systemd's own serialization (a manual
   `systemctl start kb-dispatch.service`, a second timer). Non-blocking (`-n`): a lock conflict
   fails that tick immediately rather than queuing a second run behind the first.

Underneath both, the **daemon's own claim/advance state machine is what actually makes a repeated
attempt at the same occurrence a no-op**, not dispatch.py's local ledger dedup alone: a schedule's
`nextAt` only advances after a successful claim, and a claim already past `card-saved` or
`ledger-appended` returns that phase directly without re-writing the card or re-appending the
ledger row (`scripts/dispatch.py:dispatch_claimed_occurrence`). Proven end-to-end over the real
Unix-socket server in `tests/test_schedule_store.py:test_double_tick_dispatches_the_due_occurrence_exactly_once_over_the_real_socket`
and across every crash boundary in
`test_all_claim_crash_boundaries_replay_once_through_real_socket`.

## Failure / retry

A failed tick (dispatch.py exits non-zero, or the flock is contended and skips) logs to the
journal. The **next** scheduled tick (at most 5 minutes later) retries — no exponential backoff,
per the ruling.

## Observability

```
systemctl list-timers kb-dispatch.timer        # next/last elapse, activation status
journalctl -u kb-dispatch.service               # last tick's output ("dispatched N card(s)")
journalctl -u kb-dispatch.service -n 50 --no-pager
systemctl status kb-dispatch.service            # last exit code
```

## Disable

```
systemctl disable --now kb-dispatch.timer
```

Disarming does not touch already-claimed occurrences or the schedules themselves (those stay
armed on the dashboard); it only stops new ticks from firing. Re-enable with
`systemctl enable --now kb-dispatch.timer`.

## Sandbox posture

Same `User=`/`Group=`/`ReadOnlyPaths=` as `kb-dashboard.service`. `ReadWritePaths=/var/lib/kb/ops`
only — narrower than the dashboard's own `/var/lib/kb/state /var/lib/kb/ops`, because
`scripts/dispatch.py` only writes `queue/` cards and `ledgers/` rows inside the ops checkout; it
never touches `DASHBOARD_STATE_ROOT`. No network access, no new capability grants.

## Provisioning

`deploy/bootstrap_vm.py`'s `provision_dispatch_timer()` installs both unit files
(`deploy/systemd/kb-dispatch.service`, `deploy/systemd/kb-dispatch.timer`) root-owned 0444,
`daemon-reload`s, and `enable`s (never `--now`) the timer — called from both `bootstrap()` (fresh
VM) and `upgrade()` (converging an already-provisioned VM, the path that applies to the current
prod host). `deploy/validate_vm_runtime.py`'s `validate_dispatch_units()` runs unconditionally
inside `kb-dashboard.service`'s own static ExecStartPre check: absence of the pair is tolerated (a
VM upgraded before this ruling landed keeps booting normally), but a drifted or hand-edited pair
fails that check loudly.

Starting the timer on the live prod VM is a separate, gated production-window step — see the
preflight remote shell lines in the task report / handoff for this change.
