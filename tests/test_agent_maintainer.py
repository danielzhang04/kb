from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
import yaml
import scripts.agent_maintainer as maintainer
import scripts.agent_evals as agent_evals

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


def _eval_card(card_id: str, judge: str, inputs: dict) -> str:
    lines = [
        "---", f"id: {card_id}", "capability: forecast", f"judge: {judge}",
        'rubric_version: "1"', "k: 1", "source: curated", "immutable: true", "tier: T1", "input:",
    ]
    lines += [f"  {key}: {json.dumps(value)}" for key, value in inputs.items()]
    return "\n".join(lines + ["---", f"# {card_id}", ""])


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def _forecast_repo(tmp_path: Path, *, bless_own: bool = True) -> Path:
    repo = tmp_path / "forecast-repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "test")
    _git(repo, "config", "core.autocrlf", "false")
    (repo / "agents").mkdir()
    (repo / "agents" / "demo-agent.md").write_text("before\n", encoding="utf-8")
    (repo / "memory").mkdir()
    (repo / "memory" / "demo-agent.md").write_text("memory\n", encoding="utf-8")

    own = agent_evals.suite_dir(repo, "demo-agent")
    own.mkdir(parents=True)
    (own / "test_sees_patch.py").write_text(
        "from pathlib import Path\n\n\ndef test_sees_patch():\n"
        "    assert 'Proposed maintainer note' in Path('agents/demo-agent.md').read_text()\n",
        encoding="utf-8")
    (own / "sees-patch.md").write_text(_eval_card("sees-patch", "pytest", {
        "test_file": "evals/agents/demo-agent/test_sees_patch.py"}), encoding="utf-8")
    if bless_own:
        agent_evals.update_manifest(repo, "demo-agent")

    fleet = agent_evals.suite_dir(repo, agent_evals.FLEET_SUITE_ID)
    fleet.mkdir(parents=True)
    (fleet / "memory-file.md").write_text(_eval_card("memory-file", "file-exists", {
        "path": "memory/{agent_id}.md",
    }), encoding="utf-8")
    agent_evals.update_manifest(repo, agent_evals.FLEET_SUITE_ID)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "fixture")
    return repo


def _forecast_result(repo: Path):
    """Use the actual eval-report producer; do not inject a hand-made draft."""
    sources = _empty_sources(repo / "sources")
    (sources["eval_reports"] / "nightly.md").write_text(
        "## demo-agent\n\n| card | verdict | hermetic | reason |\n"
        "|---|---|---|---|\n| smoke | FAIL | yes | fixture failure |\n",
        encoding="utf-8")
    return run_fire(repo, sources, forecast=True)


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


def test_real_producer_builds_a_git_style_diff_and_forecasts_it_without_real_ledger_rows(tmp_path):
    repo = _forecast_repo(tmp_path)

    result = _forecast_result(repo)

    draft = result.proposals[0]
    assert draft.eval_forecast == {
        "agent_id": "demo-agent", "cards_run": 2, "passed": 2, "failed": 0,
        "status": "completed", "reason": None,
    }
    assert draft.unified_diff.startswith("diff --git a/agents/demo-agent.md b/agents/demo-agent.md\n")
    assert "| demo-agent | 2 | 2 | 0 | completed |" in draft.diff_or_card_body
    assert (repo / "agents" / "demo-agent.md").read_text(encoding="utf-8") == "before\n"
    assert not (repo / "ledgers").exists()
    scratch = repo / "state" / "scratch"
    assert scratch.is_dir() and list(scratch.iterdir()) == []
    worktrees = subprocess.run(["git", "worktree", "list", "--porcelain"], cwd=repo,
                              check=True, capture_output=True, text=True).stdout
    assert not any(Path(line.removeprefix("worktree ")).parent == scratch
                   for line in worktrees.splitlines() if line.startswith("worktree "))


def test_unblessed_suite_is_attached_as_a_report_only_forecast_refusal(tmp_path):
    repo = _forecast_repo(tmp_path, bless_own=False)

    result = _forecast_result(repo)

    draft = result.proposals[0]
    assert draft.eval_forecast == {
        "agent_id": "demo-agent", "cards_run": 1, "passed": 1, "failed": 0,
        "status": "refused", "reason": "unblessed manifest",
    }
    assert result.parked is False
    assert "refused (unblessed manifest)" in draft.diff_or_card_body


