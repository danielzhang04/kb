# Executive Dashboard
_Generated: 2026-09-16 06:13 UTC by dispatcher-cloud_

## Action required
- **queue/approvals/65d8f246-8a461521.md** — project `figment`, action `GATE A eye-gate — operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed`, risk-tier **T3**. Awaits operator ruling.
- **PR #173 (`claude/provenance-fix`)** — kb-ops dashboard recovery. Root-caused + reviewed MERGEABLE, still OPEN/unmerged; the VM dashboard service has been STOPPED since 2026-09-06 and recovery cannot run until this merges. Human merge owed.
- **sync_daemon_dirs desktop fix** — 8 open wake cards (2026-08-15 → 2026-09-16). Script missing from `ops`; single-file drift on `orgs/kb-ops/workflows/acceptance-run.md`. Desktop reconciliation from dashboard-ops worktree owed.

## Queue
| state | count |
|-------|-------|
| inbox | 74 |
| working | 2 |
| approvals | 1 |
| done | 1582 |

## Last 24h
- Cadences run: `nightly-review` dispatched 1 card today (2026-09-16); this run.
- Cost: today **$0.0000** of $30.00 daily limit (no API-billed steps yet). Yesterday $0.3346 (runpod:l40s pod-create; nightly-review logged $0.0 subscription).
- Notable: nightly dispatch healthy; sync_skills check clean; sync_daemon_dirs gate ran in cloud refs-fallback mode (script absent on ops).

## Projects
- **atlas** — Omni-interface foundation + adversarial remediation complete locally on `codex/atlas-enhancements-20260820`; remote push blocked pending Daniel's approval of origin. V1 "Hands" wave merged (PR #44) and live; V2 planning is Daniel's go/no-go.
- **faceless-youtube** — PARKED, no work in flight. STATE.md stale (2026-07-19); real last activity is Bricks Variant-D arc in external clone `claude/bricks-variant-vd` (pushed).
- **figment** — One resumable `pipeline` command drives anchor→…→video with per-stage gates; `detail`/`video` now real gradeable stages; single gate-writer + single prompt-composer consolidations landed. Track-1 replication card `d126c410` in flight; GATE A eye-gate awaiting operator (see Action required).
- **kb-ops** — VM dashboard service STOPPED since 2026-09-06 (hydrate validator bug on release 39197cf5). Fix PR #173 MERGEABLE but unmerged; recovery not yet run.
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. P8 affinity gate 953/953 at HEAD 52067386; live-tested against real desktop store, all Gate P8-B criteria green.

## Anomalies
- **sync_daemon_dirs.py absent from `ops`** for the 8th consecutive night; gate runs only via `main`'s copy in refs-fallback mode. Single-file drift: `orgs/kb-ops/workflows/acceptance-run.md` (ops-only). Wake card written 2026-09-16.
- **kb-ops dashboard down 10 days** — service STOPPED since 2026-09-06, recovery blocked on unmerged PR #173.
- **working/6a6bc3dd-5494006b** sits in `queue/working/` with terminal `state: halted` (codex-worker iter-smoke-t2) — not swept.
- **working/d126c410-9bc54280** (figment track1 replicate) carries approvals dated 2026-09-03; likely long-running — verify liveness.
