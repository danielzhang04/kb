"""P16 over a genuine selected (P22) draft, its P24 attestation and a real P21 reset.

Every row here comes from a real table and a real service: the selection is produced
by the actual P15-P20 fixture pipeline, the draft by ``SelectedDraftService``, the
stage work by the actual ``PipelineStageService`` start/run_next adapters, the human
confirmation by ``SelectedSourceReviewService``, and the restart by the actual
``start_from_human_edit`` boundary. No fill/affinity/contact/approval row is created,
no budget or source authority is faked, and the model stages are synthetic *test
adapters* -- they stand for a model runtime, not for native acceptance of anything.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
import json
from pathlib import Path
from typing import Mapping

import pytest

from scripts.prospecting.affinity.evidence_bridge import CurrentRoleProof
from scripts.prospecting.pipeline_stage_service import (
    ItemProjection,
    PipelineStageError,
    PipelineStageService,
    ReviewProjection,
    StageBinding,
    StageJob,
    StageResult,
    require_revision_ready,
    require_revision_review_chain,
)
from scripts.prospecting.review_qa import (
    load_revision_qa_context,
    record_revision_qa_context,
)
from scripts.prospecting.selected_draft_service import resolve_revision_selection
from scripts.prospecting.selected_source_review import (
    SelectedSourceAttestationRequest,
    SelectedSourceReviewService,
    selected_revision_role_proof,
)
from scripts.prospecting.tests.test_selected_draft_service import (
    FIRST,
    P22_TABLES,
    SECOND,
    _link,
    _request,
    _revision_copy,
    _service,
)
from scripts.prospecting.tests.test_selected_person_render import (
    LEGACY_TABLES,
    _counts,
    _render_ready,
)
from scripts.prospecting.tests.test_selected_person_source import NOW, STAMP


ATTESTATION_TABLE = "selected_source_attestation"
# Private synthetic sentinels: they stand for the raw source excerpt / source_url a
# real proof carries and for proposed recipient-facing copy.  None may appear in a
# projection repr.
SENTINEL_SOURCE_URL = "https://sentinel.test/PRIVATE-PROOF-URL"
SENTINEL_EXCERPT = "PRIVATE PROOF EXCERPT SENTINEL"
SENTINEL_SUBJECT = "PRIVATE SUGGESTION SUBJECT SENTINEL"
SENTINEL_BODY = "PRIVATE SUGGESTION BODY SENTINEL"
# Identity, source and selection state that a P16 run, a human confirmation and a
# P21 budget reset must all leave completely alone.
WATCHED = (
    "employment", "source_observation", "source_snapshot", "evidence", "revision",
    "revision_qa_context", *P22_TABLES,
)
ACTOR = "human:local-review"


@dataclass
class _Adapter:
    """A synthetic stage adapter: it asserts the exact bindings it was handed.

    It is a test double for a model runtime and proves nothing about model quality.
    """

    binding: StageBinding
    payload: Mapping[str, object]
    calls: int = 0
    inputs: list = field(default_factory=list)

    def execute(self, job: StageJob) -> StageResult:
        self.calls += 1
        value = json.loads(job.input_json)
        context = value["approved_context"]
        assert value["stage"] == job.stage
        assert value["approved_context_hash"]
        # The exact selected source is bound into the stage context ...
        assert context["current_role_proof"]["snapshot_id"]
        assert context["current_role_proof"]["candidate_observation_id"]
        # ... but its confirmation state deliberately is not, so confirming the
        # source cannot move the approved-context hash under produced artifacts.
        assert "attested" not in context["current_role_proof"]
        assert context["qa_context"]["bindings"]
        self.inputs.append(value)
        return StageResult(self.payload)


def _binding(name: str) -> StageBinding:
    letter = {"humanizer": "a", "factchecker": "b", "critic": "c"}[name]
    return StageBinding(
        f"selected-executor-{name}", "runtime-private", "v1", letter * 64,
        (letter + "0") * 32, name, "v1",
        ("d" if name == "humanizer" else "e") * 64,
        ("f" if name == "critic" else "9") * 64,
    )


def _bound(tmp_path: Path):
    """Real P15-P20 selection, then a real P22 selected-draft materialization."""
    connection, _selected, source = _render_ready(tmp_path)
    receipt = _service(connection).materialize(_request(source))
    return connection, source, receipt


def _stage_adapters(connection, revision_id: str, *, changed: bool = False,
                    critic: str = "pass") -> dict[str, _Adapter]:
    """Adapters that re-state the saved selected copy and its recorded bindings."""
    revision = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (revision_id,),
    ).fetchone()
    subject, body = str(revision["subject"]), str(revision["body"])
    if changed:
        words = subject.split()
        assert len(words) >= 3
        # A minimal real change: same words, same length band, different bytes.
        subject = " ".join([*words[:-2], words[-1], words[-2]])
    context = load_revision_qa_context(connection, revision_id)
    fact_bindings = [
        {
            "slot": name, "value": binding.value,
            "source_kind": binding.source_kind, "source_ref": binding.source_ref,
        }
        for name, binding in context.bindings.items()
    ]
    return {
        "humanizer": _Adapter(_binding("humanizer"), {
            "draft": body, "audit": "The selected copy was left intact.",
            "final_subject": subject, "final_body": body,
        }),
        "post_humanization_factcheck": _Adapter(_binding("factchecker"), {
            "decision": "pass", "bindings": fact_bindings,
            "uncertainty": [], "shortfalls": [],
        }),
        "independent_critic": _Adapter(_binding("critic"), {
            "decision": critic, "reasons": [],
            "repair_instructions": (
                "Revise the selected draft." if critic == "repair" else ""
            ),
        }),
    }


def _service_for(connection, adapters) -> PipelineStageService:
    return PipelineStageService(connection, adapters=adapters, now=lambda: NOW)


def _run_cycle(service: PipelineStageService, item_id: str, prefix: str):
    service.run_next(item_id, f"{prefix}-h")
    service.run_next(item_id, f"{prefix}-f")
    return service.run_next(item_id, f"{prefix}-c")


def _attest(connection, source, receipt, *, request_id: str = FIRST,
            revision_id: str | None = None):
    return SelectedSourceReviewService(connection, now=lambda: NOW).attest(
        SelectedSourceAttestationRequest(
            request_id, source.campaign_id, source.person_id,
            revision_id or receipt.revision_id, receipt.source_context_digest,
            source.candidate_observation_id, True,
        ),
    )


def _copy(connection, revision_id: str) -> tuple[str, str]:
    row = connection.execute(
        "SELECT subject,body FROM revision WHERE revision_id=?", (revision_id,),
    ).fetchone()
    return str(row["subject"]), str(row["body"])


def _binding_row(connection) -> tuple:
    return tuple(connection.execute(
        """SELECT binding_id,binding_hash,revision_id,revision_hash,
                  source_context_digest,render_context_digest
             FROM selected_draft_binding ORDER BY rowid""",
    ).fetchall()[-1])


def _saved_human_edit(connection, parent_id: str, *, tag: str, digest: str,
                      subject: str, body: str) -> str:
    """Record one genuine human edit through the real review lineage tables.

    ``ReviewService.edit_draft`` has no selected-scope support in this slice, so the
    edit is written as the same real ``review_request`` / ``review_candidate`` /
    ``review_revision_lineage`` / ``revision_qa_context`` rows that path produces --
    named honestly here rather than pretending the ReviewService route was used.
    """
    child = _revision_copy(connection, parent_id, f"rev-{tag}", subject, body, digest)
    _link(connection, parent_id, child, tag)
    context = load_revision_qa_context(connection, parent_id)
    record_revision_qa_context(
        connection, child, context.bindings, context.policy,
        inherited_from_revision_id=parent_id, created_at=STAMP,
    )
    return child


def test_selected_no_change_chain_runs_pending_then_ready_after_attestation(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    adapters = _stage_adapters(connection, receipt.revision_id)
    service = _service_for(connection, adapters)

    item = service.start_from_saved_revision(
        source.campaign_id, receipt.revision_id, "selected-start",
    )
    _run_cycle(service, item.item_id, "selected")

    # The whole model chain runs on a merely pending (unconfirmed) source proof.
    projection = service.get_review_projection(item.item_id)
    assert projection.source_proof is not None
    assert projection.source_proof.attested is False
    assert projection.source_proof.candidate_observation_id == source.candidate_observation_id
    accepted = service.accept_suggestion(
        item.item_id, "selected-accept", receipt.revision_id, ACTOR,
    )
    assert accepted.unchanged is True
    assert accepted.revision_id == receipt.revision_id

    # Readiness is still refused: only a human confirmation makes identity current.
    with pytest.raises(PipelineStageError, match="^identity_source_review_missing$"):
        require_revision_review_chain(
            connection, source.campaign_id, accepted.revision_hash, NOW,
        )

    before = _counts(connection, *WATCHED)
    copy_before = _copy(connection, receipt.revision_id)
    binding_before = _binding_row(connection)

    result = _attest(connection, source, receipt)

    assert (result.attested, result.state) == (True, "attested")
    # Confirmation changed employment, source observations, snapshots, evidence,
    # revision text and the selection binding in no way at all.
    assert _counts(connection, *WATCHED) == before
    assert _copy(connection, receipt.revision_id) == copy_before
    assert _binding_row(connection) == binding_before
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)

    # The same artifacts now satisfy the chain: the approved-context hash did not
    # move, because the proof projection excludes ``attested``.
    assert require_revision_review_chain(
        connection, source.campaign_id, accepted.revision_hash, NOW,
    )["revision_id"] == accepted.revision_id
    assert selected_revision_role_proof(
        connection, accepted.revision_id, NOW,
    ).attested is True
    # Human editorial readiness is still a separate, missing decision.
    with pytest.raises(PipelineStageError, match="^human_editorial_ready_missing$"):
        require_revision_ready(
            connection, source.campaign_id, accepted.revision_hash, NOW,
        )
    connection.close()


def test_unrelated_open_employment_for_the_same_person_is_ignored(tmp_path: Path) -> None:
    connection, source, receipt = _bound(tmp_path)
    connection.execute(
        "INSERT INTO company(company_id,name,website_url,source_lane,dedupe_key)"
        " VALUES(?,?,?,?,?)",
        (
            "co_unrelatedp16", "Unrelated Synthetic", "https://unrelated.test/",
            "manual", "company:unrelated-p16",
        ),
    )
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,
               retrieved_at,confidence,snapshot_id)
           VALUES(?,'person',?,'source_review_candidate',?,?,?,?,1.0,?)""",
        (
            "obs_unrelatedp16", source.person_id,
            '{"excerpt":"unrelated synthetic role"}', source.snapshot_id,
            STAMP, STAMP, source.snapshot_id,
        ),
    )
    connection.execute(
        """INSERT INTO employment(
               employment_id,person_id,company_id,title,valid_from,valid_to,
               source_observation_id,confidence)
           VALUES(?,?,?,?,NULL,NULL,?,1.0)""",
        (
            "emp_unrelatedp16", source.person_id, "co_unrelatedp16", "Board Advisor",
            "obs_unrelatedp16",
        ),
    )
    adapters = _stage_adapters(connection, receipt.revision_id)
    service = _service_for(connection, adapters)
    item = service.start_from_saved_revision(
        source.campaign_id, receipt.revision_id, "unrelated-start",
    )
    _run_cycle(service, item.item_id, "unrelated")
    accepted = service.accept_suggestion(
        item.item_id, "unrelated-accept", receipt.revision_id, ACTOR,
    )
    _attest(connection, source, receipt)

    proof = selected_revision_role_proof(connection, accepted.revision_id, NOW)

    # The newest employment row never becomes the bound one: selection decides.
    assert proof.employment_id == source.employment_id
    assert proof.company_id == source.company_id
    assert proof.attested is True
    assert require_revision_review_chain(
        connection, source.campaign_id, accepted.revision_hash, NOW,
    )["revision_id"] == accepted.revision_id
    connection.close()


