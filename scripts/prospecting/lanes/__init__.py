from __future__ import annotations

from dataclasses import dataclass
import sqlite3
from typing import Callable, Literal, Mapping, Protocol

from scripts.prospecting.store import (
    LaneCapability,
    PredicateOverride,
    SourceObservation,
    select_lanes,
)
from scripts.prospecting.p2_store import TargetPolicy

CapabilityOutcome = Literal["exact", "approximate", "unsupported"]
PREDICATE_TYPES = (
    "industry", "company_type", "company_stage", "company_location", "person_location",
    "title", "seniority", "school", "platform", "company_list",
)
SHORTFALLS = (
    "checkpoint", "cap_reached", "unsupported_predicate", "credit_budget", "lane_exhausted",
)
LANE_CAPABILITY_OUTCOMES: dict[str, dict[str, CapabilityOutcome]] = {
    "manual": {kind: "exact" for kind in PREDICATE_TYPES},
    "pitchbook": {
        "industry": "exact", "company_type": "exact", "company_stage": "exact",
        "company_location": "exact", "person_location": "unsupported", "title": "exact",
        "seniority": "approximate", "school": "unsupported", "platform": "unsupported",
        "company_list": "exact",
    },
    "pdl": {
        "industry": "exact", "company_type": "approximate", "company_stage": "approximate",
        "company_location": "exact", "person_location": "exact", "title": "exact",
        "seniority": "exact", "school": "exact", "platform": "unsupported", "company_list": "exact",
    },
    "class_c_public_profile": {
        "industry": "approximate", "company_type": "approximate", "company_stage": "unsupported",
        "company_location": "approximate", "person_location": "exact", "title": "exact",
        "seniority": "approximate", "school": "exact", "platform": "exact", "company_list": "exact",
    },
    "linkedin_assisted": {
        "industry": "approximate", "company_type": "unsupported", "company_stage": "unsupported",
        "company_location": "approximate", "person_location": "exact", "title": "exact",
        "seniority": "approximate", "school": "approximate", "platform": "exact", "company_list": "exact",
    },
}


def capabilities_for(lane: str, version: str) -> Mapping[str, LaneCapability]:
    try:
        outcomes = LANE_CAPABILITY_OUTCOMES[lane]
    except KeyError as exc:
        raise ValueError(f"unknown_lane:{lane}") from exc
    return {
        kind: LaneCapability(outcome=outcome, reason_code=f"{lane}_v1", version=version)
        for kind, outcome in outcomes.items()
    }


@dataclass(frozen=True)
class YieldEstimate:
    low: int
    expected: int
    high: int

    def __post_init__(self) -> None:
        if not 0 <= self.low <= self.expected <= self.high:
            raise ValueError("invalid_yield_estimate")


@dataclass(frozen=True)
class LanePlan:
    lane: str
    capability_version: str
    capabilities: Mapping[str, LaneCapability]
    yield_estimate: YieldEstimate
    limit: int


@dataclass(frozen=True)
class LaneBatch:
    observations: tuple[SourceObservation, ...]
    next_cursor: str | None
    processed: int
    yielded: int
    exhausted: bool
    shortfall_reason: str | None


@dataclass(frozen=True)
class LaneCursor:
    finder_run_id: str
    lane: str
    cursor: str | None
    processed: int
    yielded: int
    capability_version: str
    updated_at: str


class Lane(Protocol):
    name: str
    capability_version: str

    def capabilities(self) -> Mapping[str, LaneCapability]: ...

    def plan(self, target_policy: TargetPolicy) -> LanePlan: ...

    def run(self, plan: LanePlan, cursor: LaneCursor | None) -> LaneBatch: ...


_REGISTRY: dict[str, Callable[[], Lane]] = {}


def register_lane(name: str, factory: Callable[[], Lane]) -> None:
    if name in _REGISTRY:
        raise ValueError(f"duplicate_lane:{name}")
    _REGISTRY[name] = factory


def get_lane(name: str) -> Lane:
    try:
        return _REGISTRY[name]()
    except KeyError as exc:
        raise ValueError(f"unknown_lane:{name}") from exc


