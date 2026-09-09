# Generated-input viewer join note — 2026-09-09

The dashboard collector now consumes the actual accepted curation source bundle.
Before repair, a read-only probe of
`_private/figment-builtin-dataset-20260909-v1/curation-staging/sources` found 21
PNGs and 21 provenance files. `MAX_SCAN = 34` rejected that 42-file
directory before parsing. Actual sidecars are named `<image>.png.provenance.json`,
while the collector derived `<stem>.provenance.json`. The parser also
requires `generation`, but the valid producer record instead has `tool`, `model`,
`review`, and `curation`, with no `generation` object.

The compatible repair is confined to `generatedInputs.ts` and its tests:
`MAX_ITEMS` is 24 and `MAX_SCAN` is 50 while retaining the 64 MiB
aggregate image cap; resolve exactly one of `<stem>.provenance.json` or
`<image>.provenance.json`, rejecting an ambiguous pair when both exist; and make
`generation` optional so `generatedOn` remains null for the producer shape.
Continue requiring schema `figment/generated-input-experiment@1`, creator-001,
exact output filename and current image SHA, optional byte equality, canonical
`anchors/g01.jpg` and live g01 SHA, and a bounded nonempty review status. The
reader must use the same unambiguous sidecar resolver as inventory collection.

Eleven focused tests cover the real 21-pair naming and no-generation shape,
both conventions individually, ambiguous dual sidecars rejected for inventory
and direct asset reads, the 24-item/50-entry bounds, source/output/review binding
failures, unchanged 64 MiB behavior, and an exact hash-bound asset read. No
provenance, ruling, approval, or image bytes need rewriting.

The post-repair actual probe reports all 21 items without truncation and an
accepted exact read of `01-turn-left.png`. Its served bytes retain SHA-256
`38176c8589fdfac70196cce03355dceba47d8ac1e0861bdbabde0c8b1fb11de4`.

Independent review is READY and TypeScript typecheck passed. Root's affected
collector and route regression run passed 29 tests in 13.82 seconds. The separate
actual `buildApp` injection probe verified all 21 authenticated asset responses
against their original bytes and SHA-256 hashes, totaling 44,932,387 bytes.
Responses carried `image/png`, `no-store`, and `nosniff`; a stale hash returned
409 and unauthenticated access returned 401. No listening server was started.
The private receipt is MAIN
`_private/figment-generated-input-route-verification-20260909.json`, SHA-256
`6786d243bb73cf545fcc5f36004e4ff32e61ef4e0eec9490ea674533919e8c1c`.
This validates the read-only gallery join, not deployment or identity acceptance.
