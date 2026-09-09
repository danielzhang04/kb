import inspect
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.prospecting.lanes import LaneBatch, LanePlan, YieldEstimate, capabilities_for
from scripts.prospecting.capture import capture_csv
from scripts.prospecting.list_builder import ListPipeline, build_list, main, summary_json
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.scorer import (
    clean_contacts,
    dedupe_people,
    ensure_fit_score_v1,
    score_person,
    write_eligibility,
)
from scripts.prospecting.store import Employment, SourceObservation, apply_role_change, open_store
from scripts.prospecting.p2_store import compile_target_policy


AT = "2026-09-03T00:00:00Z"


def insert_campaign(db):
    db.execute(
        "INSERT INTO sender_profile(sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics) VALUES(?,?,?,?,?,?)",
        ("sender-1", "Synthetic Sender", "testing", "synthetic", "fixture", "[]"),
    )
    db.execute(
        "INSERT INTO campaign(campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,send_window,timezone,daily_cap,hourly_cap,firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("campaign-1", "networking", "sender-1", "{}", "informational_call", "direct", "fixture", "[]", "{}", "UTC", 1, 1, 1, "T1", "mailbox-1", "{}", 0, "active", "a" * 64),
    )


@pytest.fixture
def seeded_contacts():
    def build(tmp_path, states):
        db = open_store(tmp_path / "contacts.sqlite")
        db.execute("INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)", ("person-1", "Synthetic", "Synthetic Person", "manual", "key-1"))
        db.executemany(
            "INSERT INTO contact_point(contact_id,person_id,employer_company_id,email,provider,adapter_version,retrieved_at,verified_at,state,confidence,bounce_history) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            ((f"contact-{i}", "person-1", None, f"email-ref-{i}", "manual", "fixture-v1", AT, AT, state, 1.0, 0) for i, state in enumerate(states)),
        )
        db.commit()
        return db
    return build


@pytest.fixture
def conflicting_people():
    def build(tmp_path):
        fixture = json.loads(Path("orgs/prospecting/fixtures/conflicting-providers.json").read_text(encoding="utf-8"))
        db = open_store(tmp_path / "conflicts.sqlite")
        person_id = fixture["merge_review"]["candidate_ids"][0]
        db.execute(
            "INSERT INTO person(person_id,first_name,full_name,linkedin_url,source_lane,dedupe_key) VALUES(?,?,?,?,?,?)",
            (person_id, "Synthetic", "Synthetic Person", None, "manual", "casey-dedupe-key"),
        )
        db.executemany(
            "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?,?)",
            tuple(
                (
                    record["observation_id"],
                    "person",
                    person_id,
                    record["field"],
                    record["value"],
                    record["source"],
                    record["seen_at"],
                    record["retrieved_at"],
                    record["confidence"],
                )
                for record in fixture["observations"]
            ),
        )
        db.commit()
        return db
    return build


