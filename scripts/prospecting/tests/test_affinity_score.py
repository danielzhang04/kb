"""Synthetic coverage for deterministic affinity scoring."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.prospecting.affinity.anchors import load_anchors
from scripts.prospecting.affinity.fitspec import fit_spec_hash
from scripts.prospecting.affinity.score import path_ratio, score_campaign, score_person
from scripts.prospecting.store import open_store


FIXTURES = Path(__file__).resolve().parents[3] / "orgs" / "prospecting" / "fixtures" / "affinity"
ANCHORS = load_anchors(FIXTURES / "sender-anchors-synthetic.json")
EXPECTED = json.loads((FIXTURES / "affinity-expected.json").read_text(encoding="utf-8"))


def _spec(**changes: object) -> dict[str, object]:
    result: dict[str, object] = {
        "version": 1,
        "paths": [{"path_id": "bank_to_startup", "label": "synthetic", "kinds": ["bank", "startup"], "weight": 26}],
        "role_families": [{"family_id": "operations", "label": "operations", "title_tokens": ["operations"], "required": False}],
        "levels": ["director"], "required_signals": [],
        "weighted_signals": {"shared_school": 30, "shared_prior_employer": 28, "path_match": 26, "own_writing": 14, "board_or_portfolio": 10, "role_family_match": 10, "firm_thesis": 8, "level_match": 6},
        "aside_signals": ["hometown", "shared_interest", "shared_activity"], "disqualifiers": [],
        "min_fit": 25, "require_strong_or_medium": True,
    }
    result.update(changes)
    return result


def _base(**changes: object) -> dict[str, object]:
    result: dict[str, object] = {
        "spec": _spec(), "anchors": ANCHORS,
        "background": {"current_kind": "startup", "kind_sequence": ["bank", "startup"]},
        "education": (), "employers": (), "links": (), "title": "Operations Director", "level": "director",
        "person_id": "person-synthetic", "campaign_id": "campaign-synthetic",
    }
    result.update(changes)
    return result


def _only(signal: str) -> dict[str, object]:
    values = _base(background={"current_kind": "other", "kind_sequence": []}, title="Analyst", level=None)
    if signal == "shared_school":
        values["education"] = ({"school_norm": "newtown university", "observation_id": "obs-school"},)
    elif signal == "shared_prior_employer":
        # employer_kind is deliberately outside the default spec's ["bank", "startup"]
        # path so this stays a single-signal fixture: score.py now rebuilds the career
        # path from these very employer rows (never the background override below).
        values["employers"] = ({"employer_norm": "meridian bank", "employer_kind": "consultancy", "observation_id": "obs-employer"},)
    elif signal == "path_match_strong":
        values["background"] = {"current_kind": "startup", "kind_sequence": ["bank", "startup"]}
    elif signal == "path_match_partial":
        values["spec"] = _spec(paths=[{"path_id": "bank_to_vc", "label": "synthetic", "kinds": ["bank", "vc"], "weight": 26}])
        values["background"] = {"current_kind": "vc", "kind_sequence": ["corporate", "bigtech", "vc"]}
    elif signal == "own_writing":
        values["links"] = ({"kind": "writing", "observation_id": "obs-writing"},)
    elif signal == "weak_only":
        values["background"] = {"current_kind": "other", "kind_sequence": [], "hometown_hint": "Test Harbor"}
        values["spec"] = _spec(weighted_signals={"hometown": 40})
    else:
        raise AssertionError(signal)
    return values


@pytest.mark.parametrize("signal,expected,qualifies", EXPECTED["single_signal"])
def test_each_signal_alone_against_min_fit_25(signal: str, expected: int, qualifies: bool) -> None:
    result = score_person(**_only(signal))
    assert result.score == expected
    assert (result.score >= 25) is qualifies


@pytest.mark.parametrize("person,target,current,ratio", EXPECTED["path_ratios"])
def test_path_ratio_arithmetic(person: list[str], target: list[str], current: str, ratio: int) -> None:
    assert path_ratio(person, target, current) == ratio


def test_path_similarity_is_stable_under_a_reordered_run_of_identical_kinds() -> None:
    assert path_ratio(["bank", "bank", "vc"], ["bank", "vc"], "vc") == 95
    assert path_ratio(["bank", "vc", "vc"], ["bank", "vc"], "vc") == 95
    assert path_ratio(["vc", "bank"], ["bank", "vc"], "vc") == 65


def test_a_disqualifier_zeroes_a_would_be_ninety() -> None:
    result = score_person(**_base(
        education=({"school_norm": "newtown university", "observation_id": "obs-school"},),
        employers=({"employer_norm": "meridian bank", "employer_kind": "bank", "observation_id": "obs-employer"},),
        links=({"kind": "writing", "observation_id": "obs-writing"},),
        spec=_spec(disqualifiers=[{"kind": "title_token", "value": "recruiter"}]), title="Recruiter",
    ))
    assert result.score == 0
    assert [signal.code for signal in result.signals] == ["disqualified_title_token"]


def test_required_signal_missing_zeroes_the_score() -> None:
    result = score_person(**_base(spec=_spec(required_signals=["shared_school"])))
    assert result.score == 0 and result.signals[0].code == "required_missing"


def _role_family_spec(**changes: object) -> dict[str, object]:
    result = _spec(
        role_families=[{"family_id": "investing", "label": "investing",
                        "title_tokens": ["director", "associate", "principal", "partner"], "required": True}],
        required_signals=["role_family_match"],
    )
    result.update(changes)
    return result


@pytest.mark.parametrize("title,excluded_token", [
    ("Director of Growth - VC Platform", "platform"),
    ("Talent Director", "talent"),
])
def test_a_title_function_excluded_title_never_earns_the_required_role_family(title: str, excluded_token: str) -> None:
    result = score_person(**_base(spec=_role_family_spec(), title=title, level=None))
    assert result.score == 0
    assert [signal.code for signal in result.signals] == [f"role_family_excluded:{excluded_token}"]
    assert title not in result.signals[0].code


@pytest.mark.parametrize("title", ["Associate", "Senior Associate, Investments"])
def test_a_non_excluded_investing_title_matches_the_role_family(title: str) -> None:
    result = score_person(**_base(spec=_role_family_spec(), title=title, level=None))
    assert any(signal.code == "role_family_match" for signal in result.signals)
    assert not any(signal.code.startswith("role_family_excluded:") for signal in result.signals)


def test_operator_override_exclusions_replace_the_default_list_entirely() -> None:
    kwargs = _base(spec=_role_family_spec(), title="Director of Something Custom", level=None)
    unaffected = score_person(**kwargs)
    assert any(signal.code == "role_family_match" for signal in unaffected.signals)

    excluded = score_person(**kwargs, exclusions=("custom",))
    assert excluded.score == 0
    assert excluded.signals[0].code == "role_family_excluded:custom"


def test_weak_only_candidate_is_rejected_even_above_min_fit(record_property: pytest.RecordProperty) -> None:
    result = score_person(**_only("weak_only"))
    assert not any(signal.klass in {"strong", "medium"} for signal in result.signals)
    assert result.score == 0
    record_property("weak_only_rows", 0)


def test_adjacent_pair_matches_are_recorded_at_zero_points() -> None:
    result = score_person(**_base(
        background={"current_kind": "vc", "kind_sequence": ["bank", "vc"]},
        spec=_spec(paths=[{"path_id": "bank_to_vc", "label": "synthetic", "kinds": ["bank", "vc"], "weight": 26}]),
    ))
    pair = [signal for signal in result.signals if signal.code == "path_pair_observed"]
    assert pair and pair[0].points == 0


def _scored(tmp_path: Path) -> tuple[object, str]:
    connection = open_store(tmp_path / "store.sqlite")
    campaign_id, person_id = "camp_0000000000000001", "per_0000000000000001"
    spec, digest = _spec(), fit_spec_hash(_spec())
    connection.execute("INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)", ("sender", "Synthetic", None, "synthetic", "synthetic", "synthetic", "[]"))
    connection.execute("INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (campaign_id, "networking", "sender", "{}", "informational_call", 15, "direct", "fixture", "[]", "09:00-17:00", "UTC", 1, 1, 1, "T1", "mailbox", "{}", 0, "draft", "a" * 64))
    connection.execute("INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)", (person_id, "Morgan", "Morgan Synthetic", "manual", "morgan-synthetic"))
    connection.execute("INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)", ("cmp_missing", "Synthetic Firm", "manual", "synthetic-firm"))
    connection.execute("INSERT INTO fill_person VALUES(?,?,?,?,?)", (campaign_id, person_id, "cmp_missing", 0, "2099-01-01T00:00:00Z"))
    connection.execute("INSERT INTO campaign_fit_spec VALUES(?,?,?,?,?,?,?)", (campaign_id, digest, json.dumps(spec, sort_keys=True, separators=(",", ":")), "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z", "human:synthetic", "approved"))
    connection.execute("INSERT INTO person_background VALUES(?,?,?,?,?,?)", (person_id, 0, None, "startup", '["bank","startup"]', "2099-01-01T00:00:00Z"))
    connection.execute("INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)", ("obs-school", "person", person_id, "school", "\"Newtown University\"", "manual", "2099-01-01T00:00:00Z", 1.0))
    connection.execute("INSERT INTO person_education VALUES(?,?,?,?,?,?,?,?)", (person_id, 0, "newtown university", "Newtown University", None, None, None, "obs-school"))
    score_campaign(connection, campaign_id, anchors=ANCHORS, now="2099-12-30T00:00:00Z")
    return connection, campaign_id


def test_recompute_skips_unchanged_rows(tmp_path: Path) -> None:
    connection, campaign_id = _scored(tmp_path)
    stamp = connection.execute("SELECT computed_at FROM person_affinity").fetchone()[0]
    summary = score_campaign(connection, campaign_id, anchors=ANCHORS, now="2099-12-31T00:00:00Z")
    assert summary.rewritten == 0
    assert connection.execute("SELECT computed_at FROM person_affinity").fetchone()[0] == stamp


def _mint_fake_evidence(connection, person_id: str, evidence_id: str) -> None:
    """Simulate the evidence bridge having already minted and recorded evidence for a signal."""
    connection.execute(
        """INSERT INTO evidence(evidence_id,person_id,claim,url,observed_at,retrieved_at,excerpt,
               confidence,expires_at,allowed_for_copy) VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (evidence_id, person_id, "Attended Newtown University", "https://evidence.test/school",
         "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z", "Newtown University alum", 0.9,
         "2199-01-01T00:00:00Z", 1),
    )


