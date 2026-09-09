from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.manager.bridge import BridgeResult
from scripts.prospecting.run_workflow import main
from scripts.prospecting.store import SCHEMA_PATH, open_store


PROFILE_ID = "22222222-2222-4222-8222-222222222222"
REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def envelope(stage_id, attempt=1, execution_key="a" * 64, command_digest="b" * 64, **counts):
    return {
        "stage_id": stage_id,
        "state": "complete",
        "ids": [stage_id + "-id"],
        "counts": counts,
        "hashes": ["a" * 64],
        "failure_codes": {},
        "attempt": attempt,
        "execution_key": execution_key,
        "command_digest": command_digest,
    }


class Bridge:
    def __init__(self, grade=95):
        self.calls, self.grade = [], grade

    def invoke(self, agent, payload, mode, host=None):
        self.calls.append((agent, payload, mode))
        if agent == "inspector":
            return BridgeResult(
                0, "ok", envelope(
                    payload["stage_id"], payload["attempt"], payload["execution_key"],
                    payload["command_digest"], grade=self.grade,
                )
            )
        return BridgeResult(
            0, "ok", envelope(
                payload["stage_id"], payload["attempt"], payload["execution_key"],
                payload["command_digest"], people=1,
            )
        )


def compiled(tmp_path):
    return {
        "campaign_id": "camp_1111111111111111",
        "policy_id": "policy-one",
        "policy_hash": "b" * 64,
        "sender_profile_id": PROFILE_ID,
        "drafting_configured": True,
        "target_policy": {"requested_people": 1, "lane_plan": ["manual"]},
    }


def _ask_file(tmp_path: Path, value: str = "intent:networking") -> Path:
    path = tmp_path / "ask.txt"
    path.write_text(value, encoding="utf-8")
    return path


def _local_create_args(tmp_path: Path, workflow: str = "outreach-run") -> list[str]:
    return [
        "--workflow", workflow,
        "--ask-file", str(_ask_file(tmp_path)),
        "--local",
        "--store", str(tmp_path / "store.sqlite"),
        "--create-request", REQUEST_ID,
        "--sender-profile-id", PROFILE_ID,
        "--mailbox-id", "mailbox-001",
        "--draft-step", "0",
        "--minimum-confidence", "0.8",
        "--model-version", "fixture-v1",
        "--model-response-file", str(tmp_path / "response.json"),
        "--prepared-output-file", str(tmp_path / "prepared.json"),
        "--outbox", str(tmp_path / "outbox"),
    ]


def kwargs(tmp_path, bridge):
    return {
        "compile_ref": lambda _: compiled(tmp_path),
        "bridge": bridge,
        "prerequisites": lambda _: {
            phase: "pass" for phase in ("P1", "P2", "P3", "P4")
        },
    }


def _profile(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        (
            PROFILE_ID,
            "Synthetic Sender",
            None,
            "Synthetic focus",
            "Synthetic background",
            "Synthetic proof",
            "[]",
        ),
    )


def _prerequisites(_pending_ok):
    return {phase: "pass" for phase in ("P1", "P2", "P3", "P4")}


def test_inspect_stages_use_the_same_adapter(
    tmp_path: Path, capsys, record_property
) -> None:
    bridge = Bridge()
    assert main(_local_create_args(tmp_path), **kwargs(tmp_path, bridge)) == 0
    value = json.loads(capsys.readouterr().out)
    assert value["state"] == "complete"
    assert [agent for agent, _, _ in bridge.calls] == [
        "list-builder", "inspector", "personalizer", "inspector", "campaigner",
    ]
    assert all(call[1]["execution_key"] for call in bridge.calls)
    operations = [payload["operation"] for _, payload, _ in bridge.calls]
    record_property(
        "model_calls",
        sum(operation in {"model-turn", "model_turn"} for operation in operations),
    )
    record_property(
        "live_vendor_calls",
        sum(
            operation in {"vendor-call", "vendor_call", "vendor_lookup"}
            for operation in operations
        ),
    )
    record_property(
        "live_gmail_sends", sum(operation == "gmail_send" for operation in operations)
    )


def test_missing_or_low_inspector_grade_parks(tmp_path: Path, capsys) -> None:
    bridge = Bridge(94)
    args = _local_create_args(tmp_path, "list-only")
    assert main(args, **kwargs(tmp_path, bridge)) == 0
    assert json.loads(capsys.readouterr().out)["state"] == "parked"


@pytest.mark.parametrize("field", ("execution_key", "command_digest"))
def test_swapped_desktop_result_binding_parks_before_checkpoint_advance(
    tmp_path: Path, capsys, field: str
) -> None:
    class SwappedBridge(Bridge):
        def invoke(self, agent, payload, mode, host=None):
            outcome = super().invoke(agent, payload, mode, host)
            return BridgeResult(
                outcome.exit_code, outcome.code,
                {**outcome.summary, field: "f" * 64},
            )

    assert main(
        _local_create_args(tmp_path, "list-only"),
        **kwargs(tmp_path, SwappedBridge()),
    ) == 0
    assert json.loads(capsys.readouterr().out)["state"] == "parked"