@pytest.fixture
def role_change_case():
    class Case:
        def __call__(self, tmp_path):
            fixture = json.loads(Path("orgs/prospecting/fixtures/job-change.json").read_text(encoding="utf-8"))
            self.db = open_store(tmp_path / "role-change.sqlite")
            self.db.executescript("""
INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES('old-company','Old Synthetic','manual','old-key');
INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES('person-1','Synthetic','Synthetic Person','manual','person-key');
INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES('obs-old','employment','employment-old','company_id','\"old-company\"','manual','2026-09-03T00:00:00Z',1.0);
INSERT INTO employment(employment_id,person_id,company_id,title,valid_from,valid_to,source_observation_id,confidence) VALUES('employment-old','person-1','old-company','Partner','2025-01-01',NULL,'obs-old',1.0);
INSERT INTO contact_point(contact_id,person_id,employer_company_id,email,provider,adapter_version,retrieved_at,verified_at,state,confidence,bounce_history) VALUES('contact-1','person-1','old-company','email-ref-1','manual','fixture-v1','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z','valid',1.0,0);
INSERT INTO contact_point(contact_id,person_id,employer_company_id,email,provider,adapter_version,retrieved_at,verified_at,state,confidence,bounce_history) VALUES('contact-2','person-1','old-company','email-ref-2','manual','fixture-v1','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z','risky',1.0,0);
""")
            company = fixture["new_company"]
            self.db.execute(
                "INSERT INTO company(company_id,name,website_url,linkedin_url,one_line_summary,industry,location,source_lane,dedupe_key) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    company["company_id"], company["name"], company["website_url"],
                    company["linkedin_url"], company["one_line_summary"], company["industry"],
                    company["location"], company["source_lane"], company["dedupe_key"],
                ),
            )
            self.fixture = fixture
            self.db.commit()
            return self.db

        def apply(self, db):
            record = self.fixture["observations"][1]
            employment_data = self.fixture["new_employment"]
            observation = SourceObservation(
                record["observation_id"], record["entity_type"], record["entity_id"],
                record["field"], record["value"], record["source"], record["seen_at"],
                record["retrieved_at"], record["confidence"], record["snapshot_id"],
            )
            employment = Employment(
                employment_data["employment_id"], employment_data["person_id"],
                employment_data["company_id"], employment_data["title"],
                employment_data["valid_from"], employment_data["valid_to"],
                employment_data["source_observation_id"], employment_data["confidence"],
            )
            return apply_role_change(
                db, "employment-old", "old-company", employment, (observation,), self.fixture["changed_at"]
            )

    return Case()


@pytest.fixture
def score_case():
    def build(tmp_path):
        db = open_store(tmp_path / "score.sqlite")
        insert_campaign(db)
        db.execute("INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)", ("person-1", "Synthetic", "Synthetic Person", "manual", "person-key"))
        db.commit()
        return db
    return build


@pytest.fixture
def eligibility_case(score_case):
    def build(tmp_path):
        db = score_case(tmp_path)
        policy = compile_target_policy({"predicates": [], "requested_companies": 0, "requested_people": 0, "extra_fields": [], "lane_plan": ["manual"], "scorer_version": "fit-v1"}, lambda _: None)
        return db, policy
    return build


def test_role_and_risky_contacts_are_not_eligible(tmp_path, seeded_contacts):
    db = seeded_contacts(tmp_path, ["role", "risky", "catch_all", "valid"])
    result = clean_contacts(db, ("person-1",), AT)
    assert result.valid == 1 and result.quarantined == 3


def test_conflicting_dedupe_creates_merge_review_and_keeps_observations(
    tmp_path, conflicting_people, record_property,
):
    db = conflicting_people(tmp_path)
    before = db.execute("SELECT COUNT(*) FROM source_observation").fetchone()[0]
    person_id = db.execute("SELECT person_id FROM person").fetchone()[0]
    result = dedupe_people(db, (person_id,), AT)
    assert result.conflicts == 1
    assert db.execute("SELECT state FROM merge_review").fetchone()[0] == "open"
    assert db.execute("SELECT COUNT(*) FROM source_observation").fetchone()[0] == before
    record_property("conflicting_provider_observation_assertions", 1)


def test_job_change_stales_all_former_employer_contacts_transactionally(
    tmp_path, role_change_case, record_property,
):
    db = role_change_case(tmp_path)
    changed = role_change_case.apply(db)
    assert changed == 2
    assert db.execute("SELECT COUNT(*) FROM contact_point WHERE state='stale'").fetchone()[0] == 2
    assert db.execute("SELECT valid_to FROM employment WHERE employment_id='employment-old'").fetchone()[0] is not None
    assert db.execute("SELECT COUNT(*) FROM employment WHERE employment_id='employment-2'").fetchone()[0] == 1
    record_property("job_change_stale_contacts", changed)


