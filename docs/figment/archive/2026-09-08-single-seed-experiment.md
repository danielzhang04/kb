# Creator-001 single-seed candidate/control experiment

## Status

Prepared locally only: no live pod, checkpoint selection, grading, promotion, accounting change, or historical-output rewrite occurred. The canonical anchor is `anchors/g01.jpg`, selected by the parent under the user's leeway pending the separate consistency audit. It is not an inferred average of the reference set and is a visual comparison anchor, not an image-conditioning input to the text-to-image graph.

| Reference | Bytes | SHA-256 |
| --- | ---: | --- |
| `g01.jpg` (canonical) | 737,366 | `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` |
| `g02.jpg` (context) | 750,657 | `d6ef8ec7a619162fb180727421b3c6f6ec05342544065c5f4a02e318ef4f12e6` |
| `g07.jpg` (context) | 730,186 | `f5457d845687aae1e23461560c2609a630b51bf2fc31cd21bc85ecbc7ed82d6a` |

The protocol freezes the persona wording: “a woman in her early twenties, about twenty-one, an adult woman's face ...”.

## Actual training evidence

The actual training receipt is `C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/out/creator-001-tensor-train-first/run.json` (`sha256` `fe6e789031667d0083fe5d3fbc2b37fd0eb8a5ae1e10663697f12a0dfc065265`). It records pod `fn938tol6mgbtp`, `2026-09-07T09:15:24Z` through `2026-09-07T11:36:54Z`, verified termination, and one measured harness estimate of `$2.570377`.

The final 1,250-step candidate is `creator001krea2.safetensors`, 228,587,800 bytes, SHA-256 `e1da52fbec917794d5dfccc99dbd7bdc48921efd955e9f4be6da065df54596b0`. The source dataset used by that receipt is `C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/creator-001-tensor-dataset-train-first`. Its `dataset_manifest.json` hash is `b897c3e61c8a6ec1a522c973d757fe91de21848ba713aa924f6fb40897ea9fc5`: it declares 23 `provided`-caption images. Every observable caption is exactly `creator001krea2 woman`; that is a fact about the previous run, not a finding of cause.

```text
01.png  852d1fa57bcda865f5bd88589c7eb58d77c92738f5cb402b428dedcef5a34f3a
02.png  98ac4ef4881d20312a4ccd115693a39e3a053a24f10954f8c18c1f371a1157cb
03.png  72fd77d40ff99960d21c332c1a56dc10028fdeaf65928a41d041e9a8d0d7f51e
04.png  9ba08baaaa410794074f538546856ee77247d40428cdd953e3926b994deda20c
05.png  46db64bfaed956505b89693e6c7849f9a73c5ed844f87f4ea8ae3a99b19a822b
06.png  c21979c3597c5f557cefab614e43b51fc33c752d787b1b6a4a7efb55bc1bdf0c
07.png  5cec0513a7318e9e1d6df3eb0414aa02fa03cb536de4f63e51185990c50fd375
08.png  76cb1346baa99ca8ea82df9c04ce708578efd704b75747c5018b3e601b9d8efb
09.png  44befdba3590c4ec9dd0d990f6b6b176f4b6f0332e30845ecacd0ea25055c43b
10.png  8b9d8c9247d08ade2817115cd35b6290ab4bce6260fd9c67499bb6515eebcc3e
11.png  b84d3960f6f54562d4e7ada617ef4016b04f7a5ff88a079a8529d1728ab5cb5d
12.png  cd1b04cddc732fe93854ef76a9a7fd4e4bfa166422062f97a49432b65ac3ae25
13.png  c97d79aae6ed057d7e619053aceab96c46122eec8c3514acf1cf9469b3d3f456
14.png  08b49f2d7239566b2442c595711865553976f1118934c841444a2d992586c3f5
15.png  f96e4bd79cd36caa58073971fa2a93d9a5f8671a115b36171cffbfa3c6435915
16.png  db59883ef00bcf2d2de00bf4309f41fc92ebd3b7a52757db609fc9948a3c7ff8
17.png  456022e00b97c52e70eb0f9eaa4e785126060ab1481f387ac84d97742d2b5c97
18.png  a3c16089d5e788434e2879f5eceadbf4fd78c2555e5416a9d6016d0bf12e92d4
19.png  9c6147d28de19ab1607f5ae40b57157cc8d71433d49eee8315471c459ee62f90
20.png  2b75ab3907ccd90bdfd4fac2f3451f42ca78b4d8ab8680bc4de7b638228d0f98
21.png  f826c38b40b6f4b573f0d9a7b0e297e8b0d579216f2e6faa2e5d829daf72327e
22.png  094ea0be2b011fe01ab32ae38eea8aebb69c73a737e4a389790d462cfdbf6df2
23.png  b9e848c2fe90e5c3f4ff46baf48a82e3d87ce10e5492ca628b2a6959b2172df5
```

