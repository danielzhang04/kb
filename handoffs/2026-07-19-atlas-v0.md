# Atlas V0 — pause/resume handoff (2026-07-19 evening)

For a fresh terminal resuming the V0 build. Read in order: this file → `.superpowers/sdd/progress.md`
(worktree root) → `docs/plans/2026-07-19-atlas-v0-plan.md` (execution notes at bottom) →
`orgs/atlas/STATE.md` (ops branch).

## Where everything is
- Work branch: `claude/atlas` in worktree `C:/Users/danie/kb-worktrees/atlas` (pushed to origin).
- Ops coordination: worktree `C:/Users/danie/kb-worktrees/dashboard-ops` (pull-rebase before every write;
  it carries a pre-existing unrelated unstaged HEARTBEAT.md change — stash/pop around rebases, never revert it).
- Specs: `docs/specs/2026-07-19-atlas-build-delta-design.md` (authoritative deltas) amending
  `docs/specs/2026-07-15-atlas-voice-layer-design.md` (base, user-approved).
- Secrets file (Daniel-created, outside repo): `%USERPROFILE%\.atlas\env`.

## State (all verified, not guessed)
- Tasks 1–5 of 8: built, task-reviewed clean (SDD: fresh implementer + fresh reviewer per task).
  - T1 sweep: commit 12c0b10. T3 kb-MCP queue_summary: a6cdb74, card graded **96 PASS**.
  - T4 read tools: 7696400, card graded **96 PASS**. T5 router/fastlane/REPL: ad5fa9a, 14/14 tests.
- Task 5 card `6a5c8ad2-1d991c23` is IN WORKING on ops — Step 9 (live REPL smoke) not run; card close +
  inspector grade happen after it.
- Cards done+graded: T3 `6a5c8ad2-812b97e7`, T4 `6a5c8ad2-98115d61`. Queued in inbox: T6 `6a5c8ad2-df7abf53`,
  T7 `6a5c8ad2-a1613d5a`, T8 `6a5c8ad2-984e5ccf`.
- Human gates: (1) contract spend ratification **DONE**, (2) CLAUDE.md carve-out **DONE**,
  (3) scoped ANTHROPIC_API_KEY in `%USERPROFILE%\.atlas\env` **PENDING**, (4) vendor accounts
  (LiveKit/Deepgram/Cartesia/ElevenLabs keys into same file) **PENDING**. Exact click-by-click steps were
  given to Daniel in-session; if lost, re-derive: Anthropic Console workspace "atlas" w/ $20/mo cap → key;
  LiveKit Cloud project; Deepgram (auto $200 credit); Cartesia + ElevenLabs free tiers.

## Open decision (ask Daniel if unanswered)
He floated measuring warm-SDK-session vs direct API for the fast lane. Default = API-only; offered to add a
side-by-side to Task 8's latency harness. Not yet answered — ask before Task 8, don't assume.

## Resume procedure
1. `python scripts/preamble.py` from repo root (constitution).
2. Check `%USERPROFILE%\.atlas\env`:
   - `ANTHROPIC_API_KEY` present → run Task 5 Step 9: from `atlas/`, `.venv\Scripts\python -m worker.repl`,
     ask "what's in the queue?" — expect grounded one-breath answer. Log cost row per ledger.py to ops
     (`ledger.append(<ops>, "cost", "atlas-worker", {...})`). Then: append live-smoke result to card
     `6a5c8ad2-1d991c23`'s `## Result`, transition to done, push ops, dispatch fresh-context inspector
     (skill `.claude/skills/inspector`, pattern identical to T3/T4 grades in ops log).
   - Vendor keys present → Task 6 onward per plan. Extract briefs with
     `bash <superpowers>/skills/subagent-driven-development/scripts/task-brief docs/plans/2026-07-19-atlas-v0-plan.md N`.
3. Execution model (Daniel-mandated): orchestrator dispatches fresh subagents per task — implementers/reviewers
   Opus 4.8 or below, model self-report REQUIRED in report + verified by orchestrator; task reviewer per task;
   inspector per card; orchestrator owns all commits-review, pushes, and ops writes. Human gates one at a time.
4. Task 6 note: its `app.py` tool wiring depends on the pairing-smoke verdict (livekit/agents#2519) — run
   `pairing_smoke.py` BEFORE writing app.py, per plan. Mandatory context7 docs pull first.
5. Wave close = plan Task 8 Step 5 (consistency sweep incl. secret-grep, memory append, PR claude/atlas → main).

## Review-debt ledger (for final whole-branch review)
Minors logged, none fixed yet by design: zero-value cost row can't catch broken accumulation (T4 test);
fastlane multi-tool_use + max_turns paths untested (brief-level); `_dispatch` KeyError guard for unknown tool
names (V1 item); stray report SHA typo (cosmetic).
