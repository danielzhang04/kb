# FYT Gated Multi-Agent Pipeline — Design

2026-07-30 · Approved by Daniel in boss session (rev 2: terminal substrate) · Status: approved, in implementation planning

## Goal

Daniel talks to a terminal, not a "platform": the fyt-runner ("run ST-0XX") or any specific
phase agent directly ("redo shots 12+43 on slug X"). A small roster of phase agents — each a
**persistent, interactive Claude Fable 5 terminal** with its full doctrine, spawned for the run
and retired when it ships — owns its phase end to end. Each agent is itself an orchestrator,
dispatching lower-model Claude subagents or codex cards for grunt work. Human gates structurally
halt the run and surface in the kb dashboard Inbox; downstream phases have nothing to act on
until the gate is approved. Machine checks pre-vet every human gate. Daniel can open any agent's
terminal mid-run — at a gate or not — see everything, and iterate with it live.

Success condition: one maiden run (fresh backlog idea → full script → 2-minute slice through
visuals/audio/render → publish-private) completes with all five gates live-fired in the Inbox,
monitored and steered through the workflow canvas.

## Locked decisions

| Decision | Ruling |
| --- | --- |
| Roster cut | 5 phase agents + cross-cutting checker service (not one-agent-per-skill, not the old 4-role cut) |
| Substrate | Persistent interactive Claude Fable 5 pty terminals (dashboard `server/pty/` infra), one per roster agent — NOT per-stage headless `claude -p` spawns. Agent `agents/*.md` declaration loads as binding context at spawn. |
| Lifecycle | Per-run: launching a run spawns the roster; agents retire when the run ships (or Daniel stops them). Sessions persist across the run's multi-day life and resume after daemon restarts. Standing always-on roster deferred. |
| Channel-agnostic | Agents carry zero channel-specific doctrine. Channel is a run parameter; agents load `channels/<name>/dna.md`, grammar, and style data at spawn. Any agent runs equivalently on any channel. |
| Compact context | Agents and subagents load lean: declaration + phase doctrine pointers + channel data + run state — read-on-demand per the project router, never bulk preload. Subagent briefs are compact work orders, not context dumps. |
| Gate set | G0 idea-pick, G1 script, G2 visual plan (approval = image+VO spend authorization), G3 image board, G4 render+compliance = publish-private approval. Public flip stays human-only in Studio. |
| Gate surface | Dashboard Inbox for approval; agent terminals for iteration. Gates enforced at the coordination layer: the runner never delivers a phase's work order until the upstream gate is approved. |
| Execution posture | Runtime unlock latch: daemon boots locked; first run launch prompts WebAuthn passkey unlock; stays unlocked until daemon restart or explicit Lock. `DASHBOARD_EXECUTION_ACTIVATED` env remains as headless/testing override only. |
| Launches | Human-initiated (dashboard or a terminal ask). queueBridge auto-launch stays unwired this arc. |
| Maiden run | Fresh idea, script the WHOLE video, feed only a ~2-minute slice through images/VO/render (slice-scope is a first-class launch parameter — the proven bricks-slice pattern) |
| Handoffs | Artifacts + manifests + verdict files ARE the structured inter-agent interface (already schema'd and linted). No new message bus. |

## Current-state facts the design builds on (verified 2026-07-30, file:line evidence in session analysis)

- Dashboard pty terminals work daemon-direct (`server/pty/`, node-pty in-process over `/api/pty`)
  — the proven substrate for interactive agent terminals.
- The control plane's run/stage/HumanRequest store and pause/resume machinery exist and are
  tested (`control/store.ts`, `control/execution.ts`): a `HumanRequest` transitions run+stage to
  `waiting-human`; the Inbox `HumanRequestsPanel` respond→activate loop resumes. Never live-fired
  on a real run. The headless `claudeWorkerAdapter.ts` spawn path also exists (Wave A passed) but
  is NOT this design's substrate; a `claudeSessionAdapter.ts` exists and must be evaluated for
  reuse before writing anything new.
- Org workflow `.md` stages cannot declare a human gate: `workflows/defs.ts` has no `humanGates`
  key and `workflows/compile.ts:234` hardcodes `humanGates: []`.
- Spend is an unapprovable hard refuse in `control/policy.ts` (`requestsSpending` → refuse), and
  nothing populates it. There is no pause-for-spend-then-approve disposition.
- `orgs/faceless-youtube/workflows/video-run.md` (14 stages) is 100% display `governedBy`,
  0% executable `agentId`/`profileId`.
- The current 4 agents are cut by role (manage/preproduce/produce/inspect), not phase:
  motion-planning sits with the script writer; checker spans two non-adjacent ends;
  nothing owns publish/analytics. preproduction/production are declared `runtime: codex`.
  All four are `runner-bound: false`.
- Branch state: `claude/boss-20260729` (VPW figures, image-gen act batches, bricks canonicals,
  render `--preview-parked`, this spec) and local-only `claude/fyt-silver-fresh` (long-form-writer
  doctrine waves + two test-slug video dirs) share exactly one file, `knowledge/decisions.md`,
  append-append, keep-both resolution.

## Architecture

### Run flow

1. Daniel asks the fyt-runner (or launches from the dashboard Workflows view) to run a slug on a
   channel. If execution is locked, the flow prompts passkey unlock first.
2. The run orchestrator spawns the roster: one interactive pty terminal per agent, declaration +
   channel data loaded, all visible on the canvas from minute one. Run/stage/gate state lives in
   the existing control-plane store.
3. Work moves by **work-order delivery**: the coordination layer hands a phase agent its work
   order only when its inputs exist and every upstream gate is approved. Until then the agent
   idles at `waiting` with nothing to act on — the structural halt.
4. At a gate: run goes `waiting-human`, item appears in the Inbox. Daniel approves there, or
   first opens the owning agent's terminal, iterates ("tighten act 2"), then approves.
5. Phase agents dispatch subagents (haiku/sonnet/opus by stakes) or codex queue cards for grunt
   work; single-writer staging survives (agents write `staging/`, runner merges + re-lints).
6. Run ships → roster retires (terminals stop, worktrees swept per lease law).

### Workflow canvas (dashboard UI)

- Each roster agent renders as a **miniaturized live terminal tile** — the actual running xterm
  surface scaled small, like a shrunk window (not zoomed text). Click → expands to the full
  interactive terminal; shrink back when done.
- Tiles are connected by edges showing artifact flow (script → shots → images → …).
- Each tile carries a live state badge: `active: image-gen batch 2/4`, `waiting on fyt-visuals`,
  `blocked: G2 in your inbox`, `idle`.
- The Inbox remains the approval surface; the canvas is the situational-awareness and
  engagement surface.

### Agent roster — 6 files in `agents/`, all `runner-bound: true`

Each phase agent is **workflow-independent** and **channel-agnostic**: the declaration defines
identity, doctrine pointers, laws, and forbidden authority — never DAG position, never channel
specifics. Any agent is spawnable standalone with a work order or as a run-roster member.

| Agent | Owns | Notes |
| --- | --- | --- |
| `fyt-runner` | Entry-point conductor: run launch/monitoring, work-order delivery, single-writer staging merges, targeted repairs | Loses image-review (goes to checker). No craft, no gate-grading, no spend, no publish. |
| `fyt-story` | idea → research → script → shorts → metadata | Absorbs fyt-preproduction's text stages. Drives idea-generator, researcher, long-form-writer, shorts-writer, metadata-writer skills. |
| `fyt-visuals` | VPW shots + motion planning + image-gen | Motion moves here from preproduction. Drives visual-prompt-writer, motion-planner, image-generation. Never grades its own frames. |
| `fyt-audio-render` | voiceover, audio-plan, SFX, render | Drives voiceover, audio-director, render-builder (+ sfx/music pools as standing duty). |
| `fyt-publish` | publish-queue (private), analytics, monitoring | Net-new. Public flips and thumbnail-set stay human-only in Studio. Drives publish-queue, compliance surfaces, analytics-reporter. |
| `fyt-checker` | Cross-cutting fresh-context gate service: judge-gate, image-review, render-verify + compliance-check | Not a phase. The author-never-grades law holds at every gate. |

Old files `fyt-preproduction.md` / `fyt-production.md` are superseded and tombstoned
(same pattern as fyt-producer, commit 9b752f1).

Model policy: phase agents default-profile `manager:claude:claude-fable-5` (checker included);
sub-workers routed haiku/sonnet/opus by stakes, or codex via queue cards. This is a deliberate
catalog change from the current codex-worker declarations.

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
  `governedBy`. `channel` and `slice` are launch parameters.
- G2 approval is recorded as the per-run spend authorization (images + voiceover share it,
  per existing spend law). No separate spend card.
- VPW always authors the full plan; `slice` scopes images/VO/audio/render to a shot/time
  subrange. Maiden run uses ~2 minutes.
- Analytics is NOT a run stage — it is fyt-publish's standing duty outside the DAG.

### Code changes (change-in-place; no new subsystems where an existing one fits)

| Surface | Change |
| --- | --- |
| `dashboard/server/workflows/defs.ts` | Add `humanGates` to `WorkflowStageDef` + allowed stage keys + validation |
| `dashboard/server/workflows/compile.ts` | Thread parsed `humanGates` into the compiled `ProposalStage` (delete the hardcoded `[]`) |
| `dashboard/server/control/policy.ts` | Approvable pause-for-spend disposition: a declared spend gate yields `waiting-human`, not refuse. Undeclared spend vocabulary still hard-refuses (fail-closed unchanged). |
| `dashboard/server/control/` run orchestration | Drive stages by delivering work orders into persistent pty agent sessions instead of headless spawns — evaluate `claudeSessionAdapter.ts` for reuse first; keep the existing run/stage/HumanRequest store as the coordination brain. Roster spawn/retire lifecycle + resume-after-daemon-restart. |
| `dashboard/server/control/activation.ts` (+ unlock route, launch-flow prompt) | Boot locked; lazy-construct execution wiring on passkey unlock; explicit Lock control; env var demoted to override |
| `dashboard/src/` workflow canvas | Run canvas view: mini live terminal tiles (scaled xterm), click-to-expand full terminal, artifact-flow edges, live state badges |
| `orgs/faceless-youtube/workflows/video-run.md` | Re-shape per above |
| `agents/*.md` | Roster rewrite per above; `runner-bound: true` flipped via Daniel's PR review/merge (human-flip law preserved) |

Each dashboard change lands with its `.test.ts` sibling updated — behavior changed in place,
no parallel code paths.

## Build plan — one task per phase, Daniel's gates at position

1. **Reconcile branches.** PR `claude/boss-20260729` and push+PR `claude/fyt-silver-fresh`
   (local-only today — push first). One keep-both conflict in `knowledge/decisions.md`.
   → *Gate: Daniel merges.*
2. **Agent roster rewrite.** 6 agent files + profile/routing entries; workflow-independence,
   channel-agnosticism, compact-context contracts; tombstone the two superseded files.
3. **Gate machinery.** defs/compile/policy changes + video-run.md re-shape + tests.
4. **Run orchestration over pty terminals.** Roster spawn/retire, work-order delivery gated on
   approvals, state tracking, resume; unlock latch. Evaluate/reuse `claudeSessionAdapter.ts`.
5. **Workflow canvas UI.** Mini terminal tiles, expand/shrink, edges, state badges.
   → *Gate: Daniel's go for maiden run (end-to-end dry check shown: launch compiles, roster
   spawns, a gate blocks in the Inbox).*
6. **Maiden run.** Fresh backlog idea on the-second-take; full script; 2-minute slice
   downstream; G0–G4 live-fired in order in the Inbox; graded against this spec's success
   condition.

## Out of scope this arc

- queueBridge auto-launch (deferred until a clean gated run exists)
- Standing always-on roster between runs
- Shorts phase agent (added later per Daniel; shorts-writer stays a story-agent duty for now)
- Public publish, thumbnail-set, Studio actions (human-only, standing law)
- Remote/off-machine dashboard access
