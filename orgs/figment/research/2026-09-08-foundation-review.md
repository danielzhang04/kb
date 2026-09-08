# Foundation review evidence

This records independent native-worker review, not a formal inspector grade.
Requested review model: `gpt-5.6-sol`; responding-model/token/cost telemetry was
not exposed. The review compared the implementation with analysis base `3b48d911`.

## Portable fixtures: accepted

The reviewer verified the allowlist contains only the three synthetic JPEGs,
generator, and README. A hypothetical private JPEG remains ignored. All three
images open as 832x1088 RGB JPEGs without EXIF; the generator creates visibly
synthetic placeholder drawings. Both raw-byte reference hashes match their persona
declarations, and the corresponding Markdown paths have explicit LF attributes.
No hash enforcement was weakened. `git diff --check` passed.

The parent then created a fresh Windows checkout of portability commit `10448378`
with `core.autocrlf=true`. Its unmodified creator-002 acceptance suite passed:
**8 passed in 10.28 seconds**. No ignored original assets were copied into that
checkout. The temporary checkout was removed after verification; its only extra
file was the suite's zero-cost dry-run ledger.

## Recovery: first review requested changes

Four high-severity issues blocked live use of the initial implementation:

1. Bare `import recovery` worked from the pod CLI but failed through the main
   driver's file-based module loader. Parent and reviewer independently reproduced
   `ModuleNotFoundError: No module named 'recovery'` from `_pod_runner_module()`.
