from dataclasses import MISSING, fields
import inspect
from pathlib import Path
from sqlite3 import IntegrityError
from tempfile import TemporaryDirectory
import threading
import io
import pytest

from scripts.prospecting.capture import capture_csv, capture_urls, make_dedupe_key, normalize_linkedin_url
from scripts.prospecting.store import (
    LaneCapability, Predicate, PredicateOverride, open_store, select_lanes,
)
from scripts.prospecting.p2_store import TargetPolicy
from scripts.prospecting.finder_base import (
    CapabilityOutcome,
    LANE_CAPABILITY_OUTCOMES,
    PREDICATE_TYPES,
    Lane,
    LaneBatch,
    LaneCursor,
    LanePlan,
    YieldEstimate,
    advance_lane_cursor,
    capabilities_for,
    choose_shortfall,
    get_lane,
    load_lane_cursor,
    plan_lanes,
    register_lane,
)


FIXTURE_HOST = "professional-network.invalid"
PROFILE_URL = f"https://{FIXTURE_HOST}/profile/synthetic-person"
COMPANY_URL = f"https://{FIXTURE_HOST}/organization/synthetic-co"


def test_manual_normalizes_profile_and_company_urls():
    allowed = (FIXTURE_HOST,)
    assert normalize_linkedin_url(PROFILE_URL + "?trk=x", "person", allowed_hosts=allowed) == PROFILE_URL
    assert normalize_linkedin_url(COMPANY_URL + "/about/", "company", allowed_hosts=allowed) == COMPANY_URL


def test_manual_dedupe_key_is_stable_and_opaque():
    key = make_dedupe_key("person", PROFILE_URL)
    assert key == make_dedupe_key("person", PROFILE_URL)
    assert "synthetic-person" not in key
    company_key = make_dedupe_key("company", COMPANY_URL, name="Synthetic Co", location="New York")
    assert company_key == make_dedupe_key(
        "company", "https://different.invalid/organization/other", name=" synthetic co ", location="new york",
    )


def test_manual_csv_mints_ids_observations_and_prints_no_pii(tmp_path, capsys):
    db = open_store(tmp_path / "manual.sqlite")
    try:
        data = io.StringIO(
            f"kind,linkedin_url,name,first_name\nperson,{PROFILE_URL},Synthetic Person,Synthetic\n"
        )
        result = capture_csv(db, data, "2026-09-03T00:00:00Z", iter(("person-opaque-1", "obs-opaque-1")).__next__)
        assert result.inserted == 1 and result.duplicates == 0
        assert db.execute("SELECT COUNT(*) FROM source_observation").fetchone()[0] >= 1
        assert db.execute("SELECT json_extract(value, '$') FROM source_observation").fetchone()[0] == PROFILE_URL
        assert capsys.readouterr() == ("", "")
    finally:
        db.close()


def test_manual_url_capture_preserves_one_csv_row_with_comma_and_newline(tmp_path):
    db = open_store(tmp_path / "manual-url.csv.sqlite")
    raw_url = f"https://{FIXTURE_HOST}/profile/synthetic,person\n"
    try:
        result = capture_urls(
            db, (raw_url,), "2026-09-03T00:00:00Z",
            iter(("person-opaque-1", "obs-opaque-1")).__next__,
        )
        assert result.inserted == 1 and result.duplicates == 0
        assert db.execute("SELECT COUNT(*) FROM person").fetchone()[0] == 1
    finally:
        db.close()