@pytest.mark.parametrize(
    "bridge_code",
    ("timeout", "output_overflow", "failed", "failed_output_redacted"),
)
def test_uncertain_bridge_failure_parks_without_replaying_stage(
    tmp_path: Path, capsys, bridge_code: str
) -> None:
    class UncertainBridge(Bridge):
        def invoke(self, agent, payload, mode, host=None):
            self.calls.append((agent, payload, mode))
            return BridgeResult(-1, bridge_code, {})

    bridge = UncertainBridge()
    args = _local_create_args(tmp_path, "list-only")

    assert main(args, **kwargs(tmp_path, bridge)) == 0

    result = json.loads(capsys.readouterr().out)
    checkpoint = json.loads(
        next((tmp_path / "outbox").glob("*-checkpoint.json")).read_text()
    )
    assert result["state"] == "parked"
    assert result["cards"] == 1
    assert result["retries"] == 0
    assert len(bridge.calls) == 1
    assert checkpoint["reason"] == "desktop_recovery_required"


def test_injected_dry_run_keeps_plan_behavior_without_creating_a_store(
    tmp_path: Path, capsys
) -> None:
    bridge = Bridge()
    store_path = tmp_path / "store.sqlite"
    args = [
        "--workflow", "list-only",
        "--ask-file", str(_ask_file(tmp_path)),
        "--dry-run",
        "--store", str(store_path),
        "--sender-profile-id", PROFILE_ID,
        "--mailbox-id", "mailbox-001",
        "--outbox", str(tmp_path / "outbox"),
    ]
    assert main(args, **kwargs(tmp_path, bridge)) == 0
    assert bridge.calls == []
    assert json.loads(capsys.readouterr().out)["card_count"] == 2
    assert not store_path.exists()


def test_local_create_and_resume_use_one_campaign_without_text_leak(
    tmp_path: Path, capsys
) -> None:
    store_path = tmp_path / "store.sqlite"
    connection = open_store(store_path)
    _profile(connection)
    connection.close()
    marker = "synthetic-fit-marker"
    fit_file = tmp_path / "fit.txt"
    fit_file.write_text(f"prefer: {marker}\n", encoding="utf-8")
    create_args = _local_create_args(tmp_path)
    create_args[create_args.index("--outbox") + 1] = str(tmp_path / "create-outbox")
    create_args.extend(("--fit-file", str(fit_file)))

    assert main(create_args, bridge=Bridge(), prerequisites=_prerequisites) == 0
    created_output = capsys.readouterr().out
    campaign_id = json.loads(created_output)["campaign_id"]
    assert marker not in created_output

    connection = open_store(store_path)
    assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 1
    brief = connection.execute(
        "SELECT brief_text FROM campaign_brief WHERE campaign_id=?", (campaign_id,)
    ).fetchone()[0]
    assert marker in brief
    connection.close()

    resume_args = [
        "--workflow", "outreach-run",
        "--campaign-id", campaign_id,
        "--local",
        "--store", str(store_path),
        "--model-response-file", str(tmp_path / "response.json"),
        "--prepared-output-file", str(tmp_path / "prepared.json"),
        "--outbox", str(tmp_path / "resume-outbox"),
    ]
    assert main(resume_args, bridge=Bridge(), prerequisites=_prerequisites) == 0
    resumed = json.loads(capsys.readouterr().out)
    assert resumed["campaign_id"] == campaign_id
    assert resumed["run_id"] == "run-" + campaign_id.replace("_", "-", 1)
    connection = open_store(store_path)
    assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 1
    connection.close()


