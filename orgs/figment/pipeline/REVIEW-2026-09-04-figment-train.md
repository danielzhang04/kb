# Adversarial review — figment_train.py generalisation (brief T1-G)

Reviewer: Claude (opus, adversarial review agent). Worktree
`C:\Users\danie\kb-worktrees\figment`, HEAD `0884c4cd`. Read-only review; this file is
the only write. No live pod invoked; verification used `runpod_run.py --dry-run` only
(network-free, no billable compute), matching the brief's own test suite.

Target commit `0884c4cd` — `figment_train.py` (1251 lines), `training_config.py` (154
lines), `orgs/figment/personas/creator-001/training.yaml`, `train/tensor-pins.yaml`,
`tests/test_figment_train.py` (10 tests), `train/FIGMENT-TRAIN.md`.

## Verification performed

1. **Plan fidelity (independent re-derivation).** Ran `figment_train.py plan --creator
   creator-001 --stage all --out <temp>` into
   `C:/Users/danie/AppData/Local/Temp/kbfp-rv/plan-out` and JSON-compared (key-order and
   whitespace insensitive) all 6 generated manifests against the committed files:
   - `expand/runs/creator-001-tensor-dataset-shard-{01,02,03}.yaml`
   - `train/runs/creator-001-tensor-train-smoke.yaml`
   - `train/runs/creator-001-tensor-train.yaml`
   - `train/runs/creator-001-tensor-tester.yaml`

   **All six are byte-for-byte JSON-identical to the hand-written, currently-live
   manifests.** No undocumented deltas found beyond formatting (matches
   `FIGMENT-TRAIN.md`'s "Reproduction and migration" section).

2. **Test suite.** `py -3 -m pytest orgs/figment/pipeline/tests/test_figment_train.py -q`
   → **10 passed**, 0 failed, 4.66s (`PYTEST_DEBUG_TEMPROOT=C:/Users/danie/AppData/Local/Temp/kbfp-rv`).
   Matches the commit message's "+10 tests" claim exactly (1 dataset-repro test, 1 pins
   test, 1 creator-002 generality+dry-run test, 1 run-verifier-pass test, 4 parametrized
   run-verifier-defect tests, 1 grading round-trip test, 1 safety-fail-closed test).

