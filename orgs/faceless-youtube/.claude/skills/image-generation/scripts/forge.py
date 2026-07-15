#!/usr/bin/env python3
"""image-generation engine — deterministic image generation from a channel's locked style bible.

The SKILL (Claude) owns judgment (registry lookup decisions, VERIFYING outputs against the acceptance
checklist, the retry/escalate loop). This script owns the mechanics: read the bible's locked descriptor,
seed off the right reference frame, call the image engine, stage the output, and index verified assets.

Reads (per channel visual-kit):
  <kit>/style-bible.md          §2 identity descriptor + §2b style-only descriptor (blockquotes)
  <kit>/registry/registry.json  characters + assets (seed frames, reuse index)
  <kit>/refs/<character>/...     canonical reference frames to seed from

Subcommands:
  gen      generate one or a --batch of assets into <kit>/_staging/  (does NOT auto-register)
  montage  build a QC contact sheet of a directory for Claude to open
  register move a VERIFIED staged frame into refs/ and add it to registry.json
  lookup   reuse-before-regenerate: print an existing asset's file for (character, tag) if present
  diff     held-set drift gate for the delta-chain — HOLD/DRIFT verdict vs --threshold
  crop     cut native-resolution crops (auto grid or explicit boxes) for a native-scale finger count
  place    move a VERIFIED staged frame into a video dir (library|scenes) with size+PNG validation
  manifest emit the render-builder scenes|library manifest from a small spec (not free-typed)

Run with native `py -3` (msys python lacks a CA bundle). No pip deps except optional certifi/Pillow.
"""
import json, os, ssl, sys, base64, urllib.request, urllib.error, time, argparse, shutil

def load_env(root):
    env = {}
    p = os.path.join(root, ".env")
    for line in open(p, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k] = v
    return env

def ctx():
    try:
        import certifi; return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()

def nano(url, parts, aspect, context):
    payload = {"contents": [{"parts": parts}],
               "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    for a in range(5):
        try:
            with urllib.request.urlopen(req, context=context, timeout=300) as r:
                j = json.load(r)
            for p in j.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                if "inlineData" in p:
                    data = base64.b64decode(p["inlineData"]["data"])
                    if not data:  # S1-A: an empty inlineData decode is a failed gen, not a valid image
                        raise RuntimeError("empty inlineData in response")
                    return data
            raise RuntimeError("no image in response")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and a < 4:
                time.sleep(12); continue
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode(errors='ignore')[:160]}")
        except (urllib.error.URLError, TimeoutError):
            if a < 4:
                time.sleep(8); continue
            raise

def b64(p): return base64.b64encode(open(p, "rb").read()).decode()
def ip(p): return {"inlineData": {"mimeType": "image/png", "data": b64(p)}}

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"

def to_png_bytes(data):
    """Normalize the engine's returned image to PNG at the ONE place bytes enter the pipeline.
    The engine (gemini-3-pro-image) returns image/jpeg; everything downstream (refs, registry,
    render, the diff/crop tools) assumes .png, so transcode
    JPEG -> PNG here rather than leaking a mislabeled file. Unknown formats pass through untouched so
    validate_png raises the bad-magic error."""
    if not data or len(data) <= 1024:
        return data  # let validate_png raise the size error
    if data.startswith(PNG_MAGIC):
        return data
    if data.startswith(JPEG_MAGIC):
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(data)).convert("RGB")
        buf = io.BytesIO(); im.save(buf, format="PNG")
        return buf.getvalue()
    return data

def validate_png(data):
    """S1-A: reject empty/undersized/non-PNG bytes BEFORE they ever touch disk, so a failed gen
    can never leave a 0-byte survivor that skip-if-exists treats as done and render picks up."""
    n = len(data) if data else 0
    if n <= 1024:
        raise RuntimeError(f"image too small ({n} bytes) — refusing to write")
    if not data.startswith(PNG_MAGIC):
        raise RuntimeError("bytes are not a valid PNG (bad magic) — refusing to write")

