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
hardcoded anywhere below. Comparisons are never cropped/zoomed: `crop_battery.py` is RETIRED — no
review procedure calls it, and it is kept on disk only as a historical tool (2026-08-03 ratified:
"I don't need a super crazy review process... it just burns time").

C-6 closing step, widened by P3 (2026-08-12) to every SEEDING ASSET: with `--staging
<kit>/_staging` the board carries a card per STEP-1 figure forge would REFUSE to seed from, and
with `--assets <frame.png> ...` it carries one per plate, environment reference, prop, crowd
exemplar or pose/expression primitive forge refused — those live outside staging, so forge's own
refusal prints the path to pass here. It writes an asset-verdicts SKELETON keyed by asset id +
`canonical_sha256`. The same fresh-eyes pass that rules on the scenes rules on those assets; the
orchestrator fills the skeleton's verdicts and runs `stamp_review.py --figures <skeleton>
<staging>`, which is what makes an asset minted in slice N seedable in slice N+1. The
single-writer law is untouched — this script writes only the INPUT; `stamp_review.py` remains the
only writer of `<staging>/review.json`, and the pending list is `forge.figure_reuse_blocker`
itself, so the board and forge's refusal can never disagree about what "seedable" means.

Usage:
  py -3 build_review_artifact.py --video <video-dir> --out <out.html> [--title T]
                                 [--shots L01 L02 ...] [--max-width 1600] [--quality 82]
                                 [--staging <kit>/_staging] [--assets <frame.png> ...]
                                 [--figures-out <skeleton.json>]

Requires Pillow. Reads shots.json + shots.motion.json + assets/scenes/manifest.json +
assets/library/manifest.json (optional — absence only narrows which rows fire, never crashes).
"""
import argparse, base64, hashlib, io, json, os, re, sys, html

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forge          # same skill, same dir: the C-6 reuse gate is imported, never re-implemented

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


# C-7's seated signal, single-sourced from `lint_shots.py`. Lint decides seated-ness from the
# PROMPT — a backticked `sit` POSE PRIMITIVE bound by backtick ORDER to the most recently named
# character, never the English verb "sits" (this project's prose uses that verb for objects: "the
# metal desk sits pushed aside"). The review filter now reads the SAME signal: reading it from the
# library manifest instead meant a shot lint HARD-failed for a floating sit could reach the board
# with no support row, and a row could appear on a shot lint never checked — two halves of one law
# (C-7) disagreeing per shot. The two skills are separate packages with no import path between
# them, so these lines are COPIED, not imported; `test_build_review_artifact.py`'s drift canaries
# read `lint_shots.py` as text and assert every copied source line is byte-identical.
_BACKTICK = re.compile(r"`([^`]+)`")
SEATED_PRIMITIVE = "sit"


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


def identity_names(lib_assets):
    """This video's NAMED CAST vocabulary — the backtick names C-7's binding may anchor on."""
    return {a["name"] for a in lib_assets
            if isinstance(a, dict) and a.get("kind") == "identity" and a.get("name")}


def seated_shots(shots, chars):
    """shot ids whose `still_prompt` binds the seated POSE PRIMITIVE to a named character —
    `lint_shots.py::seat_support_check`'s own signal, applied to the same prompts lint reads.

    `chars` is this video's Pass-1 identity vocabulary (lint additionally unions the channel
    registry's promoted characters; a video's cast never reaches `registry.json` under the
    registry-promotion rule, so the library IS the working set here)."""
    out = set()
    for sid, sh in shots.items():
        cur = None
        for m in _BACKTICK.finditer(sh.get("still_prompt") or ""):
            name = m.group(1)
            if name in chars:
                cur = name
            elif name == SEATED_PRIMITIVE and cur:
                out.add(sid)
                break
    return out


def canonical_files(lib_assets):
    """named-figure name -> its canonical reference image path, as Pass 1 recorded it."""
    return {a["name"]: a["file"] for a in lib_assets
            if isinstance(a, dict) and a.get("kind") == "identity"
            and a.get("name") and a.get("file")}


# The place-owner row's detection signal (closes R1-M3/R2-M2/R2-M3's inverted row).
# `place_owner_check` in `lint_shots.py` (F2) now enforces a FORCED CHOICE on every
# place's plate: it declares exactly one of `place_owner: "<LITERAL>"` or
# `owner_ambiguity: true`, HARD-fails either omission, HARD-fails declaring both, and
# HARD-fails any OTHER shot of the place that declares either field. With the
# declaration itself lint-mandatory, this file's job narrows to one question: is the
# declared cue actually LEGIBLE in the rendered frame? So the row reads the
# `place_owner` FIELD directly — never re-infers a decision from a generic
# quoted-proper-noun scan. The old scan (`owner_branding_declared`, `_QUOTED` +
# `_TRACKABLE_LITERAL`) was the inverted trigger: it fired on ANY shot that happened to
# quote a proper-noun-shaped literal — including branded shots that were never the
# plate — while staying silent on the plate that simply forgot the cue, because a
# forgotten cue quotes nothing to scan. That heuristic is dead now that `place_owner`
# is a real, lint-enforced field; it is deleted rather than kept as a fallback.
def owner_literal_by_place(shots):
    """place -> its declared `place_owner` literal, read straight from whichever shot
    of that place carries the field. `place_owner_check` HARD-fails any shot but the
    plate for declaring it, so this is a direct field read across the video's shots,
    never a plate re-derivation. A place that instead declares `owner_ambiguity` (or
    neither, pre-lint) contributes no entry: there is no literal to verify visibility
    of, so no row can fire anywhere in that place."""
    out = {}
    for sh in shots:
        place = sh.get("place")
        owner = sh.get("place_owner")
        if (isinstance(place, str) and place.strip()
                and isinstance(owner, str) and owner.strip()):
            out[place] = owner.strip()
    return out


_QUOTE_PAIRS = (("'", "'"), ('"', '"'), ("‘", "’"), ("“", "”"))


def _quotes_literal(prompt, literal):
    """True if `literal` — an ALREADY-KNOWN string (this place's declared
    `place_owner`) — appears quoted verbatim in `prompt`. This is a direct match
    against one known value, never a generic quoted-value scan, so none of the
    possessive-apostrophe ambiguity the deleted heuristic existed to guard against
    applies here: there is nothing to mis-parse when the value being searched for is
    already fixed."""
    if not prompt or not literal:
        return False
    return any((o + literal + c) in prompt for o, c in _QUOTE_PAIRS)


# ---------- C-12: pre-filtered, machine-emitted verdict rows ----------
# One EMPTY row per (shot x applicable invariant) a human ticks by eye — never typed, never
# recalled from memory. `applicable_invariants` is the sole filter; every predicate reads only
# what the shot's own entry (or this video's own Pass-1 ledger) actually declares.
INVARIANTS = {
    "support-contact": "Seated named figure names a support + contact phrase (C-7)",
    "relative-scale": "Two named cast: plane / eye line / relative head scale stated (C-8)",
    "crowd": "Crowd reads as background rig, not named cast",
    "flat-cel-hazard": "One-voice flat-cel style holds (no gradient/gloss/bloom/etc., C-2)",
    "line-register": "Every line reads at the rig outline weight or heavier — nothing finer, no "
                     "hairline/micro-pattern field (slats, lattice, grille, fine grain); skin one "
                     "flat fill (bible §3)",
    "insertability": "Cast-free plate offers a flat open floor plane in fore/midground at figure "
                     "scale — a rig figure could be stood on it (bible §3/§5)",
}
# `place-owner` is not in this static table: its question embeds the place's own
# declared literal (`owner cue '<LITERAL>' legible in frame per L-1?`), built per shot
# in `applicable_invariants` from `owner_literal_by_place` — a static description here
# would just be a second, drift-prone copy of the same fact.


# A shot whose pixels this pipeline GENERATES or COMPOSITES carries the flat-cel style risk, and
# that is exactly forge's own generation predicate (`cmd_batch`: `source` in `ai-gen | hybrid`,
# absent `source` defaulting to `ai-gen`). Narrowed to `== "ai-gen"`, a generated hybrid frame — or
# any shot whose author omitted `source` — reached the board with NO style row at all, in the one
# wave whose headline defect is style drift. Only pure LIBRARY REUSE (`chart|screencap|stock|
# archival`, which forge skips) is exempt: nothing generated those pixels.
GENERATED_SOURCES = ("ai-gen", "hybrid")


def applicable_invariants(shot, sid, named, seated, owner_of=None):
    """The subset of `INVARIANTS` this shot needs, per C-12's pre-filter:
      * support-contact -> >=1 named figure present AND this shot uses a seated pose primitive
      * relative-scale  -> >=2 named figures present (measured, never authored)
      * place-owner     -> EITHER (a) this shot IS the plate that declared `place_owner`
                           itself, OR (b) this shot is a later delta/chain shot of the same
                           place whose own `still_prompt` redraws (quotes) that literal
                           (the L-1 carry). `owner_of` (from `owner_literal_by_place`) is the
                           place -> literal map; a place with no entry (declared
                           `owner_ambiguity`, or — pre-lint — neither) fires no row anywhere
                           in it: lint owns catching the missing declaration now, this row
                           only checks legibility of a declaration that exists.
      * crowd           -> `figures.crowd` is true
      * flat-cel-hazard -> the shot's pixels are generated or composited (forge's own predicate)
      * line-register   -> same generated-pixels predicate as flat-cel-hazard. The two ask
                           different questions about the same risk: flat-cel-hazard rules on
                           SHADING technique (gradient/gloss/bloom), line-register on LINE WEIGHT
                           — a frame can be perfectly flat-cel and still be drawn a whole register
                           thinner than its own cast, which is exactly the 2026-08 drift that had
                           no row to fail on.
      * insertability   -> a generated CAST-FREE frame (no named figure, no declared crowd) — i.e.
                           the plate tier, whose only job is to be stood on. Read from the same
                           `named`/`figures.crowd` facts the rows above use rather than from
                           forge's derived `plate` flag, which this board never sees.
    Returns an ordered list of `(slug, question)` pairs, `INVARIANTS`-order, empty when none apply.
    """
    owner_of = owner_of or {}
    rows = []
    if named and sid in seated:
        rows.append(("support-contact", INVARIANTS["support-contact"]))
    if len(named) >= 2:
        rows.append(("relative-scale", INVARIANTS["relative-scale"]))
    place = shot.get("place")
    if isinstance(place, str) and place.strip():
        literal = owner_of.get(place)
        if literal and (shot.get("place_owner") == literal
                         or _quotes_literal(shot.get("still_prompt") or "", literal)):
            rows.append(("place-owner",
                         "owner cue '%s' legible in frame per L-1?" % literal))
    fig = shot.get("figures") if isinstance(shot.get("figures"), dict) else {}
    if fig.get("crowd"):
        rows.append(("crowd", INVARIANTS["crowd"]))
    if shot.get("source", "ai-gen") in GENERATED_SOURCES:
        rows.append(("flat-cel-hazard", INVARIANTS["flat-cel-hazard"]))
        rows.append(("line-register", INVARIANTS["line-register"]))
        if not named and not fig.get("crowd"):
            rows.append(("insertability", INVARIANTS["insertability"]))
    return rows


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


# ---------- C-6/P3: the SEEDING-ASSET half of the same review pass ----------
# The invariants a seeding asset is ruled on. `stamp_review.py` stores whatever slugs the review
# names and forge's gate requires every one of them to read "pass", so these sets are the review's
# own vocabulary, not a schema: widen one here and every later asset of that class is ruled on the
# wider set. `flat-cel-hazard` is the SAME question the scene rows ask, asked once per asset.
FIGURE_INVARIANTS = {
    "rig": "Rig holds against this character's approved canonical (bible §3, FULL rig)",
    "expression-register": "Expression sits at the authored register, not flattened (§3 per beat)",
    "flat-cel-hazard": INVARIANTS["flat-cel-hazard"],
}
# P3's other classes — plate, environment, prop, crowd exemplar, pose/expression primitive. A rig
# row would be a meaningless question on a plate, so the non-figure set asks only what a non-figure
# frame can answer, and it reuses the SCENE vocabulary above rather than inventing a second one.
ASSET_INVARIANTS = {
    "flat-cel-hazard": INVARIANTS["flat-cel-hazard"],
    "line-register": INVARIANTS["line-register"],
}


def invariants_for(asset_id):
    """The rows this asset's card carries — figure invariants for a STEP-1 card, else P3's set."""
    return FIGURE_INVARIANTS if asset_id.startswith(forge.FIGURE_PREFIX) else ASSET_INVARIANTS


def pending_assets(staging, extra=()):
    """Every asset forge would REFUSE to seed from, as `[(asset_id, path, why)]`.

    The predicate is `forge.figure_reuse_blocker` itself — the gate, called rather than
    re-implemented — so the assets this board asks the human to rule on are exactly the assets the
    next batch would otherwise hard-stop on. One already carrying an all-pass, digest-current
    record is silently absent: it is seedable, and re-ruling it is eye cost for nothing.

    Staged STEP-1 cards are found by walking `<kit>/_staging`; every OTHER P3 class lives outside
    staging (a plate under the video's `assets/scenes/`, a prop or primitive under the kit's
    `refs/`), so those arrive as explicit `extra` paths — which is exactly what forge's own
    refusal prints when it names the frame that stopped the batch. Enumerating them by scanning
    instead would board every scene the run has ever generated, since a scene frame's verdict
    lives in the scenes manifest, not in this store."""
    candidates = []
    if staging and os.path.isdir(staging):
        candidates = [os.path.join(staging, fn) for fn in sorted(os.listdir(staging))
                      if fn.startswith(forge.FIGURE_PREFIX) and fn.endswith(".png")]
    for path in extra or ():
        # I-4: an `--assets` path that resolves to nothing is a HARD ERROR, never a silent drop.
        # Dropping it ended in "none pending — every one carries an all-pass record": the board
        # reporting a clean bill precisely when it could not find what it was asked to rule on.
        # A mistyped path must never read as an approval.
        if not path or not os.path.isfile(path):
            sys.exit("--assets: no PNG at %s — pass the frame forge named in its refusal "
                     "(relative to where you run this, or absolute)" % (path or "<empty path>"))
        candidates.append(path)
    pending, seen = [], set()
    for path in candidates:
        asset_id = os.path.splitext(os.path.basename(path))[0]
        if asset_id in seen:
            continue
        seen.add(asset_id)
        why = forge.figure_reuse_blocker(staging, asset_id, path)
        if why:
            pending.append((asset_id, path, why))
    return pending


def figure_character(fig_id):
    """The named character a STEP-1 frame belongs to — `figure_frame_name`'s own composition
    (`fig-<character>--<pose>--<expression>`), read back. The character is the FIRST component, so
    any trailing dimension never matters."""
    return fig_id[len(forge.FIGURE_PREFIX):].split("--")[0]


def asset_verdict_skeleton(assets, reviewer="fresh-eyes", date=None):
    """`stamp_review.py --figures`' INPUT, pre-keyed so the human only fills verdicts.

    Emits the C-6 pinned record shape per ASSET with every applicable invariant present and EMPTY
    (`""`), and `canonical_sha256` computed from the bytes on disk right now — the same bytes the
    board just rendered, which is what the store's staleness check compares against. Which
    invariants apply is the asset's CLASS question, answered once by `invariants_for`, so a plate
    is never asked to hold a rig. This script never writes `<staging>/review.json`:
    `stamp_review.py` remains its only writer, and the store's `figures` wrapper key is kept
    verbatim — renaming it would strand every verdict already on disk."""
    import time
    stamp = date or time.strftime("%Y-%m-%d")
    out = {}
    for asset_id, path, _why in assets:
        out[asset_id] = {"canonical_sha256": forge.frame_digest(path), "expression_sha256": None,
                         "verdicts": {slug: "" for slug in invariants_for(asset_id)},
                         "reviewer": reviewer, "date": stamp}
    return {"figures": out}


def collect(video, only, staging=None, assets=()):
    """One card per generated FILE (a shot may have a plate + several cutouts), then one card per
    SEEDING ASSET still pending a ruling — a STEP-1 card, or any P3 class named in `assets`."""
    S, M, MAN = shot_index(video), motion_index(video), manifest_index(video)
    LIB = library_assets(video)
    named_by_shot = named_figures_by_shot(LIB)
    seated = seated_shots(S, identity_names(LIB))
    canon_file = canonical_files(LIB)
    owner_of = owner_literal_by_place(S.values())
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
        invariants = applicable_invariants(s, sid, named, seated, owner_of)
        for path, label in files:
            cards.append(dict(
                sid=sid, label=label, path=path,
                cls=s.get("shot_class") or "",
                vo=s.get("vo_text") or "",
                anim=describe_animation(m),
                flagged=bool(man.get("flagged")),
                reason=man.get("notes") or "",
                # The honest three-state stamp (`stamp_review.py`), never the deleted
                # `verified: {scene, rig}` boolean — nothing has written that shape since the
                # three-state gate landed, so reading it reported EVERY card as unstamped,
                # including a fully verified batch: a false honesty signal on the review surface.
                review_status=man.get("review_status") or "unreviewed",
                invariants=invariants,
                canon=canon_refs,
            ))
    order = list(S)
    cards.sort(key=lambda c: (order.index(c["sid"]), c["label"]))
    for asset_id, path, why in pending_assets(staging, assets):
        is_figure = asset_id.startswith(forge.FIGURE_PREFIX)
        char = figure_character(asset_id) if is_figure else None
        canon = canon_file.get(char) if char else None
        label = "step-1 figure" if is_figure else "seeding asset"
        cards.append(dict(
            sid=asset_id, label=label, path=path,
            cls=label, vo="",
            anim="reference frame — no animation",
            flagged=True, reason=why,
            review_status="unreviewed",
            invariants=list(invariants_for(asset_id).items()),
            # A comparison strip needs an approved canonical to compare AGAINST; only a figure
            # card has one, so a plate or prop card shows the frame alone rather than a false pair.
            canon=[(char, canon)] if canon and os.path.exists(canon) else [],
        ))
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
    ap.add_argument("--staging", help="the channel's <kit>/_staging: adds a card per STEP-1 figure "
                                      "forge would refuse to seed from, and writes the "
                                      "asset-verdicts skeleton the same pass fills in")
    ap.add_argument("--assets", nargs="*", default=[],
                    help="PNG paths for P3's other seeding classes — a place plate, environment "
                         "reference, prop, crowd exemplar, pose/expression primitive. They live "
                         "OUTSIDE staging, so forge's refusal prints the frame and you pass it "
                         "here; each is boarded and skeletoned through the same gate predicate")
    ap.add_argument("--figures-out", dest="figures_out",
                    help="where to write that skeleton (default <video>/assets/_review/"
                         "figure-verdicts.json); the input to `stamp_review.py --figures`")
    a = ap.parse_args()

    cards = collect(a.video, set(a.shots) if a.shots else None, a.staging, a.assets)
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
    unstamped = [c["sid"] for c in cards if c["review_status"] != "verified"]
    if unstamped:
        print("note: %d image(s) are not `verified` in assets/scenes/manifest.json yet "
              "(unreviewed or parked)" % len(unstamped))
    if a.staging or a.assets:
        pending = pending_assets(a.staging, a.assets)
        out = a.figures_out or os.path.join(a.video, "assets", "_review",
                                            "figure-verdicts.json")
        if pending:
            os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
            with io.open(out, "w", encoding="utf-8") as f:
                json.dump(asset_verdict_skeleton(pending), f, ensure_ascii=False, indent=1)
                f.write("\n")
            print("%s  (%d seeding asset(s) pending a ruling — fill each verdict, then: "
                  "py -3 stamp_review.py --figures %s %s)"
                  % (out, len(pending), out, a.staging))
        else:
            print("seeding assets: none pending — every one carries an all-pass, "
                  "digest-current record")


if __name__ == "__main__":
    main()
