"""Synthetic coverage for Contract 3 evidence minted from affinity signals."""

from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
import re

import pytest

from scripts.prospecting.affinity.evidence_bridge import (
    CLAIM_TEMPLATES, _observation as resolved_observation, mint_evidence, resolve_slot_facts,
)
from scripts.prospecting.affinity.score import Affinity, Signal
from scripts.prospecting.personalizer.evidence import list_evidence
from scripts.prospecting.personalizer.qa import QaPolicy, RECIPIENT_SLOTS, SlotBinding, _entailed, validate_revision
from scripts.prospecting.personalizer.templates import Template, render
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import open_store


NOW = datetime(2099, 12, 30, tzinfo=UTC)
PERSON_ID = "per_0000000000000001"
CAMPAIGN_ID = "camp_0000000000000001"
COMPANY_ID = "cmp_0000000000000001"
SLOTS = {
    "first_name": "Morgan", "company": "Test Capital", "role": "Operations Director",
    "topic": "Test Capital climate thesis", "school": "Newtown University", "why_them": "Meridian Bank",
    "transition_from": "bank at Meridian Bank", "transition_to": "vc at Test Capital",
    "new_fact_sentence": "Synthetic climate note",
    "recipient_hook": "I read Synthetic climate note.",
}
SLOTS_FOR_RENDER = dict(SLOTS)
ASK = "Would you be open to a 15-minute informational conversation to learn about your work?"
TEMPLATE = Template(
    "synthetic_affinity", 1, "networking", "{first_name} at {company}",
    """Hello {first_name},

I noticed {first_name} works at {company} as {role}. The {topic} stood out while I was reading about the firm's approach. Your time at {school} and {why_them} made the path from {transition_from} to {transition_to} especially useful context. {recipient_hook} I also appreciated the {new_fact_sentence}, which made the work feel practical rather than abstract. I am exploring similar decisions carefully and would value hearing how you evaluate opportunities, build conviction, and decide where to focus early effort. """ + ASK + """

Regards,
Synthetic Sender
""",
)
CLAIM_SAMPLE = {
    "first_name": "Morgan", "firm": "Test Capital", "title": "Operations Director",
    "domain": "climate thesis", "school": "Newtown University", "employer": "Meridian Bank",
    "kind_a": "bank", "employer_a": "Meridian Bank", "kind_b": "vc",
    "employer_b": "Test Capital", "work_title": "Synthetic climate note",
    "path_transition": "bank to vc", "role_level": "investing/director",
    "recipient_hook": "Operations Director at Test Capital",
}
SLOT_SAMPLE = {
    "first_name": "Morgan", "company": "Test Capital", "role": "Operations Director",
    "topic": "Test Capital climate thesis", "school": "Newtown University", "why_them": "Meridian Bank",
    "transition_from": "bank at Meridian Bank", "transition_to": "vc at Test Capital",
    "new_fact_sentence": "Synthetic climate note",
    "path_transition": "bank to vc", "role_level": "investing/director",
    "recipient_hook": "Operations Director at Test Capital",
}


def _snapshot(connection, snapshot_id: str, entity_id: str, suffix: str) -> None:
    connection.execute(
        "INSERT INTO source_snapshot VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (snapshot_id, entity_id, f"https://affinity.test/{suffix}", "affinity.test",
         "2099-12-01T00:00:00Z", "text/html", "a" * 64, "fixture-v1", suffix,
         "2100-01-01T00:00:00Z", "2100-01-01T00:00:00Z"),
    )


def _observation(connection, observation_id: str, entity_id: str, field: str,
                 snapshot_id: str, excerpt: str) -> None:
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
           ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (observation_id, "person" if entity_id == PERSON_ID else "company", entity_id, field,
         json.dumps({"excerpt": excerpt}), snapshot_id, "2099-12-01T00:00:00Z",
         "2099-12-01T00:00:00Z", 0.9, snapshot_id),
    )


