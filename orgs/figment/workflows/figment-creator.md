---
id: figment-creator
project: figment
title: Run one creator persona through the S2-S9 pipeline
profile: creator
governedBy: figment-runner
manager:
  agentId: figment-runner
  profileId: manager:claude:claude-opus-5
parameters: [persona_id, batch_id]
stages:
  - id: expand-s2
    phase: S2
    title: Expansion-02 identity generation and raw scoring
    action: build:identity-expansion
    target: orgs/figment/personas
    riskTier: T2
    governedBy: figment-expand
    agentId: figment-expand
    profileId: worker:claude:claude-sonnet-5
    workOrder: "Build the 60-cell allocation from persona.grammar and run the 6 ephemeral-pod manifests for expansion-02 (S2), under an approved GATE S spend card. Score every cell raw-only — no automated pass/fail. Never proceed past the manifest preflight if the job budget cannot fit the run's own max_minutes."
    artifacts:
      - id: expansion-batch
        path: orgs/figment/personas/<persona_id>/batches/<batch_id>/batch.json
        description: The append-only batch state machine — cells, pod-run rows, and raw scores for expansion-02.
  - id: checker-gate-a-review
    phase: S2
    title: Identity-gate review feeding GATE A
    action: review:identity-gate
    target: orgs/figment/personas
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [expand-s2]
    workOrder: "Build the blinded contact-sheet board over expansion-02's 60 cells and stage it for the operator's seven-axis rulings. figment-checker never rules the board itself; it prepares the review surface and, once rulings land, writes the qa_stamp.py record fail-closed on any missing or malformed safety axis."
    artifacts:
      - id: qa-stamp
        path: orgs/figment/personas/<persona_id>/batches/<batch_id>/gate.json
        description: The SHA-bound gate record the operator reads at GATE A.
  - id: train-lora-v1
    phase: S3
    title: Train persona LoRA v1 (S2 only, provisional clothed proof)
    action: build:lora-train
    target: orgs/figment/pipeline/train
    riskTier: T2
    governedBy: figment-train
    agentId: figment-train
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-a-review]
    humanGates:
      - id: gate-a
        kind: approval
        prompt: "GATE A — identity grid. Read the blind board and the operator's seven-axis rulings for expansion-02, then approve to release LoRA v1 training on S2 only. Nothing proceeds to S3 without verified on >=40 cells and every one of the 40 strata represented."
    workOrder: "Train persona LoRA v1 on the >=40 curated approved S2 cells only, then run the dataset-tester grid (12 parallel branches, one fixed prompt and seed) so figment-checker can rank checkpoints for GATE B."
    artifacts:
      - id: lora-v1-candidates
        path: orgs/figment/pipeline/train/runs/<batch_id>/checkpoints
        description: The ranked LoRA v1 checkpoint candidates for the operator's GATE B pick.
  - id: checker-checkpoint-b-review
    phase: S3
    title: Checkpoint-rank review feeding GATE B
    action: review:checkpoint-rank
    target: orgs/figment/pipeline/train
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [train-lora-v1]
    workOrder: "Review the LoRA v1 dataset-tester grid against the held-out acceptance protocol and write a ranked-checkpoint note for the operator's GATE B pick. figment-checker never picks the checkpoint itself."
    artifacts:
      - id: checkpoint-review
        path: orgs/figment/pipeline/train/runs/<batch_id>/checkpoint-review.json
        description: The ranked checkpoint review the operator reads at GATE B.
  - id: expand-s2b-swimwear
    phase: S2b
    title: Swimwear/lingerie tier extension batch
    action: build:swimwear-expansion
    target: orgs/figment/personas
    riskTier: T2
    governedBy: figment-expand
    agentId: figment-expand
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-checkpoint-b-review]
    humanGates:
      - id: gate-b
        kind: approval
        prompt: "GATE B — checkpoint pick. Read figment-checker's ranked checkpoint review, then approve the LoRA v1 checkpoint used as this batch's and S2c's reference generator."
    workOrder: "Generate 12-16 swimwear/lingerie cells as its own batch, own gate, excluded from LoRA v1, using the GATE-B-picked LoRA v1 checkpoint as reference. The garment classifier flag is a triage route to the board, never an automatic quarantine."
    artifacts:
      - id: swimwear-batch
        path: orgs/figment/personas/<persona_id>/batches/<batch_id>-s2b/batch.json
        description: The S2b batch state — cells, raw scores, and pod-run rows.
  - id: checker-gate-a2-review
    phase: S2b
    title: Swimwear identity-gate review feeding GATE A2
    action: review:identity-gate
    target: orgs/figment/personas
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [expand-s2b-swimwear]
    workOrder: "Build the blinded board over the S2b batch and, once the operator's seven-axis rulings land, write the qa_stamp.py record fail-closed on any missing or malformed safety axis."
    artifacts:
      - id: qa-stamp-a2
        path: orgs/figment/personas/<persona_id>/batches/<batch_id>-s2b/gate.json
        description: The SHA-bound gate record the operator reads at GATE A2.
  - id: expand-s2c-fullbody
    phase: S2c
    title: Full-body second pass from the GATE-B checkpoint
    action: build:fullbody-expansion
    target: orgs/figment/personas
    riskTier: T2
    governedBy: figment-expand
    agentId: figment-expand
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-checkpoint-b-review]
    humanGates:
      - id: gate-b-fullbody
        kind: approval
        prompt: "GATE B — checkpoint pick (same decision as expand-s2b-swimwear). Approving releases the full-body second pass, generated from the picked LoRA v1 checkpoint, never as a single full-frame identity swap."
    workOrder: "Generate 16-20 full-body cells at the same 5 angles x 4 lights, clothed wardrobe families only, from an approved LoRA-v1 (or S2-curated) reference. The face-pixel floor hard-routes only once min_face_px is locked at GATE A with a matching calibration_set_sha; otherwise it routes to review, not automatic quarantine."
    artifacts:
      - id: fullbody-batch
        path: orgs/figment/personas/<persona_id>/batches/<batch_id>-s2c/batch.json
        description: The S2c batch state — cells, raw scores, and pod-run rows.
  - id: checker-gate-a3-review
    phase: S2c
    title: Full-body identity-gate review feeding GATE A3
    action: review:identity-gate
    target: orgs/figment/personas
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [expand-s2c-fullbody]
    workOrder: "Build the blinded board over the S2c batch and, once the operator's seven-axis rulings land, write the qa_stamp.py record fail-closed on any missing or malformed safety axis."
    artifacts:
      - id: qa-stamp-a3
        path: orgs/figment/personas/<persona_id>/batches/<batch_id>-s2c/gate.json
        description: The SHA-bound gate record the operator reads at GATE A3.
  - id: train-lora-v2
    phase: S3
    title: Train production persona LoRA v2 on S2 union S2b union S2c
    action: build:lora-train
    target: orgs/figment/pipeline/train
    riskTier: T2
    governedBy: figment-train
    agentId: figment-train
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-a2-review, checker-gate-a3-review]
    humanGates:
      - id: gate-a2
        kind: approval
        prompt: "GATE A2 — swimwear identity grid. Read the blind board and rulings for the S2b batch, then approve. LoRA v2 folds S2b in only after this and GATE A3 both clear."
      - id: gate-a3
        kind: approval
        prompt: "GATE A3 — full-body identity grid. Read the blind board and rulings for the S2c batch, then approve. LoRA v2 trains on S2 union S2b union S2c only once this and GATE A2 both clear."
    workOrder: "Train the production LoRA v2 on the union of the S2, S2b, and S2c curated approved cells, then run the dataset-tester grid so figment-checker can rank checkpoints for GATE B2."
    artifacts:
      - id: lora-v2-candidates
        path: orgs/figment/pipeline/train/runs/<batch_id>-v2/checkpoints
        description: The ranked LoRA v2 checkpoint candidates for the operator's GATE B2 pick.
  - id: checker-checkpoint-b2-review
    phase: S3
    title: Checkpoint-rank review feeding GATE B2
    action: review:checkpoint-rank
    target: orgs/figment/pipeline/train
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [train-lora-v2]
    workOrder: "Review the LoRA v2 dataset-tester grid against the held-out acceptance protocol and write a ranked-checkpoint note for the operator's GATE B2 pick."
    artifacts:
      - id: checkpoint-review-v2
        path: orgs/figment/pipeline/train/runs/<batch_id>-v2/checkpoint-review.json
        description: The ranked checkpoint review the operator reads at GATE B2.
  - id: register-lock-s4
    phase: S4
    title: Register lock and register grids
    action: build:register-lock
    target: orgs/figment/pipeline/train
    riskTier: T2
    governedBy: figment-train
    agentId: figment-train
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-checkpoint-b2-review]
    humanGates:
      - id: gate-b2
        kind: approval
        prompt: "GATE B2 — checkpoint pick. Read figment-checker's ranked LoRA v2 checkpoint review, then approve the production checkpoint. Register grids run only against the picked checkpoint."
    workOrder: "Lock the persona's register against the picked LoRA v2 checkpoint and produce the register grids figment-checker reviews for GATE C's identity-floor and adherence proof."
    artifacts:
      - id: register-grids
        path: orgs/figment/pipeline/register/<persona_id>/grids
        description: The register grids the operator's GATE C proof reads.
  - id: checker-gate-c-review
    phase: S4
    title: Register-proof review feeding GATE C
    action: review:register-proof
    target: orgs/figment/pipeline/register
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [register-lock-s4]
    workOrder: "Review the register grids against the identity floor and register-adherence protocol and write the register-proof note for the operator's GATE C decision."
    artifacts:
      - id: register-proof
        path: orgs/figment/pipeline/register/<persona_id>/register-proof.json
        description: The register-proof review the operator reads at GATE C.
  - id: render-pass-ab
    phase: S5
    title: Pass A/B promotion candidates (12 cells)
    action: build:pass-ab
    target: orgs/figment/pipeline/passes
    riskTier: T2
    governedBy: figment-render
    agentId: figment-render
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-c-review]
    humanGates:
      - id: gate-c
        kind: approval
        prompt: "GATE C — register proof. Read figment-checker's register-proof note, then approve to release the 12-cell pass A/B promotion candidates."
    workOrder: "Generate the 12-cell pass A/B candidate set (passes 0-4, persona-LoRA strength 0.65-0.80, refine at denoise 0.35) for figment-checker's blinded eye-gate review at GATE D."
    artifacts:
      - id: pass-ab-candidates
        path: orgs/figment/pipeline/passes/<persona_id>/pass-ab
        description: The 12 pass A/B candidate cells for the blinded GATE D review.
  - id: checker-gate-d-review
    phase: S5
    title: Pass A/B blinded review feeding GATE D
    action: review:pass-ab
    target: orgs/figment/pipeline/passes
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [render-pass-ab]
    workOrder: "Build the blinded board over the pass A/B candidates for the operator's GATE D promotion decision."
    artifacts:
      - id: pass-ab-board
        path: orgs/figment/pipeline/passes/<persona_id>/pass-ab-board.html
        description: The blinded pass A/B board the operator reads at GATE D.
  - id: render-video-proofs
    phase: S6
    title: Video V1/V2 proofs
    action: build:video-proofs
    target: orgs/figment/pipeline/video
    riskTier: T2
    governedBy: figment-render
    agentId: figment-render
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-d-review]
    humanGates:
      - id: gate-d
        kind: approval
        prompt: "GATE D — pass promotion, blinded eye-gate. Read the blinded pass A/B board, then approve the promoted pass. Approving releases the S6 video V1/V2 proof generation."
    workOrder: "Generate the V1 and V2 video proofs against the promoted pass, at the reconciled Wan-2.2 TI2V-5B motion settings, for figment-checker's frame-QA and manifest-schema review at GATE D2."
    artifacts:
      - id: video-proofs
        path: orgs/figment/pipeline/video/<persona_id>/proofs
        description: The V1/V2 video proofs for the GATE D2 eye-gate.
  - id: checker-gate-d2-review
    phase: S6
    title: Video eye-gate review feeding GATE D2
    action: review:video-gate
    target: orgs/figment/pipeline/video
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [render-video-proofs]
    workOrder: "Run frame-QA and manifest-schema checks over the V1/V2 proofs and write the video-gate note for the operator's GATE D2 decision."
    artifacts:
      - id: video-gate-review
        path: orgs/figment/pipeline/video/<persona_id>/video-gate-review.json
        description: The frame-QA and manifest-schema review the operator reads at GATE D2.
  - id: content-week-plan
    phase: S7
    title: Author the week's content plan
    action: build:week-plan
    target: orgs/figment/pipeline/content
    riskTier: T2
    governedBy: figment-content
    agentId: figment-content
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [checker-gate-d2-review]
    humanGates:
      - id: gate-d2
        kind: approval
        prompt: "GATE D2 — video eye-gate. Read figment-checker's frame-QA and manifest-schema note, then approve. Approving releases the week's content-strategy plan."
    workOrder: "Run content/plan_week.py against taxonomy.yaml, carousel-templates.yaml, and reel-templates.yaml to enumerate the week's 14 stills + 3 videos across the declared A-G mix. Author only — no pixels or spend here."
    artifacts:
      - id: week-plan
        path: orgs/figment/pipeline/content/<persona_id>/week-plan.json
        description: The week plan the operator approves at GATE E — the generation-spend authorization.
  - id: render-batch-generate
    phase: S5
    title: Generate the week's batch content
    action: build:batch-generate
    target: orgs/figment/pipeline/passes
    riskTier: T2
    governedBy: figment-render
    agentId: figment-render
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [content-week-plan]
    humanGates:
      - id: gate-e
        kind: approval
        prompt: "GATE E — week-plan approval, the generation spend authorization. Read figment-content's week plan, then approve to release this run's generation spend for the week's stills and videos."
        spendAuthorization: true
    workOrder: "Generate the week's stills and videos against the approved week plan, one cell per planned slot, at the declared aspect ratios (3:4 1080x1440 stills, 9:16 1080x1920 reels). Bounded by GATE E's spend authorization only."
    artifacts:
      - id: week-batch
        path: orgs/figment/pipeline/passes/<persona_id>/week-batch
        description: The generated week batch for figment-checker's QA-board review feeding GATE F.
  - id: checker-qa-board-review
    phase: S8
    title: QA-board review feeding GATE F
    action: review:qa-board
    target: orgs/figment/pipeline/passes
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [render-batch-generate]
    workOrder: "Build the QA board over the week batch (all seven rulings axes, three-state badge, parked reasons) for the operator's GATE F batch-approval decision."
    artifacts:
      - id: qa-board
        path: orgs/figment/pipeline/passes/<persona_id>/qa-board.html
        description: The QA board the operator reads at GATE F.
  - id: poster-schedule
    phase: S8
    title: Schedule the approved batch
    action: build:schedule
    target: orgs/figment/pipeline/publish
    riskTier: T2
    governedBy: figment-poster
    agentId: figment-poster
    profileId: worker:claude:claude-opus-5
    dependsOn: [checker-qa-board-review]
    humanGates:
      - id: gate-f
        kind: approval
        prompt: "GATE F — batch approval. Read the QA board, then approve to release scheduling for the approved cells only."
    workOrder: "Write the calendar schedule for the approved batch cells against each target account's readiness record. Refuses to schedule any account whose disclosure preflight or readiness record is not verified. Never touches a credential as an object."
    artifacts:
      - id: schedule
        path: orgs/figment/pipeline/publish/<persona_id>/schedule.json
        description: The per-account schedule for figment-checker's publish-audit review.
  - id: checker-publish-audit
    phase: S8
    title: Publish-audit review — mandatory adversarial review of the posting unit
    action: review:publish-audit
    target: orgs/figment/pipeline/publish
    riskTier: T2
    governedBy: figment-checker
    agentId: figment-checker
    profileId: worker:claude:claude-opus-5
    dependsOn: [poster-schedule]
    workOrder: "Independently re-verify the schedule's disclosure preflight, quota, and idempotency-key uniqueness before any container is created. This is the posting unit's mandatory adversarial review — figment-poster authored the schedule, figment-checker never authors what it audits."
    artifacts:
      - id: publish-audit
        path: orgs/figment/pipeline/publish/<persona_id>/publish-audit.json
        description: The publish-audit review the operator reads at GATE G.
  - id: poster-publish
    phase: S8
    title: Publish and measure
    action: publish:post
    target: orgs/figment/pipeline/publish
    riskTier: T3
    governedBy: figment-poster
    agentId: figment-poster
    profileId: worker:claude:claude-opus-5
    dependsOn: [checker-publish-audit]
    humanGates:
      - id: gate-g
        kind: approval
        prompt: "GATE G — publish approval. Read figment-checker's publish-audit review, then approve with the operator's T3 publish token (dashboard/WebAuthn channel only) to authorize container creation and posting."
        publicationAuthorization: true
    workOrder: "Create the container with is_ai_generated at creation time, publish idempotently per idempotency_key, and record the post. Only after GATE G's T3 token is present; refuses closed on any missing disclosure or quota exhaustion."
    artifacts:
      - id: post-record
        path: orgs/figment/pipeline/publish/posts/<persona_id>
        description: The durable post record — media_id, container_id, idempotency_key, published_at.
  - id: analyst-measure
    phase: S9
    title: Nightly insights pull
    action: build:insights-pull
    target: orgs/figment/pipeline/insights
    riskTier: T2
    governedBy: figment-analyst
    agentId: figment-analyst
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [poster-publish]
    mutating: false
    workOrder: "Pull nightly insights at +24h/+48h/+7d into the local warehouse, one file per account per day. Never grade a post younger than 48 hours."
    artifacts:
      - id: warehouse-row
        path: orgs/figment/pipeline/insights/warehouse/<persona_id>
        description: The per-account, per-day warehouse rows the optimiser reads.
  - id: analyst-optimise
    phase: S9
    title: Optimiser proposal
    action: build:optimiser-proposal
    target: orgs/figment/pipeline/insights
    riskTier: T2
    governedBy: figment-analyst
    agentId: figment-analyst
    profileId: worker:claude:claude-sonnet-5
    dependsOn: [analyst-measure]
    humanGates:
      - id: gate-h
        kind: approval
        prompt: "GATE H — mix change. Read the optimiser's proposed diff to the weekly mix and template ranking, then approve or reject. The optimiser never edits the live mix unattended."
    workOrder: "Compute the eight KPIs from the local warehouse and propose one diff to content/taxonomy.yaml and the template ranking, or a no-change report. Never applies the diff itself."
    artifacts:
      - id: optimiser-proposal
        path: orgs/figment/pipeline/insights/<persona_id>/optimiser-proposal.json
        description: The proposed mix/template diff the operator approves or rejects at GATE H.
