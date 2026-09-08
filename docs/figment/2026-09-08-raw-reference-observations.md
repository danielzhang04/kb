# Raw reference observations

This records native V1 and fixed640 V2 local raw-observation runs on 2026-09-08. It is not a calibrated identity score, quality decision, gate input, approval, or promotion record. It changes none of the existing identity calibration, thresholds, or visual-review conclusions.

The admitted pin manifest was `e2886b2ec453970ee0222a7df8fa8d11f1afd7002feef5f8cdd469fc148d717a`. The separately verified local adoption receipt was `1e0b3a3ed6ef9c7be987eaddc7741e7a90c19e73da9e6b5df363c71cb2db076b` (`verified-artifacts-and-venv`). The venv recorded NumPy 2.2.5, Pillow 12.3.0, and `opencv-python-headless` 4.12.0.88. YuNet used its pinned 0.9 score threshold, 0.3 NMS threshold, and 5000 top-k; SFace emitted only transient features used to calculate the raw cosines below.

The immutable input inventory is `_private/identity-observer-batch-inputs-20260908-v3.json`, SHA-256 `932fd347611e95e5b0d338b4efe0a842fa5daa05d2147c7fd39cad6cc24002c7`. Before each of the 19 public `identity_observe.observe` calls, the runner rehashed the admitted pin manifest, that candidate, and all three declared anchors. It wrote fresh receipts under `_private/figment-identity-observer-20260908/observations-v1/`; the aggregate receipt is `batch-run.json`, SHA-256 `872872b2d3c28d227db74adcfaeec8e61620879733afb3951b1619dfb39c26c0`.

`g01`, `g02`, and `g07` denote the declared reference files. A dash means the observer recorded an unavailable value, never a zero. `g02` was unavailable as an anchor in every otherwise available call because YuNet reported multiple faces. The paired outputs were unavailable as candidates because YuNet reported no face. Neither condition is evidence about identity, realism, or image quality.

| Input group and ID | Candidate state | Raw cosine to g01 | Raw cosine to g02 | Raw cosine to g07 |
| --- | --- | ---: | ---: | ---: |
| Declared reference: g01 | one face, 0.935717 confidence | 1.000000 | — multiple faces | 0.757836 |
| Declared reference: g02 | unavailable: multiple faces | — | — | — |
| Declared reference: g07 | one face, 0.937152 confidence | 0.757836 | — multiple faces | 1.000000 |
| Single-seed: frontal black tee | one face, 0.921379 confidence | 0.880391 | — multiple faces | 0.676574 |
| Single-seed: small head turn (image SHA starts `55e60a`) | one face, 0.940374 confidence | 0.886538 | — multiple faces | 0.649704 |
| Single-seed: wardrobe only | one face, 0.944169 confidence | 0.917027 | — multiple faces | 0.701820 |
| Paired diagnostic candidate, seed 1595 | unavailable: no face | — | — | — |
| Paired diagnostic control, seed 1595 | unavailable: no face | — | — | — |
| Paired diagnostic candidate, seed 271828 | unavailable: no face | — | — | — |
| Paired diagnostic control, seed 271828 | unavailable: no face | — | — | — |
| Paired diagnostic candidate, seed 314159 | unavailable: no face | — | — | — |
| Paired diagnostic control, seed 314159 | unavailable: no face | — | — | — |
| Paired diagnostic candidate, seed 481516234 | unavailable: no face | — | — | — |
| Paired diagnostic control, seed 481516234 | unavailable: no face | — | — | — |
| Paired diagnostic candidate, seed 90210 | unavailable: no face | — | — | — |
| Paired diagnostic control, seed 90210 | unavailable: no face | — | — | — |
| Native-resolution V2 extracted first frame | one face, 0.944420 confidence | 0.882053 | — multiple faces | 0.735150 |
| Native-resolution V2 extracted middle frame | one face, 0.944863 confidence | 0.872274 | — multiple faces | 0.709191 |
| Native-resolution V2 extracted last frame | one face, 0.937171 confidence | 0.794009 | — multiple faces | 0.695203 |

The declared-reference rows are observer pipeline controls. The g01/g07 self-values are the mathematical self-comparisons of the same extracted feature; they do not validate reference quality or establish a threshold. The g01/g07 cross-value confirms only that this fixed detector/recognizer produced a raw number for those two selected crops. It cannot establish a comparison to g02, which remained unavailable under the exactly-one-face rule.

