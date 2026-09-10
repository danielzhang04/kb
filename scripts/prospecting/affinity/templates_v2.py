"""P8-owned v2 template rendering and deterministic draft construction."""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import string
from types import MappingProxyType
from typing import Any

from scripts.prospecting.personalizer import qa
from scripts.prospecting.personalizer.evidence import list_evidence
from scripts.prospecting.personalizer.qa import QaPolicy, SlotBinding
from scripts.prospecting.personalizer.revision import RevisionInput, build_revision
from scripts.prospecting.personalizer.templates import Template, TemplateError, load_template, render, slot_inventory
from scripts.prospecting.review_qa import (
    record_revision_qa_context,
    require_revision_qa_context,
)

from .evidence_bridge import (
    CurrentRoleProof,
    current_role_source_proof,
    mint_evidence,
    resolve_slot_facts,
)
from .fitspec import FitSpecError, fit_spec_hash, validate_fit_spec
from .score import Affinity, Signal


ROOT = Path(__file__).resolve().parents[3]
TEMPLATE_DIRECTORY_V2 = ROOT / "orgs/prospecting/templates/v2"
BINDING_MAP = {
    "first_name": "first_name", "firm": "company", "their_role": "role",
    "firm_specific_hook": "topic", "shared_school": "school",
    "shared_signal_sentence": "why_them", "transition_from": "transition_from",
    "transition_to": "transition_to", "new_fact_sentence": "new_fact_sentence",
    "recipient_hook": "recipient_hook",
}
KIND_PHRASES = {
    "bank": "banking", "consultancy": "consulting", "pe": "private equity",
    "vc": "venture investing", "hedge_fund": "hedge fund investing",
    "startup": "startup operations", "bigtech": "technology", "corporate": "corporate work",
    "government": "public service", "academia": "academia", "nonprofit": "nonprofit work",
}
SUBJECT_FROM_KIND = {
    "bank": "banking", "consultancy": "consulting", "pe": "private equity",
    "vc": "venture", "hedge_fund": "hedge funds", "startup": "startups",
    "bigtech": "tech", "corporate": "corporate", "government": "government",
    "academia": "academia", "nonprofit": "nonprofits",
}
GENERIC_SUBJECTS = {
    "asset_management_referral": "A grad's quick question on your path",
    "consulting_networking": "Quick question on your operating path",
    "curiosity_thesis": "Question on your investment perspective",
    "follow_up_de_escalation": "One follow-up question about your work today",
    "pe_networking": "Quick question on private equity work",
    "startup_nonops": "Learning how your team is structured",
    "startup_ops_corporate": "Question about your operating perspective",
    "startup_ops_noncorporate": "Quick question on your operating choices",
    "startup_current_role_hook": "A question about your operating work",
    "startup_role_application": "Question about the team's operating work",
    "vc_networking": "Question on your investment approach",
    "vc_parttime": "Quick question on your investment path",
}
SUPPORTED_INTENTS = frozenset({"networking", "recruiting_live", "curiosity", "alumni"})
SLOT_WORD_LIMITS = MappingProxyType({
    "firm_specific_hook": 12,
    "shared_signal_sentence": 18,
    "recipient_hook": 18,
    "their_role": 6,
})


@dataclass(frozen=True)
class DraftSummary:
    candidates: int
    revisions_created: int
    out_of_band: int
    qa_failed: int
    slots_clamped: int
    failure_codes: Mapping[str, int]


class DraftError(ValueError):
    """A fixed-code refusal raised before P8 draft mutation begins."""