def real(cls, **values):
    defaults = {
        "predicate_id": "predicate-1", "type": "title", "operator": "in",
        "values": ("synthetic",), "value": "synthetic", "lanes": ("manual",),
        "requested_companies": 1, "requested_people": 1, "extra_fields": (),
        "lane_plan": ("manual",), "scorer_version": "scorer-v1", "version": "manual-v1",
        "policy_hash": "policy-hash-1", "campaign_id": "campaign-1",
        "predicate_type": "title", "outcome": "exact", "reason_code": "fixture",
        "lane": "manual", "capability_version": "manual-v1", "override_id": "override-1",
        "approved_by": "human-1", "decided_by": "human:1", "approved_at": "2026-09-03T00:00:00Z",
        "decided_at": "2026-09-03T00:00:00Z",
    }
    kwargs = {}
    for field in fields(cls):
        if field.name in values:
            kwargs[field.name] = values[field.name]
        elif field.default is not MISSING or field.default_factory is not MISSING:
            continue
        elif field.name in defaults:
            kwargs[field.name] = defaults[field.name]
        else:
            raise AssertionError(f"unrecorded_p1_field:{cls.__name__}:{field.name}")
    return cls(**kwargs)


class FakeLane:
    name = "manual"
    capability_version = "manual-v1"

    def capabilities(self):
        return {
            kind: real(
                LaneCapability, predicate_type=kind, outcome="exact",
                reason_code="explicit_capture", version=self.capability_version,
            )
            for kind in PREDICATE_TYPES
        }

    def plan(self, target_policy):
        return LanePlan(
            self.name, self.capability_version, self.capabilities(), YieldEstimate(5, 10, 15), 20,
        )

    def run(self, plan, cursor):
        return LaneBatch((), "page-2", 10, 0, False, None)


def create_finder_run(db, finder_run_id="run-1"):
    db.execute(
        """INSERT INTO sender_profile(
               sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics
           ) VALUES(?,?,?,?,?,?)""",
        ("sender-1", "Synthetic Sender", "synthetic focus", "synthetic background", "synthetic proof", "[]"),
    )
    db.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,
               send_window,timezone,approval_tier,mailbox_id,evidence_rules,status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "campaign-1", "networking", "sender-1", "{}", "informational_call", "direct", "synthetic", "[]",
            "weekday", "UTC", "T0", "mailbox-1", "[]", "draft", "a" * 64,
        ),
    )
    db.execute(
        """INSERT INTO finder_run(
               finder_run_id,campaign_id,policy_hash,requested_companies,requested_people,state,updated_at
           ) VALUES(?,?,?,?,?,?,?)""",
        (finder_run_id, "campaign-1", "a" * 64, 1, 1, "running", "2026-09-03T00:00:00Z"),
    )
    db.commit()


def test_finder_base_public_names_are_directly_imported_and_exercised():
    outcome: CapabilityOutcome = "exact"
    assert outcome == "exact"
    capabilities = capabilities_for("manual", "manual-v1")
    assert set(capabilities) == set(PREDICATE_TYPES)

    estimate = YieldEstimate(1, 2, 3)
    plan = LanePlan("manual", "manual-v1", capabilities, estimate, 3)
    batch = LaneBatch((), "page-2", 1, 0, False, None)
    cursor = LaneCursor("run-1", "manual", None, 0, 0, "manual-v1", "2026-09-03T00:00:00Z")
    lane: Lane = FakeLane()
    assert (plan.lane, batch.next_cursor, cursor.lane, lane.name) == ("manual", "page-2", "manual", "manual")

    register_lane("finder_base_fixture", FakeLane)
    assert get_lane("finder_base_fixture").name == "manual"
    policy = real(TargetPolicy, predicates=(real(Predicate, type="title"),), lane_plan=("manual",))
    assert plan_lanes(policy, (lane,), frozenset(), "campaign-1", "policy-hash-1") == (lane.plan(policy),)
    assert choose_shortfall(all_exhausted=True) == "lane_exhausted"

    with TemporaryDirectory(dir=Path.cwd()) as directory:
        db = open_store(Path(directory) / "finder-base.sqlite")
        try:
            create_finder_run(db)
            assert advance_lane_cursor(
                db, "run-1", "manual", None, 0, 0, "manual-v1", "2026-09-03T00:00:00Z",
            ) == cursor
            assert load_lane_cursor(db, "run-1", "manual") == cursor
        finally:
            db.close()


