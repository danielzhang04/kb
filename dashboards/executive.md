# Executive Dashboard
_Generated: 2026-09-23 06:18 UTC by dispatcher-cloud_

## Action required
- **`65d8f246-8a461521`** — figment — _GATE A eye-gate: operator rules creator-001 expansion-02
  blind board (seven axes) so curation to 40 can proceed_ — **T3** (in `queue/approvals/`,
  awaiting human ruling).

## Queue
| state | count |
|---|---|
| inbox | 114 |
| working | 3 |
| approvals | 1 |
| blocked | 0 |
| done | 1608 |
| archived | 10 |

## Last 24h
- **Cadences run:** `nightly-review` — today (card `6ab36ee4-e6312b80`, project kb) and
  yesterday (card `6ab21c06-db0b6a4f`). This is the only cadence that ticked.
- **Cost:** $0.00 spent against a $30.00/day ceiling → **$30.00 remaining**. All logged model
  steps are subscription-billed ($0.0); yesterday's one cost row was `nightly-review` on
  `claude-opus-4-8` at $0.0.
- **Notable:** nightly step 2b tripped again — `scripts/sync_daemon_dirs.py` is present on
  `origin/main` but still absent from `origin/ops`, so the literal ops-checkout check fails
  (EXIT 2). Ran via `main`'s copy in cloud refs-fallback mode; it found the same single
  ops-only drift (`orgs/kb-ops/workflows/acceptance-run.md`). Wake-me card
  `wake-daniel-2026-09-23-sync-daemon-dirs-drift` filed (12th open on this issue); the gate
  reports only, so this run continued. `preamble` OK; `sync_skills --check` clean.

## Projects
- **atlas** — Omni-interface foundation complete locally on `codex/atlas-enhancements-20260820`
  (commit `280a67a9`); an independently re-reviewed adversarial remediation diff (>400 lines)
  is unstaged and **awaiting Daniel's review before commit** per contract, and the remote push
  is blocked pending Daniel's explicit `origin` approval. V1 "Hands" wave complete (all three
  gates passed).
- **faceless-youtube** — PARKED, no active work. STATE.md is stale (2026-07-19); real last
  activity was the Bricks Variant-D arc in external clone `kb-clones/bricks-arc`
  (`claude/bricks-variant-vd`, tip `4bc82dc2`, pushed).
- **figment** — One resumable `figment_train.py pipeline` command drives anchor→…→video with a
  gate halt at every gradeable stage; `detail`/`video` are now real stages; single gate writer
  (`identity_gate.write_gate_document`). A T3 eye-gate (above) is pending operator ruling; the
  `track1:replicate` card `d126c410` remains in `working/` (see Anomalies).
- **kb-ops** — Production VM (`kb`, `100.89.73.118`) LIVE on release `8f71173e` (main after
  PR #202 merged 2026-09-17, deployed 23:01Z under the prod-window guard). Authority/guardrails
  in force; v1 acceptance canary succeeded and the v1 launch arc is closed. Outbox drained to
  `origin/ops` (linear). Nine agent-owner cadences remain disarmed; workflow schedule `96db76e4`
  is armed but nothing ticks it on the VM.
- **prospecting** — P1–P8 built across integrated worktrees `kb-worktrees/prospecting-p{1..8}`,
  all branches **UNPUSHED**. P8 affinity gate 953/953 at HEAD `52067386`
  (`claude/prospecting-p8`). Live-tested against the real desktop store: campaign
  `camp_3147b42db58c4c15`, batch 1 (10 profiles) all Gate P8-B acceptance criteria green.

## Anomalies
- **Stale `working/` card:** `d126c410-9bc54280` (figment `track1:replicate`) has sat in
  `working/` since 2026-09-07 (~16 days, well past 48h). Its `action` also carries an unquoted
  colon that trips a strict YAML parser. Needs a resume, reassignment, or archival decision.
- **Terminal card lingering in `working/`:** `6a6bc3dd-5494006b` (`iter-smoke-t2`, codex) is
  `state: halted` (terminal) but still physically in `working/`, resolved there 2026-07-30.
  Candidate for archival.
- **Daemon-dir mirror drift (12 open wake-me cards):** `scripts/sync_daemon_dirs.py` is not on
  `ops`, and `orgs/kb-ops/workflows/acceptance-run.md` is ops-only vs `main`. Owed desktop fix:
  re-add the script to `ops` and decide `--sync --prune` vs. reconcile-to-`main`.
- **Inbox backlog:** 114 cards in `inbox/` (many `wf-*` and open wake-me cards) — a triage pass
  is overdue.