def blockquote_after(md, header):
    """Extract the '> ...' blockquote immediately following a '## <header>' line."""
    lines = md.splitlines()
    out, capturing = [], False
    for ln in lines:
        if ln.strip().startswith("## ") and header in ln:
            capturing = "seek"
            continue
        if capturing == "seek":
            if ln.strip().startswith(">"):
                capturing = True
            elif ln.strip() == "":
                continue
            else:
                continue
        if capturing is True:
            if ln.strip().startswith(">"):
                out.append(ln.strip()[1:].strip())
            elif ln.strip() == "" and out:
                break
    return " ".join(out).strip()

def _is_char_seed(path):
    """A seed path carries a FIGURE (character canonical, per-video library copy, or a prior scene
    frame in a held-set chain) — as opposed to an environment plate or a recurring PROP. Drives the
    rig-hold auto-append (the human-figure prior). A prop canonical (`prop-<name>.png`, Task A2) is an
    object, not a figure, so it is exempt exactly like an env plate."""
    rp = str(path).replace("\\", "/")
    if "/refs/env/" in rp:
        return False
    if os.path.basename(rp).startswith("prop-"):
        return False
    return ("/refs/" in rp) or ("/assets/library/" in rp) or ("/assets/scenes/" in rp)


def should_hold(mode, resolved_seeds):
    """Append the §2c RIG-HOLD block when a figure is in frame AND the mode isn't `identity`
    (identity gens already carry the full rig via the §2 descriptor, so re-appending is redundant)."""
    if mode not in ("new_character", "environment", "style"):
        return False
    return any(_is_char_seed(s) for s in resolved_seeds)


class Kit:
    def __init__(self, kit):
        self.kit = os.path.abspath(kit)
        # repo root = two levels above channels/<name>/visual-kit -> walk up to find .env
        d = self.kit
        while d and not os.path.exists(os.path.join(d, ".env")):
            nd = os.path.dirname(d)
            if nd == d: break
            d = nd
        self.root = d
        self.bible = os.path.join(self.kit, "style-bible.md")
        self.reg_path = os.path.join(self.kit, "registry", "registry.json")
        self.refs = os.path.join(self.kit, "refs")
        self.staging = os.path.join(self.kit, "_staging")
        md = open(self.bible, encoding="utf-8").read()
        self.desc_identity = blockquote_after(md, "LOCKED STYLE descriptor")
        self.desc_style = blockquote_after(md, "STYLE-ONLY descriptor")
        self.desc_righold = blockquote_after(md, "RIG-HOLD descriptor")
        self.reg = json.load(open(self.reg_path, encoding="utf-8"))
        env = load_env(self.root)
        self.key = env["GEMINI_API_KEY"]
        self.model = self.reg.get("engine", "gemini-3-pro-image")
        self.url = self.url_for()
        self.ctx = ctx()

    def url_for(self):
        # ONE engine for every generation: the registry `engine` (gemini-3-pro-image). No tiers.
        return f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.key}"

    def base_frame(self, character):
        c = self.reg.get("characters", {}).get(character)
        if not c:
            raise SystemExit(f"unknown character '{character}' — add it to registry first")
        return os.path.join(self.root, c["base"])

    def resolve_seed(self, s):
        # accept repo-relative path, absolute path, or 'character/name'
        if os.path.isabs(s) and os.path.exists(s): return s
        for cand in (os.path.join(self.root, s),          # repo-relative
                     os.path.join(self.kit, s),           # kit-relative (e.g. refs/base/base.png)
                     os.path.join(self.refs, s if s.endswith(".png") else s + ".png")):  # refs-relative (base/base)
            if os.path.exists(cand): return cand
        raise SystemExit(f"seed frame not found: {s}")

    def prompt_for(self, mode, delta, hold=False):
        if mode == "identity":
            text = self.desc_identity + "\n\n" + delta
        elif mode in ("new_character", "environment", "style"):
            text = self.desc_style + "\n\n" + delta
        else:
            raise SystemExit(f"unknown mode '{mode}'")
        if hold and self.desc_righold:
            text = text + "\n\n" + self.desc_righold
        return text

