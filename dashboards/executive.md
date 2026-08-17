# Executive Dashboard
_Generated: 2026-08-17 06:39 UTC by dispatcher-cloud_

## Action required
None in `queue/approvals/` (empty). Several **human-owned decision cards** remain parked in `queue/inbox/` awaiting you:
- `6a5e482a` — decide:budget-gate-measures-nothing (**T3**, human-operator)
- `6a605ebb`, `6a6c3d8e`, `6a718533`, `6a7c0ebf` — four wake-me:daemon-dir-drift cards (T1, human-operator), accumulated across prior runs
- `wake-daniel-2026-08-15-sync-daemon-dirs-missing` (T1) and `wake-daniel-2026-07-22-engagement-fold` (T2)

## Queue
| state | count |
|-------|-------|
| inbox | 27 |
| working | 2 |
| done | 542 |
| approvals | 0 |
| archived | 1 |

Inbox breakdown (27): 7 human-owned wake/decide cards (listed above); 4 unowned `audit:weekly-findings*` / `audit-gap` cards from prior weekly audits; 1 unowned `flip delivery-gate warn→block` card; 1 `research:slice-dossier`; and 14 faceless-youtube engagement-fold worker cards (6 `draft:engagement-*`, 2 each of `report:acceptance-p0-{draft,revise,signoff}`, 2 `report:self-lint`) — all inert until a watched session launches them. Working (2): this run's own `nightly-review` card (`6a82ac7b`, in-flight, moves to `done/` at end of run) and the terminal `halted` record `6a6bc3dd` (kb-ops iter-smoke-t2, operator-resolved, parked since 2026-07-30 — not a live stall).

## Last 24h
- **Cadences dispatched:** today (08-17) — `nightly-review` (`6a82ac7b-8a785cee`), cloud tier, 1 card (this run). Weekly-audit not due today. Yesterday (08-16) — nightly-review (`6a81540b`) ran and completed; this run moved its stale `state: done` record from `inbox/` to `done/` (queue hygiene, +1 in done → 542).
- **Cost vs budget:** daily limit $30.00. Today: $0 API-billed (this run mid-flight; all steps subscription claude-* at $0). Yesterday (08-16): $0 API-billed — the one logged step (nightly-review, claude-opus-4-8) was subscription $0. Comfortably under budget.
- **Notable:** clean night — preamble, pyyaml, and `sync_skills --check` all passed (no drift). The daemon-dir drift gate was run via the `origin/main` copy in refs-fallback (script still absent on ops); drift is byte-identical to already-filed card `6a7c0ebf`, so no new wake card.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21), PR #44 merged + prod rolled out; Atlas view live on 127.0.0.1:5317 with live worker passthrough. V2 "Trust" awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset`; Phase 6B first tenth (18/25 slots verified), PAUSED at the P1–P5 human shot-board gate. wells-fargo parked; Poyais published.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence is DORMANT (no scheduler; manual dashboard launch only, gate held in a watched session).

## Anomalies
- **Missing gate script (persisting):** `scripts/sync_daemon_dirs.py` (nightly routine step 2b) still does not exist on `ops` (exit 2, file not found). Ran the `origin/main` copy in refs-fallback: 11-file main↔ops drift (5 main-only, 5 content-differs, 1 ops-only `acceptance-run.md`), **byte-identical to filed card `6a7c0ebf` (2026-08-12)** — no change, so no duplicate wake card filed. A desktop `sync_daemon_dirs.py --sync` from the dashboard-ops worktree is owed. Non-blocking (the gate reports, never blocks dispatch).
- **Daemon-dir wake cards accumulating:** four human-operator `wake-me:daemon-dir-drift` cards (`6a605ebb`, `6a6c3d8e`, `6a718533`, `6a7c0ebf`) plus `wake-daniel-2026-08-15-sync-daemon-dirs-missing` are piling up in inbox — the recurring drift/missing-script issue has no owner picking it up. One desktop pass (restore the script + `--sync`) clears them all.
- Terminal `halted` card `6a6bc3dd` sits in `working/` (operator-resolved codex smoke record, 2026-07-30, ~18 days) — cosmetic; not a live stall.
- Queue hygiene fixed this run: yesterday's completed `nightly-review` card (`6a81540b`, `state: done`) had been left in `inbox/`; moved to `done/`.
