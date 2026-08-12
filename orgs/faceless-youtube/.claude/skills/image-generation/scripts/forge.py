#!/usr/bin/env python3
"""image-generation engine — deterministic image generation from a channel's locked style bible.

The SKILL (Claude) owns judgment (registry lookup decisions, VERIFYING outputs against the acceptance
checklist, the retry/escalate loop). This script owns the mechanics: read the bible's locked descriptor,
seed off the right reference frame, call the image engine, stage the output, and index verified assets.

Reads (per channel visual-kit):
  <kit>/style-bible.md          §2 identity + §2b style-only descriptors, §2c rig-hold and §2d
                                crowd-rig clauses (all read as blockquotes, never retyped)
  <kit>/registry/registry.json  characters + assets (seed frames, reuse index)
  <kit>/_staging/review.json    the per-ASSET review record every seeding frame must carry (P3)
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
# what the poyais era sent (no `imageSize` key at all) and what every generation before 2026-07-29
# silently got. 1K is the DEFAULT again as of the 2026-08-05 era restoration: the whole poyais board
# — the register this channel is judged against — was rendered at 1K, and at 2K the same
# "medium-thick" instruction renders a proportionally FINER stroke while the model spends the extra
# budget on detail the era never had room for (archaeology D6). A line-weight comparison against
# poyais that runs at 2K is not comparing the same instrument. 2K/4K remain available as a per-run
# spend-and-register decision (`--image-size 2K`), never a silent default; 1K at 16:9 is ~1344x768,
# below the 1920x1080 delivery frame, so a full-frame scene is upscaled at render and the crop
# battery zooms into interpolated pixels — that is the accepted cost of the era register.
IMAGE_SIZES = ("1K", "2K", "4K")
IMAGE_SIZE_DEFAULT = "1K"


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


# --- `figures` expansion: a shot's DECLARATION -> the bible's §2d clause text --------------------
# VPW declares the anonymous-figure tier in the shot's `figures` field (`{"crowd": true}`) and forge
# expands it at gen time from the bible's §2d blockquote — the same source-of-truth move as the §2c
# auto-append above. Before this, VPW pasted the clause text into `still_prompt` by hand and 5 of
# the 15 defects the bricks-segment critic found were rig-clause defects of exactly the kinds
# hand-pasting produces: the clause dropped from a shot that needed it, and the simplified §2d crowd
# clause worn by a foreground figure. Expanding from one place removes the class, not the instances.
#
# `anon_foreground` remains a KNOWN key with no expansion: the tier is abolished (the pipeline
# cannot seed it), and the seeding law refuses it BY NAME with the restaging instruction. Reading it
# here is what makes that refusal reachable instead of a bare "unknown key".
_FIG_KEYS = ("anon_foreground", "crowd")


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


def figures_expansion(figures, crowd_rig):
    """The §2d CROWD-RIG clause text for one shot's `figures` declaration.

    `crowd: true` appends the clause unchanged — it states a simplified rig rather than inventing
    anything, so it is correct on a base and a delta alike, which is why this expansion does not
    read `stage_role`. Returns "" when nothing is declared, so a shot with no `figures` field
    assembles byte-identically to before this field existed."""
    return crowd_rig if _fig_declared(figures)[1] and crowd_rig else ""


def assemble_prompt(descriptor, payload, figures_text="", righold="", suffix=""):
    """Provider zones, ONE place: descriptor -> generated figure/rig policy -> authored payload
    -> the file's `global_prompt_suffix`.

    THE LOOK IS STATED IN EXACTLY TWO VOICES, at the two ends of the prompt: the bible's §2b
    STYLE-ONLY descriptor at the HEAD and the video's `global_prompt_suffix` at the TAIL. That is
    the poyais-era shape, restored 2026-08-05: the era stated style twice, at both ends, on 87% of
    its 117 shots (98% carried `#241a12` inline, 99% carried "flat-cel"/"house style"), and this
    provider weights the LAST instruction hardest — so the tail is where line weight, the 2-3 colour
    palette rule and the single-red-accent law actually land. Between 2026-07-30 and 2026-08-04 the
    tail voice shrank to 46 lettering-only characters and style became head-only; the register drift
    under investigation dates from exactly there.

    The payload (or its exact surgical replacement) is literal final provider text; the suffix is
    fixed channel data that follows it. Crowd policy still precedes RIG-HOLD so the hold's crowd
    exemption refers to a clause already stated.
    """
    return "\n\n".join(p for p in (descriptor, figures_text, righold, payload, suffix) if p)


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

    def prompt_for(self, mode, delta, hold=False, figures=None, suffix=""):
        if mode == "identity":
            descriptor = self.desc_identity
        elif mode in ("new_character", "environment", "style"):
            descriptor = self.desc_style
        else:
            raise SystemExit(f"unknown mode '{mode}'")
        return assemble_prompt(
            descriptor, delta,
            figures_expansion(figures, self.desc_crowdrig),
            self.desc_righold if hold else "",
            suffix or "")

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
# `characters.base` is the shared RIG, not an on-screen character (registry `role`: "BASE TEMPLATE /
# rig anchor — not an on-screen character"; style-bible §1: "it never appears as ITSELF"), and it is
# NEVER cast: every human in frame is NAMED CAST or CROWD (visual-grammar §2), so `shot_cast`
# excludes it. The 2026-08-06 tier that cast it as an anonymous story-bearer is abolished
# (2026-08-12): an anonymous foreground human does not exist. The one guard that tier bought is
# kept — naming `` `base` `` in a prompt is REFUSED BY NAME in `seeding_law_violations` rather than
# dropped in silence, because a silent drop is what let a `base` casting seed nothing, mint no card
# and then measure `cast_free`.
BASE_TEMPLATE = "base"
_PRIMITIVE_KINDS = ("pose", "action", "interaction", "expression")
_BACKTICK_RE = re.compile(r"`([A-Za-z0-9][A-Za-z0-9._-]*)`")

# style-bible.md §5 (LOCKED): `refs/env/lettering-marker-italic.png` "seeds every text-bearing
# gen". The registry vocabulary key, copied not imported — the bible is prose with no parseable
# list, and the name is also the registry `assets[]` row this routes through.
LETTERING_EXEMPLAR = "lettering-marker-italic"

# style-bible.md §5 (LOCKED): `refs/env/scene-style-tile.png` "seeds every cast-free plate/scene
# gen". Same mechanism as the lettering exemplar above — a standing `assets` row of `kind:
# environment` in `refs/env/`, derived here rather than authored per shot — and the same reason:
# a route that depends on an author remembering a field is a route that silently seeds 0 frames.
#
# WHY it is scoped to CAST-FREE gens: a figure-bearing gen already carries the channel's line
# register in pixels, in its cast seeds (a STEP-1 card / canonical draws the rig's own outline
# weight, which §2b now pegs the whole frame to). A cast-free plate carries NO such anchor, so the
# register survives only as prose — and prose alone is exactly how the 2026-08 drift happened: thin
# uniform linework, hairline blind slats, and deep two-point corners on plates whose prompts said
# none of it. The tile is that missing pixel anchor, and NOTHING else: it is never a place, never a
# layout, never content (see `seed_roles_text`'s `style-anchor` role prose).
STYLE_TILE = "scene-style-tile"
STYLE_ANCHOR_ROLE = "style-anchor"

# A prompt DRAWS in-world text when it supplies a quoted literal. Deliberately the same notion
# `lint_shots.py`'s `_QUOTED` uses (copied, one regex per side, same precedent as the shot-class
# enum) so the two halves of the lettering law cannot disagree about what "text-bearing" means:
# the opening quote may not follow a letter, or a possessive apostrophe opens a phantom literal.
_QUOTED_LITERAL = re.compile("(?<![A-Za-z])['\"‘“][^'\"‘’“”]{1,60}"
                             "['\"’”]")


def text_bearing(prompt):
    """True when a prompt authors an in-world literal, i.e. the frame draws lettering."""
    return bool(_QUOTED_LITERAL.search(prompt or ""))


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
    stands `expr-deadpan`, `action-armscrossed```).

    `base` is EXCLUDED: it is the shared rig template, not a character (`BASE_TEMPLATE`), and under
    the two-tier law every human in frame is NAMED CAST or CROWD. The exclusion was deleted at
    27bc7e2 to ratify a seeded-performer tier; that tier is abolished (2026-08-12) and the
    exclusion is restored. What is NOT restored is the exclusion's silence — a prompt naming
    `` `base` `` used to resolve to `[]` here and travel on unremarked. `seeding_law_violations`
    now refuses that casting by name, so an author who writes one is told to cast the figure or
    restage the beat as mass action instead of being handed a frame that seeded nothing."""
    chars = reg.get("characters", {})
    assets = {a["name"]: a for a in reg.get("assets", [])}
    cast = []
    for n in backticked(text):
        if n in chars and n != BASE_TEMPLATE:
            cast.append((n, []))
        elif cast and assets.get(n, {}).get("kind") in _PRIMITIVE_KINDS:
            cast[-1][1].append(n)
    return cast


def costume_clause(prompt, character):
    """The era dress a shot authors for ONE figure, read off the SENTENCE(S) that name it.

    There is no era or costume FIELD in `shots.json` and none is wanted: casting and dress are
    PROSE (`shots-schema.md §2`), and a place plate takes its own era from exactly the same
    source — the prose of the shot that mints it. This mirrors that source for the figure.

    The sentence is the binding scope because it is the one the authoring side already binds
    figure facts to (`lint_shots.py`'s seat/support law: the support must be named "in the SAME
    SENTENCE" as the pose). The prompt's OPENING sentence rides along, because that is where a
    shot states its era and setting ("A cramped 1985 plant floor.") while the figure's own
    sentence usually states only the garments; a card told the garments but not the decade
    dresses them in the wrong one. Two things are stripped before the text reaches a card
    payload: backticked control tokens, which name seeds the card already carries as images, and
    any quoted literal — a reference sheet that draws lettering bleeds that lettering into every
    scene seeding it, and negative prose is the weaker guard against a drawn glyph.

    RETAINED, currently unreferenced from production: the abolished seeded-performer tier
    (2026-08-12) was its only consumer. P8 re-uses this derivation to widen a card's derived clause
    from clothing to clothing + the beat's own act, so it is kept rather than deleted and re-added."""
    sentences = re.split(r"(?<=[.!?])\s+", prompt or "")
    named = [s for s in sentences if "`" + character + "`" in s]
    if not named:
        return ""
    picked = ([sentences[0]] if sentences[0] not in named else []) + named
    text = re.sub(r"\s+([,.;:])", r"\1",      # a removed token strands its comma
                  " ".join(" ".join(_BACKTICK_RE.sub("", _QUOTED_LITERAL.sub("", s)).split())
                           for s in picked))
    text = re.sub(r"([.!?,;:])(\s*[,;:])+", r"\1", text).strip(" ,;:").strip()
    return text.rstrip(".") + "." if text else ""      # one clause, closed, so a payload can splice it


# CONSTRAINT, stated once: RIG-REGISTER CARDS FORBID SUB-OUTLINE LINE FIELDS. `line-register`
# (`style-bible.md` §rig invariants) FAILS any element drawn finer than the rig outline and any
# hairline or micro-pattern field — lattices, grilles, slats, fine grain, repeated thin stripes.
# These are the garment words that NAME such a field: each one asks the model, in a noun phrase, for
# exactly the repeated sub-outline line/dot texture the register forbids. A noun phrase BEATS
# negative prose (L32: "quilted oven gloves" survived two escalating "ONE FLAT UNIFORM colour fill /
# NO quilting, NO crosshatch, NO diamond lattice" instructions and failed rig review twice), so the
# word is removed where a derived clause becomes card text rather than argued with there.
# Internal spaces match a hyphen or nothing too, so one entry covers `cross hatch`/`cross-hatch`/
# `crosshatch`. Only verb-safe forms are listed: `hatched`, `spotted`, `studded`, `knit` are absent
# because they carry common non-texture senses ("hatched a plan", "brow knit") that a strip would
# corrupt.
MICRO_PATTERN_TEXTURE_WORDS = (
    "argyle", "basket weave", "brocade", "cable knit", "chain mail", "checked", "checkered",
    "chequered", "corduroy", "cross hatch", "cross hatched", "damask", "dotted", "embroidered",
    "filigreed", "fishnet", "flecked", "floral print", "gingham", "hand woven", "herringbone",
    "houndstooth", "knitted", "lace", "lacy", "lattice", "latticed", "mesh", "netted", "paisley",
    "patterned", "perforated", "pin stripe", "pin striped", "pin stripes", "plaid", "pleated",
    "polka dot", "polka dotted", "quilted", "quilting", "ribbed", "seersucker", "speckled",
    "striped", "stripy", "tartan", "textured", "tweed", "waffle", "waffle knit", "woven",
)

