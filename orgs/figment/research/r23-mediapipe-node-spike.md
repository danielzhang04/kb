# R23 — ComfyUI native MediaPipe face detection: node spike

Method: shallow-cloned `comfyanonymous/ComfyUI` at `v0.34.0` (our pin) into
scratch, grepped for `mediapipe`; bisected tags to find first support; shallow-cloned
`ltdrdata/ComfyUI-Impact-Pack` (default branch) for `MaskToSEGS`. Clones deleted after.

## Availability
`v0.34.0` already ships it — no need for `master`. First tag with it: **`v0.23.0`**
(confirmed via `git ls-tree v0.22.1` = empty, `git ls-tree v0.23.0` = present). This is a
pure-PyTorch reimplementation of MediaPipe Face Landmarker v2, not the `mediapipe` pip
package — **no extra pip install** (`requirements.txt` has no `mediapipe` entry; the port
file `comfy_extras/mediapipe/face_landmarker.py` imports only `numpy`, `torch`,
`scipy.special.expit`).

## Nodes (all in `comfy_extras/nodes_mediapipe.py`)
- `LoadMediaPipeFaceLandmarker` (L198) — `model_name: COMBO[detection folder]` →
  `FACE_DETECTION_MODEL`.
- `MediaPipeFaceLandmarker` (L227) — required: `face_detection_model:FACE_DETECTION_MODEL`,
  `image:IMAGE`, `detector_variant:COMBO["short","full","both"]=short`,
  `num_faces:INT=1 (0..16, 0=uncapped)`, `min_confidence:FLOAT=0.5`,
  `missing_frame_fallback:COMBO["empty","previous","interpolate"]=empty`. Outputs:
  `face_landmarks:FACE_LANDMARKS` (custom dict: frames/image_size/connection_sets) and
  `bboxes:BOUNDING_BOX` (per-frame list, not SEGS).
- `MediaPipeFaceMeshVisualize` (L329) — draws mesh overlay, outputs `IMAGE`.
- `MediaPipeFaceMask` (L442) — required: `face_landmarks:FACE_LANDMARKS`,
  `regions:DynamicCombo["all"|"custom"(face_oval/lips/left_eye/right_eye/irises toggles)]`.
  Output: `MASK` — union of filled polygons per frame (L442-498). **This is the MASK-out
  node to feed MaskToSEGS.**

Model file: category `"detection"` (folder_paths.py:67, `models/detection/`), filename
`mediapipe_face_fp32.safetensors`, source per both blueprint JSONs (`blueprints/Image Face
Detection (Mediapipe).json:525-526`, `Video ...:609-610`):
`https://huggingface.co/Comfy-Org/mediapipe/resolve/main/detection/mediapipe_face_fp32.safetensors`.
No sha256 is embedded in the repo (blueprint model block only carries `name`/`url`/`directory`,
no hash field).

## Impact-Pack `MaskToSEGS` (`ltdrdata/ComfyUI-Impact-Pack`, default branch @ `429d0159`,
`pyproject.toml` version `8.28.3`; `modules/impact/segs_nodes.py:1334`)
```
required: {
  mask: MASK,
  combined: BOOLEAN (default False),
  crop_factor: FLOAT (default 3.0, 1.0-100, step 0.1),
  bbox_fill: BOOLEAN (default False),
  drop_size: INT (default 10, 1..MAX_RESOLUTION),
  contour_fill: BOOLEAN (default False),
}
RETURN_TYPES = (SEGS,)
```
`requirements.txt` (repo root) does **not** pull `ultralytics` — only
`segment-anything, scikit-image, piexif, transformers, opencv-python-headless, scipy,
numpy, dill, matplotlib, git+facebookresearch/sam2`. (`ultralytics` appears only in
`tests/e2e_dd_compat.py`, an optional test file — Impact-Pack's bbox-detector nodes that
use YOLO live in a separate subpack, not needed for this MASK→SEGS path.)
`DetailerForEach` (`modules/impact/impact_pack.py:215`) takes `image, segs, model, clip,
vae, guide_size, guide_size_for, max_size, seed, steps, cfg, sampler_name, scheduler,
positive, negative, denoise, feather, noise_mask, force_inpaint, wildcard, cycle` (+
optional `detailer_hook, inpaint_model, noise_mask_feather, scheduler_func_opt,
tiled_encode, tiled_decode`) — relevant if the pipeline chains into inpainting later.

## Minimal API-format snippet: LoadImage → MediaPipe face → MASK → MaskToSEGS
```json
{
  "1": {"class_type": "LoadImage", "inputs": {"image": "input.png"}},
  "2": {"class_type": "LoadMediaPipeFaceLandmarker",
        "inputs": {"model_name": "mediapipe_face_fp32.safetensors"}},
  "3": {"class_type": "MediaPipeFaceLandmarker",
        "inputs": {"face_detection_model": ["2", 0], "image": ["1", 0],
                    "detector_variant": "short", "num_faces": 1,
                    "min_confidence": 0.5, "missing_frame_fallback": "empty"}},
  "4": {"class_type": "MediaPipeFaceMask",
        "inputs": {"face_landmarks": ["3", 0], "regions": {"regions": "all"}}},
  "5": {"class_type": "MaskToSEGS",
        "inputs": {"mask": ["4", 0], "combined": false, "crop_factor": 3.0,
                    "bbox_fill": false, "drop_size": 10, "contour_fill": false}}
}
```
Note: `MediaPipeFaceMask.regions` is a `DynamicCombo` widget — its API payload shape is
`{"regions": "all"}` (or `{"regions": "custom", "<feature>": true/false, ...}`), matching
`execute()` reading `connections["connections"]` / `regions["regions"]` (`nodes_mediapipe.py:369,475`).
