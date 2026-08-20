"""U10: deterministic transcript-to-ADD-proposal mining."""
from __future__ import annotations

from pathlib import Path

import pytest

from scripts.brain import session_miner


@pytest.fixture
def transcript() -> Path:
    """A scrubbed fixture with bounded retry, explicit lessons, and prose noise."""
    return Path(__file__).parent / "fixtures" / "session-miner-synthetic.jsonl"


def test_mines_retry_and_explicit_lessons_deterministically(transcript: Path) -> None:
    first = session_miner.mine_transcript(transcript)
    second = session_miner.mine_transcript(transcript)

    assert first == second
    assert [candidate.lesson for candidate in first] == [
        ('WORKED: retry Bash after an error; changed command "pytest -q" → '
         '"pytest tests/test_target.py -q". ERROR: import failed because the focused path was omitted.'),
        "WORKED: run the focused test path before the full suite.",
        "HAZARD: check the fixture directory before opening a trace.",
    ]
    assert [candidate.confidence for candidate in first] == ["med", "high", "high"]
    assert first[0].evidence == "session-miner-synthetic.jsonl:L2-L5"
    assert first[0].reason == "inferred bounded retry with changed input"
    assert first[0].date == "2026-08-18"
    assert "changed command \"pytest -q\" → \"pytest tests/test_target.py -q\"" in first[0].lesson
    assert "ERROR: import failed because the focused path was omitted." in first[0].lesson
    assert all("next time" not in candidate.lesson.lower() for candidate in first)
    assert all("distant" not in candidate.lesson for candidate in first)
    assert session_miner.default_output_path(transcript) == Path("docs/proposals/lessons/session-miner-synthetic.md")


def test_writes_only_the_requested_proposal_file(transcript: Path, tmp_path: Path) -> None:
    out = tmp_path / "review" / "proposals.md"
    before = {path.relative_to(tmp_path) for path in tmp_path.rglob("*")}

    written = session_miner.write_proposals(transcript, out)

    assert written == out.resolve()
    assert out.exists()
    assert {path.relative_to(tmp_path) for path in tmp_path.rglob("*")} - before == {
        Path("review"), Path("review/proposals.md")
    }
    text = out.read_text(encoding="utf-8")
    assert "status: PROPOSED" in text
    assert "human or dream.py must accept" in text
    assert "## ADD 1" in text
    assert "evidence: session-miner-synthetic.jsonl:L2-L5" in text
    assert "reason: inferred bounded retry with changed input" in text
    assert "date: 2026-08-18" in text


def test_refuses_a_memory_output_path(transcript: Path, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="memory"):
        session_miner.write_proposals(transcript, tmp_path / "memory" / "never.md")