_MICRO_PATTERN_RE = re.compile(
    r"\b(?:%s)\b[-\s]*" % "|".join(sorted((w.replace(" ", r"[-\s]*")
                                           for w in MICRO_PATTERN_TEXTURE_WORDS),
                                          key=len, reverse=True)), re.IGNORECASE)


def strip_micro_pattern_texture(text):
    """Remove every `MICRO_PATTERN_TEXTURE_WORDS` adjective from text bound for a RIG-REGISTER card.

    Scope is the whole point: this is applied ONLY where shot prose is turned into a STEP-1 figure
    card's dress clause (`figure_card_payload`'s `costume`). A named character's costume is pinned
    in its canonical and its registry text is never rewritten — `hq-banker`'s pinstripe suit is
    established, passing identity, and a re-mint must still say pinstripe. The derived clause is
    likewise left intact at its source (`costume_clause`), so the string a caller keys a card on is
    the prose as authored.

    RETAINED, currently unreferenced from production: the abolished performer tier was this path's
    only caller. P8 re-uses the same derivation to mint a card holding the beat's own ACT."""
    out = _MICRO_PATTERN_RE.sub("", text or "")
    out = re.sub(r"\s+([,.;:])", r"\1", out)      # a removed adjective strands its space
    return re.sub(r"\s{2,}", " ", out).strip()


def figure_frame_name(character, pose=None, expression=None):
    """STEP 1's output name. The name IS the reuse key (reuse-before-regenerate) AND the law's
    evidence that the pose/expression the prompt names is the one the slate actually carries —
    which is what makes a silent seed swap (this run's L52) a hard error instead of a mystery.

    Every card here is a NAMED character's, whose costume is pinned in its own canonical — so the
    key is costume-free, exactly as it was before the abolished performer tier added a dress
    dimension to it. NOTE for P8: if a card is ever minted holding a DERIVED clause again
    (`figure_card_payload`'s `costume` path, retained), that derivation must re-enter this key, or
    two differently-derived cards for one (character, pose, expression) collide on one name."""
    return FIGURE_PREFIX + "--".join(p for p in (character, pose, expression) if p)


def _split_primitives(reg, prims, omitted=()):
    """`(pose, expression)` from the primitives a shot authored for one figure — ONE of each is what
    the recipe seeds. A primitive in the shot's `assets_omitted` is honoured as omitted (that key is
    where a deliberate exclusion is recorded, e.g. a pose frame that would bleed a human torso onto
    a personified object), never silently re-added.

    An `interaction` slug is NOT a pose and never appears here. It is a TWO-FIGURE geometry
    reference — "two blank base mannequins carrying clasp geometry + eye-line" (image-generation
    SKILL, Pass-1 build recipe) — so it belongs to the SCENE, not to one figure. Treating it as a
    pose is what produced the 2026-08-04 fresh fifth's L29: `handshake` bound to the most recently
    named character and minted `fig-terry-johnson--handshake--expr-delighted`, a SOLO reference
    sheet whose own payload says "the character alone, fully resolved" while its third seed was a
    two-person handshake. Outcome space: a hand extended into empty air, an amputated forearm, or a
    second figure fused into the identity card that then bleeds into every scene seeding it. See
    `_interaction_primitives` for where they go instead."""
    assets = {a["name"]: a for a in reg.get("assets", [])}
    kind = lambda p: assets.get(p, {}).get("kind")
    live = [p for p in prims if p not in omitted]
    return (next((p for p in live if kind(p) in ("pose", "action")), None),
            next((p for p in live if kind(p) == "expression"), None))


def _interaction_primitives(reg, cast, omitted=()):
    """The `interaction` templates a shot authors, SCENE-LEVEL, in authoring order.

    Collected across the whole cast recipe rather than per figure: the template resolves the
    contact BETWEEN two bodies and binds to neither alone, so which character `shot_cast`
    happened to bind it to carries no meaning. It seeds the scene alongside both figures' STEP-1
    cards — 2 figures + template + place = 4 seeds, exactly at `SEED_CAP`."""
    assets = {a["name"]: a for a in reg.get("assets", [])}
    out = []
    for _c, prims in cast:
        for p in prims:
            if p not in omitted and assets.get(p, {}).get("kind") == "interaction" and p not in out:
                out.append(p)
    return out


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


_SEED_ROLES = {"place", "figure", "canonical", "parent", "pose", "expression", "crowd",
               "interaction", "prop", "environment", "reference", STYLE_ANCHOR_ROLE}

# A registry KIND is the librarian's word for an asset; a seed ROLE is the provider's word for the
# job that asset does in one slate. They overlap, which is why passing one off as the other went
# unnoticed — but they are not the same vocabulary: on the-second-take, 22 of 66 assets carry a
# kind (`action` 13, `identity` 7, `base` 1, `crowd-anchor` 1) that is not a legal role at all.
# `cmd_batch` never needed the translation because it consults `kind` for exactly one question —
# is this tagged asset a prop or an environment — and those two words happen to be spelled the
# same on both sides. The retry path is the first caller that must name a role for an ARBITRARY
# registry asset, so the mapping lives here, once, rather than as an expression at that call site.
KIND_TO_SEED_ROLE = {
    "pose": "pose", "action": "pose",       # `_split_primitives` routes both as this figure's pose
    "expression": "expression",
    "interaction": "interaction",
    "prop": "prop",
    "environment": "environment",
    "crowd-anchor": "crowd",                # the exemplar `cmd_batch` seeds as role `crowd`
}
# The kinds whose only truthful role is `canonical` — which NAMES the character the frame draws.
CHARACTER_BOUND_KINDS = ("identity", "base")


def seed_role_for_kind(kind, name, label):
    """The legal seed ROLE for a registry KIND, or a refusal that names the asset and the way out.

    An identity/base frame is refused rather than demoted: its only truthful role is `canonical`,
    and `canonical` is truthful only when it names its character (`seed_role_violations`) — a
    binding the builder makes from the shot's own cast and a retry cannot invent. Calling such a
    frame a `reference` instead would ship role prose that lies about what the seed is, which is
    the B4 failure truthful roles exist to remove, and would leave the review record as the only
    thing between an unbound canonical and the scene. Refusing reads the way this file's other
    refusals read: name the frame, name the law, name the route back.

    Anything the registry does not name at all still falls through to `reference` — untyped, but
    gated like everything else since P3."""
    role = KIND_TO_SEED_ROLE.get(kind)
    if role:
        return role
    if kind in CHARACTER_BOUND_KINDS:
        raise SystemExit(
            f"{label}: `{name}` is a registry `{kind}` frame — an identity/base seed's only "
            "truthful role is `canonical`, which must name the character it draws, and only the "
            "BUILDER can make that binding from the shot's own cast. Restage the shot and re-run "
            "`batch` rather than hand-adding this frame to a retry overlay.")
    return "reference"


def seed_role_violations(k, r):
    """Validate role metadata against both final paths and emitted ordinal prose."""
    roles = r.get("seed_roles")
    if roles is None:
        if (r.get("mode", "identity") in ("environment", "style")
                and (r.get("seed") or [])):
            return [f"{r.get('name', '<unnamed>')}: seeded composite requests require ordered "
                    "`seed_roles`; hand-written specs may not bypass provider-part role truth."]
        # Identity/new-character requests derive their own canonical seed. A true zero-seed root
        # scene has no image part to label.
        return []
    name, seeds = r.get("name", "<unnamed>"), list(r.get("seed") or [])
    if not isinstance(roles, list):
        return [f"{name}: `seed_roles` must be an ordered list matching `seed`."]
    bad = []
    for index, entry in enumerate(roles):
        required = {"path", "role", "character"}
        if (not isinstance(entry, dict) or set(entry) != required
                or not isinstance(entry.get("path"), str) or not entry.get("path")
                or entry.get("role") not in _SEED_ROLES
                or (entry["character"] is not None and not isinstance(entry["character"], str))):
            bad.append(f"{name}: seed role {index + 1} must contain valid path/role/character fields.")
    if bad:
        return bad
    if [entry["path"] for entry in roles] != seeds:
        bad.append(f"{name}: seed role order does not match the final provider seed order.")
    asset_kinds = {a.get("name"): a.get("kind") for a in k.reg.get("assets", [])}
    for index, entry in enumerate(roles):
        path, role, character = entry["path"], entry["role"], entry["character"]
        truthful = True
        if role == "figure":
            truthful = bool(character) and _is_figure_frame(path, character)
        elif role == "canonical":
            truthful = bool(character) and _is_canonical(k.reg, path, character)
        elif role in ("place", "parent"):
            truthful = _is_chain_frame(path)
        elif role in ("pose", "expression"):
            expected = ("pose", "action", "interaction") if role == "pose" else ("expression",)
            truthful = bool(character) and asset_kinds.get(_stem(path)) in expected
        elif role == "crowd":
            truthful = _stem(path).startswith("crowd-exemplar")
        elif role == "interaction":
            # Scene-level, so it carries NO character: a role naming one would be the very
            # single-figure binding this role exists to remove.
            truthful = character is None and asset_kinds.get(_stem(path)) == "interaction"
        elif role == STYLE_ANCHOR_ROLE:
            # Exactly ONE asset may wear this role: the §5 scene style tile. Any other path
            # claiming "register only" would be a place reference smuggled in under prose that
            # tells the engine to ignore its content — the truthful-roles failure, inverted.
            truthful = (_stem(path) == STYLE_TILE
                        and asset_kinds.get(STYLE_TILE) == "environment")
        elif role in ("prop", "environment"):
            truthful = asset_kinds.get(_stem(path)) == role
        if not truthful:
            bad.append(f"{name}: seed role {index + 1} `{role}` is not truthful for `{path}`.")
    payload = r.get("payload")
    if not isinstance(payload, str):
        bad.append(f"{name}: a role-bearing request must keep its canonical authored `payload`.")
    elif r.get("delta") != placement_delta(payload, roles):
        bad.append(f"{name}: seed role prose does not match the final ordered role metadata.")
    return bad


def interaction_violations(k, r, cast, seeds):
    """Every way ONE request breaks the interaction-template law, named with its shot.

    The law, stated once: an `interaction` slug is a two-figure CONTACT GEOMETRY reference and
    seeds the SCENE, never a figure. Three refusals, one per way of breaking it — a solo shot
    (no second body for the clasp), a STEP-1 card (the reference sheet says "the character
    alone"), and a delta (parent + both canonicals + one proved primitive already fills the
    slate, and the grammar's figure-cap table stages a fresh two-figure shot as the stage BASE).
    The fourth condition — the template is actually in the seeds — is the assertion that the
    builder routed it rather than dropping it."""
    name = r["name"]
    templates = _interaction_primitives(k.reg, cast, r.get("assets_omitted") or ())
    if not templates:
        return []
    named = ", ".join(f"`{t}`" for t in templates)
    bad = []
    if name.startswith(FIGURE_PREFIX):
        return [f"{name}: STEP-1 figure frame names the interaction template(s) {named}. A STEP-1 "
                f"card is a reference sheet of the character ALONE; a two-figure clasp geometry "
                f"copied onto it renders a hand into empty air or fuses a second body into the "
                f"identity card. The template seeds the SCENE, alongside both STEP-1 cards."]
    if len(cast) < 2:
        bad.append(f"{name}: interaction template(s) {named} with {len(cast)} seeded figure(s) — the "
                   f"template resolves the contact BETWEEN two bodies and binds to neither alone. "
                   f"Name both figures, or stage the gesture in prose and drop the slug.")
    if str(r.get("stage_role", "")).lower() == "delta":
        bad.append(f"{name}: interaction template(s) {named} on a delta beat — a two-figure delta "
                   f"seeds parent + both canonicals + one proved primitive and has no slot left. "
                   f"Author the contact geometry on the stage BASE; later two-figure beats in that "
                   f"place are deltas on it.")
    for t in templates:
        if not any(_stem(s) == t for s in seeds):
            bad.append(f"{name}: names the interaction template `{t}` but does not seed it — a "
                       f"clasp geometry re-synthesized from words reverts to the engine's prior.")
    return bad


