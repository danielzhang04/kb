"""Gap-only LinkedIn background parsing on the existing assisted-lane controls."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
import re

from scripts.prospecting import browser_guard
from scripts.prospecting.browser_guard import BrowserPolicy, check_navigation, detect_stop
from scripts.prospecting.linkedin_lane import LinkedInAssistedLane, LinkedInBudget

from .anchors import SenderAnchors, normalize
from .bio import BioFacts, EducationFact, EmployerFact, classify_kind


_MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
_YEAR = r"(?:19|20|21)\d{2}"
_DATE_RANGE_RE = re.compile(
    rf"(?P<start>{_MONTH}\s+(?P<start_year>{_YEAR}))\s*[-\u2013\u2014]\s*"
    rf"(?P<end>Present|{_MONTH}\s+(?P<end_year>{_YEAR}))",
    re.IGNORECASE,
)
_YEAR_RANGE_RE = re.compile(rf"(?P<start>{_YEAR})\s*[-\u2013\u2014]\s*(?P<end>{_YEAR})")
_SECTION_HEADINGS = frozenset({
    "experience", "education", "licenses", "licenses & certifications", "skills",
    "people also viewed", "interests", "volunteering", "courses", "projects",
    "recommendations", "publications", "honors & awards", "organizations", "languages",
    "more profiles for you",
})

_EMPLOYMENT_TYPE = (
    r"(?:Full-time|Part-time|Self-employed|Freelance|Contract(?:or)?|Internship|"
    r"Apprenticeship|Seasonal|Trainee|Temporary)"
)
_DURATION = (
    r"\d+\s*(?:yrs?|years?)(?:\s+\d+\s*(?:mos?|months?))?|\d+\s*(?:mos?|months?)"
)
_WORKPLACE_TYPE = r"(?:Hybrid|On-?site|Remote)"
# A group header's second line is either "<Type>", "<Type> \u00b7 <duration>", or a
# bare "<duration>" alone (LinkedIn omits the type on some grouped entries),
# optionally followed by a "\u00b7 Hybrid/On-site/Remote" workplace-type suffix.
_TYPE_ONLY_RE = re.compile(
    rf"^(?:{_EMPLOYMENT_TYPE}(?:\s*\u00b7\s*(?:{_DURATION}))?|{_DURATION})"
    rf"(?:\s*\u00b7\s*{_WORKPLACE_TYPE})?$",
    re.IGNORECASE,
)
_IGNORABLE_LINE_RE = re.compile(
    rf"^(?:Skills:|Show all \d+ media\b|\u00b7?\s*{_WORKPLACE_TYPE}\s*$)", re.IGNORECASE
)
_DEGREE_RE = re.compile(
    r"\b(?:Bachelor|Master|Associate|Doctor|MBA|BBA|BA|BS|JD|PhD|MS|MSc|AB|"
    r"Diploma|Certificate|Admission|Deferred)\b",
    re.IGNORECASE,
)
_ACTIVITIES_RE = re.compile(r"^Activities and societies:", re.IGNORECASE)
_SCHOOL_LINE_RE = re.compile(
    r"^[A-Z][\w.'()-]*(?:\s+(?:[A-Z][\w.'()-]*|of|and|the|for|at))*$"
)


def _is_ignorable(line: str) -> bool:
    """Return whether a visible-text line is optional trailing noise, never a role/school."""
    stripped = line.strip()
    if not stripped:
        return True
    if _IGNORABLE_LINE_RE.match(stripped):
        return True
    return "," in stripped or stripped.endswith(".")


def _available(lines: list[str], index: int, consumed: set[int]) -> bool:
    """Return whether a line can still serve as an unclaimed title/company candidate."""
    if index < 0 or index >= len(lines) or index in consumed:
        return False
    line = lines[index]
    if _is_ignorable(line) or _DATE_RANGE_RE.search(line) is not None:
        return False
    return _TYPE_ONLY_RE.match(line.strip()) is None


class _VisibleText(HTMLParser):
    """Collect inert visible text while preserving the profile's line breaks."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data)


def _sections(html: str) -> dict[str, list[str]]:
    parser = _VisibleText()
    parser.feed(html)
    parser.close()
    sections = {"experience": [], "education": []}
    current: str | None = None
    for raw_line in "\n".join(parser.parts).splitlines():
        line = " ".join(raw_line.split())
        heading = line.casefold().rstrip(":")
        if heading in _SECTION_HEADINGS:
            current = heading if heading in sections else None
        elif current is not None:
            sections[current].append(line)
    return sections


