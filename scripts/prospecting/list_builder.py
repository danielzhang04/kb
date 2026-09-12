"""Resumable, desktop-local assembly of a campaign's finder results."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid
from typing import Callable, Sequence

from scripts.prospecting import lanes as lanes_registry
from scripts.prospecting.lanes import (
    Lane,
    LaneBatch,
    advance_lane_cursor,
    load_lane_cursor,
    plan_lanes,
)
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.scorer import (
    clean_contacts,
    dedupe_people,
    ensure_fit_score_v1,
    score_person,
    write_eligibility,
)
from scripts.prospecting.p2_store import TargetPolicy
from scripts.prospecting.providers.base import VendorAdapter, queue_vendor_lookup
from scripts.prospecting.store import (
    Employment,
    Person,
    SourceObservation,
    apply_role_change,
    insert_employment,
    insert_person,
    insert_source_observation,
    open_store,
)


@dataclass(frozen=True)
class ListBuildSummary:
    finder_run_id: str
    list_id: str
    companies: int
    people: int
    valid_contacts: int
    quarantined: int
    duplicates: int
    attempts: int
    credits: int
    shortfall_reason: str | None
    state: str
    already_has_contact: int


class ListPipeline:
    """Injectable executor-owned stages, followed by deterministic local stages."""

    def __init__(
        self,
        reserved_enrich: Callable[..., object] | None = None,
        role_check: Callable[..., object] | None = None,
        snapshot: Callable[..., object] | None = None,
    ) -> None:
        self.reserved_enrich = reserved_enrich
        self.role_check = role_check
        self.snapshot = snapshot
        self.events: list[str] = []
        self.already_has_contact = 0

    @property
    def configured(self) -> bool:
        return all(stage is not None for stage in (
            self.reserved_enrich, self.role_check, self.snapshot,
        ))

    def process(
        self,
        connection: sqlite3.Connection,
        run_id: str,
        campaign_id: str,
        entity_ids: Sequence[tuple[str, str]],
        policy: TargetPolicy,
        at: str,
    ) -> tuple[str, ...]:
        del run_id
        if not self.configured:
            raise ValueError("list_builder_requires_configured_stages")
        assert self.reserved_enrich is not None
        assert self.role_check is not None
        assert self.snapshot is not None
        person_ids = tuple(entity_id for kind, entity_id in entity_ids if kind == "person")
        self.events.append("dedupe")
        if person_ids:
            dedupe_people(connection, person_ids, at)

        self.events.append("suppression")
        allowed = tuple(
            person_id
            for person_id in person_ids
            if connection.execute(
                "SELECT 1 FROM suppression WHERE released_at IS NULL AND subject_key=?",
                (person_id,),
            ).fetchone() is None
            and connection.execute(
                "SELECT 1 FROM eligibility_decision WHERE campaign_id=? AND person_id=?",
                (campaign_id, person_id),
            ).fetchone() is None
        )

        self.events.append("reserved_enrichment")
        if allowed:
            already_has_contact = self.reserved_enrich(connection, campaign_id, allowed, at)
            if type(already_has_contact) is int:
                self.already_has_contact += already_has_contact
        self.events.append("role_check")
        if allowed:
            self.role_check(connection, allowed, at)
        self.events.append("snapshot")
        if allowed:
            for person_id in allowed:
                self.snapshot(connection, person_id, at)
        self.events.append("clean")
        if allowed:
            clean_contacts(connection, allowed, at)
        self.events.append("score")
        if allowed:
            version = ensure_fit_score_v1(connection, at)
            for person_id in allowed:
                score_person(connection, campaign_id, person_id, {}, at)
        self.events.append("eligibility")
        if allowed:
            for person_id in allowed:
                write_eligibility(connection, campaign_id, person_id, policy, version, at)
        self.events.append("membership")
        if allowed:
            placeholders = ",".join("?" for _ in allowed)
            membership = connection.execute(
                f"""SELECT COUNT(*) FROM eligibility_decision
                    WHERE campaign_id=? AND person_id IN ({placeholders}) AND outcome='eligible'""",
                (campaign_id, *allowed),
            ).fetchone()[0]
            if membership > len(allowed):
                raise RuntimeError("invalid_membership_count")
        return person_ids


def _observation_value(value: object) -> str:
    """Store a lane's scalar as the JSON value required by immutable provenance."""
    if isinstance(value, str):
        try:
            json.loads(value)
        except json.JSONDecodeError:
            return json.dumps(value, separators=(",", ":"))
        return value
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _json_scalar(value: object) -> str:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return value
        return parsed if isinstance(parsed, str) else value
    return str(value)