The three single-seed inputs and the V2 sample frames can be compared only as unthresholded raw observations against the available g01/g07 embeddings. The V2 rows are frame samples, not temporal QA. The paired candidate/control test does not provide a numerical arm comparison here because all ten files were unavailable to the detector; their nulls must not be converted into a difference or a failure.

This run does not resolve the existing independent visual-review disagreement about resemblance. It uses one detector and one recognizer with a strict exactly-one-face rule, has an unavailable declared reference, and has no calibration for this persona or image distribution. Human visual observations remain separate evidence. No embedding, pass field, threshold update, or approval was persisted.

## Fixed640 v2 run

The reviewed `fixed-max-edge-640@1` mode then observed the same 19 inventory inputs into fresh receipts at `_private/figment-identity-observer-20260908/observations-v2/`. Its aggregate receipt, `batch-run.json`, has SHA-256 `56c6e76c40ad25f5954522316630dc71542403b7778530eceb04f6d14cd5873c`. It binds inventory v3 SHA-256 `932fd347611e95e5b0d338b4efe0a842fa5daa05d2147c7fd39cad6cc24002c7`, admitted pins SHA-256 `e2886b2ec453970ee0222a7df8fa8d11f1afd7002feef5f8cdd469fc148d717a`, adoption receipt SHA-256 `1e0b3a3ed6ef9c7be987eaddc7741e7a90c19e73da9e6b5df363c71cb2db076b`, and observer-code SHA-256 `b192d736e034151cd206cd5f5a7ae8c8cd9f862cd21588ad821041699f6b26c0`.

The same no-upscale, aspect-preserving `INTER_AREA` max-edge-640 detector rule was used for every candidate and anchor. All 19 candidates and all three anchors had exactly one detector face in this run. This restores availability only; it does not create a threshold, approval, quality ranking, or calibration. V2 values are not cross-version comparable with native V1.

| Input group and ID | Raw cosine to g01 | Raw cosine to g02 | Raw cosine to g07 |
| --- | ---: | ---: | ---: |
| Declared reference: g01 | 1.000000 | 0.794018 | 0.751242 |
| Declared reference: g02 | 0.794018 | 1.000000 | 0.722026 |
| Declared reference: g07 | 0.751242 | 0.722026 | 1.000000 |
| Single-seed: frontal black tee | 0.817836 | 0.701930 | 0.685501 |
| Single-seed: small head turn | 0.774957 | 0.663709 | 0.627913 |
| Single-seed: wardrobe only | 0.876068 | 0.762237 | 0.760086 |
| Paired diagnostic candidate, seed 1595 | 0.506589 | 0.478306 | 0.468672 |
| Paired diagnostic control, seed 1595 | -0.105025 | -0.074230 | -0.166134 |
| Paired diagnostic candidate, seed 271828 | 0.508551 | 0.465049 | 0.400115 |
| Paired diagnostic control, seed 271828 | -0.083391 | -0.111365 | -0.147503 |
| Paired diagnostic candidate, seed 314159 | 0.449867 | 0.384514 | 0.460016 |
| Paired diagnostic control, seed 314159 | 0.010783 | -0.051054 | -0.106896 |
| Paired diagnostic candidate, seed 481516234 | 0.456757 | 0.372836 | 0.395512 |
| Paired diagnostic control, seed 481516234 | -0.031000 | -0.041432 | -0.067868 |
| Paired diagnostic candidate, seed 90210 | 0.536151 | 0.459535 | 0.472120 |
| Paired diagnostic control, seed 90210 | -0.054224 | -0.066063 | -0.143771 |
| Native-resolution V2 extracted first frame | 0.899740 | 0.764377 | 0.766767 |
| Native-resolution V2 extracted middle frame | 0.864712 | 0.727425 | 0.743426 |
| Native-resolution V2 extracted last frame | 0.735771 | 0.607123 | 0.587768 |

Reference self-values remain pipeline controls only. The paired rows are a matched diagnostic under a fixed prompt and sampler, not a causal explanation or quality ranking. The previously visually rejected frontal image remains visually rejected: a raw V2 cosine does not replace independent visual review. No legacy gate, threshold, pass field, or promotion state changed.
