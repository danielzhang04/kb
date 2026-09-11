# Nonpersona visual-ruling validator — acceptance note (2026-09-11)

## Source and acceptance

Actual verified review model: `claude-opus-5` (`figment-claude-visual-ruling-review-20260911-v1`); this model identity is recorded for the independent review evidence below.

Root accepts [`content/nonpersona_visual_ruling.py`](../../orgs/figment/pipeline/content/nonpersona_visual_ruling.py) at commit `0f0c8c46` (parent `8ce2cd64`), raw source SHA
`9d44412256bf82839f4218122db467a8645678360c60a0a030817f28974081d3`, test SHA
`1492adbfd6eb8a81ecb71e0f400b3f76c8ed57d59e73daf22d9ce276b5f5f772`.
The corresponding test file is [`test_nonpersona_visual_ruling.py`](../../orgs/figment/pipeline/content/tests/test_nonpersona_visual_ruling.py).

Independent actual `claude-opus-5` review `figment-claude-visual-ruling-review-20260911-v1` finished READY WITH
COMMENTS, no blockers. The source is unchanged since the first author wrote it; there were no source repair cycles
on this file. Root read the entire source and the final tests directly and rejected both reviewer suggestions as
unnecessary: adding an inequality assertion that native and delivery dimensions merely mean separate concepts, and
relaxing the strict nonempty-role/positive-index checks. The strict checks are retained because the actual brief
producer already enforces them.

## Test authoring and repair

The initial Sonnet test-authoring job was capped by observed context limits and left flawed absolute-path fixtures.
One Opus test-repair pass corrected the paths and a race-condition mutation, and added actual C/D/E plus
UTF-16 and stale-join cases. This flaw is a test-authoring limitation, not a source failure — do not read it as a
defect in the validator itself.

## Test execution

Actual separate `claude-opus-5` executor `figment-claude-visual-ruling-test-execution-20260911-v1` ran the suite:
238 PASS / 0 failure / error / skip, 144.49s pytest time (145.006s wall), 86 new tests plus 152 neighboring tests
(non-overlapping counts). Evidence: `MAIN/_private/figment-visual-ruling-test-execution-20260911-v1.json`, JUnit
`figment-visual-ruling-tests-20260911-v1.xml`, SHA
`ea4b2c9bf10a57ef248dd72117186dd03071d489187ff1b410844c08e016b45c`. All 11 source/test files and the paid ledger are
unchanged before and after the run. The run was recorded from UTC 21:23:37.697874 to 21:26:02.703662. Root has read
the actual receipt and the worker's tool result directly; no repeated test run was performed for this note.

## Scope (what this validator does and does not do)

`validate_nonpersona_visual_ruling(root, path, expected_sha256)` is a read-only check of an externally attributed
human/research ruling against the exact chain of a retained image, its compilation, its prep step, and the original
brief/slot binding it belongs to. It performs two full passes and strictly parses finite JSON, rejecting numeric
overflow and checking an exact caller-supplied SHA. All file access is root-relative with no symlink following.
The input decision `accept-native` is permitted only when `no_person`, `scene_subject_fit`, `realism`, and `native_quality` are `pass`, and `obvious_artifacts` is `none`. The validator does not itself grant image-quality approval.

The validator returns `not_promotable: true`, and reports native dimensions and the separate delivery target without
performing or asserting any delivery transform or quality claim. It exposes no writer, CLI, binder, or
approved/bindable flag. The ruling's attribution is asserted, not authenticated by this code — an externally
supplied research ruling stays a research ruling, not a verified human judgment.

The tests exercise the real producer chain (retained-image → compilation → prep → brief/slot), but use synthetic
PNGs, a fake private ledger, and fixture human rulings. They do not constitute or imply actual image generation,
quality judgment, or production acceptance of any real content.

## What remains

No native paid pilot has launched from this file; it is a validator only, with no binder integration, no writer/CLI,
and no delivery transform. Real visual acceptance, slot binding, and delivery remain unimplemented and unproven.
