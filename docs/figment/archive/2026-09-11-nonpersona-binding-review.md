# Figment native-source binding review — 2026-09-11

## Accepted local source checkpoint

Root accepted the v3 nonpersona native-source binding at `bb9b8db2` on
`codex/figment-research-review-20260909` (parent docs checkpoint `04ee7bcf`). The
implementation is six source/test files, 669 additions and 28 deletions. The Python binder is
SHA-256 `e2647f8f8ab0c58ba5ec269aea58492d4b393f89798f680b0c1c3a00ad0789a4`; the final
new test file is `0a8ea92608b81f2931494694ceef621ad81e9674360e71f456b4c2804cad369f`.

This acceptance implements only the contract in
`MAIN/_private/figment-nonpersona-binding-contract-20260911-v1.txt`, including its amendments:
native scene-source planning may bind a current nonpersona C/D/E carousel slot to an
externally attributed human `accept-native` ruling and the exact current brief, slot and creator.
The new path uses the v3-only UTF-16/UTC-`Z` attribution bounds, a distinct `kind:id`
uniqueness namespace, and projects exact native-source state. Its server projection does not
expose private paths, hashes, ruling criteria, or reviewers; the UI label is `Recorded plan; scene
images still need delivery review`.

It does **not** authenticate a human, create a real ruling, approve media, transform an image,
assess delivery quality, or authorize delivery. The output remains `not_promotable`; native state
is `native-source`, delivery quality is `not-assessed`, and delivery transform is null. Old v1/v2
behavior remains intact.

## Evidence read

- UI receipt `MAIN/_private/figment-native-binding-ui-verification-20260911-v2/receipt.json`
  records 68 passing tests, zero failures/errors/skips, successful typecheck and build, and four
  stable TypeScript hashes.
- Python v2 receipt records 51 passing and two failing nodes. The first focused v3 receipt records
  one motion pass and one mixed-flow failure. The final focused v4 receipt
  `MAIN/_private/figment-native-binding-python-verification-20260911-v4/focused-v4-receipt.json`
  records the repaired mixed-flow node passing in 205.44 seconds pytest time (210.573 seconds
  wall), with the source/test pins and September 11 paid ledger unchanged.
- These are **53 distinct passing nodes**, not a fresh all-green full-suite run and not a sum that
  double-counts the focused paths. v1 was blocked by 46 shared-temp permission errors; v2 exposed
  the long-path Windows child-process failure. The two test-only repairs were creating `root/out`
  and passing the legacy binder a relative `Path.as_posix()` value. Product source was unchanged.
- The v1 old-byte-after receipt records return code 0 and `all_equal: true`: v1 still remains
  2,777 bytes, SHA-256 `1923fc6e961616c1a1894dc6c911492015a4cf6eab396134ed463382cefdc95c`;
  v2 motion remains 2,786 bytes, SHA-256
  `2ca4b7fddba7330a8f203f0cf27b6b531e6cfb844fe287eb590be9a46fb32739`. Fixture inventories
  and serialized results match. It pins old binder
  `d08a016bdde0c587c2897ede8c59e81bf55cd366a4ef7eb9dd727a9c4fd63889`; its September 7 ledger
  pin is not evidence of September 11 ledger stability. The v2/v3/v4 receipts correctly pin the
  unchanged September 11 ledger SHA-256
  `01c383e348746b9be43cc4ebda7ca2ce41052c7a611e13febccf2271d4580f6b`.
- Cross-language v2 produced the real mixed CT5 A/D/C/A assignment from two synthetic human
  rulings: the 128-emoji/fractional-UTC positive binder command passed and the 129-emoji command
  refused with exit 2 and no output. The brief
  `3b16cc982d111360ff7394ec8263972432ba7bdad7f6f9698fbeb8f3489ee6d6` and assignment
  `7eb2da969ca3dd58f403156e3c45cb13c2024baa05d5b9419018eaa7be209254` were byte-exact when
  copied into the collector layout. The original Vitest alias failure preceded test execution;
  isolated v3 corrected the JSX-dev alias only and records one pass, zero failure/error/skip in
  8.16 seconds Vitest (9.092 seconds wall), with all 16 source/evidence pins stable. Receipt SHA-256:
  `2f21926562b13026496f99c4a6813c97eec7114443ad7e0c5cbb2612457975a3`.

The independent combined code/security report first requested changes for the missing `out`
fixture. Its final evidence delta independently verified the second `.as_posix()` test-only repair
and the runtime receipts, then issued a superseding **READY** verdict for committed source
`bb9b8db2`, with no open concrete finding. Report SHA-256:
`ce6d14295effa7d048cfd08ee4f32a09b3f5a4964f5e54035e000928697fa8cc`. The review still does
not turn bounded, synthetic source-planning tests into delivery or media acceptance; requested
model metadata remains requested-only where a receipt does not expose the actual response model.

## Boundaries and next work

The earlier claim that a zero-byte file caused the cross-language failure is retracted: a directory
stat size was misclassified as a file. The original fault was the v1 partial fixture missing `out`.
No provider action, spend, ledger mutation, consent gate, native paid pilot, Studio brief producer,
or default-auth work was performed. The paid ledger remains at arc `$33.489565/$50` and day
`$2.859835/$10`.

Root accepted all four bounded adversarial-design recommendations as an amendment to the original
still-delivery design. Implementation and independent test authoring are being dispatched for
exactly `content/nonpersona_still_delivery.py` and
`tests/test_nonpersona_still_delivery.py`: a direct NVR consumer, with no assignment, binder, or
UI edit. The amended contract requires closed receipt schemas; key-presence refusal for transparency
and named metadata; direct encoded PNG-byte and reconstructed RGB equality; stable reads and
exclusive final publication; real upstream fixture coverage; an independent code/security review;
and at most two source-repair rounds. Source and tests are not yet written or accepted. No provider
action or quality approval follows. Real identity, media-quality, full Studio, video, and reel
delivery remain unfinished.
