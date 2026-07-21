"""Utterance router: the real three-lane dispatch (design §7).

Lanes:
  - reflex: an instant local response, no model call — matched against `atlas/config/intents.yaml`
            (normalized exact phrases + anchored regex patterns). Arrived in V1.
  - fast:   the tool-use loop over kb tools (V0's only lane) — every unmatched utterance.
  - work:   a longer-running agent/card hand-off. The utterances that name filing/launching still
            flow through `fast` (the LLM drives file_card/launch_workflow); `work` as a distinct
            execution path is V2 territory, so it is not produced here.

`route(utterance, intents)` returns `("reflex", intent_name)` for a reflex hit and `("fast", None)`
otherwise. `intents` is the mapping returned by `load_intents(path)` — the router holds NO phrases
of its own, so the matching data is entirely data-driven and unit-testable off any dict.

Pure by contract: no I/O beyond `load_intents` reading the YAML file; `route` touches only its args.
"""
import re
from pathlib import Path

import yaml

# Normalization shared by phrase matching and pattern matching: casefold, drop everything that is
# not an ascii letter / digit / space (punctuation, apostrophes — Deepgram may omit them), collapse
# runs of whitespace. Adapted from V0's _is_dismiss/_norm_phrase, now the router's single normalizer.
_STRIP = re.compile(r"[^a-z0-9\s]")
_WS = re.compile(r"\s+")


def normalize(s: str) -> str:
    return _WS.sub(" ", _STRIP.sub("", s.casefold())).strip()


def load_intents(path) -> dict:
    """Load reflex intents from a YAML file. Returns the intent mapping
    `{name: {"phrases": [...], "patterns": [...]}}` (both keys optional per intent)."""
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return data.get("intents", data)


def route(utterance: str, intents: dict) -> tuple:
    """Classify `utterance` against `intents`. Empty/whitespace still raises ValueError (the caller
    must never route a blank final transcript). First intent to match wins (declaration order)."""
    if not utterance or not utterance.strip():
        raise ValueError("utterance is empty")
    norm = normalize(utterance)
    for name, spec in (intents or {}).items():
        spec = spec or {}
        phrases = {normalize(p) for p in (spec.get("phrases") or [])}
        if norm in phrases:
            return ("reflex", name)
        for pattern in (spec.get("patterns") or []):
            # Anchored: re.fullmatch requires the pattern to consume the WHOLE normalized utterance,
            # so trailing/leading words defeat the match (near-misses stay in the fast lane).
            if re.fullmatch(pattern, norm):
                return ("reflex", name)
    return ("fast", None)
