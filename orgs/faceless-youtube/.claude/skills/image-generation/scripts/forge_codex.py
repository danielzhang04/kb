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


class RatioError(RuntimeError):
    """The native ratio exceeds the 5% normalization tolerance (failure class 7)."""


class CodexContractError(RuntimeError):
    """A deterministic contract violation detected before a subprocess is invoked (class 1)."""


class CodexRunError(RuntimeError):
    """A per-item transport/provider failure; ``failure_class`` names its section-6 class."""

    def __init__(self, failure_class, message):
        super().__init__(message)
        self.failure_class = failure_class


def resolve_codex_binary() -> str:
    """Resolve the executable at run time, failing loudly without a Codex installation.

    ``shutil.which`` deliberately provides Windows ``PATHEXT`` resolution for a codex-like binary.
    """
    exe = shutil.which(CODEX_ARGV_PREFIX[0])
    if exe is None:
        raise SystemExit(f"codex CLI not found on PATH ({CODEX_ARGV_PREFIX[0]!r}) — install it, or "
                         "patch forge_codex.CODEX_ARGV_PREFIX in tests")
    return exe
