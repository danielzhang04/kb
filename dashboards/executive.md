# Executive Dashboard
_Generated: 2026-09-17T06:08:37Z by dispatcher-cloud_

## Action required
- **figment · T3 · `65d8f246-8a461521`** — GATE A eye-gate: operator must rule
  creator-001 expansion-02 blind board (seven axes) before curation to 40 can proceed.
  Awaiting human ruling in `queue/approvals/`.

## Queue
| state | count |
|-------|-------|
| inbox | 80 |
| working | 2 |
| approvals | 1 |
| done | 1585 |

_(working = 1 genuinely in flight + 1 `halted`-terminal card still parked in `working/`; see Anomalies.)_

## Last 24h
- **Cadences run:** nightly-review (2026-09-17, card `6aab838e-d35a481b`, dispatcher-cloud) —
  this run. Prior beat 2026-09-16 (`6aaa3347-14a77965`).
- **Cost:** today $0.00 spent; yesterday (2026-09-16) $6.20, all `runpod:l40s`
  pod-create steps (figment Track-1 replication). Budget $30.00/day → ~$30.00 remaining today.
- **Notable results:** dispatcher released 1 nightly-review card; dependent-release pass
  touched 2 workflow cards. preamble + sync_skills `--check` both clean (in sync).

## Projects
- **atlas** — Omni-interface foundation complete locally on `codex/atlas-enhancements-20260820`;
  adversarial remediation diff (>400 lines) awaiting Daniel review before commit/push.
- **faceless-youtube** — PARKED, no active work; STATE stale (last real activity was the
  Bricks Variant-D arc in an out-of-tree clone).
- **figment** — Single resumable `pipeline` command drives anchor→…→video with per-stage gates;
  `detail`/`video` now first-class gradeable stages; one canonical gate writer. Track-1
  replication card in flight; GATE A eye-gate awaiting operator (see Action required).
- **kb-ops** — VM dashboard service (`kb-dashboard.service`) STOPPED since 2026-09-06 (hydrate
  validator crash on release 39197cf5); recovery fix is PR #173 (`claude/provenance-fix`,
  reviewed mergeable) — still OPEN/unmerged, recovery not yet run.
- **prospecting** — P1-P8 built across worktrees, all branches UNPUSHED; P8 affinity gate
  953/953 green, live-tested against real desktop store.

## Anomalies
- **Missing script `scripts/sync_daemon_dirs.py`** on ops — the nightly routine's step-2b
  daemon-mirror `--check` could not run (file not found). Wake-me card filed to `queue/inbox/`.
  Gate reports only; dispatch was not blocked.
- **Halted card in `working/`** — `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`, codex-worker)
  is `state: halted` (terminal) but still parked in `queue/working/`; not yet archived.
- **kb-ops dashboard down** — service failed since 2026-09-06; PR #173 open/unmerged, recovery
  not run (surfaced under Projects; human merge required).
- Card filesystem mtimes are all clone-time (fresh cloud checkout), so no reliable in-`working/`
  age signal; staleness judged from card content, not mtime.