def _scored_person(tmp_path: Path, monkeypatch, *,
                   school_owner: str = PERSON_ID,
                   school_field: str = "education",
                   school_snapshot_owner: str | None = None,
                   employment_excerpt: str = "Morgan is Operations Director at Test Capital",
                   title: str = "Operations Director",
                   link_kind: str = "writing",
                   link_signal: str = "own_writing",
                   writing_excerpt: str = "Synthetic climate note",
                   ) -> tuple[object, str, str, Affinity]:
    connection = open_store(tmp_path / "store.sqlite")
    connection.execute("INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)", ("sender", "Synthetic", None, "synthetic", "synthetic", "synthetic", "[]"))
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (CAMPAIGN_ID, "networking", "sender", "{}", "informational_call", 15, "direct", "fixture",
         "[]", "09:00-17:00", "UTC", 1, 1, 1, "T1", "mailbox", "{}", 0, "draft", "b" * 64),
    )
    connection.execute("INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)", (PERSON_ID, "Morgan", "Morgan Synthetic", "manual", "morgan-synthetic"))
    connection.execute("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)", (COMPANY_ID, "Test Capital", "manual", "test-capital"))
    _snapshot(connection, "snap_person", PERSON_ID, "person")
    _snapshot(connection, "snap_company", COMPANY_ID, "company")
    _snapshot(
        connection, "snap_school",
        school_owner if school_snapshot_owner is None else school_snapshot_owner,
        "school",
    )
    _observation(connection, "obs_person", PERSON_ID, "name", "snap_person", "Morgan at Test Capital")
    _observation(connection, "obs_employment", COMPANY_ID, "employment", "snap_company", employment_excerpt)
    _observation(
        connection, "obs_school", school_owner, school_field, "snap_school",
        "Newtown University alum",
    )
    _observation(connection, "obs_employer", PERSON_ID, "employer", "snap_person", "Meridian Bank experience")
    _observation(connection, "obs_writing", PERSON_ID, "link", "snap_person", writing_excerpt)
    _observation(connection, "obs_topic", COMPANY_ID, "topic", "snap_company", "Test Capital climate thesis")
    connection.execute("INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)", ("emp_0000000000000001", PERSON_ID, COMPANY_ID, title, None, None, "obs_employment", 0.9))
    connection.execute("INSERT INTO person_education VALUES(?,?,?,?,?,?,?,?)", (PERSON_ID, 0, "newtown university", "Newtown University", None, None, None, "obs_school"))
    connection.execute("INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)", (PERSON_ID, 0, "meridian bank", "Meridian Bank", "bank", None, None, 2090, "obs_employer"))
    connection.execute("INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)", (PERSON_ID, 1, "test capital", "Test Capital", "vc", "Operations Director", 2091, None, "obs_employment"))
    connection.execute("INSERT INTO person_link VALUES(?,?,?,?,?)", (PERSON_ID, 0, link_kind, "https://affinity.test/writing", "obs_writing"))
    affinity = Affinity(PERSON_ID, CAMPAIGN_ID, 78, (
        Signal("shared_school", "strong", 100, 30, 30, ("obs_school",)),
        Signal("shared_prior_employer", "strong", 100, 28, 28, ("obs_employer",)),
        Signal("path_match", "strong", 100, 26, 26, ("obs_employment",)),
        Signal("firm_thesis", "medium", 100, 8, 8, ("obs_topic",)),
        Signal(link_signal, "medium", 100, 14, 14, ("obs_writing",)),
    ), "c" * 64)
    connection.execute("INSERT INTO person_affinity VALUES(?,?,?,?,?,?)", (PERSON_ID, CAMPAIGN_ID, affinity.score, json.dumps([signal.__dict__ for signal in affinity.signals]), "2099-12-01T00:00:00Z", affinity.fit_spec_hash))
    connection.commit()
    return connection, PERSON_ID, CAMPAIGN_ID, affinity


def _weak_only_person(tmp_path: Path, monkeypatch) -> tuple[object, str, str, Affinity]:
    connection, person_id, campaign_id, _ = _scored_person(tmp_path, monkeypatch)
    affinity = Affinity(person_id, campaign_id, 0, (Signal("hometown", "weak", 100, 0, 0, ("obs_person",)),), "c" * 64)
    return connection, person_id, campaign_id, affinity


def _bindings(slots: dict[str, str], evidence_ids: dict[str, str]) -> dict[str, SlotBinding]:
    return {name: SlotBinding(value, "evidence", evidence_ids[name]) for name, value in slots.items()}


