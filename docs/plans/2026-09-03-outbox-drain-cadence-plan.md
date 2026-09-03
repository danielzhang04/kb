# Outbox drain cadence plan (D-1 follow-up) — 2026-09-03

Status: PROPOSED, awaiting Daniel's ruling (option B needs a credential ruling; the scheduled task runs on his desktop).
Author: opus architect (read-only), commissioned by the boss session. Source of truth for the mechanism citations: origin/main at b2b87649.

1. Daemon classifies every write; `queue/ ledgers/ traces/ memory/ dashboards/ handoffs/` + `orgs/*/STATE.md` = coordination — `dashboard/server/write/branch.ts:62-86`.
2. In `publication: 'outbox'` mode the ops commit is made locally and NOT pushed — `branch.ts:1064-1105` calls `recoverUnspooledCoordinationCommits` before and after the commit.
3. Each commit becomes one bundle + canonical manifest in `/var/lib/kb/state/outbox/ready`, and the anchor `refs/kb-outbox/spooled` advances — `dashboard/server/write/outbox.ts:73,85-158,161-184`.
4. Admission reads the spool: pending = ready manifests with no `receipts/<id>.json`; degrade on `manifest-invalid`, `pending >= 100`, or oldest pending age >= 24 h — `outboxStatus.ts:107-135,147,149-164`.
5. Degraded → every `new-work` route 503s — `control/admission.ts:17-26`, wired at `http/surface.ts:361-371`, consumed at `write/routes.ts:97,145,231`, `control/routes.ts:632,731`, `workflows/routes.ts:1275`, `agents/routes.ts:326`.
6. Outbound leg: desktop scp's `ready/` + `receipts/` and the VM ops HEAD — `scripts/promote_vm_outbox.py:205-235`; validates closed manifests + digests at `:238-299`.
7. The spool must form ONE parent-topological chain starting exactly at `--trusted-ops-head` — `:302-323`, re-asserted in `main` at `:919-920`.
8. Any bundle touching an INSTRUCTION path (`queue|memory|dashboards|handoffs|orgs/*/STATE.md`, `:20`) needs a `kb-ops-approver` ssh signature over the whole chain digest — `:367-424`; an unsigned run writes the request and exits 3 (`:774-806, 926-936`).
9. Each bundle is quarantined, mode/path-checked, cherry-picked onto a fresh clone and pushed to `origin/ops` — `:326-364, 634-684` (push at `:677`); the receipt is written durably at `:446-463`.
10. Return leg on the VM (root, under `flock`): `deploy/apply_ops_reconciliation.py:486-664` — requires quiescence (`:498-500`), installs receipts (`:520`), refuses unreceipted (`:527`) / dirty (`:529`) / moved-HEAD (`:532`), validates the reconciled range, then `git reset --hard target` (`:603`), moves the anchor (`:604`), archives to `promoted/` (`:605-618`). Drivers: `scratchpad/drain-step1.ps1` / `drain-step2.ps1` (chain base hardcoded at step1:14).

## 2. Why the fleet pause exists — and what actually needs it
- **The outbound half needs no lock at all.** `promote_vm_outbox.py` only *reads* the VM (scp + `rev-parse`) and writes to `origin/ops`. A concurrent VM write during the scp yields a torn snapshot that fails closed at `:919-920` ("VM source head does not equal the closed outbox chain") — abort-and-retry, not damage.
- **The return half is the pause.** Two separable reasons:
  - **(a) the ops-checkout reset.** `git reset --hard` (`:603`) + anchor CAS (`:604`) on `/var/lib/kb/ops` while the daemon may be mid `add/commit/update-ref` in that same checkout is the genuinely destructive race. The `activeGit` / `service-cgroup` / `pty` blockers in `release/quiescence.ts:14-24` exist for this.
  - **(b) snapshot identity.** `head != expected_source_head` (`:532`) and "unreceipted outbox items" (`:527`) mean any coordination write between the desktop snapshot and the VM apply aborts the run. The *signature* is tighter still: it binds `chainDigest` + `lastCommit` (`promote_vm_outbox.py:367-381`), so one new bundle invalidates a signature Daniel already made — hence step1:96-97 "DO NOT touch the VM".
