"""Sharded ledgers — one TSV per writer per day; no shared-file merge conflicts (spec s4)."""
from __future__ import annotations

import csv
import datetime
from pathlib import Path

KINDS = ("dispatch", "cost", "activity", "grades")


def _shard(repo_root: Path, kind: str, agent: str, day: str | None = None) -> Path:
    if kind not in KINDS:
        raise ValueError(f"unknown ledger kind: {kind}")
    day = day or datetime.date.today().isoformat()
    return Path(repo_root) / "ledgers" / kind / f"{agent}-{day}.tsv"


def append(repo_root: Path, kind: str, agent: str, record: dict) -> Path:
    p = _shard(repo_root, kind, agent)
    p.parent.mkdir(parents=True, exist_ok=True)
    fields = sorted(record)
    is_new = not p.exists()
    with p.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter="\t")
        if is_new:
            w.writeheader()
        w.writerow(record)
    return p


def read_day(repo_root: Path, kind: str, day: str) -> list[dict]:
    rows: list[dict] = []
    d = Path(repo_root) / "ledgers" / kind
    if not d.exists():
        return rows
    for shard in sorted(d.glob(f"*-{day}.tsv")):
        with shard.open(encoding="utf-8", newline="") as f:
            rows.extend(csv.DictReader(f, delimiter="\t"))
    return rows


def cost_today(repo_root: Path) -> float:
    today = datetime.date.today().isoformat()
    return round(sum(float(r.get("usd", 0) or 0) for r in read_day(repo_root, "cost", today)), 6)