def _identity_key(*, profile_url: str | None, full_name: str | None, company: str | None, fallback: str) -> str:
    """Hash the local identity evidence; raw identity data stays only in SQLite."""
    if profile_url:
        basis = "profile:" + profile_url.strip().casefold()
    else:
        basis = "name-company:" + "|".join(
            value.strip().casefold() for value in (full_name or "", company or "", fallback)
        )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _batch_values(batch: LaneBatch, entity_type: str) -> dict[str, dict[str, str]]:
    values: dict[str, dict[str, str]] = {}
    for observation in batch.observations:
        if observation.entity_type == entity_type:
            values.setdefault(observation.entity_id, {})[observation.field] = _json_scalar(
                observation.value
            )
    return values


def _canonical_person_ids(connection: sqlite3.Connection, batch: LaneBatch) -> dict[str, str]:
    people = _batch_values(batch, "person")
    result: dict[str, str] = {}
    for upstream_id, values in people.items():
        profile = values.get("profile_url") or values.get("linkedin_url")
        full_name = values.get("full_name") or values.get("name")
        company = values.get("company") or values.get("company_id") or values.get("employer")
        key = _identity_key(
            profile_url=profile, full_name=full_name, company=company, fallback=upstream_id,
        )
        row = connection.execute("SELECT person_id FROM person WHERE dedupe_key=?", (key,)).fetchone()
        if row is None and profile:
            row = connection.execute(
                "SELECT person_id FROM person WHERE linkedin_url=?", (profile,)
            ).fetchone()
        if row is None and full_name:
            matches = connection.execute(
                "SELECT person_id FROM person WHERE lower(full_name)=lower(?)", (full_name,)
            ).fetchall()
            if len(matches) == 1:
                row = matches[0]
        person_id = str(row[0]) if row is not None else "per_" + key[:16]
        if row is None:
            display_name = full_name or upstream_id
            insert_person(connection, Person(
                person_id, display_name.split(" ", 1)[0], display_name, profile,
                values.get("location"), None, "manual", key,
            ))
        result[upstream_id] = person_id
    return result


def _persist_employment(
    connection: sqlite3.Connection,
    run_id: str,
    lane: str,
    person_id: str,
    company_id: str,
    observation: object,
) -> None:
    employment_id = "emp_" + hashlib.sha256(
        f"{person_id}|{company_id}".encode("utf-8")
    ).hexdigest()[:16]
    if connection.execute(
        "SELECT 1 FROM employment WHERE person_id=? AND company_id=? AND valid_to IS NULL",
        (person_id, company_id),
    ).fetchone() is not None:
        return
    observation_id = "obs_" + hashlib.sha256(
        f"{run_id}|{lane}|{employment_id}".encode("utf-8")
    ).hexdigest()[:16]
    source = SourceObservation(
        observation_id, "employment", employment_id, "company_id", json.dumps(company_id),
        f"{run_id}|{lane}", getattr(observation, "seen_at", None),
        getattr(observation, "retrieved_at"), getattr(observation, "confidence"),
        getattr(observation, "snapshot_id"),
    )
    new_employment = Employment(
        employment_id, person_id, company_id, "unknown", None, None, observation_id,
        getattr(observation, "confidence"),
    )
    old = connection.execute(
        "SELECT employment_id,company_id FROM employment WHERE person_id=? AND valid_to IS NULL",
        (person_id,),
    ).fetchone()
    if old is None:
        insert_source_observation(connection, source)
        insert_employment(connection, new_employment)
    else:
        apply_role_change(connection, str(old[0]), str(old[1]), new_employment, (source,), source.retrieved_at)


