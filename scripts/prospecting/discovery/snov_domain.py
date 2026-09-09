"""Desktop-local Snov v2 Domain Search discovery, queued through ``finder_page``."""

from __future__ import annotations

import csv
import hashlib
import inspect
import json
import os
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
import re
import sqlite3
import uuid

from scripts.prospecting.lanes import LaneBatch, LaneCursor, LanePlan, YieldEstimate, register_lane
from scripts.prospecting.list_builder import _canonical_person_ids, _persist_batch
from scripts.prospecting.providers.base import queue_vendor_lookup
from scripts.prospecting.store import (
    Employment, ExecRequest, SourceObservation,
    insert_employment, insert_source_observation, settle_credit, validate_exec_request,
)

_AT = "2026-09-04T00:00:00Z"
SNOV_DOMAIN_PAGE_MAX_CREDITS = 1
DEFAULT_MAX_PAGES = 30
FILL_MAX_PAGES_PER_FIRM = 4
SNOV_ACCOUNT_CREDIT_CEILING = 50
SNOV_DOMAIN_START_PENDING = "snov-domain-start-pending"
SNOV_DOMAIN_START_PENDING_URL = "pending://snov-domain-start"
DEFAULT_TITLE_FUNCTION_EXCLUSIONS = (
    "finance", "accounting", "controller", "it", "technology", "engineering", "engineer", "software",
    "data", "security", "talent", "recruiting", "people", "hr", "human resources", "marketing",
    "communications", "content", "community", "brand", "design", "sales", "business development", "legal",
    "compliance", "operations", "administration", "administrative", "executive assistant", "assistant",
    "office", "investor relations", "investor database", "platform", "events", "portfolio services",
)
_DOMAIN = re.compile(r"^[a-z0-9.-]+\.[a-z]{2,}$")


class SnovBudgetRefused(RuntimeError):
    """A bounded page plan or campaign ``credit_budget`` refused another page."""


class SnovPageError(RuntimeError):
    """A typed, non-PII terminal result for one finder page."""


def _release_reservation(connection: sqlite3.Connection, reservation_id: str, at: str) -> None:
    """Release a finder-page reservation without manufacturing a person attempt.

    P1's generic release helper records an attempt against a required person ID;
    a domain page deliberately has no person until the page result is persisted.
    """
    connection.execute("BEGIN IMMEDIATE")
    try:
        changed = connection.execute("UPDATE credit_reservation SET actual_cost=0,state='released',settled_at=? WHERE reservation_id=? AND state='reserved'", (at, reservation_id))
        if changed.rowcount != 1:
            raise ValueError("reservation is not reserved")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _normalise_name(value: str) -> str:
    return " ".join(value.casefold().split())


def _normalise_title(value: str) -> str:
    return " ".join("".join(char if char.isalnum() else " " for char in value.casefold()).split())


def domain_map_path(environ: Mapping[str, str] | None = None) -> Path:
    root = (os.environ if environ is None else environ).get("LOCALAPPDATA")
    if not root:
        raise ValueError("LOCALAPPDATA is required")
    return Path(root) / "kb-prospecting" / "company-domains.csv"