def test_fit_score_v1_is_deterministic_and_versioned(tmp_path, score_case):
    db = score_case(tmp_path)
    version = ensure_fit_score_v1(db, AT)
    facts = {"title_match": True, "seniority_match": True, "industry_match": True, "location_match": False}
    assert score_person(db, "campaign-1", "person-1", facts, AT) == 80
    assert score_person(db, "campaign-1", "person-1", facts, AT) == 80
    assert db.execute("SELECT COUNT(*) FROM fit_score").fetchone()[0] == 1
    assert db.execute("SELECT version FROM fit_score_version WHERE fit_score_version_id=?", (version,)).fetchone()[0] == "fit-v1"
    with pytest.raises(Exception):
        db.execute("UPDATE fit_score_version SET rule_hash='changed' WHERE fit_score_version_id=?", (version,))
        db.commit()


def test_eligibility_is_deterministic_and_has_no_model_or_transport_surface(tmp_path, eligibility_case):
    outputs = []
    for name in ("first", "second"):
        directory = tmp_path / name
        directory.mkdir()
        db, policy = eligibility_case(directory)
        decision = write_eligibility(db, "campaign-1", "person-1", policy, ensure_fit_score_v1(db, AT), AT)
        outputs.append((decision.outcome, tuple(decision.failed_predicate_ids), tuple(decision.approximate_predicate_ids)))
    assert outputs == [("eligible", (), ()), ("eligible", (), ())]
    assert {"model", "client", "transport", "prompt"}.isdisjoint(inspect.signature(write_eligibility).parameters)


class FixtureLane:
    name = "manual"
    capability_version = "manual-v1"

    def __init__(self, pages, repeat_final=False):
        self.pages = pages
        self.repeat_final = repeat_final
        self.calls = []

    def capabilities(self):
        return capabilities_for(self.name, self.capability_version)

    def plan(self, policy):
        return LanePlan(
            self.name, self.capability_version, self.capabilities(),
            YieldEstimate(1, 15, 30), 30,
        )

    def run(self, plan, cursor):
        index = 0 if cursor is None else int(cursor.cursor)
        self.calls.append(index)
        page_index = (0 if index == 1 else index - 1) if self.repeat_final and index > 0 else index
        observations = self.pages[min(page_index, len(self.pages) - 1)]
        exhausted = page_index >= len(self.pages) - 1
        return LaneBatch(
            observations, str(index + 1), len(observations), len(observations), exhausted,
            "lane_exhausted" if exhausted and not observations else None,
        )


def company_observations(start, count):
    return tuple(
        SimpleNamespace(
            observation_id=f"observation-{i}", entity_type="company", entity_id=f"company-{i}",
            field="name", value=f"company-{i}", source="fixture",
            seen_at="2026-09-03T00:00:00Z", retrieved_at="2026-09-03T00:00:00Z",
            confidence=1.0, snapshot_id=None,
        )
        for i in range(start, start + count)
    )


def build_case(tmp_path, pages, repeat_final=False):
    fixture = json.loads(Path("orgs/prospecting/fixtures/finder-pages.json").read_text(encoding="utf-8"))
    assert len(fixture["companies"]) == 30
    db = open_store(tmp_path / "list.sqlite")
    insert_campaign(db)
    db.commit()
    policy = compile_target_policy(
        {
            "predicates": [], "requested_companies": 30, "requested_people": 0,
            "extra_fields": [], "lane_plan": ["manual"], "scorer_version": "fit-v1",
        },
        lambda _: None,
    )
    db.execute("UPDATE campaign SET policy_hash=? WHERE campaign_id='campaign-1'", (policy.policy_hash,))
    db.commit()
    return db, policy, (FixtureLane(pages, repeat_final),), ListPipeline(
        lambda *_: None, lambda *_: None, lambda *_: None,
    )


@pytest.fixture
def thirty_company_case():
    return lambda tmp_path: build_case(
        tmp_path, (company_observations(0, 15), company_observations(15, 15))
    )


