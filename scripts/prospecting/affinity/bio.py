"""Pure parsing and idempotent persistence for inert firm biography pages."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from hashlib import sha256
from html.parser import HTMLParser
import json
import re
import unicodedata
from urllib.parse import urljoin, urlsplit

from .anchors import SenderAnchors, normalize


TEAM_PATH_RE = re.compile(r"^/(our-)?(team|people|about|who-we-are|partners)/?$")
DEGREE_TOKENS = frozenset({"BA", "BS", "BBA", "MBA", "JD", "PhD", "MS", "MSc", "AB"})
TRANSITIONS = ("previously", "prior to", "before joining", "joined from", "spent")
_DEGREE_RE = re.compile(r"(?<!\w)(BA|BS|BBA|MBA|JD|PhD|MS|MSc|AB)(?!\w)")
_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|[\r\n]+")
_ORG_RE = re.compile(
    r"\bat\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,5})(?=\s+(?:from|in|between)\s+(?:19|20)\d{2}|\s*[.,;]|$)"
)
_SCHOOL_RE = re.compile(
    r"\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,4}\s+(?:University|College|Institute|School))\b"
)


@dataclass(frozen=True)
class EducationFact:
    school_norm: str
    school_raw: str
    degree: str | None
    start_year: int | None
    end_year: int | None
    excerpt: str


@dataclass(frozen=True)
class EmployerFact:
    employer_norm: str
    employer_raw: str
    employer_kind: str
    title: str | None
    start_year: int | None
    end_year: int | None
    excerpt: str


@dataclass(frozen=True)
class LinkFact:
    kind: str
    url: str
    excerpt: str


@dataclass(frozen=True)
class BioFacts:
    education: tuple[EducationFact, ...]
    employers: tuple[EmployerFact, ...]
    links: tuple[LinkFact, ...]
    has_about: bool
    hometown_hint: str | None


class _Page(HTMLParser):
    """Collect visible text and inert anchor triples without executing page content."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._anchors: list[dict[str, list[str] | str]] = []
        self.has_about = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.casefold(): value or "" for key, value in attrs}
        if "about" in attributes.get("id", "").casefold() or "about" in attributes.get("class", "").casefold():
            self.has_about = True
        if tag.casefold() == "a" and attributes.get("href"):
            self._anchors.append({"href": attributes["href"], "text": []})

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() == "a" and self._anchors:
            anchor = self._anchors.pop()
            self.links.append((str(anchor["href"]), " ".join(anchor["text"])))

    def handle_data(self, data: str) -> None:
        collapsed = " ".join(data.split())
        if not collapsed:
            return
        self.text.append(collapsed)
        for anchor in self._anchors:
            text = anchor["text"]
            assert isinstance(text, list)
            text.append(collapsed)


def _page(html: str) -> _Page:
    page = _Page()
    page.feed(html)
    page.close()
    return page


def _same_host(url: str, base_url: str) -> bool:
    return urlsplit(url).hostname == urlsplit(base_url).hostname


def team_index_url(homepage_html: str, base_url: str) -> str | None:
    """Return the first same-host team-like link from a firm homepage."""
    for href, _ in _page(homepage_html).links:
        candidate = urljoin(base_url, href)
        if _same_host(candidate, base_url) and TEAM_PATH_RE.fullmatch(urlsplit(candidate).path):
            return candidate
    return None


def person_bio_url(team_html: str, base_url: str, full_name: str) -> str | None:
    """Return a same-host bio URL whose anchor names the supplied person."""
    for href, text in _page(team_html).links:
        candidate = urljoin(base_url, href)
        if _name_matches(text, full_name) and _same_host(candidate, base_url):
            return candidate
    return None


def person_block(team_html: str, full_name: str) -> str | None:
    """Return a bounded visible-text block around a normalised name match, if present."""
    text = " ".join(_page(team_html).text)
    wanted = _name_pattern(full_name)
    if wanted is None:
        return None
    normalised, offsets = _normalised_with_offsets(text)
    match = wanted.search(normalised)
    if match is None:
        return None
    start = offsets[match.start()]
    end = offsets[match.end() - 1] + 1
    return text[max(0, start - 240):min(len(text), end + 240)].strip()


def _name_pattern(full_name: str) -> re.Pattern[str] | None:
    tokens = normalize(full_name).split()
    if len(tokens) < 2:
        return None
    first, last = map(re.escape, (tokens[0], tokens[-1]))
    middle = r"(?:\s+\w+){0,3}"
    return re.compile(rf"\b(?:{first}{middle}\s+{last}|{last}{middle}\s+{first})\b")