def load_company_domains(path: Path) -> Mapping[str, str]:
    with path.open("r", encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != ["name", "domain"]:
            raise ValueError("invalid_company_domains")
        result: dict[str, str] = {}
        for row in reader:
            name, domain = (row.get("name") or "").strip(), (row.get("domain") or "").strip().casefold()
            if not name or not domain or any(char.isspace() for char in domain):
                raise ValueError("invalid_company_domains")
            result[_normalise_name(name)] = domain
    return result


def persist_company_domain(connection: sqlite3.Connection, company_id: str, domain: str) -> bool:
    """Persist a valid domain only when the company has no homepage yet."""
    normalised = domain.casefold()
    if _DOMAIN.fullmatch(normalised):
        changed = connection.execute(
            """UPDATE company SET website_url=? WHERE company_id=?
               AND (website_url IS NULL OR trim(website_url)='')""",
            ("https://" + normalised, company_id),
        )
        return changed.rowcount == 1
    return False


def _request_id(finder_run_id: str, company_id: str, page: int) -> str:
    return "req_" + hashlib.sha256(f"{finder_run_id}|{company_id}|{page}".encode()).hexdigest()[:16]


class _ReservationAdapter:
    provider = "snov"

    def max_cost(self, operation: str) -> int:
        if operation != "find":
            raise ValueError("unsupported_vendor_operation")
        return SNOV_DOMAIN_PAGE_MAX_CREDITS


def _page_count(connection: sqlite3.Connection, run_id: str) -> int:
    return int(connection.execute("SELECT count(*) FROM snov_domain_page WHERE finder_run_id=?", (run_id,)).fetchone()[0])


def snov_account_credit_ceiling(connection: sqlite3.Connection) -> int:
    """Read Snov's non-secret desktop setting, defaulting to its free-tier cap."""
    database = next((str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"), "")
    if not database:
        return SNOV_ACCOUNT_CREDIT_CEILING
    try:
        payload = json.loads((Path(database).parent / "operator-vendors.json").read_text(encoding="utf-8"))
        ceiling = payload.get("snov_account_credit_ceiling", SNOV_ACCOUNT_CREDIT_CEILING)
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return SNOV_ACCOUNT_CREDIT_CEILING
    return ceiling if type(ceiling) is int and ceiling >= 0 else SNOV_ACCOUNT_CREDIT_CEILING


def _snov_account_used(connection: sqlite3.Connection) -> int:
    return int(connection.execute(
        """SELECT COALESCE(SUM(CASE WHEN state='reserved' THEN max_cost
                 WHEN state IN ('settled','overage_error') THEN actual_cost ELSE 0 END),0)
           FROM credit_reservation WHERE provider='snov'"""
    ).fetchone()[0])


def queue_finder_page(
    connection: sqlite3.Connection, *, campaign_id: str, finder_run_id: str,
    policy_hash: str, company_id: str, page: int = 1, at: str, max_pages: int = DEFAULT_MAX_PAGES,
) -> str | None:
    """Queue a page only after the public reservation path accepts its maximum cost."""
    if page < 1 or max_pages < 1:
        raise ValueError("invalid_snov_page_limit")
    request_id = _request_id(finder_run_id, company_id, page)
    if connection.execute("SELECT 1 FROM exec_request WHERE request_id=?", (request_id,)).fetchone():
        return request_id
    if _page_count(connection, finder_run_id) >= max_pages:
        raise SnovBudgetRefused("max_pages")
    campaign = connection.execute("SELECT credit_budget FROM campaign WHERE campaign_id=? AND policy_hash=?", (campaign_id, policy_hash)).fetchone()
    used = connection.execute("SELECT COALESCE(SUM(CASE WHEN state='reserved' THEN max_cost WHEN state IN ('settled','overage_error') THEN actual_cost ELSE 0 END),0) FROM credit_reservation WHERE campaign_id=?", (campaign_id,)).fetchone()[0]
    if campaign is None or int(used) + SNOV_DOMAIN_PAGE_MAX_CREDITS > int(campaign["credit_budget"]):
        raise SnovBudgetRefused("credit_budget")
    if _snov_account_used(connection) + SNOV_DOMAIN_PAGE_MAX_CREDITS > snov_account_credit_ceiling(connection):
        raise SnovBudgetRefused("snov_account_credit_ceiling")
    queue_vendor_lookup(
        connection, campaign_id=campaign_id,
        person_id="per_" + hashlib.sha256(company_id.encode()).hexdigest()[:16],
        provider="snov", vendor_operation="find", payload={}, policy_hash=policy_hash,
        request_id=request_id, adapter=_ReservationAdapter(), now=at,
    )
    if connection.execute("SELECT 1 FROM credit_reservation WHERE exec_request_id=? AND state='reserved'", (request_id,)).fetchone() is None:
        return None
    company = connection.execute("SELECT name FROM company WHERE company_id=?", (company_id,)).fetchone()
    if company is None:
        raise ValueError("unknown_company")
    domain = load_company_domains(domain_map_path()).get(_normalise_name(str(company["name"])))
    if domain is None:
        raise ValueError("no_domain")
    domain = domain.casefold()
    persist_company_domain(connection, company_id, domain)
    request = ExecRequest(request_id, "prospecting-list-builder", "finder_page", {"finder_run_id": finder_run_id, "lane": "snov_domain"}, policy_hash, None, at)
    validate_exec_request(request, "T0", connection)
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("UPDATE exec_request SET operation=?,payload=? WHERE request_id=? AND state='queued'", ("finder_page", json.dumps(request.payload, sort_keys=True, separators=(",", ":")), request_id))
        connection.execute("INSERT INTO snov_domain_page(request_id,finder_run_id,company_id,domain,last_id) VALUES(?,?,?,?,?)", (request_id, finder_run_id, company_id, domain, str(page)))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return request_id


class SnovDomainLane:
    name = "snov_domain"
    capability_version = "snov_domain_v2"

    def __init__(self, connection: sqlite3.Connection | None = None, domains: Path | None = None, *, report_no_domain: bool = True, max_pages: int = DEFAULT_MAX_PAGES) -> None:
        if max_pages < 1:
            raise ValueError("invalid_snov_page_limit")
        self.connection, self.domains, self.report_no_domain, self.max_pages = connection, domains, report_no_domain, max_pages
        self._run_id: str | None = None

    def bind_run(self, finder_run_id: str) -> None:
        self._run_id = finder_run_id

    def capabilities(self):
        capability = __import__("scripts.prospecting.store", fromlist=["LaneCapability"]).LaneCapability
        outcomes = {
            # Inherited from the curated company set.
            "industry": "exact",
            "company_type": "exact",
            "company_stage": "exact",
            "company_location": "exact",
            "person_location": "exact",
            # The title normaliser covers every policy title class exactly;
            # seniority is derived from the broader free-text title and remains heuristic.
            "title": "exact",
            "seniority": "approximate",
            "school": "exact",
            "platform": "unsupported",
            "company_list": "exact",
        }
        return {
            predicate: capability(outcome, "snov_domain_v2", self.capability_version)
            for predicate, outcome in outcomes.items()
        }

    def plan(self, target_policy) -> LanePlan:
        return LanePlan(self.name, self.capability_version, self.capabilities(), YieldEstimate(1, 4, max(4, self.max_pages)), self.max_pages)

    def run(self, plan: LanePlan, cursor: LaneCursor | None) -> LaneBatch:
        if self.connection is None or self._run_id is None:
            raise ValueError("snov_domain_lane_requires_bound_local_store")
        domains = load_company_domains(self.domains or domain_map_path())
        run = self.connection.execute("SELECT campaign_id,policy_hash FROM finder_run WHERE finder_run_id=?", (self._run_id,)).fetchone()
        if run is None:
            raise ValueError("unknown_finder_run")
        queued = unresolved = 0
        capped = False
        completed = {str(row[0]) for row in self.connection.execute("""SELECT page.company_id FROM snov_domain_page AS page JOIN exec_request AS request ON request.request_id=page.request_id WHERE request.state='succeeded'""")}
        for company in self.connection.execute("SELECT company_id,name FROM company WHERE source_lane='manual' ORDER BY company_id"):
            domain = domains.get(_normalise_name(str(company["name"])))
            if domain is None:
                unresolved += 1
                continue
            persist_company_domain(self.connection, str(company["company_id"]), domain)
            if str(company["company_id"]) in completed:
                continue
            try:
                queued_request = queue_finder_page(self.connection, campaign_id=str(run["campaign_id"]), finder_run_id=self._run_id, policy_hash=str(run["policy_hash"]), company_id=str(company["company_id"]), page=1, at=_AT, max_pages=self.max_pages)
            except SnovBudgetRefused:
                capped = True
                break
            if queued_request is None:
                capped = True
                break
            queued += 1
        prior = self.connection.execute("SELECT * FROM source_observation WHERE entity_type='person' AND source LIKE '%|snov_domain' ORDER BY observation_id").fetchall()
        observations = tuple(SourceObservation("obs_" + hashlib.sha256(f"{self._run_id}|{row['observation_id']}".encode()).hexdigest()[:16], str(row["entity_type"]), str(row["entity_id"]), str(row["field"]), str(row["value"]), str(row["source"]), row["seen_at"], str(row["retrieved_at"]), float(row["confidence"]), row["snapshot_id"]) for row in prior)
        reason = "credit_budget" if capped else ("no_domain" if unresolved and self.report_no_domain else ("lane_exhausted" if not queued and not observations else None))
        return LaneBatch(observations, None, queued + unresolved, len({item.entity_id for item in observations}), True, reason)


def _title_rules(connection: sqlite3.Connection, campaign_id: str) -> tuple[Mapping[str, object], ...]:
    row = connection.execute("SELECT policy_json FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()
    if row is None:
        raise ValueError("unknown_campaign")
    try:
        predicates = json.loads(str(row[0])).get("predicates", [])
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("invalid_campaign_policy") from error
    rules: list[Mapping[str, object]] = []
    for predicate in predicates:
        if not isinstance(predicate, Mapping) or predicate.get("type") != "title":
            continue
        value = predicate.get("value")
        for item in value if isinstance(value, list) else [value]:
            rules.append(item if isinstance(item, Mapping) else {"class": str(item)})
    return tuple(rules)


def _has_excluded_title_function(title: str, exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS) -> bool:
    words = _normalise_title(title).split()
    tokens = set(words)
    bigrams = {" ".join(words[index:index + 2]) for index in range(len(words) - 1)}
    return any(
        (normalised in tokens if len(normalised.split()) == 1 else normalised in bigrams)
        for value in exclusions
        if (normalised := _normalise_title(str(value)))
    )


def _matching_title_rules(
    title: str, rules: Sequence[Mapping[str, object]],
    exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS,
) -> tuple[int, ...]:
    if _has_excluded_title_function(title, exclusions):
        return ()
    words = set(_normalise_title(title).split())
    matched: list[int] = []
    for index, rule in enumerate(rules):
        kind = _normalise_title(str(rule.get("class", rule.get("value", ""))))
        senior = "senior" in words
        if kind == "associate" and "associate" in words and "partner" not in words and (not senior or bool(rule.get("include_senior", True))):
            matched.append(index)
            continue
        if kind == "senior associate" and {"senior", "associate"} <= words and bool(rule.get("include_senior", True)):
            matched.append(index)
            continue
        if kind == "principal" and "principal" in words and bool(rule.get("include_senior", True)):
            matched.append(index)
            continue
        if kind == "vice president" and {"vice", "president"} <= words and bool(rule.get("include_senior", True)):
            matched.append(index)
            continue
        if kind == "director" and "director" in words and ("managing" not in words or bool(rule.get("include_managing_director", False))) and ("associate" not in words or bool(rule.get("compound_titles", False))):
            matched.append(index)
            continue
        if kind == "managing director" and {"managing", "director"} <= words and bool(rule.get("include_senior", True)):
            matched.append(index)
            continue
        if kind == "general partner" and {"general", "partner"} <= words and bool(rule.get("include_senior", True)):
            matched.append(index)
            continue
        if kind == "partner" and "partner" in words and "associate" not in words and bool(rule.get("include_senior", True)):
            matched.append(index)
            continue
        exact = _normalise_title(str(rule.get("exact", "")))
        if exact and exact == _normalise_title(title):
            matched.append(index)
    return tuple(matched)


def _title_matches(
    title: str, rules: Sequence[Mapping[str, object]],
    exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS,
) -> bool:
    return bool(_matching_title_rules(title, rules, exclusions))


def _seniority(title: str) -> int:
    words = set(_normalise_title(title).split())
    return next((rank for word, rank in (
        ("managing", 7), ("director", 6), ("principal", 5), ("partner", 4),
        ("senior", 3), ("associate", 2), ("analyst", 1),
    ) if word in words), 0)


def _select_per_firm(
    rows: Sequence[Mapping[str, object]], rules: Sequence[Mapping[str, object]], cap: int,
    *, fulfilled_rules: frozenset[int] = frozenset(), existing_ids: frozenset[str] = frozenset(),
    exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS,
) -> tuple[Mapping[str, object], ...]:
    """Select reproducibly, reserving one best candidate per requested title class."""
    candidates: list[tuple[int, Mapping[str, object], str]] = []
    for item in rows:
        matches = _matching_title_rules(str(item.get("position") or ""), rules, exclusions)
        if matches:
            stable, _profile = _identity(item)
            if stable not in existing_ids:
                candidates.append((matches[0], item, stable))

    def key(candidate: tuple[int, Mapping[str, object], str]) -> tuple[int, int, str]:
        rule_index, item, stable = candidate
        title = _normalise_title(str(item.get("position") or ""))
        rule = rules[rule_index]
        expected = _normalise_title(str(rule.get("exact") or rule.get("class", rule.get("value", ""))))
        return (0 if title == expected else 1, -_seniority(title), stable)

    selected: list[tuple[int, Mapping[str, object], str]] = []
    for rule_index in range(len(rules)):
        if rule_index in fulfilled_rules:
            continue
        group = sorted((item for item in candidates if item[0] == rule_index), key=key)
        if group and len(selected) < cap:
            selected.append(group[0])
    selected_ids = {stable for _rule, _item, stable in selected}
    for candidate in sorted(candidates, key=lambda item: (item[0], *key(item))):
        if len(selected) >= cap:
            break
        if candidate[2] not in selected_ids:
            selected.append(candidate)
            selected_ids.add(candidate[2])
    return tuple(item for _rule, item, _stable in selected)


def _existing_firm_selection(
    connection: sqlite3.Connection, campaign_id: str, company_id: str, rules: Sequence[Mapping[str, object]],
    exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS,
) -> tuple[frozenset[str], frozenset[int]]:
    """Return prior Snov choices for this company in any run of this campaign."""
    rows = connection.execute(
        """SELECT stable.value AS stable,title.value AS title
           FROM source_observation AS stable
           JOIN finder_run AS run ON stable.source=run.finder_run_id || '|snov_domain'
           LEFT JOIN source_observation AS title
             ON title.entity_id=stable.entity_id AND title.source=stable.source AND title.field='title'
           WHERE run.campaign_id=? AND stable.entity_type='person' AND stable.field='snov_prospect_id'
             AND EXISTS (SELECT 1 FROM source_observation AS company
                         WHERE company.entity_id=stable.entity_id AND company.source=stable.source
                           AND company.field='company_id' AND json_extract(company.value,'$')=?)""",
        (campaign_id, company_id),
    ).fetchall()
    ids = frozenset(str(json.loads(str(row["stable"]))) for row in rows)
    fulfilled = frozenset(
        index for row in rows for index in _matching_title_rules(str(json.loads(str(row["title"] or '""'))), rules, exclusions)
    )
    return ids, fulfilled


def _records(raw: Mapping[str, object]) -> tuple[tuple[Mapping[str, object], ...], int | None, int, str]:
    data = raw.get("data", ())
    rows = tuple(item for item in data if isinstance(item, Mapping)) if isinstance(data, Sequence) and not isinstance(data, str) else ()
    links = raw.get("links") if isinstance(raw.get("links"), Mapping) else {}
    meta = raw.get("meta") if isinstance(raw.get("meta"), Mapping) else {}
    next_page = None
    next_link = links.get("next")
    if isinstance(next_link, str) and "page=" in next_link:
        try:
            next_page = int(next_link.split("page=", 1)[1].split("&", 1)[0])
        except ValueError:
            pass
    return rows, next_page, int(raw.get("credits", meta.get("credits", SNOV_DOMAIN_PAGE_MAX_CREDITS))), str(raw.get("api_version", "v2"))


def _snov_complete(raw: Mapping[str, object]) -> bool:
    return str(raw.get("status", "completed") or "").casefold() in {"complete", "completed"}


def _identity(item: Mapping[str, object]) -> tuple[str, str | None]:
    profile = str(item.get("source_page") or item.get("profile_url") or "").strip() or None
    stable = str(item.get("prospect_id") or item.get("prospect_hash") or item.get("id") or "").strip()
    if not stable:
        start = str(item.get("search_emails_start") or "")
        # v2 start URLs commonly end in ``/start``; use the full opaque URL as
        # the stable input so distinct prospects cannot collapse to that suffix.
        stable = "snov_" + hashlib.sha256(start.encode()).hexdigest()[:24] if start else ""
    if not stable:
        stable = profile or hashlib.sha256(json.dumps(dict(item), sort_keys=True, default=str).encode()).hexdigest()
    return stable, profile


def _contact_state(raw: object) -> str:
    status = _normalise_title(str(raw)).replace(" ", "_")
    return {"valid": "valid", "unverified": "risky", "not_verified": "risky", "catch_all": "catch_all", "invalid": "invalid"}.get(status, "risky")


class SnovDomainAdapter:
    provider = "snov"

    def __init__(self, connection: sqlite3.Connection, transport: Callable[..., Mapping[str, object]], *, max_pages: int = DEFAULT_MAX_PAGES, per_firm: int | None = None, title_function_exclusions: Sequence[str] = DEFAULT_TITLE_FUNCTION_EXCLUSIONS) -> None:
        if per_firm is not None and per_firm < 1:
            raise ValueError("invalid_per_firm")
        self.connection, self.transport, self.max_pages, self.per_firm = connection, transport, max_pages, per_firm
        self.title_function_exclusions = tuple(title_function_exclusions)

    def _per_firm(self, campaign_id: str, finder_run_id: str) -> int:
        fill = self.connection.execute(
            "SELECT max_candidates FROM fill_discovery WHERE campaign_id=? AND finder_run_id=?",
            (campaign_id, finder_run_id),
        ).fetchone()
        if fill is not None:
            return int(fill["max_candidates"])
        if self.per_firm is not None:
            return self.per_firm
        rules = _title_rules(self.connection, campaign_id)
        if len({_normalise_title(str(rule.get("class", rule.get("value", "")))) for rule in rules}) >= 2:
            return 2
        run = self.connection.execute(
            "SELECT requested_companies,requested_people FROM finder_run WHERE finder_run_id=?", (finder_run_id,)
        ).fetchone()
        if run is None:
            return 2
        return max(2, int(run["requested_people"]) // max(1, int(run["requested_companies"])))

    def _transport_page(
        self, *, domain: str, page: int, task_hash: str | None = None,
        result_url: str | None = None,
    ) -> Mapping[str, object]:
        """Call the transport without a vendor-side title filter.

        The production transport still accepts its legacy ``positions`` argument.
        Supplying an empty sequence only for that signature keeps its encoded HTTP
        request to ``domain`` and ``page`` while allowing test transports to assert
        that no positions argument was requested.
        """
        kwargs: dict[str, object] = {"domain": domain, "page": page}
        if task_hash is not None:
            kwargs.update(task_hash=task_hash, result_url=result_url)
        parameter = inspect.signature(self.transport).parameters.get("positions")
        if parameter is not None and parameter.default is inspect.Parameter.empty:
            kwargs["positions"] = ()
        return self.transport(**kwargs)

    def execute(self, request: ExecRequest, at: str) -> str | None:
        payload = request.payload
        if request.operation != "finder_page" or set(payload) != {"finder_run_id", "lane"} or payload["lane"] != "snov_domain":
            raise ValueError("invalid_snov_domain_request")
        run = self.connection.execute("SELECT campaign_id,policy_hash FROM finder_run WHERE finder_run_id=?", (payload["finder_run_id"],)).fetchone()
        reservation = self.connection.execute("""SELECT cr.* FROM credit_reservation AS cr JOIN exec_request AS er ON er.request_id=cr.exec_request_id WHERE cr.exec_request_id=? AND cr.campaign_id=? AND cr.provider='snov' AND cr.max_cost=? AND cr.state='reserved' AND er.state='claimed'""", (request.request_id, run["campaign_id"] if run else None, SNOV_DOMAIN_PAGE_MAX_CREDITS)).fetchone()
        page_row = self.connection.execute("SELECT company_id,domain,last_id FROM snov_domain_page WHERE request_id=? AND finder_run_id=?", (request.request_id, payload["finder_run_id"])).fetchone()
        if run is None or str(run["policy_hash"]) != request.policy_hash or reservation is None or page_row is None:
            raise ValueError("reservation_missing_or_invalid")
        company_id, domain, page = str(page_row["company_id"]), str(page_row["domain"]), int(page_row["last_id"] or 1)
        if not domain:
            _release_reservation(self.connection, str(reservation["reservation_id"]), at)
            raise SnovPageError("snov_empty_domain")
        persisted = self.connection.execute(
            "SELECT task_hash,result_url FROM snov_domain_search WHERE request_id=?", (request.request_id,)
        ).fetchone()
        resume_task = persisted is not None and str(persisted["task_hash"]) != SNOV_DOMAIN_START_PENDING
        try:
            raw = self._transport_page(
                domain=domain, page=page,
                task_hash=str(persisted["task_hash"]) if resume_task else None,
                result_url=str(persisted["result_url"]) if resume_task else None,
            )
        except Exception as error:
            if resume_task:
                self._mark_in_progress(request.request_id, str(persisted["task_hash"]), str(persisted["result_url"]), at)
                return None
            status = getattr(error, "status", None)
            if isinstance(error, SnovPageError):
                raise
            if error.__class__.__name__ == "VendorHttpError" and (status is None or 500 <= status < 600):
                self._mark_start_uncertain(request.request_id, at)
                return None
            _release_reservation(self.connection, str(reservation["reservation_id"]), at)
            code = "snov_rate_limited" if status == 429 else "snov_transport_error"
            raise SnovPageError(code) from None
        if not isinstance(raw, Mapping):
            _release_reservation(self.connection, str(reservation["reservation_id"]), at)
            raise SnovPageError("snov_parse_error")
        task_meta = raw.get("meta") if isinstance(raw.get("meta"), Mapping) else {}
        task_links = raw.get("links") if isinstance(raw.get("links"), Mapping) else {}
        task_hash = str(task_meta.get("task_hash") or (persisted["task_hash"] if persisted else ""))
        result_url = str(task_links.get("result") or (persisted["result_url"] if persisted else ""))
        if not _snov_complete(raw):
            if task_hash and result_url.startswith("https://api.snov.io/v2/"):
                self._mark_in_progress(request.request_id, task_hash, result_url, at)
                return None
            _release_reservation(self.connection, str(reservation["reservation_id"]), at)
            raise SnovPageError("snov_parse_error")
        try:
            rows, next_page, credits, api_version = _records(raw)
        except (TypeError, ValueError):
            _release_reservation(self.connection, str(reservation["reservation_id"]), at)
            raise SnovPageError("snov_parse_error") from None
        rules = _title_rules(self.connection, str(run["campaign_id"]))
        cap = self._per_firm(str(run["campaign_id"]), str(payload["finder_run_id"]))
        existing_ids, fulfilled_rules = _existing_firm_selection(
            self.connection, str(run["campaign_id"]), company_id, rules, self.title_function_exclusions,
        )
        selected = _select_per_firm(
            rows, rules, max(0, cap - len(existing_ids)),
            fulfilled_rules=fulfilled_rules, existing_ids=existing_ids,
            exclusions=self.title_function_exclusions,
        )
        observations: list[SourceObservation] = []
        non_candidate_observations: list[SourceObservation] = []
        chosen: dict[str, Mapping[str, object]] = {}
        for item in selected:
            name = str(item.get("name") or item.get("fullName") or " ".join(str(item.get(key) or "") for key in ("first_name", "last_name"))).strip()
            if not name:
                continue
            stable, profile = _identity(item)
            upstream = "person_" + hashlib.sha256(stable.encode()).hexdigest()[:16]
            chosen[upstream] = item
            fields = [("full_name", name), ("company_id", company_id), ("title", str(item.get("position") or "")), ("snov_prospect_id", stable)] + ([("profile_url", profile)] if profile else [])
            for field, value in fields:
                observations.append(SourceObservation("obs_" + hashlib.sha256(f"{request.request_id}|{upstream}|{field}".encode()).hexdigest()[:16], "person", upstream, field, json.dumps(value), f"{payload['finder_run_id']}|snov_domain", None, at, 1.0, None))
        for item in rows:
            if _title_matches(str(item.get("position") or ""), rules, self.title_function_exclusions):
                continue
            name = str(item.get("name") or item.get("fullName") or " ".join(str(item.get(key) or "") for key in ("first_name", "last_name"))).strip()
            stable, profile = _identity(item)
            upstream = "person_" + hashlib.sha256(stable.encode()).hexdigest()[:16]
            fields = [("company_id", company_id), ("title", str(item.get("position") or "")), ("snov_prospect_id", stable)]
            if name:
                fields.insert(0, ("full_name", name))
            if profile:
                fields.append(("profile_url", profile))
            for field, value in fields:
                non_candidate_observations.append(SourceObservation(
                    "obs_" + hashlib.sha256(f"{request.request_id}|unmatched|{upstream}|{field}".encode()).hexdigest()[:16],
                    "person", upstream, field, json.dumps(value),
                    f"{payload['finder_run_id']}|snov_domain_unmatched", None, at, 1.0, None,
                ))
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            for observation in non_candidate_observations:
                insert_source_observation(self.connection, observation)
            batch = LaneBatch(tuple(observations), None, 1, len(chosen), True, None)
            _persist_batch(self.connection, str(payload["finder_run_id"]), "snov_domain", batch)
            persons = _canonical_person_ids(self.connection, batch)
            attempt_id = "pa_" + hashlib.sha256(request.request_id.encode()).hexdigest()[:16]
            if persons:
                self.connection.execute(
                    """INSERT INTO provider_attempt(
                           attempt_id,person_id,provider,call,input_hash,priority,credits,result,
                           started_at,finished_at,raw_response_ref
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (attempt_id, next(iter(persons.values())), "snov", "domain_search",
                     hashlib.sha256(request.request_id.encode()).hexdigest(), 0, credits,
                     "valid", at, at, None),
                )
                self.connection.execute(
                    """INSERT INTO provider_attempt_meta(attempt_id,api_version,task_hash,result_url)
                       VALUES(?,?,?,?)""",
                    (attempt_id, api_version, task_hash or None, result_url or None),
                )
            for upstream, person_id in persons.items():
                item = chosen[upstream]
                _stable, source_page = _identity(item)
                employment_id = "emp_" + hashlib.sha256(f"{person_id}|{company_id}".encode()).hexdigest()[:16]
                if self.connection.execute("SELECT 1 FROM employment WHERE person_id=? AND company_id=? AND valid_to IS NULL", (person_id, company_id)).fetchone() is None:
                    observation_id = "obs_" + hashlib.sha256(f"{request.request_id}|{employment_id}".encode()).hexdigest()[:16]
                    insert_source_observation(self.connection, SourceObservation(observation_id, "employment", employment_id, "company_id", json.dumps(company_id), f"{payload['finder_run_id']}|snov_domain", None, at, 1.0, None))
                    insert_employment(self.connection, Employment(employment_id, person_id, company_id, str(item.get("position") or "unknown"), None, None, observation_id, 1.0))
                search_start = str(item.get("search_emails_start") or "").strip()
                if search_start:
                    self.connection.execute(
                        """INSERT INTO snov_prospect(person_id,company_id,source_page,search_emails_start)
                           VALUES(?,?,?,?)
                           ON CONFLICT(person_id) DO UPDATE SET
                             company_id=excluded.company_id, source_page=excluded.source_page,
                             search_emails_start=excluded.search_emails_start""",
                        (person_id, company_id, source_page, search_start),
                    )
            fill_owned = self.connection.execute(
                "SELECT 1 FROM fill_discovery WHERE finder_run_id=?", (payload["finder_run_id"],)
            ).fetchone() is not None
            if fill_owned:
                self.connection.execute(
                    "UPDATE fill_discovery SET next_page=?,exhausted=?,updated_at=? WHERE finder_run_id=?",
                    (next_page, int(next_page is None), at, payload["finder_run_id"]),
                )
            continuation_reason = None
            if next_page is not None and not fill_owned:
                continuation_reason = self._queue_continuation(str(run["campaign_id"]), str(payload["finder_run_id"]), request.policy_hash, company_id, domain, next_page, at)
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            _release_reservation(self.connection, str(reservation["reservation_id"]), at)
            raise
        settle_credit(self.connection, str(reservation["reservation_id"]), credits, at)
        return continuation_reason

    def _mark_in_progress(self, request_id: str, task_hash: str, result_url: str, at: str) -> None:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                """INSERT INTO snov_domain_search(request_id,task_hash,result_url,started_at) VALUES(?,?,?,?)
                   ON CONFLICT(request_id) DO UPDATE SET task_hash=excluded.task_hash,result_url=excluded.result_url""",
                (request_id, task_hash, result_url, at),
            )
            self.connection.execute(
                "UPDATE exec_request SET state='uncertain',reason='snov_domain_search_in_progress' WHERE request_id=? AND state='claimed'",
                (request_id,),
            )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise

    def _mark_start_uncertain(self, request_id: str, at: str) -> None:
        """Retain the reservation when a v2 start may already have reached Snov."""
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute(
                """INSERT INTO snov_domain_search(request_id,task_hash,result_url,started_at) VALUES(?,?,?,?)
                   ON CONFLICT(request_id) DO UPDATE SET task_hash=excluded.task_hash,result_url=excluded.result_url""",
                (request_id, SNOV_DOMAIN_START_PENDING, SNOV_DOMAIN_START_PENDING_URL, at),
            )
            self.connection.execute(
                "UPDATE exec_request SET state='uncertain',reason='snov_domain_start_uncertain' WHERE request_id=? AND state='claimed'",
                (request_id,),
            )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise

    def _queue_continuation(self, campaign_id: str, run_id: str, policy_hash: str, company_id: str, domain: str, page: int, at: str) -> str | None:
        if _page_count(self.connection, run_id) >= self.max_pages:
            return "skipped_budget"
        request_id = _request_id(run_id, company_id, page)
        if self.connection.execute("SELECT 1 FROM exec_request WHERE request_id=?", (request_id,)).fetchone():
            return None
        campaign = self.connection.execute("SELECT credit_budget,approval_tier FROM campaign WHERE campaign_id=?", (campaign_id,)).fetchone()
        used = self.connection.execute("SELECT COALESCE(SUM(CASE WHEN state='reserved' THEN max_cost WHEN state IN ('settled','overage_error') THEN actual_cost ELSE 0 END),0) FROM credit_reservation WHERE campaign_id=?", (campaign_id,)).fetchone()[0]
        if campaign is None or int(used) + SNOV_DOMAIN_PAGE_MAX_CREDITS > int(campaign["credit_budget"]):
            return "skipped_budget"
        if _snov_account_used(self.connection) + SNOV_DOMAIN_PAGE_MAX_CREDITS > snov_account_credit_ceiling(self.connection):
            return "skipped_budget"
        vendor = ExecRequest(request_id, "prospecting-list-builder", "vendor_lookup", {"campaign_id": campaign_id, "person_id": "per_" + hashlib.sha256(company_id.encode()).hexdigest()[:16], "provider": "snov"}, policy_hash, None, at)
        validate_exec_request(vendor, str(campaign["approval_tier"]), self.connection)
        self.connection.execute("INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,approval_id,created_at,state,reason) VALUES(?,?,?,?,?,?,?,?,?)", (request_id, vendor.caller, "finder_page", json.dumps({"finder_run_id": run_id, "lane": "snov_domain"}, sort_keys=True, separators=(",", ":")), policy_hash, None, at, "queued", None))
        self.connection.execute("INSERT INTO credit_reservation(reservation_id,campaign_id,provider,exec_request_id,max_cost,actual_cost,state,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?)", (str(uuid.uuid5(uuid.NAMESPACE_URL, request_id)), campaign_id, "snov", request_id, SNOV_DOMAIN_PAGE_MAX_CREDITS, None, "reserved", at, None))
        self.connection.execute("INSERT INTO snov_domain_page(request_id,finder_run_id,company_id,domain,last_id) VALUES(?,?,?,?,?)", (request_id, run_id, company_id, domain, str(page)))
        return None


def register_snov_domain_lane() -> None:
    try:
        register_lane("snov_domain", SnovDomainLane)
    except ValueError as error:
        if str(error) != "duplicate_lane:snov_domain":
            raise


__all__ = ["DEFAULT_MAX_PAGES", "DEFAULT_TITLE_FUNCTION_EXCLUSIONS", "FILL_MAX_PAGES_PER_FIRM", "SnovBudgetRefused", "SnovDomainAdapter", "SnovDomainLane", "domain_map_path", "load_company_domains", "persist_company_domain", "queue_finder_page", "register_snov_domain_lane"]