- **Can a ledger-only drain run without a lock? Yes for the parts that matter — but not as the script is written today.** The degrade keys on *receipt files existing* (`outboxStatus.ts:116-124`), not on the checkout being reset. `receipts/` has exactly one writer (the reconciler; the daemon only appends to `ready/`, `outbox.ts:113-157`) and receipts land via atomic `os.replace` (`promote_vm_outbox.py:446-463`), so **installing receipts is safe with no lock and no quiescence**. It is entangled with the reset only because both live inside `apply_reconciliation`.
- Caveat on skipping the reset indefinitely: (i) the chain never truncates, so `--trusted-ops-head` stays pinned at an ancient base and every drain re-validates the whole history; (ii) the VM stops receiving the main→ops `agents/**` + `orgs/*/workflows/**` mirror it reads (see the `RECONCILED` comment, `apply_ops_reconciliation.py:22-46`) — the exact drift that wedged this leg before.

## 3. Three candidates

### A. Scheduled unsigned drain of ledger-only bundles + per-class age ceiling (ledger 7 d, instruction 24 h)
- **Works because** ledger-only chains already promote unsigned (verified in production today) and the outbound leg needs no lock.
- **Fatal flaw as stated:** the spool is a *strict chain*; `order_from_parent` (`:302-323`) and the parent-order-prefix rule (`:702-708`) forbid promoting bundle N while N-1 is unpromoted. One `queue/` card move — the queue bridge makes these constantly — poisons every later ledger bundle. "Ledger-only drain" therefore only helps while the fleet is idle.
- **The per-class ceiling is independently right** and cheap: the alarm should fire when a *human* is owed something, not when the machine is.
- Cost: a Windows Scheduled Task on Daniel's box (the only holder of the ops push credential). Machine asleep = no drain; the 7 d ledger ceiling absorbs that.

### B. VM pushes its own `vm-outbox/<date>` branch
- **Fixes the root cause** (the VM cannot push) and makes the alarm self-clearing: "receipted" becomes "my commit is an ancestor of `origin/vm-outbox/<date>`", which the VM can check itself — the daily degrade disappears with no desktop action.
- Changes: `outbox.ts:16,75-83` gains a third `CoordinationPublication` (`'push-branch'`); `branch.ts:1064-1105` pushes `HEAD:refs/heads/vm-outbox/<date>` instead of spooling; classification (`branch.ts:62-86`) is unchanged. The desktop merges with the SAME validator (`_validate_source_claims` + the COORDINATION allowlist, `apply_ops_reconciliation.py:381-403`) run over `ops..vm-outbox/<date>` before a `--no-ff` merge, so nothing lands on ops unvalidated. The instruction signature can become a PR review instead of `ssh-keygen -Y`.
- Costs: the least-trusted writer now **holds a push credential**, and its confinement moves from our code into a GitHub ruleset restricting that actor to `refs/heads/vm-outbox/*` — must be verified on this plan; a plain deploy key is repo-wide write and would be a real regression. CLAUDE.md's credential ceiling makes this a Daniel ruling, not an engineering call. The VM-side reset still exists.

### C. Drop the age degrade for ledger-only bundles; degrade only on instruction bundles or a pending-count ceiling
- One-file change in `outboxStatus.ts` plus an `isInstructionPath` mirroring `promote_vm_outbox.py:20`.
- **Alone it is near a no-op**: queue/ card moves are instruction paths and dominate traffic, so 24 h still fires daily.
- Widening it to "pending-count only" removes the liveness alarm entirely — the spool is the sole record of VM coordination writes, and a silent multi-week divergence from `origin/ops` is worse than a 503. Do not ship C on its own.

## 4. Recommendation — split the alarm from the ceremony (A's ceiling + a lock-free receipt path); park B behind a ruling
The recurring cost is the *pause*, not the promotion. Ship a receipt-only write-back that never touches `/var/lib/kb/ops`, and let the fleet-pausing reset ride the deploy ceremony (§d of the preflight runbook) weekly instead of daily.

