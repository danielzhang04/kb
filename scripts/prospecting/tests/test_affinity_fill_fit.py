"""Synthetic checks for fit-first composition of the frozen P6 fill lane."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from scripts.prospecting.affinity import fill_fit
from scripts.prospecting.affinity.anchors import load_anchors
from scripts.prospecting.affinity.fill_fit import fill_campaign_fit
from scripts.prospecting.fetcher import FetchResponse
from scripts.prospecting.operator import cli as operator_cli
from scripts.prospecting.operator import vendors
from scripts.prospecting.operator.fill import _request_id
from scripts.prospecting.store import open_store


ANCHORS = object()
STAMP = "2099-01-02T03:04:05Z"
FIXTURES = Path(__file__).resolve().parents[3] / "orgs" / "prospecting" / "fixtures" / "affinity"
REAL_ANCHORS = load_anchors(FIXTURES / "sender-anchors-synthetic.json")
REVIEW_FIXTURE = json.loads(
    (FIXTURES.parent / "review-synthetic.json").read_text(encoding="utf-8")
)["affinity_fill_fit"]
FIT_SPEC = {
    "version": 1,
    "paths": [{"path_id": "bank_to_vc", "label": "synthetic", "kinds": ["bank", "vc"], "weight": 26}],
    "role_families": [], "levels": [], "required_signals": [],
    "weighted_signals": {"shared_school": 30, "shared_prior_employer": 28, "path_match": 26,
                           "own_writing": 14, "board_or_portfolio": 10, "role_family_match": 10,
                           "firm_thesis": 8, "level_match": 6},
    "aside_signals": ["hometown", "shared_interest", "shared_activity"], "disqualifiers": [],
    "min_fit": 25, "require_strong_or_medium": True,
}


def _campaign(tmp_path, monkeypatch, scores: tuple[int, ...], *, pending: bool = False):
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None, name=None, lanes=("manual",)
    )
    for index, score in enumerate(scores, 1):
        company_id = f"cmp_{index:016x}"
        person_id = f"per_{index:016x}"
        connection.execute(
            "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
            (company_id, f"Synthetic Firm {index}", "manual", f"firm-{index}"),
        )
        connection.execute(
            "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
            (person_id, f"Synth{index}", f"Synthetic Person {index}", "manual", f"person-{index}"),
        )
        connection.execute(
            "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
            (f"obs_{index:016x}", "employment", person_id, "seed", "{}", "manual", STAMP, 1.0),
        )
        connection.execute(
            "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
            (f"emp_{index:016x}", person_id, company_id, "Synthetic Director", f"obs_{index:016x}", 1.0),
        )

    def research(connection, campaign_id, **_kwargs):
        if pending:
            connection.execute(
                "INSERT INTO person_research_state VALUES(?,?,?,?,?,?,?,?)",
                ("per_0000000000000001", campaign_id, "pending", 0, "pending", 0,
                 "research_budget_exhausted", STAMP),
            )
        return SimpleNamespace(researched=len(scores) - int(pending), unresearched=int(pending),
                               bio_pages_fetched=0, linkedin_loads_used=0)

    def score(connection, campaign_id, **_kwargs):
        for index, score in enumerate(scores, 1):
            connection.execute(
                "INSERT OR REPLACE INTO person_affinity VALUES(?,?,?,?,?,?)",
                (f"per_{index:016x}", campaign_id, score, "[]", STAMP, "a" * 64),
            )
        return SimpleNamespace(scored=len(scores))

    monkeypatch.setattr(fill_fit, "research_run", research)
    monkeypatch.setattr(fill_fit, "score_campaign", score)
    return connection, campaign_id


def _single_firm_campaign(tmp_path, monkeypatch, scores: tuple[int, ...], *,
                          prove_first: bool = False):
    """Three candidates competing for the same firm, scored deterministically by index."""
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None, name=None, lanes=("manual",)
    )
    company_id = "cmp_0000000000000001"
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        (company_id, "Synthetic Firm", "manual", "firm-1"),
    )
    for index, _score in enumerate(scores, 1):
        person_id = f"per_{index:016x}"
        connection.execute(
            "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
            (person_id, f"Synth{index}", f"Synthetic Person {index}", "manual", f"person-{index}"),
        )
        connection.execute(
            "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
            (f"obs_{index:016x}", "employment", person_id, "seed", "{}", "manual", STAMP, 1.0),
        )
        connection.execute(
            "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
            (f"emp_{index:016x}", person_id, company_id, "Synthetic Director", f"obs_{index:016x}", 1.0),
        )

    if prove_first:
        connection.execute(
            "INSERT INTO source_snapshot VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            ("snap_first_school", "per_0000000000000001",
             "https://synthetic.test/first-school", "synthetic.test", STAMP,
             "text/html", "a" * 64, "fixture-v1", "school",
             "2199-01-01T00:00:00Z", "2199-01-01T00:00:00Z"),
        )
        connection.execute(
            """INSERT INTO source_observation(
                   observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            ("obs_first_school", "person", "per_0000000000000001", "education",
             json.dumps({"excerpt": "Synthetic School alum"}), "snap_first_school",
             STAMP, STAMP, 0.9, "snap_first_school"),
        )
        connection.execute(
            "INSERT INTO person_education VALUES(?,?,?,?,?,?,?,?)",
            ("per_0000000000000001", 0, "synthetic school", "Synthetic School",
             None, None, None, "obs_first_school"),
        )

    def research(connection, campaign_id, **_kwargs):
        return SimpleNamespace(researched=len(scores), unresearched=0, bio_pages_fetched=0, linkedin_loads_used=0)

    def score(connection, campaign_id, **_kwargs):
        for index, score_value in enumerate(scores, 1):
            signals = []
            if prove_first and index == 1:
                signals.append({
                    "code": "shared_school", "klass": "strong", "strength": 100,
                    "weight": 30, "points": 30,
                    "observation_ids": ["obs_first_school"], "evidence_id": None,
                })
            connection.execute(
                "INSERT OR REPLACE INTO person_affinity VALUES(?,?,?,?,?,?)",
                (f"per_{index:016x}", campaign_id, score_value,
                 json.dumps(signals), STAMP, "a" * 64),
            )
        return SimpleNamespace(scored=len(scores))

    monkeypatch.setattr(fill_fit, "research_run", research)
    monkeypatch.setattr(fill_fit, "score_campaign", score)
    return connection, campaign_id, company_id


