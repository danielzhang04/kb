# Faceless-youtube live import + first automated run — design (2026-07-19)

Author: claude-boss (Fable 5 orchestrator, autonomous session authorized by Daniel 2026-07-19).
Mandate (verbatim): "delete the frozen snapshot, move the actual faceless youtube project into kb,
and run one entire run of it with the functionality we've built out in kb. Create a workflow,
create agents if necessary, use the skills, and run one full run (from prompt to render)…
Preserve the agent you create… Go ahead and run it."

Ground truth (Sonnet explorer sweep, this session): live repo = `C:\Users\danie\faceless-youtube`
(~5.05 GB disk, `.git` only 111 MB — heavy media untracked by its own .gitignore; branch
`feat/pipeline-simplification`, 17 untracked leftovers awaiting a post-gate-6 clean sweep).
Poyais R10 is rendered+verified, PARKED at watch-through gate 6 — that gate belongs to Daniel and
is NOT touched by this work. `channel-forge` sibling repo is older (Jul 14) — not the target.
kb snapshot = `orgs/faceless-youtube` (stale by ~5 render rounds; wrapper adds contract/STATE/
_index/HEARTBEAT worth preserving). `youtube-uploader-mcp` configured but never authenticated —
irrelevant here (run scope ends at render; publish is contractually human-gated anyway).

## Decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| F1 | Import mechanics | MOVE the live working tree to `kb/orgs/faceless-youtube` (same drive, cheap). Its `.git` moves aside to `C:\Users\danie\faceless-youtube.git-archive` (intact repo dir, history preserved, inspectable via `git --git-dir`). The live repo's own `.gitignore` moves with the tree, so kb's git tracks exactly the lean file set the project itself curates. Original path left EMPTY (a pointer README only) — no second live copy to drift. | "Move" is the instruction; nested `.git` would embed a gitlink; history must not be destroyed. |
| F2 | Snapshot deletion | `git rm -r` the frozen snapshot on `claude/faceless-live-import` first, then move the live tree in, one commit each — reviewable as delete + import. | Clean history; the snapshot is stale everywhere the live repo is authoritative. |
| F3 | Wrapper preservation | Keep kb wrapper files, merged into the imported tree: `contract.md` (autonomy tiers incl. publish-is-human-gated), `HEARTBEAT.md` (empty cadences), `_index.md` (updated: live CLAUDE.md remains authoritative for per-video work), fresh `STATE.md` reflecting import + run. `output/ raw/ wiki/` kept (empty, kb convention). | Explorer verdict: wrapper governance exists nowhere in the live repo. |
| F4 | Untracked leftovers | Move as-is (backups, `_superseded-*` dirs). The project's own F-clean sweep is deferred until Poyais gate 6 passes — honoring the live repo's recorded state, not ours to run. | Don't destroy another workflow's pending state. |
| F5 | The run | ONE new video for `channels/the-second-take`, prompt→render: idea-generator → orchestrator picks top-ranked idea (idea gate is proxy-executed under Daniel's run mandate, choice + rationale logged) → researcher (deep path, channel is `research: deep`) → long-form-writer (staged writers-room) → proxy-judge (the project's OWN acceptance-gate skill stands in at the script gate; must return accept before proceeding) → shorts-writer + metadata-writer → visual-prompt-writer → motion-planner → image-generation ∥ voiceover ∥ audio-director → render-builder → measured verification (the R10 check suite: lints, `build_motion.py --dry-run` first, audio probes, splice-continuity gate). Ends at `assets/final.mp4` + verification report. NO publish, NO upload, NO touching Poyais. | Exactly "from prompt to render." Human ear/eye watch-through remains for Daniel — the run report lists what he'd gate. |
| F6 | Run coordination | kb cards: one parent run card + per-stage DAG cards (`depends-on`) in `queue/`, project `faceless-youtube`, `workflow: fyt-run-001`, executed by this orchestrator + fresh subagents per stage (the repo's proven round-pattern: verified Opus workers, orchestrator as single-writer of shots.json/motion/audio-plan/manifests, explicit-path commits). A matching dashboard-launchable definition ships as `orgs/faceless-youtube/workflows/video-run.md` (see integrations design D15) for future runs. | "With the functionality we've built out in kb" = cards/ledgers/skills coordination; the untested dashboard executor is not the vehicle for a maiden multi-hour media run. |
| F7 | The preserved agent | `.claude/agents/faceless-producer.md` in kb (checked in on the work branch): the conductor agent that knows the stage order, gates, single-writer rule, verification suite, and cost discipline; model `opus`; tools full. Future runs = dispatch this agent per stage-set, or launch the workflow def from the dashboard. | "Preserve the agent you create — that will be useful." |
| F8 | Spend authorization | The run consumes ElevenLabs chars + Gemini image credits (~$15–30/video per stack.md) using ambient keys from the project's `.env`. Daniel's explicit instruction to run authorizes this spend, ONCE, for ONE video; recorded on the parent run card. Keys are used ambiently, never printed/copied/persisted elsewhere (constitution). If a key is missing/exhausted, the stage parks with a wake-me card rather than substituting engines. | Constitution's "never spend real money" is overridden for this run by the owner's direct order; scope-capped. |
| F9 | Video scope guard | One long-form + its publish-tagged shorts ONLY if the pipeline's own laws require them for a complete run; otherwise long-form only. No re-renders beyond the verification suite's demands; regen budget per image follows the channel's existing doctrine. | Cost discipline; demonstration run, not a production binge. |

## Execution notes

- Preamble before every stage batch; STOP file honored.
- Coordination writes (cards, ledger rows, STATE.md) go to ops via pull-rebase (dashboard-ops
  worktree; stash/pop around its pre-existing HEARTBEAT.md modification — never revert it).
- Work products (the imported tree, per-video artifacts) commit on `claude/faceless-live-import`
  with explicit paths (`git add -A` is banned by the project's own law).
- The imported project's skills load from `orgs/faceless-youtube/.claude/skills/` when sessions
  run inside that directory — stage subagents are spawned with cwd inside the org so the LIVE
  skill set governs. Verify post-move that skill discovery works before the run starts (smoke:
  a subagent inside the org lists its skills).
- Media weight: renders/assets stay untracked exactly as the project's .gitignore dictates; kb's
  repo gains only lean text/config/refs (~lean set ≈ what 111 MB of history already tracked).
- Failure policy per stage: one retry with feedback, then park the run card with a wake-me and a
  precise resume note. Partial success (e.g. rendered but one audio probe failed) = report
  honestly, don't paper over.

## Acceptance

1. Snapshot deleted; live tree moved; kb branch commits show delete → import → wrapper merge.
2. Original location holds only a pointer README; `.git-archive` opens with `git log`.
3. Post-move smoke: pipeline scripts import cleanly (`build_motion.py --help`), skills discovered,
   `.env` keys present (names only, never values).
4. One new video slug under `channels/the-second-take/videos/` with research.md, script.md
   (judge-accepted), shots.json, shots.motion.json, audio-plan.json, voiceover manifest, scene
   assets, `assets/final.mp4`, render manifest, and a measured verification report.
5. Run cards in `queue/done` with Results; cost/activity ledger rows; STATE.md updated; memory
   appended; run report for Daniel listing exactly what awaits his eye/ear (watch-through, any
   parked flags, publish gates).
