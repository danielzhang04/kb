#!/usr/bin/env python3
"""build_grading_board.py — self-contained offline HTML grading board.

Ported from faceless-youtube's `build_review_artifact.py` (see
orgs/figment/pipeline/reuse-from-fyt.md). Preserved: images inlined as base64 data-URIs so
the page has zero network calls and zero sibling-file dependencies, a lightbox viewer,
and a flagged/parked-only filter. Adapted: FYT's card fields (shot class, VO line, motion
intent) are dropped — this reads a figment batch manifest (see qa_stamp.py's schema) and
adds a `--blind` mode, which is the entire point of a blind trial (trial-protocol.md).

Dependency: Pillow (image re-encode + size-budget control). FYT's original also required
it for the identical reason — no stdlib module can re-encode arbitrary PNG/JPEG/WEBP input
to a size-budgeted JPEG. Install once:  py -3 -m pip install pillow

Blind mode (`--blind`):
  * Never renders `arm` or `prompt_setup_id`, even if the manifest carries them (a manifest
    built by blind_pool.py's pool mode never does, but this flag is defensive regardless of
    what the manifest happens to contain).
  * Always shuffles display order (its own shuffle — never trust upstream ordering to be
    innocent of arm correlation).
  * Still shows `image_id` and the review_status/parked_reasons the grader (or a prior
    stamp_review pass) produced — a defect description names no arm, so it is safe to show.

Non-blind mode renders the full card: id, arm, prompt_setup_id, review_status badge,
parked_reasons — this is figment's general "look at a batch" surface, used e.g. to review
a single arm's output or to inspect a stamped board after de-anonymizing.

Usage:
  py -3 build_grading_board.py --manifest <manifest.json> --out <board.html>
      [--blind] [--title T] [--seed N] [--max-width 1600] [--quality 85] [--budget-mb 20]

Reads the manifest's `images` list (see qa_stamp.py). Image `path` is resolved relative to
the manifest file's own directory when not absolute.
"""
import argparse
import base64
import html
import io
import json
import os
import random
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  py -3 -m pip install pillow")


# ---------- data ----------