def test_every_predicate_type_is_mapped(record_property):
    assert PREDICATE_TYPES == (
        "industry", "company_type", "company_stage", "company_location", "person_location",
        "title", "seniority", "school", "platform", "company_list",
    )
    assert set(FakeLane().capabilities()) == set(PREDICATE_TYPES)
    assert set(LANE_CAPABILITY_OUTCOMES) == {
        "manual", "pitchbook", "pdl", "class_c_public_profile", "linkedin_assisted",
    }
    assert all(set(mapping) == set(PREDICATE_TYPES) for mapping in LANE_CAPABILITY_OUTCOMES.values())
    assert {
        outcome for mapping in LANE_CAPABILITY_OUTCOMES.values() for outcome in mapping.values()
    } == {"exact", "approximate", "unsupported"}
    register_lane("fixture_manual", FakeLane)
    assert get_lane("fixture_manual").name == "manual"
    with pytest.raises(ValueError, match="duplicate_lane:fixture_manual"):
        register_lane("fixture_manual", FakeLane)
    record_property("predicate_types_exercised", len(PREDICATE_TYPES))


@pytest.mark.parametrize("outcome,override_kind,error", [
    ("unsupported", "none", "unsupported_predicate:predicate-1:manual"),
    ("approximate", "none", "approximate_requires_override:predicate-1:manual"),
    ("approximate", "wrong_campaign", "approximate_requires_override:predicate-1:manual"),
    ("approximate", "wrong_policy", "approximate_requires_override:predicate-1:manual"),
    ("approximate", "wrong_lane", "approximate_requires_override:predicate-1:manual"),
    ("approximate", "wrong_version", "approximate_requires_override:predicate-1:manual"),
])
def test_plan_rejects_unsupported_and_every_unbound_approximation(
    outcome, override_kind, error, record_property,
):
    predicate = real(Predicate, predicate_id="predicate-1", type="title")
    policy = real(TargetPolicy, predicates=(predicate,), lane_plan=("manual",))
    lane = FakeLane()
    lane.capabilities = lambda: {
        **FakeLane().capabilities(),
        "title": real(
            LaneCapability, predicate_type="title", outcome=outcome,
            reason_code="fixture", version="manual-v1",
        ),
    }
    changes = {
        "wrong_campaign": {"campaign_id": "campaign-other"},
        "wrong_policy": {"policy_hash": "policy-other"},
        "wrong_lane": {"lane": "pitchbook"},
        "wrong_version": {"capability_version": "manual-v0"},
    }
    overrides = () if override_kind == "none" else (real(PredicateOverride, **changes[override_kind]),)
    with pytest.raises(ValueError, match=error):
        plan_lanes(policy, (lane,), frozenset(overrides), "campaign-1", "policy-hash-1")
    if outcome == "approximate":
        record_property("unbound_approximation_rejections", 1)


def test_correctly_bound_approximation_is_selected():
    predicate = real(Predicate, predicate_id="predicate-1", type="title")
    policy = real(TargetPolicy, predicates=(predicate,), lane_plan=("manual",))
    lane = FakeLane()
    lane.capabilities = lambda: {
        **FakeLane().capabilities(),
        "title": real(
            LaneCapability, predicate_type="title", outcome="approximate",
            reason_code="fixture", version="manual-v1",
        ),
    }
    override = real(PredicateOverride)
    assert plan_lanes(
        policy, (lane,), frozenset((override,)), "campaign-1", "policy-hash-1",
    )[0].lane == "manual"


def test_public_p1_signatures_are_pinned_before_lane_work():
    assert tuple(inspect.signature(select_lanes).parameters) == (
        "policy", "capabilities", "overrides", "campaign_id", "policy_hash",
    )


