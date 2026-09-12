"""Shared resolver for the exact current selected-person source context (P22 step 1).

This module resolves and validates provenance only.  It deliberately does not
render drafts, persist rows, extend any schema, regenerate anything, mint
evidence/approval, fill contacts, or touch P16/ReviewService.  Draft rendering,
P13 review binding and P16 are expected to reuse this single resolver rather
than re-deriving selection, so that one validated walk backs every consumer.

Two deliberate boundaries:

*   No edit/suggestion shadow tables are invented here.  Any future binding of
    operator edits or agent suggestions must query the real review and agent
    lineage tables instead of a private mirror created by this resolver.
*   Source provenance walks continue across P21 budget-reset boundaries: the
    selection root is the current P20 ranking batch for the run (bound to the
    exact P19 artifact and P18 candidate rows), never a budget root, so a reset
    budget window cannot truncate or re-root the source walk.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3

from scripts.prospecting.pipeline_service import PipelineError, PipelineService
from scripts.prospecting.qualification_service import (
    MAX_SOURCE_BYTES,
    QualificationError,
    QualificationService,
)
from scripts.prospecting.ranking_service import RankingError, RankingService
from scripts.prospecting.source_capture import SourceCaptureError, read_owned


RESOLVER_VERSION = "selected-person-source-resolver-v2"
_RUN_ID = re.compile(r"prun_[0-9a-f]{32}\Z")
_CAMPAIGN_ID = re.compile(r"camp_[0-9a-f]{16}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_SAFE_ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,127}\Z")


class SelectedPersonSourceError(ValueError):
    """Stable-code refusal at the selected-person source-resolution boundary."""


@dataclass(frozen=True, repr=False)
class SelectedPersonSource:
    """Immutable exact provenance plus evidence helper data for one selected person.

    ``repr=False`` matches the private-field convention already used by the P19/P20
    dataclasses: this record carries a private excerpt, source URL and title, none
    of which may leak through an accidental repr/log call.
    """

    resolver_version: str
    run_id: str
    campaign_id: str
    campaign_policy_hash: str
    intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    person_batch_id: str
    person_batch_hash: str
    qualification_batch_id: str
    qualification_batch_hash: str
    qualification_item_id: str
    qualification_artifact_id: str
    qualification_output_hash: str
    ranking_batch_id: str
    ranking_batch_hash: str
    role_policy_version: str
    role_policy_hash: str
    person_rank_id: str
    rank_ordinal: int
    mapped_family: str
    match_kind: str
    funding_result_id: str
    company_id: str
    person_id: str
    employment_id: str
    title: str
    title_hash: str
    representative_candidate_id: str
    source_candidate_ids: tuple[str, ...]
    source_title_hashes: tuple[str, ...]
    candidate_observation_id: str
    employment_observation_id: str
    snapshot_id: str
    source_url: str
    retrieved_at: str
    expires_at: str
    content_sha256: str
    excerpt: str
    source_context_digest: str


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise SelectedPersonSourceError("store_state_invalid") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def _normal(value: object) -> str:
    return " ".join(
        "".join(
            character.casefold() if character.isalnum() else " "
            for character in str(value)
        ).split()
    )


def _timestamp(value: object) -> datetime:
    if type(value) is not str or len(value) > 64:
        raise SelectedPersonSourceError("store_state_invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise SelectedPersonSourceError("store_state_invalid") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SelectedPersonSourceError("store_state_invalid")
    return parsed.astimezone(timezone.utc)


def _snapshot_root(connection: sqlite3.Connection) -> Path:
    database = next(
        (str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"),
        "",
    )
    if not database:
        raise SelectedPersonSourceError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _excerpt(value: object) -> str:
    try:
        parsed = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise SelectedPersonSourceError("candidate_source_invalid") from None
    excerpt = parsed.get("excerpt") if isinstance(parsed, dict) else None
    if type(excerpt) is not str or not excerpt:
        raise SelectedPersonSourceError("candidate_source_invalid")
    return excerpt


def resolve_selected_person_source(
    connection: sqlite3.Connection,
    *,
    run_id: str,
    campaign_id: str,
    person_rank_id: str,
    expected_ranking_batch_hash: str,
    now: datetime,
) -> SelectedPersonSource:
    """Resolve the exact validated current selected-person source for one P20 rank row."""
    try:
        return _resolve(
            connection, run_id=run_id, campaign_id=campaign_id,
            person_rank_id=person_rank_id,
            expected_ranking_batch_hash=expected_ranking_batch_hash, now=now,
        )
    except SelectedPersonSourceError:
        raise
    except sqlite3.Error:
        raise SelectedPersonSourceError("store_state_invalid") from None


def _resolve(
    connection: sqlite3.Connection,
    *,
    run_id: str,
    campaign_id: str,
    person_rank_id: str,
    expected_ranking_batch_hash: str,
    now: datetime,
) -> SelectedPersonSource:
    if type(run_id) is not str or _RUN_ID.fullmatch(run_id) is None:
        raise SelectedPersonSourceError("invalid_run_id")
    if type(campaign_id) is not str or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
        raise SelectedPersonSourceError("invalid_campaign_id")
    if type(person_rank_id) is not str or _SAFE_ID.fullmatch(person_rank_id) is None:
        raise SelectedPersonSourceError("invalid_person_rank_id")
    if (
        type(expected_ranking_batch_hash) is not str
        or _HASH.fullmatch(expected_ranking_batch_hash) is None
    ):
        raise SelectedPersonSourceError("invalid_ranking_batch_hash")
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise SelectedPersonSourceError("aware_now_required")
    stamp = now.astimezone(timezone.utc)

    try:
        intake = PipelineService(
            connection, now=lambda: stamp.isoformat(),
        ).get_projection(run_id)
    except PipelineError:
        raise SelectedPersonSourceError("pipeline_context_stale") from None
    if intake.campaign_id != campaign_id:
        raise SelectedPersonSourceError("campaign_scope_mismatch")

    try:
        ranking = RankingService(connection, now=lambda: stamp).get_projection(run_id)
    except RankingError as error:
        raise SelectedPersonSourceError(str(error)) from None
    if ranking is None:
        raise SelectedPersonSourceError("ranking_missing")
    if ranking.batch_hash != expected_ranking_batch_hash:
        raise SelectedPersonSourceError("ranking_batch_stale")
    if ranking.intake_hash != intake.intake_hash:
        raise SelectedPersonSourceError("pipeline_context_stale")

    matches = tuple(
        (company, person)
        for company in ranking.companies
        for person in company.people
        if person.person_rank_id == person_rank_id
    )
    if not matches:
        raise SelectedPersonSourceError("person_rank_missing")
    if len(matches) != 1:
        raise SelectedPersonSourceError("person_scope_ambiguous")
    ranked_company, ranked_person = matches[0]
    if (
        not ranked_person.selected
        or ranked_person.rank_ordinal is None
        or ranked_person.mapped_family is None
        or ranked_person.qualification_outcome != "current_role_supported"
    ):
        raise SelectedPersonSourceError("person_not_selected")
    # Selection, never a newest-employment fallback, decides the current person.
    # Only the same person being selected under two *different* companies is
    # ambiguous (the UI cannot represent that); an unrelated open employment
    # row elsewhere for the same person is irrelevant to this check.
    if len(tuple(
        person for company in ranking.companies for person in company.people
        if person.selected and person.person_id == ranked_person.person_id
    )) != 1:
        raise SelectedPersonSourceError("person_scope_ambiguous")

    try:
        scope = QualificationService(connection, now=lambda: stamp).get_supported_scope(run_id)
    except QualificationError as error:
        raise SelectedPersonSourceError(str(error)) from None
    if scope is None:
        raise SelectedPersonSourceError("qualification_missing")
    if (
        scope.batch_id != ranking.qualification_batch_id
        or scope.batch_hash != ranking.qualification_batch_hash
        or scope.intake_hash != ranking.intake_hash
        or scope.campaign_policy_hash != ranking.campaign_policy_hash
    ):
        raise SelectedPersonSourceError("pipeline_context_stale")
    supported = next(
        (item for item in scope.companies if item.item_id == ranked_company.qualification_item_id),
        None,
    )
    if supported is None or (
        supported.artifact_id != ranked_company.qualification_artifact_id
        or supported.artifact_output_hash != ranked_company.qualification_output_hash
        or supported.company_id != ranked_company.company_id
        or supported.funding_result_id != ranked_company.funding_result_id
    ):
        raise SelectedPersonSourceError("pipeline_context_stale")
    if supported.company_outcome != "source_supported":
        raise SelectedPersonSourceError("company_not_supported")

    by_id = {candidate.candidate_id: candidate for candidate in supported.candidates}
    wanted = tuple(ranked_person.source_candidate_ids)
    for_person = {
        candidate.candidate_id for candidate in supported.candidates
        if candidate.person_id == ranked_person.person_id
    }
    if not wanted or set(wanted) != for_person or any(value not in by_id for value in wanted):
        raise SelectedPersonSourceError("candidate_scope_mismatch")
    representative = by_id.get(ranked_person.representative_candidate_id)
    if representative is None or representative.candidate_id not in set(wanted):
        raise SelectedPersonSourceError("candidate_scope_mismatch")
    if (
        representative.person_id != ranked_person.person_id
        or representative.employment_id != ranked_person.employment_id
        or representative.candidate_observation_id != ranked_person.candidate_observation_id
        or representative.employment_observation_id != ranked_person.employment_observation_id
        or _normal(representative.title) != _normal(ranked_person.title)
    ):
        raise SelectedPersonSourceError("candidate_scope_mismatch")
    # P20 permits duplicate candidates whose *normalized* titles agree, even when the
    # raw casing/spacing differs across separately captured pages; compare normalized
    # text (matching RankingService's own dedupe rule) while still retaining every
    # individual candidate's title hash below for deterministic provenance.
    for candidate in (by_id[value] for value in wanted):
        if candidate.outcome != "current_role_supported":
            raise SelectedPersonSourceError("current_role_not_supported")
        if (
            candidate.employment_id != representative.employment_id
            or _normal(candidate.title) != _normal(representative.title)
        ):
            raise SelectedPersonSourceError("candidate_binding_disagreement")

    snapshot_id = ""
    for value in wanted:
        candidate = by_id[value]
        row = connection.execute(
            """SELECT batch_id,funding_result_id,company_id,person_id,employment_id,
                      outcome,snapshot_id,observation_id
                 FROM prospecting_person_candidate WHERE candidate_id=?""",
            (value,),
        ).fetchone()
        if row is None:
            raise SelectedPersonSourceError("store_state_invalid")
        if (
            str(row[0]) != scope.person_batch_id
            or str(row[1]) != ranked_company.funding_result_id
            or str(row[2]) != ranked_company.company_id
            or str(row[3]) != candidate.person_id
            or str(row[4]) != candidate.employment_id
            or str(row[5]) != "provisional_import"
            or str(row[7]) != candidate.candidate_observation_id
        ):
            raise SelectedPersonSourceError("candidate_scope_mismatch")
        if value == representative.candidate_id:
            snapshot_id = str(row[6])
    if not snapshot_id:
        raise SelectedPersonSourceError("store_state_invalid")

    # Employment is resolved by the exact bound employment_id for the selected
    # person and company, open (valid_to IS NULL).  This is a direct primary-key
    # lookup, not a scan of every open employment the person happens to carry:
    # an unrelated open employment for the same person at a *different* company
    # (or a different person at the *same* company) must be ignored, not treated
    # as a global "person_employment_ambiguous" refusal.
    employment = connection.execute(
        """SELECT employment_id,person_id,company_id,title,valid_to,source_observation_id
             FROM employment WHERE employment_id=?""",
        (ranked_person.employment_id,),
    ).fetchone()
    if employment is None or (
        str(employment[1]) != ranked_person.person_id
        or str(employment[2]) != ranked_company.company_id
        or employment[4] is not None
        or _normal(employment[3]) != _normal(ranked_person.title)
        or str(employment[5]) != ranked_person.employment_observation_id
    ):
        raise SelectedPersonSourceError("employment_binding_mismatch")

    candidate_observation = connection.execute(
        "SELECT entity_type,entity_id,field,value,snapshot_id FROM source_observation WHERE observation_id=?",
        (ranked_person.candidate_observation_id,),
    ).fetchone()
    if candidate_observation is None or (
        str(candidate_observation[0]) != "person"
        or str(candidate_observation[1]) != ranked_person.person_id
        or str(candidate_observation[2]) != "source_review_candidate"
        or str(candidate_observation[4]) != snapshot_id
    ):
        raise SelectedPersonSourceError("candidate_source_invalid")
    excerpt = _excerpt(candidate_observation[3])
    # The original employment observation is preserved as its own provenance edge:
    # it may predate the current candidate proof and is never overwritten by it.
    employment_observation = connection.execute(
        "SELECT entity_id FROM source_observation WHERE observation_id=?",
        (ranked_person.employment_observation_id,),
    ).fetchone()
    if employment_observation is None:
        raise SelectedPersonSourceError("employment_source_missing")

    snapshot = connection.execute(
        """SELECT source_url,retrieved_at,expires_at,content_sha256,body_ref,allowlist_version
             FROM source_snapshot WHERE snapshot_id=?""",
        (snapshot_id,),
    ).fetchone()
    if snapshot is None or str(snapshot[5]) != "operator-local-v1":
        raise SelectedPersonSourceError("store_state_invalid")
    if _timestamp(snapshot[2]) < stamp:
        raise SelectedPersonSourceError("source_stale")
    try:
        stored = read_owned(_snapshot_root(connection), str(snapshot[4]), maximum=MAX_SOURCE_BYTES)
    except SourceCaptureError:
        raise SelectedPersonSourceError("source_changed") from None
    if sha256(stored.contents).hexdigest() != str(snapshot[3]):
        raise SelectedPersonSourceError("source_changed")

    source_title_hashes = tuple(by_id[value].title_hash for value in wanted)
    provenance = {
        "resolver_version": RESOLVER_VERSION,
        "run_id": run_id,
        "campaign_id": campaign_id,
        "campaign_policy_hash": ranking.campaign_policy_hash,
        "intake_hash": ranking.intake_hash,
        "funding": [scope.funding_batch_id, scope.funding_batch_hash],
        "people": [scope.person_batch_id, scope.person_batch_hash],
        "qualification": [scope.batch_id, scope.batch_hash],
        "qualification_item_id": supported.item_id,
        "artifact": [supported.artifact_id, supported.artifact_output_hash],
        "ranking": [ranking.batch_id, ranking.batch_hash],
        "role_policy": [ranking.role_policy_version, ranking.role_policy_hash],
        "person_rank_id": person_rank_id,
        "rank_ordinal": ranked_person.rank_ordinal,
        "family": ranked_person.mapped_family,
        "kind": ranked_person.match_kind,
        "funding_result_id": ranked_company.funding_result_id,
        "company_id": ranked_company.company_id,
        "person_id": ranked_person.person_id,
        "employment_id": ranked_person.employment_id,
        "title_hash": ranked_person.title_hash,
        "representative_candidate_id": representative.candidate_id,
        "source_candidate_ids": list(wanted),
        "source_title_hashes": list(source_title_hashes),
        "candidate_observation_id": ranked_person.candidate_observation_id,
        "employment_observation_id": ranked_person.employment_observation_id,
        "snapshot_id": snapshot_id,
        "source_url": str(snapshot[0]),
        "retrieved_at": str(snapshot[1]),
        "expires_at": str(snapshot[2]),
        "content_sha256": str(snapshot[3]),
        "excerpt_sha256": sha256(excerpt.encode()).hexdigest(),
    }
    return SelectedPersonSource(
        RESOLVER_VERSION, run_id, campaign_id, ranking.campaign_policy_hash,
        ranking.intake_hash, scope.funding_batch_id, scope.funding_batch_hash,
        scope.person_batch_id, scope.person_batch_hash, scope.batch_id, scope.batch_hash,
        supported.item_id, supported.artifact_id, supported.artifact_output_hash,
        ranking.batch_id, ranking.batch_hash, ranking.role_policy_version,
        ranking.role_policy_hash, person_rank_id, int(ranked_person.rank_ordinal),
        str(ranked_person.mapped_family), ranked_person.match_kind,
        ranked_company.funding_result_id, ranked_company.company_id,
        ranked_person.person_id, ranked_person.employment_id, ranked_person.title,
        ranked_person.title_hash, representative.candidate_id, wanted,
        source_title_hashes,
        ranked_person.candidate_observation_id, ranked_person.employment_observation_id,
        snapshot_id, str(snapshot[0]), str(snapshot[1]), str(snapshot[2]),
        str(snapshot[3]), excerpt, _digest(provenance),
    )


__all__ = [
    "RESOLVER_VERSION", "SelectedPersonSource", "SelectedPersonSourceError",
    "resolve_selected_person_source",
]
