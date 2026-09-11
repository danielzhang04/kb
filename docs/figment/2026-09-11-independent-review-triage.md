# Figment independent review triage - 2026-09-11

Technical verdict: REQUEST CHANGES for final independent repair review. Confirmed repairs are written; root verification is recorded below. This is a deliberate handoff checkpoint at the user's request. Five independent source-only reviews completed against REVIEW150978d8. They did not execute tests. Root grades each claim against surrounding code, producer contracts and prior integration evidence. Local repairs are not deployed or media approval.

## Review coverage

| Slice | Independent model | Coverage and limits |
| --- | --- | --- |
| Video authority | claude-opus-5 | Full video_review.py and terminal ruling tests; producer helpers checked by root |
| Studio planning | claude-opus-5 | Route, process supervisor, Windows JobObject, unit and real integration tests |
| Motion assignment | claude-opus-5 | Content adapter/brief and producer/collector tests; sole video helper checked by root |
| Studio UI | claude-sonnet-5 | Plans preparation/retry DTO and motion snapshot rendering; other UI bodies not re-audited |
| HTTP composition | claude-opus-5 | New Studio registration plus surrounding auth/origin/rate/audit context; unrelated control plane not re-audited |

Reports: MAIN/_private/figment-claude-{opus,sonnet}-<scope>-subscription-review-20260910-v1/visible-review-text.txt. Exact packet pins remain in their immutable manifests. Earlier source slices retain their prior independent reviews; this is not a claim that every repository file was freshly audited. Reference images, trained checkpoint and live accounts were not sent to these reviewers.

## Disposition

| Finding | Root disposition / evidence | Work |
| --- | --- | --- |
| Studio S1 two-plan capacity and orphan recovery | Real product limitation, intentional conservative capacity; no retire/consume producer yet. Prepared snapshot never guarantees fresh execution; gen consumer revalidates. | Keep bounded ceiling; recovery/lifecycle remains explicit remaining work |
| S2 restart clears uncertainty | Confirmed: in-memory latch resets, inventory skips retained unmarked allocation. | Block new dispatch on unmarked allocations; restart test |
| S3 audit failure replay | Confirmed: marker published before audit, replay skips callback. | Retry audit before replay success, stable plan, at-least-once audit |
| S4 session late / unscoped intent | Parent and route requireSession already establish session. Move lookup early and bind subject to intent as hardening. | Worker scoped repair |
| S5 recursive rm follows inner junction | Not established: reviewer explicitly lacked Node behavior evidence. Current trusted planner and existing link safeguards inspected; no exploit claim accepted. | Preserve cleanup boundaries; no speculative recursive sweeping |
| S6 NODE_OPTIONS before job assignment | Confirmed preload window; ambient inheritance itself is normal process config, not credential exfiltration. | Strip NODE_OPTIONS case-insensitively for gated wrapper; preserve other ambient config |
| S7 Win32 BOOL ABI | Signature should be int/4 bytes, not C bool/1 byte. No observed host failure; current real-host tests passed. | Correct declarations; rerun host tests |
| S8 POSIX setsid escape / S9 disk cap after run | Trusted-planner limits, not a hostile-code sandbox or disk quota. | Document limitations; no containment redesign |
| S10 crash durability / S11 diagnosis | Fail-closed recovery gaps, lower priority; no promise of transactional power-loss recovery. | Remaining lifecycle work |
| Video V1 JSON persona | Not a new bug: video_manifest.build_manifest also requires JSON-compatible persona.yaml; actual producer uses it. | No new YAML parser |
| V2 late serialization after claim | Confirmed avoidable poison claim on oversize/deep output. Residual crash claim is intentionally immutable/fail-closed. | Preflight exact attempt and terminal records before claim; preserve post-claim failure rules |
| V3 preparation size / publication | Confirmed output can exceed reader limit; caught interruptions can leave incomplete file. | Existing bounded serializer and atomic exclusive publisher; owned cleanup |
| V4 attempt/temp capacity | Real finite-store exhaustion/concurrency availability concern. No unsafe age sweep or ignoring unknown files. | Remains bounded fail-closed; future explicit recovery/serialization design |
| V5 subject edits stale canonical store | Intentional current-authority/raw-byte invalidation and immutable candidate lifecycle. | No silent rebase or cosmetic-edit exemption |
| V6 receipt media equivalence | Trusted local assembly/extraction receipts bind exact bytes, not cryptographic authenticity or decoded equivalence. Existing preparation contract already depends on producer. | Document trust; no invented pixel tolerance scorer |
| V7 caller path spelling | CLI contract uses root-relative paths. Absolute alias convenience is not required. | No scope expansion |
| V8 hash/prompt separate reads | Confirmed structural snapshot gap. | Parse PNG prompt and verify file digest from same bounded byte snapshot |
| V9 Unicode ruling text | Low-priority display hardening; plain attributed offline text. | Remaining, no acceptance-quality bypass claim |
| V10 unused replay filename | Low availability concern; pure producer still validates its output location. | Keep producer contract pending separately justified simplification |
| V11 frame count / escaping exceptions | frame_assemble._run_job enforces exactly81; projection shape follows current producer. | Count allegation closed; no blanket exception swallowing |
| Motion M1 fit names accepted path only | Real producer uses immutable canonical candidate stores, limiting substitution. Explicit human digest binding is still useful defense. | Require exact accepted record digest in unreleased v2 ruling |
| M2/M3 second candidate parse | Confirmed parse bytes are not tied to previously captured hash; small brief parser also imposes a different budget. | Reuse sole video snapshot parser and compare entry; no authority projection change |
| M4 brief/ruling checks precede expensive source reread | Confirmed stale window. | Final metadata checks after source validation; mutation tests |
| M5 repeated hashing | Bounded cost deliberately buys current-byte checks. mtime memo would weaken contract. | No memo shortcut |
| M6 duplicate ID namespaces | Latent producer/collector mismatch; real reel currently one G slot. | Match kind:id, no taxonomy extension |
| M7 candidate normalization | Sole video SAFE_NAME already rejects whitespace/control. | Harden consumer projection |
| M8 UI literal | Root confirmed explicit source-footage label and tests. | Closed by actual UI context |
| M9 duplicate module state | Explicit root passed to video; existing still joins validate same brief identity. Real CLI integration passes. | No demonstrated bug |
| M10 text/fixtures | Low maintenance/test-message issues. | Bounded stronger assertions where useful |
| UI U1 rotate malformed-success retry key | Reject proposed fix: valid server plan may exist despite malformed/lost response; rotation can allocate duplicates. Reusing intent is intentional. | Keep key; lifecycle recovery/UI durable intent remains product work |
| UI U2 parse errors shown raw | Confirmed fixed error copy can be replaced by JSON/fetch exception text. | Normalize preparation failure message; regression test pending |
| HTTP C1 no fleet preamble/admission | Confirmed by actual route and figment_train.main: no preamble in plan path. | Add composition guard before any allocation/audit; frozen/degraded tests |
| HTTP C2 outbox wrapper missing | Closed: context.auditFn supplies publication and outboxRoot. | No duplicate outbox mechanism |
| HTTP C3 split coordination write | Plan artifacts are local _private; ledger is read as input. Audit uses existing outbox wrapper. | No demonstrated uncommitted coordination artifact |
| HTTP C4 production root | Deployment integration unproven; ops/work-product separation must be resolved in deployed operator journey. | Explicit remaining deployment gate, not hidden readiness |
| HTTP C5 shutdown/quiescence | Windows JobObject closes on process death; HTTP close waits bounded request. Readiness active-preparation count not integrated. | Remaining rollout readiness work |
| HTTP C6 double session | Both use same requireSession/verifiedSession authority. | Closed |