def test_cursor_rollback_reopen_and_repeat_at_most_one_page():
    with TemporaryDirectory(dir=Path.cwd()) as directory:
        path = Path(directory) / "cursor.sqlite"
        db = open_store(path)
        reopened = None
        try:
            with pytest.raises(IntegrityError, match="FOREIGN KEY constraint failed"):
                advance_lane_cursor(
                    db, "missing-run", "manual", "page-2", 10, 4, "manual-v1", "2026-09-03T00:00:00Z",
                )
            db.rollback()
            create_finder_run(db)
            db.execute("BEGIN")
            advance_lane_cursor(
                db, "run-1", "manual", "page-2", 10, 4, "manual-v1", "2026-09-03T00:00:00Z",
                commit=False,
            )
            db.rollback()
            assert load_lane_cursor(db, "run-1", "manual") is None
            advance_lane_cursor(db, "run-1", "manual", "page-2", 10, 4, "manual-v1", "2026-09-03T00:01:00Z")
            db.close()
            db = None
            reopened = open_store(path)
            cursor = load_lane_cursor(reopened, "run-1", "manual")
            assert cursor == LaneCursor(
                "run-1", "manual", "page-2", 10, 4, "manual-v1", "2026-09-03T00:01:00Z",
            )
            assert tuple(reopened.execute("SELECT cursor,processed,yielded FROM finder_cursor").fetchone()) == (
                "page-2", 10, 4,
            )
        finally:
            if reopened is not None:
                reopened.close()
            if db is not None:
                db.close()


def test_yield_estimate_rejects_invalid_order():
    with pytest.raises(ValueError, match="invalid_yield_estimate"):
        YieldEstimate(10, 5, 15)


@pytest.mark.parametrize("facts,expected", [
    ({"checkpoint": True}, "checkpoint"), ({"cap_reached": True}, "cap_reached"),
    ({"unsupported_predicate": True}, "unsupported_predicate"), ({"credit_budget": True}, "credit_budget"),
    ({"all_exhausted": True}, "lane_exhausted"), ({}, None),
])
def test_shortfall_precedence(facts, expected):
    assert choose_shortfall(**facts) == expected
from scripts.prospecting.finder_pitchbook import PITCHBOOK_HEADERS, import_pitchbook_csv


def test_pitchbook_documented_headers_and_unsupported_report(tmp_path):
    from scripts.prospecting.store import open_store

    db = open_store(tmp_path / "pitchbook.sqlite")
    documented_headers = (
        "Company Name",
        "Website",
        "Primary Industry",
        "Company Type",
        "Company Stage",
        "HQ Location",
        "LinkedIn URL",
    )
    assert PITCHBOOK_HEADERS == documented_headers
    csv_text = ",".join(documented_headers + ("Unsupported Metric",)) + (
        f"\nSynthetic Capital,https://synthetic.test,Software,VC,Early Stage,New York,{COMPANY_URL},ignore\n"
    )
    report = import_pitchbook_csv(
        db,
        io.StringIO(csv_text),
        "2026-09-03T00:00:00Z",
        iter((f"opaque-{i}" for i in range(20))).__next__,
    )
    assert report.imported == 1
    assert report.unsupported_columns == ("Unsupported Metric",)
    assert db.execute("SELECT COUNT(*) FROM company").fetchone()[0] == 1
    assert (
        db.execute(
            "SELECT COUNT(*) FROM source_observation "
            "WHERE field='Unsupported Metric' OR value='ignore'"
        ).fetchone()[0]
        == 0
    )


def test_pitchbook_rejects_more_than_ten_rows(tmp_path):
    from scripts.prospecting.store import open_store

    db = open_store(tmp_path / "pitchbook-cap.sqlite")
    header = ",".join(PITCHBOOK_HEADERS)
    rows = [
        f"Synthetic {i},https://c{i}.test,Software,VC,Early Stage,New York,"
        for i in range(11)
    ]
    with pytest.raises(ValueError, match="pitchbook_daily_row_cap"):
        import_pitchbook_csv(
            db, io.StringIO(header + "\n" + "\n".join(rows)), "2026-09-03T00:00:00Z"
        )


