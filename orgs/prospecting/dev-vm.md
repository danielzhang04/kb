# Source-only transient development jobs

`scripts/prospecting/dev_vm.py` implements a deliberately small lifecycle: prepare a
desktop receipt, start an isolated transient job, inspect status, collect and validate
proposed files locally, then remove the exact owned resources. It never applies a
proposal to authoritative source. `dev_jobs.verify_local_base` must pass immediately
before a separate local application step.

Only source files accepted by `dev_jobs.snapshot` may enter `prepare`. Include required
skill text and references explicitly in that allowlist; a VM job does not inherit the
desktop's skills. Never stage SQLite, browser profiles, snapshot data, private notes,
credentials, process environments, or a whole checkout. The task instruction itself
must contain source-only development instructions and synthetic examples.

An example local preparation, run from the authoritative checkout after replacing the
source path with the exact intended allowlist:

```python
from pathlib import Path
from scripts.prospecting.dev_jobs import snapshot
from scripts.prospecting.dev_vm import prepare
root = Path.cwd()
paths = ["scripts/prospecting/__init__.py"]
manifest = snapshot(root, paths, paths)
prepare(root / "_private/dev-jobs/proof/receipt.json",
        {p: (root / p).read_bytes() for p in paths}, manifest=manifest,
        instruction="Synthetic lifecycle proof only.", mode="synthetic",
        deadline_seconds=120, collection_seconds=3600)
```

The receipt is written and flushed before any SSH operation. Each operation reloads
it and validates its exact schema, manifest, source hashes, caps, state, and immutable
contract digest, so a new terminal can recover after an ambiguous SSH disconnect. The
digest detects accidental contract corruption; it is not a signature or protection
against a local actor who can rewrite the receipt.

`start` runs the repository's trusted local preamble before SSH, so STOP and budget
failures prevent a new remote launch or model call. `status`, collection, failure
collection, and cleanup remain available while STOP is present because they are the
recovery path for an already-owned job:

```powershell
python -m scripts.prospecting.dev_vm start _private/dev-jobs/proof/receipt.json
python -m scripts.prospecting.dev_vm status _private/dev-jobs/proof/receipt.json
python -m scripts.prospecting.dev_vm collect _private/dev-jobs/proof/receipt.json
python -m scripts.prospecting.dev_vm cleanup _private/dev-jobs/proof/receipt.json
```

An existing owned job is not launched again only after the supervisor proves the exact
service and active lease timer belong to the receipt. A partial launch records a typed
`start-failed` recovery state; a collected or cleaned receipt cannot regress to started.
Collection is idempotent only if existing local files have identical hashes. Its sole
destination is the receipt's sibling `output` directory; if `--destination` is supplied,
it must name that exact directory and is rejected before SSH or local writes otherwise.
Cleanup requires a successful local validation, failure evidence, or a typed partial
start. A `started` receipt that missed the collection window because of a disconnected
terminal may be cleaned only when the exact same absent-root-and-all-three-units-absent
proof already trusted for an already-reclaimed lease holds for it too; any other remote
answer refuses without touching the root, the job, or any unit, so `cleanup` can never
delete a still-present owned root or discard a still-active or uncollected job on this
path. A separately armed transient timer cleans abandoned jobs after deadline plus
collection window. That lease run stops the worker, then refuses unless a successful
`systemctl show` reports the worker in an exact stopped or not-found state and its own
control group, when still present, holds no descendants. It then refuses unless the root
is a root-owned directory whose marker matches this job, unmounts and removes only that
tree, and clears that one worker unit's residual failed state so a later `cleanup` can
verify absence instead of refusing. A failed query, an unexpected state, a foreign or
populated control group, or an absent or mismatched marker each keeps the root and fails
the lease run, which deletes nothing. An already absent root is a no-op that still clears
the owned unit. The timer is armed with `RemainAfterElapse=no` so the elapsed transient
timer, and the lease service it triggers, unload themselves rather than blocking that
verification. A lease run that fails stays loaded and failed on purpose: `cleanup` then
reports `cleanup_unverified` instead of forcing removal of units it cannot prove it owns,
and an operator must inspect and `systemctl reset-failed` that lease unit. After a natural
lease the owned root is gone, so `status` fails rather than returning a typed reclaimed
code; the receipt and `cleanup` remain the recovery path.
This timer survives SSH disconnects; like other
transient systemd state, it does not promise recovery across a VM reboot. A retained
desktop receipt identifies the exact resources for recovery after reboot.

For a terminal failed or timed-out job, use `collect-failure`. Normal collection requires
the exact systemd success tuple: loaded service, `active/exited`, `Result=success`, and
`ExecMainStatus=0`. Other loaded terminal states can only use failure collection. This
records status and hashed diagnostic evidence as `failed-collected`,
accepts no patch, and permits exact-owned cleanup. It cannot label a successful job as
a failure. Local receipt, evidence, and collection paths reject symlink and Windows
reparse ancestors before directory creation or file writes.

