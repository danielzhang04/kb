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
           --dry-run assembles + prints every prompt and calls nothing (batch pre-flight)
  batch    build the policied seed slate for a video's shots.json -> a `gen --batch` spec
           (the two-step figure seeding of the SEEDING LAW; never truncates, never spends)
  montage  build a QC contact sheet of a directory for Claude to open
  register move a VERIFIED staged frame into refs/ and add it to registry.json
  lookup   reuse-before-regenerate: print an existing asset's file for (character, tag) if present
  place    move a VERIFIED staged frame into a video dir (library|scenes) with size+PNG validation
  manifest emit the render-builder scenes|library manifest from a small spec (not free-typed)

Run with native `py -3` (msys python lacks a CA bundle). No pip deps except optional certifi/Pillow.
"""
import json, os, re, ssl, sys, base64, hashlib, urllib.request, urllib.error, time, argparse, shutil, tempfile

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

class SeedIntegrityError(RuntimeError):
    """A checked seed changed after preflight: abort, rather than spending on a mixed batch."""


def b64(p): return base64.b64encode(open(p, "rb").read()).decode()
def ip(p, expected_sha256=None):
    """Read a seed once for the request, checking its optional manifest digest on those exact bytes."""
    data = open(p, "rb").read()
    if expected_sha256 and hashlib.sha256(data).hexdigest() != expected_sha256:
        raise SeedIntegrityError(f"seed SHA-256 changed before request assembly: {p}")
    return {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(data).decode()}}

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

    def use_video(self, video_dir):
        """Point this Kit at ONE video, so its own cast resolves alongside the channel's. Call it
        for `batch`/`gen` only — `register` writes `self.reg` back to registry.json, and a video's
        local cast must never be promoted there as a side effect."""
        self.video = os.path.abspath(video_dir)
        self.reg = merge_vocabulary(self.reg, self.video)

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

# --- THE SEEDING LAW -----------------------------------------------------------------------
# A gen that cannot inherit a figure's rig from an existing frame DOES NOT RUN. Ears, ear-holes,
# eyelids, feature placement, proportion and digit count are attributes the CANONICAL and the
# EXPRESSION/POSE frames route; the moment a figure's seed is absent every one is re-synthesized
# from prose and reverts to the engine's own prior (95 of the 108 condemned shots on the
# 2026-07-28 bricks board were figure-bearing). The predicate runs as a PRE-FLIGHT over the whole
# batch before the first API call, so a violation costs $0 and the report is the COMPLETE list.
#
# Per named figure a gen satisfies one of:
#   (a) FRESH  — a stage-BASE / standalone gen carries that figure's STEP-1 frame (`fig-<char>--
#       <pose>--<expression>`): the unchanged canonical+pose+expression recipe, run isolated so
#       scene complexity never competes with rig-hold in one call (probe 2026-07-30: 6/6 held);
#   (b) INHERITED — a delta beat carries the figure's CANONICAL plus an in-chain parent frame or
#       the video's own plate, in ONE gen, exactly as today.
# Exemptions, both read from the registry: a `no_hands` character (a personified object — no pose
# primitives exist for its rig, so its canonical IS the whole inheritable base) and a crowd, whose
# seed is the crowd exemplar.
SEED_CAP = 4                    # the Pass-2 seed law: past four, dilution weakens every prior
FIGURE_PREFIX = "fig-"          # STEP 1's output: one portable frame per (char, pose, expression)
_PRIMITIVE_KINDS = ("pose", "action", "interaction", "expression")
_BACKTICK_RE = re.compile(r"`([A-Za-z0-9][A-Za-z0-9._-]*)`")


def merge_vocabulary(reg, video_dir):
    """THE ONE cast/primitive resolution: the channel registry UNION this video's own
    `assets/library/manifest.json`, returned in registry shape so every reader downstream —
    `shot_cast`, the law, `_split_primitives`, `cmd_batch`'s `vfile` — sees one vocabulary.

    Channel promotion is deliberately reserved for what RECURS, so a video's own leads never reach
    `registry/registry.json` (bricks-fresh's `hq-banker`, `qt-wiles`, `brick-foreman`,
    `auditor-rep`). Reading only the channel registry meant those names were invisible to cast
    detection AND to the law that validates it — the SAME blind spot on both ends, so L45 and L60
    assembled with zero seeds for their named leads and preflight reported them clean. A validator
    that shares the generator's blind spot is worse than no validator, because it certifies.

    Pass 1 already writes the missing data: `kind: identity` entries carry name -> canonical file.
    The CHANNEL entry wins a name collision (a promoted canonical is the stronger lock), and a field
    the manifest does not carry (e.g. `no_hands`) is simply absent, i.e. false."""
    mani = os.path.join(video_dir, "assets", "library", "manifest.json")
    if not os.path.exists(mani):
        return reg                      # no Pass-1 library yet: the channel registry is all there is
    chars = dict(reg.get("characters", {}))
    assets = list(reg.get("assets", []))
    known = {a.get("name") for a in assets}
    for e in json.load(open(mani, encoding="utf-8")).get("assets", []):
        name, kind, f = e.get("name"), e.get("kind"), e.get("file")
        if not name or not f:
            continue
        if kind in ("identity", "character"):
            chars.setdefault(name, {k: v for k, v in e.items()
                                    if k in ("head_tone", "costume", "no_hands")} | {"base": f})
        elif name not in known:
            assets.append({"name": name, "kind": kind, "file": f}); known.add(name)
    return dict(reg, characters=chars, assets=assets)


def backticked(text):
    """The registry vocabulary a prompt NAMES, in authoring order — VPW writes every character,
    pose, expression and interaction as a backticked slug inline, and that is the authoring act."""
    out = []
    for m in _BACKTICK_RE.finditer(text or ""):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out


def shot_cast(reg, text):
    """`[(character, [primitive names authored for it]), ...]` in authoring order. A primitive
    binds to the most recently named character, which is how a shot is written (```hq-banker` ...
    stands `expr-deadpan`, `action-armscrossed```)."""
    chars = reg.get("characters", {})
    assets = {a["name"]: a for a in reg.get("assets", [])}
    cast = []
    for n in backticked(text):
        if n in chars and n != "base":
            cast.append((n, []))
        elif cast and assets.get(n, {}).get("kind") in _PRIMITIVE_KINDS:
            cast[-1][1].append(n)
    return cast


def figure_frame_name(character, pose=None, expression=None):
    """STEP 1's output name. The name IS the reuse key (reuse-before-regenerate) AND the law's
    evidence that the pose/expression the prompt names is the one the slate actually carries —
    which is what makes a silent seed swap (this run's L52) a hard error instead of a mystery."""
    return FIGURE_PREFIX + "--".join(p for p in (character, pose, expression) if p)


def _split_primitives(reg, prims, omitted=()):
    """`(pose, expression)` from the primitives a shot authored for one figure — ONE of each is what
    the recipe seeds. A primitive in the shot's `assets_omitted` is honoured as omitted (that key is
    where a deliberate exclusion is recorded, e.g. a pose frame that would bleed a human torso onto
    a personified object), never silently re-added."""
    assets = {a["name"]: a for a in reg.get("assets", [])}
    kind = lambda p: assets.get(p, {}).get("kind")
    live = [p for p in prims if p not in omitted]
    return (next((p for p in live if kind(p) in ("pose", "action", "interaction")), None),
            next((p for p in live if kind(p) == "expression"), None))


def _stem(path):
    return os.path.splitext(os.path.basename(str(path).replace("\\", "/")))[0]


def _is_figure_frame(path, character):
    s = _stem(path)
    return s == FIGURE_PREFIX + character or s.startswith(FIGURE_PREFIX + character + "--")


def _is_chain_frame(path):
    """An in-chain parent frame or the video's own plate — a per-video generated frame."""
    rp = str(path).replace("\\", "/")
    return ("_staging/" in rp) or ("/assets/scenes/" in rp) or ("/assets/library/" in rp)


def _is_canonical(reg, path, character):
    rp = str(path).replace("\\", "/")
    if f"/refs/{character}/" in rp:
        return True
    base = (reg.get("characters", {}).get(character) or {}).get("base")
    return bool(base) and _stem(rp) == _stem(base)


def seeding_law_violations(k, r, seeds):
    """Every way this ONE request fails the seeding law, named with its shot and its missing asset.
    Returns a list so the caller reports the whole batch at once — a truncated failure list is the
    same defect as a truncated seed list."""
    mode = r.get("mode", "identity")
    if mode not in ("environment", "style"):
        return []              # identity/new_character gens BUILD the seeds; they cannot seed off themselves
    name, delta = r["name"], r.get("delta") or ""
    bad = []
    anon, crowd = _fig_declared(r.get("figures"))
    if anon:
        bad.append(f"{name}: `figures.anon_foreground` — the one tier the pipeline cannot seed "
                   f"({'; '.join(anon)}). It is abolished: name the figure in the video's cast "
                   f"(seeded) or stage the people at crowd scale (crowd exemplar).")
    if crowd and not any(_stem(s).startswith("crowd-exemplar") for s in seeds):
        bad.append(f"{name}: `figures.crowd` is declared but the slate carries no crowd exemplar "
                   f"(refs/base/crowd-exemplar.png) — the crowd's only seed.")
    if len(seeds) > SEED_CAP:
        bad.append(f"{name}: {len(seeds)} seeds over the cap of {SEED_CAP} — "
                   f"{', '.join(_stem(s) for s in seeds[SEED_CAP:])} did not fit. Nothing is "
                   f"truncated: restage the shot (fewer cast) rather than drop a seed.")
    chars = k.reg.get("characters", {})
    omitted = r.get("assets_omitted") or ()      # the shot's DELIBERATE exclusions, carried through
    cast = [(c, [p for p in prims if p not in omitted])
            for c, prims in shot_cast(k.reg, delta)]
    if name.startswith(FIGURE_PREFIX):
        # STEP 1 itself — the recipe, unchanged: canonical + the named primitives, in ONE gen.
        for c, prims in cast:
            if not any(_is_canonical(k.reg, s, c) for s in seeds):
                bad.append(f"{name}: STEP-1 figure frame for `{c}` without `{c}`'s canonical — the "
                           f"one seed that owns identity, head tone, hair and costume.")
            for p in prims:
                if not any(_stem(s) == p for s in seeds):
                    bad.append(f"{name}: STEP-1 figure frame names `{p}` but does not seed it — a "
                               f"pose re-synthesized from words reverts to the five-finger prior.")
        return bad
    delta_beat = str(r.get("stage_role", "")).lower() == "delta"
    for c, prims in cast:
        if chars.get(c, {}).get("no_hands"):     # personified object: canonical IS the whole rig
            if not any(_is_canonical(k.reg, s, c) for s in seeds):
                bad.append(f"{name}: `{c}` (no_hands) carries no seed — seed its canonical.")
            continue
        if delta_beat:
            if not any(_is_canonical(k.reg, s, c) for s in seeds):
                bad.append(f"{name}: delta beat staging `{c}` with no canonical in the slate.")
            if not any(_is_chain_frame(s) for s in seeds):
                bad.append(f"{name}: delta beat staging `{c}` with no in-chain parent frame or "
                           f"video plate in the slate — nothing for it to inherit from.")
            continue
        held = [s for s in seeds if _is_figure_frame(s, c)]
        if not held:
            bad.append(f"{name}: `{c}` is staged FRESH with no STEP-1 figure frame in the slate — "
                       f"expected {figure_frame_name(c, *_split_primitives(k.reg, prims))}. Build "
                       f"the slate with `forge.py batch`.")
            continue
        # Only the pair the builder ATTRIBUTES to this figure is demanded of its frame. Order-based
        # binding cannot tell a second expression meant for an anonymous figure ("...toward two
        # anonymous figures, both `expr-fear`") from one meant for the named lead, and a law that
        # guesses would condemn correct slates. Surplus primitives are RECORDED by `batch` instead.
        for p in (p for p in _split_primitives(k.reg, prims) if p):
            if p not in _stem(held[0]):
                bad.append(f"{name}: `{c}` names `{p}` but its STEP-1 frame is {_stem(held[0])} — "
                           f"the slate carries a different pose/expression than the shot authored.")
    return bad


def resolve_request_seeds(k, r, pending=()):
    """ONE place resolves a request's seed list, so the pre-flight and the generator can never
    disagree about what a gen is actually carrying. `pending` names the frames earlier entries in
    THIS batch will stage, so an in-chain parent resolves at dry-run before it exists — and a seed
    naming an entry that comes LATER (or not at all) hard-errors instead of vanishing."""
    name, mode = r["name"], r.get("mode", "identity")
    seeds = r.get("seed")
    if not seeds:
        # A5: identity / new-character gens auto-seed the character portrait. environment & style
        # gens MUST carry an explicit style-anchor seed — an unseeded environment/style gen falls
        # back to a stock-clipart prior (off the locked style, per the image-generation SKILL seed laws), so it is a
        # HARD ERROR now rather than a silent off-recipe frame. The ONE exception is a `plate: true`
        # item: the video's FIRST frame for a place has no earlier frame of its own to seed.
        if mode in ("identity", "new_character"):
            return [k.base_frame(r.get("character", "base"))]
        if r.get("plate"):
            return []
        raise SystemExit(
            f"{name}: environment/style gens must carry a style-anchor seed (the video's own plate, "
            "an in-chain parent frame, or a STEP-1 figure frame) — unseeded gens fall back to a "
            "stock-clipart prior. The video's first frame for a place is marked `plate: true`.")
    out = []
    for s in seeds:
        if "_staging/" in str(s).replace("\\", "/"):
            staged = os.path.join(k.staging, _stem(s) + ".png")
            if _stem(s) in pending or os.path.exists(staged):
                out.append(staged); continue
            raise SystemExit(f"{name}: seed '{s}' names a staged frame that does not exist and is "
                             f"not generated EARLIER in this batch — a seed can never be invented "
                             f"by a later entry.")
        out.append(k.resolve_seed(s))
    return out


LOCK_STALE_SECONDS = 60 * 60
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _staging_png(k, name):
    """A generation target is always a direct child of the resolved staging directory."""
    if not isinstance(name, str) or not name or os.path.basename(name) != name:
        raise SystemExit("generation request `name` must be a non-empty filename stem.")
    staging = os.path.realpath(k.staging)
    target = os.path.realpath(os.path.join(staging, name + ".png"))
    try:
        inside = os.path.commonpath((target, staging)) == staging
    except ValueError:
        inside = False
    if not inside:
        raise SystemExit(f"{name!r}: generation target escapes staging.")
    return target


def _existing_staging_png(path):
    """A stale/partial file is never a completed survivor eligible for skip-if-exists."""
    if not os.path.lexists(path):
        return False
    if not os.path.isfile(path):
        raise SystemExit(f"staging output is not a regular PNG file: {path}")
    try:
        validate_png(open(path, "rb").read())
    except Exception as e:
        raise SystemExit(f"staging output is invalid, not a skip-if-exists survivor: {path} ({e})")
    return True


def _digest_for_seed(k, r, seed):
    checks = r.get("seed_sha256")
    if checks is None:
        return None
    if not isinstance(checks, dict) or not all(isinstance(p, str) and isinstance(d, str)
                                               and _SHA256.fullmatch(d) for p, d in checks.items()):
        raise SystemExit(f"{r['name']}: `seed_sha256` must map seed paths to lowercase SHA-256 digests.")
    rel = os.path.relpath(os.path.realpath(seed), k.root).replace("\\", "/")
    return checks.get(rel)


def verify_request_seed_digests(k, r, seeds):
    """Preflight digest checks; `ip()` repeats the check on the exact request bytes before live use."""
    for seed in seeds:
        expected = _digest_for_seed(k, r, seed)
        if expected:
            actual = hashlib.sha256(open(seed, "rb").read()).hexdigest()
            if actual != expected:
                raise SystemExit(f"{r['name']}: seed SHA-256 mismatch for "
                                 f"{os.path.relpath(seed, k.root).replace(chr(92), '/')}")


def _release_staging_lock(lock, token):
    try:
        if json.load(open(lock, encoding="utf-8")).get("token") == token:
            os.unlink(lock)
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _pid_is_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == "nt":
        # `os.kill(pid, 0)` is NOT a harmless probe on Windows: Python maps it to TerminateProcess.
        # Query the handle and its exit state instead, treating inaccessible processes as live so a
        # retry can never kill or steal a concurrent generator's reservation.
        import ctypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        process_query_limited_information, synchronize, still_active = 0x1000, 0x00100000, 259
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        kernel32.GetExitCodeProcess.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        handle = kernel32.OpenProcess(process_query_limited_information | synchronize, False, pid)
        if not handle:
            return ctypes.get_last_error() == 5  # access denied: conservatively live
        code = ctypes.c_uint32()
        try:
            return (not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)) or
                    code.value == still_active)
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _reclaimable_staging_lock(lock):
    """A valid PID lock is reclaimed only when dead; TTL is solely for malformed/ownerless legacy locks."""
    try:
        record = json.load(open(lock, encoding="utf-8"))
        if isinstance(record, dict) and type(record.get("pid")) is int and record["pid"] > 0:
            return not _pid_is_alive(record["pid"])
    except FileNotFoundError:
        return False
    except (json.JSONDecodeError, OSError):
        pass
    try:
        return time.time() - os.stat(lock).st_mtime > LOCK_STALE_SECONDS
    except FileNotFoundError:
        return False


