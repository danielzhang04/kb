# Figment local video-frame extraction

`orgs/figment/pipeline/video/frame_extract.py` is a local diagnostic adapter
for the installed FFmpeg 8 binaries at the fixed Python 3.13 Scripts paths. It
does not download a model, start a pod, call a provider, score identity, or
approve or promote media.

The adapter accepts only root-relative video and destination paths. Absolute
paths, `..` traversal, symlinks and Windows reparse points/junctions (including
root ancestors), collisions, and
missing files fail closed. It caps source video bytes at 2 GiB, duration at 30
seconds, decoded frames at 720, dimensions at 16,777,216 pixels, and each
extracted PNG at 32 MiB. All child processes use fixed trusted binary paths,
argument arrays with `shell=False`, disabled stdin, and a 30-second timeout.
FFmpeg output is discarded; ffprobe metadata is incrementally capped at 64 KiB
before parsing.

It probes the source with `ffprobe`, including an actual decoded frame count,
then extracts decoded frame indices `0`, `frame_count // 2`, and
`frame_count - 1` through FFmpeg's `select` filter. Each output is re-probed
for matching dimensions and SHA-256 hashed in a private temporary name before
an atomic publish. The source is SHA-256 hashed both before and after
extraction; a changed input prevents the immutable receipt. Any failed run
removes the fresh directory it created, including partially extracted frames;
existing directories are never touched.

The receipt, `figment/video-frame-extraction@1`, records source hashes,
bounded metadata, exact decoded indices, and frame hashes. Its provenance says
only that frames were locally extracted from the pinned source bytes. It makes
no identity, temporal-quality, operator-approval, or promotion claim.

```powershell
python orgs/figment/pipeline/video/frame_extract.py `
  --root .\diagnostic `
  --video driving.mp4 `
  --out extracted-frames
```

The command creates a fresh `extracted-frames/` directory containing
`first.png`, `middle.png`, `last.png`, and `frame-extraction.json`. Existing
directories are never reused or overwritten.

## Ordered PNG assembly

`frame_assemble.py` accepts a frozen non-promotable I2V manifest and a local
receipt with successful-harness fields: `figment/runpod-run@1`, `dry_run: false`,
verified teardown, no error, and a terminated placement. This schema/state
validation cannot authenticate the issuer; parent/provider evidence remains
separate. The harness record can bind only its one job's output name, seed,
ordered 81 downloaded PNG names, and byte counts. The
adapter computes local PNG SHA-256 values itself; it does not claim that the
receipt binds an executed workflow hash, identity, or temporal quality.

It requires `output_name_01.png` through `_81.png`, probes every frame,
enforces the 16-fps 81-frame manifest budget, and writes a fresh non-promotable
MP4 only after hashes hold before and after assembly. FFprobe then checks 81
decoded frames and the 81/16-second duration.

```powershell
python orgs/figment/pipeline/video/frame_assemble.py `
  --root .\diagnostic `
  --manifest manifest.json `
  --run-receipt run\run.json `
  --out assembled
```

FFmpeg documents the stream-selection and filtering model used by the adapter:

Validation on 2026-09-08: the first independent review requested junction guards,
bounded probe output, and partial-output cleanup. The author repaired all three;
the parent read the final implementation and ran the eight focused tests, including
real color-video extraction, actual Windows junctions, oversized probe output, and
failure after one extracted frame. All eight passed. This establishes extraction
mechanics, not video generation or temporal identity quality.

[FFmpeg filters documentation](https://ffmpeg.org/ffmpeg-filters.html) and
[ffprobe documentation](https://ffmpeg.org/ffprobe.html).
