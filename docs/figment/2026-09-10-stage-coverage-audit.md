# Figment stage coverage audit — 2026-09-10

## Scope

This is a read-only coverage check against the Figment mandate, current
operator runbook, concrete callers, and current tests. It separates implemented
producer/consumer joins from missing code and from missing quality evidence.
Instagram, publishing, scheduling, analytics, and the explicit tier remain
deferred. No parallel orchestrator or publisher stub is proposed.

## Supported joins

| Producer | Current consumer | Binding and evidence | Status |
| --- | --- | --- | --- |
| Persona plus accepted captioned dataset | `figment_train.build_train_first_plan`, then `run --stage train` | Dataset approval and exact copied inventory are revalidated before the train manifest runs. The train-first tests cover missing/stale approval, media/caption mutation, and current plan binding. | Implemented and fixture-tested; creator-001 has bounded research dataset evidence, not production acceptance. |
| Completed train artifacts | Tester plan, grade, rulings, checkpoint selection | Tester inputs bind the train manifest and checkpoint bytes. `apply-rulings --checkpoint-step` can select only a kept produced candidate. All-cull records rejection without opening an approval path. | Implemented and live-proven mechanically; the current creator-001 tester culled every candidate. |
| Accepted tester checkpoint | Fresh `gen` plan | `_stage_accepted_checkpoint` validates current tester approval and stages only the selected checkpoint. `test_train_first_tester_selection_stages_current_checkpoint_in_fresh_gen_plan` exercises the real external-source join. | Implemented and fixture-tested; currently blocked by quality evidence because no checkpoint is selected. |
| Completed `gen` outputs | Gen grade, rulings, approval lineage, `validate_approved_gen_still` | The validator rechecks the plan, evaluation, gate, rulings, approval, approved list, selected image bytes, and a final evidence snapshot. | Implemented and fixture-tested; no creator-001 approved `gen` still exists. |
| Approved `gen` still | `video_manifest.build_manifest` | `video_manifest` calls `validate_approved_gen_still` directly and binds the returned image and evidence hashes. The prospective candidate mode also binds the exact authority persona, native profile, reserved output prefix, and harness-derived job graph. | Implemented and fixture-tested; candidate state is unreviewed and supplies no acceptance. |
| Video manifest plus harness receipt | `frame_assemble`, then `frame_extract` | Assembly requires the exact successful terminated receipt and ordered 81-frame inventory; extraction hashes the resulting local video and samples. Candidate assembly remains explicitly non-promotable evidence. | Implemented for diagnostic and prospective evidence; no acceptance follows. |
| Content request plus current producer inputs | `content_brief.build_content_brief` | The compiler binds the current persona, canonical reference, taxonomy, selected template, exact slots, dated sources, hypothesis, and null metrics. | Implemented and checked in for one CT-2 planning brief. |
| Current brief plus per-slot fit rulings and approved `gen` stills | `content_asset_binding.build_content_asset_binding` | The adapter replays the brief, cross-binds persona/reference identity to current gen approval, calls `validate_approved_gen_still` for every distinct slot image, then repeats source validation before exclusive write. | Independently READY; author and reviewer each recorded 47 passing content tests, including real producer-to-isolated-CLI use. No creator-001 assignment can exist until approved stills exist. |
| Checked-in briefs and assignments | `collectContentBriefs` → `/api/figment` → Research tab | The collector projects bounded planning fields plus per-brief missing, recorded-snapshot, or unavailable assignment state. Route and UI tests preserve older payloads and fail closed on invalid evidence. | Implemented and committed at `714bd68f`; undeployed. |

## Gaps and blocks

**Quality block.** The accepted research dataset
can feed train/tester, and an accepted tester checkpoint can feed fresh `gen`.
Creator-001 cannot advance because the actual tester disposition culled all five
images. Creating a keep, checkpoint, gen still, or assignment to bypass that
result would violate the existing contracts.

**Gen execution freshness prerequisite.** The real Studio design probe compiled
an accepted-checkpoint fixture and then removed its source tester approval.
The existing gen consumer still reached a fake harness because it only
rechecked the staged checkpoint bytes. The existing consumer now revalidates current persona,
selection, tester approval and source-checkpoint authority at every launch.
The repair is independently READY: four focused tests cover mutations and the
real train-first/fresh-gen join. Both changed selection and missing source
evidence between runs persist a stopped state. See the
[freshness review](2026-09-10-gen-authority-freshness-review.md). The Studio
control implementation and its independent review remain separate. Moving a compiled plan directory also breaks its absolute
argv binding; the future control must preserve the directory selected before
compilation. See [Studio control plan](2026-09-10-studio-control-plan.md) and
`REVIEW/_private/figment-studio-control-plan-probe-20260910-v1/result.json`.

**Missing video acceptance authority.** The runbook explicitly states that no
standalone temporal-QA acceptance command exists. The candidate compiler now
emits an unreviewed prospective input; assembly and extraction remain
non-authoritative evidence. There is no current record that can turn reviewed video bytes
and sampled frames into current accepted-video lineage. A reel `G` slot cannot
be supported by relabeling existing diagnostic clips.

**Assignment visibility is closed.** The protected read route and Research tab
now project bounded assignment state beside each brief. This remains planning
evidence and does not establish current image approval, asset quality,
publication readiness, or deployment.

**Unsupported asset classes.** The new adapter accepts only persona stills.
Non-persona stills have no approved generation/QA authority, and motion slots
have no accepted-video authority. These are upstream evidence/schema gaps, not
fields the hub should infer. In addition, the native candidate is
1280x704 at 16 fps for 5.0625 seconds, while `reel-templates.yaml` specifies
1080x1920 at 30 fps and template-specific durations. A future accepted clip
assignment would identify source material only. It cannot assert finished reel
fit or silently authorize cropping, retiming, audio, or delivery acceptance.

**Missing Studio control surface.** The hub currently offers bounded read-only
research and training views plus a fixed offline tester preview. It does not
provide protected controls to generate plans, launch train/tester/gen/video
runs, record review rulings, or apply accepted decisions. The read-only brief
and rejection projections improve visibility but do not satisfy the mandate's
Studio control goal. Any future controls must call the existing contract-bound
commands and preserve their authorization and evidence gates rather than
reimplementing pipeline state in the dashboard.

**Deferred mandate stages.** The declarative workflow names `plan_week.py`, a
week batch, schedule, publish audit, post records, and insights. `plan_week.py`
and `pipeline/publish` do not exist. Building placeholders now would not close
the current accepted-media gaps and would cross the explicit Instagram/T3
boundary.

## Ranked next infrastructure choices

1. Current-evidence video preparation is independently READY, with74video tests and the actual producer-to-subprocess CLI join passing. Implement the next separate slice: attributed rulings and the sole accepted-video validator. Each receives independent review and real producer/consumer tests. This has the highest end-to-end value because it completes the Stage 6 authority boundary and enables future `G` slots. It must not accept current diagnostic clips retroactively or imply live execution.
2. The gen freshness repair is independently READY. Implement the existing authenticated Studio plan-preparation control with stable paths, bounded storage and request idempotency. No live launch or approval writer belongs in that first control.
3. Add a non-persona still authority only when there is an actual bounded generator and QA producer to consume. Do not generalize the persona adapter or invent accepted lineage.

Product progress still depends on new supported evidence that yields a selected
checkpoint and approved held-out stills. Green contract tests show that the
handoffs work; they do not satisfy the mandate's identity, apparent-age,
full-resolution realism, or temporal-consistency criteria.
