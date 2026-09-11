from datetime import UTC, datetime

import pytest

from scripts.prospecting.personalizer.evidence import EvidenceRecord
from scripts.prospecting.personalizer.qa import QaPolicy, SlotBinding, validate_revision


NOW = datetime(2026, 9, 3, tzinfo=UTC)
BODY = """Hi Avery,

Your move into operations at Example Robotics is relevant to how I am thinking about operating careers. I am exploring how strong teams make this work effective in practice. I have experience evaluating businesses and working on operating problems. I would value your perspective on the choices that shaped your path and what you would focus on when learning the field today. Would you have 15 minutes for an informational conversation?

Daniel"""


def evidence(**changes: object) -> EvidenceRecord:
    values: dict[str, object] = {
        "evidence_id": "ev-1", "person_id": "person-1",
        "claim": "Avery moved into operations at Example Robotics", "url": "https://example.test/profile",
        "observed_at": "2026-08-20", "retrieved_at": "2026-09-01T00:00:00Z",
        "excerpt": "moved into operations", "confidence": 0.95,
        "expires_at": "2026-10-01T00:00:00Z", "allowed_for_copy": True,
    }
    values.update(changes)
    return EvidenceRecord(**values)


def bindings(**changes: SlotBinding) -> dict[str, SlotBinding]:
    values = {
        "first_name": SlotBinding("Avery", "evidence", "ev-1"),
        "company": SlotBinding("Example Robotics", "evidence", "ev-1"),
        "why_them": SlotBinding("Your move into operations at Example Robotics is relevant to how I am thinking about operating careers.", "evidence", "ev-1"),
        "sender_proof": SlotBinding("I have experience evaluating businesses and working on operating problems.", "sender", "sender.sender_operating_proof"),
        "ask": SlotBinding("Would you have 15 minutes for an informational conversation?", "policy", "policy.ask"),
        "signature": SlotBinding("Daniel", "sender", "sender.sender_name"),
    }
    values.update(changes)
    return values


def policy(**changes: object) -> QaPolicy:
    values: dict[str, object] = {
        "intent": "networking", "step": 0, "ask_type": "informational_call",
        "minimum_words": 60, "maximum_words": 120, "minimum_confidence": 0.8,
    }
    values.update(changes)
    return QaPolicy(**values)


def result(body: str = BODY, ask: str = "Would you have 15 minutes for an informational conversation?", slot_bindings=None, items=None, qa_policy=None):
    return validate_revision(
        "A question about Example Robotics", body,
        ask,
        slot_bindings or bindings(), tuple(items or [evidence()]), qa_policy or policy(),
        "person-1", "campaign-1", NOW,
    )


def test_valid_revision_passes() -> None:
    assert result().passed


@pytest.mark.parametrize(
    ("binding", "code"),
    [
        (SlotBinding("claim", "evidence", "missing"), "evidence_missing"),
        (SlotBinding("claim", "other", "x"), "slot_source_invalid"),
    ],
)
def test_slot_source_failures(binding: SlotBinding, code: str, record_property) -> None:
    assert code in result(slot_bindings=bindings(why_them=binding)).failure_codes
    if code == "evidence_missing":
        record_property("unsourced_slot_rejections", 1)


@pytest.mark.parametrize(
    ("item", "code"),
    [
        (evidence(person_id="person-2"), "evidence_person_mismatch"),
        (evidence(expires_at="2026-09-02T00:00:00Z"), "evidence_expired"),
        (evidence(allowed_for_copy=False), "evidence_copy_disallowed"),
        (evidence(confidence=0.7), "evidence_confidence_low"),
    ],
)
def test_evidence_failures(item: EvidenceRecord, code: str) -> None:
    assert code in result(items=[item]).failure_codes


def test_non_entailing_evidence_fails() -> None:
    changed = bindings(
        why_them=SlotBinding("You won an unrelated industry award.", "evidence", "ev-1")
    )
    assert "evidence_not_entailing" in result(slot_bindings=changed).failure_codes


def test_bound_slot_value_must_appear_in_rendered_copy() -> None:
    changed = bindings(company=SlotBinding("Different Company", "evidence", "ev-1"))
    assert "slot_value_missing" in result(slot_bindings=changed).failure_codes


def test_short_body_fails() -> None:
    assert "word_count" in result("Hi Avery,\n\nWould you have 15 minutes for an informational conversation?\n\nDaniel").failure_codes


def test_long_body_fails() -> None:
    long_body = "Hi Avery,\n\n" + "word " * 121 + "?\n\nDaniel"
    assert "word_count" in result(long_body).failure_codes


