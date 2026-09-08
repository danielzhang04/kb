# Figment video diagnostic contract

Figment currently has two diagnostic-only planning/compilation paths, neither of
which is a production video result.

`orgs/figment/pipeline/video/video_plan.py` is the older offline planner. It can
record a local driving-video concept and supplied-image inventory, but has no
renderer, provider, subprocess, download, credential, approval, or production
path. Its records are deliberately unverified local planning evidence, not
extracted-frame or temporal-QA proof.

`orgs/figment/pipeline/video/video_manifest.py` is the reviewed native Wan 2.2
TI2V-5B compiler. It is the current diagnostic path: a hash-bound start image
plus short text motion instruction, a pinned native-Comfy workflow and model
inventory, and one non-promotable 512 x 288, 81-frame-at-16-fps image job. It
does **not** take a driving clip. The `LoadImage` node supplies
`Wan22ImageToVideoLatent.start_image`; text remains a separate positive
conditioner. The compiler has local fixture and existing-harness dry-run tests;
it does not itself start a pod or download a model. The existing harness has
admitted manifest `6be375a2…8ff92` under the 80-minute/$1.75 diagnostic bound
and acquired pod `wo5uka031lxh7m` at 10:16:30 UTC. It completed at 10:23:35 UTC with 81 PNGs, estimated cost $0.129426, and
independently verified absence. Local assembly and extraction verified a
5.0625-second 512x288/16fps MP4. Parent visual review rejects severe colored
streaks, face distortion and background warping in later frames.

## Evidence boundaries

`figment/video-first-frame-input@1` is an approval-free diagnostic input with
path, bytes, and SHA-256. `figment/video-diagnostic-plan@1` remains offline-only
and non-promotable. Neither authorizes use of a local frame as an accepted
production input.

The reviewed `frame_extract.py` adapter probes actual media and hashes decoded
first, midpoint, and final frames. It rejects traversal, symlinks and Windows
junctions, malformed or oversized media, and partial output failures. Its
reviewed tests establish local extraction mechanics only; they do not establish
that a native diagnostic rendered, that a supplied image came from a video, or
that identity/temporal quality passed.

`frame_assemble.py` assembled this run using its ordered 81 PNGs and local
receipt. The MP4 SHA256 is
`2084e7f6cb5ad1ea954524f8b5c14b92e5ef319405aad6653250ef875aaea674`.
The input receipt binds output names and seed, not an executed-workflow hash;
parent/provider observations remain separate. The clip is non-promotable.

## Model status

The Wan 2.2 TI2V-5B pins are an admitted diagnostic inventory. The compiler
does not perform provider work; the existing harness completed the bounded
diagnostic above. Its output proves execution mechanics and fails parent visual
quality review. No production approval is represented here. The
source basis is the [Wan adoption audit](2026-09-08-video-model-adoption-audit.md), including its official Wan and ComfyUI citations.

Production still needs real upstream lineage and successful temporal QA.
This diagnostic's verified assembly/extraction does not establish those properties. A later
driving-clip path is a distinct production experiment; it is not part of the
current native start-image-plus-text compiler.
