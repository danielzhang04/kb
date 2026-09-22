# Executive Dashboard
_Generated: 2026-09-22 06:12 UTC by dispatcher-cloud_

## Action required
- **`65d8f246-8a461521`** — figment — _GATE A eye-gate: operator rules creator-001 expansion-02
  blind board (seven axes) so curation to 40 can proceed_ — **T3** (in `queue/approvals/`,
  awaiting human ruling).

## Queue
| state | count |
|---|---|
| inbox | 112 |
| working | 3 |
| approvals | 1 |
| blocked | 0 |
| done | 1604 |
| archived | 10 |

## Last 24h
- **Cadences run:** `nightly-review` — today (card `6ab21c06-db0b6a4f`, project kb) and
  yesterday (card `6ab0cbac-04057314`). This is the only cadence that ticked.
- **Cost:** $0.00 spent against a $30.00/day ceiling → **$30.00 remaining**. All logged model
  steps are subscription-billed ($0.0); yesterday's one cost row was `nightly-review` on
  `claude-opus-4-8` at $0.0.
- **Notable:** nightly step 2b tripped — `scripts/sync_daemon_dirs.py` does not exist, so the
  main→ops daemon-dir mirror check did NOT run. Wake-me card `6ab21c03-8cfd5983` filed; the
  gate reports only, so this run continued. `sync_skills --check` was clean.

## Projects
- **atlas** — Omni-interface foundation complete locally on `codex/atlas-enhancements-20260820`
  (commit `280a67a9`); an independently re-reviewed adversarial remediation diff (>400 lines)
  is unstaged and **awaiting Daniel's review before commit** per contract. V1 "Hands" wave
  complete (all three gates passed).
- **faceless-youtube** — PARKED, no active work. STATE.md is stale (2026-07-19); real last
  activity was the Bricks Variant-D arc in external clone `kb-clones/bricks-arc`
  (`claude/bricks-variant-vd`, tip `4bc82dc2`, pushed).
- **figment** — One resumable `figment_train.py pipeline` command drives anchor→…→video with a
  gate halt at every gradeable stage; `detail`/`video` are now real stages; single gate writer
  (`identity_gate.write_gate_document`). A T3 eye-gate (above) is pending operator ruling.
- **kb-ops** — Production VM (`kb`, `100.89.73.118`) LIVE on release `8f71173e` (main after
  PR #202, deployed 2026-09-17). Authority/guardrails in force (SSH-signed approvals, no
  passkeys, `X-KB-Actor` audit). v1 launch arc closed; outbox drained to `origin/ops`. Nine
  agent-owner cadences disarmed.
- **prospecting** — P1–P8 built across worktrees `prospecting-p{1..8}`, **all branches
  UNPUSHED**. P8 affinity gate 953/953 at HEAD `52067386`. Live-tested against the real desktop
  store (campaign `camp_3147b42db58c4c15`); all Gate P8-B criteria green.

## Anomalies
- **Stale working card:** `6a6bc3dd-5494006b` (`iter-smoke-t2`, kb-ops, owner codex-worker) has
  sat in `working/` since 2026-07-30 (~53 days, far past the 48h floor). Likely abandoned —
  candidate for the stranded-archiver or a human walk-back.
- **Unparseable card frontmatter:** `d126c410-9bc54280` (figment, `figment:track1:replicate`)
  has an unquoted colon in its `action:` value, so `cards.py` raises a YAML ScannerError on
  parse. Owner `figment-expand`; needs the value quoted.
- **Missing script / drift check unenforced:** `scripts/sync_daemon_dirs.py` referenced by
  nightly step 2b is absent — the main→ops daemon-dir mirror check cannot run. Wake-me card
  `6ab21c03-8cfd5983` filed (T1).
- **Inbox backlog:** 112 cards sitting in `queue/inbox/` — worth a triage pass.
