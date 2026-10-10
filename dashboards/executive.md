# Executive Dashboard
_Generated: 2026-10-10 06:24 UTC by dispatcher-cloud_

## Action required
Two cards await a human ruling in `queue/approvals/`:
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) before curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — wake:human-decision: desktop coordination tier degrading (dormant desktop cadences; `daemon-dirs-sync` + `grades-reconcile` not running; grades/activity ledgers frozen since 2026-07-21) — **T1**

Plus the long-open daemon-dir mirror drift: canonical card `6a605ebb-d86dff79` (refreshed in place this run — 6th consecutive night unchanged) + **15 historical `wake-daniel-*-sync-daemon-dirs-*` cards** still awaiting a human consolidation pass. The owed fix is a desktop action. See Anomalies.

## Queue
| state | count |
|-------|-------|
| done | 1629 |
| inbox | 120 |
| working | 2 (both stranded — see Anomalies) |
| approvals | 2 |
| archived | 10 |
| blocked | 0 |
| paused | 0 |

## Last 24h
- **Cadences:** `nightly-review` dispatched 2026-10-10 (card `6ac9d849-2a9a4189`, this run) — and every day this week (10-04 → 10-10). `weekly-audit` dispatched 2026-10-10 (card `6ac9d849-00f41034`, on its weekly:sat schedule). Both cloud cadences executed and marked `done` this run.
- **Cost:** $0.00 billed today vs **$30.00** daily limit → **$30.00 remaining** (subscription steps log $0.00).
- **Notable:** preamble OK; skills mirror in sync (`sync_skills --check` EXIT 0); dashboards regenerated. Weekly audit found the two cloud cadences healthy and the two desktop cadences dormant (already carded — no duplicates filed). Daemon-dir mirror drift unchanged (canonical card refreshed in place).

## Projects
- **atlas** — Omni-interface foundation + independently re-reviewed adversarial remediation complete **locally** on `codex/atlas-enhancements-20260820` (`280a67a9` + unstaged diff >400 lines); awaiting Daniel review before commit. V1 "Hands" merged (PR #44) and live on 127.0.0.1:5317; V2 "Trust" is Daniel's go/no-go.
- **faceless-youtube** — **PARKED**, no active work. STATE.md stale (2026-07-19); last real activity was the Bricks Variant-D arc in external clone `kb-clones/bricks-arc` (`claude/bricks-variant-vd`, tip `4bc82dc2`, pushed).
- **figment** — One resumable `pipeline` command drives `anchor → … → video` with gate halts and on-disk receipts; `detail`/`video` are now real gradeable stages; single gate-writer and single per-era prompt composer (fixes the 2026-09-07 trigger-word defect). Live-chain handoff 2026-09-23.
- **kb-ops** — Production VM (`kb`, `100.89.73.118`) LIVE on release `e8ac49ad` (PR #203/#204 merged, deployed 2026-09-23 05:55Z); daemon-internal 5-min schedule tick verified live; ops history linear.
- **prospecting** — P1–P8 built across `prospecting-p{1..8}` worktrees, all branches **UNPUSHED**. P8 affinity gate 953/953 at `52067386`; live-tested against the real desktop store (campaign `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **Desktop coordination tier dormant (root cause, already escalated).** No desktop dispatcher has run — there are zero `dispatcher-desktop-*` dispatch ledgers, and neither desktop cadence fired this week: `daemon-dirs-sync` (daily) and `grades-reconcile` (weekly:sat) have **zero** dispatch rows for 10-04 → 10-10. Consequence: the main→ops mirror is never auto-reconciled and the grades/activity ledgers are frozen at 2026-07-21. Tracked by gap card `6a80039d-c4e53a26` (unowned, awaits dispatch) and human-decision approval `6ab76543-b01ea7d5` — **no duplicate filed this run.**
- **sync_daemon_dirs main→ops mirror drift — STILL OPEN (desktop fix owed).** `scripts/sync_daemon_dirs.py` is on `origin/main` but absent from `origin/ops`, so the literal routine gate fails `No such file` (EXIT 2); ran via `main`'s copy in cloud refs-fallback mode. Drift = one ops-only file `orgs/kb-ops/workflows/acceptance-run.md` (EXIT 1), unchanged for 6 nights. Canonical card `6a605ebb-d86dff79` refreshed in place (dedup — no 16th dated duplicate). Report-only gate — never blocks dispatch.
- **Stranded `working/` cards (recorded, not moved).** `d126c410-9bc54280` (figment, owner `figment-expand`, in working/ since 2026-09-07 ≈ 33 days): its `action:` value carries an unquoted colon, so `cards.parse()` raises `mapping values are not allowed here` — both stale (>48h) and unparseable. `6a6bc3dd-5494006b` (codex-worker, `iter-smoke-t2`, state `halted`) sitting in working/ since 2026-07-30 — terminal state, never swept.
- **Inbox backlog is large (120 cards).** 16 `wake-daniel-*` cards (15 of them the duplicate sync-daemon-dirs set) + 104 uuid-style undispatched cards. Needs a human/dispatch consolidation pass.
- **Prior dashboard counts were inaccurate.** The 2026-10-09 dashboard reported `blocked 29 / done 1630 / inbox 87`, but the committed tree at that same HEAD has no `queue/blocked/` directory at all (blocked = 0), done = 1627, inbox = 120. Counts corrected here from a direct `find queue/<state>` of the committed ops tree.
- **Cloud dispatcher outage 2026-10-02 → 2026-10-03 (self-resolved).** No dispatch ledgers exist for those two days (so the 10-03 Saturday `weekly-audit` slot was missed), but the dispatcher recovered and has run every day 10-04 → 10-10. Noted for the record; no remediation card (already recovered).
- preamble: **OK**. `sync_skills --check`: **in sync** (EXIT 0). `sync_daemon_dirs --check`: **EXIT 1** (one ops-only extra, refs-fallback via main copy).
