"""Build a self-contained human-review artifact for a batch of generated scenes.

The skill mandates publishing every generated frame for human review, but shipped no tool —
so each board got hand-built. This makes it repeatable.

Per image: the still, its shot id + class, the VO line it sits under, its intended animation
(camera + layer animations + device cards), and a reason badge if it is flagged.

Images are downscaled and inlined as data: URIs — the Artifact CSP blocks every external host,
so nothing may be referenced by URL.

C-12 (2026-08-04 doctrine reset): every card also gets a pre-filtered, EMPTY verdict checklist —
one row per invariant the shot's own entry actually declares — plus, for named-figure shots, a
canonical-vs-candidate comparison strip at ordinary viewing scale. This is the machine-emitted half
of "machine-emitted, human-eyed" review (adversarial-review-2026-08-04.md finding B4): the human
still writes every verdict, but never has to recall or type which invariants apply to which shot.
Filtering reads only `shots.json` + `assets/library/manifest.json` (this video's own Pass-1 identity
ledger — never `registry.json`, per the registry-promotion rule) — no cast or place name is
hardcoded anywhere below. Comparisons are never cropped/zoomed — `crop_battery.py` stays orphaned
(2026-08-03 ratified: "I don't need a super crazy review process... it just burns time").

Usage:
  py -3 build_review_artifact.py --video <video-dir> --out <out.html> [--title T]
                                 [--shots L01 L02 ...] [--max-width 1600] [--quality 82]

Requires Pillow. Reads shots.json + shots.motion.json + assets/scenes/manifest.json +
assets/library/manifest.json (optional — absence only narrows which rows fire, never crashes).
"""
import argparse, base64, io, json, os, re, sys, html

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  py -3 -m pip install pillow")


# ---------- data ----------

def load_json(p, default=None):
    if not os.path.exists(p):
        return default
    with io.open(p, encoding="utf-8") as f:
        return json.load(f)


def shot_index(video):
    d = load_json(os.path.join(video, "shots.json"), {})
    return {s["id"]: s for s in d.get("long_form", {}).get("shots", [])}


def motion_index(video):
    d = load_json(os.path.join(video, "shots.motion.json"), {})
    ms = d.get("shots") or d.get("long_form", {}).get("shots") or []
    return {m["id"]: m for m in ms}


def manifest_index(video):
    d = load_json(os.path.join(video, "assets", "scenes", "manifest.json"), {}) or {}
    entries = d.get("scenes") or d.get("entries") or d.get("shots") or []
    if isinstance(entries, dict):
        entries = list(entries.values())
    return {e.get("shot_id") or e.get("id"): e for e in entries if isinstance(e, dict)}


def library_assets(video):
    """This video's Pass-1 identity/pose/prop ledger (`assets/library/manifest.json`) — the real
    per-video cast + vocabulary store (a video's own cast never reaches `registry.json`; see
    registry-promotion rule). Each entry is `{name, kind, file, shots: [shot ids ...]}`. Absent ->
    `[]`, which only narrows row/comparison filtering below, never crashes it (this file is written
    by image-generation's Pass 1, which always runs before a shot can be reviewed)."""
    d = load_json(os.path.join(video, "assets", "library", "manifest.json"), {}) or {}
    assets = d.get("assets")
    return assets if isinstance(assets, list) else []


_SEATED_RE = re.compile(r"\bsit\b|\bseat", re.I)


def named_figures_by_shot(lib_assets):
    """shot id -> sorted names of the NAMED CAST (`kind == "identity"`) present in it, read
    straight from each asset's own `shots` list — generic by construction, since no character name
    is ever written in this file."""
    out = {}
    for a in lib_assets:
        if not isinstance(a, dict) or a.get("kind") != "identity":
            continue
        for sid in a.get("shots") or []:
            out.setdefault(sid, set()).add(a.get("name"))
    return {sid: sorted(n for n in names if n) for sid, names in out.items()}


def seated_shots(lib_assets):
    """shot ids where a SEATED pose primitive is in play, detected from the pose/action
    vocabulary's own `name`/`tag` (matches "sit"/"seat...") — the vocabulary itself is the
    channel's, never a per-video literal, so this stays generic across any cast."""
    out = set()
    for a in lib_assets:
        if not isinstance(a, dict) or a.get("kind") not in ("pose", "action"):
            continue
        label = "%s %s" % (a.get("name") or "", a.get("tag") or "")
        if _SEATED_RE.search(label):
            out.update(a.get("shots") or [])
    return out


