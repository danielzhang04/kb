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
- public Hugging Face `models` with `repo_id`, `filename`, and absolute `destination_dir`;
- optional public-HTTPS `custom_nodes`;
- a ComfyUI API-format `workflow` object or JSON path;
- `jobs` with `seed`, safe `output_name`, substitutions, and `expected_images` (default 1).

The example uses a PyTorch image that does not contain ComfyUI. Bootstrap first checks
Python, Git, and curl and exits before downloads if a prerequisite is missing. It then clones
`https://github.com/comfyanonymous/ComfyUI` at pinned tag `v0.3.76` and installs its
`requirements.txt`. Existing tagged checkouts and non-empty model files are reused. A failed
ComfyUI install, dependency install, or model download is fatal, so the enclosing lease
immediately terminates and verifies the Pod.

ComfyUI history entries with `completed: false` are treated as work in progress. Only
`status_str: error`, timeout, or a completed job with zero images is a job failure. Before any
SCP, the returned image count must equal the job's `expected_images`; after SCP, every file
must exist and have non-zero size. Failed SCP stderr is logged through the redactor.

## Spend ceilings

A live `run` requires `--max-usd`. Before create, the harness computes the manifest estimate,
reads `governance/budget.yaml` `daily_usd_limit`, sums the `usd` column in today's
`ledgers/cost/*.tsv`, and refuses when existing spend plus the estimate exceeds the daily
limit. `max_minutes` is the minimum of the CLI value, manifest value, and the hard
`DEFAULT_MAX_MINUTES` of 60; a manifest can only lower the ceiling.

The manifest rate is never trusted after create. Once the Pod is READY, its
`adjustedCostPerHr` or `costPerHr` must be present and positive. That real rate is checked
against both `--max-usd` and the daily limit. A missing, zero, invalid, or over-budget rate
causes immediate terminate-and-verify.

At Pod acquisition, the cost ledger receives a provisional row with model
`runpod:<gpu-short-name>`, step `pod-create <id>`, and the preflight estimate. Verified
teardown replaces that same row with elapsed cost at the READY rate. An unverified teardown
keeps at least the provisional estimate. Dry-run rows remain under
`<out>/dry-run-ledger/` at zero USD.

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
  py -3 runpod_run.py run --manifest manifest.yaml --out .\run-001 --max-usd 0.30 --max-minutes 20
} finally {
  Remove-Item Env:RUNPOD_API_KEY -ErrorAction SilentlyContinue
}
```

List Pods or force verified termination:

```powershell
py -3 runpod_run.py status
py -3 runpod_run.py terminate --pod-id POD_ID
```

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
recovers every matching Pod by the request's unique name, terminates it, and verifies absence.
Failed list calls are retried by the same five-attempt close path.

The watchdog's wall-clock budget begins at the create call. It independently invokes the
same idempotent close path, and finalization waits for its full delete/verify/backoff budget
before reading the lease verdict under the lease lock. SIGINT and SIGTERM become flag-only
for the duration of `close()`, so all five teardown attempts remain available.

Close treats only `GET /pods/{id}` returning 404 (or a completed name-recovery sweep with no
match) as verified absence; a successful DELETE alone is not proof. On every unverified exit,
the CLI prints:

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
