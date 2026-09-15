---
id: figment-creator
project: figment
title: Run one creator persona through the eight-stage pipeline
profile: creator
governedBy: figment-runner
manager:
  agentId: figment-runner
  profileId: manager:claude:claude-opus-5
parameters: [persona_id, run_root]
stages:
  - id: anchor
    phase: anchor
    title: Anchor stage (identity source of record)
    action: pipeline:run-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-expand
    agentId: figment-expand
    profileId: worker:claude:claude-sonnet-5
    workOrder: "`figment_train.py plan --stage anchor` then `run --stage anchor` for <persona_id>, under the plan's own per-manifest --max-usd/--max-minutes. On creator-001 the operator-supplied g01/g02/g07 references are already the anchor of record — this stage runs only when a fresh anchor candidate is actually being generated, never to re-derive an existing one."
    artifacts:
      - id: anchor-plan
        path: orgs/figment/runs/<persona_id>/<run_root>/plan.json
        description: The anchor stage's manifest and harness argv inside the primary plan.
  - id: checker-gate-anchor
    phase: anchor
    title: Anchor gate-prep review
    action: pipeline:grade-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [anchor]
    workOrder: "Run `grade --stage anchor` to build the full-resolution board and rulings template. figment-checker never rules the board itself — it prepares the review surface; `identity_gate`/`vlm_judge` supply the automated score rows, the operator supplies the seven-axis ruling via `apply-rulings`."
    artifacts:
      - id: anchor-gate
        path: orgs/figment/runs/<persona_id>/<run_root>/grade/anchor/gate.json
        description: The numeric figment/gate@1 score table the operator's GATE anchor ruling reads alongside the board.
  - id: dataset
    phase: dataset
    title: Dataset stage
    action: pipeline:run-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-expand
    agentId: figment-expand
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-anchor]
    humanGates:
      - id: gate-anchor
        kind: approval
        prompt: "GATE anchor. Read the anchor board and gate table, then apply-rulings. Dataset plans only against a current anchor ruling."
    workOrder: "`plan --stage dataset` then `run --stage dataset`. The train-first path (Path-A, r24 method 4 + r21 DOP) skips this stage entirely and screens an already-captioned dataset directory instead (`train-first --dataset-dir`) — run this stage only when the module-10-style dataset builder is the chosen path for this persona, not on the live train-first path."
    artifacts:
      - id: dataset-plan
        path: orgs/figment/runs/<persona_id>/<run_root>/plan.json
        description: The dataset stage's manifest and harness argv inside the primary plan.
  - id: checker-gate-dataset
    phase: dataset
    title: Dataset gate-prep review
    action: pipeline:grade-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [dataset]
    workOrder: "Run `grade --stage dataset` and prepare the board/rulings template for the operator's GATE dataset ruling."
    artifacts:
      - id: dataset-gate
        path: orgs/figment/runs/<persona_id>/<run_root>/grade/dataset/gate.json
        description: The dataset stage's gate table.
  - id: smoke-and-train
    phase: train
    title: Training smoke and full train (not gradeable)
    action: pipeline:run-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-train
    agentId: figment-train
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-dataset]
    humanGates:
      - id: gate-dataset
        kind: approval
        prompt: "GATE dataset. Read the dataset board and gate table, then apply-rulings. `smoke` and `train` run only against a current dataset ruling (or, on train-first, a recorded `dataset-approval.json`)."
    workOrder: "`run --stage smoke` then `run --stage train`. Neither is gradeable — no per-cell ruling makes sense for a training smoke or a full training run; the checkpoint ladder it produces is screened at GATE tester, not here. Train's ceiling is derived from steps x the per-step rate (`_apply_train_budget`), read off the plan, never assumed."
    artifacts:
      - id: train-checkpoints
        path: orgs/figment/runs/<persona_id>/<run_root>/train/runs/out
        description: The checkpoint ladder (11 intermediates + final at the current 3000-step/DOP profile) for GATE tester to screen.
  - id: checker-gate-tester
    phase: tester
    title: Tester gate-prep review (checkpoint ranking)
    action: pipeline:grade-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [smoke-and-train]
    workOrder: "`run --stage tester` (or plan tester directly against `--import-checkpoints <dir>` for an operator-trained ladder, MANDATE.md's tier constraint), then `grade --stage tester` to build the board and rulings template ranking every checkpoint. figment-checker never picks the checkpoint — the operator does, via `apply-rulings --checkpoint-step <N>`, and never defaults it to the final step."
    artifacts:
      - id: tester-gate
        path: orgs/figment/runs/<persona_id>/<run_root>/grade/tester/gate.json
        description: The per-checkpoint gate table the operator's GATE tester pick reads.
  - id: gen
    phase: gen
    title: Base generation against the accepted checkpoint
    action: pipeline:run-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-render
    agentId: figment-render
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-tester]
    humanGates:
      - id: gate-tester
        kind: approval
        prompt: "GATE tester — checkpoint pick. Read the tester board and gate table, then apply-rulings --checkpoint-step <N> (or omit it to record an all-cull rejection). `gen` plans only once `grade/tester/accepted-checkpoint.json` exists."
    workOrder: "`plan --stage gen` (optionally `--style-lora <key> --style-lora-strength <x>` for a prospective skin-texture A/B) then `run --stage gen`, against the accepted checkpoint only — the planner revalidates persona, checkpoint, and upstream approval bytes before launch."
    artifacts:
      - id: gen-plan
        path: orgs/figment/runs/<persona_id>/<run_root>/downstream/gen/plan.json
        description: The gen stage's plan, planned automatically by `pipeline` once tester is ruled.
  - id: checker-gate-gen
    phase: gen
    title: Gen gate-prep review
    action: pipeline:grade-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [gen]
    workOrder: "`grade --stage gen` and prepare the board/rulings template for the operator's GATE gen ruling."
    artifacts:
      - id: gen-gate
        path: orgs/figment/runs/<persona_id>/<run_root>/downstream/gen/grade/gen/gate.json
        description: The gen stage's gate table.
  - id: detail
    phase: detail
    title: Detail pass over gen's kept stills
    action: pipeline:run-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-render
    agentId: figment-render
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-gen]
    humanGates:
      - id: gate-gen
        kind: approval
        prompt: "GATE gen. Read the gen board and gate table, then apply-rulings. `detail` plans automatically once gen is ruled, always against gen's own kept stills — never an operator-supplied glob."
    workOrder: "`pipeline` plans and runs `detail` automatically once GATE gen clears (F2): MediaPipe face-detailer at the package's own denoise band (0.15/0.27 A/B pair per kept image), same accepted checkpoint `gen` uses."
    artifacts:
      - id: detail-plan
        path: orgs/figment/runs/<persona_id>/<run_root>/downstream/detail/plan.json
        description: The detail stage's plan.
  - id: checker-gate-detail
    phase: detail
    title: Detail gate-prep review
    action: pipeline:grade-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [detail]
    workOrder: "`grade --stage detail` and prepare the board/rulings template for the operator's GATE detail ruling. Once ruled, `pipeline` writes `deliverable/manifest.json` (stills + detail images + lineage)."
    artifacts:
      - id: detail-gate
        path: orgs/figment/runs/<persona_id>/<run_root>/downstream/detail/grade/detail/gate.json
        description: The detail stage's gate table.
  - id: video
    phase: video
    title: Video stage (I2V candidate, assembly, frame QA)
    action: pipeline:run-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-render
    agentId: figment-render
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-detail]
    humanGates:
      - id: gate-detail
        kind: approval
        prompt: "GATE detail. Read the detail board and gate table, then apply-rulings."
    workOrder: "`pipeline` plans video automatically once gen is ruled (F6a; the run root must be inside the repository — `_video_authority_root`): a Wan 2.2 review-candidate manifest against one of gen's own kept stills, the bounded pod harness renders it, then local evidence (assembly, reel derivative, frame extraction) is built for grading."
    artifacts:
      - id: video-evidence
        path: orgs/figment/runs/<persona_id>/<run_root>/downstream/video/video
        description: The assembled candidate, reel derivative, and extracted sample frames.
  - id: checker-gate-video
    phase: video
    title: Video gate-prep review (identity under motion)
    action: pipeline:grade-stage
    target: orgs/figment/pipeline/figment_train.py
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [video]
    workOrder: "`grade --stage video` scores every 8th of the 81 native frames (11 cells) through the existing identity/judge gate — `identity` on each sampled frame IS 'the face holds here under motion'. Prepare the board/rulings template for the operator's GATE video ruling."
    artifacts:
      - id: video-gate
        path: orgs/figment/runs/<persona_id>/<run_root>/downstream/video/grade/video/gate.json
        description: The per-frame gate table the operator's GATE video ruling reads.
  - id: content-plan
    phase: content
    title: Author the content plan (stage 7)
    action: build:content-brief
    target: orgs/figment/pipeline/content
    riskTier: T2
    governedBy: figment-content
    agentId: figment-content
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-video]
    humanGates:
      - id: gate-video
        kind: approval
        prompt: "GATE video. Read the video board and per-frame gate table, then apply-rulings. Approving completes the deliverable's video block."
    workOrder: "Author a content brief (`content_brief.py`) against `content/taxonomy.yaml` and the deliverable's kept stills/detail/video. Author only — no pixels or spend here; joining approved media to slots is `content_asset_binding.py`, a separate offline step."
    artifacts:
      - id: content-brief
        path: orgs/figment/content/briefs/<persona_id>-<slug>/brief.json
        description: The content brief the operator reviews before any account posts from it.
  - id: analyst-insights
    phase: post-and-optimise
    title: Post, measure, optimise (stages 8-9)
    action: build:insights-pull
    target: orgs/figment/pipeline
    riskTier: T3
    governedBy: figment-poster
    agentId: figment-poster
    profileId: worker:claude:claude-opus-5
    dependsOn: [content-plan]
    mutating: false
    workOrder: "BLOCKED on operator provisioning (Instagram professional test account, Meta app + OAuth grant, Fanvue written confirmation — see STATE.md). No Graph API client, no publish path, and no insights reader exist under orgs/figment or dashboard/server today; this stage is a placeholder for that future work, not a runnable step."
    artifacts:
      - id: post-record
        path: orgs/figment/pipeline/publish/posts/<persona_id>
        description: Not yet implemented — recorded here as the eventual target path.