def test_pitchbook_daily_cap_spans_repeated_imports(tmp_path, record_property):
    from scripts.prospecting.store import open_store

    db = open_store(tmp_path / "pitchbook-repeated.sqlite")
    header = ",".join(PITCHBOOK_HEADERS)

    def batch(start, count):
        rows = [
            f"Synthetic {i},https://c{i}.test,Software,VC,Early Stage,New York,"
            for i in range(start, start + count)
        ]
        return io.StringIO(header + "\n" + "\n".join(rows))

    assert import_pitchbook_csv(db, batch(0, 6), "2026-09-03T00:00:00Z").imported == 6
    with pytest.raises(ValueError, match="pitchbook_daily_row_cap"):
        import_pitchbook_csv(db, batch(6, 5), "2026-09-03T12:00:00Z")
    assert (
        db.execute("SELECT COUNT(*) FROM company WHERE source_lane='pitchbook'").fetchone()[0]
        == 6
    )
    record_property("lane_cap_violations", 1)


def test_pitchbook_daily_cap_holds_for_two_simultaneous_imports_at_cap_minus_one(tmp_path):
    from scripts.prospecting.store import open_store

    path = tmp_path / "pitchbook-race.sqlite"
    db = open_store(path)
    try:
        for index in range(9):
            db.execute(
                """INSERT INTO audit(
                       event_id,actor,action,entity_type,entity_id,at,before_hash,after_hash,reason
                   ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    f"seed-{index}",
                    "fixture",
                    "pitchbook_import",
                    "company",
                    f"company-{index}",
                    "2026-09-03T00:00:00Z",
                    None,
                    None,
                    "fixture",
                ),
            )
        db.commit()
    finally:
        db.close()

    header = ",".join(PITCHBOOK_HEADERS)
    barrier = threading.Barrier(2)
    outcomes = []

    def import_one(index):
        connection = open_store(path)
        try:
            barrier.wait(timeout=5)
            try:
                outcomes.append(
                    import_pitchbook_csv(
                        connection,
                        io.StringIO(
                            header
                            + f"\nSynthetic {index},https://race-{index}.test,Software,VC,Early Stage,New York,"
                        ),
                        "2026-09-03T00:00:00Z",
                    ).imported
                )
            except ValueError as error:
                outcomes.append(str(error))
        finally:
            connection.close()

    threads = [threading.Thread(target=import_one, args=(index,)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
        assert not thread.is_alive()

    assert outcomes.count(1) == 1
    assert outcomes.count("pitchbook_daily_row_cap") == 1
    db = open_store(path)
    try:
        assert db.execute(
            "SELECT COUNT(*) FROM audit WHERE action='pitchbook_import' AND substr(at,1,10)='2026-09-03'"
        ).fetchone()[0] == 10
    finally:
        db.close()


def test_pitchbook_company_dedupe_uses_registrable_host_then_name_location(tmp_path):
    from scripts.prospecting.store import open_store

    db = open_store(tmp_path / "pitchbook-dedupe.sqlite")
    header = ",".join(PITCHBOOK_HEADERS)
    rows = (
        "Same One,https://sub.synthetic.test/a,Software,VC,Early Stage,New York,",
        "Same Two,https://synthetic.test/b,Software,VC,Early Stage,Boston,",
    )
    report = import_pitchbook_csv(
        db, io.StringIO(header + "\n" + "\n".join(rows)), "2026-09-03T00:00:00Z"
    )
    assert report.imported == 1 and report.duplicates == 1


def test_pitchbook_company_dedupe_distinguishes_co_uk_registrable_domains(tmp_path):
    from scripts.prospecting.store import open_store

    db = open_store(tmp_path / "pitchbook-co-uk.sqlite")
    header = ",".join(PITCHBOOK_HEADERS)
    rows = (
        "One,https://sub.one.co.uk/a,Software,VC,Early Stage,New York,",
        "Two,https://sub.two.co.uk/b,Software,VC,Early Stage,New York,",
    )
    report = import_pitchbook_csv(
        db, io.StringIO(header + "\n" + "\n".join(rows)), "2026-09-03T00:00:00Z"
    )
    assert report.imported == 2 and report.duplicates == 0
