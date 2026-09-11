"""Offline preparation tests for the manual native-stage acceptance harness.

Nothing here runs, or claims to have run, the manual desktop trial.  No model,
native adapter, private runtime, network, browser, credential or real store is
touched: only the harness's own fixture preparation, the real selected
resolver, and a real ``PipelineStageService`` with no adapters at all, entirely
inside ``tmp_path``.  The P19 qualification fact-check reached through the
fixture pipeline is a synthetic in-process adapter, not a qualification model.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit

import pytest

import scripts.prospecting.selected_draft_service as selected_draft_module
import scripts.prospecting.tests.manual_private_stage_acceptance as harness
import scripts.prospecting.tests.test_selected_person_render as render_tests
from scripts.prospecting.pipeline_stage_service import (
    PipelineStageError,
    PipelineStageService,
)
from scripts.prospecting.selected_draft_service import resolve_revision_selection
from scripts.prospecting.selected_person_render import RENDER_VERSION
from scripts.prospecting.selected_source_review import selected_revision_role_proof
from scripts.prospecting.tests.test_selected_person_render import LEGACY_TABLES, _counts
from scripts.prospecting.tests.test_selected_person_source import NOW


@pytest.fixture
def prepared(tmp_path: Path):
    connection, fixture = harness._prepare_fixture(tmp_path / "run", NOW)
    try:
        yield connection, fixture
    finally:
        connection.close()


def test_reviewed_sender_fixture_is_coherent_and_explicitly_synthetic() -> None:
    name, focus, proof = harness.SYNTHETIC_SENDER

    assert name == "Sam Synthetic"
    for sentence in (focus, proof):
        assert sentence == sentence.strip() and "  " not in sentence
        assert sentence.startswith("I ") and sentence.endswith(".")
        # Exactly one terminal sentence, not a concatenated fragment.
        assert sentence[:-1].count(".") == 0
        assert len(sentence.split()) >= 8
    assert "operations" in focus.casefold()
    assert "synthetic" in proof.casefold()
    assert "climate" not in " ".join(harness.SYNTHETIC_SENDER).casefold()


def test_harness_carries_no_obsolete_p8_fixture_identifiers() -> None:
    text = Path(harness.__file__).read_text(encoding="utf-8")

    for name in ("EXPECTED_PERSON_ID", "EXPECTED_CAMPAIGN_ID", "EXPECTED_COMPANY_ID"):
        assert not hasattr(harness, name)
        assert name not in text
    for value in (
        "per_0000000000000001", "camp_0000000000000001", "cmp_0000000000000001",
        "_draft_ready_fixture", "draft_step_zero_proof_pending", "person_affinity",
        "source_proof_pending",
    ):
        assert value not in text
    # The selected helper needs no monkeypatch, so no pytest dependency remains.
    assert "import pytest" not in text
    assert "monkeypatch" not in text


def test_prepare_fixture_binds_exactly_one_selected_draft(prepared, tmp_path: Path) -> None:
    connection, fixture = prepared

    assert (tmp_path / "run" / harness.STORE_NAME).is_file()
    assert _counts(
        connection, "revision", "selected_draft_binding", "selected_draft_request",
    ) == (1, 1, 1)
    binding = connection.execute("SELECT * FROM selected_draft_binding").fetchone()
    assert str(binding["binding_id"]) == fixture.binding_id
    assert str(binding["binding_hash"]) == fixture.binding_hash
    assert str(binding["revision_id"]) == fixture.revision_id
    assert str(binding["person_id"]) == fixture.person_id
    assert str(binding["campaign_id"]) == fixture.campaign_id
    assert binding["predecessor_binding_hash"] is None
    request = connection.execute("SELECT * FROM selected_draft_request").fetchone()
    assert str(request["request_id"]) == harness.FIXTURE_REQUEST_ID
    assert str(request["operation"]) == "materialize"
    assert str(request["result_state"]) == "bound"
    assert request["expected_revision_id"] is None


def test_prepare_fixture_binds_the_exact_revision_identity_and_context(prepared) -> None:
    connection, fixture = prepared

    revision = connection.execute("SELECT * FROM revision").fetchone()
    assert str(revision["revision_id"]) == fixture.revision_id
    assert str(revision["hash"]) == fixture.revision_hash
    assert str(revision["prompt_version"]) == fixture.prompt_version
    assert fixture.prompt_version.startswith(f"{RENDER_VERSION}:")
    assert len(fixture.prompt_version.split(":")) == 3
    assert int(revision["step"]) == 0
    assert str(revision["campaign_id"]) == fixture.campaign_id
    assert str(revision["person_id"]) == fixture.person_id
    # One own QA context, inherited from nothing: a proper pending-proof draft.
    context = connection.execute(
        "SELECT inherited_from_revision_id FROM revision_qa_context WHERE revision_id=?",
        (fixture.revision_id,),
    ).fetchall()
    assert len(context) == 1 and context[0][0] is None


def test_prepare_fixture_writes_no_legacy_or_attestation_rows(prepared) -> None:
    connection, _fixture = prepared

    # fill_person / fill_firm / contact_point / person_affinity / approval /
    # campaign_fit_spec / identity_source_review are all empty: no fabricated
    # fill, contact, affinity, approval, P13 or source-attestation row.
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    assert _counts(
        connection, "prospecting_pipeline_item", "prospecting_pipeline_reset",
    ) == (0, 0)
    assert _counts(
        connection, "prospecting_stage_attempt", "prospecting_stage_artifact",
    ) == (0, 0)
    # No P24 selected-source attestation, and no attestation request either.
    assert _counts(
        connection, "selected_source_attestation",
        "selected_source_attestation_request",
    ) == (0, 0)


def test_prepare_fixture_leaves_the_selected_source_proof_pending(prepared) -> None:
    """The real shared P24 helper must report an unattested exact-source proof."""
    connection, fixture = prepared

    resolved = resolve_revision_selection(connection, fixture.revision_id, NOW)
    proof = selected_revision_role_proof(connection, fixture.revision_id, NOW)

    assert resolved is not None
    assert proof is not None
    assert proof.attested is False
    assert proof.candidate_observation_id == resolved.candidate_observation_id
    assert proof.snapshot_id == resolved.snapshot_id
    assert proof.person_id == fixture.person_id
    assert proof.campaign_id == fixture.campaign_id
    assert _counts(
        connection, "selected_source_attestation",
        "selected_source_attestation_request",
    ) == (0, 0)


def test_prepare_fixture_stores_the_reviewed_sender_facts_in_the_draft(prepared) -> None:
    connection, fixture = prepared

    sender = connection.execute(
        """SELECT sender_name,sender_focus,sender_operating_proof FROM sender_profile
            WHERE sender_profile_id=(
              SELECT sender_profile_id FROM campaign WHERE campaign_id=?
            )""",
        (fixture.campaign_id,),
    ).fetchone()
    assert tuple(str(value) for value in sender) == harness.SYNTHETIC_SENDER
    body = str(connection.execute(
        "SELECT body FROM revision WHERE revision_id=?", (fixture.revision_id,),
    ).fetchone()[0])
    assert body.strip()
    assert harness.SYNTHETIC_SENDER[0] in body
    assert "{" not in body and "}" not in body


def test_prepare_fixture_sources_are_synthetic_test_urls_on_the_allowlist(prepared) -> None:
    connection, _fixture = prepared

    rows = connection.execute(
        "SELECT source_url,allowlist_version FROM source_snapshot",
    ).fetchall()
    assert rows
    for row in rows:
        assert (urlsplit(str(row[0])).hostname or "").endswith(".test")
        assert str(row[1]) in harness.ALLOWED_ALLOWLISTS


def test_allowed_allowlists_cover_the_real_capture_sources(prepared) -> None:
    """The P17 funding capture allowlist version is a real fixture source."""
    connection, _fixture = prepared

    assert harness.ALLOWED_ALLOWLISTS == frozenset({
        "fixture-v1", "operator-local-v1", "operator-public-capture-v1",
    })
    versions = {
        str(row[0]) for row in connection.execute(
            "SELECT allowlist_version FROM source_snapshot",
        ).fetchall()
    }
    assert "operator-public-capture-v1" in versions
    assert versions <= harness.ALLOWED_ALLOWLISTS


def test_prepare_fixture_revision_resolves_back_to_the_bound_selection(prepared) -> None:
    connection, fixture = prepared

    resolved = resolve_revision_selection(connection, fixture.revision_id, NOW)

    assert resolved is not None
    assert resolved.person_id == fixture.person_id
    assert resolved.campaign_id == fixture.campaign_id
    assert resolved.source_context_digest == fixture.prompt_version.split(":")[1]


def test_stage_start_uses_the_real_service_without_any_model(prepared) -> None:
    """Start the real stage service with no adapters at all: nothing can call out."""
    connection, fixture = prepared
    service = PipelineStageService(connection, adapters={}, now=lambda: NOW)

    item = service.start_from_saved_revision(
        fixture.campaign_id, fixture.revision_id, "offline-preparation-start",
    )

    assert item.state == "awaiting_humanizer_adapter"
    assert item.next_stage == "humanizer"
    assert item.repair_cycle == 0
    assert item.campaign_id == fixture.campaign_id
    assert item.person_id == fixture.person_id
    assert item.base_revision_id == fixture.revision_id
    # No adapter exists at all, so no stage is runnable and no model is reachable.
    with pytest.raises(PipelineStageError) as refused:
        service.run_next(item.item_id, "offline-preparation-run")
    assert refused.value.code == "stage_adapter_unavailable"
    assert refused.value.code in harness.FIXED_CODES
    assert _counts(
        connection, "prospecting_stage_attempt", "prospecting_stage_artifact",
    ) == (0, 0)


def test_prepare_fixture_closes_its_connection_on_failure(tmp_path: Path, monkeypatch) -> None:
    opened = []
    real_open_store = render_tests.open_store

    def _tracking(path):
        connection = real_open_store(path)
        opened.append(connection)
        return connection

    class _Refusing:
        def __init__(self, *_args, **_kwargs) -> None:
            raise RuntimeError("synthetic materialization refusal")

    monkeypatch.setattr(render_tests, "open_store", _tracking)
    monkeypatch.setattr(selected_draft_module, "SelectedDraftService", _Refusing)

    with pytest.raises(harness._HarnessError) as refused:
        harness._prepare_fixture(tmp_path / "run", NOW)

    assert refused.value.code == "fixture_preparation_failed"
    assert refused.value.code in harness.FIXED_CODES
    assert opened
    for connection in opened:
        with pytest.raises(sqlite3.ProgrammingError):
            connection.execute("SELECT 1")


def test_default_main_is_a_no_op_with_no_filesystem_or_model(
    tmp_path: Path, capsys, monkeypatch,
) -> None:
    def _boom(*_args, **_kwargs):
        raise AssertionError("the default invocation must do nothing")

    private_root = tmp_path / "private-root"
    monkeypatch.setattr(harness, "PRIVATE_ROOT", private_root)
    monkeypatch.setattr(harness, "_run", _boom)
    monkeypatch.setattr(harness, "_new_run_root", _boom)
    monkeypatch.setattr(harness, "_prepare_fixture", _boom)

    assert harness.main([]) == 0

    report = json.loads(capsys.readouterr().out)
    assert report["mode"] == "default"
    assert report["status"] == "not_attempted"
    assert report["code"] == "manual_opt_in_required"
    assert (report["stages"], report["stage_calls"]) == ([], 0)
    assert not private_root.exists()
    assert list(tmp_path.iterdir()) == []


def test_run_flag_still_opts_in_to_exactly_one_trial(capsys, monkeypatch) -> None:
    calls = []

    def _record() -> int:
        calls.append(True)
        return 7

    monkeypatch.setattr(harness, "_run", _record)

    assert harness.main(["--run"]) == 7
    assert calls == [True]
    assert capsys.readouterr().out == ""
