# Final review #3 — fix wave 2 (b47471c..9e37c73)

Reviewer: same opus subagent, resumed (model verified `claude-opus-5`).
Verdict: **SHIP**. Suite 129/129 independently confirmed.

All review-2 findings empirically closed:
- 2.1 fail-closed throttle: locked-respawn.json hammer now 0/40 spawns (was 40/40);
  unparseable last_attempt bypass closed by mtime fallback (0/10); persist-success
  strictly precedes spawn authorization.
- 2.2a: five-path truth table verified — startup crash + live lease stays ARMED
  (`supervisor-disarm-SKIPPED`); orderly no-live-leases exit still disarms even with
  stale lease files ($completedPass dominates); exit-2 after a completed pass still
  disarms; no-lease crash still disarms; throwing lease check falls back to disarm.
  $completedPass latches after invoker return, before LiveCount dereference — correct.
- 2.2b: ceiling min(900, standbyidle/3)=400s on this machine → 3 respawn attempts per
  sleep window (was 300s margin); corrupt/absent baseline falls back to PowerDefaults;
  first interval also bound (worker deviation, endorsed).
- 2.3: poisoned+live owner stays armed with loud `lease-pass-DEGRADED action=keep`;
  poisoned+dead owner pruned and unarmed; counter sweep leak-free; tests honest
  (reviewer's own first probe was defeated by the cpu-activity healing branch that the
  worker's tests already accounted for).
- 2.4: rotation fires under an open writer (was blocked); FileShare = ReadWrite|Delete.

Residual findings — dispositions:
- 4.1 MINOR: `supervisor-respawn-DENIED reason=throttle-state-unpersistable` has no
  dedup; a permanently-unwritable respawn.json → ~57k lines/day, and working rotation
  (single generation) then destroys forensic history during the failure being diagnosed.
  Fix: mtime-based rate limit like the throttle notice. DISPOSITION: FOLLOW-UP (PR body).
- 4.2 NIT: fail-closed throttle blocks watchdog recovery iff respawn.json alone is
  unwritable AND supervisor already disarmed after a completed pass. Accepted trade vs
  the 40/40 storm. DISPOSITION: RECORDED.
- 4.3 NIT: degraded-prune near-unreachable via Invoke-SupervisorPass (ordinary
  process-dead prune wins); defense in depth, correctly tested. DISPOSITION: RECORDED.
- 4.4 NIT: poisoned lease + live (possibly recycled) PID holds arm indefinitely — the
  deliberate fail-live semantic; self-clearing; could require StartTime<acquired if it
  ever matters. DISPOSITION: RECORDED.
- 4.5 NIT: MaxHours<=0 (manual only) takes cap path pre-first-pass and skips disarm.
  Fix: MaxHours -lt 1 entry guard. DISPOSITION: FOLLOW-UP (PR body).
- 4.6 NIT: in-flight writer's line lands in rotated file. Correct trade. RECORDED.

Merge gate remaining at time of review: plan Task 4 live-fire (executed by boss after
this review — results recorded in the PR).