def test_forecast_rejects_bad_patch_and_always_removes_its_temporary_worktree(tmp_path):
    repo = _forecast_repo(tmp_path)
    draft = ProposalDraft(ProposalPayload(
        "agents/demo-agent.md", "fixture evidence", "Update the note.",
        "diff --git a/agents/demo-agent.md b/agents/demo-agent.md\n"
        "--- a/agents/demo-agent.md\n+++ b/agents/demo-agent.md\n@@ -1 +1 @@\n-wrong\n+after\n"), repo)

    result = maintainer._forecast_draft(draft, repo)

    assert result.eval_forecast["status"] == "error"
    scratch = repo / "state" / "scratch"
    assert scratch.is_dir() and list(scratch.iterdir()) == []
    worktrees = subprocess.run(["git", "worktree", "list", "--porcelain"], cwd=repo,
                              check=True, capture_output=True, text=True).stdout
    assert not any(Path(line.removeprefix("worktree ")).parent == scratch
                   for line in worktrees.splitlines() if line.startswith("worktree "))


def test_one_component_strip_bypass_is_refused_before_forecast_worktree_creation(tmp_path, monkeypatch):
    draft = ProposalDraft(ProposalPayload(
        "agents/demo-agent.md", "evidence", "unsafe",
        "diff --git a/agents/demo-agent.md b/agents/demo-agent.md\n"
        "--- a/agents/demo-agent.md\n"
        "+++ a/b/agents/demo-agent.md\n"), tmp_path)
    created = False

    def no_scratch(*_args):
        nonlocal created
        created = True
        raise AssertionError("forecast scratch must not be created")

    monkeypatch.setattr(maintainer, "_forecast_scratch_parent", no_scratch)
    result = maintainer._forecast_draft(draft, tmp_path)

    assert result.eval_forecast == {
        "agent_id": "demo-agent", "cards_run": 0, "passed": 0, "failed": 0,
        "status": "refused", "reason": "patch header must start with exactly b/",
    }
    assert created is False


@pytest.mark.parametrize("patch", [
    "diff --git a/agents/demo-agent.md b/agents/demo-agent.md\n--- a/agents/demo-agent.md\n+++ b/agents/demo-agent.md\n"
    "diff --git a/agents/second-agent.md b/agents/second-agent.md\n--- a/agents/second-agent.md\n+++ b/agents/second-agent.md\n",
    "diff --git a/agents/demo-agent.md b/agents/demo-agent.md\n--- a/agents/demo-agent.md\n+++ b/agents/demo-agent.md\nrename from agents/demo-agent.md\n",
], ids=["multi-file", "rename-header"])
def test_forecast_rejects_multi_file_and_rename_patches_before_worktree(tmp_path, monkeypatch, patch):
    draft = ProposalDraft(ProposalPayload("agents/demo-agent.md", "evidence", "unsafe", patch), tmp_path)
    monkeypatch.setattr(maintainer, "_forecast_scratch_parent",
                        lambda *_: pytest.fail("worktree must not be created"))

    forecast = maintainer._forecast_draft(draft, tmp_path).eval_forecast

    assert forecast["status"] == "refused"


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


def test_scandir_file_bound_sorts_entries_before_applying_cap(tmp_path, monkeypatch):
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

    assert consumed == MAX_FILES_PER_SOURCE + 5
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


def test_card_only_draft_is_honestly_skipped_as_no_diff(tmp_path):
    draft = _draft(tmp_path)

    forecast = maintainer._forecast_draft(draft, tmp_path).eval_forecast

    assert forecast["status"] == "skipped"
    assert forecast["reason"] == "no diff"


def test_output_contains_is_never_executed_during_forecast(tmp_path):
    repo = _forecast_repo(tmp_path)
    sentinel = tmp_path / "malicious-command-ran"
    own = agent_evals.suite_dir(repo, "demo-agent")
    (own / "sees-patch.md").write_text(_eval_card("sees-patch", "output-contains", {
        "command": [sys.executable, "-c", f"from pathlib import Path; Path({str(sentinel)!r}).write_text('bad')"],
        "expect_empty": True,
    }), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "malicious fixture")

    forecast = _forecast_result(repo).proposals[0].eval_forecast

    assert forecast["status"] == "skipped"
    assert forecast["reason"] == "not forecast-safe"
    assert not sentinel.exists()


