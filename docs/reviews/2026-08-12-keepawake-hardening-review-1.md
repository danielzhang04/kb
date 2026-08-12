# Adversarial review #1 — keepawake supervisor hardening (d65caf0..602c8b2)

Reviewer: opus subagent (model verified `claude-opus-5` via transcript grep).
Verdict: **FIX-THEN-SHIP**. Boss dispositions appended after each finding as `DISPOSITION:`.

Suite state at review: 87/87 green (Pester 6.0.1).

## Findings

### 1. BLOCKER — F2's try/catch too narrow; Write-KeepAwakeLog throws under contention
`KeepAwake.psm1:40, 846-877`. `Write-KeepAwakeLog` is `Add-Content` to one shared file written by every hook/supervisor/spawn; measured ~48% failure at 3 writers × 200 ms cadence. The call sits INSIDE the new catch block and at 842/871/874; `$pass.LiveCount` (864) and `Test-SupervisorShouldContinueAfterEmptyPass` (870, real I/O) are outside the try. Reviewer REPRODUCED an exception escaping the hardened loop on final code (log locked + pass throw → supervisor died the 08-12 way). Fix: (a) make Write-KeepAwakeLog structurally non-throwing — FileStream append with FileShare.ReadWrite + short retry + swallow; (b) wrap the ENTIRE while body in try/catch.
DISPOSITION: FIX NOW (both a and b).

