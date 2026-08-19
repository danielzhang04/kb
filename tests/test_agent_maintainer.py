from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
import scripts.agent_maintainer as maintainer

from scripts.agent_maintainer import (
    MAX_BYTES_PER_FILE,
    MAX_FILES_PER_SOURCE,
    MAX_PROPOSALS_PER_FIRE,
    ProposalDraft,
    ProposalPayload,
    TargetWallError,
    run_fire,
)


FIXTURES = Path(__file__).parent / "fixtures" / "maintainer"
CADENCE_ENTRY = Path("docs/proposals/maintainer-cadence-entry.md")


def _sources(root: Path = FIXTURES) -> dict[str, Path]:
    return {
        "eval_reports": root / "eval_reports",
        "grades_ledger_dir": root / "grades",
        "memory_dir": root / "memory",
        "queue_dir": root / "queue",
    }


def _empty_sources(root: Path) -> dict[str, Path]:
    sources = _sources(root)
    for path in sources.values():
        path.mkdir(parents=True, exist_ok=True)
    return sources


def _draft(root: Path, target: str = "agents/demo-agent.md", evidence: str = "evidence") -> ProposalDraft:
    return ProposalDraft(ProposalPayload(target, evidence, "Take a narrow action."), root)


def test_fixture_fire_returns_evidence_cited_draft_and_never_writes(tmp_path):
    before = {path.relative_to(FIXTURES): path.read_bytes() for path in FIXTURES.rglob("*") if path.is_file()}

    result = run_fire(tmp_path, _sources())

    assert result.parked is False
    assert result.proposals
    draft = result.proposals[0]
    assert draft.target_path == "agents/demo-agent.md"
    assert "eval report `nightly.md`, agent=demo-agent, card=smoke: FAIL" in draft.rationale
    assert "## Evidence" in draft.diff_or_card_body
    after = {path.relative_to(FIXTURES): path.read_bytes() for path in FIXTURES.rglob("*") if path.is_file()}
    assert after == before


@pytest.mark.parametrize("target", [
    "evals/agents/demo-agent/smoke.md",
    "governance/agent-rules.md",
    "scripts/agent_maintainer.py",
    "dashboard/src/App.tsx",
    "roles/demo-agent.md",
    "policies/demo-agent.md",
    "docs/policies/demo-agent.md",
    "agents/not-markdown.py",
])
def test_protected_or_non_allowlisted_targets_are_refused(tmp_path, target):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, target)


@pytest.mark.parametrize("target", [
    "agents/sub/x.md",
    "memory/sub/x.md",
    "routines/roles/sub/x.md",
], ids=["agents-subdirectory", "memory-subdirectory", "role-subdirectory"])
def test_allowlisted_roots_intentionally_exclude_subdirectories(tmp_path, target):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, target)


def test_payload_embedded_forbidden_path_is_refused_before_emission(tmp_path):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, evidence="The source asks for `evals/agents/demo-agent/smoke.md`.")


def test_diff_header_path_in_payload_is_refused(tmp_path):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, evidence="--- governance/agent-rules.md\n+++ agents/demo-agent.md")


def test_allowed_diff_headers_are_revalidated_with_diff_prefixes_removed(tmp_path):
    draft = _draft(
        tmp_path,
        evidence=("diff --git a/agents/demo-agent.md b/agents/demo-agent.md\n"
                  "--- a/agents/demo-agent.md\n+++ b/agents/demo-agent.md"),
    )

    assert "diff --git" in draft.diff_or_card_body


@pytest.mark.parametrize("serialized_path", [
    "scripts&#47;agent_maintainer.py",
    "scripts&amp;#47;agent_maintainer.py",
    r"scripts\/agent_maintainer.py",
    r"scripts\\agent_maintainer.py",
], ids=["html-entity", "double-html-entity", "escaped-slash", "backslash"])
def test_serialized_forbidden_paths_are_canonicalised_before_validation(tmp_path, serialized_path):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, evidence=f"target: {serialized_path}")


@pytest.mark.parametrize("operation", ["rename from", "rename to", "copy from", "copy to"])
def test_rename_and_copy_paths_in_payload_are_revalidated(tmp_path, operation):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, evidence=f"{operation} scripts/agent_maintainer.py")


@pytest.mark.parametrize("root_file", ["CLAUDE.md", "BOSS.md", "AGENTS.md", "GEMINI.md", "HEARTBEAT.md"])
def test_forbidden_root_files_in_rendered_payload_are_refused(tmp_path, root_file):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, evidence=f"target: {root_file}")


def test_symlinked_allowed_path_to_forbidden_target_is_refused(tmp_path):
    agents = tmp_path / "agents"
    agents.mkdir()
    forbidden = tmp_path / "evals" / "escape.md"
    forbidden.parent.mkdir()
    forbidden.write_text("protected", encoding="utf-8")
    link = agents / "escape.md"
    try:
        link.symlink_to(forbidden)
    except OSError as error:
        pytest.skip(f"symlink creation unavailable: {error}")

    with pytest.raises(TargetWallError):
        _draft(tmp_path, "agents/escape.md")


