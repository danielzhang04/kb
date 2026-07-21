"""Voice-clean text (conversation-rules design §2). Streaming-safe by construction: the marker
characters are removed per-chunk at character level (a split "**" still dies), line-anchored
headers, list markers, and links are best-effort within a chunk. Chunks are never .strip()ped — a
single leading/trailing space is the word boundary between streamed segments."""
import re

# Silent-turn marker (Gate finding #1, 2026-07-21): the LLM's ONLY way to say nothing is to reply
# exactly [quiet] — an LLM turn always produces text, so silence needs a token. Stripped here so
# it can never be spoken; app.py additionally skips mirroring/window-re-arm for such turns.
_QUIET = re.compile(r"\[quiet\]", re.IGNORECASE)
_QUIET_TURN = re.compile(r"\s*\[quiet\][.!\s]*$", re.IGNORECASE)

_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_HEADER = re.compile(r"(?m)^[ \t]*#{1,6}[ \t]+")
_LIST_MARKER = re.compile(r"(?m)^[ \t]*(?:[-•*]|\d+\.)[ \t]+")
_MULTISPACE = re.compile(r"[ \t]{2,}")


def is_quiet_turn(text: str) -> bool:
    """True when an assistant turn is the silent-turn marker (allowing trailing punctuation) —
    the caller must then neither mirror the turn nor re-arm the addressed window."""
    return bool(_QUIET_TURN.fullmatch(text))


def sanitize_for_tts(text: str) -> str:
    # Header regex runs BEFORE the char-level strip: stripping "#" alone would leave its trailing
    # space ("# Status" -> " Status"). The char pass still catches "#" split from its space (PR #44).
    # [quiet] first: it must never reach the speaker, and _LINK would otherwise leave it intact
    # (no parenthesized target). A marker-only turn (trailing punctuation included) sanitizes to
    # nothing at all -> no synthesis; a rule-violating mixed turn just loses the marker.
    if _QUIET_TURN.fullmatch(text):
        return ""
    t = _QUIET.sub("", text)
    t = _LINK.sub(r"\1", t)
    t = _HEADER.sub("", t)
    t = _LIST_MARKER.sub("", t)
    t = t.replace("`", "").replace("*", "").replace("#", "")
    t = t.replace("_", " ")
    return _MULTISPACE.sub(" ", t)
