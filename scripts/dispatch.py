"""Single-scheduler dispatcher — reads HEARTBEAT.md declarations, emits claimed cards.

The repo is the source of truth for cadences; Routines/Task Scheduler are just the clock
(spec s6). Only dispatchers assign work (owner + claim-token); workers never self-claim.
"""
from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

import yaml

import cards
import ledger

WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
FENCE = re.compile(r"```yaml\s*\n(.*?)\n```", re.DOTALL)


def parse_heartbeat(path: Path) -> list[dict]:
    m = FENCE.search(Path(path).read_text(encoding="utf-8"))
    if not m:
        return []
    data = yaml.safe_load(m.group(1)) or {}
    return data.get("cadences", [])


def due(cadence: dict, today: datetime.date) -> bool:
    schedule = cadence.get("schedule", "")
    if schedule == "daily":
        return True
    if schedule.startswith("weekly:"):
        return today.weekday() == WEEKDAYS[schedule.split(":", 1)[1]]
    return False


def _heartbeats(repo_root: Path):
    root_hb = Path(repo_root) / "HEARTBEAT.md"
    if root_hb.exists():
        yield "kb", root_hb
    orgs = Path(repo_root) / "orgs"
    if orgs.exists():
        for proj in sorted(orgs.iterdir()):
            if proj.name.startswith("_") or not proj.is_dir():
                continue
            hb = proj / "HEARTBEAT.md"
            if hb.exists():
                yield proj.name, hb


def run(repo_root: Path, tier: str, agent_id: str,
        today: datetime.date | None = None) -> list[Path]:
    today = today or datetime.date.today()
    # ledger.append shards by wall-clock day (ledger._shard); read the same shard so
    # idempotency holds even when `today` is injected for scheduling (tests, backfill).
    ledger_day = datetime.date.today().isoformat()
    ran = {f"{r['project']}:{r['cadence']}"
           for r in ledger.read_day(repo_root, "dispatch", ledger_day)}
    emitted: list[Path] = []
    for project, hb in _heartbeats(repo_root):
        try:
            cadences = parse_heartbeat(hb)
        except Exception as err:  # noqa: BLE001 — one bad heartbeat must not halt the fleet
            print(f"WARN: skipping {project} heartbeat: {err}")
            continue
        for cadence in cadences:
            key = f"{project}:{cadence['name']}"
            if cadence.get("tier") != tier or key in ran or not due(cadence, today):
                continue
            card = cards.new_card(
                project=project,
                action=f"cadence:{cadence['name']}",
                target=hb.parent.relative_to(repo_root).as_posix(),
                risk_tier=cadence.get("risk-tier", "T1"),
                body="## Work order\n\n" + cadence.get("prompt", "").strip() + "\n",
            )
            cards.claim(card, agent_id)
            emitted.append(cards.save(card, Path(repo_root) / "queue"))
            ledger.append(repo_root, "dispatch", agent_id,
                          {"date": today.isoformat(), "cadence": cadence["name"],
                           "project": project, "card": card.meta["id"]})
    return emitted


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", required=True, choices=("cloud", "desktop"))
    ap.add_argument("--agent", required=True)
    args = ap.parse_args()
    emitted = run(Path.cwd(), args.tier, args.agent)
    print(f"dispatched {len(emitted)} card(s)")
    for p in emitted:
        print(f"  {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
