"""MANUAL, opt-in desktop acceptance harness for the native private stage runtime.

This module is deliberately named ``manual_*`` so pytest never collects it, and
every dependency import happens lazily inside ``_run`` so the default invocation
has no data, filesystem, or model side effects.  It exercises the real
Humanizer, post-humanization fact-check, and independent critic stages through
the real ``PipelineStageService`` and the real native Codex adapters, against a
fully synthetic SQLite fixture in a freshly created private directory.

The fixture is the reviewed synthetic selected draft: the real P15-P20 fixture
pipeline (``test_selected_person_render._render_ready``) followed by a real
``SelectedDraftService`` materialization and a real selected-resolver check.
The P19 qualification fact-check inside that fixture is a *synthetic in-process
adapter* (``test_qualification_service._Adapter``), explicitly not a real
qualification model, and nothing here claims otherwise.  Only the three
editorial stages above run against the real native adapters.

Preparation stops at a saved, still-proof-pending draft.  No source
confirmation, identity attestation, acceptance, readiness or send is performed
or implied anywhere in this module.

It never accepts a caller-provided store, prompt, or real input path; never
rewrites the production ``ACCEPTED_RUNTIME_BUNDLE_SHA256`` pin; and never makes
an acceptance, readiness, approval, or send decision.  Stdout is bounded
metadata only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, NamedTuple
from urllib.parse import urlsplit

__test__ = False

HARNESS = "manual_private_stage_acceptance"
PRIVATE_ROOT = Path(
    "C:/Users/danie/kb/_private/prospecting-native-stage-acceptance-20260911"
)
STORE_NAME = "store.sqlite"
STAGES = ("humanizer", "post_humanization_factcheck", "independent_critic")
STOP_STATES = frozenset({"parked", "human_review", "accepted"})
MAX_STAGE_CALLS = 9
MAX_REPAIR_CYCLES = 2
# The exact request identity of this harness's one selected-draft
# materialization; a replay of the same fixture returns the same receipt.
FIXTURE_REQUEST_ID = "9f1d7a2c-0b2e-4a6d-9c3f-5e7b1a4d8c60"
# Root-reviewed synthetic sender persona: explicitly labelled, modest,
# grammatically complete first-person sentences, so the real Humanizer receives
# a coherent operations draft (with some repetition it is expected to edit)
# rather than an ungrammatical fragment. No real person, claim, or PII.
SYNTHETIC_SENDER = (
    "Sam Synthetic",
    "I am learning how operations teams use AI in day-to-day work.",
    "I ran a five-person scheduling rota for two quarters in this synthetic example.",
)
# The exact snapshot allowlist versions the synthetic fixture pipeline really
# writes: the fixture seed lane, the P18 operator-local person capture, and the
# P17 FundingResearchService operator-captured public pages.  This is a synthetic
# fixture source allowlist only; no production permission is widened here, and
# every snapshot URL must still be a synthetic ``.test`` host.
ALLOWED_ALLOWLISTS = frozenset({
    "fixture-v1", "operator-local-v1", "operator-public-capture-v1",
})


class _Fixture(NamedTuple):
    """Opaque synthetic fixture identity: IDs and digests only, never copy."""

    campaign_id: str
    person_id: str
    revision_id: str
    revision_hash: str
    binding_id: str
    binding_hash: str
    prompt_version: str


FIXED_CODES = frozenset({
    # harness-owned outcomes
    "manual_opt_in_required", "run_root_unavailable", "fixture_preparation_failed",
    "fixture_identity_mismatch", "fixture_draft_incomplete", "fixture_binding_invalid",
    "fixture_selection_invalid", "fixture_proof_not_pending",
    "reached_human_review_no_decision", "parked_after_bounded_repairs",
    "stage_budget_exhausted", "harness_unexpected_error", "unrecognized_fixed_code",
    # pipeline stage service codes
    "stage_adapter_unavailable", "stage_not_runnable", "stage_in_progress", "stage_conflict",
    "stage_input_stale", "stage_input_invalid", "stage_input_too_large", "stage_input_missing",
    "adapter_failed", "adapter_result_invalid", "critic_not_independent", "lease_lost",
    "lease_expired", "lease_active", "pipeline_item_missing", "pipeline_item_exists",
    "pipeline_run_missing", "pipeline_context_stale", "pipeline_work_conflict",
    "revision_missing", "revision_not_current", "revision_evidence_invalid",
    "revision_qa_context_invalid", "revision_lineage_ambiguous", "revision_lineage_cycle",
    "identity_source_review_missing", "identity_source_proof_missing", "human_edit_unresolved",
    "candidate_context_invalid", "candidate_qa_failed", "proposed_revision_hash_mismatch",
    "humanizer_output_invalid", "factcheck_output_invalid", "critic_output_invalid",
    "repair_budget_exhausted", "request_conflict", "transaction_active", "transaction_required",
    "store_state_invalid", "invalid_time", "invalid_lease", "invalid_stage_binding",
    "stage_runtime_failed", "stage_runtime_timeout", "stage_runtime_tool_rejected",
    "stage_runtime_output_invalid", "stage_runtime_cleanup_failed",
    # native adapter / private runtime codes
    "private_store_invalid", "runtime_root_invalid", "runtime_bundle_changed",
    "runtime_capability_invalid", "runtime_cleanup_failed", "runtime_io_failed",
    "runtime_timeout", "runtime_manifest_invalid", "runtime_schema_invalid",
    "runtime_config_mismatch", "stage_job_invalid", "stage_output_invalid",
    "stage_content_invalid", "preflight_output_invalid", "prohibited_content_logged",
    "sink_scan_incomplete", "sink_scan_failed", "tool_configuration_invalid",
    "tool_event_rejected", "event_stream_invalid", "event_stream_incomplete",
    "event_line_too_large", "provider_unavailable", "cache_prime_failed",
    "cache_prime_timeout", "cache_prime_missing", "codex_unavailable",
    "desktop_context_missing", "private_root_invalid", "attempt_exists",
    "attempt_directory_invalid", "attempt_path_conflict", "attempt_write_failed",
    "humanizer_skill_unavailable", "humanizer_skill_mismatch",
    "qualification_skill_unavailable", "qualification_skill_mismatch",
    "live_runtime_not_accepted", "windows_job_unavailable", "process_start_failed",
    "process_wait_failed", "process_termination_failed", "job_assignment_failed",
    "stdin_path_invalid", "stdin_open_failed", "stdin_read_failed", "stdin_hash_mismatch",
    "stdin_cleanup_failed", "stdout_pipe_failed", "stdout_read_failed", "stdout_too_large",
})


class _HarnessError(Exception):
    """Fixed-category harness refusal carrying no free-form detail."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _fixed(code: object) -> str:
    return code if isinstance(code, str) and code in FIXED_CODES else "unrecognized_fixed_code"