2. Ownership verification assumed `createdAt` fields absent from the documented
   REST response. The [provider schema](https://docs.runpod.io/api-reference/pods/GET/pods)
   documents `lastStartedAt` and `lastStatusChange`. Fixtures must exercise the
   real response contract; a restart time must not be mislabeled as creation time.
3. Reusing an output directory could overwrite an unresolved recovery journal
   before another create request, destroying the previous pod's durable identity.
   Existing malformed and unresolved journals must fail closed before spending.
4. Recovery journal errors bypassed the existing redaction sink. Reflected remote
   exception text could therefore persist sensitive values despite redacted logs
   and `run.json`. The journal should retain bounded error codes or sanitized data.

The builder received this consolidated first-round feedback. Independent acceptance
requires a second check of the fixes and their negative-path tests before launch.
Atomic file replacement is not by itself a promise of survival through every
filesystem or hardware power-loss scenario. A local journal/recovery CLI also
does not establish a remotely hosted watchdog.

## Recovery: second review requested changes; live launch paused

The reviewer verified the module-loader, documented timestamp, and error-sink
fixes. Separate attempt journals preserve the old journal, but a new generated
pod name can still bypass a path-only existence check when the same output
directory contains an unresolved earlier attempt. Another POST and replacement
of the shared `run.json` remain possible. The fix needs directory-wide admission,
preservation of existing receipts, and different-name concurrency tests. Avoided
placement journals also need a terminal update immediately after verified closure.

The builder's checks passed 17 focused and 287 existing pod tests. The parent's
combined independent run returned **303 passed, 1 failed in 15.49 seconds**:
a Windows `WinError 32` sharing violation during atomic replacement in the
uncertain-state test. The reviewer independently ran the 17 focused tests green;
the transient failure did not reproduce. A bounded retry for that specific OS
condition is being prepared, with persistent-lock refusal still required.

The new missing-ID recovery branch deliberately refuses deletion after discovery.
This is safe, but a create timeout before ID persistence still requires operator
reconciliation; automatic recovery of that case is not delivered.

The operator was notified after two independent recovery failures, per the
Figment contract. Wake-up card `01K9FIGMENT0800000000000003` is in the ops proposal.
Local fixes continue to make a concrete reviewable result. A third independent
recovery acceptance and the paid tester remain paused at that boundary.

## Recovery: final local-fix state; independent verdict pending

Recovery commit `66be5887` delivers the final local fixes for this review: the
run-directory lock remains held through finalization; existing `run.json`, legacy
journals, and all prior attempt journals refuse a new POST; terminal placement
journals are recorded after verified closure; Windows `WinError 32`/`33` atomic
replacement failures receive a bounded retry; and dry-run accounting writes only to
an isolated zero-cost ledger. The builder reports **24 focused recovery tests and
287 existing pod tests passed**.

This is the final local implementation state, but the final independent recovery
verdict is **PENDING**: a third independent acceptance has not run because work paused
for user continuation after two `REQUEST CHANGES` reviews. No live or paid tester
launch is implied. Parent non-recovery integration is complete; its final result is recorded below.
This integration does not replace the pending recovery acceptance.

## Approval/checkpoint lineage: accepted at 23ce226d

The local implementation now records the inputs and decisions that each review uses.
`grade` snapshots the ordered full-resolution image bytes, anchors, plan and stage
manifests, persona/training inputs, threshold file, numeric gate, and (for tester)
checkpoint input inventory. It writes an evaluation-inputs record and carries its
subject digest into the rulings template. `apply-rulings` requires that digest, a
non-empty human `decided_by` and `decided_at`, exact keep/cull coverage, all seven
axes, and the current fail-closed numeric gate. It writes approval lineage bound to
the reviewed subject; anchor approval requires a fresh plan after promotion, and
`run --stage all` pauses after anchor when present and after dataset for operator
review.

An existing train-first dataset must pass the manifest, filename, caption, and
image-hash checks and receive an explicit `accept-dataset` decision before planning.
Tester checkpoint promotion requires `--checkpoint-step`, an explicitly kept tester
cell, a produced artifact from the same completed train receipt, a successful
teardown-verified receipt, and matching checkpoint bytes. Generation then revalidates
the source plan, tester approval, training inputs, receipt, and checkpoint bytes before
staging only the accepted checkpoint.

These records prove local source hash continuity. They do not cryptographically attest
which weights a provider pod consumed because provider receipts expose byte counts
rather than a signed weight digest. A prepared standalone diagnostic does not itself
create driver-bound tester evidence; the old tester run with unbound checkpoint
provenance must be rerun through the driver before a checkpoint can be promoted.

The adapted legacy fixtures preserve their prior assertions while using real input
hashes, explicit dataset acceptance, human ruling metadata, and a production-created
checkpoint approval. Parent integration returned 700 passes and the same 13 reproduced baseline
failures. The independent lineage reviewer returned **PASS / READY** at `23ce226d`: 66
lineage/gen/config/anchor/creator acceptance tests and all 45 driver tests passed
(**111 total**). The scoped diff check passed, with no remaining correctness or
security findings. This verdict excludes recovery.

## Integration and baseline comparison

The first broad non-recovery invocation used a nonexistent parent for its nested
pytest basetemp. It returned 392 passes, 314 setup errors and 3 failures; this
invocation does not establish a product regression. Create the custom temporary
root explicitly before using a nested basetemp.

The corrected pre-freeze run returned **697 passed, 14 failed in 58.38 seconds**.
One affected fixture declared training checkpoint artifacts without writing their
bytes. The new tester input check correctly rejected them; the builder updated the
fake harness to materialize the exact declared files, preserving its execution-order
assertions. The other 13 failures reproduced on unchanged analysis base `3b48d911`
using the same four suites: **88 passed, 13 failed in 2.28 seconds**.

- Two calibration manifest tests violate the inherited timeout budget contract.
- Two dataset-port tests require an absent ignored purchased-package source graph.
- Three advisory scorer tests require the unavailable `facenet_pytorch` dependency.
- Six shell startup tests fail when Git Bash handles Windows fixture paths (`mkdir`
  permission denied).

The baseline comparison used private creator-001 references and temporarily restored
reference text to its raw HEAD bytes; tracked baseline files were restored afterward.
The final frozen integration returned **700 passed, 13 failed in 58.82 seconds**;
its failure set exactly matches the 13 reproduced baseline failures. No new
integration failures remain. Lineage source and tests are committed as `23ce226d`.
Recovery tests are excluded from this independent integration run because their
third acceptance remains paused; this does not replace recovery review.

During the lineage review, the reviewer identified that train-first copied unlisted
source files and could dereference a symlink into its recursive upload. The final
fix copies only approved images/captions and required metadata, rejects symlinks
among copied entries, and rechecks the exact staged inventory plus regular-file
status before either training path launches. Regressions cover an unlisted source
file and a new file inserted into the staged directory after planning. No identity
scoring or acceptance thresholds changed.