def seeding_law_violations(k, r, seeds):
    """Every way this ONE request fails the seeding law, named with its shot and its missing asset.
    Returns a list so the caller reports the whole batch at once — a truncated failure list is the
    same defect as a truncated seed list."""
    mode = r.get("mode", "identity")
    if mode not in ("environment", "style"):
        return []              # identity/new_character gens BUILD the seeds; they cannot seed off themselves
    name, delta = r["name"], r.get("payload", r.get("delta") or "")
    bad = []
    omitted = r.get("assets_omitted") or ()      # the slate's DELIBERATE exclusions, carried through
    anon, crowd = _fig_declared(r.get("figures"))
    if anon:
        bad.append(f"{name}: `figures.anon_foreground` — the one tier the pipeline cannot seed "
                   f"({'; '.join(anon)}). It is abolished: an anonymous foreground human does not "
                   f"exist (visual-grammar §2). Cast the figure — an existing cast member where "
                   f"the story says it IS one, otherwise a NEW named cast member minted through "
                   f"the standard cast-generation waves at Step 3a — or stage the beat as mass "
                   f"action (crowd exemplar).")
    # THE SAME REFUSAL, RE-POINTED at the other way of authoring that tier. `shot_cast` excludes
    # `base` again, so a prompt naming it resolves to no cast entry — and a bare exclusion is
    # SILENT: the figure minted no card, seeded nothing, and the shot then measured `cast_free`,
    # taking §5's style tile onto a figure-bearing frame. That is the one hole the abolished
    # performer tier was built over, and it is closed here, at $0, naming the shot, instead of by
    # keeping the tier. Read off the raw prose, not off `cast`, because `cast` can no longer hold it.
    if BASE_TEMPLATE in backticked(delta):
        bad.append(f"{name}: casts `{BASE_TEMPLATE}` — the shared RIG TEMPLATE, not a character "
                   f"(style-bible §1: it never appears as ITSELF). An anonymous foreground "
                   f"story-bearer is not a tier: cast the figure — an existing cast member where "
                   f"the story says it IS one, otherwise a NEW named cast member minted through "
                   f"the standard cast-generation waves at Step 3a — or stage the beat as mass "
                   f"action (`figures.crowd`).")
    if (crowd and not any(_stem(s).startswith("crowd-exemplar") for s in seeds)
            and not any(str(o).startswith("crowd-exemplar") for o in omitted)):
        bad.append(f"{name}: `figures.crowd` is declared but the slate carries no crowd exemplar "
                   f"(this video's `assets/library/crowd-exemplar.png`, else the channel's "
                   f"refs/base/crowd-exemplar.png) — the crowd's only seed.")
    if len(seeds) > SEED_CAP:
        # `cmd_batch`'s walk already ran the priority-order drop (crowd exemplar, then interaction
        # template, then a tagged prop) before this ever reaches preflight, so a role-bearing spec
        # arriving here still over the cap has NOTHING legal left to drop — every seed present is
        # cast identity, the place plate/chain parent, or the LOCKED §5 lettering exemplar. Naming
        # one of those as "did not fit" is exactly the bricks-fresh seed-cap failure (a mechanism
        # steering a casting decision): the message states the true bind — figure count vs the cap —
        # and never singles out a protected seed. A spec with no `seed_roles` (hand-authored, never
        # walked through displacement) keeps the old positional message, since role identity is
        # unknown here and a droppable seed may genuinely still be present.
        roles_list = r.get("seed_roles") if isinstance(r.get("seed_roles"), list) else None
        # A `crowd` seed is only IN CONTEXT for step 1 (and so only "still droppable" here) when a
        # place/parent role sits beside it — step 1's own condition, mirrored rather than
        # re-derived, so the two can never read the crowd exemplar's legality differently. With no
        # place present the walk never had a legal drop to make, so a lone crowd role left in the
        # slate is exactly as non-droppable as the cast/place/lettering seeds around it.
        has_place = bool(roles_list) and any(
            isinstance(entry, dict) and entry.get("role") in ("place", "parent")
            for entry in roles_list)
        droppable_present = bool(roles_list) and any(
            isinstance(entry, dict)
            and (entry.get("role") in ("interaction", "prop")
                 or (entry.get("role") == "crowd" and has_place))
            for entry in roles_list)
        if roles_list is not None and not droppable_present:
            n_cast = sum(1 for entry in roles_list
                        if isinstance(entry, dict) and entry.get("role") in ("figure", "canonical"))
            bad.append(f"{name}: {len(seeds)} seeds over the cap of {SEED_CAP} after every legal "
                       f"displacement (crowd exemplar, interaction template, tagged prop) has "
                       f"already been dropped where present — {n_cast} seeded-figure seed(s) plus the "
                       f"place plate/chain parent and, where they apply, the locked §5 lettering "
                       f"exemplar and scene style tile are what remain. Nothing is truncated and no locked seed is "
                       f"dropped: the true bind is figure count against `SEED_CAP`, not a misfit seed.")
        else:
            bad.append(f"{name}: {len(seeds)} seeds over the cap of {SEED_CAP} — "
                       f"{', '.join(_stem(s) for s in seeds[SEED_CAP:])} did not fit. Nothing is "
                       f"truncated: restage the shot rather than drop a seed.")
    chars = k.reg.get("characters", {})
    cast = [(c, [p for p in prims if p not in omitted])
            for c, prims in shot_cast(k.reg, delta)]
    bad.extend(interaction_violations(k, r, cast, seeds))
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
    # A `defect: seed`/`mechanism` retry overlay re-orders or replaces seeds with NO content change
    # and no primitive of its own; holding it to the authoring-side expression gate would refuse the
    # one surgical authority that exists to repair a bad seed.
    surgical_reseed = (r.get("retry_authority") or {}).get("kind") == "seed/mechanism"
    if delta_beat:
        declared = r.get("delta_primitives") or {}
        if not isinstance(declared, dict):
            bad.append(f"{name}: `delta_primitives` must be a per-character object.")
            declared = {}
        asset_kinds = {a.get("name"): a.get("kind") for a in k.reg.get("assets", [])}
        cast_by_character = dict(cast)
        allowed_primitives = set()
        for character, values in declared.items():
            if character not in cast_by_character:
                bad.append(f"{name}: `delta_primitives` names `{character}`, which is not in the "
                           "authored shot cast.")
                continue
            if (not isinstance(values, list) or not values
                    or not all(isinstance(p, str) and p for p in values)
                    or len(values) != len(set(values)) or len(values) > 1):
                bad.append(f"{name}: `delta_primitives.{character}` must declare exactly one "
                           "proved, unique primitive.")
                continue
            for primitive in values:
                if (primitive not in cast_by_character[character]
                        or asset_kinds.get(primitive) not in _PRIMITIVE_KINDS):
                    bad.append(f"{name}: `delta_primitives.{character}` binds `{primitive}` outside "
                               "that character's authored pose/expression recipe.")
                    continue
                allowed_primitives.add(primitive)
                if not any(_stem(seed) == primitive for seed in seeds):
                    bad.append(f"{name}: declared delta primitive `{primitive}` is absent from the "
                               "actual provider seed parts.")
        undeclared = [_stem(seed) for seed in seeds
                      if asset_kinds.get(_stem(seed)) in _PRIMITIVE_KINDS
                      and _stem(seed) not in allowed_primitives]
        if undeclared:
            bad.append(f"{name}: delta carries undeclared full-frame primitive(s): "
                       f"{', '.join(undeclared)}. Use parent + canonical by default; declare only "
                       "a proved necessary primitive.")
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
            # An expression the chain already holds rides in on the parent frame's pixels; an
            # expression this delta CHANGES (the builder derives which, from the chain) needs its
            # own: the primitive, or a reviewed STEP-1 frame that already carries it. Changed by
            # prose alone, the face is re-synthesized and reverts to the engine's prior — this
            # run's L75 full eye circles.
            changed = (r.get("expression_change") or {}).get(c)
            if (changed and not surgical_reseed
                    and not any(_stem(s) == changed for s in seeds)
                    and not any(_is_figure_frame(s, c) and changed in _stem(s) for s in seeds)):
                bad.append(f"{name}: delta changes `{c}` to `{changed}` but the slate carries "
                           f"neither that expression primitive nor a STEP-1 frame holding it — an "
                           f"expression changed by prose alone reverts to the engine's prior. "
                           f'Declare `delta_primitives`: {{"{c}": ["{changed}"]}}.')
            continue
        held = [s for s in seeds if _is_figure_frame(s, c)]
        if not held:
            expected = figure_frame_name(c, *_split_primitives(k.reg, prims))
            bad.append(f"{name}: `{c}` is staged FRESH with no STEP-1 figure frame in the slate — "
                       f"expected {expected}. Build the slate with `forge.py batch`.")
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
        # Identity/new-character gens build from the character portrait. The ONE scene exception is
        # the builder-DERIVED place plate (`plate: true`, see `cmd_batch`) — the frame that
        # establishes its own place from the hardened descriptor. Every other scene's image seed is
        # its chain/place/identity lock, so a shot inside an established place can never opt out.
        if mode in ("identity", "new_character"):
            return [k.base_frame(r.get("character", "base"))]
        if (mode in ("environment", "style") and r.get("plate") is True
                and str(r.get("stage_role", "")).lower() != "delta"
                and not r.get("place_anchor")):
            return []
        raise SystemExit(
            f"{name}: only a derived place plate — a place-first frame with no chain parent and no "
            "`place_anchor` — may carry zero image seeds. Delta, chained, anchored, and "
            "identity-bearing requests must keep their continuity/identity seeds.")
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
        bad.extend(seed_role_violations(k, r))
        bad.extend(seeding_law_violations(k, r, seeds))
        plan.append((r, seeds)); pending.add(name)
    if bad:
        raise SystemExit("SEEDING LAW — %d violation(s); nothing generated, nothing charged:\n  %s"
                         % (len(bad), "\n  ".join(bad)))
    return plan


def cmd_gen(k, reqs, force, image_size=IMAGE_SIZE_DEFAULT, dry=False, gate=True):
    # Results are reported AS THEY LAND, not buffered to the end of the batch. A 20-scene batch
    # is otherwise ~15 minutes of total silence, which (a) trips agent stream watchdogs and
    # (b) hides a systematic per-gen failure until every call has already been paid for — a
    # missing Pillow install once burned a batch's worth of API calls before the first line printed.
    #
    # `dry=True` runs the whole request path except the call itself and PRINTS each assembled prompt:
    # the batch pre-flight for "confirm the step is correctly configured before a batch run". It
    # still resolves seeds (so a missing seed is caught for free) and ignores skip-if-exists, since
    # the point is to read every prompt, not to see which files already landed.
    #
    # `gate=False` is the ONE exemption from P3's review gate, and it is a CALL-SITE exemption, not
    # a role one: the ad-hoc `gen --seed` CLI — the cast-generation wave and the single-asset loop
    # — mints from the asset base under the G2 ruling and acquires no human-verdict requirement.
    # `main()` passes it only on that branch; every builder-produced slate (`gen --batch`) is gated.
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
        # P3's gate over this request's WHOLE slate — every non-exempt seed role, not only the
        # STEP-1 card. It runs here as well as in `cmd_batch` because this is the only point where
        # a frame MINTED BY THIS RUN has bytes: a card or plate the batch itself produces has no
        # file when the slate is built, so a batch-time refusal on it would permanently block the
        # only path that mints one. Everything else re-checked here is a no-op that already passed
        # at batch time, and a defence for a hand-written spec fed straight to `gen --batch`.
        #
        # Operational consequence, stated plainly: a run whose batch mints its own seeds needs
        # board+stamp rounds roughly equal to its CHAIN DEPTH — pass 1 mints the cards and plates
        # and holds the scenes that would seed from them, the review rules on what landed, and the
        # next `gen` over the SAME spec releases the next layer. That is the 6c2 card-before-scene
        # split as a forge law instead of an operator convention.
        #
        # A held request is SKIPPED, never fatal: the seeds this run minted must still land so the
        # board can rule on them, and killing the batch would take them with it.
        if gate:
            held = seed_role_review_refusals(k, r.get("seed_roles") or [], name,
                                             plate_seed_overrides(reqs))
            if held:
                report(name, "skip (seed awaits review) — " + "; ".join(
                    line.split("\n")[0] for line in held))
                continue
        figures = r.get("figures")
        hold = should_hold(mode, seeds, r["delta"], figures)
        # `prompt_suffix` rides the request exactly as `delta`/`payload` do — it is the video's
        # `global_prompt_suffix`, carried from shots.json by `cmd_batch`. A STEP-1 figure card does
        # not carry one (it is a 2:3 identity card on a plain ground; the suffix's `16:9`,
        # built-but-flat ENVIRONMENT recipe and "no on-screen narrator or host face" are scene
        # facts that would fight it), and an ad-hoc `forge gen` request carries none either.
        text = k.prompt_for(mode, r["delta"], hold=hold, figures=figures,
                            suffix=r.get("prompt_suffix") or "")
        aspect = r.get("aspect", "2:3")
        size = r.get("image_size") or image_size
        if size not in IMAGE_SIZES:
            raise SystemExit(f"{name}: unknown image_size '{size}' (allowed: {', '.join(IMAGE_SIZES)})")
        if dry:
            report(name, f"DRY (no API call) mode={mode} aspect={aspect} size={size}")
            print(f"      seeds: {[os.path.relpath(s, k.root).replace(chr(92), '/') for s in seeds]}")
            authority = r.get("retry_authority")
            if authority:
                print(f"      retry authority: {json.dumps(authority, sort_keys=True)}")
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
                report(name, "OK -> _staging/" + name + ".png")
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
    # HELD is its own count, never folded into `skipped` (I-3): "already in staging" means done and
    # needs nothing, while "awaits review" means a human owes a verdict before this frame can ever
    # be generated. An orchestrator reading one number could not tell "finished" from "blocked".
    # The EXIT CODE is unchanged — 0 — matching how `failed` has always been signalled here: this
    # function reports per-request outcomes in its summary and reserves a non-zero exit for
    # conditions that invalidate the whole batch (seed-integrity abort, the seeding law).
    held = sum(1 for _, s in results if s.startswith("skip (seed awaits review)"))
    skipped = len(results) - ok - err - held
    print(f"  == {ok} generated, {err} failed, {skipped} skipped, {held} held for review ==",
          flush=True)

