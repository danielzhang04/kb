#!/usr/bin/env python3
import json, os, re, ssl, sys, base64, hashlib, urllib.request, urllib.error, time, argparse, shutil, tempfile

ENV_MARKER = ".env"

def load_env(root):
    env = {}
    p = os.path.join(root, ENV_MARKER)
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
    pass

def b64(p): return base64.b64encode(open(p, "rb").read()).decode()
def ip(p, expected_sha256=None):
    data = open(p, "rb").read()
    if expected_sha256 and hashlib.sha256(data).hexdigest() != expected_sha256:
        raise SeedIntegrityError(f"seed SHA-256 changed before request assembly: {p}")
    return {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(data).decode()}}

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"

def to_png_bytes(data):
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
    n = len(data) if data else 0
    if n <= 1024:
        raise RuntimeError(f"image too small ({n} bytes) — refusing to write")
    if not data.startswith(PNG_MAGIC):
        raise RuntimeError("bytes are not a valid PNG (bad magic) — refusing to write")

def blockquote_after(md, header):
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
    rp = str(path).replace("\\", "/")
    if "/refs/env/" in rp:
        return False
    if os.path.basename(rp).startswith("prop-"):
        return False
    return ("/refs/" in rp) or ("/assets/library/" in rp) or ("/assets/scenes/" in rp)

_FIGUREWORDS = (
    "figure", "figures", "person", "people", "someone", "somebody", "crowd", "crowds",
    "audience", "man", "men", "woman", "women", "customer", "customers", "teller", "tellers",
    "employee", "employees", "worker", "workers", "staff", "clerk", "clerks", "banker",
    "bankers", "executive", "executives", "investor", "investors", "senator", "senators",
    "judge", "official", "officials", "cast", "character", "characters",
    "hand", "hands", "face", "faces", "head", "heads",
)

_FIGURE_FALSE_FRIENDS = (
    "hand-lettered", "hand lettered", "hand-drawn", "hand drawn", "hand-illustrated",
    "hand-stamped", "hand stamped", "handwriting", "handwritten", "freehand", "marker hand",
    "lettering hand", "second hand", "hand-painted", "hand painted", "on the other hand",
    "letterhead", "masthead", "headline", "heading", "header", "headed",
    "face of", "face value", "typeface", "coalface",
)

_FIGURE_RE = re.compile(r"\b(?:%s)\b" % "|".join(sorted(_FIGUREWORDS, key=len, reverse=True)))

def depicts_figures(prompt):
    p = (prompt or "").lower()
    for idiom in _FIGURE_FALSE_FRIENDS:
        p = p.replace(idiom, " ")
    return bool(_FIGURE_RE.search(p))

def should_hold(mode, resolved_seeds, delta="", figures=None):
    if mode not in ("new_character", "environment", "style"):
        return False
    if figures:
        return True
    if depicts_figures(delta):
        return True
    return any(_is_char_seed(s) for s in resolved_seeds)

_FIG_KEYS = ("crowd",)

def _fig_declared(figures):
    if not figures:
        return False
    if not isinstance(figures, dict):
        raise SystemExit('`figures` must be an object like {"crowd": true}')
    unknown = sorted(k for k in figures if k not in _FIG_KEYS)
    if unknown:
        raise SystemExit(f"`figures` has unknown key(s): {', '.join(unknown)} "
                         f"(allowed: {', '.join(_FIG_KEYS)})")
    crowd = figures.get("crowd", False)
    if not isinstance(crowd, bool):
        raise SystemExit("`figures.crowd` must be true or false")
    return crowd

def figures_expansion(figures, crowd_rig):
    return crowd_rig if _fig_declared(figures) and crowd_rig else ""

def assemble_prompt(descriptor, payload, figures_text="", righold="", generated_policy=""):
    return "\n\n".join(p for p in (descriptor, figures_text, righold, generated_policy, payload) if p)

