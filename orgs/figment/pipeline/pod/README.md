# RunPod bake-off harness

`runpod_run.py` creates one bounded RunPod Pod, installs and starts ComfyUI, runs an
API-format workflow for each job, verifies every downloaded image, then terminates the Pod
and verifies its absence. `--dry-run` exercises the same local flow without network access or
billable compute. Dry-run substitutes inert values for unresolved `.template.yaml`
placeholders and simulates absent upload patterns as zero-byte rows; live preflight still
requires every upload to exist and every template to be rendered. The dry-run ComfyUI stub
returns one synthetic placeholder image per job's declared `expected_images` (not always
exactly one), so a job with `expected_images > 1` still passes the same download-count check a
live run enforces.

## Requirements and credential boundary

- Python 3.12, `requests` for live commands, and `pytest` for tests.
- `RUNPOD_API_KEY` in the harness process environment for live commands.

The API key is read once into the RunPod REST `requests.Session` authorization header. It is
never copied into the Pod payload, bootstrap environment, bootstrap script, output files, or
the separate ComfyUI proxy session. Log records, REST errors, the last-resort
`sys.excepthook`, and `run.json` are redacted. The public proxy client rejects any session
that carries an `Authorization` header.

A gated Hugging Face download (a private or access-gated model repo) can authenticate the
same way, without the harness ever holding that token either. An optional manifest
`env_secret_refs` mapping (pod env var name -> RunPod secret NAME, e.g.
`{HF_TOKEN: HF_TOKEN}`) is validated during preflight: both the env var name and the secret
NAME must match `[A-Z][A-Z0-9_]*`, and any value that looks like a pasted token rather than a
secret's NAME (contains `hf_`, contains whitespace, or is longer than 64 characters) is
refused. The create payload then carries only the RunPod reference string
`{{ RUNPOD_SECRET_<name> }}` for that env var; RunPod itself substitutes the encrypted
secret's value into the Pod's container environment at start time, so this harness process
never reads it. When bootstrap finds `HF_TOKEN` set in that environment, every model download
adds it as `-H "Authorization: Bearer $HF_TOKEN"` — the shell expands the variable straight
into curl's argv, so the value is never echoed, `printf`'d, or written to `_bootstrap.log`.
Bootstrap unconditionally `unset`s `HF_TOKEN` once model downloads finish and before ComfyUI
starts. The redactor additionally strips the literal `HF_TOKEN` name and any
`{{ RUNPOD_SECRET_` reference string from logs and `run.json`, even though the reference
string itself carries no secret value.

Install the two Python packages if needed:

```powershell
py -3 -m pip install requests pytest
```

## Manifest and bootstrap

Start from `manifest.example.yaml`. The parser accepts JSON or the small YAML subset used by
that file. Required fields are:

- `gpu.type`, with optional `gpu.count` and `gpu.cloud`;
- `image` or `template_id`, plus optional `network_volume_id`;
- a conservative `price_usd_per_hour` for pre-create estimation;
- optional `readiness_timeout_seconds` (default 900) and `job_timeout_seconds` (default
  900); `max_minutes` must cover readiness, five teardown minutes, and the job timeout
  multiplied by all jobs — or, in artifact mode, one job timeout for the completion-marker
  wait plus one `artifact_download_seconds` allowance for every artifact after the first;
- optional `artifact_download_seconds` (default 180, must be finite and positive), the
  budget each artifact after the first gets for its own marker poll plus download once the
  first artifact has already spent the shared job timeout;
- optional `avoid_machine_hosts` and `avoid_machine_ids` string lists, plus
  `max_placement_attempts` (default 4), for rejecting known-bad RunPod placements;
- `comfyui.git_ref` and a `comfyui.root` below `volume_mount_path` (the root defaults to
  `/workspace/ComfyUI` and may not equal the mount itself), with optional public-HTTPS
  `comfyui.source_url` and `comfyui.tarball_url` overrides, and optional
  `comfyui.extra_args` appended to the ComfyUI launch command;
- public Hugging Face `models` with `repo_id`, `filename`, and absolute `destination_dir`;
- optional `env_secret_refs`, a mapping of pod env var name -> RunPod secret NAME (both
  `[A-Z][A-Z0-9_]*`) for gated Hugging Face downloads via a RunPod Secret the harness never
  sees — see the credential boundary above;
