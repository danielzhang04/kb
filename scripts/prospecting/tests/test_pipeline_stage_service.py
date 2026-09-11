from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from typing import Callable, Mapping

import pytest

from scripts.prospecting.affinity.evidence_bridge import current_role_source_proof
from scripts.prospecting.affinity.source_review import import_operator_page, verify_snapshot
from scripts.prospecting.pipeline_stage_service import (
    PipelineStageError,
    PipelineStageService,
    StageBinding,
    StageJob,
    StageResult,
    require_revision_ready,
    require_revision_review_chain,
)
from scripts.prospecting.personalizer.qa import QaPolicy, QaResult, SlotBinding
from scripts.prospecting.personalizer.revision import RevisionInput, build_revision
from scripts.prospecting.review_qa import load_revision_qa_context, record_revision_qa_context
from scripts.prospecting.review_service import (
    EditDraftRequest,
    ReviewService,
    VerifyIdentitySourceRequest,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_review_service import (
    ASK,
    NOW,
    POINT,
    insert_campaign,
    insert_person,
    insert_revision,
    request_id,
)


@dataclass
class FixtureAdapter:
    binding: StageBinding
    payload: Mapping[str, object]
    calls: int = 0

    def execute(self, job: StageJob) -> StageResult:
        self.calls += 1
        assert job.input_hash
        assert b"evidence-a" in job.input_json
        value = json.loads(job.input_json)
        assert value["approved_context"]["sender_profile"]["sender_profile_id"] == "sender-a"
        assert value["approved_context_hash"]
        if job.stage == "independent_critic":
            assert "audit" not in value["candidate"]
        return StageResult(self.payload)


@dataclass
class RenderedFixtureAdapter:
    binding: StageBinding
    payload: Mapping[str, object]

    def execute(self, job: StageJob) -> StageResult:
        value = json.loads(job.input_json)
        assert value["stage"] == job.stage
        assert value["approved_context"]["current_role_proof"]["snapshot_id"]
        return StageResult(self.payload)


@dataclass
class LateOnceAdapter:
    binding: StageBinding
    payload: Mapping[str, object]
    clock: list[datetime]
    calls: int = 0

    def execute(self, job: StageJob) -> StageResult:
        self.calls += 1
        if self.calls == 1:
            self.clock[0] += timedelta(minutes=6)
        return StageResult(self.payload)


@dataclass
class InterleavedCritic:
    binding: StageBinding
    clock: list[datetime]
    during: Callable[[], None]

    def execute(self, job: StageJob) -> StageResult:
        self.clock[0] += timedelta(minutes=6)
        self.during()
        return StageResult({
            "decision": "repair", "reasons": [],
            "repair_instructions": "Revise the synthetic draft.",
        })


def _binding(name: str) -> StageBinding:
    letter = {"humanizer": "a", "factchecker": "b", "critic": "c"}[name]
    return StageBinding(
        f"executor-{name}", "runtime-private", "v1", letter * 64, (letter.upper().lower()) * 64,
        name, "v1", ("d" if name == "humanizer" else "e") * 64,
        ("f" if name == "critic" else "9") * 64,
    )


def _seed(tmp_path: Path, *, identity_review: bool = True):
    connection = open_store(tmp_path / "pipeline-stage.sqlite")
    insert_campaign(connection, "campaign-a", "sender-a", "mailbox-a")
    insert_person(connection, "person-a", "a")
    connection.execute(
        "INSERT INTO fill_person VALUES(?,?,?,?,?)",
        ("campaign-a", "person-a", "cmp_" + "a" * 16, 0, NOW),
    )
    connection.execute(
        "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("evidence-a", "person-a", POINT, "https://source.example.test/a", NOW,
         NOW, "Synthetic excerpt", 1.0, "2099-01-01T00:00:00+00:00", 1),
    )
    revision = insert_revision(connection, "campaign-a", "person-a", "evidence-a")
    snapshot_id = "obs_" + "a" * 16
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("source-role-a", "person", "person-a", "current_employer", '"Synthetic Person A is Example Lead at Example A LLC"',
         "fixture", NOW, NOW, 1.0, snapshot_id),
    )
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("source-name-a", "person", "person-a", "name", '"Synthetic Person A"',
         "fixture", NOW, NOW, 1.0, snapshot_id),
    )
    connection.execute(
        "UPDATE employment SET source_observation_id='source-role-a' WHERE employment_id='emp_a'"
    )
    if identity_review:
        connection.execute(
            "INSERT INTO identity_source_review VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("role-review-a", "1" * 64, "campaign-a", "person-a", "cmp_" + "a" * 16,
             "emp_a", "source_a", "source-role-a", "source-role-a", "source-name-a",
             snapshot_id, 1, NOW),
        )
    connection.execute(
        """INSERT INTO prospecting_pipeline_intake(
          intake_id,request_id,request_hash,campaign_id,campaign_policy_hash,intake_revision,
          intake_hash,as_of_date,funding_stage_min,funding_stage_max,funding_window_years,
          funding_stage_interpretation,geography_mode,geography_json,sector_mode,sector_json,
          requested_companies,requested_people_per_company,role_families_json,
          original_specification,outreach_goal,cutoff_date,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("intake-a","intake-request-a","2"*64,"campaign-a","a"*64,1,"3"*64,
         "2026-09-09","series_a","series_c",3,"latest_known","any","[]","any","[]",
         10,2,'["ops"]',"Synthetic specification","Synthetic goal","2023-09-09",NOW),
    )
    connection.execute(
        "INSERT INTO prospecting_pipeline_run VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("run-a","intake-a","campaign-a","3"*64,"a"*64,"outreach-skill",1,"4"*64,
         "awaiting_research_adapter","research",0,2,"[]",NOW,NOW),
    )
    connection.commit()
    return connection, revision


def _adapters(*, critic: str = "pass", unchanged: bool = False):
    body = f"Hello. {POINT}. {ASK}" if unchanged else f"Hello there. {POINT}. {ASK}"
    return {
        "humanizer": FixtureAdapter(_binding("humanizer"), {
            "draft": body, "audit": "No synthetic style concerns remain.",
            "final_subject": "Example subject" if unchanged else "A natural example subject",
            "final_body": body,
        }),
        "post_humanization_factcheck": FixtureAdapter(_binding("factchecker"), {
            "decision": "pass",
            "bindings": [
                {"slot":"why_them","value":POINT,"source_kind":"evidence","source_ref":"evidence-a"},
                {"slot":"ask","value":ASK,"source_kind":"policy","source_ref":"policy.ask"},
            ],
            "uncertainty": [], "shortfalls": [],
        }),
        "independent_critic": FixtureAdapter(_binding("critic"), {
            "decision": critic, "reasons": [],
            "repair_instructions": "Revise the synthetic draft." if critic == "repair" else "",
        }),
    }


def _run_to_review(service: PipelineStageService, item_id: str) -> None:
    service.run_next(item_id, "stage-request-h")
    service.run_next(item_id, "stage-request-f")
    service.run_next(item_id, "stage-request-c")


def _import_pending_role_source(connection, tmp_path: Path, *, suffix: str = "a"):
    connection.commit()
    import_operator_page(
        connection,
        person_id="person-a",
        company_id="cmp_" + "a" * 16,
        source_url=f"https://source.example.test/current-role-{suffix}",
        body=(
            b"Synthetic Person A is Example Lead at Example A LLC. "
            + suffix.encode("ascii")
        ),
        now=datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    return current_role_source_proof(
        connection, "campaign-a", "person-a",
        datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )


def _insert_pipeline_run_for_campaign(connection, campaign_id: str) -> None:
    policy_hash = connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id=?", (campaign_id,),
    ).fetchone()[0]
    connection.execute(
        """INSERT INTO prospecting_pipeline_intake(
          intake_id,request_id,request_hash,campaign_id,campaign_policy_hash,intake_revision,
          intake_hash,as_of_date,funding_stage_min,funding_stage_max,funding_window_years,
          funding_stage_interpretation,geography_mode,geography_json,sector_mode,sector_json,
          requested_companies,requested_people_per_company,role_families_json,
          original_specification,outreach_goal,cutoff_date,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("rendered-intake", "rendered-intake-request", "2" * 64, campaign_id,
         policy_hash, 1, "3" * 64, "2099-12-30", "series_a", "series_c", 3,
         "latest_known", "any", "[]", "any", "[]", 8, 2,
         '["operations"]', "Synthetic source-first request", "Synthetic conversation",
         "2096-12-30", NOW),
    )
    connection.execute(
        "INSERT INTO prospecting_pipeline_run VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("rendered-run", "rendered-intake", campaign_id, "3" * 64, policy_hash,
         "outreach-skill", 1, "4" * 64, "awaiting_research_adapter", "research",
         0, 2, "[]", NOW, NOW),
    )
    connection.commit()


