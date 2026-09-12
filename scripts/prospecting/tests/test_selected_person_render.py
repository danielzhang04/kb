"""P22 selected-person rendering over the genuine P15-P20 fixture pipeline.

No P8/fill/contact/approval shortcut is used anywhere here: the real intake,
funding, person-import, qualification and ranking fixtures produce the selection,
and the only saved state these tests edit is the campaign copy profile and the
sender profile facts the render legitimately requires.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.affinity.evidence_bridge import selected_person_identity
from scripts.prospecting.affinity.templates_v2 import (
    DraftError,
    draft_campaign,
    load_campaign_render_context,
)
from scripts.prospecting.person_research_service import PersonResearchService
from scripts.prospecting.ranking_service import RankingService
from scripts.prospecting.store import open_store
import scripts.prospecting.selected_person_render as render_module
from scripts.prospecting.selected_person_render import (
    RENDER_VERSION,
    SelectedRenderError,
    render_selected_person_revision,
    selected_render_context_digest,
)
from scripts.prospecting.tests.test_affinity_templates_v2 import NOW as P8_NOW, _draft_ready_fixture
from scripts.prospecting.tests.test_person_research_service import (
    CAMPAIGN_ID,
    _person,
    _request,
    _seed,
)
from scripts.prospecting.tests.test_ranking_service import _rank_request
from scripts.prospecting.tests.test_selected_person_source import NOW, STAMP, _qualify, _resolve


LEGACY_TABLES = (
    "fill_person", "fill_firm", "contact_point", "person_affinity", "approval",
    "campaign_fit_spec", "identity_source_review",
)
STATE_TABLES = ("evidence", "revision", "revision_qa_context")
# The caller's anchors object is required but never read for sender facts.
ANCHORS = object()
# Injected only into RELEASE of the render's own savepoint; it stands for the
# dynamic driver text that must never reach a public refusal.
DRIVER_TEXT = "PRIVATE DRIVER TEXT"
CALLER_MARKER = "caller-owned-write"


class _ReleaseFailingConnection:
    """Delegate every statement to the real store, failing only RELEASE.

    Nothing is simulated beyond that single failure: ``SAVEPOINT``, ``ROLLBACK TO``
    and all rendering SQL run against the genuine connection, so the render's own
    rollback really undoes its writes and the caller-owned savepoint opened beneath
    it is genuinely untouched.
    """

    def __init__(self, connection, *, failures: int | None = 1) -> None:
        self._connection = connection
        self._remaining = failures
        self.release_attempts = 0
        self.rollback_attempts = 0

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def execute(self, sql, *parameters):
        statement = " ".join(str(sql).split()).upper()
        if statement.startswith(f"ROLLBACK TO {render_module.SAVEPOINT}".upper()):
            self.rollback_attempts += 1
        if statement.startswith(f"RELEASE {render_module.SAVEPOINT}".upper()):
            self.release_attempts += 1
            if self._remaining is None or self._remaining > 0:
                if self._remaining is not None:
                    self._remaining -= 1
                raise sqlite3.OperationalError(f"cannot release savepoint - {DRIVER_TEXT}")
        return self._connection.execute(sql, *parameters)


def _caller_owned_write(connection) -> None:
    """Open a caller-owned savepoint holding one write the render must not touch."""
    connection.execute("SAVEPOINT caller_owned_tx")
    connection.execute("CREATE TABLE caller_marker(marker TEXT PRIMARY KEY)")
    connection.execute("INSERT INTO caller_marker(marker) VALUES (?)", (CALLER_MARKER,))


def _caller_write_intact(connection) -> bool:
    return connection.execute(
        "SELECT count(*) FROM caller_marker WHERE marker=?", (CALLER_MARKER,),
    ).fetchone()[0] == 1


def _copy_profile(connection, *, subject_chars=(36, 50), body_words=(75, 125)) -> None:
    connection.execute(
        "UPDATE campaign SET policy_json=? WHERE campaign_id=?",
        (
            json.dumps({"copy_profile": {
                "subject_chars": list(subject_chars), "body_words": list(body_words),
            }}),
            CAMPAIGN_ID,
        ),
    )


def _sender_facts(connection) -> None:
    connection.execute(
        """UPDATE sender_profile
              SET sender_name=?,sender_focus=?,sender_operating_proof=?
            WHERE sender_profile_id='sender-synthetic'""",
        (
            "Actual Sender", "I am focused on synthetic operations.",
            "I built a verified synthetic operating project.",
        ),
    )


def _render_ready(root: Path, *, slug: str = "avery"):
    """Run the real P15-P20 fixture pipeline and resolve the selected source."""
    root.mkdir(parents=True, exist_ok=True)
    connection = open_store(root / "store.sqlite")
    started, funding, selected = _seed(connection, root)
    _copy_profile(connection)
    _sender_facts(connection)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(root, selected, slug=slug),)),
    )
    qualification = _qualify(connection, started, funding, people)
    service = RankingService(connection, now=lambda: NOW)
    ranking = service.start_or_resume(_rank_request(started, qualification))
    person = service.get_projection(started.run_id).companies[0].people[0]
    source = _resolve(connection, started, ranking, person.person_rank_id)
    return connection, selected, source


def _counts(connection, *tables: str) -> tuple[int, ...]:
    return tuple(
        connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in tables
    )


def test_legacy_p8_drafting_and_its_approved_fit_gate_are_unchanged(tmp_path, monkeypatch) -> None:
    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=P8_NOW)

    assert summary.revisions_created == 1 and summary.failure_codes == {}
    connection.execute("UPDATE campaign_fit_spec SET state='superseded'")
    with pytest.raises(DraftError, match="^approved_fit_spec_missing$"):
        draft_campaign(connection, campaign_id, 0, anchors=object(), now=P8_NOW)
    connection.close()


def test_selected_render_binds_the_exact_selected_identity_and_digest(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)

    result = render_selected_person_revision(
        connection, selected=source, anchors=ANCHORS, now=NOW,
    )

    assert result.created is True
    assert len(result.render_context_digest) == 64
    assert result.render_context_digest == selected_render_context_digest(
        connection, CAMPAIGN_ID,
    )
    assert result.prompt_version == (
        f"{RENDER_VERSION}:{source.source_context_digest}"
        f":{result.render_context_digest}"
    )
    assert result.person_id == source.person_id
    assert result.template_id == "startup_current_role_hook"
    person_id, campaign_id, step, subject, body, model, prompt = connection.execute(
        """SELECT person_id,campaign_id,step,subject,body,model_version,prompt_version
             FROM revision""",
    ).fetchone()
    assert (person_id, campaign_id, step, model) == (
        source.person_id, source.campaign_id, 0, "none",
    )
    assert prompt == result.prompt_version
    assert "Head of Operations" in body and "Nimbus Systems" in body
    assert "Avery" in body and 36 <= len(subject) <= 50
    assert "Actual Sender" in body and "15 minutes" in body
    assert _counts(connection, "evidence") == (len(result.evidence_ids),)
    assert _counts(connection, "revision_qa_context") == (1,)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert connection.execute(
        "SELECT count(*) FROM evidence WHERE person_id=? AND allowed_for_copy=1",
        (source.person_id,),
    ).fetchone()[0] == len(result.evidence_ids)
    connection.close()


def test_selected_render_replays_deterministically_without_new_rows(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)

    first = render_selected_person_revision(
        connection, selected=source, anchors=ANCHORS, now=NOW,
    )
    second = render_selected_person_revision(
        connection, selected=source, anchors=ANCHORS, now=NOW,
    )

    assert second.created is False
    assert (second.revision_id, second.revision_hash) == (first.revision_id, first.revision_hash)
    assert second.evidence_ids == first.evidence_ids
    assert second.prompt_version == first.prompt_version
    assert _counts(connection, "revision", "revision_qa_context") == (1, 1)
    assert _counts(connection, "evidence") == (len(first.evidence_ids),)
    assert connection.execute(
        "SELECT inherited_from_revision_id FROM revision_qa_context WHERE revision_id=?",
        (first.revision_id,),
    ).fetchone()[0] is None
    connection.close()


@pytest.mark.parametrize(
    ("case", "code"),
    (
        ("source", "source_changed"),
        ("campaign", "campaign_not_draft"),
        ("sender", "sender_profile_invalid"),
        ("anchors", "sender_anchors_missing"),
    ),
)
def test_changed_source_campaign_or_sender_is_refused_before_any_write(
    tmp_path: Path, case: str, code: str,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    if case == "source":
        body_ref = connection.execute(
            """SELECT body_ref FROM source_snapshot
                WHERE allowlist_version='operator-local-v1' ORDER BY rowid DESC LIMIT 1""",
        ).fetchone()[0]
        (tmp_path / "snapshots" / body_ref).write_text("PRIVATE SENTINEL", encoding="utf-8")
    elif case == "campaign":
        connection.execute(
            "UPDATE campaign SET status='paused' WHERE campaign_id=?", (CAMPAIGN_ID,),
        )
    elif case == "sender":
        connection.execute(
            "UPDATE sender_profile SET sender_operating_proof='' WHERE sender_profile_id=?",
            ("sender-synthetic",),
        )

    with pytest.raises(SelectedRenderError) as refused:
        render_selected_person_revision(
            connection, selected=source,
            anchors=None if case == "anchors" else ANCHORS, now=NOW,
        )

    assert str(refused.value) == code
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    assert _counts(connection, *STATE_TABLES) == (0, 0, 0)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_non_default_saved_copy_bands_are_enforced_without_any_write(tmp_path: Path) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    _copy_profile(connection, subject_chars=(40, 50))

    with pytest.raises(SelectedRenderError, match="^subject_chars_out_of_band$"):
        render_selected_person_revision(
            connection, selected=source, anchors=ANCHORS, now=NOW,
        )

    assert _counts(connection, *STATE_TABLES) == (0, 0, 0)
    connection.close()


def test_identical_copy_from_a_different_source_has_a_different_revision_identity(
    tmp_path: Path,
) -> None:
    first_connection, _first_selected, first_source = _render_ready(tmp_path / "first")
    second_connection, _second_selected, second_source = _render_ready(
        tmp_path / "second", slug="avery-alternate-page",
    )

    first = render_selected_person_revision(
        first_connection, selected=first_source, anchors=ANCHORS, now=NOW,
    )
    second = render_selected_person_revision(
        second_connection, selected=second_source, anchors=ANCHORS, now=NOW,
    )

    assert first_source.source_context_digest != second_source.source_context_digest
    first_copy = first_connection.execute("SELECT subject,body FROM revision").fetchone()
    second_copy = second_connection.execute("SELECT subject,body FROM revision").fetchone()
    assert tuple(first_copy) == tuple(second_copy)
    assert first.revision_hash != second.revision_hash
    assert first.prompt_version != second.prompt_version
    assert set(first.evidence_ids).isdisjoint(second.evidence_ids)
    first_connection.close()
    second_connection.close()


def test_changed_unused_sender_field_keeps_the_copy_but_changes_render_identity(
    tmp_path: Path,
) -> None:
    """A saved sender fact this template never copies still moves render identity."""
    connection, _selected, source = _render_ready(tmp_path)

    first = render_selected_person_revision(
        connection, selected=source, anchors=ANCHORS, now=NOW,
    )
    first_copy = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (first.revision_id,),
    ).fetchone()
    connection.execute(
        """UPDATE sender_profile SET sender_background=?
            WHERE sender_profile_id='sender-synthetic'""",
        ("A different, unused operating background.",),
    )
    second = render_selected_person_revision(
        connection, selected=source, anchors=ANCHORS, now=NOW,
    )
    second_copy = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (second.revision_id,),
    ).fetchone()

    assert tuple(first_copy) == tuple(second_copy)
    assert second.source_context_digest == first.source_context_digest
    assert second.render_context_digest != first.render_context_digest
    assert second.revision_hash != first.revision_hash
    assert second.prompt_version != first.prompt_version
    assert second.created is True
    assert _counts(connection, "revision") == (2,)
    connection.close()


def test_failed_qa_context_write_leaves_no_partial_evidence_or_revision(
    tmp_path: Path, monkeypatch,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    monkeypatch.setattr(
        render_module, "record_revision_qa_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("context_rejected")),
    )

    with pytest.raises(ValueError, match="^context_rejected$"):
        render_selected_person_revision(
            connection, selected=source, anchors=ANCHORS, now=NOW,
        )

    assert _counts(connection, *STATE_TABLES) == (0, 0, 0)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    connection.close()


def test_release_failure_on_success_refuses_and_rolls_back_only_its_own_writes(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    _caller_owned_write(connection)
    proxy = _ReleaseFailingConnection(connection, failures=1)

    with pytest.raises(SelectedRenderError) as refused:
        render_selected_person_revision(
            proxy, selected=source, anchors=ANCHORS, now=NOW,
        )

    # Success may never be claimed once this call's own boundary could not be closed.
    assert str(refused.value) == "store_state_invalid"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    # One failed release, then a rollback and a proven release of this savepoint only.
    assert (proxy.release_attempts, proxy.rollback_attempts) == (2, 1)
    assert _counts(connection, *STATE_TABLES) == (0, 0, 0)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert _caller_write_intact(connection)
    connection.execute("RELEASE caller_owned_tx")
    connection.close()


def test_unclosable_savepoint_reports_cleanup_failure_without_driver_text(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    _caller_owned_write(connection)
    proxy = _ReleaseFailingConnection(connection, failures=None)

    with pytest.raises(SelectedRenderError) as refused:
        render_selected_person_revision(
            proxy, selected=source, anchors=ANCHORS, now=NOW,
        )

    assert str(refused.value) == "selected_render_cleanup_failed"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert DRIVER_TEXT not in repr(refused.value)
    assert proxy.release_attempts == 2
    assert _counts(connection, *STATE_TABLES) == (0, 0, 0)
    assert _caller_write_intact(connection)
    connection.execute("ROLLBACK TO caller_owned_tx")
    connection.execute("RELEASE caller_owned_tx")
    connection.close()


def test_cleanup_failure_reports_a_fixed_code_without_chaining_the_original(
    tmp_path: Path, monkeypatch,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    _caller_owned_write(connection)
    monkeypatch.setattr(
        render_module, "record_revision_qa_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ValueError("context_rejected PRIVATE SENTINEL"),
        ),
    )
    proxy = _ReleaseFailingConnection(connection, failures=None)

    with pytest.raises(SelectedRenderError) as refused:
        render_selected_person_revision(
            proxy, selected=source, anchors=ANCHORS, now=NOW,
        )

    # The in-render failure is untrusted text: it is suppressed, never chained.
    assert str(refused.value) == "selected_render_cleanup_failed"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    assert _counts(connection, *STATE_TABLES) == (0, 0, 0)
    assert _caller_write_intact(connection)
    connection.execute("ROLLBACK TO caller_owned_tx")
    connection.execute("RELEASE caller_owned_tx")
    connection.close()


def test_closed_connection_is_refused_with_a_fixed_code_and_no_cleanup(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)
    connection.close()

    with pytest.raises(SelectedRenderError) as refused:
        render_selected_person_revision(
            connection, selected=source, anchors=ANCHORS, now=NOW,
        )

    # The savepoint never opened, so no cleanup is owed and no driver text escapes.
    assert str(refused.value) == "store_state_invalid"
    assert refused.value.__cause__ is None
    assert refused.value.__suppress_context__ is True
    assert "closed database" not in repr(refused.value).casefold()


def test_private_identity_and_campaign_records_have_no_value_bearing_repr(
    tmp_path: Path,
) -> None:
    connection, _selected, source = _render_ready(tmp_path)

    identity = selected_person_identity(connection, source)
    context = load_campaign_render_context(connection, CAMPAIGN_ID)

    private_values = (
        identity.first_name, identity.full_name, identity.company_name,
        identity.title, identity.excerpt, context.sender_name,
        context.sender_focus, context.sender_operating_proof,
    )
    assert all(private_values)
    for record in (identity, context):
        text = repr(record)
        assert text.startswith("<") and " object at 0x" in text
        assert type(record).__name__ in text
        for value in private_values:
            assert value not in text
    # Suppressing repr must not weaken the frozen value semantics.
    assert identity == selected_person_identity(connection, source)
    assert context == load_campaign_render_context(connection, CAMPAIGN_ID)
    with pytest.raises(AttributeError):
        identity.first_name = "changed"
    connection.close()