def _name_matches(candidate: str, full_name: str) -> bool:
    pattern = _name_pattern(full_name)
    return pattern is not None and pattern.search(normalize(candidate)) is not None


def _normalised_with_offsets(value: str) -> tuple[str, list[int]]:
    """Normalize text while retaining source offsets for a bounded source excerpt."""
    characters: list[str] = []
    offsets: list[int] = []
    needs_space = False
    for offset, character in enumerate(value):
        decomposed = unicodedata.normalize("NFD", unicodedata.normalize("NFKC", character)).casefold()
        for item in decomposed:
            if unicodedata.category(item) == "Mn":
                continue
            if item.isalnum() or item == "_":
                if needs_space and characters:
                    characters.append(" ")
                    offsets.append(offset)
                characters.append(item)
                offsets.append(offset)
                needs_space = False
            else:
                needs_space = bool(characters)
    return "".join(characters), offsets


def has_person_looking_block(team_html: str) -> bool:
    """Conservatively identify a page with a likely two-token person name."""
    page = _page(team_html)
    return any(
        re.search(r"\b[a-z][a-z'-]+(?:\s+[a-z]\.)?\s+[a-z][a-z'-]+\b", normalize(text))
        for _, text in page.links
    ) or bool(re.search(r"\b[a-z][a-z'-]+(?:\s+[a-z]\.)?\s+[a-z][a-z'-]+\b", normalize(" ".join(page.text))))


# classify_kind decision tables. Title keywords are checked before org-name tokens
# because a role title is a stronger, less ambiguous signal than a firm's name
# (e.g. "Investment Banking Analyst" at "Brooks, Houghton & Company" is a bank,
# not a "startup" guessed from the org name's "& Company" suffix alone).
_TITLE_BANK_HINTS = ("investment banking", "investment banker", "ib analyst")
_TITLE_PE_HINTS = ("private equity", "buyout", "growth equity")
_TITLE_VC_HINTS = ("venture", "vc")
_TITLE_CONSULTANCY_HINTS = ("consultant", "consulting")
_TITLE_HEDGE_FUND_HINTS = (
    "hedge fund", "portfolio manager", "equity research", "trader", "asset management",
)
_TITLE_STARTUP_HINTS = ("founder", "co founder", "chief of staff", "operations")
_TITLE_ACADEMIA_HINTS = ("professor", "research assistant", "phd")

# Org-name tokens that mark a firm as fund-like, used to withhold the
# title-based "founder/operations -> startup" guess when the org is plainly
# a fund (a "Founder" at a capital-partners shop is not a startup operator).
_FUND_ORG_HINTS = (
    "capital partners", "equity partners", "buyout", "ventures", "venture partners",
    "capital management", "asset management", "hedge fund", "bank", "securities",
)

_ORG_PE_TOKENS = ("capital partners", "equity partners", "buyout")
_ORG_VC_TOKENS = ("ventures", "venture partners", "vc")
_ORG_CONSULTANCY_TOKENS = ("consulting group", "advisory")
_ORG_BANK_TOKENS = ("bank", "securities")
_ORG_HEDGE_FUND_TOKENS = ("capital management", "asset management", "investors")
_ORG_ACADEMIA_TOKENS = ("university", "college", "institute")
_ORG_GOVERNMENT_TOKENS = ("department of", "ministry", "city of")
_ORG_NONPROFIT_TOKENS = ("foundation", "nonprofit")
_ORG_STARTUP_TOKENS = ("inc", "labs", "technologies", "startup", "systems")
_ORG_BIGTECH_NAMES = (
    "google", "alphabet", "meta platforms", "facebook", "amazon", "apple",
    "microsoft", "netflix", "nvidia", "tesla", "salesforce", "oracle",
)
# Weak, ambiguous org suffix ("& Company" / "& Co") that only counts as a bank
# signal when paired with a finance-flavoured title; too many ordinary firms
# use "& Company" for it to stand alone.
_ORG_AMPERSAND_BANK_RE = re.compile(r"&\s*(?:co\.?|company)\b", re.IGNORECASE)
_FINANCE_TITLE_HINTS = ("analyst", "associate", "banker", "banking", "finance")


def _has_any(value: str, tokens: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(token)}\b", value) for token in tokens)