- optional public-HTTPS `custom_nodes`;
- a ComfyUI API-format `workflow` object or JSON path;
- optional `seed_fields`, a non-empty list of workflow input names to receive every job's
  `seed` (defaults to `["seed", "noise_seed"]`);
- `jobs` with `seed`, safe `output_name`, substitutions, and `expected_images` (default 1);
- optional `uploads`, a non-empty list of input-file groups described below;
- optional `training`, which materializes a local wrapper script below the volume root; and
- optional `artifacts`, which replaces compatibility-job submission with completion-marker
  polling and non-image output downloads.

At least one workflow node must contain one configured seed field. The harness writes the
job seed to every matching node before applying that job's explicit substitutions, so an
explicit substitution can deliberately override the automatic value.

The example uses a PyTorch image that does not contain ComfyUI. Bootstrap first checks
Python, Git, curl, a non-empty `nvidia-smi -L`, and `torch.cuda.is_available()` and exits
before installs or model downloads if a prerequisite is missing. Before its first network step
it waits up to 90 seconds for DNS resolution of both GitHub and Hugging Face,
logging every wait. Git clone/fetch, every `pip install`, and every model download each retry up
to three times, with 15-second then 30-second backoff and an rc record for every attempt. The
harness is the sole owner of the ComfyUI install: it fetches and checks out `comfyui.git_ref` in
an existing Git checkout, or clones that ref when the root is absent. If all three Git attempts
fail, it downloads the tag tarball from codeload (or `comfyui.tarball_url`), extracts it in a
temporary directory, moves it into `comfyui.root` without `.git`, and writes a
`.figment-tarball-<ref>` marker. A later run reuses a root carrying that marker. The winning
Git, tarball, or marker path is logged before `requirements.txt` is installed. A 120-second
ComfyUI import smoke (`comfy.model_management`, `comfy.utils`) then runs before the first model
download. An existing
non-Git root without the marker fails before model downloads unless the manifest explicitly
sets `comfyui.replace_non_git_root: true`; only that opt-in permits removal and replacement of
the nested root. Existing non-empty model files are reused. A failed ComfyUI install,
dependency install, model download, or start is fatal and short-circuits later bootstrap
steps. `comfyui.start_command` is the launch executable only; the harness supplies
`--listen 0.0.0.0 --port 8188 --output-directory /workspace/output` and rejects manifests
that try to override those transport/output arguments.

Immediately after each create, the harness performs a machine-aware Pod GET. A matching
machine host or machine id is terminated and verified absent before recreation. Every rejected
Pod retains its own provisional ledger row, settled to elapsed time at the manifest ceiling
rate. A later definite create refusal does not rewrite that settled row or create a zero-cost
row. If every placement attempt is rejected, the run fails closed with no Pod left running.
Network-class bootstrap failures, plus GPU/Torch preflight, ComfyUI import-smoke, and
ComfyUI health failures, learn the current machine host in both
`<out>/_harness/bad_hosts.json` and `%LOCALAPPDATA%/kb-figment-pod/bad_hosts.json`; session
entries are merged into the next run's host denylist and expire after 24 hours.
Learning signatures include Git rc 128, Git username challenges, DNS-resolution failures,
curl rc 6/7/28/35, and Hugging Face HTTP 403/429 responses.

An `uploads` entry has `files`, `subfolder`, `type: input`, and boolean `overwrite` fields.
`files` is a non-empty list of local files or globs relative to the manifest directory.
Matches are sorted within each list item and uploaded in manifest order. Empty matches,
directories, paths outside the manifest directory, non-identifier subfolders, and duplicate
`(subfolder, name)` destinations are rejected during preflight. Allowed suffixes are `.png`,
`.jpg`, `.jpeg`, `.webp`, `.txt`, `.toml`, `.json`, `.safetensors`, and `.ready`; each file is
capped at 2 GiB and the batch at 10 GiB. Non-marker files must be non-empty. The file count and
total bytes are logged before create. If `_dataset.ready` is present, it must be the final
expanded upload and share the dataset's single subfolder. `overwrite: true` is recommended;
false logs a preflight warning and a ComfyUI collision rename fails with a specific error.
After readiness and the READY-price checks, each file is sent as multipart field `image` to
`POST /upload/image` with form fields `subfolder`, `type=input`, and lowercase
`overwrite=true|false`. Transient upload failures get three total attempts with 15/30-second
backoff. The response must be HTTP 2xx JSON whose `name`, `subfolder`, and `type` exactly match
the request. The proxy client carries no RunPod authorization header and local upload files
are only opened for reading.