def _reserve_staging_output(k, name, force):
    """Reserve a live output before a provider call; returns `(path, lock, token, skip_reason)`."""
    out, lock = _staging_png(k, name), _staging_png(k, name) + ".lock"
    while True:
        if _existing_staging_png(out) and not force:
            return out, None, None, "skip (exists in staging)"
        token = os.urandom(16).hex()
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if _reclaimable_staging_lock(lock):
                try:
                    os.unlink(lock)
                except FileNotFoundError:
                    pass
                continue
            return out, None, None, "skip (reserved by concurrent generator)"
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"pid": os.getpid(), "token": token, "created_at": time.time()}, f)
            if _existing_staging_png(out) and not force:
                _release_staging_lock(lock, token)
                return out, None, None, "skip (exists in staging)"
            return out, lock, token, None
        except Exception:
            _release_staging_lock(lock, token)
            raise


def _publish_staging_png(k, name, out, data, force):
    """Publish only a complete PNG. No-force uses an atomic non-clobbering hard-link."""
    fd, tmp = tempfile.mkstemp(prefix=f".{name}.", suffix=".png.tmp", dir=os.path.realpath(k.staging))
    try:
        if not _staging_png(k, name) == out or os.path.commonpath((os.path.realpath(tmp),
                                                                    os.path.realpath(k.staging))) != os.path.realpath(k.staging):
            raise RuntimeError("staging temp/output target escaped staging")
        with os.fdopen(fd, "wb") as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        if force:
            os.replace(tmp, out)
            return True
        try:
            os.link(tmp, out)       # fails atomically if a concurrent survivor appeared
        except FileExistsError:
            if _existing_staging_png(out):
                return False
            raise RuntimeError("concurrent staging output is invalid; refusing to clobber it")
        os.unlink(tmp)
        return True
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def preflight_batch(k, reqs, force, dry):
    """Resolve every seed and run the seeding law over the WHOLE batch BEFORE the first API call.
    Returns `[(request, resolved seeds or None-if-skipped), ...]`. A violation anywhere stops the
    batch at $0 — the intended signal, and cheaper than $0.134 a frame."""
    plan, pending, bad = [], set(), []
    for r in reqs:
        name = r["name"]
        out = _staging_png(k, name)
        if _existing_staging_png(out) and not force and not dry:
            plan.append((r, None)); pending.add(name); continue
        seeds = resolve_request_seeds(k, r, pending)
        verify_request_seed_digests(k, r, seeds)
        bad.extend(seeding_law_violations(k, r, seeds))
        plan.append((r, seeds)); pending.add(name)
    if bad:
        raise SystemExit("SEEDING LAW — %d violation(s); nothing generated, nothing charged:\n  %s"
                         % (len(bad), "\n  ".join(bad)))
    return plan


