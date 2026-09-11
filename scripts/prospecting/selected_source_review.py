"""P24 selected-source attestation: one immutable human confirmation per context.

Scope and deliberate boundaries
-------------------------------
*   :class:`SelectedSourceReviewService` records that a local human looked at the
    exact selected-person source behind one exact selected draft and confirmed it.
    It writes exactly one table, ``selected_source_attestation``, and nothing else.
*   It confers no readiness, no send authority and no delivery permission of any
    kind, and it is not itself the source proof: the proof stays the resolver's
    validated snapshot/observation binding.  This row only records confirmation.
*   It never mints a name/role/candidate observation, never edits employment, fill,
    affinity, contact or P18/P19/P20 source identity, never calls a model, never
    allocates or resets a P21 repair budget, and never writes P16/P22/ReviewService
    state.  It reuses the shared P22 resolver rather than re-deriving selection.
*   The actor label is a fixed server constant (:data:`ATTESTED_BY`).  It is not a
    caller-supplied string in the request payload and is never derived from a model:
    the local Review HTTP layer (wired in a later slice) maps one real human review
    action onto this label.
*   ``attested`` must be explicitly ``True`` in the request.  Qualification, a
    rendered draft, or a merely resolvable selection are never automatic
    confirmation.

Replay and reuse
----------------
Every successful request is recorded in its own immutable ledger table,
``selected_source_attestation_request``: the request UUID, the exact hash of its
payload and a reference to the attestation receipt it resolved to -- for a newly
minted attestation and for a reused one alike.  Replay is decided from that ledger
before any current-head, selection or staleness check, so the exact original payload
always returns the exact original receipt even after a later human edit or source
drift, while the *current* proof stays stale-refusing.  The same UUID with any
changed payload is ``request_conflict``, never a context-specific code.  A fresh
UUID over an unchanged source context still reuses the existing attestation row --
no second attestation identity is ever minted for one source context, and no
authority or budget is opened -- but that request is bound immutably all the same.
Both rows are written in one transaction, so a failure after either leaves neither.

Shared read helper
------------------
:func:`selected_revision_role_proof` maps the same resolver record onto the existing
``CurrentRoleProof`` shape, with ``attested`` true only when an immutable attestation
matches the *current* exact source digest, snapshot, candidate/employment observation
and content hash.  It performs no second lineage walk (the shared resolver already
validates lineage and current context) and never falls back to the legacy P13 proof
when the selected context is stale.

It additionally surfaces two already-resolved identifiers of that same single
resolution -- ``source_context_digest`` and ``employment_observation_id`` -- so a
consumer never has to cross-read the latest selection or the latest employment row
to label what it is displaying.  They are metadata about the exact proof that was
resolved; they carry no attestation, readiness or send authority of their own.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
import sqlite3
import uuid

from scripts.prospecting.affinity.evidence_bridge import (
    CurrentRoleProof,
    selected_person_identity,
)
from scripts.prospecting.selected_draft_service import (
    SelectedDraftError,
    resolve_revision_selection,
)
from scripts.prospecting.selected_person_source import SelectedPersonSource


ATTESTATION_VERSION = "selected-source-attestation-v1"
# Fixed server actor label for one local human review action.  Never model-derived
# and never taken from the request payload.
ATTESTED_BY = "human:local-review"
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")


class SelectedSourceReviewError(ValueError):
    """Fixed-code refusal at the selected-source attestation boundary."""


@dataclass(frozen=True)
class SelectedSourceAttestationRequest:
    """One caller intent.  ``attested`` must be explicitly True."""

    request_id: str
    campaign_id: str
    person_id: str
    expected_revision_id: str
    expected_source_context_digest: str
    expected_candidate_observation_id: str
    attested: bool = False


@dataclass(frozen=True)
class SelectedSourceAttestationReceipt:
    """Safe projection: opaque IDs, digests, expiry and states only."""

    request_id: str
    attestation_id: str
    revision_id: str
    binding_hash: str
    source_context_digest: str
    candidate_observation_id: str
    snapshot_id: str
    expires_at: str
    attested: bool
    state: str
    replayed: bool


@dataclass(frozen=True, repr=False)
class SelectedCurrentRoleProof(CurrentRoleProof):
    """``CurrentRoleProof`` with a value-free repr and exact selected metadata.

    The shared record is declared ``repr=True`` and carries a raw source excerpt and
    source URL, which must never reach logs or assertion output.  This subclass keeps
    the base record's exact field contract (and ``isinstance`` compatibility) while
    suppressing the dataclass repr, and it now also carries the selected metadata of
    the one resolution it was built from.

    The two appended fields are defaulted, so every existing positional construction
    of a ``CurrentRoleProof``-shaped record keeps working unchanged, and the base
    record's own field contract and attestation semantics are untouched.  Both are
    copied from the single resolver record this proof was built from: they never
    trigger a second resolver walk, a latest-selection read or a latest-employment
    read, and they are never derived from anything the caller supplied.
    """

    source_context_digest: str | None = None
    employment_observation_id: str | None = None

    def __repr__(self) -> str:
        return object.__repr__(self)


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise SelectedSourceReviewError("store_state_invalid") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def _request_hash(
    campaign_id: str, person_id: str, expected_revision_id: str,
    expected_digest: str, expected_candidate: str,
) -> str:
    """Hash of the exact caller payload; ``attested`` is always True by then."""
    return _digest([
        ATTESTATION_VERSION, campaign_id, person_id, expected_revision_id,
        expected_digest, expected_candidate, True,
    ])


def _request_id(value: object) -> str:
    if type(value) is not str:
        raise SelectedSourceReviewError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, TypeError, ValueError):
        raise SelectedSourceReviewError("invalid_request_id") from None
    if str(parsed) != value:
        raise SelectedSourceReviewError("invalid_request_id")
    return value


def _safe_id(value: object, code: str) -> str:
    if type(value) is not str or _SAFE_ID.fullmatch(value) is None:
        raise SelectedSourceReviewError(code)
    return value


def _sha(value: object, code: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        raise SelectedSourceReviewError(code)
    return value


def _now(value: object) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise SelectedSourceReviewError("aware_now_required")
    return value.astimezone(timezone.utc)


def _query(connection, sql: str, parameters: tuple[object, ...]):
    cursor = connection.cursor()
    cursor.row_factory = sqlite3.Row
    return cursor.execute(sql, parameters)


def _selection(connection, revision_id: str, stamp: datetime) -> SelectedPersonSource:
    """Resolve through the single shared resolver; a legacy root is not attestable."""
    try:
        selected = resolve_revision_selection(connection, revision_id, stamp)
    except SelectedDraftError as error:
        raise SelectedSourceReviewError(str(error)) from None
    if selected is None:
        raise SelectedSourceReviewError("selected_binding_missing")
    return selected


def _matching_attestation(connection, selected: SelectedPersonSource):
    """The immutable attestation for this exact current source context, if any."""
    return _query(
        connection,
        """SELECT * FROM selected_source_attestation
            WHERE campaign_id=? AND person_id=? AND source_context_digest=?
              AND candidate_observation_id=? AND employment_observation_id=?
              AND snapshot_id=? AND content_sha256=? AND attested=1
            ORDER BY created_at DESC,attestation_id DESC LIMIT 1""",
        (
            selected.campaign_id, selected.person_id, selected.source_context_digest,
            selected.candidate_observation_id, selected.employment_observation_id,
            selected.snapshot_id, selected.content_sha256,
        ),
    ).fetchone()


def selected_revision_role_proof(
    connection, revision_id: str, now: datetime,
) -> CurrentRoleProof | None:
    """Return the exact selected-source role proof behind one revision.

    ``None`` means a legacy (non-selected) root, exactly as the shared resolver
    defines it.  Any staleness -- changed source bytes, expiry, selection drift or
    render-context drift -- is a refusal, never a fallback to the legacy P13 path.
    """
    stamp = _now(now)
    try:
        selected = resolve_revision_selection(connection, revision_id, stamp)
    except SelectedDraftError as error:
        raise SelectedSourceReviewError(str(error)) from None
    except sqlite3.Error:
        raise SelectedSourceReviewError("store_state_invalid") from None
    if selected is None:
        return None
    try:
        identity = selected_person_identity(connection, selected)
    except SelectedSourceReviewError:
        raise
    except ValueError as error:
        raise SelectedSourceReviewError(str(error)) from None
    except sqlite3.Error:
        raise SelectedSourceReviewError("store_state_invalid") from None
    try:
        attestation = _matching_attestation(connection, selected)
    except sqlite3.Error:
        raise SelectedSourceReviewError("store_state_invalid") from None
    # Qualification is never confirmation: only an exact matching immutable row is.
    return SelectedCurrentRoleProof(
        selected.campaign_id, selected.person_id, identity.company_id,
        identity.employment_id, selected.candidate_observation_id,
        selected.snapshot_id, selected.source_url, identity.excerpt,
        selected.retrieved_at, selected.expires_at, attestation is not None,
        # Metadata of this exact already-resolved selection only.  ``selected`` was
        # validated by ``selected_person_identity`` above, which requires both of
        # these to be non-empty strings bound to the same employment row.
        selected.source_context_digest, selected.employment_observation_id,
    )


class SelectedSourceReviewService:
    """Record one immutable selected-source attestation per exact request."""

    def __init__(
        self,
        connection,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self.connection = connection
        self.now = now

    def attest(
        self, request: SelectedSourceAttestationRequest,
    ) -> SelectedSourceAttestationReceipt:
        if not isinstance(request, SelectedSourceAttestationRequest):
            raise SelectedSourceReviewError("invalid_request")
        request_id = _request_id(request.request_id)
        campaign_id = _safe_id(request.campaign_id, "invalid_campaign_id")
        person_id = _safe_id(request.person_id, "invalid_person_id")
        expected_revision_id = _safe_id(
            request.expected_revision_id, "invalid_revision_id",
        )
        expected_digest = _sha(
            request.expected_source_context_digest, "invalid_source_context_digest",
        )
        expected_candidate = _safe_id(
            request.expected_candidate_observation_id, "invalid_observation_id",
        )
        if request.attested is not True:
            raise SelectedSourceReviewError("source_attestation_required")
        request_hash = _request_hash(
            campaign_id, person_id, expected_revision_id, expected_digest,
            expected_candidate,
        )
        stamp = _now(self.now())
        try:
            active = self.connection.in_transaction
        except sqlite3.Error:
            raise SelectedSourceReviewError("store_state_invalid") from None
        if active:
            # The caller owns an open transaction; it is never committed or rolled
            # back here.
            raise SelectedSourceReviewError("transaction_active")
        try:
            self.connection.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            # A concurrent writer holds the store: refuse with a fixed code rather
            # than surfacing the driver's busy/locked text.
            raise SelectedSourceReviewError("store_busy") from None
        except sqlite3.Error:
            raise SelectedSourceReviewError("store_state_invalid") from None
        try:
            receipt = self._attest(
                request_id=request_id, request_hash=request_hash,
                campaign_id=campaign_id, person_id=person_id,
                expected_revision_id=expected_revision_id,
                expected_digest=expected_digest,
                expected_candidate=expected_candidate, stamp=stamp,
            )
            self.connection.commit()
            return receipt
        except SelectedSourceReviewError:
            self._cleanup()
            raise
        except SelectedDraftError as error:
            code = str(error)
            self._cleanup()
            raise SelectedSourceReviewError(code) from None
        except sqlite3.Error:
            # Never surface dynamic driver text through this public service.
            self._cleanup()
            raise SelectedSourceReviewError("store_state_invalid") from None
        except BaseException:
            self._cleanup()
            raise

    def _cleanup(self) -> None:
        """Roll back only this service's own transaction, honestly."""
        try:
            self.connection.rollback()
        except sqlite3.Error:
            raise SelectedSourceReviewError("attestation_cleanup_failed") from None

    def _attest(
        self, *, request_id: str, request_hash: str, campaign_id: str, person_id: str,
        expected_revision_id: str, expected_digest: str, expected_candidate: str,
        stamp: datetime,
    ) -> SelectedSourceAttestationReceipt:
        # The immutable request ledger, not the attestation row, decides replay, and
        # it is consulted before any head/selection/staleness check: the exact
        # original payload must keep returning the exact original receipt even after
        # a later human edit or source drift.
        ledger = _query(
            self.connection,
            "SELECT * FROM selected_source_attestation_request WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if ledger is not None:
            if str(ledger["request_hash"]) != request_hash:
                raise SelectedSourceReviewError("request_conflict")
            return self._replay(ledger)
        minted = _query(
            self.connection,
            "SELECT 1 FROM selected_source_attestation WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if minted is not None:
            # An attestation bound to this UUID without its ledger row is a half
            # record: fail closed rather than replaying or re-minting anything.
            raise SelectedSourceReviewError("attestation_integrity_failed")
        head = _query(
            self.connection,
            """SELECT revision_id FROM revision
                WHERE campaign_id=? AND person_id=? AND step=0
                ORDER BY rowid DESC LIMIT 1""",
            (campaign_id, person_id),
        ).fetchone()
        if head is None:
            raise SelectedSourceReviewError("selected_draft_missing")
        if str(head["revision_id"]) != expected_revision_id:
            raise SelectedSourceReviewError("stale_expected_revision")
        selected = _selection(self.connection, expected_revision_id, stamp)
        if selected.campaign_id != campaign_id or selected.person_id != person_id:
            raise SelectedSourceReviewError("selected_scope_mismatch")
        if selected.source_context_digest != expected_digest:
            raise SelectedSourceReviewError("source_context_conflict")
        # No arbitrary replacement candidate may be substituted for the reviewed one.
        if selected.candidate_observation_id != expected_candidate:
            raise SelectedSourceReviewError("source_candidate_conflict")
        try:
            identity = selected_person_identity(self.connection, selected)
        except SelectedSourceReviewError:
            raise
        except ValueError as error:
            raise SelectedSourceReviewError(str(error)) from None
        binding = self._binding(selected, stamp)
        existing = _matching_attestation(self.connection, selected)
        if existing is not None:
            # A fresh request over an unchanged context reuses the original row: no
            # new attestation identity, no new authority, no budget touched.  The
            # request itself is still bound immutably to that exact receipt.
            self._record_request(
                request_id=request_id, request_hash=request_hash,
                campaign_id=campaign_id, person_id=person_id,
                expected_revision_id=expected_revision_id,
                expected_digest=expected_digest,
                expected_candidate=expected_candidate, result_state="reused",
                attestation_id=str(existing["attestation_id"]), stamp=stamp,
            )
            return self._receipt(request_id, existing, True)
        attestation_id = "ssa_" + uuid.uuid4().hex
        self.connection.execute(
            """INSERT INTO selected_source_attestation(
                   attestation_id,request_id,request_hash,campaign_id,person_id,
                   company_id,employment_id,head_revision_id,revision_id,revision_hash,
                   binding_id,binding_hash,source_context_digest,
                   candidate_observation_id,employment_observation_id,snapshot_id,
                   content_sha256,expires_at,attested,attested_by,created_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                attestation_id, request_id, request_hash, campaign_id, person_id,
                identity.company_id, identity.employment_id, expected_revision_id,
                str(binding["revision_id"]), str(binding["revision_hash"]),
                str(binding["binding_id"]), str(binding["binding_hash"]),
                selected.source_context_digest, selected.candidate_observation_id,
                selected.employment_observation_id, selected.snapshot_id,
                selected.content_sha256, selected.expires_at, 1, ATTESTED_BY,
                stamp.isoformat(),
            ),
        )
        row = _query(
            self.connection,
            "SELECT * FROM selected_source_attestation WHERE attestation_id=?",
            (attestation_id,),
        ).fetchone()
        if row is None:
            raise SelectedSourceReviewError("store_state_invalid")
        self._record_request(
            request_id=request_id, request_hash=request_hash,
            campaign_id=campaign_id, person_id=person_id,
            expected_revision_id=expected_revision_id,
            expected_digest=expected_digest, expected_candidate=expected_candidate,
            result_state="attested", attestation_id=attestation_id, stamp=stamp,
        )
        return self._receipt(request_id, row, False)

    def _record_request(
        self, *, request_id: str, request_hash: str, campaign_id: str,
        person_id: str, expected_revision_id: str, expected_digest: str,
        expected_candidate: str, result_state: str, attestation_id: str,
        stamp: datetime,
    ) -> None:
        """Bind one successful request immutably to the receipt it resolved to.

        Written inside the same transaction as any attestation insert, so a failure
        after either statement leaves neither row behind.
        """
        self.connection.execute(
            """INSERT INTO selected_source_attestation_request(
                   request_id,request_hash,campaign_id,person_id,expected_revision_id,
                   expected_source_context_digest,expected_candidate_observation_id,
                   result_state,attestation_id,created_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                request_id, request_hash, campaign_id, person_id,
                expected_revision_id, expected_digest, expected_candidate,
                result_state, attestation_id, stamp.isoformat(),
            ),
        )

    def _replay(self, ledger) -> SelectedSourceAttestationReceipt:
        """Return the original receipt for one already bound request.

        Integrity is re-derived from the ledger's own stored columns: the payload
        hash is recomputed rather than trusted, and the cited attestation must still
        exist, still be attested, and still hold the exact context the request named.
        No resolver walk and no staleness check runs here -- a replay reports what
        was recorded, never what is current.
        """
        recomputed = _request_hash(
            str(ledger["campaign_id"]), str(ledger["person_id"]),
            str(ledger["expected_revision_id"]),
            str(ledger["expected_source_context_digest"]),
            str(ledger["expected_candidate_observation_id"]),
        )
        row = _query(
            self.connection,
            "SELECT * FROM selected_source_attestation WHERE attestation_id=?",
            (ledger["attestation_id"],),
        ).fetchone()
        if (
            recomputed != str(ledger["request_hash"])
            or row is None
            or int(row["attested"]) != 1
            or str(row["campaign_id"]) != str(ledger["campaign_id"])
            or str(row["person_id"]) != str(ledger["person_id"])
            or str(row["source_context_digest"])
            != str(ledger["expected_source_context_digest"])
            or str(row["candidate_observation_id"])
            != str(ledger["expected_candidate_observation_id"])
        ):
            raise SelectedSourceReviewError("attestation_integrity_failed")
        return self._receipt(str(ledger["request_id"]), row, True)

    def _binding(self, selected: SelectedPersonSource, stamp: datetime):
        """Cite the exact current binding backing this selection, revalidated."""
        row = _query(
            self.connection,
            """SELECT * FROM selected_draft_binding
                WHERE campaign_id=? AND person_id=? ORDER BY rowid DESC LIMIT 1""",
            (selected.campaign_id, selected.person_id),
        ).fetchone()
        if row is None:
            raise SelectedSourceReviewError("selected_binding_missing")
        if str(row["source_context_digest"]) != selected.source_context_digest:
            raise SelectedSourceReviewError("selected_binding_stale")
        # The shared resolver, not a private walk, proves the cited binding is the
        # same live selection the reviewed head resolves to.
        if _selection(self.connection, str(row["revision_id"]), stamp) != selected:
            raise SelectedSourceReviewError("selected_binding_stale")
        revision = _query(
            self.connection,
            "SELECT campaign_id,person_id,step,hash FROM revision WHERE revision_id=?",
            (row["revision_id"],),
        ).fetchone()
        if revision is None or (
            str(revision["hash"]) != str(row["revision_hash"])
            or int(revision["step"]) != 0
            or str(revision["campaign_id"]) != selected.campaign_id
            or str(revision["person_id"]) != selected.person_id
        ):
            raise SelectedSourceReviewError("selected_binding_scope_mismatch")
        return row

    @staticmethod
    def _receipt(
        request_id: str, row, replayed: bool,
    ) -> SelectedSourceAttestationReceipt:
        return SelectedSourceAttestationReceipt(
            request_id, str(row["attestation_id"]), str(row["head_revision_id"]),
            str(row["binding_hash"]), str(row["source_context_digest"]),
            str(row["candidate_observation_id"]), str(row["snapshot_id"]),
            str(row["expires_at"]), True, "attested", replayed,
        )


__all__ = [
    "ATTESTATION_VERSION", "ATTESTED_BY", "SelectedCurrentRoleProof",
    "SelectedSourceAttestationReceipt", "SelectedSourceAttestationRequest",
    "SelectedSourceReviewError", "SelectedSourceReviewService",
    "selected_revision_role_proof",
]
