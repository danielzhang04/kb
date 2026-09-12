"""P22 selected-draft binding over the genuine P15-P20 fixture pipeline.

Every row these tests read or write is a real table: the selection comes from the
real intake/funding/person-import/qualification/ranking fixtures, and lineage is
exercised through the real review_revision_lineage / review_candidate /
review_request rows.  No fill, contact, affinity, approval or shadow edit table is
created anywhere.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
import sqlite3

import pytest

import scripts.prospecting.selected_draft_service as service_module
import scripts.prospecting.selected_person_render as render_module
from scripts.prospecting.personalizer.qa import QaResult
from scripts.prospecting.review_qa import StoredReviewQa
from scripts.prospecting.review_service import EditDraftRequest, ReviewService
from scripts.prospecting.manager.campaigns import CampaignService
from scripts.prospecting.person_research_service import PersonResearchService
from scripts.prospecting.ranking_service import RankingService
from scripts.prospecting.selected_draft_service import (
    SelectedDraftError,
    SelectedDraftRequest,
    SelectedDraftService,
    resolve_revision_selection,
)
from scripts.prospecting.selected_person_render import (
    RENDER_VERSION,
    render_selected_person_revision,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_selected_person_render import (
    ANCHORS,
    LEGACY_TABLES,
    _counts,
    _render_ready,
)
from scripts.prospecting.tests.test_campaigns import (
    BRIEF, MAILBOX_ID, PROFILE_ID, REQUEST_ONE, _profile,
)
from scripts.prospecting.tests.test_person_research_service import (
    CAMPAIGN_ID, _person, _request as _people_request, _seed,
)
from scripts.prospecting.tests.test_selected_person_source import _qualify, _resolve
from scripts.prospecting.tests.test_ranking_service import _rank_request
from scripts.prospecting.tests.test_selected_person_source import NOW, STAMP


FIRST = "11111111-1111-4111-8111-111111111111"
SECOND = "22222222-2222-4222-8222-222222222222"
THIRD = "33333333-3333-4333-8333-333333333333"
FOURTH = "44444444-4444-4444-8444-444444444444"
EDIT_ONE = "55555555-5555-4555-8555-555555555555"
EDIT_TWO = "66666666-6666-4666-8666-666666666666"
P22_TABLES = ("selected_draft_binding", "selected_draft_request")
QA_PASSED = json.dumps(
    {"passed": True, "qa_score": 100, "checks": {}, "failure_codes": [], "self_critique": ""},
    sort_keys=True, separators=(",", ":"),
)
QA_FAILED = json.dumps(
    {"passed": False, "qa_score": 0, "checks": {}, "failure_codes": ["unverified"],
     "self_critique": ""},
    sort_keys=True, separators=(",", ":"),
)
# Injected only into the chosen commit/rollback boundary; it stands for the dynamic
# driver text that must never reach a public refusal.
DRIVER_TEXT = "PRIVATE DRIVER TEXT"
CALLER_MARKER = "caller-owned-write"


class _FailingConnection:
    """Delegate every call to the real store, failing only the chosen boundary.

    Nothing else is simulated: ``BEGIN IMMEDIATE`` and every statement run against
    the genuine connection, so a rollback that is allowed through really undoes the
    binding, request, revision, evidence and QA-context rows this call wrote.
    """

    def __init__(self, connection, *, fail_commit: bool = False, fail_rollback: bool = False):
        self._connection = connection
        self._fail_commit = fail_commit
        self._fail_rollback = fail_rollback
        self.commit_attempts = 0
        self.rollback_attempts = 0

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def commit(self):
        self.commit_attempts += 1
        if self._fail_commit:
            raise sqlite3.OperationalError(f"disk I/O error - {DRIVER_TEXT}")
        return self._connection.commit()

    def rollback(self):
        self.rollback_attempts += 1
        if self._fail_rollback:
            raise sqlite3.OperationalError(f"cannot rollback - {DRIVER_TEXT}")
        return self._connection.rollback()


def _service(connection) -> SelectedDraftService:
    return SelectedDraftService(connection, now=lambda: NOW)


def _request(source, **overrides) -> SelectedDraftRequest:
    values = {
        "request_id": FIRST,
        "campaign_id": source.campaign_id,
        "run_id": source.run_id,
        "person_rank_id": source.person_rank_id,
        "expected_ranking_batch_hash": source.ranking_batch_hash,
    }
    values.update(overrides)
    return SelectedDraftRequest(**values)


def _revision_copy(
    connection, base_id: str, revision_id: str, subject: str, body: str, digest: str,
    *, prompt_version: str | None = None,
) -> str:
    """Insert a real sibling revision row derived from an existing saved revision."""
    values = dict(connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (base_id,),
    ).fetchone())
    values.update({
        "revision_id": revision_id, "subject": subject, "body": body, "hash": digest,
    })
    if prompt_version is not None:
        values["prompt_version"] = prompt_version
    columns = ",".join(values)
    marks = ",".join("?" for _ in values)
    connection.execute(
        f"INSERT INTO revision({columns}) VALUES({marks})", tuple(values.values()),
    )
    return revision_id


def _link(connection, parent_id: str, child_id: str, tag: str, *, passed: bool = True) -> None:
    """Record one real human-edit lineage edge with its candidate and request."""
    child = connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (child_id,),
    ).fetchone()
    candidate_id, request_id = f"cand_{tag}", f"req_{tag}"
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,'revision_created',?,?)""",
        (
            candidate_id, request_id, child["campaign_id"], child["person_id"],
            child["step"], parent_id, child["subject"], child["body"],
            QA_PASSED if passed else QA_FAILED, STAMP,
        ),
    )
    connection.execute(
        """INSERT INTO review_revision_lineage(
               child_revision_id,parent_revision_id,candidate_id,request_id,
               campaign_id,person_id,step,created_at
           ) VALUES(?,?,?,?,?,?,?,?)""",
        (
            child_id, parent_id, candidate_id, request_id, child["campaign_id"],
            child["person_id"], child["step"], STAMP,
        ),
    )
    connection.execute(
        "INSERT INTO review_request VALUES(?,?,?,?,?,?,?,?,?)",
        (
            request_id, "edit", child["campaign_id"], child["person_id"], parent_id,
            "a" * 64, "revision_created", candidate_id, STAMP,
        ),
    )