def cmd_gen(k, reqs, force, image_size=IMAGE_SIZE_DEFAULT, dry=False):
    # Results are reported AS THEY LAND, not buffered to the end of the batch. A 20-scene batch
    # is otherwise ~15 minutes of total silence, which (a) trips agent stream watchdogs and
    # (b) hides a systematic per-gen failure until every call has already been paid for — a
    # missing Pillow install once burned a batch's worth of API calls before the first line printed.
    #
    # `dry=True` runs the whole request path except the call itself and PRINTS each assembled prompt:
    # the batch pre-flight for "confirm the step is correctly configured before a batch run". It
    # still resolves seeds (so a missing seed is caught for free) and ignores skip-if-exists, since
    # the point is to read every prompt, not to see which files already landed.
    # LOW (audit follow-up): the CEILING itself was never validated against IMAGE_SIZES/
    # IMAGE_SIZE_RANK — only the per-item `size` was (line below). Unreachable through the
    # documented CLI (argparse's `choices=list(IMAGE_SIZES)` on --image-size already refuses a bad
    # value before cmd_gen ever runs), so this is hardening only: a direct (non-CLI) caller passing
    # a bad or None ceiling used to get a raw `KeyError` out of `IMAGE_SIZE_RANK[image_size]` below
    # instead of a clean, named refusal — the same shape the per-item check already gives.
    if image_size not in IMAGE_SIZES:
        raise SystemExit(f"unknown --image-size ceiling {image_size!r} (allowed: {', '.join(IMAGE_SIZES)})")
    os.makedirs(k.staging, exist_ok=True)
    plan = preflight_batch(k, reqs, force, dry)   # the seeding law, at $0, before any API call
    results = []
    total = len(reqs)

    def report(name, status):
        results.append((name, status))
        print(f"  [{len(results)}/{total}] {name}: {status}", flush=True)

    for r, seeds in plan:
        name = r["name"]; mode = r.get("mode", "identity")
        if seeds is None:
            report(name, "skip (exists in staging)"); continue
        figures = r.get("figures")
        hold = should_hold(mode, seeds, r["delta"], figures)
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
        # Hard-error before either a live provider request OR a dry-run report.  Dry-run is the
        # no-spend preflight surface, so it must expose the same oversized payload that live mode
        # would refuse; it still never reserves staging or calls the provider.
        check_payload_size(name, seeds, text)
        if dry:
            report(name, f"DRY (no API call) mode={mode} aspect={aspect} size={size}")
            print(f"      seeds: {[os.path.relpath(s, k.root).replace(chr(92), '/') for s in seeds]}")
            print("      ----- assembled prompt -----")
            for ln in text.splitlines():
                print("      " + ln)
            print("      ----- end -----", flush=True)
            continue
        out = lock = token = None
        try:
            out, lock, token, skip = _reserve_staging_output(k, name, force)
            if skip:
                report(name, skip); continue
            # `ip` reads the checked bytes directly into the request, closing the practical gap
            # between retry-overlay SHA-256 validation and the provider call.
            parts = [ip(s, _digest_for_seed(k, r, s)) for s in seeds] + [{"text": text}]
            print(f"  [{len(results) + 1}/{total}] {name}: START provider call", flush=True)
            data = nano(k.url, parts, aspect, k.ctx, size)
            data = to_png_bytes(data)  # engine returns JPEG; normalize to the pipeline's PNG contract
            validate_png(data)
            if _publish_staging_png(k, name, out, data, force):
                report(name, f"OK size={size} -> _staging/" + name + ".png")
            else:
                report(name, "skip (concurrent survivor in staging)")
        except SeedIntegrityError as e:
            report(name, "ERR integrity " + str(e)[:150] + "; aborting remaining batch")
            raise SystemExit(f"{name}: seed integrity failure; remaining batch aborted") from e
        except Exception as e:
            report(name, "ERR " + str(e)[:160])
        finally:
            if lock:
                _release_staging_lock(lock, token)
    if dry:
        print(f"  == DRY RUN: {len(results)} prompts assembled, 0 API calls, 0 files written ==", flush=True)
        return
    ok = sum(1 for _, s in results if s.startswith("OK"))
    err = sum(1 for _, s in results if s.startswith("ERR"))
    print(f"  == {ok} generated, {err} failed, {len(results) - ok - err} skipped ==", flush=True)

