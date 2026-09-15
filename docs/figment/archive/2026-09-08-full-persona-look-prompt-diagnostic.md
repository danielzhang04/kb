# Full-persona-look prompt diagnostic (offline plan)

This is a frozen two-condition, five-seed prompt experiment for the already
selected candidate LoRA. It is planning and local-harness evidence only: it
contains no images, scores, human approval, gate result, or promotion claim.

## Question and conditions

The held-out tester prompt currently uses `identity.look.age_stage`, while the
dataset and generation prompt composers use all eight `identity.look` fields.
This experiment changes only the CLIP node 5 positive text while holding the
candidate checkpoint, model pins, workflow, sampler settings, upload, and five
seeds fixed.

| Condition | Prompt SHA-256 | Seeds |
| --- | --- | --- |
| `age-only` | `3ff92b5b153767c787130b1872aaab9985aeeefbf1c2d2a1c397ec2bf2a00e87` | 1595, 481516234, 90210, 314159, 271828 |
| `full-look` | `dd37f88a5fce84467d1d1b1bb2f0b69d7e11b9d24677f0bc6fa0951d2707aa01` | 1595, 481516234, 90210, 314159, 271828 |

The source `age-only` prompt remains unchanged from
`candidate-final1250.yaml`. The `full-look` text is deliberately formed from
`_compose_look_clause`'s frozen order: `age_stage`, `hair`, `eyes`, `skin`,
`brows`, `makeup`, `build`, and `clothing`, followed by the same adult,
clothing, framing, skin-texture, lighting, background, and camera suffix.

```text
AGE-ONLY
creator001krea2 woman, Close-up portrait photograph of a woman in her early twenties, about twenty-one, an adult woman's face with a set jawline, an adult woman's proportions and an adult woman's frame, her hands and neck reading the same age as her face. She is an adult woman, fully clothed in a plain fitted black crew-neck top, shoulders up, facing the camera, neutral relaxed expression with a faint smile. Natural skin texture with visible pores and fine flyaway hairs, no retouching. Soft even daylight from a window camera-left, plain warm off-white wall behind her, shallow depth of field, shot on a phone camera.

FULL-LOOK
creator001krea2 woman, Close-up portrait photograph of a woman in her early twenties, about twenty-one, an adult woman's face with a set jawline, an adult woman's proportions and an adult woman's frame, her hands and neck reading the same age as her face, jet-black hair parted in the middle and falling past the shoulders, dark brown eyes, fair skin with visible pores and texture, her own full dark brows brushed up and not drawn in, a thin brown line drawn close to the upper lash with one coat of mascara, lip balm over her natural lip colour, slim with an ordinary adult figure, wearing a fitted black crew-neck t-shirt and dark jeans, both fully opaque and intact. She is an adult woman, fully clothed in a plain fitted black crew-neck top, shoulders up, facing the camera, neutral relaxed expression with a faint smile. Natural skin texture with visible pores and fine flyaway hairs, no retouching. Soft even daylight from a window camera-left, plain warm off-white wall behind her, shallow depth of field, shot on a phone camera.
```

There are ten jobs, two conditions times the same five seeds. Both arms retain
LoraLoader node 4 with `creator001krea2.safetensors`; KSampler node 8 stays
connected to node 4. This is not a no-LoRA control and cannot identify a
checkpoint-versus-base effect. It can only compare these two prompt
formulations under the listed fixed configuration. It cannot establish that
prompt wording alone explains identity, apparent age, or any later result.

## Frozen inputs and verification

| Input | SHA-256 |
| --- | --- |
| Source candidate manifest `candidate-final1250.yaml` | `3acb34fb93796c4763ddddf80605fe57804459e48ab6677a2b956b9c46dfaf2b` |
| Prior held-out protocol | `9c5d998c158ba366e7ba8e8643fb6b4975f8e11961587439c7df2bc191fef071` |
| Frozen `creator-001` persona | `9fdbb536a2e4c9895e332f13e1a4f11a41f938045a8b770d639b663c32be7492` |
| Candidate checkpoint | `e1da52fbec917794d5dfccc99dbd7bdc48921efd955e9f4be6da065df54596b0` |
| New private manifest `candidate-prompt-full-look-v1.yaml` | `668ade24399652d0936797c88a5ab35915106161aadcc333da3a4930a42602e9` |
| Private verification `candidate-prompt-full-look-v1-verification.json` | `c54f714eaf5802b37e91e6ec80107a4c046a346e2f136756cfc6017a549253d2` |
| Dry-run receipt `dry-run-prompt-full-look-v1/run.json` | `b1895cb7ddc8de07d426fa0ec790063737447fd594a1b9424fad6a5f298823f9` |

The local harness dry-run completed all 10 jobs with `dry_run: true`,
`termination_verified: true`, and `estimated_actual_usd: 0.0` on the dry-run
basis. Its preflight estimate was $2.4917 for the existing 115-minute bound;
that is an estimate only, not authorization for a live run.

For each matching seed, `apply_job` reported two raw graph differences:
`/5/inputs/text` and `/10/inputs/filename_prefix`. The latter is the necessary
per-job output label. Removing that label before comparison leaves exactly
`/5/inputs/text` for all five seed pairs. The machine-readable result is the
private verification file listed above.

No compiler change is needed for this experiment. Keeping this as a static
private manifest preserves the existing tester contract and makes the changed
factor directly reviewable before any future authorization.
