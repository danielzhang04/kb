#!/usr/bin/env python3
"""finalize_thumbnail.py — turn a chosen thumbnail candidate into the publishable asset.

The forge thumb flow (see SKILL.md §Thumbnail) generates a `thumbnail.primary` candidate
plus challengers from `metadata.json`'s `thumbnail` concept, staged under
`assets/thumbs/`. Nothing else in the pipeline produces the ACTUAL publishable file
`compliance_check.py` and `publish-queue` require: `<video_dir>/assets/thumbnail.png` at
exactly YouTube's 1280x720. This script closes that gap, deterministically:

  1. Center-crop the candidate to 16:9 (crops the long axis, keeps the other axis full).
  2. LANCZOS-resize the crop to exactly 1280x720.
  3. Refuse (exit 1) if the crop is narrower than 640px — resizing that up to 1280 is a
     real upscale, not a downscale, and the result would be visibly soft.
  4. Overwrite `assets/thumbnail.png` idempotently (safe to re-run on the same candidate).

Run with native `py -3`. PIL only, no network.

CLI:
  py -3 finalize_thumbnail.py <candidate.png> <video_dir>
"""
import os
import sys

from PIL import Image

TARGET_W, TARGET_H = 1280, 720
TARGET_RATIO = TARGET_W / TARGET_H
MIN_CROP_WIDTH = 640  # below this, the 1280-wide output would be a real upscale


def compute_crop_box(w, h, target_ratio=TARGET_RATIO):
    """Return the center 16:9 crop box (x0, y0, x1, y1) for a w x h source.

    Wider-than-16:9 sources crop the width (keep full height); taller-than-16:9 sources
    (the common case — 4:3 stills, near-square candidates) crop the height (keep full
    width). An exact-16:9 source is returned uncropped.
    """
    current_ratio = w / h
    if abs(current_ratio - target_ratio) < 1e-9:
        return (0, 0, w, h)
    if current_ratio > target_ratio:
        new_w = round(h * target_ratio)
        x0 = (w - new_w) // 2
        return (x0, 0, x0 + new_w, h)
    new_h = round(w / target_ratio)
    y0 = (h - new_h) // 2
    return (0, y0, w, y0 + new_h)


def finalize_thumbnail(candidate_path, video_dir):
    """Center-crop `candidate_path` to 16:9, LANCZOS-resize to 1280x720, and write
    `<video_dir>/assets/thumbnail.png` (creating `assets/` if needed; overwriting any
    existing file). Returns the output path.

    Raises ValueError (the CLI turns this into exit 1) when the candidate is too narrow
    to downscale cleanly to 1280 wide — refuses to upscale.
    """
    with Image.open(candidate_path) as src:
        im = src.convert("RGB")
        w, h = im.size
        box = compute_crop_box(w, h)
        crop_w = box[2] - box[0]
        if crop_w < MIN_CROP_WIDTH:
            raise ValueError(
                f"refusing to upscale: candidate {w}x{h} crops to {crop_w}px wide, "
                f"below the {MIN_CROP_WIDTH}px minimum for a clean 1280-wide downscale"
            )
        cropped = im.crop(box)
        out = cropped.resize((TARGET_W, TARGET_H), Image.LANCZOS)

    assets_dir = os.path.join(video_dir, "assets")
    os.makedirs(assets_dir, exist_ok=True)
    out_path = os.path.join(assets_dir, "thumbnail.png")
    out.save(out_path, "PNG")
    return out_path


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("usage: py -3 finalize_thumbnail.py <candidate.png> <video_dir>", file=sys.stderr)
        return 1
    candidate_path, video_dir = argv
    try:
        out_path = finalize_thumbnail(candidate_path, video_dir)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 1
    except (FileNotFoundError, OSError) as e:
        print(f"finalize_thumbnail: {e}", file=sys.stderr)
        return 1
    print(f"thumbnail: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