# --- `batch`: the policied seed slate ------------------------------------------------------
# Every silent drop on the 2026-07-28 run happened in the gap BETWEEN a per-run scratch script and
# forge: a `cap4()` truncation with no print, a ladder gen sliced to `[:3]`, a retry inventing a
# seed the original never had (the swamp plate into L99), 7 shots losing their mandatory style
# anchor. forge itself never dropped a seed. So the slate is built HERE, by the same code that
# validates it — the builder and the seeding law are one file, and the retry path reuses it.
_SCALE_ANCHORS = ("doorway", "door", "desk", "table", "counter", "chair", "bench", "window",
                  "cabinet", "shelf", "crate", "pallet", "stack", "machine", "monitor", "screen",
                  "gate", "fence", "car", "truck", "van", "podium", "railing", "staircase",
                  "column", "archway", "tunnel", "conveyor", "wall")


def scale_anchor(prompt):
    """A NAMED scene element for the figure to be sized against. An anchor SEED carries palette,
    not scale and not genre (probe L133: the officer rendered as a warehouse until the prompt named
    the airport), so the placement TEXT has to name the thing the figure is measured by."""
    p = (prompt or "").lower()
    hits = [(p.find(w), w) for w in _SCALE_ANCHORS if re.search(r"\b%ss?\b" % w, p)]
    return "the " + min(hits)[1] if hits else "the other elements named in the scene above"


def figure_card_delta(character, pose, expression):
    """STEP 1's delta — the seeding RECIPE, unchanged, with the attribution language that stops two
    base-derived primitives out-voting the one specific canonical (the documented Attempt-B
    majority-vote failure). Role order matches the seed order the caller builds."""
    ordinals, out = ["SECOND", "THIRD"], [
        f"The FIRST image is `{character}`'s character canonical — identity, head tone, hair and "
        f"the pinned costume come from THIS image ONLY."]
    if expression:
        out.append(f"The {ordinals.pop(0)} image is the `{expression}` expression reference — copy "
                   f"ONLY its eye/brow/mouth shape onto `{character}`'s face; ignore its head tone, "
                   f"hairline and identity.")
    if pose:
        out.append(f"The {ordinals.pop(0)} image is the `{pose}` pose reference — copy ONLY its body "
                   f"pose, hands and limb placement onto `{character}`; ignore its head tone, face "
                   f"and costume.")
    out.append("The whole figure is in frame head to feet, standing or seated exactly as the pose "
               "reference shows, on a thin visible ground line with one soft contact shadow directly "
               "beneath it. Flat solid pale-grey studio backdrop, no scenery, no props, no "
               "furniture. This is a reference sheet: the character alone, fully resolved, ready to "
               "be placed into a separate scene.")
    return " ".join(out)


def placement_delta(prompt, cast, anchor, has_plate):
    """STEP 2's delta: the shot's own prose VERBATIM (so every scene noun it authored is restated,
    not paraphrased) plus the placement block. The block also carries the guaranteed rig-hold
    signal — a STEP-1 frame lives outside `/refs/`, so `_is_char_seed` never fires on it and §2c
    would otherwise reach the prompt only if the author's prose happened to contain a figure word."""
    one = len(cast) == 1
    it, them = ("it", "that figure") if one else ("them", "those figures")
    head = "The FIRST image is" if one else f"The FIRST {len(cast)} images are"
    out = [prompt,
           f"PLACEMENT. {head} {', '.join('`%s`' % c for c in cast)}, already posed, lit and fully "
           f"resolved as a complete figure — carry identity, costume, hair, head tone, body pose, "
           f"hands and facial expression from {'it' if one else 'them'} EXACTLY. Every description "
           f"of {them} above is ALREADY satisfied by {'that image' if one else 'those images'}: do "
           f"not re-draw, re-pose or re-dress {it}."]
    if has_plate:
        out.append("The LAST image is the destination place — match its palette, outline weight and "
                   "lighting exactly.")
    out.append(f"Stage {'the figure' if one else 'the figures'} into the scene exactly as written "
               f"above, every named element of it present, at true human scale measured against "
               f"{anchor}; feet in firm contact with the ground plane with a contact shadow beneath "
               f"matching the scene's own light direction; correctly occluded by whatever stands in "
               f"front of {it}; re-lit to the scene's own light and palette.")
    return "\n\n".join(out)


