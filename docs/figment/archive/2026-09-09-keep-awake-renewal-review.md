# Finite keep-awake renewal independent review — 2026-09-09

**Verdict: READY for the bounded one-shot operational use described below.**
This is a private helper review, not evidence of continued process, pod, or
training liveness.

## Reviewed helper

`C:\Users\danie\kb\_private\renew-figment-builtin-training-keep-awake-20260909-v1.py`

SHA-256: `00d17a93f1365003585656754f07c58eba50ddabfde8f64e2bae89210baf111c`

The helper pins the existing keep-awake entry script
(`67920bebcefebbcd37acda67350697be56026829bd624e7182dc354124c3a931`) and
its dynamically imported module
(`e73ac1562f766016234a3e50e295a1ebb70f0f331c9a909536ebee8431ffdfe6`). It
also binds the observed same-user root, supervisor, and train PID/start-tick
identities, rejects PID reuse, and checks both MAIN and Studio `STOP` sentinels.

It is inert without `--execute-once`. When intentionally run, it waits in
chunks of at most 30 seconds until after the original supervisor cap, never
alters the existing root lease, and can invoke exactly one existing
`keep_awake.ps1 -Acquire` call for the live bound train PID. It refuses a live
replacement supervisor, unreadable status, a changed source, a stopped or
reused train target, or insufficient time. The fixed window is after
21:44:10 UTC and ends by the 21:59:30 UTC acquire cutoff, reserving time before
the 22:00 UTC hard end. It rechecks UTC, source hashes, sentinels, and target
identities immediately before acquire.

Independent Sol review found and the final revision repaired stale post-probe
cutoff handling. The final reviewer verdict was READY. Python 3.13 compile,
inert self-test, and an isolated fake-clock/process/status/acquire test passed.
Those tests did not call the real keep-awake API.

## Launch status

Root intentionally launched the reviewed helper at 20:34:42 UTC as hidden PID
35400, start ticks `639245684821214509`. At that observation it was waiting;
no renewal had occurred. A future CLI `acquired` line is only a lease-acquire
acknowledgment, not proof that power is armed or that a replacement supervisor
is alive. Any such postcondition requires a separate `keep_awake.ps1 -Status`
observation. This record makes no claim about later liveness.
