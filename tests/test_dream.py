"""Wave C — Dreaming: memory-consolidation dry-run reporter (scripts/dream.py).

Covers the Mem0 router heuristics (merge-dupes, replace-stale by later entry and
by ledger evidence, prune dead-ref / resolved-todo), NOOP on clean input, the
report rendering (summary table + PROPOSAL banner), the STOP-file preamble gate,
and the apply-mode refusal. All hermetic on a tmp repo_root — never real memory.
"""
import datetime
from pathlib import Path

import grade
import dream

NOW = datetime.date(2026, 7, 20)


def _repo(tmp_path) -> Path:
    repo = tmp_path / "repo"
    (repo / "memory").mkdir(parents=True)
    return repo


def _mem(repo: Path, name: str, text: str) -> Path:
    p = repo / "memory" / name
    p.write_text(text, encoding="utf-8")
    return p


def _ops_by_reason(report: dream.DreamReport) -> dict[str, int]:
    tally: dict[str, int] = {}
    for f in report.files:
        for op in f.ops:
            tally[op.reason] = tally.get(op.reason, 0) + 1
    return tally


# --------------------------------------------------------------------------- #
# parsing
# --------------------------------------------------------------------------- #

def test_parse_memory_splits_entries_and_dates():
    text = (
        "# memory: agent\n\n"
        "## 2026-07-15\n"
        "- WORKED: first lesson about routing\n"
        "  with a wrapped continuation line\n"
        "- REMAINS: do the second thing\n"
        "## 2026-07-16 — a titled section\n"
        "- DECIDED: a third entry entirely\n"
    )
    entries = dream.parse_memory(text)
    assert len(entries) == 3
    assert entries[0].date == "2026-07-15"
    assert "wrapped continuation" in entries[0].text  # folded into the parent
    assert entries[1].is_todo is True                 # REMAINS marker
    assert entries[2].date == "2026-07-16"
    # label is stripped from the dupe-key tokens
    assert "worked" not in entries[0].tokens


# --------------------------------------------------------------------------- #
# merge-dupes (near-duplicate lessons -> UPDATE)
# --------------------------------------------------------------------------- #

def test_merge_dupes_detected(tmp_path):
    repo = _repo(tmp_path)
    _mem(repo, "a.md",
         "## 2026-07-15\n"
         "- Lesson: always invoke py -3 because MSYS python lacks yaml modules\n"
         "## 2026-07-16\n"
         "- Reminder: always invoke py -3 because MSYS python lacks yaml modules\n")
    report = dream.dream_report(repo, now=NOW)
    reasons = _ops_by_reason(report)
    assert reasons.get("merge-dupes") == 1     # the OLDER entry folds into the newer
    assert reasons.get("keep") == 1            # the survivor is NOOP
    f = report.files[0]
    assert f.counts()["UPDATE"] == 1 and f.counts()["NOOP"] == 1


# --------------------------------------------------------------------------- #
# replace-stale by a later superseding entry (change marker -> UPDATE)
# --------------------------------------------------------------------------- #

def test_replace_stale_by_later_change_marker(tmp_path):
    repo = _repo(tmp_path)
    _mem(repo, "a.md",
         "## 2026-07-15\n"
         "- Plan: the fleet build lives on the claude branch and proceeds tonight as planned\n"
         "## 2026-07-16\n"
         "- CORRECTION: the fleet build lives on the claude branch was rolled back tonight\n")
    report = dream.dream_report(repo, now=NOW)
    reasons = _ops_by_reason(report)
    assert reasons.get("replace-stale") == 1
    assert report.files[0].counts()["UPDATE"] == 1


# --------------------------------------------------------------------------- #
# replace-stale by ledger evidence (open item's card graded pass -> UPDATE)
# --------------------------------------------------------------------------- #

def test_replace_stale_by_ledger_evidence(tmp_path):
    repo = _repo(tmp_path)
    card = "6a581e05-36cf29da"
    _mem(repo, "a.md",
         "## 2026-07-19\n"
         f"- REMAINS: execute the review card `{card}` before the next wave starts\n")
    grade.record_grade(
        repo, worker="w", project="kb", task_type="review", tier="T2",
        card_id=card, score=96, rubric_version="1",
        inspector_id="inspector@agents.local",
        ts="2026-07-19T10:00:00+00:00", **{"pass": True},
    )
    report = dream.dream_report(repo, now=NOW)
    reasons = _ops_by_reason(report)
    assert reasons.get("replace-stale") == 1
    op = report.files[0].proposals[0]
    assert op.op == "UPDATE" and card in op.detail


def test_ledger_evidence_outside_window_is_ignored(tmp_path):
    repo = _repo(tmp_path)
    card = "6a581e05-36cf29da"
    _mem(repo, "a.md",
         "## 2026-07-19\n"
         f"- REMAINS: execute the review card `{card}` before the next wave starts\n")
    grade.record_grade(  # graded 200+ days ago -> outside the default 30d window
        repo, worker="w", project="kb", task_type="review", tier="T2",
        card_id=card, score=96, rubric_version="1",
        inspector_id="inspector@agents.local",
        ts="2026-01-01T10:00:00+00:00", **{"pass": True},
    )
    report = dream.dream_report(repo, now=NOW)
    # No recent evidence -> the open item stays NOOP, not replace-stale.
    assert _ops_by_reason(report).get("replace-stale") is None
    assert report.files[0].counts()["NOOP"] == 1


