# Nonpersona native compiler — acceptance note (2026-09-11)

Local proposal only. No ops promotion, push, merge, or deploy.

## Acceptance

Commit `eca89f48` ("Compile nonpersona slots into bound offline native manifests"), parent `8ec513d6`, is accepted locally on `codex/figment-research-review-20260909`.

- Native source: [`orgs/figment/pipeline/content/nonpersona_native.py`](../../orgs/figment/pipeline/content/nonpersona_native.py) — SHA `81afcb5a57d522214d69dc45cd42e52db02b4efffdf48003206e35152b6fd93c`
- Tests: [`orgs/figment/pipeline/content/tests/test_nonpersona_native.py`](../../orgs/figment/pipeline/content/tests/test_nonpersona_native.py) — SHA `f90b70cc85ce940c1b1d70199ed4455cfcb213724c290b17900a25b533eb443f`
- Result: 80 tests PASS in 8.35s.

## Execution and review evidence

- Actual Opus execution receipt: `MAIN/_private/figment-native-test-execution-20260911-v2.json`, JUnit `figment-native-tests-20260911-v2.xml`.
- First execution attempt was 65 PASS / 15 FAIL, all failures traced to a missing register-spec fixture; an exact-byte fixture correction fixed all 15 with the production guard left unchanged.
- Independent Opus delta review: READY WITH COMMENTS, no blockers — `MAIN/_private/figment-claude-native-delta-review-20260911-v2/result.json`.
  - Known nonblocking comment: wording overclaims final-file absence if another writer precreates the target; the implementation itself correctly preserves/rejects such a target.
- Real C/D/E CLI, exact revalidation, `require_manifest`/`apply_job`, stored argv plus `--dry-run`, and actual bootstrap all PASS: `MAIN/_private/figment-nonpersona-native-real-join-20260911-v3/result.json` (fixture, compile, verify receipts alongside).
  - Three jobs, fixed seeds 1595 / 481516234 / 90210, no LoRA/uploads/training/artifacts/`wait_for`.
  - Native resolution 1448x2176, separate target resolution 1080x1440.
  - Real bootstrap: `cd /workspace/ComfyUI && python main.py`.
  - Dry-run uses `run/dry-run-ledger`, not the configured production ledger; placeholders, not real generation.
  - Earlier v1/v2 join attempts failed on missing anchors/register spec and are preserved, not accepted.
  - No paid run was made. All seven checked source files and the paid ledger are unchanged.

## Repair history (source, prior to acceptance)

The native source's initial Opus review was NOT READY: the tester launcher referenced a missing train-only script. Repair cycle 1 fixed this by:
- Using the harness plain-launch path on a copied ComfyUI configuration, a plain `python main.py` startup launcher, instead of the missing train-only script the original tester uses.
- Late record fsync/publication: write pending, `fsync`, then commit via exclusive `os.link`, with no fallible cleanup step after the commit.

Hardlinks are required; partial directories and pending records are retained. A local unsigned exact rebuild is not treated as hostile-filesystem authenticity, so no adversarial-filesystem hardening beyond the above was required for acceptance.

## Previously accepted dependencies

- `e1ceac49` — image-free nonpersona C/D/E preparation, 57 tests PASS. The 80-test native run above includes 23 native tests plus these 57 existing prep/brief tests; they must not be added again on top of the 80.
- `6fe45adb` — shared native tester graph helper, 73 tests PASS in 153.91s, byte-identical tester graph proof (`MAIN/_private/figment-tester-base-before-after-20260911-v2.json`). This 73-test helper suite is a separate, unchanged, previously accepted proof and was not rerun here.

## Scope note

This acceptance covers the native compiler source and its manifest/CLI join only. Retained-output implementation (actual generation runs bound to real files/graphs, rejection of dry-run evidence as production evidence), visual review, and delivery binding are a separate next slice, not yet implemented or accepted. No paid generation, no visual approval, and no delivery have occurred against this compiler.