def _shot_iter(doc):
    """Every shot this engine draws a still for, in generation order: long-form, then each short's
    first frame and shots. The thumbnail carries its own hand-authored seeds + gen_prompt (a
    human-picked candidate set, not a scene slate) and is reported as out of scope, never dropped."""
    lf = doc.get("long_form") or {}
    for s in lf.get("shots") or []:
        yield s["id"], s, lf.get("aspect_ratio") or "16:9"
    for sh in doc.get("shorts") or []:
        stem = os.path.splitext(os.path.basename(sh.get("file") or "short"))[0]
        aspect = sh.get("aspect_ratio") or "9:16"
        if sh.get("first_frame"):
            yield f"{stem}-first", sh["first_frame"], aspect
        for s in sh.get("shots") or []:
            yield f"{stem}-{s['id']}", s, aspect


_VIDEO_DIR_RE = re.compile(r"^(.*/videos/[^/]+)/assets/")


def video_root_for(path, root):
    """The video a file belongs to = the nearest ancestor holding `assets/library/manifest.json`.
    Derived by CONTENT, not by position: a shots.json extract under `scratchpad/` (how the dogfood
    slice was built) would otherwise resolve to a dir with no library and silently lose the video's
    own cast — the same failure mode one level up."""
    d = os.path.dirname(os.path.abspath(path))
    root = os.path.abspath(root)
    while True:
        if os.path.exists(os.path.join(d, "assets", "library", "manifest.json")):
            return d
        nd = os.path.dirname(d)
        if nd == d or len(d) <= len(root):
            return os.path.dirname(os.path.abspath(path))
        d = nd


def video_dir_of(reqs, root):
    """The video a batch belongs to, read off the first seed that points into one. `gen` runs on a
    spec, not a shots.json, so without this it would resolve cast against the channel registry alone
    and re-open the blind spot for any spec it did not build itself. `--video` overrides."""
    for r in reqs:
        for s in r.get("seed") or []:
            m = _VIDEO_DIR_RE.match(str(s).replace("\\", "/"))
            if m:
                return os.path.join(root, m.group(1))
    return None


def _dedupe(seq):
    out = []
    for x in seq:
        if x and x not in out:
            out.append(x)
    return out


def _inside_real(path, root):
    try:
        return os.path.commonpath((os.path.realpath(path), os.path.realpath(root))) == os.path.realpath(root)
    except ValueError:
        return False


def _video_scene_frame(video, candidate, root, name, field):
    """Resolve one existing frame through the video's real assets/scenes boundary."""
    scenes = os.path.realpath(os.path.join(video, "assets", "scenes"))
    path = os.path.realpath(candidate)
    if not _inside_real(path, scenes):
        raise SystemExit(f"{name}: {field} must stay inside this video's assets/scenes/, "
                         "never a cross-video environment reference.")
    if not os.path.isfile(path):
        raise SystemExit(f"{name}: {field} frame not found: {os.path.relpath(path, video)}")
    return os.path.relpath(path, root).replace("\\", "/")


def place_anchor_for(video, anchor, root, name):
    """Resolve one human-approved, video-local place frame for a regenerated base.

    A place is deliberately not a channel `refs/env/` asset: it belongs to the video that
    minted it. Keep the authoring path video-relative so a copied shot cannot silently import
    another video's environment, and fail before the batch can reach the engine if the pick moved.
    """
    if anchor is None:
        return None
    if not isinstance(anchor, str) or not anchor.strip() or os.path.isabs(anchor):
        raise SystemExit(f"{name}: `place_anchor` must be a non-empty video-relative "
                         "`assets/scenes/<approved-frame>.png` path.")
    return _video_scene_frame(video, os.path.join(video, anchor), root, name, "`place_anchor`")