def _value(row: object, name: str, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(name, default)
    try:
        return row[name]  # type: ignore[index]
    except (IndexError, KeyError, TypeError):
        return getattr(row, name, default)


def load_registry_v2(directory: Path = TEMPLATE_DIRECTORY_V2) -> Mapping[str, Template]:
    """Load the v2 family registry, which intentionally permits shared intents."""
    registry: dict[str, Template] = {}
    for path in sorted(directory.glob("*.txt")):
        template = load_template(path)
        if template.template_id in registry:
            raise TemplateError(f"duplicate_template_id:{template.template_id}")
        registry[template.template_id] = template
    return MappingProxyType(registry)


def _band(value: object, name: str) -> tuple[int, int]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError(f"invalid_copy_profile:{name}")
    low, high = value
    if not isinstance(low, int) or not isinstance(high, int) or low > high:
        raise ValueError(f"invalid_copy_profile:{name}")
    return low, high


def check_bands(subject: str, body: str, copy_profile: Mapping[str, object]) -> tuple[str, ...]:
    """Return stable codes for the P8 copy-profile bands, without invoking QA."""
    subject_low, subject_high = _band(copy_profile.get("subject_chars"), "subject_chars")
    body_low, body_high = _band(copy_profile.get("body_words"), "body_words")
    failures: list[str] = []
    if not subject_low <= len(subject) <= subject_high:
        failures.append("subject_chars_out_of_band")
    if not body_low <= qa._body_word_count(body) <= body_high:
        failures.append("body_words_out_of_band")
    return tuple(failures)


def ask_sentence(body: str) -> str:
    """Recover the sole question from a rendered template body."""
    asks = [part.strip() for part in qa._sentences(body) if part.strip().endswith("?")]
    if len(asks) != 1:
        raise TemplateError("ask_sentence_not_unique")
    return asks[0]


def _signals(value: object) -> tuple[Signal, ...]:
    try:
        raw = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return ()
    if not isinstance(raw, list):
        return ()
    signals: list[Signal] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        try:
            signals.append(Signal(
                str(item["code"]), str(item["klass"]), int(item["strength"]),
                int(item["weight"]), int(item["points"]),
                tuple(str(observation) for observation in item.get("observation_ids", ())),
                str(item["evidence_id"]) if item.get("evidence_id") is not None else None,
            ))
        except (KeyError, TypeError, ValueError):
            continue
    return tuple(signals)


def _family(intent: str, step: int, row: object, registry: Mapping[str, Template]) -> str:
    if step:
        return "follow_up_de_escalation"
    if intent == "alumni":
        return "asset_management_referral"
    if intent == "curiosity":
        return "curiosity_thesis"
    codes = {signal.code for signal in _signals(_value(row, "signals_json", "[]"))}
    current_kind = str(_value(row, "current_kind", ""))
    if intent == "recruiting_live":
        return "vc_parttime" if current_kind == "vc" or "firm_thesis" in codes else "startup_role_application"
    if current_kind == "vc":
        return "vc_networking"
    if current_kind == "pe":
        return "pe_networking"
    title = str(_value(row, "title", "")).casefold()
    if any(word in title for word in ("operations", "operator", "chief operating", "strategy", "chief of staff")):
        if "path_match" not in codes:
            return "startup_current_role_hook"
        return "startup_ops_corporate" if "shared_prior_employer" in codes else "startup_ops_noncorporate"
    return "startup_nonops" if "startup_nonops" in registry else "vc_networking"


def _firm_short(firm: str) -> str:
    return " ".join(firm.split()[:2])[:18]


def _clamp(value: str, words: int) -> tuple[str, bool]:
    """Clamp at a word boundary and remove punctuation stranded by truncation."""
    parts = value.split()
    if len(parts) <= words:
        return value, False
    return " ".join(parts[:words]).rstrip(string.punctuation), True


def clamp_slot_values(values: Mapping[str, str]) -> tuple[dict[str, str], int]:
    """Apply the four copy-profile slot limits and report how many values changed."""
    clamped = dict(values)
    count = 0
    for name, words in SLOT_WORD_LIMITS.items():
        if name in clamped:
            clamped[name], changed = _clamp(clamped[name], words)
            count += changed
    return clamped, count


def _slot_values_with_clamp_count(
    connection,
    row: object,
    template: Template,
    anchors,
    *,
    sender_name: str,
    sender_focus: str,
    sender_proof: str,
    ask_minutes: int,
    current_role_proof: CurrentRoleProof | None = None,
) -> tuple[dict[str, str], int]:
    del anchors
    person_id = str(_value(row, "person_id"))
    affinity = Affinity(
        person_id, str(_value(row, "campaign_id", "")), int(_value(row, "score", 0)),
        _signals(_value(row, "signals_json", "[]")), str(_value(row, "fit_spec_hash", "")),
    )
    inventory = slot_inventory(template)
    required_evidence = tuple(
        BINDING_MAP[name] for name in inventory if name in BINDING_MAP
    )
    facts = resolve_slot_facts(
        connection, person_id, affinity, str(_value(row, "company_id")),
        required_slots=required_evidence,
        current_role_proof=current_role_proof,
    )
    firm = facts.firm
    transition_from = facts.values.get("transition_from", "")
    employer = facts.values.get("why_them", "")
    transition_to = facts.values.get("transition_to", "")
    values = {
        "first_name": str(_value(row, "first_name")),
        "firm": firm,
        "firm_short": _firm_short(firm),
        "their_role": str(_value(row, "title")),
        "firm_specific_hook": facts.values.get("topic", ""),
        "shared_signal_sentence": f"Your {employer} experience caught my attention.",
        "recipient_hook": facts.values.get("recipient_hook", ""),
        "transition_from": transition_from,
        "transition_to": transition_to,
        "sender_intro": sender_focus,
        "sender_proof": sender_proof,
        "ask_minutes": str(ask_minutes),
        "ask_mode": "informational conversation",
        "time_window": "two weeks",
        "signature": sender_name,
    }
    if "shared_school" in inventory:
        if "school" not in facts.values:
            raise ValueError("evidence_school_missing")
        values["shared_school"] = facts.values["school"]
    if "new_fact_sentence" in inventory:
        if "new_fact_sentence" not in facts.values:
            raise ValueError("evidence_new_fact_sentence_missing")
        values["new_fact_sentence"] = facts.values["new_fact_sentence"]
    rendered, count = clamp_slot_values({name: values[name] for name in inventory})
    return rendered, count


def _subject_from_transition(value: str) -> str:
    kind = value.partition(" at ")[0].strip()
    return SUBJECT_FROM_KIND.get(kind, KIND_PHRASES.get(kind, kind or "earlier work"))[:14]


def _slot_values(
    connection,
    row: object,
    template: Template,
    anchors,
    *,
    sender_name: str,
    sender_focus: str,
    sender_proof: str,
    ask_minutes: int,
) -> dict[str, str]:
    """Return rendered slot values while preserving the original helper contract."""
    return _slot_values_with_clamp_count(
        connection, row, template, anchors,
        sender_name=sender_name, sender_focus=sender_focus,
        sender_proof=sender_proof, ask_minutes=ask_minutes,
    )[0]


def fit_subject(candidates: tuple[str, ...], low: int = 36, high: int = 50) -> str:
    """Return the first band-legal subject; callers provide a guaranteed generic floor last."""
    return next((value for value in candidates if low <= len(value) <= high), candidates[-1])


def subject_candidates(template_id: str, values: Mapping[str, str]) -> tuple[str, ...]:
    """Ordered evidence-bound subjects, followed by the thread-safe generic floor."""
    floor = GENERIC_SUBJECTS[template_id]
    if template_id == "follow_up_de_escalation":
        return (floor,)
    if template_id == "asset_management_referral":
        words = values.get("shared_school", "").split()[:2]
        school_short = " ".join(words)
        if len(school_short) > 22:
            school_short = words[0] if len(words[0]) <= 22 else ""
        if not school_short:
            return (floor,)
        candidates = (
            f"Question on {school_short} career path",
            f"{school_short} career path question",
        )
        return tuple(candidate for candidate in candidates if 36 <= len(candidate) <= 50) + (floor,)
    kind = values.get("from_kind", "earlier work")[:14]
    return (
        f"Question on the {kind} career transition",
        f"A note on your {kind} career transition",
        floor,
    )


def _bindings(
    template: Template,
    values: Mapping[str, str],
    evidence_ids: Mapping[str, str],
    ask: str | None = None,
    sender_profile_ref: str = "sender_profile",
) -> Mapping[str, SlotBinding]:
    bindings: dict[str, SlotBinding] = {}
    for template_slot, binding_name in BINDING_MAP.items():
        if template_slot in values:
            bindings[binding_name] = SlotBinding(values[template_slot], "evidence", evidence_ids[binding_name])
    if "sender_intro" in values and "sender_proof" in values:
        bindings["sender_proof"] = SlotBinding(
            f"{values['sender_intro']} {values['sender_proof']}",
            "sender", sender_profile_ref,
        )
    if ask is not None:
        bindings["ask"] = SlotBinding(ask, "policy", "policy.ask")
    return MappingProxyType(bindings)


def _prior_ids(connection, person_id: str, campaign_id: str) -> frozenset[str]:
    rows = connection.execute(
        "SELECT evidence_ids FROM revision WHERE person_id=? AND campaign_id=? AND step < 1",
        (person_id, campaign_id),
    ).fetchall()
    ids: set[str] = set()
    for row in rows:
        try:
            values = json.loads(str(_value(row, "evidence_ids")))
        except json.JSONDecodeError:
            continue
        if isinstance(values, list):
            ids.update(str(value) for value in values)
    return frozenset(ids)


def _required_sender_field(value: object) -> str:
    if type(value) is not str or not value.strip() or "\x00" in value:
        raise DraftError("sender_profile_invalid")
    return value.strip()


def _approved_fit(connection, campaign_id: str, policy: Mapping[str, object]) -> tuple[str, int]:
    fit_hash = policy.get("fit_spec_hash")
    if (
        type(fit_hash) is not str or len(fit_hash) != 64
        or any(character not in "0123456789abcdef" for character in fit_hash)
    ):
        raise DraftError("approved_fit_spec_missing")
    row = connection.execute(
        """SELECT fit_spec_json FROM campaign_fit_spec
            WHERE campaign_id=? AND fit_spec_hash=? AND state='approved'""",
        (campaign_id, fit_hash),
    ).fetchone()
    if row is None:
        raise DraftError("approved_fit_spec_missing")
    try:
        fit_spec = validate_fit_spec(json.loads(str(_value(row, "fit_spec_json"))))
        minimum = fit_spec["min_fit"]
    except (FitSpecError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise DraftError("approved_fit_spec_invalid") from error
    if fit_spec_hash(fit_spec) != fit_hash:
        raise DraftError("approved_fit_spec_invalid")
    return fit_hash, minimum


def _candidate_blocker(
    row: object, fit_hash: str, minimum_fit: int, *, allow_missing_contact: bool = False,
) -> str | None:
    if _value(row, "fill_status") is None or (
        _value(row, "fill_status") == "no_confident_email" and not allow_missing_contact
    ):
        return "fill_firm_unready"
    if _value(row, "employment_id") is None:
        return "current_employment_missing"
    if _value(row, "score") is None:
        return "affinity_missing"
    if _value(row, "fit_spec_hash") != fit_hash:
        return "affinity_fit_spec_stale"
    if int(_value(row, "score")) < minimum_fit:
        return "affinity_below_minimum"
    if _value(row, "contact_id") is None and not allow_missing_contact:
        return "confident_current_contact_missing"
    if bool(_value(row, "fit_veto_active")):
        return "fit_veto_active"
    if bool(_value(row, "suppression_active")):
        return "suppression_active"
    return None


def _draft_campaign(connection, campaign_id: str, step: int, *, anchors, now: datetime,
                    model_version: str = "none", proof_pending: bool = False) -> DraftSummary:
    """Draft one P8-owned revision per delivered candidate at the requested step."""
    if step not in {0, 1, 2}:
        raise DraftError("step_invalid")
    if now.tzinfo is None or now.utcoffset() is None:
        raise DraftError("aware_now_required")
    if model_version != "none":
        raise DraftError("model_version_unsupported")
    if anchors is None:
        raise DraftError("sender_anchors_missing")
    campaign = connection.execute(
        """SELECT campaign.intent,campaign.policy_json,campaign.ask_type,
                  campaign.ask_minutes,campaign.sender_profile_id,campaign.status,
                  sender.sender_name,sender.sender_focus,sender.sender_operating_proof
             FROM campaign
             LEFT JOIN sender_profile AS sender
               ON sender.sender_profile_id=campaign.sender_profile_id
            WHERE campaign.campaign_id=?""",
        (campaign_id,),
    ).fetchone()
    if campaign is None:
        raise DraftError("unknown_campaign")
    if _value(campaign, "status") != "draft":
        raise DraftError("campaign_not_draft")
    campaign_intent = _value(campaign, "intent")
    if campaign_intent not in SUPPORTED_INTENTS:
        raise DraftError("intent_unsupported")
    try:
        policy_json = json.loads(str(_value(campaign, "policy_json")))
        copy_profile = policy_json["copy_profile"]
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise DraftError("copy_profile_missing") from error
    if not isinstance(copy_profile, Mapping):
        raise DraftError("copy_profile_missing")
    try:
        subject_band = _band(copy_profile.get("subject_chars"), "subject_chars")
        body_band = _band(copy_profile.get("body_words"), "body_words")
    except ValueError as error:
        raise DraftError("copy_profile_invalid") from error
    fit_hash, minimum_fit = _approved_fit(connection, campaign_id, policy_json)
    if _value(campaign, "ask_type") != "informational_call":
        raise DraftError("ask_type_unsupported")
    ask_minutes = _value(campaign, "ask_minutes")
    if isinstance(ask_minutes, bool) or not isinstance(ask_minutes, int) or not 10 <= ask_minutes <= 20:
        raise DraftError("ask_minutes_unsupported")
    sender_profile_id = _required_sender_field(_value(campaign, "sender_profile_id"))
    sender_name = _required_sender_field(_value(campaign, "sender_name"))
    sender_focus = _required_sender_field(_value(campaign, "sender_focus"))
    sender_proof = _required_sender_field(_value(campaign, "sender_operating_proof"))
    registry = load_registry_v2()
    rows = connection.execute(
        """SELECT fill.person_id,person.first_name,company.company_id,company.name AS firm,
                  fill.campaign_id,employment.employment_id,employment.title,firm_fill.status AS fill_status,
                  background.current_kind,affinity.score,affinity.signals_json,
                  affinity.fit_spec_hash,cp.contact_id,cp.email,
                  EXISTS(SELECT 1 FROM fit_veto AS veto
                          WHERE veto.person_id=fill.person_id
                            AND veto.campaign_id=fill.campaign_id AND veto.active=1) AS fit_veto_active,
                  EXISTS(SELECT 1 FROM suppression AS stopped
                          WHERE stopped.released_at IS NULL AND (
                            stopped.scope='global'
                            OR (stopped.scope='person' AND stopped.subject_key=fill.person_id)
                            OR (stopped.scope='company' AND stopped.subject_key=fill.company_id)
                            OR (stopped.scope='campaign' AND stopped.subject_key=fill.campaign_id)
                            OR (stopped.scope='email' AND EXISTS(
                              SELECT 1 FROM contact_point AS stopped_contact
                               WHERE stopped_contact.person_id=fill.person_id
                                 AND stopped_contact.employer_company_id=fill.company_id
                                 AND lower(trim(stopped.subject_key))=
                                     lower(trim(stopped_contact.email))
                            ))
                          )) AS suppression_active
             FROM fill_person AS fill
             JOIN person ON person.person_id=fill.person_id
             JOIN company ON company.company_id=fill.company_id
             LEFT JOIN fill_firm AS firm_fill ON firm_fill.campaign_id=fill.campaign_id
               AND firm_fill.company_id=fill.company_id
             LEFT JOIN employment ON employment.employment_id=(
               SELECT current.employment_id FROM employment AS current
                WHERE current.person_id=fill.person_id AND current.company_id=fill.company_id
                  AND current.valid_to IS NULL
                ORDER BY COALESCE(current.valid_from,'' ) DESC,current.employment_id DESC LIMIT 1
             )
             LEFT JOIN person_affinity AS affinity ON affinity.person_id=fill.person_id
               AND affinity.campaign_id=fill.campaign_id
             LEFT JOIN contact_point AS cp ON cp.contact_id=(
               SELECT contact.contact_id FROM contact_point AS contact
                WHERE contact.person_id=fill.person_id
                  AND contact.employer_company_id=fill.company_id
                  AND contact.state='valid' AND contact.confidence>=0.7
                ORDER BY COALESCE(contact.verified_at,contact.retrieved_at,'' ) DESC,
                         contact.contact_id DESC LIMIT 1
             )
             LEFT JOIN person_background AS background ON background.person_id=person.person_id
            WHERE fill.campaign_id=? AND fill.substituted=0
            ORDER BY fill.person_id""", (campaign_id,),
    ).fetchall()
    failures: Counter[str] = Counter()
    created = out_of_band = qa_failed = slots_clamped = 0
    for row in rows:
        blocker = _candidate_blocker(
            row, fit_hash, minimum_fit, allow_missing_contact=proof_pending,
        )
        if blocker is not None:
            qa_failed += 1
            failures[blocker] += 1
            continue
        person_id = str(_value(row, "person_id"))
        current_proof: CurrentRoleProof | None = None
        if proof_pending:
            try:
                current_proof = current_role_source_proof(
                    connection, campaign_id, person_id, now,
                )
            except ValueError as error:
                qa_failed += 1
                failures[str(error)] += 1
                continue
        template_id = _family(str(campaign_intent), step, row, registry)
        template = registry[template_id]
        savepoint = False
        try:
            values, clamped = _slot_values_with_clamp_count(
                connection, row, template, anchors,
                sender_name=sender_name, sender_focus=sender_focus,
                sender_proof=sender_proof, ask_minutes=ask_minutes,
                current_role_proof=current_proof,
            )
            slots_clamped += clamped
            _template_subject, body = render(template, values)
            subject_values = dict(values)
            subject_values["from_kind"] = _subject_from_transition(
                values.get("transition_from", ""),
            )
            subject = fit_subject(
                subject_candidates(template.template_id, subject_values), *subject_band,
            )
            bands = check_bands(subject, body, copy_profile)
            if bands:
                out_of_band += 1
                failures.update(bands)
                continue
            slots = {BINDING_MAP[name]: value for name, value in values.items() if name in BINDING_MAP}
            affinity = Affinity(person_id, campaign_id, int(_value(row, "score")), _signals(_value(row, "signals_json")), str(_value(row, "fit_spec_hash")))
            connection.execute("SAVEPOINT p8_revision_context")
            savepoint = True
            evidence_ids = mint_evidence(
                connection, person_id, campaign_id, affinity, slots, now,
                selected_company_id=str(_value(row, "company_id")),
                current_role_proof=current_proof,
            )
            ask = ask_sentence(body)
            bindings = _bindings(
                template, values, evidence_ids, ask,
                sender_profile_ref=f"sender_profile:{sender_profile_id}",
            )
            prior = _prior_ids(connection, person_id, campaign_id) if step else frozenset()
            policy = QaPolicy(
                str(campaign_intent), step, "informational_call",
                *body_band, 0.7, prior,
            )
            result = qa.validate_revision(
                subject, body, ask, bindings,
                list_evidence(connection, person_id, now), policy, person_id, campaign_id, now,
            )
            if result.failure_codes:
                connection.execute("ROLLBACK TO p8_revision_context")
                connection.execute("RELEASE p8_revision_context")
                savepoint = False
                qa_failed += 1
                failures.update(result.failure_codes)
                continue
            record = build_revision(connection, RevisionInput(
                person_id, campaign_id, step, subject, body,
                "follow_up_value" if step else "why_them", "bespoke", None, ask,
                tuple(sorted(evidence_ids.values())),
                tuple(sorted(
                    binding.value for name, binding in bindings.items()
                    if name in qa.RECIPIENT_SLOTS
                )),
                (values["sender_proof"],), template.template_id, template.template_version,
                "affinity-v2", model_version, result,
            ))
            if record.created:
                record_revision_qa_context(
                    connection, record.revision_id, bindings, policy,
                    inherited_from_revision_id=None,
                    created_at=now.astimezone(timezone.utc).isoformat(),
                )
            else:
                require_revision_qa_context(
                    connection, record.revision_id, bindings, policy,
                    inherited_from_revision_id=None,
                )
            created += int(record.created)
        except (TemplateError, ValueError) as error:
            if savepoint:
                connection.execute("ROLLBACK TO p8_revision_context")
                connection.execute("RELEASE p8_revision_context")
            qa_failed += 1
            failures[str(error)] += 1
        except BaseException:
            if savepoint:
                connection.execute("ROLLBACK TO p8_revision_context")
                connection.execute("RELEASE p8_revision_context")
            raise
        else:
            if savepoint:
                connection.execute("RELEASE p8_revision_context")
    return DraftSummary(len(rows), created, out_of_band, qa_failed, slots_clamped, MappingProxyType(dict(sorted(failures.items()))))


def draft_campaign(
    connection, campaign_id: str, step: int, *, anchors, now: datetime,
    model_version: str = "none",
) -> DraftSummary:
    return _draft_campaign(
        connection, campaign_id, step, anchors=anchors, now=now,
        model_version=model_version,
    )


def draft_step_zero_proof_pending(
    connection, campaign_id: str, *, anchors, now: datetime,
    model_version: str = "none",
) -> DraftSummary:
    """Prepare local step-0 copy from exact imported role proof without P13.

    Template selection remains governed by the campaign intent and saved affinity.
    The narrower proof mode changes identity-source and contact prerequisites only.
    """
    return _draft_campaign(
        connection, campaign_id, 0, anchors=anchors, now=now,
        model_version=model_version, proof_pending=True,
    )
