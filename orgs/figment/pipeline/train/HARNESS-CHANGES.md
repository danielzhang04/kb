# Harness changes required for training transport

The current harness cannot execute `train-pod.manifest.template.yaml`: it ignores
`uploads`, cannot materialize the wrapper start script, accepts only image artifacts,
and advances to jobs immediately after readiness. Implement the schema and ordering below
in `pipeline/pod/runpod_run.py`; this document is a work order, not executable behavior.

## Exact manifest contract

1. `uploads` is an optional list of `{files, subfolder, type, overwrite}` objects. Expand
   each local file/glob relative to the manifest, sort paths, reject empty matches,
   directories, duplicate remote names, traversal, absolute remote subfolders, and any
   `type` other than `input`. Local paths remain read-only.
2. After ordinary ComfyUI readiness and before any job submission, upload every expanded
   file in list order with multipart field `image` to `POST /upload/image`; send form fields
   `subfolder`, `type=input`, and `overwrite=true|false`. Require HTTP 2xx and a JSON response
   whose `name`, `subfolder`, and `type` match the request. Never send the RunPod API header
   to the proxy. The `_dataset.ready` entry must be last.
3. A local `training.start_script_file` is rendered and written mode `0700` to the absolute
   `training.start_script_path` during bootstrap before `comfyui.start_command` runs. Both
   paths must remain below their respective manifest/volume roots; reject NULs and path
   traversal. The existing launch-argument checks still apply.
4. When `artifacts` is present, do not submit compatibility jobs. Poll `wait_for` through
   `/view?filename=<marker>&type=output`; fail immediately if `training.failed_marker`
   appears, and obey the existing job/watchdog/lease deadline. After the marker, stream each
   declared remote output to its local name atomically and accept only `.safetensors`,
   `.json`, `.txt`, or `.log` with a positive byte count.
5. Preserve termination-and-absence verification on upload, training, polling, download,
   timeout, interrupt, and parse failures. Redact local path errors and proxy bodies through
   the existing redactor, and record upload/artifact outcomes without file contents.

## Required tests

- Manifest validation rejects malformed lists, unsafe subfolders, empty globs, duplicate
  remote names, non-input types, unsafe script paths, and unsupported artifact suffixes.
- A fake proxy asserts exact multipart file bytes and fields, stable upload order, no
  authorization header, and that all uploads occur after readiness but before artifact wait.
- Marker-last behavior is tested with PNG/TXT/config pairs; HTTP errors, mismatched response
  JSON, `_training.failed`, and timeout all fail closed.
- Artifact tests cover delayed completion, atomic positive-size safetensors download,
  missing/zero-byte output, traversal, and preservation of the current image-job path when
  neither `uploads` nor `artifacts` is present.
- Every injected failure asserts the Pod lease still performs terminate plus verified
  absence, matching the existing exit-path matrix.

## Addendum — the artifact budget blocks multi-checkpoint training (tensor track)

Found while porting 10sorLabs module 11 (`TENSOR-TRAINING.md`). Two implemented
behaviours make a long training run and a checkpoint ladder mutually exclusive.

1. `minimum_runtime_minutes` reserves `job_timeout_seconds x len(artifacts)`, but the
   runtime marker wait is one shared `per_job_timeout` and each download is bounded by
   the same value. A 3-hour marker wait with 13 declared checkpoints demands
   `13 x 180 + readiness + 5` minutes of ceiling — far past `DEFAULT_MAX_MINUTES` of
   840, and past the `$10.00` daily budget at any GPU rate. Reserve
   `job_timeout_seconds + (len(artifacts) - 1) x artifact_download_timeout_seconds`
   instead, with the download timeout its own manifest key defaulting to a few minutes.
   Until then the tensor track ships one artifact and persists the ladder on a network
   volume, which is a paid dependency the harness should not be forcing.
2. `DryRunComfyClient.wait_outputs` always returns exactly one output image, so any
   manifest declaring `expected_images > 1` fails `--dry-run` on the download-count
   check even though it is correct for a live run. Return `expected_images` synthetic
   entries for the job under test. Until then every tensor-track workflow is limited to
   a single `SaveImage`, which cost module 09's `image_base`/`image_upscaled` outputs
   and forced module 11's 12-branch graph to become 12 one-image jobs.

Both are preflight/simulation artefacts, not safety properties: neither change weakens
the spend ceiling, the shared runtime deadline, or terminate-and-verify.

## Required tests for the addendum

- The reserved minimum for N artifacts equals one job timeout plus N-1 download
  timeouts, and a manifest whose `max_minutes` covers exactly that is accepted.
- A dry run of a manifest with `expected_images: 3` verifies three downloaded files and
  still fails when the workflow declares a count the client is asked to exceed.
