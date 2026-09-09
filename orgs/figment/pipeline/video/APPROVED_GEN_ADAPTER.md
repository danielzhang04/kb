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
lineage records. The compiled `figment/video-i2v-manifest@1` remains
`not_promotable: true`: it has not rendered a clip and has no temporal review.

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
python video_manifest.py --root <ROOT> --persona <PERSONA> --approved-gen-plan <GEN_PLAN> --approved-gen-image-id <IMAGE_ID> --action <MOTION_TEXT> --out <MANIFEST_BESIDE_SELECTED_FRAME>
```

`--out` must be beside the selected frame so the existing harness can stage both
without widening its upload boundary.

The implementation is covered by the following fixtures and assertions:

- current `gen` approval with one kept image compiles and binds its bytes/hash;
- stale approval lineage, stale plan, receipt/image byte mutation, wrong creator,
  root-escape path, and a rejected image fail closed;
- the existing diagnostic receipt command still compiles unchanged;
- the manifest does not claim acceptance, rendering, or temporal quality.

After the upload-path repair, the production-lineage integration test passed in
54.65 seconds and the nested diagnostic-frame regression passed in 0.57 seconds.
The 14 video-manifest tests passed in 1.38 seconds and the two approved-still
validator tests passed in 0.29 seconds. These are contract checks; the compiled
video manifest remains diagnostic and non-promotable.