def plan_lanes(
    policy: TargetPolicy,
    lanes: tuple[Lane, ...],
    overrides: frozenset[PredicateOverride],
    campaign_id: str,
    policy_hash: str,
) -> tuple[LanePlan, ...]:
    by_name: dict[str, Lane] = {}
    capability_maps: dict[str, Mapping[str, LaneCapability]] = {}
    for lane in lanes:
        mapping = lane.capabilities()
        if set(mapping) != set(PREDICATE_TYPES):
            raise ValueError(f"incomplete_capability_map:{lane.name}")
        by_name[lane.name] = lane
        capability_maps[lane.name] = mapping

    for lane_name in policy.lane_plan:
        for predicate in policy.predicates:
            capability = capability_maps.get(lane_name, {}).get(predicate.type)
            if capability is None or capability.outcome == "unsupported":
                raise ValueError(f"unsupported_predicate:{predicate.predicate_id}:{lane_name}")
            if capability.outcome == "approximate" and not any(
                override.campaign_id == campaign_id
                and override.policy_hash == policy_hash
                and override.predicate_id == predicate.predicate_id
                and override.lane == lane_name
                and override.capability_version == capability.version
                and override.decided_by.startswith("human:")
                for override in overrides
            ):
                raise ValueError(
                    f"approximate_requires_override:{predicate.predicate_id}:{lane_name}"
                )

    selected = select_lanes(policy, capability_maps, set(overrides), campaign_id, policy_hash)
    return tuple(by_name[name].plan(policy) for name in selected)


def load_lane_cursor(
    connection: sqlite3.Connection, finder_run_id: str, lane: str
) -> LaneCursor | None:
    row = connection.execute(
        """SELECT finder_run_id,lane,cursor,processed,yielded,capability_version,updated_at
           FROM finder_cursor WHERE finder_run_id=? AND lane=?""",
        (finder_run_id, lane),
    ).fetchone()
    return None if row is None else LaneCursor(*tuple(row))


def advance_lane_cursor(
    connection: sqlite3.Connection,
    finder_run_id: str,
    lane: str,
    cursor_token: str | None,
    processed: int,
    yielded: int,
    capability_version: str,
    updated_at: str,
    *,
    commit: bool = True,
) -> LaneCursor:
    value = LaneCursor(
        finder_run_id, lane, cursor_token, processed, yielded, capability_version, updated_at,
    )
    connection.execute(
        """INSERT INTO finder_cursor(
               finder_run_id,lane,cursor,processed,yielded,capability_version,updated_at
           ) VALUES(?,?,?,?,?,?,?)
           ON CONFLICT(finder_run_id,lane) DO UPDATE SET
             cursor=excluded.cursor, processed=excluded.processed, yielded=excluded.yielded,
             capability_version=excluded.capability_version, updated_at=excluded.updated_at""",
        tuple(value.__dict__.values()),
    )
    if commit:
        connection.commit()
    return value


def choose_shortfall(
    *,
    checkpoint: bool = False,
    cap_reached: bool = False,
    unsupported_predicate: bool = False,
    credit_budget: bool = False,
    all_exhausted: bool = False,
) -> str | None:
    flags = (
        (checkpoint, "checkpoint"),
        (cap_reached, "cap_reached"),
        (unsupported_predicate, "unsupported_predicate"),
        (credit_budget, "credit_budget"),
        (all_exhausted, "lane_exhausted"),
    )
    return next((reason for active, reason in flags if active), None)


# The concrete imports intentionally happen after the protocol and registry are
# defined: finder modules depend on these typed lane primitives.
from scripts.prospecting.finder_manual import ManualLane
from scripts.prospecting.finder_pitchbook import PitchBookLane

register_lane("manual", ManualLane)
register_lane("pitchbook", PitchBookLane)


def registered_lanes() -> frozenset[str]:
    """Names of lanes registered by later phases (never the built-in manual/pitchbook lanes)."""
    return frozenset(_REGISTRY)


def build_lane(name: str, connection: object) -> Lane:
    """Build a registered lane; factories may take the store connection as their only positional argument."""
    import inspect

    factory = _REGISTRY[name]
    try:
        parameters = inspect.signature(factory).parameters
    except (TypeError, ValueError):
        parameters = {}
    if parameters:
        return factory(connection)  # type: ignore[call-arg]
    return factory()
