# Raw reference observations

This records one local, raw-observation run on 2026-09-08. It is not a calibrated identity score, quality decision, gate input, approval, or promotion record. It changes none of the existing identity calibration, thresholds, or visual-review conclusions.

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