## Verification and completion conditions

Historical tests are listed in 2026-09-10-whole-plan-progress.md and do not certify new edits. Root must run the changed Python suites, affected dashboard route/process/integration/UI/composition tests, typecheck/build, then obtain an independent follow-up on consequential repairs. Preserve failures as evidence. No full production media success, authenticated deployment, GPU run, main merge or publication is implied.

Keepawake was verified armed at about00:12UTC (root56824/supervisor64772); finite lease through about08:31Eastern September11. Recorded RunPod arc remains$30.629730/$50. No provider operation in this review wave.

## Closing checkpoint

All five initial reviewers and all five repair/verification worker attempts have stopped. Four repair tasks completed; the first video repair worker hit its80k observed context cap with edits saved. A fresh Opus session inspected that source independently, found no concrete new defect, and added six publication-limit regression cases. This does not substitute for final review of the whole combined repair diff.

Root verification so far: Studio process15PASS and real integration2PASS; the initial combined run41PASS/1FAIL hit a5000ms timeout in the first trivial route test under concurrent load. Sequential route/surface/UI rerun130PASS(25/70/35), with timeout unchanged. Collector11PASS; content adapter37PASS/1deselected (real movie integration runs separately). Typecheck and production buildPASS. Final focused video/motion result is recorded in MAIN/_private/figment-review-checkpoint-20260911-v1.json and the canonical handoff when complete. Full video suite has not been rerun against these final repairs.

Compatibility: Studio pre-release intent hashes now include the authenticated subject; old plain-intent markers are retained but will not replay under the new key hash. Motion slot-fit v2 requires accepted_video_sha256; legacy v1 still rulings are unchanged. No automatic migration or deletion of previous artifacts.

Final focused Python run:14PASS/128deselected in214.79s, including both real producer/CLI joins. JUnit: MAIN/_private/figment-video-motion-review-repairs-root-20260911-v1.xml. All workers and test sessions are closed. Full current video suite and combined independent repair review are deliberately handed off.
