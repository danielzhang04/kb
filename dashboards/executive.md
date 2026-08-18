# Executive Dashboard
_Generated: 2026-08-18 06:18 UTC by dispatcher-cloud_

## Action required
None in `queue/approvals/` (empty). Several **human-owned decision cards** remain parked in `queue/inbox/` awaiting you:
- `6a5e482a` — decide:budget-gate-measures-nothing (**T3**, human-operator)
- `6a605ebb`, `6a6c3d8e`, `6a718533`, `6a7c0ebf` — four wake-me:daemon-dir-drift cards (T1, human-operator), accumulated across prior runs; all clear in one desktop `--sync` pass
- `wake-daniel-2026-08-15-sync-daemon-dirs-missing` (T1) and `wake-daniel-2026-07-22-engagement-fold` (T2)
- Unowned triage backlog: `6a80039d` (audit-gap:desktop-cadences-dormant), three `audit:weekly-findings-*` (`6a645395`, `6a6d8e1e`, `6a76c8d8`), and `6a5c7274` (flip delivery-gate warn→block after clean soak)

## Queue
| state | count |
|-------|-------|
| inbox | 17 |
| blocked | 10 |
| working | 1 |
| halted | 1 |
| done | 586 |
| approvals | 0 |
| archived | 1 |

Counts are by card `state`. **working (1)** is this run's own `nightly-review` card (`6a83f8dc`, in-flight — moves to `done/` at run end, taking done to 587). **halted (1)** is the terminal `6a6bc3dd` (kb-ops iter-smoke-t2, operator-resolved codex-resume defect, parked since 2026-07-30 in `working/` — not a live stall). **blocked (10)**: 6 `draft:engagement-*` fold cards + 4 `report:acceptance-p0-{revise,signoff}` workflow cards, all waiting on the desktop worker / a watched session. **inbox (17)**: the 7 human decision/wake cards above, 5 unowned audit/flip cards, and 5 faceless-youtube worker cards (2 `report:acceptance-p0-draft`, 2 `report:self-lint`, 1 `research:slice-dossier`) — all inert until a watched session launches them.

## Last 24h
- **Cadences dispatched:** today (08-18) — `nightly-review` (`6a83f8dc-8a0fee35`), cloud tier, 1 card (this run). Weekly-audit not due today.
- **Cost vs budget:** daily limit **$30.00**. Today: **≈$5.34 API-billed** — three gemini image-gen runs logged by `claude-boss` (W2-partial char-seed $1.876 + W2-slice engine duel $1.730 + W2-slice r2 re-mint $1.730), all from the bricks taste-forensics boss session; the 8 codex worker cards were subscription-billed at $0. Yesterday (08-17): ≈$7.4 API-billed across four bricks A/B engine runs, ~40 codex cards at $0. Comfortably under budget both days.
- **Notable:** clean night — preamble, pyyaml, and `sync_skills --check` all passed (no drift). Of today's 8 codex cards, 7 exited 0 and one (`6a83ea2f`) exited 1 (subscription $0, part of the boss-session bricks A/B batch).

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21), PR #44 merged + prod rolled out; Atlas view live on 127.0.0.1:5317 with live worker passthrough. V2 "Trust" awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset`; Phase 6B first tenth (18/25 slots verified), PAUSED at the P1–P5 human shot-board gate. Heavy image-engine A/B forensics ongoing on `claude/bricks-taste-forensics` (W2-slice gemini-3-pro vs 2.5-flash duels — two forge mechanisms confirmed engine-independent: beat-clause object leak, ground-line loss). wells-fargo parked; Poyais published.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence is DORMANT (no scheduler; manual dashboard launch only, gate held in a watched session).

## Anomalies
- **Missing gate script (persisting):** `scripts/sync_daemon_dirs.py` (nightly routine step 2b) still does not exist on `ops` (exit 2, file not found). Ran the `origin/main` copy in refs-fallback: **11-file main↔ops drift** (5 main-only, 5 content-differs — mostly the faceless-youtube `agents/fyt-*.md` + `workflows/` set — and 1 ops-only `acceptance-run.md`). This has **grown from the 1-file snapshot** on umbrella card `6a605ebb`, whose Evidence/Result I refreshed this run (rather than filing a duplicate). A desktop `sync_daemon_dirs.py --sync` (+ `--prune`) from the dashboard-ops worktree is owed. Non-blocking (the gate reports, never blocks dispatch).
- **Daemon-dir wake cards accumulating:** four human-operator `wake-me:daemon-dir-drift` cards (`6a605ebb`, `6a6c3d8e`, `6a718533`, `6a7c0ebf`) plus `wake-daniel-2026-08-15-sync-daemon-dirs-missing` are piling up in inbox — the recurring drift/missing-script issue has no owner picking it up. One desktop pass (restore the script + `--sync`) clears them all.
- Terminal `halted` card `6a6bc3dd` still sits in `working/` (operator-resolved codex smoke record, 2026-07-30, ~19 days) — cosmetic; not a live stall.
