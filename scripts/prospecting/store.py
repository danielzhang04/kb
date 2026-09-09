"""SQLite lifecycle and typed repository for the desktop prospecting store."""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import uuid
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path

from . import install_no_network_guard

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
install_no_network_guard()


class MigrationError(RuntimeError):
    """A migration already recorded in the store has changed on disk."""


def resolve_store_path(environ: Mapping[str, str] | None = None) -> Path:
    values = os.environ if environ is None else environ
    override = values.get("KB_PROSPECTING_STORE")
    if override:
        return Path(override)
    local_app_data = values.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is required when KB_PROSPECTING_STORE is unset")
    return Path(local_app_data) / "kb-prospecting" / "store.sqlite"


def migrate(connection: sqlite3.Connection) -> int:
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    if not exists:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    connection.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
           name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
        )"""
    )
    phase_paths = sorted(
        (
            path
            for path in SCHEMA_PATH.parent.glob("schema_p*.sql")
            if re.fullmatch(r"schema_p\d+\.sql", path.name)
        ),
        key=lambda path: (int(path.stem.removeprefix("schema_p")), path.name),
    )
    applied = dict(connection.execute("SELECT name, sha256 FROM schema_migrations"))
    for phase_path in phase_paths:
        contents = phase_path.read_text(encoding="utf-8")
        digest = hashlib.sha256(contents.encode("utf-8")).hexdigest()
        prior_digest = applied.get(phase_path.name)
        if prior_digest is not None:
            if prior_digest != digest:
                raise MigrationError("modified_migration")
            continue
        literals = tuple(
            connection.execute("SELECT quote(?)", (value,)).fetchone()[0]
            for value in (
                phase_path.name,
                digest,
                datetime.now(timezone.utc).isoformat(),
            )
        )
        try:
            connection.executescript(
                "BEGIN IMMEDIATE;\n"
                + contents
                + "\nINSERT INTO schema_migrations(name, sha256, applied_at) VALUES("
                + ", ".join(literals)
                + ");\nCOMMIT;"
            )
        except Exception:
            connection.rollback()
            raise
    return get_schema_version(connection)


def get_schema_version(connection: sqlite3.Connection) -> int:
    return 1 + connection.execute("SELECT count(*) FROM schema_migrations").fetchone()[0]


def open_store(path: Path | None = None) -> sqlite3.Connection:
    database = resolve_store_path() if path is None else Path(path)
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database, timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=5000")
    migrate(connection)
    return connection


from dataclasses import asdict, dataclass
import json


@dataclass(frozen=True)
class Company:
    company_id: str
    name: str
    website_url: str | None
    linkedin_url: str | None
    one_line_summary: str | None
    industry: str | None
    location: str | None
    source_lane: str
    dedupe_key: str


@dataclass(frozen=True)
class Person:
    person_id: str
    first_name: str
    full_name: str
    linkedin_url: str | None
    location: str | None
    one_line_blurb: str | None
    source_lane: str
    dedupe_key: str


@dataclass(frozen=True)
class ContactPoint:
    contact_id: str
    person_id: str
    employer_company_id: str | None
    email: str
    provider: str
    adapter_version: str
    retrieved_at: str | None
    verified_at: str | None
    state: str
    confidence: float
    bounce_history: int


@dataclass(frozen=True)
class SourceObservation:
    observation_id: str
    entity_type: str
    entity_id: str
    field: str
    value: str
    source: str
    seen_at: str | None
    retrieved_at: str
    confidence: float
    snapshot_id: str | None


@dataclass(frozen=True)
class Employment:
    employment_id: str
    person_id: str
    company_id: str
    title: str
    valid_from: str | None
    valid_to: str | None
    source_observation_id: str
    confidence: float


@dataclass(frozen=True)
class MergeReview:
    review_id: str
    entity_type: str
    candidate_ids: tuple[str, ...]
    observation_ids: tuple[str, ...]
    reason: str
    state: str = "open"
    decided_by: str | None = None
    decided_at: str | None = None


@dataclass(frozen=True)
class ProviderAttempt:
    attempt_id: str
    person_id: str
    provider: str
    call: str
    input_hash: str
    priority: int
    credits: int
    result: str
    started_at: str
    finished_at: str
    raw_response_ref: int | None = None


@dataclass(frozen=True)
class FitScoreVersion:
    fit_score_version_id: str
    version: str
    rule_json: str
    rule_hash: str
    created_at: str
    active_from: str


def _insert_dataclass(
    connection: sqlite3.Connection,
    table: str,
    value: object,
    json_fields: tuple[str, ...] = (),
) -> None:
    fields = asdict(value)
    for field in json_fields:
        fields[field] = json.dumps(fields[field], separators=(",", ":"))
    columns = ",".join(fields)
    bind_marks = ",".join("?" for _ in fields)
    connection.execute(
        f"INSERT INTO {table}({columns}) VALUES({bind_marks})", tuple(fields.values())
    )


def insert_company(connection: sqlite3.Connection, company: Company) -> None:
    _insert_dataclass(connection, "company", company)


def get_company(connection: sqlite3.Connection, company_id: str) -> Company:
    row = connection.execute(
        "SELECT * FROM company WHERE company_id=?", (company_id,)
    ).fetchone()
    if row is None:
        raise KeyError(company_id)
    return Company(**dict(row))


def insert_person(connection: sqlite3.Connection, person: Person) -> None:
    _insert_dataclass(connection, "person", person)


def get_person(connection: sqlite3.Connection, person_id: str) -> Person:
    row = connection.execute("SELECT * FROM person WHERE person_id=?", (person_id,)).fetchone()
    if row is None:
        raise KeyError(person_id)
    return Person(**dict(row))


def insert_contact_point(connection: sqlite3.Connection, contact: ContactPoint) -> None:
    _insert_dataclass(connection, "contact_point", contact)


def get_contact_point(connection: sqlite3.Connection, contact_id: str) -> ContactPoint:
    row = connection.execute(
        "SELECT * FROM contact_point WHERE contact_id=?", (contact_id,)
    ).fetchone()
    if row is None:
        raise KeyError(contact_id)
    return ContactPoint(**dict(row))


def insert_source_observation(
    connection: sqlite3.Connection, observation: SourceObservation
) -> None:
    _insert_dataclass(connection, "source_observation", observation)


def get_source_observation(
    connection: sqlite3.Connection, observation_id: str
) -> SourceObservation:
    row = connection.execute(
        "SELECT * FROM source_observation WHERE observation_id=?", (observation_id,)
    ).fetchone()
    if row is None:
        raise KeyError(observation_id)
    return SourceObservation(**dict(row))


def insert_employment(connection: sqlite3.Connection, employment: Employment) -> None:
    _insert_dataclass(connection, "employment", employment)


def get_employment(connection: sqlite3.Connection, employment_id: str) -> Employment:
    row = connection.execute(
        "SELECT * FROM employment WHERE employment_id=?", (employment_id,)
    ).fetchone()
    if row is None:
        raise KeyError(employment_id)
    return Employment(**dict(row))


def insert_merge_review(connection: sqlite3.Connection, review: MergeReview) -> None:
    _insert_dataclass(
        connection, "merge_review", review, ("candidate_ids", "observation_ids")
    )


def get_merge_review(connection: sqlite3.Connection, review_id: str) -> MergeReview:
    row = connection.execute(
        "SELECT * FROM merge_review WHERE review_id=?", (review_id,)
    ).fetchone()
    if row is None:
        raise KeyError(review_id)
    values = dict(row)
    values["candidate_ids"] = tuple(json.loads(values["candidate_ids"]))
    values["observation_ids"] = tuple(json.loads(values["observation_ids"]))
    return MergeReview(**values)


def insert_provider_attempt(
    connection: sqlite3.Connection, attempt: ProviderAttempt
) -> None:
    _insert_dataclass(connection, "provider_attempt", attempt)


def get_provider_attempt(
    connection: sqlite3.Connection, attempt_id: str
) -> ProviderAttempt:
    row = connection.execute(
        "SELECT * FROM provider_attempt WHERE attempt_id=?", (attempt_id,)
    ).fetchone()
    if row is None:
        raise KeyError(attempt_id)
    return ProviderAttempt(**dict(row))


def insert_fit_score_version(
    connection: sqlite3.Connection, version: FitScoreVersion
) -> None:
    _insert_dataclass(connection, "fit_score_version", version)


def get_fit_score_version(
    connection: sqlite3.Connection, fit_score_version_id: str
) -> FitScoreVersion:
    row = connection.execute(
        "SELECT * FROM fit_score_version WHERE fit_score_version_id=?",
        (fit_score_version_id,),
    ).fetchone()
    if row is None:
        raise KeyError(fit_score_version_id)
    return FitScoreVersion(**dict(row))


def apply_role_change(
    connection: sqlite3.Connection,
    old_employment_id: str,
    old_company_id: str,
    new_employment: Employment,
    observations: tuple[SourceObservation, ...],
    changed_at: str,
    *,
    after_close: Callable[[], None] | None = None,
) -> int:
    connection.execute("BEGIN IMMEDIATE")
    try:
        for observation in observations:
            insert_source_observation(connection, observation)
        updated = connection.execute(
            """UPDATE employment SET valid_to=?
               WHERE employment_id=? AND company_id=? AND person_id=? AND valid_to IS NULL""",
            (changed_at, old_employment_id, old_company_id, new_employment.person_id),
        )
        if updated.rowcount != 1:
            raise ValueError("old employment is not open")
        if after_close is not None:
            after_close()
        insert_employment(connection, new_employment)
        stale = connection.execute(
            """UPDATE contact_point SET state='stale'
               WHERE person_id=? AND employer_company_id=? AND state<>'stale'""",
            (new_employment.person_id, old_company_id),
        )
        connection.commit()
        return stale.rowcount
    except Exception:
        connection.rollback()
        raise


@dataclass(frozen=True)
class CreditReservation:
    reservation_id: str
    campaign_id: str
    provider: str
    exec_request_id: str
    max_cost: int
    actual_cost: int | None
    state: str
    created_at: str
    settled_at: str | None


def get_credit_reservation(
    connection: sqlite3.Connection, reservation_id: str
) -> CreditReservation:
    row = connection.execute(
        "SELECT * FROM credit_reservation WHERE reservation_id=?", (reservation_id,)
    ).fetchone()
    if row is None:
        raise KeyError(reservation_id)
    return CreditReservation(**dict(row))


def reserve_credit(
    connection: sqlite3.Connection, reservation: CreditReservation
) -> bool:
    if (
        reservation.state != "reserved"
        or reservation.actual_cost is not None
        or reservation.settled_at is not None
    ):
        raise ValueError("new reservation must be unsettled and reserved")
    if type(reservation.max_cost) is not int or reservation.max_cost < 0:
        raise ValueError("max_cost must be a non-negative int")
    if reservation.provider not in CREDIT_PROVIDER_CODES:
        raise ValueError("credit reservation provider must be an enumerated code")
    connection.execute("BEGIN IMMEDIATE")
    try:
        request = connection.execute(
            "SELECT operation,payload,policy_hash,state FROM exec_request WHERE request_id=?",
            (reservation.exec_request_id,),
        ).fetchone()
        if request is None:
            raise KeyError(reservation.exec_request_id)
        if request["state"] != "queued":
            raise ValueError("exec request is not queued")
        if request["operation"] != "vendor_lookup":
            raise ValueError("credit reservation requires vendor_lookup")
        payload = json.loads(request["payload"])
        campaign_id = payload.get("campaign_id")
        if campaign_id != reservation.campaign_id:
            raise ValueError("credit reservation campaign mismatch")
        if payload.get("provider") != reservation.provider:
            raise ValueError("credit reservation provider mismatch")
        row = connection.execute(
            "SELECT credit_budget,policy_hash FROM campaign WHERE campaign_id=?",
            (campaign_id,),
        ).fetchone()
        if row is None:
            raise KeyError(campaign_id)
        if row["policy_hash"] != request["policy_hash"]:
            raise ValueError("credit reservation policy mismatch")
        used = connection.execute(
            """SELECT coalesce(sum(CASE
                 WHEN state='reserved' THEN max_cost
                 WHEN state IN ('settled','overage_error') THEN actual_cost
                 ELSE 0 END), 0)
               FROM credit_reservation WHERE campaign_id=?""",
            (campaign_id,),
        ).fetchone()[0]
        if used + reservation.max_cost > row[0]:
            connection.rollback()
            return False
        _insert_dataclass(connection, "credit_reservation", reservation)
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise


def settle_credit(
    connection: sqlite3.Connection,
    reservation_id: str,
    actual_cost: int,
    settled_at: str,
) -> str:
    if type(actual_cost) is not int or actual_cost < 0:
        raise ValueError("actual_cost must be a non-negative int")
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = connection.execute(
            "SELECT max_cost,state FROM credit_reservation WHERE reservation_id=?",
            (reservation_id,),
        ).fetchone()
        if row is None:
            raise KeyError(reservation_id)
        if row["state"] != "reserved":
            raise ValueError("reservation is not reserved")
        state = "settled" if actual_cost <= row["max_cost"] else "overage_error"
        connection.execute(
            """UPDATE credit_reservation
               SET actual_cost=?,state=?,settled_at=? WHERE reservation_id=?""",
            (actual_cost, state, settled_at, reservation_id),
        )
        if state == "overage_error":
            _record_credit_terminal(
                connection, reservation_id, "credit_overage", "error", actual_cost,
                settled_at,
            )
            campaign_id = connection.execute(
                "SELECT campaign_id FROM credit_reservation WHERE reservation_id=?",
                (reservation_id,),
            ).fetchone()[0]
            connection.execute(
                "UPDATE campaign SET status='paused' WHERE campaign_id=?", (campaign_id,)
            )
            connection.execute(
                "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
                ("audit-credit-" + reservation_id, "desktop-executor", "adapter_disabled",
                 "campaign", campaign_id, settled_at, None, None, "credit_overage"),
            )
        connection.commit()
        return state
    except Exception:
        connection.rollback()
        raise


def release_credit(
    connection: sqlite3.Connection, reservation_id: str, released_at: str
) -> None:
    connection.execute("BEGIN IMMEDIATE")
    try:
        changed = connection.execute(
            """UPDATE credit_reservation
               SET actual_cost=0,state='released',settled_at=?
               WHERE reservation_id=? AND state='reserved'""",
            (released_at, reservation_id),
        )
        if changed.rowcount != 1:
            raise ValueError("reservation is not reserved")
        _record_credit_terminal(
            connection, reservation_id, "credit_release", "skipped_budget", 0,
            released_at,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _record_credit_terminal(
    connection: sqlite3.Connection,
    reservation_id: str,
    call: str,
    result: str,
    credits: int,
    at: str,
) -> None:
    row = connection.execute(
        """SELECT cr.provider,cr.exec_request_id,er.payload
           FROM credit_reservation AS cr
           JOIN exec_request AS er ON er.request_id=cr.exec_request_id
           WHERE cr.reservation_id=?""",
        (reservation_id,),
    ).fetchone()
    if row is None:
        raise KeyError(reservation_id)
    person_id = json.loads(row["payload"])["person_id"]
    digest = __import__("hashlib").sha256(reservation_id.encode("utf-8")).hexdigest()
    insert_provider_attempt(connection, ProviderAttempt(
        "pa_" + digest[:16], person_id, row["provider"], call, digest,
        0, credits, result, at, at, None,
    ))


def ingest_observations(
    connection: sqlite3.Connection,
    observations: tuple[SourceObservation, ...],
    candidate_ids: tuple[str, ...],
) -> MergeReview | None:
    """Persist immutable observations and create the review for a real conflict."""
    if not observations:
        return None
    keys = {(item.entity_type, item.field) for item in observations}
    values = {item.value for item in observations}
    connection.execute("BEGIN IMMEDIATE")
    try:
        for observation in observations:
            insert_source_observation(connection, observation)
        review = None
        if len(keys) == 1 and len(values) > 1:
            review = MergeReview(
                "mr_" + observations[0].observation_id.removeprefix("obs_")[-16:],
                observations[0].entity_type,
                candidate_ids,
                tuple(item.observation_id for item in observations),
                "conflicting_provider_values",
            )
            insert_merge_review(connection, review)
        connection.commit()
        return review
    except Exception:
        connection.rollback()
        raise


def get_person_tranche(
    connection: sqlite3.Connection, campaign_id: str
) -> tuple[sqlite3.Row, ...]:
    """Return the exact person tranche for one campaign and one selected valid contact."""
    return tuple(connection.execute(
        """SELECT p.first_name,p.full_name,e.title,c.name AS company,p.linkedin_url,
                  p.location,cp.email,cp.state AS verification_state,p.one_line_blurb,
                  fs.score AS fit_score,p.source_lane
           FROM person AS p
           JOIN employment AS e ON e.person_id=p.person_id AND e.valid_to IS NULL
           JOIN company AS c ON c.company_id=e.company_id
           LEFT JOIN contact_point AS cp ON cp.person_id=p.person_id AND cp.state='valid'
           LEFT JOIN fit_score AS fs ON fs.person_id=p.person_id AND fs.campaign_id = ?
             AND fs.scored_at=(SELECT max(fs2.scored_at) FROM fit_score AS fs2
                               WHERE fs2.person_id=p.person_id AND fs2.campaign_id=?)""",
        (campaign_id, campaign_id),
    ))


PREDICATE_TYPES = frozenset({
    "industry", "company_type", "company_stage", "company_location", "person_location",
    "title", "seniority", "school", "platform", "company_list",
})
CAPABILITY_OUTCOMES = frozenset({"exact", "approximate", "unsupported"})
OPAQUE_ID_RE = re.compile(
    r"^(cmp|per|cp|obs|emp|mr|pa|cr|pol|camp|req|apr|rev|rt)_[0-9a-f]{16}$"
)
OPAQUE_COMPANY_ID_RE = re.compile(r"^cmp_[0-9a-f]{16}$")
NORMALIZED_VALUE_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
FORBIDDEN_VALUE_RE = re.compile(r"\s|[/\\;|&$<>`]|@|://|\d{7,}", re.IGNORECASE)
LANE_CODES = frozenset({
    "linkedin_assisted", "class_c_public_profile", "manual", "pitchbook", "pdl",
    "snov_domain",
})
PROVIDER_CODES = frozenset({
    "manual", "hunter", "snov", "fullenrich", "pdl", "apify", "hdw", "pattern",
})
CREDIT_PROVIDER_CODES = PROVIDER_CODES - {"manual"}
LABEL_CODES = frozenset({
    "sent", "followup_due", "replied", "ooo", "bounced",
    "closed_no_reply", "closed_declined",
})
FIELD_ID_PREFIXES = {
    "entity_id": frozenset({"cmp", "per", "cp", "emp"}),
    "snapshot_id": frozenset({"obs"}),
    "finder_run_id": frozenset({"camp"}),
    "person_id": frozenset({"per"}),
    "revision_id": frozenset({"rev"}),
    "contact_id": frozenset({"cp"}),
    "mailbox_id": frozenset({"pol"}),
    "delivery_id": frozenset({"req"}),
    "gmail_thread_id": frozenset({"req"}),
    "campaign_id": frozenset({"camp"}),
    "request_id": frozenset({"req"}),
}
OPERATION_KEYS = {
    "fetch_snapshot": frozenset({"entity_id", "snapshot_id"}),
    "finder_page": frozenset({"finder_run_id", "lane"}),
    "vendor_lookup": frozenset({"campaign_id", "person_id", "provider"}),
    "gmail_draft": frozenset({"revision_id", "contact_id", "mailbox_id"}),
    "gmail_send": frozenset({"delivery_id"}),
    "gmail_label": frozenset({"gmail_thread_id", "label_code"}),
    "gmail_thread_refresh": frozenset({"gmail_thread_id"}),
}
CALLER_OPERATIONS = {
    "prospecting-list-builder": frozenset({"fetch_snapshot", "finder_page", "vendor_lookup"}),
    "prospecting-campaigner": frozenset({"gmail_draft", "gmail_send", "gmail_label", "gmail_thread_refresh"}),
}


@dataclass(frozen=True)
class Predicate:
    predicate_id: str
    type: str
    value: str | tuple[str, ...]


@dataclass(frozen=True)
class TargetPolicy:
    predicates: tuple[Predicate, ...]
    requested_companies: int
    requested_people: int
    extra_fields: tuple[str, ...]
    lane_plan: tuple[str, ...]
    scorer_version: str


@dataclass(frozen=True)
class LaneCapability:
    outcome: str
    reason_code: str
    version: str


@dataclass(frozen=True)
class PredicateOverride:
    override_id: str
    campaign_id: str
    policy_hash: str
    predicate_id: str
    lane: str
    capability_version: str
    decided_by: str
    decided_at: str


@dataclass(frozen=True)
class EligibilityDecision:
    decision_id: str
    campaign_id: str
    person_id: str
    rule_version: str
    fit_score_version_id: str
    outcome: str
    failed_predicate_ids: tuple[str, ...]
    approximate_predicate_ids: tuple[str, ...]
    decided_at: str
    override_id: str | None
    policy_hash: str | None = None
    lane: str | None = None
    capability_version: str | None = None


@dataclass(frozen=True)
class ExecRequest:
    request_id: str
    caller: str
    operation: str
    payload: dict[str, str]
    policy_hash: str
    approval_id: str | None
    created_at: str
    state: str = "queued"
    reason: str | None = None


def validate_target_policy(policy: TargetPolicy) -> None:
    if (
        type(policy.requested_companies) is not int
        or type(policy.requested_people) is not int
        or policy.requested_companies < 0
        or policy.requested_people < 0
    ):
        raise ValueError("requested counts must be non-negative")
    ids = [predicate.predicate_id for predicate in policy.predicates]
    if len(ids) != len(set(ids)):
        raise ValueError("predicate_id must be unique")
    for predicate in policy.predicates:
        _validate_normalized_code(predicate.predicate_id, "predicate_id")
        if predicate.type not in PREDICATE_TYPES:
            raise ValueError("predicate type is not allowed")
        if predicate.type == "company_list" and isinstance(predicate.value, str):
            raise ValueError("company_list requires ordered opaque company IDs")
        values = (predicate.value,) if isinstance(predicate.value, str) else predicate.value
        if not values or any(not isinstance(value, str) or not value for value in values):
            raise ValueError("predicate values must be non-empty normalized scalars")
        if predicate.type == "company_list":
            if any(OPAQUE_COMPANY_ID_RE.fullmatch(value) is None for value in values):
                raise ValueError("company_list requires opaque company IDs")
        elif any(
            NORMALIZED_VALUE_RE.fullmatch(value) is None
            or FORBIDDEN_VALUE_RE.search(value) is not None
            for value in values
        ):
            raise ValueError("predicate values must be normalized codes")
    for field in policy.extra_fields:
        _validate_normalized_code(field, "extra_fields")
    for lane in policy.lane_plan:
        if lane not in LANE_CODES:
            raise ValueError("lane_plan must contain enumerated lanes")
    _validate_normalized_code(policy.scorer_version, "scorer_version")


def _validate_normalized_code(value: object, field: str) -> None:
    if (
        not isinstance(value, str)
        or NORMALIZED_VALUE_RE.fullmatch(value) is None
        or FORBIDDEN_VALUE_RE.search(value) is not None
    ):
        raise ValueError(f"{field} must contain typed normalized codes")


def compile_target_policy(
    raw: Mapping[str, object], resolve_company: Callable[[str], str | None]
) -> TargetPolicy:
    predicates: list[Predicate] = []
    for item in raw["predicates"]:  # type: ignore[index]
        record = dict(item)  # type: ignore[arg-type]
        value: object = record["value"]
        if record["type"] == "company_list":
            resolved: list[str] = []
            for name in value:  # type: ignore[union-attr]
                company_id = resolve_company(str(name))
                if company_id is None:
                    raise ValueError("company name is unresolved or ambiguous")
                resolved.append(company_id)
            value = tuple(resolved)
        elif isinstance(value, list):
            value = tuple(str(part) for part in value)
        predicates.append(Predicate(str(record["predicate_id"]), str(record["type"]), value))  # type: ignore[arg-type]
    policy = TargetPolicy(
        tuple(predicates), int(raw["requested_companies"]), int(raw["requested_people"]),
        tuple(str(item) for item in raw["extra_fields"]),  # type: ignore[union-attr]
        tuple(str(item) for item in raw["lane_plan"]),  # type: ignore[union-attr]
        str(raw["scorer_version"]),
    )
    validate_target_policy(policy)
    return policy


def select_lanes(
    policy: TargetPolicy,
    capabilities: Mapping[str, Mapping[str, LaneCapability]],
    overrides: set[PredicateOverride],
    campaign_id: str,
    policy_hash: str,
) -> tuple[str, ...]:
    selected: list[str] = []
    for lane in policy.lane_plan:
        lane_map = capabilities.get(lane, {})
        for predicate in policy.predicates:
            capability = lane_map.get(predicate.type)
            if capability is None or capability.outcome not in CAPABILITY_OUTCOMES:
                raise ValueError("capability map is incomplete")
            if capability.outcome == "unsupported":
                raise ValueError("unsupported predicate")
            if capability.outcome == "approximate":
                matched = any(
                    item.campaign_id == campaign_id
                    and item.policy_hash == policy_hash
                    and item.predicate_id == predicate.predicate_id
                    and item.lane == lane
                    and item.capability_version == capability.version
                    and item.decided_by.startswith("human:")
                    for item in overrides
                )
                if not matched:
                    raise ValueError("approximate predicate requires human override")
        selected.append(lane)
    return tuple(selected)


def decide_eligibility(
    decision_id: str,
    campaign_id: str,
    person_id: str,
    rule_version: str,
    fit_score_version_id: str,
    failed_predicate_ids: tuple[str, ...],
    approximate_predicate_ids: tuple[str, ...],
    decided_at: str,
    override_id: str | None,
    connection: sqlite3.Connection | None = None,
    *,
    policy_hash: str | None = None,
    lane: str | None = None,
    capability_version: str | None = None,
) -> EligibilityDecision:
    approved = False
    if failed_predicate_ids:
        outcome = "ineligible"
    elif approximate_predicate_ids:
        # A caller-provided ID is not evidence of a valid override.  Resolve it
        # against the canonical store and fail closed if it is not the human
        # decision for this campaign and approximate predicate.
        if (
            connection is not None
            and override_id is not None
            and policy_hash is not None
            and lane is not None
            and capability_version is not None
            and len(approximate_predicate_ids) == 1
        ):
            approved = connection.execute(
                """SELECT 1 FROM predicate_override AS po
                   JOIN campaign AS c ON c.campaign_id=po.campaign_id
                   WHERE po.override_id=? AND po.campaign_id=? AND po.policy_hash=?
                     AND po.policy_hash=c.policy_hash AND po.predicate_id=? AND po.lane=?
                     AND po.capability_version=? AND po.decided_by LIKE 'human:%'""",
                (override_id, campaign_id, policy_hash, approximate_predicate_ids[0],
                 lane, capability_version),
            ).fetchone() is not None
        outcome = "eligible" if approved else "needs_override"
    else:
        outcome = "eligible"
    return EligibilityDecision(
        decision_id, campaign_id, person_id, rule_version, fit_score_version_id, outcome,
        failed_predicate_ids, approximate_predicate_ids, decided_at,
        override_id if approved else None,
        policy_hash if approved else None,
        lane if approved else None,
        capability_version if approved else None,
    )


def _validate_opaque(value: str, field: str) -> None:
    match = OPAQUE_ID_RE.fullmatch(value)
    if match is None or (
        field in FIELD_ID_PREFIXES and match.group(1) not in FIELD_ID_PREFIXES[field]
    ):
        raise ValueError(f"{field} must be a typed opaque ID")


def _validate_revision_id(value: str) -> None:
    """Accept the legacy typed ID or build_revision's canonical UUIDv4."""
    typed = OPAQUE_ID_RE.fullmatch(value)
    if typed is not None and typed.group(1) == "rev":
        return
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, TypeError, ValueError):
        raise ValueError("revision_id must be a typed opaque ID") from None
    if (
        str(parsed) != value
        or parsed.version != 4
        or parsed.variant != uuid.RFC_4122
    ):
        raise ValueError("revision_id must be a typed opaque ID")


