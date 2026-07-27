# Triple-arc handoff (2026-07-19) — for the terminal that runs the build

Written by the autonomous orchestrator session (Fable 5, claude-boss). Daniel's closing
instruction: "After you finish running the existing pre-plan, build a handoff and pass to another
terminal to actually run the plan and do the building." This file is that handoff. Read in order:
this file → the two design docs in `docs/specs/2026-07-19-*.md` (fleet-arc branch) →
`docs/specs/2026-07-19-faceless-live-import-and-run-design.md` (faceless-live-import branch) →
auto-memory `autonomous-triple-arc-2026-07-19`.

## Mandate (Daniel, 2026-07-19, verbatim anchors)

1. "Finish building and iterating and testing the rest of atlas design, BESIDES atlas itself"
   (= the seven fleet layers; Atlas excluded).
2. Dashboard integrations: internet research; Google Drive/Gmail/Calendar workflows (email triage
   rebuilt from cowork); faceless-youtube run + YouTube upload/analytics.
3. Faceless: snapshot deleted, live project moved into kb, ONE full video run prompt→render
   ("Go ahead and run it" — this is the recorded spend authorization, one video, ~$15–30).

## What is DONE (all verified, none pushed except ops)

Branch `claude/fleet-arc` (worktree kb-worktrees/fleet-arc, off codex/dashboard-operational-surfaces),
head `02ea72d`:
- Designs: executor-activation+integrations; fleet-layers arc (7330140).
- Inert Claude worker/session adapters + review fix-pass (fe669ad → 2f2ea64; 6-finding Opus review
  SHIP-WITH-NITS, all fixed). Full dashboard suite 1318 passed / tsc clean.