def _set_evidence_id(connection, campaign_id: str, person_id: str, code: str, evidence_id: str) -> None:
    signals = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE campaign_id=? AND person_id=?", (campaign_id, person_id)
    ).fetchone()[0])
    for item in signals:
        if item["code"] == code:
            item["evidence_id"] = evidence_id
    connection.execute(
        "UPDATE person_affinity SET signals_json=? WHERE campaign_id=? AND person_id=?",
        (json.dumps(signals, sort_keys=True, separators=(",", ":")), campaign_id, person_id),
    )


def test_rescoring_preserves_a_previously_minted_evidence_id_when_points_are_unchanged(tmp_path: Path) -> None:
    connection, campaign_id = _scored(tmp_path)
    person_id = "per_0000000000000001"
    evidence_id = "e" * 64
    _mint_fake_evidence(connection, person_id, evidence_id)
    _set_evidence_id(connection, campaign_id, person_id, "shared_school", evidence_id)

    summary = score_campaign(connection, campaign_id, anchors=ANCHORS, now="2099-12-31T00:00:00Z")
    assert summary.rewritten == 0

    stored = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE campaign_id=? AND person_id=?", (campaign_id, person_id)
    ).fetchone()[0])
    assert next(item for item in stored if item["code"] == "shared_school")["evidence_id"] == evidence_id