def test_first_materialize_replays_exactly_and_never_opens_a_fresh_lineage(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)

    first = service.materialize(_request(source))
    replay = service.materialize(_request(source))
    fresh = service.materialize(_request(source, request_id=SECOND))

    assert (first.state, first.replayed) == ("bound", False)
    assert replay == dataclasses.replace(first, replayed=True)
    assert fresh.state == "unchanged" and fresh.replayed is False
    assert (fresh.binding_id, fresh.revision_id) == (first.binding_id, first.revision_id)
    assert first.predecessor_binding_hash is None
    assert first.prompt_version == (
        f"{RENDER_VERSION}:{first.source_context_digest}:{first.render_context_digest}"
    )
    # One revision and one binding.  The exact-request replay records nothing, so only
    # the two distinct request IDs are stored: no new work and no new lineage.
    assert _counts(connection, "revision", *P22_TABLES) == (1, 1, 2)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert _counts(connection, "prospecting_pipeline_item", "prospecting_pipeline_reset") == (0, 0)
    connection.close()


def test_failed_render_rolls_back_the_binding_and_every_piece_of_evidence(
    tmp_path: Path, monkeypatch,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    monkeypatch.setattr(
        render_module, "record_revision_qa_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("context_rejected")),
    )

    with pytest.raises(ValueError, match="^context_rejected$"):
        _service(connection).materialize(_request(source))

    assert _counts(connection, "evidence", "revision", "revision_qa_context") == (0, 0, 0)
    assert _counts(connection, *P22_TABLES) == (0, 0)
    assert not connection.in_transaction
    connection.close()


def test_changed_sender_context_needs_explicit_regeneration_and_keeps_the_copy(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    before = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (first.revision_id,),
    ).fetchone()
    connection.execute(
        """UPDATE sender_profile SET sender_background=?
            WHERE sender_profile_id='sender-synthetic'""",
        ("A different, unused operating background.",),
    )

    with pytest.raises(SelectedDraftError, match="^selected_draft_regeneration_required$"):
        service.materialize(_request(source, request_id=SECOND))
    assert _counts(connection, "revision", *P22_TABLES) == (1, 1, 1)

    second = service.materialize(_request(
        source, request_id=THIRD, expected_revision_id=first.revision_id,
        expected_predecessor_binding_hash=first.binding_hash,
    ))
    after = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (second.revision_id,),
    ).fetchone()

    assert second.state == "regenerated"
    assert tuple(after) == tuple(before)
    assert second.source_context_digest == first.source_context_digest
    assert second.render_context_digest != first.render_context_digest
    assert second.revision_hash != first.revision_hash
    assert second.predecessor_binding_hash == first.binding_hash
    assert _counts(connection, "revision", *P22_TABLES) == (2, 2, 2)
    connection.close()


def test_stale_expected_head_or_predecessor_is_refused_before_any_work(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))

    with pytest.raises(SelectedDraftError, match="^stale_expected_revision$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id="rev-not-current",
            expected_predecessor_binding_hash=first.binding_hash,
        ))
    with pytest.raises(SelectedDraftError, match="^predecessor_binding_stale$"):
        service.materialize(_request(
            source, request_id=THIRD, expected_revision_id=first.revision_id,
            expected_predecessor_binding_hash="b" * 64,
        ))
    with pytest.raises(SelectedDraftError, match="^regeneration_expectations_incomplete$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=first.revision_id,
        ))

    assert _counts(connection, "revision", *P22_TABLES) == (1, 1, 1)
    connection.close()


