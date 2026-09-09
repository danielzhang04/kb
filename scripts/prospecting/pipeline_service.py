"""Desktop-local, versioned intake for the reusable outreach skill pipeline.

This slice records only the requested research policy and its first waiting stage.
It does not launch research, qualify companies or people, or create review receipts.
Funding-window comparison is inclusive: a later qualification stage may accept an
announcement when ``announced_at >= cutoff_date``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import json
from types import MappingProxyType
import re
import sqlite3
import uuid
from collections.abc import Callable, Mapping


FUNDING_STAGES = (
    "pre_seed", "seed", "series_a", "series_b", "series_c", "series_d",
    "series_e", "series_f", "series_g", "growth",
)
FUNDING_INTERPRETATIONS = frozenset({"latest_known", "any_eligible_within_window"})
SUGGESTED_ROLE_FAMILIES = (
    "operations", "business_operations", "strategy", "strategy_operations",
    "chief_of_staff",
)
SCOPE_MODES = frozenset({"specific", "any", "unknown"})
MAX_PRIVATE_CONTEXT_BYTES = 16 * 1024
WORKFLOW_ID = "outreach-skill"
WORKFLOW_VERSION = 1
MAX_REPAIR_CYCLES = 2
_CAMPAIGN_ID = re.compile(r"camp_[0-9a-f]{16}\Z")
_RUN_ID = re.compile(r"prun_[0-9a-f]{32}\Z")
_ROLE_FAMILY = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
_VALUE_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_WORKFLOW_MANIFEST = {
    "id": WORKFLOW_ID,
    "version": WORKFLOW_VERSION,
    "max_repair_cycles": MAX_REPAIR_CYCLES,
    "stages": (
        "research", "qualification_factcheck", "rank", "draft", "humanizer",
        "post_humanization_factcheck", "independent_critic", "human_review",
    ),
    "initial_adapter": "unconfigured",
}


class PipelineError(ValueError):
    """A stable-code refusal at the desktop-local pipeline boundary."""


@dataclass(frozen=True)
class ScopeSpec:
    mode: str
    values: tuple[str, ...] = ()


@dataclass(frozen=True)
class PipelineStartRequest:
    request_id: str
    campaign_id: str
    as_of_date: str
    funding_stage_min: str
    funding_stage_max: str
    funding_window_years: int
    funding_stage_interpretation: str
    geography: ScopeSpec
    sector: ScopeSpec
    requested_companies: int
    requested_people_per_company: int
    role_families: tuple[str, ...]
    original_specification: str = ""
    outreach_goal: str = ""


@dataclass(frozen=True)
class PipelineProjection:
    run_id: str
    intake_id: str
    intake_revision: int
    intake_hash: str
    campaign_id: str
    campaign_policy_hash: str
    workflow_id: str
    workflow_version: int
    workflow_hash: str
    state: str
    next_stage: str
    cutoff_date: str
    pending_fields: tuple[str, ...]
    as_of_date: str
    funding_stage_min: str
    funding_stage_max: str
    funding_window_years: int
    funding_stage_interpretation: str
    geography: ScopeSpec
    sector: ScopeSpec
    requested_companies: int
    requested_people_per_company: int
    role_families: tuple[str, ...]
    original_specification: str
    outreach_goal: str


@dataclass(frozen=True)
class PipelineSafeProjection:
    run_id: str
    intake_id: str
    intake_revision: int
    intake_hash: str
    campaign_id: str
    campaign_policy_hash: str
    workflow_id: str
    workflow_version: int
    workflow_hash: str
    state: str
    next_stage: str
    pending_fields: tuple[str, ...]
    counts: Mapping[str, int]


@dataclass(frozen=True)
class PipelineStartResult:
    run_id: str
    intake_id: str
    intake_revision: int
    intake_hash: str
    campaign_id: str
    campaign_policy_hash: str
    workflow_id: str
    workflow_version: int
    workflow_hash: str
    state: str
    next_stage: str
    cutoff_date: str
    pending_fields: tuple[str, ...]
    replayed: bool


def _canonical(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


WORKFLOW_HASH = _digest(_WORKFLOW_MANIFEST)


def calendar_cutoff(as_of: date, years: int) -> date:
    """Subtract calendar years, clamping February 29 to February 28."""
    target_year = as_of.year - years
    if target_year < 1:
        raise PipelineError("invalid_funding_window")
    try:
        return as_of.replace(year=target_year)
    except ValueError:
        return as_of.replace(year=target_year, day=28)


def _request_id(value: object) -> str:
    if type(value) is not str:
        raise PipelineError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise PipelineError("invalid_request_id") from None
    if str(parsed) != value:
        raise PipelineError("invalid_request_id")
    return value


def _campaign_id(value: object) -> str:
    if type(value) is not str or _CAMPAIGN_ID.fullmatch(value) is None:
        raise PipelineError("invalid_campaign_id")
    return value


def _as_of_date(value: object) -> date:
    if type(value) is not str:
        raise PipelineError("invalid_as_of_date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise PipelineError("invalid_as_of_date") from None
    if parsed.isoformat() != value:
        raise PipelineError("invalid_as_of_date")
    return parsed


def _scope(value: object, kind: str) -> ScopeSpec:
    if (
        not isinstance(value, ScopeSpec)
        or type(value.mode) is not str
        or value.mode not in SCOPE_MODES
    ):
        raise PipelineError(f"invalid_{kind}_scope")
    if type(value.values) is not tuple:
        raise PipelineError(f"invalid_{kind}")
    cleaned: list[str] = []
    for item in value.values:
        if type(item) is not str:
            raise PipelineError(f"invalid_{kind}")
        try:
            encoded = item.encode("utf-8")
        except UnicodeError:
            raise PipelineError(f"invalid_{kind}") from None
        if (
            not item.strip() or item != item.strip()
            or len(encoded) > 128 or _VALUE_CONTROL.search(item)
        ):
            raise PipelineError(f"invalid_{kind}")
        cleaned.append(item)
    if value.mode == "specific" and not cleaned:
        raise PipelineError(f"invalid_{kind}")
    if value.mode != "specific" and cleaned:
        raise PipelineError(f"invalid_{kind}")
    if len({item.casefold() for item in cleaned}) != len(cleaned) or len(cleaned) > 32:
        raise PipelineError(f"invalid_{kind}")
    return ScopeSpec(value.mode, tuple(sorted(cleaned, key=lambda item: item.casefold())))


def _context(original: object, goal: object) -> tuple[str, str]:
    if type(original) is not str or type(goal) is not str or "\x00" in original or "\x00" in goal:
        raise PipelineError("invalid_request")
    try:
        size = len(original.encode("utf-8")) + len(goal.encode("utf-8"))
    except UnicodeError:
        raise PipelineError("invalid_request") from None
    if size > MAX_PRIVATE_CONTEXT_BYTES:
        raise PipelineError("invalid_request")
    return original, goal


def _validated(request: object) -> tuple[PipelineStartRequest, date]:
    if not isinstance(request, PipelineStartRequest):
        raise PipelineError("invalid_request")
    request_id = _request_id(request.request_id)
    campaign_id = _campaign_id(request.campaign_id)
    as_of = _as_of_date(request.as_of_date)
    if request.funding_stage_min not in FUNDING_STAGES or request.funding_stage_max not in FUNDING_STAGES:
        raise PipelineError("invalid_funding_stage")
    if FUNDING_STAGES.index(request.funding_stage_min) > FUNDING_STAGES.index(request.funding_stage_max):
        raise PipelineError("invalid_funding_stage_range")
    if type(request.funding_window_years) is not int or not 1 <= request.funding_window_years <= 25:
        raise PipelineError("invalid_funding_window")
    if (
        type(request.funding_stage_interpretation) is not str
        or request.funding_stage_interpretation not in FUNDING_INTERPRETATIONS
    ):
        raise PipelineError("invalid_funding_interpretation")
    geography = _scope(request.geography, "geography")
    sector = _scope(request.sector, "sector")
    if type(request.requested_companies) is not int or not 1 <= request.requested_companies <= 200:
        raise PipelineError("invalid_requested_companies")
    if (
        type(request.requested_people_per_company) is not int
        or not 1 <= request.requested_people_per_company <= 20
    ):
        raise PipelineError("invalid_people_per_company")
    if type(request.role_families) is not tuple or not 1 <= len(request.role_families) <= 10:
        raise PipelineError("invalid_role_families")
    if any(
        type(item) is not str or _ROLE_FAMILY.fullmatch(item) is None
        for item in request.role_families
    ) or len(set(request.role_families)) != len(request.role_families):
        raise PipelineError("invalid_role_families")
    roles = tuple(sorted(request.role_families))
    original, goal = _context(request.original_specification, request.outreach_goal)
    return PipelineStartRequest(
        request_id, campaign_id, as_of.isoformat(), request.funding_stage_min,
        request.funding_stage_max, request.funding_window_years,
        request.funding_stage_interpretation, geography, sector,
        request.requested_companies, request.requested_people_per_company, roles,
        original, goal,
    ), as_of


def _payload(request: PipelineStartRequest, campaign_policy_hash: str) -> dict[str, object]:
    return {
        "campaign_id": request.campaign_id,
        "campaign_policy_hash": campaign_policy_hash,
        "as_of_date": request.as_of_date,
        "funding_stage_min": request.funding_stage_min,
        "funding_stage_max": request.funding_stage_max,
        "funding_window_years": request.funding_window_years,
        "funding_stage_interpretation": request.funding_stage_interpretation,
        "geography": {"mode": request.geography.mode, "values": list(request.geography.values)},
        "sector": {"mode": request.sector.mode, "values": list(request.sector.values)},
        "requested_companies": request.requested_companies,
        "requested_people_per_company": request.requested_people_per_company,
        "role_families": list(request.role_families),
        "original_specification": request.original_specification,
        "outreach_goal": request.outreach_goal,
    }


def _derived_id(prefix: str, request_id: str) -> str:
    return prefix + uuid.uuid5(uuid.NAMESPACE_URL, f"kb:prospecting:pipeline:{prefix}:{request_id}").hex


def _decode_tuple(value: object, code: str) -> tuple[str, ...]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise PipelineError(code) from None
    if not isinstance(parsed, list) or any(type(item) is not str for item in parsed):
        raise PipelineError(code)
    return tuple(parsed)


class PipelineService:
    def __init__(
        self, connection: sqlite3.Connection, *,
        now: Callable[[], str] | None = None,
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now or (
            lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        )

    def _campaign_policy_hash(self, campaign_id: str) -> str:
        row = self.connection.execute(
            "SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,),
        ).fetchone()
        if row is None:
            raise PipelineError("campaign_missing")
        value = str(row[0])
        if re.fullmatch(r"[0-9a-f]{64}", value) is None:
            raise PipelineError("campaign_state_invalid")
        return value

    def start_or_resume(self, request: PipelineStartRequest) -> PipelineStartResult:
        request, as_of = _validated(request)
        if self.connection.in_transaction:
            raise PipelineError("transaction_active")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            policy_hash = self._campaign_policy_hash(request.campaign_id)
            payload = _payload(request, policy_hash)
            request_hash = _digest({"operation": "start_pipeline", **payload})
            replay = self.connection.execute(
                "SELECT intake_id,request_hash FROM prospecting_pipeline_intake WHERE request_id=?",
                (request.request_id,),
            ).fetchone()
            if replay is not None:
                if str(replay["request_hash"]) != request_hash:
                    raise PipelineError("request_conflict")
                row = self.connection.execute(
                    "SELECT run_id FROM prospecting_pipeline_run WHERE intake_id=?",
                    (replay["intake_id"],),
                ).fetchone()
                if row is None:
                    raise PipelineError("store_state_invalid")
                projection = self._get_projection(str(row["run_id"]))
                self.connection.commit()
                return self._start_result(projection, True)

            revision = int(self.connection.execute(
                "SELECT COALESCE(MAX(intake_revision),0)+1 FROM prospecting_pipeline_intake WHERE campaign_id=?",
                (request.campaign_id,),
            ).fetchone()[0])
            intake_hash = _digest({
                "intake_version": 1, "intake_revision": revision, **payload,
            })
            intake_id = _derived_id("pint_", request.request_id)
            run_id = _derived_id("prun_", request.request_id)
            cutoff = calendar_cutoff(as_of, request.funding_window_years).isoformat()
            pending = tuple(
                name for name, scope in (
                    ("geography", request.geography), ("sector", request.sector),
                ) if scope.mode == "unknown"
            )
            state = "input_pending" if pending else "awaiting_research_adapter"
            stamp = self.now()
            self.connection.execute(
                """INSERT INTO prospecting_pipeline_intake VALUES(
                       ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                   )""",
                (
                    intake_id, request.request_id, request_hash, request.campaign_id,
                    policy_hash, revision, intake_hash, request.as_of_date,
                    request.funding_stage_min, request.funding_stage_max,
                    request.funding_window_years, request.funding_stage_interpretation,
                    request.geography.mode, json.dumps(list(request.geography.values)),
                    request.sector.mode, json.dumps(list(request.sector.values)),
                    request.requested_companies, request.requested_people_per_company,
                    json.dumps(list(request.role_families)), request.original_specification,
                    request.outreach_goal, cutoff, stamp,
                ),
            )
            self.connection.execute(
                """INSERT INTO prospecting_pipeline_run VALUES(
                       ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                   )""",
                (
                    run_id, intake_id, request.campaign_id, intake_hash, policy_hash,
                    WORKFLOW_ID, WORKFLOW_VERSION, WORKFLOW_HASH, state, "research", 0,
                    MAX_REPAIR_CYCLES, json.dumps(list(pending)), stamp, stamp,
                ),
            )
            stage_input_hash = _digest({
                "run_id": run_id, "intake_hash": intake_hash,
                "workflow_hash": WORKFLOW_HASH, "stage_id": "research", "cycle": 0,
            })
            self.connection.execute(
                "INSERT INTO prospecting_pipeline_stage_state VALUES(?,?,?,?,?,?,?)",
                (
                    run_id, "research", 0,
                    "input_pending" if pending else "awaiting_adapter",
                    stage_input_hash, stamp, stamp,
                ),
            )
            projection = self._get_projection(run_id)
            self.connection.commit()
            return self._start_result(projection, False)
        except BaseException:
            self.connection.rollback()
            raise

    @staticmethod
    def _start_result(value: PipelineProjection, replayed: bool) -> PipelineStartResult:
        return PipelineStartResult(
            value.run_id, value.intake_id, value.intake_revision, value.intake_hash,
            value.campaign_id, value.campaign_policy_hash, value.workflow_id,
            value.workflow_version, value.workflow_hash, value.state, value.next_stage,
            value.cutoff_date, value.pending_fields, replayed,
        )

    def _get_projection(self, run_id: str) -> PipelineProjection:
        row = self.connection.execute(
            """SELECT run.*,intake.* FROM prospecting_pipeline_run AS run
                 JOIN prospecting_pipeline_intake AS intake ON intake.intake_id=run.intake_id
                WHERE run.run_id=?""", (run_id,),
        ).fetchone()
        if row is None:
            raise PipelineError("run_missing")
        geography = ScopeSpec(str(row["geography_mode"]), _decode_tuple(row["geography_json"], "store_state_invalid"))
        sector = ScopeSpec(str(row["sector_mode"]), _decode_tuple(row["sector_json"], "store_state_invalid"))
        roles = _decode_tuple(row["role_families_json"], "store_state_invalid")
        pending = _decode_tuple(row["pending_fields_json"], "store_state_invalid")
        stored_request = PipelineStartRequest(
            str(row["request_id"]), str(row["campaign_id"]), str(row["as_of_date"]),
            str(row["funding_stage_min"]), str(row["funding_stage_max"]),
            int(row["funding_window_years"]), str(row["funding_stage_interpretation"]),
            geography, sector, int(row["requested_companies"]),
            int(row["requested_people_per_company"]), roles,
            str(row["original_specification"]), str(row["outreach_goal"]),
        )
        normalized, as_of = _validated(stored_request)
        policy_hash = self._campaign_policy_hash(normalized.campaign_id)
        payload = _payload(normalized, policy_hash)
        expected_request_hash = _digest({"operation": "start_pipeline", **payload})
        expected_intake_hash = _digest({
            "intake_version": 1, "intake_revision": int(row["intake_revision"]), **payload,
        })
        expected_pending = tuple(
            name for name, scope in (("geography", geography), ("sector", sector))
            if scope.mode == "unknown"
        )
        expected_state = "input_pending" if expected_pending else "awaiting_research_adapter"
        stage = self.connection.execute(
            "SELECT * FROM prospecting_pipeline_stage_state WHERE run_id=? AND stage_id='research' AND cycle=0",
            (run_id,),
        ).fetchone()
        expected_stage_hash = _digest({
            "run_id": run_id, "intake_hash": expected_intake_hash,
            "workflow_hash": WORKFLOW_HASH, "stage_id": "research", "cycle": 0,
        })
        if (
            str(row["campaign_policy_hash"]) != policy_hash
            or str(row["request_hash"]) != expected_request_hash
            or str(row["intake_hash"]) != expected_intake_hash
            or str(row["workflow_id"]) != WORKFLOW_ID
            or int(row["workflow_version"]) != WORKFLOW_VERSION
            or str(row["workflow_hash"]) != WORKFLOW_HASH
            or str(row["state"]) != expected_state
            or str(row["next_stage"]) != "research"
            or int(row["repair_cycle"]) != 0
            or int(row["max_repair_cycles"]) != MAX_REPAIR_CYCLES
            or pending != expected_pending
            or str(row["cutoff_date"]) != calendar_cutoff(as_of, normalized.funding_window_years).isoformat()
            or stage is None
            or str(stage["state"]) != ("input_pending" if expected_pending else "awaiting_adapter")
            or str(stage["input_hash"]) != expected_stage_hash
        ):
            raise PipelineError("store_state_invalid")
        return PipelineProjection(
            run_id, str(row["intake_id"]), int(row["intake_revision"]),
            expected_intake_hash, normalized.campaign_id, policy_hash, WORKFLOW_ID,
            WORKFLOW_VERSION, WORKFLOW_HASH, expected_state, "research",
            str(row["cutoff_date"]), expected_pending, normalized.as_of_date,
            normalized.funding_stage_min, normalized.funding_stage_max,
            normalized.funding_window_years, normalized.funding_stage_interpretation,
            geography, sector, normalized.requested_companies,
            normalized.requested_people_per_company, roles,
            normalized.original_specification, normalized.outreach_goal,
        )

    def get_projection(self, run_id: str) -> PipelineProjection:
        if type(run_id) is not str or _RUN_ID.fullmatch(run_id) is None:
            raise PipelineError("run_missing")
        return self._get_projection(run_id)

    def get_latest_projection(self, campaign_id: str) -> PipelineProjection | None:
        campaign_id = _campaign_id(campaign_id)
        self._campaign_policy_hash(campaign_id)
        row = self.connection.execute(
            """SELECT run.run_id FROM prospecting_pipeline_intake AS intake
                 LEFT JOIN prospecting_pipeline_run AS run ON run.intake_id=intake.intake_id
                WHERE intake.campaign_id=?
                ORDER BY intake.intake_revision DESC,intake.intake_id DESC LIMIT 1""",
            (campaign_id,),
        ).fetchone()
        if row is None:
            return None
        if row["run_id"] is None:
            raise PipelineError("store_state_invalid")
        return self._get_projection(str(row["run_id"]))

    def get_safe_projection(self, run_id: str) -> PipelineSafeProjection:
        value = self.get_projection(run_id)
        return PipelineSafeProjection(
            value.run_id, value.intake_id, value.intake_revision, value.intake_hash,
            value.campaign_id, value.campaign_policy_hash, value.workflow_id,
            value.workflow_version, value.workflow_hash, value.state, value.next_stage,
            value.pending_fields,
            MappingProxyType({
                "requested_companies": value.requested_companies,
                "requested_people_per_company": value.requested_people_per_company,
            }),
        )


__all__ = [
    "FUNDING_STAGES", "MAX_PRIVATE_CONTEXT_BYTES", "PipelineError",
    "PipelineProjection", "PipelineSafeProjection", "PipelineService",
    "PipelineStartRequest", "PipelineStartResult", "ScopeSpec", "SUGGESTED_ROLE_FAMILIES",
    "WORKFLOW_HASH", "WORKFLOW_ID", "WORKFLOW_VERSION", "calendar_cutoff",
]