def _drain() -> None:
    """The P6 request rows stay queued; this fixture only proves their ordering."""


def _fixture_transport(url: str) -> FetchResponse:
    if url.endswith("/team/morgan-example"):
        body = (FIXTURES / "bio-person-full.html").read_bytes()
    elif url.endswith("/team"):
        body = (FIXTURES / "bio-team-index.html").read_bytes()
    else:
        body = b'<html><body><a href="/team">Team</a></body></html>'
    return FetchResponse(body, "text/html", url)


def _real_campaign(tmp_path, monkeypatch):
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None, name=None, lanes=("manual",)
    )
    company_id = "cmp_0000000000000001"
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (company_id, "Alpha Ventures", "https://alpha.test/", "manual", "alpha"),
    )
    for index, (first_name, full_name, title) in enumerate((
        ("Morgan", "Morgan Example", "Investor"), ("Taylor", "Taylor Example", "Analyst"),
    ), 1):
        person_id = f"per_{index:016x}"
        observation_id = f"obs_{index:016x}"
        connection.execute(
            "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
            (person_id, first_name, full_name, "manual", f"person-{index}"),
        )
        connection.execute(
            "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
            (observation_id, "employment", person_id, "seed", "{}", "manual", STAMP, 1.0),
        )
        connection.execute(
            "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
            (f"emp_{index:016x}", person_id, company_id, title, observation_id, 1.0),
        )
    connection.execute(
        "INSERT INTO campaign_fit_spec VALUES(?,?,?,?,?,?,?)",
        (campaign_id, "a" * 64, json.dumps(FIT_SPEC, sort_keys=True), STAMP, STAMP, "human:synthetic", "approved"),
    )
    monkeypatch.setattr(vendors, "_http", lambda url, policy: _fixture_transport(url))
    return connection, campaign_id, "per_0000000000000002"


