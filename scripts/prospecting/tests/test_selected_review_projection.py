"""P25 selected forward projection over the genuine P15-P20 fixture pipeline.

The selection comes from the real intake/funding/person-import/qualification/
ranking fixtures.  No fill, contact, affinity, approval or shadow table is created
anywhere, and nothing is materialized before the projection is asserted.
"""

from __future__ import annotations

import dataclasses
from datetime import timezone
from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.review_service import ReviewService
from scripts.prospecting.selected_draft_service import SelectedDraftError
from scripts.prospecting.selected_review_projection import (
    PROJECTION_VERSION,
    build_selected_pipeline_projection,
)
from scripts.prospecting.tests.test_person_research_service import CAMPAIGN_ID
from scripts.prospecting.tests.test_selected_draft_service import (
    EDIT_ONE,
    SECOND,
    _drift_sender,
    _human_edit,
    _request,
    _service,
)
from scripts.prospecting.tests.test_selected_person_render import (
    LEGACY_TABLES,
    _counts,
    _render_ready,
)
from scripts.prospecting.tests.test_selected_person_source import NOW


NOW_TEXT = NOW.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
COMPANY_NAME = "Nimbus Systems"
NEWER_TITLE = "Chief Operating Officer"
NEWER_COMPANY_ID = "co_reviewsecondcompany"
NEWER_COMPANY_NAME = "Second Synthetic"
NEWER_EMPLOYMENT_ID = "emp_reviewnewerrole"
NEWER_OBSERVATION_ID = "obs_reviewnewerrole"
# Written into the bound snapshot body to invalidate it; it must never surface in
# a projected refusal.
STALE_SENTINEL = "PRIVATE SENTINEL"
# Applied to a *copy* of an already projected view, never to stored identity.
SENTINEL_EMAIL = "PRIVATE EMAIL SENTINEL"
SENTINEL_URL = "https://example.test/PRIVATE-SENTINEL-URL"
# Injected only into the chosen hint query; it stands for the dynamic driver text
# that must never reach a projected refusal.
DRIVER_TEXT = "PRIVATE DRIVER TEXT"


class _BindingQueryFailingConnection:
    """Delegate every statement to the real store, failing only binding reads.

    Exactly one class of read is broken: statements touching
    ``selected_draft_binding``.  Pipeline, ranking, qualification, snapshot and
    revision-head reads all run against the genuine connection, so this exercises a
    failed *hint* query rather than a globally unusable store.
    """

    def __init__(self, connection) -> None:
        self._connection = connection
        self._connection.row_factory = sqlite3.Row
        self.failures = 0

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def execute(self, sql, *parameters):
        if "FROM SELECTED_DRAFT_BINDING" in " ".join(str(sql).split()).upper():
            self.failures += 1
            raise sqlite3.OperationalError(f"disk I/O error - {DRIVER_TEXT}")
        return self._connection.execute(sql, *parameters)


class _MissingBindingTableConnection:
    """Delegate everything, but report the P22 binding table as absent.

    This stands in for a store that predates P22.  Only the ``sqlite_master``
    existence probe for ``selected_draft_binding`` is answered with a real but
    empty cursor; every other read, including the revision-head read, is genuine.
    """

    def __init__(self, connection) -> None:
        self._connection = connection
        self._connection.row_factory = sqlite3.Row

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def execute(self, sql, *parameters):
        text = " ".join(str(sql).split()).upper()
        supplied = parameters[0] if parameters else ()
        if "FROM SQLITE_MASTER" in text and "selected_draft_binding" in tuple(supplied):
            return self._connection.execute("SELECT 1 WHERE 0")
        return self._connection.execute(sql, *parameters)


def _review(connection) -> ReviewService:
    return ReviewService(connection, now=lambda: NOW_TEXT)


def _listed(review: ReviewService, person_id: str):
    return {item.person_id: item for item in review.list_people(CAMPAIGN_ID)}[person_id]