def test_every_recipient_slot_gets_its_own_row_and_survives_validate_revision(tmp_path, monkeypatch, record_property) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    ids = mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW)
    assert set(ids) >= RECIPIENT_SLOTS
    signals = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?",
        (person_id, campaign_id),
    ).fetchone()[0])
    assert next(signal for signal in signals if signal["code"] == "shared_prior_employer")["evidence_id"] == ids["why_them"]
    records = list_evidence(connection, person_id, NOW)
    subject, body = render(TEMPLATE, SLOTS_FOR_RENDER)
    result = validate_revision(subject, body, ASK, _bindings(SLOTS, ids), tuple(records), QaPolicy("networking", 0, "informational_call", 75, 125, 0.7, frozenset()), person_id, campaign_id, NOW)
    assert result.failure_codes == ()
    record_property("uncited_rows", 0)


def test_weak_signals_are_never_copy_allowed(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _weak_only_person(tmp_path, monkeypatch)
    slots = dict(SLOTS, recipient_hook="Your Operations Director work at Test Capital caught my attention.")
    ids = mint_evidence(connection, person_id, campaign_id, affinity, slots, NOW)
    rows = list_evidence(connection, person_id, NOW, include_expired=True)
    assert all(not row.allowed_for_copy for row in rows if row.evidence_id in set(ids.values()))


def test_recipient_hook_prefers_same_person_own_writing(tmp_path, monkeypatch) -> None:
    connection, person_id, _campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    facts = resolve_slot_facts(connection, person_id, affinity, COMPANY_ID, required_slots=("recipient_hook",))
    assert facts.sources["recipient_hook"].observation_id == "obs_writing"
    assert facts.values["recipient_hook"] == SLOTS["recipient_hook"]


def test_recipient_hook_ignores_wrong_person_writing_and_uses_current_role(tmp_path, monkeypatch) -> None:
    connection, person_id, _campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    _observation(connection, "obs_wrong_writing", COMPANY_ID, "link", "snap_company", "Firm-only writing")
    wrong_affinity = Affinity(
        affinity.person_id, affinity.campaign_id, affinity.score,
        tuple(
            Signal(item.code, item.klass, item.strength, item.weight, item.points,
                   ("obs_wrong_writing",) if item.code == "own_writing" else item.observation_ids)
            for item in affinity.signals
        ), affinity.fit_spec_hash,
    )
    facts = resolve_slot_facts(connection, person_id, wrong_affinity, COMPANY_ID, required_slots=("recipient_hook",))
    assert facts.sources["recipient_hook"].observation_id == "obs_employment"
    assert facts.values["recipient_hook"] == "Your Operations Director work at Test Capital caught my attention."


def test_weak_selected_writing_cannot_inherit_copy_authority_from_other_signals(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    weak_writing = Affinity(
        affinity.person_id, affinity.campaign_id, affinity.score,
        tuple(
            Signal(item.code, "weak" if item.code == "own_writing" else item.klass,
                   item.strength, item.weight, item.points, item.observation_ids)
            for item in affinity.signals
        ), affinity.fit_spec_hash,
    )
    evidence_ids = mint_evidence(connection, person_id, campaign_id, weak_writing, SLOTS, NOW)
    recipient = next(item for item in list_evidence(connection, person_id, NOW, include_expired=True)
                     if item.evidence_id == evidence_ids["recipient_hook"])
    assert recipient.allowed_for_copy is False


def test_long_own_writing_hook_uses_verified_current_role_before_minting(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    excerpt = "Synthetic operating note on how teams choose priorities during rapid change with shared ownership"
    _observation(connection, "obs_long_writing", person_id, "link", "snap_person", excerpt)
    long_affinity = Affinity(
        affinity.person_id, affinity.campaign_id, affinity.score,
        tuple(
            Signal(item.code, item.klass, item.strength, item.weight, item.points,
                   ("obs_long_writing",) if item.code == "own_writing" else item.observation_ids)
            for item in affinity.signals
        ), affinity.fit_spec_hash,
    )
    facts = resolve_slot_facts(connection, person_id, long_affinity, COMPANY_ID, required_slots=("recipient_hook",))
    display = "Your Operations Director work at Test Capital caught my attention."
    ids = mint_evidence(connection, person_id, campaign_id, long_affinity, {"recipient_hook": display}, NOW)
    assert set(ids) == {"recipient_hook"}


def test_claims_carry_two_shared_terms_so_entailment_holds() -> None:
    for slot, template in CLAIM_TEMPLATES.items():
        assert _entailed(SLOT_SAMPLE[slot], template.format(**CLAIM_SAMPLE)), slot


def test_transition_sources_make_separate_prior_and_current_claims(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    ids = mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW)
    rows = {
        row["evidence_id"]: row
        for row in connection.execute("SELECT evidence_id,claim,url FROM evidence")
    }

    prior = rows[ids["transition_from"]]
    current = rows[ids["transition_to"]]
    shared = rows[ids["why_them"]]
    assert prior["claim"] == "Worked in bank at Meridian Bank"
    assert "Test Capital" not in prior["claim"]
    assert current["claim"] == "Works in vc at Test Capital"
    assert "Meridian Bank" not in current["claim"]
    assert shared["claim"] == "Worked at Meridian Bank"
    assert prior["url"] == "https://affinity.test/person"
    assert current["url"] == "https://affinity.test/company"

    signals = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?",
        (person_id, campaign_id),
    ).fetchone()[0])
    assert next(item for item in signals if item["code"] == "path_match")["evidence_id"] == ids["transition_to"]


def test_evidence_ids_are_bare_hex_so_the_pii_guard_masks_them(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    ids = mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW)
    assert all(re.fullmatch(r"[0-9a-f]{64}", value) for value in ids.values())
    assert_vm_safe({"kind": "stdout", "fields": {"evidence": sorted(ids.values())}}, "stdout")


def test_a_second_mint_creates_no_new_rows(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    first = mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW)
    before = connection.execute("SELECT count(*) FROM evidence").fetchone()[0]
    second = mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW)
    assert second == first
    assert connection.execute("SELECT count(*) FROM evidence").fetchone()[0] == before


