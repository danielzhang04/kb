"""One-off generator for creator-002's SYNTHETIC placeholder anchor images.

These are NOT real photographs of a real person -- they are flat-colour PIL
canvases with a crude drawn face shape, used only so the pipeline's file-shape
and non-empty-asset checks (persona.py's `require_assets`, build_grade's
anchor-size check) have real bytes to point at while the real anchor shoot is
outstanding. Each is >=800px on its short side per the acceptance brief.
Replace all three with real anchor photography before this persona is ever
planned against a live pod (see ../README.md).

Run once (`python make_placeholders.py`) and then delete this script, or leave
it -- it is idempotent and produces byte-identical output on every run.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent

# (filename, background colour, face colour) -- three different angles/lighting
# framings of the SAME placeholder face, distinct solid colours only so the three
# files are trivially distinguishable in a directory listing; the drawn shape is a
# crude oval+features sketch, never anything that could read as a real photograph.
PLATES = [
    ("c002-a1.jpg", (210, 190, 170), (225, 205, 185)),  # front, flat-white placeholder
    ("c002-a2.jpg", (180, 165, 150), (200, 180, 160)),  # three-quarter, window-day placeholder
    ("c002-a3.jpg", (150, 130, 115), (170, 150, 130)),  # half-body, lamp-night placeholder
]

SIZE = (832, 1088)  # short side 832 >= the 800px floor the brief asks for


def _draw_placeholder_face(canvas_color, face_color) -> Image.Image:
    img = Image.new("RGB", SIZE, canvas_color)
    draw = ImageDraw.Draw(img)
    w, h = SIZE
    cx, cy = w // 2, int(h * 0.38)
    face_w, face_h = int(w * 0.32), int(h * 0.24)
    # face oval
    draw.ellipse(
        [cx - face_w, cy - face_h, cx + face_w, cy + face_h], fill=face_color,
    )
    # crude eyes
    eye_y = cy - face_h // 6
    for dx in (-face_w // 2, face_w // 2):
        draw.ellipse(
            [cx + dx - 14, eye_y - 14, cx + dx + 14, eye_y + 14], fill=(60, 45, 40),
        )
    # crude mouth
    draw.arc(
        [cx - face_w // 2, cy + face_h // 4, cx + face_w // 2, cy + face_h],
        start=20, end=160, fill=(120, 70, 70), width=6,
    )
    # neck/shoulders block so the frame reads as a portrait, not a floating head
    draw.rectangle(
        [cx - face_w, cy + face_h, cx + face_w, h], fill=tuple(max(0, c - 25) for c in face_color),
    )
    # placeholder watermark text baked into the pixels themselves
    draw.text((20, h - 40), "SYNTHETIC PLACEHOLDER - NOT A REAL PERSON", fill=(255, 0, 0))
    return img


def main() -> None:
    for filename, canvas_color, face_color in PLATES:
        img = _draw_placeholder_face(canvas_color, face_color)
        img.save(HERE / filename, format="JPEG", quality=90)
        print(f"wrote {HERE / filename} {img.size}")


if __name__ == "__main__":
    main()
