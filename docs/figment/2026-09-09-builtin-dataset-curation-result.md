# Built-in research dataset curation result

**Date:** 2026-09-09

**Scope:** creator-001 bounded research dataset and train-first preparation

**Production status:** not approved for production or publication

## Result

The direct-`g01` candidate expansion has completed its local research-curation path. Root recorded `eligible-for-bounded-research-training`, the existing curation compiler materialized 20 numbered training image/caption pairs while retaining both evaluation rows as evidence, an independent materialization verifier passed, and the existing CLI recorded dataset decision `verified` for `codex-worker/root` at `2026-09-09T18:14:35Z`.

This is an accepted dataset for one bounded research LoRA trial. It is not a production dataset, checkpoint acceptance, production identity claim, or publication decision. The user separately approved the exact 20-image/caption `$7.61`/351-minute RunPod payload. A first launcher attempt failed locally with `WinError 5` reading `dataset-approval.json` before any provider call; the same-user read/execute repair then verified all 88 dataset files unchanged. The normal CLI child launched at 18:38:23 UTC (PID 60208) after empty-inventory and current-ledger preflight. Recovery recorded owned pod `iu3uzm2swvup3l` (`figment-bakeoff-20260909-183826-e7284e`) at 18:38:26 UTC. The latest recorded read-only snapshot at 18:44 UTC saw its container `RUNNING` while system logs were still downloading image layers. It is bootstrapping, not a training-step result or container-progress claim. No final receipt, checkpoint, tester output, or final cost claim exists.

## Bound evidence

- Root research ruling: `_private/figment-builtin-dataset-20260909-v1/root-research-ruling.json`, SHA-256 `e9b10a0b6bba635cbb38c2ef92b008b9543e3ace214e5af5cbf7635c1b67a80f`.
- Caption draft: `_private/figment-builtin-dataset-20260909-v1/caption-draft.json`, SHA-256 `670e87a4a162f8e32344dec728ee19e777326a5996808dd11f234020b0b8de9b`.
- Materialized curation record: `dataset-v1/dataset_curation.json`, SHA-256 `e1445eab14bc755728e2d66ce86c870a440da45b63736bdc9f1a36765bb51568`.
- Materialized dataset manifest: `dataset-v1/dataset_manifest.json`, SHA-256 `8e5f631b8d207edc65a6f105fad3396e137561f966dc23d24c0ced7854b3d418`.
- Materialization verification: `_private/figment-builtin-dataset-20260909-v1/materialization-verification.json`, SHA-256 `bc4590764265c2600c68b3d7f74d2fcdc25be11c1ff8073699a7a181354eb864`.
- Dataset approval: `dataset-v1/dataset-approval.json`, SHA-256 `96b2c5b470aab05af35dbc189cf8db666e9e205f24bb757816991c20b71a2505`; subject SHA-256 `1117491bf545a0f9536054025908e70cfb3642ada5ad4f11dc7c81c14b4df931`.

## Materialization proof

The curation record contains 22 entries: 20 train and two eval. All 20 train rows have numbered PNG/caption materializations. Pilot 03 and pilot 06 remain eval-only, have no numbered trainer materialization, and are retained in the immutable evidence snapshots. The materialized directory contains 20 numbered PNGs, 20 numbered caption files, `dataset_manifest.json`, `dataset_curation.json`, the request snapshot, 22 exact source snapshots, and 21 derivative-provenance snapshots.

The verifier reports:

- all source and provenance hashes are bound;
- trainer order matches the curation record;
- all 20 numbered PNGs have dimensions equal to their retained sources, with no resize or crop;
- all 20 materialized RGB pixel arrays exactly equal `source.convert("RGB")`;
- all 20 caption files equal the draft caption plus the Windows CRLF line ending;
- eval rows remain excluded from trainer media.

The numbered training PNG byte hashes differ from the original source hashes because the compiler decodes each retained source, converts it to RGB, and writes a new PNG encoding. Exact original JPEG/PNG bytes remain preserved under the `curation-*.source` snapshots. Pixel equivalence is established by the separate verification artifact, not inferred from matching file hashes.

## Train-first preparation

The current public pin preflight passed for the selected train and tester profiles. The CLI then wrote `_private/figment-builtin-train-first-20260909-v1/plan.json`, SHA-256 `9c82f6dd64500f1ac46144cf882261990353e0659773c95c3617649fbe6ece7c`. It contains the existing two-stage train/tester sequence and binds the accepted dataset subject and canonical OPS ledger path. The train stage is the normal 1250-step DOP configuration on the L40S class, with a 351-minute bound and `$7.61` ceiling.

The train child has launched but no train stage has completed and no tester has launched. The final one-shot launcher is independently READY at SHA-256 `86530deca2cd878484139d4809b97626df64eb72b319acc955b7c622194f73e7`; after the historical local pre-provider access failure, its unchanged normal CLI child launched at 18:38:23 UTC. Recovery recorded owned pod `iu3uzm2swvup3l` (`figment-bakeoff-20260909-183826-e7284e`) at 18:38:26 UTC, and the latest 18:44 UTC read-only snapshot saw its container `RUNNING` while system logs were downloading image layers. That is bootstrap, not a training-step result or container-progress claim. No final receipt, checkpoint, tester output, or quality result exists from this plan.

## Quality limits

The research acceptance is grounded in original-pixel root and independent review of the fictional adult identity and factual captions. It remains a single-anchor, first-generation derivative set. Most faces are frontal or three-quarter, repeated makeup and jewelry are common, and each variation has one generated sample. The two held-out images are narrow within-identity diagnostics from the same anchor; they are not independent identity references and cannot establish broad generalization.
