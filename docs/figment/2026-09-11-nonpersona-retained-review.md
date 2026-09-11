# Nonpersona retained-output boundary - acceptance note - 2026-09-11

## Scope

Root-accepted commit: `c00d6c92` (parent `3356ae50`; native compiler dependency `eca89f48`).
Source, implementation and tests by Claude; review and adjudication by root.

New content, all under `../../orgs/figment/pipeline/`:

- [content/nonpersona_retained.py](../../orgs/figment/pipeline/content/nonpersona_retained.py)
- [content/tests/test_nonpersona_retained.py](../../orgs/figment/pipeline/content/tests/test_nonpersona_retained.py)
- [content/tests/test_nonpersona_retained_numeric.py](../../orgs/figment/pipeline/content/tests/test_nonpersona_retained_numeric.py)

Source SHA: `b8fecf3e52cd8f67aa02afadeb439f181e3ac60cd66e50d36ab216cebcae0c2b`.

## Test evidence

Final accepted run: 152 PASS, 0 fail/error/skip, 47.46s (symlink test passed on Windows).
Evidence: `MAIN/_private/figment-retained-test-execution-20260911-v2.json` and
`figment-retained-tests-20260911-v2.xml`. This 152 count spans native/prep/brief tests
alongside the retained-output tests; it is not additive with the earlier 150 (v1) or the
80 native-compiler count from item 5 - those overlap this suite rather than sum with it.
Breakdown within the retained-boundary work: numeric file 12 cases, broad retained 60,
compatibility 80.

## Independent review

Full review `figment-claude-nonpersona-retained-review-20260911-v1`: READY, comments only,
no blockers. Root then empirically found a JSON parser overflow (`1e999` -> `inf`) accepted
as job seconds; probe recorded at `MAIN/_private/figment-retained-overflow-probe-20260911-v1.json`. One
product-source cycle added a local recursive finite-float wrapper at all retained JSON
boundaries plus a direct seconds check, preserving the native/shared source. The follow-up
delta/test review `figment-claude-retained-delta-tests-review-20260911-v1`: READY, comments
only; root read the final test-precision delta and confirmed the 152 passed. Optional
`allow_nan=False` hardening was judged not required; code was unchanged after the
test-precision fix.

## Behavior accepted

Native compilation revalidator, explicit non-dry receipt, existing teardown/ledger
agreement, strict job/seed/file byte-count/name checks, full PNG verify and decode at
1448x2176 single-frame, embedded `apply_job` graph equality, bounded reads within contained
paths with no symlinked run files, and an immutable hash-bound retained record. A generated
technical claim is true only after these checks; reviewed/slot-fit/delivered claims remain
false; not-promotable is true. Native 1448x2176 is a separate target from the 1080x1440
delivery target - no crop is implied. Record writes use a build-around-pending fsync plus
exclusive hard-link commit, with no fallible cleanup step afterward. Revalidation is
read-only over exact fields and bytes; a duplicate pending record must match.

## CLI verification

Positive CLI coverage inside the 152-test suite uses a synthetic, live-shaped fixture: a
fake pod, the `.01` private ledger, and solid-color PNGs - no real generation occurred.
Negative CLI testing replayed 3 old harness dry-run outputs; all returned rc 2 and left all
50 existing files unchanged (`MAIN/_private/figment-nonpersona-retained-dryrun-rejection-20260911-v1.json`),
predating the numeric fix by source hash. An earlier claim about a missing dashboard-ops
ledger check was wrong and is not accepted; the subsequent overflow probe and both suite
executions confirmed the correct OPS paid ledger (`01c383e3...`) was unchanged.

## Limits

Hard links are required and a pending failure blocks directory retry pending manual owned
cleanup, which is not yet provided. Local unsigned records are not cryptographic proof of
GPU origin. Pillow honors the last prompt chunk on conflict. Code/interpreter absolute-path
binding is not portable. Revalidation must precede any future use; concurrent local writers
are not an authenticity boundary. No visual approval step, review-ruling consumer,
nonpersona slot binder, or delivery transform is implemented yet, and the existing binder
still rejects nonpersona content. The three-image cafe pilot has only a prospective plan and
active local preflight - no launch or completion is claimed here; root will record live
pilot status separately. The retention question addressed here is strictly technical:
real-output retention, $2.50 and 115-minute cap for three images, one placement, zero uploads, no automatic
search.
