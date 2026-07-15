import datetime
import ledger


def test_append_creates_shard_with_header(tmp_path):
    p = ledger.append(tmp_path, "cost", "agent-a", {"step": "plan", "model": "opus", "usd": "0.0"})
    assert p.name.startswith("agent-a-")
    lines = p.read_text(encoding="utf-8").splitlines()
    assert lines[0].split("\t") == ["model", "step", "usd"]
    assert len(lines) == 2


def test_shards_are_per_agent(tmp_path):
    ledger.append(tmp_path, "cost", "agent-a", {"usd": "0.10"})
    ledger.append(tmp_path, "cost", "agent-b", {"usd": "0.20"})
    assert len(list((tmp_path / "ledgers" / "cost").glob("*.tsv"))) == 2


def test_read_day_merges_shards(tmp_path):
    today = datetime.date.today().isoformat()
    ledger.append(tmp_path, "cost", "a", {"usd": "0.10"})
    ledger.append(tmp_path, "cost", "b", {"usd": "0.25"})
    rows = ledger.read_day(tmp_path, "cost", today)
    assert len(rows) == 2
    assert ledger.cost_today(tmp_path) == 0.35