def test_no_credit_is_reserved_for_an_unscored_candidate(tmp_path, monkeypatch, record_property) -> None:
    connection, campaign_id, below_fit_person = _real_campaign(tmp_path, monkeypatch)
    fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=2,
                      anchors=REAL_ANCHORS, execute=_drain, at=STAMP)
    unscored = connection.execute(
        """SELECT count(*) FROM credit_reservation AS r
           JOIN exec_request AS x ON x.request_id = r.exec_request_id
           WHERE r.campaign_id = ? AND x.operation = 'vendor_lookup'
             AND NOT EXISTS (
               SELECT 1 FROM person_affinity AS a
               WHERE a.campaign_id = r.campaign_id
                 AND a.person_id = json_extract(x.payload, '$.person_id'))""",
        (campaign_id,),
    ).fetchone()[0]
    assert unscored == 0
    assert connection.execute(
        "SELECT score FROM person_affinity WHERE campaign_id=? AND person_id=?", (campaign_id, below_fit_person)
    ).fetchone()[0] < FIT_SPEC["min_fit"]
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='vendor_lookup' "
        "AND json_extract(payload, '$.person_id')=?", (below_fit_person,)
    ).fetchone()[0] == 0
    record_property("credits_on_unscored", unscored)


def _delivered_person_campaign(tmp_path, monkeypatch, *, include_link: bool = False,
                               include_invalid_signal: bool = False,
                               missing_only: bool = False,
                               stale_evidence_id: bool = False):
    """One firm, one clearly-delivered candidate whose strong signals are backed by real,
    https-snapshotted source_observation rows -- exactly the shape score_campaign produces from
    real bio research, without depending on a live-shaped fetch to complete."""
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None, name=None, lanes=("manual",)
    )
    company_id, person_id = "cmp_0000000000000001", "per_0000000000000001"
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        (company_id, "Synthetic Firm", "manual", "firm-1"),
    )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (person_id, "Morgan", "Morgan Synthetic", "manual", "morgan-synthetic"),
    )
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("obs_seed", "employment", person_id, "seed", "{}", "manual", STAMP, 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
        ("emp_0000000000000001", person_id, company_id, "Synthetic Director", "obs_seed", 1.0),
    )
    connection.execute(
        "INSERT INTO source_snapshot VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("snap_bio", person_id, "https://synthetic.test/team/morgan", "synthetic.test",
         STAMP, "text/html", "a" * 64, "fixture-v1", "bio", "2199-01-01T00:00:00Z", "2199-01-01T00:00:00Z"),
    )
    for observation_id, field, excerpt in (
        ("obs_school_first", "education", "First College alum"),
        ("obs_employer_first", "employer", "First Employer experience"),
        ("obs_school", "education", "Newtown University alum"),
        ("obs_employer", "employer", "Meridian Bank experience"),
    ):
        connection.execute(
            """INSERT INTO source_observation(
                   observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (observation_id, "person", person_id, field, json.dumps({"excerpt": excerpt}),
             "snap_bio", STAMP, STAMP, 0.9, "snap_bio"),
        )
    connection.execute(
        "INSERT INTO person_education VALUES(?,?,?,?,?,?,?,?)",
        (person_id, 0, "first college", "First College", None, None, None, "obs_school_first"),
    )
    connection.execute(
        "INSERT INTO person_education VALUES(?,?,?,?,?,?,?,?)",
        (person_id, 1, "newtown university", "Newtown University", None, None, None, "obs_school"),
    )
    connection.execute(
        "INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)",
        (person_id, 0, "first employer", "First Employer", "corporate", None, None, 2089, "obs_employer_first"),
    )
    connection.execute(
        "INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)",
        (person_id, 1, "meridian bank", "Meridian Bank", "bank", None, None, 2090, "obs_employer"),
    )
    signal_rows = [
        {"code": "shared_school", "klass": "strong", "strength": 100, "weight": 30, "points": 30,
         "observation_ids": ["obs_school"], "evidence_id": None},
        {"code": "shared_prior_employer", "klass": "strong", "strength": 100, "weight": 28, "points": 28,
         "observation_ids": ["obs_employer"], "evidence_id": None},
    ]
    if include_link:
        connection.execute(
            """INSERT INTO source_observation(
                   observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            ("obs_board", "person", person_id, "link",
             json.dumps({"excerpt": "Board governance note"}), "snap_bio",
             STAMP, STAMP, 0.9, "snap_bio"),
        )
        connection.execute(
            "INSERT INTO person_link VALUES(?,?,?,?,?)",
            (person_id, 0, "board", "https://synthetic.test/board", "obs_board"),
        )
        signal_rows.append({
            "code": "board_or_portfolio", "klass": "medium", "strength": 100,
            "weight": 10, "points": 10, "observation_ids": ["obs_board"],
            "evidence_id": None,
        })
    if missing_only:
        signal_rows[:] = [{
            "code": "shared_school", "klass": "strong", "strength": 100,
            "weight": 30, "points": 30, "observation_ids": ["obs_missing"],
            "evidence_id": None,
        }]
    if include_invalid_signal:
        signal_rows.append({
            "code": "own_writing", "klass": "medium", "strength": 100,
            "weight": 14, "points": 14, "observation_ids": ["obs_missing"],
            "evidence_id": None,
        })
    if stale_evidence_id:
        signal_rows[0]["evidence_id"] = "e" * 64
        connection.execute(
            "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
            ("e" * 64, person_id, "Stale unrelated claim",
             "https://synthetic.test/stale", STAMP, STAMP, "Stale unrelated excerpt",
             0.9, "2199-01-01T00:00:00Z", 1),
        )

    def research(connection, campaign_id, **_kwargs):
        return SimpleNamespace(researched=1, unresearched=0, bio_pages_fetched=0, linkedin_loads_used=0)

    def score(connection, campaign_id, **_kwargs):
        connection.execute(
            "INSERT OR REPLACE INTO person_affinity VALUES(?,?,?,?,?,?)",
            (person_id, campaign_id, 58, json.dumps(signal_rows, sort_keys=True, separators=(",", ":")), STAMP, "a" * 64),
        )
        return SimpleNamespace(scored=1)

    monkeypatch.setattr(fill_fit, "research_run", research)
    monkeypatch.setattr(fill_fit, "score_campaign", score)
    return connection, campaign_id, person_id


def test_a_delivered_persons_strong_signals_get_evidence_minted(tmp_path, monkeypatch) -> None:
    # Gate P8-B criterion 1: every delivered (substituted=0) row's strong/medium signal must
    # carry an evidence_id that resolves to a real, https-sourced evidence row -- but evidence
    # used to be minted only at draft time, so a merely-scored-and-delivered row could carry
    # signals with no evidence_id at all.
    connection, campaign_id, delivered_person = _delivered_person_campaign(tmp_path, monkeypatch)
    summary = fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                                anchors=ANCHORS, execute=_drain, at=STAMP)

    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?", (campaign_id, delivered_person)
    ).fetchone()[0] == 0
    assert summary.evidence_minted == 2

    signals = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE campaign_id=? AND person_id=?",
        (campaign_id, delivered_person),
    ).fetchone()[0])
    assert {item["code"] for item in signals} == {"shared_school", "shared_prior_employer"}
    for signal in signals:
        assert signal["klass"] == "strong" and signal["points"]  # klass/points untouched by the rewrite
        assert signal["evidence_id"]
        url = connection.execute(
            "SELECT url FROM evidence WHERE evidence_id=?", (signal["evidence_id"],)
        ).fetchone()[0]
        assert url.startswith("https://")


