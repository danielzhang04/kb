# Offline identity-embedding readiness

## Finding

The current face-identity scorer is not ready for an offline, hash-pinned run.
`pipeline/train/identity_check.py` constructs `facenet_pytorch.MTCNN` and
`InceptionResnetV1(pretrained="vggface2")`. The installed package loads `.pt`
state dictionaries with `torch.load` and downloads the VGGFace2 checkpoint when
the cache lacks it. The Python 3.13 cache contains only an 84,141,911-byte
`955717e8-8726e21a.th` file; it does not contain
`20180402-114759-vggface2.pt`. The same module's DINOv2 helper calls
`torch.hub.load`, so it is also excluded from an offline scorer.

This is a format and provenance finding, not a new quality threshold or a
verdict about any image. The age model has a separate safetensors pin in
`identity_gate.py`; it is not an identity embedder.

## Candidate for separate adoption

Use the OpenCV Zoo pair below only after a separate model-adoption change pins
the exact source revision, file bytes, and local paths. Both assets are ONNX,
so this route does not deserialize a PyTorch pickle. ONNX parsing still needs a
patched runtime and full SHA-256 verification before session construction.

| Role | Candidate file | SHA-256 and size | License evidence |
| --- | --- | --- | --- |
| face detection and five landmarks | `face_detection_yunet_2023mar.onnx` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`, 233 kB | The upstream YuNet directory states that all files are MIT-licensed. [YuNet README](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md) |
| aligned face embedding | `face_recognition_sface_2021dec.onnx` | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`, 38.7 MB | The upstream SFace directory states that all files are Apache-2.0-licensed. [SFace README](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/README.md) |

OpenCV's own hosted model pages expose those exact file digests for
[YuNet](https://huggingface.co/opencv/face_detection_yunet/blob/main/face_detection_yunet_2023mar.onnx)
and
[SFace](https://huggingface.co/opencv/face_recognition_sface/blob/main/face_recognition_sface_2021dec.onnx).
At the time of this initial audit, the pair had no cached local copy and `cv2`
was not installed in the examined Python 3.13 environment. `onnxruntime` 1.27.0
was installed, but it did not
replace the detector's landmark decode and SFace alignment implementation.
Adoption therefore needs either a locked OpenCV package version or a reviewed
local ONNX pre/post-processing implementation; it must not add auto-download.

The explicit directory-level model-file licenses make this a better
commercial-use candidate than the current scorer, subject to preserving their
notices and normal legal review. It is not a claim that training-data history
or deployment law has been independently cleared.

## Fixed detector preprocessing v2

The admitted local observer keeps its native detector path as the default and
emits `figment/identity-observation@1` for that legacy behavior. Its only
alternate detector option is `fixed-max-edge-640@1`, which emits
`figment/identity-observation@2`. It applies one deterministic rule to every
detector input: when `max(width, height)` exceeds 640, resize to a maximum edge
of 640 with preserved aspect ratio and `cv2.INTER_AREA`; otherwise do not
upscale. The receipt records original and detector dimensions, the actual
rounded `sx` and `sy`, interpolation, face count, detector-space face, and the
bounding box and five landmarks mapped back to original pixels for the
candidate and every anchor.

SFace receives the original decoded pixels and those mapped coordinates. The
resize is detector-only and remains in memory. It does not lower the 0.9 YuNet
score threshold, change NMS/top-k, choose a different resize by sample, alter
the exactly-one-face rule, or change a gate. `@1` and `@2` raw values are not
calibrated or cross-version comparable.

The fixed rule follows a detector-only probe on g01, g02, and the paired 1595
candidate/control: native input produced face counts 1, 2, 0, and 0; the fixed
640 detector inputs produced 1, 1, 1, and 1 with the same detector settings.
The probe is `_private/figment-identity-observer-20260908/detector-probe-fixed640-v1.json`.
The pinned YuNet README says its training scheme targets faces around 10×10 to
300×300 pixels. [Pinned YuNet README](https://raw.githubusercontent.com/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/README.md)

## Rejected reuse paths

* **Existing FaceNet/MTCNN:** `facenet-pytorch` identifies the pretrained
  choices as VGGFace2 or CASIA-WebFace, auto-downloads the state dictionary,
  and calls `torch.load`; it fails the safe-format and offline requirements.
  [Upstream loader](https://github.com/timesler/facenet-pytorch/blob/master/models/inception_resnet_v1.py)
* **InsightFace packs:** the upstream project distinguishes its MIT code from
  public pretrained models, which it says are non-commercial research only
  unless separately licensed. Do not substitute `buffalo_*`, `antelopev2`, or
  other InsightFace weights merely because their files are ONNX.
  [InsightFace licensing](https://github.com/deepinsight/insightface/blob/master/server/LICENSING.md)
* **DINOv2 helper:** it uses `torch.hub` and its current cache is a `.pth` file;
  it is not an offline, safe-format face embedder.

## Minimal raw-observation contract

Keep any future backend behind an additive `observe(image, anchors)` interface.
After both model files have passed their pinned size and SHA-256 checks, it
should return only:

```json
{
  "schema": "figment/identity-observation@1",
  "image_sha256": "…",
  "backend": {
    "detector": {"id": "yunet-2023mar", "sha256": "…"},
    "recognizer": {"id": "sface-2021dec", "sha256": "…"}
  },
  "face": {"detected": true, "bbox_xywh": [0, 0, 0, 0], "score": 0.0, "landmarks5": []},
  "anchor_cosines": {"g01": 0.0},
  "unavailable_reason": null
}
```

The selected-face rule, image hash, detector score, five landmarks, and every
anchor cosine make later calibration reproducible. Do not serialize a pass/fail
field, a threshold, an approval state, or a raw embedding vector. Calibration
may compare these unthresholded observations with the existing anchor sets, but
cannot alter gate thresholds or promote media.
