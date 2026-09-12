"""Fit-first composition of the frozen P6 firm-fill primitives."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
import json
import re
import sqlite3

from scripts.prospecting.executor import Executor
from scripts.prospecting.operator.fill import (
    FillSummary,
    _candidate_rows,
    _finished_without_contact,
    _has_confident_contact,
    _mark_person,
    _queue_discovery,
    _queue_email,
    _request_id,
    backfill_company_domains,
    queue_firm_profiles,
    seniority_class,
)

from . import as_datetime
from . import evidence_bridge
from .research import research_run
from .score import Affinity, Signal, score_campaign


@dataclass(frozen=True)
class FitFillSummary:
    """P6 counts plus the research and fit-selection counts added by P8."""

    base: FillSummary
    candidates_researched: int
    candidates_unresearched: int
    bio_pages_fetched: int
    linkedin_loads_used: int
    candidates_scored: int
    candidates_above_fit: int
    firms_no_fit: int
    searches_skipped_low_fit: int
    skipped_untyped: int
    evidence_minted: int = 0
    evidence_unresolved: int = 0

    def counts(self) -> dict[str, int | str]:
        return {
            **self.base.counts(),
            "candidates_researched": self.candidates_researched,
            "candidates_unresearched": self.candidates_unresearched,
            "bio_pages_fetched": self.bio_pages_fetched,
            "linkedin_loads_used": self.linkedin_loads_used,
            "candidates_scored": self.candidates_scored,
            "candidates_above_fit": self.candidates_above_fit,
            "firms_no_fit": self.firms_no_fit,
            "searches_skipped_low_fit": self.searches_skipped_low_fit,
            "skipped_untyped": self.skipped_untyped,
            "evidence_minted": self.evidence_minted,
            "evidence_unresolved": self.evidence_unresolved,
        }


_PERSON_ID_RE = re.compile(r"per_[0-9a-f]{16}\Z")


def _stamp(connection: sqlite3.Connection, at: str | None) -> str:
    if at is not None:
        return at
    return str(connection.execute("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')").fetchone()[0])


def _validate_limits(target_per_firm: int, slack: int, min_fit: int,
                     max_candidates_per_firm: int, min_confidence: float,
                     max_pages_per_firm: int, max_bio_pages: int | None,
                     max_linkedin: int) -> None:
    if (
        target_per_firm < 1
        or slack < 0
        or not 0 <= min_fit <= 100
        or max_candidates_per_firm < target_per_firm
        or not 0 <= min_confidence <= 1
        or max_pages_per_firm < 1
        or max_bio_pages is not None and max_bio_pages < 0
        or max_linkedin < 0
    ):
        raise ValueError("invalid_fill_limits")


def _firms(connection: sqlite3.Connection, reserve_company_ids: Iterable[str]) -> list[str]:
    firms = [str(row[0]) for row in connection.execute("SELECT company_id FROM company ORDER BY company_id")]
    firms.extend(company_id for company_id in reserve_company_ids if company_id not in firms)
    return firms


def _set_firm(connection: sqlite3.Connection, campaign_id: str, company_id: str,
              target_per_firm: int, maximum: int, stamp: str) -> None:
    connection.execute(
        """INSERT INTO fill_firm(campaign_id,company_id,target_per_firm,max_candidates,status,shortfall_reason,updated_at)
           VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_id,company_id) DO UPDATE SET
             target_per_firm=excluded.target_per_firm,max_candidates=excluded.max_candidates,
             updated_at=excluded.updated_at""",
        (campaign_id, company_id, target_per_firm, maximum, "selected", None, stamp),
    )


def _discover(connection: sqlite3.Connection, campaign_id: str, firms: Iterable[str], policy_hash: str,
              maximum: int, min_confidence: float, stamp: str, max_pages_per_firm: int,
              execute: Callable[[], None] | None) -> dict[str, str | None]:
    refusals: dict[str, str | None] = {}
    for company_id in firms:
        while len(_candidate_rows(connection, company_id, maximum)) < maximum:
            outcome = _queue_discovery(
                connection, campaign_id, company_id, policy_hash, maximum, min_confidence, stamp,
                max_pages_per_firm,
            )
            if outcome.refusal_reason is not None:
                refusals[company_id] = outcome.refusal_reason
                break
            if not outcome.queued:
                break
            if execute is None:
                break
            connection.commit()
            execute()
    return refusals


def _mark_candidates(connection: sqlite3.Connection, campaign_id: str, firms: Iterable[str],
                     maximum: int, min_confidence: float, stamp: str) -> None:
    """Make discovered candidates visible to P8 scoring before any email is queued."""
    for company_id in firms:
        for row in _candidate_rows(connection, company_id, maximum):
            person_id = str(row["person_id"])
            _mark_person(
                connection, campaign_id, company_id, person_id, str(row["title"]), row["source_page"],
                _finished_without_contact(connection, campaign_id, person_id, min_confidence), stamp,
            )


# Slots evidence_bridge can actually construct a claim for, keyed by the affinity signal code
# that would otherwise be left without a resolvable evidence_id at draft time.
_EVIDENCE_SLOTS_FOR_CODE: dict[str, str] = {
    "shared_school": "school", "shared_prior_employer": "why_them",
    "own_writing": "new_fact_sentence", "board_or_portfolio": "new_fact_sentence",
    "firm_thesis": "topic",
    "path_match": "path_transition",
    "role_family_match": "role_level", "level_match": "role_level",
}


def _affinity_from_row(row: sqlite3.Row) -> Affinity:
    signals = tuple(
        Signal(
            str(item["code"]), str(item["klass"]), int(item["strength"]), int(item["weight"]),
            int(item["points"]), tuple(item.get("observation_ids", ())), item.get("evidence_id"),
        )
        for item in json.loads(str(row["signals_json"]))
    )
    return Affinity(str(row["person_id"]), str(row["campaign_id"]), int(row["score"]), signals, str(row["fit_spec_hash"]))


def _has_validated_delivery_evidence(connection: sqlite3.Connection, campaign_id: str,
                                     person_id: str, validated_ids: set[str]) -> bool:
    if not validated_ids:
        return False
    row = connection.execute(
        "SELECT signals_json FROM person_affinity WHERE campaign_id=? AND person_id=?",
        (campaign_id, person_id),
    ).fetchone()
    if row is None:
        return False
    return any(
        isinstance(signal, Mapping)
        and signal.get("klass") in {"strong", "medium"}
        and signal.get("evidence_id") in validated_ids
        for signal in json.loads(str(row["signals_json"]))
    )


def _mint_delivered_evidence(connection: sqlite3.Connection, campaign_id: str,
                             person_id: str, company_id: str, now) -> tuple[int, int]:
    """Mint canonical signal facts and report unresolved P8-B delivery proof."""
    row = connection.execute(
        "SELECT * FROM person_affinity WHERE person_id=? AND campaign_id=?", (person_id, campaign_id)
    ).fetchone()
    if row is None:
        return 0, 1
    affinity = _affinity_from_row(row)
    slots = tuple(dict.fromkeys(
        _EVIDENCE_SLOTS_FOR_CODE[signal.code]
        for signal in affinity.signals
        if signal.klass in {"strong", "medium"} and signal.code in _EVIDENCE_SLOTS_FOR_CODE
    ))
    minted = 0
    validated_ids: set[str] = set()
    for slot in slots:
        try:
            facts = evidence_bridge.resolve_slot_facts(
                connection, person_id, affinity, company_id, required_slots=(slot,),
            )
            canonical = facts.values[slot]
            result = evidence_bridge.mint_evidence(
                connection, person_id, campaign_id, affinity, {slot: canonical}, now,
                selected_company_id=company_id,
            )
            minted += len(result)
            validated_ids.update(result.values())
        except (KeyError, ValueError):
            continue
    return minted, int(not _has_validated_delivery_evidence(
        connection, campaign_id, person_id, validated_ids,
    ))


def _proved_contact_count(connection: sqlite3.Connection, campaign_id: str,
                          company_id: str, min_confidence: float) -> int:
    """Count proved selected people once even when they have multiple valid contacts."""
    return int(connection.execute(
        """SELECT count(DISTINCT selected.person_id) FROM fill_person AS selected
           JOIN contact_point AS contact ON contact.person_id=selected.person_id
             AND contact.state='valid' AND contact.confidence>=?
          WHERE selected.campaign_id=? AND selected.company_id=?
            AND selected.substituted=0""",
        (min_confidence, campaign_id, company_id),
    ).fetchone()[0])


def _base_summary(connection: sqlite3.Connection, campaign_id: str, searches: int,
                  min_confidence: float, domains_backfilled: int, profiles_skipped_untyped: int) -> FillSummary:
    values = connection.execute(
        """SELECT SUM(status='met'),SUM(status IN ('short','no_confident_email')),
                  SUM(status='no_confident_email') FROM fill_firm WHERE campaign_id=?""",
        (campaign_id,),
    ).fetchone()
    reason = connection.execute(
        """SELECT shortfall_reason FROM fill_firm WHERE campaign_id=? AND shortfall_reason IS NOT NULL
           GROUP BY shortfall_reason ORDER BY count(*) DESC, shortfall_reason ASC LIMIT 1""",
        (campaign_id,),
    ).fetchone()
    refused = connection.execute(
        """SELECT count(*) FROM fill_firm WHERE campaign_id=? AND shortfall_reason IN
           ('credit_budget','snov_account_credit_ceiling','max_pages','vendor_error')""", (campaign_id,)
    ).fetchone()[0]
    people = connection.execute(
        """SELECT count(DISTINCT selected.person_id) FROM fill_person AS selected
           JOIN contact_point AS cp ON cp.person_id=selected.person_id AND cp.state='valid' AND cp.confidence>=?
           WHERE selected.campaign_id=? AND selected.substituted=0""", (min_confidence, campaign_id)
    ).fetchone()[0]
    credits = connection.execute(
        "SELECT COALESCE(SUM(actual_cost),0) FROM credit_reservation WHERE campaign_id=?", (campaign_id,)
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
           JOIN contact_point AS cp ON cp.person_id=selected.person_id AND cp.state='valid' AND cp.confidence>=?
           WHERE firm.campaign_id=? AND firm.status='short'""", (min_confidence, campaign_id)
    ).fetchone()[0]
    return FillSummary(
        int(values[0] or 0), int(values[1] or 0), int(values[2] or 0), int(people), searches,
        int(credits or 0), int(discovered or 0), int(candidates_found or 0),
        str(reason[0]) if reason is not None else None, int(partial or 0), int(refused or 0),
        domains_backfilled, profiles_skipped_untyped,
    )


