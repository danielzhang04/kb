"""Migration-ordering coverage for the P8 affinity schema."""

from pathlib import Path
import shutil

import pytest

from scripts.prospecting import store as store_module
from scripts.prospecting.store import MigrationError, get_schema_version, open_store


P8_TABLES = (
    "campaign_fit_spec", "person_background", "person_education", "person_employer",
    "person_link", "person_research_state", "person_affinity",
)
V2_COLUMNS = (
    "campaign_id", "firm", "firm_blurb", "website", "full_name", "title", "seniority_class",
    "linkedin_url", "email", "email_state", "confidence", "score", "reason_1", "reason_2",
    "reason_3", "person_blurb",
)
P7_FIXTURE_DDL = """CREATE TABLE IF NOT EXISTS p7_ui_pref (
    pref_key TEXT PRIMARY KEY,
    pref_value TEXT NOT NULL CHECK (json_valid(pref_value))
);"""


def _sandbox_schema(root: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Copy every schema file into `root` and point store.SCHEMA_PATH at the copy."""
    root.mkdir(parents=True, exist_ok=True)
    package = Path(store_module.__file__).parent
    for path in sorted(package.glob("schema*.sql")):
        shutil.copyfile(path, root / path.name)
    monkeypatch.setattr(store_module, "SCHEMA_PATH", root / "schema.sql")
    return root


def test_fresh_store_gains_every_p8_object(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sandbox = _sandbox_schema(tmp_path / "schema", monkeypatch)
    connection = open_store(tmp_path / "store.sqlite")
    names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
    assert set(P8_TABLES) <= names and "deliverable_v2" in names
    assert get_schema_version(connection) == 1 + len(list(sandbox.glob("schema_p[0-9]*.sql")))
    columns = tuple(row[1] for row in connection.execute("PRAGMA table_info(deliverable_v2)"))
    assert columns == V2_COLUMNS


def test_p7_added_later_yields_the_same_schema_as_p7_first(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, record_property
) -> None:
    late = _sandbox_schema(tmp_path / "late", monkeypatch)
    connection = open_store(tmp_path / "late.sqlite")
    (late / "schema_p7.sql").write_text(P7_FIXTURE_DDL, encoding="utf-8")
    store_module.migrate(connection)
    after = sorted(str(row[0]) for row in connection.execute("SELECT sql FROM sqlite_master"))

    early = _sandbox_schema(tmp_path / "early", monkeypatch)
    (early / "schema_p7.sql").write_text(P7_FIXTURE_DDL, encoding="utf-8")
    both = open_store(tmp_path / "early.sqlite")
    before = sorted(str(row[0]) for row in both.execute("SELECT sql FROM sqlite_master"))

    assert after == before
    record_property("migration_order_equivalence", 1)


def test_applied_migration_is_immutable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sandbox = _sandbox_schema(tmp_path / "schema", monkeypatch)
    database = tmp_path / "store.sqlite"
    open_store(database).close()
    target = sandbox / "schema_p8.sql"
    target.write_text(target.read_text(encoding="utf-8") + "\n-- drift\n", encoding="utf-8")
    with pytest.raises(MigrationError, match="modified_migration"):
        open_store(database)
