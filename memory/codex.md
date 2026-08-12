# codex worker lessons

- Workspace-local npm cache for verification (2026-07-31, from worker run): when a Node project worktree lacks node_modules and npx.ps1 is policy-blocked + npm's user cache is EPERM under the sandbox, run the `.cmd` executable and `npm ci --cache .npm-cache` inside the project, then clean the temp cache.

## Match offsets must share their source text

### Context
- A residual-language scanner translated staging terms before matching, then sliced the original prompt with translated-text offsets.
- A longer translation hid a nearby residual term even though its original context contained the directional cue.

### Root Cause / Core Insight
- Character offsets are valid only for the exact string that produced them; transformations invalidate them unless an explicit mapping is maintained.

### The Pattern (transferable)
- Next time I will keep matching and offset-based window extraction on the same text representation, or carry a deliberate source-map between representations.
- Signal to recognize: a transformed string is searched but its match spans index a different source string.

## C3 canvas calibration

- The canvas table can retain its required dimensions-only type while documenting provenance and promotion constraints immediately above the affected rows.
- When a task plan's expected test count is stale, preserve the TDD red/green evidence and report the observed total rather than weakening or removing existing tests.

## C6 Windows process-tree kill

- `taskkill /T` alone did not stop a fake grandchild in this Windows sandbox; attach a Job Object immediately after `Popen` and use `TerminateJobObject` on timeout. Keep `CREATE_NEW_PROCESS_GROUP` as the measured process-launch contract and retain process-group kill on POSIX.

## C9 integer-ratio normalization

## C12 append durability and staging links

## Whole-plan preflight requires lawful fixtures

### Context

- A CLI test fixture reused a realistic environment item but replaced its generated slate with an arbitrary PNG declared as a figure seed.
- The CLI correctly applied the current whole-batch preflight, which stopped the test before its CLI assertion.

### Root Cause / Core Insight

- A fixture that reaches a downstream runner must satisfy every upstream contract the runner intentionally invokes; realistic-looking fields are insufficient when truth metadata is validated.

### The Pattern (transferable)

- Next time I will make integration fixtures lawful at the earliest enforced boundary, or use the narrowest valid request mode, before diagnosing downstream behavior.
- Signal to recognize: a new focused test fails in preflight with metadata/continuity violations rather than at the feature under test.

- A publish/log transaction needs a durability boundary, not merely an exception boundary: once the JSONL bytes have been flushed and fsynced, later close errors must count as logged; before that boundary, restore the log exactly before rolling the matching publish back.
- A name/path gate does not stop pre-existing links from redirecting an in-place writer. For replaceable archive artifacts, write a same-directory temporary file and `os.replace` the directory entry; for append-only logs, reject symlinks and multiply linked targets before opening them.

- A one-axis integer crop cannot always land on an exact canvas ratio: 52×29 versus 43:24 is a compact poison case where rounding leaves the source untouched. Prefer the largest exact rational rectangle when it fits; only then fall back to the best floor/round/ceil one-axis crop for genuinely undersized images. Pin both the residual bound and the two validation boundaries so a superficially valid Pillow output cannot mask a removed post-output validation call.
## 2026-08-12 — C14 fresh snapshot boundary

- For a shared session image directory, a `record()` snapshot is state history, not a safe
  boundary for the next invocation. Capture the directory immediately before each invocation;
  regression-test files that arrive in the interval after `record()` and before resume.
