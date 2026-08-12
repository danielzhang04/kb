# Keep-Awake Supervisor Hardening — Design

**Date:** 2026-08-12
**Branch:** `claude/keepawake-hardening`
**Prior art:** `docs/specs/2026-07-20-overnight-keep-awake-design.md`, shipped PR #36.

## Incident (2026-08-12, 01:29 AM)

Four live terminals died overnight when the machine entered Modern Standby. Forensic
chain, from `%LOCALAPPDATA%\kb-keepawake\keepawake.log` and the System event log:

1. Supervisor pid 19748 (started 8/11 14:20, 16h cap = 6:20 AM — cap NOT reached).
2. At **01:29:35** an unhandled exception escaped the supervisor loop:
   `Cannot create a file when that file already exists.` — a `Move-Item -Force`
   collision inside `Write-JsonFileAtomic`, racing a concurrent `-Heartbeat` hook
   rewriting the same lease file. The same collision appears **358 times** in the log
   on the Heartbeat CLI path, where it is caught and benign; it was statistically
   inevitable that it would eventually fire inside the supervisor's own pass
   (`Invoke-SupervisorPass` lease rewrite), which has no try/catch.
3. The supervisor's `finally` block disarmed power management (`power-restored`)
   **while four live leases existed**, logged a misleading `supervisor-stop … exit=0`,
   and died. The CLI caught the escaping exception as `cli-error mode=Supervise`.
4. Standby idle timeout was restored to 1200 s → Modern Standby at 01:53:40, full
   sleep at 02:08:47 → NIC torn down → all four terminals' HTTPS streams timed out
   until lid-open in the morning.
5. Nothing restarts a dead supervisor: only `-Acquire` (SessionStart hook) spawns
   one; `-Heartbeat` is a pure lease-file write. Overnight, no SessionStart fires.

Three independent failures compounded: a racy write primitive, an
exception-fragile supervisor loop, and no recovery path after supervisor death.

## Fix — three layers, defense in depth

### F1. Atomic replace instead of delete-then-create

`Write-JsonFileAtomic` currently finishes with `Move-Item -Force`, which on an
existing destination is delete-then-create — a window in which a concurrent
writer's create collides. Replace with P/Invoke
`MoveFileExW(tmp, dest, MOVEFILE_REPLACE_EXISTING)` (kernel-atomic replace on the
same NTFS volume; the temp file is already written next to the destination).
The module already P/Invokes (`SetThreadExecutionState`) — same pattern, added to
the existing `KbPower.Native` member definition or a sibling type.

Belt-and-braces: retry up to 5 attempts with a growing jittered sleep
(15–55 ms, 30–70 ms, …) on ANY failure of the replace step; on final failure
**throw** (callers decide — see F2; the Heartbeat CLI already catches and exits
0). MoveFileEx returns FALSE on failure — check the return value and throw a
descriptive error; do not let a silent FALSE fake success.

Expected side effect: a **~99.7% reduction** in the 358/log `cli-error
mode=Heartbeat` lines, so heartbeats stop being routinely lost (lost heartbeats
can contribute to premature idle-timeout prunes). This is a reduction, not an
elimination: adversarial review measured a residual 0.27% throw rate under a
5-writer hammer (win32=5, sharing violation), and **residual throws remain
possible under reader contention**. The 3→5 attempt widening (review-1 finding
9) shrinks that residue further but cannot remove it — which is exactly why F2's
loop hardening and the per-lease isolation inside `Invoke-SupervisorPass` treat a
failed write as an ordinary event rather than a fatal one.

### F2. Exception-proof supervisor loop

In `Start-KeepAwakeSupervisor`, wrap the per-iteration work
(`Invoke-SupervisorPass`) in try/catch:

- On exception: log `supervisor-pass-ERROR :: <message>`, count consecutive
  failures, `Start-Sleep $PollSeconds`, continue.
- A successful pass resets the consecutive-failure counter.
- After **10 consecutive** failed passes, exit deliberately (log
  `supervisor-FAILING-persistently -- disarming and exiting`, exit code 2). The
  `finally` restore stays — a broken supervisor must not strand the machine armed;
  with F3 in place a replacement takes over within one hook firing.
- Distinguish exits honestly: crash/persistent-failure exit logs its reason and a
  non-zero code; `exit=0` is reserved for the genuine no-live-leases path.

### F3. Heartbeat watchdog — self-healing supervisor

`-Heartbeat` fires on every tool call of every Claude session. Add to that CLI
branch a cheap liveness check: read `supervisor.pid`; if the file is missing or
the PID is not alive, AND at least one lease file exists, call
`Start-DetachedSupervisor` and log `supervisor-respawned-by-heartbeat`. The
existing named mutex arbitrates any thundering herd (duplicate spawns lose the
mutex and exit — already proven behavior). The stale-arm reconciliation in
`-Acquire` already handles the armed-but-dead case on session start; this covers
the overnight case where no SessionStart ever fires.

Decision logic (`should respawn?`) goes in the module as a pure function
(pidfile state + alive test + lease presence in, bool out) so it is
unit-testable; the CLI stays thin. Perf note: the check is two file stats + one
`Get-Process` on the hot path — negligible against an existing powershell.exe
process spawn per hook.

### Out of scope (recorded, deliberate)

- **Codex VS Code terminals** hold no leases (no hooks) — they ride along on
  Claude leases. Not last night's cause (all four dead terminals held leases).
  Follow-up candidate: a `-Acquire -ProcessId <pid> -Label codex-…` wrapper.
- Battery/DC coverage remains excluded by design (AC only).
- The 16h `MaxHours` cap stays as-is.

## Testing

Pester, extending `scripts/KeepAwake/KeepAwake.Tests.ps1` (76 existing tests must
stay green):

1. **F1:** concurrent-writer hammer — two runspaces/jobs rewriting the same lease
   path via `Write-JsonFileAtomic` for a few hundred iterations: zero exceptions,
   file always parses. Plus unit: replace failure path retries then throws.
2. **F2:** injected pass failure (mock/seam) — supervisor loop survives N<10
   consecutive throwing passes and keeps counting live leases after recovery;
   10 consecutive failures → exit 2, restore called, honest log line.
   (Requires making the pass invocation injectable — a `$script:`-scoped seam in
   the same style as `$script:PowerProvider`.)
3. **F3:** pure respawn-decision function — truth table over
   {pidfile absent/stale/alive} × {leases present/absent}.
4. Live-fire (boss-run, real machine): kill the running supervisor with live
   leases → next tool call respawns it and re-arms within ~1 poll; hammer real
   heartbeats against a running supervisor with zero `cli-error` lines.

## Rollout

Module + CLI change only; no hook config changes (global `~/.claude/settings.json`
untouched). Ship via PR to main; the fix is live for any session started after the
files land (running supervisor keeps old code until it exits — acceptable, F3
covers it on next spawn).
