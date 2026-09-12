# Prepared generation status wiring review

Status: **accepted locally after independent review, runtime verification and root visual review**. Recorded status is available in the existing prepared-plan cards; live execution and creator-media quality remain separate.

The existing generation-plan discovery GET now uses exact `figment/studio-gen-plans@2` with one ordered execution record per published plan, bound to its ID and plan digest. A collector refusal preserves an independently valid prepared summary with an unavailable execution state. The POST response remains `figment/studio-gen-plan@1`; marker, request scope, idempotency key, session storage and preparation replay semantics are unchanged.

Metadata discovery and recursive capacity checks are separated. Unsafe root/marker/plan metadata still makes the inventory unavailable. A capacity-only failure or unrelated unsafe descendant retains verified summaries/status while requiring maintenance before preparation. POST still applies the original combined capacity/safety checks before replay or allocation. No threshold is raised and no file is deleted by discovery. The route rechecks plans-root safety after the asynchronous capacity pass and retains the existing active/generation race guard.

The plan-card UI adds one short recorded-status paragraph, with unknown attempt history for a missing stage, unknown liveness for recorded running, recorded failure, recorded completion with unassessed quality, or unavailable execution status. Its exact decoder checks ordered ID/digest pairing, recorded creator/stage/ceiling, finite values, dates and nullable receipt relationships. Existing token/fetch ownership gates display and dispatch. There is no new endpoint, polling, launch action, provider request, media-byte read or current source-authority check.

## Static review and frozen inputs

Root reviewed source and tests. Independent static review is READY with no concrete findings: `MAIN/_private/figment-gen-status-wiring-independent-review-20260912.md`, final report SHA `0b4284cc61d1609e646f57de9797617766aaecec2bfb99a4686cb6b9706114ec`. Root additionally caught two downstream GET @1 fixtures; those were repaired before any verification launched. Their exact diffs were independently accepted by root. The original four-file prospective verification was held, not executed, then expanded to cover six suites.

- `dashboard/server/figment/studioGenPlan.ts`: `edd8da9cec6ea5cf067a1ffa950b72f3211df61296611262d3c5ba3117101e69`.
- `dashboard/src/figment/StudioGenPlans.tsx`: `8e7ec89be2cd0681b68243cee44b76e540885c0c0db5548838ad80cebb6a9c3f`.
- `dashboard/server/figment/studioGenPlan.test.ts`: `01c6d7f68dc5189c31934cc52f1e778e14a6da5eb1d5ca81e80cebdaa53c7d07`.
- `dashboard/server/figment/studioGenPlan.integration.test.ts`: `7b9f46919754e008e279661c4ba4c7202682576a8e517b2bdfe43eccab62cbab`.
- `dashboard/server/figment/studioGenPlan.ui.integration.test.tsx`: `945a0e2c355fd7f8bf71ec1b9212b1d69acb6048d9de8c8fba04b3d4071986d5`.
- `dashboard/src/figment/StudioGenPlans.test.tsx`: `c02a9e6ff8422c61fbfbea00636f3164580db612f0896c8e395b82803c74d21e`.
- `dashboard/server/http/surface.test.ts`: `4dfd6cfe538e220c3494fec6a7526ff26dcff2d8f4726d7abd92779ee4731185`.
- `dashboard/src/figment/FigmentWorkspace.test.tsx`: `8b0c8d3741789ebf6901a55c1a2827559f256b5d9a40c5dee451c4c99ed7768b`.

The downstream surface assertion now requires exact GET @2 and empty execution records through frozen/degraded discovery, while preserving POST refusal. The Workspace mock now supplies a valid @2 DTO and awaits actual available copy and an enabled preparation control, preserving token/no-POST assertions. A heading alone would not prove successful decoding.

## Accepted runtime verification

One six-file Vitest run used the existing threads pool from 22:39:48.677 to 22:41:49.508 UTC on September 12: **268/268 passed**, native exit **0**, zero failures, pending cases or skips.

