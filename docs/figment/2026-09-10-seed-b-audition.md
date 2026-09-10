# Separate close-portrait seed audition ? September10

**Disposition: stopped after the predeclared two-image bound; no expansion, training or canonical-persona change.** Built-in image generation created one new fictional adult portrait and one reference-conditioned pose variation. No g01 image or private checkpoint was supplied. This is a different identity hypothesis, not a causal comparison with g01 or a replacement for creator-001.

Root visually inspected both full images. The frontal portrait is clearly adult, clothed in an intact opaque black crew-neck shirt, with the whole head visible and substantial natural face detail. Exact intended age21 remains unestablished. The variation retains broad same-person cues across eyes/nose/lips/hair and skin details, but turns toward viewer-left despite the prompt requesting viewer-right. The directed pose requirement fails. A mild reference-conditioned pair does not establish held-out consistency or LoRA learnability.

| Artifact | Dimensions | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `seed-b-front.png` |1122x1402|1991488|`a9a3bdb1e9bb0b9b7792e758e351bb29d6008ce60e5f627acd7bbfd76f42428c`|
| `seed-b-pose.png` |1122x1402|1933985|`942b50673b7de0cd0bdc19a4d9935a8433c571d2224dcc5b3cb303e8d71437a1`|

Workspace evidence: MAIN/_private/figment-seed-b-audition-20260910-v1/. The exact initial prompt and stop conditions are in `protocol.json`; follow-up prompt in `pose-prompt.txt`; attributed observations in `front-review.json` and `pose-review.json`. Both originals are saved in that workspace directory, with their built-in generation originals preserved. Two built-in calls; actual token/billing totals unavailable. No RunPod run or model upload occurred.

This audition shows that the loaded image tool can provide a separate detailed face seed and a related view. It does not establish the desired apparent age, directed-pose adherence, broad identity consistency or a production quality pass. Any subsequent work needs a new bounded protocol addressing those failures; do not continue generating rows under this closed audition.
