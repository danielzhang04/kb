# Adversarial re-review #2 — fix wave (602c8b2..8e7a38e)

Reviewer: same opus subagent, resumed (model verified `claude-opus-5`).
Verdict: **FIX-THEN-SHIP**. Suite 117/117 independently confirmed.

Part 1: all 13 FIX-NOW findings from review-1 verified CLOSED — findings 1/2 (blockers)
re-attacked empirically against the fixed code: supervisor returned rc=2 with no escape
under (a) exclusively-locked log + throwing passes, (b) locked log + throwing power
provider; pidfile removed, mutex released, `Write-KeepAwakeLog` swallowed an exclusive
lock. Legacy-pidfile transition prediction verified: bounded ~67 wasted mutex-loser
spawns / ~134 log lines until the old supervisor exits; no disarm risk (losers exit
before the try/finally).

Part 2 findings, with boss `DISPOSITION:` lines:

### 2.1 MAJOR — respawn throttle fails open when respawn.json can't persist
psm1:980-1010, 1028-1040. Save swallows failures; Get returns empty (Attempts=0) on read
failure; gate requires Attempts>0 AND LastAttempt non-null → unpersistable state = every
heartbeat spawns (measured 40/40 allowed with the file locked). Correlated with exactly
the disk/AV/contention conditions that break the supervisor. Second trigger: swallowed
Parse failure leaves LastAttempt=null → same bypass. Also a live flake vector for the
end-to-end throttle test.
Fix: Save returns success/failure, deny spawn on persist failure; when Attempts>0 but
LastAttempt null, fall back to the state file's LastWriteTime instead of bypassing.
DISPOSITION: FIX NOW, as suggested.

### 2.2 MAJOR — startup-failure disarm with live leases; 900s ceiling unlinked to standby timeout
psm1:1099, 1148-1157, 966. A supervisor failing before its first pass (e.g. pidfile write
throws) disarms unconditionally in finally with live leases (measured: armed True→False,
standbyidle 0→1200, lease live), then the watchdog retry window grows to 900s vs the
1200s standby idle — 300s margin, hardcoded, no relation to the baseline value.
Fix (both): (a) skip the disarm in finally when the loop never completed a pass AND
Test-AnyKeepAwakeLeaseFile is true (backstops: stale-arm reconciliation on next Acquire,
MaxHours cap, watchdog respawn); (b) derive the ceiling as min(900, standbyidle_ac / 3)
from the armed baseline (fallback to PowerDefaults when unarmed/unknown).
DISPOSITION: FIX NOW, both (a) and (b).

### 2.3 MINOR — fail-live is unbounded: a poisoned lease keeps the machine armed forever
psm1:830-837. Parseable JSON with unparseable heartbeat throws in Update-LeaseActivity
every pass → counted LIVE forever; prune branches unreachable; bounded only by 16h cap
cycles. Fix: after N consecutive failures for the same lease, fall back to
Test-ProcessAlive-only semantics (prune if dead) with a loud log line.
DISPOSITION: FIX NOW — N=3, track consecutive failures per label in supervisor process
memory (a hashtable; no new files), loud `lease-pass-DEGRADED` line on fallback.

### 2.4 MINOR — log rotation blocked while any writer holds the log
psm1:72, 89. Logger opens FileShare.ReadWrite without Delete → MoveFileExW rename blocked
under load (measured: no rotation while held, works idle). Fix: open with
ReadWrite -bor Delete.
DISPOSITION: FIX NOW (one-liner).

### 2.5 MINOR — throttle read-modify-write not atomic across processes
Six simultaneous heartbeats → 2 spawns not 1; bounded by burst width; aggregate
protection holds.
DISPOSITION: ACCEPT — bounded; a global mutex is not worth the hot-path cost.

### 2.6 NIT — Clear-SupervisorRespawnState issues Remove-Item on a normally-absent path every heartbeat
DISPOSITION: FIX NOW (gate on Test-Path; free).

### Sentinel Add-Content NIT
Sentinel writes via Add-Content — future concurrent tests asserting line counts would
flake; sequential today.
DISPOSITION: ACCEPT (test-only surface).

Clean: sentinel seam cannot reach production (requires both env vars; KB_KEEPAWAKE_ROOT
set nowhere in production); Confirm-KeepAwakeRoot non-throwing; deviation-note-6 path
resource-clean (the safety half is 2.2).

Outstanding merge gate: plan Task 4 live-fire on the real machine.
