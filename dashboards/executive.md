# Executive Dashboard
_Generated: 2026-09-24 06:16 UTC by dispatcher-cloud_

## Action required
- **`65d8f246-8a461521`** — figment — _GATE A eye-gate: operator rules creator-001 expansion-02
  blind board (seven axes) so curation to 40 can proceed_ — **T3** (in `queue/approvals/`,
  awaiting human ruling).

## Queue
| state | count |
|---|---|
| inbox | 115 |
| working | 3 |
| approvals | 1 |
| blocked | 0 |
| done | 1612 |
| archived | 10 |

## Last 24h
- **Cadences run:** `nightly-review` — today (card `6ab4bfba-40e8790d`, project kb) and
  yesterday (card `6ab36ee4-e6312b80`, project kb).
- **Cost:** today `$0.00` spent so far; yesterday `$1.88` (four runpod l40s pod-create steps —
  `$0.605392 + $0.868495 + $0.226690 + $0.183246`; the nightly-review model step logged `$0.0`
  under subscription billing). Daily budget `$30.00`; today's remaining `$30.00`.
- **Notable:** dispatcher-cloud nightly run regenerated these dashboards. `preamble.py` OK;
  `sync_skills.py --check` clean (in sync).

## Projects
- **atlas** — Omni-interface foundation + adversarial remediation complete locally on
  `codex/atlas-enhancements-20260820`; remediation diff >400 lines so it awaits Daniel review
  before commit/push. V1 "Hands" wave merged (PR #44) and live; V2 "Trust" is Daniel's go/no-go.
- **faceless-youtube** — PARKED, no active work. STATE.md stale (2026-07-19); real last activity
  was the Bricks Variant-D arc in the external `bricks-arc` clone (`claude/bricks-variant-vd`,
  pushed).
- **figment** — One resumable `pipeline` command drives anchor→…→video with per-stage GATE
  halts; `detail`/`video` now first-class gradeable stages; single gate writer and single
  per-era prompt composer. GATE A eye-gate (card above) awaits operator ruling.
- **kb-ops** — Production VM LIVE on release `e8ac49ad` (PR #204 merged/deployed 2026-09-23).
  Daemon-internal 5-min schedule tick proven live; ops history linear; next drain chain base
  `052c8355`.
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. P8 affinity gate
  953/953 at HEAD `52067386`; live-tested against the real desktop store (campaign
  `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **Stale `working/` cards** (judged by git last-commit, not clone mtime): `d126c410-9bc54280`
  (figment `track1:replicate`, owner `figment-expand`) idle since 2026-09-07 (~17d);
  `6a6bc3dd-5494006b` (kb-ops `iter-smoke-t2`) stranded since 2026-07-30 (~56d). Neither mine to
  sweep.
- **Malformed queue card** `queue/working/d126c410-9bc54280.md`: its `action:` value contains an
  unquoted colon, so the YAML frontmatter fails to parse. Needs its `action:` line quoted. Out of
  nightly-review write scope.
- **`sync_daemon_dirs.py` still main-only (absent on ops)** — the routine's step-2b daemon-dir
  check ran in refs-fallback mode (`git show origin/main:scripts/sync_daemon_dirs.py`): exit 1,
  same single unchanged drift `orgs/kb-ops/workflows/acceptance-run.md` (ops-only). This is a
  chronic issue: 12 dedicated wake-me cards already open (2026-08-15 → 2026-09-23). A DESKTOP
  `sync_daemon_dirs.py --sync --prune` (from the dashboard-ops worktree) is owed, plus a step-2b
  amendment so it stops re-firing. No 13th duplicate card filed (frugality); gate is report-only
  so the run continued.
- **preamble.py** OK; **sync_skills.py --check** clean.
