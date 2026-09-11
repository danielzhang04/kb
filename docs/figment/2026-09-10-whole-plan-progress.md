# Figment whole-plan progress - 2026-09-10

**Superseding checkpoint (2026-09-11):** Five independent reviews completed; confirmed repairs are written. See [review triage](2026-09-11-independent-review-triage.md) and OPS/handoffs/2026-09-11-figment-review-checkpoint.md for current tests and exact next steps. Historical counts and pending-packet wording below describe the September10 checkpoint, not current worker status. Final independent repair review and full current video suite remain before technical readiness.

The core CLI infrastructure is substantially built. There is not yet a complete usable production Studio or an accepted creator media pipeline. Components exist across mandate stages1-7; this does not mean those stages have all met their quality goals. Posting/measurement and optimization (stages8-9) remain deferred by the user's later instruction.

| Workstream | Built and verified | Remaining |
| --- | --- | --- |
| Research book | Six chapters plus source, package, capability and experiment audits | Continuous refresh and production-proven recommendations |
| Identity/dataset | Canonical persona/provenance, curation and materialization;20train/2eval research rows | Desired early20s appearance and consistent identity across varied views; balanced close-face coverage |
| Training/tester | Real1250-step training, five checkpoints and five tester outputs; receipts and teardown verified | All five outputs were culled; no selected checkpoint |
| Still generation | Planner, base/detail/upscale paths, grading/rulings and current-source approval checks; real fixture joins | Accepted held-out still set meeting identity/register/texture requirements |
| Video | Native generation/assembly/extraction; candidate preparation independently reviewed; terminal rulings/validator locally tested | Independent terminal-authority review; actual accepted full-playback video; production temporal/detail passes |
| Content system | Compiled research briefs, approved-still assignments and read views; motion-source assignment now locally tested | Independent motion integration review; finished-video rendering/delivery QA; non-persona assets; ongoing research loop |
| Studio | Lifecycle/research/QA views, offline preview and protected generation-plan preparation | Input editing, governed launch/review controls, authenticated deployment and complete operator journey |
| Accounts/measurement | Deferred | Official integrations, scheduling, publication, analytics and optimization; no current work scheduled |

## Test evidence, without adding overlapping suites

- Studio preparation:137PASS, typecheck/buildPASS, including actual default Windows process executor, fixed planner arguments, fresh/stale consumer behavior, storage/idempotency/auth/UI cases.
- Video:177full-suitePASS before the final bounded terminal-claim read fix, then5targetedPASS after it, including real producer/CLI integration. The independent source review is pending.
- Content:56PASS after the first motion adapter change (47previous cases plus9new unit cases). The final motion-specific suite then passed10tests, including real accepted-gen -> candidate -> local movie -> video rulings -> content CLI, followed by changed-movie refusal. These counts overlap.
- Latest hub:44PASS, typecheck/buildPASS. The exact synthetic producer brief/assignment bytes also passed the real collector as `recorded-source-snapshot`.
- Earlier content/still, candidate/preparation, gen-freshness and assignment-view slices have independent reviews. Current Studio/video-terminal/motion slices do not yet have completed independent code reviews. No deployed end-to-end browser journey or production quality acceptance is claimed.

## Work continued in this checkpoint

The existing content adapter now consumes the sole accepted-video validator, cross-checks its approved still against the brief persona/reference, and writes explicit v2 source-material-only assignments for motion. The existing collector and UI recognize that version and retain the old still record behavior. Mutation/refusal tests preserve prior outputs. The real producer test caught an adapter bug: the smaller content parser rejected a valid81-frame approval record. The adapter now delegates that record's bounded validation to the sole video authority, preserving its limits.

Evidence: MAIN/_private/figment-motion-binding-root-20260910-v3.xml (56PASS), v6.xml (10PASS), figment-motion-hub-root-20260910-v1.xml (44PASS), and figment-motion-hub-real-20260910-v1/result.json. Failed setup/import/schema attempts are preserved separately; no provider action occurred.

## Remaining sequence

1. Complete independent Studio/video code review against the two newly prepared immutable packets. Exact-payload approval question is pending; prior denied packets are not retried or replaced.
2. Independently review the new motion assignment and real producer/collector join. Implement final delivery evidence/rendering only under a separate bounded contract.
3. Obtain acceptable media through a discriminating identity/appearance experiment. The current all-cull disposition remains authoritative; the two-image alternate seed audition is closed, not a new training set. The private paired checkpoint diagnostic remains separately blocked on exact upload consent.
4. Build the remaining Studio input/launch/review controls around the existing CLI and authority boundaries, then exercise refusal/resume and the complete operator journey.
5. Add non-persona asset generation/QA, delivery transformations and research refresh where actual producers/consumers exist. Instagram remains deferred.

Recorded RunPod arc remains$30.629730/$50. Keep-awake was verified armed about22:44UTC with a finite lease through about08:31Eastern September11. A power lease is not evidence of an active model worker.
