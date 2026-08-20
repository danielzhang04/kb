# -*- coding: utf-8 -*-
"""crop_battery.py — deterministic face/hand crop battery (dormant tooling).

No active review procedure calls this helper and no verdict depends on it. Active review uses the
machine board at ordinary viewing scale. A localizer may supply per-figure bounding boxes; this
script deterministically cuts crops and builds a labeled contact sheet. `--diff` builds a paired
before/after sheet.

boxes JSON schema (normalized 0-1, top-left origin):
  {"figures": [{"name": "macgregor", "face": [x0,y0,x1,y1], "hands": [[x0,y0,x1,y1], ...]}]}
"""
import argparse, json, os, sys
from PIL import Image, ImageDraw, ImageFont

MIN_SIDE = 360          # upscale so a face crop is judgeable
PAD = 0.06              # relative padding around each box


def _load(p):
    return Image.open(p).convert("RGB")


def _crop(im, box):
    W, H = im.size
    x0, y0, x1, y1 = box
    pw, ph = (x1 - x0) * PAD + 0.005, (y1 - y0) * PAD + 0.005
    px0, py0 = max(0, int((x0 - pw) * W)), max(0, int((y0 - ph) * H))
    px1, py1 = min(W, int((x1 + pw) * W)), min(H, int((y1 + ph) * H))
    if px1 <= px0 or py1 <= py0:
        return None
    c = im.crop((px0, py0, px1, py1))
    s = max(1.0, MIN_SIDE / min(c.width, c.height))
    if s > 1.0:
        c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
    return c


def battery(frame, boxes, outdir, tag=""):
    im = _load(frame)
    stem = os.path.splitext(os.path.basename(frame))[0] + (f"--{tag}" if tag else "")
    os.makedirs(outdir, exist_ok=True)
    made = []  # (label, path, PIL)
    for fig in boxes["figures"]:
        name = fig["name"].replace(" ", "-")
        parts = ([("face", fig.get("face"))]
                 + [(f"hand{i+1}", hb) for i, hb in enumerate(fig.get("hands") or [])]
                 + [(f"ear{i+1}", eb) for i, eb in enumerate(fig.get("ear_zones") or [])])
        for label, box in parts:
            if not box:
                continue
            c = _crop(im, box)
            if c is None:
                print(f"WARN degenerate box {name}/{label}", file=sys.stderr)
                continue
            p = os.path.join(outdir, f"{stem}--{name}--{label}.png")
            c.save(p)
            made.append((f"{name}/{label}", p, c))
            print("crop:", p)
    return stem, made


def sheet(stem, made, outdir, suffix="SHEET"):
    if not made:
        return None
    cell_w = max(m[2].width for m in made)
    cell_h = max(m[2].height for m in made) + 34
    cols = min(4, len(made))
    rows = (len(made) + cols - 1) // cols
    S = Image.new("RGB", (cols * cell_w + 16, rows * cell_h + 16), (24, 24, 24))
    d = ImageDraw.Draw(S)
    try:
        f = ImageFont.truetype("arial.ttf", 22)
    except OSError:
        f = ImageFont.load_default()
    for i, (label, _, c) in enumerate(made):
        x = 8 + (i % cols) * cell_w
        y = 8 + (i // cols) * cell_h
        S.paste(c, (x, y))
        d.text((x + 4, y + c.height + 4), label, fill=(255, 235, 160), font=f)
    p = os.path.join(outdir, f"{stem}--{suffix}.png")
    S.save(p)
    print("sheet:", p)
    return p


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frame")
    ap.add_argument("--boxes")
    ap.add_argument("--diff", nargs=2, metavar=("OLD", "NEW"))
    ap.add_argument("--boxes-old")
    ap.add_argument("--boxes-new")
    ap.add_argument("--outdir", required=True)
    a = ap.parse_args()
    if a.diff:
        so, mo = battery(a.diff[0], json.load(open(a.boxes_old, encoding="utf-8")), a.outdir, "before")
        sn, mn = battery(a.diff[1], json.load(open(a.boxes_new, encoding="utf-8")), a.outdir, "after")
        sheet(sn.replace("--after", ""), mo + mn, a.outdir, "DIFF")
    else:
        stem, made = battery(a.frame, json.load(open(a.boxes, encoding="utf-8")), a.outdir)
        sheet(stem, made, a.outdir)
