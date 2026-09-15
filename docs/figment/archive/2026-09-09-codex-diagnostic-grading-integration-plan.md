# Codex diagnostic grading integration plan — 2026-09-09

Status: design only. Do **not** run the current normal `figment_train.py grade`
command for this work: it still reaches the Claude-specific judge through
`identity_gate.run_two_stage_gate()` and `vlm_judge.py`. `--skip-judge` is also not an
honest substitute; it is explicitly offline/test-only and records `unavailable: judge`.

## Current contract

`figment_train.build_grade()` (`figment_train.py:2739`) hashes the evaluation subject,
writes the blank ruling template, and calls `_run_identity_gate()` (`:2702`). That wrapper
delegates to `identity_gate.run_two_stage_gate()` (`identity_gate.py:292`): stage 1 runs
first, and only its passing cells reach the Claude judge (`:347-374`).
`two_stage_gate()` (`:410`) requires both stages to pass; a missing judge result becomes a
failed row with `unavailable: judge`. Total outages also produce failed rows rather than
omitting gate evidence (`:376-381`).

After a real grade exists, root can record an attributed bounded-research ruling from the
original tester outputs. The ruling must retain the template's exact evaluation-subject
hash, name the actual reviewer in `decided_by`, record `decided_at`, cover every image, and
provide all four quality and three safety axes (`figment_train.py:2822-2878`). A kept cell
whose gate is unavailable or failed must include a concrete non-empty `gate_override`;
`apply_rulings()` preserves the failed `gate.json` and rejects a silent keep
(`:3023-3121`). This records research continuation without inventing an automatic PASS.

Checkpoint selection does not require an automatic stage-2 pass. It requires the selected
tester image to be explicitly kept (`:3127-3135`), plus completed train/tester stages,
current candidate digests, and successful teardown-verified train and tester receipts
(`:2882-2989`). `apply-rulings --stage tester --checkpoint-step N` then writes the accepted
checkpoint lineage and persists its hash-bound selection (`:3153-3175`, `:3290-3308`).

## Minimum integration

Add an explicit `--judge-backend` choice to the `grade` parser (`figment_train.py:3462`) and
thread it through `build_grade()`, `_run_identity_gate()`, and
`identity_gate.run_two_stage_gate()`. Keep the current Claude backend as an explicit value;
add `codex-diagnostic` as a separate value. For each stage-1-passing cell, the latter calls
`codex_judge_backend.run_codex_judge()` (`codex_judge_backend.py:373`) with the already
validated candidate and anchors, then records its bounded payload or unavailable envelope
in a backend-labelled diagnostic field or companion artifact bound to the same image hashes.

Until a separately reviewed Codex calibration supplies backend-specific thresholds, do not
map that payload into the existing Sonnet-derived judge scores or `gate.yaml`. Feed no stage-2
scores into `two_stage_gate()`: the gate remains false with `unavailable: judge`, while the
Codex diagnostic provenance remains visible. Root may then use the existing attributed
`gate_override` route for bounded research continuation.

Required tests should prove explicit backend selection, unchanged default behavior,
stage-1 short-circuiting, exact image/hash binding, successful and unavailable Codex
diagnostic persistence, no Codex result producing a gate PASS, no reuse of Sonnet thresholds,
and `apply-rulings` accepting only an explicit attributed override while continuing to reject
silent keeps, safety failures, stale subjects, and unkept checkpoint steps.

The resulting `approval-lineage.json` and `accepted-checkpoint.json` use the existing
`decision: verified` vocabulary and contain no machine-readable research/production scope.
They are therefore evidence for this bounded research continuation only; they do not establish
production eligibility. Production promotion remains a separate human decision and evidence
boundary.