def cmd_batch(k, shots_path, out_path, video_dir=None, shots=None, plate_candidates=None):
    """Build one deterministic slate per shot from the shot's own `assets` tags and `figures`.

    STEP 2's priority, stated ONCE:  [STEP-1 figure(s)]  >  [the video's plate: the in-chain parent
    or the place's own first frame].  A delta beat keeps today's single-step order unchanged:
    [canonical(s)] > [the video's plate] > [pose/interaction primitive] > [expression frame].
    Nothing is ever truncated: an over-budget or under-seeded shot is a hard error naming the shot
    and the seed that did not fit, and that list is the re-authoring input."""
    if plate_candidates is not None and plate_candidates not in (2, 3):
        raise SystemExit("batch --plate-candidates must be 2 or 3.")
    if plate_candidates is not None and not shots:
        raise SystemExit("batch --plate-candidates requires an explicit plate-only --shots scope.")
    doc = json.load(open(shots_path, encoding="utf-8"))
    video = os.path.abspath(video_dir) if video_dir else video_root_for(shots_path, k.root)
    k.use_video(video)          # this video's own cast resolves alongside the channel's
    lib, scenes = os.path.join(video, "assets", "library"), os.path.join(video, "assets", "scenes")
    reg_assets = {a["name"]: a for a in k.reg.get("assets", [])}
    chars = k.reg.get("characters", {})
    crowd_ex = (reg_assets.get("crowd-exemplar") or {}).get("file")
    spec, made, emitted, place_first, place_last, notes = [], {}, {}, {}, {}, []
    # `--shots` is a FILTER on this one walk, never a second path. The walk still visits every shot,
    # because stage chains and place-first plates are only correct when the whole file is read; scope
    # decides what gets EMITTED and what BLOCKS. Full runs stay the default the engine is built for.
    scope, seen, outside = (set(shots) if shots else None), set(), []

    def vfile(n):
        return ((shot.get("assets") or {}).get(n) or (reg_assets.get(n) or {}).get("file")
                or (chars.get(n) or {}).get("base"))

    def on_disk(*cands):
        for c in cands:
            if c and os.path.exists(c):
                return os.path.relpath(c, k.root).replace("\\", "/")
        return None

    for name, shot, aspect in _shot_iter(doc):
        seen.add(name)
        in_scope = scope is None or name in scope
        src = shot.get("source", "ai-gen")
        if src not in ("ai-gen", "hybrid"):
            if in_scope:
                notes.append(f"{name}: skipped source={src}")
            continue
        prompt = shot.get("still_prompt") or ""
        omitted = shot.get("assets_omitted") or {}
        place = shot.get("stage") or name
        if (in_scope and shot.get("place_anchor") is not None
                and str(shot.get("stage_role", "")).lower() != "base"):
            raise SystemExit(f"{name}: `place_anchor` is only valid on a regenerated stage `base`.")
        place_anchor = (place_anchor_for(video, shot.get("place_anchor"), k.root, name)
                        if in_scope else None)
        delta_beat = str(shot.get("stage_role", "")).lower() == "delta" and place in place_last
        figs, canons, prims_seeds, staged, why = [], [], [], [], []
        for c, prims in shot_cast(k.reg, prompt):
            pose, expr = _split_primitives(k.reg, prims, omitted)
            surplus = [p for p in prims if p not in (pose, expr) and p not in omitted]
            if surplus:
                # Either a second pose/expression authored for this figure (only ONE can be seeded
                # — restage), or a primitive that belongs to an anonymous figure. Recorded, never
                # silently dropped; the human reading the slate decides which.
                why.append(f"`{c}` surplus primitive(s) NOT seeded: {', '.join(surplus)}")
            if chars.get(c, {}).get("no_hands"):
                # personified object: no pose primitive exists for its rig (seeding a human torso
                # bleeds a human body), so its canonical IS the inheritable base — single step.
                canons.append(vfile(c)); prims_seeds.append(vfile(expr) if expr else None)
                why.append(f"`{c}` no_hands -> canonical"); continue
            if delta_beat:
                canons.append(vfile(c))
                prims_seeds += [vfile(pose) if pose else None, vfile(expr) if expr else None]
                why.append(f"`{c}` delta -> canonical + parent"); continue
            fn = figure_frame_name(c, pose, expr)
            if not in_scope:
                # Out of scope: resolve what its slate WOULD carry so the law can judge it, but mint
                # nothing — an out-of-scope shot must not consume the reuse key an in-scope shot owns.
                figs.append(made.get(fn) or "_staging/" + fn + ".png"); staged.append(c); continue
            if fn not in made:
                reused = on_disk(os.path.join(lib, fn + ".png"), os.path.join(k.staging, fn + ".png"))
                if reused:
                    made[fn] = reused; why.append(f"`{c}` STEP-1 {fn} REUSED")
                else:
                    spec.append({"name": fn, "mode": "environment", "aspect": "2:3",
                                 "image_size": "1K", "stage_role": "base",
                                 "seed": _dedupe([vfile(c)] + ([vfile(expr)] if expr else [])
                                                 + ([vfile(pose)] if pose else [])),
                                 "delta": figure_card_delta(c, pose, expr),
                                 "why": f"STEP 1 for `{c}` ({pose or 'no pose'} / {expr or 'no expr'})"})
                    made[fn] = "_staging/" + fn + ".png"
                    why.append(f"`{c}` STEP-1 {fn} GENERATE")
            else:
                why.append(f"`{c}` STEP-1 {fn} shared")
            figs.append(made[fn]); staged.append(c)
        parent = place_last.get(place) if delta_beat else place_first.get(place)
        plate = place_anchor or ((emitted.get(parent) or
                                  on_disk(os.path.join(scenes, (parent or "") + ".png")))
                                 if parent else None)
        crowd = _fig_declared(shot.get("figures"))[1]
        # Pass 1's explicit tags are the contract: route only non-figure assets here. Cast,
        # primitives and the crowd exemplar already have higher-priority structural routes above.
        tagged = [vfile(n) for n in (shot.get("assets") or {})
                  if (reg_assets.get(n) or {}).get("kind") in ("prop", "environment")]
        seeds = _dedupe(figs + canons + [plate] + prims_seeds
                        + ([crowd_ex] if crowd else []) + tagged)
        text = prompt
        if staged:
            anchor = scale_anchor(prompt)
            text = placement_delta(prompt, staged, anchor, bool(plate))
            why.append(f"scale anchor = {anchor}")
        if place_anchor:
            why.append(f"PLACE-ANCHOR = {shot['place_anchor']}")
        elif not parent:
            # fix 2: the video's FIRST frame for this place. It mints the place's look (there is no
            # cross-video plate to import) and every later shot in the place seeds it.
            why.append("PLACE-FIRST (mints this place's plate)")
        why_text = "; ".join(why) or "no cast — the scene composes from the place"
        item = {"name": name, "mode": "environment", "aspect": aspect, "delta": text, "seed": seeds,
                "figures": shot.get("figures"), "stage_role": shot.get("stage_role"),
                "assets_omitted": sorted(omitted) or None, "why": why_text}
        if not parent and not place_anchor:
            item["plate"] = True
        if in_scope:
            if staged and not (shot.get("figures") or depicts_figures(text)):
                raise SystemExit(f"{name}: a STEP-1-seeded scene gen with no rig-hold signal — a "
                                 f"figure frame outside /refs/ does not trip the path check.")
            spec.append(item)
            emitted[name] = "_staging/" + name + ".png"
            print(f"  {name}: [{', '.join(_stem(s) for s in seeds) or 'PLATE'}] ({why_text})",
                  flush=True)
        else:
            # Judged, never resolved: an out-of-scope shot's own missing asset must not block a
            # scoped repair, so the law reads its raw paths and the result is reported, not raised.
            outside.extend(seeding_law_violations(k, item, seeds))
        place_first.setdefault(place, name); place_last[place] = name
    if scope and scope - seen:
        raise SystemExit(f"batch --shots names {len(scope - seen)} id(s) that are not in "
                         f"{os.path.basename(shots_path)}: {', '.join(sorted(scope - seen))}")
    if doc.get("thumbnail", {}).get("primary") and scope is None:
        notes.append("thumbnail: out of scope — it carries its own authored seeds + gen_prompt")
    if plate_candidates is not None:
        plate_names = {i["name"] for i in spec if i.get("plate")}
        mixed = sorted(scope - plate_names)
        if mixed:
            raise SystemExit("batch --plate-candidates scope must contain only emitted `plate:true` "
                             f"scene items; dependent/non-plate shot(s): {', '.join(mixed)}")
        expanded = []
        for item in spec:
            if not item.get("plate"):
                expanded.append(item)           # shared STEP 1, emitted exactly once
                continue
            for n in range(1, plate_candidates + 1):
                candidate = dict(item)
                candidate["name"] = f"{item['name']}-candidate-{n}"
                candidate["why"] = f"{item['why']}; PLATE CANDIDATE {n}/{plate_candidates}"
                expanded.append(candidate)
        spec = expanded
    for n in notes:
        print("  " + n, flush=True)
    preflight_batch(k, spec, True, True)          # the SAME law the generator runs, over our output
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    json.dump(spec, open(out_path, "w", encoding="utf-8"), indent=2)
    n_figs = sum(1 for i in spec if i["name"].startswith(FIGURE_PREFIX))
    print(f"  == batch: {len(spec) - n_figs} scene(s) + {n_figs} STEP-1 figure gen(s), "
          f"{len(notes)} not generated -> {out_path} ==", flush=True)
    if scope is not None:
        # Informational only — this is the future wave's input, not this repair's problem.
        print(f"  == scoped to {len(scope)} shot(s); {len(outside)} seeding-law violation(s) remain "
              f"OUTSIDE the scope, unaddressed by this spec ==", flush=True)


    return spec


# --- `batch --retry`: builder-owned surgical retry overlays --------------------------------
RETRY_OVERLAY_SCHEMA = "faceless-youtube/forge-retry-overlay@1"
_RETRY_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")


def retry_seed_for(k, video, raw, label):
    """Resolve a retry-owned seed only from this video or its kit, never arbitrary disk."""
    digest = None
    if isinstance(raw, dict):
        if set(raw) - {"path", "sha256"}:
            raise SystemExit(f"{label}: retry seed object permits only `path` and optional `sha256`.")
        raw, digest = raw.get("path"), raw.get("sha256")
        if digest is not None and (not isinstance(digest, str) or not _SHA256.fullmatch(digest)):
            raise SystemExit(f"{label}: retry seed `sha256` must be a lowercase 64-hex digest.")
    if not isinstance(raw, str) or not raw or os.path.isabs(raw):
        raise SystemExit(f"{label}: retry seed must be a non-empty relative path in this video or kit.")
    normalized = raw.replace("\\", "/")
    if normalized.startswith("_staging/"):
        staged_name = normalized.split("/", 1)[1]
        if (os.path.basename(staged_name) != staged_name or
                os.path.splitext(staged_name)[1].lower() != ".png" or
                not _RETRY_NAME.fullmatch(os.path.splitext(staged_name)[0])):
            raise SystemExit(f"{label}: `_staging/` retry seed must name one direct staged PNG.")
        candidates = ((os.path.join(k.staging, staged_name), k.staging),)
    else:
        candidates = ((os.path.join(video, raw), video), (os.path.join(k.kit, raw), k.kit))
    for candidate, boundary in candidates:
        resolved = os.path.realpath(candidate)
        if os.path.isfile(resolved) and _inside_real(resolved, boundary):
            return os.path.relpath(resolved, k.root).replace("\\", "/"), digest
    raise SystemExit(f"{label}: retry seed not found inside this video or kit: {raw}")