def test_delivery_evidence_uses_signal_bound_nonfirst_rows_and_link_excerpt(
    tmp_path, monkeypatch,
) -> None:
    connection, campaign_id, person_id = _delivered_person_campaign(
        tmp_path, monkeypatch, include_link=True,
    )

    summary = fill_campaign_fit(
        connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
        anchors=ANCHORS, execute=_drain, at=STAMP,
    )

    assert summary.evidence_minted == 3 and summary.evidence_unresolved == 0
    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?",
        (campaign_id, person_id),
    ).fetchone()[0] == 0
    claims = [str(row[0]) for row in connection.execute(
        "SELECT claim FROM evidence WHERE person_id=? ORDER BY claim", (person_id,),
    )]
    assert "Attended Newtown University" in claims
    assert "Worked at Meridian Bank" in claims
    assert "Board governance note" in claims
    assert all("First College" not in claim and "First Employer" not in claim for claim in claims)


def test_zero_resolvable_delivery_proof_is_substituted_and_reported(
    tmp_path, monkeypatch,
) -> None:
    connection, campaign_id, person_id = _delivered_person_campaign(
        tmp_path, monkeypatch, missing_only=True,
    )

    summary = fill_campaign_fit(
        connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
        anchors=ANCHORS, execute=_drain, at=STAMP,
    )

    assert summary.evidence_minted == 0 and summary.evidence_unresolved == 1
    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?",
        (campaign_id, person_id),
    ).fetchone()[0] == 1
    assert tuple(connection.execute(
        "SELECT status,shortfall_reason FROM fill_firm WHERE campaign_id=?",
        (campaign_id,),
    ).fetchone()) == ("short", "evidence_unresolved")
    assert connection.execute(
        """SELECT count(*) FROM fill_person AS fill
           JOIN person_affinity AS affinity ON affinity.person_id=fill.person_id
             AND affinity.campaign_id=fill.campaign_id
          WHERE fill.campaign_id=? AND fill.substituted=0 AND NOT EXISTS (
            SELECT 1 FROM json_each(affinity.signals_json) AS signal
            JOIN evidence ON evidence.evidence_id=json_extract(signal.value,'$.evidence_id')
            WHERE json_extract(signal.value,'$.klass') IN ('strong','medium')
              AND evidence.url LIKE 'https://%')""",
        (campaign_id,),
    ).fetchone()[0] == 0