When `training` is present, `start_script_file` must be a file below the manifest directory
and `start_script_path` must be an absolute child of `volume_mount_path`. The harness renders
`{{name}}` placeholders from scalar manifest and training values, embeds the result in
bootstrap, writes it at the requested volume path with mode `0700`, and only then runs
`comfyui.start_command`. Trigger and Git-ref identifiers are restricted to
`[A-Za-z0-9_.-]+`; every other rendered scalar is shell-quoted. NULs, traversal, missing
files, and unresolved placeholders fail preflight. The shipped training launcher removes
stale `_training.complete` and `_training.failed` markers before launch.

When `artifacts` is present, the normal `jobs` remain compatibility and preflight data but
are not submitted. Each artifact declares `remote`, `type: output`, `local`, and `wait_for`.
When `training.complete_marker` is declared, every `wait_for` must name that same marker.
The harness checks `training.failed_marker` before every completion-marker poll through
`GET /view`; 502/503/504 and connection/timeout errors retry within one shared artifact-marker
deadline, while a failure marker, persistent error, other status, timeout, or watchdog expiry
is fatal. Nested marker and artifact names are split into `/view` `filename` and `subfolder`
parameters. Once the marker is visible, the artifact download gets three total attempts and is
streamed to a sibling `.partial` file. A present `Content-Length` must equal bytes received;
without it, the extension-specific minimum is logged and enforced (1 KiB for safetensors).
An optional 64-hex `sha256` is verified when supplied. Only then is the file atomically moved
into place. Remote and local names must use the same `.safetensors`, `.json`, `.txt`, or `.log`
suffix and may not be absolute or traverse directories.

The shared artifact-marker deadline holds exactly one `job_timeout_seconds` budget for
confirming the training completion marker (or the first distinct `wait_for` marker, if artifacts
declare their own), no matter how many artifacts are declared — it is not multiplied by artifact
count. Every artifact after the first downloads under its own much smaller
`artifact_download_seconds` allowance (optional manifest key, default 180 seconds, must be
finite and positive) instead of borrowing the full job timeout again. This is what lets a
multi-hour marker wait and a multi-checkpoint ladder both fit under `DEFAULT_MAX_MINUTES`; see
`pipeline/train/HARNESS-CHANGES.md` for the defect this replaced.