---

# figment-creator — run one creator persona through the pipeline

Runs one creator persona through `figment_train.py`'s eight CLI stages — `anchor`,
`dataset`, `smoke`, `train`, `tester`, `gen`, `detail`, `video` — plus the content/post/
optimise stages beyond the CLI (7-9). The persona and run root are supplied at launch;
wherever a work order says `<persona_id>`/`<run_root>`, substitute the launch-supplied
values.

This file is **declarative only**: no card is dispatched, and no account, scheduler, or
publisher is activated by its existence. Approving a human gate is a recorded decision the
operator makes via `apply-rulings`, never inferred from a successful worker exit — a stage
reporting DONE proves the stage ran, not that any downstream gate cleared. This supersedes
the earlier `S2...S9` / `expand-s2` / `train-lora-v1` stage graph, which described a
pipeline that never existed in code (`docs/figment/AUDIT-2026-09-15.md` "Docs contradicting
the code": the CLI's real stages have always been the eight named above, driven by one
`pipeline` command since P4a, not a nine-phase agent DAG with its own LoRA-v1/v2 split).

## The roster

Agent declarations under `agents/figment-*.md`: `figment-runner` (conductor — launches,
sequences, gates, never crafts or grades), `figment-checker` (cross-cutting fresh-context
gate-prep service for every gradeable stage — `anchor`, `dataset`, `tester`, `gen`,
`detail`, `video` — running `grade` and staging the board/rulings template; it never
touches explicit-tier content and never stamps the ruling itself, since a ruling is a
human act per `contract.md`), `figment-expand` (`anchor`, `dataset`), `figment-train`
(`smoke`, `train`), `figment-render` (`gen`, `detail`, `video`), `figment-content` (stage
7), `figment-poster` (stage 8, not yet runnable — blocked on operator provisioning), and
`figment-analyst` (stage 9 + insights/token-health cadences). The four research cadences
(`figment-researcher`) run outside this DAG, per `orgs/figment/HEARTBEAT.md` — those seven
cadences (weekly cohort scan, weekly platform trends, fortnightly tooling watch, monthly
Fanvue economics, daily insights pull, daily token-health, weekly optimiser) are unchanged
by this rewrite and still `armed: false`.

