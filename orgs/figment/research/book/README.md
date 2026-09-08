# Figment research book

This book is a decision record for a fictional adult creator system. It turns the package review, current implementation, and the completed checkpoint diagnostic into a build order. The target is a clothed adult persona whose identity, realism, age presentation, and provenance can be reviewed independently. Instagram operations remain deferred.

## Evidence discipline

| Label | Meaning | Weight |
|---|---|---|
| Package evidence | Structure inferred from the purchased 10sorLabs panel, read 2026-09-03. | Useful pattern; no redistribution and no unobserved lesson claims. |
| Current code | Behavior and tests in the implementation checkout. | Reproducible locally; not proof of output quality. |
| Live proof | Frozen manifest, receipt, hashes, and observed run on 2026-09-08. | Proves this run's mechanics only. |
| Hypothesis | A proposed cause or next experiment. | Requires a held-out comparison. |

The live diagnostic completed five checkpoint jobs at 250, 500, 750, 1000, and final 1250. It produced five 1448x2176 PNGs, all adult and fully clothed by the parent Codex agent's visual inspection. The operator's qualitative review found them mostly semi-real, inconsistent with the references and each other, and reading as mid-30s rather than 21. No candidate was selected or promoted. See [live tester report](../2026-09-08-live-tester.md) and [foundation plan](../2026-09-08-foundation-plan.md).

## Governing rules

1. Freeze persona, references, prompt, seed, model, node, and checkpoint in a manifest before a run.
2. Keep identity, realism, apparent age, clothing safety, and temporal consistency as separate review dimensions.
3. Treat costs as estimates until reconciled; unknown native telemetry is unknown, never zero.
4. Use only adult, clothed evaluation material in this pipeline. Explicit work is a separate operator-owned tier.
5. A diagnostic can inform a decision; it cannot silently become approval, publication, or promotion.

## Reading map

- [Identity and data](identity-and-data.md): reference contract, dataset, and identity controls.
- [Training and evaluation](training-and-evaluation.md): checkpoint ladders and held-out tests.
- [Image production](image-production.md): render, repair, and review stages.
- [Video production](video-production.md): start-frame and temporal identity doctrine.
- [Content research](content-research.md): evidence-led topics and measurable experiments.
- [Architecture and operations](architecture-and-operations.md): hub, manifests, ledgers, and gates.

The package map is documented in [r14](../r14-10sorlabs-package.md); its derived training, generation, motion, and fidelity analyses are in [r15b training](../r15b-training.md), [r15b generation](../r15b-generation.md), [r15b edit and motion](../r15b-edit-motion.md), and [r25](../r25-why-they-can-and-we-cant.md). Those reports include locally inspected graph JSONs and recovered chapter evidence. Current code and live evidence are dated 2026-09-08; package evidence still does not prove output quality or licensing for every asset.