def test_pending_human_candidate_is_refused_rather_than_cancelled(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    revision = connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (first.revision_id,),
    ).fetchone()
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,'pending_qa',NULL,?)""",
        (
            "cand_pending", "req_pending", revision["campaign_id"], revision["person_id"],
            revision["step"], first.revision_id, "Human edited subject",
            "Human edited body", STAMP,
        ),
    )

    with pytest.raises(SelectedDraftError, match="^human_edit_unresolved$"):
        service.materialize(_request(source, request_id=SECOND))

    assert _counts(connection, "revision", *P22_TABLES) == (1, 1, 1)
    assert connection.execute(
        "SELECT count(*) FROM review_candidate WHERE qa_state='pending_qa'",
    ).fetchone()[0] == 1
    connection.close()


def test_resolver_follows_real_human_edit_lineage_back_to_the_bound_root(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))
    child = _revision_copy(
        connection, first.revision_id, "rev-edit-one", "Edited subject one",
        "Edited body one", "c1" * 32,
    )
    _link(connection, first.revision_id, child, "one")
    grandchild = _revision_copy(
        connection, first.revision_id, "rev-edit-two", "Edited subject two",
        "Edited body two", "c2" * 32,
    )
    _link(connection, child, grandchild, "two")

    resolved = resolve_revision_selection(connection, grandchild, NOW)

    assert resolved is not None
    assert resolved.person_id == source.person_id
    assert resolved.source_context_digest == first.source_context_digest
    assert resolve_revision_selection(connection, child, NOW) == resolved
    connection.close()


def test_lineage_cycle_fails_closed(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))
    other = _revision_copy(
        connection, first.revision_id, "rev-cycle", "Cycle subject", "Cycle body",
        "d1" * 32,
    )
    _link(connection, first.revision_id, other, "cycle_one")
    _link(connection, other, first.revision_id, "cycle_two")

    with pytest.raises(SelectedDraftError, match="^revision_lineage_cycle$"):
        resolve_revision_selection(connection, other, NOW)
    connection.close()


def test_unverified_lineage_edge_is_not_authority(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))
    child = _revision_copy(
        connection, first.revision_id, "rev-unverified", "Unverified subject",
        "Unverified body", "e1" * 32,
    )
    _link(connection, first.revision_id, child, "unverified", passed=False)

    with pytest.raises(SelectedDraftError, match="^revision_lineage_unverified$"):
        resolve_revision_selection(connection, child, NOW)
    connection.close()


def test_unbound_selected_root_fails_closed_and_legacy_root_returns_none(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    rendered = render_selected_person_revision(
        connection, selected=source, anchors=ANCHORS, now=NOW,
    )

    with pytest.raises(SelectedDraftError, match="^selected_binding_missing$"):
        resolve_revision_selection(connection, rendered.revision_id, NOW)

    legacy = _revision_copy(
        connection, rendered.revision_id, "rev-legacy", "Legacy subject", "Legacy body",
        "f1" * 32, prompt_version="affinity-v2",
    )
    assert resolve_revision_selection(connection, legacy, NOW) is None
    connection.close()


def test_sender_drift_makes_the_bound_draft_stale_at_every_consumer(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))

    assert resolve_revision_selection(
        connection, first.revision_id, NOW,
    ).person_id == source.person_id

    connection.execute(
        """UPDATE sender_profile SET sender_background=?
            WHERE sender_profile_id='sender-synthetic'""",
        ("Drifted background.",),
    )

    with pytest.raises(SelectedDraftError, match="^selected_render_context_stale$"):
        resolve_revision_selection(connection, first.revision_id, NOW)
    connection.close()


def test_changed_bound_source_makes_the_binding_stale(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))
    body_ref = connection.execute(
        """SELECT body_ref FROM source_snapshot
            WHERE allowlist_version='operator-local-v1' ORDER BY rowid DESC LIMIT 1""",
    ).fetchone()[0]
    (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")

    with pytest.raises(SelectedDraftError) as refused:
        resolve_revision_selection(connection, first.revision_id, NOW)

    assert str(refused.value) == "source_changed"
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    connection.close()


def test_selection_traversal_never_consults_the_budget_reset_table() -> None:
    """A P21 budget root is not a selection provenance root, so it is never read."""
    text = Path(service_module.__file__).read_text(encoding="utf-8")

    assert "FROM prospecting_pipeline_reset" not in text
    assert "JOIN prospecting_pipeline_reset" not in text
    assert "review_revision_lineage" in text
    assert "prospecting_agent_revision_lineage" in text


def test_committed_receipt_is_visible_to_an_independent_connection(tmp_path: Path) -> None:
    """A receipt is handed back only after a real commit, never after a bare write."""
    connection, _selected, source = _render_ready(tmp_path)

    first = _service(connection).materialize(_request(source))

    reader = open_store(tmp_path / "store.sqlite")
    try:
        assert reader.execute(
            "SELECT binding_hash FROM selected_draft_binding WHERE binding_id=?",
            (first.binding_id,),
        ).fetchone()[0] == first.binding_hash
        assert reader.execute(
            "SELECT count(*) FROM revision WHERE revision_id=?", (first.revision_id,),
        ).fetchone()[0] == 1
    finally:
        reader.close()
    connection.close()


def test_caller_owned_transaction_is_refused_and_never_rolled_back(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    connection.execute("BEGIN IMMEDIATE")
    connection.execute("CREATE TABLE caller_marker(marker TEXT PRIMARY KEY)")
    connection.execute("INSERT INTO caller_marker(marker) VALUES (?)", (CALLER_MARKER,))

    with pytest.raises(SelectedDraftError, match="^transaction_active$"):
        _service(connection).materialize(_request(source))

    # The caller's own transaction and its write are untouched.
    assert connection.in_transaction
    assert connection.execute(
        "SELECT count(*) FROM caller_marker WHERE marker=?", (CALLER_MARKER,),
    ).fetchone()[0] == 1
    assert _counts(connection, *P22_TABLES) == (0, 0)
    connection.rollback()
    connection.close()


def test_busy_store_is_refused_with_a_fixed_code(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    connection.execute("PRAGMA busy_timeout=0")
    blocker = open_store(tmp_path / "store.sqlite")
    blocker.execute("BEGIN IMMEDIATE")
    try:
        with pytest.raises(SelectedDraftError) as refused:
            _service(connection).materialize(_request(source))

        assert str(refused.value) == "store_busy"
        assert refused.value.__cause__ is None
        assert refused.value.__suppress_context__ is True
        assert "locked" not in repr(refused.value).casefold()
        assert not connection.in_transaction
        assert _counts(connection, *P22_TABLES) == (0, 0)
    finally:
        blocker.rollback()
        blocker.close()
    connection.close()


def test_closed_connection_is_refused_with_fixed_codes_and_no_driver_text(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    connection.close()

    with pytest.raises(SelectedDraftError) as bind_refused:
        service.materialize(_request(source, request_id=SECOND))
    with pytest.raises(SelectedDraftError) as resolve_refused:
        resolve_revision_selection(connection, first.revision_id, NOW)

    for refused in (bind_refused, resolve_refused):
        assert str(refused.value) == "store_state_invalid"
        assert refused.value.__cause__ is None
        assert refused.value.__suppress_context__ is True
        assert "closed database" not in repr(refused.value).casefold()


def test_commit_failure_returns_no_receipt_and_leaves_no_partial_state(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    proxy = _FailingConnection(connection, fail_commit=True)

    with pytest.raises(SelectedDraftError) as refused:
        _service(proxy).materialize(_request(source))

    assert str(refused.value) == "store_state_invalid"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    # Exactly one commit attempt, followed by this call's own real rollback.
    assert (proxy.commit_attempts, proxy.rollback_attempts) == (1, 1)
    assert _counts(connection, "evidence", "revision", "revision_qa_context") == (0, 0, 0)
    assert _counts(connection, *P22_TABLES) == (0, 0)
    assert not connection.in_transaction
    connection.close()


def test_unclosable_transaction_reports_cleanup_failure_without_driver_text(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    proxy = _FailingConnection(connection, fail_commit=True, fail_rollback=True)

    with pytest.raises(SelectedDraftError) as refused:
        _service(proxy).materialize(_request(source))

    # Neither success nor a cleaned-up failure may be claimed once the boundary
    # could not be proven closed.
    assert str(refused.value) == "selected_draft_cleanup_failed"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    assert (proxy.commit_attempts, proxy.rollback_attempts) == (1, 1)
    assert connection.in_transaction
    connection.rollback()
    assert _counts(connection, "evidence", "revision", "revision_qa_context") == (0, 0, 0)
    assert _counts(connection, *P22_TABLES) == (0, 0)
    connection.close()


class _PassingReviewQa:
    """ReviewService's documented deterministic QA seam, over the real context.

    The stored adapter is asked first, so the decision object, its bindings and its
    policy are the genuine recorded ones.  Only the QA verdict is forced, and that is
    stated plainly: these tests exercise the review *edit* path, not QA itself.
    """

    def __init__(self, connection) -> None:
        self._stored = StoredReviewQa(connection, now=lambda: NOW)

    def __call__(self, candidate):
        decision = self._stored(candidate)
        if decision.qa.passed:
            return decision
        return dataclasses.replace(decision, qa=QaResult(True, 100, {}, (), ""))


def _human_edit(connection, campaign_id: str, revision_id: str, request_id: str) -> str:
    """Make one genuine ReviewService human edit above the given current head."""
    parent = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (revision_id,),
    ).fetchone()
    service = ReviewService(
        connection, now=lambda: STAMP, qa_adapter=_PassingReviewQa(connection),
    )
    result = service.edit_draft(EditDraftRequest(
        request_id=request_id, campaign_id=campaign_id,
        expected_revision_id=revision_id,
        subject=f"{str(parent['subject'])[:40]} (human edit)",
        body=str(parent["body"]) + "\n\nA human reviewer added this closing line.",
    ))
    assert result.state == "revision_created"
    assert result.revision_id != revision_id
    return result.revision_id


def _drift_sender(connection, background: str) -> None:
    connection.execute(
        """UPDATE sender_profile SET sender_background=?
            WHERE sender_profile_id='sender-synthetic'""",
        (background,),
    )


def _head(connection, campaign_id: str, person_id: str) -> str:
    return str(connection.execute(
        """SELECT revision_id FROM revision
            WHERE campaign_id=? AND person_id=? AND step=0
            ORDER BY rowid DESC LIMIT 1""",
        (campaign_id, person_id),
    ).fetchone()[0])


def _agent_edge(
    connection, parent_id: str, child_id: str, tag: str, *, run_id: str,
    cycle: int = 0, item_tag: str | None = None,
    accepted_hash: str | None = None, suggestion_subject: str | None = None,
    suggestion_body: str | None = None, proposed_hash: str | None = None,
) -> None:
    """Insert one *stored* accepted-suggestion edge fixture.

    These are real P16 rows written directly by the test.  No accept was executed
    here and none is claimed: the point is precisely to exercise what the resolver
    does with persisted rows whose hashes or copy disagree with the child revision.

    The stored item binds both its base revision and its lineage root to
    ``parent_id``, so ``parent_id`` must itself be a genuine unparented root: the
    real P21 item trigger refuses a lineage root that already carries a human or
    agent lineage edge unless a committed reset owns it, and no reset is minted or
    weakened here.  Sibling edges under one parent therefore reuse that parent's
    item through ``item_tag`` at a later ``cycle`` instead of opening a second item
    on the same ``(run_id, base_revision_id)``.  Only the stage rows for the given
    cycle are written; no repair run is claimed to have executed.
    """
    parent = connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (parent_id,),
    ).fetchone()
    child = connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (child_id,),
    ).fetchone()
    filler = "1" * 64
    item_key = tag if item_tag is None else item_tag
    item_id = f"item_{item_key}"
    attempt_id, artifact_id = f"attempt_{tag}", f"artifact_{tag}"
    suggestion_id, decision_id = f"sugg_{tag}", f"dec_{tag}"
    if connection.execute(
        "SELECT 1 FROM prospecting_pipeline_item WHERE item_id=?", (item_id,),
    ).fetchone() is None:
        connection.execute(
            """INSERT INTO prospecting_pipeline_item(
                   item_id,request_id,request_hash,run_id,campaign_id,intake_hash,
                   campaign_policy_hash,person_id,step,base_revision_id,base_revision_hash,
                   lineage_root_revision_id,evidence_manifest_hash,state,next_stage,
                   repair_cycle,max_repair_cycles,claim_epoch,created_at,updated_at
               ) VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?,'accepted',NULL,0,2,1,?,?)""",
            (
                item_id, f"item_req_{item_key}", filler, run_id, parent["campaign_id"],
                filler, filler, parent["person_id"], parent_id, parent["hash"],
                parent_id, filler, STAMP, STAMP,
            ),
        )
    connection.execute(
        """INSERT INTO prospecting_stage_attempt(
               attempt_id,request_id,request_hash,item_id,stage,cycle,claim_epoch,
               input_hash,worker_role,worker_identity,worker_job_id,attempt_token_hash,
               runtime_id,runtime_version,runtime_hash,schema_hash,skill_name,
               skill_version,skill_content_hash,skill_manifest_hash,state,lease_until,
               failure_code,created_at,finished_at
           ) VALUES(?,?,?,?,'humanizer',?,1,?,'humanizer',?,?,?,?,?,?,?,?,?,?,?,
                    'succeeded',?,NULL,?,?)""",
        (
            attempt_id, f"attempt_req_{tag}", filler, item_id, cycle, filler,
            f"identity_{tag}", f"job_{tag}", filler, "runtime", "1", filler, filler,
            "skill", "1", filler, filler, STAMP, STAMP, STAMP,
        ),
    )
    connection.execute(
        """INSERT INTO prospecting_stage_artifact(
               artifact_id,attempt_id,item_id,stage,cycle,input_hash,output_hash,
               subject_body_hash,proposed_revision_hash,evidence_manifest_hash,
               decision,payload_json,producer_role,producer_identity,producer_job_id,
               runtime_id,runtime_hash,schema_hash,skill_name,skill_version,
               skill_content_hash,skill_manifest_hash,created_at
           ) VALUES(?,?,?,'humanizer',?,?,?,?,?,?,'proposed','{}','humanizer',?,?,?,?,?,
                    ?,?,?,?,?)""",
        (
            artifact_id, attempt_id, item_id, cycle, filler, filler, filler,
            str(child["hash"]), filler, f"identity_{tag}", f"job_{tag}", "runtime",
            filler, filler, "skill", "1", filler, filler, STAMP,
        ),
    )
    connection.execute(
        """INSERT INTO prospecting_pipeline_suggestion(
               suggestion_id,item_id,cycle,humanizer_artifact_id,parent_revision_id,
               parent_revision_hash,subject,body,subject_body_hash,
               proposed_revision_hash,candidate_payload_json,candidate_context_json,
               created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,'{}','{}',?)""",
        (
            suggestion_id, item_id, cycle, artifact_id, parent_id, parent["hash"],
            str(child["subject"]) if suggestion_subject is None else suggestion_subject,
            str(child["body"]) if suggestion_body is None else suggestion_body,
            filler,
            str(child["hash"]) if proposed_hash is None else proposed_hash,
            STAMP,
        ),
    )
    connection.execute(
        """INSERT INTO prospecting_suggestion_decision(
               decision_id,request_id,request_hash,suggestion_id,item_id,
               expected_parent_revision_id,decision,actor,accepted_revision_id,
               accepted_revision_hash,created_at
           ) VALUES(?,?,?,?,?,?,'accepted','human:fixture',?,?,?)""",
        (
            decision_id, f"dec_req_{tag}", filler, suggestion_id, item_id, parent_id,
            child_id,
            str(child["hash"]) if accepted_hash is None else accepted_hash,
            STAMP,
        ),
    )
    connection.execute(
        """INSERT INTO prospecting_agent_revision_lineage(
               child_revision_id,parent_revision_id,suggestion_id,decision_id,origin,
               created_at
           ) VALUES(?,?,?,?,'accepted_agent_suggestion',?)""",
        (child_id, parent_id, suggestion_id, decision_id, STAMP),
    )


def test_explicit_regeneration_above_a_genuine_human_edit_appends_a_new_generation(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    bound_copy = tuple(connection.execute(
        "SELECT subject,body,hash FROM revision WHERE revision_id=?", (first.revision_id,),
    ).fetchone())
    first_binding_row = dict(connection.execute(
        "SELECT * FROM selected_draft_binding WHERE binding_id=?", (first.binding_id,),
    ).fetchone())
    first_qa_context = tuple(connection.execute(
        "SELECT * FROM revision_qa_context WHERE revision_id=?", (first.revision_id,),
    ).fetchone())
    edited = _human_edit(connection, source.campaign_id, first.revision_id, EDIT_ONE)
    edited_copy = tuple(connection.execute(
        "SELECT subject,body,hash FROM revision WHERE revision_id=?", (edited,),
    ).fetchone())
    _drift_sender(connection, "Rewritten operating background.")

    # A blind materialize still refuses the edited descendant outright.
    with pytest.raises(SelectedDraftError, match="^selected_draft_superseded$"):
        service.materialize(_request(source, request_id=SECOND))
    # The old bound head is no longer current, so it is not a usable pin.
    with pytest.raises(SelectedDraftError, match="^stale_expected_revision$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=first.revision_id,
            expected_predecessor_binding_hash=first.binding_hash,
        ))
    with pytest.raises(SelectedDraftError, match="^predecessor_binding_stale$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=edited,
            expected_predecessor_binding_hash="b" * 64,
        ))
    assert _counts(connection, "revision", *P22_TABLES) == (2, 1, 1)

    second = service.materialize(_request(
        source, request_id=SECOND, expected_revision_id=edited,
        expected_predecessor_binding_hash=first.binding_hash,
    ))

    assert (second.state, second.replayed) == ("regenerated", False)
    assert second.superseded_revision_id == edited
    assert second.predecessor_binding_hash == first.binding_hash
    assert second.revision_id not in {first.revision_id, edited}
    assert second.source_context_digest == first.source_context_digest
    assert second.render_context_digest != first.render_context_digest
    # Nothing old moved: text, binding row and QA context are byte-identical.
    assert tuple(connection.execute(
        "SELECT subject,body,hash FROM revision WHERE revision_id=?", (first.revision_id,),
    ).fetchone()) == bound_copy
    assert tuple(connection.execute(
        "SELECT subject,body,hash FROM revision WHERE revision_id=?", (edited,),
    ).fetchone()) == edited_copy
    assert dict(connection.execute(
        "SELECT * FROM selected_draft_binding WHERE binding_id=?", (first.binding_id,),
    ).fetchone()) == first_binding_row
    assert tuple(connection.execute(
        "SELECT * FROM revision_qa_context WHERE revision_id=?", (first.revision_id,),
    ).fetchone()) == first_qa_context
    assert _counts(connection, "revision", *P22_TABLES) == (3, 2, 2)
    # The appended generation is an unparented provenance root, and no budget
    # lineage or P21 reset was opened for it.
    assert [
        tuple(row) for row in connection.execute(
            """SELECT count(*) FROM review_revision_lineage WHERE child_revision_id=?
               UNION ALL
               SELECT count(*) FROM prospecting_agent_revision_lineage
                WHERE child_revision_id=?""",
            (second.revision_id, second.revision_id),
        ).fetchall()
    ] == [(0,), (0,)]
    assert _counts(connection, "prospecting_pipeline_item", "prospecting_pipeline_reset") == (0, 0)
    # The request row is the durable supersession receipt.
    assert tuple(connection.execute(
        """SELECT operation,expected_revision_id,expected_predecessor_binding_hash,
                  result_state FROM selected_draft_request WHERE request_id=?""",
        (SECOND,),
    ).fetchone()) == ("regenerate", edited, first.binding_hash, "regenerated")

    # The new generation resolves its own current selected proof; the old one and
    # the human edit above it now stale-refuse against the changed render context.
    assert resolve_revision_selection(
        connection, second.revision_id, NOW,
    ).person_id == source.person_id
    for stale in (first.revision_id, edited):
        with pytest.raises(SelectedDraftError, match="^selected_render_context_stale$"):
            resolve_revision_selection(connection, stale, NOW)

    # Exact historical replay survives further drift and invents nothing.
    _drift_sender(connection, "Drifted again after the regeneration.")
    replay = service.materialize(_request(
        source, request_id=SECOND, expected_revision_id=edited,
        expected_predecessor_binding_hash=first.binding_hash,
    ))
    assert replay == dataclasses.replace(second, replayed=True)
    assert _counts(connection, "revision", *P22_TABLES) == (3, 2, 2)
    connection.close()


def test_pinned_head_must_be_a_verified_descendant_of_the_superseded_binding(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    stranger = _revision_copy(
        connection, first.revision_id, "rev-stranger", "Stranger subject",
        "Stranger body", "a1" * 32,
    )

    with pytest.raises(SelectedDraftError, match="^expected_revision_unrelated$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=stranger,
            expected_predecessor_binding_hash=first.binding_hash,
        ))

    _link(connection, first.revision_id, stranger, "unverified", passed=False)
    with pytest.raises(SelectedDraftError, match="^revision_lineage_unverified$"):
        service.materialize(_request(
            source, request_id=THIRD, expected_revision_id=stranger,
            expected_predecessor_binding_hash=first.binding_hash,
        ))
    with pytest.raises(SelectedDraftError, match="^selected_draft_superseded$"):
        service.materialize(_request(source, request_id=FOURTH))

    assert _counts(connection, "revision", *P22_TABLES) == (2, 1, 1)
    assert _head(connection, source.campaign_id, source.person_id) == stranger
    connection.close()


def test_regeneration_without_a_real_context_change_is_refused(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))

    assert first.superseded_revision_id is None
    with pytest.raises(SelectedDraftError, match="^regeneration_context_unchanged$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=first.revision_id,
            expected_predecessor_binding_hash=first.binding_hash,
        ))

    # A fresh unchanged-context materialize reuses the binding and invents no
    # supersession at all.
    reuse = service.materialize(_request(source, request_id=THIRD))
    assert (reuse.state, reuse.superseded_revision_id) == ("unchanged", None)
    assert _counts(connection, "revision", *P22_TABLES) == (1, 1, 2)
    connection.close()


def test_pending_human_work_blocks_descendant_regeneration(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    edited = _human_edit(connection, source.campaign_id, first.revision_id, EDIT_ONE)
    _drift_sender(connection, "Rewritten operating background.")
    revision = connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (edited,),
    ).fetchone()
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,'pending_qa',NULL,?)""",
        (
            "cand_pending", "req_pending", revision["campaign_id"],
            revision["person_id"], revision["step"], edited, "Second human subject",
            "Second human body", STAMP,
        ),
    )

    with pytest.raises(SelectedDraftError, match="^human_edit_unresolved$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=edited,
            expected_predecessor_binding_hash=first.binding_hash,
        ))

    assert _counts(connection, "revision", *P22_TABLES) == (2, 1, 1)
    assert _head(connection, source.campaign_id, source.person_id) == edited
    connection.close()


