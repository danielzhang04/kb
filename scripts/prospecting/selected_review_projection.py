"""Read-only forward projection of the current selected ranking for review (P25).

Scope and deliberate boundaries
-------------------------------
*   This module *reads*.  It writes nothing, owns no table, extends no schema,
    creates no authority and confirms no source.  It composes only existing public
    seams: :meth:`PipelineService.get_latest_projection`,
    :meth:`RankingService.get_projection` and the single shared resolver
    :func:`resolve_selected_person_source` -- one call per *currently selected*
    ranked person.  There is no latest-employment heuristic anywhere here: the
    current ranking decides who is selected, and the shared resolver decides what
    their exact bound company/employment/observation/snapshot are.
*   Regeneration expectations are *hints for display only*.  They are read from one
    exact ``(campaign_id, person_id, step)`` stored-head query plus one exact
    last-binding query -- no second ancestry walk, no lineage traversal and no
    invented authority.  ``SelectedDraftService`` revalidates both pins itself and
    remains the only thing that may append a generation; a hint being present here
    never relaxes, supplies or pre-satisfies any of its checks.  A current head is
    never presented as a pin when no binding exists yet (both pins stay ``None``),
    and no materialization receipt is ever treated as a head.
*   :attr:`SelectedPersonProjection.has_prior_binding` reports exactly one fact:
    a binding row already exists for this person.  It deliberately does *not* mean
    "regeneration is required" and no context-change inference is attempted here --
    a freshly bound, unchanged draft reports ``True`` while ``SelectedDraftService``
    would still refuse a regeneration of it with ``regeneration_context_unchanged``.
    Deciding whether anything must be regenerated belongs to that owning command.
*   A shared-resolver failure for one person marks *that person* unavailable with a
    fixed code.  No older ranking batch, no older binding and no unrelated newer
    employment/contact may stand in for the missing proof.
*   A failed hint *query* is distinguished from a genuinely absent pre-P22 binding
    table.  A store read that fails marks that one person unavailable with the fixed
    code ``store_state_invalid`` and leaves every other person and the root intact;
    an absent binding table still reads honestly as "no binding yet".  Unavailable
    data is never dressed up as a first materialization.
*   A pipeline or ranking failure marks the *root* unavailable with an explicit
    fixed code rather than silently projecting an empty selection.

Every record is frozen and ``repr``-suppressed: these carry a private title and
private opaque provenance identifiers that must never leak through a log or an
assertion dump.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import re
import sqlite3
from types import MappingProxyType

from scripts.prospecting.pipeline_service import PipelineError, PipelineService
from scripts.prospecting.ranking_service import RankingError, RankingService
from scripts.prospecting.selected_person_source import (
    SelectedPersonSourceError,
    resolve_selected_person_source,
)


PROJECTION_VERSION = "selected-review-projection-v1"
_CAMPAIGN_ID = re.compile(r"camp_[0-9a-f]{16}\Z")
# The exact fixed refusal codes this projection may forward unchanged.  Anything
# outside these sets collapses to one generic code, so no dynamic store or driver
# text can ever reach a local UI response.
PIPELINE_CODES = frozenset({
    "campaign_missing", "campaign_state_invalid", "run_missing",
    "store_state_invalid", "invalid_funding_window",
})
# ``RankingService._scope`` calls ``QualificationService.get_supported_scope``
# first, and that call reaches ``QualificationService._context`` before any
# qualification batch is looked up.  ``_context`` refuses a run whose funding or
# person research batch is absent with ``funding_batch_missing`` /
# ``person_batch_missing``, so on a fresh intake those exact codes -- not
# ``qualification_missing`` -- are what ``_scope`` re-raises verbatim.  They are
# forwarded for exactly the same reason ``qualification_missing`` is: each names
# a real missing prerequisite rather than a stale or malformed selected ranking.
# Anything outside this set still collapses to the generic fallback below.
RANKING_CODES = frozenset({
    "funding_batch_missing", "intake_stale", "invalid_run_id",
    "person_batch_missing", "pipeline_context_stale", "qualification_missing",
    "role_policy_unsupported", "source_changed", "source_stale",
    "store_state_invalid",
})
SOURCE_CODES = frozenset({
    "invalid_run_id", "invalid_campaign_id", "invalid_person_rank_id",
    "invalid_ranking_batch_hash", "aware_now_required", "campaign_scope_mismatch",
    "pipeline_context_stale", "ranking_missing", "ranking_batch_stale",
    "person_rank_missing", "person_scope_ambiguous", "person_not_selected",
    "qualification_missing", "company_not_supported", "candidate_scope_mismatch",
    "current_role_not_supported", "candidate_binding_disagreement",
    "candidate_source_invalid", "employment_binding_mismatch",
    "employment_source_missing", "snapshot_store_required", "source_changed",
    "source_stale", "store_state_invalid",
})


class SelectedReviewProjectionError(ValueError):
    """Fixed-code refusal for an unusable caller argument only.

    Store, pipeline, ranking and resolver failures are never raised: they are
    projected as an explicit ``error_code`` so a UI can say what is wrong instead
    of rendering an empty selection.
    """


@dataclass(frozen=True, repr=False)
class SelectedPersonProjection:
    """One currently selected person.  ``repr`` is disabled: it carries a title."""

    person_rank_id: str
    person_id: str
    company_id: str
    rank_ordinal: int | None
    mapped_family: str | None
    match_kind: str
    qualification_outcome: str
    reason_codes: tuple[str, ...]
    state: str
    error_code: str | None
    title: str | None
    employment_id: str | None
    source_context_digest: str | None
    candidate_observation_id: str | None
    employment_observation_id: str | None
    snapshot_id: str | None
    head_revision_id: str | None
    bound_revision_id: str | None
    expected_revision_id: str | None
    expected_predecessor_binding_hash: str | None
    # Display truth only: a binding row exists.  Not a regeneration verdict; see
    # the module docstring.  ``SelectedDraftService`` owns that decision.
    has_prior_binding: bool


@dataclass(frozen=True, repr=False)
class SelectedCompanyProjection:
    """One ranked company with its explained counts and shortfall."""

    company_rank_id: str
    company_id: str
    qualification_item_id: str
    qualification_artifact_id: str
    qualification_output_hash: str
    company_outcome: str
    desired_count: int
    eligible_count: int
    selected_count: int
    shortfall: int
    reason_codes: tuple[str, ...]
    people: tuple[SelectedPersonProjection, ...]


@dataclass(frozen=True, repr=False)
class SelectedPipelineProjection:
    """The exact current run/ranking context plus its selected people."""

    projection_version: str
    campaign_id: str
    state: str
    error_code: str | None
    run_id: str | None
    intake_hash: str | None
    campaign_policy_hash: str | None
    ranking_batch_id: str | None
    ranking_batch_hash: str | None
    role_policy_version: str | None
    role_policy_hash: str | None
    companies: tuple[SelectedCompanyProjection, ...]
    counts: Mapping[str, int]


def _aware(value: object) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise SelectedReviewProjectionError("aware_now_required")
    return value.astimezone(timezone.utc)


def _code(error: BaseException, allowed: frozenset[str], fallback: str) -> str:
    """Forward one known fixed code only; never dynamic store or driver text."""
    value = error.args[0] if len(error.args) == 1 else None
    return value if type(value) is str and value in allowed else fallback


def _counts(companies: tuple[SelectedCompanyProjection, ...]) -> Mapping[str, int]:
    people = tuple(person for company in companies for person in company.people)
    return MappingProxyType({
        "companies": len(companies),
        "selected_people": len(people),
        "available_people": sum(person.state == "available" for person in people),
        "unavailable_people": sum(person.state != "available" for person in people),
        "people_shortfall": sum(company.shortfall for company in companies),
        "companies_with_shortfall": sum(company.shortfall > 0 for company in companies),
    })


def _empty(
    campaign_id: str, state: str, error_code: str | None, *,
    run_id: str | None = None, intake_hash: str | None = None,
    campaign_policy_hash: str | None = None,
) -> SelectedPipelineProjection:
    return SelectedPipelineProjection(
        PROJECTION_VERSION, campaign_id, state, error_code, run_id, intake_hash,
        campaign_policy_hash, None, None, None, None, (), _counts(()),
    )


def _table_exists(connection: sqlite3.Connection, name: str) -> bool:
    """Answer whether one table genuinely exists.

    A failed query is *not* answered here: the ``sqlite3.Error`` propagates to
    :func:`_hints`, so an unusable store can never be reported as an absent table
    and therefore never as a fabricated "no binding yet".
    """
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,),
    ).fetchone() is not None


def _hints(
    connection: sqlite3.Connection, campaign_id: str, person_id: str,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Read the exact stored head and last binding for one selected person.

    Two plain scoped reads: the exact ``(campaign_id, person_id, step=0)`` head and
    the exact last ``selected_draft_binding`` row.  No lineage is walked and nothing
    is inferred from a receipt.

    The fourth element is a fixed failure code.  It is ``None`` for both success and
    for a store that genuinely predates P22 (no binding table, hence no binding).  A
    read that *fails* returns ``store_state_invalid`` with no hint values at all, so
    unavailable data is never presented as a first materialization.
    """
    try:
        head = connection.execute(
            """SELECT revision_id FROM revision
                WHERE campaign_id=? AND person_id=? AND step=0
                ORDER BY rowid DESC LIMIT 1""",
            (campaign_id, person_id),
        ).fetchone()
        head_id = None if head is None else str(head[0])
        if not _table_exists(connection, "selected_draft_binding"):
            return head_id, None, None, None
        binding = connection.execute(
            """SELECT revision_id,binding_hash FROM selected_draft_binding
                WHERE campaign_id=? AND person_id=? ORDER BY rowid DESC LIMIT 1""",
            (campaign_id, person_id),
        ).fetchone()
    except sqlite3.Error:
        return None, None, None, "store_state_invalid"
    if binding is None:
        return head_id, None, None, None
    return head_id, str(binding[0]), str(binding[1]), None


