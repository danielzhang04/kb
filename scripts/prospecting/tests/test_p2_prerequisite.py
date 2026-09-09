from __future__ import annotations

import inspect
import json
import os
import subprocess
from pathlib import Path

from scripts.prospecting import store
from scripts.prospecting.p2_p1_contract import P1_STORE_FUNCTION_PARAMS, P2_WRITABLE_COLUMNS


ROOT = Path(__file__).parents[3]


def test_p2_00_p1_record_verifies() -> None:
    environment = os.environ | {"KB_PROSPECTING_NO_NETWORK": "1"}
    completed = subprocess.run(
        ["py", "-3", "-m", "scripts.prospecting.gate", "--phase", "P1", "--verify-recorded"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout)
    assert result["mismatched"] == []
    assert result["matched"] is True


def test_p2_01_p1_public_signatures() -> None:
    for name, expected_parameters in P1_STORE_FUNCTION_PARAMS.items():
        function = getattr(store, name)
        assert tuple(inspect.signature(function).parameters) == expected_parameters


def test_p2_02_p1_schema_columns(tmp_path: Path) -> None:
    connection = store.open_store(tmp_path / "p2-prerequisite.sqlite")
    try:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        missing_tables: list[str] = []
        for table, expected_columns in P2_WRITABLE_COLUMNS.items():
            if table not in tables:
                missing_tables.append(table)
                continue
            actual_columns = {
                row[1] for row in connection.execute(f"PRAGMA table_info({table})")
            }
            assert set(expected_columns) <= actual_columns
        assert missing_tables == ["lane_cursor"]
    finally:
        connection.close()
