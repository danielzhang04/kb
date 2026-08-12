#!/usr/bin/env python3
"""forge_codex — the codex-CLI image engine, a standalone peer runner beside forge.py.

Ruling 7 (2026-08-11): zero forge.py edits. This module imports forge.py read-only as a library
(shot truth + staging discipline) and owns everything provider-specific: the prompt composer, the
``codex exec`` invocation, harvest, fidelity audit, normalization, failure classification and engine
log. ``git diff forge.py`` must stay empty.

Subscription-billed: $0 API spend. No key is ever loaded — every Kit is built dry.
"""
import os
import shutil
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from forge import (Kit, SeedIntegrityError, SEED_CAP, _existing_staging_png,  # noqa: E402
                   _publish_staging_png, _release_staging_lock, _reserve_staging_output,
                   _staging_png, _stem, preflight_batch, resolve_request_seeds, to_png_bytes,
                   validate_png, verify_request_seed_digests)

# Environment is carried as module constants so tests patch it. Production exposes no environment
# variable override surface. ``resolve_codex_binary`` is called from the run loop, never at import.
CODEX_ARGV_PREFIX = ["codex"]
IMAGE_ROOT = os.path.expanduser("~/.codex/generated_images")
SESSIONS_ROOT = os.path.expanduser("~/.codex/sessions")
TIMEOUT_S = 240

ENGINE_ID = "codex-imagegen"
CODEX_SEED_CAP = 4
TRANSPORT_SEED_CEILING = 5

# --- §4.6 normalization canvas. (16:9,1K) is VERIFIED MEASURED: all 23 baseline frames in
# --- scratch-codex-image-engine/gemini-baseline/ are 1376×768 (SKILL.md L130's "~1344×768"
# --- is an approximation). The (2:3,1K) and (9:16,1K) rows are UNVERIFIED and carried from
# --- SKILL.md L130; no frame at either ratio may be promoted at P5 until a real Gemini frame is
# --- measured (spec §8.5 probe 7). 2K rows are 2× linear. A pair absent from this table is an
# --- error, never a guess.
CANVAS: dict[tuple[str, str], tuple[int, int]] = {
    ("16:9", "1K"): (1376, 768),
    ("16:9", "2K"): (2752, 1536),
    ("2:3", "1K"): (832, 1248),
    ("2:3", "2K"): (1664, 2496),
    ("9:16", "1K"): (768, 1344),
    ("9:16", "2K"): (1536, 2688),
}


def resolve_canvas(aspect: str, image_size: str) -> tuple[int, int]:
    key = (str(aspect), str(image_size))
    if key not in CANVAS:
        raise SystemExit(f"no canvas row for (aspect={key[0]!r}, image_size={key[1]!r}) — measure a "
                         f"real frame of that pair before generating one (spec §4.6, §8.5 probe 7)")
    return CANVAS[key]


def framing_line(aspect: str, canvas: tuple[int, int]) -> str:
    """Return the mandatory prompt line that requests the intended frame dimensions and ratio."""
    w, h = canvas
    orientation = "landscape" if w > h else ("portrait" if h > w else "square")
    return (f"Composition/framing: Compose for a {w}×{h} pixel frame — a {aspect} "
            f"{orientation} aspect ratio.")


class RatioError(RuntimeError):
    """The native ratio exceeds the 5% normalization tolerance (failure class 7)."""


class CodexContractError(RuntimeError):
    """A deterministic contract violation detected before a subprocess is invoked (class 1)."""


class CodexRunError(RuntimeError):
    """A per-item transport/provider failure; ``failure_class`` names its section-6 class."""

    def __init__(self, failure_class, message):
        super().__init__(message)
        self.failure_class = failure_class


import re  # noqa: E402
from collections.abc import Callable  # noqa: E402

# --- §4.3 idiom translation: this pipeline's STAGING idiom renders as literal signage on codex
# --- (p1 probe E2 minted a "TOTE RACK / STAGE-LEFT" sign). Ordered, word-boundary, case-insensitive.
# --- It changes WORDING only: dropping a load-bearing staging fact would be the fidelity violation
# --- named at SKILL.md L395-397.
def _frame_side(match: re.Match) -> str:
    return f"on the {match.group('side').lower()} of the frame"


IDIOM_TABLE: list[tuple[re.Pattern, str | Callable[[re.Match], str]]] = [
    (re.compile(r"\b(?:at\s+)?(?:stage|camera)[-\s](?P<side>left|right)\s+of\s+"
                r"(?:the\s+)?frame\b", re.I), _frame_side),
    (re.compile(r"\boff[-\s]?stage\b", re.I), "outside the frame"),
    (re.compile(r"\bstage[-\s](?:centre|center)\b", re.I), "centred in the frame"),
    (re.compile(r"\bstage[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bstage[-\s]right\b", re.I), "on the right of the frame"),
    (re.compile(r"\bup\s?stage\b", re.I), "toward the back of the frame"),
    (re.compile(r"\bdown\s?stage\b", re.I), "toward the front of the frame"),
    (re.compile(r"\bcamera[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bcamera[-\s]right\b", re.I), "on the right of the frame"),
]

