# Recorded assignments and exact brief navigation

Stage B source, independent reviews, runtime checks and the bounded real local browser journey are accepted. Source and tests are committed at `dcd78f3b` (16 files). Stage A remains accepted at `b591d05e`; this note covers the subsequent six-file production change.

Frozen plans now pair each published plan with bounded matching planning assignments. **View brief slot** opens Research and highlights only the unique exact brief revision and slot. An ordinary unassigned draft contributes no matches while other valid assignments remain visible. Unsafe, incomplete or changing evidence makes the join unavailable. A legacy preparation outside the content-authority root remains discoverable and replayable, with assignment evidence unavailable.

## Operator behavior

Open **Frozen plans** and select **Refresh status** for the current bounded inventory. Recorded rows identify the brief, revision digest prefix, one-based slot and role. These are current matching records, not exhaustive usage history or a fresh source/quality approval.

Select **View brief slot** to navigate locally. It performs no request, preparation or launch. Research highlights a record only when the full brief ID/digest and slot index/role/kind agree with its independent snapshot. Missing, duplicate or changed targets display **The recorded brief revision or slot is unavailable in this snapshot.** Use **Refresh brief records** explicitly to reload. No same-name replacement revision is silently selected.

GET `figment/studio-gen-plans@3` adds exact ordered assignment records; hub @2 supplies same-read brief digests. Explicit legacy GET @2 and hub @1 remain supported with bounded unavailable navigation semantics. Preparation POST @1 and existing intent/replay behavior are unchanged. Owner and inventory generations prevent stale responses or callbacks from restoring old data, including a discarded concurrent A-to-B-to-A render.

## Verification and retained failures

| Run | Actual result | Named inputs |
| --- | --- | --- |
| Runtime v1, ten suites | 428/430, native 1; no skips. Two pre-passive ownership probes failed because an effect observer returned an array length as a cleanup function. | 98 unchanged before/after; current matched before the authorized repair. |
| Focused v2, Workspace | 62/62, native 0; no skips. Typecheck then failed TS7022 in the real UI integration fixture; build did not run. | 98 unchanged before/after; subsequent type-only repair separately pinned. |
| v3, typecheck/build only | Both native 0. No tests rerun. | All 98 before/after/current inputs matched independently and at root review. |

There are **430 distinct passing cases across v1/v2**, with 60 overlapping passes, not a fresh combined 430-case run. The first repair changes only the shared test effect to call its observer without returning the observer's value. The second adds an explicit scalar-record array type to the integration fixture, with no casts, runtime or assertion changes. Originals, failures and exact repair receipts remain retained.

Actual producer tests build two real brief revisions and bindings beside an unassigned base, then exercise the real HTTP/Workspace join and separately produced legacy-root rejection. Other cases cover whole-document validation, exact path/digest/slot pairing, same-byte metadata rewrites, absent-assignment rechecks, global bounds, malformed/duplicate/oversized DTOs, auth, intent preservation, stale owner/callback rejection and actual React concurrent discarded renders. Production and server tests received independent review by a worker who did not author them; root and the server test worker independently reviewed the separate UI tests.

Runtime evidence is under MAIN `_private/figment-stage-b-verification-20260912-v1`, `-v2`, and `-v3`. Result hashes are respectively `7eefaebd7134f71ae4a53ac75e34c8c937c2d46d52f5a5111b8615f31827d380`, `d6f00ddd941521e9cce3a7c9ef3b932e73c1f7734ddcff800c53d6981fc1975c`, and `04c690210acd823f22eaccf0a8358c7171099cb20406db9ab0587849b0d2712b`. Final independent source review is `figment-stage-b-source-independent-review-20260912-v1.md` (`c1bfb4e00d51a7e5b667ea537869c44056395c7c95d5805f1d7a39fca2b51407`); it lists the six final production pins. UI integration's final type-only hash is `57354c7406b965cf2a4392f8e403d354a452b30733f38f74b374ecba5191c4a5`, and repaired Workspace tests are `ff4ef2e2272923fa159eaa2660b48b5548722361d70c7dcb245e904d83355611`.

## Browser evidence

V1 retained an infrastructure failure before the first Page.enable response: driver native 1, zero screenshots, repeated Chrome GPU child exits and fatal unusable GPU. All 125 before/after/current inputs and 36 retained evidence hashes matched; recorded cleanup left no owned process, planned port, exact temporary file or fixture child. The wrapper's exit 0 was not visual success. Real fixture init/plan/bind succeeded, and both actual loopback GET endpoints returned 401/401/200 for missing/invalid/valid synthetic credentials. The recorded four-slot/two-revision DTO is backend evidence only.

V2 passed with driver native 0, null error and verified cleanup after the explicit tool execution-context correction. Chrome sandbox stayed enabled; no administrator-token measurement is claimed. All 126 before/after/current named inputs and 41 evidence hashes matched independently. The actual driver navigated first-revision slot 1 and second-revision slot 2 without fetching, exercised a genuine stale snapshot, then recovered through explicit refresh. The exact synthetic brief's original bytes were restored and independently rehashed. Both actual HTTP endpoints again returned 401/401/200 for missing/invalid/valid synthetic credentials; fixture init/plan/bind each exited 0.

Root actually viewed all four 1440x1200 PNGs: readable plans and legacy state; exact slot labels in distinct revisions beside the unassigned base; stale state with explicit refresh and no selected-slot label. No horizontal viewport overflow or major clipping was observed. The images are `01-recorded-slots-and-legacy.png`, `02-exact-revision-one-slot-one.png`, `03-exact-revision-two-slot-two.png`, and `04-stale-target-explicit-refresh.png` under MAIN `_private/figment-stage-b-real-visual-verification-20260912-v2`. The v1 directory retains the startup failure.

V2 execution-status SHA-256 is `677f8763b59ef2981b2fd32b00f4d6c15b85afe3dac69f5a236a7a04bafa0b97`; restoration receipt `6071d6b1d9955cfb841438ca366696f29c735d326002ec3f88fa6be1b566e449`; cleanup `69d9a19383094a4cee4a0a11d392a30c9daef40e948ec37853a3b2af09b4bdb4`. Recorded cleanup left no owned PIDs, planned-port listeners, exact temporary files, fixture children or errors. Services were force-stopped by recorded ownership, not normally exited. This real loopback producer/HTTP/session/decoder composition is narrower than full buildApp, deployed authentication, a live operator account or real media.

## Limits and remaining work

The reader uses cooperative filesystem observations and a single service writer; it does not supply an atomic multi-file snapshot against hostile same-user mutation. Safe absence is rechecked, full records are validated before projection, and original marker/plan observations survive asynchronous work. Public data contains no private paths, image IDs or attribution claims. At most two plans and 64 matching slots are projected; oversized HTTP output becomes unavailable rather than a truncated success.

This work adds no execution or current-source authority control and assesses no real creator-media quality. Populated Records rendering remains a separate pending assessment. The proposed thin current-source-check adapter was withdrawn after direct read/stat/resolve bypasses and an omitted identity input were identified; its superseding observed-read design needs separate review and authorizes no implementation. Both capacity-refused square attempts and their original uncertain journals remain unchanged. See the [overall plan](2026-09-12-overall-plan-review.md) and [operator guide](2026-09-12-input-auth-repairs.md).
