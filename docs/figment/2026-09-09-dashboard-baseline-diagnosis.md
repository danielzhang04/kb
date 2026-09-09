# Dashboard baseline diagnosis

## Verdict

No retained evidence identifies a dashboard product regression introduced by the Figment hub work. The statement that a broader dashboard suite was stopped after “at least 59 failures in 19 files” is currently an unauditable observation: its failing file list, assertions, command line, and final Vitest summary were not saved.

The only baseline log present is `C:\Users\danie\kb\_private\figment-integration-baseline-20260908.log`. Despite its name, it is a completed Python/Pytest Figment pipeline run (`13 failed, 88 passed in 2.28s`), not the stopped dashboard/Vitest run. Treating its failures as dashboard failures would send the repair to the wrong subsystem.

## Anchors and scope

- The supplied `37d47d7b` object prefix is not present in this repository. The reachable intended anchor is `37d580d9218863becc7e3a5e2e130620d51b3b08` (`Record operator identity and apparent-age feedback`). It is the merge base of the Studio head and predates every dashboard Figment commit on this branch.
- `dashboard/package.json` and `dashboard/vitest.config.ts` are unchanged between `37d580d9` and the Studio head. The last commit touching the Vitest configuration is `89f7d2a0` from 2026-08-23, before the Figment dashboard work.
- The Figment dashboard delta is confined to the new `dashboard/server/figment/**` and `dashboard/src/figment/**` surfaces plus their bounded wiring in `dashboard/server/index.ts`, `dashboard/server/index.test.ts`, `dashboard/src/App*`, and navigation/Markdown files.
- The worktree already contained unrelated `orgs/figment/STATE.md` and `.test-tmp/` changes; this diagnosis did not touch them.

## Concrete retained failure categories

The available Pytest log has four categories:

| Count | Category | Trigger and evidence | Minimum repair surface | Figment dashboard regression? |
|---:|---|---|---|---|
| 2 | Stale calibration budgets | `test_grid_run.py` builds manifests whose `max_minutes` is below the harness's readiness + compatibility jobs + teardown calculation (required minima 175 and 625). | `orgs/figment/pipeline/calibrate/grid_run.py` and/or its two expectations in `calibrate/tests/test_grid_run.py`. | No. Both the producer/test and `pod/runpod_run.py` are unchanged from `37d580d9`. |
| 2 | Missing ignored research fixture | `test_tensor_dataset.py` reads a hard-coded source graph under the separate, absent `figment-analysis-2026-09-07` worktree. | `orgs/figment/pipeline/expand/tests/test_tensor_dataset.py`; provide an explicit local fixture/root instead of a historical worktree path. | No. The failing test is unchanged from `37d580d9`. |
| 3 | Optional Python dependency absent | `score_cells.py` constructs `FaceNetEmbedder`; importing `facenet_pytorch` fails before the tests reach their assertions. | Test/dependency provisioning, or the fixture seam in `orgs/figment/pipeline/tests/test_score_cells.py`; product handling in `score_cells.py` only if the intended contract is graceful optional-dependency failure. | No. The scorer, embedder, and tests are unchanged from `37d580d9`. |
| 6 | Windows/MSYS path translation | Rendered LoRA launcher tests invoke Git Bash with Windows temp paths and fail at `mkdir C:/Users/danie: Permission denied`. | `orgs/figment/pipeline/train/tests/test_tensor_track.py` test launcher/path fixture; change production launcher only if a Linux-path defect is separately reproduced. | No. The failing test is unchanged from `37d580d9`. |

These 13 failures are baseline relative to the dashboard Figment delta with high confidence: `git diff --name-only 37d580d9...HEAD --` over all failing tests and their cited implementation files is empty. The pipeline is frozen for this task, so these are diagnosis only.

## Dashboard evidence gap and next repair

The review note at `docs/figment/2026-09-08-local-training-hub-review.md` is the only durable source for “59 failures in 19 files.” It explicitly says the run was stopped and no pre-existing baseline was established. The related integration worker transcript records targeted edits and review activity, but it does not retain a bounded Vitest failure summary that can be mapped to those counts.

Therefore the minimum current repair is evidence capture, not dashboard production code:

1. Run one bounded dashboard batch with the real Node/Vitest entrypoint and save its complete summary outside Git.
2. Compare the same files at `37d580d9` only for failures that reproduce at the Studio head. Do not infer baseline status from the aggregate count.
3. Amend the review note only after that artifact exists; until then, describe the broad run as “stopped; failure output unavailable.”

The subsequently authorized bounded verification ran this command from `dashboard/` and retained its streams under `C:\Users\danie\kb\_private\figment-dashboard-verification-20260909-v1`:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'node_modules\vitest\vitest.mjs' run server/figment/profileGallery.test.ts server/figment/routes.test.ts src/figment/FigmentWorkspace.test.tsx server/index.test.ts --maxWorkers=1
```

Result: 4 test files, 141 tests, 140 passed and one timed out; duration 141.60 seconds. The only failure was `dashboard/server/figment/routes.test.ts:175`, “streams only a receipt-listed PNG at the displayed hash and detects stale substitution,” which crossed Vitest's 5,000 ms default at 5,179 ms. Vitest reported no failed behavioral assertion. The test was introduced by `5deb8004`, after `37d580d9`, and its body is unchanged at the current head. This establishes a current test-duration failure, not a production regression and not a historical baseline failure.

The test contains `expect(response.rawPayload).toEqual(png())` at line 191. This is the same Buffer deep-equality assertion pattern that a prior Figment review identified as causing a five-second timeout for a 1.4 MB payload. The payload here is only a generated 4 x 3 PNG, so the prior large-payload mechanism is not proven to be the whole 5,179 ms cost; this test also creates a full fixture, scans it, starts Fastify, rewrites evidence, and injects four requests. The precise minimum test-only repair is nevertheless to express the intended byte identity directly:

```ts
expect(response.rawPayload.equals(png())).toBe(true);
```

That one-line change was made only in `dashboard/server/figment/routes.test.ts`; the assertions and timeout remain unchanged. The exact named test then passed in 496 ms (`1 passed`, `16 skipped`, file duration 1.48 seconds). Command and complete streams are retained under `C:\Users\danie\kb\_private\figment-dashboard-verification-20260909-v2`.

This result verifies the repaired test in isolation. It does not prove that Buffer deep equality alone caused the earlier 5,179 ms batch timeout, because there is no same-host isolated pre-change timing and the four-file run had substantially more filesystem, transform, JSDOM, and Fastify work. Do not raise the global timeout or change `dashboard/server/figment/routes.ts` without a reproduced behavioral failure.

## Confidence

- High: the retained 13 failures are not caused by the dashboard Figment delta.
- High: the Vitest runner configuration did not change in the Figment delta.
- High: the “59 failures in 19 files” claim cannot presently identify a repair target.
- High: the authorized four-file batch passed all 140 completed behavioral assertions; its sole failure was a 5,000 ms test timeout.
- High: the one-line `Buffer.equals` test repair passes the exact named test in isolation with the existing timeout.
- Moderate: the comparison change is the cause of the timing improvement; different batch load remains a plausible contributor.