# --- `batch`: the policied seed slate ------------------------------------------------------
# Every silent drop on the 2026-07-28 run happened in the gap BETWEEN a per-run scratch script and
# forge: a `cap4()` truncation with no print, a ladder gen sliced to `[:3]`, a retry inventing a
# seed the original never had (the swamp plate into L99), 7 shots losing their mandatory style
# anchor. forge itself never dropped a seed. So the slate is built HERE, by the same code that
# validates it — the builder and the seeding law are one file, and the retry path reuses it.


_ORDINALS = ("FIRST", "SECOND", "THIRD", "FOURTH")


def _seed_role(path, role, character=None):
    return {"path": path, "role": role, "character": character}


def _dedupe_seed_roles(entries):
    """Stable first-wins dedup for the path and its semantic role as one indivisible unit."""
    out, seen = [], set()
    for entry in entries:
        if not entry or not entry.get("path") or entry["path"] in seen:
            continue
        out.append(entry); seen.add(entry["path"])
    return out


def seed_roles_text(seed_roles):
    """Provider-visible ordinal prose derived only from final ordered image parts."""
    lines = []
    for index, entry in enumerate(seed_roles or []):
        ordinal = _ORDINALS[index] if index < len(_ORDINALS) else f"IMAGE {index + 1}"
        role = entry["role"]
        path = entry["path"]
        character = entry.get("character") or _stem(path)
        if role == "place":
            detail = "the destination place — preserve its set, palette, outline weight and lighting"
        elif role == "figure":
            detail = (f"`{character}`'s complete STEP-1 figure — carry that figure's identity, "
                      "costume, pose, hands and expression exactly")
        elif role == "canonical":
            detail = (f"`{character}`'s character canonical — identity, head tone, hair and the "
                      "pinned costume come from this image only")
        elif role == "parent":
            detail = "the in-chain parent scene — preserve its held set and existing composition"
        elif role == "pose":
            detail = (f"the `{_stem(path)}` pose reference for `{character}` — copy only body pose, "
                      "hands and limb placement; ignore identity and costume")
        elif role == "expression":
            detail = (f"the `{_stem(path)}` expression reference for `{character}` — copy only "
                      "eye/brow/mouth shape; ignore identity, head tone and hairline")
        elif role == "crowd":
            detail = "the crowd exemplar — use only its anonymous crowd proportion and face tier"
        elif role == "interaction":
            detail = (f"the `{_stem(path)}` interaction template — two blank mannequins holding "
                      "the contact geometry for BOTH figures; copy only the clasp/limb geometry, "
                      "relative placement and eye-line, and give it to neither figure's identity, "
                      "costume or expression")
        elif role == "prop":
            detail = f"the `{character}` prop canonical — preserve that object's design"
        elif role == STYLE_ANCHOR_ROLE:
            # The era's own words for what a `refs/env/` register anchor grants, restored
            # 2026-08-05 from `ff36f63:.../refs/env/README.md`: "the anchor pins line weight,
            # outline color (#241a12), flat-cel render, and palette discipline, not the content".
            # AMENDED 2026-08-06 (grayscale drift): "palette DISCIPLINE" is a restraint word — it
            # transfers "few colours", which is what the rest of the prompt already says four times
            # over (§2b "simple", the authored `Palette:` line, the suffix's "2-3 colour" cap and
            # its semantic-only red). The tile is the register's chroma AUTHORITY — it measures
            # mean saturation 0.407 with only 16% of its area near-neutral — and "and nothing else"
            # was opting that chroma out, leaving grey the only instruction the prompt could
            # satisfy. It now grants SATURATION, matched in the new frame's own hues, so a cool
            # authored palette renders cool-and-coloured instead of drained.
            detail = ("the channel's SCENE STYLE TILE — a register sample ONLY. It pins LINE "
                      "WEIGHT, the outline colour (#241a12), the FLAT-CEL RENDER, and PALETTE "
                      "SATURATION — match how strongly its flat fills are coloured and lay THIS "
                      "frame's own hues, warm or cool, down at that same strength; a frame drained "
                      "to neutral grey has failed to take the register. Take NOTHING else "
                      "from it — not its content, not its objects, not its layout or camera, and "
                      "NOT the place it depicts. This image is not a location and never appears "
                      "in the frame you draw")
        elif role == "environment":
            detail = f"the `{character}` environment reference — preserve its authored place facts"
        else:
            detail = f"the `{character}` supporting reference"
        lines.append(f"The {ordinal} image is {detail}.")
    return "SEED ROLES. " + " ".join(lines) if lines else ""


def placement_delta(prompt, seed_roles):
    """Put generated image-role policy before authored text so the payload remains final."""
    return "\n\n".join(p for p in (seed_roles_text(seed_roles), prompt) if p)


def figure_card_payload(pose=None, costume=""):
    """STEP 1's payload. The stance sentence follows the SEEDS: a card with a pose primitive is
    told to copy it, a POSE-LESS card is told to stand neutral rather than pointed at a reference
    image that is not in the request. That second shape is now the norm, not an edge case — an
    interaction shot's two cards are both pose-less because the contact geometry lives in the
    scene-level template (`_interaction_primitives`), so a card claiming "exactly as the pose
    reference shows" would be prose against nothing.

    `costume` is a clause DERIVED from the shot's own prose (`costume_clause`), spliced into the
    card so an attribute the figure's seed does not carry is drawn on the card's own pixels rather
    than argued for in loose scene prose. Its only caller was the abolished seeded-performer tier,
    so NOTHING passes it today: every card here is a named character's, whose costume its canonical
    already pins. The path is RETAINED unreferenced because P8 re-uses it, widened from clothing to
    clothing + the beat's own act. The clause sits BEFORE the backdrop sentence deliberately: the
    scene fragment it quotes carries the shot's setting too, and "no scenery, no props, no
    furniture" is the fence, stated last.

    This is also the ONE point where a derived clause becomes rig-register card text, so it is where
    `strip_micro_pattern_texture` applies: prose is free to dress a figure in quilted gloves, and a
    card drawn at rig register may not draw the quilting (`line-register`)."""
    stance = ("standing or seated exactly as the pose reference shows" if pose
              else "standing squarely at rest, arms relaxed at the sides, facing the viewer")
    costume = strip_micro_pattern_texture(costume)
    dress = (f"The scene this card is minted for reads: {costume} Take from that description "
             "ONLY the CLOTHING it implies — garments, headwear, footwear — and dress the figure "
             "in it for that era, work and setting, never the rig template's default hoodie; "
             "draw none of its setting, props, lettering or other people. " if costume else "")
    return (f"The whole figure is in frame head to feet, {stance}, on a thin visible ground line "
            "with one soft contact shadow directly "
            f"beneath it. {dress}Flat solid pale-grey studio backdrop, no scenery, no props, no "
            "furniture. "
            "This is a reference sheet: the character alone, fully resolved, ready to be placed "
            "into a separate scene.")


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


ASSET_REVIEW = "review.json"       # C-6/P3: the per-ASSET review store, one file inside <kit>/_staging


def figure_review_record(staging_dir, fn):
    """One asset's review record, or None when the store holds no entry for it.

    Keyed by the frame's FILE STEM — `fig-<char>--<pose>--<expr>` for a STEP-1 card, `prop-drive`
    for a prop, `L28` for a place plate. One store, one key shape, every seeding asset class.

    Takes the STAGING DIR rather than a `Kit` so the review side of the loop
    (`build_review_artifact.py`, which has a video and a staging path but no key-bearing Kit) reads
    the store through this same function instead of re-implementing it. The single-writer law is
    untouched: `stamp_review.py` is the only writer of a verdict anywhere in this pipeline; every
    other caller, forge included, only ever reads."""
    try:
        doc = json.load(open(os.path.join(staging_dir, ASSET_REVIEW), encoding="utf-8"))
    except (OSError, ValueError):
        return None
    entry = (doc.get("figures") or {}).get(fn) if isinstance(doc, dict) else None
    return entry if isinstance(entry, dict) else None


_DIGEST_CACHE = {}