class Kit:
    def __init__(self, kit, dry=False):
        self.kit = os.path.abspath(kit)
        d = self.kit
        while d and not os.path.exists(os.path.join(d, ENV_MARKER)):
            nd = os.path.dirname(d)
            if nd == d: break
            d = nd
        self._root = d
        self._root_walk_failed = not os.path.exists(os.path.join(d, ENV_MARKER))
        self.bible = os.path.join(self.kit, "style-bible.md")
        self.reg_path = os.path.join(self.kit, "registry", "registry.json")
        self.refs = os.path.join(self.kit, "refs")
        self.staging = os.path.join(self.kit, "_staging")
        if not os.path.isfile(self.bible) or not os.path.isfile(self.reg_path):
            raise SystemExit(f"missing visual kit: expected style-bible.md and registry/registry.json under {self.kit}")
        md = open(self.bible, encoding="utf-8").read()
        self.desc_identity = blockquote_after(md, "LOCKED STYLE descriptor")
        self.desc_style = blockquote_after(md, "STYLE-ONLY descriptor")
        self.desc_righold = blockquote_after(md, "RIG-HOLD descriptor")
        self.desc_crowdrig = blockquote_after(md, "CROWD-RIG clause")   # §2d, expanded from `figures`
        self.reg = json.load(open(self.reg_path, encoding="utf-8"))
        self.model = self.reg.get("engine", "gemini-3-pro-image")
        self.dry = dry
        if dry:
            self.key, self.url, self.ctx = "", None, None
        else:
            self.key = load_env(self.root)["GEMINI_API_KEY"]
            self.url = self.url_for()
            self.ctx = ctx()

    @property
    def root(self):
        if self._root_walk_failed:
            raise SystemExit(
                f"no repo root found above the kit: the walk searched for `{ENV_MARKER}` in every "
                f"directory from {self.kit} up to {self._root} and found none, so `root` would be "
                f"the filesystem root and every repo-relative path (seeds, refs, review store) "
                f"would resolve under it. Run from a checkout that carries `{ENV_MARKER}`, or set "
                f"`kit.root` explicitly.")
        return self._root

    @root.setter
    def root(self, value):
        self._root, self._root_walk_failed = value, False

    def use_video(self, video_dir):
        self.video = os.path.abspath(video_dir)
        self.reg = merge_vocabulary(self.reg, self.video)

    def url_for(self):
        return f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.key}"

    def base_frame(self, character):
        c = self.reg.get("characters", {}).get(character)
        if not c:
            raise SystemExit(f"unknown character '{character}' — add it to registry first")
        return os.path.join(self.root, c["base"])

    def resolve_seed(self, s):
        if os.path.isabs(s) and os.path.exists(s): return s
        for cand in (os.path.join(self.root, s),          # repo-relative
                     os.path.join(self.kit, s),           # kit-relative (e.g. refs/base/base.png)
                     os.path.join(self.refs, s if s.endswith(".png") else s + ".png")):  # refs-relative (base/base)
            if os.path.exists(cand): return cand
        raise SystemExit(f"seed frame not found: {s}")

    def prompt_for(self, mode, delta, hold=False, figures=None, generated_policy=""):
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
            generated_policy)

SEED_CAP = 4                    # the Pass-2 seed law: past four, dilution weakens every prior
FIGURE_PREFIX = "fig-"          # STEP 1's output: one portable frame per
BASE_TEMPLATE = "base"
_PRIMITIVE_KINDS = ("pose", "action", "interaction", "expression")
_BACKTICK_RE = re.compile(r"`([A-Za-z0-9][A-Za-z0-9._-]*)`")

LETTERING_EXEMPLAR = "lettering-marker-italic"

STYLE_TILE = "scene-style-tile"
STYLE_ANCHOR_ROLE = "style-anchor"

_QUOTED_LITERAL = re.compile("(?<![A-Za-z])['\"‘“][^'\"‘’“”]{1,60}"
                             "['\"’”]")

def text_bearing(prompt):
    return bool(_QUOTED_LITERAL.search(prompt or ""))

def merge_vocabulary(reg, video_dir):
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
    out = []
    for m in _BACKTICK_RE.finditer(text or ""):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out

def unresolved_closed_world(reg, text):
    known = {a.get("name") for a in reg.get("assets", []) if isinstance(a, dict)}
    prefixes = ("pose-", "expr-", "action-", "interaction-", "costume-")
    return [token for token in backticked(text)
            if token.startswith(prefixes) and token not in known]

def shot_cast(reg, text):
    chars = reg.get("characters", {})
    assets = {a["name"]: a for a in reg.get("assets", [])}
    cast = []
    for n in backticked(text):
        if n in chars and n != BASE_TEMPLATE:
            cast.append((n, []))
        elif cast and assets.get(n, {}).get("kind") in _PRIMITIVE_KINDS:
            cast[-1][1].append(n)
    return cast

def beat_clause(prompt, character):
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
    out = _MICRO_PATTERN_RE.sub("", text or "")
    out = re.sub(r"\s+([,.;:])", r"\1", out)      # a removed adjective strands its space
    return re.sub(r"\s{2,}", " ", out).strip()

def figure_frame_name(character, pose=None, expression=None, clause=""):
    key = FIGURE_PREFIX + "--".join(p for p in (character, pose, expression) if p)
    return key + ("--" + hashlib.sha256(clause.encode("utf-8")).hexdigest()[:8] if clause else "")

