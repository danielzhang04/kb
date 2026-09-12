import hashlib

from scripts.prospecting.bakeoff import BakeoffCase, run_bakeoff, wilson_interval
from scripts.prospecting.executor import Executor
from scripts.prospecting.finder_apify_public import ApifyPublicProfileAdapter
from scripts.prospecting.finder_pdl import PDLSpotAdapter
from scripts.prospecting.providers.base import register_vendor_adapters
from scripts.prospecting.providers.hunter import HunterEmailFinder
from scripts.prospecting.providers.snov import SnovEmailFinder
from scripts.prospecting.store import open_store


CAMPAIGN_ID = "camp_1111111111111111"
POLICY_HASH = "a" * 64
NOW = "2026-09-03T00:00:00Z"


def _person_id(index: int) -> str:
    return f"per_{index:016x}"


def _seed(connection):
    connection.execute(
        """INSERT INTO sender_profile(
               sender_profile_id,sender_name,sender_focus,sender_background,sender_operating_proof,approved_metrics
           ) VALUES(?,?,?,?,?,?)""",
        ("sender-1", "v", "v", "v", "v", "{}"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,
               send_window,timezone,approval_tier,mailbox_id,evidence_rules,policy_hash,status,credit_budget
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (CAMPAIGN_ID, "sales", "sender-1", "{}", "informational_call", "direct", "synthetic", "[]", "synthetic", "UTC", "T0",
         "mailbox-1", "{}", POLICY_HASH, "active", 200),
    )
    connection.executemany(
        "INSERT INTO person(person_id,first_name,full_name,source_lane,dedupe_key) VALUES(?,?,?,?,?)",
        ((_person_id(index), "v", "v", "manual", f"key-{index}") for index in range(50)),
    )
    connection.commit()


def test_wilson_interval_bounds():
    low, high = wilson_interval(25, 50)
    assert round(low, 3) == 0.366 and round(high, 3) == 0.634


def test_fifty_contact_bakeoff_uses_reserved_executor_path(tmp_path, monkeypatch, record_property):
    monkeypatch.setenv("KB_PROSPECTING_NO_NETWORK", "1")
    connection = open_store(tmp_path / "bakeoff.sqlite")
    _seed(connection)
    adapters = {
        "pdl": PDLSpotAdapter(),
        "apify": ApifyPublicProfileAdapter(),
        "hunter": HunterEmailFinder(),
        "snov": SnovEmailFinder(),
    }
    executor = Executor(connection)
    register_vendor_adapters(executor, adapters, now=NOW)
    cases = tuple(
        BakeoffCase(
            _person_id(index), f"com_{index:016x}", hashlib.sha256(b"x").hexdigest(), "fixture",
        )
        for index in range(50)
    )

    metrics = run_bakeoff(
        cases, (adapters["hunter"], adapters["snov"]), executor,
        campaign_id=CAMPAIGN_ID, policy_hash=POLICY_HASH, seed=20260903, now=NOW,
    )

    assert {metric.attempts for metric in metrics} == {50}
    record_property("bakeoff_attempts_per_adapter", 50)
    assert connection.execute(
        "SELECT COUNT(*) FROM credit_reservation WHERE provider='hunter' AND state='settled'"
    ).fetchone()[0] == 50
    assert connection.execute(
        "SELECT COUNT(*) FROM credit_reservation WHERE provider='snov' AND state='settled'"
    ).fetchone()[0] == 50
    assert connection.execute("SELECT COUNT(*) FROM provider_attempt").fetchone()[0] == 100
