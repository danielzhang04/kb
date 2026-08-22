"""Single-scheduler dispatcher — reads HEARTBEAT.md declarations, emits claimed cards.

The repo is the source of truth for cadences; Routines/Task Scheduler are just the clock
(spec s6). Only dispatchers assign work (owner + claim-token); workers never self-claim.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import fnmatch
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

import cards
import ledger
import promotion
import routing

_ZERO = datetime.timedelta(0)
_HOUR = datetime.timedelta(hours=1)


def _first_sunday_on_or_after(value: datetime.datetime) -> datetime.datetime:
    return value + datetime.timedelta(days=(6 - value.weekday()) % 7)


def _eastern_dst_range(year: int) -> tuple[datetime.datetime, datetime.datetime]:
    """US Eastern DST boundaries under the post-2007 rule used by the platform."""
    start = _first_sunday_on_or_after(datetime.datetime(year, 3, 8, 2))
    end = _first_sunday_on_or_after(datetime.datetime(year, 11, 1, 2))
    return start, end


class _EasternTimezone(datetime.tzinfo):
    """Dependency-free America/New_York clock, including gaps and repeated hours.

    Windows Python does not ship the IANA database and the dispatcher must not
    silently fall back to the host timezone. kb supports current-era schedules,
    whose US Eastern rules have been stable since 2007.
    """

    def tzname(self, value: datetime.datetime | None) -> str:
        return "EDT" if self.dst(value) else "EST"

    def utcoffset(self, value: datetime.datetime | None) -> datetime.timedelta:
        return datetime.timedelta(hours=-5) + self.dst(value)

    def dst(self, value: datetime.datetime | None) -> datetime.timedelta:
        if value is None:
            return _ZERO
        start, end = _eastern_dst_range(value.year)
        wall = value.replace(tzinfo=None)
        if start + _HOUR <= wall < end - _HOUR:
            return _HOUR
        if end - _HOUR <= wall < end:
            return _ZERO if value.fold else _HOUR
        if start <= wall < start + _HOUR:
            return _HOUR if value.fold else _ZERO
        return _ZERO

    def fromutc(self, value: datetime.datetime) -> datetime.datetime:
        if value.tzinfo is not self:
            raise ValueError("fromutc requires the Eastern timezone")
        start, end = _eastern_dst_range(value.year)
        standard = value.replace(tzinfo=None) + datetime.timedelta(hours=-5)
        daylight = standard + _HOUR
        if end <= daylight < end + _HOUR:
            return standard.replace(tzinfo=self, fold=1)
        if standard < start or daylight >= end:
            return standard.replace(tzinfo=self)
        if start <= standard < end - _HOUR:
            return daylight.replace(tzinfo=self)
        return standard.replace(tzinfo=self)


OPERATOR_TIMEZONE = _EasternTimezone()

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

# Task 7 -- the same fail-loud posture for a MALFORMED CRON schedule. A
# `schedule:` value with exactly five whitespace-separated fields can only ever
# have been meant as cron (no legacy form -- `daily`, `weekly:<day>`, bare
# `weekly` -- contains whitespace at all), so when it does not parse, that is a
# typo, not a form this dispatcher does not know. Silently inert is exactly how
# a cadence goes missing for months, so it wakes a human on the same
# one-card-per-(action,target) terms as UNKNOWN_TIER above. The cadence still
# does not fire: loud AND non-firing, never a guessed correction.
MALFORMED_CRON_ACTION = "wake-me:malformed-schedule"


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


def _emit_malformed_cron_wake(repo_root: Path, project: str, cadence: dict) -> Path | None:
    """Mirror of _emit_unknown_tier_wake for an unparseable 5-field `schedule:`."""
    target = _unknown_tier_target(project, cadence)
    if _wake_already_filed(repo_root, MALFORMED_CRON_ACTION, target):
        return None
    name = cadence.get("name", "<unnamed>")
    body = (
        "## Work order\n\n"
        f"Cadence `{name}` in project `{project}` declares a `schedule` of "
        f"{cadence.get('schedule')!r}: five fields, so it was meant as cron, but "
        "it does not parse as one (fields are `M H DoM Mon DoW`; `*`, lists "
        "`a,b`, ranges `a-b`, steps `*/n`, and `mon`..`sun` / `0-6` for the "
        "day-of-week). Fail-closed: this cadence does not fire at all until a "
        "human fixes its HEARTBEAT.md `schedule` string. Timing lives inside "
        "that string and nowhere else — a sibling YAML key would bypass the "
        "standing-authorization byte-compare.\n"
    )
    card = cards.new_card(project=project, action=MALFORMED_CRON_ACTION, target=target,
                          risk_tier="T1", body=body)
    return cards.save(card, Path(repo_root) / "queue")


# --------------------------------------------------------------------------- #
# Phase R1.3 -- routing resolution at claim + owner-by-runtime                 #
# --------------------------------------------------------------------------- #
#
# Routing is resolved for the WORK card right at the claim anchor, from the
# one-winner precedence (card > queue/routing-override.yaml >
# governance/model-routing.yaml > safe default; see scripts/routing.py). Two
# fail-loud-and-skip paths mirror the existing UNKNOWN_TIER wake exactly (same
# dedupe via _wake_already_filed, same one-card-per-(action,target) posture):
#   * an UNKNOWN *named* model (routing.RoutingError) -> wake-me:unroutable-card,
#     and the cadence's work card is NOT dispatched -- never a silent
#     substitution of a default model for a card that named an unknown one.
#   * a cadence that pins `agent:` whose registered runtime disagrees with the
#     resolved runtime -> wake-me:owner-runtime-mismatch, and skip -- rather than
#     mis-owning the card to a runner that would then fail its own pre-exec
#     runtime assertion (agent_runner.ps1 / scripts/assert_runtime.py).
# Everything here is additive to run(): with no policy file committed yet (gate
# R1.0), routing.resolve returns the safe default and default_worker_for returns
# None, so owner selection collapses to the pre-R1 behaviour (dispatcher/pinned
# agent) -- every existing dispatch path is unchanged but for cards now carrying
# a stamped runtime/model.
UNROUTABLE_ACTION = "wake-me:unroutable-card"
OWNER_RUNTIME_MISMATCH_ACTION = "wake-me:owner-runtime-mismatch"


def _routing_wake_target(project: str, cadence: dict) -> str:
    return f"{project}:{cadence.get('name', '<unnamed>')}"


def _emit_unroutable_wake(repo_root: Path, project: str, cadence: dict) -> Path | None:
    target = _routing_wake_target(project, cadence)
    if _wake_already_filed(repo_root, UNROUTABLE_ACTION, target):
        return None
    name = cadence.get("name", "<unnamed>")
    body = (
        "## Work order\n\n"
        f"Cadence `{name}` in project `{project}` resolved to a model that is not "
        "in its runtime's `known_models` (governance/model-routing.yaml). "
        "Fail-loud: this card is NOT dispatched and no default model is "
        "substituted for it. Fix the card/override/policy model id (or add it to "
        "the runtime registry) so routing resolves to a known model.\n"
    )
    card = cards.new_card(project=project, action=UNROUTABLE_ACTION, target=target,
                          risk_tier="T1", body=body)
    return cards.save(card, Path(repo_root) / "queue")


def _emit_owner_runtime_mismatch_wake(repo_root: Path, project: str, cadence: dict,
                                      owner: str, resolved_runtime: str,
                                      owner_runtime: str) -> Path | None:
    target = _routing_wake_target(project, cadence)
    if _wake_already_filed(repo_root, OWNER_RUNTIME_MISMATCH_ACTION, target):
        return None
    name = cadence.get("name", "<unnamed>")
    body = (
        "## Work order\n\n"
        f"Cadence `{name}` in project `{project}` pins `agent: {owner}` (a "
        f"`{owner_runtime}`-runtime worker) but routing resolved the card to "
        f"runtime `{resolved_runtime}`. Fail-loud: this card is NOT dispatched "
        "rather than mis-owned to a runner that would refuse it at its own "
        "runtime pre-exec assertion. Reconcile the cadence's `agent:` with the "
        "routing policy/override for this card.\n"
    )
    card = cards.new_card(project=project, action=OWNER_RUNTIME_MISMATCH_ACTION,
                          target=target, risk_tier="T1", body=body)
    return cards.save(card, Path(repo_root) / "queue")


# --------------------------------------------------------------------------- #
# Wave F -- escalation-on-failure requeue (Quartermaster deltas)               #
# --------------------------------------------------------------------------- #
#
# When a claimed card's attempt FAILS, the fleet requeues it one MODEL tier up
# (routing.escalate_model over routing.TIER_LADDER -- the single canonical ladder,
# never a parallel one here) and bumps a `retry_count` frontmatter counter. The
# counter is capped at RETRY_CAP: once a card has already been retried RETRY_CAP
# times, the NEXT failure DEAD-LETTERS it instead of escalating again -- it is
# moved to the terminal `rejected` state (card-schema.md: `rejected` is in the
# STATES enum, resolves to queue/done/ via cards.STATE_DIR, and has no legal
# transition out of it) and ONE `wake-me:dead-letter` card is filed for a human,
# deduped by the exhausted card's id (repeated calls never mint a second wake-me).
# A card already at the TOP tier (or an off-ladder single-tier runtime like codex)
# is retried at the SAME tier -- no bump -- but the attempt still counts against
# the cap. This is a library entry point: wiring it into the worker runner's
# failure path (agent_runner.ps1) is a separate, out-of-scope change.
RETRY_CAP = 2
DEAD_LETTER_STATE = "rejected"
DEAD_LETTER_ACTION = "wake-me:dead-letter"
RETRY_COUNT_FIELD = "retry_count"


def _retry_count(meta: dict) -> int:
    """The card's `retry_count` frontmatter counter as an int (absent/garbage -> 0).
    Floor-clamped at 0: a negative value (mis-set or crafted) must never widen
    the RETRY_CAP bound — the cap is a safety guarantee, not a default."""
    try:
        return max(0, int(meta.get(RETRY_COUNT_FIELD) or 0))
    except (TypeError, ValueError):
        return 0


def _emit_dead_letter_wake(repo_root: Path, card, failure_summary: str) -> Path | None:
    """File ONE wake-me:dead-letter card for an exhausted card. Deduped on the
    exhausted card's id via _wake_already_filed (never a second wake for the same
    card id, however many times requeue is called for it)."""
    cid = str(card.meta.get("id"))
    if _wake_already_filed(repo_root, DEAD_LETTER_ACTION, cid):
        return None
    body = (
        "## Work order\n\n"
        f"Card `{cid}` (action `{card.meta.get('action')}`) exhausted its "
        f"escalation retries (retry_count={_retry_count(card.meta)}, cap "
        f"{RETRY_CAP}) and was dead-lettered to `{DEAD_LETTER_STATE}`. Last routed "
        f"model: `{card.meta.get('model')}`.\n\n"
        "Failure summary (inert data):\n\n"
        f"> {failure_summary or '(none supplied)'}\n\n"
        "Investigate why every attempt failed before re-filing any follow-up work.\n"
    )
    wake = cards.new_card(project=card.meta.get("project") or "kb",
                          action=DEAD_LETTER_ACTION, target=cid,
                          risk_tier="T1", body=body)
    return cards.save(wake, Path(repo_root) / "queue")


def requeue(repo_root, card, *, failure_summary: str = "",
            policy: dict | None = None, agent_id: str | None = None) -> dict:
    """Requeue a FAILED card one model tier up, or dead-letter it once the retry
    cap is spent. Mutates `card` in place, moves its on-disk file, and returns a
    report: ``{"outcome", "retry_count", "model", "path", "wake"}`` where
    ``outcome`` is ``"escalated"`` / ``"retried-same-tier"`` / ``"dead-lettered"``.

    `card` is a parsed cards.Card whose `path` is its current on-disk location (any
    state). On a retry it is re-filed to `inbox` with a fresh claim-token and, when
    a summary is supplied, a `## Feedback` section carrying it (inert rerun context
    per card-schema.md). On exhaustion it is moved to DEAD_LETTER_STATE and a single
    deduped wake-me:dead-letter card is filed.
    """
    repo_root = Path(repo_root)
    queue_root = repo_root / "queue"
    policy = routing.load_policy(repo_root) if policy is None else policy
    old_path = card.path
    current = _retry_count(card.meta)

    if current >= RETRY_CAP:
        card.meta["state"] = DEAD_LETTER_STATE
        new_path = cards.save(card, queue_root)
        if old_path and old_path.exists() and old_path != new_path:
            old_path.unlink()
        wake = _emit_dead_letter_wake(repo_root, card, failure_summary)
        return {"outcome": "dead-lettered", "retry_count": current,
                "model": card.meta.get("model"), "path": new_path, "wake": wake}

    new_model, bumped = routing.escalate_model(
        policy, card.meta.get("runtime"), card.meta.get("model"))
    card.meta["model"] = new_model
    card.meta[RETRY_COUNT_FIELD] = current + 1
    card.meta["state"] = "inbox"
    # A requeue is a fresh assignment of the same owner (the dispatcher when the
    # failed card carried none) -> mint a new claim-token.
    cards.claim(card, card.meta.get("owner") or agent_id or "dispatcher")
    if failure_summary:
        card.body = (card.body.rstrip("\n") + "\n\n## Feedback\n\n"
                     + failure_summary.strip() + "\n")
    new_path = cards.save(card, queue_root)
    if old_path and old_path.exists() and old_path != new_path:
        old_path.unlink()
    return {"outcome": "escalated" if bumped else "retried-same-tier",
            "retry_count": current + 1, "model": new_model,
            "path": new_path, "wake": None}


def parse_heartbeat(path: Path) -> list[dict]:
    m = FENCE.search(Path(path).read_text(encoding="utf-8"))
    if not m:
        return []
    data = yaml.safe_load(m.group(1)) or {}
    return data.get("cadences", [])


# --------------------------------------------------------------------------- #
# Task 7 -- 5-field cron inside the `schedule:` string (spec s5)               #
# --------------------------------------------------------------------------- #
#
# The `schedule:` string additionally accepts standard 5-field cron
# ("M H DoM Mon DoW", LOCAL time) alongside `daily` / `weekly:<day>`. Timing
# lives INSIDE that one string and never in a sibling YAML key, because
# promotion._CADENCE_FIELDS byte-compares `schedule` against main: any re-time
# therefore voids standing authorization automatically.
#
# Fire rule is Claude routines' rule verbatim -- skip-not-replay: when the
# dispatcher ticks, a cadence fires at most ONCE for the most recent occurrence
# that has already passed TODAY. Occurrences missed while the machine was off
# are skipped, never replayed (Codex Automations' catch-up semantics are
# deliberately NOT built -- spec s5 / Non-goals).
#
# Anything that is not a well-formed 5-field cron expression parses as None and
# falls through to the legacy branch, where it is INERT exactly like
# `schedule: monthly` or bare `schedule: weekly` are today. Parsing NEVER
# raises: a typo in one org's heartbeat must not take the fleet's clock down.
_CRON_DOW = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}


@dataclass(frozen=True)
class CronSpec:
    """A parsed 5-field cron expression. Pure data; no clock, no timezone."""
    minutes: frozenset
    hours: frozenset
    doms: frozenset
    months: frozenset
    dows: frozenset            # cron numbering: 0 == Sunday
    dom_star: bool             # day-of-month field was `*` (unrestricted)
    dow_star: bool             # day-of-week field was `*` (unrestricted)
    expr: str                  # the original string, for display/narration


def _cron_atom(text: str, lo: int, hi: int, names: dict | None) -> int | None:
    text = text.strip().lower()
    if names and text in names:
        value = names[text]
    elif text.isdigit():
        value = int(text)
    else:
        return None
    return value if lo <= value <= hi else None


def _cron_field(text: str, lo: int, hi: int, names: dict | None = None) -> frozenset | None:
    """One comma-separated cron field -> the set of values it selects.

    Accepts `*`, `a`, `a-b`, `*/n`, `a-b/n` (and names where `names` is given).
    Returns None -- never raises -- for anything malformed or out of range.
    """
    values: set[int] = set()
    for item in text.split(","):
        item = item.strip()
        if not item:
            return None
        step = 1
        if "/" in item:
            item, _, step_text = item.partition("/")
            if not step_text.isdigit() or int(step_text) < 1:
                return None
            step = int(step_text)
            item = item.strip()
        if item == "*":
            start, end = lo, hi
        else:
            bounds = item.split("-")
            if len(bounds) > 2:
                return None
            parsed = [_cron_atom(b, lo, hi, names) for b in bounds]
            if any(v is None for v in parsed):
                return None
            start = parsed[0]
            end = parsed[1] if len(parsed) == 2 else parsed[0]
            if end < start:
                return None
        values.update(range(start, end + 1, step))
    return frozenset(values) or None


def parse_cron(expr) -> CronSpec | None:
    """Parse a 5-field cron expression; None means "not cron -> legacy form"."""
    if not isinstance(expr, str):
        return None
    fields = expr.split()
    if len(fields) != 5:
        return None
    minute, hour, dom, month, dow = fields
    minutes = _cron_field(minute, 0, 59)
    hours = _cron_field(hour, 0, 23)
    doms = _cron_field(dom, 1, 31)
    months = _cron_field(month, 1, 12)
    dows = _cron_field(dow, 0, 7, _CRON_DOW)
    if None in (minutes, hours, doms, months, dows):
        return None
    # cron accepts 7 as Sunday alongside 0; normalise so matching is one lookup.
    dows = frozenset(0 if d == 7 else d for d in dows)
    # The star flags follow Vixie's own test: a field STARTING with `*` (`*`,
    # `*/n`) sets the flag -- not only a bare `*`. Keying off a bare `*` would
    # have left `0 0 13 * */2` with neither flag set, OR-ing its day fields and
    # firing on every stepped weekday as well as the 13th.
    return CronSpec(minutes=minutes, hours=hours, doms=doms, months=months, dows=dows,
                    dom_star=dom.strip().startswith("*"),
                    dow_star=dow.strip().startswith("*"), expr=expr)


def malformed_cron(schedule) -> bool:
    """True for a `schedule:` that was MEANT as cron but does not parse.

    Five whitespace-separated fields is the tell: no legacy form (`daily`,
    `weekly:<day>`, bare `weekly`) contains whitespace at all, so this can only
    be a typo -- which run() wakes a human about rather than leaving inert.
    """
    return (isinstance(schedule, str) and len(schedule.split()) == 5
            and parse_cron(schedule) is None)


def _cron_day_matches(spec: CronSpec, day: datetime.date) -> bool:
    """The Vixie day rule, verbatim: the day-of-month and day-of-week fields are
    OR-ed when BOTH are restricted, and AND-ed when either starts with `*`.

    The AND branch is what makes a lone `*` degenerate correctly (it matches
    every value, so the other field decides) while still honouring a narrowing
    step like `*/2` instead of silently discarding it.
    """
    if day.month not in spec.months:
        return False
    dom_hit = day.day in spec.doms
    dow_hit = ((day.weekday() + 1) % 7) in spec.dows   # Mon=0 (py) -> Sun=0 (cron)
    if spec.dom_star or spec.dow_star:
        return dom_hit and dow_hit
    return dom_hit or dow_hit


def cron_matches(spec: CronSpec | None, when: datetime.datetime) -> bool:
    """True iff `when` (to the minute, local time) is an occurrence of `spec`."""
    if spec is None:
        return False
    if when.tzinfo is not None:
        when = when.astimezone(OPERATOR_TIMEZONE)
    return (when.minute in spec.minutes and when.hour in spec.hours
            and _cron_day_matches(spec, when.date()))


def latest_occurrence(spec: CronSpec | None, now: datetime.datetime) -> datetime.datetime | None:
    """Most recent occurrence <= `now`, SAME DAY only; None if none has passed.

    Same-day only is the skip-not-replay rule made structural: dispatch already
    never replays past days, so an occurrence that did not happen today simply
    never happened.
    """
    if spec is None:
        return None
    if now.tzinfo is not None:
        eastern = now.astimezone(OPERATOR_TIMEZONE).replace(second=0, microsecond=0)
        if not _cron_day_matches(spec, eastern.date()):
            return None
        # Walk real elapsed minutes, not wall-clock replacements. This makes a
        # nonexistent spring-forward hour non-firing and distinguishes both
        # fall-back occurrences while retaining the same-day skip-not-replay rule.
        for offset in range(27 * 60):
            candidate = (eastern.astimezone(datetime.timezone.utc)
                         - datetime.timedelta(minutes=offset)).astimezone(OPERATOR_TIMEZONE)
            if candidate.date() != eastern.date():
                break
            if cron_matches(spec, candidate):
                return candidate
        return None
    if not _cron_day_matches(spec, now.date()):
        return None
    for hour in sorted(spec.hours, reverse=True):
        if hour > now.hour:
            continue
        for minute in sorted(spec.minutes, reverse=True):
            if hour == now.hour and minute > now.minute:
                continue
            return now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return None


def next_occurrence(spec: CronSpec | None, now: datetime.datetime) -> datetime.datetime | None:
    """First occurrence strictly after ``now`` for display/vector parity.

    Dispatch never calls this helper to decide due work; ``latest_occurrence``
    remains the firing oracle. Aware inputs walk real minutes in Eastern time so
    DST gaps and folds match the TypeScript preview vectors.
    """
    if spec is None:
        return None
    if now.tzinfo is not None:
        start = now.astimezone(datetime.timezone.utc).replace(second=0, microsecond=0)
        for offset in range(1, 370 * 24 * 60 + 1):
            candidate = (start + datetime.timedelta(minutes=offset)).astimezone(OPERATOR_TIMEZONE)
            if cron_matches(spec, candidate):
                return candidate
        return None
    start = now.replace(second=0, microsecond=0)
    for offset in range(1, 370 * 24 * 60 + 1):
        candidate = start + datetime.timedelta(minutes=offset)
        if cron_matches(spec, candidate):
            return candidate
    return None


def due(cadence: dict, today: datetime.date, repo_root: Path | None = None,
        now: datetime.datetime | None = None) -> bool:
    """True iff `cadence` is scheduled for `today` (and, for cron, by `now`).

    `repo_root` is optional (default None) so every pre-D1.1 call site (two
    positional args, no repo awareness) keeps working unchanged. When
    supplied, a files-only `queue/paused/<cadence-name>` sentinel SUPPRESSES
    this cadence's beat -- and only this one; it can never trigger or widen a
    schedule, only skip it. Presence-only check: the marker's contents (if
    any) are never read/parsed.

    `now` is likewise optional (default: the local wall clock) and is consulted
    ONLY by the cron branch, which needs a time of day the `today` date has no
    room for. A cron cadence is due iff an occurrence has already passed today
    -- and because dispatch is a same-day scheduler with no backfill, an
    injected `today` that is not the clock's own day never fires cron at all.
    The legacy `daily`/`weekly:<day>` branches below are untouched by `now`.
    """
    if repo_root is not None:
        name = cadence.get("name")
        if name and (Path(repo_root) / "queue" / "paused" / name).exists():
            return False
    schedule = cadence.get("schedule", "")
    spec = parse_cron(schedule)
    if spec is not None:
        when = now or datetime.datetime.now(OPERATOR_TIMEZONE)
        operator_when = when.astimezone(OPERATOR_TIMEZONE) if when.tzinfo is not None else when
        if operator_when.date() != today:
            return False
        return latest_occurrence(spec, operator_when) is not None
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
        today: datetime.date | None = None, session_id: str | None = None,
        now: datetime.datetime | None = None) -> list[Path]:
    # Task 7: one clock reading per run, shared by due()'s cron branch, the
    # occurrence dedup key and the `dispatched_at` stamp, so a run that straddles
    # a minute boundary cannot fire for one occurrence and record another.
    now = now or datetime.datetime.now(OPERATOR_TIMEZONE)
    operator_now = now.astimezone(OPERATOR_TIMEZONE) if now.tzinfo is not None else now
    today = today or operator_now.date()
    # ledger.append shards by wall-clock day (ledger._shard); read the same shard so
    # idempotency holds even when `today` is injected for scheduling (tests, backfill).
    ledger_day = datetime.date.today().isoformat()
    dispatched_rows = ledger.read_day(repo_root, "dispatch", ledger_day)
    ran = {(r['project'], r['cadence']) for r in dispatched_rows}
    # Task 7 -- occurrence-level dedup for cron cadences, generalizing `ran`
    # (which stays exactly as it was for the legacy per-day forms).
    #
    # A stamp WITHOUT a "T" names a whole DAY, not an occurrence: it is either a
    # legacy daily/weekly row (`scheduled_for` = the date), or a row that lost
    # the column entirely -- written before this field existed, or into a shard
    # whose header was pinned at creation (ledger.append fixes a shard's columns
    # on the first append and drops extras from later ones). All of those
    # normalise to `''`, the day-wide marker, which the cron guard below treats
    # as matching EVERY occurrence of that (project, cadence) today. So the bias
    # is always to skip:
    #   * a cadence re-timed from `daily` to cron mid-day cannot fire a second
    #     time on the strength of its new form, and
    #   * when a shard's header predates this field, a cron cadence fires at
    #     most once and its remaining occurrences are suppressed for the REST OF
    #     THAT DAY (the next day gets a fresh shard, with the column). That is a
    #     real cost, accepted deliberately: a missed occurrence is skipped, never
    #     replayed, whereas a duplicate dispatch would double-run live work.
    ran_occurrences = set()
    for row in dispatched_rows:
        stamp = row.get('scheduled_for') or ''
        ran_occurrences.add((row['project'], row['cadence'],
                             stamp if 'T' in stamp else ''))
    # Task 4.1 -- depends-on DAG release pass. Runs unconditionally (not
    # tier-gated): it concerns existing queue/ DAG state, not heartbeat
    # cadences, and is fully additive to the per-cadence loop below.
    release_dependents(repo_root)
    # Phase R1.3 -- load the routing policy + override ONCE per run (both fail
    # open to a safe default / empty on absent/corrupt; neither ever raises).
    # The policy file does not exist until gate R1.0, so this is {}/empty today
    # and routing.resolve returns the built-in safe default -- see run()'s
    # per-cadence routing block below.
    routing_policy = routing.load_policy(repo_root)
    routing_override = routing.load_override(repo_root)
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
            # Task 7 -- an intended-cron typo is LOUD and non-firing, never
            # silently inert. Filed before the tier filter (like the unknown-tier
            # wake above) so whichever dispatcher ticks first surfaces it, however
            # the broken cadence is tiered; _wake_already_filed keeps it to one card.
            if malformed_cron(cadence.get("schedule", "")):
                _emit_malformed_cron_wake(repo_root, project, cadence)
                continue
            key = (project, cadence['name'])
            spec = parse_cron(cadence.get("schedule", ""))
            # Legacy forms: the pre-Task-7 guard, unchanged (per-day dedup).
            if cadence.get("tier") != tier or (spec is None and key in ran):
                continue
            if not due(cadence, today, repo_root, now=now):
                continue
            if spec is None:
                # Additive: legacy rows now name the day they fired for, so every
                # row has the field and old rows (absent it) still dedup by key.
                scheduled_for = today.isoformat()
            else:
                # due() just proved an occurrence has passed today.
                scheduled_for = latest_occurrence(spec, now).isoformat()
                if ((*key, scheduled_for) in ran_occurrences
                        or (*key, '') in ran_occurrences):
                    continue
            # Task 5.2 -- optional `agent:` cadence key routes card ownership to a
            # named worker (backward-compatible: absent `agent:` keeps the current
            # dispatcher, agent_id, as owner). `owner` is what cards.claim() below
            # stamps onto the WORK card; the inspect sibling further down is
            # UNCHANGED by this -- it always claims as INSPECTOR_IDENTITY per the
            # Task 4.2 comment above, never the cadence's named agent.
            owner = cadence.get("agent", agent_id)
            # decide() called on the TRUSTED read path only: grades_rows=None lets
            # it read+filter ledgers/grades/ itself via governance/graders.yaml
            # (trust-anchor invariant) rather than trusting raw ledger rows handed
            # in from here. main_ref is likewise left to resolve itself, so it
            # prefers the protected refs/remotes/origin/main over the agent-writable
            # local main.
            #
            # worker=owner (not the bare agent_id): a cadence's `agent:` key names
            # a distinct EXECUTING identity, and earned-autonomy is a property of
            # WHO does the work, not who dispatched it. Keying the streak lookup
            # on the dispatcher's own agent_id regardless of `agent:` would let a
            # freshly-named, zero-track-record worker inherit the dispatcher's own
            # earned acts-alone streak -- a privilege-escalation bug wearing a
            # convenience hat, not a neutral default. `owner` collapses to
            # agent_id exactly when `agent:` is absent, so this is a no-op for
            # every pre-5.2 cadence and every existing test.
            heartbeat_rel = hb.relative_to(repo_root).as_posix()
            decision = promotion.decide(
                cadence, repo_root,
                worker=owner, project=project, today=today,
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
                    # Phase R1.3 -- a cadence MAY carry dispatcher-authored
                    # `runtime:`/`model:` keys (the self-route / pre-set-card case);
                    # they flow onto the card as the highest-precedence routing
                    # input for resolve() below. Absent -> None (pure policy/
                    # override routing). new_card enum-validates `runtime`, so a
                    # bad value fails closed here at cadence granularity like any
                    # other ValidationError. HEARTBEAT.md is dispatcher-authored
                    # config (like `agent:`/`role:`), NOT untrusted card text.
                    runtime=cadence.get("runtime"), model=cadence.get("model"),
                )
            except cards.ValidationError as err:
                # Fail closed at CADENCE granularity (see the Task 4.2 comment
                # above): skip only this cadence, never the whole heartbeat.
                print(f"WARN: skipping cadence {project}/{cadence['name']}: {err}")
                continue
            # Phase R1.3 -- resolve routing for the WORK card at the claim anchor.
            # An unknown named model fails LOUD (wake + skip): never mis-driven,
            # never silently substituted.
            try:
                routed = routing.resolve(card.meta, role,
                                         cadence.get("risk-tier", "T1"),
                                         routing_policy, routing_override)
            except routing.RoutingError:
                _emit_unroutable_wake(repo_root, project, cadence)
                continue
            # Owner-by-runtime (no race: `owner` is single-valued, one runner
            # picks it up). An explicit cadence `agent:` still wins the OWNER, but
            # its registered runtime must agree with the resolved runtime (else
            # wake + skip rather than mis-own). With no `agent:`, claim as the
            # resolved runtime's default_worker; when the registry has no worker
            # for it (e.g. policy absent), fall back to the dispatcher (`owner`),
            # preserving every pre-R1 path.
            if "agent" in cadence:
                owner_runtime = routing.runtime_of_worker(routing_policy, owner)
                if owner_runtime is not None and owner_runtime != routed.runtime:
                    _emit_owner_runtime_mismatch_wake(
                        repo_root, project, cadence, owner,
                        routed.runtime, owner_runtime)
                    continue
                claim_owner = owner
            else:
                claim_owner = routing.default_worker_for(routing_policy, routed.runtime) or owner
            cards.claim(card, claim_owner)
            # Phase R1.3 -- stamp the resolved (runtime, model) onto the WORK card
            # only (never the inspect sibling: a future fresh session grades it).
            # Mirrors the stamp_session line below.
            cards.stamp_routing(card, routed.runtime, routed.model)
            # Task 7 -- which occurrence this card is, and when it was actually
            # cut. The two differ whenever the dispatcher ticks late.
            cards.stamp_schedule(card, scheduled_for, now.isoformat(timespec="seconds"))
            # D1.1: `session_id` is populated ONLY for the cloud self-executing
            # carve-out case (the dispatcher claiming a card for its OWN
            # already-running session, per the Task D1.1 scope note above the
            # module) -- stamp it onto the WORK card the dispatcher itself
            # claimed. The general worker case (D1.2) is stamped later, by the
            # worker runner, at transition-to-working, not here.
            if session_id:
                cards.stamp_session(card, session_id)
            emitted.append(cards.save(card, Path(repo_root) / "queue"))
            ledger.append(repo_root, "dispatch", agent_id,
                          {"date": today.isoformat(), "cadence": cadence["name"],
                           "project": project, "card": card.meta["id"],
                           # Task 7: the dedup key's third component -- the
                           # occurrence fired for (cron) or the day (legacy).
                           "scheduled_for": scheduled_for})

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
                    # Task 7: the sibling belongs to the SAME occurrence as the
                    # work card it grades (spec s5: every dispatched card records
                    # the stamps), unlike routing, which is deliberately not
                    # stamped here because a future fresh session grades it.
                    cards.stamp_schedule(sibling, scheduled_for,
                                         now.isoformat(timespec="seconds"))
                    # D1.1: the sibling's `session-id` stays null on purpose --
                    # it is graded in a DIFFERENT, future inspector session that
                    # does not exist yet at dispatch time (same reasoning as
                    # every worker card: the id is only known to whichever
                    # session eventually executes it). Only the work card the
                    # dispatcher claims for ITS OWN already-running
                    # self-execution gets stamped here.
                    emitted.append(cards.save(sibling, Path(repo_root) / "queue"))
    return emitted


class ScheduleDispatchError(RuntimeError):
    pass


def _occurrence_card_id(schedule_id: str, scheduled_for: str) -> str:
    digest = hashlib.sha256(
        f"schedule-card\0{schedule_id}\0{scheduled_for}".encode("utf-8")
    ).hexdigest()
    return f"{digest[:8]}-{digest[8:16]}"


def _claim_card(receipt: dict, schedule_id: str, scheduled_for: str) -> cards.Card:
    if (receipt.get("scheduleId") != schedule_id
            or receipt.get("scheduledFor") != scheduled_for
            or receipt.get("phase") not in ("claimed", "card-saved", "ledger-appended")):
        raise ScheduleDispatchError("schedule-claim-receipt-invalid")
    encoded = receipt.get("card")
    if not isinstance(encoded, dict) or not isinstance(encoded.get("meta"), dict) or not isinstance(encoded.get("body"), str):
        raise ScheduleDispatchError("schedule-claim-card-invalid")
    card = cards.Card(meta=dict(encoded["meta"]), body=encoded["body"])
    if card.meta.get("id") != _occurrence_card_id(schedule_id, scheduled_for):
        raise ScheduleDispatchError("schedule-card-id-conflict")
    payload = cards.render(card)
    if receipt.get("cardBytesSha256") != hashlib.sha256(payload).hexdigest():
        raise ScheduleDispatchError("schedule-card-digest-conflict")
    return card


def _schedule_ledger_row(schedule_id: str, scheduled_for: str,
                         card_id: str) -> dict:
    return {
        "date": datetime.date.today().isoformat(),
        "cadence": f"schedule:{schedule_id}",
        "project": "kb",
        "card": card_id,
        "schedule_id": schedule_id,
        "scheduled_for": scheduled_for,
    }


def _schedule_occurrence_ledger_rows(repo_root: Path, schedule_id: str,
                                     scheduled_for: str) -> list[dict]:
    """Find an occurrence across every dispatch shard so midnight replay is safe."""
    directory = Path(repo_root) / "ledgers" / "dispatch"
    if not directory.exists():
        return []
    matches = []
    for shard in sorted(directory.glob("*.tsv")):
        try:
            with shard.open(encoding="utf-8", newline="") as stream:
                for row in csv.DictReader(stream, delimiter="\t"):
                    if (row.get("schedule_id") == schedule_id
                            and row.get("scheduled_for") == scheduled_for):
                        matches.append(row)
        except (OSError, csv.Error) as error:
            raise ScheduleDispatchError("schedule-ledger-read-failed") from error
    return matches


def dispatch_claimed_occurrence(repo_root: Path, client, *, schedule_id: str,
                                scheduled_for: str, next_at: str,
                                expected_version: int, agent_id: str) -> dict:
    """Replay-safe claim → exact card → exact ledger state machine.

    ``client`` is the Unix client port. The daemon owns claim/phase CAS; this
    function owns filesystem/ledger effects and compares them byte-for-byte on
    every replay before advancing a receipt.
    """
    repo_root = Path(repo_root)
    claim_key = f"schedule-claim:{schedule_id}:{scheduled_for}"
    receipt = client.claim(schedule_id=schedule_id, scheduled_for=scheduled_for,
                           next_at=next_at, expected_version=expected_version,
                           idempotency_key=claim_key)
    card = _claim_card(receipt, schedule_id, scheduled_for)
    payload = cards.render(card)
    card_path = (repo_root / "queue" / cards.STATE_DIR[card.meta["state"]]
                 / f"{card.meta['id']}.md")

    if receipt["phase"] == "claimed":
        if card_path.exists():
            if card_path.read_bytes() != payload:
                raise ScheduleDispatchError("schedule-card-bytes-conflict")
        else:
            cards.save(card, repo_root / "queue")
        receipt = client.advance(
            schedule_id=schedule_id, scheduled_for=scheduled_for,
            next_at=next_at,
            phase="card-saved", idempotency_key=f"{claim_key}:card-saved",
        )
        _claim_card(receipt, schedule_id, scheduled_for)

    if receipt["phase"] == "card-saved":
        matches = _schedule_occurrence_ledger_rows(repo_root, schedule_id, scheduled_for)
        expected = _schedule_ledger_row(schedule_id, scheduled_for, card.meta["id"])
        if matches:
            stable = {key: value for key, value in expected.items() if key != "date"}
            if len(matches) != 1 or any(matches[0].get(key) != str(value)
                                        for key, value in stable.items()):
                raise ScheduleDispatchError("schedule-ledger-row-conflict")
        else:
            ledger.append(repo_root, "dispatch", agent_id, expected)
        receipt = client.advance(
            schedule_id=schedule_id, scheduled_for=scheduled_for,
            next_at=next_at,
            phase="ledger-appended", idempotency_key=f"{claim_key}:ledger-appended",
        )
        _claim_card(receipt, schedule_id, scheduled_for)

    return {
        "phase": receipt["phase"],
        "card_id": card.meta["id"],
        "card_bytes_sha256": hashlib.sha256(payload).hexdigest(),
    }


def dispatch_stored_schedules(repo_root: Path, client, agent_id: str,
                              now: datetime.datetime | None = None) -> list[dict]:
    """Fire due raw store rows through the claim protocol without a second clock.

    This is an unregistered W4 seam. W6 wires it after the live socket/store
    route exists; the existing HEARTBEAT caller remains untouched here.
    """
    now = now or datetime.datetime.now(OPERATOR_TIMEZONE)
    eastern = now.astimezone(OPERATOR_TIMEZONE) if now.tzinfo else now
    snapshot = client.snapshot()
    results = []
    for schedule in snapshot.get("schedules", []):
        if not isinstance(schedule, dict) or schedule.get("armed") is not True:
            continue
        cadence = schedule.get("cadence")
        source = cadence.get("source") if isinstance(cadence, dict) else None
        schedule_id = schedule.get("id")
        expected_version = schedule.get("version")
        if (not isinstance(source, str) or not isinstance(schedule_id, str)
                or isinstance(expected_version, bool) or not isinstance(expected_version, int)
                or expected_version < 1):
            raise ScheduleDispatchError("schedule-snapshot-invalid")
        spec = parse_cron(source)
        occurrence = latest_occurrence(spec, eastern) if spec else None
        if occurrence is None:
            continue
        next_fire = next_occurrence(spec, occurrence)
        if next_fire is None:
            raise ScheduleDispatchError("schedule-next-occurrence-unavailable")
        # The socket adapter binds nextAt during claim; the fake W4 port only
        # needs the immutable occurrence identity for crash-replay tests.
        results.append(dispatch_claimed_occurrence(
            repo_root, client, schedule_id=schedule_id,
            scheduled_for=occurrence.isoformat(), next_at=next_fire.isoformat(),
            expected_version=expected_version, agent_id=agent_id,
        ))
    return results


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
