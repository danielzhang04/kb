# Operator Guide — `gen_source_read.py` current-source reader

## Purpose
`gen_source_read.py` is a read-only observer that reports the currently-configured
gen-plan source for one Figment creator. It performs no launch, no approval, no
quality judgment, no atomic-snapshot guarantee, and no billing action. Importing the
module resolves its own path only — it does not read plan or media data and does not
execute any project dependency until `observe_gen_source`/`main` actually runs.

## Fresh isolated process, one shot
Invoke the reader exactly once in a fresh process, using a trusted absolute Python executable with the `-I -B` flags and a trusted absolute path to the adapter module. Both flags are verified at startup; the process refuses to run if either is missing. Any launcher (including but not mandatorily the `py` launcher) may be used as long as it resolves to a trusted absolute interpreter path and passes the required flags. The process enforces a one-shot guard: it will not accept reuse or re-invocation within the same process, so each read requires a new process launch.

## Exact six flags
Invoke with exactly these flags, each once, `--flag value` form:

- `--creator`
- `--selected-root`
- `--selected-plan-sha256`
- `--source-root`
- `--source-plan-sha256`
- `--dependency-sha256`

Conceptual argv (placeholders only, no shell quoting implied):

    <trusted-absolute-python> -I -B <trusted-absolute-adapter-path>
        --creator <creator-id>
        --selected-root <absolute-selected-root>
        --selected-plan-sha256 <64-hex>
        --source-root <absolute-source-root>
        --source-plan-sha256 <64-hex>
        --dependency-sha256 <json-map-of-five-filename-to-64-hex>

`--dependency-sha256` pins exactly five sibling source files by name —
`observed_reads.py`, `figment_train.py`, `training_config.py`, `persona.py`,
`lineage.py` — each ≤512 KiB, checked before any of that code executes. It does **not**
name or pin the adapter (`gen_source_read.py`) itself.

`--selected-plan-sha256` and `--source-plan-sha256` are independent digests over two
distinct `plan.json` documents (the selected gen plan and the source train/tester
plan). They are never substituted for one another.

## SourceConfig: trusted origin, not authenticated by hashing
`SourceConfig` (six fields: `creator`, `selected_root`, `selected_plan_sha256`,
`source_root`, `source_plan_sha256`, `dependency_sha256`) is trusted caller
configuration — it is not derived from observed data. Hashing the five dependency
files, and comparing the two plan digests, checks that *specific mutable inputs*
match a pin the caller already trusted; it does not authenticate the adapter file, the
Python executable, or the standard library that runs it. Caller responsibilities the
adapter cannot verify:

- The adapter bytes (`gen_source_read.py`) were independently approved and are
  invoked from a stable, trusted, canonical path.
- The Python executable and its runtime/standard-library environment are the trusted
  ones — no per-invocation verification is performed.
- Roots and the adapter path are given in canonical on-disk spelling (real case, no
  8.3 short names, no symlink/junction/`subst`/network alias). This is a precondition,
  not an exhaustively-checked property — some noncanonical aliases may go undetected.

If dependency hashes don't match the current five files, or a plan digest doesn't
match its `plan.json`, the run is refused as unavailable — never silently re-pinned.
There is no auto-refresh of trust pins and no auto-retry on `unavailable`. If you
intentionally revised the plans, personas, or the five dependency files, that requires
review/replanning and an updated trusted `--dependency-sha256`/plan-digest
configuration first, then a deliberate fresh one-shot run with the new pins.