def frame_digest(path):
    """One frame's sha256, memoized per (path, size, mtime) for the life of this process.

    P3 asks the gate's question once per SHOT, so a standing asset is re-read on every scene that
    seeds it — the §5 style tile on all 246 of them, against a ~100MB refs tree. The key carries
    size and mtime, so a frame RE-MINTED mid-run is re-hashed: the staleness the store checks for
    is exactly what a cache keyed on the path alone would hide."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (os.path.abspath(path), st.st_size, st.st_mtime_ns)
    if key not in _DIGEST_CACHE:
        with open(path, "rb") as f:
            _DIGEST_CACHE[key] = hashlib.sha256(f.read()).hexdigest()
    return _DIGEST_CACHE[key]


def figure_reuse_blocker(staging_dir, fn, frame, store_label=None):
    """The ONE reason ANY asset's pixels may not seed a scene slate, or None when it is clear.

    `cmd_batch` reuses a staged frame BY NAME before it regenerates anything, so the name alone
    decided whether a pre-reset, drifted figure rode into a fresh run — the 2026-08-04 audit's
    mechanism 2, which supplied 8 of the 10 defect scenes. Seeding now requires an all-pass review
    record whose `canonical_sha256` still matches the bytes on disk. A frame nobody ruled on, a
    frame that failed an invariant, and a frame re-minted since it was ruled on all get the same
    answer — re-mint it and review it. Nothing is grandfathered.

    P3 (2026-08-12) stops carving classes out of that answer. The predicate was written asset-
    agnostic and was called on figures alone, so a plate, a prop, an environment reference, a
    crowd exemplar and a pose/expression primitive each seeded scenes on pixels no human ever
    ruled on. `asset_seed_refusal` is the one route every class now takes into this same function
    — there is no second predicate and no per-class variant. The ONE exemption is a named cast
    member's own canonical, minted through the standard cast-generation wave from the asset base
    (G2 ruling: "P2 seeds don't need their own human gates... as long as it seeds with our actual
    logic and from asset base").

    This predicate is the WHOLE gate, and it is deliberately callable without a `Kit`: the review
    board asks it which staged assets still need a fresh-eyes ruling, so the board's pending list
    and forge's refusal can never disagree about what "reusable" means."""
    store = store_label or os.path.join(staging_dir, ASSET_REVIEW).replace("\\", "/")
    record = figure_review_record(staging_dir, fn)
    verdicts = (record or {}).get("verdicts")
    scored = isinstance(verdicts, dict) and bool(verdicts)
    failed = sorted(s for s, v in verdicts.items() if v != "pass") if scored else []
    if record is None:
        return f"it has no review record in {store}"
    if not scored:
        return f"its {store} record carries no per-invariant verdicts"
    if failed:
        return f"its {store} record FAILS {', '.join(failed)}"
    if record.get("canonical_sha256") != frame_digest(frame):
        return (f"its {store} record is stale — `canonical_sha256` no longer matches the frame on "
                "disk, so the pixels that were reviewed are not the pixels this slate would seed")
    return None


def figure_remint_instruction(k, fn, frame, shots_path, out_path, shot_name):
    """The builder invocation that re-mints one refused STEP-1 — printed, never a second minter.

    There is exactly ONE STEP-1 recipe in this pipeline: `cmd_batch`'s own STEP-1 branch, which
    emits `seed_roles` of `canonical` + `expression` + `pose` for that named character. A hand-typed
    `gen --seed a,b,c` cannot carry it — the `gen` CLI can only build `reference` roles
    (`main()`), and untruthful role prose is the B4 root cause `seed_roles_text` exists to remove.
    So the refusal points at the builder rather than duplicating it: delete the refused frame, re-run
    THIS SAME batch scoped to the shot that needs the figure, and the builder re-derives the request
    with its own roles. One minter, one truth.

    The last step closes C-6's loop: the fresh-eyes pass rules on the new frame and the orchestrator
    records that ruling with `stamp_review.py --figures`, which is what makes the frame reusable in
    the NEXT batch instead of being refused again."""
    def rel(path):
        return os.path.relpath(path, k.root).replace("\\", "/")
    stamp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stamp_review.py")
    return (f"    1. delete the refused frame:  {rel(frame)}\n"
            f"    2. py -3 {rel(os.path.abspath(__file__))} batch --kit {rel(k.kit)} "
            f"--batch {rel(shots_path)} --out {rel(out_path)} --shots {shot_name}\n"
            f"    3. py -3 {rel(os.path.abspath(__file__))} gen --kit {rel(k.kit)} "
            f"--batch {rel(out_path)}\n"
            f"    4. review the frame, then record the verdicts (the ONLY writer):\n"
            f"       py -3 {rel(stamp)} --figures <figure-verdicts.json> {rel(k.staging)}")


def asset_seed_refusal(k, path, klass, shot_name):
    """The P3 pre-gen refusal for one NON-figure seeding asset, or None when it may seed.

    Every asset class whose pixels seed a scene — plate, environment, prop, crowd exemplar,
    pose/expression/interaction primitive — routes THROUGH HERE into `figure_reuse_blocker`. One
    predicate, one store, one key shape (the frame's file stem): a per-class variant would be a
    second definition of "reviewed", which is precisely the drift C-6 was built to remove.

    A path that resolves to nothing on disk returns None rather than a review refusal: seed
    EXISTENCE is `preflight_batch`'s to report, and answering "no review record" for a missing
    file would send the author to the review board for a file that was never minted."""
    if not path:
        return None
    if "_staging/" in str(path).replace("\\", "/"):
        # `resolve_request_seeds`' own convention for a staged frame, byte-identical: the slate
        # writes `_staging/<name>.png` and the staging DIR is the kit's, wherever it lives.
        frame = os.path.join(k.staging, _stem(path) + ".png")
    else:
        try:
            frame = k.resolve_seed(path)
        except SystemExit:
            return None
    if not os.path.isfile(frame):
        return None
    store = os.path.relpath(os.path.join(k.staging, ASSET_REVIEW), k.root).replace("\\", "/")
    name = _stem(path)
    reason = figure_reuse_blocker(k.staging, name, frame, store)
    if reason is None:
        return None
    stamp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stamp_review.py")
    board = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_review_artifact.py")

    def rel(p):
        return os.path.relpath(p, k.root).replace("\\", "/")
    return (f"{shot_name}: {klass} `{name}` refused as a seed — {reason}. Every asset whose pixels "
            "seed a scene carries a human ruling (P3); render it onto the review board and record "
            "the verdicts (the ONLY writer):\n"
            f"    1. py -3 {rel(board)} --video <video-dir> --out <board.html> "
            f"--staging {rel(k.staging)} --assets {rel(frame)} --figures-out <verdicts.json>\n"
            f"    2. py -3 {rel(stamp)} --figures <verdicts.json> {rel(k.staging)}")


# The two seed roles P3's gate does NOT cover, each for a stated reason:
#   `canonical` — a named cast member's own canonical. The G2 ruling exempts it BY NAME ("P2 seeds
#     don't need their own human gates. I trust those will be fine. As long as it seeds with our
#     actual logic and from asset base"), so the cast wave is untouched by this change.
#   `parent`    — an ORDINARY scene-to-scene chain parent, owned by the scenes-manifest gate
#     (`_scene_provenance`). A generated scene's verdict lives in that manifest, not in the asset
#     store; asking for a second record would be a second definition of "reviewed" for one frame.
#     The exemption is NARROW, and `gated` below is why: `place_role` wears `parent` on a delta and
#     `place` on a base while naming the SAME place plate, so exempting the label once exempted the
#     plate itself — a plate refused on the `place` path rode free on the `parent` path (C-1). A
#     plate is a seeding asset like any other; only a scene-to-scene parent is exempt, and the
#     manifest's own refusal fires on `parked` alone, so it never covered an UNREVIEWED plate.
#
# `reference` is deliberately NOT here. It is the only role the ad-hoc `gen --seed` CLI builds
# (`main()`) — the cast-generation wave and the single-asset loop — and that path IS exempt, but
# by CALL SITE (`cmd_gen(gate=False)`), not by role. Exempting the role exempted every OTHER
# producer of it too: `_retry_scene`'s `added_role` fell back to `reference` for any retry-added
# seed, so a retry overlay naming a kit plate, prop or primitive seeded a scene on no ruling (I-1).
GATE_EXEMPT_ROLES = ("canonical", "parent")


def seed_role_review_refusals(k, roles, shot_name, gated=None):
    """Every P3 refusal carried by one slate's seed roles — the ONE gate sweep.

    Called on the scene slate and on the STEP-1 card's own roles, so a pose or expression primitive
    is ruled on whether its pixels reach the scene directly or through the card it mints. Roles are
    the classifier because the role is what the slate already records about a seed; a name-pattern
    or directory test would be a second, weaker taxonomy sitting beside this one.

    `gated` is a `{path: class label}` override for the one case where the role LABEL is not the
    whole truth: a place plate carried as a delta's `parent`. Only the caller can know which frames
    those are — `cmd_batch` from the walk that saw which shot minted the place, `cmd_gen` by
    reading back the `plate_parent` that walk recorded on the item — so naming the path keeps that
    knowledge out of this predicate."""
    gated = gated or {}
    out = []
    for role in roles:
        if not role:
            continue
        path = role.get("path")
        klass = gated.get(path)
        if klass is None and role.get("role") in GATE_EXEMPT_ROLES:
            continue
        refusal = asset_seed_refusal(k, path, klass or role.get("role"), shot_name)
        if refusal:
            out.append(refusal)
    return out


def plate_seed_overrides(reqs):
    """`{path: "place plate"}` for every delta in this batch that inherits a PLATE — C-1's
    gen-time half.

    A plate minted by this batch has no bytes when the slate is built, so the batch-time gate
    cannot read it; by gen time it exists, but it reaches its delta wearing the exempt `parent`
    label. `cmd_batch` is the only code that can tell a plate parent from an ordinary
    scene-to-scene parent — it walked the whole file and knows which shot minted its place — so it
    records the answer on the delta as `plate_parent` and this reads it back. Deriving it from the
    batch's `plate: true` items instead would go wrong the moment a spec is run in slices: gen a
    delta whose plate item is not in the same slice and the override would silently vanish."""
    return {r["plate_parent"]: "place plate"
            for r in reqs if isinstance(r, dict) and r.get("plate_parent")}


def refuse_unreviewed(refusals):
    """Stop the batch at $0 on the P3 gate — one refusal list, one exit, both call sites."""
    if refusals:
        raise SystemExit("PRE-GEN REVIEW GATE — %d seeding asset(s) carry no human ruling; "
                         "nothing generated, nothing charged:\n%s"
                         % (len(refusals), "\n".join(refusals)))


def figure_reuse_refusal(k, fn, frame, shots_path, out_path, shot_name):
    """The C-6 reuse refusal: the ONE blocking reason, plus the builder path that clears it."""
    store = os.path.relpath(os.path.join(k.staging, ASSET_REVIEW), k.root).replace("\\", "/")
    reason = figure_reuse_blocker(k.staging, fn, frame, store)
    if reason is None:
        return None
    return (f"{fn}: staged STEP-1 refused as a seed — {reason}. Re-mint it through the BUILDER "
            "(the only STEP-1 minter — a hand-typed `gen` carries `reference` seed roles, not this "
            "figure's canonical/expression/pose roles), then review it:\n"
            f"{figure_remint_instruction(k, fn, frame, shots_path, out_path, shot_name)}")


def _derived_from(stem, base):
    """True when `stem` names a frame DERIVED from the frame/shot `base` — forge's one naming
    convention: `<base>.png` is the frame itself, `<base>-fix.png` / `<base>.v2.png` a repair of it.

    ONE binding, used by both the same-place law (`_anchor_place`) and the retry path
    (`_repaired_parent_matches`). Written twice, a second naming form taught to only one call site
    leaves the same-place law resolving a repaired frame to `place=None` — which silently permits a
    cross-place seed, the exact failure the law exists to refuse."""
    return bool(re.fullmatch(re.escape(base) + r"[-.].+", stem))


def _anchor_place(place_of_shot, anchor):
    """The declared `place` of the shot that minted an anchored frame, or None when no shot owns it.

    An approved frame is named for the shot that produced it (`assets/scenes/<id>.png`) or for a
    repair of that shot (`<id>-fix.png`) — `_derived_from`'s binding, the same one the retry path
    uses. A frame no shot in this file owns is not provably same-place, so it resolves to None and
    only a place-less shot may anchor to it."""
    stem = _stem(anchor)
    if stem in place_of_shot:
        return place_of_shot[stem]
    for shot_name in sorted(place_of_shot, key=len, reverse=True):
        if _derived_from(stem, shot_name):
            return place_of_shot[shot_name]
    return None


def cmd_batch(k, shots_path, out_path, video_dir=None, shots=None, retry_rebuild=False):
    """Build one deterministic slate per shot from the shot's own `assets` tags and `figures`.

    STEP 2's priority, stated ONCE: [STEP-1 figure(s)] > [the video's place]. A delta beat uses
    [in-chain parent] > [canonical identity]; raw pose/expression primitives enter only through
    the shot's explicit proved-necessary `delta_primitives` declaration.
    Nothing is ever truncated: an over-budget or under-seeded shot is a hard error naming the shot
    and the seed that did not fit, and that list is the re-authoring input.

    The seeding identity is the shot's `place` — the recurring diegetic SET — and only then its
    `stage` (a continuity chain WITHIN a place, capped at 1 base + 2 deltas) and finally its own id.
    Keying on `stage` alone is what let 74 of the audited 214 shots run as independent seedless
    roots inside sets the video had already established (L89-L91): the same room, re-invented per
    chain. One map, one key, so a place's first frame is the plate every later shot inherits."""
    doc = json.load(open(shots_path, encoding="utf-8"))
    # The TAIL style voice (`assemble_prompt`): fixed channel data the file carries once, copied
    # onto every scene request so `cmd_gen` appends it after the authored payload. Read here, with
    # `still_prompt`, so the two halves of one prompt travel together through the same spec file.
    prompt_suffix = (doc.get("global_prompt_suffix") or "").strip()
    video = os.path.abspath(video_dir) if video_dir else video_root_for(shots_path, k.root)
    k.use_video(video)          # this video's own cast resolves alongside the channel's
    lib, scenes = os.path.join(video, "assets", "library"), os.path.join(video, "assets", "scenes")
    reg_assets = {a["name"]: a for a in k.reg.get("assets", [])}
    chars = k.reg.get("characters", {})
    spec, made, emitted, place_first, place_last, notes = [], {}, {}, {}, {}, []
    provenance = {}             # emitted name -> its `parent_depth`/`lineage` record (C-11)
    # Shots whose slate derived `plate: true` — the place's own establishing frame. Recorded for
    # EVERY walked shot, in scope or not, because a scoped delta's parent is routinely a plate the
    # scope excluded, and that plate still has to carry a ruling before its pixels seed the child.
    plate_shots = set()
    # `--shots` is a FILTER on this one walk, never a second path. The walk still visits every shot,
    # because stage chains and place-first plates are only correct when the whole file is read; scope
    # decides what gets EMITTED and what BLOCKS. Full runs stay the default the engine is built for.
    scope, seen, outside = (set(shots) if shots else None), set(), []
    walk = list(_shot_iter(doc))
    # Every shot's declared place, read BEFORE the walk: a `place_anchor` names a frame minted by
    # another shot, and the same-place law can only be checked against that shot's own declaration.
    place_of_shot = {shot_name: shot.get("place") or None for shot_name, shot, _ in walk}
    # C-10 state, keyed on the STAGE CHAIN, never the place. A place hosts many chains (the
    # boardroom's fear beat, firing beat and planning beat are three `stage`s inside one `place`),
    # and a delta's expression is judged against ITS chain. Keyed on the place, chain A's last
    # expression persisted into chain B: a chain-B delta that re-introduces a character at the
    # expression chain A left on record read as UNCHANGED, so the gate that demands pixels for an
    # authored expression change never fired — the L75 mechanism slipping through the gate built
    # to stop it.
    held_expression = {}        # (chain, character) -> the expression that chain currently holds

    def vfile(n):
        return ((shot.get("assets") or {}).get(n) or (reg_assets.get(n) or {}).get("file")
                or (chars.get(n) or {}).get("base"))

    def on_disk(*cands):
        for c in cands:
            if c and os.path.exists(c):
                return os.path.relpath(c, k.root).replace("\\", "/")
        return None

    # P4 (2026-08-12): the crowd exemplar is minted PER VIDEO — this video's era dress, its 2-3
    # flat head tones, its 2-3 hair silhouettes — so the video's own frame outranks the channel's
    # standing one, and the channel's remains the fallback for a video that has not minted one.
    # Same precedence shape `vfile` uses one line up (the nearest, most specific file wins); it has
    # to be stated HERE rather than left to the merged vocabulary because `merge_vocabulary`
    # deliberately lets the CHANNEL entry win a name collision (a promoted canonical is the stronger
    # lock), which would otherwise make a video's own exemplar unreachable by name. Nothing else
    # changes: the frame still enters as the `crowd` seed role, still keys the P3 review store on
    # the stem `crowd-exemplar`, and is still the crowd's only seed.
    crowd_ex = (on_disk(os.path.join(lib, "crowd-exemplar.png"))
                or (reg_assets.get("crowd-exemplar") or {}).get("file"))

    for name, shot, aspect in walk:
        seen.add(name)
        in_scope = scope is None or name in scope
        src = shot.get("source", "ai-gen")
        if src not in ("ai-gen", "hybrid"):
            if in_scope:
                notes.append(f"{name}: skipped source={src}")
            continue
        prompt = shot.get("still_prompt") or ""
        omitted = shot.get("assets_omitted") or {}
        declared_place = shot.get("place") or None
        place = declared_place or shot.get("stage") or name     # the ONE seeding key
        anchor = shot.get("place_anchor")
        if in_scope and anchor is not None:
            if str(shot.get("stage_role", "")).lower() == "delta":
                # ONE law sentence, byte-identical to `lint_shots.py`'s
                # `place_anchor_legality_check` (sanctioned mirror): an author who fixes the shot
                # lint described must not read a differently-worded rule from forge.
                raise SystemExit(f"{name}: `place_anchor` is not valid on a stage `delta` (a "
                                 "delta continues its own base's held scene via the chain parent; "
                                 "`place_anchor` is a different seed, for a base or standalone "
                                 "shot).")
            src_place = _anchor_place(place_of_shot, anchor)
            if src_place != declared_place:
                raise SystemExit(
                    f"{name}: `place_anchor` {anchor} is a frame of place `{src_place or 'none'}`, "
                    f"not this shot's own place `{declared_place or 'none'}` — cross-place image "
                    "seeding is the probe-refuted style-anchor failure (decisions.md 2026-08-04); "
                    "a plate may only seed shots in its own place.")
        place_anchor = place_anchor_for(video, anchor, k.root, name) if in_scope else None
        delta_beat = str(shot.get("stage_role", "")).lower() == "delta" and place in place_last
        chain = (place, shot.get("stage") or place)     # the C-10 expression-state key
        if not delta_beat:
            # A chain ROOT resets its own expression record: a re-base re-establishes the beat from
            # canonicals, so nothing the previous run of this chain held is still on the frame.
            for stale in [key for key in held_expression if key[0] == chain]:
                del held_expression[stale]
        declared_delta_primitives = shot.get("delta_primitives") or {}
        if declared_delta_primitives and (not delta_beat or not isinstance(declared_delta_primitives, dict)):
            raise SystemExit(f"{name}: `delta_primitives` is a per-character object allowed only "
                             "on an in-chain delta.")
        figs, canons, prims_seeds, staged, why = [], [], [], [], []
        fig_roles, canon_roles, prim_roles = [], [], []
        expression_change = {}
        cast_recipe = shot_cast(k.reg, prompt)
        # Routed SCENE-level below, so they are not this figure's to carry — and not surplus
        # either: reporting them as "not seeded" would name a drop that never happened.
        scene_level = set(_interaction_primitives(k.reg, cast_recipe, omitted))
        for c, prims in cast_recipe:
            pose, expr = _split_primitives(k.reg, prims, omitted)
            # A delta re-stating the expression its chain already holds is the DEFAULT authoring
            # (parent + canonical carry it in pixels). A delta naming a DIFFERENT expression is
            # authoring a change, and the law below demands pixels for it — the walk is the only
            # place that knows which of the two this is.
            if delta_beat and expr and expr != held_expression.get((chain, c)):
                expression_change[c] = expr
            if expr:
                held_expression[(chain, c)] = expr
            surplus = [p for p in prims
                       if p not in (pose, expr) and p not in omitted and p not in scene_level]
            if surplus:
                # Either a second pose/expression authored for this figure (only ONE can be seeded
                # — restage), or a primitive that belongs to an anonymous figure. Recorded, never
                # silently dropped; the human reading the slate decides which.
                why.append(f"`{c}` surplus primitive(s) NOT seeded: {', '.join(surplus)}")
            if chars.get(c, {}).get("no_hands"):
                # personified object: no pose primitive exists for its rig (seeding a human torso
                # bleeds a human body), so its canonical IS the inheritable base — single step.
                canons.append(vfile(c)); canon_roles.append(_seed_role(vfile(c), "canonical", c))
                if not delta_beat and expr:
                    prims_seeds.append(vfile(expr))
                    prim_roles.append(_seed_role(vfile(expr), "expression", c))
                why.append(f"`{c}` no_hands -> canonical"); continue
            if delta_beat:
                canons.append(vfile(c)); canon_roles.append(_seed_role(vfile(c), "canonical", c))
                declared = declared_delta_primitives.get(c, [])
                if not isinstance(declared, list) or any(not isinstance(p, str) for p in declared):
                    raise SystemExit(f"{name}: `delta_primitives.{c}` must be a list of authored "
                                     "pose/expression vocabulary names.")
                available = {p for p in (pose, expr) if p}
                unknown = [p for p in declared if p not in available]
                if unknown:
                    raise SystemExit(f"{name}: `delta_primitives.{c}` names unbound primitive(s): "
                                     f"{', '.join(unknown)}.")
                for primitive in _dedupe(declared):
                    role = "expression" if primitive == expr else "pose"
                    prims_seeds.append(vfile(primitive))
                    prim_roles.append(_seed_role(vfile(primitive), role, c))
                why.append(f"`{c}` delta -> parent + canonical"
                           + (f" + proved {', '.join(declared)}" if declared else "")); continue
            # Every card here is a NAMED character's: its costume is pinned in its own canonical
            # (registry `costume`), so the card is costume-invariant and its key carries no dress
            # dimension. The abolished performer tier was the only shape that needed one.
            fn = figure_frame_name(c, pose, expr)
            if not in_scope:
                # Out of scope: resolve what its slate WOULD carry so the law can judge it, but mint
                # nothing — an out-of-scope shot must not consume the reuse key an in-scope shot owns.
                figure_path = made.get(fn) or "_staging/" + fn + ".png"
                figs.append(figure_path); fig_roles.append(_seed_role(figure_path, "figure", c))
                staged.append(c); continue
            if fn not in made:
                step1_roles = _dedupe_seed_roles(
                    [_seed_role(vfile(c), "canonical", c)]
                    + ([_seed_role(vfile(expr), "expression", c)] if expr else [])
                    + ([_seed_role(vfile(pose), "pose", c)] if pose else []))
                reused = on_disk(os.path.join(lib, fn + ".png"), os.path.join(k.staging, fn + ".png"))
                if reused:
                    refusal = figure_reuse_refusal(k, fn, os.path.join(k.root, reused),
                                                   shots_path, out_path, name)
                    if refusal:
                        raise SystemExit(refusal)
                    made[fn] = reused; why.append(f"`{c}` STEP-1 {fn} REUSED")
                else:
                    # The card is MINTED here, so its own primitives are gated on the way in: a
                    # pose or expression nobody ruled on must not reach a scene by riding inside
                    # the card it minted. Same predicate, same store — only the canonical is
                    # exempt, and only because the cast wave owns it.
                    refuse_unreviewed(seed_role_review_refusals(k, step1_roles, name))
                    step1_payload = figure_card_payload(pose)
                    spec.append({"name": fn, "mode": "environment", "aspect": "2:3",
                                 "image_size": "1K", "stage_role": "base",
                                 "seed": [role["path"] for role in step1_roles],
                                 "seed_roles": step1_roles, "payload": step1_payload,
                                 "delta": placement_delta(step1_payload, step1_roles),
                                 "why": f"STEP 1 for `{c}` ({pose or 'no pose'} / "
                                        f"{expr or 'no expr'})"})
                    made[fn] = "_staging/" + fn + ".png"
                    why.append(f"`{c}` STEP-1 {fn} GENERATE")
            else:
                why.append(f"`{c}` STEP-1 {fn} shared")
            figs.append(made[fn]); fig_roles.append(_seed_role(made[fn], "figure", c)); staged.append(c)
        unknown_declared_cast = sorted(set(declared_delta_primitives) - {c for c, _ in cast_recipe})
        if unknown_declared_cast:
            raise SystemExit(f"{name}: `delta_primitives` names absent cast: "
                             f"{', '.join(unknown_declared_cast)}.")
        parent = place_last.get(place) if delta_beat else place_first.get(place)
        place_frame = place_anchor or ((emitted.get(parent) or
                                        on_disk(os.path.join(scenes, (parent or "") + ".png")))
                                       if parent else None)
        anon_declared, crowd = _fig_declared(shot.get("figures"))
        # Non-figure seeds are DERIVED from what the frame contains, then unioned with Pass 1's
        # explicit tags — the same content-first move as `depicts_figures`, and for the same
        # reason. Reading the `assets` block alone made two LOCKED routes depend on an author
        # remembering a field image-generation owns: the 2026-08-04 fresh fifth carried no
        # `assets` block on any of its 41 shots, so `lettering-marker-italic` seeded 0 of its 14
        # text-bearing frames (style-bible §5: it "seeds every text-bearing gen") and L10's
        # backticked `prop-drive` shipped as an unresolved control token in the prompt text.
        # Cast, primitives, interaction templates and the crowd exemplar keep their
        # higher-priority structural routes above; only prop/environment assets route here.
        def _kind(n):
            return (reg_assets.get(n) or {}).get("kind")
        tagged_names = _dedupe([n for n in (shot.get("assets") or {}) if _kind(n) in ("prop", "environment")]
                               + [n for n in backticked(prompt) if _kind(n) in ("prop", "environment")])
        if (text_bearing(prompt) and LETTERING_EXEMPLAR not in tagged_names
                and LETTERING_EXEMPLAR not in omitted and reg_assets.get(LETTERING_EXEMPLAR)):
            tagged_names.append(LETTERING_EXEMPLAR)
            why.append(f"LETTERING — text-bearing prompt; §5 exemplar `{LETTERING_EXEMPLAR}` derived")
        # The §5 SCENE STYLE TILE, on the same derived route: a property of the frame decides it,
        # never an authored field. The property is "this gen carries NO cast seed", read off the
        # RESOLVED recipe — the named cast the walk just staged, plus the `figures` declaration.
        # Not `_is_char_seed`, which mid-walk sees a STEP-1 frame as the unresolved string
        # `_staging/fig-*.png` and calls it non-figure; and NOT `depicts_figures`, whose ASYMMETRY
        # runs the wrong way for this route. That predicate exists for the §2c rig-hold block,
        # where a false positive costs one inert paragraph, so it fires broadly ("cast", "face",
        # "hand", "banker"). Here a false positive WITHHOLDS the register anchor from the exact
        # frame that needs it: measured over bricks-fresh it excluded 12 of 23 plates, including
        # L63 — the run's own drift exemplar — because the prompt contains the phrase "cast-free".
        # The cheap failure here is the opposite one: the tile on a frame that turns out to hold
        # people costs one seed slot and contributes register only, and it can never contradict a
        # cast seed, because its role prose grants it nothing but line weight and palette.
        # The place/parent seed is deliberately NOT a cast signal either — a cast-free scene
        # chained onto a plate is still cast-free, and inheriting a parent that already drifted is
        # precisely the case that needs the register re-anchored.
        cast_free = not (fig_roles or canon_roles or crowd or anon_declared)
        if (cast_free and STYLE_TILE not in tagged_names and STYLE_TILE not in omitted
                and reg_assets.get(STYLE_TILE)):
            tagged_names.append(STYLE_TILE)
            why.append(f"STYLE TILE — cast-free frame; §5 anchor `{STYLE_TILE}` derived "
                       f"(line register + palette only)")

        def _role_of(n):
            # The tile is registered `kind: environment` like every other standing `refs/env/`
            # anchor, but its ROLE is not "preserve this place's authored facts" — it is the exact
            # opposite. One override here keeps ONE derivation block and ONE role list.
            return STYLE_ANCHOR_ROLE if n == STYLE_TILE else _kind(n)
        tagged_roles = [_seed_role(vfile(n), _role_of(n), n) for n in tagged_names if n not in omitted]
        interaction_roles = [_seed_role(vfile(n), "interaction")
                             for n in _interaction_primitives(k.reg, cast_recipe, omitted)]
        place_role = _seed_role(place_frame, "parent" if delta_beat else "place") if place_frame else None
        # C-1: the same frame is a `place` seed on a base and a `parent` seed on a delta. Only this
        # walk knows which shot minted the place, so when a delta's parent IS that plate the fact is
        # recorded here — gating it by path where the role label alone would exempt it, and riding
        # on the item so `cmd_gen` can gate it again once the plate has bytes.
        plate_parent = (place_role["path"]
                        if delta_beat and place_role and parent in plate_shots else None)
        plate_parent_gate = {plate_parent: "place plate"} if plate_parent else None
        crowd_role = _seed_role(crowd_ex, "crowd") if crowd else None
        if delta_beat:
            seed_roles = _dedupe_seed_roles([place_role] + canon_roles + prim_roles
                                            + interaction_roles + [crowd_role] + tagged_roles)
        else:
            # The template sits with the figures whose contact it resolves, ahead of the place:
            # ordinal prose reads in seed order, and "both figures, then how they touch" is the
            # order the recipe is actually authored in.
            seed_roles = _dedupe_seed_roles(fig_roles + canon_roles + interaction_roles
                                            + [place_role] + prim_roles
                                            + [crowd_role] + tagged_roles)
        # CAP DISPLACEMENT — an ORDERED, multi-step drop within `SEED_CAP` (boss ruling
        # 2026-08-05, the seed-cap exercise in `fix-G2-report.md`): step through the priority
        # order below and drop one seed at a time UNTIL the slate fits, never all at once and
        # never past what the overage requires. NEVER droppable, at any step: the place
        # plate/chain parent, the derived §5 lettering exemplar and §5 scene style tile (both
        # LOCKED), or any character STEP-1 — dropping one of those to make room is the exact
        # failure this displaces:
        # forge naming a locked seed "did not fit" and a refusal advising fewer cast, a
        # mechanism steering a casting decision. Every drop is recorded in both `why` and
        # `assets_omitted` — the SAME bookkeeping the single-step version already used, just
        # walked more than once.
        displaced = []
        if len(seed_roles) > SEED_CAP and place_role and crowd_role in seed_roles:
            # (1) the crowd exemplar. The pipeline's only anonymous tier, staged as rear-zone
            # mass — mass the place frame already holds in pixels; the exemplar only pins its
            # proportion, which the place plate does not need restated once it is over the cap.
            seed_roles = [role for role in seed_roles if role is not crowd_role]
            displaced.append(_stem(crowd_ex))
            why.append("CAP DISPLACEMENT — crowd exemplar dropped; the place frame carries the "
                       "rear crowd mass")
        if len(seed_roles) > SEED_CAP:
            # (2) the interaction template. Its contact geometry is restated in the shot's own
            # authored prose and lands in pixels a second time via the two named figures' own
            # STEP-1 cards, so the pixel template is reinforcement, not the geometry's only
            # carrier — droppable where the crowd exemplar alone did not clear the cap.
            dropped_template = next((role for role in seed_roles if role in interaction_roles), None)
            if dropped_template:
                seed_roles = [role for role in seed_roles if role is not dropped_template]
                stem = _stem(dropped_template["path"])
                displaced.append(stem)
                why.append(f"CAP DISPLACEMENT — interaction template `{stem}` dropped; its "
                           "geometry survives in role prose and the two figures' STEP-1 cards")
        if len(seed_roles) > SEED_CAP:
            # (3) a tagged PROP exemplar — never an environment reference, which this priority
            # order does not touch. The prompt already names the prop by its own backticked
            # slug; forge's derived prop seed reinforces that naming, it does not solely carry
            # it, so it is the last displaceable tier before the place/lettering/STEP-1 floor.
            dropped_prop = next((role for role in seed_roles
                                 if role in tagged_roles and role["role"] == "prop"), None)
            if dropped_prop:
                seed_roles = [role for role in seed_roles if role is not dropped_prop]
                stem = _stem(dropped_prop["path"])
                displaced.append(stem)
                why.append(f"CAP DISPLACEMENT — tagged prop `{stem}` dropped; the prompt "
                           "already names it, and forge's seed is a reinforcement, not its only "
                           "carrier")
        if in_scope:
            # P3's gate, on the FINAL slate: an asset the cap already displaced never seeds this
            # scene, so refusing on it would send the author to review a frame the slate dropped.
            # C-1: a delta's `parent` is the exempt label, but when that parent frame is the
            # place's own PLATE it is a seeding asset like any other and is gated by path.
            refuse_unreviewed(seed_role_review_refusals(k, seed_roles, name, plate_parent_gate))
        seeds = [role["path"] for role in seed_roles]
        # C-4: the PLATE marker is DERIVED, never authored. A scene carrying no CONTENT seed is
        # the frame that establishes its own place — a place-first shot with no cast, a single-use
        # place, or a shot class the schema exempts from `place`. It is the one zero-seed exception
        # `resolve_request_seeds` honours — derived from the walk, never a flag a request can set.
        # The §5 style tile is excluded from that read BY ROLE: it carries no content, no layout and
        # no place, so a plate that takes it is still the frame that mints its own place. Counting
        # it would silently un-mark every plate in the channel the day the tile was registered.
        plate = not [role for role in seed_roles if role["role"] != STYLE_ANCHOR_ROLE]
        if plate:
            plate_shots.add(name)       # C-1: what a later delta inherits, and must be ruled on
        text = placement_delta(prompt, seed_roles)
        if place_anchor:
            why.append(f"PLACE-ANCHOR = {shot['place_anchor']}")
        elif plate:
            why.append("PLATE — place-first frame, bible descriptor + style suffix, "
                       "no content anchor")
        why_text = "; ".join(why) or "no cast — the scene composes from the place"
        in_batch_parent = (provenance.get(parent)
                           if place_frame and place_frame == emitted.get(parent) else None)
        depth, lineage = _scene_provenance(video, k.root, name, place_frame, in_batch_parent,
                                           refuse_parked=not retry_rebuild)
        item = {"name": name, "mode": "environment", "aspect": aspect, "delta": text,
                "payload": prompt, "prompt_suffix": prompt_suffix or None,
                "seed": seeds, "seed_roles": seed_roles,
                "figures": shot.get("figures"), "stage_role": shot.get("stage_role"),
                "assets_omitted": sorted(set(omitted) | set(displaced)) or None, "plate": plate,
                "delta_primitives": declared_delta_primitives or None,
                "plate_parent": plate_parent,
                "expression_change": expression_change or None,
                "parent_depth": depth, "lineage": lineage,
                "why": why_text}
        if in_scope:
            if staged and not (shot.get("figures") or depicts_figures(text)):
                raise SystemExit(f"{name}: a STEP-1-seeded scene gen with no rig-hold signal — a "
                                 f"figure frame outside /refs/ does not trip the path check.")
            spec.append(item)
            emitted[name] = "_staging/" + name + ".png"
            provenance[name] = {"parent_depth": depth, "lineage": lineage}
            print(f"  {name}: [{', '.join(_stem(s) for s in seeds) or 'ROOT-TEXT'}] ({why_text})",
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
RETRY_OVERLAY_SCHEMA = "faceless-youtube/forge-retry-overlay@2"
_RETRY_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")
_EXPRESSION_RETRY = re.compile(
    r"\b(expr(?:ession)?(?:-[a-z0-9-]+)?|facial|smile|grin|teeth|worried|smug|deadpan|"
    r"caught|pleased|angry|sad|fear)\b",
    re.IGNORECASE)


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


def _scene_manifest_entry(video, seed, root):
    """The scenes-manifest record for this exact video-local frame — the ONE manifest reader."""
    path = os.path.realpath(os.path.join(root, seed))
    rel = os.path.relpath(path, video).replace("\\", "/")
    manifest_path = os.path.join(video, "assets", "scenes", "manifest.json")
    try:
        manifest = json.load(open(manifest_path, encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    for scene in manifest.get("shots", []) if isinstance(manifest, dict) else []:
        if (isinstance(scene, dict) and str(scene.get("file", "")).replace("\\", "/") == rel):
            return scene
    return None


def _scene_review_status(video, seed, root):
    """Return the manifest review status for this exact video-local scene frame."""
    return (_scene_manifest_entry(video, seed, root) or {}).get("review_status")


def _hops(value):
    """A provenance counter read back from a manifest: a non-negative int, or 0 when unrecorded."""
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _scene_provenance(video, root, name, place_frame, in_batch_parent, refuse_parked=True):
    """`(parent_depth, lineage)` for one emitted scene — C-11's provenance ledger.

    `parent_depth` counts image-parent hops back to the frame that started the chain. `lineage`
    counts hops back to the nearest APPROVED frame: it resets to 1 under a `verified` parent and
    keeps climbing while a chain runs on pixels no human has ruled on, so a drifting chain is
    visible in the manifest instead of being re-derived by eye.
    A parent carrying a PARKED defect is refused here — parked is non-shippable, and a child
    inherits the defect in its strongest seed. `refuse_parked=False` is the ONE exemption: a retry
    overlay's whole purpose can be to swap a defective parent out, and the retry path runs its own
    verified-parent check over the FINAL seeds, so refusing during its canonical rebuild would fire
    two laws for one condition and hide the one that actually applies."""
    if not place_frame:
        return 0, 0
    if in_batch_parent is not None:      # the parent is generated EARLIER in this same batch
        return in_batch_parent["parent_depth"] + 1, in_batch_parent["lineage"] + 1
    entry = _scene_manifest_entry(video, place_frame, root) or {}
    if refuse_parked and entry.get("review_status") == "parked":
        raise SystemExit(f"{name}: its place frame {place_frame} is PARKED — a parked defect is "
                         "non-shippable and may not be inherited. Re-base this shot on an approved "
                         "frame, or repair and re-review the parent first.")
    if entry.get("review_status") == "verified":
        return _hops(entry.get("parent_depth")) + 1, 1
    return _hops(entry.get("parent_depth")) + 1, _hops(entry.get("lineage")) + 1


def _repaired_parent_matches(k, video, seed, parent_seeds):
    """Name-bound repaired frames may replace only the canonical parent they identify."""
    path = os.path.realpath(os.path.join(k.root, seed))
    scenes = os.path.join(video, "assets", "scenes")
    video_staging = os.path.join(video, "_staging")
    if not (_inside_real(path, scenes) or _inside_real(path, k.staging)
            or _inside_real(path, video_staging)):
        return []
    stem = os.path.splitext(os.path.basename(path))[0]
    return [parent for parent in parent_seeds if _derived_from(stem, _stem(parent))]


def _retry_scene(item, source, entry, k, video, label):
    allowed = {"kind", "shot", "name", "defect", "instruction", "prepend_seeds",
               "extra_seeds", "replace"}
    unknown = set(entry) - allowed
    if unknown:
        raise SystemExit(f"{label}: scene retry has unknown key(s) {sorted(unknown)!r}.")
    defect = entry.get("defect")
    if defect == "expression":
        raise SystemExit(f"{label}: expression defects route to a `step1` (STEP-1) re-mint; a scene "
                         "retry may not contradict an expression seed with prose.")
    if defect not in ("content", "seed", "mechanism"):
        raise SystemExit(f"{label}: scene retry `defect` must be `content`, `seed`, or `mechanism`; "
                         "expression defects route to a `step1` (STEP-1) re-mint.")
    instruction = entry.get("instruction")
    if instruction is not None:
        if isinstance(instruction, str) and _EXPRESSION_RETRY.search(instruction):
            raise SystemExit(f"{label}: expression defects route to a `step1` (STEP-1) re-mint; a scene "
                             "retry may not contradict an expression seed with prose.")
        raise SystemExit(f"{label}: scene retry forbids additive `instruction`; use one exact "
                         "`replace` or a seed/mechanism replacement with no content append.")
    payload = item.get("payload", item["delta"])
    text = payload
    replacement = entry.get("replace")
    if replacement is not None:
        if defect != "content":
            raise SystemExit(f"{label}: exact `replace` authority requires `defect: content`.")
        if not isinstance(replacement, dict) or set(replacement) != {"from", "to"}:
            raise SystemExit(f"{label}: `replace` must contain only non-empty `from` and `to` strings.")
        old, new = replacement.get("from"), replacement.get("to")
        if (isinstance(old, str) and isinstance(new, str)
                and _EXPRESSION_RETRY.search(old + " " + new)):
            raise SystemExit(f"{label}: expression defects route to a `step1` (STEP-1) re-mint; "
                             "scene content replacement may not change an expression register.")
        if (not isinstance(old, str) or not old or not isinstance(new, str) or not new
                or old == new or text.count(old) != 1):
            raise SystemExit(f"{label}: replacement source must occur exactly once in the canonical scene delta.")
        start = text.index(old)
        replaced_text = text[:start] + new + text[start + len(old):]
        if (replaced_text[:start] != text[:start]
                or replaced_text[start + len(new):] != text[start + len(old):]):
            raise SystemExit(f"{label}: replacement changed bytes outside its one causal span.")
        text = replaced_text
    prepend, extra = entry.get("prepend_seeds", []), entry.get("extra_seeds", [])
    if not isinstance(prepend, list) or not isinstance(extra, list):
        raise SystemExit(f"{label}: `prepend_seeds` and `extra_seeds` must be lists when present.")
    has_seed_change = bool(prepend or extra)
    if bool(replacement) == has_seed_change:
        raise SystemExit(f"{label}: scene retry needs exactly one surgical authority: one exact "
                         "`replace`, or a seed/mechanism replacement with no content change.")
    if has_seed_change and defect not in ("seed", "mechanism"):
        raise SystemExit(f"{label}: seed/mechanism authority requires `defect: seed` or `mechanism`.")
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
    reordered = {path for path, _ in added_first + added_last if path in native}
    # I-1: a retry-added seed states WHAT IT IS. The old fallback stamped `reference` on every one
    # of them, which was untruthful role prose (the B4 root cause `seed_roles` exists to remove)
    # and — while `reference` was gate-exempt — a way for a kit plate, prop, environment or
    # primitive to seed a scene with no review record. The registry already knows each asset's
    # kind, so the role is read from there — THROUGH `seed_role_for_kind`, because a kind is not
    # automatically a legal role: handing the raw kind over made an added `action-*` or the crowd
    # exemplar schema-illegal, and the batch then died naming neither the asset nor the reason.
    kind_by_stem = {_stem(a.get("file") or ""): a.get("kind")
                    for a in (getattr(k, "reg", None) or {}).get("assets", []) if a.get("file")}

    def _seed_kind(path):
        if _is_scene_seed(path):
            return "parent"
        return seed_role_for_kind(kind_by_stem.get(_stem(path)), _stem(path), label)

    native_roles = item.get("seed_roles") or [_seed_role(path, _seed_kind(path)) for path in native]
    native_role_by_path = {role["path"]: role for role in native_roles}

    def added_role(path):
        if path in native_role_by_path:
            return dict(native_role_by_path[path])
        matches = repaired.get(path) or []
        if matches:
            inherited = native_role_by_path.get(matches[0], _seed_role(matches[0], "parent"))
            return dict(inherited, path=path)
        return _seed_role(path, _seed_kind(path))

    seed_roles = _dedupe_seed_roles(
        [added_role(path) for path, _ in added_first]
        + [role for role in native_roles if role["path"] not in replaced]
        + [added_role(path) for path, _ in added_last])
    seeds = [role["path"] for role in seed_roles]
    actual_reorder = reordered if seeds != native else set()
    for seed in (s for s in seeds if _is_scene_seed(s)):
        checked = _video_scene_frame(video, os.path.join(k.root, seed), k.root, label,
                                     "retry scene seed")
        if checked == place_anchor or seed in repaired:
            continue
        status = _scene_review_status(video, checked, k.root)
        if status != "verified":
            raise SystemExit(f"{label}: fresh retry may not seed an old video scene output unless "
                             "its manifest `review_status` is `verified`.")
    if has_seed_change and not (replaced or actual_reorder):
        raise SystemExit(f"{label}: seed/mechanism retry must replace a named in-chain parent or "
                         "change the order of existing provider seeds; additions and no-ops are additive.")
    digest_by_path = {}
    for path, digest in added_first + added_last:
        if digest and path in digest_by_path and digest_by_path[path] != digest:
            raise SystemExit(f"{label}: the same retry seed carries conflicting SHA-256 digests.")
        if digest:
            digest_by_path[path] = digest
    authority = ({"kind": "replace", "changed_spans": 1,
                  "from": replacement["from"], "to": replacement["to"]}
                 if replacement else
                 {"kind": "seed/mechanism", "changed_spans": 1,
                  "replaced": sorted(replaced), "reordered": sorted(actual_reorder)})
    out = dict(item, name=entry["name"], seed=seeds, seed_roles=seed_roles,
               payload=text, delta=placement_delta(text, seed_roles),
               retry_authority=authority, plate=not seeds,   # a re-seeded retry is not a place mint
               why=item.get("why", "") + f"; RETRY overlay from `{entry['shot']}`")
    if digest_by_path:
        out["seed_sha256"] = digest_by_path
    return out


def _retry_step1(entry, source, k, label):
    allowed = {"kind", "shot", "character", "name", "defect", "instruction"}
    unknown = set(entry) - allowed
    if unknown:
        raise SystemExit(f"{label}: STEP-1 retry has unknown key(s) {sorted(unknown)!r}.")
    if entry.get("defect") not in ("expression", "rig"):
        raise SystemExit(f"{label}: STEP-1 retry `defect` must be `expression` or `rig`.")
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
    seed_roles = _dedupe_seed_roles(
        [_seed_role(vfile(character), "canonical", character)]
        + ([_seed_role(vfile(expr), "expression", character)] if expr else [])
        + ([_seed_role(vfile(pose), "pose", character)] if pose else []))
    seeds = [role["path"] for role in seed_roles]
    instruction = entry.get("instruction")
    if instruction is not None and (not isinstance(instruction, str) or not instruction.strip()):
        raise SystemExit(f"{label}: STEP-1 `instruction` must be a non-empty string when present.")
    payload = figure_card_payload(pose)
    if instruction:
        payload += "\n\n" + instruction.strip()
    delta = placement_delta(payload, seed_roles)
    return {"name": entry["name"], "mode": "environment", "aspect": "2:3", "image_size": "1K",
            "stage_role": "base", "seed": seeds, "seed_roles": seed_roles,
            "payload": payload, "delta": delta,
            "retry_authority": {"kind": "step1-remint", "changed_spans": 1,
                                "defect": entry["defect"], "character": character},
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
            native = cmd_batch(k, shots_path, os.path.join(td, "native.json"), video, scene_ids,
                               retry_rebuild=True)
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

PROVENANCE_COUNTERS = ("parent_depth", "lineage")     # C-11, derived by `batch`, copied by `manifest`


def batch_provenance(spec_path):
    """`{shot id: {parent_depth, lineage}}` read back from a `batch` spec — C-11's ledger at the one
    point it is already derived. `batch` computes both counters per emitted item and writes them
    onto the spec; without this, nothing ever copied them onto the scenes manifest, so
    `_scene_provenance` read 0 hops on every run and `lineage` could never climb past 1. Derived
    ONCE by the walk that knows the chain, never re-derived by hand downstream."""
    try:
        spec = json.load(open(spec_path, encoding="utf-8"))
    except (OSError, ValueError):
        raise SystemExit(f"manifest --from-batch: {spec_path} is not a readable `batch` spec.")
    out = {}
    for item in spec if isinstance(spec, list) else []:
        if isinstance(item, dict) and item.get("name") and any(c in item for c in PROVENANCE_COUNTERS):
            out[item["name"]] = {c: _hops(item.get(c)) for c in PROVENANCE_COUNTERS}
    return out


def cmd_manifest(k, kind, spec_path, out, to_dir, slug, notes, from_batch=None):
    """Q7: emit the manifest render-builder depends on from a small spec, instead of free-typing it
    (a drifted/forgotten manifest key silently degrades render). --kind scenes -> shots[]; library ->
    assets[]. Spec is a JSON list of entries OR an object already carrying that array; this wraps it
    in the {video_slug, generated, notes, <shots|assets>} envelope and validates the required keys.

    A scenes entry additionally carries C-11's provenance — `parent_depth` (image-parent hops) and
    `lineage` (hops since the last APPROVED frame). `--from-batch <spec.json>` INHERITS both from the
    `batch` spec this run generated from, matching `name` to `shot_id`: they are derived once by the
    walk that knows the chain and copied here, never re-derived by eye. An entry stating its own
    counters keeps them. They stay optional so a manifest written before this wave still emits, but a
    present counter must be a real one: a mistyped provenance field would make a drifting chain read
    as a grounded one."""
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
    if from_batch and kind != "scenes":
        raise SystemExit("manifest --from-batch carries C-11 provenance, which only scenes entries hold.")
    derived = batch_provenance(from_batch) if from_batch else {}
    for i, e in enumerate(entries):
        miss = [f for f in req if not e.get(f)]
        if miss:
            raise SystemExit(f"{kind} entry #{i} missing required key(s): {', '.join(miss)}")
        for counter in PROVENANCE_COUNTERS if kind == "scenes" else ():
            if counter not in e and e["shot_id"] in derived:
                e[counter] = derived[e["shot_id"]][counter]
            if counter in e and e[counter] != _hops(e[counter]):
                raise SystemExit(f"scenes entry #{i} `{counter}` must be a non-negative integer "
                                 "count of hops, as `batch` derived it.")
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
    ap.add_argument("--retry", help="batch: a versioned forge-retry-overlay@2 manifest; derives only "
                                    "the named retry requests from the canonical shots.json")
    ap.add_argument("--name"); ap.add_argument("--character", default="base")
    ap.add_argument("--mode", default="identity"); ap.add_argument("--delta")
    ap.add_argument("--aspect", default="2:3"); ap.add_argument("--seed", help="comma-separated seed frames")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--image-size", default=IMAGE_SIZE_DEFAULT, choices=list(IMAGE_SIZES),
                    help=f"gen: engine resolution tier (default {IMAGE_SIZE_DEFAULT}; 4K is the top "
                         f"tier at ~6x the 1K price, so it is a per-run spend call)")
    ap.add_argument("--dry-run", action="store_true",
                    help="gen: assemble and PRINT every prompt, make NO API call (batch pre-flight)")
    ap.add_argument("--figures", help="gen: one shot's `figures` field as JSON, e.g. "
                                     "'{\"anon_foreground\": [\"the clerk\"], \"crowd\": true}'")
    ap.add_argument("--stage-role", choices=["base", "delta"],
                    help="gen: the shot's stage_role — `delta` makes the seeding law judge the "
                         "request as an in-chain beat (canonical + parent, expression changes seeded)")
    ap.add_argument("--shots", action="append",
                    help="batch: OPT-IN repair scope — comma-separated shot ids (repeatable). Emits "
                         "and blocks on ONLY these shots; violations elsewhere are reported as a "
                         "count. Omit for a FULL run, which stays the default.")
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
    ap.add_argument("--from-batch", dest="from_batch",
                    help="manifest --kind scenes: the `batch` spec this run generated from; each "
                         "entry inherits C-11's `parent_depth`/`lineage` from the matching item "
                         "(spec `name` == entry `shot_id`) unless it states its own")
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
            seed_paths = a.seed.split(",") if a.seed else None
            seed_roles = ([_seed_role(path, "reference") for path in seed_paths]
                          if seed_paths and a.mode in ("environment", "style") else None)
            payload = a.delta or ""
            reqs = [{"name": a.name, "character": a.character, "mode": a.mode,
                     "payload": payload if seed_roles is not None else None,
                     "delta": placement_delta(payload, seed_roles) if seed_roles is not None else a.delta,
                     "aspect": a.aspect, "seed": seed_paths, "seed_roles": seed_roles,
                     "figures": json.loads(a.figures) if a.figures else None,
                     "stage_role": a.stage_role}]
        vid = a.video or video_dir_of(reqs, k.root)
        if vid and os.path.isdir(vid):
            k.use_video(vid)
        # P3's gate applies to builder-produced slates (`--batch`). The ad-hoc `--seed` form above
        # IS the cast-generation wave / single-asset loop, exempt by the G2 ruling — exempted here,
        # at its one call site, rather than by exempting a seed role every other producer can wear.
        cmd_gen(k, reqs, a.force, a.image_size, dry, gate=bool(a.batch))
    elif a.cmd == "batch":
        if not a.batch or not a.out:
            raise SystemExit("batch needs --batch <videos/slug/shots.json> and --out <spec.json>")
        out = a.out if os.path.isabs(a.out) else os.path.join(k.root, a.out)
        if a.retry:
            if a.shots:
                raise SystemExit("batch --retry derives its scope from the overlay; do not also pass --shots.")
            cmd_retry_batch(k, a.batch, out, a.retry, a.video)
        else:
            ids = [i.strip() for chunk in (a.shots or []) for i in chunk.split(",") if i.strip()]
            cmd_batch(k, a.batch, out, a.video, ids or None)
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
        cmd_manifest(k, a.kind, a.batch, a.out, a.to, a.slug, a.notes, a.from_batch)
    elif a.cmd == "cutout":
        if not a.in_path or not a.out:
            raise SystemExit("cutout needs --in <image> and --out <png>")
        cmd_cutout(a.in_path, a.out, a.lo, a.hi, a.allow_wide)

if __name__ == "__main__":
    main()
