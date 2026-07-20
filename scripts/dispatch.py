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
import routing

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
    """The card's `retry_count` frontmatter counter as an int (absent/garbage -> 0)."""
    try:
        return int(meta.get(RETRY_COUNT_FIELD) or 0)
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


def due(cadence: dict, today: datetime.date, repo_root: Path | None = None) -> bool:
    """True iff `cadence` is scheduled for `today`.

    `repo_root` is optional (default None) so every pre-D1.1 call site (two
    positional args, no repo awareness) keeps working unchanged. When
    supplied, a files-only `queue/paused/<cadence-name>` sentinel SUPPRESSES
    this cadence's beat -- and only this one; it can never trigger or widen a
    schedule, only skip it. Presence-only check: the marker's contents (if
    any) are never read/parsed.
    """
    if repo_root is not None:
        name = cadence.get("name")
        if name and (Path(repo_root) / "queue" / "paused" / name).exists():
            return False
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
        today: datetime.date | None = None, session_id: str | None = None) -> list[Path]:
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
            key = (project, cadence['name'])
            if cadence.get("tier") != tier or key in ran or not due(cadence, today, repo_root):
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
                    # D1.1: the sibling's `session-id` stays null on purpose --
                    # it is graded in a DIFFERENT, future inspector session that
                    # does not exist yet at dispatch time (same reasoning as
                    # every worker card: the id is only known to whichever
                    # session eventually executes it). Only the work card the
                    # dispatcher claims for ITS OWN already-running
                    # self-execution gets stamped here.
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
