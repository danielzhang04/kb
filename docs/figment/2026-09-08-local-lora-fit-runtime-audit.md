# Local LoRA fit runtime audit — 2026-09-08

## Outcome

A separately admitted local one-observation LoRA **availability probe** completed on 2026-09-08. V2 ran the one-image `g01` stage for ten steps, exited zero after 79.234 seconds, and wrote one bounded checkpoint. It establishes that this constrained local fit path ran and saved its declared artifact.

It does not establish image quality, identity, age presentation, generalization, checkpoint acceptance, or promotion. It produced no samples or exports and remains non-promotable. The historical one-observation plan still disallows a GPU fit by itself; V2 used a separate, hash-bound parent admission. This result does not relax the separate 20-row training gate.

## Bound inputs and admission

- Frozen plan: raw SHA-256 `cba60c9b1157ee90f322f5bdd13382fb27a99de7e2d0245a8ce033baf198fa9d`; canonical `e9de0980ae27f8fb1e98398a685f81a18bdb6dd27e70d07ec4dff38d2aac75ea`. It specifies one original `g01` view, `max_train_steps: 10`, and zero samples/exports.
- V2 parent admission: raw SHA-256 `38429b694110a7c17260106fd2cc5021804df00c644813ffb3ea7b6488176e9b`; canonical `2f1514062aae4e6f0dbd0d1d978da80772e2fce6aee2e8ec0ca9b7da71ba367e`. It authorizes this GPU probe only, fixes ten steps and a 1,200-second wall limit, binds the frozen plan and preflight receipts, and marks the result non-promotable.
- Launcher source: SHA-256 `5554d92cfa52e91a001da376a247dac6a6a75250c5759516692833599aa84bed`, introduced by commit `937d27b294d1ae0743b1010e0a3e2d84efc35862` with Windows `-X utf8` for the trainer subprocess.
- Exact V2 stage inputs: `g01.jpg` `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` (737,366 bytes), `g01.txt` `de34cde35290689f8b167bbfc2aa96cc79abf61db64e0e87a4e404719209c569` (331 bytes), and `fit-probe.toml` `9ab856aa4fa90234915d4d49c3b3ddbcf3a1d8cb417fb2b62bd2e33bfb960119` (1,176 bytes). The fresh local stage retained its generated latent cache `g01_1408x0768_sdxl.npz` `ed38930fcc9e0249219643b5424ecebda804052fa2388f5a5b2aeed106d104be` (115,554 bytes) and text-encoder cache `g01_te_outputs.npz` `423a02a89c45567b5f59cdc59379fea0a0da6695cbed78dc7e15ac7c8aeeb9ba` (1,865,484 bytes). These caches are run-stage artifacts, not additional source observations.

## V1 failure and V2 completion

V1 is retained as a failed, non-promotable record: its failure record hashes to `b67569dc15329ab0d5f79fd79bc5fe3748f80d1f2144b09a7727283538fa2cc7`, exited 1 after 110.283 seconds, and preserves the CP1252 `UnicodeEncodeError` emitted when the trainer printed Japanese text. Its launcher hash was the prior `3bc31032410ad43cb0c4ed5d389b4fa6f0396a01f95119dcca1ffc8a7e4674c1`; it wrote no checkpoint.

V2's receipt hashes to `071af1206db70a4c0294fa3372f910bd1a19233aae79df30f94ae58328b0030a`. Its stdout, stderr, and TensorBoard event hashes are respectively `395a1d67e835dceb202d3cf88dfc085fcd9d5598dc7b4a254ff35b3b5d75edf8`, `28006fc720f2c9e62511d98ce0f40174dfea159c0656c3ec6b22b2f41e84603d`, and `ba98e63ab380467c634ad93cfe70f3dfe9c7734da75647be4adf32de54877916`. The bounded log tail records steps 1–10 and `model saved`.

The sole V2 output is `figmentlocalg01probe.safetensors`, 170,540,916 bytes, SHA-256 `032123a1bc31b8e6dab3c8d00f961189ff3e0ddda2d051bd587a5de879afd135`. A bounded safetensors-header audit read the 309,704-byte header only: it contains 2,166 F16 tensors, with valid shape/dtype byte spans and non-overlapping offsets through the exact 170,231,204-byte data region. Metadata records `ss_steps=10`, one train image, rank 32, alpha 16, bf16 mixed precision, and `sdxl_base_v1-0`. A separate root NumPy/mmap finite-weight audit recorded all 2,166 F16 tensors and 85,115,602 elements in `root-checkpoint-audit.json` (`f1f59dd15fa8e8d53649cca40ee66b091c9985e0d6e88b4f9fd8df32dacd2460`).

## Lifecycle and accounting boundary

The root assistant independently observed retained PIDs `28696` and `32456`, plus separately observed trainer/launcher PIDs `35396` and `37004`, absent at 16:47 UTC. A post-run `nvidia-smi` check reported zero MiB used. These are separate root observations, not a peak-memory measurement, human review, or full process-history reconstruction. The receipt itself reports verified teardown and no unresolved processes. There is no active probe recorded here.

Recorded RunPod spending remains $37.800385 of the $50 arc, with no holds. These local runs incurred no RunPod charge. Native agent billing telemetry remains unavailable and is not recorded as zero.

This runtime evidence belongs beside the [research-book status](../../orgs/figment/research/book/README.md), [training and evaluation boundary](../../orgs/figment/research/book/training-and-evaluation.md), and [architecture and operations record](../../orgs/figment/research/book/architecture-and-operations.md).