def load_manifest(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    images = data.get("images") if isinstance(data, dict) else data
    if not images:
        sys.exit(f"no images found in manifest {path}")
    base_dir = path.resolve().parent
    out = []
    for e in images:
        if not isinstance(e, dict):
            sys.exit(f"malformed manifest image entry: expected an object, got {type(e).__name__}: {e!r}")
        iid = e.get("image_id") or e.get("id")
        rel = e.get("path")
        if not iid or not rel:
            sys.exit(f"manifest entry missing image_id or path: {e!r}")
        p = Path(rel)
        if not p.is_absolute():
            p = base_dir / p
        out.append(dict(
            image_id=iid,
            path=p,
            arm=e.get("arm"),
            prompt_setup_id=e.get("prompt_setup_id"),
            review_status=e.get("review_status") or "unreviewed",
            parked_reasons=e.get("parked_reasons") or [],
        ))
    return out


def checkerboard(size, sq=16):
    """Transparency checker — a flat fill makes a matted cutout look like an opaque box,
    which reads as a defect that isn't there. Show alpha honestly (ported verbatim from
    build_review_artifact.py — schema-neutral image handling, not FYT-style-specific)."""
    bg = Image.new("RGB", size, (255, 255, 255))
    px = bg.load()
    for y in range(size[1]):
        for x in range(size[0]):
            if ((x // sq) + (y // sq)) % 2:
                px[x, y] = (214, 214, 218)
    return bg


def _encode(im, quality):
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def inline_budgeted(path: Path, max_w: int, quality: int, per_image_budget: int):
    """Re-encode `path` as a JPEG data-URI, shrinking width then quality until it fits
    `per_image_budget` bytes or hits a sane floor. Size-budget-aware so a large batch stays
    a manageable single HTML file instead of ballooning unboundedly."""
    im = Image.open(path)
    im = im.convert("RGBA") if im.mode == "P" else im
    if im.mode == "RGBA":
        bg = checkerboard(im.size)
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im = im.convert("RGB")

    width = max_w
    q = quality
    QUALITY_FLOOR, WIDTH_FLOOR = 40, 480
    while True:
        work = im
        if work.width > width:
            work = work.resize((width, round(work.height * width / work.width)), Image.LANCZOS)
        data = _encode(work, q)
        if len(data) <= per_image_budget or (q <= QUALITY_FLOOR and width <= WIDTH_FLOOR):
            return "data:image/jpeg;base64," + base64.b64encode(data).decode(), len(data)
        if q > QUALITY_FLOOR:
            q = max(QUALITY_FLOOR, q - 10)
        else:
            width = max(WIDTH_FLOOR, round(width * 0.85))


# ---------- render ----------

CSS = """
*{box-sizing:border-box}
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b6560;--card:#fff;--line:#e5e0d8;--flag:#c0392b;--ok:#2f7d4f}
@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#f0ece4;--mut:#9a938a;--card:#211d17;--line:#332d24}}
:root[data-theme=dark]{--bg:#16140f;--fg:#f0ece4;--mut:#9a938a;--card:#211d17;--line:#332d24}
:root[data-theme=light]{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b6560;--card:#fff;--line:#e5e0d8}
body{margin:0;background:var(--bg);color:var(--fg);
 font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:26px;margin:0 0 4px}
.sub{color:var(--mut);margin:0 0 22px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:22px}
button{font:inherit;padding:7px 13px;border:1px solid var(--line);border-radius:7px;
 background:var(--card);color:var(--fg);cursor:pointer}
button[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:26px}
.card{background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:hidden;
 display:flex;flex-direction:column}
.card.flag{border-color:var(--flag);border-width:2px}
.card img{width:100%;display:block;cursor:zoom-in;background:#f0f0f2}
.meta{padding:13px 15px 15px}
.hd{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:7px}
.id{font-weight:650;font-size:16px}
.tag{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:20px;padding:1px 8px}
.badge{color:#fff;font-size:11px;border-radius:20px;padding:2px 9px}
.badge.parked{background:var(--flag)}
.badge.verified{background:var(--ok)}
.badge.unreviewed{background:var(--mut)}
.rsn{margin:8px 0 0;color:var(--flag);font-size:13px}
.rsn li{margin:2px 0}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.94);display:none;z-index:99;
 flex-direction:column;align-items:center;justify-content:center}
#lb.on{display:flex}
#lb img{max-width:94vw;max-height:78vh;object-fit:contain}
#lbm{color:#fff;max-width:900px;text-align:center;padding:14px 20px}
.nav{position:absolute;top:50%;transform:translateY(-50%);font-size:34px;color:#fff;
 background:rgba(255,255,255,.1);border:0;border-radius:50%;width:52px;height:52px;cursor:pointer}
#prev{left:18px}#next{right:18px}
.hint{position:absolute;bottom:14px;color:#8a8378;font-size:12px}
@media(max-width:560px){.grid{grid-template-columns:1fr}}
"""

JS = """
const cards=[...document.querySelectorAll('.card')];
let data=cards.map(c=>({src:c.querySelector('img').src,html:c.querySelector('.meta').innerHTML}));
let i=0;const lb=document.getElementById('lb'),lbi=document.getElementById('lbi'),lbm=document.getElementById('lbm');
function vis(){return cards.map((c,n)=>[c,n]).filter(([c])=>c.style.display!=='none').map(([,n])=>n)}
function show(n){i=n;lbi.src=data[n].src;lbm.innerHTML=data[n].html;lb.classList.add('on')}
function step(d){const v=vis();if(!v.length)return;let k=v.indexOf(i);k=(k+d+v.length)%v.length;show(v[k])}
cards.forEach((c,n)=>c.querySelector('img').addEventListener('click',()=>show(n)));
document.getElementById('next').onclick=e=>{e.stopPropagation();step(1)};
document.getElementById('prev').onclick=e=>{e.stopPropagation();step(-1)};
lb.addEventListener('click',e=>{if(e.target===lb)lb.classList.remove('on')});
addEventListener('keydown',e=>{
  if(!lb.classList.contains('on'))return;
  if(e.key==='ArrowRight'||e.key==='l'||e.key==='L'){e.preventDefault();step(1)}
  if(e.key==='ArrowLeft' ||e.key==='h'||e.key==='H'){e.preventDefault();step(-1)}
  if(e.key==='Escape')lb.classList.remove('on');
});
const fb=document.getElementById('fb');let on=false;
fb.onclick=()=>{on=!on;fb.setAttribute('aria-pressed',on);
  cards.forEach(c=>c.style.display=(!on||c.classList.contains('flag'))?'':'none')};
"""


def build(images, title, subtitle, blind, max_w, quality, budget_mb):
    total_budget = int(budget_mb * 1e6)
    per_image_budget = max(50_000, int(total_budget * 0.9 / max(1, len(images))))

    out, total = [], 0
    for e in images:
        uri, nb = inline_budgeted(e["path"], max_w, quality, per_image_budget)
        total += nb
        status = e["review_status"]
        parked = status == "parked"
        flag = " flag" if parked else ""
        badge = '<span class="badge %s">%s</span>' % (status, status.upper())
        tags = ""
        if not blind:
            if e["arm"]:
                tags += '<span class="tag">arm %s</span>' % html.escape(str(e["arm"]))
            if e["prompt_setup_id"]:
                tags += '<span class="tag">%s</span>' % html.escape(str(e["prompt_setup_id"]))
        reasons = e["parked_reasons"]
        rsn = ""
        if reasons:
            items = "".join("<li>%s</li>" % html.escape(str(r)) for r in reasons)
            rsn = '<ul class="rsn">%s</ul>' % items
        out.append(
            '<figure class="card%s"><img loading="lazy" src="%s" alt="%s">'
            '<div class="meta"><div class="hd"><span class="id">%s</span>%s%s</div>%s</div></figure>'
            % (flag, uri, html.escape(e["image_id"]), html.escape(e["image_id"]), tags, badge, rsn)
        )

    nflag = sum(1 for e in images if e["review_status"] == "parked")
    mode_note = "blind — arm/source hidden, order shuffled" if blind else "not blind"
    page = (
        "<title>%s</title><style>%s</style><div class=wrap><h1>%s</h1>"
        "<p class=sub>%s &middot; %s</p><div class=bar>"
        "<button id=fb aria-pressed=false>Parked only (%d)</button>"
        "<span class=sub style='margin:0'>click an image to zoom · "
        "<b>&larr;</b>/<b>&rarr;</b> to step · <b>Esc</b> to close</span></div>"
        "<div class=grid>%s</div></div>"
        "<div id=lb><button class=nav id=prev>&lsaquo;</button><img id=lbi>"
        "<div id=lbm></div><button class=nav id=next>&rsaquo;</button>"
        "<span class=hint>&larr; / &rarr; to step · Esc to close</span></div><script>%s</script>"
        % (html.escape(title), CSS, html.escape(title), html.escape(subtitle), mode_note,
           nflag, "".join(out), JS)
    )
    return page, total


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="build_grading_board.py",
        description="Build a self-contained offline HTML grading board from a figment batch manifest.",
    )
    ap.add_argument("--manifest", required=True, type=Path, help="path to the batch manifest JSON")
    ap.add_argument("--out", required=True, type=Path, help="path to write the board HTML")
    ap.add_argument("--title", default="Grading board")
    ap.add_argument("--blind", action="store_true",
                     help="hide arm/prompt_setup_id and shuffle display order — the blind-trial mode")
    ap.add_argument("--seed", type=int, default=None,
                     help="shuffle seed (default: random each run; printed either way)")
    ap.add_argument("--max-width", type=int, default=1600)
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--budget-mb", type=float, default=20.0,
                     help="soft cap on total inlined image bytes; images are downscaled to fit")
    return ap


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)

    if not args.manifest.exists():
        sys.exit(f"no manifest at {args.manifest}")

    images = load_manifest(args.manifest)

    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(2**31)
    if args.blind or args.seed is not None:
        random.Random(seed).shuffle(images)
    print(f"display order seed: {seed}", file=sys.stderr)

    missing = [e["image_id"] for e in images if not e["path"].exists()]
    if missing:
        sys.exit(f"{len(missing)} image(s) not found on disk, e.g. {missing[0]}")

    sub = "%d image(s)" % len(images)
    page, nb = build(images, args.title, sub, args.blind, args.max_width, args.quality, args.budget_mb)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(page, encoding="utf-8")
    print("%s  (%d images, %.1f MB inlined, %.1f MB page)"
          % (args.out, len(images), nb / 1e6, args.out.stat().st_size / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
