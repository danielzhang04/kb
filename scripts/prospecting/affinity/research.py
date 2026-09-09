"""Bounded, resumable firm-bio research for affinity candidates."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
import hashlib
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import urljoin

from scripts.prospecting.executor import Executor
from scripts.prospecting.fetcher import FetchResponse
from scripts.prospecting.store import ExecRequest, insert_exec_request

from . import as_stamp
from .bio import (
    BioFacts, has_person_looking_block, parse_bio, persist_bio_facts, person_block,
    person_bio_url, team_index_url,
)
from .bio_adapter import _snapshot_dir, register_bio_adapter
from .linkedin import backfill_person, needs_linkedin, parse_profile_background
from .source_review import import_operator_page, read_operator_page
from scripts.prospecting.linkedin_lane import LinkedInAssistedLane, LinkedInBudget
from scripts.prospecting import browser_guard
from scripts.prospecting.browser_guard import next_delay
from scripts.prospecting.operator.vendors import attach_vendors


@dataclass(frozen=True)
class ResearchSummary:
    candidates: int
    bio_pages_fetched: int
    linkedin_loads_used: int
    researched: int
    unresearched: int
    skipped_untyped: int
    reason_codes: Mapping[str, int]
    bio_via_probe: int = 0
    retried: int = 0
    retry_exhausted: int = 0
    linkedin_operator_pages: int = 0
    linkedin_operator_empty: int = 0


_PERSON_ID_RE = re.compile(r"per_[0-9a-f]{16}\Z")
_COMPANY_ID_RE = re.compile(r"cmp_[0-9a-f]{16}\Z")
_TEAM_PROBE_PATHS = ("/team", "/people", "/our-team", "/about", "/about-us", "/who-we-are", "/team/")
_RETRYABLE_FETCH_REASONS = frozenset({"fetch_http_error", "fetch_transport_error", "adapter_error"})
_RETRYABLE_BIO_REASONS = frozenset({"bio_page_http_error", "bio_page_transport_error", "bio_page_adapter_error"})
_MAX_SNAPSHOT_ATTEMPTS = 3


def _request_id(campaign_id: str, entity_id: str, purpose: str) -> str:
    return "req_" + hashlib.sha256(f"p8-research|{campaign_id}|{entity_id}|{purpose}".encode()).hexdigest()[:16]


@dataclass(frozen=True)
class _QueuedSnapshot:
    request_id: str | None
    retried: bool = False
    retry_exhausted: bool = False


def _queue_snapshot(connection: sqlite3.Connection, campaign_id: str, policy_hash: str,
                    entity_id: str, purpose: str, stamp: str) -> _QueuedSnapshot:
    """Queue a content-addressed snapshot, minting up to two retries for transient failures."""
    attempt_ids = [_request_id(campaign_id, entity_id, purpose)] + [
        _request_id(campaign_id, entity_id, f"{purpose}#a{attempt}")
        for attempt in range(1, _MAX_SNAPSHOT_ATTEMPTS)
    ]
    for attempt, request_id in enumerate(attempt_ids):
        row = connection.execute(
            "SELECT state,reason FROM exec_request WHERE request_id=?", (request_id,)
        ).fetchone()
        if row is None:
            request = ExecRequest(
                request_id, "prospecting-list-builder", "fetch_snapshot",
                {"entity_id": entity_id, "snapshot_id": "obs_" + request_id.removeprefix("req_")},
                policy_hash, None, stamp,
            )
            insert_exec_request(connection, request, "T0")
            return _QueuedSnapshot(request_id, retried=attempt > 0)
        if row["state"] != "rejected" or row["reason"] not in _RETRYABLE_FETCH_REASONS:
            return _QueuedSnapshot(request_id, retried=attempt > 0)
    return _QueuedSnapshot(None, retry_exhausted=True)


def _drain(connection: sqlite3.Connection, executor: Executor, request_ids: set[str]) -> None:
    """Process only P8 requests explicitly queued by this invocation."""
    while connection.execute(
        "SELECT 1 FROM exec_request WHERE request_id IN (%s) AND state='queued'" % ",".join("?" * len(request_ids)),
        tuple(sorted(request_ids)),
    ).fetchone() is not None:
        next_request = connection.execute(
            "SELECT request_id FROM exec_request WHERE state='queued' ORDER BY created_at,request_id LIMIT 1"
        ).fetchone()
        if next_request is None or str(next_request["request_id"]) not in request_ids:
            raise ValueError("foreign_requests_queued")
        executor.process_one()


class _Clock:
    def __init__(self, now: datetime) -> None:
        self._now = now

    def now(self) -> datetime:
        return self._now


def _production_sleeper(seconds: int) -> None:
    time.sleep(seconds)


def _linkedin_lane(connection: sqlite3.Connection, clock: _Clock, *, sleeper=None) -> LinkedInAssistedLane:
    """Build the production lane with real 45--120 second pacing; tests inject a no-op."""
    return LinkedInAssistedLane(clock, connection, __import__("random").Random(), sleeper or _production_sleeper)


def _lane_profile_fetcher(lane: LinkedInAssistedLane):
    """Read profile text through the lane's dedicated persistent-browser primitive."""
    loaded = False

    def fetch(url: str) -> str:
        nonlocal loaded
        if loaded:
            lane.sleeper(next_delay(lane.rng))
        page = lane._open_page()
        try:
            page.goto(url)
            loaded = True
            return str(page.content())
        finally:
            browser_guard.close_persistent_page(page)

    return fetch


