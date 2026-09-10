# Prospective Figment video acceptance contract

## Decision boundary

This plan defines one future offline review and lineage boundary. It does not
approve a clip, score visual quality, run a provider, or add an orchestrator.
The current `figment/video-i2v-manifest@1` records use `mode: diagnostic`, the
current assembly and extraction receipts say `not_promotable: true`, and the
current harness receipt binds output name and seed rather than an executed
workflow. None of those existing artifacts is eligible for acceptance, even if
someone later writes favorable rulings beside it.

The only prospective eligible producer is a new `review-candidate-v1` mode in
the existing `video_manifest.py`. It is available only with the approved-gen
input route, the native 1280x704 profile, current still approval, and the
existing pinned workflow and model inventory. The compiler writes a distinct
`figment/video-review-candidate@1` schema with lifecycle `unreviewed` and
`eligible_for_temporal_review: true`. It does not use the diagnostic
`not_promotable` state, and it is not an
accepted input until an accepted-video lineage exists. The compiler also uses
a reserved `review-candidate-v1-...` output namespace that reaches the sole
job's SaveImage prefix. Eligibility to be reviewed is not approval.
Receipt-based first-frame diagnostics remain diagnostic-only.

`runpod_run.py` remains unchanged as the runner. The offline reviewer derives
the exact job graph with the existing `apply_job(manifest.workflow, job,
seed_fields)` function and requires the `prompt` metadata embedded in every one
of the 81 downloaded Comfy PNGs to equal that graph plus exactly one known
Comfy annotation: node 56 `LoadImage.is_changed` must be the one-element list
containing the SHA-256 of the current uploaded first-frame bytes. This is the
behavior of the already pinned Comfy commit. No arbitrary metadata fields are
stripped or tolerated. The reserved candidate SaveImage prefix is therefore
present in the executed graph and every output. The reviewer also binds the
current manifest SHA-256 and receipt names, seed, order, byte counts, successful
status, and teardown. Missing, oversized, or malformed PNG prompt metadata is
ineligible. A new schema label placed beside an old diagnostic graph and
receipt cannot satisfy these checks. No harness change or second runner is
required.

This graph check has bounded diagnostic feasibility evidence, not prospective
eligibility. The first strict comparison against all 81 historical V3 PNGs
found one difference in every graph: node 56's `is_changed` fingerprint. The
V2 probe verified the current input-frame SHA-256
`e33f2d0c396e4e0f7eed49240271d972d36bdafa2a6f27ef04dcfaaf3cf6f6a2`,
allowed only that exact annotation, and matched all 81 graphs with no other
difference. The records are
`MAIN/_private/figment-video-candidate-graph-probe-20260910-v1.json` and `v2.json`.
The pinned primary behavior is in ComfyUI
[`execution.py`](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/12d5279438bfefc058a269eae805ceab6047777f/execution.py)
and [`nodes.py`](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/12d5279438bfefc058a269eae805ceab6047777f/nodes.py).

`frame_assemble.py` and `frame_extract.py` remain the media adapters. They may
accept the new candidate mode, but their receipts continue to make no quality
or approval claim. Candidate assembly must preserve the manifest and run
receipt hashes, all 81 ordered frame hashes, the MP4 hash, dimensions, frame
count, frame rate, and duration. Extraction continues to produce exact first,
middle, and final frame hashes from that MP4.

## Review subject

One future `video_review.py prepare` command builds
`figment/video-evaluation-inputs@1` from current local evidence. Its subject is
canonicalized with `lineage.canonical_sha256` and contains only root-relative
records and bounded metadata for:

- the candidate manifest, its approved-gen source plan, approved still ID and
  current `validate_approved_gen_still` result;
- the pinned workflow, model inventory, candidate graph, seed, output name,
  reserved candidate prefix, action, dimensions, 81-frame/16-fps budget, and
  canonical digest of the `apply_job` graph;
- the successful terminated harness receipt, plus the bounded prompt graph
  parsed from each of its 81 ordered PNGs and matched to that `apply_job` graph;
- the assembly receipt, all 81 ordered frame entries, MP4 entry and probed
  metadata;
- the extraction receipt and exact first, midpoint, and final frame entries;
- the current persona projection and canonical approved-still lineage already
  established by the still validator.

The preparation is a review surface, not a decision. It may generate a bounded
local contact sheet or playback reference from those already-recorded bytes,
but such a convenience file is not evidence and is never part of acceptance.

## Human observations and rulings

`video-rulings.json` is an explicit operator/root-authored input. It binds the
evaluation subject digest, `decided_by`, `decided_at`, and one decision:
`accept`, `reject`, or `parked`. Free-text reasons are bounded plain text.

The three extracted-frame rulings use the existing `qa_stamp.stamp` logic on an
in-memory three-image manifest. Each ruling carries the existing identity,
realism, hands, lighting, adult-read, garment-integrity, and real-person-
resemblance axes. The caller requires exact coverage of all three IDs after
stamping; an unreviewed, parked, or safety-failed sample cannot be accepted.
`qa_stamp.py` remains unchanged and is not treated as temporal QA.

Two additional observations are mandatory for acceptance:

