## 2026-07-20 — Task 8: full-system verification of overnight keep-awake

- ROOT CAUSE (why this feature exists): this machine supports only Modern Standby (S0), not
  legacy S3. On lid close, Windows tears down the NIC as part of Adaptive Connected Standby
  (network hardware is powered off to save battery even though the CPU can still run
  background tasks). A streaming Claude Code API response over that torn-down NIC stalls
  rather than erroring, so a session can silently sit dead for hours and only "resume" when
  the lid re-opens and the NIC comes back. `ES_SYSTEM_REQUIRED` alone does not fix this — it
  prevents idle sleep but does nothing about the AC lid-close action, which is the actual
  trigger. The fix has to touch the lid-close power setting itself (AC only), not just hold
  a wake lock.
- MUTEX-SINGLETON RATIONALE: multiple workers (hook-fired `-Acquire` calls, `agent_runner.ps1`)
  can race to notice "no supervisor is running" and each spawn one. The design accepts this
  race deliberately rather than trying to prevent it: every `-Acquire` unconditionally spawns
  a detached supervisor, and each supervisor immediately tries to take a named OS mutex
  (`Global\kb-keepawake-supervisor`). Only the winner proceeds; every loser logs
  `supervisor-exit reason=another-supervisor-holds-mutex` and exits at once. This is simpler
  and more robust than a check-then-spawn guard (which has its own TOCTOU race) — checking
  first is exactly the race being avoided, so the code doesn't check first at all.
- WORKED: full round-trip verified end to end on the real machine (not mocked) — acquired a
  lease pinned to an explicit long-lived `-ProcessId`, confirmed via direct registry read
  (`HKLM:\...\PowerSchemes\<scheme>\...\5ca83367-...` → `ACSettingIndex`) and `powercfg /query`
  that lid/standby/hibernate all flip to 0 on arm, then released and confirmed an exact
  restore (lid=1, standby=0x4b0/1200, hibernate=0x384/900) once the supervisor's next ~60s
  poll ran. No drift from the true originals across the round trip.
- WORKED: crash recovery matches the designed-for state exactly. Killing the supervisor
  process (`Stop-Process -Force`) while armed leaves the powercfg change in place (it's an OS
  setting, not tied to the process) — `armed.json` survives because only a graceful exit's
  `finally` block clears it; a hard kill skips that entirely. Running `-Repair` afterward
  restored the exact original values and cleared `armed.json`.
- OBSERVATION (not a defect, but non-obvious — future agents should not "fix" this): after a
  supervisor crash + `-Repair`, two artifacts are deliberately NOT cleaned up by `-Repair`
  itself: the stale `supervisor.pid` file (a hard-killed process never reaches the `finally`
  that removes it) and any lease file whose owner process is still alive. `-Repair`'s only job
  is `Restore-PowerBaseline`; it does not touch leases or the pid file. This is correct by
  design for the real scenario (session still alive, supervisor died) — the next `-Acquire`
  will adopt the existing `armed.json` rather than re-baseline over it, and will pick up the
  still-live lease as a genuine signal to stay armed. It only looks like a leak when the lease
  belongs to a throwaway test process, which is what I had to explicitly `-Release` and clean
  up by hand during this verification.
- OBSERVATION: `-Status`'s `supervisor:` line reports `pid=<n> alive=False` (not `none`) after
  a hard-killed supervisor, because it only checks `Test-Path` on the pid file, not liveness —
  this is more informative than the Task-8 brief's stale expectation of a bare `none`, and is
  fine as-is; the brief predates this and several other fixes (it still says 30 tests; the
  real count is 57 as of `5d06ad5`).
- WORKED: suite is 57/57 passed with pristine output in every invocation context tried this
  session — direct Windows PowerShell 5.1, and PowerShell invoked through the Bash tool (which
  itself shells out via Git Bash). No flakes, no environment-dependent failures observed
  (the task brief specifically warned one such test had slipped through earlier in this
  project's history; not reproduced here).
- REMAINS: the real acceptance test (overnight run, lid closed, AC power, Daniel confirms the
  session survives) cannot be automated and was out of scope for this verification pass —
  hand-off to Daniel is being delivered by the controller directly, not by this agent.
- REMAINS: DC (battery) handling is an intentional non-goal of the whole feature — do not add
  it later without a deliberate design decision; battery must keep sleeping normally.
- PROCESS NOTE: the GateGuard "[Fact-Forcing Gate]" hook described in this task's environment
  notes did not actually fire on the first Bash or PowerShell call in this session — worth
  keeping in mind that its trigger conditions are narrower than "first Bash/Write ever," in
  case a future agent expects it and is surprised when it's silent.