def _outcome(connection: sqlite3.Connection, request_id: str) -> tuple[str, str | None]:
    row = connection.execute("SELECT state,reason FROM exec_request WHERE request_id=?", (request_id,)).fetchone()
    return (str(row["state"]), None if row["reason"] is None else str(row["reason"]))


def _snapshot_text(connection: sqlite3.Connection, entity_id: str) -> tuple[str, str] | None:
    row = connection.execute(
        "SELECT source_url,body_ref FROM source_snapshot WHERE entity_id=? ORDER BY rowid DESC LIMIT 1", (entity_id,)
    ).fetchone()
    if row is None:
        return None
    path = _snapshot_dir(connection) / str(row["body_ref"])
    if not path.exists():
        return None
    return str(row["source_url"]), path.read_text(encoding="utf-8", errors="replace")


def _set_state(connection: sqlite3.Connection, person_id: str, campaign_id: str, *, bio_state: str,
               bio_pages: int, linkedin_state: str, linkedin_loads: int, reason: str | None, stamp: str) -> None:
    connection.execute(
        """INSERT INTO person_research_state(
            person_id,campaign_id,bio_state,bio_pages,linkedin_state,linkedin_loads,reason,updated_at
        ) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(person_id,campaign_id) DO UPDATE SET
            bio_state=excluded.bio_state,bio_pages=excluded.bio_pages,
            linkedin_state=excluded.linkedin_state,linkedin_loads=excluded.linkedin_loads,
            reason=excluded.reason,updated_at=excluded.updated_at""",
        (person_id, campaign_id, bio_state, bio_pages, linkedin_state, linkedin_loads, reason, stamp),
    )


def _failure_state(reason: str | None) -> tuple[str, str]:
    return {
        "fetch_domain_blocked": ("blocked", "bio_page_blocked"),
        "fetch_http_error": ("error", "bio_page_http_error"),
        "fetch_transport_error": ("error", "bio_page_transport_error"),
        "snapshot_entity_url_missing": ("absent", "no_domain"),
        "adapter_error": ("error", "bio_page_adapter_error"),
        "retry_exhausted": ("error", "retry_exhausted"),
    }.get(reason, ("error", "bio_page_http_error"))