# A quoted span is diegetic and load-bearing (SKILL.md L136-138): it must render verbatim, so the
# table is applied only to the UNQUOTED spans between them.
_QUOTED_SPAN = re.compile(r'"[^"\n]{1,60}"' r"|'[^'\n]{1,60}'")

_RESIDUAL = re.compile(r"\b(stage|wings|blocking)\b", re.I)
_DIRECTION_NEAR = re.compile(r"\b(left|right|centre|center|front|back|up|down|mark)\b", re.I)


def translate_idiom(text: str) -> str:
    """Apply IDIOM_TABLE to every unquoted span of `text`; quoted literals pass through untouched."""
    out, pos = [], 0
    for m in _QUOTED_SPAN.finditer(text or ""):
        out.append(_translate_span(text[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_translate_span((text or "")[pos:]))
    return "".join(out)


def _translate_span(span: str) -> str:
    for pattern, replacement in IDIOM_TABLE:
        span = pattern.sub(replacement, span)
    return span


def residual_idiom(text: str) -> list[str]:
    """WARN-level scan for staging idiom the table cannot claim to cover. Never raises: the table
    is not provably exhaustive and hard-failing on authored prose would block legitimate shots."""
    translated = translate_idiom(text or "")
    hits = []
    for m in _RESIDUAL.finditer(translated):
        window = translated[max(0, m.start() - 40):m.end() + 40]
        if _DIRECTION_NEAR.search(window):
            hits.append(window.strip())
    return hits


# --- §4.1-4.3 THE COMPOSER. Codex's own labeled schema (~/.codex/skills/.system/imagegen/SKILL.md
# --- L212-229), front-loaded, ONE trailing constraint block. Gemini's two-voice head+tail
# --- convention is NOT ported: P2b E2 measured it ~4x worse on this engine.
USE_CASE = "illustration-story"
ASSET_TYPE = "documentary-style animated video still frame"
COMPOSED_CHAR_BUDGET = 2200      # P2b E1: 1740 -> 4032 chars was ~6x worse at constant facts

CODEX_REGISTER_BLOCK = {
    "Style/medium": ("clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black "
                     "outline (#241a12), flat cel colour fills with gentle soft shading only, "
                     "rounded friendly shapes, no realistic detail"),
    "Color palette": ("locked 2-3 colour scene palette plus a single red accent #d7402b reserved "
                      "only for alarm / prohibition / ownership / the final punch element"),
    "Materials/textures": "flat cel fills only, no gradients, no ambient occlusion",
}

# The single biggest measured register lever (P2b B/C: 2-3x closer, and zero unrequested text in
# EVERY dedicated-Avoid run). Kept to 6 items: short, hard, direct negation, never merged into
# Constraints -- the schema splits keep/avoid deliberately.
AVOID_BASE = ["photorealism", "on-screen narrator or host face", "logos",
              "gradients and cast shadows", "soft ambient shading"]
AVOID_TEXT_WITH_QUOTES = ("unrequested text or signage beyond the quoted text and invented staging "
                          "labels")
AVOID_TEXT_NO_QUOTES = "any words, letters, numerals or signage"

CONSTRAINT_FIGURE = ("preserve {who}'s exact costume, proportions and line weight from the "
                     "reference image")
CONSTRAINT_CROWD = ("background crowd figures stay flat silhouetted shapes in the scene palette, "
                    "no individual faces and no added named characters")
CONSTRAINT_ENVIRONMENT = ("environment stays a built-but-flat environment — minimal geometry "
                          "plus one foreground depth prop, not a fully rendered set")

# Short ordinal + role label. P2b D: all three tested framings prevented style-tile content leak
# equally, INCLUDING the cheapest -- verbosity is not protective, so the composer uses the short
# form. The role words restate forge's own `role` vocabulary (seed_roles_text L1270-1352).
_ROLE_CLAUSE = {
    "figure": "character reference for {who} — match exactly",
    "canonical": "character reference for {who} — match exactly",
    "pose": "pose reference for {who} — match the body position",
    "expression": "expression reference for {who} — match the face",
    "place": "place reference — preserve its set, palette and outline weight",
    "parent": "previous frame in this chain — preserve its set, palette and outline weight",
    "prop": "prop reference — include exactly as shown",
    "crowd": "crowd reference — match its figure proportion and face style",
    "interaction": "interaction geometry reference — match the contact and eye-line",
    "style-anchor": "style reference only",
}
_ROLE_CLAUSE_DEFAULT = "reference only"

_FIGURE_ROLES = ("figure", "canonical", "pose", "expression")
_SLUG = re.compile(r"`([A-Za-z0-9][A-Za-z0-9._-]*)`")
# A diegetic literal is short and quoted (SKILL.md L136-138: 1-4 words). The single-quote form is
# guarded on both sides so a possessive apostrophe can never pair into a false literal.
_QUOTED_LITERAL = re.compile(r'"([^"\n]{1,60})"' r"|(?<![A-Za-z0-9])'([^'\n]{1,40})'(?![A-Za-z0-9])")


def resolve_slugs(text, reg):
    """Backticked slugs -> plain words, resolved from the registry so the result is deterministic."""
    assets = {a["name"]: a for a in (reg or {}).get("assets", [])}

    def one(m):
        slug = m.group(1)
        asset = assets.get(slug)
        if asset:
            tag = asset.get("tag") or slug
            kind = asset.get("kind")
            if kind == "expression":
                return f"{tag} expression"
            if kind in ("pose", "action"):
                return f"{tag} pose"
            if kind == "interaction":
                return f"{tag} interaction staging"
            return str(tag)
        return slug

    return _SLUG.sub(one, text or "")


def quoted_literals(text):
    """The in-video diegetic text, in authored order, de-duplicated."""
    out = []
    for m in _QUOTED_LITERAL.finditer(text or ""):
        lit = (m.group(1) if m.group(1) is not None else m.group(2)).strip()
        if lit and len(lit.split()) <= 4 and lit not in out:
            out.append(lit)
    return out


def input_images_line(seed_roles):
    parts = []
    for i, entry in enumerate(seed_roles or [], start=1):
        who = entry.get("character") or _stem(entry.get("path", ""))
        clause = _ROLE_CLAUSE.get(entry.get("role"), _ROLE_CLAUSE_DEFAULT).format(who=who)
        parts.append(f"Image {i}: {clause}.")
    return " ".join(parts)


def constraints_text(item):
    out, seen = [], []
    for entry in item.get("seed_roles") or []:
        who = entry.get("character")
        if entry.get("role") in _FIGURE_ROLES and who and who not in seen:
            seen.append(who)
            out.append(CONSTRAINT_FIGURE.format(who=who))
    if (item.get("figures") or {}).get("crowd"):
        out.append(CONSTRAINT_CROWD)
    out.append(CONSTRAINT_ENVIRONMENT)
    return "; ".join(out)


def avoid_text(has_quotes):
    items = (AVOID_BASE + [AVOID_TEXT_WITH_QUOTES]) if has_quotes \
        else ([AVOID_TEXT_NO_QUOTES] + AVOID_BASE)
    return ", ".join(items)


def compose_prompt(item, *, reg, canvas, aspect):
    """Pure function of (item, registry, canvas, aspect): no model call, no randomness, no ambient
    state. That is what makes --dry-run print the exact bytes a live run would send, at $0."""
    payload = translate_idiom(resolve_slugs(item.get("payload") or item.get("delta") or "", reg))
    quotes = quoted_literals(item.get("payload") or "")
    lines = [f"Use case: {USE_CASE}",
             f"Asset type: {ASSET_TYPE}",
             f"Primary request: {payload}"]
    images = input_images_line(item.get("seed_roles") or [])
    if images:
        lines.append(f"Input images: {images}")
    lines.append(f"Style/medium: {CODEX_REGISTER_BLOCK['Style/medium']}")
    lines.append(framing_line(aspect, canvas))
    lines.append(f"Color palette: {CODEX_REGISTER_BLOCK['Color palette']}")
    lines.append(f"Materials/textures: {CODEX_REGISTER_BLOCK['Materials/textures']}")
    if quotes:
        joined = "; ".join(f'"{q}"' for q in quotes)
        lines.append(f"Text (verbatim): {joined} — render exactly this text and nothing else.")
    lines.append(f"Constraints: {constraints_text(item)}")
    lines.append(f"Avoid: {avoid_text(bool(quotes))}")
    composed = "\n".join(lines) + "\n"
    residual = residual_idiom(composed)
    if residual:
        warnings.warn(f"residual staging idiom in composed prompt: {residual}",
                      RuntimeWarning, stacklevel=2)
    return composed


def resolve_codex_binary() -> str:
    """Resolve the executable at run time, failing loudly without a Codex installation.

    ``shutil.which`` deliberately provides Windows ``PATHEXT`` resolution for a codex-like binary.
    """
    exe = shutil.which(CODEX_ARGV_PREFIX[0])
    if exe is None:
        raise SystemExit(f"codex CLI not found on PATH ({CODEX_ARGV_PREFIX[0]!r}) — install it, or "
                         "patch forge_codex.CODEX_ARGV_PREFIX in tests")
    return exe
