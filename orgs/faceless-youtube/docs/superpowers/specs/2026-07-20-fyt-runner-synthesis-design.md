# FYT Runner + tail + run-001 structural fixes — synthesis design

**Date:** 2026-07-20
**Status:** approved (Daniel, this terminal). Supersets `2026-07-20-fyt-post-render-tail-design.md`
(the tail design, approved earlier the same day) by merging in the structural work owed from
`docs/2026-07-20-fyt-run-001-HANDOFF.md`. Where this doc and the tail design disagree, this doc wins.

## Why one design

The two source documents were written independently and overlap in exactly one place: the
orchestrator. The tail design says "FYT Runner replaces faceless-producer"; the run-001 handoff says
"rewrite `agents/fyt-producer.md` to encode gates rather than commands." These are the same
deliverable: **`agents/fyt-runner.md` is the gates-first rewrite of fyt-producer.** Likewise the
tail design's Gate 2 (human shot-board review) and run-001's `image-review` DAG node are two layers
of one gate: the node is the mechanical enforcement, the board is the human surface on it.

The reusable lesson from fyt-run-001 is this design's core law, stated once here and repeated in
the runner's agent file:

> **A stage never holds the gate that blocks its own work. The runner never stamps what a review
> did not establish. "Parked" is always a legal answer.**

## Scope decisions (Daniel, 2026-07-20)

| Question | Decision |
|---|---|
| wells-fargo remediation | **Parked entirely.** Only `assets/plan_pass2.py` is deleted (it *is* the hand-orchestration artifact). The 29 HARD lint violations, re-authoring, regen, re-render: all deferred to a future card. Uncommitted wells-fargo manifest edits in the worktree are left untouched. |
| Live-run scope of this arc | **Poyais through the tail only** (thumbnail → compliance → shot board retro-check → Gate 3 → publish-queue upload). Fresh A→C videos run later, each under its own card. |
| Git flow | **Stack on `claude/faceless-live-import`** (worktree `kb-worktrees/faceless-import`); one PR at the end. A companion main-based commit updates `dashboard/server/workflows/compile.videoRun.test.ts` (see §Integration). |
| YouTube setup | Channel **exists**. youtube-uploader MCP is **connected in-session** (`mcp__youtube-uploader-mcp__*`) — publish-queue uses it, per the tail design. Analytics OAuth refresh token: Daniel pastes into `.env` himself; agents never handle it as an object. |
| Budget note | `governance/budget.yaml` `daily_usd_limit: 5.00` still conflicts with per-video reality; human-edited file, so flagged to Daniel, not changed here. This arc spends ~$0 API money (thumbnail render on poyais is the only possible paid call and requires explicit go-ahead at that step). |

## Part 1 — structural gate fixes (built first)

### 1a. `image-review` DAG node

`workflows/video-run.md` gains a node:

```
- id: image-review
  dependsOn: [images, motion]
  artifact: assets/_review/ (shard rulings + merged.json) and an honestly-stamped
            assets/scenes/manifest.json
```

`render`'s dependsOn swaps `images` → `image-review` (becoming
`[audio-plan, image-review, metadata, motion, shorts]`). `motion` is a dependency because the
review needs the motion plan's `cutout_layer_ids` to enumerate the full reviewable surface
(layered shots' plates + cutouts, not just `scenes/<id>.png`). The node's work order is the batched
review that already exists as prose in `image-generation/SKILL.md`, now with a DAG node, a
dependsOn, and an artifact — so the DAG can no longer be satisfied by "PNG files exist."

While editing the file, fold in the corrections from fyt-producer's "Known drift" table (the run's
measured reality is authoritative): real paths are `channels/<name>/videos/<slug>/`, judge-gate
writes `judge-verdict.md`, shorts write `shorts/short-NN.md`, audio-plan depends on
`[script, shots, voiceover]` (already true in the def), the images stage is a paid Gemini stage,
and the single-writer staging rule is stated in the def itself.

### 1b. Third `verified` state