def test_forecast_pytest_is_root_pinned_and_runs_once(tmp_path, monkeypatch):
    repo = _forecast_repo(tmp_path)
    observed = []
    real_run = maintainer.subprocess.run

    def inspect_run(command, *args, **kwargs):
        if command[:3] == [sys.executable, "-m", "pytest"]:
            observed.append((command, kwargs))
        return real_run(command, *args, **kwargs)

    monkeypatch.setattr(maintainer.subprocess, "run", inspect_run)
    forecast = _forecast_result(repo).proposals[0].eval_forecast

    assert forecast["status"] == "completed"
    command, kwargs = observed[0]
    assert command.count("--rootdir") == 1
    assert Path(command[command.index("--rootdir") + 1]) == Path(kwargs["cwd"])
    assert Path(kwargs["cwd"]).name.startswith("forecast-")


def test_forecast_failure_is_recorded_and_later_proposals_keep_order(tmp_path, monkeypatch):
    sources = _empty_sources(tmp_path / "sources")
    (tmp_path / "agents").mkdir()
    for agent in ("demo-agent", "second-agent"):
        (tmp_path / "agents" / f"{agent}.md").write_text("before\n", encoding="utf-8")
    (sources["eval_reports"] / "nightly.md").write_text(
        "## demo-agent\n| card | verdict | hermetic | reason |\n|---|---|---|---|\n| one | FAIL | yes | one |\n\n"
        "## second-agent\n| card | verdict | hermetic | reason |\n|---|---|---|---|\n| two | FAIL | yes | two |\n",
        encoding="utf-8")
    calls = []

    def explode_once(draft, _root, **_kwargs):
        calls.append(draft.target_path)
        if draft.target_path == "agents/demo-agent.md":
            raise RuntimeError("boom")
        return maintainer._forecast_report("completed", None, "second-agent")

    monkeypatch.setattr(maintainer, "_run_forecast", explode_once)
    result = run_fire(tmp_path, sources, forecast=True)

    assert [draft.target_path for draft in result.proposals] == ["agents/demo-agent.md", "agents/second-agent.md"]
    assert calls == ["agents/demo-agent.md", "agents/second-agent.md"]
    assert result.proposals[0].eval_forecast["status"] == "error"
    assert result.proposals[1].eval_forecast["status"] == "completed"


def test_forecast_cleanup_rmtree_precedes_prune_when_git_remove_fails(tmp_path, monkeypatch):
    worktree = tmp_path / "state" / "scratch" / "forecast-stale"
    worktree.mkdir(parents=True)
    calls = []

    class Result:
        def __init__(self, returncode):
            self.returncode = returncode

    def failed_remove(_root, args, **_kwargs):
        calls.append((args, worktree.exists()))
        if args[1] == "remove":
            return Result(1)
        assert not worktree.exists()
        return Result(0)

    monkeypatch.setattr(maintainer, "_git", failed_remove)
    maintainer._remove_forecast_worktree(tmp_path, worktree)

    assert calls == [(["worktree", "remove", "--force", str(worktree)], True),
                     (["worktree", "prune"], False)]


def test_forecast_scratch_uses_dashboard_state_root(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    state_root = tmp_path / "daemon-state"
    monkeypatch.setenv("DASHBOARD_STATE_ROOT", str(state_root))

    scratch = maintainer._forecast_scratch_parent(repo)

    assert scratch == state_root / "agent-maintainer" / "forecast"
    assert scratch.is_dir()
    assert not (repo / "state").exists()


def test_forecast_scratch_retains_repo_local_fallback(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    monkeypatch.delenv("DASHBOARD_STATE_ROOT", raising=False)

    scratch = maintainer._forecast_scratch_parent(repo)

    assert scratch == repo / "state" / "scratch"
    assert scratch.is_dir()


def test_stale_lease_sweep_only_removes_aged_forecast_directories(tmp_path, monkeypatch):
    scratch = tmp_path / "state" / "scratch"
    old_forecast = scratch / "forecast-old"
    fresh_forecast = scratch / "forecast-fresh"
    unrelated = scratch / "other-worker"
    for path in (old_forecast, fresh_forecast, unrelated):
        path.mkdir(parents=True)
    old_time = time.time() - maintainer.FORECAST_STALE_LEASE_SECONDS - 1
    os.utime(old_forecast, (old_time, old_time))
    removed = []
    monkeypatch.setattr(maintainer, "_remove_forecast_worktree", lambda _root, path: removed.append(path))

    maintainer._sweep_stale_forecast_leases(tmp_path)

    assert removed == [old_forecast]