3. **Generality grep.** No `creator-001`/`creator001` literal in `training_config.py`
   (only a docstring reference to the sidecar's purpose) or `tensor-pins.yaml`. Two hits
   in `figment_train.py` (lines 226-227, 554-555) — see findings #3 and the note below
   table; both are cosmetic-only (copied-file text rewrites), not structural. The
   creator-002 fixture test independently asserts no `creator-001`/`creator001` byte
   sequence anywhere under a full creator-002 plan output tree, and that all 6 generated
   manifests pass `runpod_run.py run --dry-run`.

4. **qa_stamp.py cross-check.** `qa_stamp.py` (pre-existing, reused unmodified) already
   fail-closes on any missing/invalid safety axis (`adult_read`, `garment_integrity`,
   `real_person_resemblance`) before any write. `figment_train.py`'s own
   `_normalize_rulings` is *stricter* still: it requires all seven axes (four quality +
   three safety) present and non-empty on every ruling before `qa_stamp.stamp` is even
   called. `apply_rulings` only adds a cell to `approved_rows` when
   `decision == "keep"` **and** `not safety_failed` **and** `review_status == "verified"`,
   and only `approved_rows` (copied to a temp dir) reaches
   `build_training_set.build_training_set(images_from=[temporary_approved], ...)`. No
   path from a raw score/threshold into the training set was found.

## Out-of-scope observation (not a T1-G defect — surfaced for operator awareness)

`git status` in this worktree shows `orgs/figment/pipeline/pod/runpod_run.py` **modified
and uncommitted** (114 insertions / 5 deletions — new `forget_bad_host`, a
machine/network/dependency failure-reason split), and, as of a later `git status` taken
minutes later in the same review session, `orgs/figment/pipeline/pod/README.md` and
`orgs/figment/pipeline/pod/tests/test_runpod_run.py` **also modified and uncommitted** —
neither was dirty at the start of this review. None of the three is part of commit
`0884c4cd` (confirmed via `git show --stat HEAD`), and this review only ever opened them
with `Read`/`grep`, never `Write`/`Edit` — the diffs are not from this review. The set
growing mid-session means another process (almost certainly whatever is driving tonight's
live pod, or a concurrent session) is actively editing the harness — `pod/runpod_run.py`,
its own README, and its own test file — in the same worktree the live training run reads
from, and specifically the file the brief said must not be modified while that pod is up.
Whoever owns that in-flight edit should commit or revert it deliberately; an uncommitted,
moving harness change sitting in the same worktree a live training run reads from is a
risk independent of anything graded here, and this review does not evaluate that diff's
correctness — it was never asked to and the file is explicitly out of the T1-G target list.

## Findings

| # | Severity | File:line | Defect | Fix |
|---|----------|-----------|--------|-----|
| 1 | **HIGH** | `figment_train.py:869-877` (`run_planned_stage`) | A planned run's `state["runs"][key]` is only checked for `"complete"` (skip) or `"failed"` (refuse-retry, line 873-876). If a prior invocation was interrupted after the `"running"` status was written (line 886) but before the subprocess returned — process killed, terminal closed, machine sleep/crash, `PodLease`'s own atexit/watchdog not reached — the next `run` invocation for the same stage sees neither `"complete"` nor `"failed"`, falls through, and **launches a second live pod for the same manifest**. This directly contradicts the brief's "never retrying live" contract and GUARDRAILS.md #6 ("a forgotten pod silently drains the balance") — the exact scenario a resumed `"running"` row represents. | Treat `prior.get("status") == "running"` the same as `"failed"`: raise `FigmentTrainError` telling the operator to confirm the pod's true state via `runpod_run.py status`/`probe` (and `terminate` if still running) before any new plan/run — never silently resume. |
| 2 | MEDIUM | `figment_train.py:680-685` (`_ledger_model`) vs `pod/runpod_run.py:3203-3209` (`gpu_model_label`) | `_ledger_model` is a byte-for-byte reimplementation of `runpod_run.py`'s `gpu_model_label` (same two `re.sub` calls, same `runpod:` prefix), used to recompute the ledger-row `model` key for `_verify_ledger`'s reconciliation check. Every other pod-side helper this module needs (`render_aitoolkit_config.py`, `build_training_set.py`, `qa_stamp.py`) is imported via the existing `_load_module` pattern; this one was hand-copied instead. If the harness's GPU-name-to-ledger-key rule ever changes, the writer (`runpod_run.py`) and this reader silently diverge and ledger-agreement verification either false-fails a good run or (in a worse case) stops catching a real mismatch. | Import `gpu_model_label` from `pod/runpod_run.py` via `_load_module`, the same way the render/build-set/qa modules are loaded, and delete the local copy. |
| 3 | LOW | `figment_train.py:226-227` (`_generalized_prompts`) | `note.replace("anchors/g01.jpg", references[0].as_posix())` / `.replace("anchors/g07.jpg", body_ref.as_posix())` pattern-match creator-001's literal anchor filenames inside the shared template's descriptive note (`tensor-dataset-prompts.yaml` → `structure.prepend_is_the_hand_typed_description`). For any creator whose reference files aren't literally named `g01.jpg`/`g07.jpg` (e.g. the creator-002 fixture's `a01/a02/a03.jpg`), both `.replace()` calls are silent no-ops, so the plan's copy of the note keeps asserting "face.identity matches anchors/g01.jpg; body.identity matches anchors/g07.jpg" for a creator with no such files. The note is documentation-only (never fed into a workflow node or an actual model prompt — confirmed by tracing `prompts["face"]["identity"]`/`prompts["body"]["identity"]`, which are separate fields), so this has no functional effect on generation, but it is exactly the "still describes creator-001" residue the brief's generality test is meant to catch, and it slips past `test_creator002_is_data_only_token_clean_and_every_manifest_dry_runs` because that test only greps for the literal strings `creator-001`/`creator001`, not `g01`/`g07`. | Build the note from `references[0].name` / `body_ref.name` directly (e.g. re-template the sentence) instead of string-replacing creator-001's specific filenames, or leave the note un-rewritten and static. |
| 4 | LOW | `orgs/figment/pipeline/tests/test_figment_train.py:93-131` (`_synthetic_persona`) | The review brief's own stated attack is "what would break for creator-002 with 2 anchors or a different arch?" The fixture always builds 3 anchors (`a01/a02/a03`) and only `krea2` (the sole `ALLOWED_ARCHES` value). The 2-anchor boundary for `_generalized_prompts`/`_generalized_dataset_workflow`'s `references[0]`-is-face / `body_target.exemplars`-driven body-ref selection is exercised only by manual trace in this review (found correct — see report), not by an automated test. | Add a second fixture variant with exactly 2 references and 1 exemplar (or parametrize `_synthetic_persona`) to lock in the minimal-anchor-count behavior. |
| 5 | LOW | `orgs/figment/pipeline/train/FIGMENT-TRAIN.md:54` | "Nothing remains creator-specific in code or manifests" is true for the creator axis but the doc doesn't note that `training_config.py:31` (`ALLOWED_ARCHES = {"krea2"}`) and `tensor-pins.yaml`'s single, arch-unkeyed `pins.{dataset,train,tester}` blocks mean architecture is still hardcoded — a persona requesting a non-krea2 `base_arch` fails closed cleanly (verified: `validate_training` raises before any manifest is built), which is the right behavior, but a reader could take the "nothing remains creator-specific" line to mean full generality including architecture. | One sentence: "Architecture is currently fixed to `krea2`; `tensor-pins.yaml` pins are not yet keyed by `base_arch`, and any other value fails `training_config.py` validation before planning starts." |

## Verdict

**APPROVE WITH FIXES.**

The core generalisation claim holds up under direct adversarial verification, not just
trust in the author's tests: an independently-run `plan` reproduces all six live,
hand-written creator-001 manifests byte-for-byte; the creator-002 fixture is genuinely
different data (different steps/save_every/trigger/anchor count) and its plan output
carries zero creator-001 residue by content grep, and every one of its six generated
manifests passes the harness's own `--dry-run` preflight; all three safety axes are
mandatory and fail closed before any image reaches `build_training_set`; and the `run`
path re-verifies the manifest hash and every harness argv field against the frozen plan
before each live call, which is *stronger* than the scratchpad driver it supersedes. 10/10
tests pass.

Finding #1 is a real, brief-contradicting gap in the one place this module is allowed to
spend money: an interrupted `"running"` row is not distinguished from a fresh run, so a
crash mid-pod can be followed by a second live launch instead of a hard stop. That must
be fixed before this command is trusted for an unattended or resumed live run (i.e.
before the migration note's "retire the scratchpad driver" step). Finding #2 is a
maintainability/drift risk on the same safety-critical ledger-verification path and
should be fixed in the same pass. Findings #3-#5 are cosmetic/documentation/coverage
items that don't block use.

**Counts: 5 findings — 1 HIGH, 1 MEDIUM, 3 LOW.**
