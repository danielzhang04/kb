# Train-first hub lifecycle review

Root technical verdict: **READY**, 2026-09-09 22:43 UTC. This is local branch readiness, not a deployment or a quality ruling.

Reviewed the collector, route configuration, client projection and rendering, and their three focused test files. The final collector SHA-256 is `7fb3a21993e295676ebc57cddfbdc7d6bec84e9d3b8d5fe6aaf3395a877bfc7c`. Existing OmniGen/Qwen collection remains separate.

Review findings closed before acceptance:

- Removed synchronous checkpoint-content hashing from HTTP requests. Terminal train evidence checks the five exact pinned manifest artifact rows and current safe file sizes; it makes no unsupported checksum claim.
- Bound tester jobs to the exact manifest output names and order, unique PNG names, and current safe byte sizes.
- Distinguished missing stage/output evidence from an existing unsafe entry. Small plan and manifest documents are now parsed from the same bounded bytes whose digest is checked.
- Caught terminal file-size reads so concurrent disappearance becomes unavailable evidence rather than an uncaught request error.

The server alone configures the root and exact plan digest. Running state has unknown liveness; completed execution remains unreviewed quality. The response excludes provider IDs, paths, prompts, logs, raw errors, and approval actions.

Root verification of the final snapshot: `npm.cmd test -- --run server/figment/cloudExperiment.test.ts src/figment/FigmentWorkspace.test.tsx server/figment/routes.test.ts` passed **57 tests across three files in 7.41 seconds**. `npm.cmd run typecheck` and `npm.cmd run build` passed. The author separately exercised the actual immutable v2 plan locally. No provider request is part of collection.

This read-only projection is not a cryptographic verifier of large artifact contents and does not independently contact RunPod to establish liveness. The pipeline's receipt/checkpoint verifier and actual quality review retain those responsibilities. No deployment or merge to main was performed.