def test_two_questions_fail() -> None:
    assert "extra_question" in result(BODY.replace("today.", "today?", 1)).failure_codes


def test_ask_without_question_mark_fails() -> None:
    ask = "Would you have 15 minutes for an informational conversation"
    body = BODY.replace(f"{ask}?", f"{ask}.")
    checked = result(body, ask, slot_bindings=bindings(ask=SlotBinding(ask, "policy", "policy.ask")))
    assert "ask_count" in checked.failure_codes


def test_exactly_one_ask_question_passes() -> None:
    assert result().passed


def test_ask_must_match_body() -> None:
    assert "ask_mismatch" in validate_revision(
        "Subject", BODY, "Could we speak for 10 minutes?", bindings(), (evidence(),), policy(),
        "person-1", "campaign-1", NOW,
    ).failure_codes


def test_wrong_ask_type_fails() -> None:
    changed_ask = "Can you refer me for a job?"
    altered = BODY.replace("Would you have 15 minutes for an informational conversation?", changed_ask)
    assert "ask_type" in result(altered, changed_ask, slot_bindings=bindings(ask=SlotBinding(changed_ask, "policy", "policy.ask"))).failure_codes


def test_first_touch_referral_fails() -> None:
    changed_ask = "Would you have 15 minutes for a referral conversation?"
    altered = BODY.replace("Would you have 15 minutes for an informational conversation?", changed_ask)
    assert "first_touch_referral" in result(altered, changed_ask, slot_bindings=bindings(ask=SlotBinding(changed_ask, "policy", "policy.ask"))).failure_codes


@pytest.mark.parametrize(
    "referral_request",
    ["refer me", "referral", "refers", "referred", "intro me", "introduce me", "put me in touch"],
)
def test_first_touch_referral_language_fails(referral_request: str) -> None:
    changed_ask = f"Would you {referral_request} for an informational conversation?"
    altered = BODY.replace("Would you have 15 minutes for an informational conversation?", changed_ask)
    checked = result(altered, changed_ask, slot_bindings=bindings(ask=SlotBinding(changed_ask, "policy", "policy.ask")))
    assert "first_touch_referral" in checked.failure_codes


@pytest.mark.parametrize("minutes", [10, 11, 19, 20])
def test_every_duration_inside_policy_range_passes(minutes: int) -> None:
    ask = f"Would you have {minutes} minutes for an informational conversation?"
    body = BODY.replace("15 minutes", f"{minutes} minutes")
    checked = result(body, ask, slot_bindings=bindings(ask=SlotBinding(ask, "policy", "policy.ask")))
    assert checked.passed


@pytest.mark.parametrize("minutes", [9, 21])
def test_duration_outside_policy_range_fails(minutes: int) -> None:
    ask = f"Would you have {minutes} minutes for an informational conversation?"
    body = BODY.replace("15 minutes", f"{minutes} minutes")
    checked = result(body, ask, slot_bindings=bindings(ask=SlotBinding(ask, "policy", "policy.ask")))
    assert "ask_duration" in checked.failure_codes


@pytest.mark.parametrize("step", [-1, 3])
def test_step_outside_schema_range_fails(step: int) -> None:
    assert "step_invalid" in result(qa_policy=policy(step=step)).failure_codes


@pytest.mark.parametrize("unsafe", ["https://example.test", "see the link", "see the links", "attached resume", "see attachments", "tracking pixel"])
def test_link_or_attachment_language_fails(unsafe: str) -> None:
    assert "plain_text_only" in result(BODY.replace("operating careers", unsafe)).failure_codes


@pytest.mark.parametrize("term", ["race", "religion", "disability", "pregnant", "sexual orientation", "political affiliation"])
def test_sensitive_inference_fails(term: str) -> None:
    assert "sensitive_inference" in result(BODY.replace("operating careers", term)).failure_codes


def test_follow_up_without_new_value_fails() -> None:
    follow_up_policy = policy(step=2, prior_evidence_ids=frozenset({"ev-1"}))
    assert "follow_up_value" in result(BODY.replace("Your move into operations", "Just checking in about operations"), qa_policy=follow_up_policy).failure_codes


def test_step_one_follow_up_without_new_value_fails() -> None:
    follow_up_policy = policy(step=1, prior_evidence_ids=frozenset({"ev-1"}))
    assert "follow_up_value" in result(qa_policy=follow_up_policy).failure_codes


