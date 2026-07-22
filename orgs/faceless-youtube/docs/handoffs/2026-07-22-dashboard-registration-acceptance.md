# FYT dashboard registration — no-spend acceptance checkpoint

Date: 2026-07-22

## What was proved without a run

- The checked-out `workflows/video-run.md` is discovered by `GET /api/workflows`, valid and compiler-launchable as the generic `producer` profile, with exactly 14 stages and the required `channel` / `slug` parameters.
- The current definition contains no manager or stage assignment. The registry reports no eligible assignment because the four relevant FYT declarations (`fyt-runner`, `fyt-preproduction`, `fyt-production`, and `fyt-checker`) are all `runner-bound: false`.
- Static tests read the checked-out workflow and all four segment sources. They syntax-compile the runner bodies without evaluating them, pin each segment's metadata/gate envelope/fail-stop/sandbox declaration, and validate the parsed FYT DAG (including the image-review, render, audio-plan, verify, and no-publish boundary). They also pin paid-stage disclosures, the image-review full-surface/conductor boundary, A/B1/B2 ordering and fail-stops, and C's blank-`approvedBy` throw before any possible agent call.

This is registration and source-contract evidence only. It did not launch workers, call APIs, publish, execute a segment, or create/change video assets. In particular, a static `spendAuthorized` / `approvedBy` condition is only source evidence; it does **not** prove that a human authorization actually exists.

## Actual human blockers before any live acceptance

- A human must bind and activate eligible runner declarations; all four FYT declarations are currently `runner-bound: false`. Existing enforcement evidence is `dashboard/server/write/governedSave.test.ts`'s `refuses an agents/*.md save that sets runner-bound: true (400, no write, no git)` test: a dashboard save cannot self-bind one.
- The dashboard is inert unless `DASHBOARD_EXECUTION_ACTIVATED=1` is set in the watched daemon/session. `dashboard/server/control/activation.test.ts` pins that every other value constructs nothing; this checkpoint did not enable it or establish that a watched daemon is running. The human-only T1 acceptance path is `docs/runbooks/2026-07-20-wave-a-acceptance-runbook.md`, which requires the exact gate and explicit watched-run confirmation.
- The human must approve the workflow's assignment/review/gate semantics and an observed authorization path; no test invents those bindings or treats generic compilation as activation.
- Daniel's G1 script/idea decision remains required before paid work. B1's static guard does **not** mechanically validate that preceding Daniel decision. Images and voiceover require an explicit per-run queue-card authorization and declared spend ceiling before either paid stage starts.
- Any upload remains outside `video-run.md`: it is a separate T3 publish leg requiring Daniel's recorded GATE 3 approval.
