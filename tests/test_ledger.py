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


def test_append_heterogeneous_records_keeps_header_alignment(tmp_path):
    today = datetime.date.today().isoformat()
    ledger.append(tmp_path, "cost", "agent-a", {"step": "plan", "model": "opus", "usd": "0.10"})
    ledger.append(tmp_path, "cost", "agent-a", {"usd": "0.20"})
    rows = ledger.read_day(tmp_path, "cost", today)
    assert len(rows) == 2
    assert ledger.cost_today(tmp_path) == 0.30


def test_cost_today_skips_malformed_usd(tmp_path):
    ledger.append(tmp_path, "cost", "agent-a", {"usd": "0.10"})
    ledger.append(tmp_path, "cost", "agent-a", {"usd": "n/a"})
    ledger.append(tmp_path, "cost", "agent-a", {"usd": ""})
    assert ledger.cost_today(tmp_path) == 0.10


def test_append_recovers_zero_byte_shard(tmp_path):
    today = datetime.date.today().isoformat()
    # A shard file exists but is 0 bytes (e.g. crash between create and write).
    shard = tmp_path / "ledgers" / "cost" / f"agent-a-{today}.tsv"
    shard.parent.mkdir(parents=True, exist_ok=True)
    shard.touch()
    assert shard.stat().st_size == 0
    ledger.append(tmp_path, "cost", "agent-a", {"step": "plan", "model": "opus", "usd": "0.42"})
    rows = ledger.read_day(tmp_path, "cost", today)
    assert len(rows) == 1
    assert rows[0]["usd"] == "0.42"
    assert ledger.cost_today(tmp_path) == 0.42
