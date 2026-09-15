# Studio preparation allocation and watcher privacy review

Status: **accepted locally after independent source/test review and verified runtime evidence**. Stage A makes new Studio preparations compatible with the existing content-assignment authority root. Recorded assignment display/navigation and actual creator-media quality remain open.

Previously, Studio allocated under `REPO/_private/figment-studio/gen-plans/<UUID>`, outside the content-binding producer's `REPO/orgs/figment` root. New preparations now use `REPO/orgs/figment/_private/figment-studio/gen-plans/<UUID>`. Both fixed locations remain discoverable. Existing plans keep their bytes, same-intent replay and audit behavior; nothing is copied, migrated or re-signed.

A shared safe inventory maintains a global maximum of two published plans and 512 MiB across both roots, with 256 MiB per allocation. Missing/unsafe roots, duplicate UUIDs or intent hashes, unmarked legacy work and capacity changes retain bounded refusal behavior. Final inventory/capacity are checked again after the runner returns. Cleanup belongs to the route and targets only its exact new unpublished allocation; uncertain work and published/legacy directories are retained. GET @2, POST @1, request scope and pending-intent storage are unchanged.

The new location falls beneath the general orgs watcher. An exact lexical predicate excludes only this allocation tree before Chokidar traversal and before event classification/debounce and hub forwarding. Parents, near-prefix siblings, other private features, neighboring content, other orgs and STOP events remain observable. This is a specific privacy boundary, not a general watcher-policy rewrite.

The filesystem model remains cooperative, with one active preparation service. Drain/replace the old writer during deployment; these checks do not provide atomic multi-process serialization or protect every asynchronous step against hostile namespace replacement. No UI production change, HTTP launch, provider call or Stage B assignment field was added.

## Static review and tested source

Independent production and eight-file test/fixture reviews are READY, with no concrete unresolved finding. Private reports are MAIN `_private/figment-stage-a-source-independent-review-20260912-v1.md` (SHA `38bb26a21d135ebc11582ce7fe9df28feef9beb633c6b2829d3c9f7a99de3cac`) and `figment-stage-a-test-independent-review-20260912-v1.md` (SHA `da2e448f7070b9d67db9ac6de897aec7667617d44d3cf6c202f8b72970d825dc`). Root also reviewed the complete production and test changes.

| Production file | SHA-256 |
| --- | --- |
| `dashboard/server/figment/studioPublishedPlans.ts` | `ba218301976da5362d1eaaf65074fb010b9d3bc66cd6c9dd005379658da7658a` |
| `dashboard/server/figment/studioGenPlan.ts` | `9b2b920b17c9fb37390d303574f84fa0346ba7da646c410599a0e69280fd797d` |
| `dashboard/server/planeA/indexer.ts` | `8b55861b47e84c7f1742ba93b4ff81bc7f35fc75c0c87b266a2001141d6000ba` |

Stage A source/tests are committed at `b591d05e`. After runtime acceptance, the shared index received only removal of its extra final CRLF. Root byte-verified that change against MAIN `_private/figment-stage-a-studioPublishedPlans-before-eof-20260912.bin`; its final SHA is `38cfb4c63ef3666217050a722f5375e28c583bdfb014e6d142662f82b4c96c05`. The table records the tested source SHA. No runtime rerun was needed for this whitespace-only cleanup.

The original eight-file test freeze is MAIN `_private/figment-stage-a-test-author-freeze-20260912-v1.json`, SHA `45fb8a9ce3c1d2b408f9ead9aa698eb707e965f1ac6f29f2a6bf0a7803cc0272`. Only two test files changed after v1: repaired `studioGenPlan.integration.test.ts` SHA `26e6ce30f97394c09b753a42ccaf0d3c689ac52bc39b6db2ea6db8edc0ce2fc6` and `studio_assignment_fixture.py` SHA `9d40973e21243b2d64fc3ae8a1dcd5d235dd7f128d6734dd5ea98597a5a91f5b`.

## Verification and retained failure

V1 ran seven suites at 23:19:07.909968–23:19:33.185897 UTC on September 12: **180/181 passed**, native exit **1**, no skips/pending/todo cases. The new assignment fixture failed during initialization because added `py -3 -I -B` isolation hid the selected interpreter's existing user-site `pytest`. Its new producer join did not execute. Typecheck/build were not run after that failure. All **83** named before/after/current inputs matched before repair.

