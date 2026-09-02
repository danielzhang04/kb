# RunPod bake-off harness

`runpod_run.py` creates one bounded RunPod Pod, installs and starts ComfyUI, runs an
API-format workflow for each job, verifies every downloaded image, then terminates the Pod
and verifies its absence. `--dry-run` exercises the same local flow without network access or
billable compute.

## Requirements and credential boundary

- Python 3.12, `requests` for live commands, and `pytest` for tests.
- OpenSSH `ssh` and `scp` on `PATH` for a live run.
- A public SSH key already configured in RunPod. The harness never reads a private key.
- `RUNPOD_API_KEY` in the harness process environment for live commands.

The API key is read once into a `requests.Session` authorization header. Log records, command
errors, the last-resort `sys.excepthook`, `run.json`, and SSH/SCP diagnostics are redacted.
Every SSH, SCP, and tunnel child receives an explicit environment with `RUNPOD_API_KEY`
removed, so SSH client configuration cannot forward it.

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
- optional `readiness_timeout_seconds` (default 900); when `max_minutes` is present it
  must be at least readiness time plus five teardown minutes;
- `comfyui.git_ref` and a `comfyui.root` below `volume_mount_path` (the root defaults to
  `/workspace/ComfyUI` and may not equal the mount itself);
- public Hugging Face `models` with `repo_id`, `filename`, and absolute `destination_dir`;
- optional public-HTTPS `custom_nodes`;
- a ComfyUI API-format `workflow` object or JSON path;
- optional `seed_fields`, a non-empty list of workflow input names to receive every job's
  `seed` (defaults to `["seed", "noise_seed"]`);
- `jobs` with `seed`, safe `output_name`, substitutions, and `expected_images` (default 1).

At least one workflow node must contain one configured seed field. The harness writes the
job seed to every matching node before applying that job's explicit substitutions, so an
explicit substitution can deliberately override the automatic value.

The example uses a PyTorch image that does not contain ComfyUI. Bootstrap first checks
Python, Git, and curl and exits before downloads if a prerequisite is missing. The harness is
the sole owner of the ComfyUI install: it fetches and checks out `comfyui.git_ref` in an
existing Git checkout, or clones that ref when the root is absent, then installs
`requirements.txt`. An existing non-Git root fails before model downloads unless the manifest
explicitly sets `comfyui.replace_non_git_root: true`; only that opt-in permits removal and
replacement of the nested root. Existing non-empty model files are reused. A failed ComfyUI
install, dependency install, model download, or start is fatal and short-circuits later
bootstrap steps, so the enclosing lease immediately terminates and verifies the Pod.

ComfyUI history entries with `completed: false` are treated as work in progress. Only
`status_str: error`, timeout, or a completed job with zero output images is a job failure.
Preview and temporary images are ignored. Before any SCP, the returned output-image count
must equal the job's `expected_images`; after SCP, every file must exist and have non-zero
size. Failed SCP stderr is logged through the redactor.

## Spend ceilings

A live `run` requires `--max-usd`. Before create, the harness computes the manifest estimate,
reads `governance/budget.yaml` `daily_usd_limit`, sums the `usd` column in today's
cost ledgers, and refuses when existing spend plus the estimate exceeds the daily limit.
Files without a `usd` column are skipped with a warning; malformed values in a declared
`usd` column still fail closed. The ledger directory is selected in this order:
`--ledger-dir`, `KB_LEDGER_DIR`,
`C:/Users/danie/kb-worktrees/dashboard-ops/ledgers/cost` when that directory exists, then the
repo's `ledgers/cost`. The selected path is logged. `governance/budget.yaml` always comes from
the harness repo root. `max_minutes` is the minimum of the CLI value, manifest value, and the hard
`DEFAULT_MAX_MINUTES` of 60; a manifest can only lower the ceiling.

Pod readiness is separately bounded by `readiness_timeout_seconds` (default 900 seconds).
Manifest preflight rejects a `max_minutes` value shorter than the readiness budget plus a
five-minute teardown margin. This keeps the readiness wait from consuming the time reserved
for the mandatory terminate-and-verify path.

The manifest rate is never trusted after create. Once the Pod is READY, its
`adjustedCostPerHr` or `costPerHr` must be present and positive. That real rate is checked
against both `--max-usd` and the daily limit. A missing, zero, invalid, or over-budget rate
causes immediate terminate-and-verify.

At Pod acquisition, the cost ledger receives a provisional row with model
`runpod:<gpu-short-name>`, step `pod-create <id>`, and the preflight estimate. Verified
teardown replaces that same row with elapsed cost at the READY rate. An unverified teardown
keeps at least the provisional estimate. Dry-run rows remain under
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
py -3 runpod_run.py status
py -3 runpod_run.py probe
py -3 runpod_run.py terminate --pod-id POD_ID
```

`probe` is read-only: it makes only `GET /pods?includeMachine=true` and prints response keys,
type placeholders, and status values. It suppresses IDs, IPs, ports, prices, names, and other
values so an operator can compare a live account's response shape without creating a Pod.

## Readiness schema and diagnostics

The current REST [get-Pod](https://docs.runpod.io/api-reference/pods/GET/pods/podId) and
[list-Pods](https://docs.runpod.io/api-reference/pods/GET/pods) schemas expose
`desiredStatus`, `lastStatusChange`, top-level `publicIp`, top-level `portMappings` (for
example `{"22": 10341}`), `machineId`, and optional `machine`. They do not document a
separate current status or a `runtime` object. Both endpoints accept `includeMachine=true`;
`includeNetworkVolume=true` is only needed for attached-volume details, so the harness does
not request it. The harness requests machine data on both GET paths.

For compatibility with the separately documented RunPod
[GraphQL Pod schema](https://docs.runpod.io/sdks/graphql/manage-pods), readiness also accepts
`runtime.ports[]` entries containing `ip`, `privatePort`, `publicPort`, and `type`; the SSH
entry must be TCP private port 22. A Pod is ready only when `desiredStatus == "RUNNING"` and
one complete SSH mapping exists. The ready log line says `schema=rest` or `schema=runtime`.

Every readiness poll logs one line with elapsed time, desired/current/runtime status when
present, `lastStatusChange`, public-IP and SSH-mapping presence, machine GPU/host fields when
present, and the detected response shape. On timeout it logs the last full Pod object through
the credential redactor, stores the same redacted object in `run.json` as `last_pod_state`,
and raises a classified message such as image pull in progress, never left CREATED/PENDING,
or RUNNING without a public IP/port mapping.

## Network and output layout

Only `22/tcp` is exposed. Bootstrap uses `ssh -p`, downloads use `scp -P`, and ComfyUI stays
on the Pod loopback interface behind `ssh -L`. Tunnel stderr is continuously drained at
OpenSSH `LogLevel=ERROR`, and both tunnel startup failure paths kill or reap the child.

The output directory contains `run.json`, verified images, and `manifest.json` for the figment
QA tools. SSH host-key state is isolated under `<out>/_harness/.runpod_known_hosts`, outside
the flat deliverable image set.

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

The test suite covers all reviewed lifecycle, spend, watchdog, signal, credential, bootstrap,
ComfyUI history, image-count, subprocess, ledger, YAML, and SSH flag regressions.