def cmd_gen(k, reqs, force):
    os.makedirs(k.staging, exist_ok=True)
    results = []
    for r in reqs:
        name = r["name"]; mode = r.get("mode", "identity")
        out = os.path.join(k.staging, name + ".png")
        if os.path.exists(out) and not force:
            results.append((name, "skip (exists in staging)")); continue
        seeds = r.get("seed")
        if not seeds:
            # A5: only identity / new-character gens auto-seed the character portrait. environment &
            # style plates default to NO image seed (else the base FACE bleeds into figure-free plates).
            seeds = [k.base_frame(r.get("character", "base"))] if mode in ("identity", "new_character") else []
        else:
            seeds = [k.resolve_seed(s) for s in seeds]
        hold = should_hold(mode, seeds)
        parts = [ip(s) for s in seeds] + [{"text": k.prompt_for(mode, r["delta"], hold=hold)}]
        try:
            # S1-A: compute + validate the bytes BEFORE opening the file, so a failed/empty gen can
            # never truncate `out` to a 0-byte survivor that skip-if-exists + render then treat as done.
            data = nano(k.url, parts, r.get("aspect", "2:3"), k.ctx)
            data = to_png_bytes(data)  # engine returns JPEG; normalize to the pipeline's PNG contract
            validate_png(data)
            with open(out, "wb") as f:
                f.write(data)
            results.append((name, "OK -> _staging/" + name + ".png"))
        except Exception as e:
            results.append((name, "ERR " + str(e)[:160]))
    for n, s in results:
        print(f"  {n}: {s}", flush=True)