def test_one_valid_signal_keeps_delivery_when_an_extra_signal_is_unresolved(
    tmp_path, monkeypatch,
) -> None:
    connection, campaign_id, person_id = _delivered_person_campaign(
        tmp_path, monkeypatch, include_invalid_signal=True,
    )

    summary = fill_campaign_fit(
        connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
        anchors=ANCHORS, execute=_drain, at=STAMP,
    )

    assert summary.evidence_minted == 2 and summary.evidence_unresolved == 0
    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?",
        (campaign_id, person_id),
    ).fetchone()[0] == 0


def test_stale_evidence_id_cannot_prove_a_changed_unresolvable_signal(
    tmp_path, monkeypatch,
) -> None:
    connection, campaign_id, person_id = _delivered_person_campaign(
        tmp_path, monkeypatch, missing_only=True, stale_evidence_id=True,
    )

    summary = fill_campaign_fit(
        connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
        anchors=ANCHORS, execute=_drain, at=STAMP,
    )

    assert summary.evidence_unresolved == 1
    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?",
        (campaign_id, person_id),
    ).fetchone()[0] == 1


def test_proved_contact_count_deduplicates_multiple_contacts_for_one_person(
    tmp_path, monkeypatch,
) -> None:
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual",
        sender_profile_path=None, name=None, lanes=("manual",),
    )
    company_id = "cmp_0000000000000001"
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        (company_id, "Synthetic Firm", "manual", "firm-1"),
    )
    for index, substituted in ((1, 0), (2, 1)):
        person_id = f"per_{index:016x}"
        connection.execute(
            "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
            (person_id, f"Synth{index}", f"Synthetic Person {index}",
             "manual", f"person-{index}"),
        )
        connection.execute(
            "INSERT INTO fill_person VALUES(?,?,?,?,?)",
            (campaign_id, person_id, company_id, substituted, STAMP),
        )
        connection.execute(
            "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (f"contact-{index}-a", person_id, company_id, f"contact-ref-{index}-a",
                "manual", "fixture-v1", STAMP, STAMP, "valid", 0.9, 0),
        )
    # Exercise the query against stores that predate or do not retain the optional
    # one-valid-contact convenience index; correctness must not depend on it.
    connection.execute("DROP INDEX one_valid_contact_per_person")
    connection.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("contact-1-b", "per_0000000000000001", company_id, "contact-ref-1-b",
         "manual", "fixture-v1", STAMP, STAMP, "valid", 0.9, 0),
    )

    assert fill_fit._proved_contact_count(
        connection, campaign_id, company_id, 0.7,
    ) == 1


def test_evidence_minting_settles_to_the_same_state_on_a_second_pass(tmp_path, monkeypatch) -> None:
    connection, campaign_id, _delivered_person = _delivered_person_campaign(tmp_path, monkeypatch)
    fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                      anchors=ANCHORS, execute=_drain, at=STAMP)
    before_evidence = connection.execute("SELECT count(*) FROM evidence").fetchone()[0]
    before_signals = [
        tuple(row) for row in connection.execute(
            "SELECT person_id,signals_json FROM person_affinity WHERE campaign_id=? ORDER BY person_id", (campaign_id,)
        )
    ]

    fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                      anchors=ANCHORS, execute=_drain, at=STAMP)
    after_evidence = connection.execute("SELECT count(*) FROM evidence").fetchone()[0]
    after_signals = [
        tuple(row) for row in connection.execute(
            "SELECT person_id,signals_json FROM person_affinity WHERE campaign_id=? ORDER BY person_id", (campaign_id,)
        )
    ]
    assert after_evidence == before_evidence
    assert after_signals == before_signals