| Actual suite | Passed |
| --- | ---: |
| `studioGenPlan.test.ts` | 49 |
| `studioGenPlan.integration.test.ts` | 2 |
| `studioGenPlan.ui.integration.test.tsx` | 1 |
| `surface.test.ts` | 83 |
| `FigmentWorkspace.test.tsx` | 41 |
| `StudioGenPlans.test.tsx` | 92 |

Both real integration files executed. They covered the real fixture planner through the default Windows owned-process executor; exact production preparation, same-intent replay and stale-authority refusal; and a lost UI response followed by remount, same-key replay and refresh refusal after published-byte mutation. Existing timeouts were preserved. The Windows resolver actually used `py -3`; a metadata probe identified Python 3.12.8 at `C:/Program Files/Python312/python.exe`. The explicit Python 3.13 executable only wrapped evidence capture. No resolver override or substitute fixture was used.

One TypeScript no-emit check passed at native exit **0**, 22:41:49.700 to 22:41:52.664 UTC. One Vite build passed at native exit **0**, 22:41:52.864 to 22:41:53.974 UTC. Root independently parsed the actual cases and checked all **68** finite before/after/current pins, with zero mismatches. These named inputs are not a transitive dependency closure. The existing surface STOP-path fixture warning states that no git command ran; it did not fail the suite. No source/test repair or rerun occurred during verification.

Evidence: `MAIN/_private/figment-gen-status-wiring-verification-20260912-v1`. Result SHA `f45210d92b0c4ae720d6137655d6945704a8e00020f0978ff0c7080b13fe2c28`; raw JSON reporter SHA `c0cc9bf74e855e7c038a0c5280e186117eddec854909ce3ccb037adcc3e6041d`; actual-case inventory SHA `a0767926fa83455ad0dbb8e769623a553535677893b72cfb5a2682b9643e7251`. Exact launches, native exits, raw stdout/stderr, frozen inputs and both unexecuted four-file preparation records remain retained. Existing real integrations created synthetic local fixtures; no provider or real creator media was used.

## Accepted synthetic browser observations

One prepared hidden Chrome/CDP driver completed at native exit **0**, 22:43:39.442 to 22:43:44.848 UTC. Root actually viewed all four rendered scenarios: recorded completion, no-stage history unknown, recorded running with liveness unknown, and maintenance retaining the plan summary with preparation disabled. Controls and status were readable, with no observed clipping or horizontal overflow. Root independently checked all **26** before/after/current pins. This strict synthetic GET @2 backend establishes rendered behavior, not a live authenticated backend journey.

Evidence: `MAIN/_private/figment-gen-status-visual-verification-20260912-v1`. Execution error is null and cleanup is true. Cleanup force-stopped the exact owned processes (not normal process exit); no owned PID, planned port listener or temporary fixture file remained. The browser profile was preserved. The raw summary's pre-review `root_visual_judgment: pending` is historical capture state; root's subsequent actual-view acceptance is recorded here without rewriting that evidence.

| Screenshot | SHA-256 |
| --- | --- |
| `01-recorded-completion.png` | `f0ad4bf8bf1f876b14adb2895fe7eb1216f4c79d603031b933ec3cd29d643613` |
| `02-no-stage-record.png` | `38d7278d9ac72ecac0b375b67ee80f6db3846feddcc49f37818edb0d064b4589` |
| `03-recorded-running.png` | `6f12073234114cff16c2657d2b11de1400f6ea394180168906910de06db7ed88` |
| `04-maintenance.png` | `68e2043d2ceaa35b8c6d3171eb9dd85f81493343693cad6b19d9e40d1adf95dd` |

The accepted standalone collector is documented separately in [collector acceptance](2026-09-12-prepared-gen-collector-review.md). This wiring does not turn recorded metadata into launch permission, current source/ledger authority, actual provider liveness, media quality, deployment or external publication. `MAIN` is `C:/Users/danie/kb`.