def canonical_files(lib_assets):
    """named-figure name -> its canonical reference image path, as Pass 1 recorded it."""
    return {a["name"]: a["file"] for a in lib_assets
            if isinstance(a, dict) and a.get("kind") == "identity"
            and a.get("name") and a.get("file")}


# The place-owner check's REAL detection signal, landed by C-3/B4 as
# `lint_shots.py`'s `place_owner_check` (copied here, not imported — same
# cross-skill precedent as SEATED_PRIMITIVE below): the schema has exactly ONE
# real place-owner field, `owner_ambiguity` (shots-schema.md) — `owner_branding`/
# `place_owner` were never landed. An owner cue itself is not a separate field at
# all; it is authored as an ordinary quoted, alphabetic, proper-noun-shaped
# literal in `still_prompt` (a plaque/nameplate/lettering) — lint's own
# `_TRACKABLE_LITERAL` signal.
_OWNER_CUE_QUOTED = re.compile(r"['\"‘“]([A-Za-z][A-Za-z '&/-]{3,})['\"’”]")


def owner_branding_declared(shot):
    """True once THIS shot's own entry records a place-owner decision, either way — an
    authored owner cue (a quoted trackable literal in `still_prompt`, lint's own signal) or
    the deliberate `owner_ambiguity` escape (the schema's one real field). A place with no
    decision recorded yet emits no row: there is nothing to check against."""
    if "owner_ambiguity" in shot:
        return True
    return bool(_OWNER_CUE_QUOTED.search(shot.get("still_prompt") or ""))


# ---------- C-12: pre-filtered, machine-emitted verdict rows ----------
# One EMPTY row per (shot x applicable invariant) a human ticks by eye — never typed, never
# recalled from memory. `applicable_invariants` is the sole filter; every predicate reads only
# what the shot's own entry (or this video's own Pass-1 ledger) actually declares.
INVARIANTS = {
    "support-contact": "Seated named figure names a support + contact phrase (C-7)",
    "relative-scale": "Two named cast: plane / eye line / relative head scale stated (C-8)",
    "place-owner": "Owner cue visible on the plate, or the ambiguity is the intended read",
    "crowd": "Crowd reads as background rig, not named cast",
    "flat-cel-hazard": "One-voice flat-cel style holds (no gradient/gloss/bloom/etc., C-2)",
}


def applicable_invariants(shot, sid, named, seated):
    """The subset of `INVARIANTS` this shot needs, per C-12's pre-filter:
      * support-contact -> >=1 named figure present AND this shot uses a seated pose primitive
      * relative-scale  -> >=2 named figures present (measured, never authored)
      * place-owner     -> shot declares `place` AND its entry records an owner decision
      * crowd           -> `figures.crowd` is true
      * flat-cel-hazard -> `source == "ai-gen"` (every ai-gen shot carries the style risk)
    Returns an ordered list of `(slug, question)` pairs, `INVARIANTS`-order, empty when none apply.
    """
    rows = []
    if named and sid in seated:
        rows.append("support-contact")
    if len(named) >= 2:
        rows.append("relative-scale")
    if shot.get("place") and owner_branding_declared(shot):
        rows.append("place-owner")
    fig = shot.get("figures") if isinstance(shot.get("figures"), dict) else {}
    if fig.get("crowd"):
        rows.append("crowd")
    if shot.get("source") == "ai-gen":
        rows.append("flat-cel-hazard")
    return [(slug, INVARIANTS[slug]) for slug in rows]


def describe_animation(m):
    """Human-readable intent: camera + each layer + device cards."""
    if not m:
        return "—"
    bits = []
    cam = m.get("camera") or {}
    move = cam.get("move") or cam.get("type")
    if move and move not in ("none", "locked"):
        bits.append("camera: %s" % move)
    else:
        bits.append("camera: locked")
    for l in m.get("layers", []) or []:
        if l.get("source") == "engine":
            bits.append("card: %s (%s)" % (l.get("type") or "device", l.get("id")))
        else:
            a = l.get("animation") or {}
            kind = a.get("type") or a.get("kind") or "appear"
            bits.append("%s: %s" % (l.get("id"), kind))
    bg = m.get("background") or {}
    if bg.get("mode") == "delta-chain" and bg.get("plate"):
        bits.append("reuses %s" % os.path.basename(bg["plate"]))
    return " · ".join(bits) if bits else "—"


