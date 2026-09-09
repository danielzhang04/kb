# Video resolution profile implementation — 2026-09-09

Status: **independently READY for later manifest preparation. No live video run was
performed.**

`video_manifest.py` now accepts only two named profiles:

- `legacy-512x288`, the unchanged default for the approval-free diagnostic receipt route;
- `native-1280x704`, the default and only accepted profile for an approved `gen` still.

Both profiles reuse the existing hash-pinned Wan 2.2 TI2V workflow, ComfyUI commit, model
pins, seed, sampler, 81-frame length, 16 fps, GPU class, runtime limits, and cost ceiling.
The compiler first validates the original pinned 512x288 template, then changes only node
55's width and height for the selected profile. Arbitrary dimensions are not accepted.

Each manifest records the profile name and dimensions, repeats those dimensions in
`frame_budget`, retains the original template SHA-256, and adds the canonical SHA-256 of the
manifest-compiled workflow after prompt, first-frame path, and resolution substitution but
before the harness applies its per-job seed and output-prefix substitutions. The job output
name contains the profile and compiled-workflow hash prefix, preventing collisions between
otherwise identical 512x288 and 1280x704 requests.

Verification on Python 3.13:

- `video/tests/test_video_manifest.py` plus the real lineage join: 24 passed in 2.43 seconds.
  The native approved-gen
  dry run produced 81 fake outputs and recorded verified teardown plus an absence-verified
  recovery journal. The suite also covers legacy defaults, consistent workflow/manifest
  dimensions, effective digest binding, resolution-dependent output names, invalid-profile
  refusal before writes, approved-gen rejection of the legacy profile, and unchanged approval
  evidence bytes.
  The set includes the real fixture producer/consumer join
  `test_real_approved_gen_lineage_compiles_nonpromotable_video_and_rejects_stale_evidence`
  against current lineage code.
- Root's full video suite passed 48 tests in 17.06 seconds under Python 3.13 with a
  short private temp root.
- Independent review found no source, schema, provenance, or compatibility defect in the
  frozen implementation.

These checks prove local compiler and harness contracts only. The earlier 1280x704 V2/V3
visual results motivate the fixed profile but do not establish quality for a future approved
still, motion prompt, or seed. The manifest remains diagnostic and `not_promotable: true`.
