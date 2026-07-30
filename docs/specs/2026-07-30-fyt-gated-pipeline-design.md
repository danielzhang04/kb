# FYT Gated Multi-Agent Pipeline — Design

2026-07-30 · Approved by Daniel in boss session (rev 2: terminal substrate) · Status: approved and
implemented on `claude/fyt-pipeline-boss` (PR #102, unmerged, Daniel's review pending). Six real
deviations from this text surfaced during the build — corrected in place below, and cataloged with
their reasoning in *As-built deviations* near the end of this document. Two of them are genuine
open questions for Daniel's ruling, not settled by the build; the rest were mechanical necessities
or safety-positive changes. Nothing below has been ruled on by Daniel yet.

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
monitored and steered through the workflow canvas. **As shipped there are six gates, not five
(`g3b-narration-cost` was added — see *As-built deviations* #2); the maiden run's success
condition is six gates firing in order, not five.**

## Locked decisions

| Decision | Ruling |
| --- | --- |
| Roster cut | 5 phase agents + cross-cutting checker service (not one-agent-per-skill, not the old 4-role cut) |
| Substrate | Persistent interactive Claude Fable 5 pty terminals (dashboard `server/pty/` infra), one per roster agent — NOT per-stage headless `claude -p` spawns. Agent `agents/*.md` declaration loads as binding context at spawn. |
| Lifecycle | Per-run: launching a run spawns the roster; agents retire when the run ships (or Daniel stops them). Sessions persist across the run's multi-day life and resume after daemon restarts. Standing always-on roster deferred. |
| Channel-agnostic | Agents carry zero channel-specific doctrine. Channel is a run parameter; agents load `channels/<name>/dna.md`, grammar, and style data at spawn. Any agent runs equivalently on any channel. |
| Compact context | Agents and subagents load lean: declaration + phase doctrine pointers + channel data + run state — read-on-demand per the project router, never bulk preload. Subagent briefs are compact work orders, not context dumps. |
| Gate set | G0 idea-pick, G1 script, G2 visual plan (approval = image+VO spend authorization), G3 image board, G4 render+compliance = publish-private approval. Public flip stays human-only in Studio. **As shipped: six gates, not five — `g3b-narration-cost` (spend authorization) was added on the `audio` stage, and `g4-publish-private` carries a net-new `publicationAuthorization` gate kind this spec never named. See *As-built deviations* #2 and #4.** |
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
   work; single-writer staging survives (agents write `staging/`; **as shipped, `fyt-checker` — not
   the runner — merges to root and re-lints, as its own DAG nodes; see *As-built deviations* #3,
   pending Daniel's ruling**).
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
| `fyt-runner` | Entry-point conductor: run launch/monitoring, work-order delivery, targeted repairs | Loses image-review (goes to checker). No craft, no gate-grading, no spend, no publish. **As shipped, `fyt-runner` does not execute the single-writer staging merges — it governs their place in the run; `fyt-checker` executes them. See *As-built deviations* #3 (pending Daniel's ruling).** |
| `fyt-story` | idea → research → script → shorts → metadata | Absorbs fyt-preproduction's text stages. Drives idea-generator, researcher, long-form-writer, shorts-writer, metadata-writer skills. |
| `fyt-visuals` | VPW shots + motion planning + image-gen | Motion moves here from preproduction. Drives visual-prompt-writer, motion-planner, image-generation. Never grades its own frames. |
| `fyt-audio-render` | voiceover, audio-plan, SFX, render | Drives voiceover, audio-director, render-builder (+ sfx/music pools as standing duty). |
| `fyt-publish` | publish-queue (private), analytics, monitoring | Net-new. Public flips and thumbnail-set stay human-only in Studio. Drives publish-queue, compliance surfaces, analytics-reporter. |
| `fyt-checker` | Cross-cutting fresh-context gate service: judge-gate, image-review, render-verify + compliance-check | Not a phase. The author-never-grades law holds at every gate. **As shipped, also executes the two staging→root merge nodes (`shots-merge`, `audio-plan-merge`) — see *As-built deviations* #3.** |

Old files `fyt-preproduction.md` / `fyt-production.md` are superseded and tombstoned
(same pattern as fyt-producer, commit 9b752f1).

Model policy: phase agents default-profile `manager:claude:claude-fable-5` (checker included);
sub-workers routed haiku/sonnet/opus by stakes, or codex via queue cards. This is a deliberate
catalog change from the current codex-worker declarations.

**As shipped, only `fyt-runner` carries a `manager:` default profile; the five others (`fyt-story`,
`fyt-visuals`, `fyt-audio-render`, `fyt-publish`, `fyt-checker`) carry `worker:claude:claude-fable-5`.
See *As-built deviations* #6 — `manager:*` profiles carry no write capability, so this row conflated
model tier with profile role.**

### video-run.md re-shape (~11 stages, executable)

**As shipped: 13 stages, not 11, and a strict linear chain, not the `packaging ∥ visual-plan`
branch drawn below. See *As-built deviations* #1 and #5.** The diagram below is the design as
approved; it is not what shipped.

```
idea(story) → [G0 pick]
→ story: research+script(story) → judge-gate(checker) → [G1 script]
→ packaging: shorts+metadata(story)   ∥   visual-plan: shots+motion+lint(visuals) → [G2 visual plan = spend auth]
→ images(visuals, slice-scoped) → image-review(checker) + shot-board → [G3 image board]
→ audio+render(audio-render) → verify+compliance(checker) → [G4 = publish-private approval]
→ publish-private(publish)
```

As-built chain (linear, 13 stages — see *video-run.md*'s own gate table for the full picture):

```
idea(story) → [G0] → story(story) → judge-gate(checker) → [G1]
→ packaging(story) → visual-plan(visuals) → shots-merge(checker) → [G2, spend auth]
→ images(visuals, slice) → image-review(checker) → [G3, G3b spend auth]
→ audio(audio-render) → audio-plan-merge(checker) → render(audio-render)
→ verify(checker) → [G4, publication auth] → publish-private(publish)
```

- Every stage gets `agentId` + `profileId` (executable), replacing display-only reliance on
  `governedBy`. `channel` and `slice` are launch parameters.
- G2 approval is recorded as the per-run spend authorization (images + voiceover share it,
  per existing spend law). **As shipped, there IS a second spend card after all —
  `g3b-narration-cost` on `audio` — because G2 alone left the ElevenLabs call authorized only by
  DAG reachability, not by a recorded decision on the stage that spends. See *As-built deviations*
  #2.**
- VPW always authors the full plan; `slice` scopes images/VO/audio/render to a shot/time
  subrange. Maiden run uses ~2 minutes.
- Analytics is NOT a run stage — it is fyt-publish's standing duty outside the DAG.

### Code changes (change-in-place; no new subsystems where an existing one fits)

| Surface | Change |
| --- | --- |
| `dashboard/server/workflows/defs.ts` | Add `humanGates` to `WorkflowStageDef` + allowed stage keys + validation |
| `dashboard/server/workflows/compile.ts` | Thread parsed `humanGates` into the compiled `ProposalStage` (delete the hardcoded `[]`) |
| `dashboard/server/control/policy.ts` | Approvable pause-for-spend disposition: a declared spend gate yields `waiting-human`, not refuse. Undeclared spend vocabulary still hard-refuses (fail-closed unchanged). **As shipped, `policy.ts` also gained a second, parallel disposition this row never named: `publicationAuthorization`, which makes a T3 stage's own release conditional on its declared gate's approval. See *As-built deviations* #4 — pending Daniel's ruling.** |
| `dashboard/server/control/` run orchestration | Drive stages by delivering work orders into persistent pty agent sessions instead of headless spawns — evaluate `claudeSessionAdapter.ts` for reuse first; keep the existing run/stage/HumanRequest store as the coordination brain. Roster spawn/retire lifecycle + resume-after-daemon-restart. |
| `dashboard/server/control/activation.ts` (+ unlock route, launch-flow prompt) | Boot locked; lazy-construct execution wiring on passkey unlock; explicit Lock control; env var demoted to override |
| `dashboard/src/` workflow canvas | Run canvas view: mini live terminal tiles (scaled xterm), click-to-expand full terminal, artifact-flow edges, live state badges |
| `orgs/faceless-youtube/workflows/video-run.md` | Re-shape per above |
| `agents/*.md` | Roster rewrite per above; `runner-bound: true` flipped via Daniel's PR review/merge (human-flip law preserved) |

Each dashboard change lands with its `.test.ts` sibling updated — behavior changed in place,
no parallel code paths.

## As-built deviations (recorded 2026-07-30, on build completion — none of this is ruled on yet)

Six commits in `claude/fyt-pipeline-boss` (`9e41b78..8f19295`) diverged from this text in
ways worth recording as they were found, not silently absorbed into the artifact. The design's
original intent stays above, uncut; this section is the honest account of where the build differs
and why, so a reader can see both and judge for themselves. Daniel has not seen or ruled on any of
this — the two items below flagged for his ruling are open questions, not settled ones.

**1. Roster is 6 agents over 13 stages, not 5 phase agents + checker over 11.** Two merge nodes
were added: `shots-merge` between `visual-plan` and `images`, and `audio-plan-merge` between
`audio` and `render`. The agent count this spec locked (6: 4 phase agents + runner + checker) is
unchanged — what grew is the stage count. Reason: the staging→root merge this spec describes in
its single-writer-staging line was prose only. Nothing verified the root `shots.json`,
`shots.motion.json`, or `audio-plan.json` that every downstream stage actually reads, while `g2`'s
prompt told a human to "read the merged shots.json" as though that merge were already a checked
fact. Making it a real DAG node with declared artifacts closes that gap. No ruling needed — this
is a correctness fix, not a design choice.

**2. Six gates, not five.** `g3b-narration-cost` was added on the `audio` stage, carrying
`spendAuthorization: true`. Reason: the voiceover stage's paid ElevenLabs call was reachable from
`g2-visual-plan` only by DAG position, not by a recorded decision against the stage that actually
spends — so a targeted single-stage re-run of narration (a repair `fyt-runner` is explicitly meant
to do) would have called a paid API with no authorization recorded anywhere against it. `g3b`
restates the same G2 decision at the point where the call happens. No ruling needed — this closes
an ungated-spend path the spend law was already meant to prevent.

**3. `fyt-checker` executes the two merge nodes, not `fyt-runner` — PENDING DANIEL'S RULING.**
This is the one deviation that directly contradicts this spec's text: the "single-writer staging
survives (agents write `staging/`, runner merges + re-lints)" line above, and the roster table's
listing of "single-writer staging merges" under `fyt-runner`'s responsibilities. Reason it
happened: `compile.ts#resolveAssignment` requires a stage's assigned agent to have a *worker*-role
default profile, while the workflow-level manager assignment requires a *manager*-role one —
`fyt-runner` is declared manager-role (by this same spec's model policy) and cannot declare both
roles at once without gaining a second identity or having its own role changed, both of which
this project has ruled against elsewhere to avoid multiplying agent identities. So a stage-level
merge node governed by `fyt-runner` cannot resolve to `fyt-runner` as its executor; it parks
closed instead. `fyt-checker` was given the two nodes rather than the alternative of loosening
the role check or minting a seventh agent. `fyt-runner` still governs the nodes' place in the run
(sequencing, gating around them); it does not execute them.
The argument for this being *right* rather than merely necessary: promoting and re-linting a plan
is a verification act, and `fyt-checker` authors none of the plans it promotes — a different
identity re-linting the root file `fyt-visuals` (or `fyt-audio-render`) staged strengthens
author-never-grades rather than bending it, and the single-writer law is still satisfied (exactly
one identity writes each root file — it is now the checker instead of the runner, a change of WHO
writes it, not a loosening of the ONE-writer rule). The counter-argument Daniel should weigh: this
spec explicitly locked the merge as the runner's job, and reassigning it to the gate-service agent
blurs the conductor/inspector split this spec was written to enforce. Both readings are live until
Daniel rules.

**4. `publicationAuthorization` is net-new and not in the approved design — the highest-stakes
deviation, PENDING DANIEL'S RULING.** This spec's policy row (`control/policy.ts`) covers only the
spend disposition: a declared spend gate yields `waiting-human` instead of a hard refuse. The
build added a second, parallel disposition of the same shape for publication: a T3 stage
(`publish-private`) whose own declared gate (`g4-publish-private`, `publicationAuthorization:
true`) is approved becomes releasable at that gate, where an undeclared T3 stage still fails
closed exactly as before. `RESTRICTED_INTENT_RULES` in `execution.ts` is byte-for-byte untouched —
confirmed by diff across the full commit range — but the *effect* of its publication-refusal rule
is now something a human approval can release, where before this build no path released it at
all. This is required for `g4` to function as an approvable gate rather than a permanent refuse;
without it the T3 upload stage could never run under this control plane regardless of approval.
The reason to flag it as highest-stakes: this is a new axis of authority this spec never
described, sitting exactly on the boundary the restricted-intent rules exist to hold, and Daniel
should decide whether this is the mechanism he wants carrying that release, not just whether the
code is correct.

**5. The DAG is a strict linear chain, not the spec's `packaging ∥ visual-plan` parallel
branch.** Safety-positive — a parallel branch would have let `visual-plan` (and everything behind
`g2`'s spend authorization) proceed independently of whether `packaging` had passed `g1`, i.e. a
stage could dodge a gate by running on a different fork of the DAG — but it is a real deviation
from the approved shape, and it serializes two phases (shorts/metadata authoring and shot-list
planning) the design wanted running in parallel for wall-clock speed. No ruling needed on
correctness; worth knowing it costs time the design assumed it wouldn't.

**6. Phase agents use `worker:` profiles, not the spec's `manager:` — only `fyt-runner` keeps a
manager profile.** This spec's model-policy line locked `manager:claude:claude-fable-5` as the
default profile for every phase agent including the checker. As built, `fyt-story`, `fyt-visuals`,
`fyt-audio-render`, `fyt-publish`, and `fyt-checker` all declare `worker:claude:claude-fable-5`;
`fyt-runner` alone is `manager:claude:claude-fable-5`. Reason: `manager:*` profiles carry no write
capability in the compiled workflow's role model, and every one of these five agents needs to
write real artifacts (scripts, shot lists, stills, audio plans, cuts, uploads) — so this spec's
locked policy conflated model *tier* (Fable 5 for everyone, which is unchanged) with profile
*role* (manager vs. worker, which the compiler treats as a hard capability split, not a tier
label). No ruling needed — the model each agent runs on is exactly what this spec locked.

**Cross-reference:** the DAG's real gate table, stage list, and full reasoning for #1, #3, and #4
now live as the authoritative source in `orgs/faceless-youtube/workflows/video-run.md` itself
(its "roster," "gates," "cost law," and "single-writer staging law" sections) — this section
exists so a reader of this spec sees the divergence without having to diff the two documents.

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