The create payload carries the base64-encoded script in the string-valued
`env.FIGMENT_BOOTSTRAP_B64` field. `dockerEntrypoint: ["bash", "-lc"]` and
`dockerStartCmd` decode it to `/workspace/bootstrap.sh` and execute it as the container start
command. RunPod's official [create-Pod reference](https://docs.runpod.io/api-reference/pods/POST/pods)
and live [OpenAPI schema](https://rest.runpod.io/v1/openapi.json) define
`dockerEntrypoint` and `dockerStartCmd` as string arrays, `env` as an object, and `ports` as
`[port]/[protocol]` strings.

Every bootstrap command appends a `STEP <label> rc=<code>` line to
`/workspace/output/_bootstrap.log`. A fatal step writes its reason to
`/workspace/output/_bootstrap.failed`, starts a temporary diagnostics endpoint when Python
is available, keeps the container alive for 60 seconds so the harness can fetch both files,
then exits nonzero. After successful health, the bootstrap process waits on ComfyUI so the
container remains alive. The enclosing lease terminates and verifies the Pod on any detected
failure.

ComfyUI history entries with `completed: false` are treated as work in progress. Only
`status_str: error`, timeout, or a completed job with zero output images is a job failure.
Preview and temporary images are ignored. Before any download, the returned output-image
count must equal the job's `expected_images`. Each image is streamed from `/view` to a local
temporary file, atomically moved into place, and verified to exist with non-zero size.

## Spend ceilings

A live `run` requires `--max-usd`. Before create, the harness computes the manifest estimate,
reads `governance/budget.yaml` `daily_usd_limit`, sums the `usd` column in today's
cost ledgers, and refuses when existing spend plus the estimate exceeds the daily limit.
It also applies the independent whole-arc cap: `--arc-cap-usd` defaults from
`KB_ARC_CAP_USD`, otherwise `$50.00`, and sums every `figment-*.tsv` in the selected ledger
directory (override with `--arc-ledger-glob`). Files without a `usd` column are skipped with a
warning; malformed values in a declared `usd` column still fail closed. The ledger directory is selected in this order:
`--ledger-dir`, `KB_LEDGER_DIR`,
`C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost` when that directory exists, then the
repo's `ledgers/cost`. The selected path is logged. `governance/budget.yaml` always comes from
the harness repo root. `max_minutes` is the minimum of the CLI value, manifest value, and the hard
`DEFAULT_MAX_MINUTES` of 840; a manifest can only lower the ceiling.

Pod readiness is separately bounded by `readiness_timeout_seconds` (default 900 seconds).
Manifest preflight rejects a `max_minutes` value shorter than the applicable minimum:

- Job (non-artifact) mode: `readiness_timeout_seconds + job_timeout_seconds x len(jobs) +
  300` seconds.
- Artifact mode: `readiness_timeout_seconds + job_timeout_seconds + (len(artifacts) - 1) x
  artifact_download_seconds + 300` seconds — one shared job timeout for the completion-marker
  wait, plus one `artifact_download_seconds` allowance (default 180 s) for every artifact after
  the first, plus the same five-minute teardown margin.

Artifact marker polls share one runtime deadline built from `job_timeout_seconds`, exactly as
preflight reserves. This keeps work from consuming the time reserved for the mandatory
terminate-and-verify path.

The manifest rate is never trusted after create. Once the Pod is READY, its
`adjustedCostPerHr` or `costPerHr` must be present and positive. That real rate is checked
against `--max-usd`, the daily limit, and the arc cap. A missing, zero, invalid, or over-budget rate
causes immediate terminate-and-verify.

At Pod acquisition, the cost ledger receives a provisional row with model
`runpod:<gpu-short-name>`, step `pod-create <id>`, and the preflight estimate. Verified
teardown replaces that same row with elapsed cost at the READY rate. If the run exits before a
READY price is available, the final ledger value is elapsed seconds times the manifest hourly
ceiling rate; `run.json` labels this a `ceiling-rate estimate`. An unverified teardown after a
READY price keeps at least the provisional estimate. Dry-run rows remain under
`<out>/dry-run-ledger/` at zero USD unless `--ledger-dir` is explicitly supplied. Ledger
upserts use an exclusive bounded lock and a unique atomic-replace temporary file.

## Commands

Offline smoke test:

```powershell
py -3 runpod_run.py run --manifest manifest.example.yaml --dry-run --out .\smoke-out --max-minutes 1
```

For a live run, keep the key in a one-line file outside the repository and read it without
typing the secret into PowerShell history:

```powershell
$env:RUNPOD_API_KEY = (Get-Content -Raw 'C:\secure\runpod-api-key.txt').Trim()
try {
  py -3 runpod_run.py run --manifest manifest.yaml --out .\run-001 --max-usd 0.30 --max-minutes 20 --ledger-dir C:\Users\danie\kb-worktrees\dashboard-ops\ledgers\cost
} finally {
  Remove-Item Env:RUNPOD_API_KEY -ErrorAction SilentlyContinue
}
```

List Pods or force verified termination:

```powershell
py -3 runpod_run.py status --arc-cap-usd 50 --arc-ledger-glob 'figment-*.tsv'
py -3 runpod_run.py probe
py -3 runpod_run.py terminate --pod-id POD_ID
```

`probe` is read-only: it makes only `GET /pods?includeMachine=true` and prints response keys,
type placeholders, and status values. It suppresses IDs, IPs, ports, prices, names, and other
values so an operator can compare a live account's response shape without creating a Pod.

## Readiness and bootstrap diagnostics

The current REST [get-Pod](https://docs.runpod.io/api-reference/pods/GET/pods/podId) schema
exposes `desiredStatus`, `lastStatusChange`, `machineId`, and optional `machine`. Readiness
requires both `desiredStatus == "RUNNING"` and an HTTP 200 from proxy
`GET /system_stats`; a RUNNING control-plane state alone is not sufficient. The official
[port-exposure guide](https://docs.runpod.io/pods/configuration/expose-ports) documents the
`https://[POD_ID]-[INTERNAL_PORT].proxy.runpod.net` URL, warns that a RUNNING Pod's service
may still be starting, and requires the service to bind `0.0.0.0`.

Every readiness poll logs elapsed time, desired/current/runtime status when present,
`lastStatusChange`, the proxy status code (or sanitized exception type), and machine GPU/host
fields when present. Every fifth poll also requests
`/view?filename=_bootstrap.log&type=output` and logs the last 20 lines. Each RUNNING poll
checks `_bootstrap.failed`; when present, the harness fetches and logs the redacted last 40
bootstrap-log lines before raising, stores the redacted last 10 as `bootstrap_log_tail` in
`run.json`, then the lease terminates the Pod and verifies absence. A failed log fetch is logged
explicitly. On timeout the harness logs the last full
Pod object through the credential redactor, stores the same redacted object in `run.json` as
`last_pod_state`, and classifies image-pull, pending, or proxy-not-ready state.

## Network and output layout

Only `8188/http` is exposed. Jobs use the same proxy origin for `POST /prompt`,
`GET /history/{prompt_id}`, and streaming `GET /view` downloads. The RunPod
[port-exposure guide](https://docs.runpod.io/pods/configuration/expose-ports) says HTTP proxy
services are publicly accessible and advises applications to implement their own
authentication. Neither that guide nor the create-Pod/OpenAPI schema documents a way to
require the account API key on proxy requests, so this ComfyUI endpoint is unauthenticated:
anyone who knows the Pod ID can reach it for the Pod's lifetime. The harness mitigates that
exposure with short wall-clock limits and terminate-plus-absence-verification on every exit.
It deliberately sends no `RUNPOD_API_KEY` header to the proxy.

The output directory contains `run.json`, verified images and `manifest.json` for the figment
QA tools, or verified training artifacts. `run.json` records upload and artifact names,
destinations, byte counts, and marker outcomes, never file contents. Bootstrap diagnostics
remain in the Pod's `/workspace/output` directory and are available through ComfyUI `/view`
while the Pod is alive.

## Exit-path guarantee

`PodLease` registers its atexit cleanup before the create request. If create times out,
returns a proxy error or bad JSON, or omits the ID after RunPod created the Pod, teardown
recovers matching Pods by the request's unique name and, when provided by RunPod, a creation
timestamp no older than this run. Missing creation timestamps are logged before proceeding on
the exact name alone. Failed or empty list calls are retried by the same five-attempt close
path. An empty name scan never proves absence: only a 404 for a known Pod ID can mark teardown
verified.

The watchdog's wall-clock budget begins at the create call. It independently invokes the
same idempotent close path, and finalization waits for its full delete/verify/backoff budget
before reading the lease verdict under the lease lock. SIGINT and SIGTERM become flag-only
for the duration of `close()`, so all five teardown attempts remain available.

Close treats only `GET /pods/{id}` returning 404 as verified absence; a successful DELETE or
an empty name scan alone is not proof. Final ledger/JSON write failures are reported as
secondary errors and cannot replace an earlier teardown failure. On every unverified exit,
the CLI prints an ID-specific terminate command when the ID is known, or a `status` recovery
command when only the name is known:

```text
POD STILL RUNNING <id> — run: terminate --pod-id <id>
```

The atexit path also writes `POD STILL RUNNING <id>` directly to stderr in addition to a
critical log record, because logging may already be shutting down.

## Verification

```powershell
py -3 -m pytest orgs/figment/pipeline/pod/tests -q
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/pod/manifest.example.yaml --dry-run --out <tmp>
```

The pod tests default `PYTEST_DEBUG_TEMPROOT` to a dedicated directory below the OS temp
root, while honoring an explicit environment override, so plain pytest does not create or
reuse scratch state inside the repository.

The test suite covers all reviewed lifecycle, spend, watchdog, signal, credential, bootstrap,
proxy readiness/diagnostics, ComfyUI history, streamed download, image-count, ledger, and YAML
regressions.
