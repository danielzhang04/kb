# -*- coding: utf-8 -*-
"""crop_battery.py — deterministic face/hand crop battery (round-2 verify law).

A localizer agent supplies per-figure bounding boxes; this script executes the crops at high zoom
and builds a labeled contact sheet. Crops are the EVIDENCE a judge agent must cite per ruling — a
rig verdict without a crop path is inadmissible. --diff builds a paired before/after sheet so a fix
pass is regression-checked on EVERY figure.

boxes JSON schema (normalized 0-1, top-left origin):
  {"figures": [{"name": "macgregor", "face": [x0,y0,x1,y1], "hands": [[x0,y0,x1,y1], ...]}]}

--batch runs the battery across MANY frames at once (a 25-shot review packet is 157 crops + 25
sheets; serially that is ~1h of wall clock for local PIL work with no cross-frame dependency).
Each entry is independent — its own frame, its own boxes, its own output files — so a bounded
thread pool (--concurrency, default 4; 1 reproduces today's serial order exactly) is safe:
`battery()`/`sheet()` themselves are UNCHANGED, only which thread calls them differs. Output is
identical either way — same crop files, same sheet files, same deterministic `batch-index.json`.
"""
import argparse, json, os, sys
from concurrent.futures import ThreadPoolExecutor
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


def _one_batch_entry(entry, outdir):
    """One `--batch` entry -> its crops + sheet, via the SAME `battery()`/`sheet()` used by the
    single-frame CLI path — no separate parallel code path to drift out of sync with serial."""
    frame = entry["frame"]
    tag = entry.get("tag", "")
    boxes = json.load(open(entry["boxes"], encoding="utf-8"))
    stem, made = battery(frame, boxes, outdir, tag)
    sheet_path = sheet(stem, made, outdir)
    return {
        "frame": frame,
        "tag": tag,
        "stem": stem,
        "crops": sorted(p for _, p, _ in made),
        "sheet": sheet_path,
    }


def run_batch(entries, outdir, concurrency=1):
    """Crop/contact-sheet production across MANY frames. `concurrency<=1` walks `entries` in the
    given order, single-threaded — byte-identical to calling `battery()`/`sheet()` in a loop.
    `concurrency>1` runs up to N entries at once via a bounded thread pool (each entry is fully
    independent local PIL work — its own frame, its own boxes, its own output files — so there is
    no shared mutable state across entries to race on).

    Returns (index_path, results): `results` is a list sorted by frame stem, so the written
    `batch-index.json` — and the return value — are deterministic regardless of `entries` order or
    `concurrency`, which is exactly what makes a serial-vs-parallel run byte-comparable."""
    os.makedirs(outdir, exist_ok=True)
    if concurrency <= 1:
        results = [_one_batch_entry(e, outdir) for e in entries]
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            results = list(ex.map(lambda e: _one_batch_entry(e, outdir), entries))
    results.sort(key=lambda r: r["stem"])
    index_path = os.path.join(outdir, "batch-index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    print(f"batch: {len(results)} frames -> {index_path}")
    return index_path, results


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frame")
    ap.add_argument("--boxes")
    ap.add_argument("--diff", nargs=2, metavar=("OLD", "NEW"))
    ap.add_argument("--boxes-old")
    ap.add_argument("--boxes-new")
    ap.add_argument("--batch", help="JSON list of {frame, boxes, tag?} entries — runs the battery "
                                    "across many frames (see --concurrency)")
    ap.add_argument("--concurrency", type=int, default=4,
                    help="--batch: thread-pool size for parallel crop/sheet production (default "
                         "4; 1 reproduces today's serial order/output exactly — local PIL work, "
                         "no cross-frame dependency)")
    ap.add_argument("--outdir", required=True)
    a = ap.parse_args()
    if a.batch:
        run_batch(json.load(open(a.batch, encoding="utf-8")), a.outdir, a.concurrency)
    elif a.diff:
        so, mo = battery(a.diff[0], json.load(open(a.boxes_old, encoding="utf-8")), a.outdir, "before")
        sn, mn = battery(a.diff[1], json.load(open(a.boxes_new, encoding="utf-8")), a.outdir, "after")
        sheet(sn.replace("--after", ""), mo + mn, a.outdir, "DIFF")
    else:
        stem, made = battery(a.frame, json.load(open(a.boxes, encoding="utf-8")), a.outdir)
        sheet(stem, made, a.outdir)
