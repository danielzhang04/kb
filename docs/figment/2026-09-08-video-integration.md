# Figment offline video diagnostic contract

`orgs/figment/pipeline/video/video_plan.py` records bounded local inputs for an
offline diagnostic. It has no renderer, provider, subprocess, download,
credential, approval, or production path. Its CLI requires `--root`; every
input and output path is relative to that directory. Traversal, symlinks,
oversized files, malformed JSON, and output overwrites fail closed.

The motion guidance comes from `orgs/figment/research/r15b-edit-motion.md`:
use a single clothed adult subject, a short action, and begin with a small test
(60 frames at 12 fps). This is planning guidance only. It does not establish
accepted upstream lineage, render a video, or perform visual, duration,
identity, or temporal QA.

## Evidence records

`figment/video-first-frame-input@1` records a local first-frame path, byte
count, and SHA-256. It rejects approval-shaped fields and reports
`unverified-local-input`; the record is not an operator acceptance receipt.

`figment/video-diagnostic-plan@1` accepts only `--mode diagnostic`. It records
the 60-frame budget and sample indices 0, 29, and 59, but sets `renderer` to
`null`, `offline_only` to true, and `not_promotable` to true. Production mode is
rejected until real upstream lineage and human gates are wired.

`figment/video-sample-inventory@1` hashes a supplied candidate file and three
supplied image files. It calls their relationship
`unverified-local-inventory`: the files were not extracted from the video and
are not evidence of timing, duration, identity, or temporal quality. The
inventory only verifies that its separately supplied initial image matches the
diagnostic plan's input hash.

## Model status

The plan names the Wan 2.2 I2V candidate only as `blocked-unadopted`. Figment has
no approved video tensor-pin profile or safe asset inventory, so this code does
not download or run it. The official project describes the Wan 2.2 I2V family
and its installation requirements, while the pinned model revision lists the
artifacts and the repository's model page labels the licence Apache-2.0. These
external statements remain adoption research, not an approved pin.

- [Wan 2.2 official repository](https://github.com/Wan-Video/Wan2.2)
- [Wan 2.2 I2V pinned model revision](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B/tree/00182421b2da3589352abed7e139a6bd5c1f86ab)

## Local use

```powershell
python orgs/figment/pipeline/video/video_plan.py plan `
  --root .\diagnostic `
  --persona persona.json `
  --first-frame-input first-frame-input.json `
  --driving-video driving.mp4 `
  --action "walk slowly toward the camera in a fully clothed street-style shot" `
  --out plan.json

python orgs/figment/pipeline/video/video_plan.py samples `
  --root .\diagnostic `
  --plan plan.json `
  --video candidate.mp4 `
  --initial-frame accepted.png `
  --first supplied-first.png `
  --middle supplied-middle.png `
  --last supplied-last.png `
  --out samples.json
```

Future rendering needs separately approved model adoption, safe asset intake,
real upstream lineage, actual media extraction and temporal QA, and the
pipeline's human gates. None is represented as completed by these records.
