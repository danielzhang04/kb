from __future__ import annotations

import inspect

import pytest

from scripts.prospecting import store
from scripts.prospecting.p4_p1_contract import (
    EXECUTOR_FUNCTION_PARAMETERS,
    EXECUTOR_CLAIM_PATH_PARAMETERS,
    EXPECTED_COLUMNS,
    STORE_FUNCTION_PARAMETERS,
    verify_p1_contract,
)
def test_p4_00_p1_record_verifies() -> None:
    import json
    import os
    import subprocess

    result = subprocess.run(
        ["py", "-3", "-m", "scripts.prospecting.gate", "--phase", "P1", "--verify-recorded"],
        check=False,
        capture_output=True,
        env={**os.environ, "KB_PROSPECTING_NO_NETWORK": "1"},
        text=True,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["matched"] is True
    assert report["mismatched"] == []


def test_p4_01_signatures() -> None:
    from scripts.prospecting import executor

    for name, expected in STORE_FUNCTION_PARAMETERS.items():
        assert tuple(inspect.signature(getattr(store, name)).parameters) == expected
    for name, expected in EXECUTOR_FUNCTION_PARAMETERS.items():
        assert tuple(inspect.signature(getattr(executor, name)).parameters) == expected
    for name, expected in EXECUTOR_CLAIM_PATH_PARAMETERS.items():
        assert tuple(inspect.signature(getattr(executor.Executor, name)).parameters) == expected


def test_p4_02_schema_columns(tmp_path) -> None:
    connection = store.open_store(tmp_path / "p4-schema.sqlite")
    verify_p1_contract(connection)
    for table, expected in EXPECTED_COLUMNS.items():
        actual = tuple(row[1] for row in connection.execute(f"PRAGMA table_info({table})"))
        assert actual == expected


def test_p4_03_t0_gmail_send_rejected(tmp_path) -> None:
    connection = store.open_store(tmp_path / "p4-t0-reject.sqlite")
    request = store.ExecRequest(
        request_id="exec_request:00000000-0000-4000-8000-000000000001",
        caller="prospecting-campaigner",
        operation="gmail_send",
        payload={
            "action": "send_revision",
            "delivery_id": "delivery:00000000-0000-4000-8000-000000000002",
        },
        policy_hash="0" * 64,
        approval_id=None,
        created_at="2026-09-03T12:00:00+00:00",
        state="queued",
        reason=None,
    )
    with pytest.raises(ValueError):
        store.insert_exec_request(connection, request, "T0", now="2026-09-03T12:00:00Z")
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_send'"
    ).fetchone()[0] == 0
