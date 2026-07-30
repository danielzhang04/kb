#!/usr/bin/env python3
"""image-generation engine — deterministic image generation from a channel's locked style bible.

The SKILL (Claude) owns judgment (registry lookup decisions, VERIFYING outputs against the acceptance
checklist, the retry/escalate loop). This script owns the mechanics: read the bible's locked descriptor,
seed off the right reference frame, call the image engine, stage the output, and index verified assets.

Reads (per channel visual-kit):
  <kit>/style-bible.md          §2 identity + §2b style-only descriptors, §2c rig-hold, §2d crowd-rig
                                and §2e base-rig clauses (all read as blockquotes, never retyped)
  <kit>/registry/registry.json  characters + assets (seed frames, reuse index)
  <kit>/refs/<character>/...     canonical reference frames to seed from

Subcommands:
  gen      generate one or a --batch of assets into <kit>/_staging/  (does NOT auto-register);
           --dry-run assembles + prints every prompt and calls nothing (batch pre-flight).
           DEPENDENCY-AWARE PARALLEL BATCH: a batch entry may carry `"after": ["name", ...]`
           naming other entries in the SAME batch it must wait on; a `seed` string whose basename
           names another batch entry (the delta-seeds-its-parent-frame shape every chain uses) is
           an automatic dependency too -- no need to also list it in `after`. `--concurrency N`
           (default 1 = today's exact serial order) schedules entries topologically with up to N
           running at once; a gen launches the moment every dependency has generated. A cycle, a
           dependency on an unknown name, or a duplicate `name` in the batch fails the WHOLE batch
           closed BEFORE any spend. A gen whose own API call fails is marked ERR; only ITS
           descendants are skipped (reason recorded), the rest of the batch still runs, and the
           process exits nonzero if anything failed or was skipped. Per-request `"reject_first":
           true` (or `--reject-first` on a single request) moves a previously-generated
           `_staging/<name>.png` into `_rejected/` before generating -- the retry path for a
           reviewed-and-rejected frame (see `reject` below).
  reject   move one or a --batch of names' `_staging/<name>.png` into `_staging/_rejected/`
           (timestamp-suffixed, preserved as evidence) so a subsequent `gen` for that name is a
           genuine regen rather than a skip-if-exists no-op. Does not touch refs/registry.json --
           `register` stays the only durable promotion path.
  montage  build a QC contact sheet of a directory for Claude to open
  register move a VERIFIED staged frame into refs/ and add it to registry.json
  lookup   reuse-before-regenerate: print an existing asset's file for (character, tag) if present
  place    move a VERIFIED staged frame into a video dir (library|scenes) with size+PNG validation
  manifest emit the render-builder scenes|library manifest from a small spec (not free-typed)

Run with native `py -3` (msys python lacks a CA bundle). No pip deps except optional certifi/Pillow.
"""
import json, os, re, ssl, sys, base64, urllib.request, urllib.error, time, argparse, shutil, threading
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

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

# Engine resolution tiers (`imageConfig.imageSize`): "1K" | "2K" | "4K". UNSET means 1K, which is
# what every generation before 2026-07-29 silently got — below the 1920x1080 long-form delivery
# frame (1K at 16:9 is ~1344x768), so full-frame scenes were being upscaled at render and the crop
# battery zoomed 3-4x into interpolated pixels. 2K is the first tier that clears delivery with
# headroom to zoom. PRICING (2026-07-30 correction): 1K and 2K are the SAME price — $0.134/image,
# 1120 output tokens — so the 2K default is spend-NEUTRAL, not an up-spend. 4K is a real up-spend
# at $0.24/image (~1.8x 1K/2K), so it stays a per-run spend decision (`--image-size 4K`), never a
# silent default.
IMAGE_SIZES = ("1K", "2K", "4K")
IMAGE_SIZE_DEFAULT = "2K"
IMAGE_SIZE_RANK = {s: i for i, s in enumerate(IMAGE_SIZES)}  # 1K < 2K < 4K, for the ceiling check
PRICE_PER_IMAGE_SIZE = {"1K": 0.134, "2K": 0.134, "4K": 0.24}  # $/image, matches the tiers above

# SKILL.md "Cap: <=4 seeds per gen" -- canonical + ONE pose primitive + ONE expression frame + one
# anchor/exemplar; past four, dilution weakens every prior. This was previously enforced only ad
# hoc by whichever driver script built a batch spec; forge enforces it itself now (fail-closed,
# per gen, before the API call) so a batch that violates it can never spend, and so the base-rig
# auto-seed below (SS4b item 1) has a real ceiling to respect rather than silently exceeding it.
SEED_CAP = 4

# The Gemini request-body cap is 20MB; this is a 1MB safety margin under it, so the CLI's own
# hard-error lands before the engine's less legible one does.
REQUEST_SIZE_SAFETY_CAP = 19 * 1024 * 1024


def nano(url, parts, aspect, context, image_size=IMAGE_SIZE_DEFAULT):
    payload = {"contents": [{"parts": parts}],
               "generationConfig": {"responseModalities": ["IMAGE"],
                                    "imageConfig": {"aspectRatio": aspect, "imageSize": image_size}}}
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

