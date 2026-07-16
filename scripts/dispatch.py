"""Single-scheduler dispatcher — reads HEARTBEAT.md declarations, emits claimed cards.

The repo is the source of truth for cadences; Routines/Task Scheduler are just the clock
(spec s6). Only dispatchers assign work (owner + claim-token); workers never self-claim.
"""
from __future__ import annotations

import argparse
import datetime
import fnmatch
import re
import sys
from pathlib import Path

import yaml

import cards
import ledger
import promotion

WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
FENCE = re.compile(r"```yaml\s*\n(.*?)\n```", re.DOTALL)

# --------------------------------------------------------------------------- #
# Task 3.4 — nightly-review carve-out (governance/risk-tiers.md, 2026-07-16) #
# --------------------------------------------------------------------------- #
#
# risk-tiers.md grants ONLY `nightly-review` a standing T1 acts-alone
# authorization, scoped to an enumerated write allow-list: dashboards/**, the
# running agent's own memory shard, ledgers/dispatch/** (its own rows), and
# ledgers/cost/** (its own rows) -- plus its own card's queue/ state transition,
# which dispatch performs itself below and is therefore always in-scope, not
# something a cadence "declares". Any write outside that list -- including
# EXCLUDED integrity streams ledgers/grades/** and ledgers/activity/** -- voids
# the carve-out for that run and reverts it to queues-for-me.
#
# ASSUMPTION (documented for the next serialized dispatch.py editor -- task 4.1's
# DAG work): dispatch.py has no runtime introspection into what a cadence's
# prompt will actually write to disk. So a cadence MAY declare the paths its run
# intends to write as an optional `writes: [<repo-relative-path>, ...]` list in
# its HEARTBEAT.md block. This key is NOT one of promotion._CADENCE_FIELDS, so it
# never affects standing-authorization matching -- it is consulted here, by
# dispatch, only for `nightly-review` (the one cadence name risk-tiers.md
# carves out); every other cadence's `writes` (if present) is ignored. An
# absent/omitted `writes` list means "nothing declared" (vacuously in-scope),
# not "unknown -> fail closed" -- only nightly-review is ever checked at all.
NIGHTLY_REVIEW_CADENCE = "nightly-review"
_CARVEOUT_ALLOW_GLOBS = (
    "dashboards/*", "dashboards/**",
    "ledgers/dispatch/*", "ledgers/dispatch/**",
    "ledgers/cost/*", "ledgers/cost/**",
)


def _carveout_write_allowed(path: str, agent_id: str) -> bool:
    if path == f"memory/{agent_id}.md":
        return True
    return any(fnmatch.fnmatch(path, pat) for pat in _CARVEOUT_ALLOW_GLOBS)


def _carveout_voided(cadence: dict, agent_id: str) -> bool:
    """True iff a `nightly-review` cadence declares a write outside its
    enumerated allow-list -> the carve-out is void for this run, so any
    acts-alone verdict must be downgraded to queues-for-me regardless of why
    promotion.decide() granted it (earned autonomy or standing-authorization).
    Every other cadence name is untouched by this check."""
    if cadence.get("name") != NIGHTLY_REVIEW_CADENCE:
        return False
    writes = cadence.get("writes") or []
    return any(not _carveout_write_allowed(w, agent_id) for w in writes)


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
    ran = {(r['project'], r['cadence'])
           for r in ledger.read_day(repo_root, "dispatch", ledger_day)}
    emitted: list[Path] = []
    for project, hb in _heartbeats(repo_root):
        try:
            cadences = parse_heartbeat(hb)
        except Exception as err:  # noqa: BLE001 — one bad heartbeat must not halt the fleet
            print(f"WARN: skipping {project} heartbeat: {err}")
            continue
        for cadence in cadences:
            key = (project, cadence['name'])
            if cadence.get("tier") != tier or key in ran or not due(cadence, today):
                continue
            # decide() called on the TRUSTED read path only: grades_rows=None lets
            # it read+filter ledgers/grades/ itself via governance/graders.yaml
            # (trust-anchor invariant) rather than trusting raw ledger rows handed
            # in from here. main_ref is likewise left to resolve itself, so it
            # prefers the protected refs/remotes/origin/main over the agent-writable
            # local main.
            heartbeat_rel = hb.relative_to(repo_root).as_posix()
            decision = promotion.decide(
                cadence, repo_root,
                worker=agent_id, project=project, today=today,
                heartbeat_rel=heartbeat_rel, grades_rows=None,
            )
            autonomy = decision["autonomy"]
            assurance_class = decision["assurance_class"]
            if autonomy == promotion.ACTS_ALONE and _carveout_voided(cadence, agent_id):
                autonomy = promotion.QUEUES_FOR_ME
                assurance_class = "possession-eligible"
            state = "inbox" if autonomy == promotion.ACTS_ALONE else "approvals"
            card = cards.new_card(
                project=project,
                action=f"cadence:{cadence['name']}",
                target=hb.parent.relative_to(repo_root).as_posix(),
                risk_tier=cadence.get("risk-tier", "T1"),
                body="## Work order\n\n" + cadence.get("prompt", "").strip() + "\n",
                state=state, autonomy=autonomy, assurance_class=assurance_class,
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
