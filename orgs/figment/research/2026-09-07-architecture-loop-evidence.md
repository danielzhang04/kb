# Figment architecture, evidence, and loop review — 2026-09-07

## Scope and status

Read-only review of the Figment snapshot at `a005f6d0`, the prior Track-2 handoff,
checked-in calibration/review/test material, and non-image JSON metadata in the
ignored `c001-tf*` run directories. No pod, model, credential, image, or live cloud
action was invoked. The project preamble failed in this snapshot:
`daily budget breached: $19.40 >= $10.00`. The operator explicitly authorized this
read-only continuation; it is not evidence that the budget guard may be bypassed for
another run.

The central finding is that the current code has closed the specific fail-open gate
defects found in the older review, and it has a bounded in-process teardown attempt.
It has not yet demonstrated a complete operational feedback loop: a network/process
failure can still leave a pod without an independent recovery actor, and the judge is
a calibrated proxy rather than an independent acceptance authority.

## Evidence ladder

| Claim | Evidence located | Strength and limit | Result |
| --- | --- | --- | --- |
| `apply-rulings` cannot silently keep an un-gated cell | `figment_train.py:2218-2247` requires `gate.json`, exact coverage, `pass is True`, or a non-empty operator override | Static source evidence; targeted tests were added in `fb1f20ae`, but were not rerun here | **Supported at snapshot** |
| Old judge overload setting is not reintroduced by the gate | `identity_gate.py:284-300` derives gate workers from `vlm_judge.DEFAULT_WORKERS`; judge default is 2 at `vlm_judge.py:74-81` | Static source; no new real judge run was made | **Supported at snapshot** |
| Gate is a reliable identity/realism acceptance test | Calibration documents report 95 local images, but identify only identity/same-person and VLM age delta as separating signals | Same material informs threshold setting and reported performance; no held-out, blinded operator-labelled test or second judge | **Partly supported only** |
| Current pipeline composes dataset identity text from the selected persona | `_generalized_prompts` composes both face/body identity fields from `persona.identity.look` at `figment_train.py:384-417`; the creator-002 regression at `test_creator002_acceptance.py:324-352` asserts the generated job has creator-002 words and no creator-001 words | The test file's module header and `KNOWN_DEFECT_FILES` comments are stale pre-`09faa490` prose. Fresh fixture execution was blocked by missing ignored anchors and then an LF/CRLF spec-hash mismatch, so no new whole-suite pass is claimed | **Supported by current source; fresh acceptance blocked** |
| Train-first live path is proven | Ignored metadata records one completed train and one completed no-trigger tester; later tester attempts stopped with unverified teardown | Metadata proves historical harness outcomes, not output quality or a valid LoRA evaluation | **Partly supported** |
| Teardown is robust after a host/network outage | `runpod_run.py:640-700` retries deletion/verification five times with bounded backoff and raises `PodStillRunning`; `:4204-4268` records finalization status and an estimate | In-process only. No `sweep`/sentinel recovery command exists in this snapshot, and incident metadata shows two unverified teardowns | **Not operationally proven** |
| “964 tests passed” | Track-2 handoff asserts a detached 964-pass run | No retained command result, test list, revision/working-tree identity, or independent rerun was inspected | **Claim only** |
| Sept. spend and orphan cost are reconciled | Sanitized TSV rows can be summed, but orphan rows label themselves estimates pending billing | Provider GET returned 403 and normal status could not run because `requests` is unavailable; no provider bill/pod state was confirmed | **Recorded estimates only** |

## Current code versus the old gate review

The review at `pipeline/REVIEW-2026-09-07-gate-judge-budgets.md` found six medium
gate/judge defects. Commit `fb1f20ae` addresses the relevant source paths: missing
or partial `gate.json` and missing `pass` no longer default to pass; stage-two worker
count is single-sourced; duplicate image stems are rejected before judging
(`identity_gate.py:323-336`); judge score ranges and image-text handling were added;
cache-hit cost accounting was corrected; and a stage-two deadline was added. This is
real hardening, so the old defects should not be reported as current defects at this
snapshot.

The remaining issue is independence. `vlm_judge.py` asks a subscription CLI vision
model to score the same kind of identity and realism qualities that form the gate
(`vlm_judge.py:250-275`), while the current pipeline uses its result to decide whether
a human must explain an override. That is useful machine triage, but it is neither a
fresh independent inspector nor a ground-truth identity measurement. The same
calibration material supplies both threshold derivation and apparent success rates.
The judge can therefore be calibrated to its own proxy, including its own anchor-photo
behaviour, without demonstrating alignment to operator judgement on unseen images.

The calibration records the contradiction plainly:

* The local FaceNet age proxy describes generated sets the operator considered older as
  younger than the anchors; the report calls this a classifier calibration problem.
