"""Task 5 — per-agent eval runner (`scripts/agent_evals.py`).

Covers: manifest tamper refusal (the canary.py discipline, new scope), the three
deterministic judges (file-exists / output-contains / pytest), grade rows landing
in the RESERVED eval namespace through the unchanged `grade.py` schema, the
promotion-isolation guarantee (eval rows can never move an agent's own autonomy),
and the CLI's human-gated manifest re-bless.

No model calls anywhere in this file (model-judge tier is Task 6).
"""
import json
import sys
from pathlib import Path

import pytest

import promotion
from scripts.agent_evals import (
    INSPECTOR_ID,
    EVAL_WORKER,
    load_cards,
    main,
    run_suite,
    suite_dir,
    update_manifest,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


# --------------------------------------------------------------------------- #
# fixtures                                                                     #
# --------------------------------------------------------------------------- #
def _card_text(cid, judge, inp, *, capability="agent-baseline", tier="T1", k=1):
    lines = ["---", f"id: {cid}", f"capability: {capability}", f"judge: {judge}",
             'rubric_version: "1"', f"k: {k}", "source: curated", "immutable: true",
             f"tier: {tier}", "input:"]
    lines += [f"  {key}: {json.dumps(val)}" for key, val in inp.items()]
    lines += ["---", f"# {cid}", "", "Golden card body (inert data).", ""]
    return "\n".join(lines)


def _seed_suite(repo_root: Path, agent_id: str, cards: dict, *, bless=True) -> Path:
    d = suite_dir(repo_root, agent_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "README.md").write_text("readme is never manifested\n", encoding="utf-8")
    for cid, text in cards.items():
        (d / f"{cid}.md").write_text(text, encoding="utf-8")
    if bless:
        update_manifest(repo_root, agent_id)
    return d


def _smoke_suite(repo_root: Path, **kw) -> Path:
    (repo_root / "README.md").write_text("hello\n", encoding="utf-8")
    return _seed_suite(repo_root, "demo-agent",
                       {"smoke": _card_text("smoke", "file-exists", {"path": "README.md"})},
                       **kw)


# --------------------------------------------------------------------------- #
# manifest discipline (tamper refusal)                                         #
# --------------------------------------------------------------------------- #
def test_tampered_manifest_refuses_to_run(tmp_path):
    d = _smoke_suite(tmp_path)
    (d / "smoke.md").write_text(
        _card_text("smoke", "file-exists", {"path": "NOPE.md"}), encoding="utf-8")
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is False
    assert "manifest" in report.reason.lower()
    assert report.cards == []


def test_missing_manifest_refuses_to_run(tmp_path):
    _smoke_suite(tmp_path, bless=False)
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is False
    assert "manifest" in report.reason.lower()


def test_unmanifested_extra_card_refuses_to_run(tmp_path):
    d = _smoke_suite(tmp_path)
    (d / "sneaky.md").write_text(
        _card_text("sneaky", "file-exists", {"path": "README.md"}), encoding="utf-8")
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is False and "manifest" in report.reason.lower()


def test_readme_is_not_manifested(tmp_path):
    _smoke_suite(tmp_path)
    manifest = (suite_dir(tmp_path, "demo-agent") / "MANIFEST.sha256").read_text(
        encoding="utf-8")
    assert "smoke.md" in manifest and "README.md" not in manifest


def test_unknown_agent_is_a_refusal_not_a_crash(tmp_path):
    report = run_suite(tmp_path, "ghost-agent")
    assert report.passed is False and report.cards == []


# --------------------------------------------------------------------------- #
# recording — reserved eval namespace, unchanged grade schema                  #
# --------------------------------------------------------------------------- #
def test_passing_card_records_exactly_one_reserved_namespace_row(tmp_path):
    _smoke_suite(tmp_path)
    record_root = tmp_path / "ledgerhome"
    report = run_suite(tmp_path, "demo-agent", record=True, record_root=record_root)
    assert report.passed is True
    assert [(c.id, c.passed) for c in report.cards] == [("smoke", True)]

    rows = promotion.read_grades(record_root)
    assert len(rows) == 1
    row = rows[0]
    assert row["worker"] == EVAL_WORKER == "eval-suite"
    assert row["task_type"] == "eval:demo-agent:smoke"
    assert row["project"] == "kb"
    assert row["card_id"] == "smoke"
    assert row["inspector_id"] == INSPECTOR_ID
    assert float(row["score"]) == 100.0
    assert row["pass"] == "True"
    # the real repo ledger was never touched
    assert not (tmp_path / "ledgers").exists()


def test_no_rows_are_recorded_without_the_record_flag(tmp_path):
    _smoke_suite(tmp_path)
    record_root = tmp_path / "ledgerhome"
    run_suite(tmp_path, "demo-agent", record_root=record_root)
    assert promotion.read_grades(record_root) == []


def test_failing_card_records_a_zero_row_and_fails_the_suite(tmp_path):
    _seed_suite(tmp_path, "demo-agent",
                {"smoke": _card_text("smoke", "file-exists", {"path": "missing.md"})})
    record_root = tmp_path / "ledgerhome"
    report = run_suite(tmp_path, "demo-agent", record=True, record_root=record_root)
    assert report.passed is False
    assert report.cards[0].passed is False
    assert "missing.md" in report.cards[0].reason
    rows = promotion.read_grades(record_root)
    assert len(rows) == 1 and rows[0]["pass"] == "False" and float(rows[0]["score"]) == 0.0


# --------------------------------------------------------------------------- #
# promotion isolation — the guarantee this whole namespace exists for          #
# --------------------------------------------------------------------------- #
def test_forty_passing_eval_rows_cannot_move_the_agent_toward_acts_alone(tmp_path):
    _smoke_suite(tmp_path)
    record_root = tmp_path / "ledgerhome"
    for _ in range(40):
        assert run_suite(tmp_path, "demo-agent", record=True,
                         record_root=record_root).passed
    rows = promotion.read_grades(record_root)
    assert len(rows) == 40

    baseline = promotion.status("demo-agent", "kb", "build", "T2", [], frozen=False)
    for task_type in ("build", "eval:demo-agent:smoke"):
        for tier in ("T1", "T2", "T3"):
            verdict = promotion.status("demo-agent", "kb", task_type, tier, rows,
                                       frozen=False)
            assert verdict == baseline
            assert verdict != promotion.ACTS_ALONE
            assert verdict != promotion.AUTONOMOUS


# --------------------------------------------------------------------------- #
# deterministic judges                                                         #
# --------------------------------------------------------------------------- #
def test_output_contains_judge_runs_the_command_and_matches(tmp_path):
    _seed_suite(tmp_path, "demo-agent", {"smoke": _card_text(
        "smoke", "output-contains",
        {"command": [sys.executable, "-c", "print('kb-eval-marker')"],
         "contains": "kb-eval-marker"})})
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is True, [c.reason for c in report.cards]


def test_output_contains_judge_fails_on_a_missing_substring(tmp_path):
    _seed_suite(tmp_path, "demo-agent", {"smoke": _card_text(
        "smoke", "output-contains",
        {"command": [sys.executable, "-c", "print('nope')"], "contains": "kb-eval-marker"})})
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is False
    assert "kb-eval-marker" in report.cards[0].reason


def test_pytest_judge_runs_the_named_test_file(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_green.py").write_text(
        "def test_green():\n    assert True\n", encoding="utf-8")
    (tmp_path / "tests" / "test_red.py").write_text(
        "def test_red():\n    assert False\n", encoding="utf-8")
    _seed_suite(tmp_path, "demo-agent", {
        "green": _card_text("green", "pytest", {"test_file": "tests/test_green.py"}),
        "red": _card_text("red", "pytest", {"test_file": "tests/test_red.py"})})
    report = run_suite(tmp_path, "demo-agent")
    results = {c.id: c.passed for c in report.cards}
    assert results == {"green": True, "red": False}
    assert report.passed is False


def test_unknown_judge_fails_loud_instead_of_passing(tmp_path):
    _seed_suite(tmp_path, "demo-agent",
                {"smoke": _card_text("smoke", "model", {"prompt": "hi"})})
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is False
    assert "judge" in report.cards[0].reason.lower()


def test_a_crashing_judge_is_a_card_failure_not_a_suite_crash(tmp_path):
    _seed_suite(tmp_path, "demo-agent",
                {"smoke": _card_text("smoke", "output-contains", {"contains": "x"})})
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is False and report.cards[0].passed is False


def test_k_repeats_require_every_run_to_pass(tmp_path):
    (tmp_path / "README.md").write_text("hello\n", encoding="utf-8")
    _seed_suite(tmp_path, "demo-agent", {"smoke": _card_text(
        "smoke", "file-exists", {"path": "README.md"}, k=3)})
    report = run_suite(tmp_path, "demo-agent")
    assert report.passed is True and report.cards[0].k == 3


# --------------------------------------------------------------------------- #
# card parsing (reuses canary.py's frontmatter splitter)                       #
# --------------------------------------------------------------------------- #
def test_missing_required_field_is_a_loud_parse_error(tmp_path):
    d = suite_dir(tmp_path, "demo-agent")
    d.mkdir(parents=True)
    (d / "smoke.md").write_text("---\nid: smoke\n---\nbody\n", encoding="utf-8")
    with pytest.raises(Exception) as err:
        load_cards(d)
    assert "tier" in str(err.value) or "capability" in str(err.value)


# --------------------------------------------------------------------------- #
# the real committed suite                                                     #
# --------------------------------------------------------------------------- #
def test_real_demo_agent_suite_is_green_and_manifested():
    report = run_suite(REPO_ROOT, "demo-agent")
    assert report.passed, (report.reason, [(c.id, c.reason) for c in report.cards])
    assert any(c.id == "smoke" for c in report.cards)


def test_real_suite_run_writes_no_grade_rows_without_record():
    before = len(promotion.read_grades(REPO_ROOT))
    run_suite(REPO_ROOT, "demo-agent")
    assert len(promotion.read_grades(REPO_ROOT)) == before


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
@pytest.fixture
def _no_preamble(monkeypatch):
    import preamble
    monkeypatch.setattr(preamble, "check", lambda *a, **k: [])


def test_cli_run_exits_zero_on_a_green_suite(tmp_path, capsys, _no_preamble):
    _smoke_suite(tmp_path)
    assert main(["run", "demo-agent", "--repo", str(tmp_path)]) == 0
    assert "smoke" in capsys.readouterr().out


def test_cli_run_exits_nonzero_on_a_red_suite(tmp_path, _no_preamble):
    _seed_suite(tmp_path, "demo-agent",
                {"smoke": _card_text("smoke", "file-exists", {"path": "missing.md"})})
    assert main(["run", "demo-agent", "--repo", str(tmp_path)]) != 0


def test_cli_record_writes_to_the_given_record_root(tmp_path, _no_preamble):
    _smoke_suite(tmp_path)
    record_root = tmp_path / "ledgerhome"
    assert main(["run", "demo-agent", "--repo", str(tmp_path), "--record",
                 "--record-root", str(record_root)]) == 0
    assert len(promotion.read_grades(record_root)) == 1


def test_cli_update_manifest_warns_that_blessing_is_a_human_act(tmp_path, capsys,
                                                                _no_preamble):
    d = _smoke_suite(tmp_path, bless=False)
    assert main(["run", "demo-agent", "--repo", str(tmp_path), "--update-manifest"]) == 0
    out = capsys.readouterr().out.lower()
    assert "human" in out
    assert (d / "MANIFEST.sha256").exists()
    assert run_suite(tmp_path, "demo-agent").passed


def test_cli_refuses_to_bless_a_red_suite(tmp_path, capsys, _no_preamble):
    d = _seed_suite(tmp_path, "demo-agent",
                    {"smoke": _card_text("smoke", "file-exists", {"path": "missing.md"})},
                    bless=False)
    assert main(["run", "demo-agent", "--repo", str(tmp_path), "--update-manifest"]) != 0
    assert not (d / "MANIFEST.sha256").exists()


def test_cli_blocks_on_the_preamble_gate(tmp_path, monkeypatch):
    import preamble
    _smoke_suite(tmp_path)
    monkeypatch.setattr(preamble, "check", lambda *a, **k: ["STOP file present"])
    assert main(["run", "demo-agent", "--repo", str(tmp_path)]) != 0
