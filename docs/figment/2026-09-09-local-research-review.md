# Local-research grading review — 2026-09-09

## Verdict

**READY** for the bounded research tester-to-selection-to-generation path. This is not a
production approval and does not establish identity quality. The repository schema still has no
machine-enforced research/production scope, so operators must preserve that limitation in the
rulings and downstream use.

Reviewed against base `05056a7a` at these exact file digests:

- `identity_gate.py`: `d5f9b7b3d0b2897aeb0ff8451ea8fc079ff97f500599540f1ab9a6f795abdeb6`
- `figment_train.py`: `2bea43169bf7e7d5238f60d74da618f800aea854718b9c775ece2dce73d38b41`
- `test_identity_gate.py`: `c32700200a54147801846fe7659ebb0f053debfd8c797d1f03fcfee933955bf8`
- `test_figment_train.py`: `701664340cbc03fd19fede6e98b5233668ea8a986ffaff0f8661e43787d45b31`
- operator runbook: `23ef5a16099bcdf9fc4a3449f85b27733d9b77d30ef654917af798fa4a17b34c`
- v2 post-train readiness note: `3cec50af6d197912b00e83472ba0b59c43589e1c45910185eb1667a781caf073`

## Findings and behavior

No open code or security finding remains in the local-research change. The first review found that
all candidates were hidden in the collapsed failed-gate section because the mode deliberately
creates no automatic pass. The final code fixes that: every research candidate is visible,
numbered for the attributed ruling sheet, and still displays its failed/unavailable gate reason.
The Claude, Codex-diagnostic, and default board branches remain unchanged.

`grade --judge-backend local-research` runs the real stage-1 scorers and creates the existing
plan-bound gate, full-resolution board, evaluation record, and rulings template. Every overall
automatic verdict remains false, `stage2` remains `null`, and a stage-1-passing row records
`unavailable: judge`. The gate and evaluation records contain the executing CLI and identity-gate
digests. The evaluation subject hashes the complete `gate.json`, binding those provenance fields
without introducing a separate schema or self-code-hash lock.

The module import still calls `_vlm_judge_module()` to read `DEFAULT_WORKERS` metadata. Local mode
does not invoke an external image judge, start its CLI, or transfer image bytes. Tests replace both
runtime external-judge entry points with failing stubs and confirm neither is called. Existing
local scorers may attempt to obtain missing model weights; the runbook records that limitation and
requires an intended offline environment rather than claiming a global network block.

`apply-rulings` remains shared across modes. It requires non-empty human attribution and time, all
seven quality/safety axes, a non-empty `gate_override` for every kept false gate row, a current
evaluation subject, current image and gate bytes, and an explicitly kept tester checkpoint. The
existing receipt, teardown, checkpoint-byte, and checkpoint-digest guards remain in the selection
and fresh-generation path. `--skip-judge` remains labelled and used as an offline test seam; the
new runbooks use `local-research` for real bounded research review.

The revised operator runbook uses local research for both tester and generation. The changed
local-research portions of the v2 post-train readiness note are accurate. Its opening status and
step 1 still describe the train as active and awaiting completion; that surrounding text became
historical once the real train completed and should not be read as current runtime state.

## Verification

- Final full Python 3.13 suites: **125 passed** across the two changed test files in 73.82 seconds.
- Final focused local-grade test: **1 passed, 58 deselected** in 10.96 seconds.
- Focused CLI selection and shared ruling guards: **5 passed, 54 deselected** in 22.56 seconds.
- Focused identity-gate backend checks: **2 passed, 64 deselected**.
- `py_compile`, `grade --help`, and `git diff --check` passed.
- No external judge, image transfer, image inspection, provider action, or live spend occurred in
  this review.

## Direct tester readiness and parked helper

The actual v2 tester command is **READY** on the reviewed evidence. A read-only cross-check loaded
the pinned Studio CLI, recomputed `_planned_run`, and matched `ceiling_usd`, `out`, `argv`, and
`cli` exactly. Five current `_tester_checkpoint_inputs` matched the train manifest, actual
producer-shaped receipt rows, and current checkpoint bytes/digests. The completed train receipt
records pod `lsns75h3zrd7pb` with verified termination; the tester command is capped at `$2.50` and
115 minutes. Root's separate final preflight recorded an empty live pod inventory and sufficient
current arc/daily budget.

The automated v3 continuation helper is **PARKED**. Its source
`ac6b1c29c439fa3c06791b9e614619c22adfcb1b4ca985b988cf03f2913249cb` and tests
`057ace955c6d6ac904f66f1cc33eec313fa8e64f131eb6b8fde7834e79f1aa8c` correctly fixed receipt
mapping and passed **20 fixture tests**, but its fixture invented `run.budget.max_minutes`. The real
plan has no `run.budget` object, so `plan_shape()` refuses the actual plan before spawn. Those tests
therefore do not prove actual helper readiness. The helper must remain unlaunched unless that real
plan-shape defect is fixed and independently re-reviewed.

Dashboard TypeScript/TSX changes, dashboard tests, lifecycle documentation, and live provider
operations were outside this local-research review.