---

# figment-creator — run one creator persona through S2-S9

Runs creator-001's stage graph from expansion-02 identity generation through publish and
optimise. The persona and the active batch are supplied at launch; wherever a work order
says `<persona_id>`/`<batch_id>`, substitute the launch-supplied values.

Tonight this file is **declarative only**: no card is dispatched, and no account,
scheduler, or publisher is activated by its existence. Approving a human gate is a
recorded decision the operator makes, never inferred from a successful worker exit —
a stage reporting DONE proves the stage ran, not that any downstream gate cleared.

## The roster

Nine declarations under `agents/figment-*.md`: `figment-runner` (conductor —
launches, sequences, gates, never crafts or grades), `figment-checker` (cross-cutting
fresh-context gate service — every Instagram-tier verdict, never touches
explicit-tier), `figment-expand` (S2/S2b/S2c), `figment-train` (S3/S4),
`figment-render` (S5/S6/SV), `figment-content` (S7), `figment-poster` (S8, no model
downgrade), and `figment-analyst` (S9 + insights/token-health cadences). The four
research cadences (`figment-researcher`) run outside this DAG, per
`orgs/figment/HEARTBEAT.md`.

## Gate spine (read-only restatement — the source of record is the design doc)

```
anchor (closed) -> GATE S spend card approved (operator, T2, BEFORE the first create)
  -> expansion-02 -> GATE A identity grid (operator)
  -> LoRA v1 train (S2 only) -> dataset-tester rank -> GATE B checkpoint pick (operator)
  -> S2b swimwear -> GATE A2 . S2c full-body (from the GATE-B checkpoint) -> GATE A3
  -> LoRA v2 train (S2 union S2b union S2c) -> dataset-tester rank -> GATE B2 checkpoint pick (operator)
  -> register grids -> GATE C register proof (operator)
  -> pass A/B -> GATE D pass promotion (blinded eye-gate)
  -> video V1/V2 proofs -> GATE D2 video eye-gate (operator)
  -> week plan -> GATE E week-plan approval (operator; the generation spend authorization)
  -> batch generate -> QA board -> GATE F batch approval (operator)
  -> schedule -> GATE G publish approval (operator, T3 token) -> post -> measure -> optimiser proposal
  -> GATE H mix change (operator)
```

Every gate writes a `gate.json` record bound to its subject's sha256. A downstream gate
reopens automatically when its subject changes — a re-run expansion invalidates GATE A,
a re-picked checkpoint invalidates GATE C, and so on.

## Author-never-grades

`figment-checker` reviews every stage's output in fresh context and never authors what
it grades. Craft agents (`figment-expand`, `figment-train`, `figment-render`,
`figment-content`, `figment-poster`, `figment-analyst`) never stamp a gate that
unblocks their own work — every review boundary above is a distinct stage owned by
`figment-checker`, sitting between the craft stage and the human gate it feeds.

## Boundaries

- Explicit-tier generation (SX/SX-T) is entirely outside this DAG — operator hardware,
  operator hand, never an agent invocation.
- Handle no credential as an object; the RunPod and Meta credentials are ambient-only.
- Incur paid-API or pod cost only on a stage whose declared human gate names a spend
  authorization (`gate-e`) or under an approved GATE S spend card, and never beyond
  that run's declared ceiling.