def test_selected_second_current_employer_owns_identity(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    second = "cmp_0000000000000002"
    connection.execute("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)", (second, "Second Capital", "manual", "second-capital"))
    _snapshot(connection, "snap_second", second, "second")
    _observation(connection, "obs_second", second, "employment", "snap_second", "Morgan is Partner at Second Capital")
    _observation(connection, "obs_second_topic", second, "topic", "snap_second", "Second Capital climate thesis")
    connection.execute("INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)", ("emp_2", person_id, second, "Partner", None, None, "obs_second", .9))
    connection.execute("INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)", (person_id, 2, "second capital", "Second Capital", "vc", "Partner", 2092, None, "obs_second"))
    affinity = Affinity(
        affinity.person_id, affinity.campaign_id, affinity.score,
        tuple(
            Signal(item.code, item.klass, item.strength, item.weight, item.points,
                   (("obs_second",) if item.code == "path_match" else
                    ("obs_second_topic",) if item.code == "firm_thesis" else item.observation_ids),
                   item.evidence_id)
            for item in affinity.signals
        ),
        affinity.fit_spec_hash,
    )
    slots = dict(
        SLOTS, company="Second Capital", role="Partner",
        topic="Second Capital climate thesis", transition_to="vc at Second Capital",
    )
    ids = mint_evidence(connection, person_id, campaign_id, affinity, slots, NOW, selected_company_id=second)
    claims = {row[0]: row[1] for row in connection.execute("SELECT evidence_id,claim FROM evidence")}
    assert claims[ids["company"]] == "Works at Second Capital as Partner"
    with pytest.raises(ValueError, match="evidence_identity_ambiguous"):
        mint_evidence(connection, person_id, campaign_id, affinity, slots, NOW)


@pytest.mark.parametrize(
    "fixture_options",
    [
        {"school_owner": COMPANY_ID},
        {"school_field": "link"},
        {"school_snapshot_owner": COMPANY_ID},
    ],
)
def test_wrong_person_field_and_snapshot_source_are_rejected(
    tmp_path, monkeypatch, fixture_options,
) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(
        tmp_path, monkeypatch, **fixture_options,
    )
    with pytest.raises(ValueError, match="evidence_school_source_mismatch"):
        mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW, selected_company_id=COMPANY_ID)


