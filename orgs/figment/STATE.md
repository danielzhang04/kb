# Figment current state

Updated 2026-09-08 16:53 UTC / 12:53 Eastern. Async work continues after the
8 AM checkpoint. Instagram integration is deferred. The canonical
[handoff](../../handoffs/2026-09-08-figment-async.md) contains the resume load list.

Studio branch `codex/figment-studio-20260908`, head `614b6e40`, is pushed to
[ draft PR179](https://github.com/danielzhang04/kb/pull/179), stacked on PR178.
The research book, authenticated studio, offline tester-plan preview, reference
and diagnostic galleries, raw identity observer, single-seed curation compiler,
and separate experimental training compiler/executor are built and reviewed.

Identity quality remains unresolved. g01 is the provisional canonical seed;
g02/g07 are comparators that may overlap prior training. Six generated gallery
records remain training-ineligible. The preserved failed-launcher crop output
is separate. Photo-like rendering has not established reference resemblance or
the intended about-21 appearance. No diverse reviewed training set or selected
production checkpoint exists.

Three native video diagnostics completed with verified artifacts and pod
teardown. The first distorted badly; the next two stayed coherent at1280x704,
but the requested turn-and-return was not unambiguously performed. Their
limitations and all-frame reviews are in the research book and cited audits.

The local one-observation LoRA plan now stages exactly original g01 and its
caption. The actual installed sd-scripts CPU parser passed: one image/repeat,
896x512 bucket, CUDA unavailable, zero visible devices, and no initialization.
Two earlier dependency-import failures are preserved. Supported explicit CUDA
masking resolved them without replacing upstream parsing. The two pinned CLIP
tokenizers also loaded from ten verified local copies. Both actual runs exited0
and verified process teardown; parent and independent audits matched hashes.
See Studio `docs/figment/2026-09-08-local-training-preflight-audit.md`.

The ten-step, twenty-minute local GPU launcher is accepted after 14 focused
tests and independent review. Actual full input validation passed. The first
admitted run loaded the model, cached its single observation, and created the
LoRA/optimizer, then failed before step1 after 110.283 seconds: Windows cp1252
could not encode the trainer's Japanese status text. The failure and private
cache are preserved; teardown was verified and root observed no remaining run
processes. The reviewed UTF-8 correction at937d27b2 passed15 tests. A fresh V2
completed all ten steps in79.234 seconds and wrote a170,540,916-byte checkpoint.
Independent receipt/header audit and root finite-weight audit passed; all2,166
F16 tensors were finite. Root verified no remaining observed run processes.
This proves local runtime fit only; no generated sample or quality result exists.
`figment_fit_repair` now builds the distinct100-step quality planner/CPU preflight;
new GPU execution support follows only after those checks. The original20/50/100
evaluation is preserved using eleven explicitly declared periodic/final files.
The historical preparation view is accepted at614b6e40; it does not infer absence
of GPU/quality work elsewhere. Author123 focused tests/typecheck, independent
review and root actual-receipt projection passed. Full dashboard testing was
aborted after at least59 failures; these are not baseline-proven pre-existing.
`figment_training_hub_plan` verifies a fresh desktop/mobile fixture on5420;
`figment_fit_independent_review` writes the runtime audit and book updates.
The later one-source quality experiment is a design only, with matched schedules,
fixed comparisons, and separate resemblance, realism, adult-presentation and
clothing observations; crops do not create independent identity evidence.

No owned RunPods or numeric reservations remain. Recorded provider spend is
$37.800385 of the $50 arc, with $2.110134 recorded today. The runner uses the
canonical OPS cost-ledger directory and the studio's stricter $10 daily guard.
Native-agent and built-in image-generation billing is unknown where unavailable.
Keep-awake owner16580 and supervisor19564 were reverified alive at12:53 Eastern;
the current safety cap expires around20:45 Eastern and must be managed if work
continues then.

Automatic review rejected the exact LoRA-to-RunPod and original-g01-to-Google
exports; the explicit questions remain unanswered. Neither export was retried.
The unused Gemini reservation was released after verified no-process execution;
its old admission is expired. An answered export question requires a fresh
freeze/accounting check. Independent local work continues. No account action,
production promotion, deployment, or merge has occurred.