The worker runs as `kb-shell` with 2 CPU equivalents, 2 GiB memory, no swap, 64 tasks,
a bounded runtime, a 128 MiB per-file ceiling for private runtime scratch, `ExitType=cgroup`,
and `KillMode=control-group`. The broader scratch ceiling is separate from proposed output:
the output tmpfs remains 16 MiB and collection still rejects more than 1 MiB per file or
8 MiB total. Successful jobs stay
in `active/exited` with `RemainAfterExit=yes`, preserving their exit result until cleanup.
Collection checks the service state
and its cgroup's descendant population. `/workspace` is immutable, `/output` is a
16 MiB tmpfs with at most 1024 inodes, and `/tmp` is private. The supervisor and lease
marker are outside the worker mount namespace. No host root mount, production checkout,
SSH directory, or production service tree is exposed. Synthetic jobs have no network.

Codex mode invokes the installed native CLI with a private tmpfs `CODEX_HOME` and
a read-only bind of the existing ambient runtime auth file. The ambient configuration,
databases, memories, plugins, skills, and session trees are not mounted. It uses
`--ephemeral`, `--ignore-user-config`, and `--ignore-rules`. It supplies staged source
through stdin and requests a JSON file proposal. Shell, unified execution, freeform
patch, apps, MCP servers, shell snapshots, history persistence, and web search are disabled. A permission
profile grants runtime reads and output writes inside that already narrow outer mount
namespace, and denies tool network access. No legacy `--sandbox` override is used.

The restrictive `:root=deny` profile was measured to fail before a request while loading
`AGENTS.md` because the installed CLI attempted another bwrap user namespace. With the
unchanged narrow outer bwrap and `:root=read,/output=write`, a fake loopback Responses
probe reached the provider boundary and sent an exactly empty tools array, with no config
warnings. Its intentional HTTP 400 and exit 1 prove request shape, not a successful model
job. The probe mounted no auth and made no external request.

The outer CLI needs provider network access; this implementation does not enforce a
provider destination firewall. Runtime authentication is not copied or inspected.
Read-only auth alone is **not** a credential confidentiality boundary. The first Codex
slice disables command tools because the installed CLI's nested sandbox failed its
user-namespace probe on this VM. Enabling command tools requires a separately verified
sandbox; an instruction saying not to read credentials is insufficient. Unknown CLI
feature behavior and actual provider execution must be verified on the deployed CLI
before describing Codex mode as a completed VM proof.

Transport uses bounded JSON/base64 records, never archive extraction. Collection rejects
symlinks, nonregular files, hardlinks, traversal, unexpected paths, digest mismatch, and
caps beyond 256 files / 1 MiB per file / 8 MiB total. Local source remains authoritative.
Job stdout/stderr go to capped files inside the inaccessible supervisor control directory.
Collection saves these beside the local receipt and records their hashes without printing
their contents. The process-wide scratch ceiling also bounds these files at 128 MiB, while
this collector accepts evidence only when each file is at most 1 MiB. Oversized diagnostics
currently make collection fail rather than saving a prefix; normal-job acceptance therefore
requires each diagnostic stream to remain within 1 MiB. CLI events provide responding-model evidence only when the installed CLI
actually emits that field; a configured model alone is not proof of the responding model.
Systemd
and provider metadata may persist; cleanup claims cover owned task files, mounts, and
transient units, not the operating system's or provider's history.

Synthetic `prepare` options support `synthetic_scenario="success"` with
`synthetic_seconds=0..60`, `"timeout"`, and `"descendant"`. The latter two deliberately
outlive the deadline, including a child-process case, so timeout and descendant cleanup
can be tested without arbitrary command execution or provider access.

The first authenticated source-only startup exited immediately with systemd status 153 and
empty diagnostics under the old 1 MiB process-wide file limit. A controlled credential-free
probe then isolated the limit: the same outer sandbox with child-only `RLIMIT_FSIZE=1 MiB`
exited on signal 25 before a request, while 128 MiB reached the fake provider with `tools=[]`,
no warnings, and the expected HTTP 400. The startup failure is therefore tied to the 1 MiB
process limit. Authenticated Codex mode still requires a successful controlled rerun under the
bounded 128 MiB ceiling before acceptance.

## Current routing status

That startup failure and its probe isolation are historical evidence and are preserved
above unchanged. Current development work is routed to verified source-only Claude
workers on the existing vCPU; the responding Opus5/Sonnet5 identities were verified from
JSONL. That route is operational for source-only proposals. Product model calls use the existing
native Codex runtime on the Windows desktop, where actual native calls
prove desktop authentication works; that desktop evidence is not evidence about this VM
and the earlier VM startup failure is not the same issue as a desktop 401.

An authenticated Codex VM rerun is not established by this evidence; the optional
Codex VM backend provider proof remains explicitly unverified. Successful Claude VM lifecycle jobs and
successful desktop native calls do not imply an authenticated provider success inside
Codex mode on this VM. The live synthetic lifecycle cleanup tests recorded in review
remain verified within their stated limits: they establish the tested lifecycle on the
existing VM, not persistence across reboot and not universal absence of operating-system
or provider traces. Nothing here claims a new VM authentication test, a reboot result, or
the absence of provider traces.
