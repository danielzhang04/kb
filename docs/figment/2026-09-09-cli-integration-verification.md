# Figment offline CLI integration verification

## Corrected verdict

The existing production still-image path has no verified missing lineage join from persona and curated dataset through accepted checkpoint and approved `gen` stills.

`held-out-diagnostic` is intentionally a separate research protocol. Its docstring defines an unscored candidate-versus-control comparison that is non-promotable by construction. Accepting an unaccepted checkpoint is required for that purpose. The fact that it accepts any nonempty `.safetensors` candidate is not a broken production lineage edge because no downstream production path treats its output as accepted.

The first verified unresolved production join is after an approved `gen` still: `video/video_manifest.py` accepts only an approval-free `figment/video-first-frame-input@1` diagnostic receipt and actively rejects any approval/acceptance/decision claim. It therefore cannot consume the existing `gen` approved-list and approval-lineage records. This matches the corrected delivery plan's Phase 4 statement that the video compiler still needs an approved-still lineage wrapper.

## Verified production joins

### Persona and curation to dataset acceptance

`training_config.load_persona_with_training` merges and validates the persona and training extension, including trigger, checkpoint schedule, DOP fields, and generation settings.

For the creator-001 single-seed route, `curate_single_seed_dataset` produces an unapproved dataset with `dataset_curation.json` plus retained request, source-image, and provenance snapshots. `lineage.dataset_subject` reopens and validates those snapshots, requires first-generation derivatives from canonical `anchors/g01.jpg`, prevents a derivative hash from crossing train/eval, binds captions and materialized output order, and inventories the curation evidence in the dataset subject.

`accept_train_first_dataset` requires at least 20 images and writes `figment/dataset-approval@1` over the current dataset subject. When curation evidence is present, it is included in the accepted subject. The focused tests mutate source snapshots, provenance, captions, split assignments, ready markers, manifests, and post-acceptance files and observe fail-closed rejection.

A generic 20-row dataset can be accepted without `dataset_curation.json`; this is an intentional compatibility path. For creator-001 delivery, the curated route must be used when claiming immutable curation evidence. `accept-dataset` records an operator decision over the bytes presented; it does not itself perform visual quality review.

### Dataset acceptance to train-first plan

`build_train_first_plan` requires `_dataset.ready`, `dataset_manifest.json`, and a current `dataset-approval.json`. It recomputes the dataset subject, compares `subject_sha256`, copies only the approved image/caption and curation inventory, renders `training.json`, and carries the dataset approval hash into the ordinary `figment/train-plan@1` document with `variant: train-first`.

Before a train-first stage is installed or run, `_validated_train_first_dataset` and `_assert_exact_staged_dataset` run again. Caption mutation, forged ready markers, unlisted additions, missing files, and symlinks fail before the harness. The same plan schema drives train then tester; there is no duplicate runner.

### Tester ruling to production held-out stills

`apply_rulings --stage tester --checkpoint-step` only selects a produced checkpoint whose tester image was explicitly kept. It writes `accepted-checkpoint.json` with hashes for the source plan, approval lineage, training-input projection, checkpoint bytes, and train manifest.

`figment_train.py plan --stage gen` calls `_stage_accepted_checkpoint`. That function revalidates the accepted-checkpoint schema and creator, source-plan location and hash, current tester approval lineage, training-input projection, checkpoint step/name/path/bytes/hash, train-manifest hash, and the persisted chosen-checkpoint digest before staging the checkpoint. `_install_stage_config` hashes the staged upload again immediately before a `gen` run.

`gen` is gradeable under the same `grade`, `apply-rulings`, and `gate` paths as tester and dataset images. A kept `gen` still therefore receives the normal hash-bound approved-list and `figment/approval-lineage@1` record. No separate held-out protocol is required for this production path.

## Intended research protocol and its consumers

`build_held_out_diagnostic_protocol` freezes a candidate and no-LoRA control over the same five seeds and prompt, records the candidate and current anchors by hash, leaves all criteria unscored, and sets `promotion.allowed` to false. Its tests correctly use arbitrary candidate bytes because the command is for research diagnosis, including checkpoints that have not been accepted.

A repository-wide search found no code consumer of `figment/held-out-diagnostic-protocol@1` outside its builder and tests. The historical candidate/control experiment did execute successfully, but `docs/figment/2026-09-08-single-seed-experiment.md` records that its combined manifest was prepared separately. `docs/figment/2026-09-08-paired-diagnostic-review.md` binds that frozen protocol, the separately compiled manifest, and the resulting run receipt by reported hashes. This proves the experiment ran; it does not establish a reusable protocol-to-manifest compiler.

The local `local_lora_pair_engine.py`, matched runtime, and profile runtime create hash-bound, non-promotable receipts for their own fixed diagnostic plans. They do not parse `DIAGNOSTIC_PROTOCOL_SCHEMA` and are not a generic executor for `held-out-diagnostic` output.

The absent protocol-to-manifest-to-receipt compiler is a real research automation gap already named in the single-seed experiment note. It does not block the production still path and should not be closed by forcing research candidates through accepted-checkpoint lineage.

## First true unresolved production join

`video/video_manifest.py:_load_first_frame` requires `figment/video-first-frame-input@1`, verifies the image hash, and rejects the receipt if `_approval_claim` finds any approval, acceptance, or decision field. Its output manifest is also explicitly `mode: diagnostic` and `not_promotable: true`.

Consequently an approved `gen` still cannot become a production video start frame through the current compiler while retaining its approval lineage. The compiler has no input for `grade/gen/approval-lineage.json`, `approved-list.json`, the reviewed image ID, or their current hashes. This is the first concrete missing production edge after the verified still pipeline.

## Focused verification

Environment:

- Python: `C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe`, version 3.13.7
- Repository: Studio worktree
- Temp root: `C:\Users\danie\kb\_private\figment-cli-integration-verification-20260909-v1\tmp`
- Providers, credentials, pins, spend logic, scorers, RunPod sources, and production code: untouched

The exact command and selected node IDs are retained at `C:\Users\danie\kb\_private\figment-cli-integration-verification-20260909-v1\command.txt`. It covered the single-seed curation suite, training configuration, dataset materialization, held-out research protocol, train-first planning and ordered execution, lineage freshness/tamper cases, and creator-002 checked-in fixture acceptance.

Observed result:

```text
50 passed in 176.01s (0:02:56)
```

Exit code was 0 and stderr was empty. Complete stdout/stderr are retained beside the command file.

## Subsequent adapter disposition

Do not change `held-out-diagnostic` or require accepted checkpoints for research protocols.

The original reviewer opinion was to defer the approved-still adapter until a quality-accepted `gen` artifact existed. Root rejected that sequencing constraint: exact producer-schema fixtures are sufficient to build and fail-close the infrastructure before a real image is accepted. The resulting adapter reuses the existing `figment/approval-lineage@1` and `approved-list.json`, binds the reviewed image and source plan, and keeps the approval-free diagnostic route.

The first production-lineage integration passed in 36.66 seconds and the original 16 focused tests passed in 1.96 seconds. A later consumer check found and repaired a nested upload-path duplication: after that repair, the real integration passed in 54.65 seconds, the nested diagnostic regression passed in 0.57 seconds, and the 14 video-manifest plus two approved-still validator tests passed in 1.38 and 0.29 seconds respectively. These checks do not create an accepted still or make the resulting video manifest promotable.