def _person(
    connection: sqlite3.Connection, *, campaign_id: str, run_id: str,
    ranking_batch_hash: str, company, person, stamp: datetime,
) -> SelectedPersonProjection:
    head_id, bound_id, binding_hash, hint_error = _hints(
        connection, campaign_id, person.person_id,
    )
    if hint_error is not None:
        # The hint reads failed for this person.  Their projection is honestly
        # unavailable and carries no pins and no source fields; every other person
        # and the root are untouched.
        return SelectedPersonProjection(
            person.person_rank_id, person.person_id, company.company_id,
            person.rank_ordinal, person.mapped_family, person.match_kind,
            person.qualification_outcome, person.reason_codes,
            "unavailable", hint_error,
            None, None, None, None, None, None,
            None, None, None, None, False,
        )
    source = None
    error_code: str | None = None
    try:
        source = resolve_selected_person_source(
            connection, run_id=run_id, campaign_id=campaign_id,
            person_rank_id=person.person_rank_id,
            expected_ranking_batch_hash=ranking_batch_hash, now=stamp,
        )
    except SelectedPersonSourceError as error:
        error_code = _code(error, SOURCE_CODES, "selected_source_unavailable")
    except sqlite3.Error:
        error_code = "store_state_invalid"
    return SelectedPersonProjection(
        person.person_rank_id, person.person_id, company.company_id,
        person.rank_ordinal, person.mapped_family, person.match_kind,
        person.qualification_outcome, person.reason_codes,
        "available" if source is not None else "unavailable", error_code,
        None if source is None else source.title,
        None if source is None else source.employment_id,
        None if source is None else source.source_context_digest,
        None if source is None else source.candidate_observation_id,
        None if source is None else source.employment_observation_id,
        None if source is None else source.snapshot_id,
        head_id, bound_id,
        # A head is only ever offered as an expectation once a binding exists to
        # supersede; otherwise no pin is presented at all.
        head_id if binding_hash is not None else None,
        binding_hash, binding_hash is not None,
    )


