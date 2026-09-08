# Local generated-input adoption review - 2026-09-08

## Imported diagnostic record

The root-owned importer published the completed local simple-portrait diagnostic
as a generated-input record. This is a rejected, training-ineligible diagnostic
record; it is not an approval, a new reference, or a training example.

| Item | SHA-256 |
| --- | --- |
| Published provenance | `cad8020f5eff246ce8a2b300a85fba6516db1415715b98806fae5d68e6a5636e` |
| Published PNG | `06c468272f74c9c52b8f8b161ae0df467c8bd5451e1a15463f3b156b2e3c618b` |
| Local manifest | `7bad7f10091acfa0604d8aab05b2a5726c469bb8799ae77d487ac7764c3a5d05` |
| Completed receipt and journal | `97b968517a444fed7945e7ef6bd50c1472a9f94696996ef69e2abfe1b7c3aeae` |
| Fixed640 observation | `f8345d03f0731fafad3a5118c0ea5808c21040cab9da14a9667f6def1d930c82` |

The imported PNG is 1,180,068 bytes at 1024 by 1024. Its provenance binds
canonical `g01.jpg` through the materialized 384-square crop
`5d6045e15a8d025ad33912234230c257678292331abdf122998ba4cefa28f27c` and
states `independent_view: false`. Its review is
`rejected-as-same-person-candidate` with `training_eligible: false` and no
operator approval. The underlying receipt records verified teardown; that
runtime fact does not override the recorded visual rejection. See the
[local simple-portrait review](2026-09-08-local-simple-portrait-review.md) for
its evidence-bound visual and raw-observation limitations.

## Fixture gallery QA

A fresh v5 capture used the owned local preview fixture at `127.0.0.1:5419`
with actual Figment routes. It rendered six generated-input cards and nineteen
images. Desktop used two generated-card columns; the 390-pixel mobile capture
used one. Both state captures recorded `overflow: false`, six visible source
and hash summaries, and one `Recorded observations` label per card.

| Capture | SHA-256 |
| --- | --- |
| Desktop screenshot | `a4e093eecd03cf50987098b9640fa2cbf1a95bdaef5aebba50c881f23cce5727` |
| Mobile screenshot | `417c0f82e46ff5dd7c37654f9a3b88e2f62c42a2d2f85493043d4c024afe788e` |
| Desktop state | `cbf49995ea8c36c8a68fd358eeea56242c130ed5a916199e02df06238987fadc` |
| Mobile state | `086786affe183dfdab886ae498100edac8c52793ae8bc9744a2e90d8922d9747` |

The generated-asset endpoint on that fixture returned the new PNG as HTTP 200,
`image/png`, `nosniff`, and `no-store`, with the published byte count and hash.
The fixture is not an authenticated production session; production route
registration and authentication are covered separately by their existing tests.
After capture, `Emulation.clearDeviceMetricsOverride` ran on the owned preview
tab, restoring its normal desktop metrics.