def test_a_firm_with_nobody_above_threshold_is_short_no_fit(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _campaign(tmp_path, monkeypatch, (0, 0))
    summary = fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                                anchors=ANCHORS, execute=_drain, at=STAMP)
    rows = connection.execute(
        "SELECT status,shortfall_reason FROM fill_firm WHERE campaign_id=?", (campaign_id,)
    ).fetchall()
    assert all((row["status"], row["shortfall_reason"]) == ("short", "no_fit") for row in rows)
    assert summary.firms_no_fit == len(rows)


def test_a_firm_is_never_met_while_a_candidate_is_still_pending(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _campaign(tmp_path, monkeypatch, (80,), pending=True)
    summary = fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                                anchors=ANCHORS, execute=_drain, at=STAMP)
    assert summary.candidates_unresearched > 0
    assert connection.execute(
        "SELECT count(*) FROM fill_firm WHERE campaign_id=? AND status='met'", (campaign_id,)
    ).fetchone()[0] == 0


def test_counts_keep_every_p6_key(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _campaign(tmp_path, monkeypatch, (80,))
    summary = fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                                anchors=ANCHORS, execute=_drain, at=STAMP)
    assert set(fill_fit.FillSummary.__dataclass_fields__) <= set(summary.counts()) | {"shortfall_reason"}


def test_fill_fit_never_queues_vendor_lookup_for_a_legacy_person_id(tmp_path, monkeypatch) -> None:
    connection, campaign_id = _campaign(tmp_path, monkeypatch, (80,))
    legacy_id = "123e4567-e89b-12d3-a456-426614174000"
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (legacy_id, "Legacy", "Legacy Person", "manual", "legacy-person"),
    )
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("obs_0000000000000002", "employment", legacy_id, "seed", "{}", "manual", STAMP, 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
        ("emp_0000000000000002", legacy_id, "cmp_0000000000000001", "Partner", "obs_0000000000000002", 1.0),
    )

    def score(connection, campaign_id, **_kwargs):
        for person_id in ("per_0000000000000001", legacy_id):
            connection.execute(
                "INSERT OR REPLACE INTO person_affinity VALUES(?,?,?,?,?,?)",
                (person_id, campaign_id, 80, "[]", STAMP, "a" * 64),
            )
        return SimpleNamespace(scored=2)

    monkeypatch.setattr(fill_fit, "score_campaign", score)
    summary = fill_campaign_fit(connection, campaign_id, target_per_firm=2, max_candidates_per_firm=2,
                                anchors=ANCHORS, execute=_drain, at=STAMP)

    assert summary.skipped_untyped == 1
    assert connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='vendor_lookup' "
        "AND json_extract(payload, '$.person_id')=?", (legacy_id,),
    ).fetchone()[0] == 0


def test_second_pass_queues_no_new_exec_request(tmp_path, monkeypatch, record_property) -> None:
    connection, campaign_id = _campaign(tmp_path, monkeypatch, (80,))
    fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                      anchors=ANCHORS, execute=_drain, at=STAMP)
    before = connection.execute("SELECT count(*) FROM exec_request").fetchone()[0]
    fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                      anchors=ANCHORS, execute=_drain, at=STAMP)
    assert connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == before
    record_property("refire_noop_runs", 1)


def test_only_the_candidate_at_or_above_min_fit_is_not_substituted(tmp_path, monkeypatch) -> None:
    connection, campaign_id, company_id = _single_firm_campaign(
        tmp_path, monkeypatch, (40, 20, 10), prove_first=True,
    )
    connection.execute(
        "INSERT INTO contact_point(contact_id,person_id,employer_company_id,email,provider,adapter_version,"
        "retrieved_at,verified_at,state,confidence,bounce_history) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("cp_0000000000000001", "per_0000000000000001", company_id, REVIEW_FIXTURE["contact_email"], "manual", "v1",
         STAMP, STAMP, "valid", 0.9, 0),
    )
    summary = fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=3,
                                min_fit=25, anchors=ANCHORS, execute=_drain, at=STAMP)
    substituted = {
        str(row["person_id"]): int(row["substituted"])
        for row in connection.execute("SELECT person_id,substituted FROM fill_person WHERE campaign_id=?", (campaign_id,))
    }
    assert substituted == {"per_0000000000000001": 0, "per_0000000000000002": 1, "per_0000000000000003": 1}
    assert summary.base.people_delivered == 1

    before = connection.execute(
        "SELECT person_id,substituted FROM fill_person WHERE campaign_id=? ORDER BY person_id", (campaign_id,)
    ).fetchall()
    before_requests = connection.execute("SELECT count(*) FROM exec_request").fetchone()[0]
    fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=3,
                      min_fit=25, anchors=ANCHORS, execute=_drain, at=STAMP)
    after = connection.execute(
        "SELECT person_id,substituted FROM fill_person WHERE campaign_id=? ORDER BY person_id", (campaign_id,)
    ).fetchall()
    assert [tuple(row) for row in after] == [tuple(row) for row in before]
    assert connection.execute("SELECT count(*) FROM exec_request").fetchone()[0] == before_requests


