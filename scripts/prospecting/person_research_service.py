"""Private, source-bound current-person imports for an exact P17 research scope."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import ipaddress
import json
from pathlib import Path
import re
import sqlite3
from types import MappingProxyType
from typing import Callable, Mapping
from urllib.parse import SplitResult, urlsplit, urlunsplit
import uuid

from scripts.prospecting.affinity.source_review import (
    MAX_OPERATOR_SNAPSHOTS,
    MAX_OPERATOR_SNAPSHOT_BYTES,
    MAX_SOURCE_BYTES,
    _owned_snapshot_usage,
    identity_excerpt,
)
from scripts.prospecting.funding_research_service import (
    FundingResearchError,
    FundingResearchService,
)
from scripts.prospecting.pipeline_service import PipelineError, PipelineService
from scripts.prospecting.source_capture import (
    SourceCaptureError,
    cleanup_owned,
    copy_owned,
    read_capture,
    read_owned,
)


MAX_CANDIDATES = MAX_OPERATOR_SNAPSHOTS
MAX_CANDIDATES_PER_TARGET = 3
IMPORTER_VERSION = "person-current-role-import-v1"
_IMPORTER_MANIFEST = {
    "version": IMPORTER_VERSION,
    "source_pages_per_candidate": 1,
    "page_bytes": MAX_SOURCE_BYTES,
    "aggregate_operator_snapshots": MAX_OPERATOR_SNAPSHOTS,
    "aggregate_operator_bytes": MAX_OPERATOR_SNAPSHOT_BYTES,
    "candidate_multiplier": MAX_CANDIDATES_PER_TARGET,
    "identity": "exact-profile-or-unique-full-name-company-title",
    "first_name": "caller-supplied-contiguous-full-name-token-sequence",
    "authority": "awaiting-person-qualification-factcheck",
}
IMPORTER_HASH = sha256(json.dumps(
    _IMPORTER_MANIFEST, sort_keys=True, separators=(",", ":"),
).encode()).hexdigest()
_RUN_ID = re.compile(r"prun_[0-9a-f]{32}\Z")
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_DNS_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class PersonResearchError(ValueError):
    """Stable-code refusal at the private person import boundary."""


@dataclass(frozen=True, repr=False)
class PersonCapture:
    funding_result_id: str
    company_id: str
    first_name: str
    full_name: str
    title: str
    profile_url: str | None
    source_url: str
    body_ref: str
    captured_at: str


@dataclass(frozen=True, repr=False)
class PersonResearchRequest:
    request_id: str
    run_id: str
    expected_intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    research_result_ids: tuple[str, ...]
    candidates: tuple[PersonCapture, ...]


@dataclass(frozen=True, repr=False)
class PersonCandidateProjection:
    candidate_id: str
    ordinal: int
    funding_result_id: str
    company_id: str
    person_id: str | None
    employment_id: str | None
    outcome: str
    reason_codes: tuple[str, ...]
    snapshot_id: str
    observation_id: str | None


@dataclass(frozen=True, repr=False)
class PersonResearchProjection:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    state: str
    research_company_count: int
    candidate_count: int
    imported_count: int
    collision_count: int
    source_unknown_count: int
    requested_people_total: int
    provisional_shortfall: int
    candidates: tuple[PersonCandidateProjection, ...]


@dataclass(frozen=True)
class PersonResearchSafeProjection:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    state: str
    counts: Mapping[str, int]


@dataclass(frozen=True)
class PersonResearchResult:
    batch_id: str
    batch_hash: str
    run_id: str
    state: str
    counts: Mapping[str, int]
    replayed: bool = False


@dataclass(frozen=True, repr=False)
class _Prepared:
    supplied: PersonCapture
    source_url: str
    profile_url: str | None
    captured_at: str
    contents: bytes = field(repr=False)
    content_hash: str = ""
    identity_hash: str = ""


def _canonical(value: object) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, UnicodeError):
        raise PersonResearchError("invalid_request") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def _text(value: object, code: str, maximum: int, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if type(value) is not str or not value or value != value.strip() or _CONTROL.search(value):
        raise PersonResearchError(code)
    try:
        if len(value.encode("utf-8")) > maximum:
            raise PersonResearchError(code)
    except UnicodeError:
        raise PersonResearchError(code) from None
    return value


def _uuid(value: object) -> str:
    if type(value) is not str:
        raise PersonResearchError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise PersonResearchError("invalid_request_id") from None
    if str(parsed) != value:
        raise PersonResearchError("invalid_request_id")
    return value


def _hash(value: object, code: str) -> str:
    if type(value) is not str or _SHA.fullmatch(value) is None:
        raise PersonResearchError(code)
    return value


def _timestamp(value: object, code: str) -> datetime:
    if type(value) is not str:
        raise PersonResearchError(code)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(timezone.utc)
    except ValueError:
        raise PersonResearchError(code) from None


def _url(value: object, code: str, *, optional: bool = False) -> str | None:
    raw = _text(value, code, 2048, optional=optional)
    if raw is None:
        return None
    try:
        parsed = urlsplit(raw)
        host = (parsed.hostname or "").casefold().rstrip(".")
        host.encode("ascii")
        labels = host.split(".")
        if (
            parsed.scheme.casefold() != "https" or not host or "." not in host
            or parsed.username is not None or parsed.password is not None
            or parsed.port not in (None, 443) or len(host) > 253 or "\\" in raw
            or any(_DNS_LABEL.fullmatch(label) is None for label in labels)
        ):
            raise ValueError
        try:
            address = ipaddress.ip_address(host)
            if not address.is_global:
                raise ValueError
        except ValueError as error:
            if host.replace(".", "").isdigit():
                raise error
        return urlunsplit(SplitResult("https", host, parsed.path or "/", parsed.query, ""))
    except (TypeError, ValueError, UnicodeError):
        raise PersonResearchError(code) from None


def _normal(value: str) -> str:
    return " ".join(
        "".join(character.casefold() if character.isalnum() else " " for character in value).split()
    )


def _contains_token_sequence(container: str, wanted: str) -> bool:
    container_tokens = _normal(container).split()
    wanted_tokens = _normal(wanted).split()
    return bool(wanted_tokens) and any(
        container_tokens[index:index + len(wanted_tokens)] == wanted_tokens
        for index in range(len(container_tokens) - len(wanted_tokens) + 1)
    )


def _id(prefix: str, request_id: str, suffix: str, length: int = 32) -> str:
    return prefix + uuid.uuid5(
        uuid.NAMESPACE_URL, f"kb:prospecting:person:{request_id}:{suffix}",
    ).hex[:length]


def _snapshot_root(connection: sqlite3.Connection) -> Path:
    database = next((str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"), "")
    if not database:
        raise PersonResearchError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _decode_array(value: object) -> tuple[str, ...]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise PersonResearchError("store_state_invalid") from None
    if not isinstance(decoded, list) or any(type(item) is not str for item in decoded):
        raise PersonResearchError("store_state_invalid")
    return tuple(decoded)


def _prepare(request: object, root: Path) -> tuple[PersonResearchRequest, tuple[_Prepared, ...], str]:
    if not isinstance(request, PersonResearchRequest):
        raise PersonResearchError("invalid_request")
    request_id = _uuid(request.request_id)
    if type(request.run_id) is not str or _RUN_ID.fullmatch(request.run_id) is None:
        raise PersonResearchError("invalid_run_id")
    intake_hash = _hash(request.expected_intake_hash, "invalid_intake_hash")
    funding_batch = _text(request.funding_batch_id, "invalid_funding_batch", 80)
    funding_hash = _hash(request.funding_batch_hash, "invalid_funding_batch")
    if (request.predecessor_batch_id is None) != (request.predecessor_hash is None):
        raise PersonResearchError("invalid_predecessor")
    predecessor_id = None if request.predecessor_batch_id is None else _text(
        request.predecessor_batch_id, "invalid_predecessor", 80,
    )
    predecessor_hash = None if request.predecessor_hash is None else _hash(
        request.predecessor_hash, "invalid_predecessor",
    )
    if (
        type(request.research_result_ids) is not tuple or not request.research_result_ids
        or any(type(item) is not str or not item.startswith("pfrr_") for item in request.research_result_ids)
        or len(set(request.research_result_ids)) != len(request.research_result_ids)
    ):
        raise PersonResearchError("invalid_research_scope")
    if type(request.candidates) is not tuple or len(request.candidates) > MAX_CANDIDATES:
        raise PersonResearchError("invalid_candidates")
    prepared: list[_Prepared] = []
    identities: set[str] = set()
    total = 0
    request_candidates: list[dict[str, object]] = []
    for candidate in request.candidates:
        if not isinstance(candidate, PersonCapture):
            raise PersonResearchError("invalid_candidate")
        result_id = _text(candidate.funding_result_id, "invalid_candidate", 80)
        company_id = _text(candidate.company_id, "invalid_candidate", 80)
        first_name = _text(candidate.first_name, "invalid_candidate", 120)
        full_name = _text(candidate.full_name, "invalid_candidate", 240)
        title = _text(candidate.title, "invalid_candidate", 240)
        profile_url = _url(candidate.profile_url, "invalid_profile_url", optional=True)
        source_url = _url(candidate.source_url, "invalid_source_url")
        captured_at = _timestamp(candidate.captured_at, "invalid_candidate").isoformat()
        try:
            captured = read_capture(root, candidate.body_ref, maximum=MAX_SOURCE_BYTES)
        except SourceCaptureError as error:
            code = str(error)
            raise PersonResearchError(
                "invalid_body_ref" if code == "invalid_ref" else
                "source_too_large" if code == "too_large" else "source_changed"
            ) from None
        try:
            captured.contents.decode("utf-8", errors="strict")
        except UnicodeError:
            raise PersonResearchError("invalid_candidate") from None
        total += len(captured.contents)
        if total > MAX_OPERATOR_SNAPSHOT_BYTES:
            raise PersonResearchError("batch_too_large")
        identity = {
            "funding_result_id": result_id, "company_id": company_id,
            "first_name": first_name, "full_name": full_name, "title": title,
            "profile_url": profile_url, "source_url": source_url,
        }
        identity_hash = _digest(identity)
        if identity_hash in identities:
            raise PersonResearchError("invalid_candidates")
        identities.add(identity_hash)
        supplied = PersonCapture(
            result_id, company_id, first_name, full_name, title, profile_url,
            source_url, captured.body_ref, captured_at,
        )
        prepared.append(_Prepared(
            supplied, str(source_url), profile_url, captured_at, captured.contents,
            sha256(captured.contents).hexdigest(), identity_hash,
        ))
        request_candidates.append({
            **identity, "body_ref": captured.body_ref, "captured_at": captured_at,
            "content_sha256": sha256(captured.contents).hexdigest(),
        })
    normalized = PersonResearchRequest(
        request_id, request.run_id, intake_hash, str(funding_batch), funding_hash,
        predecessor_id, predecessor_hash, request.research_result_ids, request.candidates,
    )
    request_hash = _digest({
        "operation": "import_current_people", "request_id": request_id,
        "run_id": request.run_id, "expected_intake_hash": intake_hash,
        "funding_batch_id": funding_batch, "funding_batch_hash": funding_hash,
        "predecessor_batch_id": predecessor_id, "predecessor_hash": predecessor_hash,
        "research_result_ids": list(request.research_result_ids),
        "candidates": request_candidates, "importer_hash": IMPORTER_HASH,
    })
    return normalized, tuple(prepared), request_hash


class PersonResearchService:
    def __init__(self, connection: sqlite3.Connection, *, now: Callable[[], str] | None = None) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now or (lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

    def _context(self, request: PersonResearchRequest):
        try:
            intake = PipelineService(self.connection, now=self.now).get_projection(request.run_id)
            funding = FundingResearchService(self.connection, now=self.now).get_projection(request.run_id)
        except (PipelineError, FundingResearchError):
            raise PersonResearchError("pipeline_context_stale") from None
        if intake.intake_hash != request.expected_intake_hash:
            raise PersonResearchError("intake_stale")
        if (
            funding is None or funding.batch_id != request.funding_batch_id
            or funding.batch_hash != request.funding_batch_hash
        ):
            raise PersonResearchError("funding_batch_stale")
        if len(request.research_result_ids) > intake.requested_companies:
            raise PersonResearchError("research_scope_too_large")
        by_result = {item.result_id: item for item in funding.companies}
        selected = []
        for result_id in request.research_result_ids:
            item = by_result.get(result_id)
            if item is None or item.company_id is None or item.rule_outcome != "provisional_match":
                raise PersonResearchError("invalid_research_scope")
            selected.append(item)
        per_company: dict[str, int] = {item.result_id: 0 for item in selected}
        for candidate in request.candidates:
            if candidate.funding_result_id not in per_company:
                raise PersonResearchError("candidate_outside_scope")
            projected = by_result[candidate.funding_result_id]
            if candidate.company_id != projected.company_id:
                raise PersonResearchError("candidate_company_mismatch")
            per_company[candidate.funding_result_id] += 1
            if per_company[candidate.funding_result_id] > MAX_CANDIDATES_PER_TARGET * intake.requested_people_per_company:
                raise PersonResearchError("candidate_pool_too_large")
        if len(request.candidates) > min(
            MAX_CANDIDATES,
            len(selected) * MAX_CANDIDATES_PER_TARGET * intake.requested_people_per_company,
        ):
            raise PersonResearchError("candidate_pool_too_large")
        return intake, funding, tuple(selected)

    def _resolve_person(self, candidate: _Prepared) -> tuple[str | None, str | None, bool]:
        supplied = candidate.supplied
        profile_rows = [] if candidate.profile_url is None else self.connection.execute(
            "SELECT person_id,first_name,full_name,linkedin_url FROM person WHERE linkedin_url=? ORDER BY person_id",
            (candidate.profile_url,),
        ).fetchall()
        name_rows = self.connection.execute(
            """SELECT p.person_id,p.first_name,p.full_name,p.linkedin_url,e.employment_id,e.title
                 FROM person AS p JOIN employment AS e ON e.person_id=p.person_id
                WHERE e.company_id=? AND e.valid_to IS NULL
                ORDER BY p.person_id,e.employment_id""", (supplied.company_id,),
        ).fetchall()
        name_rows = [row for row in name_rows if _normal(str(row["full_name"])) == _normal(supplied.full_name)]
        person_ids = {str(row["person_id"]) for row in (*profile_rows, *name_rows)}
        if len(profile_rows) > 1 or len(name_rows) > 1 or len(person_ids) > 1:
            return None, None, True
        if not person_ids:
            return None, None, False
        person_id = next(iter(person_ids))
        employment = [row for row in name_rows if str(row["person_id"]) == person_id]
        person = (profile_rows or employment)[0]
        if (
            _normal(str(person["first_name"])) != _normal(supplied.first_name)
            or _normal(str(person["full_name"])) != _normal(supplied.full_name)
            or candidate.profile_url is not None and str(person["linkedin_url"]) != candidate.profile_url
            or len(employment) != 1 or _normal(str(employment[0]["title"])) != _normal(supplied.title)
        ):
            return None, None, True
        return person_id, str(employment[0]["employment_id"]), False

    def import_current_people(self, request: PersonResearchRequest) -> PersonResearchResult:
        root = _snapshot_root(self.connection)
        normalized, prepared, request_hash = _prepare(request, root)
        if self.connection.in_transaction:
            raise PersonResearchError("transaction_active")
        created: list[tuple[Path, tuple[int, int]]] = []
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            intake, _funding, selected = self._context(normalized)
            replay = self.connection.execute(
                "SELECT request_hash,batch_id FROM prospecting_person_batch WHERE request_id=?",
                (normalized.request_id,),
            ).fetchone()
            if replay is not None:
                if str(replay["request_hash"]) != request_hash:
                    raise PersonResearchError("request_conflict")
                projection = self._projection(str(replay["batch_id"]), intake)
                self.connection.commit()
                return self._result(projection, True)
            latest = self.connection.execute(
                "SELECT batch_id,batch_hash FROM prospecting_person_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
                (normalized.run_id,),
            ).fetchone()
            wanted = None if latest is None else (str(latest[0]), str(latest[1]))
            supplied_predecessor = (normalized.predecessor_batch_id, normalized.predecessor_hash)
            if wanted != (None if supplied_predecessor == (None, None) else supplied_predecessor):
                raise PersonResearchError("predecessor_conflict")
            stamp_dt = _timestamp(self.now(), "store_state_invalid")
            for candidate in prepared:
                captured = _timestamp(candidate.captured_at, "invalid_candidate")
                if captured > stamp_dt or captured + timedelta(days=30) < stamp_dt:
                    raise PersonResearchError("source_stale")
            root.mkdir(parents=True, exist_ok=True)
            try:
                existing_count, existing_bytes = _owned_snapshot_usage(self.connection, root)
            except ValueError:
                raise PersonResearchError("operator_source_store_invalid") from None
            if (
                existing_count + len(prepared) > MAX_OPERATOR_SNAPSHOTS
                or existing_bytes + sum(len(item.contents) for item in prepared) > MAX_OPERATOR_SNAPSHOT_BYTES
            ):
                raise PersonResearchError("operator_source_store_cap")
            batch_id = _id("pprb_", normalized.request_id, "batch")
            rows: list[dict[str, object]] = []
            seen_people: set[str] = set()
            for ordinal, candidate in enumerate(prepared):
                supplied = candidate.supplied
                candidate_id = _id("pprc_", normalized.request_id, f"candidate:{ordinal}")
                snapshot_id = _id("snap_", normalized.request_id, f"snapshot:{ordinal}")
                text = candidate.contents.decode("utf-8")
                company_name = next(
                    item.name for item in selected if item.result_id == supplied.funding_result_id
                )
                excerpt = identity_excerpt(text, supplied.full_name, company_name, supplied.title)
                source_unknown = (
                    excerpt is None
                    or not _contains_token_sequence(supplied.full_name, supplied.first_name)
                    or not _contains_token_sequence(text, supplied.first_name)
                )
                person_id = employment_id = observation_id = None
                collision = False
                if not source_unknown:
                    person_id, employment_id, collision = self._resolve_person(candidate)
                    if person_id in seen_people:
                        person_id = employment_id = None
                        collision = True
                if source_unknown:
                    outcome, reasons = "source_unknown", ("identity_not_structurally_present",)
                elif collision:
                    outcome, reasons = "identity_collision", ("person_identity_collision",)
                    person_id = employment_id = None
                else:
                    outcome, reasons = "provisional_import", ("current_role_source_captured",)
                    if person_id is None:
                        person_id = _id("per_", normalized.request_id, f"person:{ordinal}", 16)
                        employment_id = _id("emp_", normalized.request_id, f"employment:{ordinal}", 16)
                    seen_people.add(person_id)
                    observation_id = _id("obs_", normalized.request_id, f"observation:{ordinal}")
                body_ref = copy_owned(
                    root, namespace=None, snapshot_id=snapshot_id, contents=candidate.contents,
                    maximum=MAX_SOURCE_BYTES, created=created,
                )
                expires = (_timestamp(candidate.captured_at, "invalid_candidate") + timedelta(days=30)).isoformat()
                entity_id = candidate_id if person_id is None else person_id
                self.connection.execute(
                    """INSERT INTO source_snapshot(
                           snapshot_id,entity_id,source_url,source_domain,retrieved_at,content_type,
                           content_sha256,allowlist_version,body_ref,expires_at,retention_delete_at)
                       VALUES(?,?,?,?,?,'text/plain',?,'operator-local-v1',?,?,?)""",
                    (snapshot_id, entity_id, candidate.source_url, urlsplit(candidate.source_url).hostname,
                     candidate.captured_at, candidate.content_hash, body_ref, expires, expires),
                )
                if person_id is not None:
                    existing_person = self.connection.execute(
                        "SELECT 1 FROM person WHERE person_id=?", (person_id,),
                    ).fetchone()
                    if existing_person is None:
                        self.connection.execute(
                            """INSERT INTO person(
                                   person_id,first_name,full_name,linkedin_url,source_lane,dedupe_key)
                               VALUES(?,?,?,?,? ,?)""",
                            (person_id, supplied.first_name, supplied.full_name, candidate.profile_url,
                             "manual", "person:" + candidate.identity_hash),
                        )
                    self.connection.execute(
                        """INSERT INTO source_observation(
                               observation_id,entity_type,entity_id,field,value,source,seen_at,
                               retrieved_at,confidence,snapshot_id)
                           VALUES(?,'person',?,'source_review_candidate',?,?,?,?,1.0,?)""",
                        (observation_id, person_id, _canonical({"excerpt": excerpt}), snapshot_id,
                         candidate.captured_at, candidate.captured_at, snapshot_id),
                    )
                    if self.connection.execute(
                        "SELECT 1 FROM employment WHERE employment_id=?", (employment_id,),
                    ).fetchone() is None:
                        self.connection.execute(
                            """INSERT INTO employment(
                                   employment_id,person_id,company_id,title,valid_from,valid_to,
                                   source_observation_id,confidence)
                               VALUES(?,?,?,?,NULL,NULL,?,1.0)""",
                            (employment_id, person_id, supplied.company_id, supplied.title, observation_id),
                        )
                manifest = {
                    "snapshot_id": snapshot_id, "observation_id": observation_id,
                    "entity_id": entity_id,
                    "source_url": candidate.source_url, "retrieved_at": candidate.captured_at,
                    "body_ref": body_ref, "content_sha256": candidate.content_hash,
                    "excerpt_sha256": None if excerpt is None else sha256(excerpt.encode()).hexdigest(),
                }
                rows.append({
                    "candidate_id": candidate_id, "ordinal": ordinal, "prepared": candidate,
                    "person_id": person_id, "employment_id": employment_id,
                    "outcome": outcome, "reasons": reasons, "snapshot_id": snapshot_id,
                    "observation_id": observation_id, "manifest": manifest,
                    "manifest_hash": _digest(manifest),
                })
            counts = {
                "imported": sum(row["outcome"] == "provisional_import" for row in rows),
                "collisions": sum(row["outcome"] == "identity_collision" for row in rows),
                "source_unknown": sum(row["outcome"] == "source_unknown" for row in rows),
            }
            requested_total = len(selected) * intake.requested_people_per_company
            imported_by_result = {
                item.result_id: len({
                    str(row["person_id"])
                    for row in rows
                    if row["outcome"] == "provisional_import"
                    and row["prepared"].supplied.funding_result_id == item.result_id
                })
                for item in selected
            }
            shortfall = sum(
                max(0, intake.requested_people_per_company - imported_by_result[item.result_id])
                for item in selected
            )
            research_ids_hash = _digest(list(normalized.research_result_ids))
            batch_hash = _digest({
                "batch_id": batch_id, "run_id": normalized.run_id,
                "intake_hash": normalized.expected_intake_hash,
                "funding_batch_id": normalized.funding_batch_id,
                "funding_batch_hash": normalized.funding_batch_hash,
                "research_result_ids_hash": research_ids_hash,
                "predecessor_batch_id": normalized.predecessor_batch_id,
                "predecessor_hash": normalized.predecessor_hash,
                "request_hash": request_hash,
                "candidates": [{
                    "candidate_id": row["candidate_id"], "ordinal": row["ordinal"],
                    "funding_result_id": row["prepared"].supplied.funding_result_id,
                    "company_id": row["prepared"].supplied.company_id,
                    "identity_hash": row["prepared"].identity_hash,
                    "outcome": row["outcome"], "reasons": row["reasons"],
                    "manifest_hash": row["manifest_hash"],
                } for row in rows],
            })
            stamp = stamp_dt.isoformat()
            self.connection.execute(
                """INSERT INTO prospecting_person_batch(
                       batch_id,request_id,request_hash,batch_hash,run_id,intake_id,intake_hash,
                       campaign_policy_hash,funding_batch_id,funding_batch_hash,research_result_ids_json,
                       research_result_ids_hash,predecessor_batch_id,predecessor_hash,importer_version,
                       importer_hash,candidate_count,imported_count,collision_count,source_unknown_count,
                       requested_people_total,provisional_shortfall,state,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'awaiting_person_qualification_factcheck',?)""",
                (batch_id, normalized.request_id, request_hash, batch_hash, normalized.run_id,
                 intake.intake_id, intake.intake_hash, intake.campaign_policy_hash,
                 normalized.funding_batch_id, normalized.funding_batch_hash,
                 _canonical(list(normalized.research_result_ids)), research_ids_hash,
                 normalized.predecessor_batch_id, normalized.predecessor_hash,
                 IMPORTER_VERSION, IMPORTER_HASH, len(rows), counts["imported"], counts["collisions"],
                 counts["source_unknown"], requested_total, shortfall, stamp),
            )
            for row in rows:
                supplied = row["prepared"].supplied
                identity = {
                    "funding_result_id": supplied.funding_result_id,
                    "company_id": supplied.company_id,
                    "first_name": supplied.first_name, "full_name": supplied.full_name,
                    "title": supplied.title, "profile_url": row["prepared"].profile_url,
                    "source_url": row["prepared"].source_url,
                }
                self.connection.execute(
                    """INSERT INTO prospecting_person_candidate(
                           candidate_id,batch_id,ordinal,funding_result_id,company_id,
                           candidate_identity_json,candidate_identity_hash,person_id,employment_id,
                           outcome,reason_codes_json,snapshot_id,observation_id,
                           source_manifest_json,source_manifest_hash,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (row["candidate_id"], batch_id, row["ordinal"], supplied.funding_result_id,
                     supplied.company_id, _canonical(identity), row["prepared"].identity_hash,
                     row["person_id"], row["employment_id"], row["outcome"],
                     _canonical(list(row["reasons"])), row["snapshot_id"], row["observation_id"],
                     _canonical(row["manifest"]), row["manifest_hash"], stamp),
                )
            projection = self._projection(batch_id, intake)
            self.connection.commit()
            return self._result(projection, False)
        except BaseException as error:
            self.connection.rollback()
            cleanup_owned(created)
            if isinstance(error, PersonResearchError):
                raise
            if isinstance(error, SourceCaptureError):
                raise PersonResearchError("source_changed") from None
            if isinstance(error, sqlite3.Error):
                raise PersonResearchError("store_state_invalid") from None
            raise

    def _projection(self, batch_id: str, intake) -> PersonResearchProjection:
        batch = self.connection.execute(
            "SELECT * FROM prospecting_person_batch WHERE batch_id=?", (batch_id,),
        ).fetchone()
        if batch is None:
            raise PersonResearchError("store_state_invalid")
        request = PersonResearchRequest(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", str(batch["run_id"]), str(batch["intake_hash"]),
            str(batch["funding_batch_id"]), str(batch["funding_batch_hash"]),
            None if batch["predecessor_batch_id"] is None else str(batch["predecessor_batch_id"]),
            None if batch["predecessor_hash"] is None else str(batch["predecessor_hash"]),
            _decode_array(batch["research_result_ids_json"]), (),
        )
        _intake, _funding, selected = self._context(request)
        if (
            str(batch["intake_id"]) != intake.intake_id
            or str(batch["intake_hash"]) != intake.intake_hash
            or str(batch["campaign_policy_hash"]) != intake.campaign_policy_hash
            or str(batch["importer_version"]) != IMPORTER_VERSION
            or str(batch["importer_hash"]) != IMPORTER_HASH
            or _digest(list(request.research_result_ids)) != str(batch["research_result_ids_hash"])
        ):
            raise PersonResearchError("pipeline_context_stale")
        rows = self.connection.execute(
            "SELECT * FROM prospecting_person_candidate WHERE batch_id=? ORDER BY ordinal", (batch_id,),
        ).fetchall()
        root = _snapshot_root(self.connection)
        projections: list[PersonCandidateProjection] = []
        hash_rows: list[dict[str, object]] = []
        stamp = _timestamp(self.now(), "store_state_invalid")
        selected_by_result = {item.result_id: item for item in selected}
        identity_keys = {
            "funding_result_id", "company_id", "first_name", "full_name", "title",
            "profile_url", "source_url",
        }
        manifest_keys = {
            "snapshot_id", "observation_id", "entity_id", "source_url", "retrieved_at",
            "body_ref", "content_sha256", "excerpt_sha256",
        }
        for expected_ordinal, row in enumerate(rows):
            if int(row["ordinal"]) != expected_ordinal:
                raise PersonResearchError("store_state_invalid")
            selected_company = selected_by_result.get(str(row["funding_result_id"]))
            if selected_company is None or selected_company.company_id != str(row["company_id"]):
                raise PersonResearchError("store_state_invalid")
            try:
                identity = json.loads(str(row["candidate_identity_json"]))
            except json.JSONDecodeError:
                raise PersonResearchError("store_state_invalid") from None
            if (
                not isinstance(identity, dict) or set(identity) != identity_keys
                or any(type(identity[key]) is not str for key in (
                    "funding_result_id", "company_id", "first_name", "full_name", "title", "source_url",
                ))
                or identity["profile_url"] is not None and type(identity["profile_url"]) is not str
                or identity["funding_result_id"] != str(row["funding_result_id"])
                or identity["company_id"] != str(row["company_id"])
                or _digest(identity) != str(row["candidate_identity_hash"])
            ):
                raise PersonResearchError("store_state_invalid")
            try:
                manifest = json.loads(str(row["source_manifest_json"]))
            except json.JSONDecodeError:
                raise PersonResearchError("store_state_invalid") from None
            if (
                not isinstance(manifest, dict) or set(manifest) != manifest_keys
                or any(type(manifest[key]) is not str for key in (
                    "snapshot_id", "entity_id", "source_url", "retrieved_at", "body_ref", "content_sha256",
                ))
                or manifest["observation_id"] is not None and type(manifest["observation_id"]) is not str
                or manifest["excerpt_sha256"] is not None and type(manifest["excerpt_sha256"]) is not str
                or manifest["snapshot_id"] != str(row["snapshot_id"])
                or manifest["observation_id"] != (
                    None if row["observation_id"] is None else str(row["observation_id"])
                )
                or manifest["entity_id"] != (
                    str(row["candidate_id"]) if row["person_id"] is None else str(row["person_id"])
                )
                or manifest["body_ref"] != f'{row["snapshot_id"]}.body'
                or _digest(manifest) != str(row["source_manifest_hash"])
            ):
                raise PersonResearchError("store_state_invalid")
            snapshot = self.connection.execute(
                "SELECT * FROM source_snapshot WHERE snapshot_id=?", (row["snapshot_id"],),
            ).fetchone()
            if snapshot is None or any(
                str(snapshot[key]) != str(manifest[value]) for key, value in (
                    ("snapshot_id", "snapshot_id"), ("source_url", "source_url"),
                    ("retrieved_at", "retrieved_at"), ("body_ref", "body_ref"),
                    ("content_sha256", "content_sha256"),
                )
            ) or (
                str(snapshot["entity_id"]) != str(manifest["entity_id"])
                or str(snapshot["allowlist_version"]) != "operator-local-v1"
                or str(snapshot["content_type"]) != "text/plain"
                or str(snapshot["source_domain"]) != str(urlsplit(str(manifest["source_url"])).hostname)
            ):
                raise PersonResearchError("store_state_invalid")
            retrieved_at = _timestamp(manifest["retrieved_at"], "store_state_invalid")
            expires_at = _timestamp(snapshot["expires_at"], "store_state_invalid")
            if (
                expires_at != retrieved_at + timedelta(days=30)
                or _timestamp(snapshot["retention_delete_at"], "store_state_invalid") != expires_at
            ):
                raise PersonResearchError("store_state_invalid")
            if expires_at < stamp:
                raise PersonResearchError("source_stale")
            try:
                stored = read_owned(root, str(snapshot["body_ref"]), maximum=MAX_SOURCE_BYTES)
            except SourceCaptureError:
                raise PersonResearchError("source_changed") from None
            if sha256(stored.contents).hexdigest() != str(snapshot["content_sha256"]):
                raise PersonResearchError("source_changed")
            observation_id = row["observation_id"]
            if observation_id is not None:
                observation = self.connection.execute(
                    "SELECT * FROM source_observation WHERE observation_id=?", (observation_id,),
                ).fetchone()
                if (
                    observation is None or str(observation["entity_type"]) != "person"
                    or str(observation["entity_id"]) != str(row["person_id"])
                    or str(observation["field"]) != "source_review_candidate"
                    or str(observation["snapshot_id"]) != str(row["snapshot_id"])
                    or str(observation["source"]) != str(row["snapshot_id"])
                    or str(observation["seen_at"]) != str(manifest["retrieved_at"])
                    or str(observation["retrieved_at"]) != str(manifest["retrieved_at"])
                    or observation["confidence"] != 1.0
                ):
                    raise PersonResearchError("store_state_invalid")
                try:
                    value = json.loads(str(observation["value"]))
                except json.JSONDecodeError:
                    raise PersonResearchError("store_state_invalid") from None
                excerpt = value.get("excerpt") if isinstance(value, dict) else None
                if type(excerpt) is not str or sha256(excerpt.encode()).hexdigest() != manifest["excerpt_sha256"]:
                    raise PersonResearchError("store_state_invalid")
                person = self.connection.execute(
                    "SELECT * FROM person WHERE person_id=?", (row["person_id"],),
                ).fetchone()
                employment = self.connection.execute(
                    "SELECT * FROM employment WHERE employment_id=?", (row["employment_id"],),
                ).fetchone()
                if (
                    person is None or employment is None
                    or _normal(str(person["first_name"])) != _normal(str(identity["first_name"]))
                    or _normal(str(person["full_name"])) != _normal(str(identity["full_name"]))
                    or identity["profile_url"] is not None
                    and str(person["linkedin_url"]) != str(identity["profile_url"])
                    or str(employment["person_id"]) != str(row["person_id"])
                    or str(employment["company_id"]) != str(row["company_id"])
                    or _normal(str(employment["title"])) != _normal(str(identity["title"]))
                    or employment["valid_to"] is not None
                ):
                    raise PersonResearchError("store_state_invalid")
            reasons = _decode_array(row["reason_codes_json"])
            projections.append(PersonCandidateProjection(
                str(row["candidate_id"]), int(row["ordinal"]), str(row["funding_result_id"]),
                str(row["company_id"]), None if row["person_id"] is None else str(row["person_id"]),
                None if row["employment_id"] is None else str(row["employment_id"]),
                str(row["outcome"]), reasons, str(row["snapshot_id"]),
                None if row["observation_id"] is None else str(row["observation_id"]),
            ))
            hash_rows.append({
                "candidate_id": str(row["candidate_id"]), "ordinal": int(row["ordinal"]),
                "funding_result_id": str(row["funding_result_id"]), "company_id": str(row["company_id"]),
                "identity_hash": str(row["candidate_identity_hash"]), "outcome": str(row["outcome"]),
                "reasons": reasons, "manifest_hash": str(row["source_manifest_hash"]),
            })
        expected_batch_hash = _digest({
            "batch_id": str(batch["batch_id"]), "run_id": str(batch["run_id"]),
            "intake_hash": str(batch["intake_hash"]), "funding_batch_id": str(batch["funding_batch_id"]),
            "funding_batch_hash": str(batch["funding_batch_hash"]),
            "research_result_ids_hash": str(batch["research_result_ids_hash"]),
            "predecessor_batch_id": batch["predecessor_batch_id"],
            "predecessor_hash": batch["predecessor_hash"], "request_hash": str(batch["request_hash"]),
            "candidates": hash_rows,
        })
        if expected_batch_hash != str(batch["batch_hash"]):
            raise PersonResearchError("store_state_invalid")
        calculated = {
            "candidate_count": len(projections),
            "imported_count": sum(item.outcome == "provisional_import" for item in projections),
            "collision_count": sum(item.outcome == "identity_collision" for item in projections),
            "source_unknown_count": sum(item.outcome == "source_unknown" for item in projections),
        }
        requested_total = len(selected) * intake.requested_people_per_company
        imported_by_result = {
            item.result_id: len({
                candidate.person_id
                for candidate in projections
                if candidate.outcome == "provisional_import"
                and candidate.funding_result_id == item.result_id
                and candidate.person_id is not None
            })
            for item in selected
        }
        shortfall = sum(
            max(0, intake.requested_people_per_company - imported_by_result[item.result_id])
            for item in selected
        )
        if (
            any(int(batch[key]) != value for key, value in calculated.items())
            or int(batch["requested_people_total"]) != requested_total
            or int(batch["provisional_shortfall"]) != shortfall
        ):
            raise PersonResearchError("store_state_invalid")
        return PersonResearchProjection(
            str(batch["batch_id"]), str(batch["batch_hash"]), str(batch["run_id"]),
            str(batch["intake_hash"]), str(batch["funding_batch_id"]), str(batch["funding_batch_hash"]),
            None if batch["predecessor_batch_id"] is None else str(batch["predecessor_batch_id"]),
            None if batch["predecessor_hash"] is None else str(batch["predecessor_hash"]),
            str(batch["state"]), len(selected), int(batch["candidate_count"]),
            int(batch["imported_count"]), int(batch["collision_count"]),
            int(batch["source_unknown_count"]), int(batch["requested_people_total"]),
            int(batch["provisional_shortfall"]), tuple(projections),
        )

    @staticmethod
    def _result(value: PersonResearchProjection, replayed: bool) -> PersonResearchResult:
        return PersonResearchResult(
            value.batch_id, value.batch_hash, value.run_id, value.state,
            MappingProxyType({
                "research_companies": value.research_company_count,
                "candidates": value.candidate_count, "imported": value.imported_count,
                "collisions": value.collision_count, "source_unknown": value.source_unknown_count,
                "requested_people_total": value.requested_people_total,
                "provisional_shortfall": value.provisional_shortfall,
            }), replayed,
        )

    def get_projection(self, run_id: str) -> PersonResearchProjection | None:
        if type(run_id) is not str or _RUN_ID.fullmatch(run_id) is None:
            raise PersonResearchError("invalid_run_id")
        try:
            intake = PipelineService(self.connection, now=self.now).get_projection(run_id)
        except PipelineError:
            raise PersonResearchError("pipeline_context_stale") from None
        row = self.connection.execute(
            "SELECT batch_id FROM prospecting_person_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
            (run_id,),
        ).fetchone()
        return None if row is None else self._projection(str(row[0]), intake)

    def get_safe_projection(self, run_id: str) -> PersonResearchSafeProjection | None:
        projection = self.get_projection(run_id)
        if projection is None:
            return None
        return PersonResearchSafeProjection(
            projection.batch_id, projection.batch_hash, projection.run_id,
            projection.intake_hash, projection.funding_batch_id, projection.funding_batch_hash,
            projection.state, MappingProxyType({
                "research_companies": projection.research_company_count,
                "candidates": projection.candidate_count, "imported": projection.imported_count,
                "collisions": projection.collision_count,
                "source_unknown": projection.source_unknown_count,
                "requested_people_total": projection.requested_people_total,
                "provisional_shortfall": projection.provisional_shortfall,
            }),
        )


__all__ = [
    "PersonCandidateProjection", "PersonCapture", "PersonResearchError",
    "PersonResearchProjection", "PersonResearchRequest", "PersonResearchResult",
    "PersonResearchSafeProjection", "PersonResearchService",
]
