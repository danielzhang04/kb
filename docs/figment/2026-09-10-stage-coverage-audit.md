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
| Approved `gen` still | `video_manifest.build_manifest` | `video_manifest` calls `validate_approved_gen_still` directly and binds the returned image and evidence hashes. `test_real_approved_gen_lineage_compiles_nonpromotable_video_and_rejects_stale_evidence` reaches manifest upload expansion. | Implemented and fixture-tested; the compiled video remains diagnostic and non-promotable. |
| Video manifest plus harness receipt | `frame_assemble`, then `frame_extract` | Assembly requires the exact successful terminated receipt and ordered 81-frame inventory; extraction hashes the resulting local video and samples. The reviewed video suite recorded 48 passing tests. | Implemented for diagnostic evidence; no acceptance follows. |
| Content request plus current producer inputs | `content_brief.build_content_brief` | The compiler binds the current persona, canonical reference, taxonomy, selected template, exact slots, dated sources, hypothesis, and null metrics. | Implemented and checked in for one CT-2 planning brief. |
| Current brief plus per-slot fit rulings and approved `gen` stills | `content_asset_binding.build_content_asset_binding` | The adapter replays the brief, cross-binds persona/reference identity to current gen approval, calls `validate_approved_gen_still` for every distinct slot image, then repeats source validation before exclusive write. | Independently READY; author and reviewer each recorded 47 passing content tests, including real producer-to-isolated-CLI use. No creator-001 assignment can exist until approved stills exist. |
| Checked-in briefs | `collectContentBriefs` → `/api/figment` → Research tab | The collector projects only bounded planning fields. Route and UI tests preserve older payloads and fail closed on invalid evidence. The reviewed slice recorded 56 tests, typecheck, build, actual read-only probe, and qualified local fixture QA. | Implemented locally at `3ed8eaa9`; undeployed. |

## Gaps and blocks

**Quality block, not missing still-pipeline code.** The accepted research dataset
can feed train/tester, and an accepted tester checkpoint can feed fresh `gen`.
Creator-001 cannot advance because the actual tester disposition culled all five
images. Creating a keep, checkpoint, gen still, or assignment to bypass that
result would violate the existing contracts.

**Missing video acceptance authority.** The runbook explicitly states that no
standalone temporal-QA acceptance command exists. `video_manifest`,
`frame_assemble`, and `frame_extract` all preserve diagnostic/non-promotable
status. There is therefore no current record that can turn reviewed video bytes
and sampled frames into current accepted-video lineage. A reel `G` slot cannot
be supported by relabeling existing diagnostic clips.

**Smallest missing user-visible join: assignment to hub.** The content adapter
can now write a bounded assignment, but `collectContentBriefs` reads only
`<brief-folder>/brief.json`; the route and Research tab do not project an
assignment record or per-slot assigned/unassigned state. This is a real final
consumer gap. A small optional read-only projection beside each brief could
show assignment status, slot role/type, asset kind, and source-state labels
without exposing paths, image bytes, prompts, reviewer identity, or actions.
It must revalidate the assignment's brief hash and fail unavailable on stale or
malformed evidence. Older responses must remain compatible.

**Unsupported asset classes.** The new adapter accepts only persona stills.
Non-persona stills have no approved generation/QA authority, and motion slots
have no accepted-video authority. These are upstream evidence/schema gaps, not
fields the hub should infer.

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

1. Define and independently review one offline temporal-QA ruling and accepted-video lineage contract that consumes the existing manifest, terminated receipt, assembly receipt, extracted samples, persona, and source approved-still lineage. This has the highest end-to-end value because it completes the Stage 6 authority boundary and enables future `G` slots. It must not accept current diagnostic clips retroactively or imply live execution.
2. Add the optional assignment projection to the existing protected read route and Research tab. This is the smallest safe user-visible join and should remain read-only, backward-compatible, bounded, path-free, and explicit that assignment is planning evidence rather than asset or publication approval.
3. Add a non-persona still authority only when there is an actual bounded generator and QA producer to consume. Do not generalize the persona adapter or invent accepted lineage.

Product progress still depends on new supported evidence that yields a selected
checkpoint and approved held-out stills. Green contract tests show that the
handoffs work; they do not satisfy the mandate's identity, apparent-age,
full-resolution realism, or temporal-consistency criteria.