def test_follow_up_with_new_evidence_passes() -> None:
    follow_up_policy = policy(step=2, prior_evidence_ids=frozenset({"ev-old"}))
    assert result(qa_policy=follow_up_policy).passed


def test_sender_ratio_fails_above_one_to_three() -> None:
    extra = bindings(sender_two=SlotBinding("More sender proof", "sender", "sender.approved_metrics.0"))
    assert "recipient_sender_ratio" in result(slot_bindings=extra).failure_codes


def test_zero_sender_proof_passes_ratio() -> None:
    no_sender = {key: value for key, value in bindings().items() if key != "sender_proof"}
    no_sender_body = BODY.replace(
        "I have experience evaluating businesses and working on operating problems.",
        "I would also value context on the practical tradeoffs and lessons involved.",
    )
    assert result(no_sender_body, slot_bindings=no_sender).passed


def test_empty_campaign_binding_fails() -> None:
    checked = validate_revision(
        "A question about Example Robotics", BODY,
        "Would you have 15 minutes for an informational conversation?",
        bindings(), (evidence(),), policy(), "person-1", "", NOW,
    )
    assert "campaign_missing" in checked.failure_codes


def test_whitespace_only_campaign_binding_fails() -> None:
    checked = validate_revision(
        "A question about Example Robotics", BODY,
        "Would you have 15 minutes for an informational conversation?",
        bindings(), (evidence(),), policy(), "person-1", "  ", NOW,
    )
    assert "campaign_missing" in checked.failure_codes


def test_score_is_zero_to_one_hundred_and_thresholded() -> None:
    checked = result()
    assert checked.qa_score == 100 and 0 <= checked.qa_score <= 100


@pytest.mark.parametrize("alias", ["signature", "sender_name", "sign_off"])
@pytest.mark.parametrize(
    "ref",
    ["sender.sender_name", "sender_profile.sender_name", "sender.signature"],
)
def test_identity_sender_name_binding_is_alias_independent_and_unpenalized(
    alias: str, ref: str,
) -> None:
    values = {key: value for key, value in bindings().items() if key != "signature"}
    values[alias] = SlotBinding("Daniel", "sender", ref)

    assert result(slot_bindings=values).passed


@pytest.mark.parametrize(
    "ref",
    [
        "sender_profile.sender_name ", " sender.sender_name",
        "Sender.sender_name", "SENDER_PROFILE.SENDER_NAME",
        "x.sender_name", "sender_name", "sender.sender_name.suffix",
        "sender.signature ", " sender.signature",
        "Sender.signature", "SENDER.SIGNATURE",
        "x.signature", "signature", "sender.signature.suffix",
    ],
)
def test_non_exact_sender_name_ref_variants_count_as_substantive(ref: str) -> None:
    """Only the three exact authoritative identity refs are excluded; every
    malformed, prefixed, cased, or whitespace-padded variant of
    ``sender_name``/``signature`` still consumes recipient-relative ratio
    budget."""
    values = {key: value for key, value in bindings().items() if key != "signature"}
    values["signature"] = SlotBinding("Daniel", "sender", ref)

    assert "recipient_sender_ratio" in result(slot_bindings=values).failure_codes


def test_substantive_sender_proof_counts_under_any_slot_alias() -> None:
    proof = bindings()["sender_proof"]
    values = {key: value for key, value in bindings().items() if key != "sender_proof"}
    values["signature_block"] = SlotBinding(proof.value, "sender", proof.source_ref)

    assert result(slot_bindings=values).passed

    values["closing_note"] = SlotBinding(
        "I would value your perspective on the choices that shaped your path",
        "sender", "sender_profile.sender_background",
    )

    assert "recipient_sender_ratio" in result(slot_bindings=values).failure_codes


def test_duplicate_sender_aliases_of_one_claim_count_once() -> None:
    proof = bindings()["sender_proof"]
    values = bindings()
    values["sender_proof_again"] = SlotBinding(proof.value, "sender", proof.source_ref)

    assert result(slot_bindings=values).passed


def test_duplicate_recipient_aliases_cannot_manufacture_ratio_credit() -> None:
    values = bindings()
    company = values["company"]
    for alias in ("role", "topic", "school", "recipient_hook"):
        values[alias] = SlotBinding(company.value, "evidence", company.source_ref)
    values["sender_two"] = SlotBinding(
        "I would value your perspective on the choices that shaped your path",
        "sender", "sender_profile.sender_background",
    )

    checked = result(slot_bindings=values)

    assert "recipient_sender_ratio" in checked.failure_codes