def classify_kind(organisation: str, title: str = "") -> str:
    """Classify an organisation, preferring title keywords over org-name tokens.

    Decision order: (a) role-title keywords, (b) org-name tokens, (c) "other".
    Deterministic and offline -- every table above is a static module constant.
    """
    org = normalize(organisation)
    role = normalize(title)

    if role:
        if _has_any(role, _TITLE_BANK_HINTS):
            return "bank"
        if _has_any(role, _TITLE_PE_HINTS):
            return "pe"
        if _has_any(role, _TITLE_VC_HINTS):
            return "vc"
        if _has_any(role, _TITLE_CONSULTANCY_HINTS):
            return "consultancy"
        if _has_any(role, _TITLE_HEDGE_FUND_HINTS):
            return "hedge_fund"
        if _has_any(role, _TITLE_ACADEMIA_HINTS):
            return "academia"
        if _has_any(role, _TITLE_STARTUP_HINTS) and not _has_any(org, _FUND_ORG_HINTS):
            return "startup"

    if _has_any(org, _ORG_PE_TOKENS):
        return "pe"
    if _has_any(org, _ORG_VC_TOKENS):
        return "vc"
    if _has_any(org, _ORG_CONSULTANCY_TOKENS):
        return "consultancy"
    if _has_any(org, _ORG_BANK_TOKENS):
        return "bank"
    if _ORG_AMPERSAND_BANK_RE.search(organisation) and _has_any(role, _FINANCE_TITLE_HINTS):
        return "bank"
    if _has_any(org, _ORG_HEDGE_FUND_TOKENS):
        return "hedge_fund"
    if _has_any(org, _ORG_ACADEMIA_TOKENS):
        return "academia"
    if _has_any(org, _ORG_GOVERNMENT_TOKENS):
        return "government"
    if _has_any(org, _ORG_NONPROFIT_TOKENS):
        return "nonprofit"
    if _has_any(org, _ORG_BIGTECH_NAMES):
        return "bigtech"
    if _has_any(org, _ORG_STARTUP_TOKENS):
        return "startup"
    return "other"


def _excerpt(value: str) -> str:
    return " ".join(value.split())[:240]


def _years(sentence: str) -> tuple[int | None, int | None]:
    years = [int(value) for value in _YEAR_RE.findall(sentence)]
    return (years[0], years[-1]) if years else (None, None)


def _school_raw(sentence: str, canonical: str) -> str:
    match = _SCHOOL_RE.search(sentence)
    return match.group(1) if match else canonical.title()


def _link_kind(url: str) -> str:
    parsed = urlsplit(url)
    haystack = f"{parsed.hostname or ''}{parsed.path}".casefold()
    if any(token in haystack for token in ("/blog", "/writing", "substack")):
        return "writing"
    if any(token in haystack for token in ("/portfolio", "/companies")):
        return "portfolio"
    if "/board" in haystack:
        return "board"
    if any(token in haystack for token in ("podcast", "spotify", "apple.com/podcast")):
        return "podcast"
    return "profile"


def parse_bio(html: str, base_url: str, anchors: SenderAnchors) -> BioFacts:
    """Extract normalised education, prior-employer, and public-link facts from inert HTML."""
    page = _page(html)
    sentences = tuple(filter(None, _SENTENCE_RE.split(" ".join(page.text))))
    education: list[EducationFact] = []
    employers: list[EmployerFact] = []
    for sentence in sentences:
        excerpt = _excerpt(sentence)
        school = anchors.schools.match(sentence)
        degree_match = _DEGREE_RE.search(sentence)
        if school is not None or degree_match is not None:
            if school is not None:
                start_year, end_year = _years(sentence)
                education.append(EducationFact(
                    school, _school_raw(sentence, school), degree_match.group(1) if degree_match else None,
                    start_year, end_year, excerpt,
                ))
        if any(marker in sentence.casefold() for marker in TRANSITIONS):
            match = _ORG_RE.search(sentence)
            if match is not None:
                raw = match.group(1).strip()
                canonical = anchors.employers.match(raw) or normalize(raw)
                start_year, end_year = _years(sentence)
                title_match = re.search(r"\b(?:was|as)\s+(?:an?\s+)?([A-Z][\w -]{1,60}?)\s+at\b", sentence)
                title = title_match.group(1).strip() if title_match else None
                employers.append(EmployerFact(
                    canonical, raw, anchors.employer_kinds.get(canonical, classify_kind(raw, title or "")),
                    title, start_year, end_year, excerpt,
                ))
    employers.sort(key=lambda fact: (fact.end_year is None, fact.end_year or 0))
    links = tuple(
        LinkFact(_link_kind(url), url, _excerpt(text))
        for href, text in page.links
        if (url := urljoin(base_url, href)).startswith("https://")
    )
    hometown = None
    hometown_match = re.search(r"\b(?:born and raised in|hometown(?: is)?|from)\s+([A-Z][A-Za-z -]+)", " ".join(sentences))
    if hometown_match:
        hometown = normalize(hometown_match.group(1))
    return BioFacts(tuple(education), tuple(employers), links, page.has_about, hometown)


