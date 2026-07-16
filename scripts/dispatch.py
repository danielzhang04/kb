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


# --------------------------------------------------------------------------- #
# Task 4.1 -- depends-on DAG release logic (DAG keystone)                    #
# --------------------------------------------------------------------------- #
#
# A release pass over queue/ cards, wholly separate from the per-cadence loop
# in run() below: it releases a `blocked` child card to `inbox` once every id
# in its `depends-on` list names a card in `queue/done/`, threading each dep's
# `## Result` section verbatim into the child's body first. It is additive --
# it never touches the cadence-emission loop, ledger dedup, or promotion.decide
# -- and it runs unconditionally in run() (not gated by `tier`), since it
# concerns existing queue DAG state, not heartbeat cadences.
#
# SECURITY: `## Result` text from a dep card is untrusted-ish worker output --
# it is threaded as INERT DATA under its own clearly-labelled heading, never
# parsed/executed/interpreted. And this pass must never be a side channel
# around the approvals gate: it only ever performs the `blocked -> inbox`
# transition (the one cards.py's LEGAL map allows), and only for a child whose
# OWN stamped autonomy is not `queues-for-me`. A card whose own routing verdict
# was queues-for-me (destined for approvals) is left blocked -- this pass never
# upgrades autonomy/assurance_class and never acts-alone-releases such a card.
# Fail closed throughout: any parse error, on the child or on a dep, leaves the
# child blocked.
RESULT_HEADING = "## Result"


def _first_section(body: str, heading: str) -> str:
    """Fence-aware extraction of the first top-level `heading` section.

    Mirrors approvals.work_order_of's algorithm (column-0 '## ' headings only,
    fenced code blocks never count as headings, first occurrence wins) but is
    reimplemented here, parameterized by heading, so dispatch.py needn't import
    a card-verification helper out of approvals.py for an unrelated concern.
    Raises ValueError if `heading` never appears unfenced at column 0.
    """
    lines: list[str] = []
    capture = False
    fenced = False
    found = False
    done = False
    for line in body.splitlines():
        if line.startswith("```"):
            fenced = not fenced
            if capture:
                lines.append(line)
            continue
        is_heading = (not fenced) and line.startswith("## ")
        if is_heading:
            if capture:
                capture = False
                done = True
            elif not done and line == heading:
                capture = True
                found = True
            continue
        if capture:
            lines.append(line)
    if not found:
        raise ValueError(f"no {heading!r} section")
    return "\n".join(lines).strip()


def release_dependents(repo_root: Path) -> list[Path]:
    """Release `blocked` cards whose `depends-on` cards are all `done`.

    Only cards already sitting in queue/inbox/ (cards.STATE_DIR maps both
    "inbox" and "blocked" there) with state == "blocked" and a non-empty
    `depends-on` are candidates. Returns the paths released this call.
    """
    queue_root = Path(repo_root) / "queue"
    inbox_dir = queue_root / "inbox"
    done_dir = queue_root / "done"
    released: list[Path] = []
    if not inbox_dir.exists():
        return released
    for path in sorted(inbox_dir.glob("*.md")):
        try:
            child = cards.parse(path)
        except Exception:  # noqa: BLE001 — fail closed: unparseable card, skip it
            continue
        if child.meta.get("state") != "blocked":
            continue
        deps = child.meta.get("depends-on") or []
        if not deps:
            continue
        # A child whose own routing verdict was queues-for-me is destined for
        # human approval; this pass may never act-alone-release it to inbox,
        # and must never touch its autonomy/assurance_class either.
        if child.meta.get("autonomy") == promotion.QUEUES_FOR_ME:
            continue
        results: list[tuple[str, str]] = []
        all_done = True
        for dep_id in deps:
            dep_path = done_dir / f"{dep_id}.md"
            if not dep_path.exists():
                all_done = False
                break
            try:
                dep_card = cards.parse(dep_path)
                result_text = _first_section(dep_card.body, RESULT_HEADING)
            except Exception:  # noqa: BLE001 — fail closed: any dep parse error blocks release
                all_done = False
                break
            results.append((dep_id, result_text))
        if not all_done:
            continue
        threaded = "\n\n".join(
            f"## Result from {dep_id}\n\n{text}" for dep_id, text in results
        )
        child.body = child.body.rstrip("\n") + "\n\n" + threaded + "\n"
        cards.transition(child, "inbox", queue_root)
        released.append(child.path)
    return released