### 2. BLOCKER — finally not exception-safe; partial disarm possible, mutex/pidfile cleanup skippable
`KeepAwake.psm1:879-886`. `Restore-PowerBaseline` and `Clear-ExecutionStateHold` call Write-KeepAwakeLog; a throw skips pidfile removal, supervisor-stop line, and mutex release. Reviewer proved `supervisor.pid still on disk = True` after escape. Also: inside Restore-PowerBaseline the powercfg writes + armed.json removal happen BEFORE its log line → machine can end disarmed with live leases and no forensic trail. Fix: per-step try/catch in finally; ReleaseMutex/Dispose in nested finally on separate lines.
DISPOSITION: FIX NOW. (Finding 1a's non-throwing logger removes the root of this class; the finally hardening is defense in depth on top.)

### 3. MAJOR — no respawn-storm protection in F3
`keep_awake.ps1:115-118`, psm1:785-795. Heartbeat fires ≥2×/tool call/session; no cooldown/backoff/cap. Non-self-clearing failure states (import error, exec-policy refusal, mutex-held-but-pidfile-gone) → worst case ~57,600 spawns/day + ~5.5 MB/day log growth (no rotation exists) + feedback into finding 1's collision rate. Fix: persist respawn state (timestamp + attempt count); min interval one PollSeconds (60 s) with exponential backoff to a 15-min ceiling; log throttled case once per window. Add size-based log rotation (single generation, rotate at 1 MB).
DISPOSITION: FIX NOW, as specified in the review, including rotation.

### 4. MAJOR — PID-recycling false negative defeats F3
psm1:791-794. Bare-int pidfile + Test-ProcessAlive only → recycled PID = no respawn forever = the outage returns. Fix: store `pid|startTimeTicks`, require both to match; ProcessName filter as extra check; apply same to -Status.
DISPOSITION: FIX NOW. Fold in finding 8 (same file: atomic write via Write-JsonFileAtomic or FileShare-safe IO, move write inside try, FileShare.ReadWrite reads).

### 5. MAJOR — one unwritable lease aborts arming for every lease; can become a permanent exit-2/respawn/disarm cycle
psm1:711-752. No per-lease try/catch; residual Write-JsonFileAtomic throw rate measured 0.27% under 5-writer hammer (win32=5). Persistent unwritable lease → 10 consecutive pass failures → exit 2 → disarm → respawn → repeat, machine unarmed most of the time. Fix: per-lease try/catch counting the lease as LIVE on write failure (fail safe toward armed); arm decision must still run on partial pass.
DISPOSITION: FIX NOW.

### 6. MAJOR — F3's CLI wiring has zero coverage; live-fire not performed
`keep_awake.ps1:115-118`; tests never enter the Heartbeat respawn branch (heartbeat test has no lease). Fix: CLI-level test stubbing/sentineling Start-DetachedSupervisor so the branch executes without a real spawn. Live-fire (plan Task 4) remains a merge gate.
DISPOSITION: FIX NOW (test); live-fire stays gated with the boss after this wave.

### 7. MINOR — watchdog hot path does full lease parse and can DELETE leases
psm1:786 → 152-179. Get-KeepAwakeLeases deletes unparseable leases and now runs per tool call across all sessions; zero-length read classifies as corrupt → live lease deleted. Fix: cheap presence check (`Get-ChildItem -Filter *.lease | Select -First 1`) in the watchdog; corrupt-deletion stays supervisor-only.
DISPOSITION: FIX NOW.

### 8. MINOR — pidfile write non-atomic, outside try, unretried; watchdog reads it constantly
psm1:830-834, keep_awake.ps1:45. Measured 778/800 Set-Content failures against a concurrent reader; ErrorActionPreference=Stop kills the starting supervisor. Fix: FileShare-safe write/read, move inside try.
DISPOSITION: FIX NOW (folded into finding 4's pidfile rework).

### 9. MINOR — spec overclaims "358 cli-errors disappear"; residual 0.27% throw rate
psm1:86-91, spec §F1. Fix: widen retry to 5 attempts with longer jitter AND correct the spec claim to "~99.7% reduction; residual throws remain possible under reader contention".
DISPOSITION: FIX NOW (both).

### 10. MINOR — Set-SupervisorPassInvoker never reset across tests
Tests:1083-1086. Fix: AfterEach restoring production invoker.
DISPOSITION: FIX NOW.

### 11. MINOR — F2 tests issue real SetThreadExecutionState + create real Global\ mutexes; F3 test spawns one real powershell
Tests:1092-1124. Mitigated by finding 2's exception-safe finally (hold cannot leak).
DISPOSITION: ACCEPT — record here, no code change. powercfg is faked; residual risk is a transient ES hold on the Pester host.

### 12. MINOR — F1 concurrency tests flake risk + vacuous reader assertion
Tests:88-121. Fix: retry widening (finding 9) collapses residual rate; strengthen reader test to require >0 successful parsed reads.
DISPOSITION: FIX NOW.

### 13. MINOR — relative-path semantics differ between Set-Content and MoveFileExW
psm1:84-87. Latent only. Fix: normalize via GetUnresolvedProviderPathFromPSPath at function top.
DISPOSITION: FIX NOW (one-liner).

### 14. NIT — respawn success logged unconditionally
DISPOSITION: FIX NOW as part of finding 3 (log "supervisor-respawn-attempt", let next heartbeat confirm).

### 15. NIT — SHA256 not disposed; mutex-name input not normalized
DISPOSITION: FIX NOW (one-liners: dispose; TrimEnd('\','/')+ToLowerInvariant before hashing).

### 16. NIT — GetLastWin32Error read after intervening statements
DISPOSITION: SKIP (reviewer: almost certainly correct; cosmetic).

### 17. NIT — ReleaseMutex/Dispose on one line
DISPOSITION: folded into finding 2.

### Bonus from CLEAN section
Add-Type failure containment is safe but silent: add module-load guard — if `'KbPower.FileNative' -as [type]` is null, Write-KeepAwakeLog a FATAL line.
DISPOSITION: FIX NOW (with the now non-throwing logger).

## Clean surfaces (no action)
KB_KEEPAWAKE_ROOT never set in production (repo-wide grep + settings.json); exit codes 2/3 regress no caller; deadline check cannot be starved (bounded 10×PollSeconds); seam default is production-identical; temp-file cleanup covers all paths (0 strays after 1,500 contended writes); MoveFileEx replace semantics verified (last-writer-wins, no window); 87/87 green.
