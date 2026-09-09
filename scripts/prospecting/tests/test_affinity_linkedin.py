"""Synthetic checks for gap-only LinkedIn background backfill."""

from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import asdict
from pathlib import Path
import uuid

import pytest

from scripts.prospecting.affinity.anchors import SenderAnchors, load_anchors
from scripts.prospecting.affinity.bio import parse_bio
from scripts.prospecting.affinity.linkedin import backfill_person, needs_linkedin, parse_profile_background
from scripts.prospecting.linkedin_lane import LinkedInAssistedLane, LinkedInBudget
from scripts.prospecting.store import open_store


FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "orgs"
    / "prospecting"
    / "fixtures"
    / "affinity"
)
PROFILE = FIXTURES / "linkedin-profile-synthetic.html"
ANCHORS_PATH = FIXTURES / "sender-anchors-synthetic.json"
BIO_WITH_EDUCATION = FIXTURES / "bio-person-full.html"
EXPERIENCE_SHAPE1 = FIXTURES / "linkedin-profile-experience-shape1.html"
EXPERIENCE_SHAPE2 = FIXTURES / "linkedin-profile-experience-shape2.html"
EXPERIENCE_MIXED = FIXTURES / "linkedin-profile-experience-mixed.html"
EXPERIENCE_GROUPED_INTERLEAVED = FIXTURES / "linkedin-profile-experience-grouped-interleaved.html"
EXPERIENCE_BARE_DURATION = FIXTURES / "linkedin-profile-experience-bare-duration.html"
EDUCATION_MIXED = FIXTURES / "linkedin-profile-education-mixed.html"
EDUCATION_EMPTY = FIXTURES / "linkedin-profile-education-empty.html"
URL = "file:///synthetic-profile.html"
CHECKPOINT_HTML = "<main>synthetic checkpoint</main>"