## Ancestor and ABA limits
Data-path ancestors are fingerprinted and rechecked; a change present at the final
recheck is caught. This does **not** catch a revert between checks (ABA) or a
sufficiently privileged concurrent writer that can also alter the fingerprinting
inputs. Code-file ancestors (the adapter's own directory chain) are trusted for path
stability across the process, not independently reverified.

## Bounded observation
The reader partitions its budget across three fixed producer roles (A: plan/config
documents, B: manifests named by A, C: leaves/receipts named by A and B), summing to
256 files / 1 GiB unique bytes / 2 GiB streamed bytes / 1024 operations total, never
moved between roles. Per-file cap 256 MiB; JSON documents capped at 256 KiB. Role
caps: at most 2 gen runs, 8 identity references, 8 anchors, 16 grading images. The
five dependency source files are each ≤512 KiB, from a separate budget than the data
reads above.

Only files whose content was actually hashed are re-streamed and rehashed at the
final recheck. Not every consulted path gets a content rehash: references touched
only for metadata or identity (which may include actual referenced files, not only
directories) keep metadata/identity-level checks, not a content rehash.

## Response contract
Output is one bounded ASCII line ending in LF, ≤4096 bytes including the LF, written
to stdout only; stderr is expected empty. Failure returns exit 1.

On success (exit 0) the JSON line has exactly these fields: `schema`, `result`
(`"current-source-observed"`), `creator`, `selected_plan_sha256`, `persona_sha256`,
`approval_sha256`, `approval_lineage_sha256`, `source_plan_sha256`,
`checkpoint_sha256`, `gen_manifest_sha256`, `gen_runs`, `claims`. `claims` always
reports `launch_ready`, `quality_approved`, and `atomic_snapshot` as `false` —
current-source observation is not any of those authorities and does not verify that
independent validators upheld any human ruling.

Failures before any output is produced (bad arguments, bootstrap errors, domain/logic errors, or serialization failures) cause the process to attempt to emit the fixed unavailable line `{"result":"unavailable","schema":"figment/gen-source-read@1"}`, though even this emission is best-effort and may itself fail. Failures occurring during or after a successful-looking write (partial write, flush failure, or short output) never trigger a second, unavailable line—output in that case is not guaranteed to be complete or present at all. External consumers are responsible for rejecting malformed, truncated, or extra output; the producer does not detect or guard against output that is modified or tampered with externally after it leaves the process.

Partial, malformed, or extra output, or a nonzero exit with anything else, must be
treated as unavailable; there is no guarantee of diagnostics against a hostile or
misbehaving runtime.

## Manual dashboard source check

The generation-plan view now includes **Source check** for each stored plan. The
HTTP workflow supports `creator-001`, one prepared gen run per plan, on local
Windows CPython. It uses the reader described above; configuring the server does
not launch a check. The synthetic local browser journey is verified; this guide does not
claim deployment or media-quality acceptance.

Set `DASHBOARD_FIGMENT_GEN_SOURCE_READS_JSON` in the dashboard server's environment
before startup. Its value has exactly this shape. Every angle-bracket value below
is a placeholder to replace with independently reviewed configuration; this is not
a runnable configuration or a set of trusted production pins.

```json
{
  "pythonExecutable": "<canonical-absolute-Windows-python.exe-path>",
  "adapterSha256": "<reviewed-adapter-sha256>",
  "dependencySha256": {
    "observed_reads.py": "<reviewed-sha256>",
    "figment_train.py": "<reviewed-sha256>",
    "training_config.py": "<reviewed-sha256>",
    "persona.py": "<reviewed-sha256>",
    "lineage.py": "<reviewed-sha256>"
  },
  "entries": [
    {
      "id": "<published-plan-id>",
      "planSha256": "<selected-gen-plan-sha256>",
      "sourceRoot": "<canonical-absolute-source-root-inside-server-repoRoot>",
      "sourcePlanSha256": "<source-train-or-tester-plan-sha256>"
    }
  ]
}
```

- Use one or two entries with unique IDs. Copy the exact published plan ID and
  its `planSha256` together. The ID uses the existing 36-character lowercase
  hex/hyphen format; do not generate a replacement ID. All digests are lowercase
  64-hex. `sourcePlanSha256` independently pins the source root's `plan.json`.
- The selected plan must be published in
  `<repoRoot>/orgs/figment/_private/figment-studio/gen-plans/<id>` with matching
  publication evidence. Legacy-root plans and unmarked or ambiguous inventories
  are refused. `sourceRoot` must also lie inside the server's configured
  `repoRoot`; a sibling checkout or external source directory is unavailable.
- Use canonical local drive-absolute Windows paths with backslashes, escaped as
  `\\` in JSON. No relative paths, forward slashes, UNC/device paths, junctions,
  short-name aliases, dot segments, or trailing separators. Path strings are
  limited to 2,048 characters. The trusted Python executable may be outside
  `repoRoot`; its runtime integrity remains the caller's responsibility.
- The server fixes the adapter path to
  `<repoRoot>/orgs/figment/pipeline/gen_source_read.py`. `adapterSha256` must come
  from independent review of that adapter; the five sibling pins do not replace
  it. Review intentional code or plan changes before updating configuration.
  Hashing whatever happens to be on disk is not approval of those bytes.
- An absent environment variable disables checking. Empty text, JSON `null`,
  extra keys, malformed pins, or more than two entries fail startup with a fixed
  configuration error. The JSON limit is 65,536 characters. Configuration is
  copied and frozen at registration; a deliberate configuration change requires
  restarting the server after review.

Open a stored plan and choose **Check current source** explicitly. Discovery only
reports configuration and availability; it does not inspect the source files.
The browser supplies the plan's exact ID/digest and the current operator/workspace
scope automatically. There are no prompt, filesystem-path, or token-entry fields
in this flow; the existing dashboard session provides authentication.

A successful result shows **Source checked at** and the source-plan digest prefix.
This is a past observation: files may already have changed. It grants no launch,
quality, approval, or atomic-snapshot authority and does not change recorded
assignment evidence. There is no automatic check, retry, or source-result storage.
Both the child's **Refresh status** and the parent plan-list **Refresh status**
clear the displayed result. Changing the operator or plan identity also removes
the old result and discards late responses.

When another check is **busy**, wait and refresh explicitly. **Quarantined** means
an earlier process ended with uncertain containment; an operator must investigate
before checking can resume. Refresh does not clear that server quarantine. Other
failures show fixed unavailable, authorization, or identity-mismatch messages;
raw process diagnostics and paths are not displayed. A browser timeout does not
prove the server stopped: the server may still be working, and no automatic retry
occurs. The browser waits up to 30 seconds for discovery and 150 seconds for a
check; the contained child has a separate 120-second execution timeout and must
finish its cleanup before the server can reuse its slot.

For maintainers, discovery is bodyless
`GET /api/figment/studio/gen-source-reads`; the manual action is bodyless
`POST /api/figment/studio/gen-plans/:id/source-check`, carrying
`X-Figment-Plan-Sha256` and `X-Figment-Request-Scope`. Both use existing session,
origin, and rate gates; POST also requires new-work admission and the fleet
preamble. See the [route and configuration parser](../../dashboard/server/figment/genSourceRead.ts),
[governed registration](../../dashboard/server/http/surface.ts), and
[plan-list integration](../../dashboard/src/figment/StudioGenPlans.tsx).

## Creator identifier and hash shapes
`creator` is lowercase alphanumeric segments separated by single hyphens, starting
with a letter. All sha256 pins/digests are lowercase 64-hex strings.

## Readiness checklist
- Fresh, isolated (`-I -B`) Python process, one call only.
- Trusted absolute Python executable and runtime/stdlib — not verified by the tool.
- Trusted absolute path to this exact adapter file.
- Canonical spelling for all roots and the adapter path.
- Correct, currently-accurate `--dependency-sha256` for the five named files.
- Correct, independently matching `--selected-plan-sha256` and
  `--source-plan-sha256` for their respective `plan.json` files.
- Exit 0 and the exact success schema before treating output as an observation;
  anything else is unavailable — re-plan/re-pin deliberately, don't auto-retry.
