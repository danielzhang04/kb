# Executive Dashboard
_Generated: 2026-09-08 06:20 UTC by dispatcher-cloud_

## Action required
- **65d8f246-8a461521** | figment | T3 — GATE A eye-gate: operator rules creator-001
  expansion-02 blind board (seven axes) so curation to 40 can proceed. Awaiting human approval.

## Queue
| state | count |
|---|---|
| inbox | 51 |
| working | 3 |
| done | 1577 |
| approvals | 1 |
| archived | 10 |

Inbox risk-tier spread: 27×T1, 22×T2, 2×T3.

## Last 24h
- **Cadences:** `nightly-review` dispatched 2026-09-07 and again this run (2026-09-08). This
  run emitted 1 cadence card (`6a9fa8e1-1ebb28d6`, executed inline by dispatcher-cloud).
- **Cost vs budget** (daily limit $30.00): 2026-09-07 = **~$19.40** across 11 ledger rows
  (~$10.60 headroom) — almost all RunPod L40S pod-create/orphan cost, of which **$15.97 is a
  WORST-CASE ceiling-rate orphan estimate** for pod `hvtovmusbx6a1t` (08:37–23:16) flagged
  "verify RunPod billing" — actual spend is likely well below the ledgered figure. 2026-09-08
  so far = **$0.00** (subscription steps only). Under budget on both the ledgered and realistic figures.
- **Notable:** preamble OK; `sync_skills --check` clean; daemon-dir mirror check clean except
  one already-carded ops-only extra — see Anomalies.

## Projects
- **atlas** — Omni-interface adversarial remediation READY for Daniel review on
  `codex/atlas-enhancements-20260820` (foundation 280a67a9 + unstaged remediation diff; >400
  lines so contract requires review before commit). V1 "Hands" merged (PR #44) and live earlier.
- **faceless-youtube** — Production run `bricks-fresh` PAUSED at the P6B human gate (18/25 slots
  verified). Variant D trial 25/25 verified on `claude/bricks-variant-vd`; awaiting Daniel's
  keep / keep-with-edits / iterate / revert gate.
- **kb-ops** — Wave A complete (governed executor proven live). Daily `self-lint-report` cadence
  DORMANT: no scheduler enabled, launches are manual via the dashboard Workflows UI.
- **prospecting** — P1 PASSED (2026-09-04). P2 live Snov run (30 NYC VC firms) under Daniel's
  judgment; P3–P7 gates pending; P8 affinity gate P8-B green on batch 1 (2 delivered / 1 firm),
  batch 2 awaiting Daniel. Branches unpushed on desktop worktrees.
- **figment** — Active via queue only (no `orgs/figment/` STATE): 1 approvals card (GATE A above)
  and 1 long-running Track-1 replication card (`d126c410-9bc54280`, working). See Anomalies.

## Anomalies
All anomalies below are known and already carded — no new wake-me cards were filed this run.
- **Daemon-dir drift (already carded):** `sync_daemon_dirs --check` (run from the `origin/main`
  copy per the documented workaround, since the tool is absent from `ops`) reports one ops-only
  extra daemon-read file: `orgs/kb-ops/workflows/acceptance-run.md`. Same recurring drift tracked
  by umbrella card `6a605ebb-d86dff79`. A desktop `sync_daemon_dirs.py --sync --prune`
  from dashboard-ops is owed. Gate reports only — dispatch continued.
- **Missing check tool on ops (already carded):** `scripts/sync_daemon_dirs.py` exists on `main`
  but not on `ops`, so step-2b's literal invocation file-not-founds; the main-copy workaround is
  used each run. Tracked by `6a605ebb-d86dff79`; a desktop script-mirror decision is owed.
- **Halted card:** `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`, codex-worker) is state=`halted`
  (terminal) and parked in working/, carried since 2026-07-30 — reversible only by a human walk-back.
- **Long-running card:** `d126c410-9bc54280` (figment, track1 replicate, T2) is state=`working`,
  a known long-running job. Its `action` frontmatter has an unquoted colon that trips strict YAML
  parsing (tolerant readers cope); worth a one-line quote fix at the desk.
- **Orphan project:** `figment` cards exist (1 approvals + 1 working) but there is no
  `orgs/figment/` project directory.

_Health line: preamble OK · sync_skills --check clean (in sync) · daemon-dir mirror check clean
except the already-carded ops-only `acceptance-run.md` extra (checked via origin/main copy;
refs-fallback mode). No new wake-me cards filed._