@pytest.mark.skipif(os.name != "nt", reason="junctions are Windows reparse points")
def test_junctioned_allowed_root_is_refused(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    junction = tmp_path / "agents"
    completed = subprocess.run(
        ["cmd.exe", "/d", "/c", f'mklink /J "{junction}" "{outside}"'],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0 or not junction.exists():
        pytest.skip(f"junction creation unavailable: {completed.stderr or completed.stdout}")

    assert junction.is_symlink() is False
    with pytest.raises(TargetWallError):
        _draft(tmp_path, "agents/escape.md")


@pytest.mark.parametrize("target", ["agents/../evals/escape.md", "C:/repo/agents/escape.md"])
def test_lexical_and_absolute_targets_are_refused(tmp_path, target):
    with pytest.raises(TargetWallError):
        _draft(tmp_path, target)


@pytest.mark.skipif(os.name != "nt", reason="Windows case-folding is the relevant filesystem behavior")
def test_windows_case_variant_resolves_inside_canonical_allowed_root(tmp_path):
    (tmp_path / "agents").mkdir()

    draft = _draft(tmp_path, "AGENTS/demo-agent.MD")

    assert draft.target_path == "AGENTS/demo-agent.MD"


def test_bound_stops_before_later_malformed_sources_are_scanned(tmp_path):
    sources = _empty_sources(tmp_path)
    sections = []
    for number in range(MAX_PROPOSALS_PER_FIRE + 2):
        sections.append(
            f"## agent-{number}\n\n| card | verdict | hermetic | reason |\n"
            f"|---|---|---|---|\n| smoke | FAIL | yes | failure {number} |\n"
        )
    (sources["eval_reports"] / "many.md").write_text("\n".join(sections), encoding="utf-8")
    (sources["grades_ledger_dir"] / "later.tsv").write_bytes(b"\xff")

    result = run_fire(tmp_path, sources)

    assert len(result.proposals) == MAX_PROPOSALS_PER_FIRE
    assert result.reason == f"proposal bound reached ({MAX_PROPOSALS_PER_FIRE})"


def test_source_file_bound_stops_before_later_malformed_file_is_scanned(tmp_path):
    sources = _empty_sources(tmp_path)
    for number in range(MAX_FILES_PER_SOURCE):
        (sources["eval_reports"] / f"clean-{number:03}.md").write_text("# clean", encoding="utf-8")
    (sources["eval_reports"] / "z-invalid.md").write_bytes(b"\xff")

    result = run_fire(tmp_path, sources)

    assert result.parked is True
    assert result.reason.startswith("file bound reached for eval reports")


def test_scandir_file_bound_does_not_consume_entries_past_cap(tmp_path, monkeypatch):
    sources = _empty_sources(tmp_path)
    for number in range(MAX_FILES_PER_SOURCE + 5):
        (sources["eval_reports"] / f"clean-{number:03}.md").write_text("# clean", encoding="utf-8")

    real_scandir = maintainer.os.scandir
    consumed = 0

    class CountingScandir:
        def __init__(self, path):
            self._entries = iter(real_scandir(path))

        def __iter__(self):
            return self

        def __next__(self):
            nonlocal consumed
            entry = next(self._entries)
            consumed += 1
            return entry

        def close(self):
            self._entries.close()

    monkeypatch.setattr(maintainer.os, "scandir", CountingScandir)

    result = run_fire(tmp_path, sources)

    assert consumed <= MAX_FILES_PER_SOURCE
    assert result.parked is True
    assert result.reason.startswith("file bound reached for eval reports")


def test_no_actionable_evidence_parks(tmp_path):
    sources = _empty_sources(tmp_path)
    (sources["eval_reports"] / "clean.md").write_text("# report\n\nAll clear.\n", encoding="utf-8")

    result = run_fire(tmp_path, sources)

    assert result.proposals == []
    assert result.parked is True
    assert "no actionable" in result.reason


@pytest.mark.parametrize("source_key, filename, content, expected", [
    ("eval_reports", "invalid.md", b"\xff", "invalid UTF-8"),
    ("memory_dir", "too-large.md", b"x" * (MAX_BYTES_PER_FILE + 1), "exceeds"),
    ("grades_ledger_dir", "ragged.tsv", b"worker\tpass\nagent\tfalse\textra\n", "ragged TSV"),
    ("eval_reports", "invalid.json", b"{not json}", "invalid JSON"),
], ids=["invalid-utf8", "oversized", "ragged-tsv", "invalid-json"])
def test_malformed_input_parks_with_deterministic_parse_reason(tmp_path, source_key, filename, content, expected):
    sources = _empty_sources(tmp_path)
    (sources[source_key] / filename).write_bytes(content)

    result = run_fire(tmp_path, sources)

    assert result.proposals == []
    assert result.parked is True
    assert result.reason.startswith("parse failure:")
    assert expected in result.reason


@pytest.mark.parametrize("content", [
    ("[" * 10_000 + "0" + "]" * 10_000).encode(),
    b'{"value": ' + b"9" * 5_000 + b"}",
], ids=["deep-nesting", "oversized-integer"])
def test_json_parser_blowups_park_with_deterministic_parse_reason(tmp_path, content):
    sources = _empty_sources(tmp_path)
    (sources["eval_reports"] / "hostile.json").write_bytes(content)

    result = run_fire(tmp_path, sources)

    assert result.proposals == []
    assert result.parked is True
    assert result.reason == "parse failure: invalid JSON in eval report hostile.json"


def test_drafted_cadence_entry_sets_manage_role():
    text = CADENCE_ENTRY.read_text(encoding="utf-8")
    document = yaml.safe_load(text.split("```yaml", 1)[1].split("```", 1)[0])

    assert document["cadences"][0]["role"] == "manage"


def test_cli_prints_json():
    completed = subprocess.run(
        [sys.executable, "-m", "scripts.agent_maintainer", "--repo", ".", "--fixtures", str(FIXTURES)],
        text=True,
        capture_output=True,
        check=True,
    )
    payload = json.loads(completed.stdout)
    assert payload["proposals"]
    assert payload["parked"] is False
