"""Verify the bridge's fleet cost record round-trips through scripts/ledger.py.

T5/D8: the queue->engine bridge emits a FLEET cost row (separate from the control plane's own
accounting) via `ledger.append(repo, 'cost', <subject>, record)`. This proves the exact record the
TS seam builds — {usd, billing, model, card_id} — writes a well-formed sharded TSV row whose columns
include usd/model/card_id and that `ledger.cost_today` reads it back (subscription rows are 0.0).
"""
import datetime
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
import ledger  # noqa: E402

SUBJECT = "dashboard-engine"


def _record(usd=0.0, model="claude-sonnet", card_id="wf-abc"):
    # The exact record shape the TS emitFleetCostRow builds.
    return {"usd": usd, "billing": "subscription", "model": model, "card_id": card_id}


def test_append_writes_a_row_with_usd_model_card_id_columns(tmp_path):
    path = ledger.append(tmp_path, "cost", SUBJECT, _record())
    today = datetime.date.today().isoformat()
    assert path == tmp_path / "ledgers" / "cost" / f"{SUBJECT}-{today}.tsv"
    rows = ledger.read_day(tmp_path, "cost", today)
    assert len(rows) == 1
    row = rows[0]
    assert set(("usd", "billing", "model", "card_id")).issubset(row.keys())
    assert row["model"] == "claude-sonnet"
    assert row["card_id"] == "wf-abc"
    assert row["billing"] == "subscription"


def test_subscription_rows_are_zero_and_cost_today_sums_them(monkeypatch, tmp_path):
    # cost_today reads today's shards; a subscription run contributes 0.0.
    ledger.append(tmp_path, "cost", SUBJECT, _record(usd=0.0, card_id="wf-a"))
    ledger.append(tmp_path, "cost", SUBJECT, _record(usd=0.0, card_id="wf-b"))
    assert ledger.cost_today(tmp_path) == 0.0


def test_derived_nonzero_usd_is_preserved_and_summed(tmp_path):
    # A metered value (micros/1e6) survives the round-trip and is summed by cost_today.
    ledger.append(tmp_path, "cost", SUBJECT, _record(usd=2.34, card_id="wf-a"))
    rows = ledger.read_day(tmp_path, "cost", datetime.date.today().isoformat())
    assert float(rows[0]["usd"]) == 2.34
    assert ledger.cost_today(tmp_path) == 2.34


def test_header_is_the_sorted_record_keys(tmp_path):
    ledger.append(tmp_path, "cost", SUBJECT, _record())
    shard = tmp_path / "ledgers" / "cost" / f"{SUBJECT}-{datetime.date.today().isoformat()}.tsv"
    header = shard.read_text(encoding="utf-8").splitlines()[0].split("\t")
    # ledger.append sorts the record keys for a fresh shard.
    assert header == sorted(_record().keys())
