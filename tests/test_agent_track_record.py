"""Tests for scripts/agent_track_record.py — Loop C's evidence driver.

The table is the loop's whole evidence base, so the properties that matter are: it is
deterministic, it fails CLOSED when the grader trust anchor is missing, and it never
writes to the repository it reads.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import agent_track_record as atr  # noqa: E402

HEADER = "card_id\tinspector_id\tpass\tproject\trubric_version\tscore\ttask_type\ttier\tts\tworker"


def _row(*, card_id, inspector="inspector@agents.local", passed="True", project="kb",
         score="96", task_type="cadence:demo", tier="T1", ts, worker="worker-desktop") -> str:
    return "\t".join([card_id, inspector, passed, project, "inspector-v1", score,
                      task_type, tier, ts, worker])


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    (tmp_path / "governance").mkdir()
    (tmp_path / "governance" / "graders.yaml").write_text(
        "graders:\n  - id: inspector@agents.local\n", encoding="utf-8")
    (tmp_path / "ledgers" / "grades").mkdir(parents=True)
    return tmp_path


def _write_shard(repo: Path, name: str, rows: list[str]) -> None:
    (repo / "ledgers" / "grades" / name).write_text(
        "\n".join([HEADER, *rows]) + "\n", encoding="utf-8")


def test_empty_ledger_yields_an_empty_table(repo: Path):
    assert atr.rollup(repo) == []


def test_absent_grades_dir_yields_an_empty_table(tmp_path: Path):
    assert atr.rollup(tmp_path) == []


def test_untrusted_grader_rows_are_dropped(repo: Path):
    """The trust anchor is the whole safety story: a row from an unlisted inspector must
    not reach the table, or Loop C could be steered by a planted ledger shard."""
    _write_shard(repo, "planted-2026-08-01.tsv", [
        _row(card_id="a1", inspector="worker-desktop", ts="2026-08-01T00:00:00+00:00"),
    ])
    assert atr.rollup(repo) == []


def test_absent_graders_yaml_trusts_nobody(repo: Path):
    (repo / "governance" / "graders.yaml").unlink()
    _write_shard(repo, "inspector@agents.local-2026-08-01.tsv", [
        _row(card_id="a1", ts="2026-08-01T00:00:00+00:00"),
    ])
    assert atr.rollup(repo) == []


def test_fixture_ledger_produces_the_exact_table(repo: Path):
    _write_shard(repo, "inspector@agents.local-2026-08-01.tsv", [
        # alpha: two clean passes, then a below-bar run that ends the pass count but is
        # above the T1 floor (80), so it does NOT reset the streak.
        _row(card_id="a1", worker="alpha", ts="2026-08-01T01:00:00+00:00", score="96"),
        _row(card_id="a2", worker="alpha", ts="2026-08-01T02:00:00+00:00", score="96"),
        _row(card_id="a3", worker="alpha", ts="2026-08-01T03:00:00+00:00", score="85"),
        # beta: an explicit failure (resets the streak to 0 — below floor), then a pass.
        _row(card_id="b1", worker="beta", passed="False", score="40",
             ts="2026-08-01T01:00:00+00:00"),
        _row(card_id="b2", worker="beta", ts="2026-08-01T02:00:00+00:00", score="96"),
    ])
    assert atr.rollup(repo) == [
        {
            "agent": "alpha", "project": "kb", "task_type": "cadence:demo", "tier": "T1",
            "runs": 3, "passes": 2, "streak": 3,
            "failure_patterns": [{"pattern": "below-bar<90>", "count": 1}],
        },
        {
            "agent": "beta", "project": "kb", "task_type": "cadence:demo", "tier": "T1",
            "runs": 2, "passes": 1, "streak": 1,
            "failure_patterns": [{"pattern": "failed", "count": 1}],
        },
    ]


def test_a_repeated_failure_pattern_is_counted(repo: Path):
    """Loop C's selection rule is 'a pattern appearing in >= 2 rows', so the count is
    load-bearing, not decorative."""
    _write_shard(repo, "inspector@agents.local-2026-08-02.tsv", [
        _row(card_id="c1", worker="gamma", passed="False", score="10",
             ts="2026-08-02T01:00:00+00:00"),
        _row(card_id="c2", worker="gamma", passed="False", score="10",
             ts="2026-08-02T02:00:00+00:00"),
    ])
    (entry,) = atr.rollup(repo)
    assert entry["failure_patterns"] == [{"pattern": "failed", "count": 2}]
    assert entry["streak"] == 0


def test_malformed_score_is_a_failure_not_a_pass(repo: Path):
    _write_shard(repo, "inspector@agents.local-2026-08-03.tsv", [
        _row(card_id="d1", worker="delta", score="n/a", ts="2026-08-03T01:00:00+00:00"),
    ])
    (entry,) = atr.rollup(repo)
    assert entry["passes"] == 0
    assert entry["failure_patterns"] == [{"pattern": "malformed-score", "count": 1}]


def test_unknown_tier_fails_closed(repo: Path):
    _write_shard(repo, "inspector@agents.local-2026-08-04.tsv", [
        _row(card_id="e1", worker="eps", tier="T9", ts="2026-08-04T01:00:00+00:00"),
    ])
    (entry,) = atr.rollup(repo)
    assert entry["streak"] == 0
    assert entry["failure_patterns"] == [{"pattern": "unknown-tier", "count": 1}]


def test_projects_are_not_collapsed(repo: Path):
    """promotion._row_key includes project; merging two projects' rows would report a
    streak no promotion decision would agree with."""
    _write_shard(repo, "inspector@agents.local-2026-08-05.tsv", [
        _row(card_id="f1", worker="zeta", project="kb", ts="2026-08-05T01:00:00+00:00"),
        _row(card_id="f2", worker="zeta", project="atlas", ts="2026-08-05T02:00:00+00:00"),
    ])
    table = atr.rollup(repo)
    assert [entry["project"] for entry in table] == ["atlas", "kb"]


def test_rollup_is_deterministic_across_shards(repo: Path):
    """Rows split across day-shards must roll up identically regardless of glob order."""
    _write_shard(repo, "inspector@agents.local-2026-08-07.tsv", [
        _row(card_id="g2", worker="eta", ts="2026-08-07T01:00:00+00:00"),
    ])
    _write_shard(repo, "inspector@agents.local-2026-08-06.tsv", [
        _row(card_id="g1", worker="eta", ts="2026-08-06T01:00:00+00:00"),
    ])
    assert atr.rollup(repo) == atr.rollup(repo)
    (entry,) = atr.rollup(repo)
    assert entry["runs"] == 2 and entry["streak"] == 2


def test_renderers_cover_the_fixed_column_set(repo: Path):
    _write_shard(repo, "inspector@agents.local-2026-08-08.tsv", [
        _row(card_id="h1", worker="theta", ts="2026-08-08T01:00:00+00:00"),
    ])
    table = atr.rollup(repo)
    markdown = atr.render_markdown(table)
    for column in atr.COLUMNS:
        assert column in markdown
    assert json.loads(atr.render_json(table)) == table


def test_empty_table_still_renders(repo: Path):
    assert "no trusted grade rows" in atr.render_markdown([])
    assert json.loads(atr.render_json([])) == []


def test_the_script_never_writes_to_the_repo_it_reads(repo: Path):
    """Read-only is a boundary Loop C's whole safety argument leans on."""
    _write_shard(repo, "inspector@agents.local-2026-08-09.tsv", [
        _row(card_id="i1", worker="iota", ts="2026-08-09T01:00:00+00:00"),
    ])

    def snapshot() -> dict[str, tuple[int, bytes]]:
        return {
            str(p.relative_to(repo)): (p.stat().st_size, p.read_bytes())
            for p in sorted(repo.rglob("*")) if p.is_file()
        }

    before = snapshot()
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "agent_track_record.py"),
         "--root", str(repo), "--format", "json"],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == atr.rollup(repo)
    assert snapshot() == before, "agent_track_record.py wrote into the repo it read"


def test_out_writes_only_the_named_report(repo: Path, tmp_path: Path):
    out = tmp_path / "track-record.json"
    assert atr.main(["--root", str(repo), "--format", "json", "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8")) == []
