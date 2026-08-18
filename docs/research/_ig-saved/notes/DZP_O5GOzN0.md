# DZP_O5GOzN0 — TurboVec - open-source vector index
- post: https://www.instagram.com/p/DZP_O5GOzN0/ | author: @Marc Kaz | published: 20260606 | duration: 28s

## What's demonstrated
A talking-head reaction video reading aloud a GitHub README for **turbovec**, an open-source Rust vector index. No live demo, no terminal run, no benchmark walkthrough — just the README text on screen while the presenter narrates and reacts.

## Dashboard / UI-UX observed
None — talking-head over a single static GitHub README screenshot (repo `RyanCodrai/turbovec`) held on screen for the entire 28s. The README shows: repo tabs (README / Contributing / MIT license), a hero graphic ("turbovec — Google's TurboQuant for vector search" with a colorful line/point diagram), badge row (license MIT, pypi v0.7.0, crates.io v0.8.0, paper arXiv), a one-line pitch ("A 10 million document corpus takes 31 GB of RAM as float32. turbovec fits it in 4 GB — and searches it faster than FAISS."), a prose paragraph, a bulleted feature list (Online ingest, Faster than FAISS, Filter at search time, Pure local), and a Python code block:
```
pip install turbovec

from turbovec import TurboQuantIndex
index = TurboQuantIndex(dim=1536, bit_width=4)
index.add(vectors)
index.add(more_vectors)
```
No dashboard, app UI, or architecture diagram beyond this standard README layout — not relevant to the "capture the UI" priority for this batch.

## Concrete mechanism
turbovec is described as a Rust vector index (with Python bindings) implementing Google Research's TurboQuant algorithm: a "data-oblivious quantizer that matches the Shannon lower bound on distortion, with no codebook training and no separate train phase." Claims: online ingest (vectors indexed on add, no rebuild as corpus grows), hand-written NEON (ARM) and AVX-512BW (x86) SIMD kernels beating FAISS IndexPQFastScan by 12-20% on ARM and matching/beating it on x86, filter-at-search-time via id allowlist/slot bitmask, and fully local/no managed service (no data leaves the machine/VPC).

## Named tools / repos / models / APIs
- turbovec — https://github.com/RyanCodrai/turbovec [frame + audio]
- Google Research's TurboQuant algorithm — [frame + audio, "built on Google Research's TurboQuant"]
- FAISS — comparison baseline, IndexPQFastScan specifically named [frame]
- Python package `turbovec`, class `TurboQuantIndex` — [frame]

## Specific claim / result
"A 10 million document corpus takes 31 GB of RAM as float32. turbovec fits it in 4 GB — and searches it faster than FAISS." [frame, README text] — an ~8x memory reduction claim (matches caption's "16x" figure loosely — caption says 16x/31GB→4GB which is actually ~7.75x, so the caption's "16x" appears to be an error or refers to a different bit-width setting; the on-screen README states 31GB→4GB directly). "12-20% faster than FAISS IndexPQFastScan on ARM, match-or-beat on x86" [frame]. These are the README's own claims, not independently verified in the video — no benchmark run is shown on screen.

## Novel / buildable moments (with timestamps)
None of UI/UX substance — this reel is pure content (a real open-source library worth knowing about for kb's own vector-search needs, given kb runs local-first tooling), not a visual/mechanism to replicate.

## Transcript highlights
- "Google just found a way to shrink 31 gigabytes of AI memory down to 4 gigs." [0:00-0:07]
- "turbovec is a new open source vector index built on Google Research's TurboQuant that delivers extreme compression without sacrificing much performance." [0:07-0:24]

## Reliability
Thin content video — 28 seconds of a presenter reading a static README aloud with reaction faces, no demo, no independent verification of the compression/speed claims. No dashboard or UI to steal. Only value: a pointer to a real, named, linkable open-source library (`RyanCodrai/turbovec`) that could be worth evaluating directly if kb ever needs local vector search — but that evaluation should go to the repo itself, not this video.
