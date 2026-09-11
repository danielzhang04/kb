"""Render one P22 selected-person revision from the exact resolved source (slice 2).

Scope and deliberate boundaries
-------------------------------
*   This module renders and persists copy for a person already selected by P20 and
    already validated by :mod:`scripts.prospecting.selected_person_source`.  It adds
    no schema, binds no P22 request/lineage row (a later slice binds those by the
    caller) and edits no resolver.
*   It never fabricates fill_person / fill_firm / campaign_fit_spec / person_affinity
    / contact_point / approval rows, and never requires them as prerequisites.  No
    email is produced and no model is called (``model_version`` is always "none").
*   Campaign facts are never invented: the saved campaign row and the exact
    sender_profile row it references are loaded through the shared
    :func:`~scripts.prospecting.affinity.templates_v2.load_campaign_render_context`
    helper, which the legacy P8 path also uses.  The ``anchors`` argument is still
    required for consistency with the legacy drafting contract, but no sender fact is
    ever read from it -- it is not a sender profile.
*   It never builds a synthetic :class:`Affinity` to reuse the P8 mint loop.  Instead
    it uses the narrow, exact selected-source evidence path
    (:func:`mint_selected_person_evidence`), which shares the insert/idempotency
    primitive with P8 rather than copying it.  Legacy P8 drafting, including its
    approved fit-spec gate, is untouched.
*   No role-family allowlist is invented here.  The resolver already guarantees a
    mapped family produced by the current P20 role policy, and the current-role
    template states only the evidenced name, employer and title, which is true for
    every family that policy can map.
*   Import direction: ``selected_person_source`` reaches ``templates_v2`` and
    ``evidence_bridge`` through the qualification/pipeline chain, so this module is a
    leaf.  Neither ``templates_v2`` nor ``evidence_bridge`` may import it.

Canonical revision identity
---------------------------
The revision hash must change whenever the selection provenance changes, even when
the rendered subject/body are byte-identical.  No schema shortcut is used: the
existing :class:`RevisionInput.prompt_version` field carries the explicit value
``selected-person-render-v1:<source_context_digest>:<render_context_digest>``.
Semantics: the render contract version, the exact resolver provenance digest that
the copy was rendered from, and this module's own self-computed digest of the
complete render context (the exact saved sender_profile row in full, the campaign
render policy/ask/intent, and the template identity plus content version).  Both
digests are reported as separate result fields as well, and the source digest stays
its own output field.  The minted evidence_ids carry the source digest, so evidence
and revision identity move together when the selection moves; an identical copy
rendered under a changed sender or campaign context still gets a new revision
identity.  The render-context digest is always computed here, from saved rows only:
no caller may supply, forge or override it, and no timestamp or random value ever
enters revision identity.

Source confirmation by a human stays a separate step; nothing here attests anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import sqlite3

from scripts.prospecting.affinity.evidence_bridge import (
    mint_selected_person_evidence,
    selected_person_identity,
)
from scripts.prospecting.affinity.templates_v2 import (
    BINDING_MAP,
    GENERIC_SUBJECTS,
    DraftError,
    _bindings,
    ask_sentence,
    check_bands,
    clamp_slot_values,
    fit_subject,
    load_campaign_render_context,
    load_registry_v2,
)
from scripts.prospecting.personalizer import qa
from scripts.prospecting.personalizer.evidence import list_evidence
from scripts.prospecting.personalizer.qa import QaPolicy
from scripts.prospecting.personalizer.revision import RevisionInput, build_revision
from scripts.prospecting.personalizer.templates import TemplateError, render, slot_inventory
from scripts.prospecting.review_qa import (
    record_revision_qa_context,
    require_revision_qa_context,
)
from scripts.prospecting.selected_person_source import (
    SelectedPersonSource,
    SelectedPersonSourceError,
    resolve_selected_person_source,
)


RENDER_VERSION = "selected-person-render-v1"
RENDER_CONTEXT_VERSION = "selected-render-context-v1"
SELECTED_TEMPLATE_ID = "startup_current_role_hook"
SAVEPOINT = "p22_selected_revision"


class SelectedRenderError(ValueError):
    """Fixed-code refusal raised before or instead of any selected-render mutation."""


@dataclass(frozen=True)
class SelectedPersonRevision:
    """Result of one selected-person render.

    ``created`` is False on a deterministic replay that matched an existing
    revision hash; the existing revision_id is returned unchanged in that case.
    """

    revision_id: str
    revision_hash: str
    created: bool
    person_id: str
    campaign_id: str
    template_id: str
    template_version: int
    prompt_version: str
    source_context_digest: str
    render_context_digest: str
    evidence_ids: tuple[str, ...]


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise SelectedRenderError("render_context_invalid") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def _sender_profile_fields(connection, sender_profile_id: str) -> dict[str, object]:
    """Return every saved column of the exact referenced sender_profile row.

    All fields participate in the digest, not only the ones this template copies:
    a change to any saved sender fact must make an existing selected draft stale,
    even when the rendered bytes are unchanged.
    """
    cursor = connection.execute(
        "SELECT * FROM sender_profile WHERE sender_profile_id=?", (sender_profile_id,),
    )
    row = cursor.fetchone()
    if row is None or cursor.description is None:
        raise SelectedRenderError("sender_profile_invalid")
    values: dict[str, object] = {}
    for index, column in enumerate(cursor.description):
        value = row[index]
        if value is None or isinstance(value, (bool, int, float, str)):
            values[str(column[0])] = value
        elif isinstance(value, (bytes, bytearray)):
            values[str(column[0])] = sha256(bytes(value)).hexdigest()
        else:
            raise SelectedRenderError("sender_profile_invalid")
    return values


def _template_identity(template) -> dict[str, object]:
    """Identity plus content version of the exact loaded template object."""
    values: dict[str, object] = {
        "template_id": template.template_id,
        "template_version": template.template_version,
        "slots": sorted(slot_inventory(template)),
    }
    for name in ("subject", "body", "text", "content"):
        value = getattr(template, name, None)
        if type(value) is str:
            values[name] = sha256(value.encode()).hexdigest()
    return values


def _campaign_render_policy(context) -> dict[str, object]:
    return {
        "campaign_id": context.campaign_id,
        "intent": context.intent,
        "ask_type": "informational_call",
        "ask_minutes": context.ask_minutes,
        "subject_band": list(context.subject_band),
        "body_band": list(context.body_band),
        "copy_profile": json.loads(_canonical(dict(context.copy_profile))),
        "policy": json.loads(_canonical(dict(context.policy))),
        "sender_profile_id": context.sender_profile_id,
    }


def _render_context_digest(connection, context, template) -> str:
    return _digest({
        "render_context_version": RENDER_CONTEXT_VERSION,
        "campaign": _campaign_render_policy(context),
        "sender_profile": _sender_profile_fields(connection, context.sender_profile_id),
        "template": _template_identity(template),
    })


def selected_render_context_digest(connection, campaign_id: str) -> str:
    """Recompute the complete current render-context digest for one campaign.

    Read-only and write-free: consumers (the P22 binding service, and later P16)
    revalidate a stored digest through this single helper instead of re-deriving
    sender/campaign/template identity themselves.  No caller-supplied digest is
    ever accepted in its place.
    """
    try:
        context = load_campaign_render_context(connection, campaign_id)
    except DraftError as error:
        raise SelectedRenderError(str(error)) from None
    try:
        template = load_registry_v2()[SELECTED_TEMPLATE_ID]
    except (KeyError, TemplateError):
        raise SelectedRenderError("selected_template_missing") from None
    return _render_context_digest(connection, context, template)


def _revalidated(connection, selected: SelectedPersonSource, now: datetime) -> SelectedPersonSource:
    """Re-run the single resolver and require an exact record/digest match."""
    try:
        current = resolve_selected_person_source(
            connection,
            run_id=selected.run_id,
            campaign_id=selected.campaign_id,
            person_rank_id=selected.person_rank_id,
            expected_ranking_batch_hash=selected.ranking_batch_hash,
            now=now,
        )
    except SelectedPersonSourceError as error:
        # The resolver's codes are a fixed vocabulary; no dynamic text is forwarded.
        raise SelectedRenderError(str(error)) from None
    if current.source_context_digest != selected.source_context_digest or current != selected:
        raise SelectedRenderError("selected_source_stale")
    return current


def _render(connection, selected: SelectedPersonSource, now: datetime) -> SelectedPersonRevision:
    """Revalidate provenance, campaign and identity, then write, inside one savepoint."""
    selected = _revalidated(connection, selected, now)
    try:
        context = load_campaign_render_context(connection, selected.campaign_id)
    except DraftError as error:
        raise SelectedRenderError(str(error)) from None
    try:
        identity = selected_person_identity(connection, selected)
    except ValueError as error:
        raise SelectedRenderError(str(error)) from None

    template = load_registry_v2()[SELECTED_TEMPLATE_ID]
    render_context = _render_context_digest(connection, context, template)
    firm, title = identity.company_name, identity.title
    available = {
        "first_name": identity.first_name,
        # Both hooks are derived only from the exact selected role and company, and
        # each is backed by its own canonical claim minted from the same source.
        "recipient_hook": f"Your {title} work at {firm} caught my attention.",
        "firm_specific_hook": f"the {title} work at {firm}",
        "sender_intro": context.sender_focus,
        "sender_proof": context.sender_operating_proof,
        "ask_minutes": str(context.ask_minutes),
        "ask_mode": "informational conversation",
        "time_window": "two weeks",
        "signature": context.sender_name,
    }
    inventory = slot_inventory(template)
    if inventory - set(available):
        raise SelectedRenderError("selected_template_slot_unsupported")
    values, clamped = clamp_slot_values({name: available[name] for name in inventory})
    if clamped:
        # Clamping would show a truncated name/company/title against an exact claim;
        # refuse instead of weakening the evidenced identity.
        raise SelectedRenderError("selected_identity_too_long")

    try:
        _subject_template, body = render(template, values)
        ask = ask_sentence(body)
    except TemplateError:
        raise SelectedRenderError("selected_template_render_failed") from None
    # Only the family-generic subject is used: every alternative subject in the P8
    # candidate list asserts a career transition that this slice does not evidence.
    subject = fit_subject((GENERIC_SUBJECTS[template.template_id],), *context.subject_band)
    bands = check_bands(subject, body, context.copy_profile)
    if bands:
        raise SelectedRenderError(bands[0])

    required = tuple(sorted({BINDING_MAP[name] for name in inventory if name in BINDING_MAP}))
    try:
        evidence_ids = mint_selected_person_evidence(connection, selected, required)
    except ValueError as error:
        raise SelectedRenderError(str(error)) from None
    bindings = _bindings(
        template, values, evidence_ids, ask,
        sender_profile_ref=f"sender_profile:{context.sender_profile_id}",
    )
    policy = QaPolicy(
        context.intent, 0, "informational_call", *context.body_band, 0.7, frozenset(),
    )
    result = qa.validate_revision(
        subject, body, ask, bindings,
        list_evidence(connection, identity.person_id, now), policy,
        identity.person_id, selected.campaign_id, now,
    )
    if result.failure_codes:
        raise SelectedRenderError(f"qa_failed:{','.join(result.failure_codes)}")
    prompt_version = (
        f"{RENDER_VERSION}:{selected.source_context_digest}:{render_context}"
    )
    record = build_revision(connection, RevisionInput(
        identity.person_id, selected.campaign_id, 0, subject, body,
        "why_them", "bespoke", None, ask,
        tuple(sorted(evidence_ids.values())),
        tuple(sorted(
            binding.value for name, binding in bindings.items()
            if name in qa.RECIPIENT_SLOTS
        )),
        (values["sender_proof"],), template.template_id, template.template_version,
        prompt_version, "none", result,
    ))
    if record.created:
        record_revision_qa_context(
            connection, record.revision_id, bindings, policy,
            inherited_from_revision_id=None, created_at=now.isoformat(),
        )
    else:
        # A replay must verify, never backfill or re-parent, the existing context.
        require_revision_qa_context(
            connection, record.revision_id, bindings, policy,
            inherited_from_revision_id=None,
        )
    return SelectedPersonRevision(
        record.revision_id, record.revision_hash, record.created,
        identity.person_id, selected.campaign_id, template.template_id,
        template.template_version, prompt_version, selected.source_context_digest,
        render_context, tuple(sorted(evidence_ids.values())),
    )


def render_selected_person_revision(
    connection, *, selected: SelectedPersonSource, anchors, now: datetime,
) -> SelectedPersonRevision:
    """Render and persist the step-0 revision for one exact selected person.

    The savepoint opens *before* provenance revalidation, so the resolver walk, the
    campaign/sender read, the identity read and every write share one coherent
    snapshot and cannot race a concurrent change between check and write.  The
    caller's transaction is preserved: only this savepoint is released or rolled
    back, so any failure leaves zero partial evidence and zero partial revision
    state.  A second call with the same selection is idempotent -- it re-mints
    byte-identical evidence, matches the existing revision hash and requires the
    already recorded QA context.

    Cleanup is proven, never assumed.  This call reports success only once its own
    savepoint is provably closed: if ``RELEASE`` fails after an otherwise successful
    render, the savepoint is rolled back and ``store_state_invalid`` is raised, so no
    caller can be told a commit boundary closed when it did not.  If the savepoint
    cannot be closed at all, ``selected_render_cleanup_failed`` is raised.  Every
    boundary refusal is raised ``from None``, so neither dynamic driver text nor the
    value-bearing text of an in-render failure can be chained onto a fixed code; an
    original typed failure is re-raised unchanged only when cleanup provably
    succeeded.
    """
    if not isinstance(selected, SelectedPersonSource):
        raise SelectedRenderError("selected_source_required")
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise SelectedRenderError("aware_now_required")
    # Required for consistency with the legacy drafting contract; no sender fact is
    # read from it, and none may be: the saved campaign/sender rows are authoritative.
    if anchors is None:
        raise SelectedRenderError("sender_anchors_missing")
    stamp = now.astimezone(timezone.utc)

    def _release(rollback_first: bool) -> bool:
        """Try to close the savepoint; return True only if the boundary is
        provably closed (either cleanly released, or rolled back and released).

        A caller-owned transaction opened before this savepoint is never touched:
        only ``ROLLBACK TO``/``RELEASE`` of this exact savepoint name is issued.
        """
        try:
            if rollback_first:
                connection.execute(f"ROLLBACK TO {SAVEPOINT}")
            connection.execute(f"RELEASE {SAVEPOINT}")
            return True
        except sqlite3.Error:
            return False

    try:
        connection.execute(f"SAVEPOINT {SAVEPOINT}")
    except sqlite3.Error:
        # Nothing was opened; no cleanup is owed and none is attempted.
        raise SelectedRenderError("store_state_invalid") from None

    try:
        result = _render(connection, selected, stamp)
    except sqlite3.Error:
        # Never surface dynamic driver text through this public service.
        if _release(True):
            raise SelectedRenderError("store_state_invalid") from None
        raise SelectedRenderError("selected_render_cleanup_failed") from None
    except BaseException:
        # The original failure is preserved only when the boundary is provably
        # closed.  Otherwise a fixed code is raised ``from None``: the original may
        # carry identity/excerpt/sender text, which must never be chained onto a
        # public refusal as ``__cause__``.
        if _release(True):
            raise
        raise SelectedRenderError("selected_render_cleanup_failed") from None
    else:
        if _release(False):
            return result
        # RELEASE failed on the success path: this call must never claim success
        # once its own commit boundary could not be proven closed.  Prove the
        # boundary closed by rolling this savepoint back instead.
        if _release(True):
            raise SelectedRenderError("store_state_invalid") from None
        raise SelectedRenderError("selected_render_cleanup_failed") from None


__all__ = [
    "RENDER_CONTEXT_VERSION", "RENDER_VERSION", "SELECTED_TEMPLATE_ID",
    "SelectedPersonRevision", "SelectedRenderError",
    "render_selected_person_revision", "selected_render_context_digest",
]
