"""Voice-clean text (conversation-rules design §2). Streaming-safe by construction: the marker
characters are removed per-chunk at character level (a split "**" still dies), line-anchored
headers, list markers, and links are best-effort within a chunk. Chunks are never .strip()ped — a
single leading/trailing space is the word boundary between streamed segments."""
import re

_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_HEADER = re.compile(r"(?m)^[ \t]*#{1,6}[ \t]+")
_LIST_MARKER = re.compile(r"(?m)^[ \t]*(?:[-•*]|\d+\.)[ \t]+")
_MULTISPACE = re.compile(r"[ \t]{2,}")


def sanitize_for_tts(text: str) -> str:
    # Header regex runs BEFORE the char-level strip: stripping "#" alone would leave its trailing
    # space ("# Status" -> " Status"). The char pass still catches "#" split from its space (PR #44).
    t = _LINK.sub(r"\1", text)
    t = _HEADER.sub("", t)
    t = _LIST_MARKER.sub("", t)
    t = t.replace("`", "").replace("*", "").replace("#", "")
    t = t.replace("_", " ")
    return _MULTISPACE.sub(" ", t)