def _retry_name(k, video, name, label, seen):
    if not isinstance(name, str) or not _RETRY_NAME.fullmatch(name):
        raise SystemExit(f"{label}: retry output name must be a safe filename stem.")
    if name in seen:
        raise SystemExit(f"{label}: duplicate retry output name `{name}`.")
    seen.add(name)
    for folder in (k.staging, os.path.join(video, "assets", "scenes"),
                   os.path.join(video, "assets", "library")):
        if os.path.exists(os.path.join(folder, name + ".png")):
            raise SystemExit(f"{label}: retry output `{name}` collides with existing {folder} PNG.")


def _retry_entries(path, video_slug):
    doc = json.load(open(path, encoding="utf-8"))
    if not isinstance(doc, dict) or set(doc) != {"schema", "video_slug", "entries"}:
        raise SystemExit("retry overlay must contain only `schema`, `video_slug`, and `entries`.")
    if doc["schema"] != RETRY_OVERLAY_SCHEMA:
        raise SystemExit(f"retry overlay schema must be `{RETRY_OVERLAY_SCHEMA}`.")
    if doc["video_slug"] != video_slug:
        raise SystemExit(f"retry overlay video_slug `{doc['video_slug']}` does not match `{video_slug}`.")
    if not isinstance(doc["entries"], list) or not doc["entries"]:
        raise SystemExit("retry overlay `entries` must be a non-empty list.")
    return doc["entries"]


def _is_scene_seed(seed):
    return "/assets/scenes/" in ("/" + str(seed).replace("\\", "/").lstrip("/"))