1. `complete_sequence` binds the canonical digest of all 81 ordered frame
   entries, states `coverage: all-81-ordered-frames`, and records pass/fail
   rulings for identity stability, anatomy stability, background stability,
   visible corruption, adult read throughout, garment integrity throughout,
   and real-person resemblance throughout.
2. `full_playback` binds the MP4 SHA-256, states `coverage: entire-clip`, and
   records pass/fail rulings for motion intent, motion coherence, subject and
   camera continuity, flicker/warping, and pacing. This is an operator
   observation made after actual start-to-end playback. The command, three
   extracted samples, or an automated probe cannot manufacture that claim.

Every required axis must be present and valid. `accept` succeeds only when all
three sampled frames are verified and safety-clear, every complete-sequence and
playback axis passes, both coverage bindings match the current subject, and no
gate override exists. `reject` or `parked` writes review/rejection evidence
without accepted lineage. Missing playback capability honestly yields `parked`; it is never inferred
from the extracted samples or the complete frame inventory.

## Decision records

`video_review.py apply-rulings` first reconstructs the current subject and uses
`lineage.assert_current` against evaluation inputs. It normalizes rulings,
invokes `qa_stamp.stamp` for sample frames, and writes a fresh append-only
review attempt containing normalized rulings and
`figment/video-review-manifest@1`. An attempt ID is a bounded plain identifier;
an existing attempt is never overwritten.

An accepted decision additionally writes `figment/accepted-video@1` with
`lineage.wrap_subject`, the reviewed subject digest, operator attribution,
rulings digest, exact MP4 entry, and transition `video-candidate-acceptance`.
That lineage is the sole future authority a motion-slot adapter may consume.
It does not mutate or copy the movie. Rejected or parked decisions write
no accepted-video record. A rejection writes terminal
`figment/video-rejection-lineage@1`; the same candidate cannot later be
accepted. A parked attempt is incomplete review evidence, not rejected media.
It writes no terminal lineage and may be followed by a new append-only attempt
against the exact unchanged candidate subject, so missing playback access does
not force another paid run. Exactly one terminal accept or reject record is
allowed. If any candidate source, graph, receipt, frame, movie, or current
upstream lineage changes, the old evaluation is stale and a new prospective
candidate is required.

The sole public consumer seam is
`video_review.validate_accepted_video(root, accepted_video_path)`. It treats the
accepted-video JSON as a pointer to evidence, never as standalone authority.
The validator reconstructs the current subject, calls `lineage.assert_current`,
reparses the normalized rulings and accepted review attempt, verifies their
recorded bytes and digests, requires exactly one terminal accepted record and
no terminal rejection, and repeats the source/media snapshot checks before it
returns. Its bounded result contains the creator and candidate IDs, root-
relative MP4 entry, source approved-still entry, candidate-manifest entry, and
accepted-lineage entry. Future `G`-slot and hub collectors must call this seam;
they may not infer acceptance from a raw file, path, or schema label.

## Current-input and write checks

All paths are lexical root-relative inputs with containment and reparse checks.
JSON reads have fixed byte, depth, entry, and text limits; media hashing has
fixed per-file and aggregate limits. Before any decision write, the command:

- replays candidate compilation and revalidates the approved gen still;
- verifies current workflow/model pins, derives the exact `apply_job` graph,
  and matches bounded prompt metadata from every ordered PNG to it;
- verifies the non-dry-run receipt, successful job, and teardown;
- revalidates assembly from the same 81 current frame bytes and verifies the
  current MP4 bytes and metadata;
- revalidates extraction against the same current MP4 and sample-frame bytes;
- checks the evaluation subject and every ruling coverage digest;
- snapshots every dependency, repeats the validations after capture, and
  compares the snapshots before an exclusive fresh write.

Mutation, stale still approval/persona/reference, manifest or receipt mismatch,
missing or reordered frames, altered MP4/sample bytes, malformed observations,
partial coverage, symlink/junction traversal, oversized evidence, an existing
attempt/terminal output, or any diagnostic-mode input fails before acceptance
is written.

## Required implementation evidence

The focused tests must cover candidate-mode admission, diagnostic-mode refusal,
and refusal of a diagnostic record with its mode manually relabeled;
still-approval mutation; manifest, pin, candidate-prefix and per-PNG prompt-
graph mismatch or missing/oversized metadata;
dry-run/failure/teardown refusal; missing, duplicate, reordered or mutated
frames; MP4 and extraction mutation; incomplete sample/sequence/playback
coverage; every failing quality or safety axis; stale evaluation/rulings; path,
reparse, size/depth and fresh-output failures; rejection/parked records with no
accepted lineage; a parked-then-completed review of unchanged evidence; refusal
after a terminal rejection; and mutation between initial validation and final
write. Consumer-boundary tests must also prove that current acceptance returns
the bounded projection and that stale MP4/frame bytes, upstream still/persona,
candidate graph, normalized rulings, review attempt, or terminal record fails
closed before any `G`-slot or hub projection is returned.

One provider-free producer/consumer fixture must carry a real approved-gen lineage
through the candidate compiler and harness schema. One bounded local-media
fixture must carry 81 generated frames through the actual assembler and
extractor into review preparation and accepted/rejected application. It proves
contract joins only. A later authorized live candidate must still pass the
same current-input checks and receive real full-sequence and full-playback
operator observations; fixture rulings cannot approve live media.