# --------------------------------------------------------------------------- #
# Task 4.2 -- role-tagged cards + auto inspect sibling + main-ref standing-auth
# --------------------------------------------------------------------------- #
#
# `role` (cards.ROLES: scout|manage|work|inspect|consolidate) defaults to
# "work" per cadence (`cadence.get("role", "work")`) and flows straight into
# cards.new_card, which validates the enum (Task 4.4/4.7) -- so an unknown role
# value raises cards.ValidationError. We fail closed the same way the
# heartbeat parser already fails closed on a wholly-malformed heartbeat (print
# a WARN, skip, keep going -- see the `except Exception` around
# `parse_heartbeat` below) but at CADENCE granularity instead of whole-heartbeat
# granularity: one cadence with a typo'd `role` must not withhold every other
# cadence in the same HEARTBEAT.md from dispatching. No card is emitted and
# nothing is written to the dispatch ledger for a bad-role cadence, so it is
# retried (and re-warned) on every future run until a human fixes the
# HEARTBEAT.md -- there is no silent, permanent drop.
#
# `inspect: true` on a cadence additionally emits a paired `role: inspect`
# sibling card that `depends-on: [<work-card-id>]`, modelled on
# routines/roles/inspector.md's fresh-context-grader contract:
#   * SECURITY: the sibling must never carry a BROADER autonomy than the work
#     card's own promotion.decide()-computed verdict -- an inspector that could
#     auto-act on a cadence nobody vouched for would be a privilege-escalation
#     side channel wearing a grading hat. We reuse the IDENTICAL
#     autonomy/assurance_class already computed for the work card (same
#     cadence -> same standing-auth + earned-status inputs), which trivially
#     satisfies "same-or-stricter": it is never looser.
#   * The sibling ALWAYS starts `state: blocked` with the above `depends-on`,
#     regardless of its autonomy verdict -- it cannot reach `inbox` before the
#     work it grades exists. Task 4.1's release_dependents() is the only thing
#     that can ever move it out of `blocked`, and it already refuses to
#     release a `queues-for-me`-stamped child to `inbox`
#     (test_release_never_routes_queues_for_me_child_to_inbox) -- so a sibling
#     that inherits queues-for-me simply stays blocked here; routing it to a
#     human is out of scope for dispatch (cards.py's LEGAL map has no
#     blocked -> approvals transition for dispatch to use even if it tried).
#   * The sibling's `owner` is the ROLE identity `inspector@agents.local` (per
#     routines/roles/inspector.md: "never the underlying model/agent name"),
#     never the dispatching agent_id -- so a grade can never appear to come
#     from the same identity that dispatched (or later, executed) the work
#     card it grades.
INSPECTOR_IDENTITY = "inspector@agents.local"


# --------------------------------------------------------------------------- #
# Task 3.6 -- fail-closed tier-partition rule (D5 invariant #10)              #
# --------------------------------------------------------------------------- #
#
# Every cadence must be scheduled by EXACTLY one of the two dispatcher tiers.
# The existing `cadence.get("tier") != tier` check in run()'s per-cadence loop
# already makes a *valid* ("cloud" xor "desktop") tier value mutually
# exclusive between the two dispatchers -- but it silently drops a cadence
# whose `tier` is missing, misspelled, or otherwise not one of the two known
# values: neither dispatcher's `!= tier` check ever matches such a cadence, so
# it is (correctly) never scheduled by either, but nobody is ever told. That
# is a silent fail-closed, not a fail-closed-and-visible one. This closes that
# gap: an invalid tier is reported once via a T1 wake-me card so a human fixes
# the HEARTBEAT.md, rather than the cadence quietly never running forever.
#
# Dedupe choice: scan the ENTIRE queue/ tree (every state dir, not just
# inbox/) for a pre-existing card with this exact `action` + `target` before
# filing a new one. This is deliberately NOT keyed off the per-day dispatch
# ledger (unlike the rest of run()'s idempotency, `ran`/`ledger_day`) because
# a misconfigured `tier` is a static config error, not a schedule -- it would
# otherwise still be "due" and re-detected (and re-filed) every single day
# until a human edits the HEARTBEAT.md. Scanning existing cards means exactly
# one wake-me is ever filed per (project, cadence name) for as long as that
# card exists anywhere in the queue, however many times either dispatcher
# tier runs, on however many days -- it naturally stops once a human moves it
# to done/ AND fixes the tier (a fixed tier no longer hits this branch at
# all). Fail-open on an unparseable existing card (skip just that one file):
# under-detecting a duplicate here only ever costs one extra wake-me card, it
# never hides an integrity problem the way silently over-detecting would.
UNKNOWN_TIER_ACTION = "wake-me:unknown-tier"