def test_failed_descendant_regeneration_rolls_back_and_keeps_the_existing_head(
    tmp_path: Path, monkeypatch,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    first = service.materialize(_request(source))
    edited = _human_edit(connection, source.campaign_id, first.revision_id, EDIT_ONE)
    _drift_sender(connection, "Rewritten operating background.")
    monkeypatch.setattr(
        render_module, "record_revision_qa_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("context_rejected")),
    )

    with pytest.raises(ValueError, match="^context_rejected$"):
        service.materialize(_request(
            source, request_id=SECOND, expected_revision_id=edited,
            expected_predecessor_binding_hash=first.binding_hash,
        ))

    assert _counts(connection, "revision", *P22_TABLES) == (2, 1, 1)
    assert _head(connection, source.campaign_id, source.person_id) == edited
    assert not connection.in_transaction
    connection.close()


def test_inconsistent_stored_agent_edge_is_refused_with_a_valid_control(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    first = _service(connection).materialize(_request(source))
    child = _revision_copy(
        connection, first.revision_id, "rev-agent-one", "Agent subject one",
        "Agent body one", "a2" * 32,
    )
    _agent_edge(connection, first.revision_id, child, "one", run_id=source.run_id)

    # Control: a consistent stored edge resolves back to the bound root.
    assert resolve_revision_selection(
        connection, child, NOW,
    ).person_id == source.person_id

    # Each broken case is an independent sibling of the control child under the very
    # same bound root, so its refusal is caused by its own stored inconsistency and
    # not by an already-unverifiable parent above it.  They reuse the control's
    # pipeline item at later repair cycles, which keeps that item's base revision and
    # lineage root exactly the real unparented root: no P21 reset is minted and no
    # trigger is weakened to admit these rows.
    mismatched_hash = _revision_copy(
        connection, first.revision_id, "rev-agent-two", "Agent subject two",
        "Agent body two", "a3" * 32,
    )
    _agent_edge(
        connection, first.revision_id, mismatched_hash, "two", run_id=source.run_id,
        item_tag="one", cycle=1, accepted_hash="c" * 64,
    )
    mismatched_body = _revision_copy(
        connection, first.revision_id, "rev-agent-three", "Agent subject three",
        "Agent body three", "a4" * 32,
    )
    _agent_edge(
        connection, first.revision_id, mismatched_body, "three", run_id=source.run_id,
        item_tag="one", cycle=2,
        suggestion_body="A different stored body than the child revision carries.",
    )

    for broken in (mismatched_hash, mismatched_body):
        with pytest.raises(SelectedDraftError, match="^revision_lineage_unverified$"):
            resolve_revision_selection(connection, broken, NOW)
    connection.close()


def test_restored_earlier_render_context_refuses_to_bind_one_revision_twice(
    tmp_path: Path,
) -> None:
    """A -> B -> restored A must refuse explicitly, not collide on the binding key.

    ``build_revision`` is idempotent, so regenerating under a render context that
    was restored to exactly the first generation's context resolves back to the
    first, already-bound revision.  The refusal must name that condition and leave
    the current head, its copy and every stored row exactly as they were.
    """
    connection, _selected, source = _render_ready(tmp_path)
    service = _service(connection)
    original_background = str(connection.execute(
        """SELECT sender_background FROM sender_profile
            WHERE sender_profile_id='sender-synthetic'""",
    ).fetchone()[0])

    first = service.materialize(_request(source))
    _drift_sender(connection, "A second, genuinely different operating background.")
    second = service.materialize(_request(
        source, request_id=SECOND, expected_revision_id=first.revision_id,
        expected_predecessor_binding_hash=first.binding_hash,
    ))

    assert second.state == "regenerated"
    assert second.revision_id != first.revision_id
    first_revision_row = dict(connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (first.revision_id,),
    ).fetchone())
    second_revision_row = dict(connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (second.revision_id,),
    ).fetchone())
    second_binding_row = dict(connection.execute(
        "SELECT * FROM selected_draft_binding WHERE binding_id=?", (second.binding_id,),
    ).fetchone())

    # Restore the exact earlier render context.
    _drift_sender(connection, original_background)

    with pytest.raises(SelectedDraftError, match="^selected_revision_already_bound$"):
        service.materialize(_request(
            source, request_id=THIRD, expected_revision_id=second.revision_id,
            expected_predecessor_binding_hash=second.binding_hash,
        ))

    # The current head is still the second generation, byte for byte, and no third
    # revision, binding or request row was opened.
    assert _head(connection, source.campaign_id, source.person_id) == second.revision_id
    assert dict(connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (second.revision_id,),
    ).fetchone()) == second_revision_row
    assert dict(connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (first.revision_id,),
    ).fetchone()) == first_revision_row
    assert dict(connection.execute(
        "SELECT * FROM selected_draft_binding WHERE binding_id=?", (second.binding_id,),
    ).fetchone()) == second_binding_row
    assert _counts(connection, "revision", *P22_TABLES) == (2, 2, 2)
    assert _counts(connection, "prospecting_pipeline_item", "prospecting_pipeline_reset") == (0, 0)
    assert not connection.in_transaction

    # While the sender is restored to A's exact background, B's source resolution
    # must honestly refuse as stale: the production resolver correctly reports that
    # the currently saved context no longer matches the binding it was rendered
    # under, precisely because the sender has been restored to A.
    with pytest.raises(SelectedDraftError, match="^selected_render_context_stale$"):
        resolve_revision_selection(connection, second.revision_id, NOW)

    # Restore the exact B background and confirm recovery: B resolves again, stays
    # head, and no new binding or request row was opened by any of this -- the same
    # two bindings/requests from the two real materializations above remain.
    _drift_sender(connection, "A second, genuinely different operating background.")
    assert resolve_revision_selection(
        connection, second.revision_id, NOW,
    ).person_id == source.person_id
    assert _head(connection, source.campaign_id, source.person_id) == second.revision_id
    assert _counts(connection, "revision", *P22_TABLES) == (2, 2, 2)
    connection.close()


