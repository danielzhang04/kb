# Local matched base runtime audit — 2026-09-08

The separately admitted local **base** matched-pair runtime completed. Its
receipt is `figment/local-lora-matched-runtime@1`, status `complete`, with
deadline 600 seconds and verified teardown. Receipt raw SHA-256 is
`d12cdd5c99cc9666a919632712b3a5556147c509325b29295ad048f92bbd1b7a`.
It binds the C1 graph source `bca8be929852fe19eab724f878f8985e4b3f6146050e564af91d0c83e6570d6f`,
the C2 runtime `ce9341824349072f5172e3fe7e161f13963e082d1c8e6fc3208cba02985994e0`,
and immutable ownership helper
`2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac`.
The base admission raw SHA-256 is
`57b026768d69d8b7add2b781a6228d9e9ea432b5617612a40553ef7e0fe95536`;
its `checkpoint_sha256` is null and its prior-review digest list is empty,
as required for the first base pair.

The two receipt-listed outputs exist at 1024 × 1024 and rehash to their
recorded values:

| Seed | PNG SHA-256 | Bytes | Embedded graph SHA-256 |
| --- | --- | ---: | --- |
| 481516234 | `dcbd390846e7799c17a827d278cf98ca98f493e5ceed6bdefb57647e1c2d4948` | 1,454,689 | `997621a1c7d186e1868bc4a44c1a2c1a5e2c957c024c076dd20511abc2338ac6` |
| 90210 | `2c95cfd3a4d7e2d1773330e65c14ae791a51aaf4248e0d9350e5a3eecd496153` | 1,431,012 | `8aa9595595e490c0a36a90cd3d5dcd2e562327762e75ee7c982de4c15e0a1df7` |

For each PNG, Pillow read the embedded `prompt` JSON and it exactly equals
the C1 `graph("base", seed)` reconstruction. Each dispatch journal records
the same graph hash and the matching `base-seed-<seed>` row ID. The graphs
contain `CheckpointLoaderSimple`, two `CLIPTextEncode` nodes,
`EmptyLatentImage`, `KSampler`, `VAEDecode`, and `SaveImage`; they contain no
`LoraLoader`, IP-Adapter, image-conditioning, or input-image node. Their
positive and negative prompts match C1, and the sampler is 1024 × 1024,
24 steps, CFG 6.0, `dpmpp_2m`, `karras`, denoise 1.0, with the fixed seed.

The receipt records `checkpoint: null`, zero header U-Net keys, and zero
missing-LoRA warnings. The run-owned `output/loras` directory is empty. The
bounded stderr file is 11,317 bytes and rehashes to the receipt value
`bcc155a85682610974dc37bd386265c602346dd89a294a779c5834f62d1b4edc`.
The receipt does not expose a separate log-truncation field, so this audit
does not make an additional truncation claim. It records three owned-process
identities (38724, 38356, and 35428) as terminated with no unresolved
processes; root separately observed those IDs absent after the run.

This is execution and artifact-binding evidence only. It makes no visual
quality, realism, reference-resemblance, age, clothing, checkpoint-acceptance,
promotion, or production-eligibility finding. Separate root and independent
visual diagnostic records remain the evidence for observations of the images.
