"""Desktop-local sender-anchor loading and deterministic alias matching."""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from ..store import resolve_store_path


_ALLOWED = frozenset({
    "_note", "sender", "schools", "activities", "employers", "career_track", "domains",
    "geography", "heritage_language", "interests", "skills", "proof_points",
})
_KINDS = frozenset({
    "bank", "consultancy", "pe", "vc", "hedge_fund", "startup", "bigtech",
    "corporate", "government", "academia", "nonprofit", "other",
})


def normalize(value: str) -> str:
    """Canonicalise anchor text without permitting fuzzy matching."""
    folded = unicodedata.normalize("NFKC", value).casefold()
    stripped = "".join(
        ch for ch in unicodedata.normalize("NFD", folded)
        if unicodedata.category(ch) != "Mn"
    )
    return " ".join(re.sub(r"[^\w\s]", " ", stripped).split())


@dataclass(frozen=True)
class AliasIndex:
    exact: Mapping[str, str]
    token_sets: tuple[tuple[frozenset[str], str], ...]

    def match(self, value: str) -> str | None:
        """Return an exact or whole multi-token-alias match, never a fuzzy match."""
        normalised = normalize(value)
        if exact := self.exact.get(normalised):
            return exact
        value_tokens = frozenset(normalised.split())
        for tokens, canonical in self.token_sets:
            if tokens <= value_tokens:
                return canonical
        return None


@dataclass(frozen=True)
class SenderAnchors:
    schools: AliasIndex
    employers: AliasIndex
    employer_kinds: Mapping[str, str]
    career_track: tuple[str, ...]
    domains: frozenset[str]
    activities: frozenset[str]
    interests: frozenset[str]
    skills: frozenset[str]
    geography: frozenset[str]
    proof_points: tuple[str, ...]


def anchors_path() -> Path:
    """Return the desktop-local sender-anchor file path."""
    return resolve_store_path().parent / "sender-anchors.json"


def _schema_error() -> ValueError:
    return ValueError("anchors_schema")


def _entries(value: object) -> tuple[Mapping[str, object], ...]:
    if not isinstance(value, list) or any(not isinstance(entry, dict) for entry in value):
        raise _schema_error()
    return tuple(value)


def _strings(value: object) -> tuple[str, ...]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise _schema_error()
    return tuple(value)


def _index(entries: Iterable[Mapping[str, object]]) -> AliasIndex:
    exact: dict[str, str] = {}
    token_sets: list[tuple[frozenset[str], str]] = []
    for entry in entries:
        name = entry.get("name")
        aliases = entry.get("aliases", ())
        if not isinstance(name, str) or not isinstance(aliases, list):
            raise _schema_error()
        if any(not isinstance(alias, str) for alias in aliases):
            raise _schema_error()
        canonical = normalize(name)
        if not canonical:
            raise _schema_error()
        for alias in (name, *aliases):
            key = normalize(alias)
            if not key:
                continue
            exact[key] = canonical
            tokens = frozenset(key.split())
            if len(tokens) > 1:
                token_sets.append((tokens, canonical))
    return AliasIndex(
        MappingProxyType(exact),
        tuple(sorted(token_sets, key=lambda pair: (-len(pair[0]), pair[1]))),
    )


def _normalised_set(value: object) -> frozenset[str]:
    return frozenset(filter(None, (normalize(item) for item in _strings(value))))


def _geography(value: object) -> frozenset[str]:
    if not isinstance(value, dict):
        raise _schema_error()
    raw_values = [value.get("home", ""), value.get("current", ""), *value.get("aliases", [])]
    if any(not isinstance(item, str) for item in raw_values):
        raise _schema_error()
    return frozenset(filter(None, (normalize(item) for item in raw_values)))


def load_anchors(path: Path) -> SenderAnchors:
    """Load anchors while intentionally discarding sensitive heritage-language data."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise _schema_error() from error
    if not isinstance(payload, dict) or set(payload) - _ALLOWED:
        raise _schema_error()

    schools = _entries(payload.get("schools", []))
    employers = _entries(payload.get("employers", []))
    employer_kinds: dict[str, str] = {}
    for employer in employers:
        name = employer.get("name")
        kind = employer.get("kind")
        if not isinstance(name, str) or not isinstance(kind, str) or kind not in _KINDS:
            raise _schema_error()
        canonical = normalize(name)
        if not canonical:
            raise _schema_error()
        employer_kinds[canonical] = kind

    return SenderAnchors(
        schools=_index(schools),
        employers=_index(employers),
        employer_kinds=MappingProxyType(employer_kinds),
        career_track=tuple(normalize(item) for item in _strings(payload.get("career_track", []))),
        domains=_normalised_set(payload.get("domains", [])),
        activities=_normalised_set(payload.get("activities", [])),
        interests=_normalised_set(payload.get("interests", [])),
        skills=_normalised_set(payload.get("skills", [])),
        geography=_geography(payload.get("geography", {})),
        proof_points=_strings(payload.get("proof_points", [])),
    )
