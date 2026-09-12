"""P22 durable selected-draft binding and the single selection resolver (slice 3).

Scope and deliberate boundaries
-------------------------------
*   :class:`SelectedDraftService` binds one immutable receipt per exact request:
    the request UUID plus its request hash decide replay, and the binding names the
    exact revision, its two identity digests and the exact P20 rank / P19 artifact /
    P18 candidate provenance it was rendered from.  The whole materialization -- the
    resolver walk, the leaf render (evidence + revision + QA context) and the binding
    and request rows -- commits in one transaction, so a failure leaves no partial
    evidence and no partial revision.
*   It never fabricates or requires fill / affinity / contact / approval rows, never
    mints a human source attestation, never calls a model and never writes to P16,
    P21 or ReviewService state.  ``source_proof_pending`` merely means "still a
    draft"; it is permitted here and confers nothing.
*   It writes no repair-budget row and performs no budget reset: it does not touch
    ``prospecting_pipeline_item`` or ``prospecting_pipeline_reset`` at all, so a
    materialization neither consumes, restores nor resets any P21 budget.  An
    explicitly regenerated root is a new unparented lineage root, so if a caller
    later starts P16 on it, that run gets its own fresh bounded repair budget --
    a consequence of a genuinely new generation, not a P21 reset and not an
    increase in anyone's permissions.  That path is reachable only through the
    doubly-pinned regeneration described below (exact current head *and* exact
    predecessor binding hash, a genuine context change, and no pending or live
    work); an unchanged-context or unpinned request can never obtain it, and a
    fresh request with unchanged context returns the original receipt instead of
    opening anything new.
*   Explicit regeneration is the only path that appends a new binding.  It requires
    the exact *current* head revision id *and* the exact predecessor binding hash,
    requires a real source/sender/policy/template context change, and refuses rather
    than overwriting human edits, pending suggestions or history.  When the head is
    no longer the bound revision (a genuine human edit or accepted agent suggestion
    sits above it), the pinned head must be proven a real descendant of the exact
    binding being superseded, through the same bounded validated lineage walk.  A
    blind materialize over an edited descendant still refuses with
    ``selected_draft_superseded``: only the explicit, doubly-pinned request may
    append.  The appended generation is a fresh unparented provenance root -- no
    human/agent lineage edge is forged for it, and no P21 budget row or reset is
    written here; a later P16 start on that root simply begins its own bounded
    budget.  A render that resolves back onto an already-bound revision (the
    idempotent ``build_revision`` case, reached for example once an earlier render
    context has been restored exactly) is refused with
    ``selected_revision_already_bound`` rather than binding one revision twice.
*   The durable ``selected_draft_request`` row is the supersession receipt: its
    immutable ``expected_revision_id`` (for an ``operation='regenerate'`` request
    whose ``result_state='regenerated'``) is the exact head that was superseded, and
    :attr:`SelectedDraftReceipt.superseded_revision_id` is derived from that row
    alone -- never from whatever the latest head happens to be at replay time.  A
    fresh unchanged-context request that reuses an existing binding reports no
    supersession at all.
*   :func:`resolve_revision_selection` is the single binding resolver consumers
    (next: P16) must use.  It never relaxes the employment binding to accept an
    arbitrary new observation: the underlying resolver's exact employment /
    observation edges remain authoritative.

Lineage
-------
Traversal follows only the real ``review_revision_lineage`` and
``prospecting_agent_revision_lineage`` tables (no shadow edit/suggestion table is
invented), and validates the candidate/review-request and suggestion/decision
provenance of every edge it walks, so a fabricated unrelated row is never authority.
It is bounded at 256 steps and fails closed on cycles, multiple parents and
cross person/campaign/step edges.  It deliberately never stops at a
``prospecting_pipeline_reset`` boundary: a budget root is not a selection
provenance root, so a P21 reset can neither truncate nor re-root the walk.

Transactions
------------
:meth:`SelectedDraftService.materialize` opens, commits and abandons only its own
transaction.  An already-open caller transaction is refused up front, so no rollback
taken here can ever discard a caller's work.  Opening, committing and rolling back
are each guarded: a closed or busy store becomes a fixed code, never driver text,
and a receipt is returned only after the commit provably succeeded.  When a rollback
cannot prove this call's own transaction was closed, ``selected_draft_cleanup_failed``
is raised instead of an outcome the store may not actually hold.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
import sqlite3
import uuid

from scripts.prospecting.selected_person_render import (
    RENDER_VERSION,
    SelectedRenderError,
    render_selected_person_revision,
    selected_render_context_digest,
)
from scripts.prospecting.selected_person_source import (
    SelectedPersonSource,
    SelectedPersonSourceError,
    resolve_selected_person_source,
)


BINDING_VERSION = "selected-draft-binding-v1"
MAX_LINEAGE = 256
BINDING_HASH_KEYS = (
    "binding_id", "request_id", "campaign_id", "run_id", "person_id",
    "person_rank_id", "ranking_batch_hash", "qualification_artifact_id",
    "qualification_output_hash", "source_context_digest", "render_context_digest",
    "revision_id", "revision_hash", "prompt_version", "predecessor_binding_hash",
)
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
_RUNNING_STATES = (
    "human_review", "humanizer_running", "post_factcheck_running", "critic_running",
)
# Required by the legacy drafting contract shape only; no sender fact is read from
# it, and none may be: the saved campaign/sender rows stay authoritative.
_ANCHORS = object()

_REVIEW_EDGE_SQL = """
    SELECT lineage.parent_revision_id
      FROM review_revision_lineage AS lineage
      JOIN review_candidate AS candidate ON candidate.candidate_id=lineage.candidate_id
      JOIN review_request AS request ON request.request_id=lineage.request_id
      JOIN revision AS child ON child.revision_id=lineage.child_revision_id
     WHERE lineage.child_revision_id=?
       AND candidate.request_id=lineage.request_id
       AND candidate.parent_revision_id=lineage.parent_revision_id
       AND candidate.campaign_id=lineage.campaign_id
       AND candidate.person_id=lineage.person_id AND candidate.step=lineage.step
       AND candidate.qa_state='revision_created'
       AND json_extract(candidate.qa_json,'$.passed')=1
       AND request.operation='edit' AND request.result_state='revision_created'
       AND request.campaign_id=lineage.campaign_id
       AND request.person_id=lineage.person_id
       AND request.expected_revision_id=lineage.parent_revision_id
       AND request.result_id=candidate.candidate_id
       AND child.campaign_id=lineage.campaign_id AND child.person_id=lineage.person_id
       AND child.step=lineage.step
       AND child.subject=candidate.subject AND child.body=candidate.body"""
_AGENT_EDGE_SQL = """
    SELECT agent.parent_revision_id
      FROM prospecting_agent_revision_lineage AS agent
      JOIN prospecting_pipeline_suggestion AS suggestion
        ON suggestion.suggestion_id=agent.suggestion_id
      JOIN prospecting_suggestion_decision AS decision
        ON decision.decision_id=agent.decision_id
      JOIN revision AS child ON child.revision_id=agent.child_revision_id
     WHERE agent.child_revision_id=?
       AND decision.suggestion_id=agent.suggestion_id
       AND decision.decision='accepted'
       AND decision.accepted_revision_id=agent.child_revision_id
       AND decision.accepted_revision_hash=child.hash
       AND decision.item_id=suggestion.item_id
       AND decision.expected_parent_revision_id=agent.parent_revision_id
       AND suggestion.parent_revision_id=agent.parent_revision_id
       AND suggestion.proposed_revision_hash=child.hash
       AND child.subject=suggestion.subject
       AND child.body=suggestion.body"""
_RAW_EDGE_SQL = """
    SELECT parent_revision_id FROM review_revision_lineage WHERE child_revision_id=?
    UNION ALL
    SELECT parent_revision_id FROM prospecting_agent_revision_lineage
     WHERE child_revision_id=?"""


class SelectedDraftError(ValueError):
    """Fixed-code refusal at the selected-draft binding boundary."""


@dataclass(frozen=True)
class SelectedDraftRequest:
    """One caller intent.  Regeneration must name both expectations or neither."""

    request_id: str
    campaign_id: str
    run_id: str
    person_rank_id: str
    expected_ranking_batch_hash: str
    expected_revision_id: str | None = None
    expected_predecessor_binding_hash: str | None = None


@dataclass(frozen=True)
class SelectedDraftReceipt:
    """Safe projection: opaque IDs, hashes and states only."""

    request_id: str
    binding_id: str
    binding_hash: str
    revision_id: str
    revision_hash: str
    prompt_version: str
    source_context_digest: str
    render_context_digest: str
    predecessor_binding_hash: str | None
    state: str
    replayed: bool
    # Optional safe receipt for UI/history: the exact head this generation
    # superseded, derived only from the immutable original request row.
    superseded_revision_id: str | None = None


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise SelectedDraftError("store_state_invalid") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def _request_id(value: object) -> str:
    if type(value) is not str:
        raise SelectedDraftError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, TypeError, ValueError):
        raise SelectedDraftError("invalid_request_id") from None
    if str(parsed) != value:
        raise SelectedDraftError("invalid_request_id")
    return value


def _safe_id(value: object, code: str) -> str:
    if type(value) is not str or _SAFE_ID.fullmatch(value) is None:
        raise SelectedDraftError(code)
    return value


def _sha(value: object, code: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        raise SelectedDraftError(code)
    return value


def _now(value: object) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise SelectedDraftError("aware_now_required")
    return value.astimezone(timezone.utc)


def _timestamp(value: object) -> datetime:
    if type(value) is not str or len(value) > 64:
        raise SelectedDraftError("store_state_invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise SelectedDraftError("store_state_invalid") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SelectedDraftError("store_state_invalid")
    return parsed.astimezone(timezone.utc)


def _binding_hash(values: Mapping[str, object]) -> str:
    return _digest({
        "binding_version": BINDING_VERSION,
        **{key: values[key] for key in BINDING_HASH_KEYS},
    })


def _query(connection: sqlite3.Connection, sql: str, parameters: tuple[object, ...]) -> sqlite3.Cursor:
    cursor = connection.cursor()
    cursor.row_factory = sqlite3.Row
    return cursor.execute(sql, parameters)


def _revision(connection: sqlite3.Connection, revision_id: str) -> sqlite3.Row:
    row = _query(
        connection, "SELECT * FROM revision WHERE revision_id=?", (revision_id,),
    ).fetchone()
    if row is None:
        raise SelectedDraftError("revision_missing")
    return row


def _validated_parents(connection: sqlite3.Connection, revision_id: str) -> tuple[str, ...]:
    """Return validated parents; fail closed when only unverified edges exist."""
    parents = [
        str(row[0])
        for row in _query(connection, _REVIEW_EDGE_SQL, (revision_id,)).fetchall()
    ] + [
        str(row[0])
        for row in _query(connection, _AGENT_EDGE_SQL, (revision_id,)).fetchall()
    ]
    raw = _query(connection, _RAW_EDGE_SQL, (revision_id, revision_id)).fetchall()
    if raw and not parents:
        raise SelectedDraftError("revision_lineage_unverified")
    if len(raw) != len(parents):
        raise SelectedDraftError("revision_lineage_unverified")
    return tuple(parents)


def _lineage_root(connection: sqlite3.Connection, revision_id: str) -> sqlite3.Row:
    """Walk validated lineage to the bounded selection root of one revision.

    A committed P21 budget reset is deliberately not a boundary here: budget roots
    and selection provenance roots are different things.
    """
    row = _revision(connection, revision_id)
    scope = (row["campaign_id"], row["person_id"], row["step"])
    current, seen = revision_id, {revision_id}
    for _step in range(MAX_LINEAGE):
        parents = _validated_parents(connection, current)
        if not parents:
            return _revision(connection, current)
        if len(parents) != 1:
            raise SelectedDraftError("revision_lineage_ambiguous")
        parent_id = parents[0]
        if parent_id in seen:
            raise SelectedDraftError("revision_lineage_cycle")
        parent = _revision(connection, parent_id)
        if (parent["campaign_id"], parent["person_id"], parent["step"]) != scope:
            raise SelectedDraftError("revision_lineage_scope_mismatch")
        seen.add(parent_id)
        current = parent_id
    raise SelectedDraftError("revision_lineage_too_deep")


def _selection_for_revision(
    connection: sqlite3.Connection, revision_id: str, stamp: datetime,
) -> SelectedPersonSource | None:
    """Body of :func:`resolve_revision_selection`; row_factory stays caller-owned."""
    root = _lineage_root(connection, revision_id)
    binding = _query(
        connection, "SELECT * FROM selected_draft_binding WHERE revision_id=?",
        (str(root["revision_id"]),),
    ).fetchone()
    if binding is None:
        if str(root["prompt_version"]).startswith(f"{RENDER_VERSION}:"):
            raise SelectedDraftError("selected_binding_missing")
        return None
    if (
        str(binding["campaign_id"]) != str(root["campaign_id"])
        or str(binding["person_id"]) != str(root["person_id"])
        or str(binding["revision_hash"]) != str(root["hash"])
        or str(binding["prompt_version"]) != str(root["prompt_version"])
    ):
        raise SelectedDraftError("selected_binding_scope_mismatch")
    try:
        selected = resolve_selected_person_source(
            connection,
            run_id=str(binding["run_id"]),
            campaign_id=str(binding["campaign_id"]),
            person_rank_id=str(binding["person_rank_id"]),
            expected_ranking_batch_hash=str(binding["ranking_batch_hash"]),
            now=stamp,
        )
    except SelectedPersonSourceError as error:
        raise SelectedDraftError(str(error)) from None
    if (
        selected.source_context_digest != str(binding["source_context_digest"])
        or selected.person_id != str(binding["person_id"])
        or selected.qualification_artifact_id != str(binding["qualification_artifact_id"])
        or selected.qualification_output_hash != str(binding["qualification_output_hash"])
    ):
        raise SelectedDraftError("selected_source_stale")
    try:
        current_context = selected_render_context_digest(
            connection, str(binding["campaign_id"]),
        )
    except SelectedRenderError as error:
        raise SelectedDraftError(str(error)) from None
    if current_context != str(binding["render_context_digest"]):
        raise SelectedDraftError("selected_render_context_stale")
    return selected


def resolve_revision_selection(
    connection: sqlite3.Connection, revision_id: str, now: datetime,
) -> SelectedPersonSource | None:
    """Resolve the exact current selected-person source behind one revision.

    Returns ``None`` only for a legacy root that carries no P22 binding and was not
    produced by the selected renderer.  A root whose prompt_version is a
    ``selected-person-render-v1:`` identity but has no binding fails closed.  A bound
    root is revalidated through the existing selected resolver *and* the current
    render-context digest, so source, sender, policy, ranking or template drift makes
    the selected draft stale for every consumer at once.

    This function only reads.  Capturing and restoring the caller's ``row_factory``
    is itself guarded: on an unusable connection the capture refuses with a fixed
    code before anything is changed, and a restore that cannot run is swallowed so it
    can never mask or replace the outcome.  No driver text ever reaches the caller.
    """
    revision_id = _safe_id(revision_id, "invalid_revision_id")
    stamp = _now(now)
    try:
        previous_row_factory = connection.row_factory
        connection.row_factory = sqlite3.Row
    except (AttributeError, TypeError, sqlite3.Error):
        raise SelectedDraftError("store_state_invalid") from None
    try:
        return _selection_for_revision(connection, revision_id, stamp)
    except SelectedDraftError:
        raise
    except (SelectedRenderError, SelectedPersonSourceError) as error:
        raise SelectedDraftError(str(error)) from None
    except sqlite3.Error:
        raise SelectedDraftError("store_state_invalid") from None
    finally:
        try:
            connection.row_factory = previous_row_factory
        except (AttributeError, TypeError, sqlite3.Error):
            # Restoring a caller's factory must never mask or replace the outcome.
            pass


class SelectedDraftService:
    """Bind one durable selected draft per exact request, atomically."""

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now

    def materialize(self, request: SelectedDraftRequest) -> SelectedDraftReceipt:
        if not isinstance(request, SelectedDraftRequest):
            raise SelectedDraftError("invalid_request")
        request_id = _request_id(request.request_id)
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        run_id = _safe_id(request.run_id, "invalid_run_id")
        person_rank_id = _safe_id(request.person_rank_id, "invalid_person_rank_id")
        ranking_batch_hash = _sha(
            request.expected_ranking_batch_hash, "invalid_ranking_batch_hash",
        )
        expected_revision_id = (
            None if request.expected_revision_id is None
            else _safe_id(request.expected_revision_id, "invalid_revision_id")
        )
        predecessor = (
            None if request.expected_predecessor_binding_hash is None
            else _sha(request.expected_predecessor_binding_hash, "invalid_binding_hash")
        )
        if (expected_revision_id is None) != (predecessor is None):
            raise SelectedDraftError("regeneration_expectations_incomplete")
        operation = "materialize" if expected_revision_id is None else "regenerate"
        request_hash = _digest([
            BINDING_VERSION, operation, campaign_id, run_id, person_rank_id,
            ranking_batch_hash, expected_revision_id, predecessor,
        ])
        stamp = _now(self.now())
        self._begin()
        try:
            replay = self.connection.execute(
                "SELECT * FROM selected_draft_request WHERE request_id=?", (request_id,),
            ).fetchone()
            receipt = (
                self._replay(replay, request_hash) if replay is not None
                else self._bind(
                    request_id=request_id, request_hash=request_hash,
                    operation=operation, campaign_id=campaign_id, run_id=run_id,
                    person_rank_id=person_rank_id,
                    ranking_batch_hash=ranking_batch_hash,
                    expected_revision_id=expected_revision_id,
                    predecessor=predecessor, stamp=stamp,
                )
            )
        except SelectedDraftError:
            # A fixed code is safe to re-raise, but only once this call's own
            # transaction is provably closed.
            if self._rollback():
                raise
            raise SelectedDraftError("selected_draft_cleanup_failed") from None
        except (SelectedRenderError, SelectedPersonSourceError) as error:
            code = str(error)
            if self._rollback():
                raise SelectedDraftError(code) from None
            raise SelectedDraftError("selected_draft_cleanup_failed") from None
        except sqlite3.Error:
            # Never surface dynamic driver text through this public boundary.
            if self._rollback():
                raise SelectedDraftError("store_state_invalid") from None
            raise SelectedDraftError("selected_draft_cleanup_failed") from None
        except BaseException:
            # The original failure is preserved only when the boundary is provably
            # closed; otherwise it may carry private text that must not be chained.
            if self._rollback():
                raise
            raise SelectedDraftError("selected_draft_cleanup_failed") from None
        try:
            self.connection.commit()
        except (AttributeError, TypeError, sqlite3.Error):
            # No receipt may be handed back once the commit did not provably succeed.
            if self._rollback():
                raise SelectedDraftError("store_state_invalid") from None
            raise SelectedDraftError("selected_draft_cleanup_failed") from None
        return receipt

    def _begin(self) -> None:
        """Open this call's own transaction without leaking driver text.

        A caller's transaction is never joined, committed or rolled back: an already
        open transaction is refused here, so every rollback taken by this service can
        only ever abandon work this call itself opened.
        """
        try:
            active = self.connection.in_transaction
        except (AttributeError, TypeError, sqlite3.Error):
            raise SelectedDraftError("store_state_invalid") from None
        if active:
            raise SelectedDraftError("transaction_active")
        try:
            self.connection.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            # A concurrent writer holds the store: refuse with a fixed code rather
            # than surfacing the driver's busy/locked text.
            raise SelectedDraftError("store_busy") from None
        except (AttributeError, TypeError, sqlite3.Error):
            raise SelectedDraftError("store_state_invalid") from None

    def _rollback(self) -> bool:
        """Abandon this call's own transaction; report a provably closed boundary."""
        try:
            self.connection.rollback()
            return True
        except (AttributeError, TypeError, sqlite3.Error):
            return False

    def _replay(self, row: sqlite3.Row, request_hash: str) -> SelectedDraftReceipt:
        """Return the original receipt after integrity checks; generate no work."""
        if str(row["request_hash"]) != request_hash:
            raise SelectedDraftError("request_conflict")
        binding = self.connection.execute(
            "SELECT * FROM selected_draft_binding WHERE binding_id=?",
            (row["binding_id"],),
        ).fetchone()
        if binding is None:
            raise SelectedDraftError("binding_integrity_failed")
        revision = self.connection.execute(
            "SELECT campaign_id,person_id,step,hash,prompt_version FROM revision WHERE revision_id=?",
            (binding["revision_id"],),
        ).fetchone()
        values = {
            key: (None if binding[key] is None else str(binding[key]))
            for key in BINDING_HASH_KEYS
        }
        if (
            revision is None
            or str(revision["hash"]) != str(binding["revision_hash"])
            or str(revision["prompt_version"]) != str(binding["prompt_version"])
            or str(revision["campaign_id"]) != str(binding["campaign_id"])
            or str(revision["person_id"]) != str(binding["person_id"])
            or int(revision["step"]) != 0
            or _binding_hash(values) != str(binding["binding_hash"])
        ):
            raise SelectedDraftError("binding_integrity_failed")
        # Derived from this immutable request row only: never from the latest head,
        # and never invented for a request that merely reused an existing binding.
        superseded = (
            str(row["expected_revision_id"])
            if str(row["operation"]) == "regenerate"
            and str(row["result_state"]) == "regenerated"
            and row["expected_revision_id"] is not None
            else None
        )
        return self._receipt(
            str(row["request_id"]), binding, str(row["result_state"]), True, superseded,
        )

    def _assert_no_pending_work(
        self, campaign_id: str, person_id: str, stamp: datetime,
    ) -> None:
        """Refuse rather than cancel or overwrite live human or agent work."""
        candidate = self.connection.execute(
            """SELECT qa_state FROM review_candidate
                WHERE campaign_id=? AND person_id=? ORDER BY rowid DESC LIMIT 1""",
            (campaign_id, person_id),
        ).fetchone()
        if candidate is not None and str(candidate["qa_state"]) in {"pending_qa", "qa_failed"}:
            raise SelectedDraftError("human_edit_unresolved")
        marks = ",".join("?" for _ in _RUNNING_STATES)
        if self.connection.execute(
            f"""SELECT 1 FROM prospecting_pipeline_item
                 WHERE campaign_id=? AND person_id=? AND state IN ({marks}) LIMIT 1""",
            (campaign_id, person_id, *_RUNNING_STATES),
        ).fetchone() is not None:
            raise SelectedDraftError("pipeline_work_active")
        if self.connection.execute(
            """SELECT 1 FROM prospecting_pipeline_suggestion AS suggestion
                 JOIN prospecting_pipeline_item AS item ON item.item_id=suggestion.item_id
                WHERE item.campaign_id=? AND item.person_id=? AND NOT EXISTS (
                  SELECT 1 FROM prospecting_suggestion_decision AS decision
                   WHERE decision.suggestion_id=suggestion.suggestion_id) LIMIT 1""",
            (campaign_id, person_id),
        ).fetchone() is not None:
            raise SelectedDraftError("agent_suggestion_pending")
        leases = self.connection.execute(
            """SELECT attempt.lease_until FROM prospecting_stage_attempt AS attempt
                 JOIN prospecting_pipeline_item AS item ON item.item_id=attempt.item_id
                WHERE item.campaign_id=? AND item.person_id=? AND attempt.state='claimed'""",
            (campaign_id, person_id),
        ).fetchall()
        if any(stamp <= _timestamp(row["lease_until"]) for row in leases):
            raise SelectedDraftError("pipeline_work_active")

    def _assert_descendant(self, head_id: str, ancestor_id: str) -> None:
        """Prove one exact head is a real validated descendant of one exact revision.

        This is a thin wrapper over :func:`_lineage_root`, the single bounded
        ancestry walk this module owns.  That walk already follows only validated
        review/agent edges, refuses an unverifiable stored edge, a fork, a cycle, a
        cross campaign/person/step edge and an over-deep chain, and deliberately
        never stops at a P21 budget boundary.  No second traversal, no alternative
        lineage source and no optional corruption bypass exists here, so source
        resolution and regeneration can never disagree about ancestry.

        The pinned head qualifies only when the single root it resolves to is
        exactly the binding revision being superseded; anything else is
        ``expected_revision_unrelated``.  An appended generation is always written
        as an unparented provenance root, so the bound revision is its own root and
        this comparison is the exact descendant question.
        """
        if str(_lineage_root(self.connection, head_id)["revision_id"]) != ancestor_id:
            raise SelectedDraftError("expected_revision_unrelated")

    def _bind(
        self, *, request_id: str, request_hash: str, operation: str, campaign_id: str,
        run_id: str, person_rank_id: str, ranking_batch_hash: str,
        expected_revision_id: str | None, predecessor: str | None, stamp: datetime,
    ) -> SelectedDraftReceipt:
        try:
            selected = resolve_selected_person_source(
                self.connection, run_id=run_id, campaign_id=campaign_id,
                person_rank_id=person_rank_id,
                expected_ranking_batch_hash=ranking_batch_hash, now=stamp,
            )
        except SelectedPersonSourceError as error:
            raise SelectedDraftError(str(error)) from None
        person_id = selected.person_id
        self._assert_no_pending_work(campaign_id, person_id, stamp)
        existing = self.connection.execute(
            """SELECT * FROM selected_draft_binding
                WHERE campaign_id=? AND person_id=? ORDER BY rowid DESC LIMIT 1""",
            (campaign_id, person_id),
        ).fetchone()
        head = self.connection.execute(
            """SELECT revision_id,hash FROM revision
                WHERE campaign_id=? AND person_id=? AND step=0
                ORDER BY rowid DESC LIMIT 1""",
            (campaign_id, person_id),
        ).fetchone()
        head_id = None if head is None else str(head["revision_id"])
        superseded_revision_id: str | None = None
        if existing is None:
            if operation != "materialize":
                raise SelectedDraftError("predecessor_binding_missing")
        else:
            on_bound_head = head_id is not None and head_id == str(existing["revision_id"])
            if operation == "regenerate":
                # Both pins are required, and both are checked against exact stored
                # values before any render, evidence or identity work happens.
                if predecessor != str(existing["binding_hash"]):
                    raise SelectedDraftError("predecessor_binding_stale")
                if head_id is None or expected_revision_id != head_id:
                    raise SelectedDraftError("stale_expected_revision")
                if not on_bound_head:
                    # A human edit or accepted agent revision sits above the bound
                    # draft.  It is never overwritten and never re-parented: the
                    # caller must pin that exact head, and it must be a real
                    # descendant of the exact binding it supersedes.
                    self._assert_descendant(head_id, str(existing["revision_id"]))
                superseded_revision_id = head_id
            elif not on_bound_head:
                # Blind materialize over an edited descendant still refuses: stale
                # history must never silently become current again.
                raise SelectedDraftError("selected_draft_superseded")
        rendered = render_selected_person_revision(
            self.connection, selected=selected, anchors=_ANCHORS, now=stamp,
        )
        if selected_render_context_digest(
            self.connection, campaign_id,
        ) != rendered.render_context_digest:
            raise SelectedDraftError("render_context_stale")
        if existing is not None and str(existing["revision_hash"]) == rendered.revision_hash:
            if operation == "regenerate":
                # Nothing actually changed, so no new identity may be minted.
                raise SelectedDraftError("regeneration_context_unchanged")
            self._record_request(
                request_id, request_hash, operation, campaign_id, run_id,
                person_rank_id, expected_revision_id, predecessor, "unchanged",
                str(existing["binding_id"]), stamp,
            )
            return self._receipt(request_id, existing, "unchanged", False)
        if operation == "materialize" and existing is not None:
            raise SelectedDraftError("selected_draft_regeneration_required")
        if existing is None and head is not None and str(head["revision_id"]) != rendered.revision_id:
            raise SelectedDraftError("unbound_revision_present")
        # ``build_revision`` is idempotent, so a request whose render context was
        # restored to an earlier generation's exact context renders straight back
        # onto that earlier, already-bound revision.  Inserting a second binding for
        # it would collide with the stored uniqueness on ``revision_id`` and surface
        # as the generic ``store_state_invalid``; refuse with a fixed, specific code
        # instead.  No second binding and no new head are invented here, and the
        # caller's transaction is abandoned by the ordinary rollback path.
        if self.connection.execute(
            "SELECT 1 FROM selected_draft_binding WHERE revision_id=? LIMIT 1",
            (rendered.revision_id,),
        ).fetchone() is not None:
            raise SelectedDraftError("selected_revision_already_bound")
        binding = self._insert_binding(
            request_id=request_id, campaign_id=campaign_id, run_id=run_id,
            person_rank_id=person_rank_id, ranking_batch_hash=ranking_batch_hash,
            selected=selected, rendered=rendered,
            predecessor=None if existing is None else str(existing["binding_hash"]),
            stamp=stamp,
        )
        state = "bound" if existing is None else "regenerated"
        self._record_request(
            request_id, request_hash, operation, campaign_id, run_id, person_rank_id,
            expected_revision_id, predecessor, state, str(binding["binding_id"]), stamp,
        )
        return self._receipt(request_id, binding, state, False, superseded_revision_id)

    def _insert_binding(
        self, *, request_id: str, campaign_id: str, run_id: str, person_rank_id: str,
        ranking_batch_hash: str, selected: SelectedPersonSource, rendered,
        predecessor: str | None, stamp: datetime,
    ) -> sqlite3.Row:
        values: dict[str, object] = {
            "binding_id": "sdb_" + uuid.uuid4().hex,
            "request_id": request_id,
            "campaign_id": campaign_id,
            "run_id": run_id,
            "person_id": selected.person_id,
            "person_rank_id": person_rank_id,
            "ranking_batch_hash": ranking_batch_hash,
            "qualification_artifact_id": selected.qualification_artifact_id,
            "qualification_output_hash": selected.qualification_output_hash,
            "source_context_digest": rendered.source_context_digest,
            "render_context_digest": rendered.render_context_digest,
            "revision_id": rendered.revision_id,
            "revision_hash": rendered.revision_hash,
            "prompt_version": rendered.prompt_version,
            "predecessor_binding_hash": predecessor,
        }
        digest = _binding_hash(values)
        self.connection.execute(
            """INSERT INTO selected_draft_binding(
                   binding_id,binding_hash,request_id,campaign_id,run_id,person_id,
                   person_rank_id,ranking_batch_hash,qualification_artifact_id,
                   qualification_output_hash,source_context_digest,render_context_digest,
                   revision_id,revision_hash,prompt_version,predecessor_binding_hash,
                   created_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                values["binding_id"], digest, request_id, campaign_id, run_id,
                values["person_id"], person_rank_id, ranking_batch_hash,
                values["qualification_artifact_id"], values["qualification_output_hash"],
                values["source_context_digest"], values["render_context_digest"],
                values["revision_id"], values["revision_hash"],
                values["prompt_version"], predecessor, stamp.isoformat(),
            ),
        )
        row = self.connection.execute(
            "SELECT * FROM selected_draft_binding WHERE binding_id=?",
            (values["binding_id"],),
        ).fetchone()
        if row is None or str(row["binding_hash"]) != digest:
            raise SelectedDraftError("store_state_invalid")
        return row

    def _record_request(
        self, request_id: str, request_hash: str, operation: str, campaign_id: str,
        run_id: str, person_rank_id: str, expected_revision_id: str | None,
        predecessor: str | None, state: str, binding_id: str, stamp: datetime,
    ) -> None:
        self.connection.execute(
            """INSERT INTO selected_draft_request(
                   request_id,request_hash,operation,campaign_id,run_id,person_rank_id,
                   expected_revision_id,expected_predecessor_binding_hash,result_state,
                   binding_id,created_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (
                request_id, request_hash, operation, campaign_id, run_id,
                person_rank_id, expected_revision_id, predecessor, state,
                binding_id, stamp.isoformat(),
            ),
        )

    @staticmethod
    def _receipt(
        request_id: str, binding: sqlite3.Row, state: str, replayed: bool,
        superseded_revision_id: str | None = None,
    ) -> SelectedDraftReceipt:
        predecessor = binding["predecessor_binding_hash"]
        return SelectedDraftReceipt(
            request_id, str(binding["binding_id"]), str(binding["binding_hash"]),
            str(binding["revision_id"]), str(binding["revision_hash"]),
            str(binding["prompt_version"]), str(binding["source_context_digest"]),
            str(binding["render_context_digest"]),
            None if predecessor is None else str(predecessor), state, replayed,
            superseded_revision_id,
        )


__all__ = [
    "BINDING_VERSION", "MAX_LINEAGE", "SelectedDraftError", "SelectedDraftReceipt",
    "SelectedDraftRequest", "SelectedDraftService", "resolve_revision_selection",
]
