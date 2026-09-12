"""Bounded repair continuity at the shared P16 humanizer stage-input seam.

These tests drive the real :class:`PipelineStageService` start/``run_next`` path
with synthetic stage adapters. The adapters are test doubles standing in for a
model runtime: nothing here is evidence about model behaviour or quality, and no
positive acceptance of any real runtime is claimed. Every fixture helper,
binding factory and constant is imported from
``test_pipeline_stage_service`` rather than copied, so the two suites cannot
drift and that file stays unmodified.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import json
from pathlib import Path

from scripts.prospecting.pipeline_stage_service import (
    PipelineStageService,
    StageBinding,
    StageJob,
    StageResult,
)
from scripts.prospecting.tests.test_pipeline_stage_service import (
    ASK,
    NOW,
    POINT,
    CapturingAdapter,
    _adapters,
    _binding,
    _clock,
    _exhaust,
    _fresh_revision,
    _seed,
)


@dataclass
class ScriptedAdapter:
    """A synthetic stage adapter returning a different payload per call.

    It is a test double standing in for a model runtime. It proves nothing about
    model behaviour or quality and implies no acceptance of any real runtime.
    """

    binding: StageBinding
    payloads: list
    inputs: list = field(default_factory=list)
    calls: int = 0

    def execute(self, job: StageJob) -> StageResult:
        value = json.loads(job.input_json)
        assert value["stage"] == job.stage
        self.inputs.append(value)
        payload = self.payloads[min(self.calls, len(self.payloads) - 1)]
        self.calls += 1
        return StageResult(payload)


def _stage_artifacts(connection, item_id: str, stage: str):
    return connection.execute(
        """SELECT cycle,decision,output_hash,proposed_revision_hash
             FROM prospecting_stage_artifact
            WHERE item_id=? AND stage=? ORDER BY cycle""",
        (item_id, stage),
    ).fetchall()


def _artifact_hashes(connection, item_id: str) -> set[str]:
    return {
        str(row[0]) for row in connection.execute(
            "SELECT output_hash FROM prospecting_stage_artifact WHERE item_id=?",
            (item_id,),
        )
    }


def test_humanizer_repair_job_carries_previous_candidate_and_bounded_history(
    tmp_path: Path,
) -> None:
    connection, revision = _seed(tmp_path)
    parent_body = str(connection.execute(
        "SELECT body FROM revision WHERE revision_id=?", (revision.revision_id,),
    ).fetchone()[0])
    good_body = f"Hello there. {POINT}. {ASK}"
    degraded_body = f"Hello. A generic synthetic note. {ASK}"
    recovered_body = f"Hello again. {POINT}. {ASK}"
    humanizer = ScriptedAdapter(_binding("humanizer"), [
        {"draft": good_body, "audit": "Synthetic audit for cycle zero.",
         "final_subject": "A natural example subject", "final_body": good_body},
        {"draft": degraded_body, "audit": "Synthetic evidence phrase was removed.",
         "final_subject": "Generic subject", "final_body": degraded_body},
        {"draft": recovered_body, "audit": "Synthetic audit for cycle two.",
         "final_subject": "A recovered example subject", "final_body": recovered_body},
    ])
    passing = {
        "decision": "pass",
        "bindings": [
            {"slot": "why_them", "value": POINT,
             "source_kind": "evidence", "source_ref": "evidence-a"},
            {"slot": "ask", "value": ASK,
             "source_kind": "policy", "source_ref": "policy.ask"},
        ],
        "uncertainty": [], "shortfalls": [],
    }
    dropped_evidence = {
        "decision": "pass",
        "bindings": [
            {"slot": "ask", "value": ASK,
             "source_kind": "policy", "source_ref": "policy.ask"},
        ],
        "uncertainty": [], "shortfalls": ["The evidence phrase is missing."],
    }
    critic_repair = {
        "decision": "repair",
        "reasons": ["The role sentence is repeated."],
        "repair_instructions": "Connect the topic to the stated sender interest.",
    }
    factchecker = ScriptedAdapter(
        _binding("factchecker"), [passing, dropped_evidence, passing],
    )
    critic = ScriptedAdapter(_binding("critic"), [critic_repair])
    service = PipelineStageService(
        connection,
        adapters={
            "humanizer": humanizer,
            "post_humanization_factcheck": factchecker,
            "independent_critic": critic,
        },
        now=lambda: datetime.fromisoformat(NOW.replace("Z", "+00:00")),
    )
    item = service.start_from_saved_revision(
        "campaign-a", revision.revision_id, "continuity-start",
    )

    service.run_next(item.item_id, "continuity-h0")
    service.run_next(item.item_id, "continuity-f0")
    after_critic = service.run_next(item.item_id, "continuity-c0")
    service.run_next(item.item_id, "continuity-h1")
    after_fact = service.run_next(item.item_id, "continuity-f1")
    service.run_next(item.item_id, "continuity-h2")

    assert (after_critic.repair_cycle, after_fact.repair_cycle) == (1, 2)
    assert humanizer.calls == 3
    first, second, third = humanizer.inputs
    # A first cycle invents no history at all.
    assert "previous_candidate" not in first
    assert "repair_history" not in first
    assert "repair_from" not in first

    produced = _stage_artifacts(connection, item.item_id, "humanizer")
    assert second["previous_candidate"] == {
        "cycle": 0,
        "artifact_hash": produced[0]["output_hash"],
        "proposed_revision_hash": produced[0]["proposed_revision_hash"],
        "final_subject": "A natural example subject",
        "final_body": good_body,
    }
    assert [
        (row["cycle"], row["stage"], row["decision"])
        for row in second["repair_history"]
    ] == [(0, "independent_critic", "repair")]
    # The pre-existing compatible field is preserved unchanged.
    assert second["repair_from"]["stage"] == "independent_critic"

    # The cycle after a deterministic QA failure revises its own latest work and
    # still sees the earlier, never-satisfied critic objection.
    candidate = third["previous_candidate"]
    assert candidate["cycle"] == 1
    assert candidate["final_body"] == degraded_body
    assert candidate["final_subject"] == "Generic subject"
    assert candidate["proposed_revision_hash"] == produced[1]["proposed_revision_hash"]
    assert candidate["artifact_hash"] == produced[1]["output_hash"]
    # Producer self-assessment never travels with the candidate.
    assert set(candidate) == {
        "cycle", "artifact_hash", "proposed_revision_hash", "final_subject",
        "final_body",
    }
    history = third["repair_history"]
    assert [
        (row["cycle"], row["stage"], row["decision"]) for row in history
    ] == [
        (0, "independent_critic", "repair"),
        (1, "post_humanization_factcheck", "fail"),
    ]
    assert history[0]["payload"]["reasons"] == ["The role sentence is repeated."]
    assert history[0]["payload"]["repair_instructions"].startswith("Connect the topic")
    assert "name_swap" in history[1]["payload"]["qa_failure_codes"]
    # The passing cycle-0 fact-check is not replayed as a grievance.
    assert all(row["decision"] in {"fail", "repair"} for row in history)
    # The approved original and the approved context remain present and remain
    # the authority; the job is no longer original-only.
    assert third["revision"]["body"] == parent_body
    assert candidate["final_body"] != parent_body
    assert third["approved_context"]["qa_context"]["bindings"]
    assert third["approved_context_hash"]

    # The independent critic still receives no producer audit and no continuity.
    critic_input = critic.inputs[0]
    assert "audit" not in critic_input["candidate"]
    assert "previous_candidate" not in critic_input
    assert "repair_history" not in critic_input
    # Other stage inputs are unchanged by this seam.
    assert "previous_candidate" not in factchecker.inputs[1]
    assert "repair_history" not in factchecker.inputs[1]


def test_repair_history_excludes_other_items_and_keeps_two_repair_budget(
    tmp_path: Path,
) -> None:
    connection, revision = _seed(tmp_path)
    neighbour_service = PipelineStageService(
        connection, adapters=_adapters(critic="repair"), now=_clock,
    )
    neighbour = neighbour_service.start_from_saved_revision(
        "campaign-a", revision.revision_id, "scope-start-a",
    )
    _exhaust(neighbour_service, neighbour.item_id, "scope-a")
    neighbour_hashes = _artifact_hashes(connection, neighbour.item_id)
    assert len(neighbour_hashes) >= 3

    fresh = _fresh_revision(connection, "A second synthetic item subject")
    body = f"Hello there. {POINT}. {ASK}"
    humanizer = CapturingAdapter(_binding("humanizer"), {
        "draft": body, "audit": "Synthetic audit.",
        "final_subject": "A second natural subject", "final_body": body,
    })
    adapters = _adapters(critic="repair")
    adapters["humanizer"] = humanizer
    service = PipelineStageService(connection, adapters=adapters, now=_clock)
    item = service.start_from_saved_revision("campaign-a", fresh, "scope-start-b")

    service.run_next(item.item_id, "scope-b-h0")
    service.run_next(item.item_id, "scope-b-f0")
    repaired = service.run_next(item.item_id, "scope-b-c0")
    service.run_next(item.item_id, "scope-b-h1")

    assert repaired.repair_cycle == 1
    assert "previous_candidate" not in humanizer.inputs[0]
    assert "repair_history" not in humanizer.inputs[0]
    history = humanizer.inputs[1]["repair_history"]
    assert [(row["cycle"], row["stage"]) for row in history] == [
        (0, "independent_critic"),
    ]
    seen = {row["artifact_hash"] for row in history}
    assert seen & neighbour_hashes == set()
    assert seen <= _artifact_hashes(connection, item.item_id)
    assert humanizer.inputs[1]["previous_candidate"]["final_body"] == body

    # The exhausted neighbour keeps its parked state and its exact budget, and
    # the new item gets the same unchanged two-repair budget.
    assert tuple(connection.execute(
        """SELECT state,repair_cycle,max_repair_cycles
             FROM prospecting_pipeline_item WHERE item_id=?""",
        (neighbour.item_id,),
    ).fetchone()) == ("parked", 2, 2)
    assert connection.execute(
        "SELECT max_repair_cycles FROM prospecting_pipeline_item WHERE item_id=?",
        (item.item_id,),
    ).fetchone()[0] == 2