def test_rescoring_with_changed_points_still_rewrites_but_keeps_the_evidence_id(tmp_path: Path) -> None:
    connection, campaign_id = _scored(tmp_path)
    person_id = "per_0000000000000001"
    evidence_id = "e" * 64
    _mint_fake_evidence(connection, person_id, evidence_id)
    _set_evidence_id(connection, campaign_id, person_id, "shared_school", evidence_id)

    new_spec = _spec(weighted_signals={
        "shared_school": 50, "shared_prior_employer": 28, "path_match": 26, "own_writing": 14,
        "board_or_portfolio": 10, "role_family_match": 10, "firm_thesis": 8, "level_match": 6,
    })
    new_digest = fit_spec_hash(new_spec)
    connection.execute("UPDATE campaign_fit_spec SET state='superseded' WHERE campaign_id=?", (campaign_id,))
    connection.execute(
        "INSERT INTO campaign_fit_spec VALUES(?,?,?,?,?,?,?)",
        (campaign_id, new_digest, json.dumps(new_spec, sort_keys=True, separators=(",", ":")),
         "2099-12-31T00:00:00Z", "2099-12-31T00:00:00Z", "human:synthetic", "approved"),
    )

    summary = score_campaign(connection, campaign_id, anchors=ANCHORS, now="2099-12-31T00:00:00Z")
    assert summary.rewritten == 1

    stored = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE campaign_id=? AND person_id=?", (campaign_id, person_id)
    ).fetchone()[0])
    school_signal = next(item for item in stored if item["code"] == "shared_school")
    assert school_signal["points"] == 50
    assert school_signal["evidence_id"] == evidence_id


