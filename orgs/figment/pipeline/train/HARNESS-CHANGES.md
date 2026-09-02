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
