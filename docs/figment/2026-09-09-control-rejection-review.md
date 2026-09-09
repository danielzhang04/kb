# Held-out compiler and rejection recording review

Technical verdict: READY after one concrete CLI fix, 2026-09-09 23:50 UTC. Independent reviewer: native Codex worker `figment_control_rejection_review`, requested model gpt-5.6-sol/high. Responding-model identity, tokens and incremental billing are not exposed by this runtime.

Reviewed base: e6534843. Final file hashes measured by root:

- `orgs/figment/pipeline/figment_train.py`: `3a93b2ba8765d49c11cfa42d3af4537694e6f7bfccf92cf73b1ebcecf5ae5312`
- `orgs/figment/pipeline/tests/test_figment_train.py`: `03b2b35ed839be02ec7db588e7fe2c2467614e440fd4521dc3b0efaa915da5eb`

The compiler consumes the existing ten-cell diagnostic protocol, validates current inputs, stages one exact checkpoint and emits a native harness manifest with a non-promotable preparation record. Five candidate jobs retain the LoRA; five controls bypass its model and CLIP outputs. Harness per-job graph copies prevent substitution leakage. Runtime minimum is 113 minutes, cap 115, CLI ceiling $2.50 and native reservation estimate about $2.491667. No model, judge, scoring threshold or spend-control implementation changed.

All-cull rulings now persist attributed rulings, a stamped review and subject-bound rejection lineage. They create no approval, accepted list, dataset, persona mutation or checkpoint selection. A checkpoint-selection request with all-cull fails before writes. Existing rejection artifacts cannot satisfy approval consumers.

## Findings resolved

Root review found that source snapshots followed initial protocol validation and omitted references/sidecar config. The author added full revalidation after snapshots and before publication, all-reference/effective-config snapshots, explicit staged-candidate checks and raw symlink refusal. A mutation-between-validation-and-snapshot regression passes.

Independent review found a post-write CLI KeyError: main unconditionally accessed approved_list after an all-cull application. Root added a real subprocess CLI regression, observed the expected failure, then made CLI output distinguish rejection from approval. The regression now exits successfully and asserts no approval output.

## Verification

- Root affected suite before the four-line CLI output correction: 149 passed in 192.97 seconds (identity_gate, figment_train and lineage_freshness). Evidence: `MAIN/_private/figment-control-rejection-root-tests-20260909-v1/`.
- Root final focused suite after correction: 13 passed, 54 deselected in 51.11 seconds, covering all_cull and held_out, including the actual subprocess regression. RED evidence is the prior expected CLI KeyError in `_private/fcr-cli-red`; GREEN fixtures in `_private/fcr-cli-green`.
- Independent final focused review: 8 passed, 59 deselected; Python compilation and scoped diff check passed. Its prior recovery-lock failure disappeared when the identical isolated test used a shorter Windows basetemp; root full suite also passed. This was a path-length environment failure, not a demonstrated product regression.
- Root actual V3 protocol/compiler/native dry-run: exit 0, ten synthetic jobs, one 228587800-byte checkpoint in 14 upload chunks, simulated teardown verified and isolated dry-run ledger. No provider call occurred. Source matches final CLI hash. Reviewer did not independently open private artifact records; root owns that actual-artifact verification.

Final V3 preparation: `MAIN/_private/figment-builtin-heldout-control-20260909-v3/compiled/preparation.json`, SHA `88fe538e0cb33ec137efb6eeefac8a36d0112790d4e18f38e1b7fa80a1740cf8`. Manifest SHA `1d3a037f9ca5b4620baa8dd723f50dcdf94173078883092206a56065337fb6c4`; protocol SHA `8d907fadffe6c6848c172e779097876c41a451e6a07287f768b8d0c6bb7f3f97`. V1/V2 preparations are retained superseded offline evidence and must not launch.

Actual all-cull CLI application then exited 0. Five rulings and five parked review rows were verified; no approval outputs exist. Rejection lineage SHA `da60f6bef193f8be8bd31af63af3712e021ad729b03bcbf0d5d44371fa56261a` binds evaluation subject `e471aa29b8ec9898341e77e74c3e0dbe1a2219471ac39e00b3651bfe3500fdac`. Attribution is codex-worker/root under standing research delegation, not human impersonation. Root/independent quality disagreement is preserved in the separate decision document.

Standing user authorization covers the bounded diagnostic; root must still check current source/artifact hashes, both budgets and zero-pod inventory immediately before launch. No production quality, deployment, new approved checkpoint or video result is claimed.

Automatic approval review rejected deletion of the reviewer's `.baseline-review-81f2.zip` and partial `.baseline-review-81f2/` extraction. Those temporary artifacts remain untouched and are excluded from this commit; cleanup is not required for the diagnostic.