def _unknown_tier_target(project: str, cadence: dict) -> str:
    return f"{project}:{cadence.get('name', '<unnamed>')}"


def _wake_already_filed(repo_root: Path, action: str, target: str) -> bool:
    queue_root = Path(repo_root) / "queue"
    if not queue_root.exists():
        return False
    for path in queue_root.glob("*/*.md"):
        try:
            existing = cards.parse(path)
        except Exception:  # noqa: BLE001 — fail open: skip an unparseable card
            continue
        if existing.meta.get("action") == action and existing.meta.get("target") == target:
            return True
    return False


def _emit_unknown_tier_wake(repo_root: Path, project: str, cadence: dict) -> Path | None:
    target = _unknown_tier_target(project, cadence)
    if _wake_already_filed(repo_root, UNKNOWN_TIER_ACTION, target):
        return None
    name = cadence.get("name", "<unnamed>")
    body = (
        "## Work order\n\n"
        f"Cadence `{name}` in project `{project}` declares an invalid/missing "
        f"`tier` ({cadence.get('tier')!r}) — must be exactly \"cloud\" or "
        "\"desktop\". Fail-closed: this cadence is not scheduled by either "
        "dispatcher until a human fixes its HEARTBEAT.md `tier` field.\n"
    )
    card = cards.new_card(project=project, action=UNKNOWN_TIER_ACTION, target=target,
                          risk_tier="T1", body=body)
    return cards.save(card, Path(repo_root) / "queue")


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
    # Task 4.1 -- depends-on DAG release pass. Runs unconditionally (not
    # tier-gated): it concerns existing queue/ DAG state, not heartbeat
    # cadences, and is fully additive to the per-cadence loop below.
    release_dependents(repo_root)
    emitted: list[Path] = []
    for project, hb in _heartbeats(repo_root):
        try:
            cadences = parse_heartbeat(hb)
        except Exception as err:  # noqa: BLE001 — one bad heartbeat must not halt the fleet
            print(f"WARN: skipping {project} heartbeat: {err}")
            continue
        for cadence in cadences:
            if cadence.get("tier") not in ("cloud", "desktop"):
                _emit_unknown_tier_wake(repo_root, project, cadence)
                continue
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
            target = hb.parent.relative_to(repo_root).as_posix()
            role = cadence.get("role", "work")
            try:
                card = cards.new_card(
                    project=project,
                    action=f"cadence:{cadence['name']}",
                    target=target,
                    risk_tier=cadence.get("risk-tier", "T1"),
                    body="## Work order\n\n" + cadence.get("prompt", "").strip() + "\n",
                    state=state, autonomy=autonomy, assurance_class=assurance_class,
                    role=role,
                )
            except cards.ValidationError as err:
                # Fail closed at CADENCE granularity (see the Task 4.2 comment
                # above): skip only this cadence, never the whole heartbeat.
                print(f"WARN: skipping cadence {project}/{cadence['name']}: {err}")
                continue
            cards.claim(card, agent_id)
            emitted.append(cards.save(card, Path(repo_root) / "queue"))
            ledger.append(repo_root, "dispatch", agent_id,
                          {"date": today.isoformat(), "cadence": cadence["name"],
                           "project": project, "card": card.meta["id"]})

            if cadence.get("inspect"):
                try:
                    sibling = cards.new_card(
                        project=project,
                        action=f"cadence:{cadence['name']}:inspect",
                        target=target,
                        risk_tier=cadence.get("risk-tier", "T1"),
                        body=("## Work order\n\nInspect the paired work card "
                              f"{card.meta['id']} per routines/roles/inspector.md.\n"),
                        state="blocked", autonomy=autonomy,
                        assurance_class=assurance_class, role="inspect",
                        **{"depends-on": [card.meta["id"]]},
                    )
                except cards.ValidationError as err:  # pragma: no cover -- role="inspect" is always valid
                    print(f"WARN: skipping inspect sibling for {project}/{cadence['name']}: {err}")
                else:
                    cards.claim(sibling, INSPECTOR_IDENTITY)
                    emitted.append(cards.save(sibling, Path(repo_root) / "queue"))
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
