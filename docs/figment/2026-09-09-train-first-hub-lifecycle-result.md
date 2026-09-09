# Train-first hub lifecycle result

Status: **READY for independent review.** This change adds a read-only `trainFirst` projection to the existing Figment hub. It is configured only by the server with `DASHBOARD_FIGMENT_TRAIN_FIRST_ROOT` plus the exact `DASHBOARD_FIGMENT_TRAIN_FIRST_PLAN_SHA256`; requests cannot select a plan or filesystem root.

The projection reports the plan-bound creator, selected `train` or `tester` stage, recorded execution state, stage ceiling, and teardown state. A running record is shown with liveness `unknown`. A completed train receipt is accepted only when its five artifact rows match the pinned manifest in order and the safe local files match the recorded byte sizes. A completed tester receipt is accepted only when its five jobs match the pinned manifest output names in order and each unique, safe local PNG matches the recorded byte size. Checkpoint hashes are deliberately omitted because the harness receipt does not record them, and the request path does not hash multi-gigabyte files. Plan and manifest digests are computed from the same bounded bytes that are parsed.

Malformed, oversized, stale-plan, dry-run, inconsistent terminal, unsafe-root, and unsafe-stage evidence fails closed. The projection excludes pod identifiers, paths, prompts, logs, errors, actions, and quality claims. Existing OmniGen/Qwen projections and older hub responses retain their prior behavior.

Verification on the review worktree:

- `npm.cmd test -- --run server/figment/cloudExperiment.test.ts src/figment/FigmentWorkspace.test.tsx server/figment/routes.test.ts`: 57 tests passed.
- `npm.cmd run typecheck`: passed.
- Read-only collection of the exact v2 plan SHA `920125ce7e543c95b62d3d808675ebbc5b419fcb2da4e55d6f853518b8343ec3` returned `train/running`, the 351-minute and $7.61 bounds, and liveness `unknown`. This was a local projection probe, not a provider request.
- A second local collector probe at 22:56 UTC returned `recorded/tester/running`, the 115-minute and $2.50 bounds, liveness `unknown`, quality `not-reviewed`, and zero outputs. This confirms the current tester record joins the same pinned plan schema; it was not a provider request or browser test.

## Proposed local preview

The normal server entry reaches this projection: `dashboard/server/index.ts` registers `registerFigmentRead` inside the authenticated read scope, and `dashboard/server/figment/routes.ts` resolves the train-first root and SHA from environment variables when explicit route options are absent. The proposed isolated binding is:

- `DASHBOARD_FIGMENT_TRAIN_FIRST_ROOT=C:\Users\danie\kb\_private\figment-builtin-train-first-20260909-v2`
- `DASHBOARD_FIGMENT_TRAIN_FIRST_PLAN_SHA256=920125ce7e543c95b62d3d808675ebbc5b419fcb2da4e55d6f853518b8343ec3`
- `DASHBOARD_PORT=4418`
- `DASHBOARD_STATE_ROOT=C:\Users\danie\kb\_private\figment-hub-preview-state-20260909-v1`
- `DASHBOARD_AUTH_MODE=win32-desktop`
- `DASHBOARD_RP_ORIGIN=http://localhost:4418`
- `DASHBOARD_EXECUTION_ACTIVATED=0`
- `DASHBOARD_HUMAN_REQUEST_SWEEP_INTERVAL_MS=0`

Port 4418 was observed free, and the review-worktree build contains the new UI. This remains a proposed fresh loopback preview; no server or browser was launched.

A presence-only environment check found `DASHBOARD_WEBAUTHN_CREDENTIALS` absent and `DASHBOARD_SESSION_SECRET` present; neither value was read or printed. Because `/api/figment` requires a session, the session secret alone does not establish an authenticated browser session. A fresh-port browser preview therefore remains unverified until the normal registered WebAuthn configuration is available. No credential store was read, no token was minted, and no authentication fixture or bypass was created.

No deployment, provider call, approval mutation, or quality decision was performed.