def test_selected_pipeline_can_configure_format_after_p20_before_p22(tmp_path: Path) -> None:
    """The genuine P15–P20 fixture remains renderable without P8 fit approval."""
    connection = open_store(tmp_path / "store.sqlite")
    _profile(connection, PROFILE_ID)
    campaigns = CampaignService(
        connection, campaign_id_factory=lambda: CAMPAIGN_ID, now=lambda: STAMP,
    )
    created = campaigns.create(
        request_id=REQUEST_ONE, brief_text=BRIEF, sender_profile_id=PROFILE_ID,
        mailbox_id=MAILBOX_ID, require_first_draft_compatible=True,
    )
    started, funding, selected = _seed(
        connection, tmp_path, campaign_id=CAMPAIGN_ID, seed_campaign=False,
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _people_request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    qualification = _qualify(connection, started, funding, people)
    ranking = RankingService(connection, now=lambda: NOW).start_or_resume(
        _rank_request(started, qualification),
    )
    projection = RankingService(connection, now=lambda: NOW).get_projection(started.run_id)
    person = projection.companies[0].people[0]
    source = _resolve(connection, started, ranking, person.person_rank_id)
    missing = campaigns.selected_draft_format_status(CAMPAIGN_ID)
    configured = campaigns.configure_selected_draft_format(CAMPAIGN_ID, missing.policy_state_hash)

    assert (missing.state, configured.state, configured.policy_hash) == (
        "missing", "configured", created.policy_hash,
    )
    assert source.ranking_batch_hash == ranking.batch_hash == projection.batch_hash
    assert connection.execute(
        "SELECT count(*) FROM campaign_fit_spec WHERE campaign_id=?", (CAMPAIGN_ID,),
    ).fetchone()[0] == 0
    result = _service(connection).materialize(_request(source))
    assert (result.state, result.replayed) == ("bound", False)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()