`assets/scenes/manifest.json` entries gain `review_status: "unreviewed" | "verified" | "parked"`.

- `unreviewed` — default at generation time. Not shippable.
- `verified` — stamped by the conductor **only** from a batched-review verdict. Shippable.
- `parked` — reviewed, defects known, deliberately not shipping. Not shippable, and *honest*.
  Entry carries `parked_reasons: [...]` naming the defects (or a pointer into `_review/`).

`render.py::resolve_scene_files` maps: only `review_status == "verified"` (or, for backward
compatibility with existing manifests, `verified.scene && verified.rig` when `review_status` is
absent) resolves; `parked` hard-errors with a distinct message that names the parked reasons —
so the failure reads as a decision, not a mystery. The old two-value world forced a
finish-pressured agent to falsify; this gives the honest path a representation.

### 1c. Inert-gate fix (`cutout_layer_ids` must not exempt verification)

Today membership in `cutout_layer_ids` skips the S2 manifest check entirely — which exempted
119/119 wells-fargo shots. New behavior: layered/fallback membership changes **which files** the
gate verifies (the plate + cutout PNGs supplied via the motion plan instead of `scenes/<id>.png`),
never **whether** verification is required. The scenes manifest carries entries for layered shots
too (keyed by shot id, listing their plate/cutout files). Acceptance: a manifest in which nothing
is `verified` must fail the render gate for every shot; the wells-fargo honest re-stamp
(0 verified / 119 flagged) must NOT resolve in a dry run.

### 1d. Deletions and corrections

- Delete `channels/the-second-take/videos/2026-07-19-wells-fargo/assets/plan_pass2.py`.
- fyt-producer's claim that the video-run def is "pinned byte-identical to a fixture" is stale:
  `compile.videoRun.test.ts` on main now loads the real org file across worktrees and asserts the
  stage list + DAG shape. The correction lands in the fyt-runner rewrite (§Part 3).

## Part 2 — the tail (per the tail design; deltas only)

Components, contracts, error handling, and testing are as specified in
`2026-07-20-fyt-post-render-tail-design.md` §Architecture through §Testing:

1. **`compliance-check` skill** — mechanical pass/fail + provenance warn level → `compliance-report.md`.
2. **Thumbnail stage** — `metadata.json` primary concept → `assets/thumbnail.png` (1280×720) via
   image-generation. Thumbnails go through the same review honesty rules: the runner eyeballs and
   stamps, or parks.
3. **Shot-board generator** — per-video self-contained HTML → Claude artifact at a stable per-video
   URL; Gate 2 iteration surface. Reusable standalone (works on any video dir with
   `shots.json` + `library/` + `scenes/`).
4. **`publish-queue` skill** — Gate-3-gated T3, upload private via youtube-uploader MCP, idempotent
   `publish-record.json`. Thumbnail-set and private→public remain manual in Studio.
5. **`analytics-reporter` skill + dashboard** — read-only client on `.env` `YOUTUBE_OAUTH_*` slots;
   JSON under `analytics/<channel>/`; digests appended to `performance.md`; one stable-URL Claude
   artifact dashboard; link in `DASHBOARD.md`.

Deltas vs the tail design text:

- **Segment B1/B2 gain the image-review node explicitly:** B1 ends "…image-generation ∥ voiceover →
  **image-review (batched) → honest stamp** → build shot board → GATE 2". The board renders each
  shot's `review_status` and ruling flags — Gate 2 sees the machine's honesty, not a curated subset.
- The compliance report also asserts Part-1 invariants: every scene either `verified` or the video
  is blocked; no `unreviewed`/`parked` entries behind a rendered final.mp4.

## Part 3 — FYT Runner agent + workflow segments

**`agents/fyt-runner.md`** (kb agent registry, `id: fyt-runner`, `model: claude-opus-4-8`) is the
gates-first rewrite of fyt-producer:

- **Spine = gates.** The file is organized around the three human gates (script / shot board /
  publish) and the mechanical gates between them (preamble, judge-gate, HARD lints at root
  post-merge, image-review + stamp, spend authorization per paid stage, verified render gate,
  compliance). Stages are what happens between gates, each still one skill invocation.
