"""ReviewService's exact-selected core slice over the genuine P15-P24 fixtures.

Every row read or written here belongs to a real table: the selection comes from
the real intake/funding/person-import/qualification/ranking fixtures, the draft
from the real P22 binding service, the confirmation from the real P24 service and
the head drift from the real review lineage tables.  No fill, contact, affinity,
approval or shadow table is created anywhere, and no SQL "readiness" is faked: the
assertions are made against the actual ReviewService forwarders and views.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from scripts.prospecting.review_service import (
    ImportIdentitySourceRequest,
    ReviewError,
    ReviewService,
    VerifyIdentitySourceRequest,
)
from scripts.prospecting.selected_source_review import SelectedSourceAttestationRequest
from scripts.prospecting.tests.test_selected_draft_service import (
    FIRST,
    SECOND,
    THIRD,
    _agent_edge,
    _link,
    _request,
    _revision_copy,
)
from scripts.prospecting.tests.test_selected_person_render import (
    LEGACY_TABLES,
    _counts,
    _render_ready,
)
from scripts.prospecting.tests.test_selected_person_source import NOW, STAMP


WATCHED = ("employment", "source_observation", "source_snapshot", "evidence", "revision")


def _clock() -> str:
    return NOW.strftime("%Y-%m-%dT%H:%M:%SZ")


def _review(connection) -> ReviewService:
    return ReviewService(connection, now=_clock)


def _attest(source, receipt, **overrides) -> SelectedSourceAttestationRequest:
    values = {
        "request_id": FIRST,
        "campaign_id": source.campaign_id,
        "person_id": source.person_id,
        "expected_revision_id": receipt.revision_id,
        "expected_source_context_digest": receipt.source_context_digest,
        "expected_candidate_observation_id": source.candidate_observation_id,
        "attested": True,
    }
    values.update(overrides)
    return SelectedSourceAttestationRequest(**values)


def _snapshot_body_ref(connection, snapshot_id: str) -> str:
    """The body file of one exact snapshot.

    Looked up by the selected snapshot_id rather than by "latest allowlist row":
    a selected snapshot may carry a different allowlist version, so an allowlist
    filter could silently target an unrelated snapshot.
    """
    row = connection.execute(
        "SELECT body_ref FROM source_snapshot WHERE snapshot_id=?", (snapshot_id,),
    ).fetchone()
    assert row is not None
    return str(row[0])


def test_selected_materialization_is_projected_as_a_pending_source_draft(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)

    receipt = review.materialize_selected_draft(_request(source))
    draft = review.get_draft(source.campaign_id, receipt.revision_id)

    assert receipt.state == "bound"
    assert draft.source_revision_id == receipt.revision_id
    assert draft.identity_source_state == "confirmation_required"
    assert draft.identity_source is not None
    assert draft.identity_source.observation_id == source.candidate_observation_id
    assert draft.identity_source.snapshot_id == source.snapshot_id
    # Pending proof may never read as confirmed.
    assert draft.identity_source.is_current is False
    assert draft.source_error_code is None
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_confirmation_is_never_automatic_and_only_explicit_attestation_confirms(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))

    with pytest.raises(ReviewError, match="^source_attestation_required$"):
        review.attest_selected_source(_attest(source, receipt, attested=False))
    assert review.get_draft(
        source.campaign_id, receipt.revision_id,
    ).identity_source_state == "confirmation_required"

    result = review.attest_selected_source(_attest(source, receipt))
    draft = review.get_draft(source.campaign_id, receipt.revision_id)

    assert (result.state, result.attested, result.replayed) == ("attested", True, False)
    assert result.source_context_digest == receipt.source_context_digest
    assert draft.identity_source_state == "source_ready"
    assert draft.identity_source is not None
    assert draft.identity_source.is_current is True
    connection.close()


def test_exact_replay_after_head_drift_keeps_the_original_attestation_head(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    first = review.attest_selected_source(_attest(source, receipt))
    child = _revision_copy(
        connection, receipt.revision_id, "rev-review-edit", "Edited subject",
        "Edited body", "c7" * 32,
    )
    _link(connection, receipt.revision_id, child, "review_edit")

    replay = review.attest_selected_source(_attest(source, receipt))
    reused = review.attest_selected_source(_attest(
        source, receipt, request_id=SECOND, expected_revision_id=child,
    ))
    drifted = review.get_draft(source.campaign_id, child)

    assert replay == dataclasses.replace(first, replayed=True)
    assert reused.attestation_id == first.attestation_id
    # The reused receipt's revision_id is the ORIGINAL attestation head recorded on
    # that immutable row; it is not the caller's current head and is not labelled so.
    assert reused.revision_id == receipt.revision_id != child
    assert (reused.replayed, reused.attested) == (True, True)
    # The displayed revision is the drifted head, resolved through the shared seam.
    assert drifted.source_revision_id == child
    assert drifted.identity_source_state == "source_ready"
    connection.close()


def test_source_drift_shows_unavailable_and_never_falls_back_to_legacy(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    review.attest_selected_source(_attest(source, receipt))
    before = review.get_draft(source.campaign_id, receipt.revision_id)
    body_ref = _snapshot_body_ref(connection, source.snapshot_id)
    (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")

    after = review.get_draft(source.campaign_id, receipt.revision_id)

    # The draft text is preserved exactly; only the source projection changes.
    assert (after.subject, after.body) == (before.subject, before.body)
    assert after.identity_source_state == "source_unavailable"
    assert after.identity_source is None
    assert after.source_error_code == "source_changed"
    assert after.source_revision_id == receipt.revision_id
    assert "PRIVATE SENTINEL" not in repr(after)
    connection.close()


def test_legacy_verify_and_import_refuse_under_a_selected_scope(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    review.attest_selected_source(_attest(source, receipt))
    before = _counts(connection, *WATCHED)

    with pytest.raises(ReviewError, match="^selected_source_scope_active$"):
        review.verify_current_role_source(VerifyIdentitySourceRequest(
            request_id=THIRD, campaign_id=source.campaign_id,
            person_id=source.person_id,
            expected_observation_id=source.employment_observation_id,
            observation_id=source.candidate_observation_id, attested=True,
        ))
    with pytest.raises(ReviewError, match="^selected_source_scope_active$"):
        review.import_current_role_source(ImportIdentitySourceRequest(
            campaign_id=source.campaign_id, person_id=source.person_id,
            source_url="https://example.test/profile",
            body="A synthetic local body that is never imported.",
        ))

    # The original employment row and its bound observation are untouched.
    assert str(connection.execute(
        "SELECT source_observation_id FROM employment WHERE employment_id=?",
        (source.employment_id,),
    ).fetchone()[0]) == source.employment_observation_id
    assert _counts(connection, *WATCHED) == before
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert not connection.in_transaction
    assert review.get_draft(
        source.campaign_id, receipt.revision_id,
    ).identity_source_state == "source_ready"
    connection.close()


def test_view_dataclasses_do_not_leak_excerpt_or_copy_through_repr(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    draft = review.get_draft(source.campaign_id, receipt.revision_id)

    text = repr(draft)
    assert text.startswith("<") and " object at 0x" in text
    assert draft.subject not in text and draft.body not in text
    assert draft.identity_source is not None
    source_text = repr(draft.identity_source)
    assert source_text.startswith("<") and " object at 0x" in source_text
    assert draft.identity_source.excerpt not in source_text
    assert draft.identity_source.source_url not in source_text
    for item in draft.evidence:
        assert item.claim not in repr(item)
        assert item.url not in repr(item)
    connection.close()


def test_root_selected_draft_carries_the_exact_proof_metadata(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))

    draft = review.get_draft(source.campaign_id, receipt.revision_id)

    assert draft.source_revision_id == receipt.revision_id
    assert draft.selected_source_scope is True
    # Exactly the digest of the one resolved selection, not a latest-selection read.
    assert draft.source_context_digest == receipt.source_context_digest
    assert draft.source_context_digest == source.source_context_digest
    assert draft.current_observation_id == source.employment_observation_id
    assert draft.identity_source_state == "confirmation_required"
    assert draft.source_error_code is None
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_verified_human_edit_descendant_keeps_the_same_proof_metadata(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    root = review.get_draft(source.campaign_id, receipt.revision_id)
    child = _revision_copy(
        connection, receipt.revision_id, "rev-digest-edit", "Edited subject",
        "Edited body", "d7" * 32,
    )
    _link(connection, receipt.revision_id, child, "digest_edit")

    drafted = review.get_draft(source.campaign_id, child)

    # The displayed revision is the descendant head, and the proof metadata is the
    # same single valid selected source it resolved through.
    assert drafted.source_revision_id == child != receipt.revision_id
    assert drafted.selected_source_scope is True
    assert drafted.source_context_digest == root.source_context_digest
    assert drafted.source_context_digest == receipt.source_context_digest
    assert drafted.current_observation_id == source.employment_observation_id
    assert drafted.source_error_code is None
    assert drafted.identity_source is not None and root.identity_source is not None
    assert (
        drafted.identity_source.observation_id,
        drafted.identity_source.snapshot_id,
        drafted.identity_source.expires_at,
    ) == (
        root.identity_source.observation_id,
        root.identity_source.snapshot_id,
        root.identity_source.expires_at,
    )
    connection.close()


def test_genuine_agent_descendant_keeps_the_same_proof_metadata(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    root = review.get_draft(source.campaign_id, receipt.revision_id)
    child = _revision_copy(
        connection, receipt.revision_id, "rev-digest-agent", "Agent subject",
        "Agent body", "d8" * 32,
    )
    _agent_edge(
        connection, receipt.revision_id, child, "digest_agent", run_id=source.run_id,
    )

    drafted = review.get_draft(source.campaign_id, child)

    assert drafted.source_revision_id == child
    assert drafted.selected_source_scope is True
    assert drafted.source_context_digest == root.source_context_digest
    assert drafted.current_observation_id == source.employment_observation_id
    assert drafted.identity_source is not None and root.identity_source is not None
    assert (
        drafted.identity_source.observation_id, drafted.identity_source.expires_at,
    ) == (root.identity_source.observation_id, root.identity_source.expires_at)
    connection.close()


def test_reused_historical_attestation_receipt_never_relabels_the_current_head(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    first = review.attest_selected_source(_attest(source, receipt))
    before = review.get_draft(source.campaign_id, receipt.revision_id)
    child = _revision_copy(
        connection, receipt.revision_id, "rev-digest-confirm", "Confirmed subject",
        "Confirmed body", "d9" * 32,
    )
    _link(connection, receipt.revision_id, child, "digest_confirm")

    reused = review.attest_selected_source(_attest(
        source, receipt, request_id=SECOND, expected_revision_id=child,
    ))
    drafted = review.get_draft(source.campaign_id, child)

    assert before.source_revision_id == receipt.revision_id
    assert reused.attestation_id == first.attestation_id
    # The reused receipt reports its own original head; the view must not adopt it.
    assert reused.revision_id == receipt.revision_id != child
    assert drafted.source_revision_id == child
    assert drafted.selected_source_scope is True
    assert drafted.source_context_digest == receipt.source_context_digest
    assert drafted.current_observation_id == source.employment_observation_id
    assert drafted.identity_source_state == "source_ready"
    assert drafted.identity_source is not None
    assert drafted.identity_source.is_current is True
    connection.close()


def test_stale_selected_source_reports_no_digest_and_no_legacy_fallback(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    review.attest_selected_source(_attest(source, receipt))
    body_ref = _snapshot_body_ref(connection, source.snapshot_id)
    (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")

    draft = review.get_draft(source.campaign_id, receipt.revision_id)

    assert draft.source_error_code == "source_changed"
    assert draft.identity_source_state == "source_unavailable"
    assert draft.identity_source is None
    # No stale digest and no latest-employment observation is claimed here.
    assert draft.source_context_digest is None
    assert draft.current_observation_id is None
    # The selected scope marker survives so the UI still knows what it displayed,
    # and never offers legacy verification for an unavailable selected root.
    assert draft.selected_source_scope is True
    assert draft.source_revision_id == receipt.revision_id
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert "PRIVATE SENTINEL" not in repr(draft)
    connection.close()


def test_unrelated_newer_employment_never_changes_the_projected_metadata(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (
            "co_unrelateddto", "Unrelated Synthetic", "https://unrelated-dto.test/",
            "manual", "company:unrelated-dto",
        ),
    )
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,
               retrieved_at,confidence,snapshot_id)
           VALUES(?,'person',?,'source_review_candidate',?,?,?,?,1.0,?)""",
        (
            "obs_unrelateddto", source.person_id, '{"excerpt":"unrelated synthetic role"}',
            source.snapshot_id, STAMP, STAMP, source.snapshot_id,
        ),
    )
    # Genuinely newer: an explicit valid_from far in the future, so a
    # latest-employment read would actually prefer this row over the bound one.
    connection.execute(
        """INSERT INTO employment(
               employment_id,person_id,company_id,title,valid_from,valid_to,
               source_observation_id,confidence)
           VALUES(?,?,?,?,'2099-01-01',NULL,?,1.0)""",
        (
            "emp_unrelateddto", source.person_id, "co_unrelateddto", "Board Advisor",
            "obs_unrelateddto",
        ),
    )

    draft = review.get_draft(source.campaign_id, receipt.revision_id)

    assert draft.current_observation_id == source.employment_observation_id
    assert draft.source_context_digest == receipt.source_context_digest
    assert draft.source_revision_id == receipt.revision_id
    assert draft.selected_source_scope is True
    connection.close()


def test_legacy_root_view_reports_no_digest_and_is_otherwise_unchanged(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    review = _review(connection)
    receipt = review.materialize_selected_draft(_request(source))
    legacy = _revision_copy(
        connection, receipt.revision_id, "rev-digest-legacy", "Legacy subject",
        "Legacy body", "e7" * 32, prompt_version="affinity-v2",
    )

    draft = review.get_draft(source.campaign_id, legacy)

    # A genuinely unselected root falls to the legacy path, which owns no selected
    # source context and therefore reports none -- and is the only path that says so.
    assert draft.source_context_digest is None
    assert draft.selected_source_scope is False
    assert draft.identity_source is None
    assert draft.identity_source_state == "source_unavailable"
    assert draft.source_error_code is not None
    assert draft.source_revision_id == legacy
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()
