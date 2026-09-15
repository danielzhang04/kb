# Figment whole-plan progress

**Current status (2026-09-11):** the bounded repair diff `150978d8..ec58decf` (Studio,
video terminal authority, motion-source binding, HTTP surface) is reviewed READY, with
the full video suite passing (187 passed in 392.98s) — see the
[repair checkpoint review](2026-09-11-repair-checkpoint-review.md). The Studio
stored-plan inventory/scope server slice is independently READY and committed locally at
`749abdca` — see the [inventory server review](2026-09-11-studio-inventory-server-review.md).
The Studio UI (`StudioGenPlans`) has 41 component tests, 33 workspace tests, a real
planner/API/UI join pass, and typecheck/build all passing, reviewed READY — see the
[Studio resume UI review](2026-09-11-studio-resume-ui-review.md). This bounded slice is
complete; full Studio input/launch/review remains incomplete. The identity/coverage
diagnostic (V4, ten clothed images) completed with independently verified pod teardown
(estimated $0.247567; arc $30.877297/$50): LoRA shows stronger resemblance cues to `g01`
than the no-LoRA control, but every output still misses shoulders-up framing and facial
proportions still differ — see the [held-out diagnostic review](2026-09-11-heldout-diagnostic-review.md).
The face-coverage/drift audit on that same set has since run (33/33 records, two
independent Opus visual reviews): it supports further investigation but rejects blanket
crop-based training, pending full-image inspection of a low-concern shortlist — see the
[face-coverage review](2026-09-11-face-coverage-review.md). The creator still has no selected checkpoint, accepted still, or accepted video. Earlier
counts below the workstream table describe prior checkpoints and are superseded where
they conflict with this paragraph.

The core CLI infrastructure is substantially built. There is not yet a complete usable
production Studio or an accepted creator media pipeline. Components exist across
mandate stages 1-7; this does not mean those stages have all met their quality goals.
Posting/measurement and optimization (stages 8-9) remain deferred by the user's later
instruction.

| Workstream | Built and verified | Remaining |
| --- | --- | --- |
| Research book | Six chapters plus source, package, capability and experiment audits | Continuous refresh and production-proven recommendations |
| Identity/dataset | Canonical persona/provenance, curation and materialization; 20 train/2 eval research rows; V4 ten-image diagnostic with verified teardown; face-coverage/drift audit run and reviewed | Full-image inspection of the audit's low-concern shortlist; desired early-20s appearance, shoulders-up framing, and consistent identity across varied views |
| Training/tester | Real 1250-step training, five checkpoints, five tester outputs, all culled; V4 diagnostic shows a visible LoRA effect but no proportion match | No selected checkpoint; framing and proportion gap unresolved |
| Still generation | Planner, base/detail/upscale paths, grading/rulings and current-source approval checks; real fixture joins | Accepted held-out still set meeting identity/register/texture requirements |
| Video | Native generation/assembly/extraction; repair diff READY with full 187-test suite passing | Actual accepted full-playback video; production temporal/detail passes |
| Content system | Compiled research briefs, approved-still assignments, motion-source assignment and producer/collector join reviewed complete through the `ec58decf` repair checkpoint | Finished-video rendering/delivery QA; non-persona assets; ongoing research loop |
| Studio | Lifecycle/research/QA views, offline preview, stored-plan inventory/scope server (READY), `StudioGenPlans` UI (component/workspace tests, real planner/API/UI join, typecheck/build all pass, READY) | Input editing; governed launch/review controls; authenticated deployment; complete operator journey |
| Accounts/measurement | Deferred | Official integrations, scheduling, publication, analytics and optimization; no current work scheduled |

## Remaining sequence

1. The face-coverage/drift audit on the V4 diagnostic set has run and is reviewed; see the
   [face-coverage review](2026-09-11-face-coverage-review.md). Root inspected the five shortlisted originals. Declared-crop provenance is now
   being implemented for a controlled experiment; no retrain or promotion decision follows
   from the audit alone.
2. Finished-video delivery evidence/rendering only under a separate bounded contract.
3. The brief text compiler/collector mismatch is fixed and reviewed at `a3d87a8c`;
   see the [content input contract review](2026-09-11-content-input-contract-review.md).
   Build the remaining Studio input/launch/review controls around the existing CLI and
   authority boundaries, then exercise refusal/resume and the complete operator journey.
4. Add non-persona asset generation/QA, delivery transformations, and research refresh
   where actual producers/consumers exist. Instagram remains deferred.

Recorded RunPod arc is $30.877297/$50.