def test_an_above_fit_person_who_finished_without_a_confident_contact_is_substituted(tmp_path, monkeypatch) -> None:
    # P6 semantics (operator/fill.py's own fill_campaign): a candidate is only ever "delivered"
    # when its email search actually finished with a confident contact -- above min_fit alone is
    # not enough. Pre-seed a finished-but-contactless exec_request for the one candidate so
    # fill_campaign_fit sees the search as already resolved (never queues it, never runs it).
    connection, campaign_id, company_id = _single_firm_campaign(tmp_path, monkeypatch, (40,))
    person_id = "per_0000000000000001"
    connection.execute(
        """INSERT INTO exec_request(request_id,caller,operation,payload,policy_hash,created_at,state)
           VALUES(?,?,?,?,?,?,?)""",
        (_request_id(campaign_id, person_id), "test", "vendor_lookup", "{}", "a" * 64, STAMP, "succeeded"),
    )
    summary = fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                                min_fit=25, anchors=ANCHORS, execute=_drain, at=STAMP)
    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?", (campaign_id, person_id)
    ).fetchone()[0] == 1
    assert summary.base.people_delivered == 0


def _path_role_level_campaign(
    tmp_path, monkeypatch, *, current_excerpt: str = "Morgan is Director at Synthetic Firm",
):
    """One firm, one candidate whose only strong/medium signals are path_match, role_family_match,
    and level_match -- runs through the real (unmocked) score_campaign, with real https-snapshotted
    source_observation rows backing the career-path history, so this exercises the actual scoring
    and evidence-citation fixes end to end rather than a hand-built Affinity fixture."""
    monkeypatch.setenv("KB_PROSPECTING_STORE", str(tmp_path / "store.sqlite"))
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, _campaigns, _policies = operator_cli._insert_campaign(
        connection, ask="intent:networking lane:manual", sender_profile_path=None, name=None, lanes=("manual",)
    )
    company_id, person_id = "cmp_0000000000000001", "per_0000000000000001"
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        (company_id, "Synthetic Firm", "manual", "firm-1"),
    )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        (person_id, "Morgan", "Morgan Synthetic", "manual", "morgan-synthetic"),
    )
    # employment.source_observation_id points at a bare "seed" observation with no snapshot at all
    # -- role_family_match/level_match must fall back to the bio-derived current-employer
    # observation below rather than fail outright when this one is unresolvable.
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("obs_seed", "employment", person_id, "seed", "{}", "manual", STAMP, 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
        ("emp_0000000000000001", person_id, company_id, "Director", "obs_seed", 1.0),
    )
    connection.execute(
        "INSERT INTO source_snapshot VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("snap_bio", person_id, "https://synthetic.test/team/morgan", "synthetic.test",
         STAMP, "text/html", "a" * 64, "fixture-v1", "bio", "2199-01-01T00:00:00Z", "2199-01-01T00:00:00Z"),
    )
    for observation_id, excerpt in (
        ("obs_consultancy", "Formerly at a consultancy"),
        ("obs_vc_employer", current_excerpt),
    ):
        connection.execute(
            """INSERT INTO source_observation(
                   observation_id,entity_type,entity_id,field,value,source,seen_at,retrieved_at,confidence,snapshot_id
               ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (observation_id, "person", person_id, "employer", json.dumps({"excerpt": excerpt}),
             "snap_bio", STAMP, STAMP, 0.9, "snap_bio"),
        )
    connection.execute(
        "INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)",
        (person_id, 0, "prior consultancy", "Prior Consultancy", "consultancy", None, 2090, 2093, "obs_consultancy"),
    )
    connection.execute(
        "INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)",
        (person_id, 1, "synthetic firm", "Synthetic Firm", "vc", "Director", 2093, None, "obs_vc_employer"),
    )
    fit_spec = {
        "version": 1,
        "paths": [{"path_id": "consultancy_to_vc", "label": "synthetic", "kinds": ["consultancy", "vc"], "weight": 26}],
        "role_families": [{"family_id": "investing", "label": "investing", "title_tokens": ["director"], "required": False}],
        "levels": ["director"], "required_signals": [],
        "weighted_signals": {"path_match": 26, "role_family_match": 10, "level_match": 6},
        "aside_signals": [], "disqualifiers": [],
        "min_fit": 25, "require_strong_or_medium": True,
    }
    connection.execute(
        "INSERT INTO campaign_fit_spec VALUES(?,?,?,?,?,?,?)",
        (campaign_id, "d" * 64, json.dumps(fit_spec, sort_keys=True), STAMP, STAMP, "human:synthetic", "approved"),
    )

    def research(connection, campaign_id, **_kwargs):
        return SimpleNamespace(researched=1, unresearched=0, bio_pages_fetched=0, linkedin_loads_used=0)

    monkeypatch.setattr(fill_fit, "research_run", research)
    return connection, campaign_id, person_id


def test_path_match_role_family_and_level_signals_get_cited_evidence(tmp_path, monkeypatch) -> None:
    # Gate P8-B criterion 1: every delivered row needs at least one strong/medium signal with a
    # resolvable, https-sourced evidence_id. This person's only strong/medium signals are
    # path_match, role_family_match, and level_match -- codes _mint_delivered_evidence used to
    # have no slot for at all, so none of them ever got cited.
    connection, campaign_id, person_id = _path_role_level_campaign(tmp_path, monkeypatch)
    fill_campaign_fit(connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
                      anchors=REAL_ANCHORS, execute=_drain, at=STAMP)

    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?", (campaign_id, person_id)
    ).fetchone()[0] == 0

    signals = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE campaign_id=? AND person_id=?", (campaign_id, person_id)
    ).fetchone()[0])
    codes = {item["code"] for item in signals}
    assert {"path_match", "role_family_match", "level_match"} <= codes

    cited = 0
    for item in signals:
        if item["klass"] in {"strong", "medium"} and item.get("evidence_id"):
            url = connection.execute(
                "SELECT url FROM evidence WHERE evidence_id=?", (item["evidence_id"],)
            ).fetchone()
            if url is not None and str(url[0]).startswith("https://"):
                cited += 1
    assert cited >= 1

    # The corrected Gate P8-B criterion 1 (json key is "klass", not the plan doc's stale "class").
    uncited_rows = connection.execute(
        """SELECT count(*) FROM fill_person AS f
           JOIN person_affinity AS a ON a.person_id = f.person_id AND a.campaign_id = f.campaign_id
           WHERE f.campaign_id = ? AND f.substituted = 0 AND NOT EXISTS (
             SELECT 1 FROM json_each(a.signals_json) AS s
             JOIN evidence AS e ON e.evidence_id = json_extract(s.value, '$.evidence_id')
             WHERE json_extract(s.value, '$.klass') IN ('strong','medium') AND e.url LIKE 'https://%')""",
        (campaign_id,),
    ).fetchone()[0]
    assert uncited_rows == 0

    # The path_match claim carries kinds only, never employer names.
    path_signal = next(item for item in signals if item["code"] == "path_match")
    path_claim = connection.execute(
        "SELECT claim FROM evidence WHERE evidence_id=?", (path_signal["evidence_id"],)
    ).fetchone()
    if path_claim is not None:
        assert "Prior Consultancy" not in path_claim[0] and "Synthetic Firm" not in path_claim[0]


def test_current_classification_cannot_use_an_unrelated_bio_excerpt(tmp_path, monkeypatch) -> None:
    connection, campaign_id, person_id = _path_role_level_campaign(
        tmp_path, monkeypatch, current_excerpt="A generic career biography",
    )

    summary = fill_campaign_fit(
        connection, campaign_id, target_per_firm=1, max_candidates_per_firm=1,
        anchors=REAL_ANCHORS, execute=_drain, at=STAMP,
    )

    assert summary.evidence_minted == 0 and summary.evidence_unresolved == 1
    assert connection.execute(
        "SELECT substituted FROM fill_person WHERE campaign_id=? AND person_id=?",
        (campaign_id, person_id),
    ).fetchone()[0] == 1