def _newer_employment(connection, source, title: str) -> str:
    """Insert one unrelated newer open employment for the exact selected person.

    The row is written with explicit named columns at one explicitly created
    synthetic company, mirroring the second-company fixture already used by
    ``test_selected_person_source``.  A same-company copy would violate the real
    ``UNIQUE(employment.person_id, company_id)`` constraint; a *different* company
    with a later ``valid_from`` preserves that constraint while still being the row
    the legacy latest-employment subquery would prefer.
    """
    snapshot_id = connection.execute(
        "SELECT snapshot_id FROM source_snapshot ORDER BY snapshot_id LIMIT 1",
    ).fetchone()[0]
    connection.execute(
        """INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key)
           VALUES(?,?,?,?,?)""",
        (
            NEWER_COMPANY_ID, NEWER_COMPANY_NAME, "https://second.test/", "manual",
            "company:review-second",
        ),
    )
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,
               retrieved_at,confidence,snapshot_id)
           VALUES(?,'person',?,'source_review_candidate',?,?,?,?,1.0,?)""",
        (
            NEWER_OBSERVATION_ID, source.person_id,
            '{"excerpt":"second synthetic role"}', snapshot_id, NOW_TEXT, NOW_TEXT,
            snapshot_id,
        ),
    )
    connection.execute(
        """INSERT INTO employment(
               employment_id,person_id,company_id,title,valid_from,valid_to,
               source_observation_id,confidence)
           VALUES(?,?,?,?,?,NULL,?,1.0)""",
        (
            NEWER_EMPLOYMENT_ID, source.person_id, NEWER_COMPANY_ID, title,
            "2099-01-01", NEWER_OBSERVATION_ID,
        ),
    )
    return NEWER_EMPLOYMENT_ID


def test_selected_person_projects_and_lists_before_any_materialization(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)

    projection = review.get_selected_pipeline(CAMPAIGN_ID)
    view = _listed(review, source.person_id)

    assert projection.projection_version == PROJECTION_VERSION
    assert (projection.state, projection.error_code) == ("ready", None)
    assert projection.run_id == source.run_id
    assert projection.ranking_batch_hash == source.ranking_batch_hash
    assert projection.counts["selected_people"] == 1
    company = projection.companies[0]
    assert company.company_id == source.company_id
    assert company.shortfall == company.desired_count - company.selected_count
    assert company.reason_codes
    person = company.people[0]
    assert (person.state, person.error_code) == ("available", None)
    assert person.person_rank_id == source.person_rank_id
    assert person.rank_ordinal == 0 and person.mapped_family
    assert person.source_context_digest == source.source_context_digest
    assert person.candidate_observation_id == source.candidate_observation_id
    assert person.employment_observation_id == source.employment_observation_id
    assert person.snapshot_id == source.snapshot_id
    # No binding exists yet, so no regeneration pin may be presented at all.
    assert person.expected_revision_id is None
    assert person.expected_predecessor_binding_hash is None
    assert person.has_prior_binding is False
    assert (person.head_revision_id, person.bound_revision_id) == (None, None)

    assert (view.selected, view.state) == (True, "selected")
    assert view.title == source.title and view.company == COMPANY_NAME
    assert view.person_rank_id == source.person_rank_id
    assert view.run_id == source.run_id
    assert view.ranking_batch_hash == source.ranking_batch_hash
    assert view.source_context_digest == source.source_context_digest
    assert view.projection_error_code is None
    # Selection confers no source confirmation and no contact.
    assert view.identity_source_state == "confirmation_required"
    assert (view.contact_id, view.email, view.contact_state) == (None, None, None)
    # Nothing was materialized and no legacy row was fabricated.
    assert review.list_drafts(CAMPAIGN_ID) == ()
    assert _counts(connection, "revision") == (0,)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_stale_selected_source_is_projected_as_honestly_unavailable(
    tmp_path: Path,
) -> None:
    """A tampered *bound* snapshot invalidates the ranking read itself.

    The qualification scope behind ``RankingService.get_projection`` verifies the
    exact bound snapshot before any per-person resolution can happen, so the
    failure is a *root* failure: there is no company and no person to project.
    No older ranking batch stands in, and the run/intake context the refusal was
    computed against is still reported so a UI can say why.  The narrower
    per-person failure path is covered by the binding-hint proxy test below.
    """
    connection, _selected, source = _render_ready(tmp_path)
    body_ref = connection.execute(
        "SELECT body_ref FROM source_snapshot WHERE snapshot_id=?",
        (source.snapshot_id,),
    ).fetchone()[0]
    (tmp_path / "snapshots" / body_ref).write_text(STALE_SENTINEL, encoding="utf-8")
    review = _review(connection)

    projection = review.get_selected_pipeline(CAMPAIGN_ID)

    assert (projection.state, projection.error_code) == (
        "unavailable", "source_changed",
    )
    assert projection.companies == ()
    assert projection.counts["selected_people"] == 0
    # The refusal names the exact context it was computed against instead of
    # silently dropping it, and claims no ranking batch it could not verify.
    assert projection.run_id == source.run_id
    assert projection.intake_hash is not None
    assert projection.campaign_policy_hash is not None
    assert projection.ranking_batch_id is None
    assert projection.ranking_batch_hash is None
    assert STALE_SENTINEL not in repr(projection)
    # This campaign carries no legacy fill/fit/eligibility/revision rows, so the
    # person list is legitimately empty: nothing is substituted for the missing
    # proof, and no stale title, company or contact is displayed anywhere.
    assert review.list_people(CAMPAIGN_ID) == ()
    assert review.list_drafts(CAMPAIGN_ID) == ()
    assert _counts(connection, "revision") == (0,)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_newer_employment_cannot_substitute_the_selected_title_or_company(
    tmp_path: Path,
) -> None:
    """Selection, not recency, decides the displayed role.

    A newer open employment row for the same person at a different company would
    win the legacy latest-employment subquery; the selected projection must still
    report the exact resolver-bound employment, title and company.
    """
    connection, _selected, source = _render_ready(tmp_path)
    newer = _newer_employment(connection, source, NEWER_TITLE)
    review = _review(connection)

    person = review.get_selected_pipeline(CAMPAIGN_ID).companies[0].people[0]
    view = _listed(review, source.person_id)

    assert person.state == "available"
    assert person.employment_id == source.employment_id != newer
    assert person.employment_observation_id == source.employment_observation_id
    assert view.title == source.title and view.title != NEWER_TITLE
    assert view.company == COMPANY_NAME != NEWER_COMPANY_NAME
    assert view.current_observation_id == source.employment_observation_id
    assert (view.contact_id, view.email, view.contact_state) == (None, None, None)
    connection.close()


def test_prior_binding_alone_is_reported_without_implying_regeneration(
    tmp_path: Path,
) -> None:
    """``has_prior_binding`` states only that a binding exists.

    A freshly bound, unchanged draft reports ``True`` -- and the owning command
    still refuses to regenerate it, which is exactly why this flag is not named
    after regeneration.
    """
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    review = _review(connection)

    person = review.get_selected_pipeline(CAMPAIGN_ID).companies[0].people[0]

    assert person.has_prior_binding is True
    assert person.head_revision_id == first.revision_id
    assert person.bound_revision_id == first.revision_id
    assert person.expected_revision_id == first.revision_id
    assert person.expected_predecessor_binding_hash == first.binding_hash

    # The hint pins are display expectations only: the owning command revalidates
    # them and refuses an unchanged context on its own authority.
    with pytest.raises(SelectedDraftError, match="^regeneration_context_unchanged$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=person.expected_revision_id,
            expected_predecessor_binding_hash=person.expected_predecessor_binding_hash,
        ))
    connection.close()


def test_regeneration_hints_name_the_edited_head_and_predecessor_binding(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))
    edited = _human_edit(connection, source.campaign_id, first.revision_id, EDIT_ONE)
    _drift_sender(connection, "Rewritten operating background.")
    review = _review(connection)

    person = review.get_selected_pipeline(CAMPAIGN_ID).companies[0].people[0]
    view = _listed(review, source.person_id)

    assert person.head_revision_id == edited
    assert person.bound_revision_id == first.revision_id
    assert person.expected_revision_id == edited
    assert person.expected_predecessor_binding_hash == first.binding_hash
    # Only binding existence is asserted here; no source-authority change and no
    # regeneration verdict is inferred from these two reads.
    assert person.has_prior_binding is True
    assert view.identity_source_state == "confirmation_required"
    assert view.projection_error_code is None
    connection.close()


def test_failed_binding_hint_query_marks_only_that_person_unavailable(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    _service(connection).materialize(_request(source))
    proxy = _BindingQueryFailingConnection(connection)

    projection = build_selected_pipeline_projection(proxy, CAMPAIGN_ID, now=NOW)
    person = projection.companies[0].people[0]

    # The root and every other read survived: only the hint read failed.
    assert (projection.state, projection.error_code) == ("ready", None)
    assert projection.run_id == source.run_id
    assert projection.ranking_batch_hash == source.ranking_batch_hash
    assert proxy.failures == 1
    # Unavailable data is reported as unavailable, never as "no binding yet".
    assert (person.state, person.error_code) == ("unavailable", "store_state_invalid")
    assert person.has_prior_binding is False
    assert (person.head_revision_id, person.bound_revision_id) == (None, None)
    assert person.expected_revision_id is None
    assert person.expected_predecessor_binding_hash is None
    assert person.title is None and person.source_context_digest is None
    assert DRIVER_TEXT not in repr(person)
    assert projection.counts["unavailable_people"] == 1
    connection.close()


def test_absent_binding_table_still_reads_as_no_binding_yet(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))
    proxy = _MissingBindingTableConnection(connection)

    person = build_selected_pipeline_projection(
        proxy, CAMPAIGN_ID, now=NOW,
    ).companies[0].people[0]

    # A store that genuinely predates P22 has no binding, and that is not an error.
    assert (person.state, person.error_code) == ("available", None)
    assert person.head_revision_id == first.revision_id
    assert person.bound_revision_id is None
    assert person.has_prior_binding is False
    assert person.expected_revision_id is None
    assert person.expected_predecessor_binding_hash is None
    connection.close()


def test_unavailable_pipeline_is_reported_as_an_explicit_projection_error(
    tmp_path: Path,
) -> None:
    connection, _selected, _source = _render_ready(tmp_path)
    connection.execute(
        "UPDATE campaign SET policy_hash=? WHERE campaign_id=?", ("b" * 64, CAMPAIGN_ID),
    )
    review = _review(connection)

    projection = review.get_selected_pipeline(CAMPAIGN_ID)

    assert projection.state == "unavailable"
    assert projection.error_code == "store_state_invalid"
    assert projection.companies == ()
    assert projection.counts["selected_people"] == 0
    # The person list is legitimately empty here (this campaign has no legacy rows
    # at all).  The reason is available explicitly above, so a UI can say why
    # instead of rendering a silent empty screen.
    assert review.list_people(CAMPAIGN_ID) == ()
    connection.close()


def test_closed_connection_root_is_unavailable_with_a_fixed_code(
    tmp_path: Path,
) -> None:
    connection, _selected, _source = _render_ready(tmp_path)
    connection.close()

    projection = build_selected_pipeline_projection(connection, CAMPAIGN_ID, now=NOW)

    assert (projection.state, projection.error_code) == (
        "unavailable", "store_state_invalid",
    )
    assert projection.companies == () and projection.run_id is None
    assert "closed database" not in repr(projection).casefold()


def test_a_non_pipeline_campaign_id_projects_as_no_pipeline(tmp_path: Path) -> None:
    connection, _selected, _source = _render_ready(tmp_path)

    projection = build_selected_pipeline_projection(
        connection, "camp-legacy-ui", now=NOW,
    )

    assert (projection.state, projection.error_code) == ("no_pipeline", None)
    assert projection.companies == () and projection.run_id is None
    assert projection.counts["selected_people"] == 0
    connection.close()


def test_projection_records_have_no_value_bearing_repr(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    projection = _review(connection).get_selected_pipeline(CAMPAIGN_ID)
    company = projection.companies[0]
    person = company.people[0]

    for record in (projection, company, person):
        text = repr(record)
        assert text.startswith("<") and " object at 0x" in text
        assert type(record).__name__ in text
    assert source.title and source.title not in repr(person)
    # Suppressing repr must not weaken the frozen value semantics.
    assert person == company.people[0]
    connection.close()


def test_selected_person_view_has_no_value_bearing_repr(tmp_path: Path) -> None:
    """The listed private view suppresses its own fields, not by inheritance.

    The view under test is a genuinely projected, available selected person: its
    name, company and resolver-supplied title are real.  Stored identity is *not*
    mutated to manufacture a sentinel, because ``full_name``/``linkedin_url`` are
    bound identity and rewriting them correctly invalidates the ranking.  Extra
    sentinels are applied with :func:`dataclasses.replace` to the already produced
    view only.  All of these are PersonView's *own* fields: the nested
    identity-source suppression never covered them, which is what this pins.
    """
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)

    view = _listed(review, source.person_id)

    assert view.selected is True
    assert view.title == source.title
    assert view.full_name and view.company == COMPANY_NAME
    text = repr(view)
    assert text.startswith("<") and " object at 0x" in text
    assert "PersonView" in text
    private_values = [view.full_name, view.company, source.title]
    if view.linkedin_url is not None:
        private_values.append(view.linkedin_url)
    for private in private_values:
        assert private
        assert private not in text
    # Value-bearing fields the fixture leaves empty are still covered, by placing
    # sentinels on a copy of the projected view rather than on stored identity.
    sentinel_view = dataclasses.replace(
        view, email=SENTINEL_EMAIL, linkedin_url=SENTINEL_URL,
    )
    sentinel_text = repr(sentinel_view)
    assert sentinel_text.startswith("<") and "PersonView" in sentinel_text
    assert SENTINEL_EMAIL not in sentinel_text
    assert SENTINEL_URL not in sentinel_text
    # Suppressing repr must not weaken the frozen value semantics.
    assert view == _listed(review, source.person_id)
    with pytest.raises(AttributeError):
        view.full_name = "changed"
    connection.close()
