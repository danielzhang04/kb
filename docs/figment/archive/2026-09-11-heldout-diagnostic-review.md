# Held-out LoRA/base diagnostic disposition - 2026-09-11

Responding models verified from assistant message.model: independent visual reviewers claude-opus-5 (jobs v2/v3); parent Codex reviewed all ten original PNGs. Earlier claude-sonnet-5 batch verdicts are REJECTED for image/filename misbinding, not used as votes.

## Decision

The learned checkpoint has a visible effect in every matched pair and improves resemblance to canonical g01 relative to the no-LoRA control. This is useful evidence that the trained weights affect generation. It is insufficient for checkpoint selection or production promotion: facial proportions still differ, all outputs miss shoulders-up framing, and seed variation is narrow. Continue only with a distinct, bounded coverage/composition hypothesis. Do not repeat closed public sampler or wording searches, or pick a lucky seed. Existing V2 tester all-cull remains authoritative; no current checkpoint, still or video is accepted.

## Run proof

User specifically approved transfer of creator001krea2.safetensors,228587800bytes,SHA070b0e639e68babaf7a650c0ac7e1b460a53ef8aca1fda7bfd73057e680cb9a0, for ten clothed diagnostic images to one RunPod within$2.50/115minutes and existing$50 total. V4 reused the exact V3 protocol and manifest; only preparation source binding was refreshed. ManifestSHA1d3a037f9ca5b4620baa8dd723f50dcdf94173078883092206a56065337fb6c4.

One L40S pod cyltstf0rtxgwx ran04:24:04-04:37:41UTC,817.654seconds. All10outputs were downloaded and decoded. Harness verified termination; parent independently queried provider and received[]. Recorded READY-rate estimated actual cost$0.247567, arc$30.877297/$50, daily$0.247567/$10. These are measured-rate estimates, not invoices.

Every original is1448x2176. Parent reconstructed each graph with the actual harness apply_job and compared it to PNG embedded prompt metadata:10/10 exact matches. Five distinct sampler seeds are correctly wired; base jobs bypass LoRA on both model and clip paths. Low visual diversity therefore is not evidence that the harness reused a single seed. All originals and full hashes: MAIN/_private/figment-builtin-heldout-control-20260911-v4/visual-review/input-pins.json. Graph proof: embedded-graph-verification.json in that directory. Run receipt, recovery and post-run-verification.json remain at the V4 root.

## Visual assessment

| Seed | LoRA relative to g01 | Base relative to g01 | Framing |
|---|---|---|---|
|1595|Closer hair, eyes/lash styling, lips and hoops; different fuller face/cheek proportions|Different facial proportions, tied-back hair, no corresponding styling|Both too loose; LoRA reaches hips|
|481516234|Same learned resemblance and proportion deviation; short-sleeve top|Different face, tied-back hair, no hoops|Both too loose|
|90210|Closer resemblance, fuller cheeks, short-sleeve top|Different longer face and nose, tied-back hair|Both waist-up|
|314159|Closer resemblance, fuller cheeks, minor plant/floor background content|Different longer face, tied-back hair|Both waist-up|
|271828|Closer resemblance, fuller cheeks, very similar to90210|Different face with loose brown hair and long sleeves|LoRA waist-up; base mid-torso|

Root: all are clothed and visually adult. Skin has visible detail but the LoRA group remains somewhat smoother than the control; no gross visible facial deformation found. Reference face is small, and lens distance/makeup affect proportion comparisons. Do not infer a precise age or verified real identity from these pictures. Only the frontal, single-prompt family was tested; this cannot establish varied-view identity consistency. Both arms vary little, so the experiment cannot isolate whether low diversity comes from training, prompt, sampler or their interaction. The missing shoulders-up examples in training remain a hypothesis, especially because the base control also misses the crop.

The two Opus reviewers independently agree on the arm-level resemblance and framing failure. One reviewer missed a small eyeliner wing in two LoRA images; root retains the visible wing and does not adopt that detail. Their remaining per-file descriptions match the visible files. Reviews use1024px copies for bounded transport; root inspected all originals through the image viewer. This is scoped visual evidence, not a unanimous precision score or an approval.

## Review failures retained

Two Sonnet jobs confused image labels and claimed shoulders-up framing despite visible waists. Parent compared every delivered tool-image byte with the named local review copy:12/12 exact matches, proving transport/file mapping was correct. Their verdicts are rejected. A first sequential Opus job exceeded the3MB supervisor event cap and returned no public verdict; smaller2-pair/3-pair jobs finished. Do not count a stopped job's hidden reasoning as a review. Accepted evidence paths are MAIN/_private/figment-claude-heldout-opus-visual-20260911-v2 and v3, each with supervisor.json, stdout.jsonl and visible-review-text.txt. The rejected jobs and delivery check remain preserved.
