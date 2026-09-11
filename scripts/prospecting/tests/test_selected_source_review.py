"""P24 selected-source attestation over the genuine P15-P22 fixture pipeline.

Every row read or written here belongs to a real table: the selection comes from the
real intake/funding/person-import/qualification/ranking fixtures, the draft comes from
the real P22 binding service, and human edits use the real review lineage tables.  No
fill, contact, affinity, approval or shadow table is created anywhere.
"""

from __future__ import annotations

import dataclasses
from datetime import timedelta
from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.affinity.evidence_bridge import CurrentRoleProof
import scripts.prospecting.selected_source_review as review_module
from scripts.prospecting.selected_source_review import (
    ATTESTED_BY,
    SelectedSourceAttestationRequest,
    SelectedSourceReviewError,
    SelectedSourceReviewService,
    selected_revision_role_proof,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_selected_draft_service import (
    FIRST,
    P22_TABLES,
    SECOND,
    THIRD,
    _link,
    _request,
    _revision_copy,
    _service,
)
from scripts.prospecting.tests.test_selected_person_render import (
    LEGACY_TABLES,
    _counts,
    _render_ready,
)
from scripts.prospecting.tests.test_selected_person_source import NOW, STAMP


ATTESTATION_TABLE = "selected_source_attestation"
LEDGER_TABLE = "selected_source_attestation_request"
WATCHED = (
    "employment", "source_observation", "source_snapshot", "evidence", "revision",
    "revision_qa_context", *P22_TABLES, *LEGACY_TABLES,
)
DRIVER_TEXT = "PRIVATE DRIVER TEXT"
CALLER_MARKER = "caller-owned-write"


class _InsertFailingConnection:
    """Delegate every statement to the real store, failing only the attestation insert."""

    def __init__(self, connection) -> None:
        self._connection = connection
        self.rollbacks = 0

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def rollback(self):
        self.rollbacks += 1
        return self._connection.rollback()

    def execute(self, sql, *parameters):
        statement = " ".join(str(sql).split()).upper()
        if statement.startswith(f"INSERT INTO {ATTESTATION_TABLE}".upper()):
            raise sqlite3.OperationalError(f"insert failed - {DRIVER_TEXT}")
        return self._connection.execute(sql, *parameters)


def _bound(tmp_path: Path):
    """Real materialization first: a genuine selected draft before any attestation."""
    connection, _selected, source = _render_ready(tmp_path)
    receipt = _service(connection).materialize(_request(source))
    return connection, source, receipt


def _attest_request(source, receipt, **overrides) -> SelectedSourceAttestationRequest:
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


def _review(connection, *, now=NOW) -> SelectedSourceReviewService:
    return SelectedSourceReviewService(connection, now=lambda: now)


def test_pending_proof_then_attestation_without_any_other_mutation(tmp_path: Path) -> None:
    connection, source, receipt = _bound(tmp_path)
    before = _counts(connection, *WATCHED)

    pending = selected_revision_role_proof(connection, receipt.revision_id, NOW)
    assert isinstance(pending, CurrentRoleProof)
    assert pending.attested is False
    assert (pending.campaign_id, pending.person_id) == (source.campaign_id, source.person_id)
    assert pending.company_id == source.company_id
    assert pending.employment_id == source.employment_id
    assert pending.candidate_observation_id == source.candidate_observation_id
    assert pending.snapshot_id == source.snapshot_id
    assert pending.source_url == source.source_url
    assert pending.expires_at == source.expires_at

    result = _review(connection).attest(_attest_request(source, receipt))

    assert (result.state, result.replayed, result.attested) == ("attested", False, True)
    assert result.source_context_digest == receipt.source_context_digest
    assert result.binding_hash == receipt.binding_hash
    proof = selected_revision_role_proof(connection, receipt.revision_id, NOW)
    assert proof.attested is True
    assert (proof.excerpt, proof.candidate_observation_id) == (
        pending.excerpt, pending.candidate_observation_id,
    )
    # No employment/source/fill/affinity/contact/approval/evidence/revision change.
    assert _counts(connection, *WATCHED) == before
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert _counts(connection, ATTESTATION_TABLE) == (1,)
    stored = connection.execute(
        f"SELECT attested,attested_by,employment_id FROM {ATTESTATION_TABLE}",
    ).fetchone()
    assert (stored[0], stored[1], stored[2]) == (1, ATTESTED_BY, source.employment_id)
    text = repr(proof)
    assert text.startswith("<") and " object at 0x" in text
    assert proof.excerpt not in text and proof.source_url not in text
    connection.close()


def test_replay_conflict_and_fresh_request_reuse_without_new_authority(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    service = _review(connection)

    first = service.attest(_attest_request(source, receipt))
    replay = service.attest(_attest_request(source, receipt))

    assert replay == dataclasses.replace(first, replayed=True)
    with pytest.raises(SelectedSourceReviewError, match="^request_conflict$"):
        service.attest(_attest_request(
            source, receipt, expected_candidate_observation_id="obs_conflicting",
        ))

    fresh = service.attest(_attest_request(source, receipt, request_id=SECOND))

    assert fresh.request_id == SECOND
    assert fresh.attestation_id == first.attestation_id
    assert (fresh.replayed, fresh.attested) == (True, True)
    assert _counts(connection, ATTESTATION_TABLE) == (1,)
    assert _counts(connection, *P22_TABLES) == (1, 1)
    connection.close()


@pytest.mark.parametrize(
    ("overrides", "code"),
    (
        ({"expected_revision_id": "rev-not-current"}, "stale_expected_revision"),
        ({"expected_source_context_digest": "b" * 64}, "source_context_conflict"),
        ({"expected_candidate_observation_id": "obs_unrelated"}, "source_candidate_conflict"),
        ({"attested": False}, "source_attestation_required"),
    ),
)
def test_head_and_source_mismatches_are_refused_without_any_row(
    tmp_path: Path, overrides: dict, code: str,
) -> None:
    connection, source, receipt = _bound(tmp_path)

    with pytest.raises(SelectedSourceReviewError, match=f"^{code}$"):
        _review(connection).attest(_attest_request(source, receipt, **overrides))

    assert _counts(connection, ATTESTATION_TABLE) == (0,)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert not connection.in_transaction
    connection.close()


def test_unrelated_open_employment_elsewhere_is_ignored(tmp_path: Path) -> None:
    connection, source, receipt = _bound(tmp_path)
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (
            "co_unrelatedp24", "Unrelated Synthetic", "https://unrelated.test/",
            "manual", "company:unrelated-p24",
        ),
    )
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,
               retrieved_at,confidence,snapshot_id)
           VALUES(?,'person',?,'source_review_candidate',?,?,?,?,1.0,?)""",
        (
            "obs_unrelatedp24", source.person_id, '{"excerpt":"unrelated synthetic role"}',
            source.snapshot_id, STAMP, STAMP, source.snapshot_id,
        ),
    )
    connection.execute(
        """INSERT INTO employment(
               employment_id,person_id,company_id,title,valid_from,valid_to,
               source_observation_id,confidence)
           VALUES(?,?,?,?,NULL,NULL,?,1.0)""",
        (
            "emp_unrelatedp24", source.person_id, "co_unrelatedp24", "Board Advisor",
            "obs_unrelatedp24",
        ),
    )

    result = _review(connection).attest(_attest_request(source, receipt))

    assert result.attested is True
    bound = connection.execute(
        f"SELECT employment_id,company_id FROM {ATTESTATION_TABLE}",
    ).fetchone()
    assert (bound[0], bound[1]) == (source.employment_id, source.company_id)
    assert selected_revision_role_proof(
        connection, receipt.revision_id, NOW,
    ).employment_id == source.employment_id
    connection.close()


@pytest.mark.parametrize(
    ("case", "code"),
    (
        ("bytes", "source_changed"),
        ("expiry", "source_stale"),
        ("sender", "selected_render_context_stale"),
    ),
)
def test_changed_bytes_expiry_or_sender_drift_refuse_with_no_legacy_fallback(
    tmp_path: Path, case: str, code: str,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    stamp = NOW
    if case == "bytes":
        body_ref = connection.execute(
            """SELECT body_ref FROM source_snapshot
                WHERE allowlist_version='operator-local-v1' ORDER BY rowid DESC LIMIT 1""",
        ).fetchone()[0]
        (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")
    elif case == "expiry":
        stamp = NOW + timedelta(days=365)
    else:
        connection.execute(
            """UPDATE sender_profile SET sender_background=?
                WHERE sender_profile_id='sender-synthetic'""",
            ("Drifted background.",),
        )

    with pytest.raises(SelectedSourceReviewError) as refused:
        _review(connection, now=stamp).attest(_attest_request(source, receipt))

    assert str(refused.value) == code
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    with pytest.raises(SelectedSourceReviewError, match=f"^{code}$"):
        selected_revision_role_proof(connection, receipt.revision_id, stamp)
    assert _counts(connection, ATTESTATION_TABLE) == (0,)
    assert not connection.in_transaction
    connection.close()


def test_attestation_survives_a_real_human_edit_above_the_selected_root(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    first = _review(connection).attest(_attest_request(source, receipt))
    child = _revision_copy(
        connection, receipt.revision_id, "rev-p24-edit", "Edited subject",
        "Edited body", "a4" * 32,
    )
    _link(connection, receipt.revision_id, child, "p24_edit")

    proof = selected_revision_role_proof(connection, child, NOW)
    again = _review(connection).attest(_attest_request(
        source, receipt, request_id=THIRD, expected_revision_id=child,
    ))

    assert proof.attested is True
    assert proof.candidate_observation_id == source.candidate_observation_id
    assert again.attestation_id == first.attestation_id
    assert (again.replayed, again.attested) == (True, True)
    assert _counts(connection, ATTESTATION_TABLE) == (1,)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_caller_owned_transaction_is_preserved_and_never_rolled_back(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    connection.execute("SAVEPOINT caller_owned_tx")
    connection.execute("CREATE TABLE caller_marker(marker TEXT PRIMARY KEY)")
    connection.execute("INSERT INTO caller_marker(marker) VALUES (?)", (CALLER_MARKER,))

    with pytest.raises(SelectedSourceReviewError, match="^transaction_active$"):
        _review(connection).attest(_attest_request(source, receipt))

    assert connection.execute(
        "SELECT count(*) FROM caller_marker WHERE marker=?", (CALLER_MARKER,),
    ).fetchone()[0] == 1
    assert connection.in_transaction
    assert _counts(connection, ATTESTATION_TABLE) == (0,)
    connection.execute("RELEASE caller_owned_tx")
    connection.close()


def test_failed_attestation_insert_rolls_back_atomically_without_driver_text(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    proxy = _InsertFailingConnection(connection)

    with pytest.raises(SelectedSourceReviewError) as refused:
        SelectedSourceReviewService(proxy, now=lambda: NOW).attest(
            _attest_request(source, receipt),
        )

    assert str(refused.value) == "store_state_invalid"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    assert proxy.rollbacks == 1
    assert _counts(connection, ATTESTATION_TABLE) == (0,)
    assert not connection.in_transaction
    connection.close()


def test_closed_connection_is_refused_with_a_fixed_code(tmp_path: Path) -> None:
    connection, source, receipt = _bound(tmp_path)
    request = _attest_request(source, receipt)
    connection.close()

    with pytest.raises(SelectedSourceReviewError) as refused:
        _review(connection).attest(request)

    assert str(refused.value) == "store_state_invalid"
    assert "closed database" not in repr(refused.value).casefold()
    with pytest.raises(SelectedSourceReviewError, match="^store_state_invalid$"):
        selected_revision_role_proof(connection, request.expected_revision_id, NOW)


def test_attestation_service_never_reads_or_writes_authority_tables() -> None:
    """Attestation carries no readiness, approval, contact or fill authority."""
    text = Path(review_module.__file__).read_text(encoding="utf-8")

    for fragment in (
        "fill_person", "fill_firm", "contact_point", "FROM approval",
        "INTO approval", "identity_source_review", "UPDATE employment",
        "INSERT INTO source_observation", "person_affinity", "INTO evidence",
        "prospecting_pipeline_reset", "prospecting_pipeline_item",
    ):
        assert fragment not in text
    assert "resolve_revision_selection" in text
    assert "selected_person_identity" in text


class _BoundaryFailingConnection:
    """Delegate every call to the real store, failing only chosen boundaries.

    Nothing else is simulated: ``BEGIN IMMEDIATE`` and every other statement run
    against the genuine connection, so a rollback that is allowed through really
    undoes whatever this call wrote.
    """

    def __init__(
        self, connection, *, fail_sql: str | None = None, fail_commit: bool = False,
        fail_rollback: bool = False,
    ) -> None:
        self._connection = connection
        self._fail_sql = None if fail_sql is None else " ".join(fail_sql.split()).upper()
        self._fail_commit = fail_commit
        self._fail_rollback = fail_rollback
        self.commits = 0
        self.rollbacks = 0

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def execute(self, sql, *parameters):
        statement = " ".join(str(sql).split()).upper()
        if self._fail_sql is not None and statement.startswith(self._fail_sql):
            raise sqlite3.OperationalError(f"statement failed - {DRIVER_TEXT}")
        return self._connection.execute(sql, *parameters)

    def commit(self):
        self.commits += 1
        if self._fail_commit:
            raise sqlite3.OperationalError(f"disk I/O error - {DRIVER_TEXT}")
        return self._connection.commit()

    def rollback(self):
        self.rollbacks += 1
        if self._fail_rollback:
            raise sqlite3.OperationalError(f"cannot rollback - {DRIVER_TEXT}")
        return self._connection.rollback()


def test_every_successful_request_is_persisted_in_the_immutable_ledger(
    tmp_path: Path,
) -> None:
    """A reused-context request is recorded too, not silently dropped."""
    connection, source, receipt = _bound(tmp_path)
    service = _review(connection)

    first = service.attest(_attest_request(source, receipt))
    fresh = service.attest(_attest_request(source, receipt, request_id=SECOND))

    assert connection.execute(
        f"SELECT count(*) FROM {LEDGER_TABLE} WHERE request_id=?", (SECOND,),
    ).fetchone()[0] == 1
    rows = connection.execute(
        f"""SELECT request_id,result_state,attestation_id,campaign_id,person_id,
                   expected_source_context_digest,expected_candidate_observation_id
              FROM {LEDGER_TABLE}""",
    ).fetchall()
    assert {row[0]: (row[1], row[2]) for row in rows} == {
        FIRST: ("attested", first.attestation_id),
        SECOND: ("reused", first.attestation_id),
    }
    for row in rows:
        assert (row[3], row[4]) == (source.campaign_id, source.person_id)
        assert row[5] == receipt.source_context_digest
        assert row[6] == source.candidate_observation_id
    assert fresh.attestation_id == first.attestation_id
    # One attestation per source context still; one ledger row per request.
    assert _counts(connection, ATTESTATION_TABLE, LEDGER_TABLE) == (1, 2)
    for statement in (
        f"UPDATE {LEDGER_TABLE} SET result_state='attested' WHERE request_id=?",
        f"DELETE FROM {LEDGER_TABLE} WHERE request_id=?",
    ):
        with pytest.raises(sqlite3.DatabaseError):
            connection.execute(statement, (SECOND,))
    connection.rollback()
    assert _counts(connection, LEDGER_TABLE) == (2,)
    connection.close()


@pytest.mark.parametrize(
    "overrides",
    (
        {"expected_source_context_digest": "c" * 64},
        {"expected_revision_id": "rev-some-other-head"},
        {"expected_candidate_observation_id": "obs_other_candidate"},
    ),
)
def test_changed_payload_under_a_bound_request_id_is_always_request_conflict(
    tmp_path: Path, overrides: dict,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    service = _review(connection)
    service.attest(_attest_request(source, receipt))
    fresh = service.attest(_attest_request(source, receipt, request_id=SECOND))

    with pytest.raises(SelectedSourceReviewError, match="^request_conflict$"):
        service.attest(_attest_request(
            source, receipt, request_id=SECOND, **overrides,
        ))

    assert fresh.replayed is True
    assert _counts(connection, ATTESTATION_TABLE, LEDGER_TABLE) == (1, 2)
    assert not connection.in_transaction
    connection.close()


def test_exact_replay_after_edit_and_drift_returns_the_original_receipt(
    tmp_path: Path,
) -> None:
    """The recorded request replays; the current proof still refuses."""
    connection, source, receipt = _bound(tmp_path)
    service = _review(connection)
    first = service.attest(_attest_request(source, receipt))
    second = service.attest(_attest_request(source, receipt, request_id=SECOND))
    child = _revision_copy(
        connection, receipt.revision_id, "rev-p24-drift", "Edited subject",
        "Edited body", "b4" * 32,
    )
    _link(connection, receipt.revision_id, child, "p24_drift")
    body_ref = connection.execute(
        """SELECT body_ref FROM source_snapshot
            WHERE allowlist_version='operator-local-v1' ORDER BY rowid DESC LIMIT 1""",
    ).fetchone()[0]
    (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")

    replayed = service.attest(_attest_request(source, receipt, request_id=SECOND))

    assert replayed == dataclasses.replace(second, replayed=True)
    assert replayed.attestation_id == first.attestation_id
    with pytest.raises(SelectedSourceReviewError) as refused:
        selected_revision_role_proof(connection, child, NOW)
    assert str(refused.value) == "source_changed"
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    # A genuinely new request over the drifted context grants nothing.
    with pytest.raises(SelectedSourceReviewError, match="^source_changed$"):
        service.attest(_attest_request(
            source, receipt, request_id=THIRD, expected_revision_id=child,
        ))
    assert _counts(connection, ATTESTATION_TABLE, LEDGER_TABLE) == (1, 2)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_failed_ledger_insert_rolls_back_both_tables_leaving_no_half_row(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    proxy = _BoundaryFailingConnection(
        connection, fail_sql=f"INSERT INTO {LEDGER_TABLE}",
    )

    with pytest.raises(SelectedSourceReviewError) as refused:
        SelectedSourceReviewService(proxy, now=lambda: NOW).attest(
            _attest_request(source, receipt),
        )

    assert str(refused.value) == "store_state_invalid"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    assert proxy.rollbacks == 1
    assert _counts(connection, ATTESTATION_TABLE, LEDGER_TABLE) == (0, 0)
    assert not connection.in_transaction
    connection.close()


def test_busy_store_is_refused_with_a_fixed_code(tmp_path: Path) -> None:
    connection, source, receipt = _bound(tmp_path)
    connection.execute("PRAGMA busy_timeout=0")
    blocker = open_store(tmp_path / "store.sqlite")
    blocker.execute("BEGIN IMMEDIATE")
    try:
        with pytest.raises(SelectedSourceReviewError) as refused:
            _review(connection).attest(_attest_request(source, receipt))

        assert str(refused.value) == "store_busy"
        assert refused.value.__cause__ is None
        assert refused.value.__suppress_context__ is True
        assert "locked" not in repr(refused.value).casefold()
        assert not connection.in_transaction
        assert _counts(connection, ATTESTATION_TABLE, LEDGER_TABLE) == (0, 0)
    finally:
        blocker.rollback()
        blocker.close()
    connection.close()


def test_commit_failure_returns_no_receipt_and_leaves_no_rows(tmp_path: Path) -> None:
    connection, source, receipt = _bound(tmp_path)
    proxy = _BoundaryFailingConnection(connection, fail_commit=True)

    with pytest.raises(SelectedSourceReviewError) as refused:
        SelectedSourceReviewService(proxy, now=lambda: NOW).attest(
            _attest_request(source, receipt),
        )

    assert str(refused.value) == "store_state_invalid"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    assert (proxy.commits, proxy.rollbacks) == (1, 1)
    assert _counts(connection, ATTESTATION_TABLE, LEDGER_TABLE) == (0, 0)
    assert not connection.in_transaction
    connection.close()


def test_unclosable_transaction_reports_cleanup_failure_without_driver_text(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    proxy = _BoundaryFailingConnection(
        connection, fail_commit=True, fail_rollback=True,
    )

    with pytest.raises(SelectedSourceReviewError) as refused:
        SelectedSourceReviewService(proxy, now=lambda: NOW).attest(
            _attest_request(source, receipt),
        )

    # Neither success nor a cleaned-up failure may be claimed once the boundary
    # could not be proven closed.
    assert str(refused.value) == "attestation_cleanup_failed"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    assert (proxy.commits, proxy.rollbacks) == (1, 1)
    assert connection.in_transaction
    connection.rollback()
    assert _counts(connection, ATTESTATION_TABLE, LEDGER_TABLE) == (0, 0)
    connection.close()
