# Executive Dashboard
_Generated: 2026-09-15 06:15 UTC by dispatcher-cloud_

## Action required
- **[T3] figment — GATE A eye-gate** (`65d8f246-8a461521`, action `GATE A eye-gate — operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed`). Awaiting operator/human decision; blocks figment curation to 40.

## Queue
| state | count |
|-------|-------|
| inbox | 58 |
| working | 3 |
| approvals | 1 |
| blocked | 0 |
| done | 1581 |
| archived | 10 |

## Last 24h
- **Cadences run:** `nightly-review` dispatched today (`6aa8e214-d5fb0ac9`, project kb) and executed by dispatcher-cloud; one `nightly-review` ran yesterday (`6aa79134-afb1f906`).
- **Cost vs budget:** $0.00 API-billed today; daily ceiling $30.00 (`governance/budget.yaml`) → ~$30.00 remaining. All fleet steps ran on subscription billing (logged 0.0).
- **Notable results:** dashboards regenerated; `sync_skills --check` in sync; `sync_daemon_dirs --check` still reports drift (see Anomalies); preamble OK.

## Projects
- **atlas** — Omni-interface foundation (branch `codex/atlas-enhancements-20260820`, commit `280a67a9`) plus an independently re-reviewed adversarial remediation diff, all local. Diff exceeds 400 lines → project contract requires Daniel review before commit; remote push blocked pending approval.
- **faceless-youtube** — PARKED, no active work. `STATE.md` stale (2026-07-19); real last activity was the Bricks Variant-D arc in external clone `kb-clones/bricks-arc` (branch `claude/bricks-variant-vd`, pushed).
- **figment** — Slim single-command gated pipeline + creator-002 acceptance delivered (964 tests, HEAD `abc91610`, pushed). Train-first LoRA trigger fix landed but NOT re-tested; orphan pod incident (~$16 worst-case) unverified against RunPod billing.
- **kb-ops** — VM dashboard (`kb-dashboard.service`) STOPPED since 2026-09-06 (hydrate crash: validator join not keyed by run). Fix PR #173 (`claude/provenance-fix`) reviewed MERGEABLE but confirmed still OPEN/unmerged; recovery not yet run.
- **prospecting** — P1–P8 built across worktrees `prospecting-p{1..8}`, all branches UNPUSHED. P8 affinity gate 953/953 at HEAD `52067386`; live-tested against real desktop store (campaign `camp_3147b42db58c4c15`, all Gate P8-B criteria green).

## Anomalies
- **Stale working/ cards (>48h):** `d126c410-9bc54280` (figment:track1:replicate) untouched since 2026-09-07; `6a6bc3dd-5494006b` (kb-ops iter-smoke-t2) is state `halted` and has sat in working/ since 2026-07-30 — both need sweeping.
- **Daemon-dir drift (recurring):** `sync_daemon_dirs --check` exits 1 — ops-only file `orgs/kb-ops/workflows/acceptance-run.md` present on `ops` but not `main`; the checker script itself is absent from `ops` (run via `main`'s refs-fallback copy). Desktop `--sync` owed. Wake cards `wake-daniel-2026-08-15/-08-30/-09-10/-09-15-sync-daemon-dirs-*` all open.
- **kb-ops dashboard down:** service stopped 9 days; fix PR #173 open, unmerged, recovery not run.
- Preamble failures: None.