@pytest.fixture
def resumable_case():
    return lambda tmp_path: build_case(
        tmp_path, (company_observations(0, 15), company_observations(15, 15)), True
    )


@pytest.fixture
def exhausted_case():
    return lambda tmp_path: build_case(tmp_path, ((),))


@pytest.fixture
def person_pipeline_case():
    def build(tmp_path):
        db = open_store(tmp_path / "person-list.sqlite")
        insert_campaign(db)
        db.commit()
        policy = compile_target_policy(
            {
                "predicates": [], "requested_companies": 0, "requested_people": 1,
                "extra_fields": [], "lane_plan": ["manual"], "scorer_version": "fit-v1",
            },
            lambda _: None,
        )
        db.execute(
            "UPDATE campaign SET policy_hash=? WHERE campaign_id='campaign-1'", (policy.policy_hash,)
        )
        db.commit()
        observation = SimpleNamespace(
            observation_id="observation-person-1", entity_type="person", entity_id="person-1",
            field="full_name", value="person-1", source="fixture",
            seen_at="2026-09-03T00:00:00Z", retrieved_at="2026-09-03T00:00:00Z",
            confidence=1.0, snapshot_id=None,
        )
        calls = []
        pipeline = ListPipeline(
            lambda *args: calls.append("reserved_enrichment"),
            lambda *args: calls.append("role_check"),
            lambda *args: calls.append("snapshot"),
        )
        return db, policy, (FixtureLane(((observation,),)),), pipeline, calls

    return build


def test_synthetic_30_company_run_is_counts_only_no_network(
    tmp_path, monkeypatch, thirty_company_case, record_property,
):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    db, policy, lanes, pipeline = thirty_company_case(tmp_path)
    summary = build_list(db, "campaign-1", policy, lanes, pipeline, AT)
    text = summary_json(summary)
    assert summary.companies == 30 and summary.state == "complete"
    assert json.loads(text) == {
        "companies": 30,
        "people": 0,
        "already_has_contact": 0,
        "valid_contacts": 0,
        "quarantined": 0,
        "duplicates": 0,
        "attempts": 0,
        "credits": 0,
        "shortfall_reason": None,
        "state": "complete",
    }
    assert db.execute(
        "SELECT COUNT(*) FROM source_observation WHERE source LIKE ?", (summary.finder_run_id + "|%",)
    ).fetchone()[0] == 30
    assert pipeline.events == [
        "dedupe", "suppression", "reserved_enrichment", "role_check", "snapshot", "clean",
        "score", "eligibility", "membership",
    ] * 2
    assert_vm_safe({"kind": "process_results", "fields": json.loads(text)}, "process_results")
    assert "@" not in text and "http" not in text
    record_property("synthetic_companies_run", summary.companies)


def test_restart_from_cursor_yields_zero_duplicate_canonical_rows(
    tmp_path, monkeypatch, resumable_case, record_property,
):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    db, policy, lanes, pipeline = resumable_case(tmp_path)
    first = build_list(db, "campaign-1", policy, lanes, pipeline, AT, interrupt_after_batches=1)
    second = build_list(db, "campaign-1", policy, lanes, pipeline, "2026-09-03T00:10:00Z")
    assert first.finder_run_id == second.finder_run_id and first.list_id == second.list_id
    assert lanes[0].calls == [0, 1, 2]
    assert second.duplicates == 0
    assert db.execute("SELECT COUNT(*)-COUNT(DISTINCT dedupe_key) FROM company").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM source_observation").fetchone()[0] == 30
    record_property("restart_duplicate_row_assertions", 1)


def test_shortfall_never_relaxes_policy(tmp_path, exhausted_case):
    db, policy, lanes, pipeline = exhausted_case(tmp_path)
    before = db.execute("SELECT policy_hash FROM campaign WHERE campaign_id='campaign-1'").fetchone()[0]
    summary = build_list(db, "campaign-1", policy, lanes, pipeline, AT)
    after = db.execute("SELECT policy_hash FROM campaign WHERE campaign_id='campaign-1'").fetchone()[0]
    assert summary.shortfall_reason == "lane_exhausted" and after == before