def fill_campaign_fit(
    connection, campaign_id: str, *, target_per_firm: int, slack: int = 1,
    min_fit: int = 25, max_candidates_per_firm: int = 6,
    min_confidence: float = 0.7, max_pages_per_firm: int = 4,
    max_bio_pages: int | None = None, max_linkedin: int = 0,
    anchors, reserve_company_ids=(), at: str | None = None,
    execute=None, queue_email=None,
) -> FitFillSummary:
    """Discover, research, score, and search only the best-fitting candidates."""
    _validate_limits(
        target_per_firm, slack, min_fit, max_candidates_per_firm, min_confidence,
        max_pages_per_firm, max_bio_pages, max_linkedin,
    )
    stamp = _stamp(connection, at)
    campaign = connection.execute("SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()
    if campaign is None:
        raise ValueError("unknown_campaign")
    policy_hash = str(campaign["policy_hash"])
    approved = connection.execute(
        """SELECT json_extract(fit_spec_json, '$.min_fit') AS min_fit
           FROM campaign_fit_spec WHERE campaign_id=? AND state='approved'""", (campaign_id,)
    ).fetchone()
    if approved is not None:
        min_fit = max(min_fit, int(approved["min_fit"]))
    firms = _firms(connection, reserve_company_ids)
    for company_id in firms:
        _set_firm(connection, campaign_id, company_id, target_per_firm, max_candidates_per_firm, stamp)
    domains_backfilled = backfill_company_domains(connection, firms)
    refusals = _discover(
        connection, campaign_id, firms, policy_hash, max_candidates_per_firm, min_confidence, stamp,
        max_pages_per_firm, execute,
    )
    _mark_candidates(connection, campaign_id, firms, max_candidates_per_firm, min_confidence, stamp)
    connection.commit()

    research = research_run(
        connection, campaign_id, anchors=anchors, max_bio_pages=max_bio_pages, max_linkedin=max_linkedin,
        now=as_datetime(stamp), executor_factory=Executor,
    )
    scores = score_campaign(connection, campaign_id, anchors=anchors, now=stamp)
    searches = skipped_low_fit = firms_no_fit = skipped_untyped = evidence_minted = 0
    evidence_unresolved = 0
    limit = target_per_firm + slack
    stamp_dt = as_datetime(stamp)
    for company_id in firms:
        candidates = _candidate_rows(connection, company_id, max_candidates_per_firm)
        typed_candidates = [
            row for row in candidates if _PERSON_ID_RE.fullmatch(str(row["person_id"])) is not None
        ]
        skipped_untyped += len(candidates) - len(typed_candidates)
        affinity = {
            str(row["person_id"]): int(row["score"])
            for row in connection.execute(
                """SELECT affinity.person_id,affinity.score FROM person_affinity AS affinity
                   JOIN employment AS employment ON employment.person_id=affinity.person_id
                     AND employment.company_id=? AND employment.valid_to IS NULL
                   WHERE affinity.campaign_id=? ORDER BY affinity.score DESC,affinity.person_id""",
                (company_id, campaign_id),
            )
        }
        eligible = sorted(
            (row for row in typed_candidates if affinity.get(str(row["person_id"]), -1) >= min_fit),
            key=lambda row: (-affinity[str(row["person_id"])], str(row["person_id"])),
        )
        skipped_low_fit += sum(affinity.get(str(row["person_id"]), -1) < min_fit for row in typed_candidates)
        if not eligible:
            status, reason = "short", "no_fit"
            firms_no_fit += 1
        else:
            queued_searches = 0
            for row in eligible[:limit]:
                person_id = str(row["person_id"])
                if _has_confident_contact(connection, person_id, min_confidence) or _finished_without_contact(
                    connection, campaign_id, person_id, min_confidence
                ):
                    continue
                queued_searches += int(_queue_email(connection, campaign_id, policy_hash, person_id, stamp, queue_email))
            searches += queued_searches
            if queued_searches and execute is not None:
                connection.commit()
                execute()
            delivered = sum(
                _has_confident_contact(connection, str(row["person_id"]), min_confidence) for row in eligible[:limit]
            )
            pending_research = connection.execute(
                """SELECT 1 FROM person_research_state AS state
                   JOIN employment AS employment ON employment.person_id=state.person_id
                     AND employment.company_id=? AND employment.valid_to IS NULL
                   WHERE state.campaign_id=? AND state.bio_state='pending' LIMIT 1""",
                (company_id, campaign_id),
            ).fetchone() is not None
            finished = bool(eligible) and all(
                _has_confident_contact(connection, str(row["person_id"]), min_confidence)
                or _finished_without_contact(connection, campaign_id, str(row["person_id"]), min_confidence)
                for row in eligible[:limit]
            )
            if delivered >= target_per_firm and not pending_research:
                status, reason = "met", None
            elif company_id in refusals:
                status, reason = "short", refusals[company_id]
            elif pending_research:
                status, reason = "short", "discovery_pending"
            elif delivered == 0 and finished:
                status, reason = "no_confident_email", "no_confident_email"
            else:
                status, reason = "short", "candidate_exhausted"
        evidence_blocked = 0
        for row in candidates:
            person_id = str(row["person_id"])
            # Only a candidate at or above min_fit (at the approved fit_spec_hash's score) who
            # also finished with a confident contact may be delivered -- the same P6 substitution
            # semantics fill_campaign itself applies. Everyone else this firm touched (below
            # min_fit, or a search that finished without a confident contact) is a substitution,
            # never a pick.
            substituted = affinity.get(person_id, -1) < min_fit or _finished_without_contact(
                connection, campaign_id, person_id, min_confidence
            )
            if not substituted:
                minted, unresolved = _mint_delivered_evidence(
                    connection, campaign_id, person_id, company_id, stamp_dt,
                )
                evidence_minted += minted
                evidence_unresolved += unresolved
                evidence_blocked += unresolved
                substituted = bool(unresolved)
            _mark_person(
                connection, campaign_id, company_id, person_id, str(row["title"]), row["source_page"],
                substituted, stamp,
            )
        if evidence_blocked and status != "no_confident_email" and not pending_research:
            if _proved_contact_count(
                connection, campaign_id, company_id, min_confidence,
            ) < target_per_firm:
                status, reason = "short", "evidence_unresolved"
        connection.execute(
            "UPDATE fill_firm SET status=?,shortfall_reason=?,updated_at=? WHERE campaign_id=? AND company_id=?",
            (status, reason, stamp, campaign_id, company_id),
        )
        connection.commit()
    _profiles, profiles_skipped_untyped = queue_firm_profiles(
        connection, campaign_id, policy_hash, stamp, min_confidence
    )
    above_fit = connection.execute(
        "SELECT count(*) FROM person_affinity WHERE campaign_id=? AND score>=?", (campaign_id, min_fit)
    ).fetchone()[0]
    return FitFillSummary(
        _base_summary(connection, campaign_id, searches, min_confidence, domains_backfilled, profiles_skipped_untyped),
        research.researched, research.unresearched, research.bio_pages_fetched, research.linkedin_loads_used,
        scores.scored, int(above_fit), firms_no_fit, skipped_low_fit, skipped_untyped,
        evidence_minted, evidence_unresolved,
    )