| V1 actual suite | Passed | Failed |
| --- | ---: | ---: |
| Generation-plan route | 67 | 0 |
| Shared published inventory | 6 | 0 |
| Real server integration | 2 | 1 |
| Real UI integration | 1 | 0 |
| HTTP surface | 83 | 0 |
| Hub bus | 9 | 0 |
| Plane-A indexer | 12 | 0 |

The test worker's local metadata probe confirmed the same Python 3.12.8 interpreter at `C:/Program Files/Python312/python.exe` can discover existing pytest/PIL/numpy through normal `py -3`, as the accepted fixture and production resolver already do. The repair removed exactly three newly introduced `-I` argv tokens from the fixture init/bind and nested binding CLI. It preserved `-B`, the actual launcher, all authority calls and all assertions. No install, shim, helper copy or production change occurred. Original files remain under v1 `before-fixture-flag-repair`. Independent byte-level delta review is READY: MAIN `_private/figment-stage-a-fixture-flag-repair-independent-review-20260912.md`, SHA `44071135f6d5d8a51cc4cc5218c66702a74ceae56f1d3021ed4db3f44f5a383b`.

V2 reran only the affected real integration file at **23:23:41.624988–23:23:51.062759 UTC**: **3/3 passed, native exit 0**, with no skips/pending/todo cases. The actual cases were:

- Real fixture planner through the default owned-process executor: 2,230.48 ms.
- Exact production preparation argv, same-intent replay and stale-authority refusal before the harness: 1,790.26 ms.
- New allocation through real producers and legacy-root rejection with replay preserved: 4,456.79 ms.

TypeScript no-emit passed at native **0**, 23:23:51.349176–23:23:54.175960 UTC. Vite build passed at native **0**, 23:23:54.426750–23:23:54.945796 UTC. All v2 stderr streams were empty. Root and the independent reviewer rehashed all **91** before/after/current named inputs with zero mismatches and parsed the actual reporter/case names. Raw command stream hashes were independently checked. These finite pins do not establish transitive dependency closure.

There are **181 distinct passing cases across v1 and v2**, with two integration cases passing in both runs. This is not a fresh seven-suite 181/181 run. The failed v1 record remains authoritative for that invocation.

Evidence directories are MAIN `_private/figment-stage-a-verification-20260912-v1` and `figment-stage-a-verification-20260912-v2`. V1 result SHA `b97b3447bfba760638b3c15dcf457b5c22933813daee35e0a08cc222d78610b4`, reporter SHA `615e6a8178be5e03edaf9a5ce98f988ab186a50c6999d8c41e43655013d36e49`. V2 result SHA `29f99791460c4916dea40534e4bb9f9780756084706298107285aacf2ed39362`, reporter SHA `2b14ebbca262df1cd14d7f06fc516516a61d2fdd7848332d3cb68bb62bb678c0`, actual-case inventory SHA `d3938a3bdd6085de28b9a50aea3ae739d60425fd853b5bfff8b82607f211d8ca`. The existing surface STOP fixture warning in v1 explicitly reports that no git command ran; it is separate from the repaired import failure.

## What the checks establish

The decisive test actually prepared through the real route, asserting exact argv and output location. It used canonical isolated creator-001 persona/checkpoint setup, synthetic gen evidence followed by real grade/rulings/authority validation, real brief publication/revision and the actual content-binding CLI. The resulting two distinct images bind to the exact new published plan path/digest and revised brief/slots, preserving plan, marker and base bytes. A separately compiled, authority-valid legacy plan was refused by that CLI's root boundary, then remained discoverable and replayable without another route runner invocation.

Synthetic stage receipts/images, pin/judge skips and attributed fixture gate overrides remain explicit test setup. Production authority checks were not replaced. This proves local producer compatibility, not a real accepted checkpoint, actual image quality or live browser/backend assignment journey.

Other executed cases distinguish combined 510 MiB success from 513 MiB refusal while every tree stays below 256 MiB; introduce final-publication conflicts during a held child; preserve legacy replay and cleanup ownership; inspect real initial and later-created private trees through `getWatched()`; exercise direct event ingress and actual bus nonpublication; and preserve positive neighboring/STOP events. Stage A changes no UI rendering, so the [prior recorded-status browser review](2026-09-12-gen-status-wiring-review.md) remains separate evidence. Recorded assignment display and exact revision navigation belong to Stage B. `MAIN` is `C:/Users/danie/kb`.