**Day 1**
1. `deploy/apply_ops_reconciliation.py` — add `--receipts-only`: install returned receipts (`:504-520`), archive the fully-receipted *prefix* into `promoted/` (the `:605-618` logic, prefix only), write the new chain base to `/var/lib/kb/state/outbox/CHAIN_BASE`, return. Skip `readiness()` (`:498-500`), the clean/HEAD checks (`:529-532`), the bundle fetch, `reset --hard` (`:603`) and the anchor CAS (`:604`) — none are reachable in this mode. Tests in `tests/test_apply_ops_reconciliation.py`: receipts install under a non-quiescent readiness stub; a HEAD advanced mid-run is tolerated; no ref is written; archiving stops at the first gap.
2. `scripts/promote_vm_outbox.py` — add `--no-reconcile` (promote + push receipts back via `--receipts-only`; skip `create_return_bundle` / `upload_and_apply_reconciliation`, `:817-875`) and read `--trusted-ops-head` from the VM's `CHAIN_BASE` when not given. Tests in `tests/test_promote_vm_outbox.py`.
3. `dashboard/server/write/outboxStatus.ts` — per-class ceilings: `DEFAULT_LEDGER_MAX_AGE_MS = 7 d`, `DEFAULT_INSTRUCTION_MAX_AGE_MS = 24 h`; reasons split into `ledger-age-limit` / `instruction-age-limit`; `pending >= 100` and `HARD_SPOOL_CEILING` unchanged. Derive `isInstructionPath` in `branch.ts` beside `COORDINATION_PREFIXES` (`:62-86`) as a subset built from the same list, and pin it against `promote_vm_outbox.py:20` in a test — the same construction discipline as `RECONCILED` in `apply_ops_reconciliation.py:41-47`. Extend `outboxStatus.test.ts:33-53`.

**Day 2**
4. Windows Scheduled Task `kb-outbox-drain` (every 4 h, desktop): `promote_vm_outbox.py --no-reconcile ...`. Exit 0 = drained; exit 3 = signature owed → write a `queue/inbox` card for Daniel rather than fail; any other exit = alert. Replaces the hardcoded `$CHAINBASE` in `drain-step1.ps1:14`. No systemd unit — the VM must never run this.
5. Runbook §e in `docs/runbooks/2026-09-03-vm-agent-launch-preflight.md`: "Unattended: `kb-outbox-drain` promotes and receipts every 4 h with no lock and no quiescence. Manual + signed: only when a bundle touches an instruction path (24 h ceiling). Fleet-paused reset: with the deploy ceremony, ≤ weekly." Update §g P7 to point here.
6. Optional, **needs adversarial review before shipping — not on the critical path**: narrow INSTRUCTION so a *byte-identical* card move inside `queue/` (a D+A pair whose added blob oid equals the deleted blob oid) promotes unsigned. `parse_raw_diff` (`promote_vm_outbox.py:184-202`) already parses those oids and currently discards them. This is what would make the unattended drain cover the common case rather than only an idle fleet.

**Invariants that must hold**
- **I1 — no unsigned instruction bundle ever reaches ops.** Enforcement stays exactly `require_instruction_approval` (`:384-424`); the scheduled task holds **no** `kb-ops-approver` key and cannot be given one, so an instruction chain can only exit 3.
- **I2 — a drain never runs while a run is mid-write.** Outbound: torn snapshots fail closed at `:919-920`. Receipt-only: single-writer `receipts/` + atomic `os.replace` (`:446-463`). Full reconcile: keeps the quiescence gate (`apply_ops_reconciliation.py:498-500`) and `head == expected_source_head` (`:532`) unchanged.
- **I3 — the unattended path mutates nothing in `/var/lib/kb/ops`.** No `reset`, no `update-ref`, no branch write. That single property is what removes the lock requirement; if a future change adds a ref write to `--receipts-only`, quiescence must come back with it.
- **I4 — receipts are written in chain order, never leaving a gap**, and archiving stops at the first gap; otherwise the parent-order-prefix rule at `:702-708` and `_validate_promoted_deltas` (`apply_ops_reconciliation.py:445-484`) break.
- **I5 — one leaf defines "instruction".** The TS predicate and `promote_vm_outbox.py:20` must be pinned equal by test; drift would let an instruction bundle age under the 7 d ledger ceiling and silently defeat I1's alarm.
- **I6 — the reset still happens.** Chain length and VM catalog drift are both unbounded without it; the weekly deploy ceremony owns it, and `CHAIN_BASE` must be re-read after each one.