def _employer_facts(lines: list[str], anchors: SenderAnchors) -> tuple[EmployerFact, ...]:
    """Recover every role, attributing grouped roles to their shared company header.

    Two on-page shapes are both anchored on the date-range line: shape 2 is
    "Title / Company [· Type] / date-range" (3 unclaimed lines); shape 1 is a
    company header followed by a bare "Type · duration" line, then one or more
    "Title / date-range" pairs (2 lines) that inherit the header's company.
    """
    employers: list[EmployerFact] = []
    current_company: str | None = None
    consumed: set[int] = set()
    total = len(lines)
    for index in range(total):
        if index in consumed:
            continue
        line = lines[index]
        date_match = _DATE_RANGE_RE.search(line)
        if date_match is not None:
            consumed.add(index)
            title: str | None = None
            company_raw: str | None = None
            excerpt_lines: list[str] = []
            if _available(lines, index - 2, consumed) and _available(lines, index - 1, consumed):
                title = lines[index - 2].strip() or None
                company_raw = lines[index - 1].split("·", 1)[0].strip()
                excerpt_lines = [lines[index - 2], lines[index - 1], line]
                consumed.update({index - 2, index - 1})
            elif current_company and _available(lines, index - 1, consumed):
                title = lines[index - 1].strip() or None
                company_raw = current_company
                excerpt_lines = [lines[index - 1], line]
                consumed.add(index - 1)
            if not company_raw:
                continue
            canonical = anchors.employers.match(company_raw) or normalize(company_raw)
            employers.append(EmployerFact(
                canonical, company_raw,
                anchors.employer_kinds.get(canonical, classify_kind(company_raw, title or "")), title,
                int(date_match.group("start_year")),
                None if date_match.group("end").casefold() == "present" else int(date_match.group("end_year")),
                " ".join(excerpt_lines).strip()[:240],
            ))
            current_company = company_raw
            continue
        if (
            index + 1 < total
            and not _is_ignorable(line)
            and _TYPE_ONLY_RE.match(line.strip()) is None
            and _TYPE_ONLY_RE.match(lines[index + 1].strip()) is not None
        ):
            current_company = line.split("·", 1)[0].strip()
            consumed.update({index, index + 1})
    return tuple(employers)


def _education_facts(lines: list[str], anchors: SenderAnchors) -> tuple[EducationFact, ...]:
    """Recover every school in the section, not only ones present in the sender's anchors.

    Entries are school line, optional degree line, optional "YYYY – YYYY" line;
    a school may carry neither. A new school line flushes the entry in progress,
    so anchoring must not require an anchors match (that was the defect: unknown
    schools were silently dropped).
    """
    education: list[EducationFact] = []
    school_raw: str | None = None
    degree: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    entry_lines: list[str] = []

    def _flush() -> None:
        if school_raw is None:
            return
        canonical = anchors.schools.match(school_raw) or normalize(school_raw)
        education.append(EducationFact(
            canonical, school_raw, degree, start_year, end_year,
            " ".join(entry_lines).strip()[:240],
        ))

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        year_match = _YEAR_RANGE_RE.search(stripped)
        if year_match is not None and school_raw is not None:
            start_year, end_year = int(year_match.group("start")), int(year_match.group("end"))
            entry_lines.append(line)
            continue
        if _ACTIVITIES_RE.match(stripped):
            continue
        if _DEGREE_RE.search(stripped) and school_raw is not None:
            if degree is None:
                degree = stripped
            entry_lines.append(line)
            continue
        if _SCHOOL_LINE_RE.match(stripped):
            _flush()
            school_raw, degree, start_year, end_year = stripped, None, None, None
            entry_lines = [line]
            continue
        # unrecognised prose (e.g. a stray description line) is ignored.
    _flush()
    return tuple(education)


def needs_linkedin(facts: BioFacts) -> bool:
    """Return whether a bio page left both background gaps unanswered."""
    return not facts.education and not facts.employers


def parse_profile_background(html: str, anchors: SenderAnchors) -> BioFacts:
    """Extract labelled LinkedIn Experience and Education visible-text sections."""
    sections = _sections(html)
    return BioFacts(
        _education_facts(sections["education"], anchors),
        _employer_facts(sections["experience"], anchors),
        (), False, None,
    )


@dataclass(frozen=True)
class BackfillOutcome:
    person_id: str
    linkedin_state: str
    reason: str
    loads_used: int
    facts: BioFacts | None


def backfill_person(
    lane: LinkedInAssistedLane,
    budget: LinkedInBudget,
    person_id: str,
    profile_url: str,
    page_html: Callable[[str], str],
    anchors: SenderAnchors,
    max_linkedin: int,
    used: int,
) -> BackfillOutcome:
    """Load one profile through the shared guard, budget, and checkpoint primitives."""
    if max_linkedin <= 0 or used >= max_linkedin:
        return BackfillOutcome(person_id, "disabled", "linkedin_disabled", 0, None)
    if lane._checkpoint_stop_active():
        return BackfillOutcome(person_id, "checkpoint", "linkedin_checkpoint_stop", 0, None)
    check_navigation(profile_url, BrowserPolicy((browser_guard.LINKEDIN_HOST,)))
    if budget.cap_reached() or not budget.may_navigate():
        return BackfillOutcome(person_id, "cap_reached", "linkedin_cap_reached", 0, None)
    load_id = budget.reserve_navigation(profile_url)
    if load_id is None:
        return BackfillOutcome(person_id, "cap_reached", "linkedin_cap_reached", 0, None)
    html = page_html(profile_url)
    stop = detect_stop(html)
    if stop:
        lane._persist_checkpoint_stop(stop)
        lane.on_stop(stop)
        return BackfillOutcome(person_id, "checkpoint", "linkedin_checkpoint_stop", 0, None)
    budget.mark_success(load_id, profile_url)
    return BackfillOutcome(
        person_id,
        "loaded",
        "linkedin_loaded",
        1,
        parse_profile_background(html, anchors),
    )
