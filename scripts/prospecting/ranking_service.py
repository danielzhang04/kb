"""Deterministic role ordering over exact source-supported P19 results."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
import sqlite3
from types import MappingProxyType
import uuid

from scripts.prospecting.pipeline_service import PipelineError, PipelineService
from scripts.prospecting.qualification_service import (
    QualificationError,
    QualificationService,
    QualificationSupportedCandidate,
    QualificationSupportedScope,
)


ROLE_POLICY_VERSION = "requested-role-ordering-v1"
_ROLE_POLICY = {
    "version": ROLE_POLICY_VERSION,
    "families": (
        "operations", "business_operations", "strategy",
        "strategy_operations", "chief_of_staff",
    ),
    "direct_phrases": {
        "operations": ("chief operating officer", "coo"),
        "business_operations": ("business operations", "bizops"),
        "strategy": ("corporate strategy",),
        "strategy_operations": (
            "strategy and operations", "strategy and ops", "strategy operations",
        ),
        "chief_of_staff": ("chief of staff",),
    },
    "generic_operations_exclusions": (
        "sales", "revenue", "people", "human resources", "hr", "marketing",
        "product", "finance", "financial", "legal", "dev", "developer",
        "development", "devops", "it", "security",
    ),
    "generic_phrases": {
        "operations": ("operations", "ops"),
        "strategy": ("strategy",),
    },
    "specific_fallbacks": {
        "business_operations": ("operations",),
        "strategy_operations": ("operations", "strategy"),
    },
    "match_tiers": {"direct": 0, "compound": 0, "generic": 1},
    "tie_break": ("match_tier", "p18_ordinal", "candidate_id"),
}


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise RankingError("invalid_request") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def _array(value: object) -> tuple[str, ...]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError, RecursionError):
        raise RankingError("store_state_invalid") from None
    if (
        type(parsed) is not list
        or any(type(item) is not str or not item for item in parsed)
        or len(set(parsed)) != len(parsed)
    ):
        raise RankingError("store_state_invalid")
    return tuple(parsed)


ROLE_POLICY_HASH = _digest(_ROLE_POLICY)
_RUN_ID = re.compile(r"prun_[0-9a-f]{32}\Z")
_SAFE_ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,127}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_SUPPORTED_FAMILIES = frozenset(_ROLE_POLICY["families"])


class RankingError(ValueError):
    """Stable-code refusal at the deterministic ranking boundary."""


@dataclass(frozen=True, repr=False)
class RankingStartRequest:
    request_id: str
    run_id: str
    expected_intake_hash: str
    qualification_batch_id: str
    qualification_batch_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None


@dataclass(frozen=True, repr=False)
class RankedPersonProjection:
    person_rank_id: str
    representative_candidate_id: str
    source_candidate_ids: tuple[str, ...]
    person_id: str
    employment_id: str
    candidate_observation_id: str
    employment_observation_id: str
    title: str
    title_hash: str
    qualification_outcome: str
    mapped_family: str | None
    match_kind: str
    match_tier: int | None
    rank_ordinal: int | None
    selected: bool
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, repr=False)
class RankedCompanyProjection:
    company_rank_id: str
    qualification_item_id: str
    qualification_artifact_id: str
    qualification_output_hash: str
    funding_result_id: str
    company_id: str
    company_outcome: str
    desired_count: int
    eligible_count: int
    selected_count: int
    shortfall: int
    reason_codes: tuple[str, ...]
    people: tuple[RankedPersonProjection, ...]


@dataclass(frozen=True, repr=False)
class RankingProjection:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_hash: str
    campaign_policy_hash: str
    qualification_batch_id: str
    qualification_batch_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    role_policy_version: str
    role_policy_hash: str
    requested_role_families: tuple[str, ...]
    state: str
    companies: tuple[RankedCompanyProjection, ...]


@dataclass(frozen=True)
class RankingSafeProjection:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_hash: str
    qualification_batch_id: str
    qualification_batch_hash: str
    state: str
    counts: Mapping[str, int]


@dataclass(frozen=True)
class RankingResult:
    batch_id: str
    batch_hash: str
    run_id: str
    state: str
    counts: Mapping[str, int]
    replayed: bool = False


def _uuid(value: object, code: str) -> str:
    if type(value) is not str:
        raise RankingError(code)
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise RankingError(code) from None
    if parsed.version != 4 or str(parsed) != value:
        raise RankingError(code)
    return value


def _id(value: object, code: str) -> str:
    if type(value) is not str or _SAFE_ID.fullmatch(value) is None:
        raise RankingError(code)
    return value


def _hash(value: object, code: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        raise RankingError(code)
    return value


def _now(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise RankingError("aware_now_required")
    return value.astimezone(timezone.utc)


def _normal(value: str) -> str:
    value = value.casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


def _contains_phrase(title: str, phrase: str) -> bool:
    return re.search(rf"(?:^| ){re.escape(phrase)}(?: |$)", title) is not None


def _role_match(title: str, requested: frozenset[str]) -> tuple[str | None, str, int | None, tuple[str, ...]]:
    normal = _normal(title)
    matches: list[tuple[int, int, str, str]] = []
    family_order = {family: index for index, family in enumerate(_ROLE_POLICY["families"])}

    def add(family: str, kind: str, tier: int) -> None:
        if family in requested:
            matches.append((tier, family_order[family], family, kind))

    specific_matches = {
        family: any(_contains_phrase(normal, phrase) for phrase in phrases)
        for family, phrases in _ROLE_POLICY["direct_phrases"].items()
    }
    for family, matched in specific_matches.items():
        if matched:
            kind = "compound" if family == "strategy_operations" else "direct"
            add(family, kind, int(_ROLE_POLICY["match_tiers"][kind]))

    excluded_operations = any(
        re.search(rf"(?:^| ){re.escape(modifier)}(?: and)? (?:operations|ops)(?: |$)", normal)
        for modifier in _ROLE_POLICY["generic_operations_exclusions"]
    )
    has_generic_operations = any(
        _contains_phrase(normal, phrase)
        for phrase in _ROLE_POLICY["generic_phrases"]["operations"]
    )
    if has_generic_operations and not excluded_operations:
        add("operations", "generic", int(_ROLE_POLICY["match_tiers"]["generic"]))
    if any(
        _contains_phrase(normal, phrase)
        for phrase in _ROLE_POLICY["generic_phrases"]["strategy"]
    ):
        add("strategy", "generic", int(_ROLE_POLICY["match_tiers"]["generic"]))
    for specific, fallbacks in _ROLE_POLICY["specific_fallbacks"].items():
        if specific_matches[specific]:
            for family in fallbacks:
                add(family, "generic", int(_ROLE_POLICY["match_tiers"]["generic"]))
    if matches:
        tier, _order, family, kind = min(matches)
        return family, kind, tier, ("requested_role_match",)
    if excluded_operations:
        return None, "excluded", None, ("function_specific_operations_excluded",)
    return None, "unknown", None, ("role_family_unknown",)


class RankingService:
    def __init__(
        self, connection: sqlite3.Connection, *,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now

    def _request(self, value: object) -> RankingStartRequest:
        if not isinstance(value, RankingStartRequest):
            raise RankingError("invalid_request")
        request_id = _uuid(value.request_id, "invalid_request_id")
        if type(value.run_id) is not str or _RUN_ID.fullmatch(value.run_id) is None:
            raise RankingError("invalid_run_id")
        intake_hash = _hash(value.expected_intake_hash, "invalid_intake_hash")
        qualification_id = _id(value.qualification_batch_id, "invalid_qualification_batch")
        qualification_hash = _hash(value.qualification_batch_hash, "invalid_qualification_batch")
        if (value.predecessor_batch_id is None) != (value.predecessor_hash is None):
            raise RankingError("invalid_predecessor")
        predecessor_id = None if value.predecessor_batch_id is None else _id(
            value.predecessor_batch_id, "invalid_predecessor",
        )
        predecessor_hash = None if value.predecessor_hash is None else _hash(
            value.predecessor_hash, "invalid_predecessor",
        )
        return RankingStartRequest(
            request_id, value.run_id, intake_hash, qualification_id,
            qualification_hash, predecessor_id, predecessor_hash,
        )

    def _scope(self, run_id: str) -> tuple[QualificationSupportedScope, object]:
        now_text = _now(self.now()).isoformat()
        try:
            scope = QualificationService(
                self.connection, now=lambda: _now(self.now()),
            ).get_supported_scope(run_id)
            intake = PipelineService(self.connection, now=lambda: now_text).get_projection(run_id)
        except QualificationError as error:
            raise RankingError(str(error)) from None
        except PipelineError:
            raise RankingError("pipeline_context_stale") from None
        if scope is None:
            raise RankingError("qualification_missing")
        return scope, intake

    @staticmethod
    def _group_candidates(
        candidates: tuple[QualificationSupportedCandidate, ...],
    ) -> tuple[tuple[QualificationSupportedCandidate, tuple[QualificationSupportedCandidate, ...], str, tuple[str, ...]], ...]:
        grouped: dict[str, list[QualificationSupportedCandidate]] = defaultdict(list)
        for candidate in candidates:
            grouped[candidate.person_id].append(candidate)
        result = []
        for person_id in sorted(grouped):
            values = tuple(sorted(grouped[person_id], key=lambda row: (row.ordinal, row.candidate_id)))
            representative = values[0]
            reasons: set[str] = set()
            if len(values) > 1:
                reasons.add("duplicate_source_candidates")
            if any(
                value.employment_id != representative.employment_id
                or _normal(value.title) != _normal(representative.title)
                for value in values
            ):
                outcome = "unknown"
                reasons.add("duplicate_binding_disagreement")
            elif any(value.outcome == "contradicted" for value in values):
                outcome = "contradicted"
            elif values and all(value.outcome == "current_role_supported" for value in values):
                outcome = "current_role_supported"
            else:
                outcome = "unknown"
            result.append((representative, values, outcome, tuple(sorted(reasons))))
        return tuple(result)

    def _prepared(self, scope: QualificationSupportedScope, intake, request_id: str):
        requested = frozenset(intake.role_families)
        if not requested or not requested <= _SUPPORTED_FAMILIES:
            raise RankingError("role_policy_unsupported")
        companies = []
        for ordinal, company in enumerate(scope.companies):
            rows = []
            for representative, values, outcome, group_reasons in self._group_candidates(company.candidates):
                family, kind, tier, role_reasons = _role_match(representative.title, requested)
                eligible = (
                    company.company_outcome == "source_supported"
                    and outcome == "current_role_supported" and family is not None
                )
                reasons = set(group_reasons) | set(role_reasons) | {
                    "role_policy_only", "sender_background_not_scored",
                }
                if company.company_outcome != "source_supported":
                    reasons.add("company_qualification_pending")
                if outcome == "contradicted":
                    reasons.add("current_role_contradicted")
                elif outcome != "current_role_supported":
                    reasons.add("current_role_unknown")
                if eligible:
                    reasons.add("stable_tiebreak_p18_ordinal")
                rows.append({
                    "representative": representative, "values": values,
                    "outcome": outcome, "family": family, "kind": kind,
                    "tier": tier, "eligible": eligible, "reasons": reasons,
                })
            eligible = sorted(
                (row for row in rows if row["eligible"]),
                key=lambda row: (
                    int(row["tier"]), row["representative"].ordinal,
                    row["representative"].candidate_id,
                ),
            )
            ranks = {row["representative"].person_id: index for index, row in enumerate(eligible)}
            selected_ids = {
                row["representative"].person_id for row in eligible[:company.desired_people]
            }
            people = []
            for person_ordinal, row in enumerate(sorted(
                rows,
                key=lambda value: (
                    ranks.get(value["representative"].person_id, 1_000_000),
                    value["representative"].ordinal,
                    value["representative"].candidate_id,
                ),
            )):
                representative = row["representative"]
                selected = representative.person_id in selected_ids
                reasons = set(row["reasons"])
                if row["eligible"] and not selected:
                    reasons.add("not_selected_capacity")
                people.append({
                    **row, "ordinal": person_ordinal,
                    "rank": ranks.get(representative.person_id),
                    "selected": selected, "reasons": tuple(sorted(reasons)),
                    "person_rank_id": "prrp_" + uuid.uuid5(
                        uuid.UUID(request_id), f"person:{ordinal}:{representative.person_id}",
                    ).hex,
                })
            selected_count = len(selected_ids)
            company_reasons = []
            if company.company_outcome != "source_supported":
                company_reasons.append("company_qualification_pending")
            elif not eligible:
                company_reasons.append("no_supported_role_match")
            elif selected_count < company.desired_people:
                company_reasons.append("insufficient_supported_role_matches")
            else:
                company_reasons.append("requested_role_count_met")
            companies.append({
                "source": company, "ordinal": ordinal,
                "company_rank_id": "prrc_" + uuid.uuid5(
                    uuid.UUID(request_id), f"company:{ordinal}",
                ).hex,
                "people": people, "eligible": len(eligible), "selected": selected_count,
                "shortfall": company.desired_people - selected_count,
                "reasons": tuple(company_reasons),
            })
        return companies

    def start_or_resume(self, value: RankingStartRequest) -> RankingResult:
        request = self._request(value)
        request_hash = _digest({
            "operation": "start_role_ordering", "request": request.__dict__,
            "role_policy_hash": ROLE_POLICY_HASH,
        })
        if self.connection.in_transaction:
            raise RankingError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            replay = self.connection.execute(
                "SELECT request_hash,batch_id FROM prospecting_ranking_batch WHERE request_id=?",
                (request.request_id,),
            ).fetchone()
            if replay is not None:
                if str(replay["request_hash"]) != request_hash:
                    raise RankingError("request_conflict")
                projection = self._stored_projection(str(replay["batch_id"]))
                self.connection.commit()
                return self._result(projection, True)
            scope, intake = self._scope(request.run_id)
            if (
                scope.intake_hash != request.expected_intake_hash
                or scope.batch_id != request.qualification_batch_id
                or scope.batch_hash != request.qualification_batch_hash
            ):
                raise RankingError("pipeline_context_stale")
            latest = self.connection.execute(
                "SELECT batch_id,batch_hash FROM prospecting_ranking_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
                (request.run_id,),
            ).fetchone()
            expected = None if latest is None else (str(latest[0]), str(latest[1]))
            supplied = None if request.predecessor_batch_id is None else (
                request.predecessor_batch_id, request.predecessor_hash,
            )
            if expected != supplied:
                raise RankingError("predecessor_conflict")
            context_hash = _digest({
                "qualification_batch_hash": scope.batch_hash,
                "role_policy_hash": ROLE_POLICY_HASH,
                "requested_role_families": list(intake.role_families),
                "desired_people_per_company": intake.requested_people_per_company,
            })
            if self.connection.execute(
                "SELECT 1 FROM prospecting_ranking_batch WHERE run_id=? AND input_context_hash=?",
                (request.run_id, context_hash),
            ).fetchone() is not None:
                raise RankingError("ranking_context_unchanged")
            companies = self._prepared(scope, intake, request.request_id)
            batch_id = "prrb_" + uuid.uuid5(uuid.UUID(request.request_id), "ranking-batch").hex
            batch_hash = _digest({
                "batch_id": batch_id, "request_hash": request_hash,
                "input_context_hash": context_hash, "run_id": request.run_id,
                "intake_hash": scope.intake_hash, "campaign_policy_hash": scope.campaign_policy_hash,
                "funding": [scope.funding_batch_id, scope.funding_batch_hash],
                "people": [scope.person_batch_id, scope.person_batch_hash],
                "qualification": [scope.batch_id, scope.batch_hash],
                "predecessor": [request.predecessor_batch_id, request.predecessor_hash],
                "role_policy": [ROLE_POLICY_VERSION, ROLE_POLICY_HASH],
                "requested_role_families": list(intake.role_families),
                "desired_people_per_company": intake.requested_people_per_company,
                "state": "deterministic_role_ordered",
                "companies": self._hashable_companies(companies),
            })
            stamp = _now(self.now()).isoformat()
            self.connection.execute(
                """INSERT INTO prospecting_ranking_batch(
                       batch_id,request_id,request_hash,batch_hash,input_context_hash,
                       run_id,intake_hash,campaign_policy_hash,funding_batch_id,funding_batch_hash,
                       person_batch_id,person_batch_hash,qualification_batch_id,
                       qualification_batch_hash,predecessor_batch_id,predecessor_hash,
                       role_policy_version,role_policy_hash,requested_role_families_json,
                       requested_role_families_hash,desired_people_per_company,state,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'deterministic_role_ordered',?)""",
                (
                    batch_id, request.request_id, request_hash, batch_hash, context_hash,
                    request.run_id, scope.intake_hash, scope.campaign_policy_hash,
                    scope.funding_batch_id, scope.funding_batch_hash,
                    scope.person_batch_id, scope.person_batch_hash, scope.batch_id, scope.batch_hash,
                    request.predecessor_batch_id, request.predecessor_hash,
                    ROLE_POLICY_VERSION, ROLE_POLICY_HASH,
                    _canonical(list(intake.role_families)), _digest(list(intake.role_families)),
                    intake.requested_people_per_company, stamp,
                ),
            )
            for company in companies:
                source = company["source"]
                self.connection.execute(
                    """INSERT INTO prospecting_ranking_company(
                           company_rank_id,batch_id,ordinal,qualification_item_id,
                           qualification_artifact_id,qualification_output_hash,funding_result_id,
                           company_id,company_outcome,desired_count,eligible_count,selected_count,
                           shortfall,reason_codes_json,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        company["company_rank_id"], batch_id, company["ordinal"], source.item_id,
                        source.artifact_id, source.artifact_output_hash, source.funding_result_id,
                        source.company_id, source.company_outcome, source.desired_people,
                        company["eligible"], company["selected"], company["shortfall"],
                        _canonical(list(company["reasons"])), stamp,
                    ),
                )
                for person in company["people"]:
                    representative = person["representative"]
                    source_ids = tuple(value.candidate_id for value in person["values"])
                    self.connection.execute(
                        """INSERT INTO prospecting_ranking_person(
                               person_rank_id,company_rank_id,ordinal,representative_candidate_id,
                               source_candidate_ids_json,source_candidate_ids_hash,person_id,
                               employment_id,candidate_observation_id,employment_observation_id,
                               title,title_hash,qualification_outcome,mapped_family,match_kind,
                               match_tier,rank_ordinal,selected,reason_codes_json,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            person["person_rank_id"], company["company_rank_id"],
                            person["ordinal"], representative.candidate_id, _canonical(list(source_ids)),
                            _digest(list(source_ids)), representative.person_id,
                            representative.employment_id, representative.candidate_observation_id,
                            representative.employment_observation_id, representative.title,
                            representative.title_hash, person["outcome"], person["family"],
                            person["kind"], person["tier"], person["rank"],
                            int(person["selected"]), _canonical(list(person["reasons"])), stamp,
                        ),
                    )
            projection = self._projection(batch_id, scope, intake)
            self.connection.commit()
            return self._result(projection, False)
        except BaseException as error:
            self.connection.rollback()
            if isinstance(error, RankingError):
                raise
            if isinstance(error, sqlite3.Error):
                raise RankingError("store_state_invalid") from None
            raise

    @staticmethod
    def _hashable_companies(companies) -> list[dict[str, object]]:
        return [{
            "company_rank_id": company["company_rank_id"],
            "qualification_item_id": company["source"].item_id,
            "artifact": [company["source"].artifact_id, company["source"].artifact_output_hash],
            "funding_result_id": company["source"].funding_result_id,
            "company_id": company["source"].company_id,
            "company_outcome": company["source"].company_outcome,
            "desired": company["source"].desired_people,
            "eligible": company["eligible"], "selected": company["selected"],
            "shortfall": company["shortfall"], "reasons": list(company["reasons"]),
            "people": [{
                "person_rank_id": person["person_rank_id"],
                "ordinal": person["ordinal"],
                "representative": person["representative"].candidate_id,
                "source_candidates": [value.candidate_id for value in person["values"]],
                "person_id": person["representative"].person_id,
                "employment_id": person["representative"].employment_id,
                "candidate_observation_id": person["representative"].candidate_observation_id,
                "employment_observation_id": person["representative"].employment_observation_id,
                "title_hash": person["representative"].title_hash,
                "qualification_outcome": person["outcome"],
                "family": person["family"], "kind": person["kind"],
                "tier": person["tier"], "rank": person["rank"],
                "selected": person["selected"], "reasons": list(person["reasons"]),
            } for person in company["people"]],
        } for company in companies]

    def _stored_projection(self, batch_id: str) -> RankingProjection:
        batch = self.connection.execute(
            "SELECT * FROM prospecting_ranking_batch WHERE batch_id=?", (batch_id,),
        ).fetchone()
        if batch is None:
            raise RankingError("store_state_invalid")
        companies = []
        hash_companies = []
        for company in self.connection.execute(
            "SELECT * FROM prospecting_ranking_company WHERE batch_id=? ORDER BY ordinal",
            (batch_id,),
        ).fetchall():
            people = []
            hash_people = []
            for person in self.connection.execute(
                "SELECT * FROM prospecting_ranking_person WHERE company_rank_id=? ORDER BY ordinal",
                (company["company_rank_id"],),
            ).fetchall():
                source_ids = _array(person["source_candidate_ids_json"])
                reasons = _array(person["reason_codes_json"])
                if (
                    not source_ids or len(set(source_ids)) != len(source_ids)
                    or _digest(list(source_ids)) != str(person["source_candidate_ids_hash"])
                    or sha256(str(person["title"]).encode()).hexdigest() != str(person["title_hash"])
                ):
                    raise RankingError("store_state_invalid")
                projected = RankedPersonProjection(
                    str(person["person_rank_id"]), str(person["representative_candidate_id"]),
                    source_ids, str(person["person_id"]), str(person["employment_id"]),
                    str(person["candidate_observation_id"]), str(person["employment_observation_id"]),
                    str(person["title"]), str(person["title_hash"]),
                    str(person["qualification_outcome"]),
                    None if person["mapped_family"] is None else str(person["mapped_family"]),
                    str(person["match_kind"]),
                    None if person["match_tier"] is None else int(person["match_tier"]),
                    None if person["rank_ordinal"] is None else int(person["rank_ordinal"]),
                    bool(person["selected"]), reasons,
                )
                people.append(projected)
                hash_people.append({
                    "person_rank_id": projected.person_rank_id,
                    "ordinal": int(person["ordinal"]),
                    "representative": projected.representative_candidate_id,
                    "source_candidates": list(projected.source_candidate_ids),
                    "person_id": projected.person_id, "employment_id": projected.employment_id,
                    "candidate_observation_id": projected.candidate_observation_id,
                    "employment_observation_id": projected.employment_observation_id,
                    "title_hash": projected.title_hash,
                    "qualification_outcome": projected.qualification_outcome,
                    "family": projected.mapped_family, "kind": projected.match_kind,
                    "tier": projected.match_tier, "rank": projected.rank_ordinal,
                    "selected": projected.selected, "reasons": list(projected.reason_codes),
                })
            reasons = _array(company["reason_codes_json"])
            projected_company = RankedCompanyProjection(
                str(company["company_rank_id"]), str(company["qualification_item_id"]),
                str(company["qualification_artifact_id"]), str(company["qualification_output_hash"]),
                str(company["funding_result_id"]), str(company["company_id"]),
                str(company["company_outcome"]), int(company["desired_count"]),
                int(company["eligible_count"]), int(company["selected_count"]),
                int(company["shortfall"]), reasons, tuple(people),
            )
            ranked = [person for person in people if person.rank_ordinal is not None]
            selected = [person for person in people if person.selected]
            if (
                sorted(person.rank_ordinal for person in ranked) != list(range(len(ranked)))
                or len(ranked) != projected_company.eligible_count
                or len(selected) != projected_company.selected_count
                or any(
                    person.rank_ordinal is None
                    or person.rank_ordinal >= projected_company.desired_count
                    for person in selected
                )
            ):
                raise RankingError("store_state_invalid")
            companies.append(projected_company)
            hash_companies.append({
                "company_rank_id": projected_company.company_rank_id,
                "qualification_item_id": projected_company.qualification_item_id,
                "artifact": [projected_company.qualification_artifact_id, projected_company.qualification_output_hash],
                "funding_result_id": projected_company.funding_result_id,
                "company_id": projected_company.company_id,
                "company_outcome": projected_company.company_outcome,
                "desired": projected_company.desired_count,
                "eligible": projected_company.eligible_count,
                "selected": projected_company.selected_count,
                "shortfall": projected_company.shortfall,
                "reasons": list(projected_company.reason_codes), "people": hash_people,
            })
        expected = _digest({
            "batch_id": str(batch["batch_id"]), "request_hash": str(batch["request_hash"]),
            "input_context_hash": str(batch["input_context_hash"]), "run_id": str(batch["run_id"]),
            "intake_hash": str(batch["intake_hash"]),
            "campaign_policy_hash": str(batch["campaign_policy_hash"]),
            "funding": [str(batch["funding_batch_id"]), str(batch["funding_batch_hash"])],
            "people": [str(batch["person_batch_id"]), str(batch["person_batch_hash"])],
            "qualification": [str(batch["qualification_batch_id"]), str(batch["qualification_batch_hash"])],
            "predecessor": [batch["predecessor_batch_id"], batch["predecessor_hash"]],
            "role_policy": [str(batch["role_policy_version"]), str(batch["role_policy_hash"])],
            "requested_role_families": list(_array(batch["requested_role_families_json"])),
            "desired_people_per_company": int(batch["desired_people_per_company"]),
            "state": str(batch["state"]),
            "companies": hash_companies,
        })
        requested_roles = _array(batch["requested_role_families_json"])
        if (
            _digest(list(requested_roles)) != str(batch["requested_role_families_hash"])
            or expected != str(batch["batch_hash"])
        ):
            raise RankingError("store_state_invalid")
        return RankingProjection(
            str(batch["batch_id"]), str(batch["batch_hash"]), str(batch["run_id"]),
            str(batch["intake_hash"]), str(batch["campaign_policy_hash"]),
            str(batch["qualification_batch_id"]), str(batch["qualification_batch_hash"]),
            None if batch["predecessor_batch_id"] is None else str(batch["predecessor_batch_id"]),
            None if batch["predecessor_hash"] is None else str(batch["predecessor_hash"]),
            str(batch["role_policy_version"]), str(batch["role_policy_hash"]),
            requested_roles, str(batch["state"]), tuple(companies),
        )

    def _projection(self, batch_id: str, scope: QualificationSupportedScope, intake) -> RankingProjection:
        value = self._stored_projection(batch_id)
        expected_context = _digest({
            "qualification_batch_hash": scope.batch_hash,
            "role_policy_hash": ROLE_POLICY_HASH,
            "requested_role_families": list(intake.role_families),
            "desired_people_per_company": intake.requested_people_per_company,
        })
        stored_context = self.connection.execute(
            "SELECT input_context_hash,desired_people_per_company FROM prospecting_ranking_batch WHERE batch_id=?",
            (batch_id,),
        ).fetchone()
        if (
            value.run_id != scope.run_id or value.intake_hash != scope.intake_hash
            or value.campaign_policy_hash != scope.campaign_policy_hash
            or value.qualification_batch_id != scope.batch_id
            or value.qualification_batch_hash != scope.batch_hash
            or value.role_policy_version != ROLE_POLICY_VERSION
            or value.role_policy_hash != ROLE_POLICY_HASH
            or value.requested_role_families != tuple(intake.role_families)
            or str(stored_context["input_context_hash"]) != expected_context
            or int(stored_context["desired_people_per_company"])
            != int(intake.requested_people_per_company)
        ):
            raise RankingError("pipeline_context_stale")
        scope_companies = {company.item_id: company for company in scope.companies}
        if len(scope_companies) != len(value.companies):
            raise RankingError("pipeline_context_stale")
        for company in value.companies:
            source = scope_companies.get(company.qualification_item_id)
            if source is None or (
                source.artifact_id != company.qualification_artifact_id
                or source.artifact_output_hash != company.qualification_output_hash
                or source.funding_result_id != company.funding_result_id
                or source.company_id != company.company_id
                or source.company_outcome != company.company_outcome
            ):
                raise RankingError("pipeline_context_stale")
            source_candidates = {candidate.candidate_id: candidate for candidate in source.candidates}
            ranked_source_ids: list[str] = []
            for person in company.people:
                candidates = [source_candidates.get(value) for value in person.source_candidate_ids]
                if any(candidate is None for candidate in candidates):
                    raise RankingError("pipeline_context_stale")
                representative = source_candidates.get(person.representative_candidate_id)
                if representative is None or (
                    representative.person_id != person.person_id
                    or representative.employment_id != person.employment_id
                    or representative.candidate_observation_id != person.candidate_observation_id
                    or representative.employment_observation_id != person.employment_observation_id
                    or representative.title != person.title
                    or representative.title_hash != person.title_hash
                ):
                    raise RankingError("pipeline_context_stale")
                ranked_source_ids.extend(person.source_candidate_ids)
            if (
                len(ranked_source_ids) != len(set(ranked_source_ids))
                or set(ranked_source_ids) != set(source_candidates)
            ):
                raise RankingError("pipeline_context_stale")
        return value

    def get_projection(self, run_id: str) -> RankingProjection | None:
        if type(run_id) is not str or _RUN_ID.fullmatch(run_id) is None:
            raise RankingError("invalid_run_id")
        scope, intake = self._scope(run_id)
        row = self.connection.execute(
            "SELECT batch_id FROM prospecting_ranking_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
            (run_id,),
        ).fetchone()
        return None if row is None else self._projection(str(row[0]), scope, intake)

    def get_safe_projection(self, run_id: str) -> RankingSafeProjection | None:
        value = self.get_projection(run_id)
        if value is None:
            return None
        counts = self._counts(value)
        return RankingSafeProjection(
            value.batch_id, value.batch_hash, value.run_id, value.intake_hash,
            value.qualification_batch_id, value.qualification_batch_hash,
            value.state, counts,
        )

    @staticmethod
    def _counts(value: RankingProjection) -> Mapping[str, int]:
        return MappingProxyType({
            "companies": len(value.companies),
            "eligible_people": sum(company.eligible_count for company in value.companies),
            "selected_people": sum(company.selected_count for company in value.companies),
            "people_shortfall": sum(company.shortfall for company in value.companies),
            "companies_with_shortfall": sum(company.shortfall > 0 for company in value.companies),
        })

    @classmethod
    def _result(cls, value: RankingProjection, replayed: bool) -> RankingResult:
        return RankingResult(
            value.batch_id, value.batch_hash, value.run_id, value.state,
            cls._counts(value), replayed,
        )


__all__ = [
    "ROLE_POLICY_HASH", "ROLE_POLICY_VERSION", "RankedCompanyProjection",
    "RankedPersonProjection", "RankingError", "RankingProjection", "RankingResult",
    "RankingSafeProjection", "RankingService", "RankingStartRequest",
]
