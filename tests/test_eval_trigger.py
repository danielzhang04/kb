"""Task 6 — report-only eval trigger (`scripts/eval_trigger.py`).

Covers: the affected_suites mapping rules (kit/skills/fleet-dir changes -> ALL
REAL agent suites, `_fleet` itself NEVER a mapping key; agents/<id>.md -> that
suite; evals/agents/<id>/** -> that suite; a structurally-invalid id is
filtered out, not crashed on), the CLI's report-only contract (exit 0 ALWAYS —
a failing card, a suite that raises outright, or an unwritable --report-out
path all degrade to a diagnostic, never a non-zero exit), and the markdown
report (header/rollup + hermetic column).

No model calls anywhere in this file (the model-judge argv/env pins live in
tests/test_agent_evals.py).
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import agent_evals
from scripts.eval_trigger import EvalTriggerError, affected_suites, definition_version_drift, main

REPO_ROOT = Path(__file__).resolve().parents[1]


# --------------------------------------------------------------------------- #
# git fixture (mirrors tests/test_canary.py's diff-guard helpers)              #
# --------------------------------------------------------------------------- #
def _git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def _init_repo(tmp_path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")
    _git(repo, "config", "commit.gpgsign", "false")
    _git(repo, "config", "core.autocrlf", "false")
    return repo


def _commit_all(repo, message):
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", message)


def _card_text(cid, judge, inp, *, tier="T1"):
    lines = ["---", f"id: {cid}", "capability: agent-baseline", f"judge: {judge}",
             'rubric_version: "1"', "k: 1", "source: curated", "immutable: true",
             f"tier: {tier}", "input:"]
    lines += [f"  {key}: {val!r}" for key, val in inp.items()]
    lines += ["---", f"# {cid}", ""]
    return "\n".join(lines)


def _seed_agent_suites(repo, ids):
    """One blessed, trivially-passing file-exists suite per id under evals/agents/
    (works for real agent ids AND `_fleet` — this is a directory-seeding helper,
    not a claim about how `affected_suites` treats the id)."""
    (repo / "ANCHOR.md").write_text("x\n", encoding="utf-8")
    for aid in ids:
        d = repo / "evals" / "agents" / aid
        d.mkdir(parents=True)
        (d / "smoke.md").write_text(
            _card_text("smoke", "file-exists", {"path": "ANCHOR.md"}), encoding="utf-8")
        agent_evals.update_manifest(repo, aid)


# --------------------------------------------------------------------------- #
# affected_suites mapping rules                                                #
# --------------------------------------------------------------------------- #
def test_kit_change_maps_to_all_real_agent_suites_excluding_fleet_itself(tmp_path):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent", "other-agent", agent_evals.FLEET_SUITE_ID])
    (repo / "readme.txt").write_text("hi\n", encoding="utf-8")
    _commit_all(repo, "base")

    (repo / "kit").mkdir()
    (repo / "kit" / "spin-up.md").write_text("kit change\n", encoding="utf-8")
    _commit_all(repo, "touch kit")

    mapping = affected_suites(repo, "HEAD~1..HEAD")
    # `_fleet` is present on disk as a suite dir but must NEVER be a mapping
    # key — it is not a standalone runnable target (see module docstring).
    assert set(mapping) == {"demo-agent", "other-agent"}
    assert all(p.startswith("kit/") for paths in mapping.values() for p in paths)


def test_skills_curated_change_maps_to_all_real_agent_suites(tmp_path):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    _commit_all(repo, "base")

    (repo / "skills" / "curated" / "demo-skill").mkdir(parents=True)
    (repo / "skills" / "curated" / "demo-skill" / "SKILL.md").write_text(
        "s\n", encoding="utf-8")
    _commit_all(repo, "touch skill")

    mapping = affected_suites(repo, "HEAD~1..HEAD")
    assert set(mapping) == {"demo-agent"}
    assert mapping["demo-agent"] == ["skills/curated/demo-skill/SKILL.md"]


def test_fleet_dir_change_fans_out_to_all_real_agent_suites_not_to_fleet_itself(tmp_path):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent", "other-agent", agent_evals.FLEET_SUITE_ID])
    _commit_all(repo, "base")

    (repo / "evals" / "agents" / agent_evals.FLEET_SUITE_ID / "another.md").write_text(
        _card_text("another", "file-exists", {"path": "ANCHOR.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, agent_evals.FLEET_SUITE_ID)
    _commit_all(repo, "add fleet card")

    mapping = affected_suites(repo, "HEAD~1..HEAD")
    assert set(mapping) == {"demo-agent", "other-agent"}
    assert all(any("another.md" in p for p in paths) for paths in mapping.values())


def test_single_agent_def_change_maps_to_one_suite(tmp_path):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent", "other-agent"])
    (repo / "agents").mkdir()
    (repo / "agents" / "demo-agent.md").write_text("---\nid: demo-agent\n---\n",
                                                    encoding="utf-8")
    _commit_all(repo, "base")

    (repo / "agents" / "demo-agent.md").write_text(
        "---\nid: demo-agent\nrole: work\n---\n", encoding="utf-8")
    _commit_all(repo, "edit demo-agent def")

    mapping = affected_suites(repo, "HEAD~1..HEAD")
    assert set(mapping) == {"demo-agent"}
    assert mapping["demo-agent"] == ["agents/demo-agent.md"]


def test_definition_version_drift_warns_only_when_content_changed_without_bump(tmp_path, capsys):
    repo = _init_repo(tmp_path)
    (repo / "agents").mkdir()
    definition = repo / "agents" / "demo-agent.md"
    definition.write_text("---\nid: demo-agent\nversion: 1\nrole: work\n---\n# before\n", encoding="utf-8")
    _commit_all(repo, "base")

    definition.write_text("---\nid: demo-agent\nversion: 1\nrole: work\n---\n# changed behavior\n", encoding="utf-8")
    _commit_all(repo, "changed without bump")
    assert definition_version_drift(repo, "HEAD~1..HEAD") == [
        "def changed without version bump: agents/demo-agent.md (v1)",
    ]
    assert main(["--repo", str(repo), "--range", "HEAD~1..HEAD"]) == 0
    assert "WARNING: def changed without version bump: agents/demo-agent.md (v1)" in capsys.readouterr().out

    definition.write_text("---\nid: demo-agent\nversion: 2\nrole: work\n---\n# bumped behavior\n", encoding="utf-8")
    _commit_all(repo, "changed with bump")
    assert definition_version_drift(repo, "HEAD~1..HEAD") == []


def test_definition_version_drift_ignores_eol_and_trailing_whitespace_only_changes(tmp_path):
    repo = _init_repo(tmp_path)
    definition = repo / "agents" / "demo-agent.md"
    definition.parent.mkdir()
    definition.write_bytes(b"---\nid: demo-agent\nversion: 2\nrole: work\n---\n# body\n")
    _commit_all(repo, "base")

    definition.write_bytes(b"---\r\nid: demo-agent  \r\nversion: 2\r\nrole: work\t\r\n---\r\n# body  \r\n")
    _commit_all(repo, "normalization only")
    assert definition_version_drift(repo, "HEAD~1..HEAD") == []


def test_definition_version_drift_warns_on_a_version_regression(tmp_path):
    repo = _init_repo(tmp_path)
    definition = repo / "agents" / "demo-agent.md"
    definition.parent.mkdir()
    definition.write_text("---\nid: demo-agent\nversion: 3\nrole: work\n---\n# before\n", encoding="utf-8")
    _commit_all(repo, "base")

    definition.write_text("---\nid: demo-agent\nversion: 2\nrole: inspect\n---\n# after\n", encoding="utf-8")
    _commit_all(repo, "regression")
    assert definition_version_drift(repo, "HEAD~1..HEAD") == [
        "def changed without version bump: agents/demo-agent.md (v2)",
    ]


def test_definition_version_drift_uses_merge_base_for_three_dot_ranges(tmp_path):
    repo = _init_repo(tmp_path)
    definition = repo / "agents" / "demo-agent.md"
    definition.parent.mkdir()
    definition.write_text("---\nid: demo-agent\nversion: 1\nrole: work\n---\n# base\n", encoding="utf-8")
    _commit_all(repo, "base")
    _git(repo, "checkout", "-b", "feature")
    definition.write_text("---\nid: demo-agent\nversion: 1\nrole: inspect\n---\n# feature\n", encoding="utf-8")
    _commit_all(repo, "feature change")
    _git(repo, "checkout", "master")
    (repo / "README.md").write_text("main only\n", encoding="utf-8")
    _commit_all(repo, "main change")

    assert definition_version_drift(repo, "master...feature") == [
        "def changed without version bump: agents/demo-agent.md (v1)",
    ]


def test_invalid_agent_def_id_is_filtered_out_of_the_mapping(tmp_path):
    """`agents/.template.md` -> id `.template`, which `agent_evals.suite_dir`
    would reject outright (leading dot). A report tool must filter this, not
    surface a doomed key or crash trying to run it."""
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    (repo / "agents").mkdir()
    (repo / "agents" / "demo-agent.md").write_text("x\n", encoding="utf-8")
    _commit_all(repo, "base")

    (repo / "agents" / ".template.md").write_text("template stub\n", encoding="utf-8")
    _commit_all(repo, "add a template def")

    mapping = affected_suites(repo, "HEAD~1..HEAD")
    assert mapping == {}  # ".template" never becomes a key
    assert ".template" not in mapping


def test_suite_dir_change_maps_to_its_own_suite(tmp_path):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    _commit_all(repo, "base")

    (repo / "evals" / "agents" / "demo-agent" / "extra.md").write_text(
        _card_text("extra", "file-exists", {"path": "ANCHOR.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _commit_all(repo, "add card")

    mapping = affected_suites(repo, "HEAD~1..HEAD")
    assert set(mapping) == {"demo-agent"}
    assert any("extra.md" in p for p in mapping["demo-agent"])


def test_unrelated_change_maps_to_nothing(tmp_path):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    (repo / "code.py").write_text("x = 1\n", encoding="utf-8")
    _commit_all(repo, "base")

    (repo / "code.py").write_text("x = 2\n", encoding="utf-8")
    _commit_all(repo, "touch code only")

    assert affected_suites(repo, "HEAD~1..HEAD") == {}


def test_bad_range_raises_eval_trigger_error(tmp_path):
    repo = _init_repo(tmp_path)
    (repo / "x.txt").write_text("a\n", encoding="utf-8")
    _commit_all(repo, "base")
    with pytest.raises(EvalTriggerError):
        affected_suites(repo, "not-a-real-ref..HEAD")


# --------------------------------------------------------------------------- #
# CLI — report-only contract                                                   #
# --------------------------------------------------------------------------- #
@pytest.fixture
def _no_preamble(monkeypatch):
    import scripts.eval_trigger as eval_trigger
    monkeypatch.setattr(eval_trigger.preamble, "check", lambda *a, **k: [])


def test_cli_prints_mapping_and_exits_zero(tmp_path, capsys, _no_preamble):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    (repo / "agents").mkdir()
    (repo / "agents" / "demo-agent.md").write_text("---\nid: demo-agent\n---\n",
                                                    encoding="utf-8")
    _commit_all(repo, "base")
    (repo / "agents" / "demo-agent.md").write_text(
        "---\nid: demo-agent\nrole: work\n---\n", encoding="utf-8")
    _commit_all(repo, "edit")

    rc = main(["--range", "HEAD~1..HEAD", "--repo", str(repo)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "demo-agent" in out


def test_cli_run_executes_own_suite_and_the_fleet_baseline(tmp_path, capsys, _no_preamble):
    """Item 3: for every mapped agent id, `--run` executes BOTH that agent's
    own suite AND `run_suite(root, agent_id, fleet=True)` — never just one."""
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent", agent_evals.FLEET_SUITE_ID])
    (repo / "agents").mkdir()
    (repo / "agents" / "demo-agent.md").write_text("x\n", encoding="utf-8")
    _commit_all(repo, "base")
    (repo / "agents" / "demo-agent.md").write_text("y\n", encoding="utf-8")
    _commit_all(repo, "edit")

    rc = main(["--range", "HEAD~1..HEAD", "--repo", str(repo), "--run"])
    assert rc == 0
    out = capsys.readouterr().out
    # the fleet card here ("smoke": file-exists ANCHOR.md — no {agent_id} in
    # it) passes trivially regardless of target — its presence in the report
    # under BOTH sections proves both runs actually happened.
    assert "## demo-agent" in out
    assert "### demo-agent — own suite" in out
    assert "### demo-agent — fleet baseline" in out


def test_cli_run_exit_code_is_zero_even_with_a_failing_card(tmp_path, capsys, _no_preamble):
    repo = _init_repo(tmp_path)
    d = repo / "evals" / "agents" / "demo-agent"
    d.mkdir(parents=True)
    (d / "smoke.md").write_text(
        _card_text("smoke", "file-exists", {"path": "MISSING.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _commit_all(repo, "base")

    (d / "extra.md").write_text(
        _card_text("extra", "file-exists", {"path": "MISSING.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _commit_all(repo, "touch suite")

    rc = main(["--range", "HEAD~1..HEAD", "--repo", str(repo), "--run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "FAIL demo-agent/own/smoke" in out


def test_cli_run_exit_code_is_zero_even_when_a_suite_raises(tmp_path, capsys, _no_preamble,
                                                             monkeypatch):
    """Exit-0 law, the hard case: `run_suite` itself raises an unexpected
    exception (not just a manifest-tamper refusal). `_safe_run_suite` must
    catch it and turn it into a REFUSED report; the CLI must still exit 0."""
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    (repo / "agents").mkdir()
    (repo / "agents" / "demo-agent.md").write_text("x\n", encoding="utf-8")
    _commit_all(repo, "base")
    (repo / "agents" / "demo-agent.md").write_text("y\n", encoding="utf-8")
    _commit_all(repo, "edit")

    import scripts.eval_trigger as eval_trigger

    real_run_suite = eval_trigger.agent_evals.run_suite

    def boom(root, suite_id, **kwargs):
        if suite_id == "demo-agent" and not kwargs.get("fleet"):
            raise RuntimeError("simulated crash")
        return real_run_suite(root, suite_id, **kwargs)

    monkeypatch.setattr(eval_trigger.agent_evals, "run_suite", boom)

    rc = main(["--range", "HEAD~1..HEAD", "--repo", str(repo), "--run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "suite demo-agent (own): REFUSED" in out
    assert "simulated crash" in out


def test_cli_run_writes_a_markdown_report_to_report_out(tmp_path, _no_preamble):
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    _commit_all(repo, "base")
    (repo / "evals" / "agents" / "demo-agent" / "extra.md").write_text(
        _card_text("extra", "file-exists", {"path": "ANCHOR.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _commit_all(repo, "touch suite")

    report_out = tmp_path / "report.md"
    rc = main(["--range", "HEAD~1..HEAD", "--repo", str(repo), "--run",
              "--report-out", str(report_out)])
    assert rc == 0
    text = report_out.read_text(encoding="utf-8")
    assert "# eval_trigger report" in text
    assert "- range: `HEAD~1..HEAD`" in text
    assert "- HEAD: `" in text
    assert "- generated: " in text
    assert "## Rollup" in text
    assert "demo-agent: own" in text and "fleet" in text
    assert "demo-agent" in text
    assert "smoke" in text and "extra" in text
    assert "hermetic" in text  # column header present (item 9)


def test_cli_report_out_falls_back_to_stdout_on_an_unwritable_path(tmp_path, capsys,
                                                                    _no_preamble):
    """Item 2: a `--report-out` path that cannot be created (its parent is a
    plain FILE, not a directory, so `mkdir(parents=True)` raises) must not
    crash or change the exit code — the report prints to stdout instead."""
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    _commit_all(repo, "base")
    (repo / "evals" / "agents" / "demo-agent" / "extra.md").write_text(
        _card_text("extra", "file-exists", {"path": "ANCHOR.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _commit_all(repo, "touch suite")

    blocker = tmp_path / "blocker-file"
    blocker.write_text("i am a file, not a directory\n", encoding="utf-8")
    unwritable = blocker / "sub" / "report.md"

    rc = main(["--range", "HEAD~1..HEAD", "--repo", str(repo), "--run",
              "--report-out", str(unwritable)])
    assert rc == 0
    assert not unwritable.exists()
    out = capsys.readouterr().out
    assert "# eval_trigger report" in out  # fell back to stdout


def test_cli_never_blocks_on_a_preamble_failure(tmp_path, monkeypatch):
    import scripts.eval_trigger as eval_trigger
    repo = _init_repo(tmp_path)
    _seed_agent_suites(repo, ["demo-agent"])
    _commit_all(repo, "base")
    (repo / "evals" / "agents" / "demo-agent" / "extra.md").write_text(
        _card_text("extra", "file-exists", {"path": "ANCHOR.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _commit_all(repo, "touch suite")

    monkeypatch.setattr(eval_trigger.preamble, "check", lambda *a, **k: ["STOP file present"])
    rc = main(["--range", "HEAD~1..HEAD", "--repo", str(repo), "--run"])
    assert rc == 0  # report-only: a frozen fleet must never turn into a nonzero exit


def test_cli_bad_range_still_exits_zero(tmp_path, _no_preamble):
    repo = _init_repo(tmp_path)
    (repo / "x.txt").write_text("a\n", encoding="utf-8")
    _commit_all(repo, "base")
    rc = main(["--range", "not-a-real-ref..HEAD", "--repo", str(repo)])
    assert rc == 0


def test_cli_survives_a_unicode_reason_under_legacy_cp1252_stdio(tmp_path):
    """Re-review blocker: a card `reason` embedding a non-cp1252 character
    (`→`/`中`), echoed verbatim into the mapping/markdown-report tables, must
    never crash `print()` on a legacy Windows console — that would break the
    HARD exit-0-ALWAYS law this CLI holds. A REAL subprocess with
    `PYTHONIOENCODING=cp1252` reproduces that console's starting encoding;
    `_force_utf8_stdio()` must override it before anything prints."""
    repo = _init_repo(tmp_path)
    d = repo / "evals" / "agents" / "demo-agent"
    d.mkdir(parents=True)
    (d / "smoke.md").write_text(
        _card_text("smoke", "file-exists", {"path": "→ 中 missing.md"}), encoding="utf-8")
    agent_evals.update_manifest(repo, "demo-agent")
    _commit_all(repo, "base")
    (repo / "agents").mkdir()
    (repo / "agents" / "demo-agent.md").write_text("x\n", encoding="utf-8")
    _commit_all(repo, "add def")

    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "cp1252"
    env.pop("ANTHROPIC_API_KEY", None)
    res = subprocess.run(
        [sys.executable, "-m", "scripts.eval_trigger", "--range", "HEAD~1..HEAD",
         "--repo", str(repo), "--run"],
        cwd=str(REPO_ROOT), capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=30, env=env)
    assert "Traceback" not in res.stderr, res.stderr
    assert "UnicodeEncodeError" not in res.stderr, res.stderr
    assert res.returncode == 0, (res.returncode, res.stdout, res.stderr)  # exit-0 law, always
    assert "→" in res.stdout  # the unicode char actually made it to stdout
