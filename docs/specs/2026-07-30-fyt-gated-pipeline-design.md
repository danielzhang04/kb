# FYT Gated Multi-Agent Pipeline — Design

2026-07-30 · Approved by Daniel in boss session · Status: spec for implementation planning

## Goal

Daniel tells the kb platform "run ST-0XX" (or a narrower ask like "regen shots 12+43 on slug X").
A small roster of phase agents — each a Claude Fable 5 terminal spawned by the governed executor,
running full-auto with its full doctrine — carries the video from idea to published-private.
Human gates structurally halt the run and surface in the kb dashboard Inbox; nothing downstream
of an unapproved gate ever spawns. Machine checks pre-vet every human gate.

Success condition: one maiden run (fresh backlog idea → full script → 2-minute slice through
visuals/audio/render → publish-private) completes with all five gates live-fired in the Inbox.

## Locked decisions

| Decision | Ruling |
| --- | --- |
| Roster cut | 5 phase agents + cross-cutting checker service (not one-agent-per-skill, not the old 4-role cut) |
| Gate set | G0 idea-pick, G1 script, G2 visual plan (approval = image+VO spend authorization), G3 image board, G4 render+compliance = publish-private approval. Public flip stays human-only in Studio. |
| Gate surface | Dashboard Inbox via the governed executor's existing HumanRequest pause/resume — no third gate system |
| Execution posture | Runtime unlock latch: daemon boots locked; first workflow launch prompts WebAuthn passkey unlock; stays unlocked until daemon restart or explicit Lock. `DASHBOARD_EXECUTION_ACTIVATED` env remains as headless/testing override only. |
| Launches | Human-initiated (dashboard or boss). queueBridge auto-launch stays unwired this arc. |
| Maiden run | Fresh idea, script the WHOLE video, feed only a ~2-minute slice through images/VO/render (slice-scope is a first-class launch parameter — the proven bricks-slice pattern) |
| Substrate | Phase agents run on Fable-5 Claude profiles; each is itself an orchestrator dispatching haiku/sonnet/opus subagents or codex cards for grunt work |
| Handoffs | Artifacts + manifests + verdict files ARE the structured inter-agent interface (already schema'd and linted). No new message bus. |

## Current-state facts the design builds on (verified 2026-07-30, file:line evidence in session analysis)

- The spawn path exists and passed Wave A: `dashboard/server/control/claudeWorkerAdapter.ts`
  spawns `claude -p` per stage attempt, injects the `agents/<id>.md` body as a server-verified
  binding declaration, worktree-isolated under `AppData/Local/kb-dashboard/control/`, results
  canonically integrated. Inert today behind two switches: `runner-bound: false` on all four FYT
  agents, and `DASHBOARD_EXECUTION_ACTIVATED` unset.
- Pause/resume is built and tested but never live-fired: `control/execution.ts` creates a
  `HumanRequest`, transitions run+stage to `waiting-human`; the Inbox `HumanRequestsPanel`
  respond→activate loop resumes it (client-driven; no daemon poll needed).
- Org workflow `.md` stages cannot declare a human gate: `workflows/defs.ts` has no `humanGates`
  key and `workflows/compile.ts:234` hardcodes `humanGates: []`.
- Spend is an unapprovable hard refuse in `control/policy.ts` (`requestsSpending` → refuse), and
  nothing populates it. There is no pause-for-spend-then-approve disposition.
- `orgs/faceless-youtube/workflows/video-run.md` (14 stages) is 100% display `governedBy`,
  0% executable `agentId`/`profileId`.
- The current 4 agents are cut by role (manage/preproduce/produce/inspect), not phase:
  motion-planning sits with the script writer; checker spans two non-adjacent ends;
  nothing owns publish/analytics. preproduction/production are declared `runtime: codex`.
- Branch state: `claude/boss-20260729` (4 commits: VPW figures, image-gen act batches,
  bricks canonicals, render `--preview-parked`) and local-only `claude/fyt-silver-fresh`
  (14 commits: long-form-writer doctrine waves + two test-slug video dirs) share exactly one
  file, `knowledge/decisions.md`, append-append, keep-both resolution. Neither contains the other.

## Architecture

### Run flow

1. Daniel launches `video-run` for a slug (dashboard Workflows view, or asks the boss).
   If execution is locked, the launch flow prompts passkey unlock first.
2. The workflow compiler turns `video-run.md` into a proposal whose stages carry executable
   `agentId`/`profileId` and, where declared, `humanGates`.
3. Per stage, the executor spawns that stage's phase agent with its declaration injected,
   in an isolated worktree; canonical integration merges results.
4. At a gate: run goes `waiting-human`, item appears in the Inbox, Daniel approves, run resumes.
   Downstream stages do not exist as processes until then.

### Agent roster — 6 files in `agents/`, all `runner-bound: true`

Each phase agent is written **workflow-independent**: the declaration defines identity, doctrine
pointers, laws, and forbidden authority — never DAG position. Any agent is spawnable standalone
with a work order ("redo shots 12+43 on slug X") or as a DAG node.

| Agent | Owns | Notes |
| --- | --- | --- |
| `fyt-runner` | Entry-point conductor: launches/monitors runs, targeted repairs, single-writer staging merges | Loses image-review (goes to checker). No craft, no gate-grading, no spend, no publish. |
| `fyt-story` | idea → research → script → shorts → metadata | Absorbs fyt-preproduction's text stages. Drives idea-generator, researcher, long-form-writer, shorts-writer, metadata-writer skills. |
| `fyt-visuals` | VPW shots + motion planning + image-gen | Motion moves here from preproduction. Drives visual-prompt-writer, motion-planner, image-generation. Never grades its own frames. |
| `fyt-audio-render` | voiceover, audio-plan, SFX, render | Drives voiceover, audio-director, render-builder (+ sfx/music pools as standing duty). |
| `fyt-publish` | publish-queue (private), analytics, monitoring | Net-new. Public flips and thumbnail-set stay human-only in Studio. Drives publish-queue, compliance surfaces, analytics-reporter. |
| `fyt-checker` | Cross-cutting fresh-context gate service: judge-gate, image-review, render-verify + compliance-check | Not a phase. The author-never-grades law holds at every gate. |

Old files `fyt-preproduction.md` / `fyt-production.md` are superseded and tombstoned
(same pattern as fyt-producer, commit 9b752f1).

Model policy: phase agents default-profile `manager:claude:claude-fable-5` (checker included);
sub-workers routed haiku/sonnet/opus by stakes per BOSS.md conventions, or codex via queue cards.
This is a deliberate catalog change from the current codex-worker declarations.

### video-run.md re-shape (~11 stages, executable)

```
idea(story) → [G0 pick]
→ story: research+script(story) → judge-gate(checker) → [G1 script]
→ packaging: shorts+metadata(story)   ∥   visual-plan: shots+motion+lint(visuals) → [G2 visual plan = spend auth]
→ images(visuals, slice-scoped) → image-review(checker) + shot-board → [G3 image board]
→ audio+render(audio-render) → verify+compliance(checker) → [G4 = publish-private approval]
→ publish-private(publish)
```

- Every stage gets `agentId` + `profileId` (executable), replacing display-only reliance on
  `governedBy`.
- Single-writer staging survives unchanged: stage agents write `staging/`, conductor merges
  `shots.json` / `shots.motion.json` / `audio-plan.json` and re-lints.
- G2 approval is recorded as the per-run spend authorization (images + voiceover share it,
  per existing spend law). No separate spend card.
- `slice` launch parameter scopes images/VO/audio/render to a shot/time subrange; VPW always
  authors the full plan. Maiden run uses ~2 minutes.
- Analytics is NOT a run stage — it is fyt-publish's standing duty outside the DAG.

### Code changes (change-in-place; no new subsystems)

| File | Change |
| --- | --- |
| `dashboard/server/workflows/defs.ts` | Add `humanGates` to `WorkflowStageDef` + allowed stage keys + validation |
| `dashboard/server/workflows/compile.ts` | Thread parsed `humanGates` into the compiled `ProposalStage` (delete the hardcoded `[]`) |
| `dashboard/server/control/policy.ts` | Approvable pause-for-spend disposition: a declared spend gate yields `waiting-human`, not refuse. Undeclared spend vocabulary still hard-refuses (fail-closed unchanged). |
| `dashboard/server/control/activation.ts` (+ one unlock route, + launch-flow prompt) | Boot locked; lazy-construct execution wiring on passkey unlock; explicit Lock control; env var demoted to override |
| `orgs/faceless-youtube/workflows/video-run.md` | Re-shape per above |
| `agents/*.md` | Roster rewrite per above, `runner-bound: true` flipped by Daniel's review/merge (human-flip law preserved via PR approval) |

Each dashboard change lands with its `.test.ts` sibling updated — behavior changed in place,
no parallel code paths.

## Build plan — one task per phase, Daniel's gates at position

1. **Reconcile branches.** PR `claude/boss-20260729` and push+PR `claude/fyt-silver-fresh`
   (local-only today — push first). One keep-both conflict in `knowledge/decisions.md`.
   → *Gate: Daniel merges.*
2. **Agent roster rewrite.** 6 agent files + profile/routing entries; workflow-independence
   contracts; tombstone the two superseded files.
3. **Gate machinery.** defs/compile/policy/activation changes + video-run.md re-shape + tests.
4. **Activation + wiring check.** Unlock latch live on the daemon; end-to-end dry check that a
   launch compiles, spawns stage 1, and a gate blocks in the Inbox.
   → *Gate: Daniel's go for maiden run.*
5. **Maiden run.** Fresh backlog idea; full script; 2-minute slice downstream; G0–G4 live-fired
   in order in the Inbox; graded against this spec's success condition.

## Out of scope this arc

- queueBridge auto-launch (deferred until a clean gated run exists)
- Shorts phase agent (added later per Daniel; shorts-writer stays a story-agent duty for now)
- Public publish, thumbnail-set, Studio actions (human-only, standing law)
- Remote/off-machine dashboard access
