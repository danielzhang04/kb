# Figment: Nonpersona Preparation — Acceptance Review (2026-09-11)

## Root Acceptance Decision

Root accepts the image-free nonpersona preparation source for a local checkpoint. The
accepted slice freezes one current C(nonpersona)/D/E content brief slot's exact
brief/request/scene/dependency hashes, a bounded subject, a deterministic prompt,
three fixed seeds, and current base-model pins. Native inference dimensions remain
unset; the delivery target is explicitly 1080x1440. All `generated`, `reviewed`,
`slot_fit`, and `delivered` claims remain false, and `not_promotable` remains true.
This slice contains no image generation, no provider call, no nonpersona asset
binder, and no production acceptance. Local commit `e1ceac49` carries this
accepted slice.

This is a documentation delegation of root's findings; this note does not claim
independent test execution or source inspection.

## Scope

- [`orgs/figment/pipeline/content/nonpersona_prep.py`](../../orgs/figment/pipeline/content/nonpersona_prep.py)
  — SHA `8410287a3cd02291d34108720d2a51e160d43a998f6e786f665cda7f4c8781da`
- [`orgs/figment/pipeline/content/tests/test_nonpersona_prep.py`](../../orgs/figment/pipeline/content/tests/test_nonpersona_prep.py)
  — SHA `fd5ab90c4750f97e7488ce0e4aa7f4bb80d25e87302df8a7d5ada9fc0b2eeeea`

Path arguments are normalized via `as_posix`; string traversal and absolute paths
are still rejected. Build requires a fresh output path. Revalidation reads the
stored output and reconstructs current producer values using strict JSON type
equality.

## Evidence

Private evidence root, `MAIN = C:/Users/danie/kb/_private/`:

- `MAIN/figment-nonpersona-root-20260911-v4.xml` — 57 tests pass, 3.08 seconds,
  including the content brief regression suite.
- `MAIN/figment-claude-nonpersona-independent-review-20260911-v1/result.json` and
  `MAIN/figment-claude-nonpersona-final-delta-review-20260911-v2/result.json` —
  actual responding model claude-opus-5, verdict READY WITH COMMENTS, no blockers.
  Root reviewed both.
- `MAIN/figment-nonpersona-current-cli-20260911-v4.json` — current source hash
  unchanged; actual D/E module CLI rc 0 plus C CLI from the attributed v3 receipt;
  all three stored outputs revalidate through the relative Path API with equal
  JSON, inputs unchanged. Output hashes: C
  `b728f90366e581505316f79a3d72699d257ecf4e0466447d19050c06b008164b`, D
  `e84288d02e6d44e05d699af739876a93c14cd1ab1152ff9192006e76da1afe52`, E
  `e58940696b6ba2f732063b8098a9a7620363c406e4690da9e03650e1361a4914`. The final
  verification's actual responding model was claude-opus-5; implementation and
  test fixture workers were claude-sonnet-5.

Earlier CLI runs are not treated as current proof: v2 passed absolute paths and
correctly failed; v3 omitted D and used the wrong E scene — both were worker
command errors, preserved as failures rather than product bugs. CLI receipt v1
predates the Path fix and is not claimed as current-source proof.

## Remaining Limitations

- The cheap word/trigger guard is not semantic safety.
- Local unsigned records carry hash/read concurrency limits.
- Malformed trusted-pin validation needs strengthening at a native compiler
  boundary.
- Partial I/O failure is not guaranteed atomic rollback.
- No approval artifacts or production media are created in this slice.

## Deferred Work

The native compiler, retained-output validation, reject-any-person visual review,
slot-fit binding, and exact-byte delivery remain separate pending work. The native
compiler is not accepted by this review.