## Gate spine (read-only restatement — the source of record is `pipeline/README.md`'s
"The gate" and `RUNBOOK.md`'s "The gates, in order")

```
anchor -> GATE anchor (operator, seven axes)
  -> dataset -> GATE dataset (operator; skipped entirely on the live train-first path,
     which screens an already-captioned dataset dir + dataset-approval.json instead)
  -> smoke -> train (neither gradeable -- the checkpoint ladder is screened at GATE tester)
  -> tester -> GATE tester (operator picks --checkpoint-step by the tester's own ranking,
     never defaults to the final step; or records an all-cull rejection)
  -> gen (planned automatically once tester is ruled) -> GATE gen (operator)
  -> detail (planned automatically once gen is ruled, always against gen's own kept
     stills) -> GATE detail (operator) -> deliverable/manifest.json written
  -> video (planned automatically once gen is ruled, in-repo run roots only)
     -> GATE video (operator; identity-under-motion on 11 sampled frames)
     -> deliverable gains video/<candidate id>.mp4
  -> content brief (stage 7, author-only)
  -> post/measure/optimise (stages 8-9, BLOCKED on operator provisioning)
```

Every gate's `gate.json` (the single writer, `identity_gate.write_gate_document`) is bound
to its subject's sha256 via the `figment/approval-lineage@1` record `apply-rulings` writes.
A downstream gate has nothing to reopen automatically the way the old S2-S9 graph's
per-batch gates did — each of these eight stages plans and grades against its own
upstream stage's approval-lineage every time, so a changed upstream ruling is caught at the
next plan/run boundary, not by a separate reopening mechanism.

## Author-never-grades

`figment-checker` runs `grade` and stages the review surface for every gradeable stage but
never authors the craft stage it reviews, and never rules a stage itself — the operator's
`apply-rulings` is the only path to a kept/culled decision. Craft agents (`figment-expand`,
`figment-train`, `figment-render`, `figment-content`, `figment-poster`, `figment-analyst`)
never stamp a gate that unblocks their own work.

## Boundaries

- Explicit-tier generation is entirely outside this DAG — operator hardware, operator
  hand, never an agent invocation (MANDATE.md's tier constraint).
- Handle no credential as an object; the RunPod and Meta credentials are ambient-only.
- Incur paid-API or pod cost only through a plan's own recorded `--max-usd`/`--max-minutes`
  ceiling, and only after the plan-time budget preflight clears (or `--accept-budget` is
  explicitly passed) — never beyond that run's declared ceiling.