def _split_primitives(reg, prims, omitted=()):
    assets = {a["name"]: a for a in reg.get("assets", [])}
    kind = lambda p: assets.get(p, {}).get("kind")
    live = [p for p in prims if p not in omitted]
    return (next((p for p in live if kind(p) in ("pose", "action")), None),
            next((p for p in live if kind(p) == "expression"), None))

def _interaction_primitives(reg, cast, omitted=()):
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

KIND_TO_SEED_ROLE = {
    "pose": "pose", "action": "pose",       # `_split_primitives` routes both as this figure's pose
    "expression": "expression",
    "interaction": "interaction",
    "prop": "prop",
    "environment": "environment",
    "crowd-anchor": "crowd",                # the exemplar `cmd_batch` seeds as role `crowd`
}
CHARACTER_BOUND_KINDS = ("identity", "base")

def seed_role_for_kind(kind, name, label):
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
    roles = r.get("seed_roles")
    if roles is None:
        if (r.get("mode", "identity") in ("environment", "style")
                and (r.get("seed") or [])):
            return [f"{r.get('name', '<unnamed>')}: seeded composite requests require ordered "
                    "`seed_roles`; hand-written specs may not bypass provider-part role truth."]
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
            truthful = character is None and asset_kinds.get(_stem(path)) == "interaction"
        elif role == STYLE_ANCHOR_ROLE:
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
    mode = r.get("mode", "identity")
    if mode not in ("environment", "style"):
        return []              # identity/new_character gens BUILD the seeds; they cannot seed off themselves
    name, delta = r["name"], r.get("payload", r.get("delta") or "")
    bad = []
    omitted = r.get("assets_omitted") or ()      # the slate's DELIBERATE exclusions, carried through
    crowd = _fig_declared(r.get("figures"))
    if (crowd and not any(_stem(s).startswith("crowd-exemplar") for s in seeds)
            and not any(str(o).startswith("crowd-exemplar") for o in omitted)):
        bad.append(f"{name}: `figures.crowd` is declared but the slate carries no crowd exemplar "
                   f"(this video's `assets/library/crowd-exemplar.png`, else the channel's "
                   f"refs/base/crowd-exemplar.png) — the crowd's only seed.")
    if len(seeds) > SEED_CAP:
        roles_list = r.get("seed_roles") if isinstance(r.get("seed_roles"), list) else None
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
            expected = figure_frame_name(c, *_split_primitives(k.reg, prims),
                                         beat_clause(delta, c))
            bad.append(f"{name}: `{c}` is staged FRESH with no STEP-1 figure frame in the slate — "
                       f"expected {expected}. Build the slate with `forge.py batch`.")
            continue
        for p in (p for p in _split_primitives(k.reg, prims) if p):
            if p not in _stem(held[0]):
                bad.append(f"{name}: `{c}` names `{p}` but its STEP-1 frame is {_stem(held[0])} — "
                           f"the slate carries a different pose/expression than the shot authored.")
    return bad

def resolve_request_seeds(k, r, pending=()):
    name, mode = r["name"], r.get("mode", "identity")
    seeds = r.get("seed")
    if not seeds:
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
        if gate:
            held = seed_role_review_refusals(k, r.get("seed_roles") or [], name,
                                             plate_seed_overrides(reqs))
            if held:
                report(name, "skip (seed awaits review) — " + "; ".join(
                    line.split("\n")[0] for line in held))
                continue
        figures = r.get("figures")
        hold = should_hold(mode, seeds, r["delta"], figures)
        text = k.prompt_for(mode, r["delta"], hold=hold, figures=figures,
                            generated_policy="")
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
    held = sum(1 for _, s in results if s.startswith("skip (seed awaits review)"))
    skipped = len(results) - ok - err - held
    print(f"  == {ok} generated, {err} failed, {skipped} skipped, {held} held for review ==",
          flush=True)

_ORDINALS = ("FIRST", "SECOND", "THIRD", "FOURTH")

def _seed_role(path, role, character=None):
    return {"path": path, "role": role, "character": character}

def _dedupe_seed_roles(entries):
    out, seen = [], set()
    for entry in entries:
        if not entry or not entry.get("path") or entry["path"] in seen:
            continue
        out.append(entry); seen.add(entry["path"])
    return out

