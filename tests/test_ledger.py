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


def test_approvals_kind_registered(tmp_path):
    today = datetime.date.today().isoformat()
    ledger.append(tmp_path, "approvals", "agent-a", {
        "ts": "2026-07-16T00:00:00+00:00", "update_id": 1, "card_id": "abc",
        "decision": "approve", "from_id": 111, "result": "approved",
    })
    p = tmp_path / "ledgers" / "approvals" / f"agent-a-{today}.tsv"
    assert p.exists()
    rows = ledger.read_day(tmp_path, "approvals", today)
    assert len(rows) == 1
    assert rows[0]["result"] == "approved"


def test_cursor_roundtrip(tmp_path):
    assert ledger.read_cursor(tmp_path, "telegram") == 0  # absent -> default
    p = ledger.write_cursor(tmp_path, "telegram", 42)
    assert p == tmp_path / "ledgers" / "approvals" / "telegram-cursor"
    assert ledger.read_cursor(tmp_path, "telegram") == 42
    ledger.write_cursor(tmp_path, "telegram", 43)
    assert ledger.read_cursor(tmp_path, "telegram") == 43  # overwritten, not appended


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


def test_append_accepts_an_exact_pinned_day_and_preserves_default(tmp_path):
    pinned = ledger.append(tmp_path, "cost", "agent-a", {"usd": "0.10"}, day="2026-09-07")
    assert pinned == tmp_path / "ledgers" / "cost" / "agent-a-2026-09-07.tsv"
    assert ledger.read_day(tmp_path, "cost", "2026-09-07") == [{"usd": "0.10"}]
    assert b"\r\n" not in pinned.read_bytes()
    default = ledger.append(tmp_path, "cost", "agent-b", {"usd": "0.20"})
    assert default.name == f"agent-b-{datetime.date.today().isoformat()}.tsv"


def test_append_recovers_a_zero_byte_pinned_shard(tmp_path):
    shard = tmp_path / "ledgers" / "cost" / "agent-a-2026-09-07.tsv"
    shard.parent.mkdir(parents=True, exist_ok=True)
    shard.touch()
    ledger.append(tmp_path, "cost", "agent-a", {"usd": "0.42"}, day="2026-09-07")
    assert ledger.read_day(tmp_path, "cost", "2026-09-07") == [{"usd": "0.42"}]


def test_append_rejects_every_noncanonical_pinned_day_before_creating_a_path(tmp_path):
    invalid = ["", "2026-9-7", "2026-09-07T00:00:00", "../2026-09-07", "2026-02-29", 20260907]
    for day in invalid:
        try:
            ledger.append(tmp_path, "cost", "agent-a", {"usd": "1"}, day=day)
        except ValueError as error:
            assert str(error) == "ledger day must be exact ISO YYYY-MM-DD"
        else:
            raise AssertionError(f"accepted invalid day {day!r}")
    assert not (tmp_path / "ledgers").exists()