def _b64_encoded_size(path):
    """The BASE64-encoded byte size of a seed file without holding the encoded string in memory —
    base64 inflates by exactly 4/3, rounded up to the next multiple of 4."""
    n = os.path.getsize(path)
    return ((n + 2) // 3) * 4

def check_payload_size(name, seeds, text):
    """FIX 2 (audit follow-up): hard-error BEFORE the API call — never auto-downscale — when the
    assembled request (every inline seed, base64-encoded, plus the prompt text) would exceed
    REQUEST_SIZE_SAFETY_CAP, a 1MB margin under Google's 20MB request cap. Auto-downscaling would
    silently change what the engine sees; a loud, itemized error lets a human choose what to trim."""
    sizes = [(s, _b64_encoded_size(s)) for s in seeds]
    text_size = len(text.encode("utf-8"))
    total = sum(n for _, n in sizes) + text_size
    if total > REQUEST_SIZE_SAFETY_CAP:
        listing = "\n".join(f"    {s}: {n:,} bytes (base64)" for s, n in sizes)
        raise SystemExit(
            f"{name}: assembled request would be {total:,} bytes, over the "
            f"{REQUEST_SIZE_SAFETY_CAP:,}-byte safety margin (Google's request cap is 20MB):\n"
            f"{listing}\n    prompt text: {text_size:,} bytes\n"
            f"Trim the seed set or split the batch — this does NOT auto-downscale.")

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"

def to_png_bytes(data):
    """Normalize the engine's returned image to PNG at the ONE place bytes enter the pipeline.
    The engine (gemini-3-pro-image) returns image/jpeg; everything downstream (refs, registry,
    render) assumes .png, so transcode
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


# --- figure detection from PROMPT CONTENT -------------------------------------------------
# The rig-hold decision derives from what the frame CONTAINS (does it depict figures?), NOT from
# which seeds it happens to carry. Deriving it from the seed list alone shipped a real defect:
# `_is_char_seed()` excludes `/refs/env/`, so a frame whose prompt was full of people but whose
# seeds were all environment anchors received NO rig invariants at all, and the no-nose /
# no-ears / four-digit-hand rules survived only as prose the engine ignored (fyt-run-001 L01,
# L10, L17, L31 — precisely that video's four worst rig frames: a drawn ear on the cold open,
# noses on the investor row, realistic adults, and noses + an ear + a realistic profile jaw).
#
# The asymmetry is deliberate: a FALSE POSITIVE costs one extra paragraph on a figure-free gen
# (the §2c block is scoped to "every FOREGROUND / named / seeded cartoon figure in this image",
# so it is inert when there are none), while a FALSE NEGATIVE ships an off-rig frame that must
# be paid for twice. When in doubt, HOLD.
_FIGUREWORDS = (
    "figure", "figures", "person", "people", "someone", "somebody", "crowd", "crowds",
    "audience", "man", "men", "woman", "women", "customer", "customers", "teller", "tellers",
    "employee", "employees", "worker", "workers", "staff", "clerk", "clerks", "banker",
    "bankers", "executive", "executives", "investor", "investors", "senator", "senators",
    "judge", "official", "officials", "cast", "character", "characters",
    "hand", "hands", "face", "faces", "head", "heads",
)

# Idioms that contain a figure word but describe a RENDERING STYLE, not a body in frame. These
# are stripped before matching so "relaxed hand-lettered MARKER CAPITALS" and "in the §6 marker
# hand" do not force a hold on a pure lettering/prop gen.
_FIGURE_FALSE_FRIENDS = (
    "hand-lettered", "hand lettered", "hand-drawn", "hand drawn", "hand-illustrated",
    "hand-stamped", "hand stamped", "handwriting", "handwritten", "freehand", "marker hand",
    "lettering hand", "second hand", "hand-painted", "hand painted", "on the other hand",
    "letterhead", "masthead", "headline", "heading", "header", "headed",
    "face of", "face value", "typeface", "coalface",
)

_FIGURE_RE = re.compile(r"\b(?:%s)\b" % "|".join(sorted(_FIGUREWORDS, key=len, reverse=True)))


def depicts_figures(prompt):
    """True when a prompt puts one or more human FIGURES on screen. Read from the prompt text,
    because the prompt is the only place that states what the frame contains."""
    p = (prompt or "").lower()
    for idiom in _FIGURE_FALSE_FRIENDS:
        p = p.replace(idiom, " ")
    return bool(_FIGURE_RE.search(p))


def should_hold(mode, resolved_seeds, delta="", figures=None):
    """Append the §2c RIG-HOLD block when a figure is in frame AND the mode isn't `identity`
    (identity gens already carry the full rig via the §2 descriptor, so re-appending is redundant).

    "A figure is in frame" is decided by CONTENT first — the prompt says what the image depicts —
    with the character-bearing seed list kept as a second, independent signal so a terse delta on
    a seeded character (e.g. "him, seated") still holds. A `figures` declaration is a THIRD signal
    and the most explicit of the three: the shot states outright that anonymous figures are staged.
    Any signal is sufficient."""
    if mode not in ("new_character", "environment", "style"):
        return False
    if figures:
        return True
    if depicts_figures(delta):
        return True
    return any(_is_char_seed(s) for s in resolved_seeds)


# --- `figures` expansion: a shot's DECLARATION -> the bible's §2d/§2e clause text ----------------
# VPW declares anonymous-figure TIERS in the shot's `figures` field
# (`{"anon_foreground": ["the worker at the dock edge"], "crowd": true}`) and forge expands them at
# gen time from the bible's §2d/§2e blockquotes — the same source-of-truth move as the §2c
# auto-append above. Before this, VPW pasted the clause text into `still_prompt` by hand and 5 of
# the 15 defects the bricks-segment critic found were rig-clause defects of exactly the kinds
# hand-pasting produces: the clause dropped from a shot that needed it, the simplified §2d crowd
# clause worn by a foreground figure, and §2e's invent-a-distinct-outfit sentence repeated onto a
# DELTA shot whose whole job was holding that figure unchanged. Expanding from one place, with the
# stage_role deciding base-vs-held wording, removes the class rather than the instances.
_FIG_KEYS = ("anon_foreground", "crowd")

# §2e is written for ONE figure ("This prominent foreground figure is an anonymous, non-recurring
# person drawn on the FULL base family rig — ..."). The expansion keeps its rig TAIL verbatim (that
# tail IS the law) and replaces only the leading clause with the named list, so the bible stays the
# single source of the invariants. The anchor is also `lint_shots.py`'s rig-clause fingerprint, so
# a bible rewording that moved it would be caught at lint, not silently here.
_BASE_RIG_ANCHOR = "FULL base family rig"

# The clause must not leak onto the rest of the cast: an unbounded "anonymous, non-recurring person"
# paragraph invites the engine to re-draw a NAMED figure as a generic one. The bible's §2e template
# may already END in that binding, so the append is IDEMPOTENT (`_has_binding`) — stating it twice in
# one prompt is the redundancy the measured long-prompt degradation punishes.
_FIG_BINDING = ("This clause binds ONLY the figure(s) named above — no other figure in this image "
                "takes it, and every named cast member keeps its canonical description.")


def _has_binding(text):
    """True when a clause already carries the named-cast protection binding (both halves of it:
    the no-other-figure scope AND the canonical-description carve-out for named cast)."""
    t = (text or "").lower()
    return "other figure in" in t and "canonical descri" in t


def _fig_declared(figures):
    """Normalize + validate one shot's `figures` field -> `(anon_foreground: [str], crowd: bool)`.
    A malformed field HARD-ERRORS instead of degrading to no clause: a large anonymous figure with
    no rig clause is an off-rig frame that gets paid for twice (lint enforces the same shape
    upstream, so reaching here malformed means the shot bypassed lint)."""
    if not figures:
        return [], False
    if not isinstance(figures, dict):
        raise SystemExit('`figures` must be an object like {"anon_foreground": ["the clerk"], "crowd": true}')
    unknown = sorted(k for k in figures if k not in _FIG_KEYS)
    if unknown:
        raise SystemExit(f"`figures` has unknown key(s): {', '.join(unknown)} "
                         f"(allowed: {', '.join(_FIG_KEYS)})")
    anon = figures.get("anon_foreground") or []
    if isinstance(anon, str) or not isinstance(anon, (list, tuple)):
        raise SystemExit("`figures.anon_foreground` must be a LIST of phrases — one per anonymous "
                         "foreground figure, each the exact phrase the prompt uses for it")
    anon = [str(a).strip() for a in anon if str(a).strip()]
    crowd = figures.get("crowd", False)
    if not isinstance(crowd, bool):
        raise SystemExit("`figures.crowd` must be true or false")
    return anon, crowd


def _rig_tail(base_rig):
    """§2e from the base-rig anchor onward — the rig invariants, verbatim. A bible reworded past the
    anchor falls back to the WHOLE clause: a clumsy sentence beats a frame with no rig law."""
    i = base_rig.find(_BASE_RIG_ANCHOR)
    if i < 0:
        return base_rig
    return base_rig[i + len(_BASE_RIG_ANCHOR):].lstrip()


def figures_expansion(figures, base_rig, crowd_rig, stage_role=None):
    """The §2d/§2e clause text for one shot's `figures` declaration.

    BASE / standalone shot: §2e pluralized over `anon_foreground`, opening by naming the entries
    VERBATIM — they are the phrases the prompt itself stages, so the engine can bind clause to
    figure — and closing with the named-cast protection binding.
    DELTA shot (`stage_role == "delta"`): held-figure wording instead. §2e's tail ends in "Give them
    a distinct, era-appropriate outfit and hair", which is a FIRST-ESTABLISHMENT instruction; on a
    delta it asks the engine to redesign the exact figure the chain exists to hold.
    `crowd: true` appends the §2d CROWD-RIG clause unchanged — it states a simplified rig rather
    than inventing anything, so it is correct on a base and a delta alike.
    Returns "" when nothing is declared, so a shot with no `figures` field assembles byte-identically
    to before this field existed."""
    anon, crowd = _fig_declared(figures)
    blocks = []
    if anon:
        named = "; ".join(anon)
        one = len(anon) == 1
        if str(stage_role).lower() == "delta":
            head = (f"The anonymous figure — {named} — is unchanged, exactly as established" if one
                    else f"The anonymous figures — {named} — are unchanged, exactly as established")
            blocks.append(f"{head}: hold the established outfit, hair, face and rig exactly as the "
                          f"previous frame in this stage, and do not redesign. {_FIG_BINDING}")
        elif base_rig:
            head = (f"The following figure — {named} — is an anonymous, non-recurring person drawn "
                    f"on the {_BASE_RIG_ANCHOR}" if one else
                    f"The following figures — {named} — are anonymous, non-recurring people drawn "
                    f"on the {_BASE_RIG_ANCHOR}")
            tail = _rig_tail(base_rig)
            blocks.append(f"{head} {tail}" if _has_binding(tail) else
                          f"{head} {tail} {_FIG_BINDING}")
    if crowd and crowd_rig:
        blocks.append(crowd_rig)
    return "\n\n".join(blocks)


def assemble_prompt(descriptor, delta, figures_text="", righold=""):
    """Prompt assembly, ONE place, in order: [bible descriptor] + [still_prompt/delta] + [figures
    expansion] + [§2c RIG-HOLD]. The figures clauses precede §2c so that its crowd exemption
    ("crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it") reads a
    clause the prompt has already stated. The shot's `global_prompt_suffix` rides inside the
    still_prompt (VPW bakes it in), so it is not a separate slot here."""
    return "\n\n".join(p for p in (descriptor, delta, figures_text, righold) if p)


# --- SS4b item 1: seed the base rig on a declared anonymous foreground figure -------------------
def base_rig_seed_needed(mode, figures):
    """An anonymous SS2e foreground figure gets NO seed today -- the rig rests on prose alone, and
    it is the weakest rig surface in the pipeline (fyt _bricks-seg L17/L18: an explicit "NO nose,
    NO ears" clause did not survive one retry). Auto-add `refs/base/base.png` as a seed whenever
    the shot's `figures` field declares one or more `anon_foreground` entries, so the no-nose /
    no-ears / four-digit-hand invariants arrive as a SEED and not only as words.

    Mirrors the SAME guard `figures_expansion` already uses (`_fig_declared` for the declaration,
    a non-identity-mode check for the pass gate) so this can never fire on an identity pass, where
    `figures` is always passed as `None` by construction (gen-log.md Pass 2: re-expanding SS2e on
    an identity pass would re-invent the very figure gen A already staged)."""
    if mode == "identity":
        return False
    anon, _crowd = _fig_declared(figures)
    return bool(anon)


# --- SS4b item 2: no_hands registry flag suppresses the SS2c hand clause ------------------------
def _character_of_seed(path, characters):
    """Best-effort registry character name for a character-bearing seed path, or None when the
    seed cannot be attributed to exactly one figure. A chained scene/staging frame (a delta's
    parent) may carry ANY number of cast members, so it is always ambiguous here -- the no_hands
    suppression below must fail closed (clause stays) rather than guess."""
    rp = str(path).replace("\\", "/")
    if "/assets/scenes/" in rp or "/_staging/" in rp:
        return None
    m = re.search(r"/refs/([^/]+)/", rp)
    if m and m.group(1) != "env" and m.group(1) in characters:
        return m.group(1)
    base = os.path.splitext(os.path.basename(rp))[0]
    for cname in sorted(characters, key=len, reverse=True):
        if base == cname or base.startswith(cname + "-") or base.startswith(cname + "_"):
            return cname
    return None


def hands_clause_suppressed(mode, character, resolved_seeds, figures, characters):
    """A registry `no_hands: true` character (e.g. `pc-boxy`, a personified OBJECT with NO hands
    at all -- stub arms only) must not get the SS2c RIG-HOLD hand paragraph appended: forge was
    instructing the engine to draw hands onto a handless character, and it did (fyt _bricks-seg
    L01-L04, L16 -- four-fingered fists on a character whose canonical has no hands). Suppress the
    clause ONLY when EVERY figure-bearing element of this gen's seed/name set is a flagged
    character.

    An anonymous SS2e/SS2d figure is never flagged (it is not a registry entry, by definition), so
    a declared `anon_foreground`/`crowd` figure always keeps the clause. An unattributable seed
    (a chained scene frame) fails closed -- the clause stays, per this file's own
    when-in-doubt-HOLD law (see the `depicts_figures` module comment above)."""
    anon, crowd = _fig_declared(figures)
    if anon or crowd:
        return False
    names = set()
    if mode in ("identity", "new_character") and character:
        names.add(character)
    for s in resolved_seeds:
        if not _is_char_seed(s):
            continue
        cname = _character_of_seed(s, characters)
        if cname is None:
            return False  # ambiguous seed -> fail closed, clause stays
        names.add(cname)
    if not names:
        return False
    return all(characters.get(n, {}).get("no_hands") for n in names)


# --- SS4b item 4: retry semantics -- reject a stale staged frame before regenerating -------------
def reject_frame(staging_dir, name):
    """Moves a previously-generated `_staging/<name>.png` into a `_rejected/` sibling dir,
    timestamp-suffixed to avoid collisions, so the rejected frame survives as evidence and
    `_staging/<name>.png` is genuinely ABSENT afterward -- the skip-if-exists idempotency check
    (the whole point of which is safe batch re-runs) can no longer mistake a stale rejected frame
    for a completed one and silently no-op the retry. A no-op (returns None) when nothing is
    staged under that name: a first-time gen is not a retry, and `register` already MOVES a
    verified frame out of staging, so there is nothing left here to reject."""
    src = os.path.join(staging_dir, name + ".png")
    if not os.path.exists(src):
        return None
    rej_dir = os.path.join(staging_dir, "_rejected")
    os.makedirs(rej_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%S")
    dst = os.path.join(rej_dir, f"{name}--{stamp}.png")
    i = 1
    while os.path.exists(dst):
        i += 1
        dst = os.path.join(rej_dir, f"{name}--{stamp}-{i}.png")
    shutil.move(src, dst)
    return dst


def cmd_reject(k, names):
    for name in names:
        if not name:
            continue
        dst = reject_frame(k.staging, name)
        if dst:
            print(f"  {name}: rejected -> {os.path.relpath(dst, k.root).replace(chr(92), '/')}", flush=True)
        else:
            print(f"  {name}: nothing staged under this name -- nothing to reject", flush=True)


# --- dependency-aware parallel batch scheduling ---------------------------------------------
def _batch_dependencies(reqs):
    """Each request's dependency set: the union of its explicit `after` list and any OTHER batch
    entry name that one of its (UNRESOLVED) seed strings names by basename -- the
    delta-seeds-its-parent-frame shape every Pass-2 chain uses ("every delta seeds its parent
    frame instead of an anchor"). Matching must work off the raw seed STRING, never a resolved
    path: the parent's output does not exist on disk yet at dependency-analysis time, so
    `Kit.resolve_seed` cannot be called here without raising on every real chain."""
    names = {r["name"] for r in reqs if r.get("name")}
    deps = {}
    for r in reqs:
        name = r["name"]
        d = set(str(x) for x in (r.get("after") or []))
        for s in (r.get("seed") or []):
            stem = os.path.splitext(os.path.basename(str(s).replace("\\", "/")))[0]
            if stem in names and stem != name:
                d.add(stem)
        d.discard(name)
        deps[name] = d
    return deps


def _topo_check(names_in_order, deps):
    """Pre-flight ONLY: cycle detection + unknown-dependency detection, fail-closed BEFORE any
    spend (HARD REQUIREMENT). Kahn's algorithm, ties broken by original batch order -- this is
    also what guarantees a batch with NO dependencies schedules in EXACTLY the order it was
    written, so `--concurrency 1` on such a batch reproduces today's serial order exactly."""
    idx = {n: i for i, n in enumerate(names_in_order)}
    for n, d in deps.items():
        unknown = d - set(names_in_order)
        if unknown:
            raise SystemExit(
                f"{n}: `after`/seed dependency on unknown batch entr{'y' if len(unknown) == 1 else 'ies'} "
                f"{sorted(unknown)} -- not present in this batch")
    remaining = {n: set(d) for n, d in deps.items()}
    ready = sorted((n for n in names_in_order if not remaining[n]), key=lambda n: idx[n])
    done = set()
    while ready:
        ready.sort(key=lambda n: idx[n])
        n = ready.pop(0)
        done.add(n)
        for m in names_in_order:
            if m in done or m in ready:
                continue
            if n in remaining[m]:
                remaining[m].discard(n)
                if not remaining[m]:
                    ready.append(m)
    if len(done) != len(names_in_order):
        cyclic = [n for n in names_in_order if n not in done]
        raise SystemExit(
            f"gen batch has a dependency CYCLE (fail closed before any spend): {cyclic}")


class Kit:
    def __init__(self, kit, dry=False):
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
        self.desc_crowdrig = blockquote_after(md, "CROWD-RIG clause")   # §2d, expanded from `figures`
        self.desc_baserig = blockquote_after(md, "BASE-RIG clause")     # §2e, expanded from `figures`
        self.reg = json.load(open(self.reg_path, encoding="utf-8"))
        self.model = self.reg.get("engine", "gemini-3-pro-image")
        self.dry = dry
        if dry:
            # A dry assembly reads the bible + registry and nothing else: no key is loaded and no
            # request URL exists, so a pre-flight check cannot reach the engine even by mistake.
            self.key, self.url, self.ctx = "", None, None
        else:
            self.key = load_env(self.root)["GEMINI_API_KEY"]
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

    def prompt_for(self, mode, delta, hold=False, figures=None, stage_role=None):
        if mode == "identity":
            descriptor = self.desc_identity
        elif mode in ("new_character", "environment", "style"):
            descriptor = self.desc_style
        else:
            raise SystemExit(f"unknown mode '{mode}'")
        return assemble_prompt(
            descriptor, delta,
            figures_expansion(figures, self.desc_baserig, self.desc_crowdrig, stage_role),
            self.desc_righold if hold else "")

def _gen_single(k, r, force, image_size, dry):
    """The single-gen body: reject-first (if asked), resolve seeds (incl. the SS4b base-rig
    auto-seed + seed-cap enforcement), assemble the prompt (incl. SS4b no_hands suppression),
    validate, and call the engine.

    Config-shape problems -- missing style-anchor seed, an over-cap seed set, an oversized
    payload, an item `image_size` above the batch ceiling, a malformed `figures` field -- raise
    `SystemExit` exactly as this logic did when it lived inline in `cmd_gen`'s loop: fail closed,
    the whole run aborts, nothing further spends. A RUNTIME failure (network/engine error, an
    invalid returned image) is the ONLY class caught here and turned into a soft "err" outcome --
    this is what lets a dependency scheduler skip just that gen's descendants and keep going.

    Returns (status, message, price_or_None) where status is "ok" (generated, or a dry
    assembly), "exists" (skip-if-in-staging, unchanged bytes), or "err"."""
    name = r["name"]; mode = r.get("mode", "identity")
    if r.get("reject_first"):
        reject_frame(k.staging, name)
    out = os.path.join(k.staging, name + ".png")
    if os.path.exists(out) and not force and not dry:
        return "exists", "skip (exists in staging)", None
    seeds = r.get("seed")
    if not seeds:
        # A5: identity / new-character gens auto-seed the character portrait. environment & style
        # gens MUST carry an explicit style-anchor seed — an unseeded environment/style gen falls
        # back to a stock-clipart prior (off the locked style, per the image-generation SKILL seed laws), so it is a
        # HARD ERROR now rather than a silent off-recipe frame.
        if mode in ("identity", "new_character"):
            seeds = [k.base_frame(r.get("character", "base"))]
        else:
            raise SystemExit(
                f"{name}: environment/style gens must carry a style-anchor seed (a refs/env/ "
                "anchor, the target plate, or an approved on-style scene) — unseeded gens fall "
                "back to a stock-clipart prior")
    else:
        seeds = [k.resolve_seed(s) for s in seeds]
    figures = r.get("figures")
    # SS4b item 1 — auto-add the base-rig seed on a declared anon_foreground figure, respecting
    # the seed cap: never exceed it, never silently drop the seed without a WARNING naming the gen.
    if base_rig_seed_needed(mode, figures):
        base_seed = os.path.join(k.refs, "base", "base.png")
        already = any(os.path.abspath(s) == os.path.abspath(base_seed) for s in seeds)
        if not already:
            if len(seeds) + 1 > SEED_CAP:
                print(f"  WARNING: {name}: declares anon_foreground figure(s) but adding "
                     f"refs/base/base.png would exceed the {SEED_CAP}-seed cap ({len(seeds)} "
                     f"seed(s) already) — NOT added; the SS2e rig rests on prose only for this gen",
                     flush=True)
            else:
                seeds = seeds + [base_seed]
    if len(seeds) > SEED_CAP:
        raise SystemExit(f"{name}: {len(seeds)} seeds exceeds the {SEED_CAP}-seed cap "
                         f"(SKILL.md 'Cap: <=4 seeds per gen') — trim the seed set")
    hold = should_hold(mode, seeds, r["delta"], figures)
    if hold and hands_clause_suppressed(mode, r.get("character"), seeds, figures,
                                        k.reg.get("characters", {})):
        hold = False  # SS4b item 2 — every figure-bearing element is a flagged no_hands character
    text = k.prompt_for(mode, r["delta"], hold=hold, figures=figures,
                        stage_role=r.get("stage_role"))
    aspect = r.get("aspect", "2:3")
    size = r.get("image_size") or image_size
    if size not in IMAGE_SIZES:
        raise SystemExit(f"{name}: unknown image_size '{size}' (allowed: {', '.join(IMAGE_SIZES)})")
    # FIX 4 (audit follow-up): --image-size is a CEILING, not a per-item override that can go
    # either way — a per-item tier ABOVE the batch ceiling is a silent up-spend, so it hard-errors
    # naming the item rather than quietly generating at the higher (costlier) tier.
    if IMAGE_SIZE_RANK[size] > IMAGE_SIZE_RANK[image_size]:
        raise SystemExit(
            f"{name}: item image_size '{size}' exceeds the --image-size ceiling '{image_size}' "
            f"(order: {' < '.join(IMAGE_SIZES)}) — raise the batch ceiling (--image-size) or "
            f"lower this item's image_size")
    if dry:
        lines = [f"DRY (no API call) mode={mode} aspect={aspect} size={size}",
                f"      seeds: {[os.path.relpath(s, k.root).replace(chr(92), '/') for s in seeds]}",
                "      ----- assembled prompt -----"]
        lines += ["      " + ln for ln in text.splitlines()]
        lines.append("      ----- end -----")
        return "ok", "\n".join(lines), None
    # FIX 2 (audit follow-up): hard-error on an oversized request BEFORE it is ever assembled or
    # sent — never auto-downscale a seed to make it fit.
    check_payload_size(name, seeds, text)
    parts = [ip(s) for s in seeds] + [{"text": text}]
    try:
        # S1-A: compute + validate the bytes BEFORE opening the file, so a failed/empty gen can
        # never truncate `out` to a 0-byte survivor that skip-if-exists + render then treat as done.
        data = nano(k.url, parts, aspect, k.ctx, size)
        data = to_png_bytes(data)  # engine returns JPEG; normalize to the pipeline's PNG contract
        validate_png(data)
        with open(out, "wb") as f:
            f.write(data)
        return "ok", f"OK size={size} -> _staging/" + name + ".png", PRICE_PER_IMAGE_SIZE.get(size, 0.0)
    except Exception as e:
        return "err", "ERR " + str(e)[:160], None


def cmd_gen(k, reqs, force, image_size=IMAGE_SIZE_DEFAULT, dry=False, concurrency=1):
    """Dependency-aware parallel batch scheduler. `concurrency=1` (the default, and every existing
    caller before this feature) walks the batch in exactly the order `_topo_check` would order a
    dependency-free batch — i.e. list order — one gen at a time: BYTE-IDENTICAL to the old strictly
    serial loop. `concurrency>1` runs up to N gens at once via a bounded thread pool; a gen is
    launched the moment every dependency (declared `after` or seed-derived) has itself resolved
    "ok". A dependency that resolved "err" propagates a "skip" to everything downstream of it —
    marked with a reason, never silently dropped — while the REST of the batch still completes.

    Results are reported AS THEY LAND (not buffered), each report line locked so concurrent
    completions can never interleave/corrupt/drop an entry in the in-memory run ledger this
    function keeps (`results`/`state`) — the closest thing forge has to a spend ledger, since no
    persisted ledger file exists in this pipeline; the running-total suffix on every line and the
    final summary are both read from that same locked state.

    Returns an int: 0 if every gen ended "ok"/"exists" (or this was a dry run), else the count of
    err+skip entries — callers that care about exit codes should propagate it (`sys.exit`)."""
    os.makedirs(k.staging, exist_ok=True)
    names_in_order = [r.get("name") for r in reqs]
    if any(not n for n in names_in_order):
        raise SystemExit("every gen request needs a `name`")
    # HARD REQUIREMENT (d): pre-validate unique output names BEFORE any launch — two concurrent
    # gens must never be able to target the same `_staging/<name>.png`.
    counts = {}
    for n in names_in_order:
        counts[n] = counts.get(n, 0) + 1
    dupes = sorted(n for n, c in counts.items() if c > 1)
    if dupes:
        raise SystemExit(f"batch has duplicate gen name(s), each must target a unique output: {dupes}")

    deps = _batch_dependencies(reqs)
    # HARD REQUIREMENT (a): cycle / unknown-dependency detection fails the WHOLE batch closed,
    # before any spend — checked once, up front, for every entry.
    _topo_check(names_in_order, deps)

    by_name = {r["name"]: r for r in reqs}
    total = len(reqs)
    results = []                    # (name, msg) — append-only, lock-protected
    lock = threading.Lock()
    state = {"ok": 0, "exists": 0, "err": 0, "skip": 0, "spend": 0.0, "running": 0}

    def report(name, outcome_status, msg):
        with lock:
            results.append((name, msg))
            state[outcome_status] += 1
            n = len(results)
            print(f"  [{n}/{total}] {name}: {msg}  "
                 f"(running: {state['ok']} ok / {state['exists']} exists / {state['err']} err / "
                 f"{state['skip']} skip, ${state['spend']:.2f} spent)", flush=True)

    def gen_one(name):
        with lock:
            state["running"] += 1
            print(f"  -> start {name} (running: {state['running']})", flush=True)
        try:
            outcome_status, msg, price = _gen_single(k, by_name[name], force, image_size, dry)
        finally:
            with lock:
                state["running"] -= 1
        if outcome_status == "ok" and price:
            with lock:
                state["spend"] += price
        report(name, outcome_status, msg)
        return outcome_status

    pending = set(names_in_order)
    resolved = {}                   # name -> "ok" | "exists" | "err" | "skip"
    futures = {}

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        def launch_ready():
            for n in sorted(pending, key=names_in_order.index):
                if n in futures:
                    continue
                dset = deps[n]
                if not dset.issubset(resolved.keys()):
                    continue  # a dependency hasn't resolved yet
                bad = [d for d in sorted(dset) if resolved[d] not in ("ok", "exists")]
                if bad:
                    # HARD REQUIREMENT (b): a failed/skipped parent skips ONLY this descendant —
                    # marked with the reason — never the rest of the batch.
                    reason = ("skipped-with-reason: parent " + ", ".join(bad) +
                             " did not complete (err/skip)")
                    report(n, "skip", reason)
                    resolved[n] = "skip"
                    pending.discard(n)
                    continue
                futures[n] = ex.submit(gen_one, n)

        launch_ready()
        while futures:
            done, _ = wait(list(futures.values()), return_when=FIRST_COMPLETED)
            for fut in done:
                n = next(nm for nm, f in futures.items() if f is fut)
                futures.pop(n)
                outcome_status = fut.result()  # re-raises SystemExit / any worker exception here
                resolved[n] = outcome_status
                pending.discard(n)
            launch_ready()

    if dry:
        print(f"  == DRY RUN: {len(results)} prompts assembled, 0 API calls, 0 files written ==", flush=True)
        return 0
    generated = state["ok"]; skipped = state["exists"] + state["skip"]; err = state["err"]
    print(f"  == {generated} generated, {err} failed, {skipped} skipped == "
         f"(${state['spend']:.2f} spent)", flush=True)
    return err + state["skip"]

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


CUTOUT_WIDE_RATIO = 1.5

def check_cutout_aspect(w, h, allow_wide=False):
    """Cutout-aspect ban (the image-generation SKILL Pass-2 aspect law): a cutout gen must NOT be wide — a 16:9
    (or other wide) cutout squashes the object's proportions (a ship shipped at aspect 1.54 vs the
    approved 1.22, human-caught). HARD-ERROR when width/height >= 1.5 so the squashed source is
    regenerated at 2:3 / 4:3 / 3:2, unless --allow-wide is passed for a legitimately wide object
    (e.g. the L42 star row)."""
    if allow_wide or not h:
        return
    ratio = w / h
    if ratio >= CUTOUT_WIDE_RATIO:
        raise SystemExit(
            f"cutout input aspect {ratio:.2f} (>= {CUTOUT_WIDE_RATIO}) is too WIDE — a wide/16:9 cutout "
            f"gen squashes the object's proportions. Regenerate the source at 2:3/4:3/3:2, or pass "
            f"--allow-wide for a legitimately wide object (e.g. a star row).")


def cmd_cutout(in_path, out_path, lo, hi, allow_wide=False):
    from PIL import Image
    from rembg import remove, new_session
    src = Image.open(in_path).convert("RGBA")
    check_cutout_aspect(src.width, src.height, allow_wide)
    rgba = remove(src, session=new_session("u2net"), alpha_matting=True,
                  alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10,
                  alpha_matting_erode_size=10).convert("RGBA")
    out = trim_to_alpha(harden_alpha(rgba, lo, hi))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    out.save(out_path)
    print(f"cutout: {in_path} -> {out_path} {out.size}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "reject", "montage", "register", "lookup", "place", "manifest", "cutout"])
    ap.add_argument("--kit", required=True, help="path to the channel's visual-kit dir")
    ap.add_argument("--batch", help="gen/register/place/manifest: JSON file with a list of requests/entries/names")
    ap.add_argument("--name"); ap.add_argument("--character", default="base")
    ap.add_argument("--mode", default="identity"); ap.add_argument("--delta")
    ap.add_argument("--aspect", default="2:3"); ap.add_argument("--seed", help="comma-separated seed frames")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--image-size", default=IMAGE_SIZE_DEFAULT, choices=list(IMAGE_SIZES),
                    help=f"gen: engine resolution tier / CEILING (default {IMAGE_SIZE_DEFAULT}; 1K "
                         f"and 2K are the SAME price, so the 2K default is spend-neutral; 4K is a "
                         f"real up-spend at ~1.8x the 1K/2K price, so it is a per-run spend call)")
    ap.add_argument("--dry-run", action="store_true",
                    help="gen: assemble and PRINT every prompt, make NO API call (batch pre-flight)")
    ap.add_argument("--concurrency", type=int, default=1,
                    help="gen: bounded concurrency for the dependency-aware parallel batch "
                         "scheduler (default 1 = today's exact serial order/behavior). A batch "
                         "entry may declare `\"after\": [\"name\", ...]`, and any `seed` string "
                         "naming another entry's `name` is an automatic dependency too; a gen "
                         "launches the moment every dependency has generated. Cycles and unknown "
                         "dependencies fail the whole batch before any spend.")
    ap.add_argument("--reject-first", action="store_true",
                    help="gen (single-request only; use \"reject_first\": true per-entry in a "
                         "--batch): move any existing _staging/<name>.png into _rejected/ before "
                         "generating — the reviewed-and-rejected retry path")
    ap.add_argument("--figures", help="gen: one shot's `figures` field as JSON, e.g. "
                                     "'{\"anon_foreground\": [\"the clerk\"], \"crowd\": true}'")
    ap.add_argument("--stage-role", choices=["base", "delta"],
                    help="gen: the shot's stage_role (delta -> held-figure `figures` wording)")
    ap.add_argument("--dir", help="montage: folder of PNGs (rel to kit or abs)")
    ap.add_argument("--out", help="montage: output png path"); ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--tag")
    # cutout (rembg -> alpha-harden -> trim)
    ap.add_argument("--in", dest="in_path", help="cutout: source PNG (repo/kit/abs path)")
    ap.add_argument("--lo", type=int, default=100, help="cutout: alpha-harden low threshold")
    ap.add_argument("--hi", type=int, default=175, help="cutout: alpha-harden high threshold")
    ap.add_argument("--allow-wide", action="store_true",
                    help="cutout: allow a wide (w/h >= 1.5) input — a legitimately wide object (e.g. a star row)")
    # Q7 place / manifest
    ap.add_argument("--to", help="place/manifest: destination dir (e.g. videos/<slug>/assets/scenes)")
    ap.add_argument("--kind", choices=["scenes", "library"], help="manifest: which manifest to emit")
    ap.add_argument("--slug", help="manifest: video_slug for the envelope")
    ap.add_argument("--notes", help="manifest: free-text notes for the envelope")
    a = ap.parse_args()
    dry = a.dry_run and a.cmd == "gen"
    k = Kit(a.kit, dry=dry)
    if a.cmd == "gen":
        if a.batch:
            reqs = json.load(open(a.batch, encoding="utf-8"))
        else:
            reqs = [{"name": a.name, "character": a.character, "mode": a.mode, "delta": a.delta,
                     "aspect": a.aspect, "seed": a.seed.split(",") if a.seed else None,
                     "figures": json.loads(a.figures) if a.figures else None,
                     "stage_role": a.stage_role, "reject_first": a.reject_first}]
        rc = cmd_gen(k, reqs, a.force, a.image_size, dry, a.concurrency)
        if rc:
            sys.exit(rc)
    elif a.cmd == "reject":
        names = json.load(open(a.batch, encoding="utf-8")) if a.batch else [a.name]
        cmd_reject(k, names)
    elif a.cmd == "montage":
        cmd_montage(k, a.dir, a.out, a.cols)
    elif a.cmd == "register":
        entries = json.load(open(a.batch, encoding="utf-8")) if a.batch else [{
            "name": a.name, "character": a.character, "kind": a.mode, "tag": a.tag or a.name}]
        cmd_register(k, entries)
    elif a.cmd == "lookup":
        cmd_lookup(k, a.character, a.tag)
    elif a.cmd == "place":
        names = json.load(open(a.batch, encoding="utf-8")) if a.batch else [a.name]
        cmd_place(k, names, a.to)
    elif a.cmd == "manifest":
        cmd_manifest(k, a.kind, a.batch, a.out, a.to, a.slug, a.notes)
    elif a.cmd == "cutout":
        if not a.in_path or not a.out:
            raise SystemExit("cutout needs --in <image> and --out <png>")
        cmd_cutout(a.in_path, a.out, a.lo, a.hi, a.allow_wide)

if __name__ == "__main__":
    main()
