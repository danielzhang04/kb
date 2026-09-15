# Nonpersona delivery-ruling acceptance checkpoint — 2026-09-11

Root accepted the bounded read-only nonpersona delivery-ruling source and tests at REVIEW commit `57590274` (parent `a786d14f`) at 2026-09-12 00:01 UTC, which is still September 11 locally. The commit contains exactly the four assigned source/test files, with 895 additions and 3 deletions.

| Frozen input | SHA-256 |
| --- | --- |
| `content/content_brief.py` | `61d92f13a8ac228b2d77969388c550bed67212bc43486583943d858dabe22998` |
| `content/tests/test_content_brief.py` | `d211c594d6ae98aa1ae4089f755b1dc17eb944ca47730f53e6f36dc10e17d0e6` |
| `content/nonpersona_still_delivery_ruling.py` | `3bdfc4d8c1031ccd19752c5fc41dca2cca4393888cb7a40dfc5d77bb88a2f4cf` |
| `content/tests/test_nonpersona_still_delivery_ruling.py` | `a6cc2f3544e6238444b48a1e89abd0364209e23bd78da2f1938f91a8d58d4896` |

The ruling uses the accepted delivery revalidator as its sole authority. It binds an externally attributed assertion to the exact current delivery receipt, output, brief, creator, slot, and full transform, then tests six fresh criteria. Its result is always `not_promotable`.

The first focused runtime execution was evidence of a product defect: V1 collected 69 tests and returned 68 pass, one fail, zero error, and zero skip. A leading-slash, no-drive Windows path bypassed the inherited `content_brief._relative` boundary. This was neither a selector problem nor a harness failure. The earlier source-only review `64f37bdbd29c0fc825807d6e933242c1d22017fa80ba5fdad329a2ba7925692d` missed that inherited boundary and is superseded for acceptance purposes.

Repair round 1 was minimal and shared: `_relative` now checks host and `PureWindows` root, anchor, and drive forms. The delivery-ruling source is unchanged. The rooted repair report is `1cccfb3e`; independent report `0b26c80e9a52b068c5005d3472dadacc99cf73284cad3e81c4c9064ac6a55060` is READY WITH COMMENTS/security PASS. No receipt was rewritten.

V2 performed one fresh full run of `test_content_brief.py` and `test_nonpersona_still_delivery_ruling.py` together. It began 2026-09-11 23:58:09.759834 UTC and finished 2026-09-12 00:00:41.318856 UTC: 107/107 passed (35 brief and 72 ruling), with zero failures, errors, or skips; pytest took 150.84 seconds and wall time was 151.559 seconds. All thirteen captured source/test pins and the paid-ledger SHA `01c383e348746b9be43cc4ebda7ca2ce41052c7a611e13febccf2271d4580f6b` were byte-identical before and after. The structured result SHA is `24b2ffbd6ca26e30a03755a0dfad1d9759e997f6aa0d1ba583e8f2f0aa4d6e9e`; JUnit SHA is `eb8112fd83ec8923902314fedb3bb1a3daac13fe314463b02abf1716fdce3782`.

This acceptance is technical and synthetic-fixture-bound. It does not authenticate a human identity, create a real ruling, prove real image or transform quality, establish publication authority, or create a real nonpersona delivery. Native records derived from the old `content_brief.py` pin are stale; retained, NVR, and delivery descendants need fresh current preparation. Historical receipts stay intact, and a preparation can be reused only if its own revalidator passes.