- Workflow registry D15 (716ad49): orgs/<project>/workflows/*.md → validated defs → compiled
  kb.plan-proposal/v1 → governed one-step launch that STALLS at the existing activation gate
  (activationGated:true). Definitions shipped: kb-ops/email-triage (4-tier taxonomy, DRAFT-ONLY),
  kb-ops/research-brief. Profiles research/gmail-triage/drive-author/producer (no upload/send tools).
- Fleet layers (merged from claude/fleet-arc-py at 02ea72d; pytest 407 passed):
  - Wave A CoS code (d8684c5): scripts/brief.py, rollup.py (propose-only), brief_notify.py
    (supervised Telegram, launcher-pattern token), cadence proposals in orgs/kb-ops/cadence-proposals/.
  - Wave B Proving Grounds (1fddf62): evals/canaries/ (20 golden cards) + MANIFEST.sha256 tamper
    guard, scripts/canary.py (--all/--record/--diff-guard), scripts/trust.py, scripts/triage_rules.py
    (the email-triage classifier core). 20/20 pass.
  - Wave D Sentinel (bd492f9): scripts/sentinel.py (reconcile/usage/loops — all report-only,
    STOP-supremacy), sentinel_watchdog.ps1 (STOP-check-first, not registered), cadence proposal.

Branch `claude/faceless-live-import` (worktree kb-worktrees/faceless-import), head `8ae966d`+aef202a:
- Frozen snapshot deleted (ff4187b); live tree MOVED in (ff36f63; 655 files/101MB lean set; media
  untracked per project .gitignore). History archived intact: C:\Users\danie\faceless-youtube.git-archive
  (471 commits); original path = pointer README only. Wrapper (contract/HEARTBEAT/_index/STATE) merged.
  Poyais untouched (verified byte-identical), parked at Daniel's gate 6.
- Preserved agent: .claude/agents/faceless-producer.md (aef202a) — the conductor for any video run.
- fyt-run-001 progress: idea stage done (38a56e6; backlog re-ranked to 33) → PICK: ST-033 Wells
  Fargo (rationale on card) → research stage done (8ae966d; 35-row cited fact ledger, 5 flagged
  open questions incl. F-35 $1B-penalty scope).

ops branch (pushed): fyt-run-001 DAG cards (workflow fyt-run-001, ids 6a5d53ea-*; parent working,
idea+research done w/ Results, script card 6a5d53ea-def9aa59 READY IN INBOX, then judge/
shorts_meta/visuals/images/voiceover/audio/render chained by depends-on). OAuth human gates
G1–G4 for Daniel: cards 6a5d6b23-{12ddfee2,05204b15,4c98aec0,17e8d1be} (T3, click-by-click).

## THE HARD CONSTRAINT the next terminal must respect

The auto-mode classifier twice DENIED building the live activation wiring (engine injection into
surface.ts + queue bridge), even flag-gated-inert. Treat this as a substantive gate, not phrasing:
unattended-Claude-session spawning infrastructure requires Daniel's interactive go (likely: he
runs/authorizes that build himself in a supervised session). Everything shipped routes around it —
adapters are inert modules; workflow launches stall at the human gate BY DESIGN. Do NOT try to
sneak activation past the classifier. Activation checklist when Daniel gates it: implement
buildActivatedExecution + surface wiring + queueBridge per design §2 (D3/D5), address the review's
activation-time notes (worker cancellation wiring to the engine's cancellation controller;
CLAUDE_CODE_OAUTH_TOKEN env decision), then the synthetic two-stage acceptance with fault
injection + REAL daemon boot (design D7).

## What the next terminal RUNS (in order)

1. Preamble (`python scripts/preamble.py`), read this file + designs.
2. **fyt-run-001 resume** (worktree kb-worktrees/faceless-import; the faceless-producer agent
   definition is the conductor spec): script card 6a5d53ea-def9aa59 → long-form-writer (leashed to
   research.md) → proxy-judge gate (ACCEPT required, ≤2 revise loops) → shorts+metadata → visual-
   prompt-writer → motion-planner → images ∥ voiceover ∥ audio-director → render-builder
   (build_motion.py --dry-run FIRST) → measured verification. Transition cards + Results on ops as
   stages land (batch pushes fine). Spend: authorized for THIS one video only (.env ambient keys;
   missing key ⇒ park + wake-me). NO publish/upload. Report lists what awaits Daniel's ear/eye.
3. **Remaining fleet waves** on claude/fleet-arc per the arc design: Wave C Dreaming
   (scripts/dream.py --dry-run REPORT-ONLY + its design section is already written), Wave E
   Mission Control (scripts/mission_control.py renderer) + Flight Recorder (traces normalizer +
   static viewer — note: transcript capture depends on the executor, so build the normalizer
   against the control-plane store's stored events + document the live hook for activation),
   Wave F Quartermaster deltas (escalation-on-failure requeue in dispatch.py + trust.py outcome
   columns). SDD: fresh Opus implementer + fresh reviewer per task, model self-report verified.
4. **WS2 leftovers**: scripts/yt_analytics.py (+tests, gate G4 pairs with it);
   orgs/faceless-youtube/workflows/video-run.md definition (compile-clean through the registry);
   supervised first Telegram send of a real brief (brief_notify.py --send via desktop_poll launcher
   pattern) — SUPERVISED, once; Wave A live-fire (self-lint-report through the engine) is BLOCKED
   until activation.
5. **Wave close**: whole-branch review (the standing review-debt: registry launch-flow replication,
   canary README governance-amendment draft card still to mint, sentinel reservations extra `id`
   column), inspector grading of the wave cards if Daniel wants the trust loop fed, then PRs:
   claude/fleet-arc → (Daniel merges codex/dashboard-operational-surfaces first, then this),
   claude/faceless-live-import likewise. Daniel pushes/merges; workers never push main.

## Also waiting on Daniel (cards exist)

- OAuth gates G1–G4 (see cards; G1's PUBLISH-the-consent-screen step kills the 7-day token death).
- Poyais watch-through gate 6 (untouched by all of this).
- Executor activation authorization (above).
- Cadence proposals (brief-morning, rollup-eod, sentinel-reconcile) — install into HEARTBEAT.md is
  a human act per contract.

## Environment facts the next terminal needs

- kb-dashboard PM2 daemon runs Wave-A-era code from C:\Users\danie\kb\dashboard (main worktree,
  branch codex/dashboard-operational-surfaces) — restart only with plain `pm2 restart kb-dashboard`.
- dashboard-ops worktree = ops branch for ALL coordination writes (pull-rebase first; a
  pre-existing HEARTBEAT.md mod may exist — stash/pop, never revert).
- `py -3` not `python` for pytest (MSYS python lacks yaml). Full suites: `py -3 -m pytest tests -q`
  (repo root, 407) and `npm test` + `npx tsc --noEmit` (dashboard/, 1318).
- GateGuard hooks demand stated facts before first Bash/Write and block first-attempt file
  creations — present facts, retry identical.
- claude.ai Gmail/Drive connectors do NOT work headless; the chosen stack is in the integrations
  design §5 (google_workspace_mcp + youtube-uploader-mcp + yt_analytics.py + --allowedTools).