* Its gloss proxy is effectively zero on both the operator-described glossy images and
  anchors.
* NIQE separates anchors from every generated set, including the best recorded result,
  so the shipped 6.5 threshold is a practical judgment call rather than a separating
  measurement.
* The VLM calibration says skin realism, gloss, and artifacts each have zero
  separations across the five non-anchor evidence sets. Its combined gate is driven
  mainly by same-person and age delta.

Sources: `personas/creator-001/calibration/calibration.md`; 
`personas/creator-001/calibration/judge-calibration.md`; and the explicit threshold
annotations in `pipeline/gate.yaml`.

This does not make the gate useless. It means gate PASS is a routing condition for a
full-resolution human decision, not evidence of accepted image quality. A false
negative is safe only if it merely culls/regenerates; a false positive must remain
unable to promote or publish without the operator.

The bake-off report must be read with the same discipline. Its arm medians are below
the stated anchor band, but its own per-cell line says `a-03 = 85` and `b-02 = 78`
while it defines the anchor self-score band as 78–88. Therefore its statement that
none reach that band is internally false, and the stronger “edit-model path is
exhausted” verdict is not established by this 18-cell result. It is a reasonable
decision hypothesis for an operator to review, not a machine-decided stop condition.
Source: `pipeline/expand/bakeoff/m1-RESULTS.md:3-24`.

## Creator-002 acceptance evidence correction

The active code corrects the dataset/anchor-edit persona-contamination issue reported
by stale comments in `test_creator002_acceptance.py`: commit `09faa490` added the
current composer, and `cdd2f438` moved static workflow identity values to structural
placeholders. The source and the specific non-xfail regression support the correction.
The stale module header, old `KNOWN_DEFECT_FILES` exclusions, and comments still need
cleanup because they can mislead a reviewer, but they do not describe current runtime
behaviour.

Two read-only attempts to run the creator-002 test module are **not** fresh passing
acceptance evidence: the snapshot first produced `8 failed, 33 passed` because the
fixture anchors are ignored/missing; after three original dummy JPGs were copied, it
again produced `8 failed, 33 passed` because the checked-out `identity-spec.md` failed
its declared SHA-256 check. No further retry was made. The cause is reproducible from
bytes: the declaration is the LF-byte digest `802ca421…`, while this checkout has 36
CRLF sequences and raw digest `023104da…`; LF-normalizing in memory yields the
declared digest. Git attributes do not specify text/eol for the file. This is a real
fixture portability/integrity defect, not evidence that the production prompt
composition regressed.

## Operational reality from ignored run metadata

Only JSON metadata was read. No images or credential material were opened.

* `runs/c001-tf/train/runs/out/creator-001-tensor-train-first/run.json` records pod
  `fn938tol6mgbtp`, `termination_verified: true`, and an estimated actual cost of
  `2.570377`.
* `runs/c001-tf2/...tester-first.no-trigger/run.json` records pod
  `idb1hskq79h4l3`, `termination_verified: true`, and `0.288181`. The accompanying
  `stage.json` is complete, but the handoff says this tester omitted the trigger word;
  it exercised orchestration, not valid LoRA quality acceptance.
* `runs/c001-tf3/...tester-first/run.json` records
  `PodStillRunning: POD STILL RUNNING pmi9y2gsoaxkea`,
  `termination_verified: false`, and `0.400403`. Its stage is `stopped:tester`.
* `runs/c001-tf4/...tester-first/run.json` records
  `PodStillRunning: POD STILL RUNNING hvtovmusbx6a1t`,
  `termination_verified: false`, and `0.113185`. Its stage is `stopped:tester`.

The current harness has the right local safety behaviour: it retains the pod ID,
tries delete plus absence verification five times, backs off 1/2/4/8 seconds, and
fails loud rather than claiming termination (`pipeline/pod/runpod_run.py:640-700`).
It also reserves teardown time for the watchdog (`:969-972,4213-4229`). But `atexit`,
the watchdog, and finalization all require the original local process and a usable API
path. A DNS loss, host death, or killed process removes all three. Repository search
found no `sweep` or independent sentinel/reconciler command in the current harness.
Thus the incident is not closed by retries alone.

The plans for `c001-tf2`, `c001-tf3`, and `c001-tf4` each have one planned train and
one tester, each with a recorded `--max-usd` and `--max-minutes`; their state machine
refuses an in-plan retry after a failed/running run (`figment_train.py:1730-1777`).
That prevents duplicate paid execution, but recovery requires a new reviewed plan and
does not recover an existing orphan.

## Cost evidence boundary

The only financial source used here is the sanitized cost-TSV schema
`model, step, usd`. Decimal sums reported from those rows are: 2026-09-02
`1.972622`, 09-03 `5.181765`, 09-04 `6.316118`, 09-06 `2.822600`, and 09-07
`19.397146`. The 09-07 rows include two explicitly labelled
`pod-orphan-estimate` values totalling `16.025`; the non-orphan total across the
observed rows is `19.665251`, and the full recorded arc is `35.690251`.