def test_score_campaign_repairs_a_stale_kind_history_from_the_authoritative_employer_rows(tmp_path: Path) -> None:
    connection, campaign_id = _scored(tmp_path)
    person_id = "per_0000000000000001"
    # person_employer is the sole source of truth; this row is the person's only prior (former)
    # role. A legacy, pre-chronological-fix write left person_background storing the wrong,
    # most-recent-first pair -- "ex-vc" instead of the correct "ex-consultancy" -- exactly the
    # masked blurb bug this reconciliation exists to repair.
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) "
        "VALUES(?,?,?,?,?,?,?,?)",
        ("obs-consultancy", "person", person_id, "employer", "{}", "manual", "2099-01-01T00:00:00Z", 1.0),
    )
    connection.execute(
        "INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)",
        (person_id, 0, "stale co", "Stale Co", "consultancy", None, 2095, 2098, "obs-consultancy"),
    )
    connection.execute(
        "UPDATE person_background SET current_kind=?,kind_sequence=? WHERE person_id=?",
        ("vc", json.dumps(["vc", "consultancy"]), person_id),
    )
    score_campaign(connection, campaign_id, anchors=ANCHORS, now="2099-12-31T00:00:00Z")
    row = connection.execute(
        "SELECT current_kind,kind_sequence FROM person_background WHERE person_id=?", (person_id,)
    ).fetchone()
    assert row["current_kind"] == "consultancy"
    assert json.loads(row["kind_sequence"]) == ["consultancy"]


def test_background_reconciliation_is_a_no_op_once_it_already_matches_the_employer_rows(tmp_path: Path) -> None:
    connection, campaign_id = _scored(tmp_path)
    person_id = "per_0000000000000001"
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) "
        "VALUES(?,?,?,?,?,?,?,?)",
        ("obs-consultancy", "person", person_id, "employer", "{}", "manual", "2099-01-01T00:00:00Z", 1.0),
    )
    connection.execute(
        "INSERT INTO person_employer VALUES(?,?,?,?,?,?,?,?,?)",
        (person_id, 0, "stale co", "Stale Co", "consultancy", None, 2095, 2098, "obs-consultancy"),
    )
    connection.execute(
        "UPDATE person_background SET current_kind=?,kind_sequence=?,updated_at=? WHERE person_id=?",
        ("consultancy", json.dumps(["consultancy"]), "2099-01-01T00:00:00Z", person_id),
    )
    score_campaign(connection, campaign_id, anchors=ANCHORS, now="2099-12-31T00:00:00Z")
    row = connection.execute("SELECT updated_at FROM person_background WHERE person_id=?", (person_id,)).fetchone()
    assert row["updated_at"] == "2099-01-01T00:00:00Z"


def _employer_row(kind: str, start_year: int | None, end_year: int | None) -> dict[str, object]:
    return {
        "employer_norm": f"{kind}-firm-unmatched", "employer_kind": kind,
        "start_year": start_year, "end_year": end_year, "observation_id": f"obs-{kind}-{start_year}",
    }


# other(2087)->pe(2089)->consultancy(2091)->vc(2093, current). Handed to score_person in a
# shuffled, non-chronological list (mirroring how a stored row order or a SELECT without an
# ORDER BY could arrive) to prove the ordering comes from start_year, never row order.
CHRONOLOGICAL_EMPLOYERS = (
    _employer_row("vc", 2093, None),
    _employer_row("other", 2087, 2089),
    _employer_row("consultancy", 2091, 2093),
    _employer_row("pe", 2089, 2091),
)
INVESTING_PATH = ["bank", "hedge_fund", "pe", "startup", "vc"]


