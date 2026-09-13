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

## Not available yet
No UI or HTTP integration ships with this reader; nothing here should be wired into
an automatic run/retry loop. Current-source observation is strictly distinct from
launch authority, human approval, quality sign-off, atomic-snapshot guarantees, or
billing control.

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
