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


def resolve_codex_binary() -> str:
    """Resolve the executable at run time, failing loudly without a Codex installation.

    ``shutil.which`` deliberately provides Windows ``PATHEXT`` resolution for a codex-like binary.
    """
    exe = shutil.which(CODEX_ARGV_PREFIX[0])
    if exe is None:
        raise SystemExit(f"codex CLI not found on PATH ({CODEX_ARGV_PREFIX[0]!r}) — install it, or "
                         "patch forge_codex.CODEX_ARGV_PREFIX in tests")
    return exe