`training.json` hashes to `3943f259e6f688c79e79debda36cda8013e602d700e66071307634483081b09b`. It specifies Krea2 Raw BF16 (`f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7`), rank-32 LoRA, U-Net only, 1,250 steps, saves every 250, provided captions, and differential output preservation `1.0` for `woman`.

The immutable five-image receipt is `C:/Users/danie/kb/_private/figment-live-tester-20260908/live-output-retry-1/run.json` (`sha256` `dd623b534a6007e9be5ef3da6f5cae3fe5ff80778db5d2961d6e155843490c8b`). It used five checkpoints at seed 1595 and terminated with absence verified. Its final image hash is `e48622df4da6034d9327ba2557063120a14acffe9fe0472adbd2884f252f47d2`. Its prompt had the superseded literal “mid twenties”; it is neither a control study nor a promotion record.

## Frozen next diagnostic

Private artifacts: `C:/Users/danie/kb/_private/figment-single-seed-experiment-20260908/`.

| Artifact | SHA-256 | Role |
| --- | --- | --- |
| `held-out-diagnostic-protocol.json` | `9c5d998c158ba366e7ba8e8643fb6b4975f8e11961587439c7df2bc191fef071` | unscored 10-cell protocol; promotion false |
| `candidate-final1250.yaml` | `3acb34fb93796c4763ddddf80605fe57804459e48ab6677a2b956b9c46dfaf2b` | final-LoRA arm |
| `control-no-lora.yaml` | `6e1e77b2f44d5dd9db28f0cffce0f6d330e38bbd0ca29210dc88c89f8271b489` | direct base-model arm |
| `combined-candidate-control-v1.yaml` | `7bad70d7dd3d024eadb4b78dd63fa9c4b92277d707a772089274212428ed903f` | admission candidate: five final-LoRA jobs and five base-model controls in one upload-bound manifest |

The protocol fixes seeds `1595`, `481516234`, `90210`, `314159`, and `271828`; seed 1595 is historical and the other four are new. It uses one persona-derived prompt in both arms; records the final candidate hash, canonical g01, full reference set, and separate unscored criteria for realism, within-batch identity, reference identity, and apparent persona age.

The immutable source pair remains unchanged. The combined manifest uploads only the final 228,587,800-byte checkpoint in 14 chunks, avoiding the prior five-checkpoint/70-chunk transfer. It keeps node 4 reachable for each candidate and uses `apply_job` list-valued substitutions for each control: node 5 `clip` becomes `["2", 0]` and node 8 `model` becomes `["1", 0]`. That bypasses `LoraLoader`, leaving node 4 unreachable from `SaveImage` for every control. Local closure inspection verified node 4 in all five candidate graphs and absent from all five control graphs.

One dry-run of the combined manifest verified ten placeholder images, a single 14-chunk upload, and dry-run teardown; it incurred zero actual cost. Its 115-minute ceiling covers the 40-minute readiness, 15-minute upload, 50 minutes of job windows, one three-minute initial job wait, and five-minute teardown reserve (113 minutes). The preflight estimate is `$2.491667`, below the `$2.50` ceiling. This is prepared evidence for parent budget admission, not live authorization.

## Next decision

First complete the anchor-consistency audit. If g01 is no longer canonical, rebuild the immutable protocol and manifests; do not edit them. If admitted, render both arms to fresh directories, preserve both receipts, and visually review the four criteria plus clothing/adult QA. This diagnostic can reject the candidate but cannot promote it because it is not driver-bound lineage.

Prefer this same-model candidate/control experiment before a regenerated one-seed dataset: under the same corrected prompt, it isolates the existing LoRA arm from the pinned base-model control. It does not independently isolate age wording from the old live run. Regeneration changes data and training together, so it cannot explain the current result. Consider new data only after this comparison rejects the candidate or the anchor audit invalidates g01, then use a newly approved dataset and driver-bound train-first plan.

The reusable gap is narrow: `held-out-diagnostic` freezes protocol data but does not compile the paired manifests or join their receipts. The private pair proves current harness compatibility. A later compiler should derive both manifests from the immutable protocol and refuse historical standalone receipts, rather than create another state system.
