# atlas — STATE

_Updated: 2026-07-20 (V1 "Hands" wave OPEN — Fable 5 boss session)_

## Now
- **V1 "Hands" wave UNDERWAY.** Authority: `docs/plans/2026-07-20-atlas-v1-plan.md` +
  `docs/specs/2026-07-20-atlas-v1-hands-design.md` (both approved by Daniel 2026-07-20,
  committed on `claude/atlas` at db250e6). Scope: Slice 1 status surface (state core,
  `/state` on 127.0.0.1:4360, dashboard Atlas view + global mini-orb, transcript ledger)
  then Slice 2 hands (registry consolidation, reflex lane, file_card / launch_workflow
  card-backed / credit_remaining, completion callbacks, persona.md). Three human gates:
  A Slice-1 desk check, B persona co-authoring, C checkpoint (card by voice → orb → callback).
- **Task 1 sweep PASSED 2026-07-20:** atlas 23/23 + fleet 530/530 green; canary card
  6a5ec3bb-65db6d11 through full lifecycle inbox→done with ops pushes; dashboard daemon
  live under pm2 on **127.0.0.1:5317** (not dev 4317 — live checks use 5317); dispatch
  ledger has today's row. Nuance recorded: dispatch.py emits cadence cards; hand-filed
  cards (Atlas's path) are executed by fleet sessions after assignment — same model V0 used.
- **SLICE 1 COMPLETE + ALL GRADED 2026-07-20 late:** T3 registry ae2e6f6 (95 PASS after
  remediation+re-grade), T4 state core 8ca17da (96), T5 /state server 72786fc (97, live-smoked),
  T6 transcript ledger 8f08503 (96 after remediation+re-grade), T7 panel route ef4e0be (95),
  T8 Atlas view + global mini-orb 87552c2 (96). Suites: atlas 68, fleet 530, dashboard 1551 —
  all green. **GATE A PASSED (Daniel, desk, 2026-07-20 late)** — orb/mini-orb/transcript/history/OFFLINE all verified live; one desk fix during bring-up: console mic index reshuffled 2->1 (indices drift on BT connect; wake thread already name-pinned; polish candidate = name-pin the console flag too). Staging was:  branch dashboard live on
  127.0.0.1:4317 (DASHBOARD_REPO_ROOT=dashboard-ops, matches prod env; pm2/5317 untouched).
  Landmine fixed: stale inspector identity in shared kb/.git/config mislabeled two commits —
  restored, history reauthored, per-command -c identity now a standing rule in all prompts.
- V1 cards filed (workflow `atlas-v1`): T3 6a5ec41c-b18aa9f1, T4 6a5ec41c-f7d86587,
  T5 6a5ec41c-d2e26925, T6 6a5ec41c-216ad53f, T7 6a5ec41c-53ac36f7, T8 6a5ec41c-caabe932,
  T9 6a5ec41c-d8332ebf, T10 6a5ec41c-6a21da88, T11 6a5ec41c-4800fe6e, T12 6a5ec41c-3a4808a7.

## V0 (shipped, for reference)
- V0 live at desk since 2026-07-20: "hey Atlas" (custom `hey_atlas.onnx`) → grounded kb answers
  → dismiss/2-min silence → sleep. Voice = mars (Aura-2). PRs #37 + #39 merged; six 96-PASS grades.
- Desk prerequisites: Windows default INPUT = Intel mic array (AirPods HFP mutes A2DP out).
  Run: `cd kb-worktrees\atlas\atlas; .venv\Scripts\python -m worker.app console --input-device 2`.

## Next
- Execute T3→T12 per plan order (Slice 1 first: T4/T5/T6/T7/T8 after T3 refactor), gates
  one at a time at their plan positions.
- Deferred (named): TTFT input diet, spoken voice-switch, hot-follow BT routing, SSE panel
  upgrade, tray widget, panel write-back, Agent-SDK in-process workflows (V2), native MCP
  retest on livekit-agents upgrade past the #2519-class bug.

## Blocked
- Nothing. V2 "Trust" planning deliberately deferred to after gate C.
