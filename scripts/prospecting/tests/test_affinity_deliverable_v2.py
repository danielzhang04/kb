"""Synthetic H6 coverage for the deliverable fit threshold."""

from __future__ import annotations

import json

from scripts.prospecting.tests.test_affinity_evidence_bridge import _scored_person


def _contact(connection, contact_id: str, person_id: str, company_id: str) -> None:
    connection.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (contact_id, person_id, company_id, f"{person_id}@affinity.test", "manual", "fixture",
         "2099-12-01T00:00:00Z", None, "valid", 1.0, 0),
    )


def test_deliverable_excludes_selected_people_below_approved_min_fit(tmp_path, monkeypatch, record_property) -> None:
    connection, selected_person, campaign_id, _affinity = _scored_person(tmp_path, monkeypatch)
    company_id = "cmp_0000000000000001"
    below_person = "per_0000000000000002"
    connection.execute(
        "INSERT INTO campaign_fit_spec VALUES(?,?,?,?,?,?,?)",
        (campaign_id, "d" * 64, json.dumps({"min_fit": 25}), "2099-12-01T00:00:00Z",
         "2099-12-01T00:00:00Z", "human:synthetic", "approved"),
    )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (below_person, "Taylor", "Taylor Synthetic", "manual", "taylor-synthetic"),
    )
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("obs_0000000000000002", "employment", below_person, "seed", "{}", "manual", "2099-12-01T00:00:00Z", 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
        ("emp_0000000000000002", below_person, company_id, "Analyst", "obs_0000000000000002", 1.0),
    )
    connection.execute(
        "INSERT INTO fill_firm VALUES(?,?,?,?,?,?,?)",
        (campaign_id, company_id, 2, 2, "selected", None, "2099-12-01T00:00:00Z"),
    )
    for person_id in (selected_person, below_person):
        connection.execute(
            "INSERT INTO fill_person VALUES(?,?,?,?,?)",
            (campaign_id, person_id, company_id, 0, "2099-12-01T00:00:00Z"),
        )
    connection.execute(
        "UPDATE person_affinity SET score=40 WHERE person_id=? AND campaign_id=?",
        (selected_person, campaign_id),
    )
    connection.execute(
        "INSERT INTO person_affinity VALUES(?,?,?,?,?,?)",
        (below_person, campaign_id, 10, "[]", "2099-12-01T00:00:00Z", "e" * 64),
    )
    _contact(connection, "cp_0000000000000001", selected_person, company_id)
    _contact(connection, "cp_0000000000000002", below_person, company_id)

    assert [row["score"] for row in connection.execute(
        "SELECT score FROM deliverable_v2 WHERE campaign_id=? ORDER BY score DESC", (campaign_id,)
    )] == [40]
    record_property("delivered_below_min_fit", 0)