def _investing_path_spec() -> dict[str, object]:
    return _spec(paths=[{"path_id": "investing", "label": "synthetic", "kinds": INVESTING_PATH, "weight": 26}])


def test_path_match_rebuilds_the_chronological_sequence_from_employer_rows() -> None:
    # "other" is dropped (more than one kind survives): ["pe", "consultancy", "vc"].
    expected_ratio = path_ratio(["pe", "consultancy", "vc"], INVESTING_PATH, "vc")
    assert expected_ratio == 65

    result = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        employers=CHRONOLOGICAL_EMPLOYERS, spec=_investing_path_spec(), title="Investor", level=None,
    ))
    path_signal = next(signal for signal in result.signals if signal.code == "path_match")
    assert (path_signal.strength, path_signal.points) == (70, 18)
    assert result.score == 18


def test_path_match_ignores_a_reversed_stored_kind_sequence_when_employer_rows_exist() -> None:
    with_real_history = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        employers=CHRONOLOGICAL_EMPLOYERS, spec=_investing_path_spec(), title="Investor", level=None,
    ))
    with_reversed_stored_background = score_person(**_base(
        background={"current_kind": "vc", "kind_sequence": ["vc", "consultancy", "pe", "other"]},
        employers=CHRONOLOGICAL_EMPLOYERS, spec=_investing_path_spec(), title="Investor", level=None,
    ))
    assert with_reversed_stored_background.score == with_real_history.score == 18
    assert [s.code for s in with_reversed_stored_background.signals] == [s.code for s in with_real_history.signals]


def test_level_match_falls_back_to_title_when_seniority_class_is_null() -> None:
    result = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        spec=_spec(levels=["associate", "senior associate", "analyst", "director"], role_families=[], required_signals=[]),
        title="Associate", level=None,
    ))
    assert any(signal.code == "level_match" for signal in result.signals)


def test_a_real_seniority_class_wins_over_the_title_derived_fallback() -> None:
    # Title alone ("Associate") would never derive to "director" -- a real, present
    # seniority_class must still decide level_match on its own, ignoring the title.
    spec = _spec(levels=["director"], role_families=[], required_signals=[])
    with_real_seniority_class = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        spec=spec, title="Associate", level="director",
    ))
    assert any(signal.code == "level_match" for signal in with_real_seniority_class.signals)

    without_seniority_class = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        spec=spec, title="Associate", level=None,
    ))
    assert not any(signal.code == "level_match" for signal in without_seniority_class.signals)


def test_a_p6_seniority_class_outside_the_fit_specs_own_levels_falls_back_to_the_title() -> None:
    # "individual" is a real person_profile.seniority_class value, but it is a P6 class the fit
    # spec never declared as one of its own levels -- it must not be used verbatim as the level;
    # the title-derived fallback ("Associate" -> "associate") must still get a chance to fire.
    spec = _spec(levels=["associate", "director"], role_families=[], required_signals=[])
    result = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        spec=spec, title="Associate", level="individual",
    ))
    assert any(signal.code == "level_match" for signal in result.signals)


def test_a_seniority_class_that_is_itself_a_fit_spec_level_still_wins_over_the_title() -> None:
    # "director" is both a real seniority_class and one of the spec's own levels: it must be used
    # directly and must not be replaced by whatever "Associate" alone would otherwise derive to.
    spec = _spec(levels=["director"], role_families=[], required_signals=[])
    result = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        spec=spec, title="Associate", level="director",
    ))
    assert any(signal.code == "level_match" for signal in result.signals)


def test_an_excluded_title_function_never_derives_a_level_match() -> None:
    # "Talent Director" would otherwise classify to the "director" level; the title-function
    # exclusion gate must suppress the fallback the same way it suppresses role_family_match.
    result = score_person(**_base(
        background={"current_kind": "other", "kind_sequence": []},
        spec=_spec(levels=["director"], role_families=[], required_signals=[]),
        title="Talent Director", level=None,
    ))
    assert not any(signal.code == "level_match" for signal in result.signals)
    assert result.score == 0