def _emit(report: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _new_run_root() -> Path:
    from scripts.prospecting.personalizer import private_runtime as runtime

    try:
        PRIVATE_ROOT.mkdir(parents=True, exist_ok=True)
        runtime._require_plain_directory_tree(PRIVATE_ROOT)
        run_root = PRIVATE_ROOT / uuid.uuid4().hex
        run_root.mkdir(mode=0o700)
        runtime._require_plain_directory_tree(run_root)
        return run_root
    except (OSError, ValueError):
        raise _HarnessError("run_root_unavailable") from None


def _prepare_fixture(run_root: Path, now: datetime) -> tuple[Any, _Fixture]:
    """Materialize the reviewed synthetic selected draft with the real services.

    The real P15-P20 fixture pipeline, the real ``SelectedDraftService`` and the
    real selected resolver are used exactly as they ship.  Identities come from
    the resolved selected source itself, never from hardcoded fixture IDs and
    never from an arbitrary newest employment row.  Nothing here fabricates a
    fill, contact, affinity, approval, P13 identity-source or human source
    attestation row, and no acceptance, readiness or send decision is made.
    """
    from scripts.prospecting.selected_draft_service import (
        SelectedDraftRequest,
        SelectedDraftService,
        resolve_revision_selection,
    )
    from scripts.prospecting.selected_person_render import RENDER_VERSION
    from scripts.prospecting.selected_source_review import selected_revision_role_proof
    from scripts.prospecting.tests.test_selected_person_render import (
        LEGACY_TABLES,
        _render_ready,
    )

    connection = None
    try:
        try:
            connection, _selected, source = _render_ready(run_root)
            connection.execute(
                """UPDATE sender_profile
                      SET sender_name=?,sender_focus=?,sender_operating_proof=?
                    WHERE sender_profile_id=(
                      SELECT sender_profile_id FROM campaign WHERE campaign_id=?
                    )""",
                (*SYNTHETIC_SENDER, source.campaign_id),
            )
            # The binding service refuses a caller-owned transaction, so this
            # harness closes its own seeding write before materializing.
            connection.commit()
            receipt = SelectedDraftService(connection, now=lambda: now).materialize(
                SelectedDraftRequest(
                    FIXTURE_REQUEST_ID, source.campaign_id, source.run_id,
                    source.person_rank_id, source.ranking_batch_hash,
                ),
            )
        except Exception:
            raise _HarnessError("fixture_preparation_failed") from None
        if (
            (receipt.state, receipt.replayed) != ("bound", False)
            or receipt.predecessor_binding_hash is not None
            or receipt.superseded_revision_id is not None
        ):
            raise _HarnessError("fixture_binding_invalid")
        counted = (
            "revision", "selected_draft_binding", "selected_draft_request",
            "prospecting_pipeline_item", "prospecting_pipeline_reset",
            "prospecting_stage_attempt", "prospecting_stage_artifact",
            "selected_source_attestation", "selected_source_attestation_request",
            *LEGACY_TABLES,
        )
        counts = {
            table: int(connection.execute(
                f"SELECT count(*) FROM {table}",
            ).fetchone()[0])
            for table in counted
        }
        if (
            counts["revision"], counts["selected_draft_binding"],
            counts["selected_draft_request"],
        ) != (1, 1, 1):
            raise _HarnessError("fixture_binding_invalid")
        # No fabricated fill, contact, affinity, approval or P13 identity-source
        # row, no P24 selected-source attestation or attestation request, and no
        # pipeline or budget state yet.
        if any(counts[table] for table in (
            *LEGACY_TABLES, "prospecting_pipeline_item", "prospecting_pipeline_reset",
            "prospecting_stage_attempt", "prospecting_stage_artifact",
            "selected_source_attestation", "selected_source_attestation_request",
        )):
            raise _HarnessError("fixture_identity_mismatch")
        binding = connection.execute(
            "SELECT * FROM selected_draft_binding",
        ).fetchone()
        if binding is None or (
            str(binding["binding_id"]), str(binding["revision_id"]),
            str(binding["binding_hash"]), str(binding["person_id"]),
            str(binding["campaign_id"]),
        ) != (
            receipt.binding_id, receipt.revision_id, receipt.binding_hash,
            source.person_id, source.campaign_id,
        ) or binding["predecessor_binding_hash"] is not None:
            raise _HarnessError("fixture_binding_invalid")
        revision = connection.execute(
            "SELECT * FROM revision WHERE revision_id=?", (receipt.revision_id,),
        ).fetchone()
        if revision is None:
            raise _HarnessError("fixture_draft_incomplete")
        expected_prompt = (
            f"{RENDER_VERSION}:{receipt.source_context_digest}"
            f":{receipt.render_context_digest}"
        )
        if (
            str(revision["prompt_version"]) != expected_prompt
            or receipt.prompt_version != expected_prompt
            or str(revision["hash"]) != receipt.revision_hash
            or str(revision["campaign_id"]) != source.campaign_id
            or str(revision["person_id"]) != source.person_id
            or int(revision["step"]) != 0
        ):
            raise _HarnessError("fixture_identity_mismatch")
        sender = connection.execute(
            """SELECT sender_name,sender_focus,sender_operating_proof
                 FROM sender_profile
                WHERE sender_profile_id=(
                  SELECT sender_profile_id FROM campaign WHERE campaign_id=?
                )""",
            (source.campaign_id,),
        ).fetchone()
        if sender is None or tuple(str(value) for value in sender) != SYNTHETIC_SENDER:
            raise _HarnessError("fixture_identity_mismatch")
        body = str(revision["body"])
        if not body.strip() or SYNTHETIC_SENDER[0] not in body or "{" in body:
            raise _HarnessError("fixture_draft_incomplete")
        # Exactly one own QA context, inherited from nothing: a proper
        # still-proof-pending draft, with no human attestation anywhere.
        context = connection.execute(
            """SELECT inherited_from_revision_id FROM revision_qa_context
                WHERE revision_id=?""",
            (receipt.revision_id,),
        ).fetchall()
        if len(context) != 1 or context[0][0] is not None:
            raise _HarnessError("fixture_draft_incomplete")
        for row in connection.execute(
            "SELECT source_url,allowlist_version FROM source_snapshot",
        ).fetchall():
            host = urlsplit(str(row[0])).hostname or ""
            if not host.endswith(".test") or str(row[1]) not in ALLOWED_ALLOWLISTS:
                raise _HarnessError("fixture_identity_mismatch")
        try:
            resolved = resolve_revision_selection(connection, receipt.revision_id, now)
        except Exception:
            raise _HarnessError("fixture_selection_invalid") from None
        if resolved is None or (
            resolved.person_id, resolved.campaign_id, resolved.company_id,
            resolved.employment_id, resolved.source_context_digest,
        ) != (
            source.person_id, source.campaign_id, source.company_id,
            source.employment_id, receipt.source_context_digest,
        ):
            raise _HarnessError("fixture_selection_invalid")
        # The one real pending-proof guarantee: the shared P24 read helper must
        # resolve this exact revision to an *unattested* selected-source proof
        # over the exact candidate/snapshot/person/campaign the resolver names.
        # Nothing here mints or requests an attestation.
        try:
            proof = selected_revision_role_proof(connection, receipt.revision_id, now)
        except Exception:
            raise _HarnessError("fixture_proof_not_pending") from None
        if proof is None or proof.attested is not False or (
            proof.candidate_observation_id, proof.snapshot_id,
            proof.person_id, proof.campaign_id,
        ) != (
            resolved.candidate_observation_id, resolved.snapshot_id,
            source.person_id, source.campaign_id,
        ):
            raise _HarnessError("fixture_proof_not_pending")
        return connection, _Fixture(
            source.campaign_id, source.person_id, receipt.revision_id,
            receipt.revision_hash, receipt.binding_id, receipt.binding_hash,
            receipt.prompt_version,
        )
    except BaseException:
        if connection is not None:
            try:
                connection.close()
            except BaseException:
                pass
        raise


def _drive(service, item, report: dict[str, Any], stage_error: type) -> tuple[str, str]:
    """Run bounded real stages; stop immediately on failure, park, or human review."""
    calls = 0
    while (
        calls < MAX_STAGE_CALLS
        and item.state not in STOP_STATES
        and item.next_stage in STAGES
        and item.repair_cycle <= MAX_REPAIR_CYCLES
    ):
        stage = item.next_stage
        calls += 1
        started = time.monotonic()
        try:
            item = service.run_next(item.item_id, f"manual-acceptance-{calls}")
        except stage_error as error:
            code = _fixed(getattr(error, "code", None))
            report["stages"].append({
                "stage": stage, "state": "failed", "code": code,
                "elapsed_ms": round((time.monotonic() - started) * 1000),
            })
            report["stage_calls"] = calls
            return "failed", code
        except BaseException:
            report["stages"].append({
                "stage": stage, "state": "failed", "code": "harness_unexpected_error",
                "elapsed_ms": round((time.monotonic() - started) * 1000),
            })
            report["stage_calls"] = calls
            return "failed", "harness_unexpected_error"
        report["stages"].append({
            "stage": stage, "state": item.state, "code": "ok",
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        })
    report["stage_calls"] = calls
    report["repair_cycle"] = item.repair_cycle
    report["final_state"] = item.state
    if item.state == "human_review":
        return "succeeded", "reached_human_review_no_decision"
    if item.state == "parked":
        return "failed", "parked_after_bounded_repairs"
    return "failed", "stage_budget_exhausted"


def _run() -> int:
    from scripts.prospecting.personalizer import private_runtime as runtime
    from scripts.prospecting.personalizer import private_stage_adapter as adapter
    from scripts.prospecting.pipeline_stage_service import PipelineStageError, PipelineStageService
    from scripts.prospecting.tests.test_selected_person_source import NOW as FIXTURE_NOW

    wall_started = datetime.now(timezone.utc)
    report: dict[str, Any] = {
        "harness": HARNESS, "schema_version": 1, "mode": "run",
        "status": "failed", "code": "harness_unexpected_error",
        "requested_model": adapter.REQUESTED_MODEL, "responding_model_verified": False,
        "accepted_pin_present": adapter.ACCEPTED_RUNTIME_BUNDLE_SHA256 is not None,
        "stages": [], "stage_calls": 0,
        "cleanup": {"capability_invalidated": False, "runtime_root": "not_started",
                    "connection_closed": False, "adapter_cleanup_codes": []},
    }
    connection = capability = parent = None
    stage_adapters: Mapping[str, Any] = {}
    try:
        run_root = _new_run_root()
        report["run_root_id"] = run_root.name
        connection, fixture = _prepare_fixture(run_root, FIXTURE_NOW)
        # Opaque synthetic identities and digests only; never any draft copy.
        report["fixture"] = {
            "binding_id": fixture.binding_id, "binding_hash": fixture.binding_hash,
            "revision_id": fixture.revision_id, "revision_hash": fixture.revision_hash,
            "prompt_version": fixture.prompt_version,
        }
        assets = adapter._stage_assets()
        selected = adapter._selected_environment(os.environ)
        executable = runtime._codex_executable(selected)
        expected_bundle = adapter._digest(adapter._bundle_manifest(
            runtime._sha_file(executable), runtime._cli_version(executable), assets,
        ))
        parent, capability = adapter._bootstrap(
            run_root / STORE_NAME, selected, assets=assets,
        )
        report["bundle_sha256"] = capability.bundle_sha256
        report["binary_sha256"] = capability.executable_sha256
        report["cli_version"] = capability.cli_version
        report["bundle_matches_precheck"] = capability.bundle_sha256 == expected_bundle
        if not report["bundle_matches_precheck"]:
            raise adapter.PrivateStageRuntimeError("runtime_bundle_changed")
        stage_adapters = {
            stage: value
            for stage, value in adapter._adapters(capability, assets).items()
            if stage in STAGES
        }
        report["skill_sha256"] = {stage: assets[stage].skill_hash for stage in STAGES}
        service = PipelineStageService(
            connection, adapters=stage_adapters, now=lambda: FIXTURE_NOW,
        )
        item = service.start_from_saved_revision(
            fixture.campaign_id, fixture.revision_id, "manual-acceptance-start",
        )
        report["item_id"] = item.item_id
        report["status"], report["code"] = _drive(service, item, report, PipelineStageError)
    except BaseException as error:
        report["status"] = "failed"
        code = getattr(error, "code", None)
        report["code"] = _fixed(code) if isinstance(code, str) else "harness_unexpected_error"
    finally:
        report["cleanup"]["adapter_cleanup_codes"] = sorted(
            value for value in (
                adapter.take_adapter_cleanup_code(item) for item in stage_adapters.values()
            ) if value is not None
        )
        cleanup_exception = False
        if capability is not None:
            capability.invalidated.set()
            report["cleanup"]["capability_invalidated"] = capability.invalidated.is_set()
            if parent is not None:
                try:
                    report["cleanup"]["runtime_root"] = runtime._cleanup_attempt(
                        capability.root, parent,
                    )
                except BaseException:
                    report["cleanup"]["runtime_root"] = "failed"
                    cleanup_exception = True
        if connection is not None:
            try:
                report["evidence"] = {
                    "attempts": connection.execute(
                        "SELECT count(*) FROM prospecting_stage_attempt",
                    ).fetchone()[0],
                    "artifacts": connection.execute(
                        "SELECT count(*) FROM prospecting_stage_artifact",
                    ).fetchone()[0],
                }
            except BaseException:
                report["evidence"] = {"attempts": -1, "artifacts": -1}
            try:
                connection.close()
                report["cleanup"]["connection_closed"] = True
            except BaseException:
                report["cleanup"]["connection_closed"] = False
                cleanup_exception = True
        cleanup_code = None
        if (
            cleanup_exception
            or report["cleanup"]["adapter_cleanup_codes"]
            or (capability is not None and report["cleanup"]["runtime_root"] != "deleted")
        ):
            cleanup_code = "stage_runtime_cleanup_failed"
            if report["status"] != "failed":
                report["code"] = cleanup_code
            report["status"] = "failed"
        report["cleanup_code"] = cleanup_code
    report["fixture_time_utc"] = FIXTURE_NOW.isoformat()
    report["wall_time_started_utc"] = wall_started.isoformat()
    report["wall_time_finished_utc"] = datetime.now(timezone.utc).isoformat()
    report["fixture_time_is_future"] = FIXTURE_NOW > wall_started
    _emit(report)
    return 0 if report["status"] == "succeeded" else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog=HARNESS, description=__doc__)
    parser.add_argument(
        "--run", action="store_true",
        help="opt in to one actual synthetic native stage trial on this desktop",
    )
    options = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if not options.run:
        _emit({
            "harness": HARNESS, "schema_version": 1, "mode": "default",
            "status": "not_attempted", "code": "manual_opt_in_required",
            "stages": [], "stage_calls": 0,
        })
        return 0
    return _run()


if __name__ == "__main__":
    raise SystemExit(main())
