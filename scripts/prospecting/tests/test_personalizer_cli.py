import json
from dataclasses import replace
from pathlib import Path
import socket
import sqlite3

import pytest

from scripts.prospecting.personalizer.cli import (
    Summary,
    build_parser,
    emit_summary,
    main,
    run_fixture,
    run_name_swap_probe,
)
import scripts.prospecting.personalizer.cli as cli_module
from scripts.prospecting.personalizer.evidence import EvidenceRecord
from scripts.prospecting.review_qa import ReviewQaUnavailable
from scripts.prospecting.store import open_store


FIXTURE = Path("orgs/prospecting/fixtures/active-intents-20.json")
PROFILE = Path("orgs/prospecting/fixtures/sender-profile.synthetic.json")


def insert_campaign(connection: sqlite3.Connection, campaign_id: str, policy: str, policy_hash: str) -> None:
    connection.execute(
        """INSERT OR IGNORE INTO sender_profile(
             sender_profile_id,sender_name,sender_school,sender_focus,sender_background,
             sender_operating_proof,approved_metrics
           ) VALUES(?,?,?,?,?,?,?)""",
        ("sender-synthetic", "Example Sender", "Example University", "synthetic focus",
         "synthetic background", "synthetic proof", "[]"),
    )
    connection.execute(
        """INSERT INTO campaign(
             campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
             template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
             firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,
             policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (campaign_id, json.loads(policy)["intent"], "sender-synthetic", policy,
         "informational_call", 15, "warm", "fixture", "[]", "{}", "UTC", 25, 6, 2,
         "T1", "mailbox-synthetic", "{}", 0, "draft", policy_hash),
    )


def test_parser_exposes_only_prepare_and_personalize_commands() -> None:
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["fetch", "--campaign", "campaign-1"])
    prepared = parser.parse_args([
        "prepare", "--campaign", "campaign-1", "--sender-profile", "C:/local/sender-profile.json",
        "--output", "C:/local/model-input.json",
    ])
    personalized = parser.parse_args([
        "personalize", "--campaign", "campaign-1", "--sender-profile", "C:/local/sender-profile.json",
        "--model-response", "C:/local/model-response.json",
    ])
    assert {prepared.command, personalized.command} == {"prepare", "personalize"}


def test_sales_policy_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="intent_reserved"):
        run_fixture(FIXTURE, tmp_path / "store.sqlite", PROFILE, "sales")


@pytest.mark.parametrize("attempt", range(5))
def test_sales_activation_rejects_five_of_five(tmp_path: Path, attempt: int) -> None:
    with pytest.raises(ValueError, match="intent_reserved"):
        run_fixture(FIXTURE, tmp_path / f"store-{attempt}.sqlite", PROFILE, "sales")


def test_fixture_has_five_recipients_per_active_intent() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    counts = {intent: 0 for intent in ("networking", "recruiting_live", "curiosity", "alumni")}
    for row in data["rows"]:
        counts[row["intent"]] += 1
    assert counts == {intent: 5 for intent in counts}


def test_file_backed_run_creates_then_resumes_twenty_stable_results(tmp_path: Path, record_property) -> None:
    store = tmp_path / "store.sqlite"
    first = run_fixture(FIXTURE, store, PROFILE)
    second = run_fixture(FIXTURE, store, PROFILE)
    assert first.candidates == first.qa_passed == first.revisions_created == 20
    record_property("drafts_generated", first.revisions_created)
    assert second.revisions_created == 0 and second.qa_passed == 20
    connection = open_store(store)
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 20
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 20


def test_revision_and_qa_context_persist_atomically(tmp_path: Path, monkeypatch) -> None:
    store = tmp_path / "store.sqlite"

    def reject_context(*args, **kwargs):
        raise ValueError("context_rejected")

    monkeypatch.setattr(cli_module, "record_revision_qa_context", reject_context)
    with pytest.raises(ValueError, match="context_rejected"):
        run_fixture(FIXTURE, store, PROFILE)
    connection = open_store(store)
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 0


def test_equal_hash_retry_does_not_backfill_legacy_revision_context(
    tmp_path: Path, monkeypatch
) -> None:
    store = tmp_path / "store.sqlite"
    with monkeypatch.context() as context:
        context.setattr(cli_module, "record_revision_qa_context", lambda *args, **kwargs: None)
        first = run_fixture(FIXTURE, store, PROFILE)
    assert first.revisions_created == 20
    connection = open_store(store)
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 20
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 0
    connection.close()

    with pytest.raises(ReviewQaUnavailable, match="^qa_context_missing$"):
        run_fixture(FIXTURE, store, PROFILE)
    connection = open_store(store)
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 20
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 0


@pytest.mark.parametrize(
    "column,value", [("intent", "curiosity"), ("ask_type", "role_conversation")]
)
def test_database_policy_must_match_campaign_scope(
    tmp_path: Path, column: str, value: str
) -> None:
    connection = open_store(tmp_path / "policy.sqlite")
    insert_campaign(
        connection, "campaign-policy", json.dumps({
            "intent": "networking", "step": 0, "minimum_confidence": 0.8,
            "model_version": "fixture-v1",
        }), "f" * 64,
    )
    connection.execute(f"UPDATE campaign SET {column}=? WHERE campaign_id='campaign-policy'", (value,))
    with pytest.raises(ValueError, match="^campaign_policy_scope$"):
        cli_module._campaign_policy(connection, "campaign-policy")


def test_summary_json_has_exact_aggregate_keys(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    summary = run_fixture(FIXTURE, tmp_path / "store.sqlite", PROFILE)
    emit_summary(summary)
    payload = json.loads(capsys.readouterr().out)
    assert set(payload) == {
        "run_id", "candidates", "evidence_valid", "revisions_created", "qa_passed",
        "qa_failed", "failure_codes", "template_versions", "prompt_version", "model_version",
    }


def test_summary_output_contains_no_fixture_person_or_company_ids(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    emit_summary(run_fixture(FIXTURE, tmp_path / "store.sqlite", PROFILE))
    output = capsys.readouterr().out
    assert "person-" not in output and "company-" not in output and "contact-" not in output


def test_emit_summary_invokes_p1_sink_guard(tmp_path: Path, monkeypatch, capsys) -> None:
    calls: list[tuple[object, str]] = []
    monkeypatch.setattr(cli_module, "assert_vm_safe", lambda value, sink: calls.append((value, sink)))
    emit_summary(run_fixture(FIXTURE, tmp_path / "store.sqlite", PROFILE))
    capsys.readouterr()
    assert len(calls) == 1 and calls[0][1] == "stdout"


def test_model_response_argument_is_a_path_not_inline_json() -> None:
    args = build_parser().parse_args([
        "personalize", "--campaign", "campaign-1", "--sender-profile", "C:/local/sender-profile.json",
        "--model-response", "C:/local/model-response.json",
    ])
    assert args.model_response.name == "model-response.json"


def test_fixture_responses_have_one_ask_and_no_links() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for row in data["rows"]:
        response = row["model_response"]
        assert response["ask"].count("?") == 1
        assert set(response["evidence_ids_used"]) >= {"why_them"}
        assert "http" not in json.dumps(response).lower()


def test_name_swap_fixture_fails_end_to_end_for_both_rows(tmp_path: Path) -> None:
    failures = run_name_swap_probe(
        Path("orgs/prospecting/fixtures/name-swap.json"), tmp_path / "store.sqlite", PROFILE
    )
    assert failures == {"person-alpha": ("evidence_not_entailing", "name_swap"), "person-beta": ("evidence_not_entailing", "name_swap")}


def test_main_commits_exactly_twenty_rows_across_two_runs(tmp_path: Path, capsys) -> None:
    local = tmp_path / "kb-prospecting"
    local.mkdir()
    store = local / "store.sqlite"
    open_store(store).close()
    profile = local / "sender-profile.json"
    profile.write_text(PROFILE.read_text(encoding="utf-8"), encoding="utf-8")
    argv = [
        "personalize", "--campaign", "campaign-p3", "--sender-profile", str(profile),
        "--model-response", str(FIXTURE), "--store", str(store), "--fixture",
    ]
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
        monkeypatch.setattr(cli_module, "ROOT", tmp_path / "outside-repository")
        assert main(argv) == 0
        assert main(argv) == 0
    capsys.readouterr()
    connection = open_store(store)
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 20


def test_main_rejects_unc_store_before_opening_it(tmp_path: Path, monkeypatch, capsys) -> None:
    local = tmp_path / "kb-prospecting"
    local.mkdir()
    profile = local / "sender-profile.json"
    profile.write_text(PROFILE.read_text(encoding="utf-8"), encoding="utf-8")
    opened: list[Path] = []
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(cli_module, "open_store", lambda path: opened.append(path))
    result = main([
        "personalize", "--campaign", "campaign-p3", "--sender-profile", str(profile),
        "--model-response", str(FIXTURE), "--store", "//server/share/store.sqlite", "--fixture",
    ])
    captured = capsys.readouterr()
    assert result == 1 and captured.err == "desktop_local_path_required\n" and opened == []


def test_main_rejects_repository_store_before_opening_it(tmp_path: Path, monkeypatch, capsys) -> None:
    local = tmp_path / "kb-prospecting"
    local.mkdir()
    profile = local / "sender-profile.json"
    profile.write_text(PROFILE.read_text(encoding="utf-8"), encoding="utf-8")
    opened: list[Path] = []
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(cli_module, "open_store", lambda path: opened.append(path))
    result = main([
        "personalize", "--campaign", "campaign-p3", "--sender-profile", str(profile),
        "--model-response", str(FIXTURE), "--store", str(cli_module.ROOT / "store.sqlite"), "--fixture",
    ])
    captured = capsys.readouterr()
    assert result == 1 and captured.err == "desktop_local_path_required\n" and opened == []


def test_main_reports_missing_sender_profile_without_its_filename(tmp_path: Path, monkeypatch, capsys) -> None:
    local = tmp_path / "kb-prospecting"
    local.mkdir()
    store = local / "store.sqlite"
    open_store(store).close()
    missing_profile = local / "Avery-Quinn-sender-profile.json"
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(cli_module, "ROOT", tmp_path / "outside-repository")
    result = main([
        "personalize", "--campaign", "campaign-p3", "--sender-profile", str(missing_profile),
        "--model-response", str(FIXTURE), "--store", str(store), "--fixture",
    ])
    captured = capsys.readouterr()
    assert result == 1 and captured.err == "sender_profile_missing\n"
    assert "Avery" not in captured.err and "Quinn" not in captured.err


def test_run_database_job_queries_campaign_eligible_projection(tmp_path: Path, monkeypatch) -> None:
    local = tmp_path / "kb-prospecting"
    local.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    profile = local / "sender-profile.json"
    profile.write_text(PROFILE.read_text(encoding="utf-8"), encoding="utf-8")
    responses = local / "responses.json"
    responses.write_text('{"responses":{}}', encoding="utf-8")
    connection = open_store(local / "store.sqlite")
    connection.row_factory = sqlite3.Row
    insert_campaign(connection, "campaign-empty", '{"intent":"networking","step":0,"minimum_confidence":0.8,"model_version":"fixture-v1"}', "c" * 64)
    statements: list[str] = []
    connection.set_trace_callback(statements.append)
    summary = cli_module.run_database_job(connection, "campaign-empty", profile, responses)
    assert summary.candidates == 0
    projection = "\n".join(statements)
    assert "FROM person_tranche AS tranche" in projection
    assert "eligibility_decision AS decision" in projection
    assert "tranche.campaign_id = 'campaign-empty'" in projection
    assert "decision.outcome = 'eligible'" in projection


def test_prepare_sanitizes_snapshot_in_production_path_with_zero_network_attempts(tmp_path: Path, monkeypatch) -> None:
    local = tmp_path / "kb-prospecting"
    local.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    profile = local / "sender-profile.json"
    profile.write_text(PROFILE.read_text(encoding="utf-8"), encoding="utf-8")
    snapshot = local / "snapshot.html"
    snapshot.write_text(Path("orgs/prospecting/fixtures/snapshot-injection.html").read_text(encoding="utf-8"), encoding="utf-8")
    output = local / "model-input.json"
    connection = open_store(local / "store.sqlite")
    connection.row_factory = sqlite3.Row
    insert_campaign(connection, "campaign-prepare", '{"intent":"networking","step":0,"minimum_confidence":0.8,"model_version":"fixture-v1"}', "d" * 64)
    connection.execute(
        """INSERT INTO source_snapshot(snapshot_id,entity_id,source_url,source_domain,retrieved_at,
             content_type,content_sha256,allowlist_version,body_ref,expires_at,retention_delete_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        ("snapshot-1", "person-1", "https://example.test/source", "example.test",
         "2026-09-01T00:00:00Z", "text/html", "0" * 64, "fixture-v1", str(snapshot),
         "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    )
    item = EvidenceRecord(
        "evidence-1", "person-1", "Published an operations guide", "https://example.test/source",
        "2026-08-20", "2026-09-01T00:00:00Z", "Published an operations guide", 0.95,
        "2026-10-01T00:00:00Z", True,
    )
    monkeypatch.setattr(cli_module, "_projection", lambda connection, campaign_id: [{"person_id": "person-1", "first_name": "Casey", "company": "Example", "title": "operations"}])
    monkeypatch.setattr(cli_module, "list_evidence", lambda *args, **kwargs: (item,))
    attempts: list[object] = []
    monkeypatch.setattr(socket, "create_connection", lambda *args, **kwargs: attempts.append(args))
    summary = cli_module.prepare_database_job(connection, "campaign-prepare", profile, output)
    payload = output.read_text(encoding="utf-8")
    assert summary.evidence_valid == 1 and "Ignore previous" not in payload
    assert "snapshot_instruction_removed\": true" in payload and attempts == []


def test_projection_uses_each_campaigns_latest_eligibility_decision() -> None:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """CREATE TABLE person_tranche(
               person_id TEXT, campaign_id TEXT, first_name TEXT, company TEXT, title TEXT
           );
           CREATE TABLE eligibility_decision(
               person_id TEXT, campaign_id TEXT, outcome TEXT, decided_at TEXT
           );"""
    )
    connection.executemany(
        "INSERT INTO person_tranche VALUES(?,?,?,?,?)",
        [
            ("person-shared", "campaign-a", "Casey", "Example A", "operations"),
            ("person-shared", "campaign-b", "Casey", "Example B", "operations"),
        ],
    )
    connection.executemany(
        "INSERT INTO eligibility_decision VALUES(?,?,?,?)",
        [
            ("person-shared", "campaign-a", "eligible", "2026-09-01T00:00:00Z"),
            ("person-shared", "campaign-b", "ineligible", "2026-09-01T00:00:00Z"),
        ],
    )
    assert [row["person_id"] for row in cli_module._projection(connection, "campaign-a")] == ["person-shared"]
    assert cli_module._projection(connection, "campaign-b") == []
    connection.execute(
        "INSERT INTO eligibility_decision VALUES(?,?,?,?)",
        ("person-shared", "campaign-a", "ineligible", "2026-09-02T00:00:00Z"),
    )
    assert cli_module._projection(connection, "campaign-a") == []


def test_p3_numeric_metrics_are_observed(tmp_path: Path, monkeypatch, record_property) -> None:
    original_validate = cli_module.validate_revision
    observed: list[tuple[tuple[object, ...], object]] = []

    def observe(*args, **kwargs):
        result = original_validate(*args, **kwargs)
        observed.append((args, result))
        return result

    monkeypatch.setattr(cli_module, "validate_revision", observe)
    summary = run_fixture(FIXTURE, tmp_path / "store.sqlite", PROFILE)
    assert (summary.candidates, summary.evidence_valid, summary.qa_passed, summary.qa_failed) == (20, 20, 20, 0)
    baseline_args, baseline = observed[0]
    content_args = list(baseline_args)
    content_args[1] = content_args[1].replace(content_args[2], "Let us talk.")
    content_args[2] = "Let us talk."
    sourcing_args = list(baseline_args)
    sourcing_bindings = dict(sourcing_args[3])
    for name in ("why_them", "company", "first_name"):
        sourcing_bindings[name] = replace(
            sourcing_bindings[name], source_kind="sender", source_ref="sender.test"
        )
    sourcing_args[3] = sourcing_bindings
    follow_up_args = list(baseline_args)
    follow_up_args[5] = replace(
        follow_up_args[5], step=1,
        prior_evidence_ids=frozenset(item.evidence_id for item in follow_up_args[4]),
    )
    red_results = (
        original_validate(*content_args),
        original_validate(*sourcing_args),
        original_validate(*follow_up_args),
    )
    qa_rule_ids = set(baseline.checks)
    green_rule_ids = {
        rule_id for _, result in observed for rule_id, passed in result.checks.items() if passed
    }
    red_rule_ids = {
        rule_id for result in red_results for rule_id, passed in result.checks.items() if not passed
    }
    count_with_red_and_green = len(qa_rule_ids & green_rule_ids & red_rule_ids)
    assert count_with_red_and_green == len(qa_rule_ids)
    record_property("qa_rules_exercised", count_with_red_and_green)
    assert summary.template_versions == {
        "alumni": 1,
        "curiosity": 1,
        "networking": 1,
        "recruiting_live": 1,
    }
