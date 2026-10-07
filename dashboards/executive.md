# Executive Dashboard
_Generated: 2026-10-07 06:24 UTC by dispatcher-cloud_

## Action required
Two cards await a human ruling in `queue/approvals/`:
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) before curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — wake:human-decision — **T1**

## Queue
| state | count |
|-------|-------|
| inbox | 120 |
| working | 3 |
| approvals | 2 |
| done | 1624 |
| archived | 10 |

## Last 24h
- **Cadences dispatched:** `nightly-review` on 2026-10-06 (card `6a492a5-e5d73418`) and 2026-10-07 (card `6ac5e503-b0dd66b8`, this run).
- **Cost:** $0.00 spent today; 2026-10-06 logged 3 cost rows all at $0.00 (subscription steps). Budget remaining: **$30.00 of $30.00** daily ceiling.
- **Notable:** This nightly run executed via the PR-fallback path — the session could not check out `ops` directly (permission classifier), so coordination work is on `claude/ops-sync-2026-10-07` cut from `ops` HEAD (`054c4158`). Preamble OK, no STOP file, skills-drift check clean.

## Projects
- **atlas** — Omni-interface foundation + adversarially-reviewed remediation complete locally on `codex/atlas-enhancements-20260820` (`280a67a9` + unstaged diff); diff >400 lines, so project contract requires Daniel's review before commit. V1 "Hands" previously merged (PR #44) and live.
- **faceless-youtube** — PARKED, no active work in flight. STATE stale (2026-07-19); real last activity was the Bricks Variant-D arc, tracked in an out-of-checkout clone.
- **figment** — One resumable `pipeline` command drives anchor→dataset→smoke→train→tester→gen→detail→video with per-stage gates; recent consolidation (single gate writer, single prompt composer, plan-time budget preflight, ledger precedence). One GATE A eye-gate approval pending (see Action required).
- **kb-ops** — Production VM (`kb`, 100.89.73.118) LIVE on release `e8ac49ad` (PR #203/#204 merged Sept 2026). Daemon-internal 5-min schedule tick; ops history linear.
- **prospecting** — P1–P8 built across integrated worktrees, all branches UNPUSHED. P8 affinity gate 953/953 at HEAD `52067386`; live-tested against the real desktop store (campaign `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **Routine references a missing script.** `scripts/sync_daemon_dirs.py` (nightly step 2b health gate) does not exist in the repo and has no history — the mirror check could not run. Non-blocking per the routine; flagged for repair. `sync_skills.py --check` ran clean.
- **Environment blocked the normal `ops` path.** This session's permission classifier denied `git checkout ops` ("Modify Shared Resources"), so the run used the sanctioned PR-fallback (branch cut from `origin/ops`, coordination changes proposed via PR). Last night (2026-10-06) took DIRECT-PUSH, so this is a change in this session's environment.
- **Stale cards in `working/`.** `6a6bc3dd-5494006b` (iter-smoke-t2 / codex-worker) untouched since 2026-07-30; `d126c410-9bc54280` (figment:track1:replicate / figment-expand) untouched since 2026-09-07 — both well past 48h.
- **Malformed card.** `d126c410-9bc54280` has invalid YAML frontmatter (an unquoted colon inside its `action` value), so `cards.py` cannot parse it; it needs quoting before any tool can act on it.