def observation_id(person_id: str, field: str, value: Mapping[str, object]) -> str:
    """Return the canonical, content-addressed observation identifier for one fact."""
    payload = json.dumps(
        {"person_id": person_id, "field": field, "value": value},
        sort_keys=True, separators=(",", ":"),
    )
    return "obs_" + sha256(payload.encode()).hexdigest()[:32]


def _insert_observation(connection: object, person_id: str, snapshot_id: str, field: str,
                        value: Mapping[str, object], now: str, confidence: float) -> tuple[str, bool]:
    identifier = observation_id(person_id, field, value)
    cursor = connection.execute(
        "INSERT OR IGNORE INTO source_observation("
        "observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence"
        ") VALUES(?,?,?,?,?,?,?,?)",
        (identifier, "person", person_id, field,
         json.dumps(value, sort_keys=True, separators=(",", ":")), snapshot_id, now, confidence),
    )
    return identifier, cursor.rowcount == 1


def chronological_kind_sequence(
    rows: Sequence[tuple[int, int | None, int | None, str]],
) -> tuple[list[str], str | None]:
    """Order ``(ordinal, start_year, end_year, kind)`` rows oldest-to-newest.

    Primary sort is ``start_year`` ascending with a missing year sorted last; ties
    (equal, including both missing) break on ``ordinal`` descending. Consecutive
    duplicate kinds collapse into one, and a bare ``"other"`` is dropped unless it
    is the only kind remaining. The current kind is the role whose ``end_year`` is
    ``None`` (still held), or otherwise the chronologically latest role.
    """
    if not rows:
        return [], None
    ordered = sorted(rows, key=lambda row: (row[1] is None, row[1] or 0, -row[0]))
    sequence: list[str] = []
    for _ordinal, _start_year, _end_year, kind in ordered:
        if not sequence or sequence[-1] != kind:
            sequence.append(kind)
    if len(sequence) > 1:
        sequence = [kind for kind in sequence if kind != "other"] or sequence
    current = next((row for row in ordered if row[2] is None), ordered[-1])
    return sequence, current[3]


def persist_bio_facts(connection: object, person_id: str, snapshot_id: str, facts: BioFacts,
                      now: str, confidence: float = 0.8) -> int:
    """Persist facts idempotently and return the number of new observations."""
    inserted = 0
    for ordinal, fact in enumerate(facts.education):
        value = asdict(fact)
        identifier, new = _insert_observation(connection, person_id, snapshot_id, "education", value, now, confidence)
        inserted += int(new)
        connection.execute(
            "INSERT INTO person_education(person_id,ordinal,school_norm,school_raw,degree,start_year,end_year,observation_id) "
            "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(person_id,ordinal) DO NOTHING",
            (person_id, ordinal, fact.school_norm, fact.school_raw, fact.degree, fact.start_year, fact.end_year, identifier),
        )
    for ordinal, fact in enumerate(facts.employers):
        value = asdict(fact)
        identifier, new = _insert_observation(connection, person_id, snapshot_id, "employer", value, now, confidence)
        inserted += int(new)
        connection.execute(
            "INSERT INTO person_employer(person_id,ordinal,employer_norm,employer_raw,employer_kind,title,start_year,end_year,observation_id) "
            "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(person_id,ordinal) DO NOTHING",
            (person_id, ordinal, fact.employer_norm, fact.employer_raw, fact.employer_kind, fact.title,
             fact.start_year, fact.end_year, identifier),
        )
    for ordinal, fact in enumerate(facts.links):
        value = asdict(fact)
        identifier, new = _insert_observation(connection, person_id, snapshot_id, "link", value, now, confidence)
        inserted += int(new)
        connection.execute(
            "INSERT INTO person_link(person_id,ordinal,kind,url,observation_id) VALUES(?,?,?,?,?) "
            "ON CONFLICT(person_id,ordinal) DO NOTHING",
            (person_id, ordinal, fact.kind, fact.url, identifier),
        )
    kind_sequence, current_kind = chronological_kind_sequence([
        (ordinal, fact.start_year, fact.end_year, fact.employer_kind)
        for ordinal, fact in enumerate(facts.employers)
    ])
    connection.execute(
        "INSERT INTO person_background(person_id,has_about,hometown_hint,current_kind,kind_sequence,updated_at) "
        "VALUES(?,?,?,?,?,?) ON CONFLICT(person_id) DO UPDATE SET has_about=excluded.has_about, "
        "hometown_hint=excluded.hometown_hint,current_kind=excluded.current_kind, "
        "kind_sequence=excluded.kind_sequence,updated_at=excluded.updated_at",
        (person_id, int(facts.has_about), facts.hometown_hint, current_kind or "other",
         json.dumps(kind_sequence), now),
    )
    return inserted
