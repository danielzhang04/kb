"""Synthetic coverage for P8's v2 template families and copy bands."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
import json
from pathlib import Path

import pytest

import scripts.prospecting.affinity.templates_v2 as templates_module
from scripts.prospecting.affinity.fitspec import canonical_bytes, fit_spec_hash, validate_fit_spec
from scripts.prospecting.affinity.templates_v2 import (
    DraftError, _clamp, ask_sentence, check_bands, clamp_slot_values, draft_campaign,
    draft_step_zero_proof_pending, fit_subject, load_registry_v2, subject_candidates,
)
from scripts.prospecting.affinity.evidence_bridge import current_role_source_proof
from scripts.prospecting.affinity.source_review import import_operator_page
from scripts.prospecting.personalizer.evidence import EvidenceRecord
from scripts.prospecting.personalizer.qa import QaPolicy, SlotBinding, _body_word_count, validate_revision
from scripts.prospecting.personalizer.templates import load_registry, render, slot_inventory


EXPECTED_IDS = {
    "startup_ops_corporate", "startup_ops_noncorporate", "startup_nonops",
    "startup_role_application", "vc_networking", "vc_parttime", "pe_networking",
    "asset_management_referral", "consulting_networking", "curiosity_thesis",
    "follow_up_de_escalation", "startup_current_role_hook",
}
COPY_PROFILE_DEFAULT = {"body_words": [75, 125], "subject_chars": [36, 50]}
NOW = datetime(2099, 12, 30, tzinfo=UTC)
REVIEW_FIXTURE = json.loads(
    (Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures" / "review-synthetic.json")
    .read_text(encoding="utf-8")
)["affinity_templates_v2"]
PERSON = "per_0000000000000001"
CAMPAIGN = "camp_0000000000000001"
FLOOR_SLOT_VALUES = {
    "first_name": "Al", "firm": "Thrive", "their_role": "Partner",
    "firm_specific_hook": "the work at Thrive",
    "recipient_hook": "Your Partner work at Thrive caught my attention.",
    "shared_signal_sentence": "Your earlier work experience caught my attention.",
    "transition_from": "an earlier role", "transition_to": "venture investing at Thrive",
    "sender_intro": "I am exploring a similar career path.",
    "sender_proof": "I have built a focused research project.",
    "shared_school": "shared academic path",
    "new_fact_sentence": "your recent work at Thrive added useful context",
    "ask_minutes": "20", "ask_mode": "informational conversation",
    "time_window": "two weeks", "signature": "Al",
}
CEILING_SLOT_VALUES = dict(FLOOR_SLOT_VALUES,
    firm="Bessemer Venture Partners",
    their_role="Vice President of Platform and Portfolio Operations",
    firm_specific_hook="Practical platform support helps founders build customer operations through measured experiments, valuable partnerships, and patient guidance across each stage.",
    transition_from="consulting at McKinsey & Company Incorporated",
    transition_to="venture investing at Bessemer Venture Partners",
)
VALUES = FLOOR_SLOT_VALUES


def _slot_values(template):
    return {name: VALUES[name] for name in slot_inventory(template)}


def _bindings(template, values):
    evidence = {}
    bindings = {}
    mapping = {
        "first_name": "first_name", "firm": "company", "their_role": "role",
        "firm_specific_hook": "topic", "shared_school": "school",
        "shared_signal_sentence": "why_them", "transition_from": "transition_from",
        "transition_to": "transition_to", "new_fact_sentence": "new_fact_sentence",
        "recipient_hook": "recipient_hook",
    }
    for slot, name in mapping.items():
        if slot not in values:
            continue
        evidence_id = f"evidence-{name}"
        evidence[evidence_id] = EvidenceRecord(
            evidence_id, PERSON, f"{values[slot]} verified fact", "https://affinity.test/evidence",
            "2099-12-01T00:00:00Z", "2099-12-01T00:00:00Z", "synthetic excerpt", 0.9,
            "2100-01-01T00:00:00Z", True,
        )
        bindings[name] = SlotBinding(values[slot], "evidence", evidence_id)
    bindings["sender_proof"] = SlotBinding(
        f"{values['sender_intro']} {values['sender_proof']}", "sender", "sender_profile",
    )
    return bindings, tuple(evidence.values())


PRIOR_IDS = frozenset(_bindings(load_registry_v2()["vc_networking"], _slot_values(load_registry_v2()["vc_networking"]))[0][name].source_ref for name in ("first_name", "company", "role", "topic", "why_them", "transition_from", "transition_to"))


@pytest.mark.parametrize("template_id", sorted(EXPECTED_IDS))
def test_every_family_renders_and_passes_qa(template_id, record_property) -> None:
    template = load_registry_v2()[template_id]
    values, _clamped = clamp_slot_values(_slot_values(template))
    subject, body = render(template, values)
    assert check_bands(subject, body, COPY_PROFILE_DEFAULT) == ()
    assert 36 <= len(subject) <= 50
    assert 75 <= _body_word_count(body) <= 125
    bindings, evidence = _bindings(template, values)
    if "shared_signal_sentence" in values:
        assert bindings["why_them"].value == values["shared_signal_sentence"]
    else:
        assert bindings["recipient_hook"].value == values["recipient_hook"]
    step = int(template_id == "follow_up_de_escalation")
    result = validate_revision(
        subject, body, ask_sentence(body), bindings, evidence,
        QaPolicy(template.intent, step, "informational_call", 75, 125, 0.7, PRIOR_IDS if step else frozenset()),
        PERSON, CAMPAIGN, NOW,
    )
    assert result.failure_codes == ()
    record_property("body_words_out_of_band", 0)
    record_property("subject_chars_out_of_band", 0)


@pytest.mark.parametrize("template_id", sorted(EXPECTED_IDS))
@pytest.mark.parametrize("values", (FLOOR_SLOT_VALUES, CEILING_SLOT_VALUES))
def test_all_template_bodies_stay_in_band_at_slot_extremes(template_id, values) -> None:
    template = load_registry_v2()[template_id]
    if values is CEILING_SLOT_VALUES:
        assert len(values["firm_specific_hook"]) == 160
    rendered_values, clamped = clamp_slot_values({name: values[name] for name in slot_inventory(template)})
    subject, body = render(template, rendered_values)
    assert 36 <= len(subject) <= 50
    assert 75 <= _body_word_count(body) <= 125
    if values is CEILING_SLOT_VALUES:
        assert 0 < clamped <= len({"firm_specific_hook", "shared_signal_sentence", "sender_intro", "sender_proof", "their_role"} & set(rendered_values))


def test_slot_clamps_truncate_at_a_word_boundary_and_drop_trailing_punctuation() -> None:
    value, clamped = _clamp("one two three four five!", 4)
    assert (value, clamped) == ("one two three four", True)


@pytest.mark.parametrize("template_id", sorted(EXPECTED_IDS))
@pytest.mark.parametrize("values", (
    {"from_kind": "banking", "shared_school": "Newtown University"},
    {"from_kind": "private equity", "shared_school": "International Institute"},
))
def test_subject_candidates_choose_the_first_band_legal_evidence_bound_value(template_id, values) -> None:
    candidates = subject_candidates(template_id, values)
    assert all(36 <= len(candidate) <= 50 for candidate in candidates)
    assert fit_subject(candidates) == candidates[0]


def test_school_subjects_keep_whole_words_or_use_the_generic_floor() -> None:
    two_word = subject_candidates("asset_management_referral", {"shared_school": "Newtown University"})
    assert two_word[0] == "Question on Newtown University career path"
    long_first_word = subject_candidates("asset_management_referral", {"shared_school": "x" * 24})
    assert long_first_word == ("A grad's quick question on your path",)


def _valid_contact(connection, person_id: str) -> None:
    connection.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("cp_0000000000000001", person_id, "cmp_0000000000000001", REVIEW_FIXTURE["contact_email"],
         "manual", "fixture", "2099-12-01T00:00:00Z", None, "valid", 1.0, 0),
    )


def _approve_fixture_fit(connection, campaign_id: str, *, subject_high: int = 50,
                         body_low: int = 75) -> None:
    fixture = (
        templates_module.ROOT / "orgs" / "prospecting" / "fixtures" /
        "affinity" / "fit-specs.json"
    )
    fit_spec = validate_fit_spec(json.loads(fixture.read_text(encoding="utf-8"))["minimal"])
    fit_hash = fit_spec_hash(fit_spec)
    connection.execute(
        "UPDATE campaign SET policy_json=? WHERE campaign_id=?",
        (json.dumps({
            "fit_spec_hash": fit_hash,
            "copy_profile": {"body_words": [body_low, 125], "subject_chars": [36, subject_high]},
        }), campaign_id),
    )
    connection.execute(
        "INSERT INTO campaign_fit_spec VALUES(?,?,?,?,?,?,?)",
        (campaign_id, fit_hash, canonical_bytes(fit_spec).decode("utf-8"),
         "2099-12-01T00:00:00Z", "2099-12-02T00:00:00Z", "human:fixture", "approved"),
    )
    connection.execute(
        "UPDATE person_affinity SET fit_spec_hash=? WHERE campaign_id=?",
        (fit_hash, campaign_id),
    )


def _draft_ready_fixture(tmp_path, monkeypatch, *, subject_high: int = 50,
                         body_low: int = 75, scored_options=None):
    from scripts.prospecting.tests.test_affinity_evidence_bridge import _scored_person

    connection, person_id, campaign_id, _affinity = _scored_person(
        tmp_path, monkeypatch, **(scored_options or {}),
    )
    _approve_fixture_fit(
        connection, campaign_id, subject_high=subject_high, body_low=body_low,
    )
    connection.execute(
        "INSERT INTO fill_firm VALUES(?,?,?,?,?,?,?)",
        (campaign_id, "cmp_0000000000000001", 1, 1, "selected", None,
         "2099-12-01T00:00:00Z"),
    )
    connection.execute(
        "INSERT INTO fill_person VALUES(?,?,?,?,?)",
        (campaign_id, person_id, "cmp_0000000000000001", 0,
         "2099-12-01T00:00:00Z"),
    )
    _valid_contact(connection, person_id)
    return connection, person_id, campaign_id


def _import_current_role_proof(connection, person_id: str) -> str:
    connection.commit()
    snapshot_id = import_operator_page(
        connection,
        person_id=person_id,
        company_id="cmp_0000000000000001",
        source_url="https://proof.example.test/current-role",
        body=b"Morgan Synthetic is Operations Director at Test Capital.",
        now=NOW,
    )
    return snapshot_id


def test_every_family_has_a_typed_person_specific_recipient_slot() -> None:
    for template in load_registry_v2().values():
        slots = slot_inventory(template)
        assert "shared_signal_sentence" in slots or "recipient_hook" in slots, template.template_id


def test_the_follow_up_cites_an_id_outside_the_step_zero_set() -> None:
    template = load_registry_v2()["follow_up_de_escalation"]
    bindings, _evidence = _bindings(template, _slot_values(template))
    used = {binding.source_ref for binding in bindings.values() if binding.source_kind == "evidence"}
    assert used - PRIOR_IDS


def test_an_out_of_band_render_is_skipped_and_counted(tmp_path, monkeypatch) -> None:
    # The preceding task's fully synthetic evidence fixture supplies the P8 rows this
    # test needs; the tight subject band ensures drafting stops before minting evidence.
    connection, _person_id, campaign_id = _draft_ready_fixture(
        tmp_path, monkeypatch, subject_high=36,
    )
    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    assert summary.out_of_band == 1 and summary.revisions_created == 0
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0


def test_draft_campaign_creates_a_qa_checked_revision(tmp_path, monkeypatch) -> None:
    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    connection.execute(
        """UPDATE sender_profile
              SET sender_name=?,sender_focus=?,sender_operating_proof=?
            WHERE sender_profile_id='sender'""",
        ("Actual Sender", "I am focused on synthetic operations.",
         "I built a verified synthetic operating project."),
    )
    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    assert summary.revisions_created == 1 and summary.qa_failed == 0
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 1
    revision = connection.execute(
        "SELECT body,sender_proof_points FROM revision"
    ).fetchone()
    assert "15 minutes" in revision["body"] and "20 minutes" not in revision["body"]
    assert "I am focused on synthetic operations." in revision["body"]
    assert "I built a verified synthetic operating project." in revision["body"]
    assert "focused research project" not in revision["body"]
    assert revision["body"].rstrip().endswith("Actual Sender")
    assert json.loads(revision["sender_proof_points"]) == [
        "I built a verified synthetic operating project."
    ]


def test_proof_pending_draft_allows_missing_email_and_preserves_family_routing(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    snapshot_id = _import_current_role_proof(connection, person_id)
    connection.execute("DELETE FROM contact_point WHERE person_id=?", (person_id,))
    connection.execute(
        "UPDATE fill_firm SET status='no_confident_email' WHERE campaign_id=?",
        (campaign_id,),
    )
    connection.commit()

    blocked = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    assert blocked.failure_codes == {"fill_firm_unready": 1}
    summary = draft_step_zero_proof_pending(
        connection, campaign_id, anchors=object(), now=NOW,
    )

    assert summary.revisions_created == 1 and summary.failure_codes == {}
    revision = connection.execute(
        "SELECT revision_id,template_id FROM revision"
    ).fetchone()
    assert revision["template_id"] == "startup_ops_corporate"
    assert connection.execute(
        "SELECT count(*) FROM revision_qa_context WHERE revision_id=?",
        (revision["revision_id"],),
    ).fetchone()[0] == 1
    assert connection.execute(
        "SELECT count(*) FROM identity_source_review"
    ).fetchone()[0] == 0
    proof = current_role_source_proof(connection, campaign_id, person_id, NOW)
    assert proof.snapshot_id == snapshot_id and proof.attested is False
    assert connection.execute(
        "SELECT count(*) FROM evidence WHERE url=?",
        (proof.source_url,),
    ).fetchone()[0] >= 3


def test_proof_pending_draft_preserves_nonstartup_campaign_family(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(
        tmp_path, monkeypatch, body_low=60,
    )
    connection.execute(
        "UPDATE campaign SET intent='alumni' WHERE campaign_id=?", (campaign_id,),
    )
    _import_current_role_proof(connection, person_id)

    summary = draft_step_zero_proof_pending(
        connection, campaign_id, anchors=object(), now=NOW,
    )

    assert summary.revisions_created == 1 and summary.failure_codes == {}
    assert connection.execute("SELECT template_id FROM revision").fetchone()[0] == (
        "asset_management_referral"
    )


def test_proof_pending_draft_honors_email_suppression_on_an_unusable_contact(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    _import_current_role_proof(connection, person_id)
    email = connection.execute(
        "SELECT email FROM contact_point WHERE person_id=?", (person_id,),
    ).fetchone()[0]
    connection.execute("UPDATE contact_point SET state='invalid'")
    connection.execute("UPDATE fill_firm SET status='no_confident_email'")
    connection.execute(
        "INSERT INTO suppression VALUES(?,?,?,?,?,?,?,?)",
        ("email-stop", "email", email, "manual_dnc", "2099-12-01T00:00:00Z",
         "human:fixture", None, None),
    )
    connection.commit()

    summary = draft_step_zero_proof_pending(
        connection, campaign_id, anchors=object(), now=NOW,
    )

    assert summary.failure_codes == {"suppression_active": 1}
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0


@pytest.mark.parametrize(
    "mutation,code",
    [
        ("changed_role", "current_role_proof_invalid"),
        ("wrong_scope", "current_role_proof_missing"),
        ("stale", "current_role_proof_invalid"),
        ("tampered", "current_role_proof_invalid"),
    ],
)
def test_proof_pending_draft_refuses_changed_wrong_stale_or_tampered_source(
    tmp_path, monkeypatch, mutation, code,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    snapshot_id = _import_current_role_proof(connection, person_id)
    if mutation == "changed_role":
        connection.execute("UPDATE employment SET title='Changed Role'")
    elif mutation == "wrong_scope":
        connection.execute(
            "UPDATE source_snapshot SET entity_id='wrong-person' WHERE snapshot_id=?",
            (snapshot_id,),
        )
    elif mutation == "stale":
        connection.execute(
            "UPDATE source_snapshot SET expires_at='2099-12-01T00:00:00Z' WHERE snapshot_id=?",
            (snapshot_id,),
        )
    else:
        body_ref = connection.execute(
            "SELECT body_ref FROM source_snapshot WHERE snapshot_id=?", (snapshot_id,),
        ).fetchone()[0]
        (tmp_path / "snapshots" / body_ref).write_bytes(b"tampered synthetic bytes")
    connection.commit()
    before = tuple(
        connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("evidence", "revision", "revision_qa_context")
    )

    summary = draft_step_zero_proof_pending(
        connection, campaign_id, anchors=object(), now=NOW,
    )

    assert summary.failure_codes == {code: 1}
    assert tuple(
        connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("evidence", "revision", "revision_qa_context")
    ) == before


@pytest.mark.parametrize("title", ("Operations Director", "Strategy Director", "Chief of Staff"))
def test_current_role_hook_renders_for_ops_strategy_and_chief_of_staff_without_a_career_path(
    tmp_path, monkeypatch, title,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(
        tmp_path, monkeypatch,
        scored_options={"title": title, "employment_excerpt": f"Morgan is {title} at Test Capital"},
    )
    signals = json.loads(connection.execute("SELECT signals_json FROM person_affinity").fetchone()[0])
    connection.execute(
        "UPDATE person_affinity SET signals_json=? WHERE person_id=? AND campaign_id=?",
        (json.dumps([item for item in signals if item["code"] != "path_match"]), person_id, campaign_id),
    )
    connection.execute("DELETE FROM person_employer WHERE person_id=? AND end_year IS NOT NULL", (person_id,))

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.revisions_created == 1 and summary.failure_codes == {}
    template_id, template_version, body = connection.execute(
        "SELECT template_id,template_version,body FROM revision"
    ).fetchone()
    assert (template_id, template_version) == ("startup_current_role_hook", 1)
    assert body.count("Would you have") == 1


def test_invalid_current_role_hook_source_parks_before_revision_write(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    signals = json.loads(connection.execute("SELECT signals_json FROM person_affinity").fetchone()[0])
    connection.execute(
        "UPDATE person_affinity SET signals_json=? WHERE person_id=? AND campaign_id=?",
        (json.dumps([item for item in signals if item["code"] != "path_match"]), person_id, campaign_id),
    )
    connection.execute("UPDATE source_snapshot SET entity_id='wrong-person' WHERE snapshot_id='snap_company'")

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.revisions_created == 0
    assert summary.failure_codes == {"evidence_identity_source_mismatch": 1}
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0


def test_long_own_writing_hook_renders_as_a_complete_sentence(tmp_path, monkeypatch) -> None:
    excerpt = "Synthetic operating note on how teams choose priorities during rapid change with shared ownership"
    connection, person_id, campaign_id = _draft_ready_fixture(
        tmp_path, monkeypatch, scored_options={"writing_excerpt": excerpt},
    )
    signals = json.loads(connection.execute("SELECT signals_json FROM person_affinity").fetchone()[0])
    connection.execute(
        "UPDATE person_affinity SET signals_json=? WHERE person_id=? AND campaign_id=?",
        (json.dumps([item for item in signals if item["code"] != "path_match"]), person_id, campaign_id),
    )

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.revisions_created == 1
    body = connection.execute("SELECT body FROM revision").fetchone()[0]
    assert "Your Operations Director work at Test Capital caught my attention. I noticed" in body


def test_draft_campaign_retry_requires_the_existing_exact_qa_context(
    tmp_path, monkeypatch,
) -> None:
    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    first = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    required = []
    original_require = templates_module.require_revision_qa_context

    def require(*args, **kwargs):
        required.append(args[1])
        return original_require(*args, **kwargs)

    monkeypatch.setattr(templates_module, "require_revision_qa_context", require)
    monkeypatch.setattr(
        templates_module, "record_revision_qa_context",
        lambda *_args, **_kwargs: pytest.fail("retry backfilled QA context"),
    )
    second = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert first.revisions_created == 1 and second.revisions_created == 0
    assert len(required) == 1
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 1


@pytest.mark.parametrize(
    "case,code",
    [
        ("state", "campaign_not_draft"),
        ("intent", "intent_unsupported"),
        ("ask_type", "ask_type_unsupported"),
        ("ask_minutes", "ask_minutes_unsupported"),
        ("sender", "sender_profile_invalid"),
        ("fit", "approved_fit_spec_missing"),
        ("fit_invalid", "approved_fit_spec_invalid"),
        ("copy", "copy_profile_invalid"),
        ("anchors", "sender_anchors_missing"),
    ],
)
def test_campaign_preflight_refuses_incompatible_saved_state_before_mutation(
    tmp_path, monkeypatch, case, code,
) -> None:
    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    if case == "state":
        connection.execute("UPDATE campaign SET status='paused' WHERE campaign_id=?", (campaign_id,))
    elif case == "intent":
        connection.execute("UPDATE campaign SET intent='sales' WHERE campaign_id=?", (campaign_id,))
    elif case == "ask_type":
        connection.execute(
            "UPDATE campaign SET ask_type='relationship' WHERE campaign_id=?", (campaign_id,),
        )
    elif case == "ask_minutes":
        connection.execute("UPDATE campaign SET ask_minutes=5 WHERE campaign_id=?", (campaign_id,))
    elif case == "sender":
        connection.execute("UPDATE sender_profile SET sender_operating_proof='' WHERE sender_profile_id='sender'")
    elif case == "fit":
        connection.execute("UPDATE campaign_fit_spec SET state='superseded'")
    elif case == "fit_invalid":
        connection.execute(
            "UPDATE campaign_fit_spec SET fit_spec_json=?", (json.dumps({"min_fit": 25}),),
        )
    elif case == "copy":
        policy = json.loads(connection.execute(
            "SELECT policy_json FROM campaign WHERE campaign_id=?", (campaign_id,),
        ).fetchone()[0])
        policy["copy_profile"] = {"body_words": [75], "subject_chars": [36, 50]}
        connection.execute(
            "UPDATE campaign SET policy_json=? WHERE campaign_id=?",
            (json.dumps(policy), campaign_id),
        )
    before = tuple(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                   for table in ("evidence", "revision", "revision_qa_context"))

    with pytest.raises(DraftError, match=f"^{code}$"):
        draft_campaign(
            connection, campaign_id, 0,
            anchors=None if case == "anchors" else object(), now=NOW,
        )

    assert tuple(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                 for table in ("evidence", "revision", "revision_qa_context")) == before


@pytest.mark.parametrize(
    "case,code",
    [
        ("fill", "fill_firm_unready"),
        ("employment", "current_employment_missing"),
        ("affinity", "affinity_fit_spec_stale"),
        ("score", "affinity_below_minimum"),
        ("confidence", "confident_current_contact_missing"),
        ("employer", "confident_current_contact_missing"),
        ("veto", "fit_veto_active"),
    ],
)
def test_selected_candidate_prerequisite_blockers_are_counted_without_writes(
    tmp_path, monkeypatch, case, code,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    if case == "fill":
        connection.execute("UPDATE fill_firm SET status='no_confident_email'")
    elif case == "employment":
        connection.execute("UPDATE employment SET valid_to='2099-12-01'")
    elif case == "affinity":
        connection.execute("UPDATE person_affinity SET fit_spec_hash=?", ("d" * 64,))
    elif case == "score":
        connection.execute("UPDATE person_affinity SET score=24")
    elif case == "confidence":
        connection.execute("UPDATE contact_point SET confidence=0.69")
    elif case == "employer":
        connection.execute(
            "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
            ("cmp_0000000000000002", "Other Synthetic", "manual", "other-synthetic"),
        )
        connection.execute(
            "UPDATE contact_point SET employer_company_id='cmp_0000000000000002'"
        )
    else:
        connection.execute(
            "INSERT INTO fit_veto VALUES(?,?,?,?,?,?,?)",
            ("veto", person_id, campaign_id, "human_review", 1,
             "human:fixture", "2099-12-01T00:00:00Z"),
        )

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.candidates == 1 and summary.revisions_created == 0
    assert summary.failure_codes == {code: 1}
    assert connection.execute("SELECT count(*) FROM evidence").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM eligibility_decision").fetchone()[0] == 0


@pytest.mark.parametrize("scope", ["global", "person", "email", "company", "campaign"])
def test_every_active_suppression_scope_blocks_selected_candidate_drafting(
    tmp_path, monkeypatch, scope,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    subject = {
        "global": "all", "person": person_id, "email": REVIEW_FIXTURE["suppression_email"],
        "company": "cmp_0000000000000001", "campaign": campaign_id,
    }[scope]
    connection.execute(
        "INSERT INTO suppression VALUES(?,?,?,?,?,?,?,?)",
        (f"stop-{scope}", scope, subject, "manual_dnc", "2099-12-01T00:00:00Z",
         "human:fixture", None, None),
    )

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.failure_codes == {"suppression_active": 1}
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0


def test_substituted_and_released_suppression_rows_do_not_create_false_blockers(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    connection.execute(
        "INSERT INTO suppression VALUES(?,?,?,?,?,?,?,?)",
        ("released", "person", person_id, "manual_dnc", "2099-11-01T00:00:00Z",
         "human:fixture", "2099-11-02T00:00:00Z", "human:fixture"),
    )
    allowed = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    assert allowed.revisions_created == 1 and allowed.failure_codes == {}

    connection.execute("UPDATE fill_person SET substituted=1")
    skipped = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    assert skipped.candidates == 0 and skipped.revisions_created == 0
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 1


def test_failed_qa_context_write_rolls_back_revision_evidence_and_signal_updates(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    before_signals = connection.execute(
        "SELECT signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?",
        (person_id, campaign_id),
    ).fetchone()[0]
    monkeypatch.setattr(
        templates_module, "record_revision_qa_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("context_rejected")),
    )

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.failure_codes == {"context_rejected": 1}
    assert connection.execute("SELECT count(*) FROM evidence").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 0
    assert connection.execute(
        "SELECT signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?",
        (person_id, campaign_id),
    ).fetchone()[0] == before_signals


def test_expired_source_evidence_fails_qa_without_partial_draft_state(
    tmp_path, monkeypatch,
) -> None:
    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    connection.execute("UPDATE source_snapshot SET expires_at='2099-01-01T00:00:00Z'")

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.revisions_created == 0 and summary.qa_failed == 1
    assert summary.failure_codes.get("evidence_missing", 0) >= 1
    assert connection.execute("SELECT count(*) FROM evidence").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM revision_qa_context").fetchone()[0] == 0


def test_the_follow_up_clears_the_seventy_five_word_floor() -> None:
    template = load_registry_v2()["follow_up_de_escalation"]
    _subject, body = render(template, _slot_values(template))
    assert _body_word_count(body) >= 75


def test_current_role_hook_clears_the_seventy_five_word_floor() -> None:
    template = load_registry_v2()["startup_current_role_hook"]
    _subject, body = render(template, _slot_values(template))
    assert 75 <= _body_word_count(body) <= 125


def test_the_registry_holds_many_templates_per_intent() -> None:
    registry = load_registry_v2()
    assert set(registry) == EXPECTED_IDS
    assert Counter(template.intent for template in registry.values())["networking"] >= 5


def test_v1_registry_is_untouched_by_the_new_directory() -> None:
    root = __import__("pathlib").Path(__file__).resolve().parents[3]
    assert set(load_registry(root / "orgs/prospecting/templates")) == {
        "networking", "recruiting_live", "curiosity", "alumni",
    }


def test_a_body_below_the_band_is_caught_before_qa() -> None:
    assert check_bands("A" * 40, "Hi\n\nBrief note.\n\nSender", COPY_PROFILE_DEFAULT) == (
        "body_words_out_of_band",
    )


def test_ask_sentence_requires_one_question() -> None:
    with pytest.raises(ValueError, match="ask_sentence_not_unique"):
        ask_sentence("One question? Another question?")


def test_actual_draft_uses_signal_backed_nonfirst_school_and_employer(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    from scripts.prospecting.tests.test_affinity_evidence_bridge import _observation
    _observation(connection, "obs_school_zero", person_id, "education", "snap_person", "First College alum")
    _observation(connection, "obs_employer_zero", person_id, "employer", "snap_person", "Shared Prior experience")
    connection.execute("UPDATE person_education SET ordinal=1 WHERE person_id=?", (person_id,))
    connection.execute("INSERT INTO person_education VALUES(?,?,?,?,?,?,?,?)", (person_id, 0, "first college", "First College", None, None, None, "obs_school_zero"))
    connection.execute("UPDATE person_employer SET ordinal=2 WHERE person_id=? AND observation_id='obs_employer'", (person_id,))
    connection.execute("INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)", (person_id, 0, "shared prior", "Shared Prior", "consultancy", None, None, 2090, "obs_employer_zero"))
    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    assert summary.revisions_created == 1
    body = connection.execute("SELECT body FROM revision").fetchone()[0]
    assert "Meridian Bank" in body and "Shared Prior" not in body


def test_path_signal_cannot_borrow_a_different_shared_prior(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    from scripts.prospecting.tests.test_affinity_evidence_bridge import _observation
    _observation(connection, "obs_path_prior", person_id, "employer", "snap_person", "Path Consulting experience")
    connection.execute("INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)", (person_id, 3, "path consulting", "Path Consulting", "consultancy", None, None, 2090, "obs_path_prior"))
    signals = json.loads(connection.execute("SELECT signals_json FROM person_affinity").fetchone()[0])
    next(item for item in signals if item["code"] == "path_match")["observation_ids"] = ["obs_path_prior"]
    connection.execute("UPDATE person_affinity SET signals_json=?", (json.dumps(signals),))
    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)
    assert summary.revisions_created == 1
    revision = connection.execute("SELECT subject,body FROM revision").fetchone()
    assert "Path Consulting" in revision["body"]
    assert "Meridian Bank experience caught my attention" in revision["body"]
    assert "consulting" in revision["subject"].casefold()


def test_unused_strong_signal_with_an_invalid_source_does_not_block_step_zero(
    tmp_path, monkeypatch,
) -> None:
    connection, _person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    signals = json.loads(connection.execute("SELECT signals_json FROM person_affinity").fetchone()[0])
    signals.append({
        "code": "board_or_portfolio", "klass": "strong", "strength": 100,
        "weight": 10, "points": 10, "observation_ids": ["obs_missing"],
    })
    connection.execute("UPDATE person_affinity SET signals_json=?", (json.dumps(signals),))

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.revisions_created == 1 and summary.failure_codes == {}


def test_transition_kind_comes_from_selected_normalized_current_employer_not_background(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    connection.execute(
        "INSERT INTO person_background VALUES(?,?,?,?,?,?)",
        (person_id, 1, None, "bank", json.dumps(["bank"]), "2099-12-01T00:00:00Z"),
    )

    summary = draft_campaign(connection, campaign_id, 0, anchors=object(), now=NOW)

    assert summary.revisions_created == 1
    body = connection.execute("SELECT body FROM revision").fetchone()[0]
    assert "vc at Test Capital" in body


def test_board_only_signal_supplies_the_follow_up_new_fact(tmp_path, monkeypatch) -> None:
    connection, _person_id, campaign_id = _draft_ready_fixture(
        tmp_path, monkeypatch,
        body_low=60,
        scored_options={"link_kind": "board", "link_signal": "board_or_portfolio"},
    )

    summary = draft_campaign(connection, campaign_id, 1, anchors=object(), now=NOW)

    assert summary.revisions_created == 1 and summary.failure_codes == {}
    body = connection.execute("SELECT body FROM revision").fetchone()[0]
    assert "Synthetic climate note" in body