- **Everything fyt-producer learned survives:** R1–R12 operational rules with their teaching
  failures, single-writer staging (`staging/` + conductor-only merge, `wf-<id>` prefixes), exact
  stage commands, spend rules (card-authorised, TTS/images at most once per approved script,
  vo.mp3 reuse law), resume discipline. Stale content corrected (fixture note, drift table rows
  that Part 1 folds into the def itself).
- **Run modes:** full run ("make a video about X for channel Y"), resume-from-gate, single-stage
  ("re-run motion"), targeted repair ("regen shots 12+43 and re-review only those"). All modes end
  at the same gates — partial entry never skips a gate downstream of the change.
- **Repair-and-resume:** on stage failure, diagnose, fix (possibly invoking stage skills directly
  under the same staging rules), resume the same cached workflow run. Paid stages never blindly
  re-run.
- **Self-learning:** append agent lessons to `memory/fyt-runner.md`, pipeline lessons to
  `knowledge/` per operating-law §G-route. Run report per video (stage outcomes, retries, spend,
  deviations).
- **`agents/fyt-producer.md` becomes a tombstone** (one paragraph: superseded by fyt-runner, date,
  pointer), preserving git history for the full old text.

**Workflow segments** live beside `video-run.md` in `orgs/faceless-youtube/workflows/` as committed
Workflow-tool scripts, cut at the human gates:

- `segment-a` — idea → research → script → judge-gate → GATE 1
- `segment-b1` — shorts ∥ metadata → shots → motion → images ∥ voiceover → image-review → stamp →
  shot board → GATE 2
- `segment-b2` — audio-plan → render → verify → thumbnail → compliance → GATE 3
- `segment-c` — publish-queue (T3, in-session, post-approval)

Each stage = one `agent()` call invoking the stage skill; exit condition = the stage artifact
exists and passes that skill's own gate; workflow resume caching is the crash-recovery story.
`video-run.md` remains the declarative DAG of record (the dashboard compiles it); the segment
scripts are its executable form and must state that they derive from it.

## Integration notes

- **`compile.videoRun.test.ts` (main)** asserts the exact stage list and dependency graph and loads
  the real org file across worktrees. Adding `image-review` breaks it. A companion commit on a
  main-based branch updates the assertions (`image-review` node between images/motion and render);
  the PR description instructs merging both together. Until then, editing `video-run.md` on this
  branch may fail dashboard test runs on main — accepted, documented in the PR.
- Wells-fargo's uncommitted manifest edits in the worktree stay uncommitted; all commits in this
  arc use explicit paths (fyt-producer rule R10).
- Poyais is parked at Daniel's watch-through gate for *content*; this arc touches only its tail
  artifacts (thumbnail, compliance report, board), which is exactly the approved live test. run-001
  measured that poyais's lettering was never fully reviewed (~35% defect rate on sampled
  text-bearing shots) — surfacing that is Gate 3's job, not a build blocker; the compliance report
  will carry the caveat.

## Build order

1. Part 1 gate fixes (node + third state + cutout fix + companion test + plan_pass2 deletion)
2. `compliance-check` (immediately testable on poyais)
3. Thumbnail stage
4. Shot-board generator (testable on poyais's shots + library)
5. `publish-queue` (MCP wiring + record)
6. `analytics-reporter` + dashboard
7. FYT Runner agent + workflow segments (lands last)
8. Live: poyais thumbnail → compliance → board → GATE 3 (Daniel) → segment-c upload

Steps 2–6 are independent of each other and may be parallelized by the orchestrator; step 1 lands
first (7 depends on all; 8 on 1–5 + Daniel's setup of analytics OAuth for the analytics live pull).

## Out of scope (unchanged from the tail design)

Deep originality/IP audit; scheduled/self-initiating cadence; generic content-pipeline abstraction;
kb fleet-dashboard integration; A/B thumbnail automation; wells-fargo remediation (parked, own card).