def test_changed_accepted_suggestion_resolves_the_exact_selected_root(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    _attest(connection, source, receipt)
    adapters = _stage_adapters(connection, receipt.revision_id, changed=True)
    service = _service_for(connection, adapters)
    item = service.start_from_saved_revision(
        source.campaign_id, receipt.revision_id, "changed-start",
    )
    _run_cycle(service, item.item_id, "changed")

    accepted = service.accept_suggestion(
        item.item_id, "changed-accept", receipt.revision_id, ACTOR,
    )

    assert accepted.unchanged is False
    assert accepted.revision_id != receipt.revision_id
    assert connection.execute(
        "SELECT count(*) FROM prospecting_agent_revision_lineage",
    ).fetchone()[0] == 1
    # The accepted agent revision resolves back to the exact bound selected root.
    resolved = resolve_revision_selection(connection, accepted.revision_id, NOW)
    assert resolved is not None
    assert resolved.source_context_digest == source.source_context_digest
    assert resolved.candidate_observation_id == source.candidate_observation_id
    proof = selected_revision_role_proof(connection, accepted.revision_id, NOW)
    assert (proof.attested, proof.employment_id) == (True, source.employment_id)
    assert require_revision_review_chain(
        connection, source.campaign_id, accepted.revision_hash, NOW,
    )["revision_id"] == accepted.revision_id
    with pytest.raises(PipelineStageError, match="^human_editorial_ready_missing$"):
        require_revision_ready(
            connection, source.campaign_id, accepted.revision_hash, NOW,
        )
    # Acceptance opened no new selected binding and no new P22 request.
    assert _counts(connection, *P22_TABLES) == (1, 1)
    assert _counts(connection, ATTESTATION_TABLE) == (1,)
    connection.close()


def test_real_p21_reset_after_exhaustion_retains_selection_and_pending_proof(
    tmp_path: Path,
) -> None:
    """A P21 budget reset is not a selection boundary: the real walk passes it.

    This replaces the previous source-text structural assertion with a real reset:
    the budget is genuinely exhausted over two repair cycles by the actual critic
    path, an actual restart boundary is committed, and the selection is then
    resolved through the live resolver rather than inspected as source text.
    """
    connection, source, receipt = _bound(tmp_path)
    adapters = _stage_adapters(connection, receipt.revision_id, critic="repair")
    service = _service_for(connection, adapters)
    item = service.start_from_saved_revision(
        source.campaign_id, receipt.revision_id, "reset-start",
    )

    for cycle in range(3):
        parked = _run_cycle(service, item.item_id, f"reset-{cycle}")
    assert (parked.state, parked.repair_cycle) == ("parked", 2)
    assert adapters["independent_critic"].calls == 3

    parent_subject, parent_body = _copy(connection, receipt.revision_id)
    edited = _saved_human_edit(
        connection, receipt.revision_id, tag="p21_edit", digest="a7" * 32,
        subject="A reviewer rewrote this selected subject",
        body=parent_body + "\n\nAdded by the human reviewer.",
    )
    offer = service.get_restart_offer(source.campaign_id, edited)
    assert (offer.state, offer.exhausted_item_id, offer.code) == (
        "restart_available", item.item_id, None,
    )

    restarted = service.start_from_human_edit(
        source.campaign_id, edited, item.item_id, "reset-restart", ACTOR,
    )

    assert (restarted.state, restarted.next_stage, restarted.repair_cycle) == (
        "awaiting_humanizer_adapter", "humanizer", 0,
    )
    row = connection.execute(
        """SELECT lineage_root_revision_id,base_revision_id,claim_epoch
             FROM prospecting_pipeline_item WHERE item_id=?""",
        (restarted.item_id,),
    ).fetchone()
    assert (row["lineage_root_revision_id"], row["base_revision_id"], row["claim_epoch"]) == (
        edited, edited, 0,
    )
    assert connection.execute(
        "SELECT count(*) FROM prospecting_pipeline_reset",
    ).fetchone()[0] == 1

    # The fresh budget root did not truncate, re-root or discard the selection.
    resolved = resolve_revision_selection(connection, edited, NOW)
    assert resolved is not None
    assert resolved.source_context_digest == source.source_context_digest
    assert resolved.person_rank_id == source.person_rank_id
    proof = selected_revision_role_proof(connection, edited, NOW)
    assert proof.attested is False
    assert proof.candidate_observation_id == source.candidate_observation_id
    binding = _binding_row(connection)
    assert binding[2] == receipt.revision_id
    assert binding[4] == source.source_context_digest
    assert _counts(connection, *P22_TABLES) == (1, 1)
    assert _counts(connection, ATTESTATION_TABLE) == (0,)
    assert _counts(connection, *LEGACY_TABLES) == (0,) * len(LEGACY_TABLES)
    # A reset grants no readiness on its own.
    with pytest.raises(PipelineStageError, match="^identity_source_review_missing$"):
        require_revision_review_chain(
            connection, source.campaign_id,
            connection.execute(
                "SELECT hash FROM revision WHERE revision_id=?", (edited,),
            ).fetchone()[0],
            NOW,
        )
    assert parent_subject
    connection.close()


@pytest.mark.parametrize("case", ["sender", "source_bytes"])
def test_drift_between_stages_refuses_before_the_next_adapter_call(
    tmp_path: Path, case: str,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    adapters = _stage_adapters(connection, receipt.revision_id)
    service = _service_for(connection, adapters)
    item = service.start_from_saved_revision(
        source.campaign_id, receipt.revision_id, f"drift-{case}-start",
    )
    service.run_next(item.item_id, f"drift-{case}-h")
    if case == "sender":
        connection.execute(
            """UPDATE sender_profile SET sender_background=?
                WHERE sender_profile_id='sender-synthetic'""",
            ("Drifted background.",),
        )
    else:
        body_ref = connection.execute(
            """SELECT body_ref FROM source_snapshot
                WHERE allowlist_version='operator-local-v1' ORDER BY rowid DESC LIMIT 1""",
        ).fetchone()[0]
        (tmp_path / "snapshots" / body_ref).write_text(
            "PRIVATE SENTINEL", encoding="utf-8",
        )

    with pytest.raises(PipelineStageError) as refused:
        service.run_next(item.item_id, f"drift-{case}-f")

    assert str(refused.value) in {
        "identity_source_proof_stale", "pipeline_context_stale",
    }
    assert "PRIVATE SENTINEL" not in repr(refused.value)
    # The refusal happened before the next stage adapter was ever invoked.
    assert adapters["post_humanization_factcheck"].calls == 0
    assert connection.execute(
        """SELECT count(*) FROM prospecting_stage_artifact
            WHERE item_id=? AND stage='post_humanization_factcheck'""",
        (item.item_id,),
    ).fetchone()[0] == 0
    assert _counts(connection, ATTESTATION_TABLE) == (0,)
    connection.close()


def test_replay_runs_no_extra_calls_and_pending_human_edit_blocks_acceptance(
    tmp_path: Path,
) -> None:
    connection, source, receipt = _bound(tmp_path)
    adapters = _stage_adapters(connection, receipt.revision_id)
    service = _service_for(connection, adapters)
    item = service.start_from_saved_revision(
        source.campaign_id, receipt.revision_id, "replay-start",
    )

    first = service.run_next(item.item_id, "replay-h")
    replay = service.run_next(item.item_id, "replay-h")

    assert first == replay
    assert adapters["humanizer"].calls == 1
    service.run_next(item.item_id, "replay-f")
    service.run_next(item.item_id, "replay-c")
    assert adapters["post_humanization_factcheck"].calls == 1
    assert adapters["independent_critic"].calls == 1

    revision = connection.execute(
        "SELECT * FROM revision WHERE revision_id=?", (receipt.revision_id,),
    ).fetchone()
    connection.execute(
        """INSERT INTO review_candidate(
               candidate_id,request_id,campaign_id,person_id,step,parent_revision_id,
               subject,body,qa_state,qa_json,created_at
           ) VALUES(?,?,?,?,?,?,?,?,'pending_qa',NULL,?)""",
        (
            "cand_p16_pending", "req_p16_pending", revision["campaign_id"],
            revision["person_id"], revision["step"], receipt.revision_id,
            "Human edited subject", "Human edited body", STAMP,
        ),
    )
    copy_before = _copy(connection, receipt.revision_id)
    suggestion_before = tuple(connection.execute(
        "SELECT subject,body,proposed_revision_hash FROM prospecting_pipeline_suggestion",
    ).fetchone())

    # The generated suggestion waits; it never overwrites the pending human edit.
    with pytest.raises(PipelineStageError, match="^human_edit_unresolved$"):
        service.accept_suggestion(
            item.item_id, "replay-accept", receipt.revision_id, ACTOR,
        )

    assert _copy(connection, receipt.revision_id) == copy_before
    assert tuple(connection.execute(
        "SELECT subject,body,proposed_revision_hash FROM prospecting_pipeline_suggestion",
    ).fetchone()) == suggestion_before
    assert connection.execute(
        "SELECT qa_state FROM review_candidate WHERE candidate_id='cand_p16_pending'",
    ).fetchone()[0] == "pending_qa"
    assert connection.execute(
        "SELECT count(*) FROM prospecting_suggestion_decision",
    ).fetchone()[0] == 0
    assert _counts(connection, *P22_TABLES) == (1, 1)
    assert SECOND  # imported request-id constant kept for symmetry with P22 tests
    connection.close()


def test_review_projection_repr_leaks_neither_proof_nor_suggestion_copy() -> None:
    """The whole projection repr is suppressed, both halves of it.

    The proof is a real :class:`CurrentRoleProof` built from the production
    dataclass; only its field values are private synthetic sentinels, so the legacy
    excerpt/source_url half and the suggestion subject/body half are both covered.
    """
    proof = CurrentRoleProof(
        "camp-synthetic", "person-synthetic", "company-synthetic",
        "employment-synthetic", "observation-synthetic", "snapshot-synthetic",
        SENTINEL_SOURCE_URL, SENTINEL_EXCERPT, STAMP, STAMP, False,
    )
    projection = ReviewProjection(
        ItemProjection(
            "item-synthetic", "camp-synthetic", "person-synthetic",
            "rev-synthetic", "human_review", None, 0,
        ),
        proof, "suggestion-synthetic", SENTINEL_SUBJECT, SENTINEL_BODY,
        "d" * 64, None,
    )

    text = repr(projection)

    for sentinel in (
        SENTINEL_SOURCE_URL, SENTINEL_EXCERPT, SENTINEL_SUBJECT, SENTINEL_BODY,
    ):
        assert sentinel not in text
    assert "ReviewProjection" in text
    # Value semantics are unchanged by suppressing the repr.
    assert replace(projection) == projection
    assert projection.source_proof is proof
    assert projection.suggestion_body == SENTINEL_BODY