def test_finder_run_uses_target_policy_hash(tmp_path, exhausted_case):
    db, policy, lanes, pipeline = exhausted_case(tmp_path)
    summary = build_list(db, "campaign-1", policy, lanes, pipeline, AT)
    assert db.execute(
        "SELECT policy_hash FROM finder_run WHERE finder_run_id=?", (summary.finder_run_id,)
    ).fetchone()[0] == policy.policy_hash


def test_build_list_rejects_campaign_policy_hash_mismatch(tmp_path, exhausted_case):
    db, policy, lanes, pipeline = exhausted_case(tmp_path)
    db.execute("UPDATE campaign SET policy_hash=? WHERE campaign_id='campaign-1'", ("b" * 64,))
    db.commit()
    with pytest.raises(ValueError, match="^campaign_policy_hash_mismatch$"):
        build_list(db, "campaign-1", policy, lanes, pipeline, AT)


def test_build_list_rejects_unconfigured_default_stages(tmp_path, exhausted_case):
    db, policy, lanes, _ = exhausted_case(tmp_path)
    with pytest.raises(ValueError, match="^list_builder_requires_configured_stages$"):
        build_list(db, "campaign-1", policy, lanes, ListPipeline(), AT)


def test_person_pipeline_executes_enrich_role_snapshot_score_eligibility_membership(tmp_path, person_pipeline_case):
    db, policy, lanes, pipeline, calls = person_pipeline_case(tmp_path)
    summary = build_list(db, "campaign-1", policy, lanes, pipeline, AT)
    assert summary.people == 1
    assert calls == ["reserved_enrichment", "role_check", "snapshot"]
    assert db.execute("SELECT COUNT(*) FROM fit_score WHERE campaign_id='campaign-1'").fetchone()[0] == 1
    assert db.execute(
        "SELECT outcome FROM eligibility_decision WHERE campaign_id='campaign-1'"
    ).fetchone()[0] == "eligible"


def _cli_policy():
    return {
        "predicates": [], "requested_companies": 3, "requested_people": 6,
        "extra_fields": [], "lane_plan": ["manual", "pitchbook"], "scorer_version": "fit-v1",
    }


def _prepare_cli_store(tmp_path):
    path = tmp_path / "cli.sqlite"
    db = open_store(path)
    insert_campaign(db)
    campaign_id = "camp_0000000000000001"
    policy = compile_target_policy(_cli_policy(), lambda _: None)
    db.execute(
        "UPDATE campaign SET policy_json=?,policy_hash=? WHERE campaign_id='campaign-1'",
        (json.dumps(_cli_policy()), policy.policy_hash),
    )
    db.execute("UPDATE campaign SET campaign_id=? WHERE campaign_id='campaign-1'", (campaign_id,))
    captured = "kind,linkedin_url,name,first_name\n" + "".join(
        f"person,https://professional-network.invalid/profile/synthetic-{index},Synthetic {index},Synthetic\n"
        for index in range(6)
    )
    capture_csv(
        db, __import__("io").StringIO(captured), AT,
        iter(value for index in range(6) for value in (
            f"per_{index:016x}", f"obs_{index:016x}",
        )).__next__,
    )
    db.close()
    pitchbook = tmp_path / "pitchbook.csv"
    pitchbook.write_text(
        "Company Name,Website,Primary Industry,Company Type,Company Stage,HQ Location,LinkedIn URL\n"
        "Synthetic Firm 1,https://firm-1.test,Software,VC,Early,Metro,\n"
        "Synthetic Firm 2,https://firm-2.test,Software,VC,Early,Metro,\n"
        "Synthetic Firm 3,https://firm-3.test,Software,VC,Early,Metro,\n",
        encoding="utf-8",
    )
    return path, pitchbook, campaign_id


