# Approved `gen` still adapter contract

`video_manifest.py` accepts the approval-free diagnostic receipt
`figment/video-first-frame-input@1`. That route stays unchanged. The mutually
exclusive approved-still route uses `--approved-gen-plan` for the existing `gen`
plan and `--approved-gen-image-id` for the selected reviewed image. The plan's
run directory contains the existing `gen` evidence:

```
plan.json
grade/gen/grading-manifest.json
grade/gen/gate.json
grade/gen/approved-list.json
grade/gen/approval-lineage.json
<the approved image named by approved-list>
```

The adapter selects exactly one approved image from
`figment/approved-images@1` where `creator` matches the current persona and
`stage` is exactly `gen`. It must not write or amend any approval record. Its
first-frame provenance must contain only the selected `image_id`, root-relative
image path, byte count and SHA-256, plus hashes of the approved list and approval
lineage records. The default compiled `figment/video-i2v-manifest@1` remains
`not_promotable: true`: it has not rendered a clip and has no temporal review.
The explicit `--mode review-candidate-v1` route instead emits the distinct
`figment/video-review-candidate@1` schema with literal `unreviewed` lifecycle
and temporal-review eligibility. It is still not accepted media. Only a future
terminal review authority may produce accepted-video lineage.

Resolution is selected from two fixed profiles. The receipt-based diagnostic route
continues to default to `legacy-512x288`. The approved-gen route defaults to and requires
`native-1280x704`; explicitly requesting the legacy profile on that route fails closed. The
compiler changes only the pinned workflow's node-55 width/height and the matching
`frame_budget`. It records the profile, dimensions, immutable source-template hash, and the
effective compiled-workflow hash. The output name includes both the profile and effective
hash prefix so outputs from different resolutions cannot collide or share ambiguous
provenance. The digest covers the manifest-compiled graph before the harness applies its
per-job seed and output-prefix substitutions.

Freshness is the essential gate. The adapter must reuse the existing current
approval validation, currently `figment_train._load_current_approval`, which
recomputes the `lineage.review_subject` and calls `lineage.assert_current`.
That subject binds the plan, all `gen` manifests, reviewed image bytes, persona
and training configuration, anchors and numeric gate. A video-local copy of this
logic could diverge from the still pipeline and is not acceptable.

The read-only seam is `figment_train.validate_approved_gen_still(creator, plan,
image_id)`. It reuses `_load_current_approval`, exact rulings normalization and
the stored gate before returning the selected image and source-record digests.
The video adapter only consumes that result. No `gen` schema or approval-lineage
schema change is needed. The exact CLI shape is:

```powershell
python video_manifest.py --root <ROOT> --persona <PERSONA> --approved-gen-plan <GEN_PLAN> --approved-gen-image-id <IMAGE_ID> --resolution-profile native-1280x704 --action <MOTION_TEXT> --out <MANIFEST_BESIDE_SELECTED_FRAME>
```

For a prospective temporal-review candidate, add
`--mode review-candidate-v1`. Candidate mode requires the exact current persona
bound by the approved-gen plan, uses a reserved candidate ID/output prefix, and
records the SHA-256 of the harness-derived per-job graph. The unchanged harness
must apply that same candidate ID to SaveImage node 9. A diagnostic receipt,
same-ID alternate persona, legacy resolution, stale approval, or unsafe evidence
path fails before publication.

`--out` must be beside the selected frame so the existing harness can stage both
without widening its upload boundary.

The implementation is covered by the following fixtures and assertions:

- current `gen` approval with one kept image compiles and binds its bytes/hash;
- stale approval lineage, stale plan, receipt/image byte mutation, wrong creator,
  root-escape path, and a rejected image fail closed;
- the existing diagnostic receipt command keeps its default resolution and render settings,
  while its added profile metadata and output name bind the effective graph;
- receipt-based diagnostics default to 512x288, approved-gen manifests default to 1280x704,
  and unknown profiles or an approved-gen legacy request fail before any write;
- the effective workflow, `frame_budget`, profile record, and output name bind the same
  selected resolution;
- neither manifest mode claims acceptance, rendering, or temporal quality;
- candidate mode reaches the real approved-gen validator, upload expansion and
  unchanged harness dry-run, while its 81-frame assembly stays non-promotable
  review evidence.

After the upload-path repair, the production-lineage integration test passed in
54.65 seconds and the nested diagnostic-frame regression passed in 0.57 seconds.
The 14 video-manifest tests passed in 1.38 seconds and the two approved-still
validator tests passed in 0.29 seconds. These are contract checks; the compiled
video manifest remains diagnostic and non-promotable.

The resolution-profile change was independently reviewed READY with no findings. Root's
full video suite passed 48 tests in 17.06 seconds. No live video or quality conclusion is
part of that verification.


## Prepare a prospective candidate for review

After the existing runner, assembler and extractor have produced current local
evidence, the reviewed preparation command is:

```powershell
python video_review.py prepare --root <ROOT> --candidate-manifest <CANDIDATE_JSON> --run-receipt <RUN_JSON> --assembly-receipt <FRAME_ASSEMBLY_JSON> --extraction-receipt <FRAME_EXTRACTION_JSON>
```

All four evidence paths are relative to ROOT. This command has no output-path
option: it writes a fresh `evaluation-inputs.json` beneath the candidate's
physical directory, in `video-review/SHA256(candidate_id encoded as UTF-8)/`.
The full ID remains in the record. Renaming the manifest or widening ROOT does
not create a second review store for that candidate. Existing stores are never
overwritten.

Preparation revalidates the approved still and candidate compiler, all 81
original PNG prompt graphs, terminated receipt, native movie, and three
extracted samples. Missing, changed, oversized, malformed or linked evidence
fails before publication. Its status is `prepared`; it writes no rulings,
accepted video, or quality conclusion. Historical diagnostics stay ineligible.

Independent verification passed 74 video tests and the real approved-gen to
candidate, local assembly/extraction and subprocess preparation join. See the
[preparation review](../../../../docs/figment/2026-09-10-video-review-preparation-review.md).
The attributed rulings writer and accepted-video validator are a separate next
slice. Intended adult age presentation, all-frame observations and actual
full-clip playback remain distinct requirements.