def collect(video, only):
    """One card per generated FILE (a shot may have a plate + several cutouts)."""
    S, M, MAN = shot_index(video), motion_index(video), manifest_index(video)
    LIB = library_assets(video)
    named_by_shot = named_figures_by_shot(LIB)
    seated = seated_shots(LIB)
    canon_file = canonical_files(LIB)
    cards = []
    for sid, s in S.items():
        if only and sid not in only:
            continue
        m, man = M.get(sid), MAN.get(sid, {})
        named = named_by_shot.get(sid, [])
        files = []
        for sub, label in (("scenes", "scene"), ("plates", "plate")):
            p = os.path.join(video, "assets", sub, sid + ".png")
            if os.path.exists(p):
                files.append((p, label))
        cdir = os.path.join(video, "assets", "cutouts")
        if os.path.isdir(cdir):
            for fn in sorted(os.listdir(cdir)):
                if fn.startswith(sid + "-") and fn.endswith(".png"):
                    files.append((os.path.join(cdir, fn),
                                  "cutout: " + fn[len(sid) + 1:-4]))
        # comparisons only on named-figure shots (>=1 named cast), and only when the canonical
        # file actually exists on disk — never invent a comparison for an unminted figure.
        canon_refs = [(n, canon_file[n]) for n in named
                      if n in canon_file and os.path.exists(canon_file[n])]
        invariants = applicable_invariants(s, sid, named, seated)
        for path, label in files:
            cards.append(dict(
                sid=sid, label=label, path=path,
                cls=s.get("shot_class") or "",
                vo=s.get("vo_text") or "",
                anim=describe_animation(m),
                flagged=bool(man.get("flagged")),
                reason=man.get("notes") or "",
                verified=man.get("verified") or {},
                invariants=invariants,
                canon=canon_refs,
            ))
    cards.sort(key=lambda c: (list(S).index(c["sid"]), c["label"]))
    return cards