These are recorded harness estimates, not provider invoices. The 09-07 orphan rows
themselves say to verify RunPod billing. Read-only provider access returned HTTP 403,
so neither actual pod state nor billing could be confirmed. No cost, model telemetry,
or completion grade is inferred beyond those records.

## Bounded-loop recommendation

Treat the current pipeline as a **servo for one reviewed plan**, never as an
unattended self-improving loop. The execution goal can be machine-decided only at the
lower level: a plan has one manifest digest; each stage has one terminal state;
termination is verified; artifacts and ledger row agree; every graded cell has a gate
document; and a human-authored rulings document covers every cell. The high-level goal
— whether an identity/register result is good enough, whether the data is suitable,
and whether spending should continue — remains with the operator.

| Gate | Technical acceptance (machine evidence) | Operator acceptance (human judgement) | Stop/fallback |
| --- | --- | --- | --- |
| Before a paid stage | Fresh preamble budget pass; reviewed plan digest; dry-run; exact `--max-usd`/`--max-minutes`; no existing unresolved pod for the plan | Approve the concrete spend and stage purpose | Any failure or budget mismatch: do not create a pod |
| After each pod | `run.json` has expected outputs, ledger agreement, and `termination_verified: true`; gate document covers all cells | Inspect full-resolution board and decide keep/cull; every gate failure requires a written override reason | `PodStillRunning`, missing data, or gate outage: wake operator; no next stage |
| Dataset promotion | Every kept image has required safety/quality fields, a gate row, and a verified ruling | Confirm identity/register suitability; decide whether the dataset itself remains representative | No automatic fill-to-minimum by overrides; regenerate or stop |
| Model/checkpoint selection | Valid tester invocation proves the trigger/checkpoint path; judge results are attached as annotations | Blind/full-resolution comparison to anchors; choose or reject checkpoint | No selection from an invalid tester or a proxy score alone |
| Incident recovery | Independent reconciler finds provider pod absent and reconciles one provider-billing fact to ledger | Decide whether a new plan is justified | Until then, no rerun of the failed stage |

This passes the loop-design review only as a bounded, human-gated servo. It fails the
requirements for a recurring autonomous regulator today: no external reconciliation
baseline exists for termination/billing, calibration has proxy mismatch and no held-out
operator-labelled validation, the creator-002 acceptance fixture is not portable in
this checkout, and the final quality standard is rightly human judgement.

## Highest-priority risks and concrete next evidence

1. **Unrecovered paid pod after local/API failure.** Add an independent, read-only
   reconciliation/sweep mechanism before another unattended run. It needs a durable
   pod ID/name and stage digest, provider absence verification, ledger reconciliation,
   a bounded retry cap, and a wake-me record. It must not itself authorize a new pod.
2. **Creator-002 fixture portability.** The current code verifies the declared
   identity-spec SHA-256 against raw bytes, while the declaration is LF-specific and
   this checkout materializes CRLF. Define and enforce the repository EOL contract (or
   hash a canonical representation), restore the fixture anchors through a declared
   test fixture path, then retain one clean-command result before claiming acceptance.
3. **Bake-off overclaim.** Correct the false “none reach the anchors' band” statement
   and do not treat the 18-cell m1 sample as proof that a whole model route is
   exhausted. Define the operator decision criterion and held-out comparison before
   stopping a route.
4. **Judge/proxy leakage.** Freeze a held-out set with human labels before changing
   thresholds. Report false-pass and false-cull counts by set; do not use the same
   images both to select a threshold and to claim its performance. Keep the gate as
   triage until it meets an operator-defined error bound.
5. **Invalid success evidence.** Retain the exact test command, revision, clean/dirty
   state, collection count, and result artifact before treating “964 passed” as a
   release fact. A completed no-trigger tester must be marked orchestration-only.
6. **Budget control inconsistency.** Resolve the project preamble failure and the
   recorded-estimate/provider-billing gap before the next live run. The ledger should
   distinguish estimate, confirmed provider charge, and adjustment rather than letting
   a worst-case orphan estimate masquerade as final spend.

## Unknowns

* No provider billing or current pod state could be verified because read-only API
  access returned 403.
* Ignored run data supplied metadata but not a reproducible, non-image record proving
  visual quality or a valid post-fix tester run.
* The 964-test assertion was not rerun or independently evidenced in this review.
* Snapshot `a005f6d0` is the handoff snapshot. The gate hardening predates that handoff
  (it is a fix after the earlier adversarial review), but there is no evidence that its
  teardown path has been exercised successfully under the same DNS/network failure
  mode.