def test_legacy_source_pointer_and_explicit_provider_label_resolve_but_conflict_refuses(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, _campaign_id, _affinity = _scored_person(tmp_path, monkeypatch)
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
           ) VALUES(?,?,?,?,?,?,?,?,?,NULL)""",
        ("obs_legacy", "person", person_id, "link", json.dumps({"excerpt": "Legacy note"}),
         "snap_person", "2099-12-01T00:00:00Z", "2099-12-01T00:00:00Z", 0.9),
    )
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
           ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        ("obs_provider", "person", person_id, "link", json.dumps({"excerpt": "Provider note"}),
         "approved-provider", "2099-12-01T00:00:00Z", "2099-12-01T00:00:00Z", 0.9,
         "snap_person"),
    )
    _snapshot(connection, "snap_conflict", person_id, "conflict")
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
           ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        ("obs_conflict", "person", person_id, "link", json.dumps({"excerpt": "Conflict note"}),
         "snap_conflict", "2099-12-01T00:00:00Z", "2099-12-01T00:00:00Z", 0.9,
         "snap_person"),
    )

    assert resolved_observation(connection, "obs_legacy").snapshot_id == "snap_person"
    assert resolved_observation(connection, "obs_provider").snapshot_id == "snap_person"
    with pytest.raises(ValueError, match="^evidence_snapshot_conflict$"):
        resolved_observation(connection, "obs_conflict")


def test_current_employment_excerpt_must_name_person_firm_and_title(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(
        tmp_path, monkeypatch, employment_excerpt="Operations Director at Test Capital",
    )
    with pytest.raises(ValueError, match="^evidence_identity_source_mismatch$"):
        mint_evidence(
            connection, person_id, campaign_id, affinity, SLOTS, NOW,
            selected_company_id=COMPANY_ID,
        )


def test_current_employment_rejects_names_embedded_inside_other_words(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(
        tmp_path, monkeypatch,
        employment_excerpt="Morgana is Operations Director at Contest Capital",
    )
    with pytest.raises(ValueError, match="^evidence_identity_source_mismatch$"):
        mint_evidence(
            connection, person_id, campaign_id, affinity, SLOTS, NOW,
            selected_company_id=COMPANY_ID,
        )


def test_multiple_valid_name_sources_choose_one_deterministically(tmp_path, monkeypatch) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    _snapshot(connection, "snap_name_first", person_id, "name-first")
    _observation(
        connection, "obs_000_name", person_id, "name", "snap_name_first",
        "Morgan Synthetic profile",
    )

    ids = mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW)
    row = connection.execute(
        "SELECT url FROM evidence WHERE evidence_id=?", (ids["first_name"],),
    ).fetchone()
    assert row[0] == "https://affinity.test/name-first"


def test_duplicate_evidence_id_with_different_source_metadata_is_refused_without_backfill(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    evidence_id = __import__("hashlib").sha256(
        f"{person_id}|{campaign_id}|first_name|Known as Morgan".encode(),
    ).hexdigest()
    connection.execute(
        "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
        (evidence_id, person_id, "Known as Morgan", "https://affinity.test/forged",
         "2099-12-01T00:00:00Z", "2099-12-01T00:00:00Z", "Morgan", 0.9,
         "2100-01-01T00:00:00Z", 1),
    )

    with pytest.raises(ValueError, match="^duplicate_evidence_conflict$"):
        mint_evidence(connection, person_id, campaign_id, affinity, SLOTS, NOW)

    assert connection.execute(
        "SELECT url FROM evidence WHERE evidence_id=?", (evidence_id,),
    ).fetchone()[0] == "https://affinity.test/forged"


def test_only_canonical_word_prefixes_are_accepted_for_clamped_title_and_topic(
    tmp_path, monkeypatch,
) -> None:
    connection, person_id, campaign_id, affinity = _scored_person(tmp_path, monkeypatch)
    accepted = dict(SLOTS, role="Operations", topic="Test Capital climate")
    assert {"role", "topic"} <= set(mint_evidence(
        connection, person_id, campaign_id, affinity, accepted, NOW,
    ))
    with pytest.raises(ValueError, match="^evidence_display_mismatch$"):
        mint_evidence(
            connection, person_id, campaign_id, affinity,
            dict(SLOTS, role="Senior Operations"), NOW,
        )
