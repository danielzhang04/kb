import subprocess
import sys
from pathlib import Path

from scripts.migrate_schema_versions import migrate_card_text, migrate_workflow_text


SCRIPT = Path(__file__).parents[1] / "scripts" / "migrate_schema_versions.py"


def test_card_migration_preserves_body_and_is_idempotent():
    source = "---\nid: version-test\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n\n## Work order\nexact body\n"
    migrated = migrate_card_text(source)
    assert migrated.startswith("---\nschema-version: 1\nid: version-test\nproject:")
    assert migrated.endswith("\n## Work order\nexact body\n")
    assert migrate_card_text(migrated) == migrated


def test_workflow_migration_inserts_inside_frontmatter():
    source = "---\nid: demo\nproject: kb-ops\ntitle: Demo\nprofile: research\nstages: []\n---\n\n# Demo\n"
    migrated = migrate_workflow_text(source)
    assert migrated.startswith("---\nschemaVersion: 1\nid: demo")
    assert migrate_workflow_text(migrated) == migrated


def test_card_migration_preserves_crlf_and_changes_only_the_inserted_line(tmp_path):
    path = tmp_path / "card.md"
    source = b"---\r\nid: version-test\r\nproject: kb-ops\r\naction: test:noop\r\ntarget: x\r\nrisk-tier: T1\r\nstate: inbox\r\n---\r\n\r\n## Work order\r\nexact body\r\n"
    path.write_bytes(source)

    result = subprocess.run(
        [sys.executable, str(SCRIPT), "card", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert path.read_bytes() == source.replace(b"---\r\n", b"---\r\nschema-version: 1\r\n", 1)


def test_workflow_migration_preserves_lf_and_changes_only_the_inserted_line(tmp_path):
    path = tmp_path / "workflow.md"
    source = b"---\nid: demo\nproject: kb-ops\ntitle: Demo\nprofile: research\nstages: []\n---\n\n# Demo\n"
    path.write_bytes(source)

    result = subprocess.run(
        [sys.executable, str(SCRIPT), "workflow", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert path.read_bytes() == source.replace(b"---\n", b"---\nschemaVersion: 1\n", 1)


def test_check_exit_codes_distinguish_current_from_pending_migration(tmp_path):
    pending = tmp_path / "pending.md"
    pending.write_text("---\nid: demo\nproject: kb-ops\ntitle: Demo\nprofile: research\nstages: []\n---\n", encoding="utf-8", newline="")
    current = tmp_path / "current.md"
    current.write_text("---\nschemaVersion: 1\nid: demo\nproject: kb-ops\ntitle: Demo\nprofile: research\nstages: []\n---\n", encoding="utf-8", newline="")

    pending_result = subprocess.run([sys.executable, str(SCRIPT), "workflow", str(pending), "--check"], check=False)
    current_result = subprocess.run([sys.executable, str(SCRIPT), "workflow", str(current), "--check"], check=False)

    assert pending_result.returncode == 1
    assert current_result.returncode == 0


def test_main_reports_missing_and_malformed_files_without_tracebacks(tmp_path):
    malformed = tmp_path / "malformed.md"
    malformed.write_text("not frontmatter\n", encoding="utf-8")
    for path in (tmp_path / "missing.md", malformed):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "card", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode != 0
        assert str(path) in result.stderr
        assert "Traceback" not in result.stderr


def test_main_refuses_unknown_kind_without_touching_the_file(tmp_path):
    path = tmp_path / "card.md"
    source = "---\nid: demo\n---\n"
    path.write_text(source, encoding="utf-8", newline="")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), "unknown", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "invalid choice" in result.stderr
    assert "Traceback" not in result.stderr
    assert path.read_text(encoding="utf-8") == source
