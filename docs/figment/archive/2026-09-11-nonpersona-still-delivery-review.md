# Figment nonpersona still-delivery review — 2026-09-11

## Accepted local checkpoint

`content/nonpersona_still_delivery.py` is an accepted direct-NVR still-delivery producer, SHA-256
`851e9ca6aaae7dee22233f75fbc81678b644da410cda2a816c6d9737cb8438fc`; its authored test file
is SHA-256 `73fafde0b2799de716b1b49d4e657be24bf7e82797744388ef918563071f0ca1`. It implements the
accepted amended design as one producer and one test file, without assignment, binder, or UI edits.

The implementation author reported candidate completion and syntax checks; the independent source
review is READY WITH COMMENTS and security review passed. Root caught pre-freeze
`getexif()`-before-verify and final-output-stability-after-second-NVR defects, which the author
corrected before freeze. Pre-freeze test repairs covered constants, ICC, forged hashes, and a `NameError`. The
optional low observation that a runtime disk hash cannot attest already-loaded bytecode has no
framework hot reload path; root documented it and made no product change.

Root accepted and committed the producer/test at `a0074da8` (parent `482017b3`), exactly two files
and 1,353 insertions. Final independent review is READY WITH COMMENTS and no open blocker; report
SHA-256 `f749a2775659227c8b9ec6367a32b4675744c58093a8aa25f278b77d3b385471`. The low loaded-bytecode
limitation is accepted: no hot-reload framework exists and no source change is warranted.

The focused v1 test run collected 37 tests: 36 passed, one
skipped, zero failures/errors, in 299.79 seconds pytest time (300.447 seconds wall,
22:56:35.469127–23:01:35.917716 UTC). JUnit and the actual receipt show the skip was a test-fixture
collision: `_compile('reparse')` had already created `reparse-request.json` before the symlink used
the same name; `WinError 183` was caught as a generic `OSError`, so the reparse-request refusal did
not execute. The earlier privilege-unavailable diagnosis is retracted. A narrow test-only repair
then limited skips to actual permission/unsupported cases, and the exact repaired node passed in v3
as recorded below. Product source remained frozen throughout.

The direct script `revalidate` command passed in 2.002 seconds over the existing `fdv1` fixture,
leaving its tree unchanged. It validated the existing receipt
`40cd70eab8bbd22bd97cf98e8a436a2cd9510ccf45d34c79c1238e27dbfe6190`, delivery PNG SHA-256
`5e2c0c240d781af2a98185f9614c6f5e3733609d468b4bc0848cc9f35ab0dcb9`, and RGB SHA-256
`08c2a44957ddbbad9d758a40e91c95ec38953bc78affeb74c95b36c2245535ed`. Runtime was Python
3.13.7, Pillow 12.3.0, and zlib 1.3.1. The comprehensive v1 verification receipt is SHA-256
`9c7f811d833d37562bf2b7a47f1703207a1ca03b9eda7b4167d1c8b969c553af`; ten source/test/dependency
pins and the September 11 ledger SHA-256
`01c383e348746b9be43cc4ebda7ca2ce41052c7a611e13febccf2271d4580f6b` stayed unchanged.

All evidence uses synthetic fixtures. It does not establish a real human ruling, real media quality,
delivery quality, publication approval, or any provider action. Requested tiers are known (Sol
author/reviewer and Terra test/executor); actual responding model, usage, and cost remain unknown
where receipts do not expose them.

## Next gated work

The v2 repaired-node attempt is a harness error before test execution: a dotted-module selector was
used instead of the exact `file.py::node` path (return code 4, zero tests, 0.06 seconds pytest/
0.675 seconds wall). Pins and paid ledger stayed stable. It is neither a product failure nor a pass.
V3 then passed the repaired node 1/1 with zero failure/error/skip in 5.83 seconds pytest (6.451
seconds wall, 23:10:54.951856–23:11:01.402880 UTC); receipt SHA-256
`8cf3560ee49afc004d6cf7a1a560db467638bdcf30d90ab7a61fc2f139b7cdd4`, JUnit SHA-256
`517b3a8df43d127134909e5fa71d37cb4e11d616e9e7f65b3255a8336f6ade78`. With v1, this is 37
distinct passing nodes, not one fresh clean 37-test run. V3 pins only source, repaired test, and
paid ledger; do not attribute v1's ten dependency pins to it. Final independent evidence delta and
commit are complete; this source acceptance remains synthetic-fixture evidence only.

Root has separately accepted and dispatched the next delivery-ruling implementation: one read-only module
and test binding the current finished output/receipt/brief/creator/slot/transform to six fresh
delivery criteria. It has no writer, CLI, binder, assignment, UI, real ruling, or quality approval,
and independent tests follow when a slot is free.