def _scene_review_status(video, seed, root):
    """Return the manifest review status for this exact video-local scene frame."""
    path = os.path.realpath(os.path.join(root, seed))
    rel = os.path.relpath(path, video).replace("\\", "/")
    manifest_path = os.path.join(video, "assets", "scenes", "manifest.json")
    try:
        manifest = json.load(open(manifest_path, encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    for scene in manifest.get("shots", []) if isinstance(manifest, dict) else []:
        if (isinstance(scene, dict) and str(scene.get("file", "")).replace("\\", "/") == rel):
            return scene.get("review_status")
    return None


def _repaired_parent_matches(k, video, seed, parent_seeds):
    """Name-bound repaired frames may replace only the canonical parent they identify."""
    path = os.path.realpath(os.path.join(k.root, seed))
    scenes = os.path.join(video, "assets", "scenes")
    video_staging = os.path.join(video, "_staging")
    if not (_inside_real(path, scenes) or _inside_real(path, k.staging)
            or _inside_real(path, video_staging)):
        return []
    stem = os.path.splitext(os.path.basename(path))[0]
    return [parent for parent in parent_seeds
            if re.fullmatch(re.escape(_stem(parent)) + r"[-.].+", stem)]


def _retry_scene(item, source, entry, k, video, label):
    allowed = {"kind", "shot", "name", "instruction", "prepend_seeds", "extra_seeds", "replace"}
    unknown = set(entry) - allowed
    if unknown:
        raise SystemExit(f"{label}: scene retry has unknown key(s) {sorted(unknown)!r}.")
    instruction = entry.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        raise SystemExit(f"{label}: scene retry needs a non-empty additive `instruction`.")
    text = item["delta"]
    replacement = entry.get("replace")
    if replacement is not None:
        if not isinstance(replacement, dict) or set(replacement) != {"from", "to"}:
            raise SystemExit(f"{label}: `replace` must contain only non-empty `from` and `to` strings.")
        old, new = replacement.get("from"), replacement.get("to")
        if not isinstance(old, str) or not old or not isinstance(new, str) or not new or text.count(old) != 1:
            raise SystemExit(f"{label}: replacement source must occur exactly once in the canonical scene delta.")
        text = text.replace(old, new)
    prepend, extra = entry.get("prepend_seeds", []), entry.get("extra_seeds", [])
    if not isinstance(prepend, list) or not isinstance(extra, list):
        raise SystemExit(f"{label}: `prepend_seeds` and `extra_seeds` must be lists when present.")
    added_first = [retry_seed_for(k, video, s, label) for s in prepend]
    added_last = [retry_seed_for(k, video, s, label) for s in extra]
    native = list(item.get("seed") or [])
    place_anchor = place_anchor_for(video, source.get("place_anchor"), k.root,
                                    source.get("id") or entry["shot"])
    native_scenes = [s for s in native if _is_scene_seed(s) and s != place_anchor]
    repaired = {}
    for path, _ in added_first + added_last:
        matches = _repaired_parent_matches(k, video, path, native_scenes)
        if matches:
            repaired[path] = matches
    replaced = {parent for matches in repaired.values() for parent in matches}
    seeds = _dedupe([p for p, _ in added_first] + [s for s in native if s not in replaced] +
                    [p for p, _ in added_last])
    for seed in (s for s in seeds if _is_scene_seed(s)):
        checked = _video_scene_frame(video, os.path.join(k.root, seed), k.root, label,
                                     "retry scene seed")
        status = _scene_review_status(video, checked, k.root)
        # A shot's `place_anchor` is human-authored in shots.json, so its trust derives from that
        # authorship rather than the scene manifest's review status.  A repaired predecessor is
        # likewise an explicit, name-bound replacement for the canonical parent it identifies.
        if checked == place_anchor:
            if status is not None and status != "verified":
                print(f"WARNING: {label}: accepting human-authored place_anchor `{source.get('place_anchor')}` "
                      f"despite manifest review_status `{status}`.", flush=True)
            continue
        if seed in repaired:
            continue
        if status != "verified":
            raise SystemExit(f"{label}: fresh retry may not seed an old video scene output unless "
                             "its manifest `review_status` is `verified`.")
    digest_by_path = {}
    for path, digest in added_first + added_last:
        if digest and path in digest_by_path and digest_by_path[path] != digest:
            raise SystemExit(f"{label}: the same retry seed carries conflicting SHA-256 digests.")
        if digest:
            digest_by_path[path] = digest
    out = dict(item, name=entry["name"], seed=seeds,
               delta=text + "\n\nRETRY OVERLAY. " + instruction.strip(),
               why=item.get("why", "") + f"; RETRY overlay from `{entry['shot']}`")
    if digest_by_path:
        out["seed_sha256"] = digest_by_path
    if added_first:
        out.pop("plate", None)       # an explicit prepended anchor is not a place mint
    return out


def _retry_step1(entry, source, k, label):
    allowed = {"kind", "shot", "character", "name", "instruction"}
    unknown = set(entry) - allowed
    if unknown:
        raise SystemExit(f"{label}: STEP-1 retry has unknown key(s) {sorted(unknown)!r}.")
    character = entry.get("character")
    if not isinstance(character, str) or not character.strip():
        raise SystemExit(f"{label}: STEP-1 `character` must be a non-empty string.")
    cast = dict(shot_cast(k.reg, source.get("still_prompt") or ""))
    if character not in cast or k.reg.get("characters", {}).get(character, {}).get("no_hands"):
        raise SystemExit(f"{label}: `{character}` has no derivable named STEP-1 recipe in `{entry['shot']}`.")
    pose, expr = _split_primitives(k.reg, cast[character], source.get("assets_omitted") or ())
    assets = {a["name"]: a for a in k.reg.get("assets", [])}
    def vfile(n):
        return ((source.get("assets") or {}).get(n) or (assets.get(n) or {}).get("file")
                or (k.reg.get("characters", {}).get(n) or {}).get("base"))
    seeds = _dedupe([vfile(character), vfile(expr) if expr else None, vfile(pose) if pose else None])
    instruction = entry.get("instruction")
    if instruction is not None and (not isinstance(instruction, str) or not instruction.strip()):
        raise SystemExit(f"{label}: STEP-1 `instruction` must be a non-empty string when present.")
    delta = figure_card_delta(character, pose, expr)
    if instruction:
        delta += "\n\nRETRY OVERLAY. " + instruction.strip()
    return {"name": entry["name"], "mode": "environment", "aspect": "2:3", "image_size": "1K",
            "stage_role": "base", "seed": seeds, "delta": delta,
            "why": f"STEP-1-only retry for `{character}` from `{entry['shot']}`"}


def cmd_retry_batch(k, shots_path, out_path, retry_path, video_dir=None):
    """Build a final retry-only slate from canonical shots plus a checked overlay manifest."""
    shots_doc = json.load(open(shots_path, encoding="utf-8"))
    video = os.path.abspath(video_dir) if video_dir else video_root_for(shots_path, k.root)
    k.use_video(video)
    entries = _retry_entries(retry_path, shots_doc.get("video_slug"))
    sources = {name: shot for name, shot, _ in _shot_iter(shots_doc)}
    seen, scene_ids = set(), []
    for i, entry in enumerate(entries):
        label = f"retry entry {i + 1}"
        if not isinstance(entry, dict):
            raise SystemExit(f"{label}: retry entry must be an object.")
        kind, shot, name = entry.get("kind"), entry.get("shot"), entry.get("name")
        if not isinstance(kind, str) or kind not in ("scene", "step1"):
            raise SystemExit(f"{label}: `kind` must be `scene` or `step1`.")
        if not isinstance(shot, str) or not shot.strip():
            raise SystemExit(f"{label}: `shot` must be a non-empty string.")
        if not isinstance(name, str) or not name.strip():
            raise SystemExit(f"{label}: `name` must be a non-empty string.")
        if shot not in sources:
            raise SystemExit(f"{label}: canonical shot `{shot}` is not in {os.path.basename(shots_path)}.")
        if name == shot:
            raise SystemExit(f"{label}: fresh retry output name cannot equal canonical shot `{shot}`.")
        _retry_name(k, video, name, label, seen)
        if kind == "scene" and shot not in scene_ids:
            scene_ids.append(shot)
    native = []
    if scene_ids:
        with tempfile.TemporaryDirectory() as td:
            native = cmd_batch(k, shots_path, os.path.join(td, "native.json"), video, scene_ids)
    by_name = {r["name"]: r for r in native}
    spec = []
    for i, entry in enumerate(entries):
        label, shot = f"retry entry {i + 1}", entry["shot"]
        if entry["kind"] == "scene":
            if shot not in by_name:
                raise SystemExit(f"{label}: canonical `{shot}` did not emit a scene request.")
            spec.append(_retry_scene(by_name[shot], sources[shot], entry, k, video, label))
        else:
            spec.append(_retry_step1(entry, sources[shot], k, label))
    preflight_batch(k, spec, True, True)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    json.dump(spec, open(out_path, "w", encoding="utf-8"), indent=2)
    print(f"  == retry batch: {len(spec)} request(s), canonical shots only, -> {out_path} ==", flush=True)
    return spec


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
    ap.add_argument("cmd", choices=["gen", "batch", "montage", "register", "lookup", "place",
                                    "manifest", "cutout"])
    ap.add_argument("--kit", required=True, help="path to the channel's visual-kit dir")
    ap.add_argument("--batch", help="gen/register/place/manifest: JSON file with a list of "
                                    "requests/entries/names; batch: the video's shots.json")
    ap.add_argument("--retry", help="batch: a versioned forge-retry-overlay@1 manifest; derives only "
                                    "the named retry requests from the canonical shots.json")
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
    ap.add_argument("--figures", help="gen: one shot's `figures` field as JSON, e.g. "
                                     "'{\"anon_foreground\": [\"the clerk\"], \"crowd\": true}'")
    ap.add_argument("--stage-role", choices=["base", "delta"],
                    help="gen: the shot's stage_role (delta -> held-figure `figures` wording)")
    ap.add_argument("--shots", action="append",
                    help="batch: OPT-IN repair scope — comma-separated shot ids (repeatable). Emits "
                         "and blocks on ONLY these shots; violations elsewhere are reported as a "
                         "count. Omit for a FULL run, which stays the default.")
    ap.add_argument("--plate-candidates", type=int, choices=(2, 3),
                    help="batch: emit 2-3 variants for each plate in an explicit plate-only "
                         "--shots scope; pick/place one under the canonical id before building deltas")
    ap.add_argument("--video", help="gen/batch: the video dir, so its OWN cast (assets/library/"
                                    "manifest.json) resolves alongside the channel registry. "
                                    "Derived when omitted — from the shots.json's nearest library "
                                    "ancestor (batch), or from the seeds (gen).")
    ap.add_argument("--dir", help="montage: folder of PNGs (rel to kit or abs)")
    ap.add_argument("--out", help="montage: output png path; batch: the gen spec to write")
    ap.add_argument("--cols", type=int, default=4)
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
    # `batch` builds and validates a slate and calls nothing, so it loads no key and has no URL:
    # a slate build cannot reach the engine even by mistake.
    dry = (a.dry_run and a.cmd == "gen") or a.cmd == "batch"
    k = Kit(a.kit, dry=dry)
    if a.cmd == "gen":
        if a.batch:
            reqs = json.load(open(a.batch, encoding="utf-8"))
        else:
            reqs = [{"name": a.name, "character": a.character, "mode": a.mode, "delta": a.delta,
                     "aspect": a.aspect, "seed": a.seed.split(",") if a.seed else None,
                     "figures": json.loads(a.figures) if a.figures else None,
                     "stage_role": a.stage_role}]
        vid = a.video or video_dir_of(reqs, k.root)
        if vid and os.path.isdir(vid):
            k.use_video(vid)
        cmd_gen(k, reqs, a.force, a.image_size, dry)
    elif a.cmd == "batch":
        if not a.batch or not a.out:
            raise SystemExit("batch needs --batch <videos/slug/shots.json> and --out <spec.json>")
        out = a.out if os.path.isabs(a.out) else os.path.join(k.root, a.out)
        if a.retry:
            if a.shots:
                raise SystemExit("batch --retry derives its scope from the overlay; do not also pass --shots.")
            if a.plate_candidates is not None:
                raise SystemExit("batch --retry cannot be combined with --plate-candidates.")
            cmd_retry_batch(k, a.batch, out, a.retry, a.video)
        else:
            ids = [i.strip() for chunk in (a.shots or []) for i in chunk.split(",") if i.strip()]
            cmd_batch(k, a.batch, out, a.video, ids or None, a.plate_candidates)
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