def test_unconnected_stage_refuses_without_claim(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")

    with pytest.raises(PipelineStageError, match="^stage_adapter_unavailable$"):
        service.run_next(item.item_id, "stage-request")

    assert connection.execute("SELECT count(*) FROM prospecting_stage_attempt").fetchone()[0] == 0


def test_changed_suggestion_uses_agent_lineage_and_exact_ready_chain(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters()
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _run_to_review(service, item.item_id)

    accepted = service.accept_suggestion(item.item_id, "accept-request", revision.revision_id, "human:fixture")

    assert accepted.unchanged is False
    assert connection.execute("SELECT count(*) FROM review_request WHERE operation='edit'").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM review_revision_lineage").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM prospecting_agent_revision_lineage").fetchone()[0] == 1
    ready = require_revision_review_chain(connection, "campaign-a", accepted.revision_hash, NOW)
    assert ready["revision_id"] == accepted.revision_id
    assert service.accept_suggestion(item.item_id, "accept-request", revision.revision_id, "human:fixture").replayed is True


def test_unchanged_output_records_human_accept_without_child(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(unchanged=True), now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _run_to_review(service, item.item_id)

    accepted = service.accept_suggestion(item.item_id, "accept-request", revision.revision_id, "human:fixture")

    assert accepted.unchanged is True
    assert accepted.revision_id == revision.revision_id
    assert connection.execute("SELECT count(*) FROM prospecting_suggestion_decision").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM prospecting_agent_revision_lineage").fetchone()[0] == 0


def test_stage_request_replay_does_not_execute_adapter_twice(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters()
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")

    first = service.run_next(item.item_id, "stage-request")
    replay = service.run_next(item.item_id, "stage-request")

    assert first == replay
    assert adapters["humanizer"].calls == 1


def test_two_repairs_park_on_third_critic_failure(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters(critic="repair")
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")

    for cycle in range(3):
        service.run_next(item.item_id, f"human-{cycle}")
        service.run_next(item.item_id, f"fact-{cycle}")
        result = service.run_next(item.item_id, f"critic-{cycle}")

    assert result.state == "parked"
    assert result.repair_cycle == 2
    assert adapters["independent_critic"].calls == 3


def test_post_factcheck_deterministic_failure_enters_repair_loop(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters()
    adapters["humanizer"].payload = {
        "draft": f"Hello. A generic synthetic note. {ASK}",
        "audit": "Synthetic evidence phrase was removed.",
        "final_subject": "Generic subject",
        "final_body": f"Hello. A generic synthetic note. {ASK}",
    }
    adapters["post_humanization_factcheck"].payload = {
        "decision": "pass",
        "bindings": [
            {"slot":"ask","value":ASK,"source_kind":"policy","source_ref":"policy.ask"},
        ],
        "uncertainty": [], "shortfalls": [],
    }
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")

    service.run_next(item.item_id, "human")
    result = service.run_next(item.item_id, "fact")

    assert result.state == "awaiting_humanizer_adapter"
    assert result.repair_cycle == 1
    artifact = connection.execute(
        "SELECT decision,payload_json FROM prospecting_stage_artifact WHERE stage='post_humanization_factcheck'"
    ).fetchone()
    assert artifact["decision"] == "fail"
    assert "name_swap" in json.loads(artifact["payload_json"])["qa_failure_codes"]
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_suggestion").fetchone()[0] == 0


def test_post_factcheck_rejects_unapproved_sender_binding(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters()
    adapters["post_humanization_factcheck"].payload = {
        "decision": "pass",
        "bindings": [
            {"slot":"why_them","value":POINT,"source_kind":"evidence","source_ref":"evidence-a"},
            {"slot":"ask","value":ASK,"source_kind":"policy","source_ref":"policy.ask"},
            {"slot":"sender_claim","value":"Unsupported synthetic claim","source_kind":"sender","source_ref":"sender_profile.sender_background"},
        ],
        "uncertainty": [], "shortfalls": [],
    }
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    service.run_next(item.item_id, "human")

    result = service.run_next(item.item_id, "fact")

    assert result.state == "awaiting_humanizer_adapter"
    payload = json.loads(connection.execute(
        "SELECT payload_json FROM prospecting_stage_artifact WHERE stage='post_humanization_factcheck'"
    ).fetchone()[0])
    assert "binding_source_mismatch" in payload["qa_failure_codes"]


@pytest.mark.parametrize("payload", [
    {"draft":"ok","audit":"ok","final_subject":"ok","final_body":"x" * 300_000},
    {"draft":"ok","audit":"ok","final_subject":"ok","final_body":float("nan")},
])
def test_untrusted_stage_output_is_bounded_strict_json(tmp_path: Path, payload: dict[str, object]) -> None:
    connection, revision = _seed(tmp_path)
    adapter = FixtureAdapter(_binding("humanizer"), payload)
    service = PipelineStageService(connection, adapters={"humanizer": adapter}, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")

    with pytest.raises(PipelineStageError, match="^adapter_result_invalid$"):
        service.run_next(item.item_id, "human")

    assert connection.execute("SELECT count(*) FROM prospecting_stage_artifact").fetchone()[0] == 0
    assert connection.execute("SELECT state FROM prospecting_stage_attempt").fetchone()[0] == "failed"


def test_private_stage_dtos_hide_payloads_from_repr() -> None:
    secret = "private-synthetic-sentinel"
    job = StageJob("item","attempt","worker","humanizer",0,"a" * 64,secret.encode())
    result = StageResult({"value": secret})

    assert secret not in repr(job)
    assert secret not in repr(result)


def test_context_change_after_humanizer_refuses_factcheck(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters()
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    service.run_next(item.item_id, "human")
    connection.execute("UPDATE sender_profile SET sender_background='Changed synthetic background' WHERE sender_profile_id='sender-a'")
    connection.commit()

    with pytest.raises(PipelineStageError, match="^pipeline_context_stale$"):
        service.run_next(item.item_id, "fact")

    assert adapters["post_humanization_factcheck"].calls == 0


def test_acceptance_needs_separate_latest_human_ready_event_and_plain_row_factory(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(), now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _run_to_review(service, item.item_id)
    accepted = service.accept_suggestion(item.item_id, "accept-request", revision.revision_id, "human:fixture")

    with pytest.raises(PipelineStageError, match="^human_editorial_ready_missing$"):
        require_revision_ready(connection, "campaign-a", accepted.revision_hash, NOW)
    connection.execute(
        "INSERT INTO draft_editorial_event(event_id,request_id,campaign_id,person_id,revision_id,state,created_at) VALUES(?,?,?,?,?,'ready',?)",
        ("editorial-ready","editorial-ready-request","campaign-a","person-a",accepted.revision_id,NOW),
    )
    connection.commit()
    connection.row_factory = None
    assert require_revision_ready(connection, "campaign-a", accepted.revision_hash, NOW)["revision_id"] == accepted.revision_id
    connection.execute(
        "INSERT INTO draft_editorial_event(event_id,request_id,campaign_id,person_id,revision_id,state,created_at) VALUES(?,?,?,?,?,'review_required',?)",
        ("editorial-unready","editorial-unready-request","campaign-a","person-a",accepted.revision_id,NOW),
    )
    connection.commit()
    with pytest.raises(PipelineStageError, match="^human_editorial_ready_missing$"):
        require_revision_ready(connection, "campaign-a", accepted.revision_hash, NOW)
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,'null',?)""",
        ("accepted-candidate","accepted-candidate-request","campaign-a","person-a",0,
         accepted.revision_id,"Pending subject",f"Hello. {POINT}. {ASK}","qa_failed",NOW),
    )
    connection.commit()
    with pytest.raises(PipelineStageError, match="^human_edit_unresolved$"):
        require_revision_ready(connection, "campaign-a", accepted.revision_hash, NOW)


def test_unresolved_human_edit_blocks_acceptance_and_ready_chain(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(), now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _run_to_review(service, item.item_id)
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,'null',?)""",
        ("candidate-pending","candidate-request","campaign-a","person-a",0,revision.revision_id,
         "Pending subject",f"Hello. {POINT}. {ASK}","qa_failed",NOW),
    )
    connection.commit()

    with pytest.raises(PipelineStageError, match="^human_edit_unresolved$"):
        service.accept_suggestion(item.item_id, "accept-request", revision.revision_id, "human:fixture")


def test_adapter_identity_must_be_distinct_between_review_stages(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters()
    adapters["post_humanization_factcheck"].binding = adapters["humanizer"].binding
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    service.run_next(item.item_id, "human")

    with pytest.raises(PipelineStageError, match="^critic_not_independent$"):
        service.run_next(item.item_id, "fact")

    assert adapters["post_humanization_factcheck"].calls == 0


def test_cyclic_stage_output_fails_with_fixed_code(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    cyclic: dict[str, object] = {}
    cyclic["cycle"] = cyclic
    adapter = FixtureAdapter(_binding("humanizer"), cyclic)
    service = PipelineStageService(connection, adapters={"humanizer": adapter}, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")

    with pytest.raises(PipelineStageError, match="^adapter_result_invalid$"):
        service.run_next(item.item_id, "human")

    assert connection.execute("SELECT count(*) FROM prospecting_stage_artifact").fetchone()[0] == 0


@pytest.mark.parametrize("mutation", ["superseded", "expired", "wrong_company"])
def test_current_role_attestation_fails_closed_when_source_scope_changes(tmp_path: Path, mutation: str) -> None:
    connection, revision = _seed(tmp_path)
    if mutation == "superseded":
        connection.execute("UPDATE employment SET source_observation_id='source_a' WHERE employment_id='emp_a'")
    elif mutation == "expired":
        connection.execute("UPDATE source_snapshot SET expires_at='2026-09-08T00:00:00Z' WHERE snapshot_id='obs_aaaaaaaaaaaaaaaa'")
    else:
        insert_person(connection, "person-b", "b")
        connection.execute("UPDATE fill_person SET company_id='cmp_bbbbbbbbbbbbbbbb' WHERE campaign_id='campaign-a' AND person_id='person-a'")
    connection.commit()
    service = PipelineStageService(connection, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))

    with pytest.raises(PipelineStageError, match="^identity_source_proof_missing$"):
        service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")


def test_exact_attested_name_binding_ignores_an_authentic_duplicate(
    tmp_path: Path,
) -> None:
    connection, revision = _seed(tmp_path)
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("aaa-authentic-name", "person", "person-a", "name", '"Synthetic Person A"',
         "fixture", NOW, NOW, 1.0, "obs_aaaaaaaaaaaaaaaa"),
    )
    connection.commit()

    item = PipelineStageService(
        connection, now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    ).start_from_saved_revision(
        "campaign-a", revision.revision_id, "duplicate-name-start",
    )

    assert item.state == "awaiting_humanizer_adapter"


def test_exact_attested_name_binding_rejects_wrong_review_value(
    tmp_path: Path,
) -> None:
    connection, revision = _seed(tmp_path)
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("wrong-reviewed-name", "person", "person-a", "name", '"Different Synthetic"',
         "fixture", NOW, NOW, 1.0, "obs_aaaaaaaaaaaaaaaa"),
    )
    connection.execute(
        "INSERT INTO identity_source_review VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("wrong-name-review", "8" * 64, "campaign-a", "person-a", "cmp_" + "a" * 16,
         "emp_a", "source_a", "source-role-a", "source-role-a", "wrong-reviewed-name",
         "obs_" + "a" * 16, 1, "2099-12-31T00:00:00Z"),
    )
    connection.commit()

    with pytest.raises(PipelineStageError, match="^identity_source_proof_missing$"):
        PipelineStageService(
            connection, now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
        ).start_from_saved_revision(
            "campaign-a", revision.revision_id, "wrong-name-start",
        )


def test_proof_pending_chain_survives_exact_attestation_without_rerun(
    tmp_path: Path,
) -> None:
    connection, revision = _seed(tmp_path, identity_review=False)
    proof = _import_pending_role_source(connection, tmp_path)
    service = PipelineStageService(
        connection, adapters=_adapters(),
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )

    assert service.get_latest_review_projection(
        "campaign-a", revision.revision_id,
    ) is None
    item = service.start_from_saved_revision(
        "campaign-a", revision.revision_id, "proof-pending-start",
    )
    _run_to_review(service, item.item_id)
    pending = service.get_review_projection(item.item_id)
    assert pending.item.item_id == item.item_id
    assert pending.source_proof == proof
    assert pending.source_proof is not None and pending.source_proof.attested is False
    assert pending.suggestion_id and pending.suggestion_body
    accepted = service.accept_suggestion(
        item.item_id, "proof-pending-accept", revision.revision_id, "human:fixture",
    )
    counts = tuple(
        connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("prospecting_stage_attempt", "prospecting_stage_artifact")
    )
    with pytest.raises(PipelineStageError, match="^identity_source_review_missing$"):
        require_revision_review_chain(
            connection, "campaign-a", accepted.revision_hash, NOW,
        )

    review = ReviewService(
        connection,
        now=lambda: NOW,
        source_verifier=lambda candidate: verify_snapshot(
            tmp_path / "snapshots", candidate,
            now=datetime.fromisoformat(NOW.replace("Z", "+00:00")),
        ),
    )
    review.verify_current_role_source(VerifyIdentitySourceRequest(
        request_id(810), "campaign-a", "person-a", "source-role-a",
        proof.candidate_observation_id, True,
    ))

    after = service.get_latest_review_projection(
        "campaign-a", accepted.revision_id,
    )
    assert after is not None and after.item.item_id == item.item_id
    assert after.suggestion_id == pending.suggestion_id
    assert after.proposed_revision_hash == pending.proposed_revision_hash
    assert after.decision == "accepted"
    assert after.source_proof is not None and after.source_proof.attested is True
    assert tuple(
        connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("prospecting_stage_attempt", "prospecting_stage_artifact")
    ) == counts
    assert require_revision_review_chain(
        connection, "campaign-a", accepted.revision_hash, NOW,
    )["revision_id"] == accepted.revision_id
    with pytest.raises(PipelineStageError, match="^human_editorial_ready_missing$"):
        require_revision_ready(connection, "campaign-a", accepted.revision_hash, NOW)


def test_rendered_proof_pending_revision_completes_exact_chain_after_p13(
    tmp_path: Path, monkeypatch,
) -> None:
    from scripts.prospecting.tests.test_affinity_templates_v2 import (
        NOW as DRAFT_NOW,
        _draft_ready_fixture,
        _import_current_role_proof,
    )
    from scripts.prospecting.affinity.templates_v2 import draft_step_zero_proof_pending

    connection, person_id, campaign_id = _draft_ready_fixture(tmp_path, monkeypatch)
    signals = json.loads(connection.execute(
        "SELECT signals_json FROM person_affinity WHERE person_id=? AND campaign_id=?",
        (person_id, campaign_id),
    ).fetchone()[0])
    connection.execute(
        "UPDATE person_affinity SET signals_json=? WHERE person_id=? AND campaign_id=?",
        (json.dumps([item for item in signals if item["code"] != "path_match"]),
         person_id, campaign_id),
    )
    _import_current_role_proof(connection, person_id)
    summary = draft_step_zero_proof_pending(
        connection, campaign_id, anchors=object(), now=DRAFT_NOW,
    )
    assert summary.revisions_created == 1 and summary.failure_codes == {}
    revision = connection.execute(
        "SELECT * FROM revision WHERE campaign_id=?", (campaign_id,),
    ).fetchone()
    proof = current_role_source_proof(connection, campaign_id, person_id, DRAFT_NOW)
    context = load_revision_qa_context(connection, revision["revision_id"])
    fact_bindings = [
        {
            "slot": name, "value": binding.value,
            "source_kind": binding.source_kind, "source_ref": binding.source_ref,
        }
        for name, binding in context.bindings.items()
    ]
    adapters = {
        "humanizer": RenderedFixtureAdapter(_binding("humanizer"), {
            "draft": revision["body"],
            "audit": "Synthetic rendered draft retained.",
            "final_subject": revision["subject"],
            "final_body": revision["body"],
        }),
        "post_humanization_factcheck": RenderedFixtureAdapter(
            _binding("factchecker"), {
                "decision": "pass", "bindings": fact_bindings,
                "uncertainty": [], "shortfalls": [],
            },
        ),
        "independent_critic": RenderedFixtureAdapter(_binding("critic"), {
            "decision": "pass", "reasons": [], "repair_instructions": "",
        }),
    }
    _insert_pipeline_run_for_campaign(connection, campaign_id)
    service = PipelineStageService(connection, adapters=adapters, now=lambda: DRAFT_NOW)
    item = service.start_from_saved_revision(
        campaign_id, revision["revision_id"], "rendered-start",
    )
    _run_to_review(service, item.item_id)
    accepted = service.accept_suggestion(
        item.item_id, "rendered-accept", revision["revision_id"], "human:fixture",
    )
    assert accepted.unchanged is True
    with pytest.raises(PipelineStageError, match="^identity_source_review_missing$"):
        require_revision_review_chain(connection, campaign_id, accepted.revision_hash, DRAFT_NOW)

    ReviewService(
        connection,
        now=lambda: DRAFT_NOW.isoformat(),
        source_verifier=lambda candidate: verify_snapshot(
            tmp_path / "snapshots", candidate, now=DRAFT_NOW,
        ),
    ).verify_current_role_source(VerifyIdentitySourceRequest(
        request_id(811), campaign_id, person_id, "obs_employment",
        proof.candidate_observation_id, True,
    ))
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("aaa-authentic-name", "person", person_id, "name",
         json.dumps({"excerpt": proof.excerpt}), proof.snapshot_id,
         DRAFT_NOW.isoformat(), DRAFT_NOW.isoformat(), 1.0, proof.snapshot_id),
    )
    connection.commit()

    assert require_revision_review_chain(
        connection, campaign_id, accepted.revision_hash, DRAFT_NOW,
    )["revision_id"] == accepted.revision_id
    with pytest.raises(PipelineStageError, match="^human_editorial_ready_missing$"):
        require_revision_ready(connection, campaign_id, accepted.revision_hash, DRAFT_NOW)


def test_rejected_suggestion_projects_and_cannot_later_be_accepted(
    tmp_path: Path,
) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(
        connection, adapters=_adapters(),
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    item = service.start_from_saved_revision(
        "campaign-a", revision.revision_id, "rejection-start",
    )
    _run_to_review(service, item.item_id)

    rejected = service.reject_suggestion(
        item.item_id, "rejection-request", revision.revision_id, "human:fixture",
    )
    replayed = service.reject_suggestion(
        item.item_id, "rejection-request", revision.revision_id, "human:fixture",
    )

    assert replayed == type(rejected)(rejected.decision_id, item.item_id, True)
    assert service.get_review_projection(item.item_id).decision == "rejected"
    with pytest.raises(PipelineStageError, match="^suggestion_already_decided$"):
        service.accept_suggestion(
            item.item_id, "accept-after-reject", revision.revision_id, "human:fixture",
        )
    assert connection.execute("SELECT count(*) FROM revision").fetchone()[0] == 1


@pytest.mark.parametrize("mutation", ["changed_source", "changed_role", "stale"])
def test_proof_pending_stage_refuses_changed_or_stale_exact_source(
    tmp_path: Path, mutation: str,
) -> None:
    connection, revision = _seed(tmp_path, identity_review=False)
    proof = _import_pending_role_source(connection, tmp_path)
    service = PipelineStageService(
        connection, adapters=_adapters(),
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    item = service.start_from_saved_revision(
        "campaign-a", revision.revision_id, f"{mutation}-start",
    )
    if mutation == "changed_source":
        import_operator_page(
            connection,
            person_id="person-a",
            company_id="cmp_" + "a" * 16,
            source_url="https://source.example.test/current-role-new",
            body=b"Synthetic Person A is Example Lead at Example A LLC. newer proof",
            now=datetime.fromisoformat(NOW.replace("Z", "+00:00")) + timedelta(seconds=1),
        )
    elif mutation == "changed_role":
        connection.execute("UPDATE employment SET title='Different Lead'")
        connection.commit()
    else:
        connection.execute(
            "UPDATE source_snapshot SET expires_at='2026-09-08T00:00:00Z' "
            "WHERE snapshot_id=?", (proof.snapshot_id,),
        )
        connection.commit()

    with pytest.raises(
        PipelineStageError,
        match="^(pipeline_context_stale|identity_source_proof_missing)$",
    ):
        service.run_next(item.item_id, f"{mutation}-run")
    assert connection.execute(
        "SELECT count(*) FROM prospecting_stage_artifact WHERE item_id=?",
        (item.item_id,),
    ).fetchone()[0] == 0


def test_expired_claim_recovers_in_fresh_service_instance(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    item = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    binding = _binding("humanizer")
    connection.execute(
        "UPDATE prospecting_pipeline_item SET state='humanizer_running',claim_epoch=1 WHERE item_id=?",
        (item.item_id,),
    )
    connection.execute(
        """INSERT INTO prospecting_stage_attempt(
               attempt_id,request_id,request_hash,item_id,stage,cycle,claim_epoch,input_hash,
               worker_role,worker_identity,worker_job_id,attempt_token_hash,runtime_id,
               runtime_version,runtime_hash,schema_hash,skill_name,skill_version,
               skill_content_hash,skill_manifest_hash,state,lease_until,failure_code,
               created_at,finished_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("attempt-expired","lost-request","1"*64,item.item_id,"humanizer",0,1,"2"*64,
         "humanizer",binding.executor_identity,"lost-worker","3"*64,binding.runtime_id,
         binding.runtime_version,binding.runtime_hash,binding.schema_hash,binding.skill_name,
         binding.skill_version,binding.skill_content_hash,binding.skill_manifest_hash,"claimed",
         "2026-09-08T00:00:00Z",None,"2026-09-08T00:00:00Z",None),
    )
    connection.commit()

    recovered = PipelineStageService(connection, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00"))).recover_expired(item.item_id)

    assert recovered.state == "awaiting_humanizer_adapter"
    recovered_attempt = connection.execute(
        "SELECT state,failure_code FROM prospecting_stage_attempt WHERE attempt_id='attempt-expired'"
    ).fetchone()
    assert tuple(recovered_attempt) == ("expired","lease_expired")


def test_late_adapter_result_expires_attempt_and_new_request_recovers(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    clock = [datetime.fromisoformat(NOW.replace("Z", "+00:00"))]
    valid = _adapters()["humanizer"].payload
    adapter = LateOnceAdapter(_binding("humanizer"), valid, clock)
    service = PipelineStageService(
        connection, adapters={"humanizer": adapter}, now=lambda: clock[0],
    )
    item = service.start_from_saved_revision(
        "campaign-a", revision.revision_id, "start-request",
    )

    with pytest.raises(PipelineStageError, match="^lease_expired$"):
        service.run_next(item.item_id, "late-request")

    attempt = connection.execute(
        "SELECT state,failure_code FROM prospecting_stage_attempt WHERE request_id='late-request'"
    ).fetchone()
    assert tuple(attempt) == ("expired", "lease_expired")
    assert connection.execute(
        "SELECT count(*) FROM prospecting_stage_artifact"
    ).fetchone()[0] == 0
    assert service.get_item(item.item_id).state == "awaiting_humanizer_adapter"
    with pytest.raises(PipelineStageError, match="^lease_expired$"):
        service.run_next(item.item_id, "late-request")
    assert adapter.calls == 1

    recovered = service.run_next(item.item_id, "recovery-request")

    assert recovered.state == "awaiting_post_factcheck_adapter"
    assert adapter.calls == 2


def test_lineage_root_rejects_dual_parent_tables(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(
        connection, adapters=_adapters(),
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    item = service.start_from_saved_revision(
        "campaign-a", revision.revision_id, "start-request",
    )
    _run_to_review(service, item.item_id)
    accepted = service.accept_suggestion(
        item.item_id, "accept-request", revision.revision_id, "human:fixture",
    )
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        ("malformed-candidate", "malformed-request", "campaign-a", "person-a", 0,
         revision.revision_id, "Malformed", f"Hello. {POINT}. {ASK}",
         "revision_created", "{}", NOW),
    )
    connection.execute(
        "INSERT INTO review_revision_lineage VALUES(?,?,?,?,?,?,?,?)",
        (accepted.revision_id, revision.revision_id, "malformed-candidate",
         "malformed-request", "campaign-a", "person-a", 0, NOW),
    )
    connection.commit()

    with pytest.raises(PipelineStageError, match="^revision_lineage_ambiguous$"):
        service.start_from_saved_revision(
            "campaign-a", accepted.revision_id, "ambiguous-start",
        )
    assert connection.in_transaction is False


def test_lineage_root_rejects_cross_table_cycle(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(
        connection, adapters=_adapters(),
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    item = service.start_from_saved_revision(
        "campaign-a", revision.revision_id, "start-request",
    )
    _run_to_review(service, item.item_id)
    accepted = service.accept_suggestion(
        item.item_id, "accept-request", revision.revision_id, "human:fixture",
    )
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        ("cycle-candidate", "cycle-request", "campaign-a", "person-a", 0,
         accepted.revision_id, "Malformed", f"Hello. {POINT}. {ASK}",
         "revision_created", "{}", NOW),
    )
    connection.execute(
        "INSERT INTO review_revision_lineage VALUES(?,?,?,?,?,?,?,?)",
        (revision.revision_id, accepted.revision_id, "cycle-candidate",
         "cycle-request", "campaign-a", "person-a", 0, NOW),
    )
    connection.commit()

    with pytest.raises(PipelineStageError, match="^revision_lineage_cycle$"):
        service.start_from_saved_revision(
            "campaign-a", accepted.revision_id, "cycle-start",
        )
    assert connection.in_transaction is False


@pytest.mark.parametrize(
    "binding_case",
    [
        "omitted", "replacement", "exact_aliases", "overlap_aliases",
        "distinct_same_source",
    ],
)
def test_factcheck_preserves_surviving_parent_sender_binding_for_qa(
    tmp_path: Path, binding_case: str,
) -> None:
    connection, _revision = _seed(tmp_path)
    sender_claim = "Example background"
    parent_body = (
        f"Hello. {POINT}. Product Built. Example Built. {sender_claim}. {ASK}"
    )
    parent = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, "Sender-bound example", parent_body,
        "why_them", "bespoke", None, ASK, ("evidence-a",), (POINT,), (),
        "networking", 1, "fixture-prompt", "fixture-model",
        QaResult(True, 100, {"fixture": True}, ()),
    ))
    record_revision_qa_context(
        connection, parent.revision_id,
        {
            "why_them": SlotBinding(POINT, "evidence", "evidence-a"),
            "topic": SlotBinding("Product Built", "evidence", "evidence-a"),
            "recipient_hook": SlotBinding("Example Built", "evidence", "evidence-a"),
            "sender_claim": SlotBinding(
                sender_claim, "sender", "sender_profile.sender_background",
            ),
            "ask": SlotBinding(ASK, "policy", "policy.ask"),
        },
        QaPolicy("networking", 0, "informational_call", 1, 120, 0.7),
        inherited_from_revision_id=None, created_at=NOW,
    )
    connection.commit()
    adapters = _adapters()
    final_body = f"Hello there. {POINT}. {sender_claim}. {ASK}"
    if binding_case == "distinct_same_source":
        final_body = (
            f"Hello there. {POINT}. Product Built. Example Built. "
            f"{sender_claim}. {ASK}"
        )
    adapters["humanizer"].payload = {
        "draft": final_body,
        "audit": "Synthetic parent claim remains.",
        "final_subject": "A natural sender-bound subject",
        "final_body": final_body,
    }
    if binding_case == "replacement":
        adapters["post_humanization_factcheck"].payload["bindings"].append({
            "slot": "sender_claim", "value": POINT,
            "source_kind": "evidence", "source_ref": "evidence-a",
        })
    elif binding_case in {"exact_aliases", "overlap_aliases"}:
        aliases = (
            (POINT, POINT)
            if binding_case == "exact_aliases"
            else ("Built Example", "Example Product")
        )
        adapters["post_humanization_factcheck"].payload["bindings"].extend([
            {"slot": "role", "value": aliases[0],
             "source_kind": "evidence", "source_ref": "evidence-a"},
            {"slot": "company", "value": aliases[1],
             "source_kind": "evidence", "source_ref": "evidence-a"},
        ])
    elif binding_case == "distinct_same_source":
        adapters["post_humanization_factcheck"].payload["bindings"].extend([
            {"slot": "topic", "value": "Product Built",
             "source_kind": "evidence", "source_ref": "evidence-a"},
            {"slot": "recipient_hook", "value": "Example Built",
             "source_kind": "evidence", "source_ref": "evidence-a"},
        ])
    service = PipelineStageService(
        connection, adapters=adapters,
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    item = service.start_from_saved_revision(
        "campaign-a", parent.revision_id, "sender-bound-start",
    )
    service.run_next(item.item_id, "sender-bound-human")

    result = service.run_next(item.item_id, "sender-bound-fact")

    expected_state = (
        "awaiting_critic_adapter"
        if binding_case == "distinct_same_source"
        else "awaiting_humanizer_adapter"
    )
    assert result.state == expected_state
    artifact = connection.execute(
        "SELECT payload_json FROM prospecting_stage_artifact "
        "WHERE item_id=? AND stage='post_humanization_factcheck'",
        (item.item_id,),
    ).fetchone()
    payload = json.loads(artifact[0])
    assert payload["bindings"]["sender_claim"] == {
        "value": sender_claim,
        "source_kind": "sender",
        "source_ref": "sender_profile.sender_background",
    }
    if binding_case in {"omitted", "replacement"}:
        assert "recipient_sender_ratio" in payload["qa_failure_codes"]
    if binding_case == "replacement":
        assert "binding_context_conflict" in payload["qa_failure_codes"]
    if binding_case in {"exact_aliases", "overlap_aliases"}:
        assert "recipient_binding_alias" in payload["qa_failure_codes"]
    if binding_case == "distinct_same_source":
        assert payload["decision"] == "pass"
        assert payload["qa_failure_codes"] == []


def test_repair_budget_survives_new_intake_run_for_same_lineage(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    adapters = _adapters(critic="repair")
    service = PipelineStageService(connection, adapters=adapters, now=lambda: datetime.fromisoformat(NOW.replace("Z","+00:00")))
    first = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request-a")
    for cycle in range(3):
        service.run_next(first.item_id, f"first-h-{cycle}")
        service.run_next(first.item_id, f"first-f-{cycle}")
        service.run_next(first.item_id, f"first-c-{cycle}")
    connection.execute(
        """INSERT INTO prospecting_pipeline_intake(
               intake_id,request_id,request_hash,campaign_id,campaign_policy_hash,intake_revision,
               intake_hash,as_of_date,funding_stage_min,funding_stage_max,funding_window_years,
               funding_stage_interpretation,geography_mode,geography_json,sector_mode,sector_json,
               requested_companies,requested_people_per_company,role_families_json,
               original_specification,outreach_goal,cutoff_date,created_at
           ) SELECT 'intake-b','intake-request-b','5'||substr(request_hash,2),campaign_id,
                    campaign_policy_hash,2,'6'||substr(intake_hash,2),as_of_date,
                    funding_stage_min,funding_stage_max,funding_window_years,
                    funding_stage_interpretation,geography_mode,geography_json,sector_mode,
                    sector_json,requested_companies,requested_people_per_company,
                    role_families_json,original_specification,outreach_goal,cutoff_date,created_at
               FROM prospecting_pipeline_intake WHERE intake_id='intake-a'"""
    )
    connection.execute(
        """INSERT INTO prospecting_pipeline_run(
               run_id,intake_id,campaign_id,intake_hash,campaign_policy_hash,workflow_id,
               workflow_version,workflow_hash,state,next_stage,repair_cycle,max_repair_cycles,
               pending_fields_json,created_at,updated_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("run-b","intake-b","campaign-a","6" + "3"*63,"a"*64,"outreach-skill",1,"4"*64,
         "awaiting_research_adapter","research",0,2,"[]",NOW,NOW),
    )
    connection.commit()

    with pytest.raises(PipelineStageError, match="^repair_budget_exhausted$"):
        service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request-b")
    assert connection.execute(
        "SELECT count(*) FROM prospecting_pipeline_item"
    ).fetchone()[0] == 1


def _clock() -> datetime:
    return datetime.fromisoformat(NOW.replace("Z", "+00:00"))


def _exhaust(service: PipelineStageService, item_id: str, prefix: str):
    for cycle in range(3):
        service.run_next(item_id, f"{prefix}-h-{cycle}")
        service.run_next(item_id, f"{prefix}-f-{cycle}")
        result = service.run_next(item_id, f"{prefix}-c-{cycle}")
    assert (result.state, result.repair_cycle) == ("parked", 2)
    return result


def _human_edit(connection, parent_revision_id: str, index: int, sentence: str, **extra):
    result = ReviewService(connection, now=lambda: NOW).edit_draft(EditDraftRequest(
        request_id(index), "campaign-a", parent_revision_id,
        extra.pop("subject", f"Revised synthetic subject {index}"),
        extra.pop("body", f"Hello. {POINT}. {sentence} {ASK}"), **extra,
    ))
    return result


def _fresh_revision(connection, subject: str) -> str:
    """A model-produced current revision with no human-edit lineage."""
    revision = build_revision(connection, RevisionInput(
        "person-a", "campaign-a", 0, subject, f"Hello. {POINT}. {ASK}", "why_them",
        "bespoke", None, ASK, ("evidence-a",), (POINT,), (), "networking", 1,
        "fixture-prompt", "fixture-model", QaResult(True, 100, {"fixture": True}, ()),
    ))
    record_revision_qa_context(
        connection, revision.revision_id,
        {"why_them": SlotBinding(POINT, "evidence", "evidence-a"),
         "ask": SlotBinding(ASK, "policy", "policy.ask")},
        QaPolicy("networking", 0, "informational_call", 1, 120, 0.7),
        inherited_from_revision_id=None, created_at=NOW,
    )
    connection.commit()
    return revision.revision_id


def _authority_counts(connection) -> tuple[int, ...]:
    return tuple(
        connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in (
            "draft_editorial_event", "approval", "identity_source_review",
            "source_snapshot", "exec_request",
        )
    )


def test_changed_human_edit_restarts_exhausted_lineage_at_cycle_zero(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(critic="repair"), now=_clock)
    exhausted = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _exhaust(service, exhausted.item_id, "old")
    assert service.get_restart_offer("campaign-a", revision.revision_id) is None
    edited = _human_edit(
        connection, revision.revision_id, 21, "This human edit reframes the synthetic evidence.",
    )
    assert edited.state == "revision_created"
    with pytest.raises(PipelineStageError, match="^repair_budget_exhausted$"):
        service.start_from_saved_revision("campaign-a", edited.revision_id, "plain-start")
    before = _authority_counts(connection)

    offer = service.get_restart_offer("campaign-a", edited.revision_id)
    assert (offer.state, offer.exhausted_item_id, offer.code) == (
        "restart_available", exhausted.item_id, None,
    )
    restarted = service.start_from_human_edit(
        "campaign-a", edited.revision_id, exhausted.item_id, "restart-request", "human:fixture",
    )

    assert (restarted.base_revision_id, restarted.state, restarted.next_stage, restarted.repair_cycle) == (
        edited.revision_id, "awaiting_humanizer_adapter", "humanizer", 0,
    )
    item = connection.execute(
        "SELECT * FROM prospecting_pipeline_item WHERE item_id=?", (restarted.item_id,),
    ).fetchone()
    assert (item["lineage_root_revision_id"], item["claim_epoch"], item["request_id"]) == (
        edited.revision_id, 0, "restart-request",
    )
    reset = connection.execute("SELECT * FROM prospecting_pipeline_reset").fetchone()
    assert (
        reset["item_id"], reset["exhausted_item_id"], reset["exhausted_base_revision_id"],
        reset["exhausted_root_revision_id"], reset["edited_revision_id"],
        reset["edit_parent_revision_id"], reset["edit_candidate_id"], reset["actor"],
    ) == (
        restarted.item_id, exhausted.item_id, revision.revision_id, revision.revision_id,
        edited.revision_id, revision.revision_id, edited.candidate_id, "human:fixture",
    )
    old = service.get_item(exhausted.item_id)
    assert (old.state, old.repair_cycle) == ("parked", 2)
    assert _authority_counts(connection) == before

    assert service.start_from_human_edit(
        "campaign-a", edited.revision_id, exhausted.item_id, "restart-request", "human:fixture",
    ) == restarted
    for changed in (
        ("campaign-a", edited.revision_id, exhausted.item_id, "restart-request", "human:other"),
        ("campaign-a", edited.revision_id, "item-other", "restart-request", "human:fixture"),
    ):
        with pytest.raises(PipelineStageError, match="^request_conflict$"):
            service.start_from_human_edit(*changed)
    with pytest.raises(PipelineStageError, match="^request_conflict$"):
        service.start_from_saved_revision("campaign-a", edited.revision_id, "restart-request")
    with pytest.raises(PipelineStageError, match="^request_conflict$"):
        service.start_from_human_edit(
            "campaign-a", edited.revision_id, exhausted.item_id, "start-request", "human:fixture",
        )
    with pytest.raises(PipelineStageError, match="^pipeline_work_conflict$"):
        service.start_from_human_edit(
            "campaign-a", edited.revision_id, exhausted.item_id, "restart-again", "human:fixture",
        )
    with pytest.raises(PipelineStageError, match="^human_actor_required$"):
        service.start_from_human_edit(
            "campaign-a", edited.revision_id, exhausted.item_id, "agent-restart", "agent:humanizer",
        )
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_reset").fetchone()[0] == 1
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_item").fetchone()[0] == 2
    assert connection.in_transaction is False

    reviewer = PipelineStageService(connection, adapters=_adapters(), now=_clock)
    _run_to_review(reviewer, restarted.item_id)
    accepted = reviewer.accept_suggestion(
        restarted.item_id, "accept-restart", edited.revision_id, "human:fixture",
    )
    assert require_revision_review_chain(
        connection, "campaign-a", accepted.revision_hash, NOW,
    )["revision_id"] == accepted.revision_id
    with pytest.raises(PipelineStageError, match="^human_editorial_ready_missing$"):
        require_revision_ready(connection, "campaign-a", accepted.revision_hash, NOW)
    assert _authority_counts(connection) == before


def test_restart_refuses_unchanged_edits_and_preserves_pending_human_edit(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(critic="repair"), now=_clock)
    exhausted = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _exhaust(service, exhausted.item_id, "old")
    with pytest.raises(PipelineStageError, match="^reset_edit_unchanged$"):
        service.start_from_human_edit(
            "campaign-a", revision.revision_id, exhausted.item_id, "same-base", "human:fixture",
        )
    parent = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (revision.revision_id,),
    ).fetchone()
    changed = _human_edit(connection, revision.revision_id, 22, "A temporary synthetic change.")
    assert changed.state == "revision_created"
    # Reverting to the exhausted text creates no revision (its copy hash already exists);
    # the saved attempt stays visible and unresolved instead of enabling a restart.
    reverted = _human_edit(
        connection, changed.revision_id, 23, "", subject=parent["subject"], body=parent["body"],
    )
    assert (reverted.state, reverted.revision_id) == ("qa_failed", changed.revision_id)
    offer = service.get_restart_offer("campaign-a", changed.revision_id)
    assert (offer.state, offer.code) == ("restart_blocked", "human_edit_unresolved")
    with pytest.raises(PipelineStageError, match="^human_edit_unresolved$"):
        service.start_from_human_edit(
            "campaign-a", changed.revision_id, exhausted.item_id, "pending", "human:fixture",
        )
    assert connection.execute(
        "SELECT qa_state FROM review_candidate WHERE candidate_id=?", (reverted.candidate_id,),
    ).fetchone()[0] == "qa_failed"

    resolved = _human_edit(
        connection, changed.revision_id, 24, "A resolved synthetic change.",
        expected_candidate_id=reverted.candidate_id,
    )
    assert resolved.state == "revision_created"
    restarted = service.start_from_human_edit(
        "campaign-a", resolved.revision_id, exhausted.item_id, "resolved", "human:fixture",
    )
    assert restarted.repair_cycle == 0
    assert connection.execute("SELECT count(*) FROM review_candidate").fetchone()[0] == 3


def test_restart_refuses_forged_and_model_only_revisions(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(critic="repair"), now=_clock)
    exhausted = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _exhaust(service, exhausted.item_id, "old")
    forged = _fresh_revision(connection, "Forged synthetic subject")
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        ("forged-candidate", "forged-request", "campaign-a", "person-a", 0,
         revision.revision_id, "Forged synthetic subject", f"Hello. {POINT}. {ASK}",
         "revision_created", "{}", NOW),
    )
    connection.execute(
        "INSERT INTO review_revision_lineage VALUES(?,?,?,?,?,?,?,?)",
        (forged, revision.revision_id, "forged-candidate", "forged-request",
         "campaign-a", "person-a", 0, NOW),
    )
    connection.commit()
    offer = service.get_restart_offer("campaign-a", forged)
    assert (offer.state, offer.code) == ("restart_blocked", "reset_edit_required")
    with pytest.raises(PipelineStageError, match="^reset_edit_required$"):
        service.start_from_human_edit(
            "campaign-a", forged, exhausted.item_id, "forged", "human:fixture",
        )
    forged_hash = connection.execute(
        "SELECT hash FROM revision WHERE revision_id=?", (forged,),
    ).fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError, match="prospecting_pipeline_reset_scope"):
        connection.execute(
            """INSERT INTO prospecting_pipeline_reset VALUES(
                   'reset-forged','forged-reset','5'||substr(?,2),'item-forged','campaign-a',
                   'person-a',0,?,?,?,?,?,?,'forged-candidate','forged-request','human:fixture',?)""",
            (forged_hash, exhausted.item_id, revision.revision_id, revision.revision_id,
             forged, forged_hash, revision.revision_id, NOW),
        )
    with pytest.raises(sqlite3.IntegrityError, match="prospecting_pipeline_reset_item_scope"):
        connection.execute(
            """INSERT INTO prospecting_pipeline_item(
                   item_id,request_id,request_hash,run_id,campaign_id,intake_hash,
                   campaign_policy_hash,person_id,step,base_revision_id,base_revision_hash,
                   lineage_root_revision_id,evidence_manifest_hash,state,next_stage,
                   repair_cycle,max_repair_cycles,claim_epoch,created_at,updated_at
               ) SELECT 'item-escape','escape-request',request_hash,run_id,campaign_id,
                        intake_hash,campaign_policy_hash,person_id,step,?,?,?,
                        evidence_manifest_hash,'awaiting_humanizer_adapter','humanizer',
                        0,2,0,created_at,updated_at
                   FROM prospecting_pipeline_item WHERE item_id=?""",
            (forged, forged_hash, forged, exhausted.item_id),
        )

    model_only = _fresh_revision(connection, "Regenerated synthetic subject")
    assert service.get_restart_offer("campaign-a", model_only) is None
    with pytest.raises(PipelineStageError, match="^reset_edit_required$"):
        service.start_from_human_edit(
            "campaign-a", model_only, exhausted.item_id, "model-only", "human:fixture",
        )
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_reset").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_item").fetchone()[0] == 1


def test_restart_refuses_wrong_scope_root_and_newer_work(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(critic="repair"), now=_clock)
    first = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-first")
    _exhaust(service, first.item_id, "first")
    fresh = _fresh_revision(connection, "Fresh synthetic subject")
    second = service.start_from_saved_revision("campaign-a", fresh, "start-second")
    edited = _human_edit(connection, fresh, 27, "A newer synthetic human edit.")

    cases = (
        (("campaign-a", edited.revision_id, first.item_id), "pipeline_work_conflict"),
        (("campaign-a", edited.revision_id, second.item_id), "reset_not_exhausted"),
        (("campaign-a", edited.revision_id, "item-missing"), "pipeline_item_missing"),
        (("campaign-b", edited.revision_id, second.item_id), "revision_not_current"),
        (("campaign-a", fresh, second.item_id), "revision_not_current"),
    )
    for index, (arguments, code) in enumerate(cases):
        with pytest.raises(PipelineStageError, match=f"^{code}$"):
            service.start_from_human_edit(*arguments, f"scope-{index}", "human:fixture")

    third = service.start_from_saved_revision("campaign-a", edited.revision_id, "start-third")
    _exhaust(service, third.item_id, "third")
    other = _fresh_revision(connection, "Other synthetic subject")
    other_edit = _human_edit(connection, other, 28, "An edit in another lineage.")
    assert service.get_restart_offer("campaign-a", other_edit.revision_id) is None
    with pytest.raises(PipelineStageError, match="^reset_scope_mismatch$"):
        service.start_from_human_edit(
            "campaign-a", other_edit.revision_id, third.item_id, "wrong-root", "human:fixture",
        )
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_reset").fetchone()[0] == 0
    assert connection.in_transaction is False


@pytest.mark.parametrize("failure", ["python_between_rows", "sqlite_item_insert", "orphan_boundary"])
def test_restart_boundary_and_item_commit_or_roll_back_together(
    tmp_path: Path, monkeypatch, failure: str,
) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(critic="repair"), now=_clock)
    exhausted = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _exhaust(service, exhausted.item_id, "old")
    edited = _human_edit(connection, revision.revision_id, 29, "A crash-window synthetic edit.")
    original = PipelineStageService._insert_start_item
    if failure == "python_between_rows":
        def crash(self, *args, **kwargs):
            assert self.connection.execute(
                "SELECT count(*) FROM prospecting_pipeline_reset",
            ).fetchone()[0] == 1
            raise RuntimeError("injected_crash")
        monkeypatch.setattr(PipelineStageService, "_insert_start_item", crash)
    elif failure == "sqlite_item_insert":
        connection.execute(
            """CREATE TEMP TRIGGER injected_crash BEFORE INSERT ON prospecting_pipeline_item
               WHEN EXISTS (SELECT 1 FROM prospecting_pipeline_reset WHERE item_id=NEW.item_id)
               BEGIN SELECT RAISE(ABORT,'injected_crash'); END"""
        )
    else:
        monkeypatch.setattr(
            PipelineStageService, "_insert_start_item",
            lambda self, *args, **kwargs: kwargs["item_id"],
        )

    with pytest.raises((RuntimeError, sqlite3.IntegrityError)):
        service.start_from_human_edit(
            "campaign-a", edited.revision_id, exhausted.item_id, "restart-request", "human:fixture",
        )

    assert connection.in_transaction is False
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_reset").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_item").fetchone()[0] == 1
    monkeypatch.setattr(PipelineStageService, "_insert_start_item", original)
    connection.execute("DROP TRIGGER IF EXISTS temp.injected_crash")
    restarted = service.start_from_human_edit(
        "campaign-a", edited.revision_id, exhausted.item_id, "restart-request", "human:fixture",
    )
    assert restarted.repair_cycle == 0
    assert connection.execute("SELECT count(*) FROM prospecting_pipeline_reset").fetchone()[0] == 1


def test_late_result_from_old_attempt_is_fenced_after_restart(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    clock = [_clock()]
    old = PipelineStageService(connection, adapters=_adapters(critic="repair"), now=lambda: clock[0])
    item = old.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    for cycle in range(2):
        old.run_next(item.item_id, f"old-h-{cycle}")
        old.run_next(item.item_id, f"old-f-{cycle}")
        old.run_next(item.item_id, f"old-c-{cycle}")
    old.run_next(item.item_id, "old-h-2")
    old.run_next(item.item_id, "old-f-2")
    other = open_store(tmp_path / "pipeline-stage.sqlite")
    restarted: dict[str, object] = {}

    def recover_exhaust_edit_and_restart() -> None:
        worker = PipelineStageService(
            other, adapters={"independent_critic": _adapters(critic="repair")["independent_critic"]},
            now=lambda: clock[0],
        )
        worker.recover_expired(item.item_id)
        assert worker.run_next(item.item_id, "recovered-c-2").state == "parked"
        edited = _human_edit(other, revision.revision_id, 30, "A human edit during a stale claim.")
        restarted["item"] = worker.start_from_human_edit(
            "campaign-a", edited.revision_id, item.item_id, "restart-request", "human:fixture",
        )

    late = PipelineStageService(
        connection,
        adapters={"independent_critic": InterleavedCritic(
            _binding("critic"), clock, recover_exhaust_edit_and_restart,
        )},
        now=lambda: clock[0],
    )
    with pytest.raises(PipelineStageError, match="^lease_lost$"):
        late.run_next(item.item_id, "late-c-2")

    new_item = restarted["item"]
    assert tuple(connection.execute(
        "SELECT state,failure_code FROM prospecting_stage_attempt WHERE request_id='late-c-2'"
    ).fetchone()) == ("expired", "lease_expired")
    assert connection.execute(
        """SELECT count(*) FROM prospecting_stage_artifact AS artifact
             JOIN prospecting_stage_attempt AS attempt ON attempt.attempt_id=artifact.attempt_id
            WHERE attempt.request_id='late-c-2'"""
    ).fetchone()[0] == 0
    parked = old.get_item(item.item_id)
    assert (parked.state, parked.repair_cycle) == ("parked", 2)
    fresh = connection.execute(
        "SELECT state,claim_epoch,repair_cycle FROM prospecting_pipeline_item WHERE item_id=?",
        (new_item.item_id,),
    ).fetchone()
    assert tuple(fresh) == ("awaiting_humanizer_adapter", 0, 0)
    assert connection.execute(
        "SELECT count(*) FROM prospecting_stage_attempt WHERE item_id=?", (new_item.item_id,),
    ).fetchone()[0] == 0
    other.close()


def test_re_exhaustion_requires_another_changed_human_edit(tmp_path: Path) -> None:
    connection, revision = _seed(tmp_path)
    service = PipelineStageService(connection, adapters=_adapters(critic="repair"), now=_clock)
    first = service.start_from_saved_revision("campaign-a", revision.revision_id, "start-request")
    _exhaust(service, first.item_id, "first")
    edit_one = _human_edit(connection, revision.revision_id, 31, "The first restart edit.")
    second = service.start_from_human_edit(
        "campaign-a", edit_one.revision_id, first.item_id, "restart-one", "human:fixture",
    )
    _exhaust(service, second.item_id, "second")
    with pytest.raises(PipelineStageError, match="^reset_edit_unchanged$"):
        service.start_from_human_edit(
            "campaign-a", edit_one.revision_id, second.item_id, "restart-same", "human:fixture",
        )

    edit_two = _human_edit(connection, edit_one.revision_id, 32, "The second restart edit.")
    with pytest.raises(PipelineStageError, match="^repair_budget_exhausted$"):
        service.start_from_saved_revision("campaign-a", edit_two.revision_id, "plain-two")
    with pytest.raises(PipelineStageError, match="^pipeline_work_conflict$"):
        service.start_from_human_edit(
            "campaign-a", edit_two.revision_id, first.item_id, "restart-stale", "human:fixture",
        )
    offer = service.get_restart_offer("campaign-a", edit_two.revision_id)
    assert (offer.state, offer.exhausted_item_id) == ("restart_available", second.item_id)
    third = service.start_from_human_edit(
        "campaign-a", edit_two.revision_id, second.item_id, "restart-two", "human:fixture",
    )

    assert third.repair_cycle == 0
    assert connection.execute(
        "SELECT lineage_root_revision_id FROM prospecting_pipeline_item WHERE item_id=?",
        (third.item_id,),
    ).fetchone()[0] == edit_two.revision_id
    assert [tuple(row) for row in connection.execute(
        "SELECT exhausted_item_id,edited_revision_id FROM prospecting_pipeline_reset ORDER BY rowid"
    )] == [
        (first.item_id, edit_one.revision_id), (second.item_id, edit_two.revision_id),
    ]