def approval_scope_hash(values: Mapping[str, object]) -> str:
    keys = (
        "assertion_ref", "campaign_id", "policy_hash", "content_kind", "revision_hash",
        "contact_id", "mailbox_id", "approver", "approved_at", "expires_at", "tier",
        "send_window", "nonce", "permitted_action",
    )
    canonical = json.dumps(
        {key: values[key] for key in keys}, sort_keys=True, separators=(",", ":")
    )
    return __import__("hashlib").sha256(canonical.encode("utf-8")).hexdigest()


ENABLED_SEND_TIERS = ("T1",)


def _normalize_trusted_now(now: str) -> str:
    try:
        parsed = datetime.fromisoformat(now.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("current UTC time is invalid") from error
    if parsed.tzinfo is None:
        raise ValueError("current UTC time must include an offset")
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def validate_exec_request(
    request: ExecRequest,
    campaign_tier: str,
    connection: sqlite3.Connection | None = None,
    now: str | None = None,
) -> sqlite3.Row | None:
    _validate_opaque(request.request_id, "request_id")
    if re.fullmatch(r"[0-9a-f]{64}", request.policy_hash) is None:
        raise ValueError("policy_hash must be lowercase SHA-256")
    if request.approval_id is not None:
        if re.fullmatch(r"apr_[0-9a-f]{16}", request.approval_id) is None:
            raise ValueError("approval_id must be a typed opaque ID")
    allowed = CALLER_OPERATIONS.get(request.caller)
    if allowed is None or request.operation not in allowed:
        raise ValueError("caller is not allowed for operation")
    expected_keys = OPERATION_KEYS[request.operation]
    if frozenset(request.payload) != expected_keys:
        raise ValueError("payload keys do not match operation contract")
    if any(not isinstance(value, str) or not value for value in request.payload.values()):
        raise ValueError("payload values must be opaque non-empty strings")
    for field, value in request.payload.items():
        if field == "lane":
            if value not in LANE_CODES:
                raise ValueError("lane must be an enumerated code")
            if FORBIDDEN_VALUE_RE.search(value):
                raise ValueError("payload values contain forbidden free-form content")
        elif field == "provider":
            if value not in PROVIDER_CODES:
                raise ValueError("provider must be an enumerated code")
            if FORBIDDEN_VALUE_RE.search(value):
                raise ValueError("payload values contain forbidden free-form content")
        elif field == "label_code":
            if value not in LABEL_CODES:
                raise ValueError("label_code must be an enumerated code")
            if FORBIDDEN_VALUE_RE.search(value):
                raise ValueError("payload values contain forbidden free-form content")
        elif field == "revision_id":
            _validate_revision_id(value)
        else:
            _validate_opaque(value, field)
    if request.operation != "gmail_send" and request.approval_id is not None:
        raise ValueError("approval_id must be null for this operation")
    if request.operation == "gmail_send":
        if campaign_tier not in ENABLED_SEND_TIERS:
            raise ValueError("tier_not_enabled")
        if request.approval_id is None:
            raise ValueError("approval_id is required for gmail_send")
        if connection is None or now is None:
            raise ValueError("approval validation requires store and current UTC time")
        row = connection.execute(
            """SELECT a.*,d.campaign_id AS delivery_campaign,
                      d.revision_hash AS delivery_revision,d.contact_id AS delivery_contact,
                      d.mailbox_id AS delivery_mailbox,c.policy_hash AS current_policy
               FROM approval AS a
               JOIN delivery AS d ON d.delivery_id=?
               JOIN campaign AS c ON c.campaign_id=d.campaign_id
               WHERE a.approval_id=?""",
            (request.payload["delivery_id"], request.approval_id),
        ).fetchone()
        if row is None:
            raise ValueError("approval_unresolved")
        window = json.loads(row["send_window"])
        if row["campaign_id"] != row["delivery_campaign"]:
            raise ValueError("approval_campaign_mismatch")
        if row["policy_hash"] != request.policy_hash or row["policy_hash"] != row["current_policy"]:
            raise ValueError("approval_policy_hash_mismatch")
        if row["tier"] != campaign_tier:
            raise ValueError("approval_tier_mismatch")
        if row["content_kind"] != "revision":
            raise ValueError("approval_content_kind_mismatch")
        if row["permitted_action"] != "send_revision":
            raise ValueError("approval_permitted_action_mismatch")
        if row["revision_hash"] != row["delivery_revision"]:
            raise ValueError("approval_revision_mismatch")
        if row["contact_id"] != row["delivery_contact"]:
            raise ValueError("approval_contact_mismatch")
        if row["mailbox_id"] != row["delivery_mailbox"]:
            raise ValueError("approval_mailbox_mismatch")
        if not str(row["approver"]).startswith("human:"):
            raise ValueError("approval_human_approver_required")
        if row["consumed_at"] is not None:
            raise ValueError("approval_consumed")
        if row["invalidation_reason"] is not None:
            raise ValueError("approval_invalidated")
        if not row["nonce"]:
            raise ValueError("approval_missing_nonce")
        if now < row["approved_at"]:
            raise ValueError("approval_not_yet_valid")
        if now > row["expires_at"]:
            raise ValueError("approval_expired")
        if not (window["start"] <= now <= window["end"]):
            raise ValueError("approval_outside_send_window")
        if row["scope_hash"] != approval_scope_hash(dict(row)):
            raise ValueError("approval_scope_hash_mismatch")
        return row
    return None


def insert_exec_request(
    connection: sqlite3.Connection,
    request: ExecRequest,
    campaign_tier: str,
    now: str | None = None,
) -> None:
    if request.state != "queued" or request.reason is not None:
        raise ValueError("new exec request must be queued without a reason")
    if request.operation == "gmail_send" and now is None:
        raise ValueError("gmail_send requires current UTC time")
    trusted_now = _normalize_trusted_now(now) if request.operation == "gmail_send" else None
    validate_exec_request(
        request, campaign_tier, connection, trusted_now
    )
    values = asdict(request)
    values["payload"] = json.dumps(request.payload, sort_keys=True, separators=(",", ":"))
    columns = ",".join(values)
    bind_marks = ",".join("?" for _ in values)
    with connection:
        connection.execute(
            f"INSERT INTO exec_request({columns}) VALUES({bind_marks})", tuple(values.values())
        )


def consume_send_approval(
    connection: sqlite3.Connection, request: ExecRequest, campaign_tier: str, now: str
) -> None:
    approval = validate_exec_request(request, campaign_tier, connection, now)
    assert approval is not None
    consumed = connection.execute(
        """UPDATE approval SET consumed_at=?
           WHERE approval_id=? AND consumed_at IS NULL AND invalidation_reason IS NULL
             AND assertion_ref=? AND campaign_id=? AND policy_hash=?
             AND content_kind='revision' AND revision_hash=?
             AND contact_id=? AND mailbox_id=? AND approver=?
             AND approved_at=? AND expires_at=? AND tier=? AND send_window=?
             AND nonce=? AND permitted_action='send_revision' AND scope_hash=?
             AND approver LIKE 'human:%' AND approved_at <= ? AND expires_at >= ?
             AND campaign_id=(SELECT campaign_id FROM delivery WHERE delivery_id=?)
             AND revision_hash=(SELECT revision_hash FROM delivery WHERE delivery_id=?)
             AND contact_id=(SELECT contact_id FROM delivery WHERE delivery_id=?)
             AND mailbox_id=(SELECT mailbox_id FROM delivery WHERE delivery_id=?)
             AND policy_hash=(SELECT c.policy_hash FROM campaign AS c
                 JOIN delivery AS d ON d.campaign_id=c.campaign_id WHERE d.delivery_id=?)""",
        (now, request.approval_id, approval["assertion_ref"], approval["campaign_id"],
         request.policy_hash, approval["revision_hash"], approval["contact_id"],
         approval["mailbox_id"], approval["approver"], approval["approved_at"],
         approval["expires_at"], campaign_tier, approval["send_window"], approval["nonce"],
         approval["scope_hash"], now, now, request.payload["delivery_id"],
         request.payload["delivery_id"], request.payload["delivery_id"],
         request.payload["delivery_id"], request.payload["delivery_id"]),
    ).rowcount
    if consumed != 1:
        raise ValueError("approval_replayed_or_scope_mismatch")


def insert_predicate_override(
    connection: sqlite3.Connection, override: PredicateOverride
) -> None:
    if not override.decided_by.startswith("human:"):
        raise ValueError("predicate override requires a human decision")
    _validate_normalized_code(override.predicate_id, "predicate_id")
    if override.lane not in LANE_CODES:
        raise ValueError("override lane must be enumerated")
    _validate_normalized_code(override.capability_version, "capability_version")
    connection.execute("BEGIN IMMEDIATE")
    try:
        campaign = connection.execute(
            "SELECT policy_hash FROM campaign WHERE campaign_id=?", (override.campaign_id,)
        ).fetchone()
        if campaign is None or campaign["policy_hash"] != override.policy_hash:
            raise ValueError("predicate override campaign policy mismatch")
        _insert_dataclass(connection, "predicate_override", override)
        connection.execute(
            "INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?)",
            ("audit-" + override.override_id, override.decided_by, "predicate_override",
             "predicate_override", override.override_id, override.decided_at, None,
             override.policy_hash, "approximate_capability"),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def insert_eligibility_decision(
    connection: sqlite3.Connection, decision: EligibilityDecision
) -> None:
    if decision.override_id is not None:
        if (
            decision.outcome != "eligible"
            or len(decision.approximate_predicate_ids) != 1
            or decision.policy_hash is None
            or decision.lane is None
            or decision.capability_version is None
        ):
            raise ValueError("eligibility override binding is incomplete")
        matched = connection.execute(
            """SELECT 1 FROM predicate_override AS po
               JOIN campaign AS c ON c.campaign_id=po.campaign_id
               WHERE po.override_id=? AND po.campaign_id=? AND po.policy_hash=?
                 AND po.policy_hash=c.policy_hash AND po.predicate_id=? AND po.lane=?
                 AND po.capability_version=? AND po.decided_by LIKE 'human:%'""",
            (decision.override_id, decision.campaign_id, decision.policy_hash,
             decision.approximate_predicate_ids[0], decision.lane,
             decision.capability_version),
        ).fetchone()
        if matched is None:
            raise ValueError("eligibility override binding mismatch")
    _insert_dataclass(
        connection, "eligibility_decision", decision,
        ("failed_predicate_ids", "approximate_predicate_ids"),
    )


def get_eligibility_decision(
    connection: sqlite3.Connection, decision_id: str
) -> EligibilityDecision:
    row = connection.execute(
        "SELECT * FROM eligibility_decision WHERE decision_id=?", (decision_id,)
    ).fetchone()
    if row is None:
        raise KeyError(decision_id)
    values = dict(row)
    values["failed_predicate_ids"] = tuple(json.loads(values["failed_predicate_ids"]))
    values["approximate_predicate_ids"] = tuple(json.loads(values["approximate_predicate_ids"]))
    return EligibilityDecision(**values)
