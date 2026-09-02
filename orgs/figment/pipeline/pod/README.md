# RunPod bake-off harness

`runpod_run.py` provisions one bounded RunPod Pod, bootstraps a ComfyUI arm, runs an
API-format workflow for each manifest job, downloads and verifies every image, then
terminates the Pod and verifies that `GET /pods/{id}` returns 404. It never creates a Pod
in `--dry-run` mode.

## Requirements

- Python 3.12.
- `requests` for live commands and `pytest` for tests. The tests use an in-tree stub
  session, so `requests-mock` is not required.
- OpenSSH `ssh` and `scp` on `PATH` for a live run.
- A public SSH key already configured in the RunPod account. The harness does not read or
  copy private keys and invokes OpenSSH in batch mode.
- `RUNPOD_API_KEY` provisioned in the process environment for live commands. The key is
  read once into a `requests.Session` authorization header, filtered from logs, and never
  written to the manifest, `run.json`, or output files. `--dry-run` does not read it.

Install the two Python packages if the selected Python does not already have them:

```powershell
py -3 -m pip install requests pytest
```

## Manifest

Start from `manifest.example.yaml`. The parser accepts JSON or the deliberately small YAML
subset used by that file, keeping the harness within the dependency limit. The load-bearing
fields are:

- `gpu.type`, optional `gpu.count` and `gpu.cloud`;
- exactly one practical source, `image` or `template_id`;
- optional `network_volume_id`; without it, `volume_gb` creates ordinary Pod volume space;
- `price_usd_per_hour`, an operator-checked conservative rate used for preflight;
- public Hugging Face `models` (`repo_id`, `filename`, absolute `destination_dir`);
- public HTTPS `custom_nodes` Git URLs;
- a ComfyUI API-format `workflow` object or a path to a workflow JSON file;
- `jobs`, each with `seed`, safe `output_name`, and node `substitutions` (`node_id`,
  `field`, `value`). A bare field means `inputs.<field>`; a dotted field is traversed as
  written. The seed replaces every `inputs.seed` and the output name replaces every
  `inputs.filename_prefix`.

The hourly price is intentionally explicit rather than fetched with RunPod's GraphQL API:
the documented GraphQL examples put the key in the URL query string, while this harness's
credential boundary requires header-only authentication. Before a live run, compare the
manifest ceiling with RunPod's current console or GPU pricing query. The create response's
`adjustedCostPerHr`/`costPerHr` is checked again immediately; an over-budget Pod is
terminated before bootstrap.

## Commands

Offline smoke test, from this directory:

```powershell
py -3 runpod_run.py run --manifest manifest.example.yaml --dry-run --out .\smoke-out --max-usd 1 --max-minutes 1
```

The dry run exercises create/readiness/bootstrap/job/history/download/count-and-size
verification/terminate/verify using in-memory fakes and makes no network call. Its zero-cost
TSV goes under `<out>/dry-run-ledger/`, so it does not alter the live cost ledger.

Live run (creates billable compute; operator only, after approval and after replacing every
placeholder):

```powershell
$env:RUNPOD_API_KEY = '<provisioned outside the repo>'
py -3 runpod_run.py run --manifest manifest.yaml --out .\run-001 --max-usd 0.30 --max-minutes 20
```

List Pods or force verified termination:

```powershell
py -3 runpod_run.py status
py -3 runpod_run.py terminate --pod-id POD_ID
```

Live runs append exactly one `model<TAB>step<TAB>usd` row to
`ledgers/cost/figment-YYYY-MM-DD.tsv`. The output directory contains `run.json`, the images,
and `manifest.json` in the schema consumed by `qa_stamp.py`, `build_grading_board.py`, and
`blind_pool.py`.

## Network design

Only `22/tcp` is exposed. RunPod maps it to `publicIp:portMappings["22"]`. The harness uses
that mapping for bootstrap and `scp -P`; ComfyUI remains bound to the Pod's loopback
interface and is reached through `ssh -L`. This avoids placing ComfyUI's unauthenticated API
on RunPod's public HTTP proxy. It also avoids the proxy's documented 100-second request
limit; generation is asynchronous (`POST /prompt`, poll `GET /history/{prompt_id}`).

Models download directly on the Pod from public Hugging Face resolve URLs, with no token or
login. Bootstrap is idempotent: non-empty model files are reused, existing Git nodes receive
`pull --ff-only`, and ComfyUI is started only when its health endpoint is down. It never uses
`set -e`; every required and cosmetic step prints its own exit code, and cosmetic diagnostics
cannot abort a billable run.

## Exit-path guarantee

`PodLease` is the sole lifecycle owner. Once creation returns a Pod ID, it registers an
`atexit` callback. Its context-manager `finally` path covers success, bootstrap failure,
ComfyUI/job/download exceptions, and `KeyboardInterrupt`. Temporary SIGINT/SIGTERM handlers
raise into that same path. A daemon watchdog independently calls the same idempotent close
method when `--max-minutes` expires, so it does not depend on the main loop noticing a flag.

Close issues `DELETE /pods/{id}` and then `GET /pods/{id}`. A 200 response is still treated
as alive, even if its status says terminated. Delete-and-verify retries five times with
backoff. If absence cannot be proven, the process exits non-zero and emits exactly
`POD STILL RUNNING <id>` at critical severity. Ambiguous API errors also enter this teardown
loop; teardown success is never inferred from a successful DELETE alone.

## Verification

```powershell
py -3 -m pytest orgs/figment/pipeline/pod/tests -q
```

Coverage includes the mocked-HTTP happy path, mid-job exception, `KeyboardInterrupt`, the
watchdog, five failed terminate/verify attempts and loud error, over-budget preflight,
ledger format, credential redaction across logs/files, offline dry run, and an assertion that
downloads use uppercase `scp -P` rather than lowercase `-p`.

Current RunPod references checked during implementation:

- REST overview/OpenAPI: <https://docs.runpod.io/api-reference/overview>
- create/list/get/delete Pods: <https://docs.runpod.io/api-reference/pods/POST/pods>,
  <https://docs.runpod.io/api-reference/pods/GET/pods>,
  <https://docs.runpod.io/api-reference/pods/GET/pods/podId>, and
  <https://docs.runpod.io/api-reference/pods/DELETE/pods/podId>
- port mapping: <https://docs.runpod.io/pods/configuration/expose-ports>
- SSH/SCP requirements: <https://docs.runpod.io/pods/configuration/use-ssh>

