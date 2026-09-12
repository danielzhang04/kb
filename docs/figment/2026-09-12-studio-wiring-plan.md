# Studio video ruling wiring plan

Root planning checkpoint, 2026-09-12. Standalone prerequisite accepted at4fa11242 with independent review,137/137 tests and typecheck. Wiring below is not implemented or verified.

Goal: an authenticated operator can open Runs & review, discover configured opaque ruling IDs, explicitly request one bounded Python validation, and see the existing sanitized self-reported result. No media quality or publication approval is implied.

## Implementation boundary

- Extend dashboard/server/http/context.ts with optional server-owned video ruling configuration and a typed process-runner test seam. Use the existing registrar option types where practical; no duplicated decoder or command logic.
- In makeSurfaceContext in dashboard/server/http/surface.ts resolve configuration once, early, with parseVideoRulingConfigJson from DASHBOARD_FIGMENT_VIDEO_RULINGS_JSON using the same injected activation.env source as the rest of this composition root, falling back to process.env. An explicitly supplied null override disables configuration; undefined selects the environment. Invalid non-null configuration throws the existing fixed refusal before side-effect setup. Do not log values or paths. Production defaults to disabled with no environment setting.
- Register registerFigmentVideoRulingRead exactly once within the existing authenticated Studio child scope. It inherits origin, separate read/write rate limits and session enforcement. Retain the registrar's own auth guard. Extend the exact discovery GET exemption to /api/figment/video-rulings; do not broadly exempt GET or path prefixes. POST continues through ctx.admission('new-work') and assertFleetRunnable before any owned subprocess. Existing planner behavior remains covered by regression tests.
- Mount VideoRulingRead alongside Records only in the Runs & review branch of dashboard/src/figment/FigmentWorkspace.tsx, passing the current token and fetchImpl. Preserve existing records and their limits. The accepted component owns its explicit click behavior and stale-response protections.
- Keep index.ts unchanged unless evidence shows the composition root cannot expose production configuration without a new BuildAppOptions field. Server configuration is sufficient; no browser configuration editor, filesystem picker, path input or auto-discovery.

## Verification and acceptance

- Independently author focused surface tests using existing hermetic context/runner patterns: default disabled inventory, valid configured inventory, invalid startup config fixed error, explicit-null environment override, auth/origin/read/write-rate enforcement, exact GET availability under frozen/degraded state, POST refusal before runner under both gates, allowed POST invokes one configured runner, no path/config leakage. Include existing planner gate tests in execution.
- Workspace tests prove the panel mounts only in Records, preserves existing records, passes token/fetch context, and never POSTs from navigation or refresh. Existing standalone concurrency tests remain authoritative for component internals.
- Independently review the composition changes, then run focused suites and dashboard typecheck/build on stable captured inputs. Review actual case statuses and evidence files; no automatic rerun on failure without root diagnosis.
- A separate local integration test must join the real accepted Python reader and bounded process runner over a synthetic prepared chain. That work needs its own precise fixture/runtime plan, especially after shared brief changes settle. Do not use real private media or claim the standalone mocked route tests cover this join.
- Visual verification of the Records panel remains required for a usable UI claim. No dashboard deployment, account action, paid run or publication is part of this work order.

At most two source-repair rounds per bounded implementation, then reassess the contract rather than continuing an unbounded patch loop. User already authorized all remaining Figment tracks and Codex fallback on observed Claude quota. The separate private bookkeeping metadata gate remains untouched.
