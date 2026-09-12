"""PII-output regression tests for the P8 affinity CLI."""

from __future__ import annotations

# P8: this module owns the stdout PII-gate measurement for affinity CLI coverage.

import json
from pathlib import Path

import pytest

from scripts.prospecting.affinity import cli
from scripts.prospecting.operator import cli as operator_cli
from scripts.prospecting.pii_guard import PIIGuardError, assert_vm_safe
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


SYNTHETIC = legacy_fixture("test_affinity_pii_guard")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "Sample Person"),
        ("email", SYNTHETIC["email"]),
        ("phone", SYNTHETIC["phone"]),
        ("profile_url", "https://profiles.example.test/member"),
        ("note", SYNTHETIC["note"]),
        ("excerpt", SYNTHETIC["excerpt"]),
        ("body", SYNTHETIC["body"]),
    ],
)
def test_the_shared_stdout_boundary_rejects_every_pii_class(field: str, value: str) -> None:
    with pytest.raises(PIIGuardError):
        cli._emit({field: value})


def test_every_affinity_cli_verb_stdout_is_pii_safe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], record_property
) -> None:
    store_path = tmp_path / "store.sqlite"
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(store_path))
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    connection = open_store(store_path)
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection,
        ask="intent:networking lane:manual",
        sender_profile_path=None,
        name=None,
        lanes=("manual",),
    )
    ask_file = tmp_path / "ask.txt"
    ask_file.write_text("Synthetic affinity request.", encoding="utf-8")
    commands = (
        ("ask", "compile", "--campaign", campaign_id, "--ask-file", str(ask_file)),
        ("ask", "approve", "--campaign", campaign_id, "--fit-hash", "0" * 64),
        ("research", "run", "--campaign", campaign_id),
        ("score", "--campaign", campaign_id),
        ("fill-fit", "--campaign", campaign_id, "--target-per-firm", "1"),
        ("draft", "--campaign", campaign_id, "--step", "0"),
        ("list", "--fit", "--campaign", campaign_id),
    )

    violations = 0
    for argv in commands:
        assert cli.main(argv) in (0, 1)
        stdout = capsys.readouterr().out
        assert stdout
        try:
            assert_vm_safe({"kind": "stdout", "fields": json.loads(stdout)}, "stdout")
        except PIIGuardError:
            violations += 1

    record_property("pii_stdout_violations", violations)
    assert violations == 0
