# Local identity-observer adoption plan

`pipeline/train/identity_observe_adopt.py` is a local preparation tool for the
additive raw YuNet/SFace observer. It accepts only a
`pending-independent-review` pin manifest, so preparation must precede a separate
admission decision. It does not itself admit pins, invoke the observer, open a
candidate image, or change a gate or threshold.

On 2026-09-08 the preparer ran while the predecessor manifest was pending
(receipt pin SHA-256 `eef05d54f7bb4d72fb42ca917445f5a1b7f0ba27ee76673b9ce75bff6b916791`).
Its private `adoption.json` is SHA-256
`1e0b3a3ed6ef9c7be987eaddc7741e7a90c19e73da9e6b5df363c71cb2db076b` and records
`verified-artifacts-and-venv`. The current pin manifest was later separately
admitted as SHA-256 `e2886b2ec453970ee0222a7df8fa8d11f1afd7002feef5f8cdd469fc148d717a`.
That admission and installed private runtime do not turn the preparation receipt
into an identity, quality, gate, or approval result.

The script's default is a no-I/O plan:

```powershell
C:\Users\danie\AppData\Local\Programs\Python\Python313\python.exe `
  orgs/figment/pipeline/train/identity_observe_adopt.py
```

After independent review, `--apply` creates only the fresh private directory
`C:\Users\danie\kb\_private\figment-identity-observer-20260908`. It downloads
the two ONNX files from the exact OpenCV Hugging Face revisions recorded in
`identity_observe_pins.json`. GitHub serves these ONNX objects as Git LFS pointers,
so the script uses the same pinned OpenCV Zoo GitHub commit only for the matching
LFS-pointer evidence and model-directory `LICENSE` texts. It saves and parses
each GitHub pointer, requiring its `oid sha256` and `size` lines to equal the
immutable Hugging Face pin, then verifies the downloaded model bytes independently.
The local
`adoption.json` records the fetched URLs and hashes;
it is preparation provenance, not a model-admission or approval artifact.

The Windows wheel is the exact PyPI
`opencv_python_headless-4.12.0.88-cp37-abi3-win_amd64.whl` file, 38,923,559
bytes, SHA-256
`86b413bdd6c6bf497832e346cd5371995de148e579b9774f8eba686dee3f5528`.
At preparation the Python 3.13 NumPy was 2.4.6, outside the OpenCV 4.12 requirement
used here (`>=2,<2.3`), so preparation selected an isolated venv and installed the
pinned NumPy 2.2.5 CPython-3.13 Windows wheel (12,638,356 bytes, SHA-256
`d8882a829fd779f0f43998e931c466802a77ca1ee0fe25a3abe50278616b1471`) before
the verified OpenCV wheel. It also installs the pinned Pillow 12.3.0 CPython-3.13
Windows wheel (7,239,691 bytes, SHA-256
`1cca606cd25738df4ed873d5ad46bbdb3d83b5cbca291f6b4ff13a4df6b0bbe8`), which the
observer needs for bounded image-header inspection. If a later host has compatible
NumPy, the same tool uses a system-site-packages venv instead and does not download
the NumPy fallback.

The source records are the [OpenCV Zoo commit](https://github.com/opencv/opencv_zoo/commit/47534e27c9851bb1128ccc0102f1145e27f23f98), the pinned [YuNet license](https://github.com/opencv/opencv_zoo/blob/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/LICENSE), pinned [SFace license](https://github.com/opencv/opencv_zoo/blob/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/LICENSE), [OpenCV wheel release](https://pypi.org/project/opencv-python-headless/4.12.0.88/), and [NumPy 2.2.5 wheel release](https://pypi.org/project/numpy/2.2.5/). The pin manifest preserves the model hashes as the final integrity check; the model files are Git LFS assets rather than an inference-quality endorsement.