def test_list_builder_run_counts_only_queues_people_and_dry_run_writes_nothing(tmp_path, capsys):
    path, pitchbook, campaign_id = _prepare_cli_store(tmp_path)
    arguments = [
        "run", "--campaign", campaign_id, "--lanes", "manual,pitchbook", "--store", str(path),
        "--pitchbook-csv", str(pitchbook), "--at", AT,
    ]
    assert main(arguments + ["--dry-run"]) == 0
    dry_output = capsys.readouterr().out.strip()
    db = open_store(path)
    assert db.execute("SELECT COUNT(*) FROM finder_run").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM exec_request").fetchone()[0] == 0
    db.close()
    assert main(arguments) == 0
    output = capsys.readouterr().out.strip()
    assert json.loads(dry_output)["companies"] == 3
    assert json.loads(output)["companies"] == 3 and json.loads(output)["people"] == 6
    assert "@" not in output and "https:" not in output
    db = open_store(path)
    assert db.execute("SELECT COUNT(*) FROM company").fetchone()[0] == 3
    assert db.execute("SELECT COUNT(*) FROM person").fetchone()[0] == 6
    assert db.execute("SELECT COUNT(*) FROM exec_request WHERE operation='vendor_lookup'").fetchone()[0] == 6
    request_payload = json.loads(db.execute(
        "SELECT payload FROM exec_request WHERE operation='vendor_lookup' LIMIT 1"
    ).fetchone()[0])
    assert request_payload["provider"] == "pdl"
    assert db.execute(
        "SELECT COUNT(*) FROM credit_reservation WHERE provider='pdl' AND max_cost=0"
    ).fetchone()[0] == 6
    db.close()


def test_list_builder_run_uses_selected_snov_finder_cost(tmp_path, capsys):
    path, pitchbook, campaign_id = _prepare_cli_store(tmp_path)
    db = open_store(path)
    db.execute("UPDATE campaign SET credit_budget=6 WHERE campaign_id=?", (campaign_id,))
    db.commit()
    db.close()

    assert main([
        "run", "--campaign", campaign_id, "--lanes", "manual,pitchbook", "--store", str(path),
        "--pitchbook-csv", str(pitchbook), "--finder-provider", "snov", "--at", AT,
    ]) == 0
    output = json.loads(capsys.readouterr().out.strip())
    assert output["already_has_contact"] == 0
    db = open_store(path)
    requests = db.execute(
        "SELECT payload FROM exec_request WHERE operation='vendor_lookup'"
    ).fetchall()
    assert len(requests) == 6
    assert {json.loads(row[0])["provider"] for row in requests} == {"snov"}
    assert db.execute(
        "SELECT COUNT(*) FROM credit_reservation WHERE provider='snov' AND max_cost=1"
    ).fetchone()[0] == 6
    db.close()


def test_list_builder_skips_people_with_existing_contact_points(tmp_path, capsys):
    path, pitchbook, campaign_id = _prepare_cli_store(tmp_path)
    db = open_store(path)
    person_id = db.execute("SELECT person_id FROM person ORDER BY person_id LIMIT 1").fetchone()[0]
    db.execute(
        "INSERT INTO contact_point(contact_id,person_id,employer_company_id,email,provider,adapter_version,retrieved_at,verified_at,state,confidence,bounce_history) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("contact-known", person_id, None, "opaque-contact-ref", "manual", "fixture", AT, AT, "valid", 1.0, 0),
    )
    db.commit()
    db.close()

    assert main([
        "run", "--campaign", campaign_id, "--lanes", "manual,pitchbook", "--store", str(path),
        "--pitchbook-csv", str(pitchbook), "--at", AT,
    ]) == 0
    output = json.loads(capsys.readouterr().out.strip())
    assert output["already_has_contact"] == 1
    db = open_store(path)
    assert db.execute("SELECT COUNT(*) FROM exec_request WHERE operation='vendor_lookup'").fetchone()[0] == 5
    db.close()