class Clock:
    def now(self) -> datetime:
        return datetime(2099, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class Rng:
    def randint(self, low: int, high: int) -> int:
        assert (low, high) == (45, 120)
        return 45


@pytest.fixture
def budget_db() -> object:
    return open_store(Path(":memory:"))


@pytest.fixture
def fake_clock() -> Clock:
    return Clock()


@pytest.fixture
def anchors() -> SenderAnchors:
    return load_anchors(ANCHORS_PATH)


@pytest.fixture
def lane(fake_clock: Clock, budget_db: object) -> LinkedInAssistedLane:
    return LinkedInAssistedLane(fake_clock, budget_db, Rng(), lambda _: None)


@pytest.fixture
def budget(budget_db: object, fake_clock: Clock) -> LinkedInBudget:
    return LinkedInBudget(budget_db, fake_clock)


def _forbidden(url: str) -> str:
    raise AssertionError(f"profile load unexpectedly requested: {url}")


def test_a_candidate_whose_bio_had_education_never_needs_linkedin(
    anchors: SenderAnchors, record_property: pytest.RecordProperty
) -> None:
    facts = parse_bio(BIO_WITH_EDUCATION.read_text(encoding="utf-8"), "https://alpha.test/team/one", anchors)
    assert not needs_linkedin(facts)
    record_property("linkedin_loads_over_cap", 0)


def test_the_p8_driver_is_counted_by_the_shared_cap(
    lane: LinkedInAssistedLane, budget: LinkedInBudget, anchors: SenderAnchors
) -> None:
    for _ in range(40):
        budget.mark_success(str(uuid.uuid4()), URL)
    assert budget.cap_reached()
    outcome = backfill_person(lane, budget, "per_synthetic_2", URL, _forbidden, anchors, max_linkedin=5, used=0)
    assert outcome.linkedin_state == "cap_reached" and outcome.reason == "linkedin_cap_reached"


def test_a_checkpoint_page_stops_and_never_loads_again(
    lane: LinkedInAssistedLane, budget: LinkedInBudget, budget_db: object, anchors: SenderAnchors
) -> None:
    outcome = backfill_person(lane, budget, "per_synthetic_3", URL, lambda _: CHECKPOINT_HTML, anchors, max_linkedin=5, used=0)
    assert outcome.linkedin_state == "checkpoint"
    assert budget_db.execute(
        "SELECT count(*) FROM linkedin_checkpoint_stop WHERE cleared_at IS NULL"
    ).fetchone()[0] == 1


def test_max_linkedin_zero_disables_the_lane(
    lane: LinkedInAssistedLane, budget: LinkedInBudget, anchors: SenderAnchors
) -> None:
    outcome = backfill_person(lane, budget, "per_synthetic_4", URL, _forbidden, anchors, max_linkedin=0, used=0)
    assert outcome.linkedin_state == "disabled" and outcome.reason == "linkedin_disabled"


def test_background_parse_recovers_education_and_prior_employer(anchors: SenderAnchors) -> None:
    facts = parse_profile_background(PROFILE.read_text(encoding="utf-8"), anchors)
    assert [asdict(fact) for fact in facts.education] == [{
        "school_norm": "newtown university",
        "school_raw": "Newtown University",
        "degree": "BBA",
        "start_year": 2099,
        "end_year": 2103,
        "excerpt": "Newtown University BBA 2099 - 2103",
    }]
    assert [asdict(fact) for fact in facts.employers] == [
        {
            "employer_norm": "meridian bank",
            "employer_raw": "Meridian Bank",
            "employer_kind": "bank",
            "title": "Analyst",
            "start_year": 2099,
            "end_year": 2101,
            "excerpt": "Analyst Meridian Bank · Full-time Jan 2099 - Dec 2101 · 2 yrs 11 mos",
        },
        {
            "employer_norm": "meridian bank",
            "employer_raw": "Meridian Bank",
            "employer_kind": "bank",
            "title": "Associate",
            "start_year": 2102,
            "end_year": None,
            "excerpt": "Associate Meridian Bank Feb 2102 - Present",
        },
    ]


@pytest.mark.parametrize(
    ("fixture", "expected_count", "first"),
    [
        (
            EXPERIENCE_SHAPE1,
            2,
            {
                "employer_norm": "acme ventures",
                "employer_raw": "Acme Ventures",
                "title": "Associate",
                "start_year": 2095,
                "end_year": None,
            },
        ),
        (
            EXPERIENCE_SHAPE2,
            2,
            {
                "employer_norm": "beta consulting group bcg",
                "employer_raw": "Beta Consulting Group (BCG)",
                "title": "Associate",
                "start_year": 2091,
                "end_year": 2093,
            },
        ),
        (
            EXPERIENCE_MIXED,
            4,
            {
                "employer_norm": "acme ventures",
                "employer_raw": "Acme Ventures",
                "title": "Associate",
                "start_year": 2095,
                "end_year": None,
            },
        ),
    ],
)
def test_experience_shapes_recover_every_role(
    anchors: SenderAnchors, fixture: Path, expected_count: int, first: dict[str, object]
) -> None:
    facts = parse_profile_background(fixture.read_text(encoding="utf-8"), anchors)
    assert len(facts.employers) == expected_count
    first_fact = asdict(facts.employers[0])
    for key, value in first.items():
        assert first_fact[key] == value


def test_experience_mixed_shapes_attribute_grouped_roles_to_the_header_company() -> None:
    anchors = load_anchors(ANCHORS_PATH)
    facts = parse_profile_background(EXPERIENCE_MIXED.read_text(encoding="utf-8"), anchors)
    employers = [asdict(fact) for fact in facts.employers]
    assert [(fact["title"], fact["employer_raw"]) for fact in employers] == [
        ("Associate", "Acme Ventures"),
        ("Analyst", "Acme Ventures"),
        ("Associate", "Beta Consulting Group (BCG)"),
        ("Venture Capital Fellow", "Gamma Ventures"),
    ]
    assert [fact["start_year"] for fact in employers] == [2095, 2093, 2091, 2090]
    assert employers[1]["end_year"] == 2094


def test_experience_grouped_interleaved_attributes_each_role_to_the_right_company(
    anchors: SenderAnchors,
) -> None:
    """Real-profile defect shape: a comma-separated skills-list line sits between two
    grouped roles under the same header, and a shape-2 entry immediately follows.
    Both grouped roles must inherit the header company, not each other's fields.
    """
    facts = parse_profile_background(EXPERIENCE_GROUPED_INTERLEAVED.read_text(encoding="utf-8"), anchors)
    employers = [asdict(fact) for fact in facts.employers]
    assert [(fact["employer_raw"], fact["title"], fact["start_year"], fact["end_year"]) for fact in employers] == [
        ("Rivergate Ventures", "Associate", 2095, None),
        ("Rivergate Ventures", "Analyst", 2093, 2094),
        ("Boston Consulting Group (BCG)", "Associate", 2091, 2093),
    ]


def test_experience_bare_duration_header_with_workplace_suffix_still_groups(
    anchors: SenderAnchors,
) -> None:
    """A group header's second line can be a bare duration (no employment type),
    and a date-range line can carry a trailing "· Hybrid" workplace-type suffix;
    neither should be mistaken for a title or company.
    """
    facts = parse_profile_background(EXPERIENCE_BARE_DURATION.read_text(encoding="utf-8"), anchors)
    employers = [asdict(fact) for fact in facts.employers]
    assert [(fact["employer_raw"], fact["title"], fact["start_year"], fact["end_year"]) for fact in employers] == [
        ("Quantum Peak Advisors", "Managing Director", 2085, None),
        ("Quantum Peak Advisors", "Vice President", 2080, 2084),
    ]


def test_education_mixed_recovers_every_school_incl_one_without_years(
    anchors: SenderAnchors,
) -> None:
    facts = parse_profile_background(EDUCATION_MIXED.read_text(encoding="utf-8"), anchors)
    assert len(facts.education) == 3
    first = asdict(facts.education[0])
    assert first["school_raw"] == "Villanova-like University"
    assert first["school_norm"] == "villanova like university"
    assert first["degree"] == "Bachelor of Business Administration, Finance"
    assert first["start_year"] == 2087
    assert first["end_year"] == 2091
    second = asdict(facts.education[1])
    assert second["school_raw"] == "East Town High School"
    assert second["start_year"] == 2083
    assert second["end_year"] == 2087
    third = asdict(facts.education[2])
    assert third["school_raw"] == "Sloan-like School of Management"
    assert third["degree"] == "Deferred Admission"
    assert third["start_year"] is None
    assert third["end_year"] is None


def test_education_empty_section_yields_no_entries(anchors: SenderAnchors) -> None:
    facts = parse_profile_background(EDUCATION_EMPTY.read_text(encoding="utf-8"), anchors)
    assert facts.education == ()
