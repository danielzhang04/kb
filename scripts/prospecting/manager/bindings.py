"""Canonical PII-free bindings for manager runs and desktop commands."""

from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
from typing import Mapping


RUN_BINDING_VERSION = 1
COMMAND_BINDING_VERSION = 1
CHECKPOINT_VERSION = 1

DESKTOP_FAILURE_CODES = frozenset({
    "adapter_failed",
    "adapter_timeout",
    "adapter_output_overflow",
    "adapter_output_rejected",
    "adapter_cleanup_failed",
    "adapter_recovery_required",
})
RESULT_FAILURE_CODES = DESKTOP_FAILURE_CODES | {
    "fixture_failure",
    "synthetic_failure",
}
NON_RETRYABLE_FAILURE_CODES = frozenset({"adapter_recovery_required"})


def _canonical(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def run_binding(
    workflow: object,
    run_id: str,
    policy_id: str,
    policy_hash: str,
    input_ids: tuple[str, ...],
    input_hashes: tuple[str, ...],
    counts: Mapping[str, int],
) -> dict[str, object]:
    stages = [
        {**asdict(stage), "needs": list(stage.needs)}
        for stage in workflow.stages
    ]
    return {
        "version": RUN_BINDING_VERSION,
        "run_id": run_id,
        "workflow": {
            "id": workflow.id,
            "manager": workflow.manager,
            "version": workflow.version,
            "stages": stages,
        },
        "policy_id": policy_id,
        "policy_hash": policy_hash,
        "input_ids": list(input_ids),
        "input_hashes": list(input_hashes),
        "counts": dict(counts),
    }


def stage_execution_key(workflow: object, job: object, stage: object, attempt: int) -> str:
    return digest({
        "version": COMMAND_BINDING_VERSION,
        "workflow_id": workflow.id,
        "workflow_version": workflow.version,
        "run_id": job.workflow,
        "stage_id": stage.id,
        "operation": stage.operation,
        "attempt": attempt,
        "policy_id": job.policy_id,
        "policy_hash": job.policy_hash,
        "input_ids": list(job.input_ids),
        "input_hashes": list(job.input_hashes),
        "counts": dict(job.counts),
    })


def command_digest(job: Mapping[str, object]) -> str:
    payload = {
        key: value
        for key, value in job.items()
        if key not in {"command_digest"}
    }
    return digest({"version": COMMAND_BINDING_VERSION, "command": payload})