def checkerboard(size, sq=16):
    """Transparency checker — a flat fill makes a matted cutout look like an opaque box,
    which reads as a defect that isn't there. Show the alpha honestly."""
    bg = Image.new("RGB", size, (255, 255, 255))
    px = bg.load()
    for y in range(size[1]):
        for x in range(size[0]):
            if ((x // sq) + (y // sq)) % 2:
                px[x, y] = (214, 214, 218)
    return bg


def inline(path, max_w, quality):
    im = Image.open(path)
    im = im.convert("RGBA") if im.mode == "P" else im
    if im.mode == "RGBA":
        bg = checkerboard(im.size)             # so transparency reads AS transparency
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im = im.convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), buf.tell()


# ---------- render ----------

CSS = """
*{box-sizing:border-box}
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b6560;--card:#fff;--line:#e5e0d8;--flag:#c0392b}
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
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:26px}
.card{background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:hidden;
 display:flex;flex-direction:column}
.card.flag{border-color:var(--flag);border-width:2px}
.card img{width:100%;display:block;cursor:zoom-in;background:#f0f0f2}
.meta{padding:13px 15px 15px}
.hd{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:7px}
.id{font-weight:650;font-size:16px}
.tag{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:20px;padding:1px 8px}
.vo{margin:0 0 8px;font-style:italic}
.anim{margin:0;color:var(--mut);font-size:13px}
.badge{background:var(--flag);color:#fff;font-size:11px;border-radius:20px;padding:2px 9px}
.rsn{margin:8px 0 0;color:var(--flag);font-size:13px}
.checks{list-style:none;margin:10px 0 0;padding:9px 0 0;border-top:1px dashed var(--line);
 display:flex;flex-direction:column;gap:5px}
.checks li{font-size:12.5px;color:var(--fg)}
.checks .slug{display:inline-block;min-width:112px;font-weight:650;color:var(--mut)}
.canon{margin:10px 0 0;padding:9px 0 0;border-top:1px dashed var(--line)}
.cmp{margin:0 0 6px;font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.03em}
.canon .strip{display:flex;gap:8px;flex-wrap:wrap}
.canon figure{margin:0;width:96px}
.canon img{width:100%;border-radius:6px;border:1px solid var(--line);display:block}
.canon figcaption{font-size:11px;color:var(--mut);text-align:center;margin-top:3px}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.94);display:none;z-index:99;
 flex-direction:column;align-items:center;justify-content:center}
#lb.on{display:flex}
#lb img{max-width:94vw;max-height:78vh;object-fit:contain}
#lbm{color:#fff;max-width:900px;text-align:center;padding:14px 20px}
#lbm .vo{color:#ddd}
#lbm .anim{color:#9a938a}
.nav{position:absolute;top:50%;transform:translateY(-50%);font-size:34px;color:#fff;
 background:rgba(255,255,255,.1);border:0;border-radius:50%;width:52px;height:52px;cursor:pointer}
#prev{left:18px}#next{right:18px}
#cls{position:absolute;top:16px;right:18px;font-size:15px}
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
document.getElementById('cls').onclick=()=>lb.classList.remove('on');
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


def build(cards, title, subtitle, max_w, quality):
    out, total = [], 0
    for c in cards:
        uri, nb = inline(c["path"], max_w, quality)
        total += nb
        flag = " flag" if c["flagged"] else ""
        badge = '<span class="badge">FLAGGED</span>' if c["flagged"] else ""
        rsn = ('<p class="rsn">%s</p>' % html.escape(c["reason"])) if (c["flagged"] and c["reason"]) else ""
        checks = ""
        if c.get("invariants"):
            rows = "".join(
                '<li><span class="slug">%s</span>%s</li>' % (html.escape(slug), html.escape(q))
                for slug, q in c["invariants"])
            checks = '<ul class="checks">%s</ul>' % rows
        canon = ""
        if c.get("canon"):
            thumbs = []
            for name, cpath in c["canon"]:
                curi, cnb = inline(cpath, max(max_w // 4, 200), quality)
                total += cnb
                thumbs.append(
                    '<figure><img src="%s" alt="%s canonical"><figcaption>%s</figcaption></figure>'
                    % (curi, html.escape(name), html.escape(name)))
            canon = ('<div class="canon"><p class="cmp">canonical vs. candidate</p>'
                      '<div class="strip">%s</div></div>' % "".join(thumbs))
        out.append(
            '<figure class="card%s"><img loading="lazy" src="%s" alt="%s">'
            '<div class="meta"><div class="hd"><span class="id">%s</span>'
            '<span class="tag">%s</span><span class="tag">%s</span>%s</div>'
            '<p class="vo">%s</p><p class="anim">%s</p>%s%s%s</div></figure>'
            % (flag, uri, html.escape(c["sid"]), html.escape(c["sid"]),
               html.escape(c["label"]), html.escape(c["cls"] or "—"), badge,
               html.escape(c["vo"] or "—"), html.escape(c["anim"]), rsn, checks, canon))
    nflag = sum(1 for c in cards if c["flagged"])
    page = (
        "<title>%s</title><style>%s</style><div class=wrap><h1>%s</h1>"
        "<p class=sub>%s</p><div class=bar>"
        "<button id=fb aria-pressed=false>Flagged only (%d)</button>"
        "<span class=sub style='margin:0'>click an image to zoom · "
        "<b>←</b>/<b>→</b> to step · <b>Esc</b> to close</span></div>"
        "<div class=grid>%s</div></div>"
        "<div id=lb><button class=nav id=prev>‹</button><img id=lbi>"
        "<div id=lbm></div><button class=nav id=next>›</button>"
        "<button id=cls class=nav style='width:auto;padding:0 14px;border-radius:8px'>Esc</button>"
        "<span class=hint>← / → to step · Esc to close</span></div><script>%s</script>"
        % (html.escape(title), CSS, html.escape(title), html.escape(subtitle),
           nflag, "".join(out), JS))
    return page, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="Image review")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--shots", nargs="*", default=None)
    ap.add_argument("--max-width", type=int, default=1600)
    ap.add_argument("--quality", type=int, default=82)
    a = ap.parse_args()

    cards = collect(a.video, set(a.shots) if a.shots else None)
    if not cards:
        sys.exit("no generated files found for the requested shots")
    sub = a.subtitle or ("%d image(s) · %d shot(s)"
                         % (len(cards), len({c["sid"] for c in cards})))
    page, nb = build(cards, a.title, sub, a.max_width, a.quality)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with io.open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print("%s  (%d images, %.1f MB inlined, %.1f MB page)"
          % (a.out, len(cards), nb / 1e6, os.path.getsize(a.out) / 1e6))
    unstamped = [c["sid"] for c in cards if not c["verified"]]
    if unstamped:
        print("note: %d image(s) have no manifest stamp yet" % len(unstamped))


if __name__ == "__main__":
    main()