def seed_roles_text(seed_roles):
    lines = []
    has_parent = any((e or {}).get("role") == "parent" for e in seed_roles or [])
    for index, entry in enumerate(seed_roles or []):
        ordinal = _ORDINALS[index] if index < len(_ORDINALS) else f"IMAGE {index + 1}"
        role = entry["role"]
        path = entry["path"]
        character = entry.get("character") or _stem(path)
        if role == "place":
            detail = "the destination place — preserve its set, palette, outline weight and lighting"
        elif role == "figure":
            detail = (f"`{character}`'s complete STEP-1 figure — carry that figure's identity, "
                      "costume, pose, hands and expression exactly, and take nothing else from "
                      "the card: its blank ground is not this frame's set")
        elif role == "canonical":
            detail = (f"`{character}`'s character canonical — identity, head tone, hair, the "
                      "pinned costume unless this beat authors a change")
            detail += (". Never the pose, and never the face: the parent image owns it outright"
                       if has_parent else
                       ", and the face's RENDER REGISTER: how eyes, brows and mouth are DRAWN, "
                       "never which shape they take where another seed carries it. Never the pose")
        elif role == "parent":
            detail = ("the in-chain parent scene — preserve its held set and existing "
                      "composition, and take each held figure's STANCE and EXPRESSION "
                      "(eye/brow/mouth) from its pixels — shape and register both — unless this "
                      "request also seeds a pose or expression reference for that figure; a held "
                      "face is inherited here, never re-invented and never re-read off the "
                      "canonical")
        elif role == "pose":
            detail = (f"the `{_stem(path)}` pose reference for `{character}` — copy only body pose, "
                      "hands and limb placement; ignore identity and costume")
        elif role == "expression":
            detail = (f"the `{_stem(path)}` expression reference for `{character}` — copy only "
                      "eye/brow/mouth shape; ignore identity, head tone and hairline; this shape "
                      f"replaces the expression `{character}` holds in the parent scene, and no "
                      "other figure's")
        elif role == "crowd":
            detail = ("the crowd exemplar — use its anonymous crowd proportion, face tier and the "
                      "bounded 2-3 flat head-tone set it repeats; take nothing of its dress, "
                      "period or setting, which each scene authors for itself")
        elif role == "interaction":
            detail = (f"the `{_stem(path)}` interaction template — two blank mannequins holding "
                      "the contact geometry for BOTH figures; copy only the clasp/limb geometry, "
                      "relative placement and eye-line, and give it to neither figure's identity, "
                      "costume or expression")
        elif role == "prop":
            detail = f"the `{character}` prop canonical — preserve that object's design"
        elif role == STYLE_ANCHOR_ROLE:
            detail = ("the channel's SCENE STYLE TILE — a register sample ONLY. It pins LINE "
                      "WEIGHT, the outline colour (#241a12), the FLAT-CEL RENDER, and PALETTE "
                      "SATURATION — match how strongly its flat fills are coloured while using THIS "
                      "frame's authored locked hues and temperature; a frame drained "
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
    return "\n\n".join(p for p in (seed_roles_text(seed_roles), prompt) if p)

def figure_card_payload(pose=None, clause=""):
    stance = ("standing or seated exactly as the pose reference shows" if pose
              else "standing squarely at rest, arms relaxed at the sides, facing the viewer")
    clause = strip_micro_pattern_texture(clause)
    act = ("; and, of the bodily ACT it gives this figure, take ONLY the GESTURE it implies — draw "
           "the figure performing that gesture empty-handed, WITHIN the stance the pose reference "
           "holds; the object, person, prop or setting its sentence names belongs to the scene, "
           "not to this reference card" if pose else
           ", and nothing else from it: with no pose reference seeded, its action is not this "
           "card's to draw")
    derived = (f"The scene this card is minted for reads: {clause} Where that description AUTHORS "
               "clothing — garments, headwear, footwear — dress the figure in it for that era, "
               "work and setting; where it authors none, the costume the canonical seed pins "
               f"governs unchanged, and never the rig template's default hoodie{act}. Draw none "
               "of its setting, props, lettering or other people. " if clause else "")
    return (f"The whole figure is in frame head to feet, {stance}, with one soft contact shadow "
            f"directly beneath it. {derived}Flat solid pale-grey studio backdrop, no scenery, no "
            "props, no furniture. "
            "This is a reference sheet: the character alone, fully resolved, ready to be placed "
            "into a separate scene.")

def _shot_iter(doc):
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
    scenes = os.path.realpath(os.path.join(video, "assets", "scenes"))
    path = os.path.realpath(candidate)
    if not _inside_real(path, scenes):
        raise SystemExit(f"{name}: {field} must stay inside this video's assets/scenes/, "
                         "never a cross-video environment reference.")
    if not os.path.isfile(path):
        raise SystemExit(f"{name}: {field} frame not found: {os.path.relpath(path, video)}")
    return os.path.relpath(path, root).replace("\\", "/")

def place_anchor_for(video, anchor, root, name):
    if anchor is None:
        return None
    if not isinstance(anchor, str) or not anchor.strip() or os.path.isabs(anchor):
        raise SystemExit(f"{name}: `place_anchor` must be a non-empty video-relative "
                         "`assets/scenes/<approved-frame>.png` path.")
    return _video_scene_frame(video, os.path.join(video, anchor), root, name, "`place_anchor`")

ASSET_REVIEW = "review.json"       # C-6/P3: the per-ASSET review store, one file inside <kit>/_staging

def store_key(path, kit):
    return os.path.relpath(os.path.realpath(path), os.path.realpath(kit)).replace("\\", "/")

def _candidate_frames(staging_dir, kit):
    return [os.path.join(base, fn)
            for r in (staging_dir, os.path.join(kit, "refs")) if r
            for base, _dirs, files in os.walk(r)
            for fn in files if fn.lower().endswith(".png")]

def _is_current_key(key, kit):
    return not os.path.isabs(key) and os.path.isfile(os.path.join(kit, key))

def migrate_review_store(figures, staging_dir, kit):
    if not isinstance(figures, dict) or not kit:
        return figures if isinstance(figures, dict) else {}
    if all(_is_current_key(key, kit) for key in figures):
        return figures
    by_digest = {}
    for path in _candidate_frames(staging_dir, kit):
        by_digest.setdefault(frame_digest(path), path)
    out = {}
    for key, record in figures.items():
        match = by_digest.get(record.get("canonical_sha256")) if isinstance(record, dict) else None
        out[store_key(match, kit) if match else key] = record
    return out

def review_store(staging_dir, kit=None):
    try:
        doc = json.load(open(os.path.join(staging_dir or "", ASSET_REVIEW), encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    figures = (doc.get("figures") if isinstance(doc, dict) else None) or {}
    return migrate_review_store(figures, staging_dir, kit)

def figure_review_record(staging_dir, frame, kit=None):
    if not kit:
        return None
    store, digest = review_store(staging_dir, kit), frame_digest(frame)
    keyed = store.get(store_key(frame, kit))
    applicable = ([keyed] if isinstance(keyed, dict) else []) + [
        r for r in store.values() if isinstance(r, dict) and r is not keyed
        and digest and r.get("canonical_sha256") == digest]
    return next((r for r in applicable if record_blocker(r, frame, "")),
                applicable[0] if applicable else None)

_DIGEST_CACHE = {}

def frame_digest(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (os.path.abspath(path), st.st_size, st.st_mtime_ns)
    if key not in _DIGEST_CACHE:
        with open(path, "rb") as f:
            _DIGEST_CACHE[key] = hashlib.sha256(f.read()).hexdigest()
    return _DIGEST_CACHE[key]

def figure_reuse_blocker(staging_dir, frame, store_label=None, kit=None):
    store = store_label or os.path.join(staging_dir, ASSET_REVIEW).replace("\\", "/")
    return record_blocker(figure_review_record(staging_dir, frame, kit), frame, store)

def record_blocker(record, frame, store):
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
    if not path:
        return None
    if "_staging/" in str(path).replace("\\", "/"):
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
    reason = figure_reuse_blocker(k.staging, frame, store, k.kit)
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

GATE_EXEMPT_ROLES = ("canonical", "parent")

def seed_role_review_refusals(k, roles, shot_name, gated=None):
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
    return {r["plate_parent"]: "place plate"
            for r in reqs if isinstance(r, dict) and r.get("plate_parent")}

def refuse_batch(refusals):
    if refusals:
        raise SystemExit("PRE-GEN REVIEW GATE — %d refusal(s); "
                         "nothing generated, nothing charged:\n%s"
                         % (len(refusals), "\n".join(refusals)))

def figure_reuse_refusal(k, fn, frame, shots_path, out_path, shot_name):
    store = os.path.relpath(os.path.join(k.staging, ASSET_REVIEW), k.root).replace("\\", "/")
    reason = figure_reuse_blocker(k.staging, frame, store, k.kit)
    if reason is None:
        return None
    return (f"{fn}: staged STEP-1 refused as a seed — {reason}. Re-mint it through the BUILDER "
            "(the only STEP-1 minter — a hand-typed `gen` carries `reference` seed roles, not this "
            "figure's canonical/expression/pose roles), then review it:\n"
            f"{figure_remint_instruction(k, fn, frame, shots_path, out_path, shot_name)}")

def _derived_from(stem, base):
    return bool(re.fullmatch(re.escape(base) + r"[-.].+", stem))

def _anchor_place(place_of_shot, anchor):
    stem = _stem(anchor)
    if stem in place_of_shot:
        return place_of_shot[stem]
    for shot_name in sorted(place_of_shot, key=len, reverse=True):
        if _derived_from(stem, shot_name):
            return place_of_shot[shot_name]
    return None

def cmd_batch(k, shots_path, out_path, video_dir=None, shots=None, retry_rebuild=False):
    doc = json.load(open(shots_path, encoding="utf-8"))
    video = os.path.abspath(video_dir) if video_dir else video_root_for(shots_path, k.root)
    k.use_video(video)          # this video's own cast resolves alongside the channel's
    lib, scenes = os.path.join(video, "assets", "library"), os.path.join(video, "assets", "scenes")
    reg_assets = {a["name"]: a for a in k.reg.get("assets", [])}
    chars = k.reg.get("characters", {})
    spec, made, emitted, place_first, place_last, notes = [], {}, {}, {}, {}, []
    blocked = []
    provenance = {}             # emitted name -> its `parent_depth`/`lineage` record (C-11)
    plate_shots = set()
    scope, seen, outside = (set(shots) if shots else None), set(), []
    walk = list(_shot_iter(doc))
    place_of_shot = {shot_name: shot.get("place") or None for shot_name, shot, _ in walk}
    held_expression = {}        # (chain, character) -> the expression that chain currently holds

    def vfile(n):
        return ((shot.get("assets") or {}).get(n) or (reg_assets.get(n) or {}).get("file")
                or (chars.get(n) or {}).get("base"))

    def on_disk(*cands):
        for c in cands:
            if c and os.path.exists(c):
                return os.path.relpath(c, k.root).replace("\\", "/")
        return None

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
        unregistered = [t for t in backticked(prompt) if t not in chars and t not in reg_assets]
        unresolved = unresolved_closed_world(k.reg, prompt)
        if unresolved:
            blocked.append(f"{name}: unresolved closed-world token(s): {', '.join(unresolved)}")
        if unregistered:
            why.append("unregistered slug(s) NOT seeded — named in the prompt, absent from the "
                       f"registry vocabulary: {', '.join(unregistered)}")
        scene_level = set(_interaction_primitives(k.reg, cast_recipe, omitted))
        for c, prims in cast_recipe:
            pose, expr = _split_primitives(k.reg, prims, omitted)
            if delta_beat and expr and expr != held_expression.get((chain, c)):
                expression_change[c] = expr
            if expr:
                held_expression[(chain, c)] = expr
            surplus = [p for p in prims
                       if p not in (pose, expr) and p not in omitted and p not in scene_level]
            if surplus:
                why.append(f"`{c}` surplus primitive(s) NOT seeded: {', '.join(surplus)}")
            if chars.get(c, {}).get("no_hands"):
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
            clause = beat_clause(prompt, c)
            fn = figure_frame_name(c, pose, expr, clause)
            if not in_scope:
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
                    blocked.extend(seed_role_review_refusals(k, step1_roles, name))
                    step1_payload = figure_card_payload(pose, clause)
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
        if in_scope and declared_place and place_frame is None and scope and parent and parent not in scope:
            blocked.append(
                f"{name}: place `{declared_place}` would seed NOTHING — its frame is minted by "
                f"`{parent}`, which this `--shots` scope excludes, and no frame for it exists on "
                f"disk yet. Building here silently breaks the set's continuity: include the "
                f"minting shot (`--shots {parent},{name}`), or mint the plate first.")
        crowd = _fig_declared(shot.get("figures"))
        def _kind(n):
            return (reg_assets.get(n) or {}).get("kind")
        tagged_names = _dedupe([n for n in (shot.get("assets") or {}) if _kind(n) in ("prop", "environment")]
                               + [n for n in backticked(prompt) if _kind(n) in ("prop", "environment")])
        if (text_bearing(prompt) and LETTERING_EXEMPLAR not in tagged_names
                and LETTERING_EXEMPLAR not in omitted and reg_assets.get(LETTERING_EXEMPLAR)):
            tagged_names.append(LETTERING_EXEMPLAR)
            why.append(f"LETTERING — text-bearing prompt; §5 exemplar `{LETTERING_EXEMPLAR}` derived")
        cast_free = not (fig_roles or canon_roles or crowd)
        if (cast_free and STYLE_TILE not in tagged_names and STYLE_TILE not in omitted
                and reg_assets.get(STYLE_TILE)):
            tagged_names.append(STYLE_TILE)
            why.append(f"STYLE TILE — cast-free frame; §5 anchor `{STYLE_TILE}` derived "
                       f"(line register + palette saturation)")

        def _role_of(n):
            return STYLE_ANCHOR_ROLE if n == STYLE_TILE else _kind(n)
        tagged_roles = [_seed_role(vfile(n), _role_of(n), n) for n in tagged_names if n not in omitted]
        interaction_roles = [_seed_role(vfile(n), "interaction")
                             for n in _interaction_primitives(k.reg, cast_recipe, omitted)]
        place_role = _seed_role(place_frame, "parent" if delta_beat else "place") if place_frame else None
        plate_parent = (place_role["path"]
                        if delta_beat and place_role and parent in plate_shots else None)
        plate_parent_gate = {plate_parent: "place plate"} if plate_parent else None
        crowd_role = _seed_role(crowd_ex, "crowd") if crowd else None
        if delta_beat:
            seed_roles = _dedupe_seed_roles([place_role] + canon_roles + prim_roles
                                            + interaction_roles + [crowd_role] + tagged_roles)
        else:
            seed_roles = _dedupe_seed_roles(fig_roles + canon_roles + interaction_roles
                                            + [place_role] + prim_roles
                                            + [crowd_role] + tagged_roles)
        displaced = []
        if len(seed_roles) > SEED_CAP and place_role and crowd_role in seed_roles:
            seed_roles = [role for role in seed_roles if role is not crowd_role]
            displaced.append(_stem(crowd_ex))
            why.append("CAP DISPLACEMENT — crowd exemplar dropped; the place frame carries the "
                       "rear crowd mass")
        if len(seed_roles) > SEED_CAP:
            dropped_template = next((role for role in seed_roles if role in interaction_roles), None)
            if dropped_template:
                seed_roles = [role for role in seed_roles if role is not dropped_template]
                stem = _stem(dropped_template["path"])
                displaced.append(stem)
                why.append(f"CAP DISPLACEMENT — interaction template `{stem}` dropped; its "
                           "geometry survives in role prose and the two figures' STEP-1 cards")
        if len(seed_roles) > SEED_CAP:
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
            blocked.extend(seed_role_review_refusals(k, seed_roles, name, plate_parent_gate))
        seeds = [role["path"] for role in seed_roles]
        plate = not [role for role in seed_roles if role["role"] != STYLE_ANCHOR_ROLE]
        if plate:
            plate_shots.add(name)       # C-1: what a later delta inherits, and must be ruled on
        text = placement_delta(prompt, seed_roles)
        if place_anchor:
            why.append(f"PLACE-ANCHOR = {shot['place_anchor']}")
        elif plate:
            why.append("PLATE — place-first frame, bible descriptor, "
                       "no content anchor")
        why_text = "; ".join(why) or "no cast — the scene composes from the place"
        in_batch_parent = (provenance.get(parent)
                           if place_frame and place_frame == emitted.get(parent) else None)
        depth, lineage = _scene_provenance(video, k.root, name, place_frame, in_batch_parent,
                                           refuse_parked=not retry_rebuild)
        item = {"name": name, "mode": "environment", "aspect": aspect, "delta": text,
                "payload": prompt,
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
            outside.extend(seeding_law_violations(k, item, seeds))
        place_first.setdefault(place, name); place_last[place] = name
    if scope and scope - seen:
        raise SystemExit(f"batch --shots names {len(scope - seen)} id(s) that are not in "
                         f"{os.path.basename(shots_path)}: {', '.join(sorted(scope - seen))}")
    refuse_batch(blocked)                # one exit, the whole batch's list
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
        print(f"  == scoped to {len(scope)} shot(s); {len(outside)} seeding-law violation(s) remain "
              f"OUTSIDE the scope, unaddressed by this spec ==", flush=True)

    return spec

RETRY_OVERLAY_SCHEMA = "faceless-youtube/forge-retry-overlay@2"
_RETRY_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")
_EXPRESSION_RETRY = re.compile(
    r"\b(expr(?:ession)?(?:-[a-z0-9-]+)?|facial|smile|grin|teeth|worried|smug|deadpan|"
    r"caught|pleased|angry|sad|fear)\b",
    re.IGNORECASE)

def retry_seed_for(k, video, raw, label):
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
    return (_scene_manifest_entry(video, seed, root) or {}).get("review_status")

def _hops(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0

def _scene_provenance(video, root, name, place_frame, in_batch_parent, refuse_parked=True):
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
                         "expression AND pose defects route to a `step1` (STEP-1) re-mint.")
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
    if entry.get("defect") not in ("expression", "rig", "pose", "clean_card"):
        raise SystemExit(f"{label}: STEP-1 retry `defect` must be `expression`, `rig`, `pose` or "
                         "`clean_card`.")
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
    clause = beat_clause(source.get("still_prompt") or "", character)
    expected = figure_frame_name(character, pose, expr, clause)
    if entry["name"] != expected:
        raise SystemExit(
            f"{label}: STEP-1 retry `name` is `{entry['name']}` but this shot's recipe mints "
            f"`{expected}`. A card's name carries its derived-clause digest (P8), so a hand-typed "
            f"name lands a frame the next `batch` never looks up — it re-mints instead, without "
            f"this retry's instruction. Copy the name from the review board.")
    is_clean_card = entry["defect"] == "clean_card"
    payload = figure_card_payload(pose, "" if is_clean_card else clause)
    if is_clean_card and not instruction:
        instruction = ("The previous attempt drew a held object, prop or scenery fragment on this "
                       "card. Draw the figure alone against the flat pale-grey backdrop: no held "
                       "object, no prop, no scenery, no other person.")
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
    try:
        spec = json.load(open(spec_path, encoding="utf-8"))
    except (OSError, ValueError):
        raise SystemExit(f"manifest --from-batch: {spec_path} is not a readable `batch` spec.")
    out = {}
    for item in spec if isinstance(spec, list) else []:
        if isinstance(item, dict) and item.get("name") and any(c in item for c in PROVENANCE_COUNTERS):
            out[item["name"]] = {c: _hops(item.get(c)) for c in PROVENANCE_COUNTERS}
    return out

def scene_row_integrity(entry, video):
    sid, declared = entry.get("shot_id"), entry.get("file")
    rel = declared or "assets/scenes/%s.png" % sid
    if os.path.isfile(os.path.join(video, rel)):
        entry.pop("note", None)
        if declared:
            return None
        entry["file"] = rel
        return f"{sid}: file -> {rel} (a verified frame nothing pointed at)"
    if entry.get("review_status") != "verified":
        return None
    entry["review_status"] = "unreviewed"
    entry["note"] = f"`verified` withdrawn on emit: no frame at {rel} in this checkout"
    return f"{sid}: verified -> unreviewed (no frame at {rel})"

def cmd_manifest(k, kind, spec_path, out, to_dir, slug, notes, from_batch=None):
    if kind not in ("scenes", "library"):
        raise SystemExit("manifest needs --kind scenes|library")
    key = "shots" if kind == "scenes" else "assets"
    req = ("shot_id",) if kind == "scenes" else ("name", "file")
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
    if out:
        out_path = out if os.path.isabs(out) else os.path.join(k.root, out)
    else:
        base = to_dir if os.path.isabs(to_dir) else os.path.join(k.root, to_dir or "")
        out_path = os.path.join(base, "manifest.json")
    video = os.path.dirname(os.path.dirname(os.path.dirname(out_path)))
    reconciled = []
    for i, e in enumerate(entries):
        miss = [f for f in req if not e.get(f)]
        if miss:
            raise SystemExit(f"{kind} entry #{i} missing required key(s): {', '.join(miss)}")
        if kind == "scenes":
            change = scene_row_integrity(e, video)
            if change:
                reconciled.append(change)
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
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(manifest, open(out_path, "w", encoding="utf-8"), indent=2)
    for change in reconciled:
        print(f"  reconciled {change}", flush=True)
    print(f"manifest ({kind}): {len(entries)} entries -> {out_path}"
          + (f", {len(reconciled)} row(s) reconciled" if reconciled else ""), flush=True)

def harden_alpha(rgba, lo=100, hi=175):
    r, g, b, a = rgba.split()
    a = a.point(lambda v: 0 if v < lo else (255 if v > hi else int((v - lo) / (hi - lo) * 255)))
    from PIL import Image
    return Image.merge("RGBA", (r, g, b, a))

def trim_to_alpha(rgba):
    bbox = rgba.split()[3].getbbox()
    return rgba.crop(bbox) if bbox else rgba

CUTOUT_WIDE_RATIO = 1.5

def check_cutout_aspect(w, h, allow_wide=False):
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
                                     "'{\"crowd\": true}'")
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
    ap.add_argument("--in", dest="in_path", help="cutout: source PNG (repo/kit/abs path)")
    ap.add_argument("--lo", type=int, default=100, help="cutout: alpha-harden low threshold")
    ap.add_argument("--hi", type=int, default=175, help="cutout: alpha-harden high threshold")
    ap.add_argument("--allow-wide", action="store_true",
                    help="cutout: allow a wide (w/h >= 1.5) input — a legitimately wide object (e.g. a star row)")
    ap.add_argument("--to", help="place/manifest: destination dir (e.g. videos/<slug>/assets/scenes)")
    ap.add_argument("--kind", choices=["scenes", "library"], help="manifest: which manifest to emit")
    ap.add_argument("--from-batch", dest="from_batch",
                    help="manifest --kind scenes: the `batch` spec this run generated from; each "
                         "entry inherits C-11's `parent_depth`/`lineage` from the matching item "
                         "(spec `name` == entry `shot_id`) unless it states its own")
    ap.add_argument("--slug", help="manifest: video_slug for the envelope")
    ap.add_argument("--notes", help="manifest: free-text notes for the envelope")
    a = ap.parse_args()
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