def cmd_montage(k, folder, out, cols):
    try:
        from PIL import Image, ImageDraw
    except Exception:
        raise SystemExit("montage needs Pillow: py -3 -m pip install Pillow")
    d = folder if os.path.isabs(folder) else os.path.join(k.kit, folder)
    names = sorted(f for f in os.listdir(d) if f.endswith(".png"))
    if not names:
        raise SystemExit("no PNGs in " + d)
    tw, th, pad, lab = 300, 450, 12, 22
    rows = (len(names) + cols - 1) // cols
    W = cols * tw + (cols + 1) * pad
    H = rows * (th + lab) + (rows + 1) * pad
    canvas = Image.new("RGB", (W, H), (207, 207, 207)); dr = ImageDraw.Draw(canvas)
    for i, n in enumerate(names):
        rr, cc = divmod(i, cols)
        x = pad + cc * (tw + pad); y = pad + rr * (th + lab)
        im = Image.open(os.path.join(d, n)).convert("RGB"); im.thumbnail((tw, th))
        canvas.paste(im, (x + (tw - im.width) // 2, y)); dr.text((x + 2, y + th + 4), n[:-4], fill=(30, 30, 30))
    canvas.save(out); print("montage:", out, canvas.size, len(names), "tiles")

def cmd_register(k, entries):
    reg = k.reg
    for e in entries:
        name = e["name"]; character = e.get("character", "base")
        kind = e.get("kind", "expression"); tag = e.get("tag", name)
        is_env = e.get("environment", False)
        subdir = "env" if is_env else character
        dest_dir = os.path.join(k.refs, subdir); os.makedirs(dest_dir, exist_ok=True)
        src = os.path.join(k.staging, name + ".png")
        if not os.path.exists(src):
            print(f"  {name}: MISSING in staging — generate + verify first"); continue
        if not is_env and character not in reg.get("characters", {}):
            print(f"  {name}: character '{character}' not in registry characters — add its entry "
                  f"(role/head_tone/base) first; file left in staging"); continue
        dst = os.path.join(dest_dir, name + ".png"); shutil.move(src, dst)
        rel = os.path.relpath(dst, k.root).replace("\\", "/")
        # drop any existing entry with same name
        reg["assets"] = [a for a in reg.get("assets", []) if a["name"] != name]
        entry = {"name": name, "file": rel, "character": None if is_env else character,
                 "kind": "environment" if is_env else kind, "tag": tag}
        if not is_env:
            entry["seed_frame"] = reg["characters"][character]["base"]
        reg.setdefault("assets", []).append(entry)
        print(f"  {name}: registered -> {rel}")
    json.dump(reg, open(k.reg_path, "w", encoding="utf-8"), indent=2)

def cmd_lookup(k, character, tag):
    for a in k.reg.get("assets", []):
        if a.get("character") == character and a.get("tag") == tag:
            print("REUSE:", a["file"]); return
    print("MISS: no existing asset for", character, tag, "— generate a new one")

def cmd_diff(k, pa, pb, changed, threshold):
    """A6: held-set drift gate for the seeded delta-chain. Measures mean-abs pixel diff (0=identical)
    on the region that should NOT have changed (the "held" region) and prints an explicit HOLD/DRIFT
    verdict against --threshold. --changed says where the intended delta is:
      left|right|top|bottom -> score the OPPOSITE (held) half;
      center|full           -> no clean 'away' half, so score a structural signal: the outer border
                               band (the frame ring), which a held set keeps stable even on a full redraw."""
    try:
        from PIL import Image
        import numpy as np
    except Exception:
        raise SystemExit("diff needs Pillow+numpy: py -3 -m pip install Pillow numpy")
    def load(p):
        p = p if os.path.isabs(p) else k.resolve_seed(p)
        return np.asarray(Image.open(p).convert("L").resize((512, 512)), dtype="float32")
    A, B = load(pa), load(pb)
    md = lambda X, Y: round(float(np.abs(X - Y).mean()), 2)
    changed = (changed or "full").lower()
    if changed == "left":
        signal, region = md(A[:, 256:], B[:, 256:]), "right (held) half"
    elif changed == "right":
        signal, region = md(A[:, :256], B[:, :256]), "left (held) half"
    elif changed == "top":
        signal, region = md(A[256:], B[256:]), "bottom (held) half"
    elif changed == "bottom":
        signal, region = md(A[:256], B[:256]), "top (held) half"
    elif changed in ("center", "full"):
        band = 64
        mask = np.ones((512, 512), dtype=bool); mask[band:-band, band:-band] = False
        signal = round(float(np.abs(A - B)[mask].mean()), 2)
        region = f"{band}px border band (structural)"
    else:
        raise SystemExit("--changed must be one of left|right|top|bottom|center|full")
    verdict = "HOLD" if signal <= threshold else "DRIFT"
    print(f"held-set diff (0=identical): whole {md(A, B)}  held-signal {signal} [{region}]  "
          f"threshold {threshold}  -> {verdict}", flush=True)

def cmd_crop(k, in_path, regions, out_dir, grid):
    """Q5: cut NATIVE-resolution crops so a per-hand digit count is judged at full scale (montage
    downscales, which is worse for counting). --regions auto tiles the frame into a grid×grid grid;
    --regions "x,y,w,h;x,y,w,h;..." cuts explicit boxes. Writes <stem>-<tag>.png into --out."""
    try:
        from PIL import Image
    except Exception:
        raise SystemExit("crop needs Pillow: py -3 -m pip install Pillow")
    if not in_path:
        raise SystemExit("crop needs --in <png>")
    src = in_path if os.path.isabs(in_path) else k.resolve_seed(in_path)
    im = Image.open(src).convert("RGB")
    W, H = im.size
    out_dir = out_dir or os.path.join(k.staging, "_crops")
    out_dir = out_dir if os.path.isabs(out_dir) else os.path.join(k.kit, out_dir)
    os.makedirs(out_dir, exist_ok=True)
    boxes = []
    if not regions or regions.lower() == "auto":
        n = max(1, grid)
        cw, ch = W // n, H // n
        for ry in range(n):
            for rx in range(n):
                boxes.append((rx * cw, ry * ch, cw, ch, f"r{ry}c{rx}"))
    else:
        for i, spec in enumerate(s for s in regions.split(";") if s.strip()):
            try:
                x, y, w, h = (int(v) for v in spec.split(","))
            except ValueError:
                raise SystemExit(f"bad region '{spec}' — want x,y,w,h")
            boxes.append((x, y, w, h, f"crop{i}"))
    stem = os.path.splitext(os.path.basename(src))[0]
    saved = []
    for x, y, w, h, tag in boxes:
        # native resolution — NO downscale, so digits stay countable
        c = im.crop((x, y, min(x + w, W), min(y + h, H)))
        p = os.path.join(out_dir, f"{stem}-{tag}.png")
        c.save(p); saved.append(p)
    print(f"crop: {len(saved)} native-scale crop(s) of {W}x{H} -> {out_dir}", flush=True)
    for p in saved:
        print("  " + p, flush=True)

def cmd_place(k, names, to_dir):
    """Q7: move a VERIFIED staged frame into a video dir (assets/library or assets/scenes) with
    size + PNG-magic validation, so a copy-into-video-dir step can't silently place a bad/0-byte
    file that render then picks up by filename. Replaces the hand-typed copy."""
    if not to_dir:
        raise SystemExit("place needs --to <videos/slug/assets/{library|scenes}>")
    dest = to_dir if os.path.isabs(to_dir) else os.path.join(k.root, to_dir)
    os.makedirs(dest, exist_ok=True)
    for name in names:
        if not name:
            continue
        src = os.path.join(k.staging, name + ".png")
        if not os.path.exists(src):
            print(f"  {name}: MISSING in staging — generate + verify first"); continue
        try:
            validate_png(open(src, "rb").read())
        except Exception as e:
            print(f"  {name}: INVALID — {e}; left in staging"); continue
        dst = os.path.join(dest, name + ".png")
        shutil.copy2(src, dst)
        print(f"  {name}: placed -> {os.path.relpath(dst, k.root).replace(chr(92), '/')}", flush=True)

def cmd_manifest(k, kind, spec_path, out, to_dir, slug, notes):
    """Q7: emit the manifest render-builder depends on from a small spec, instead of free-typing it
    (a drifted/forgotten manifest key silently degrades render). --kind scenes -> shots[]; library ->
    assets[]. Spec is a JSON list of entries OR an object already carrying that array; this wraps it
    in the {video_slug, generated, notes, <shots|assets>} envelope and validates the required keys."""
    if kind not in ("scenes", "library"):
        raise SystemExit("manifest needs --kind scenes|library")
    key = "shots" if kind == "scenes" else "assets"
    req = ("shot_id", "file") if kind == "scenes" else ("name", "file")
    spec = json.load(open(spec_path, encoding="utf-8"))
    if isinstance(spec, list):
        entries, env = spec, {}
    elif isinstance(spec, dict):
        env = spec
        entries = spec.get(key) or spec.get("shots") or spec.get("assets") or []
    else:
        raise SystemExit("spec must be a JSON list of entries or an object with a shots/assets array")
    for i, e in enumerate(entries):
        miss = [f for f in req if not e.get(f)]
        if miss:
            raise SystemExit(f"{kind} entry #{i} missing required key(s): {', '.join(miss)}")
    manifest = {
        "video_slug": slug or env.get("video_slug") or "",
        "generated": env.get("generated") or time.strftime("%Y-%m-%d"),
        "notes": notes or env.get("notes") or "",
        key: entries,
    }
    if out:
        out_path = out if os.path.isabs(out) else os.path.join(k.root, out)
    else:
        base = to_dir if os.path.isabs(to_dir) else os.path.join(k.root, to_dir or "")
        out_path = os.path.join(base, "manifest.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(manifest, open(out_path, "w", encoding="utf-8"), indent=2)
    print(f"manifest ({kind}): {len(entries)} entries -> {out_path}", flush=True)

def harden_alpha(rgba, lo=100, hi=175):
    """Push a soft rembg matte to a crisp edge: alpha < lo -> 0, > hi -> 255, linear between."""
    r, g, b, a = rgba.split()
    a = a.point(lambda v: 0 if v < lo else (255 if v > hi else int((v - lo) / (hi - lo) * 255)))
    from PIL import Image
    return Image.merge("RGBA", (r, g, b, a))


def trim_to_alpha(rgba):
    """Crop to the alpha bounding box (drops fully-transparent margins)."""
    bbox = rgba.split()[3].getbbox()
    return rgba.crop(bbox) if bbox else rgba


def cmd_cutout(in_path, out_path, lo, hi):
    from PIL import Image
    from rembg import remove, new_session
    src = Image.open(in_path).convert("RGBA")
    rgba = remove(src, session=new_session("u2net"), alpha_matting=True,
                  alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10,
                  alpha_matting_erode_size=10).convert("RGBA")
    out = trim_to_alpha(harden_alpha(rgba, lo, hi))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    out.save(out_path)
    print(f"cutout: {in_path} -> {out_path} {out.size}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "montage", "register", "lookup", "diff", "crop", "place", "manifest", "cutout"])
    ap.add_argument("--kit", required=True, help="path to the channel's visual-kit dir")
    ap.add_argument("--batch", help="gen/register/place/manifest: JSON file with a list of requests/entries/names")
    ap.add_argument("--name"); ap.add_argument("--character", default="base")
    ap.add_argument("--mode", default="identity"); ap.add_argument("--delta")
    ap.add_argument("--aspect", default="2:3"); ap.add_argument("--seed", help="comma-separated seed frames")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dir", help="montage: folder of PNGs (rel to kit or abs)")
    ap.add_argument("--out", help="montage: output png path"); ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--tag")
    ap.add_argument("--a", help="diff: first image (repo/kit/abs path)")
    ap.add_argument("--b", help="diff: second image (repo/kit/abs path)")
    # A6 diff gate
    ap.add_argument("--changed", default="full",
                    help="diff: where the intended delta is (left|right|top|bottom|center|full)")
    ap.add_argument("--threshold", type=float, default=10.0,
                    help="diff: mean-abs held-signal above this = DRIFT (default 10.0)")
    # Q5 crop
    ap.add_argument("--in", dest="in_path", help="crop: source PNG (repo/kit/abs path)")
    ap.add_argument("--regions", help="crop: 'auto' (grid tiles) or 'x,y,w,h;x,y,w,h;...'")
    ap.add_argument("--grid", type=int, default=3, help="crop: N for the auto N×N tiling (default 3)")
    # cutout (rembg -> alpha-harden -> trim)
    ap.add_argument("--lo", type=int, default=100, help="cutout: alpha-harden low threshold")
    ap.add_argument("--hi", type=int, default=175, help="cutout: alpha-harden high threshold")
    # Q7 place / manifest
    ap.add_argument("--to", help="place/manifest: destination dir (e.g. videos/<slug>/assets/scenes)")
    ap.add_argument("--kind", choices=["scenes", "library"], help="manifest: which manifest to emit")
    ap.add_argument("--slug", help="manifest: video_slug for the envelope")
    ap.add_argument("--notes", help="manifest: free-text notes for the envelope")
    a = ap.parse_args()
    k = Kit(a.kit)
    if a.cmd == "gen":
        if a.batch:
            reqs = json.load(open(a.batch, encoding="utf-8"))
        else:
            reqs = [{"name": a.name, "character": a.character, "mode": a.mode, "delta": a.delta,
                     "aspect": a.aspect, "seed": a.seed.split(",") if a.seed else None}]
        cmd_gen(k, reqs, a.force)
    elif a.cmd == "montage":
        cmd_montage(k, a.dir, a.out, a.cols)
    elif a.cmd == "register":
        entries = json.load(open(a.batch, encoding="utf-8")) if a.batch else [{
            "name": a.name, "character": a.character, "kind": a.mode, "tag": a.tag or a.name}]
        cmd_register(k, entries)
    elif a.cmd == "lookup":
        cmd_lookup(k, a.character, a.tag)
    elif a.cmd == "diff":
        cmd_diff(k, a.a, a.b, a.changed, a.threshold)
    elif a.cmd == "crop":
        cmd_crop(k, a.in_path, a.regions, a.out or a.to, a.grid)
    elif a.cmd == "place":
        names = json.load(open(a.batch, encoding="utf-8")) if a.batch else [a.name]
        cmd_place(k, names, a.to)
    elif a.cmd == "manifest":
        cmd_manifest(k, a.kind, a.batch, a.out, a.to, a.slug, a.notes)
    elif a.cmd == "cutout":
        if not a.in_path or not a.out:
            raise SystemExit("cutout needs --in <image> and --out <png>")
        cmd_cutout(a.in_path, a.out, a.lo, a.hi)

if __name__ == "__main__":
    main()
