"""Synthetic checks for inert firm-bio parsing and persistence."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.prospecting.affinity.anchors import SenderAnchors, load_anchors
from scripts.prospecting.affinity.bio import (
    BioFacts,
    EmployerFact,
    chronological_kind_sequence,
    classify_kind,
    parse_bio,
    persist_bio_facts,
    person_bio_url,
    person_block,
    team_index_url,
)
from scripts.prospecting.store import open_store


FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "orgs"
    / "prospecting"
    / "fixtures"
    / "affinity"
)
FULL = FIXTURES / "bio-person-full.html"
NO_EDUCATION = FIXTURES / "bio-person-no-education.html"
ANCHORS = FIXTURES / "sender-anchors-synthetic.json"
URL = "https://alpha.test/team/one"
NOW = "2099-01-02T03:04:05Z"


@pytest.fixture
def anchors() -> SenderAnchors:
    return load_anchors(ANCHORS)


def _seed(tmp_path: Path) -> tuple[object, str, str]:
    connection = open_store(tmp_path / "store.sqlite")
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        ("company-synthetic", "Alpha Ventures", "manual", "alpha-ventures"),
    )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) "
        "VALUES(?,?,?,?,?)",
        ("person-synthetic", "Morgan", "Morgan Example", "manual", "morgan-example"),
    )
    return connection, "person-synthetic", "snapshot-synthetic"


def test_team_index_is_chosen_only_from_the_same_host() -> None:
    html = '<a href="/our-team">Team</a><a href="https://other.test/team">Team</a>'
    assert team_index_url(html, "https://alpha.test/") == "https://alpha.test/our-team"


def test_person_matching_allows_middle_initials_reversed_tokens_and_diacritics() -> None:
    html = '<a href="/people/zoe">Álvarez, Zoë Q. </a><p>Zoë Q. Álvarez earned a BA.</p>'
    assert person_bio_url(html, "https://alpha.test/people", "Zoe Alvarez") == "https://alpha.test/people/zoe"
    assert person_block(html, "Zoe Alvarez") is not None


def test_bio_yields_education_employer_and_links(anchors: SenderAnchors) -> None:
    facts = parse_bio(FULL.read_text(encoding="utf-8"), URL, anchors)
    assert [(e.school_norm, e.end_year) for e in facts.education] == [("newtown university", 2014)]
    assert [(e.employer_norm, e.employer_kind) for e in facts.employers] == [
        ("meridian bank", "bank"), ("harborline systems", "startup")
    ]
    assert {link.kind for link in facts.links} == {"writing", "board"}
    assert all(len(fact.excerpt) <= 240 for fact in facts.education + facts.employers)


def test_a_bio_without_education_reports_none(anchors: SenderAnchors) -> None:
    facts = parse_bio(NO_EDUCATION.read_text(encoding="utf-8"), URL, anchors)
    assert facts.education == () and facts.employers == ()


@pytest.mark.parametrize(
    ("organisation", "title", "expected"),
    [
        # Real misclassification #1 (masked/synthetic, shape exact): an org-name
        # token match previously sent "capital partners" to vc; it must be pe.
        ("Seminal Capital Partners", "", "pe"),
        # Real misclassification #2 (masked/synthetic): org-name-only
        # classification could not see this is a bank; the role title can.
        ("Brooks, Houghton & Company", "Investment Banking Analyst", "bank"),
        # Title keywords take precedence over org-name tokens.
        ("Fictitious Holdings", "Private Equity Associate", "pe"),
        ("Fictitious Holdings", "Venture Partner", "vc"),
        ("Fictitious Holdings", "Management Consultant", "consultancy"),
        ("Fictitious Holdings", "Portfolio Manager", "hedge_fund"),
        ("Fictitious Holdings", "Research Assistant", "academia"),
        ("Fictitious Holdings", "Founder", "startup"),
        # A "Founder" at a plainly fund-shaped org is not a startup operator.
        ("Northbridge Capital Partners", "Founder", "pe"),
        # Org-name-token branch, one row per bucket.
        ("Willowmere Ventures", "", "vc"),
        ("North Ridge Consulting Group", "", "consultancy"),
        ("Example Federal Bank", "", "bank"),
        ("Sample Capital Management", "", "hedge_fund"),
        ("Placeholder Institute of Technology", "", "academia"),
        ("Department of Fictional Affairs", "", "government"),
        ("Helping Hands Foundation", "", "nonprofit"),
        ("Meta Platforms", "", "bigtech"),
        ("Nimbus Labs Inc", "", "startup"),
        # No signal in either field falls through to the static default.
        ("Unremarkable Widget Co", "", "other"),
    ],
)
def test_classify_kind_covers_every_branch(organisation: str, title: str, expected: str) -> None:
    assert classify_kind(organisation, title) == expected


def test_classify_kind_keeps_positional_single_argument_compatibility() -> None:
    assert classify_kind("Willowmere Ventures") == "vc"


def test_observation_id_is_content_addressed_so_a_reparse_is_a_no_op(
    tmp_path: Path, anchors: SenderAnchors, record_property: pytest.RecordProperty
) -> None:
    connection, person_id, snapshot_id = _seed(tmp_path)
    facts = parse_bio(FULL.read_text(encoding="utf-8"), URL, anchors)
    first = persist_bio_facts(connection, person_id, snapshot_id, facts, NOW)
    second = persist_bio_facts(connection, person_id, snapshot_id, facts, NOW)
    rows = connection.execute("SELECT count(*) FROM source_observation").fetchone()[0]
    assert first > 0 and second == 0 and rows == first
    record_property("bio_reparse_new_rows", second)


def test_chronological_kind_sequence_orders_by_start_year_drops_other_and_picks_the_open_role() -> None:
    # (ordinal, start_year, end_year, kind); ordinal deliberately does not track start_year,
    # so a correct result proves the sort keys off start_year, never row/ordinal position.
    rows = (
        (0, 2093, None, "vc"),
        (1, 2087, 2089, "other"),
        (2, 2091, 2093, "consultancy"),
        (3, 2089, 2091, "pe"),
    )
    sequence, current_kind = chronological_kind_sequence(rows)
    assert sequence == ["pe", "consultancy", "vc"]
    assert current_kind == "vc"


def test_chronological_kind_sequence_keeps_a_lone_other_and_collapses_duplicates() -> None:
    assert chronological_kind_sequence([(0, 2010, 2012, "other")]) == (["other"], "other")
    assert chronological_kind_sequence([
        (0, 2010, 2012, "bank"), (1, 2012, 2014, "bank"), (2, 2014, None, "vc"),
    ]) == (["bank", "vc"], "vc")
    assert chronological_kind_sequence([]) == ([], None)


def test_chronological_kind_sequence_falls_back_to_latest_start_year_when_nothing_is_open() -> None:
    sequence, current_kind = chronological_kind_sequence([(0, 2010, 2012, "bank"), (1, 2012, 2015, "vc")])
    assert (sequence, current_kind) == (["bank", "vc"], "vc")


def test_persist_bio_facts_writes_a_chronological_deduped_kind_sequence_and_current_kind(
    tmp_path: Path,
) -> None:
    connection, person_id, snapshot_id = _seed(tmp_path)
    # Facts arrive in the bio's own most-recent-first prose order; persistence must still
    # write them oldest-to-newest, dropping the "other" role and picking the open one as current.
    facts = BioFacts(
        education=(),
        employers=(
            EmployerFact("acme ventures", "Acme Ventures", "vc", None, 2093, None, "current vc role"),
            EmployerFact("beta consultants", "Beta Consultants", "consultancy", None, 2091, 2093, "consultancy stint"),
            EmployerFact("gamma partners", "Gamma Partners", "pe", None, 2089, 2091, "pe stint"),
            EmployerFact("delta industries", "Delta Industries", "other", None, 2087, 2089, "first job"),
        ),
        links=(), has_about=False, hometown_hint=None,
    )
    persist_bio_facts(connection, person_id, snapshot_id, facts, NOW)
    row = connection.execute(
        "SELECT current_kind, kind_sequence FROM person_background WHERE person_id=?", (person_id,)
    ).fetchone()
    assert row["current_kind"] == "vc"
    assert json.loads(row["kind_sequence"]) == ["pe", "consultancy", "vc"]


def test_persist_bio_facts_writes_other_when_it_is_the_only_employer_fact(tmp_path: Path) -> None:
    connection, person_id, snapshot_id = _seed(tmp_path)
    facts = BioFacts(
        education=(),
        employers=(EmployerFact("delta industries", "Delta Industries", "other", None, 2020, None, "only job"),),
        links=(), has_about=False, hometown_hint=None,
    )
    persist_bio_facts(connection, person_id, snapshot_id, facts, NOW)
    row = connection.execute(
        "SELECT current_kind, kind_sequence FROM person_background WHERE person_id=?", (person_id,)
    ).fetchone()
    assert row["current_kind"] == "other"
    assert json.loads(row["kind_sequence"]) == ["other"]