def test_real_dry_run_uses_memory_without_schema_or_data_writes(
    tmp_path: Path, capsys
) -> None:
    store_path = tmp_path / "legacy.sqlite"
    connection = sqlite3.connect(store_path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _profile(connection)
    connection.commit()
    connection.close()
    before = hashlib.sha256(store_path.read_bytes()).hexdigest()
    args = [
        "--workflow", "list-only",
        "--ask-file", str(_ask_file(tmp_path)),
        "--dry-run",
        "--store", str(store_path),
        "--sender-profile-id", PROFILE_ID,
        "--mailbox-id", "mailbox-001",
        "--outbox", str(tmp_path / "outbox"),
    ]

    assert main(args, bridge=Bridge(), prerequisites=_prerequisites) == 0

    assert json.loads(capsys.readouterr().out)["mode"] == "dry-run"
    assert hashlib.sha256(store_path.read_bytes()).hexdigest() == before
    connection = sqlite3.connect(store_path)
    assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 0
    assert connection.execute(
        "SELECT 1 FROM sqlite_master WHERE name='campaign_brief'"
    ).fetchone() is None
    assert connection.execute(
        "SELECT count(*) FROM schema_migrations"
    ).fetchone()[0] == 0
    connection.close()


def test_fit_content_and_incomplete_drafting_fail_with_safe_codes(
    tmp_path: Path,
) -> None:
    fit_file = tmp_path / "fit.txt"
    fit_file.write_text("raw synthetic prose", encoding="utf-8")
    base = [
        "--workflow", "list-only",
        "--ask-file", str(_ask_file(tmp_path)),
        "--fit-file", str(fit_file),
        "--dry-run",
        "--store", str(tmp_path / "store.sqlite"),
        "--sender-profile-id", PROFILE_ID,
        "--mailbox-id", "mailbox-001",
        "--outbox", str(tmp_path / "outbox"),
    ]
    with pytest.raises(ValueError, match="^fit_file_invalid$"):
        main(base, compile_ref=lambda _: compiled(tmp_path), prerequisites=_prerequisites)
    without_fit = base[:4] + base[6:]
    with pytest.raises(ValueError, match="^drafting_settings_incomplete$"):
        main(
            without_fit + ["--draft-step", "0"],
            compile_ref=lambda _: compiled(tmp_path),
            prerequisites=_prerequisites,
        )


def test_local_personalization_requires_explicit_saved_drafting_settings(
    tmp_path: Path,
) -> None:
    store_path = tmp_path / "store.sqlite"
    connection = open_store(store_path)
    _profile(connection)
    connection.close()
    args = _local_create_args(tmp_path)
    for option in ("--draft-step", "--minimum-confidence", "--model-version"):
        index = args.index(option)
        del args[index:index + 2]

    with pytest.raises(ValueError, match="^drafting_not_configured$"):
        main(args, bridge=Bridge(), prerequisites=_prerequisites)
    connection = open_store(store_path)
    assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 0
    connection.close()


def test_invalid_outbox_is_rejected_before_campaign_creation(tmp_path: Path) -> None:
    store_path = tmp_path / "store.sqlite"
    connection = open_store(store_path)
    _profile(connection)
    connection.close()
    blocked_parent = tmp_path / "not-a-directory"
    blocked_parent.write_text("synthetic", encoding="utf-8")
    args = _local_create_args(tmp_path, "list-only")
    args[args.index("--store") + 1] = str(store_path)
    args[args.index("--outbox") + 1] = str(blocked_parent / "outbox")

    with pytest.raises(ValueError, match="^outbox_invalid$"):
        main(args, bridge=Bridge(), prerequisites=_prerequisites)

    connection = open_store(store_path)
    assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM campaign_brief").fetchone()[0] == 0
    connection.close()


def test_ssh_source_is_blocked_before_prerequisites_bridge_or_cards(
    tmp_path: Path,
) -> None:
    bridge = Bridge()
    prerequisite_calls = []
    outbox = tmp_path / "outbox"
    args = [
        "--workflow", "list-only",
        "--ask-ref", "ask-synthetic",
        "--ssh",
        "--host", "desktop.test",
        "--model-response-file", str(tmp_path / "response.json"),
        "--prepared-output-file", str(tmp_path / "prepared.json"),
        "--outbox", str(outbox),
    ]

    with pytest.raises(
        ValueError, match="^ssh_saved_request_resolver_unavailable$"
    ):
        main(
            args,
            compile_ref=lambda _ref: compiled(tmp_path),
            bridge=bridge,
            prerequisites=lambda pending: prerequisite_calls.append(pending),
        )

    assert prerequisite_calls == []
    assert bridge.calls == []
    assert not outbox.exists()


def test_real_local_cli_uses_selected_desktop_store_and_parks_without_inspector(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    desktop_root = tmp_path / "local-app-data" / "kb-prospecting"
    desktop_root.mkdir(parents=True)
    store_path = desktop_root / "selected.sqlite"
    connection = open_store(store_path)
    _profile(connection)
    connection.execute(
        "INSERT INTO source_observation("
        "observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence"
        ") VALUES(?,?,?,?,?,?,?,?)",
        (
            "obs-person", "person", "person-one", "full_name",
            json.dumps("Synthetic Person"), "manual", "2026-09-03T00:00:00Z", 1.0,
        ),
    )
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        ("firm-one", "Synthetic Firm", "manual", "firm-key-one"),
    )
    connection.close()
    ask_file = desktop_root / "ask.txt"
    ask_file.write_text(
        "intent:networking companies-count:1 people-count:1 lane:manual",
        encoding="utf-8",
    )
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "wrong-local-app-data"))
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "wrong.sqlite"))
    outbox = tmp_path / "outbox"
    args = [
        "--workflow", "list-only",
        "--ask-file", str(ask_file),
        "--local",
        "--store", str(store_path),
        "--create-request", REQUEST_ID,
        "--sender-profile-id", PROFILE_ID,
        "--mailbox-id", "mailbox-001",
        "--model-response-file", str(desktop_root / "response.json"),
        "--prepared-output-file", str(desktop_root / "prepared.json"),
        "--outbox", str(outbox),
    ]

    assert main(args, prerequisites=_prerequisites) == 0

    result = json.loads(capsys.readouterr().out)
    assert result["state"] == "parked"
    checkpoint = json.loads(next(outbox.glob("*-checkpoint.json")).read_text())
    assert checkpoint["reason"] == "inspector_unavailable"
    connection = open_store(store_path)
    assert connection.execute("SELECT count(*) FROM campaign").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM finder_run").fetchone()[0] == 1
    connection.close()
    assert not (tmp_path / "wrong.sqlite").exists()
