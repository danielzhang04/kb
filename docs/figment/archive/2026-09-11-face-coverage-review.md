# Face-coverage and drift audit — 2026-09-11

**Status:** the local face-coverage/drift audit has run and completed. This replaces the
earlier "not yet run" / "underway" language in the [whole-plan progress](2026-09-10-whole-plan-progress.md)
and the [research book README](../../orgs/figment/research/book/README.md). This report is
descriptive only: it makes no causal drift claim, sets no accept/reject threshold, and is
not a training-selection or retrain decision.

## What ran

`MAIN/_private/figment-face-coverage-audit-20260911-v2/audit.py` completed with exit code 0
in 38.529s. All 33 expected records were available (33/33; 0 unknown, 0 error, 0
deadline-not-run). Source images, face-detector models, and pin files were verified intact
before and after scoring. Pinned artifact hashes:

- 33-image audit adapter SHA256: `5000effe543997ec7958ad9946acef1e634bc79789a46f4f45a28d5d9407c6d6`
- `results/report.json` SHA256: `0cbb1a5f99cf41b35827f120b32516543135bc98ed8e6f666a5b8215ac208555`

**Method notes:**
- The admitted observer uses `fixed-max-edge-640@1` for detection and maps the box
  back to original coordinates; recognition uses original pixels.
- Face height and fraction figures are the detector's YuNet face bounding-box height, in
  original-image coordinates, and that height divided by the original image height. Only the
  separate approximate 512/768/1024 resize estimates are longest-edge resizes; the reported
  table is **not** the actual ai-toolkit training bucket dimensions. Treat both as coverage
  indicators, not literal training crop sizes.
- Cosine similarity is against the canonical reference and is advisory only — it is not an
  identity authority and sets no pass/fail threshold.
- The canonical record (`g01`) is itself one of the 20 `train`-group rows (as `seed-g01`),
  not a separate held-out reference. Its self-cosine (1.000) is a sanity check on the
  pipeline, not independent identity evidence.

## Quantitative results by group

| Group | n | Face height px (min / median / max) | Face height fraction (min / median / max) | Cosine to `g01` (min / median / max) |
| --- | --- | --- | --- | --- |
| base | 5 | 627.7 / 681.0 / 704.2 | 0.288 / 0.313 / 0.324 | −0.105 / −0.054 / 0.011 |
| canonical (`g01` self) | 1 | 181.8 | 0.237 | 1.000 (self) |
| eval | 2 | 168.8 / 360.7 / 552.5 | 0.117 / 0.249 / 0.382 | 0.803 / 0.851 / 0.898 |
| lora | 5 | 597.1 / 623.9 / 647.5 | 0.274 / 0.287 / 0.298 | 0.632 / 0.665 / 0.699 |
| train (20 rows, incl. `seed-g01`) | 20 | 158.1 / 245.3 / 278.8 | 0.109 / 0.172 / 0.237 | 0.572 / 0.856 / 1.000 |
| **overall** | 33 | 158.1 / 254.8 / 704.2 | 0.109 / 0.179 / 0.382 | −0.105 / 0.830 / 1.000 |

`base` cosines cluster near zero — these are no-LoRA renders. Per-row cosine values for every group are in `report.json`; they are
not reproduced here beyond the ranges above.

## Independent visual review

Two separate, verified `claude-opus-5` sessions assessed the two rendered
QA sheets from JPEG95 transport files, with instructions not to use similarity metrics, infer
identity/age/ethnicity, or set a pass/fail threshold:

- `MAIN/_private/figment-face-coverage-audit-20260911-v2/review-figures/sheet-01-transport.jpg`
  — Claude's own display pipeline downscaled this from 1772×2082 to 1702×2000 for the reviewer.
- `MAIN/_private/figment-face-coverage-audit-20260911-v2/review-figures/sheet-02-transport.jpg`
  — downscaled from 1812×2148 to 1687×2000.

Root separately verified both native PNG figures pixel-exact against all 22 underlying QA
cells (22/22) via `review-figures/pixel-verification.json`; the transport JPEGs sent to the
Opus reviewers carry the same cell content at JPEG95 quality.

**Sheet 1 verdict (`pilot-01/02/04/05`, `expansion-07..11`, `seed-g01`):** most cells match
`g01` in hair, makeup, and accessories. A recurring drift direction — fuller/more pouted
lips, a wider lower face, and a head tilt with a pout — appears across several cells, most
clearly in `pilot-01`, `pilot-04`, and `expansion-08`. `expansion-09` is a near-profile pose
with little comparable identity evidence at this size. No gross anatomical errors were
visible. Verdict: supports selective inspection, not blanket crop augmentation.

**Sheet 2 verdict (`expansion-12..21`):** the same lip-fullness/jaw-width drift direction
recurs, most clearly in `expansion-13`, `expansion-14`, and `expansion-17` (the reviewer's
strongest drift candidate). `expansion-18` and `expansion-15` are the closest matches to
`g01`. `expansion-12` is the lowest-resolution cell (h=158px), and `expansion-20` is an
ambiguous up-and-to-the-side gaze that is a weak identity anchor. No gross anatomical errors
were visible. Verdict: does not support blanket crop augmentation; calls for selective
inspection.

## Reviewer-caveat corrections

- **`g01` cell is presentation only.** The single canonical training entry is `seed-g01`,
  one row among the 20 `train`-group records — it is not double-counted, and the reviewer's
  flagged "duplicate" concern in sheet 1 is expected, not an error.
- **The `h=` label and the printed bbox do not need to match.** `h=` reports the detector's
  unpadded face-box height; the printed bbox coordinates on the QA sheet are the padded crop
  used for the figure. The mismatch the sheet-2 reviewer noted is intentional and is not an
  issue with the measurements.
- **Hairstyle, expression, or view differences alone are not drift.** Several flagged cells
  (e.g., `expansion-09`, `expansion-16`, `expansion-20`, `expansion-21`) differ mainly in
  pose, hairstyle, or expression; forward pose/view variation in the dataset is intended and
  valuable on its own, separate from the proportion-drift observations above.
- **No gross face-anatomy error was found** in either sheet by the independent reviewers.

## Disposition (root)

The audit and the two independent visual reviews together **support investigating face
coverage further**, but **reject blanket crop-based training** on this set, given (a) a
recurring proportion drift (fuller lips, wider lower face) visible across a majority of
cells on both sheets, and (b) the canonical face itself has limited detail (182px).

**Candidate low-concern shortlist for further full-image inspection** (not a training
selection, not a retrain decision): `pilot-05`, `expansion-07`, `expansion-11`,
`expansion-15`, `expansion-18`, plus `g01` itself. Root has since viewed all 5 shortlisted
full originals (`05/06/10/14/17.png`); subjects are adult and clothed, with no gross
anatomical defect observed. This remains a candidate, experimental-crop shortlist — it is
not an approved training record.

## Status and cost

No checkpoint, still, or video is selected or accepted as a result of this audit. This audit
required no new RunPod spend; recorded arc cost remains $30.877297/$50, with the V4
diagnostic (the set this audit measures) at $0.247567.