def research_run(
    connection: sqlite3.Connection, campaign_id: str, *, anchors, max_bio_pages: int | None = None,
    max_linkedin: int = 0, now: datetime, executor_factory: Callable[[sqlite3.Connection], Executor],
    page_html: Callable[[str], str] | None = None, linkedin_sleeper: Callable[[int], None] | None = None,
    linkedin_pages_dir: Path | None = None,
) -> ResearchSummary:
    """Research un-fetched campaign candidates through the snapshot executor in bio-first order."""
    campaign = connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()
    if campaign is None:
        raise ValueError("unknown_campaign")
    if connection.execute("SELECT 1 FROM exec_request WHERE state='queued' LIMIT 1").fetchone() is not None:
        raise ValueError("foreign_requests_queued")
    stamp = as_stamp(now)
    rows = connection.execute(
        """SELECT employment.person_id,employment.company_id,person.full_name,person.linkedin_url,company.website_url,
                  state.bio_state,state.reason
           FROM employment JOIN person ON person.person_id=employment.person_id
           JOIN company ON company.company_id=employment.company_id
           JOIN fill_firm AS firm ON firm.company_id=company.company_id AND firm.campaign_id=?
           LEFT JOIN person_research_state AS state ON state.person_id=person.person_id AND state.campaign_id=?
           WHERE employment.valid_to IS NULL ORDER BY employment.company_id,employment.person_id""",
        (campaign_id, campaign_id),
    ).fetchall()
    skipped_untyped = 0
    pending = []
    for row in rows:
        person_id, company_id = str(row["person_id"]), str(row["company_id"])
        if _PERSON_ID_RE.fullmatch(person_id) is None or _COMPANY_ID_RE.fullmatch(company_id) is None:
            _set_state(connection, person_id, campaign_id, bio_state="error", bio_pages=0,
                       linkedin_state="disabled", linkedin_loads=0, reason="untyped_id", stamp=stamp)
            skipped_untyped += 1
        elif row["bio_state"] is None or row["bio_state"] == "pending":
            pending.append(row)
        elif row["bio_state"] == "error" and row["reason"] in _RETRYABLE_BIO_REASONS:
            pending.append(row)
        elif row["bio_state"] == "absent" and row["reason"] == "bio_page_absent":
            pending.append(row)
    for row in pending:
        if row["bio_state"] is None:
            _set_state(connection, str(row["person_id"]), campaign_id, bio_state="pending", bio_pages=0,
                       linkedin_state="pending", linkedin_loads=0, reason=None, stamp=stamp)
    connection.commit()
    cap = max_bio_pages if max_bio_pages is not None else 3 * len({row["company_id"] for row in pending})
    used_pages = 0
    linkedin_loads_used = 0
    bio_via_probe = 0
    retried = 0
    retry_exhausted = 0
    reasons: Counter[str] = Counter()
    executor = executor_factory(connection)
    # Match the P6 executor bootstrap before replacing only fetch_snapshot with P8's proxy.
    attach_vendors(executor, now=stamp)
    person_urls: dict[str, str] = {}
    transport = getattr(executor, "bio_transport", None)
    register_bio_adapter(executor, lambda person_id: person_urls.get(person_id), now=now, transport=transport)
    owned_requests: set[str] = set()
    budget: LinkedInBudget | None = None
    lane: LinkedInAssistedLane | None = None
    profile_fetcher = None
    if linkedin_pages_dir is None:
        clock = _Clock(now)
        budget = LinkedInBudget(connection, clock)
        budget.start_session()
        lane = _linkedin_lane(connection, clock, sleeper=linkedin_sleeper)
        profile_fetcher = page_html or _lane_profile_fetcher(lane)

    by_company: dict[str, list[sqlite3.Row]] = {}
    for row in pending:
        by_company.setdefault(str(row["company_id"]), []).append(row)
    for company_id, people in by_company.items():
        homepage = _snapshot_text(connection, company_id)
        if homepage is None and used_pages < cap:
            queued = _queue_snapshot(connection, campaign_id, str(campaign["policy_hash"]), company_id, "homepage", stamp)
            retried += int(queued.retried)
            if queued.retry_exhausted:
                for row in people:
                    _set_state(connection, str(row["person_id"]), campaign_id, bio_state="error", bio_pages=0,
                               linkedin_state="disabled", linkedin_loads=0, reason="retry_exhausted", stamp=stamp)
                    reasons["retry_exhausted"] += 1
                    retry_exhausted += 1
                connection.commit()
                continue
            assert queued.request_id is not None
            request_id = queued.request_id
            owned_requests.add(request_id)
            _drain(connection, executor, owned_requests)
            used_pages += 1
            state, reason = _outcome(connection, request_id)
            if state != "succeeded":
                bio_state, code = _failure_state(reason)
                for row in people:
                    _set_state(connection, str(row["person_id"]), campaign_id, bio_state=bio_state, bio_pages=0,
                               linkedin_state="disabled", linkedin_loads=0, reason=code, stamp=stamp)
                    reasons[code] += 1
                connection.commit()
                continue
            homepage = _snapshot_text(connection, company_id)
        if homepage is None:
            continue
        homepage_url, homepage_html = homepage
        team_url = team_index_url(homepage_html, homepage_url)
        team_html: str | None = None
        team_snapshot_id: str | None = None
        team_pages = 0
        via_probe: str | None = None
        team_failure: str | None = None
        fetch_person_id = str(people[0]["person_id"])

        def fetch_team(url: str, purpose: str) -> tuple[str, str] | None:
            nonlocal used_pages, team_pages, team_snapshot_id, team_failure, retried
            if used_pages >= cap:
                return None
            person_urls[fetch_person_id] = url
            queued = _queue_snapshot(
                connection, campaign_id, str(campaign["policy_hash"]), fetch_person_id, purpose, stamp,
            )
            retried += int(queued.retried)
            if queued.retry_exhausted:
                team_failure = "retry_exhausted"
                return None
            assert queued.request_id is not None
            request_id = queued.request_id
            owned_requests.add(request_id)
            _drain(connection, executor, owned_requests)
            used_pages += 1
            team_pages += 1
            state, failure_reason = _outcome(connection, request_id)
            if state != "succeeded":
                if purpose == "team":
                    team_failure = failure_reason
                return None
            snapshot = _snapshot_text(connection, fetch_person_id)
            if snapshot is None:
                return None
            row = connection.execute(
                "SELECT snapshot_id FROM source_snapshot WHERE entity_id=? ORDER BY rowid DESC LIMIT 1",
                (fetch_person_id,),
            ).fetchone()
            team_snapshot_id = None if row is None else str(row["snapshot_id"])
            return snapshot

        if team_url is not None:
            team = fetch_team(team_url, "team")
            if team is not None:
                team_url, team_html = team
        else:
            for path in _TEAM_PROBE_PATHS:
                candidate = urljoin(homepage_url, path)
                team = fetch_team(candidate, f"team-probe:{path}")
                if team is not None and has_person_looking_block(team[1]):
                    team_url, team_html, via_probe = team[0], team[1], path
                    break
        if team_failure is not None:
            bio_state, code = _failure_state(team_failure)
            for row in people:
                _set_state(connection, str(row["person_id"]), campaign_id, bio_state=bio_state, bio_pages=team_pages,
                           linkedin_state="disabled", linkedin_loads=0, reason=code, stamp=stamp)
                reasons[code] += 1
                retry_exhausted += int(code == "retry_exhausted")
            connection.commit()
            continue
        for row in people:
            person_id, full_name = str(row["person_id"]), str(row["full_name"])
            pages = team_pages
            facts: BioFacts | None = None
            snapshot_id = team_snapshot_id
            if team_html is not None and team_url is not None:
                person_url = person_bio_url(team_html, team_url, full_name)
                if person_url is not None:
                    if used_pages >= cap:
                        _set_state(connection, person_id, campaign_id, bio_state="pending", bio_pages=pages,
                                   linkedin_state="pending", linkedin_loads=0, reason="research_budget_exhausted", stamp=stamp)
                        reasons["research_budget_exhausted"] += 1
                        connection.commit()
                        continue
                    person_urls[person_id] = person_url
                    queued = _queue_snapshot(
                        connection, campaign_id, str(campaign["policy_hash"]), person_id, "bio", stamp,
                    )
                    retried += int(queued.retried)
                    if queued.retry_exhausted:
                        _set_state(connection, person_id, campaign_id, bio_state="error", bio_pages=pages,
                                   linkedin_state="disabled", linkedin_loads=0, reason="retry_exhausted", stamp=stamp)
                        reasons["retry_exhausted"] += 1
                        retry_exhausted += 1
                        connection.commit()
                        continue
                    assert queued.request_id is not None
                    request_id = queued.request_id
                    owned_requests.add(request_id)
                    _drain(connection, executor, owned_requests)
                    used_pages += 1
                    pages += 1
                    state, reason = _outcome(connection, request_id)
                    if state != "succeeded":
                        bio_state, code = _failure_state(reason)
                        _set_state(connection, person_id, campaign_id, bio_state=bio_state, bio_pages=pages,
                                   linkedin_state="disabled", linkedin_loads=0, reason=code, stamp=stamp)
                        reasons[code] += 1
                        connection.commit()
                        continue
                    bio = _snapshot_text(connection, person_id)
                    if bio is None:
                        _set_state(connection, person_id, campaign_id, bio_state="error", bio_pages=pages,
                                   linkedin_state="disabled", linkedin_loads=0, reason="bio_snapshot_missing", stamp=stamp)
                        reasons["bio_snapshot_missing"] += 1
                        connection.commit()
                        continue
                    facts = parse_bio(bio[1], person_url, anchors)
                    snapshot = connection.execute(
                        "SELECT snapshot_id FROM source_snapshot WHERE entity_id=? ORDER BY rowid DESC LIMIT 1", (person_id,)
                    ).fetchone()
                    snapshot_id = None if snapshot is None else str(snapshot["snapshot_id"])
                else:
                    block = person_block(team_html, full_name)
                    facts = parse_bio(block, team_url, anchors) if block else None
            else:
                block = person_block(homepage_html, full_name)
                facts = parse_bio(block or "", homepage_url, anchors) if block else None
                snapshot = connection.execute(
                    "SELECT snapshot_id FROM source_snapshot WHERE entity_id=? ORDER BY rowid DESC LIMIT 1", (company_id,)
                ).fetchone()
                snapshot_id = None if snapshot is None else str(snapshot["snapshot_id"])
            if facts is None:
                _set_state(connection, person_id, campaign_id, bio_state="absent", bio_pages=pages,
                           linkedin_state="disabled", linkedin_loads=0, reason="bio_page_absent", stamp=stamp)
                reasons["bio_page_absent"] += 1
            else:
                if snapshot_id is None:
                    _set_state(connection, person_id, campaign_id, bio_state="error", bio_pages=pages,
                               linkedin_state="disabled", linkedin_loads=0, reason="bio_snapshot_missing", stamp=stamp)
                    reasons["bio_snapshot_missing"] += 1
                    connection.commit()
                    continue
                persist_bio_facts(connection, person_id, snapshot_id, facts, stamp)
                linkedin_loads = 0
                if needs_linkedin(facts):
                    if linkedin_pages_dir is not None:
                        # Operator-supplied pages are consumed independently in the dedicated
                        # pass below, after every bio-pass candidate has been considered.
                        linkedin_state, reason = "disabled", "linkedin_disabled"
                    else:
                        profile_url = str(row["linkedin_url"] or "")
                        if max_linkedin > 0 and profile_url:
                            # reserve_navigation starts its own immediate transaction.
                            connection.commit()
                            assert lane is not None and budget is not None and profile_fetcher is not None
                            outcome = backfill_person(
                                lane, budget, person_id, profile_url, profile_fetcher, anchors, max_linkedin, linkedin_loads_used,
                            )
                            linkedin_state, reason = outcome.linkedin_state, outcome.reason
                            linkedin_loads = outcome.loads_used
                            linkedin_loads_used += outcome.loads_used
                        else:
                            linkedin_state, reason = "disabled", "linkedin_disabled"
                else:
                    linkedin_state, reason = ("not_needed", "linkedin_not_needed")
                final_reason = f"bio_page_via:{via_probe}" if via_probe else reason
                _set_state(connection, person_id, campaign_id, bio_state="fetched", bio_pages=pages,
                           linkedin_state=linkedin_state, linkedin_loads=linkedin_loads,
                           reason=final_reason, stamp=stamp)
                reasons[final_reason] += 1
                bio_via_probe += int(via_probe is not None)
            connection.commit()
    linkedin_operator_pages = 0
    linkedin_operator_empty = 0
    if linkedin_pages_dir is not None:
        seen_people: set[str] = set()
        for row in rows:
            person_id, company_id = str(row["person_id"]), str(row["company_id"])
            if person_id in seen_people:
                continue
            seen_people.add(person_id)
            if _PERSON_ID_RE.fullmatch(person_id) is None or _COMPANY_ID_RE.fullmatch(company_id) is None:
                continue
            supplied_body = read_operator_page(linkedin_pages_dir, person_id)
            if supplied_body is None:
                continue
            state_row = connection.execute(
                "SELECT bio_state,bio_pages,linkedin_state,linkedin_loads FROM person_research_state "
                "WHERE person_id=? AND campaign_id=?",
                (person_id, campaign_id),
            ).fetchone()
            if state_row is not None and str(state_row["linkedin_state"]) == "loaded":
                continue
            bio_state = str(state_row["bio_state"]) if state_row is not None else "pending"
            bio_pages = int(state_row["bio_pages"]) if state_row is not None else 0
            prior_loads = int(state_row["linkedin_loads"]) if state_row is not None else 0
            if linkedin_loads_used >= max_linkedin:
                _set_state(connection, person_id, campaign_id, bio_state=bio_state, bio_pages=bio_pages,
                           linkedin_state="cap_reached", linkedin_loads=prior_loads,
                           reason="linkedin_cap_reached", stamp=stamp)
                reasons["linkedin_cap_reached"] += 1
                connection.commit()
                continue
            supplied_text = supplied_body.decode("utf-8", errors="replace")
            supplied_facts = parse_profile_background(supplied_text, anchors)
            snapshot_id = import_operator_page(
                connection, person_id=person_id, company_id=company_id,
                source_url=str(row["linkedin_url"] or ""), body=supplied_body, now=now,
            )
            persist_bio_facts(connection, person_id, snapshot_id, supplied_facts, stamp)
            _set_state(connection, person_id, campaign_id, bio_state=bio_state, bio_pages=bio_pages,
                       linkedin_state="loaded", linkedin_loads=prior_loads + 1,
                       reason="linkedin_operator_supplied", stamp=stamp)
            reasons["linkedin_operator_supplied"] += 1
            connection.commit()
            linkedin_loads_used += 1
            linkedin_operator_pages += 1
            if not supplied_facts.education and not supplied_facts.employers:
                linkedin_operator_empty += 1
    current = connection.execute(
        "SELECT bio_state,reason FROM person_research_state WHERE campaign_id=?", (campaign_id,)
    ).fetchall()
    for row in current:
        if row["reason"]:
            reasons[str(row["reason"])] += 0
    researched = sum(row["bio_state"] == "fetched" for row in current)
    return ResearchSummary(
        len(rows), used_pages, linkedin_loads_used, researched, len(rows) - researched,
        skipped_untyped, dict(sorted(reasons.items())), bio_via_probe, retried, retry_exhausted,
        linkedin_operator_pages, linkedin_operator_empty,
    )
