# Train-first hub lifecycle result

Status: **READY for independent review.** This change adds a read-only `trainFirst` projection to the existing Figment hub. It is configured only by the server with `DASHBOARD_FIGMENT_TRAIN_FIRST_ROOT` plus the exact `DASHBOARD_FIGMENT_TRAIN_FIRST_PLAN_SHA256`; requests cannot select a plan or filesystem root.

The projection reports the plan-bound creator, selected `train` or `tester` stage, recorded execution state, stage ceiling, and teardown state. A running record is shown with liveness `unknown`. A completed train receipt is accepted only when its five artifact rows match the pinned manifest in order and the safe local files match the recorded byte sizes. A completed tester receipt is accepted only when its five jobs match the pinned manifest output names in order and each unique, safe local PNG matches the recorded byte size. Checkpoint hashes are deliberately omitted because the harness receipt does not record them, and the request path does not hash multi-gigabyte files. Plan and manifest digests are computed from the same bounded bytes that are parsed.

Malformed, oversized, stale-plan, dry-run, inconsistent terminal, unsafe-root, and unsafe-stage evidence fails closed. The projection excludes pod identifiers, paths, prompts, logs, errors, actions, and quality claims. Existing OmniGen/Qwen projections and older hub responses retain their prior behavior.

Verification on the review worktree:

- `npm.cmd test -- --run server/figment/cloudExperiment.test.ts src/figment/FigmentWorkspace.test.tsx server/figment/routes.test.ts`: 57 tests passed.
- `npm.cmd run typecheck`: passed.
- Read-only collection of the exact v2 plan SHA `920125ce7e543c95b62d3d808675ebbc5b419fcb2da4e55d6f853518b8343ec3` returned `train/running`, the 351-minute and $7.61 bounds, and liveness `unknown`. This was a local projection probe, not a provider request.

No deployment, provider call, approval mutation, or quality decision was performed.