def build_selected_pipeline_projection(
    connection: sqlite3.Connection, campaign_id: object, *, now: datetime,
) -> SelectedPipelineProjection:
    """Project the exact current selected ranking for one campaign.

    ``state`` is one of ``no_pipeline``, ``input_pending``, ``awaiting_ranking``,
    ``ready`` or ``unavailable``.  Only ``unavailable`` carries a root
    ``error_code``; per-person failures stay per-person so one stale source or one
    failed hint read cannot blank the rest of the projection.
    """
    stamp = _aware(now)
    if type(campaign_id) is not str or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
        # Not a pipeline campaign id at all: a legacy campaign genuinely has no
        # selected pipeline, which is not an error to report.
        return _empty("" if type(campaign_id) is not str else campaign_id, "no_pipeline", None)
    stamp_text = stamp.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        intake = PipelineService(
            connection, now=lambda: stamp_text,
        ).get_latest_projection(campaign_id)
    except PipelineError as error:
        return _empty(
            campaign_id, "unavailable",
            _code(error, PIPELINE_CODES, "pipeline_projection_unavailable"),
        )
    except sqlite3.Error:
        # Includes an outright unusable (for example closed) connection.
        return _empty(campaign_id, "unavailable", "store_state_invalid")
    if intake is None:
        return _empty(campaign_id, "no_pipeline", None)
    context = {
        "run_id": intake.run_id, "intake_hash": intake.intake_hash,
        "campaign_policy_hash": intake.campaign_policy_hash,
    }
    if intake.state == "input_pending":
        return _empty(campaign_id, "input_pending", "pipeline_input_pending", **context)
    try:
        ranking = RankingService(connection, now=lambda: stamp).get_projection(intake.run_id)
    except RankingError as error:
        return _empty(
            campaign_id, "unavailable",
            _code(error, RANKING_CODES, "ranking_projection_unavailable"), **context,
        )
    except sqlite3.Error:
        return _empty(campaign_id, "unavailable", "store_state_invalid", **context)
    if ranking is None:
        return _empty(campaign_id, "awaiting_ranking", None, **context)
    companies = tuple(
        SelectedCompanyProjection(
            company.company_rank_id, company.company_id, company.qualification_item_id,
            company.qualification_artifact_id, company.qualification_output_hash,
            company.company_outcome, company.desired_count, company.eligible_count,
            company.selected_count, company.shortfall, company.reason_codes,
            tuple(
                _person(
                    connection, campaign_id=campaign_id, run_id=intake.run_id,
                    ranking_batch_hash=ranking.batch_hash, company=company,
                    person=person, stamp=stamp,
                )
                for person in company.people if person.selected
            ),
        )
        for company in ranking.companies
    )
    return SelectedPipelineProjection(
        PROJECTION_VERSION, campaign_id, "ready", None, intake.run_id,
        intake.intake_hash, intake.campaign_policy_hash, ranking.batch_id,
        ranking.batch_hash, ranking.role_policy_version, ranking.role_policy_hash,
        companies, _counts(companies),
    )


__all__ = [
    "PIPELINE_CODES", "PROJECTION_VERSION", "RANKING_CODES",
    "SOURCE_CODES", "SelectedCompanyProjection", "SelectedPersonProjection",
    "SelectedPipelineProjection", "SelectedReviewProjectionError",
    "build_selected_pipeline_projection",
]
