"""P6 email-driven campaign selection and firm enrichment.

The functions in this module only work with desktop-local SQLite rows.  The CLI
supplies the executor callback; tests inject deterministic callbacks instead.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import re
import sqlite3
from typing import Any

from scripts.prospecting.discovery.snov_domain import (
    FILL_MAX_PAGES_PER_FIRM, SnovBudgetRefused, _has_excluded_title_function,
    domain_map_path, load_company_domains, persist_company_domain, queue_finder_page,
)
from scripts.prospecting.providers.base import queue_vendor_lookup
from scripts.prospecting.store import ExecRequest, insert_exec_request, validate_exec_request


VERIFIED_STATES = frozenset({"valid"})


@dataclass(frozen=True)
class FillSummary:
    firms_met: int
    firms_short: int
    firms_substituted: int
    people_delivered: int
    searches_run: int
    credits: int
    firms_discovered: int
    candidates_found: int
    shortfall_reason: str | None
    firms_partial: int
    firms_refused: int
    domains_backfilled: int
    profiles_skipped_untyped: int

    def counts(self) -> dict[str, int | str]:
        return {
            "firms_met": self.firms_met, "firms_short": self.firms_short,
            "firms_substituted": self.firms_substituted,
            "people_delivered": self.people_delivered, "searches_run": self.searches_run,
            "credits": self.credits, "firms_discovered": self.firms_discovered,
            "candidates_found": self.candidates_found,
            "shortfall_reason": self.shortfall_reason or "none",
            "firms_partial": self.firms_partial,
            "firms_refused": self.firms_refused,
            "domains_backfilled": self.domains_backfilled,
            "profiles_skipped_untyped": self.profiles_skipped_untyped,
        }


@dataclass(frozen=True)
class _DiscoveryQueueOutcome:
    queued: bool
    refusal_reason: str | None = None


class _SnovReservation:
    provider = "snov"

    def max_cost(self, operation: str) -> int:
        if operation != "find":
            raise ValueError("unsupported_vendor_operation")
        return 1


def seniority_class(title: str) -> str:
    value = title.casefold()
    for token, label in (("chief", "executive"), ("founder", "executive"), ("partner", "executive"),
                         ("vice president", "vp"), (" vp", "vp"), ("director", "director"),
                         ("head", "head"), ("manager", "manager"), ("senior", "senior")):
        if token in value:
            return label
    return "individual"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _request_id(campaign_id: str, person_id: str) -> str:
    return "req_" + hashlib.sha256(f"fill|{campaign_id}|{person_id}|snov".encode()).hexdigest()[:16]


def _candidate_rows(connection: sqlite3.Connection, company_id: str, maximum: int) -> list[sqlite3.Row]:
    return list(connection.execute(
        """SELECT p.person_id,e.title,sp.source_page FROM employment AS e
           JOIN person AS p ON p.person_id=e.person_id
           LEFT JOIN snov_prospect AS sp ON sp.person_id=p.person_id
           WHERE e.company_id=? AND e.valid_to IS NULL
           ORDER BY CASE
             WHEN lower(e.title) LIKE '%chief%' OR lower(e.title) LIKE '%founder%' THEN 0
             WHEN lower(e.title) LIKE '%vice president%' OR lower(e.title) LIKE '% vp%' THEN 1
             WHEN lower(e.title) LIKE '%director%' THEN 2 WHEN lower(e.title) LIKE '%head%' THEN 3
             WHEN lower(e.title) LIKE '%manager%' THEN 4 WHEN lower(e.title) LIKE '%senior%' THEN 5 ELSE 6 END,
             p.person_id LIMIT ?""", (company_id, maximum),
    ))


def _has_confident_contact(connection: sqlite3.Connection, person_id: str, min_confidence: float) -> bool:
    return connection.execute(
        "SELECT 1 FROM contact_point WHERE person_id=? AND state IN ('valid') AND confidence>=? LIMIT 1",
        (person_id, min_confidence),
    ).fetchone() is not None


def _queue_email(
    connection: sqlite3.Connection, campaign_id: str, policy_hash: str, person_id: str, at: str,
    queue_email: Callable[[str, str, str, str], None] | None,
) -> bool:
    request_id = _request_id(campaign_id, person_id)
    if connection.execute("SELECT 1 FROM exec_request WHERE request_id=?", (request_id,)).fetchone() is not None:
        return False
    if queue_email is not None:
        queue_email(campaign_id, person_id, policy_hash, request_id)
    else:
        queue_vendor_lookup(
            connection, campaign_id=campaign_id, person_id=person_id, provider="snov", vendor_operation="find",
            payload={}, policy_hash=policy_hash, request_id=request_id, adapter=_SnovReservation(), now=at,
        )
    return True


def _fill_run_id(campaign_id: str, company_id: str) -> str:
    return "camp_" + hashlib.sha256(f"fill-discovery|{campaign_id}|{company_id}".encode()).hexdigest()[:16]


def _queue_discovery(
    connection: sqlite3.Connection, campaign_id: str, company_id: str, policy_hash: str,
    maximum: int, min_confidence: float, at: str, max_pages_per_firm: int,
) -> _DiscoveryQueueOutcome:
    """Queue exactly the next fill-owned domain page when title matches are spent."""
    if max_pages_per_firm < 1:
        raise ValueError("invalid_fill_page_limit")
    row = connection.execute(
        "SELECT finder_run_id,next_page,exhausted FROM fill_discovery WHERE campaign_id=? AND company_id=?",
        (campaign_id, company_id),
    ).fetchone()
    if row is None:
        run_id = _fill_run_id(campaign_id, company_id)
        connection.execute(
            """INSERT OR IGNORE INTO finder_run(
                   finder_run_id,campaign_id,policy_hash,requested_companies,requested_people,
                   state,started_at,updated_at
               ) VALUES(?,?,?,?,?,'running',?,?)""",
            (run_id, campaign_id, policy_hash, 1, maximum, at, at),
        )
        connection.execute(
            """INSERT INTO fill_discovery(
                   campaign_id,company_id,finder_run_id,max_candidates,next_page,exhausted,updated_at
               ) VALUES(?,?,?,?,?,?,?)""",
            (campaign_id, company_id, run_id, maximum, 1, 0, at),
        )
        page = 1
    else:
        run_id, page = str(row["finder_run_id"]), row["next_page"]
        if bool(row["exhausted"]) or page is None:
            return _DiscoveryQueueOutcome(False)
        candidates = _candidate_rows(connection, company_id, maximum)
        if len(candidates) >= maximum:
            return _DiscoveryQueueOutcome(False)
    pages_used = int(connection.execute(
        "SELECT count(*) FROM snov_domain_page WHERE finder_run_id=?", (run_id,)
    ).fetchone()[0])
    if pages_used >= max_pages_per_firm:
        connection.execute(
            "UPDATE fill_discovery SET next_page=NULL,exhausted=1,updated_at=? WHERE campaign_id=? AND company_id=?",
            (at, campaign_id, company_id),
        )
        return _DiscoveryQueueOutcome(False)
    try:
        request_id = queue_finder_page(
            connection, campaign_id=campaign_id, finder_run_id=run_id, policy_hash=policy_hash,
            company_id=company_id, page=int(page), at=at, max_pages=max_pages_per_firm,
        )
    except SnovBudgetRefused as error:
        connection.execute(
            "UPDATE fill_discovery SET updated_at=? WHERE campaign_id=? AND company_id=?",
            (at, campaign_id, company_id),
        )
        return _DiscoveryQueueOutcome(False, str(error))
    except OSError:
        connection.execute(
            "UPDATE fill_discovery SET updated_at=? WHERE campaign_id=? AND company_id=?",
            (at, campaign_id, company_id),
        )
        return _DiscoveryQueueOutcome(False, "vendor_error")
    return _DiscoveryQueueOutcome(request_id is not None)


def queue_firm_profiles(
    connection: sqlite3.Connection, campaign_id: str, policy_hash: str, at: str,
    min_confidence: float = 0.7,
) -> tuple[int, int]:
    """Queue snapshot requests and count firms with IDs P1 cannot execute."""
    queued = skipped_untyped = 0
    rows = connection.execute(
        """SELECT DISTINCT firm.company_id FROM fill_firm AS firm
           WHERE firm.campaign_id=? AND firm.status IN ('met','short')
             AND EXISTS (SELECT 1 FROM company WHERE company_id=firm.company_id AND trim(COALESCE(website_url,'')) != '')
             AND EXISTS (SELECT 1 FROM fill_person AS person JOIN contact_point AS contact ON contact.person_id=person.person_id
                         WHERE person.campaign_id=firm.campaign_id AND person.company_id=firm.company_id
                           AND person.substituted=0 AND contact.state='valid' AND contact.confidence>=?)""",
        (campaign_id, min_confidence),
    )
    for row in rows:
        company_id = str(row["company_id"])
        if re.fullmatch(r"cmp_[0-9a-f]{16}", company_id) is None:
            skipped_untyped += 1
            continue
        snapshot_id = "obs_" + hashlib.sha256(f"fill-profile|{campaign_id}|{company_id}".encode()).hexdigest()[:16]
        request_id = "req_" + hashlib.sha256(f"fill-snapshot|{campaign_id}|{company_id}".encode()).hexdigest()[:16]
        if connection.execute("SELECT 1 FROM exec_request WHERE request_id=?", (request_id,)).fetchone() is not None:
            continue
        request = ExecRequest(request_id, "prospecting-list-builder", "fetch_snapshot", {"entity_id": company_id, "snapshot_id": snapshot_id}, policy_hash, None, at)
        validate_exec_request(request, "T0", connection)
        insert_exec_request(connection, request, "T0")
        queued += 1
    return queued, skipped_untyped


def backfill_company_domains(connection: sqlite3.Connection, company_ids: Iterable[str]) -> int:
    """Fill missing homepages from the same local domain map used by discovery."""
    domains = load_company_domains(domain_map_path())
    updated = 0
    for company_id in dict.fromkeys(company_ids):
        company = connection.execute(
            "SELECT name FROM company WHERE company_id=?", (company_id,)
        ).fetchone()
        if company is not None:
            domain = domains.get(" ".join(str(company["name"]).casefold().split()))
            if domain is not None:
                updated += int(persist_company_domain(connection, company_id, domain))
    return updated


def _finished_without_contact(connection: sqlite3.Connection, campaign_id: str, person_id: str, min_confidence: float) -> bool:
    row = connection.execute("SELECT state FROM exec_request WHERE request_id=?", (_request_id(campaign_id, person_id),)).fetchone()
    return row is not None and row["state"] in {"succeeded", "rejected"} and not _has_confident_contact(connection, person_id, min_confidence)


def _mark_person(connection: sqlite3.Connection, campaign_id: str, company_id: str, person_id: str, title: str, source_page: str | None, substituted: bool, at: str) -> None:
    connection.execute(
        """INSERT INTO fill_person(campaign_id,person_id,company_id,substituted,updated_at) VALUES(?,?,?,?,?)
           ON CONFLICT(campaign_id,person_id) DO UPDATE SET company_id=excluded.company_id,
           substituted=excluded.substituted,updated_at=excluded.updated_at""",
        (campaign_id, person_id, company_id, int(substituted), at),
    )
    connection.execute(
        """INSERT INTO person_profile(person_id,seniority_class,source_page) VALUES(?,?,?)
           ON CONFLICT(person_id) DO UPDATE SET seniority_class=excluded.seniority_class,
           source_page=COALESCE(excluded.source_page,person_profile.source_page)""",
        (person_id, seniority_class(title), source_page),
    )


def _substitute_excluded_people(connection: sqlite3.Connection, campaign_id: str, exclusions: Iterable[str], at: str) -> None:
    rows = connection.execute(
        """SELECT selected.person_id,employment.title FROM fill_person AS selected
           JOIN employment ON employment.person_id=selected.person_id AND employment.company_id=selected.company_id
             AND employment.valid_to IS NULL WHERE selected.campaign_id=? AND selected.substituted=0""",
        (campaign_id,),
    ).fetchall()
    exclusions = tuple(exclusions)
    for row in rows:
        if _has_excluded_title_function(str(row["title"]), exclusions):
            connection.execute(
                "UPDATE fill_person SET substituted=1,updated_at=? WHERE campaign_id=? AND person_id=?",
                (at, campaign_id, str(row["person_id"])),
            )
def fill_campaign(
    connection: sqlite3.Connection, campaign_id: str, *, target_per_firm: int = 2,
    max_candidates_per_firm: int = 6, min_confidence: float = 0.7, max_rounds: int = 3,
    max_pages_per_firm: int = FILL_MAX_PAGES_PER_FIRM,
    reserve_company_ids: Iterable[str] = (), at: str | None = None,
    execute: Callable[[], None] | None = None,
    queue_email: Callable[[str, str, str, str], None] | None = None,
) -> FillSummary:
    """Select only confident contacts, retaining failed candidates as substitutions.

    ``execute`` drains the attached desktop executor after a bounded batch; it is
    intentionally optional for deterministic, no-network tests.
    """
    if target_per_firm < 1 or max_candidates_per_firm < target_per_firm or not 0 <= min_confidence <= 1 or max_rounds < 1 or max_pages_per_firm < 1:
        raise ValueError("invalid_fill_limits")
    stamp = at or _now()
    campaign = connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()
    if campaign is None:
        raise ValueError("unknown_campaign")
    policy_hash = str(campaign["policy_hash"])
    from .vendors import title_function_exclusions
    exclusions = title_function_exclusions(connection)
    _substitute_excluded_people(connection, campaign_id, exclusions, stamp)
    firms = [str(row[0]) for row in connection.execute("SELECT company_id FROM company ORDER BY company_id")]
    firms.extend(company_id for company_id in reserve_company_ids if company_id not in firms)
    domains_backfilled = backfill_company_domains(connection, firms)
    searches = 0
    for company_id in firms:
        discovery_refusal: str | None = None
        connection.execute(
            """INSERT INTO fill_firm(campaign_id,company_id,target_per_firm,max_candidates,status,shortfall_reason,updated_at)
               VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_id,company_id) DO UPDATE SET
                 target_per_firm=excluded.target_per_firm,max_candidates=excluded.max_candidates,
                 updated_at=excluded.updated_at""",
            (campaign_id, company_id, target_per_firm, max_candidates_per_firm, "selected", None, stamp),
        )
        for _round in range(max_rounds):
            candidates = [row for row in _candidate_rows(connection, company_id, max_candidates_per_firm)
                          if not _has_excluded_title_function(str(row["title"]), exclusions)]
            delivered = sum(_has_confident_contact(connection, str(row["person_id"]), min_confidence) for row in candidates)
            if delivered >= target_per_firm:
                break
            pending = any(
                (request := connection.execute(
                    "SELECT state FROM exec_request WHERE request_id=?", (_request_id(campaign_id, str(row["person_id"])),)
                ).fetchone()) is not None and request["state"] in {"queued", "claimed", "uncertain"}
                for row in candidates
            )
            if pending and execute is not None:
                connection.commit()
                execute()
                continue
            if len(candidates) < max_candidates_per_firm:
                discovery_outcome = _queue_discovery(
                    connection, campaign_id, company_id, policy_hash, max_candidates_per_firm, min_confidence, stamp,
                    max_pages_per_firm,
                )
                if discovery_outcome.refusal_reason is not None:
                    discovery_refusal = discovery_outcome.refusal_reason
                    break
                if discovery_outcome.queued:
                    if execute is not None:
                        connection.commit()
                        execute()
                    continue
            queued = 0
            for row in candidates:
                person_id = str(row["person_id"])
                if _has_confident_contact(connection, person_id, min_confidence) or _finished_without_contact(connection, campaign_id, person_id, min_confidence):
                    continue
                queued += int(_queue_email(connection, campaign_id, policy_hash, person_id, stamp, queue_email))
            searches += queued
            if queued and execute is not None:
                connection.commit()
                execute()
            elif not queued:
                break
        candidates = [row for row in _candidate_rows(connection, company_id, max_candidates_per_firm)
                      if not _has_excluded_title_function(str(row["title"]), exclusions)]
        delivered = 0
        substituted = 0
        for row in candidates:
            person_id = str(row["person_id"])
            confident = _has_confident_contact(connection, person_id, min_confidence)
            failed = _finished_without_contact(connection, campaign_id, person_id, min_confidence)
            _mark_person(connection, campaign_id, company_id, person_id, str(row["title"]), row["source_page"], failed, stamp)
            delivered += int(confident)
            substituted += int(failed)
        discovery = connection.execute(
            """SELECT discovery.exhausted, count(page.request_id) AS pages_used
               FROM fill_discovery AS discovery
               LEFT JOIN snov_domain_page AS page ON page.finder_run_id=discovery.finder_run_id
               WHERE discovery.campaign_id=? AND discovery.company_id=?
               GROUP BY discovery.finder_run_id""", (campaign_id, company_id)
        ).fetchone()
        exhausted = discovery is not None and (
            bool(discovery["exhausted"]) or int(discovery["pages_used"]) >= max_pages_per_firm
        )
        if exhausted and discovery is not None and not bool(discovery["exhausted"]):
            connection.execute(
                "UPDATE fill_discovery SET next_page=NULL,exhausted=1,updated_at=? WHERE campaign_id=? AND company_id=?",
                (stamp, campaign_id, company_id),
            )
        pending_discovery = connection.execute(
            """SELECT 1 FROM fill_discovery AS discovery
               JOIN snov_domain_page AS page ON page.finder_run_id=discovery.finder_run_id
               JOIN exec_request AS request ON request.request_id=page.request_id
               WHERE discovery.campaign_id=? AND discovery.company_id=?
                 AND request.state IN ('queued','claimed','uncertain') LIMIT 1""",
            (campaign_id, company_id),
        ).fetchone() is not None
        pending_email = any(
            (request := connection.execute(
                "SELECT state FROM exec_request WHERE request_id=?", (_request_id(campaign_id, str(row["person_id"])),)
            ).fetchone()) is not None and request["state"] in {"queued", "claimed", "uncertain"}
            for row in candidates
        )
        candidates_finished = bool(candidates) and all(
            _has_confident_contact(connection, str(row["person_id"]), min_confidence)
            or _finished_without_contact(connection, campaign_id, str(row["person_id"]), min_confidence)
            for row in candidates
        )
        discovered_to_limit = len(candidates) >= max_candidates_per_firm
        if delivered >= target_per_firm:
            status, reason = "met", None
        elif discovery_refusal is not None:
            status, reason = "short", discovery_refusal
        elif exhausted and not candidates:
            status, reason = "short", "no_candidates"
        elif delivered == 0 and discovered_to_limit and candidates_finished:
            status, reason = "no_confident_email", "no_confident_email"
        elif exhausted and candidates_finished:
            status, reason = ("short", "candidate_exhausted") if delivered else ("no_confident_email", "no_confident_email")
        elif pending_discovery or pending_email:
            status, reason = "short", "discovery_pending"
        else:
            status, reason = "short", "candidate_exhausted"
        connection.execute("UPDATE fill_firm SET status=?,shortfall_reason=?,updated_at=? WHERE campaign_id=? AND company_id=?", (status, reason, stamp, campaign_id, company_id))
        connection.commit()
    values = connection.execute(
        """SELECT SUM(status='met'),SUM(status IN ('short','no_confident_email')),
                  SUM(status='no_confident_email')
           FROM fill_firm WHERE campaign_id=?""", (campaign_id,)).fetchone()
    reason = connection.execute(
        """SELECT shortfall_reason FROM fill_firm
           WHERE campaign_id=? AND shortfall_reason IS NOT NULL
           GROUP BY shortfall_reason ORDER BY count(*) DESC, shortfall_reason ASC LIMIT 1""",
        (campaign_id,),
    ).fetchone()
    refused = connection.execute(
        """SELECT count(*) FROM fill_firm WHERE campaign_id=?
           AND shortfall_reason IN ('credit_budget','snov_account_credit_ceiling','max_pages','vendor_error')""",
        (campaign_id,),
    ).fetchone()[0]
    _profiles, profiles_skipped_untyped = queue_firm_profiles(connection, campaign_id, policy_hash, stamp, min_confidence)
    people = connection.execute(
        """SELECT count(DISTINCT selected.person_id) FROM fill_person AS selected
           JOIN contact_point AS cp ON cp.person_id=selected.person_id
             AND cp.state='valid' AND cp.confidence>=?
           WHERE selected.campaign_id=? AND selected.substituted=0""",
        (min_confidence, campaign_id),
    ).fetchone()[0]
    credits = connection.execute(
        "SELECT COALESCE(SUM(actual_cost),0) FROM credit_reservation WHERE campaign_id=?",
        (campaign_id,),
    ).fetchone()[0]
    discovered = connection.execute(
        """SELECT count(DISTINCT discovery.company_id) FROM fill_discovery AS discovery
           JOIN snov_domain_page AS page ON page.finder_run_id=discovery.finder_run_id
           JOIN exec_request AS request ON request.request_id=page.request_id
           WHERE discovery.campaign_id=? AND request.state='succeeded'""", (campaign_id,)
    ).fetchone()[0]
    candidates_found = connection.execute(
        """SELECT count(*) FROM snov_prospect AS prospect
           JOIN fill_discovery AS discovery ON discovery.company_id=prospect.company_id
           WHERE discovery.campaign_id=?""", (campaign_id,)
    ).fetchone()[0]
    partial = connection.execute(
        """SELECT count(DISTINCT firm.company_id) FROM fill_firm AS firm
           JOIN fill_person AS selected ON selected.campaign_id=firm.campaign_id
             AND selected.company_id=firm.company_id AND selected.substituted=0
           JOIN contact_point AS cp ON cp.person_id=selected.person_id
             AND cp.state='valid' AND cp.confidence>=?
           WHERE firm.campaign_id=? AND firm.status='short'""",
        (min_confidence, campaign_id),
    ).fetchone()[0]
    return FillSummary(
        int(values[0] or 0), int(values[1] or 0), int(values[2] or 0), int(people),
        searches, int(credits or 0), int(discovered or 0), int(candidates_found or 0),
        str(reason[0]) if reason is not None else None, int(partial or 0), int(refused or 0), domains_backfilled,
        profiles_skipped_untyped,
    )


def extract_blurb(body: bytes) -> str:
    """Extract inert metadata/title text without interpreting page content."""
    text = body.decode("utf-8", "replace")
    match = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', text, re.I)
    if not match:
        match = re.search(r'<title[^>]*>(.*?)</title>', text, re.I | re.S)
    return re.sub(r"\s+", " ", match.group(1) if match else "").strip()[:160]


def persist_company_profile(connection: sqlite3.Connection, company_id: str, website: str, body: bytes, fetched_at: str) -> None:
    connection.execute(
        """INSERT INTO company_profile(company_id,website,blurb,fetched_at) VALUES(?,?,?,?)
           ON CONFLICT(company_id) DO UPDATE SET website=excluded.website,blurb=excluded.blurb,fetched_at=excluded.fetched_at""",
        (company_id, website, extract_blurb(body), fetched_at),
    )
