# Review of the Figment end-to-end delivery plan

## Verdict

**Revise the order, then execute it as finite work orders.** The plan is directionally sound: it keeps
Instagram out, separates mechanical completion from visual quality, reuses `figment_train.py`, and
does not need another orchestrator. The loop-design subtraction gate is decisive here: this is a
one-off dependency chain with bounded build, review, and test tasks, not a recurring cadence. A new
daemon or generic plan/build/judge loop would add state without creating an identity result.

Two corrections matter before this is an honest end-to-end plan. First, the plan has no producer for
the 20-plus varied, captioned rows between a successful two-image OmniGen2 diagnostic and
`train-first`. Second, it turns a second agent review into a required research gate even though
production promotion, not experiment selection, is where subjective human judgment belongs.

## Prioritized corrections

### 1. Add the missing pair-to-dataset production step

The critical-path diagram jumps from two reviewed reference outputs to a curated 20-plus-row dataset,
and the first ranked work order only tests whether the curation validator can ingest a receipt. The
current code cannot manufacture the missing rows:

- `accept_train_first_dataset()` only hashes and records an already-existing dataset and refuses fewer
  than 20 images (`figment_train.py:1611-1635`).
- `build_train_first_plan()` explicitly requires an **already-built, already-captioned** dataset
  (`figment_train.py:1726-1752`).
- A two-seed reference run can contribute at most two candidate images. Passing it proves that the
  conditioning method deserves a larger pilot; it cannot satisfy dataset diversity or count.

Insert a bounded **variation pilot** before dataset acceptance. If one or both reference outputs are
useful, freeze six varied jobs using the same OmniGen2 weights, graph, harness, and accepted `g01`
asset, varying only declared prompt/seed rows across pose, crop, light, and clothed wardrobe. Review
those six at full resolution. Only a passing pilot should expand to the 20-plus-row candidate set.
Then use the existing curation/build-training-set path, `accept-dataset`, and `train-first`. This is the
smallest join that turns the plan from a list of stages into an executable pipeline.

### 2. Remove consensus as a research-experiment gate

Lines 72-75, 81-87, and 160-163 require root plus an independent reviewer and treat disagreement as
an unresolved stop. The research book shows this exact pattern already stalled the paired diagnostic:
one reviewer saw an identity split, another found `g01` resemblance insufficient, and no operational
decision followed. Preserve both reads as evidence, but let the named experiment owner record one
bounded diagnostic disposition: continue, change one variable, or stop.

Keep the user's full-resolution judgment for production identity, dataset, checkpoint, still, and
video acceptance. That is the subjective quality boundary. It does not imply another user prompt or
two-reviewer consensus before a non-promotable research variation. The exact g01 RunPod transfer and
$1.30/60-minute envelope are already authorized; generic T2 language must not recreate that gate.

### 3. Move video and hub extensions behind the missing still lineage

The second and third ranked work orders are downstream adapters whose stated inputs do not exist.
`video_manifest.py` remains diagnostic and non-promotable, and the reviewed native Wan run proved
assembly while failing visual quality with face distortion, colored streaks, and background warping.
Building a production wrapper before an accepted still cannot verify its central contract. Likewise,
the hub can display accepted lineage only after that lineage exists.

Rank the work as: reference result -> variation pilot -> curated dataset -> train/test/select ->
held-out stills -> video adapter -> hub projection. Video and hub schema fixtures can be prepared in
parallel, but they are not critical-path completion and must not be reported as end-to-end progress.

The hub timeout item is also stale as written. The one-line `Buffer.equals` test repair already made
the exact named test pass in isolation at the original timeout. The remaining mechanical check is to
rerun the four-file 141-test batch; do not describe another implementation fix unless that rerun
reproduces a behavioral failure.

## Current cloud-bootstrap evidence boundary

The original dry run proved manifest parsing, local upload expansion, job substitution, output-count
handling, and teardown flow. It could not prove public Git behavior inside Linux or Windows access
between the sandbox account and the actual launcher account.

Live v1 exposed the first gap before reference upload: `git clone --branch <40-hex commit>` failed and
the harness's default `codeload/.../refs/tags/<commit>` fallback returned 404. The v2 manifest-only
repair supplies the commit archive URL explicitly. Static bootstrap rendering proves that the harness
will retain the exact commit/model/graph pins, exhaust the known Git attempt, then fetch and install
the exact-SHA archive. A public HEAD returned 200 `application/x-gzip`; the downloaded archive's sole
top-level directory is named with the complete commit SHA. This is strong source-selection evidence,
but the active live receipt remains the proof of Linux installation and node availability.

Preparation also exposed a local Windows boundary that dry-run did not model: `mkdir(mode=0o700)` was
performed by `MSI\CodexSandboxOffline`, so the real `MSI\danie` launcher could not read the payload.
Preparing the same immutable bytes under the launcher identity is the correct local correction. Future
preparation must either run as the consuming Windows identity or use an explicit Windows ACL contract;
POSIX mode bits alone are not a portable cross-account access policy. This is not an asset-permission
issue and should not trigger another approval request.

## Bounded next action by outcome

If cloud startup fails again before inference, classify the exact bootstrap or Comfy node error from
the teardown-verified receipt and make at most one narrow manifest/bootstrap correction using the same
model, graph, asset, two seeds, 60-minute limit, and $1.30 ceiling. Do not restart the local RAM wait,
create a background LLM daemon, or change several variables together.

If startup succeeds but identity quality fails, the best next experiment is one two-seed,
single-variable OmniGen2 repair that increases reference face-pixel density with a deterministic,
hash-bound crop of `g01`, while preserving the model, graph wiring, prompt, sampler, and budget shape.
The canonical-seed audit already shows low face coverage in the landscape source, so this has a stated
mechanism. If that repaired pair also fails, stop the OmniGen2 branch for this delivery window and
record the negative result; do not spend the night cycling prompts.

If at least one output meets the research rubric, build the six-row variation pilot described above.
Its machine-verifiable completion is a teardown-verified receipt with six expected files, exact
manifest/asset hashes, and a review packet. Whether those images preserve the intended identity,
adult-about-21 read, realism, and clothing remains a visual judgment. No test, hash, receipt, cosine,
or VLM score can promise that outcome.

## What can finish tonight

Mechanical work can finish tonight: classify the active receipt; freeze and test the six-row pilot
manifest or the one-variable crop repair; validate receipt-to-curation lineage; rerun the repaired hub
batch; and prepare video/hub fixtures that explicitly remain blocked on accepted still lineage.

Identity quality cannot be scheduled or claimed in advance. A production dataset, selected checkpoint,
held-out still set, and production video exist only if successive full-resolution outputs pass the
user's criterion. The plan should present those as contingent outcomes, not overnight deliverables.
