# Codex diagnostic grading integration result — 2026-09-09

Status: **READY for a separately controlled transport smoke; no live judge was run.**

`figment_train.py grade` now accepts an explicit
`--judge-backend {claude,codex-diagnostic}` choice. The default remains `claude`, and the
default gate document keeps its existing schema and fields. The Codex path is opt-in.

For `codex-diagnostic`, stage 1 still runs first. Only stage-1-passing images reach the
standalone Codex adapter, sequentially and without retries. Each request uses the first
resolved persona anchor only, which is the plan's canonical g01 reference; later legacy
anchors are not sent. The request fixes `gpt-5.6-terra`, a 120-second per-image timeout, a
versioned image-only rubric, the reviewed native `codex.exe`, and a fresh same-runner temp
work root outside the repository.

The adapter's complete envelope is stored on the matching gate row as
`codex_diagnostic`. That envelope carries the reference and candidate byte hashes, the
requested and responding model evidence, the bounded result payload or an unavailable
reason, and no source image paths. A stage-1 failure records no Codex result and makes no
Codex call.

Codex results do not populate the existing `judge` field, do not load or reuse the
Sonnet-derived judge thresholds, and do not enter `two_stage_gate()`. Every stage-1 pass
therefore remains an automatic failure with `unavailable: judge`, even when the diagnostic
payload is valid. The existing attributed `gate_override` and evaluation-subject lineage
checks are unchanged.

Verification:

- `test_identity_gate.py`: 65 passed in 1.54 seconds. This includes explicit g01-only
  request construction, stage-1 short-circuiting, reference/candidate hash persistence,
  successful and unavailable payloads, empty Sonnet thresholds, and no automatic pass.
- Relevant `test_figment_train.py` grading and ruling cases: 12 passed, 46 deselected in
  3.67 seconds. These cover explicit parser selection and propagation plus the existing
  grade, stale-subject, and attributed-override behavior.
- Independent review reran both complete files with a short private base temp: 123 passed in
  46.24 seconds. The earlier broad run retained a failure on the train-first dry-run test
  while using a long nested pytest temp path. That exact test passed on an isolated
  pre-integration baseline (1.99 seconds) and on this snapshot with a short base temp
  (1.26 seconds). Those comparisons do not establish a single cause for the prior failure.
  The independent full-pass log is `_private/codex-grade-integration-review-20260909-v1.log`
  in MAIN.

The configured native executable is intentionally explicit for this Windows runner and its
current npm vendor layout. A different runner or installation layout must supply an equally
reviewed native path in code before using this diagnostic; wrapper scripts are not accepted.

No Claude CLI, Codex CLI, model inference, provider request, approval write, or promotion
was performed by this implementation or its tests. Transport behavior and model quality
remain separate evidence.
