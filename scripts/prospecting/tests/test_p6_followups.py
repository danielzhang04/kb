"""P6 ownership tests for follow-up approval safeguards."""

import sqlite3
from pathlib import Path

import pytest

from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_contracts import _insert_approval, _seed_approval_graph


def test_cross_kind_digest_collision_is_rejected(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "cross-kind.sqlite")
    digest = "d" * 64
    _seed_approval_graph(connection)
    connection.execute(
        "INSERT INTO revision VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "revision-collision", "person-1", "campaign-1", 1, "Synthetic subject",
            "Synthetic body", "why_them", "bespoke", None, "Synthetic ask?", "[]", "[]",
            "[]", "networking", 1, "p6", "m1", '{"qa_score":100}', digest,
        ),
    )
    connection.execute(
        "INSERT INTO reply_template VALUES(?,?,?,?)",
        ("template-collision", 1, digest, "2026-09-03T00:00:00Z"),
    )
    with pytest.raises(sqlite3.IntegrityError, match="approval_content_resolution"):
        _insert_approval(connection, revision_hash=digest)
