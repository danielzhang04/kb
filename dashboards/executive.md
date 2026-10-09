# Executive Dashboard
_Generated: 2026-10-09 06:28 UTC by dispatcher-cloud_

## Action required
Two cards await a human ruling in `queue/approvals/`:
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) before curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — wake:human-decision: desktop coordination tier degrading (dormant desktop cadences; daemon-dirs-sync not running; grades/activity ledgers frozen since 2026-07-21) — **T1**

Plus the long-open daemon-dir mirror drift: canonical card `6a605ebb-d86dff79` (refreshed in place this run) + **15 historical `wake-daniel-*-sync-daemon-dirs-*` cards** awaiting a human consolidation pass — see Anomalies. The owed fix is a desktop action.

## Queue
| state | count |
|-------|-------|
| done | 1630 |
| inbox | 87 |
| blocked | 29 |
| archived | 10 |
| approvals | 2 |
| working | 2 (1 unparseable — see Anomalies) |
| halted | 1 |

## Last 24h
- **Cadences:** `nightly-review` dispatched 2026-10-09 (card `6ac88876-b7490965`, this run) and 2026-10-08 (card `6ac735bb-6d8d3533`). No other cadence fired.
- **Cost:** $0.00 billed today vs **$30.00** daily limit → **$30.00 remaining** (subscription steps log $0.00).
- **Notable:** preamble OK; skills mirror in sync; dashboards regenerated. Daemon-dir mirror drift still open (canonical card refreshed in place, no new duplicate filed).

## Projects
- **atlas** — Omni-interface foundation + independently re-reviewed adversarial remediation complete **locally** on `codex/atlas-enhancements-20260820` (`280a67a9` + unstaged diff >400 lines); awaiting Daniel review before commit. V1 "Hands" merged (PR #44) and live on 127.0.0.1:5317; V2 "Trust" is Daniel's go/no-go.
- **faceless-youtube** — **PARKED**, no active work. STATE.md stale (2026-07-19); last real activity was the Bricks Variant-D arc in external clone `kb-clones/bricks-arc` (`claude/bricks-variant-vd`, tip `4bc82dc2`, pushed).
- **figment** — One resumable `pipeline` command drives `anchor → … → video` with gate halts and on-disk receipts; `detail`/`video` are now real gradeable stages; pins repaired (9 stages clean), Qwen3-VL auto-captioning + per-plan style-LoRA wired. Live-chain handoff 2026-09-23.
- **kb-ops** — Production VM (`kb`, `100.89.73.118`) LIVE on release `e8ac49ad` (PR #203/#204 merged, deployed 2026-09-23 05:55Z); daemon-internal 5-min schedule tick verified live; ops history linear.
- **prospecting** — P1–P8 built across `prospecting-p{1..8}` worktrees, all branches **UNPUSHED**. P8 affinity gate 953/953 at `52067386`; live-tested against the real desktop store (campaign `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **sync_daemon_dirs main→ops mirror drift — STILL OPEN (desktop fix owed ~2 months).** `scripts/sync_daemon_dirs.py` is present on `origin/main` but absent from `origin/ops`, so the literal routine gate fails `No such file` (EXIT 2); ran via `main`'s copy in cloud refs-fallback mode. Drift = one ops-only file `orgs/kb-ops/workflows/acceptance-run.md` (EXIT 1), unchanged for 5 nights. Per the dispatcher-cloud dedup decision, the canonical card `6a605ebb-d86dff79` was refreshed in place (no new dated duplicate); **15** historical `wake-daniel-*-sync-daemon-dirs-*` cards (08-15 → 10-04) still sit in inbox awaiting a human consolidation pass + the owed step-2b amendment. Report-only gate — never blocks dispatch.
- **Malformed working card** `queue/working/d126c410-9bc54280.md` (figment, owner `figment-expand`, in working/ since 2026-09-07 ≈ 32 days): its `action:` value contains an unquoted colon, so `cards.parse()` raises `mapping values are not allowed here`. The card is both stale (>48h) and unparseable by the card tooling — needs the `action` quoted or the card resolved.
- **Long-halted card** `queue/working/6a6bc3dd-5494006b.md` (codex-worker, `iter-smoke-t2`, halted) sitting in working/ since 2026-07-30 — terminal state, never swept.
- preamble: **OK**. sync_skills `--check`: **in sync** (EXIT 0).