class IdentityLane:
    capability_version = "identity-v1"

    def __init__(self, name, observations):
        self.name = name
        self.observations = observations

    def capabilities(self):
        return capabilities_for(self.name, self.capability_version)

    def plan(self, policy):
        return LanePlan(self.name, self.capability_version, self.capabilities(), YieldEstimate(1, 1, 1), 1)

    def run(self, plan, cursor):
        return LaneBatch(self.observations, None, 1, 1, True, None)


def _identity_observations(person, company, suffix):
    return (
        SimpleNamespace(observation_id=f"obs-company-{suffix}", entity_type="company", entity_id=company,
                        field="name", value=f"Synthetic {company}", source="fixture", seen_at=AT,
                        retrieved_at=AT, confidence=1.0, snapshot_id=None),
        SimpleNamespace(observation_id=f"obs-person-{suffix}", entity_type="person", entity_id=person,
                        field="full_name", value="Synthetic Person", source="fixture", seen_at=AT,
                        retrieved_at=AT, confidence=1.0, snapshot_id=None),
        SimpleNamespace(observation_id=f"obs-employer-{suffix}", entity_type="person", entity_id=person,
                        field="company_id", value=company, source="fixture", seen_at=AT,
                        retrieved_at=AT, confidence=1.0, snapshot_id=None),
    )


def test_person_identity_merges_lanes_and_stales_contacts_after_employer_change(tmp_path):
    db = open_store(tmp_path / "identity.sqlite")
    insert_campaign(db)
    policy = compile_target_policy(
        {"predicates": [], "requested_companies": 1, "requested_people": 1,
         "extra_fields": [], "lane_plan": ["manual", "pitchbook"], "scorer_version": "fit-v1"},
        lambda _: None,
    )
    db.execute("UPDATE campaign SET policy_hash=? WHERE campaign_id='campaign-1'", (policy.policy_hash,))
    db.commit()
    summary = build_list(
        db, "campaign-1", policy,
        (IdentityLane("manual", _identity_observations("source-a", "firm-old", "a")),
         IdentityLane("pitchbook", _identity_observations("source-b", "firm-old", "b"))),
        ListPipeline(lambda *_: None, lambda *_: None, lambda *_: None), AT,
    )
    assert summary.people == 1 and db.execute("SELECT COUNT(*) FROM person").fetchone()[0] == 1
    person_id = db.execute("SELECT person_id FROM person").fetchone()[0]
    old_company = db.execute("SELECT company_id FROM company WHERE name='Synthetic firm-old'").fetchone()[0]
    db.execute(
        "INSERT INTO contact_point(contact_id,person_id,employer_company_id,email,provider,adapter_version,retrieved_at,verified_at,state,confidence,bounce_history) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("contact-old", person_id, old_company, "opaque-email-ref", "manual", "fixture", AT, AT, "valid", 1.0, 0),
    )
    db.commit()
    changed_policy = compile_target_policy(
        {"predicates": [], "requested_companies": 1, "requested_people": 1,
         "extra_fields": [], "lane_plan": ["manual"], "scorer_version": "fit-v1"}, lambda _: None,
    )
    db.execute("UPDATE campaign SET policy_hash=? WHERE campaign_id='campaign-1'", (changed_policy.policy_hash,))
    db.commit()
    build_list(db, "campaign-1", changed_policy,
               (IdentityLane("manual", _identity_observations("source-c", "firm-new", "c")),),
               ListPipeline(lambda *_: None, lambda *_: None, lambda *_: None), "2026-09-03T00:01:00Z")
    assert db.execute("SELECT COUNT(*) FROM person").fetchone()[0] == 1
    assert db.execute("SELECT state FROM contact_point WHERE contact_id='contact-old'").fetchone()[0] == "stale"
    assert db.execute("SELECT COUNT(*) FROM employment WHERE valid_to IS NULL").fetchone()[0] == 1