# --------------------------------------------------------------------------- #
# prune: dead reference (DELETE) and resolved TODO (DELETE)
# --------------------------------------------------------------------------- #

def test_prune_dead_reference(tmp_path):
    repo = _repo(tmp_path)
    (repo / "docs").mkdir()
    (repo / "docs" / "real.md").write_text("x", encoding="utf-8")
    _mem(repo, "a.md",
         "## 2026-07-15\n"
         "- See the map at docs/plans/gone-forever.md for the layout\n"
         "- See the map at docs/real.md for the other layout entirely\n")
    report = dream.dream_report(repo, now=NOW)
    reasons = _ops_by_reason(report)
    assert reasons.get("prune-dead-ref") == 1   # only the missing path is flagged
    op = [o for o in report.files[0].proposals][0]
    assert op.op == "DELETE" and "gone-forever.md" in op.detail
    # the entry that references an existing file is kept
    assert report.files[0].counts()["NOOP"] == 1


def test_prune_resolved_todo(tmp_path):
    repo = _repo(tmp_path)
    _mem(repo, "a.md",
         "## 2026-07-15\n"
         "- REMAINS: wire the dashboard inbox poller to the approvals queue\n"
         "## 2026-07-16\n"
         "- DONE: wired the dashboard inbox poller to the approvals queue, shipped and merged\n")
    report = dream.dream_report(repo, now=NOW)
    reasons = _ops_by_reason(report)
    assert reasons.get("prune-resolved") == 1
    assert report.files[0].counts()["DELETE"] == 1


# --------------------------------------------------------------------------- #
# NOOP on clean input
# --------------------------------------------------------------------------- #

def test_noop_on_clean_distinct_entries(tmp_path):
    repo = _repo(tmp_path)
    _mem(repo, "a.md",
         "## 2026-07-15\n"
         "- Telegram is the single fleet notification transport, bot token in the manager\n"
         "- Grade rows flow only through the pinned record_grade schema writer\n"
         "- Reconcile compares desired queue state against observed disk artifacts\n")
    report = dream.dream_report(repo, now=NOW)
    f = report.files[0]
    assert f.counts()["NOOP"] == 3
    assert f.proposals == []
    assert f.counts()["UPDATE"] == 0 and f.counts()["DELETE"] == 0


# --------------------------------------------------------------------------- #
# rendering
# --------------------------------------------------------------------------- #

def test_render_marks_proposal_and_summary_table(tmp_path):
    repo = _repo(tmp_path)
    _mem(repo, "a.md",
         "## 2026-07-15\n"
         "- Lesson: use py -3 because MSYS python lacks yaml and pip\n"
         "## 2026-07-16\n"
         "- Note: use py -3 since MSYS python lacks pip and yaml modules\n")
    text = dream.render(dream.dream_report(repo, now=NOW))
    assert "PROPOSAL" in text
    assert "makes **no** changes to `memory/`" in text
    assert "ADD · UPDATE · DELETE · NOOP" in text
    # summary table header + a totals row
    assert "| file | entries | ADD | UPDATE | DELETE | NOOP |" in text
    assert "| **total** |" in text
    assert "memory/a.md" in text


def test_render_empty_memory_dir(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    text = dream.render(dream.dream_report(repo, now=NOW))
    assert "No `memory/*.md` files found" in text


# --------------------------------------------------------------------------- #
# CLI: STOP-file preamble gate (STOP supremacy) — did-nothing exit
# --------------------------------------------------------------------------- #

def test_cli_stops_on_preamble_failure(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.setattr(dream.preamble, "check",
                        lambda *a, **k: ["STOP file present — fleet is frozen"])
    rc = dream.main(["--repo", str(repo), "--dry-run"])
    err = capsys.readouterr().err
    assert rc == dream.EXIT_PREAMBLE
    assert "PREAMBLE FAIL" in err and "STOP file present" in err


def test_cli_real_stop_file_blocks(tmp_path, capsys):
    repo = _repo(tmp_path)
    (repo / "STOP").write_text("frozen", encoding="utf-8")
    rc = dream.main(["--repo", str(repo), "--dry-run"])
    assert rc == dream.EXIT_PREAMBLE
    assert "PREAMBLE FAIL" in capsys.readouterr().err


# --------------------------------------------------------------------------- #
# CLI: apply-mode refusal (design gate)
# --------------------------------------------------------------------------- #

def test_cli_refuses_apply_mode(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    monkeypatch.setattr(dream.preamble, "check", lambda *a, **k: [])
    rc = dream.main(["--repo", str(repo)])   # no --dry-run
    err = capsys.readouterr().err
    assert rc == dream.EXIT_GATED
    assert "design-gated" in err and "never rewrites memory/" in err


def test_cli_dry_run_prints_and_writes_out(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path)
    _mem(repo, "a.md", "## 2026-07-15\n- a single clean distinct lesson entry\n")
    monkeypatch.setattr(dream.preamble, "check", lambda *a, **k: [])
    out_path = tmp_path / "report.md"
    rc = dream.main(["--repo", str(repo), "--dry-run", "--out", str(out_path)])
    out = capsys.readouterr().out
    assert rc == dream.EXIT_OK
    assert "PROPOSAL" in out
    assert out_path.exists()
    assert "memory/a.md" in out_path.read_text(encoding="utf-8")
    # dry-run must never mutate memory/
    assert (repo / "memory" / "a.md").read_text(encoding="utf-8") == \
        "## 2026-07-15\n- a single clean distinct lesson entry\n"