def _persist_batch(
    connection: sqlite3.Connection, run_id: str, lane: str, batch: LaneBatch
) -> tuple[tuple[str, str], ...]:
    person_ids = _canonical_person_ids(connection, batch)
    company_values = _batch_values(batch, "company")
    company_ids: dict[str, str] = {}
    for upstream_id, values in company_values.items():
        name = values.get("name") or values.get("company_name") or upstream_id
        key = hashlib.sha256((values.get("website_url") or name.casefold()).encode("utf-8")).hexdigest()
        row = connection.execute("SELECT company_id FROM company WHERE dedupe_key=?", (key,)).fetchone()
        company_ids[upstream_id] = str(row[0]) if row is not None else "cmp_" + key[:16]
    entity_ids: list[tuple[str, str]] = []
    for observation in batch.observations:
        entity_id = (
            person_ids.get(observation.entity_id, observation.entity_id)
            if observation.entity_type == "person"
            else company_ids.get(observation.entity_id, observation.entity_id)
        )
        entity_ids.append((observation.entity_type, entity_id))
        if observation.entity_type == "company":
            values = company_values[observation.entity_id]
            name = values.get("name") or values.get("company_name") or observation.entity_id
            dedupe_key = hashlib.sha256(
                (values.get("website_url") or name.casefold()).encode("utf-8")
            ).hexdigest()
            connection.execute(
                """INSERT OR IGNORE INTO company(company_id,name,source_lane,dedupe_key)
                   VALUES(?,?,?,?)""",
                (entity_id, name, lane, dedupe_key),
            )
        elif observation.entity_type == "person":
            company_ref = _batch_values(batch, "person")[observation.entity_id].get("company_id")
            if company_ref and company_ref in company_ids:
                _persist_employment(connection, run_id, lane, entity_id, company_ids[company_ref], observation)
        else:
            raise ValueError("unsupported_list_entity_type")
        connection.execute(
            """INSERT OR IGNORE INTO source_observation(
                   observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,
                   confidence,snapshot_id
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                observation.observation_id,
                observation.entity_type,
                entity_id,
                observation.field,
                _observation_value(observation.value),
                f"{run_id}|{lane}",
                observation.seen_at,
                observation.retrieved_at,
                observation.confidence,
                observation.snapshot_id,
            ),
        )
    return tuple(dict.fromkeys(entity_ids))


def _run_id_for(
    connection: sqlite3.Connection, campaign_id: str, policy_hash: str, at: str,
    requested_companies: int, requested_people: int,
) -> str:
    row = connection.execute(
        """SELECT finder_run_id FROM finder_run
           WHERE campaign_id=? AND policy_hash=? AND state<>'completed'
           ORDER BY started_at DESC LIMIT 1""",
        (campaign_id, policy_hash),
    ).fetchone()
    if row is not None:
        return str(row[0])
    # Finder-page requests use the P1 typed opaque finder-run field.  Preserve
    # the run's UUID-like entropy while giving the executor its required prefix.
    run_id = "camp_" + uuid.uuid4().hex[:16]
    connection.execute(
        """INSERT INTO finder_run(
               finder_run_id,campaign_id,policy_hash,requested_companies,requested_people,
               state,started_at,updated_at
           ) VALUES(?,?,?,?,?,'running',?,?)""",
        (run_id, campaign_id, policy_hash, requested_companies, requested_people, at, at),
    )
    return run_id


def build_list(
    connection: sqlite3.Connection,
    campaign_id: str,
    target_policy: TargetPolicy,
    lanes: Sequence[Lane],
    pipeline: ListPipeline,
    at: str,
    interrupt_after_batches: int | None = None,
) -> ListBuildSummary:
    """Build one campaign-scoped finder run without relaxing its selected policy."""
    if not lanes or not target_policy.lane_plan:
        raise ValueError("list_builder_requires_concrete_lane")
    if target_policy.requested_companies == 0 and target_policy.requested_people == 0:
        raise ValueError("list_builder_requires_requested_target")
    if not pipeline.configured:
        raise ValueError("list_builder_requires_configured_stages")
    campaign = connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if campaign is None:
        raise KeyError(campaign_id)
    campaign_policy_hash = str(campaign["policy_hash"])
    if campaign_policy_hash != target_policy.policy_hash:
        raise ValueError("campaign_policy_hash_mismatch")
    policy_hash = target_policy.policy_hash
    run_id = _run_id_for(
        connection, campaign_id, policy_hash, at,
        target_policy.requested_companies, target_policy.requested_people,
    )
    connection.commit()
    lane_values = tuple(lanes)
    for lane in lane_values:
        bind_run = getattr(lane, "bind_run", None)
        if callable(bind_run):
            bind_run(run_id)
    lane_by_name = {lane.name: lane for lane in lane_values}
    plans = plan_lanes(target_policy, lane_values, frozenset(), campaign_id, policy_hash)
    batches = 0
    shortfall: str | None = None
    interrupted = False

    for plan in plans:
        lane = lane_by_name[plan.lane]
        while True:
            cursor = load_lane_cursor(connection, run_id, plan.lane)
            batch = lane.run(plan, cursor)
            entity_ids = _persist_batch(connection, run_id, plan.lane, batch)
            connection.execute("BEGIN")
            try:
                advance_lane_cursor(
                    connection,
                    run_id,
                    plan.lane,
                    batch.next_cursor,
                    (cursor.processed if cursor else 0) + batch.processed,
                    (cursor.yielded if cursor else 0) + batch.yielded,
                    plan.capability_version,
                    at,
                    commit=False,
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            pipeline.process(connection, run_id, campaign_id, entity_ids, target_policy, at)
            batches += 1
            shortfall = batch.shortfall_reason or shortfall
            if interrupt_after_batches is not None and batches >= interrupt_after_batches:
                interrupted = True
                break
            if batch.exhausted or batch.shortfall_reason in {
                "checkpoint", "cap_reached", "credit_budget", "lane_exhausted",
            }:
                break
        if interrupted or shortfall in {"checkpoint", "cap_reached", "credit_budget"}:
            break

    source_prefix = run_id + "|%"
    company_count = connection.execute(
        """SELECT COUNT(DISTINCT entity_id) FROM source_observation
           WHERE entity_type='company' AND source LIKE ?""",
        (source_prefix,),
    ).fetchone()[0]
    person_ids = tuple(
        row[0]
        for row in connection.execute(
            """SELECT DISTINCT entity_id FROM source_observation
               WHERE entity_type='person' AND source LIKE ?""",
            (source_prefix,),
        )
    )
    cleaning = clean_contacts(connection, person_ids, at) if person_ids else None
    duplicates = sum(
        connection.execute(
            f"""SELECT COUNT(*)-COUNT(DISTINCT dedupe_key) FROM {table}
                WHERE {table}_id IN (
                    SELECT entity_id FROM source_observation WHERE entity_type=? AND source LIKE ?
                )""",
            (table, source_prefix),
        ).fetchone()[0]
        for table in ("company", "person")
    )
    attempts, credits = connection.execute(
        """SELECT COUNT(*),COALESCE(SUM(credits),0) FROM provider_attempt
           WHERE person_id IN (
               SELECT entity_id FROM source_observation WHERE entity_type='person' AND source LIKE ?
           )""",
        (source_prefix,),
    ).fetchone()
    database_state = "paused" if interrupted else "completed"
    summary_state = "interrupted" if interrupted else "complete"
    connection.execute(
        """UPDATE finder_run SET state=?,updated_at=?,completed_at=?,shortfall_reason=?
           WHERE finder_run_id=?""",
        (database_state, at, at if database_state == "completed" else None, shortfall, run_id),
    )
    connection.commit()
    return ListBuildSummary(
        run_id,
        run_id,
        int(company_count),
        len(person_ids),
        0 if cleaning is None else cleaning.valid,
        0 if cleaning is None else cleaning.quarantined,
        int(duplicates),
        int(attempts),
        int(credits),
        shortfall,
        summary_state,
        pipeline.already_has_contact,
    )


def summary_json(summary: ListBuildSummary) -> str:
    fields = asdict(summary)
    assert_vm_safe({"kind": "process_results", "fields": fields}, "process_results")
    result = {
        field: fields[field]
        for field in (
            "companies",
            "people",
            "already_has_contact",
            "valid_contacts",
            "quarantined",
            "duplicates",
            "attempts",
            "credits",
            "shortfall_reason",
            "state",
        )
    }
    return json.dumps(result, sort_keys=True, separators=(",", ":"))


class _QueueOnlyVendorAdapter:
    """Metadata-only adapter used solely to reserve a typed executor request."""

    max_retries = 0

    def __init__(self, provider: str, operation: str, unit_cost: int) -> None:
        self.provider = provider
        self.operation = operation
        self.unit_cost = unit_cost

    def max_cost(self, operation: str) -> int:
        if operation != self.operation:
            raise ValueError("unsupported_vendor_operation")
        return self.unit_cost

    def call(self, *args: object, **kwargs: object) -> object:
        raise RuntimeError("queued_vendor_request_must_be_executed_by_executor")


def _load_campaign_policy(connection: sqlite3.Connection, campaign_id: str) -> TargetPolicy:
    row = connection.execute(
        "SELECT policy_json FROM campaign WHERE campaign_id=?", (campaign_id,)
    ).fetchone()
    if row is None:
        raise KeyError(campaign_id)
    raw = json.loads(str(row[0]))
    if not isinstance(raw, dict):
        raise ValueError("campaign_policy_must_be_object")

    def resolve_company(name: str) -> str | None:
        matches = connection.execute(
            "SELECT company_id FROM company WHERE name=?", (name,)
        ).fetchall()
        return str(matches[0][0]) if len(matches) == 1 else None

    return __import__("scripts.prospecting.p2_store", fromlist=["compile_target_policy"]).compile_target_policy(
        raw, resolve_company
    )


def _queue_person_vendor_lookups(
    connection: sqlite3.Connection,
    campaign_id: str,
    person_ids: Sequence[str],
    policy_hash: str,
    at: str,
    finder_provider: str,
    finder_operation: str,
    finder_unit_cost: int,
) -> int:
    adapter: VendorAdapter = _QueueOnlyVendorAdapter(
        finder_provider, finder_operation, finder_unit_cost
    )
    already_has_contact = 0
    for person_id in person_ids:
        if connection.execute(
            "SELECT 1 FROM contact_point WHERE person_id=? LIMIT 1", (person_id,)
        ).fetchone() is not None:
            already_has_contact += 1
            continue
        request_id = "req_" + hashlib.sha256(
            f"{campaign_id}|{policy_hash}|{person_id}|{finder_provider}".encode("utf-8")
        ).hexdigest()[:16]
        if connection.execute(
            "SELECT 1 FROM exec_request WHERE request_id=?", (request_id,)
        ).fetchone() is None:
            queue_vendor_lookup(
                connection, campaign_id=campaign_id, person_id=person_id, provider=finder_provider,
                vendor_operation=finder_operation, payload={}, policy_hash=policy_hash,
                request_id=request_id, adapter=adapter, now=at,
            )
    return already_has_contact


def _parse_lanes(value: str) -> tuple[str, ...]:
    lanes = tuple(item.strip() for item in value.split(",") if item.strip())
    if not lanes or len(lanes) != len(set(lanes)):
        raise argparse.ArgumentTypeError("lanes must be a non-empty unique comma-separated list")
    if any(lane not in ({"manual", "pitchbook"} | lanes_registry.registered_lanes()) for lane in lanes):
        raise argparse.ArgumentTypeError("unsupported concrete lane")
    return lanes


def _run_command(args: argparse.Namespace) -> ListBuildSummary:
    connection = open_store(Path(args.store) if args.store else None)
    shadow: sqlite3.Connection | None = None
    try:
        active = connection
        if args.dry_run:
            shadow = sqlite3.connect(":memory:", isolation_level=None)
            shadow.row_factory = sqlite3.Row
            connection.backup(shadow)
            active = shadow
        policy = _load_campaign_policy(active, args.campaign)
        if tuple(policy.lane_plan) != args.lanes:
            raise ValueError("requested_lanes_must_match_campaign_policy")
        finder_defaults = {
            "pdl": ("person_search", 0),
            "snov": ("find", 1),
            "hunter": ("find", 1),
        }
        default_operation, default_cost = finder_defaults[args.finder_provider]
        finder_operation = args.finder_operation or default_operation
        finder_unit_cost = default_cost if args.finder_cost is None else args.finder_cost
        from scripts.prospecting.finder_manual import ManualLane
        from scripts.prospecting.finder_pitchbook import PitchBookLane

        lanes: list[Lane] = []
        for name in args.lanes:
            if name == "manual":
                lanes.append(ManualLane(active, args.max_people))
            elif name == "pitchbook":
                lanes.append(PitchBookLane(
                    Path(args.pitchbook_csv) if args.pitchbook_csv else None,
                ))
            else:
                lanes.append(lanes_registry.build_lane(name, active))
        at = args.at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        pipeline = ListPipeline(
            reserved_enrich=lambda db, campaign, people, now: _queue_person_vendor_lookups(
                db, campaign, people, policy.policy_hash, now,
                args.finder_provider, finder_operation, finder_unit_cost,
            ),
            role_check=lambda *_: None,
            snapshot=lambda *_: None,
        )
        return build_list(active, args.campaign, policy, tuple(lanes), pipeline, at)
    finally:
        if shadow is not None:
            shadow.close()
        connection.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="py -3 -m scripts.prospecting.list_builder")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--campaign", required=True)
    run.add_argument("--lanes", required=True, type=_parse_lanes)
    run.add_argument("--max-people", type=int)
    run.add_argument("--dry-run", action="store_true")
    run.add_argument("--store")
    run.add_argument("--pitchbook-csv")
    run.add_argument("--at")
    run.add_argument("--finder-provider", choices=("pdl", "snov", "hunter"), default="pdl")
    run.add_argument("--finder-operation")
    run.add_argument("--finder-cost", type=int)
    args = parser.parse_args(argv)
    if args.max_people is not None and args.max_people < 1:
        parser.error("--max-people must be positive")
    if args.finder_cost is not None and args.finder_cost < 0:
        parser.error("--finder-cost must be non-negative")
    if args.command == "run":
        print(summary_json(_run_command(args)))
        return 0
    raise AssertionError("unreachable_command")


if __name__ == "__main__":
    raise SystemExit(main())
