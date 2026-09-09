"""Bounded, PII-free manager workflow runner."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Callable

from scripts.prospecting.manager.jobs import OPAQUE, StageJob, parse_card, write_card
from scripts.prospecting.manager.bindings import (
    CHECKPOINT_VERSION,
    NON_RETRYABLE_FAILURE_CODES,
    RESULT_FAILURE_CODES,
    digest,
    run_binding,
    stage_execution_key,
)
from scripts.prospecting.pii_guard import assert_vm_safe


ALLOWED_RESULT = {
    "stage_id", "state", "ids", "counts", "hashes", "failure_codes", "attempt",
    "execution_key", "command_digest",
}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{3,63}$")
INSPECTION_PASS_SCORE = 95
ISSUED_KINDS = {"initial", "failure_retry", "inspection_rework", "reinspection"}
PARK_REASONS = {
    "dependency_not_complete", "desktop_recovery_required", "human_gate",
    "inspector_failed", "inspector_unavailable", "invalid_inspection_stage",
    "invalid_result", "pii_result", "retry_exhausted",
}


@dataclass(frozen=True)
class RunReport:
    run_id: str
    workflow: str
    state: str
    cards: int
    retries: int
    escalations: int
    counts: dict[str, int]


class ManagerRunner:
    def __init__(self, workflow, outbox: Path, turn: Callable, inspector_turn: Callable):
        self.workflow = workflow
        self.outbox = outbox
        self.turn = turn
        self.inspector_turn = inspector_turn
        self._active_binding: dict[str, object] | None = None
        self._generation = 0

    @staticmethod
    def _safe(value: object) -> None:
        assert_vm_safe(
            {"kind": "process_results", "fields": value}, "process_results"
        )

    @staticmethod
    def _card_run_id(run_id: str) -> str:
        """Keep card identifiers within the job writer's opaque-ID grammar."""
        normalized = re.sub(r"[^a-z0-9-]+", "-", run_id.lower()).strip("-")
        return normalized or "run"

    def _valid(self, value, stage_id: str, expected_attempt: int, execution_key: str) -> dict:
        if (
            not isinstance(value, dict)
            or set(value) != ALLOWED_RESULT
            or value.get("stage_id") != stage_id
            or value.get("attempt") != expected_attempt
            or value.get("execution_key") != execution_key
        ):
            raise ValueError("invalid_stage_result")
        if value.get("state") not in {"complete", "failed"}:
            raise ValueError("invalid_stage_state")
        if not isinstance(value["ids"], list) or not all(
            isinstance(item, str) and OPAQUE.fullmatch(item) for item in value["ids"]
        ):
            raise ValueError("invalid_ids")
        if not isinstance(value["hashes"], list) or not all(
            isinstance(item, str) and HEX64.fullmatch(item)
            for item in value["hashes"]
        ):
            raise ValueError("invalid_hashes")
        if not isinstance(value["counts"], dict) or not all(
            isinstance(key, str) and type(item) is int and item >= 0
            for key, item in value["counts"].items()
        ):
            raise ValueError("invalid_counts")
        if not isinstance(value["failure_codes"], dict) or not all(
            key in RESULT_FAILURE_CODES and type(item) is int and item >= 0
            for key, item in value["failure_codes"].items()
        ):
            raise ValueError("invalid_failure_codes")
        if type(value["attempt"]) is not int or not 1 <= value["attempt"] <= 2:
            raise ValueError("invalid_attempt")
        if not isinstance(value["command_digest"], str) or HEX64.fullmatch(value["command_digest"]) is None:
            raise ValueError("invalid_command_digest")
        try:
            self._safe(value)
        except Exception as error:
            raise ValueError("pii_result") from error
        return value

    def _checkpoint_path(self, run_id: str) -> Path:
        return self._outbox_path(run_id, "-checkpoint.json")

    def _outbox_path(self, run_id: str, suffix: str) -> Path:
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise ValueError("invalid_run_id")
        outbox = self.outbox.resolve()
        path = (outbox / f"{run_id}{suffix}").resolve()
        if path != outbox and outbox not in path.parents:
            raise ValueError("invalid_outbox_path")
        return path

    def _save(self, run_id: str, value: dict) -> None:
        if self._active_binding is None:
            raise RuntimeError("run_binding_missing")
        self._generation += 1
        value = {
            **value,
            "state": value.get("state", "running"),
            "checkpoint_version": CHECKPOINT_VERSION,
            "generation": self._generation,
            "run_binding": self._active_binding,
            "run_binding_hash": digest(self._active_binding),
        }
        self._safe(value)
        self.outbox.mkdir(parents=True, exist_ok=True)
        target = self._checkpoint_path(run_id)
        descriptor, name = tempfile.mkstemp(
            prefix=f".{target.name}-", suffix=".tmp", dir=target.parent
        )
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(value, handle, sort_keys=True, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise

    @contextmanager
    def _run_lock(self, run_id: str):
        self.outbox.mkdir(parents=True, exist_ok=True)
        path = self._outbox_path(run_id, "-manager.lock")
        handle = path.open("a+b")
        try:
            if path.stat().st_size == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise ValueError("run_in_progress") from None
            try:
                yield
            finally:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()

    def _issue(
        self,
        stage,
        attempt: int,
        kind: str,
        job: StageJob,
        issued: dict[str, dict],
    ) -> tuple[bool, str]:
        if kind not in ISSUED_KINDS:
            raise ValueError("checkpoint_invalid")
        execution_key = stage_execution_key(self.workflow, job, stage, attempt)
        path = write_card(job, self.outbox)
        record = {
            "card_path": path.name,
            "card_digest": digest(parse_card(path)),
            "execution_key": execution_key,
            "kind": kind,
            "command_digest": None,
        }
        label = f"{stage.id}:{attempt}"
        prior = issued.get(label)
        if prior is not None:
            if (
                not isinstance(prior, dict)
                or {**prior, "command_digest": None} != record
            ):
                raise ValueError("checkpoint_invalid")
            return False, execution_key
        issued[label] = record
        return True, execution_key

    def _issued_job(self, record: dict) -> StageJob:
        card = parse_card(self.outbox / record["card_path"])
        header, work = card["frontmatter"], card["work_order"]
        return StageJob(
            header["id"], header["project"], header["workflow"], work["stage"],
            header["owner"], tuple(header["depends-on"]), work["policy_id"],
            work["policy_hash"], tuple(work["input_ids"]),
            tuple(work["input_hashes"]), work["counts"],
            tuple(work["acceptance_criteria"]),
        )

    def _validate_checkpoint(self, state: object, binding: dict[str, object]) -> dict:
        common = {
            "state", "completed", "issued", "cards", "retries", "escalations",
            "counts", "checkpoint_version", "generation", "run_binding",
            "run_binding_hash",
        }
        if not isinstance(state, dict) or state.get("state") not in {
            "running", "complete", "parked"
        }:
            raise ValueError("checkpoint_invalid")
        expected_fields = common | (
            {"reason", "failure_code"} if state["state"] == "parked" else set()
        )
        if (
            set(state) != expected_fields
            or state.get("checkpoint_version") != CHECKPOINT_VERSION
            or type(state.get("generation")) is not int
            or state["generation"] < 1
            or state.get("run_binding") != binding
            or state.get("run_binding_hash") != digest(binding)
        ):
            raise ValueError("checkpoint_invalid")
        for field in ("cards", "retries", "escalations"):
            if type(state.get(field)) is not int or state[field] < 0:
                raise ValueError("checkpoint_invalid")
        if not isinstance(state.get("completed"), dict) or not isinstance(
            state.get("issued"), dict
        ):
            raise ValueError("checkpoint_invalid")
        if not isinstance(state.get("counts"), dict) or not all(
            isinstance(key, str) and type(value) is int and value >= 0
            for key, value in state["counts"].items()
        ):
            raise ValueError("checkpoint_invalid")
        if state["state"] == "parked" and (
            state.get("reason") not in PARK_REASONS
            or state.get("failure_code") != state.get("reason")
        ):
            raise ValueError("checkpoint_invalid")

        stages = {stage.id: stage for stage in self.workflow.stages}
        card_run_id = self._card_run_id(binding["run_id"])
        issued_jobs: dict[str, StageJob] = {}
        card_labels: dict[str, str] = {}
        for label, record in state["issued"].items():
            if (
                not isinstance(label, str)
                or label.count(":") != 1
                or not isinstance(record, dict)
                or set(record) != {
                    "card_path", "card_digest", "execution_key", "kind",
                    "command_digest",
                }
            ):
                raise ValueError("checkpoint_invalid")
            stage_id, attempt_text = label.rsplit(":", 1)
            if stage_id not in stages or attempt_text not in {"1", "2"}:
                raise ValueError("checkpoint_invalid")
            attempt = int(attempt_text)
            kind = record["kind"]
            if (
                kind not in ISSUED_KINDS
                or (attempt == 1) != (kind == "initial")
                or not isinstance(record["execution_key"], str)
                or HEX64.fullmatch(record["execution_key"]) is None
                or not isinstance(record["card_digest"], str)
                or HEX64.fullmatch(record["card_digest"]) is None
                or (
                    record["command_digest"] is not None
                    and (
                        not isinstance(record["command_digest"], str)
                        or HEX64.fullmatch(record["command_digest"]) is None
                    )
                )
            ):
                raise ValueError("checkpoint_invalid")
            expected_name = f"{card_run_id}-{stage_id}-a{attempt}.md"
            if record["card_path"] != expected_name:
                raise ValueError("checkpoint_invalid")
            path = self.outbox / expected_name
            try:
                card = parse_card(path)
            except (OSError, ValueError):
                raise ValueError("checkpoint_invalid") from None
            if digest(card) != record["card_digest"]:
                raise ValueError("checkpoint_invalid")
            header, work = card["frontmatter"], card["work_order"]
            stage = stages[stage_id]
            if (
                header["id"] != expected_name[:-3]
                or header["project"] != "prospecting"
                or header["workflow"] != card_run_id
                or header["owner"] != stage.agent
                or work["stage"] != stage_id
                or work["policy_id"] != binding["policy_id"]
                or work["policy_hash"] != binding["policy_hash"]
                or work["counts"] != binding["counts"]
            ):
                raise ValueError("checkpoint_invalid")
            job = StageJob(
                header["id"], header["project"], header["workflow"], work["stage"],
                header["owner"], tuple(header["depends-on"]), work["policy_id"],
                work["policy_hash"], tuple(work["input_ids"]),
                tuple(work["input_hashes"]), work["counts"],
                tuple(work["acceptance_criteria"]),
            )
            if stage_execution_key(self.workflow, job, stage, attempt) != record[
                "execution_key"
            ]:
                raise ValueError("checkpoint_invalid")
            issued_jobs[label] = job
            card_labels[job.card_id] = label

        for label, job in issued_jobs.items():
            stage_id, attempt_text = label.rsplit(":", 1)
            stage, attempt = stages[stage_id], int(attempt_text)
            kind = state["issued"][label]["kind"]
            expected_acceptance = {
                "initial": ("summary_schema_valid", "no_pii"),
                "failure_retry": ("retry_once", "summary_schema_valid", "no_pii"),
                "inspection_rework": (
                    "inspector_rework_once", "summary_schema_valid", "no_pii"
                ),
                "reinspection": ("independent_reinspection", "no_pii"),
            }[kind]
            if job.acceptance != expected_acceptance:
                raise ValueError("checkpoint_invalid")
            dependency_labels = []
            for card_id in job.depends_on:
                dependency_label = card_labels.get(card_id)
                if dependency_label is None:
                    raise ValueError("checkpoint_invalid")
                dependency_labels.append(dependency_label)
            if kind == "initial":
                dependency_stages = {
                    item.rsplit(":", 1)[0] for item in dependency_labels
                }
                if dependency_stages != set(stage.needs) or len(
                    dependency_labels
                ) != len(stage.needs):
                    raise ValueError("checkpoint_invalid")
            elif kind == "failure_retry":
                if dependency_labels != [f"{stage_id}:1"]:
                    raise ValueError("checkpoint_invalid")
            elif kind == "inspection_rework":
                if len(dependency_labels) != 1:
                    raise ValueError("checkpoint_invalid")
                inspector_id, inspector_attempt = dependency_labels[0].rsplit(":", 1)
                inspector = stages[inspector_id]
                if (
                    inspector_attempt != "1"
                    or not inspector.inspect
                    or inspector.needs != (stage_id,)
                ):
                    raise ValueError("checkpoint_invalid")
            elif kind == "reinspection":
                if not stage.inspect or len(dependency_labels) != 1:
                    raise ValueError("checkpoint_invalid")
                producer_id, producer_attempt = dependency_labels[0].rsplit(":", 1)
                if (
                    stage.needs != (producer_id,)
                    or producer_attempt != "2"
                    or state["issued"][dependency_labels[0]]["kind"]
                    != "inspection_rework"
                ):
                    raise ValueError("checkpoint_invalid")

        completed_ids = set(state["completed"])
        stage_order = [stage.id for stage in self.workflow.stages]
        if completed_ids != set(stage_order[: len(completed_ids)]):
            raise ValueError("checkpoint_invalid")
        maximum_issued_index = len(completed_ids)
        if any(
            stage_order.index(label.rsplit(":", 1)[0]) > maximum_issued_index
            for label in issued_jobs
        ):
            raise ValueError("checkpoint_invalid")

        recomputed: dict[str, int] = {}
        for stage_id, entry in state["completed"].items():
            stage = stages[stage_id]
            expected_entry_fields = (
                {"card_id", "result", "inspection"}
                if stage.inspect
                else {"card_id", "result"}
            )
            if not isinstance(entry, dict) or set(entry) != expected_entry_fields:
                raise ValueError("checkpoint_invalid")
            result = entry["result"]
            if not isinstance(result, dict) or type(result.get("attempt")) is not int:
                raise ValueError("checkpoint_invalid")
            label = f"{stage_id}:{result['attempt']}"
            if label not in issued_jobs or entry["card_id"] != issued_jobs[label].card_id:
                raise ValueError("checkpoint_invalid")
            completed_kind = state["issued"][label]["kind"]
            if (
                stage.inspect
                and completed_kind not in {"initial", "reinspection"}
            ) or (
                not stage.inspect and completed_kind == "reinspection"
            ):
                raise ValueError("checkpoint_invalid")
            result = self._valid(
                result, stage_id, result["attempt"],
                state["issued"][label]["execution_key"],
            )
            if result["state"] != "complete":
                raise ValueError("checkpoint_invalid")
            if state["issued"][label]["command_digest"] != result["command_digest"]:
                raise ValueError("checkpoint_invalid")
            if stage.inspect:
                inspection = entry["inspection"]
                if not isinstance(inspection, dict) or set(inspection) != {
                    "decision", "grade", "source_result_hash", "execution_key",
                    "command_digest",
                }:
                    raise ValueError("checkpoint_invalid")
                if len(stage.needs) != 1 or stage.needs[0] not in state["completed"]:
                    raise ValueError("checkpoint_invalid")
                source = state["completed"][stage.needs[0]]["result"]
                if (
                    inspection["decision"] != "pass"
                    or type(inspection["grade"]) is not int
                    or not INSPECTION_PASS_SCORE <= inspection["grade"] <= 100
                    or inspection["source_result_hash"] != digest(source)
                    or inspection["execution_key"] != result["execution_key"]
                    or inspection["command_digest"] != result["command_digest"]
                    or result["ids"] != source["ids"]
                    or result["hashes"] != source["hashes"]
                    or result["counts"]
                    or result["failure_codes"]
                ):
                    raise ValueError("checkpoint_invalid")
            for key, value in result["counts"].items():
                recomputed[key] = recomputed.get(key, 0) + value

        def combined(values):
            return tuple(dict.fromkeys(values))

        for label, job in issued_jobs.items():
            stage_id, _attempt = label.rsplit(":", 1)
            stage = stages[stage_id]
            kind = state["issued"][label]["kind"]
            historical_initial_inspection = (
                kind == "initial"
                and stage.inspect
                and (
                    f"{stage_id}:2" in issued_jobs
                    or (
                        len(stage.needs) == 1
                        and state["issued"].get(
                            f"{stage.needs[0]}:2", {}
                        ).get("kind") == "inspection_rework"
                        and state["completed"].get(stage.needs[0], {}).get(
                            "card_id"
                        ) == issued_jobs[f"{stage.needs[0]}:2"].card_id
                    )
                )
            )
            completed_entry = state["completed"].get(stage_id)
            completed_by_this_card = (
                completed_entry is not None
                and completed_entry["card_id"] == job.card_id
            )
            if historical_initial_inspection:
                continue
            if kind in {"initial", "failure_retry"}:
                predecessor_results = [
                    state["completed"][dependency]["result"]
                    for dependency in stage.needs
                ]
                expected_ids = combined([
                    *binding["input_ids"],
                    *(item for result in predecessor_results for item in result["ids"]),
                ])
                expected_hashes = combined([
                    *binding["input_hashes"],
                    *(item for result in predecessor_results for item in result["hashes"]),
                ])
            elif kind == "inspection_rework":
                if completed_by_this_card:
                    # The prior producer result was intentionally replaced and
                    # is not retained as an authoritative checkpoint result.
                    continue
                source = state["completed"][stage_id]["result"]
                expected_ids = combined([*binding["input_ids"], *source["ids"]])
                expected_hashes = combined([
                    *binding["input_hashes"], *source["hashes"]
                ])
            else:
                source = state["completed"][stage.needs[0]]["result"]
                expected_ids = tuple(source["ids"])
                expected_hashes = tuple(source["hashes"])
            if job.input_ids != expected_ids or job.input_hashes != expected_hashes:
                raise ValueError("checkpoint_invalid")
        if recomputed != state["counts"]:
            raise ValueError("checkpoint_invalid")
        if state["cards"] != len(state["issued"]):
            raise ValueError("checkpoint_invalid")
        expected_retries = sum(
            record["kind"] in {"failure_retry", "inspection_rework"}
            for record in state["issued"].values()
        )
        if state["retries"] != expected_retries:
            raise ValueError("checkpoint_invalid")
        if state["escalations"] != (1 if state["state"] == "parked" else 0):
            raise ValueError("checkpoint_invalid")
        if state["state"] == "complete" and completed_ids != set(stage_order):
            raise ValueError("checkpoint_invalid")
        try:
            self._safe(state)
        except Exception as error:
            raise ValueError("checkpoint_invalid") from error
        return state

    def _wake(self, run_id: str, policy_id: str, policy_hash: str, reason: str) -> None:
        card_run_id = self._card_run_id(run_id)
        write_card(
            StageJob(
                f"{card_run_id}-wake", "prospecting", card_run_id, "wake-me", "human", (),
                policy_id, policy_hash, (card_run_id,), (), {},
                ("human_decision_required", reason),
            ),
            self.outbox,
        )

    def _park(
        self,
        run_id: str,
        policy_id: str,
        policy_hash: str,
        reason: str,
        completed: dict,
        issued: dict,
        cards: int,
        retries: int,
        escalations: int,
        totals: dict[str, int],
    ) -> RunReport:
        self._wake(run_id, policy_id, policy_hash, reason)
        escalations += 1
        self._save(
            run_id,
            {
                "state": "parked", "reason": reason, "failure_code": reason,
                "completed": completed, "issued": issued,
                "cards": cards, "retries": retries, "escalations": escalations,
                "counts": totals,
            },
        )
        return RunReport(
            run_id, self.workflow.id, "parked", cards, retries, escalations, totals
        )

    def _inspect(self, stage, result: dict, job: StageJob, attempt: int) -> dict:
        execution_key = stage_execution_key(self.workflow, job, stage, attempt)
        verdict = self.inspector_turn(stage, result, job, attempt)
        if not isinstance(verdict, dict) or set(verdict) != {
            "decision", "grade", "execution_key", "command_digest"
        }:
            raise ValueError("invalid_inspector_result")
        if (
            verdict["decision"] not in {"pass", "retry", "park"}
            or type(verdict["grade"]) is not int
            or not 0 <= verdict["grade"] <= 100
            or verdict["execution_key"] != execution_key
            or not isinstance(verdict["command_digest"], str)
            or HEX64.fullmatch(verdict["command_digest"]) is None
        ):
            raise ValueError("invalid_inspector_decision")
        self._safe(verdict)
        return verdict

    @staticmethod
    def _inspector_result(stage_id: str, source: dict, verdict: dict, attempt: int) -> dict:
        return {
            "stage_id": stage_id,
            "state": "complete",
            "ids": list(source["ids"]),
            "counts": {},
            "hashes": list(source["hashes"]),
            "failure_codes": {},
            "attempt": attempt,
            "execution_key": verdict["execution_key"],
            "command_digest": verdict["command_digest"],
        }

    @staticmethod
    def _totals(totals: dict[str, int], result: dict) -> None:
        for key, value in result["counts"].items():
            totals[key] = totals.get(key, 0) + value

    def run(
        self,
        run_id: str,
        policy_id: str,
        policy_hash: str,
        input_ids: tuple[str, ...],
        input_hashes: tuple[str, ...],
        counts: dict[str, int],
    ) -> RunReport:
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise ValueError("invalid_run_id")
        with self._run_lock(run_id):
            return self._run_locked(
                run_id, policy_id, policy_hash, input_ids, input_hashes, counts
            )

    def _run_locked(
        self,
        run_id: str,
        policy_id: str,
        policy_hash: str,
        input_ids: tuple[str, ...],
        input_hashes: tuple[str, ...],
        counts: dict[str, int],
    ) -> RunReport:
        self._safe(
            {
                "policy_id": policy_id, "policy_hash": policy_hash,
                "input_ids": input_ids, "input_hashes": input_hashes,
                "counts": counts,
            }
        )
        binding = run_binding(
            self.workflow, run_id, policy_id, policy_hash, input_ids, input_hashes, counts
        )
        self._active_binding = binding
        checkpoint = self._checkpoint_path(run_id)
        if checkpoint.exists():
            try:
                state = json.loads(checkpoint.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                raise ValueError("run_binding_conflict") from None
            if (
                not isinstance(state, dict)
                or state.get("run_binding") != binding
                or state.get("run_binding_hash") != digest(binding)
            ):
                raise ValueError("run_binding_conflict")
            state = self._validate_checkpoint(state, binding)
            self._generation = state["generation"]
        else:
            state = {
                "state": "running", "completed": {}, "issued": {}, "cards": 0,
                "retries": 0, "escalations": 0, "counts": {},
            }
            self._generation = 0
        if state["state"] in {"complete", "parked"}:
            return RunReport(
                run_id, self.workflow.id, state["state"], state["cards"],
                state["retries"], state["escalations"], state["counts"],
            )

        completed = state["completed"]
        issued = state["issued"]
        cards = state["cards"]
        retries = state["retries"]
        escalations = state["escalations"]
        totals = state["counts"]

        for stage in self.workflow.stages:
            if stage.id in completed:
                continue
            if any(dependency not in completed for dependency in stage.needs):
                return self._park(
                    run_id, policy_id, policy_hash, "dependency_not_complete", completed,
                    issued, cards, retries, escalations, totals,
                )

            dependencies = tuple(completed[item]["card_id"] for item in stage.needs)
            predecessors = [completed[item]["result"] for item in stage.needs]
            stage_ids = tuple(dict.fromkeys([
                *input_ids, *(item for result in predecessors for item in result["ids"]),
            ]))
            stage_hashes = tuple(dict.fromkeys([
                *input_hashes, *(item for result in predecessors for item in result["hashes"]),
            ]))
            card_run_id = self._card_run_id(run_id)
            card_id = f"{card_run_id}-{stage.id}-a1"
            job = StageJob(
                card_id, "prospecting", card_run_id, stage.id, stage.agent, dependencies,
                policy_id, policy_hash, stage_ids, stage_hashes, counts,
                ("summary_schema_valid", "no_pii"),
            )
            if f"{stage.id}:1" in issued:
                job = self._issued_job(issued[f"{stage.id}:1"])
                card_id = job.card_id
            created, execution_key = self._issue(
                stage, 1, "initial", job, issued
            )
            if created:
                cards += 1
                self._save(run_id, {"completed": completed, "issued": issued, "cards": cards, "retries": retries, "escalations": escalations, "counts": totals})

            if stage.agent == "human":
                return self._park(
                    run_id, policy_id, policy_hash, "human_gate", completed, issued, cards,
                    retries, escalations, totals,
                )

            if stage.inspect:
                if len(stage.needs) != 1:
                    return self._park(
                        run_id, policy_id, policy_hash, "invalid_inspection_stage", completed,
                        issued, cards, retries, escalations, totals,
                    )
                producer_id = stage.needs[0]
                producer = next(item for item in self.workflow.stages if item.id == producer_id)
                source = completed[producer_id]["result"]
                inspector_attempt = 1
                rework_record = issued.get(f"{producer_id}:2")
                resuming_rework = (
                    rework_record is not None
                    and rework_record["kind"] == "inspection_rework"
                )
                if resuming_rework:
                    verdict = {"decision": "retry", "grade": 0}
                else:
                    try:
                        verdict = self._inspect(stage, source, job, 1)
                        issued[f"{stage.id}:1"]["command_digest"] = verdict[
                            "command_digest"
                        ]
                    except Exception as error:
                        return self._park(
                            run_id, policy_id, policy_hash,
                            "inspector_unavailable" if "unavailable" in str(error) else "inspector_failed", completed,
                            issued, cards, retries, escalations, totals,
                        )

                if verdict["decision"] == "retry":
                    if source["attempt"] == 2 and not resuming_rework:
                        return self._park(
                            run_id, policy_id, policy_hash, "retry_exhausted",
                            completed, issued, cards, retries, escalations, totals,
                        )
                    if not resuming_rework:
                        retries += 1
                    rework_id = f"{card_run_id}-{producer_id}-a2"
                    rework_job = StageJob(
                        rework_id, "prospecting", card_run_id, producer_id, producer.agent,
                        (card_id,), policy_id, policy_hash, stage_ids, stage_hashes, counts,
                        ("inspector_rework_once", "summary_schema_valid", "no_pii"),
                    )
                    if rework_record is not None:
                        rework_job = self._issued_job(rework_record)
                        rework_id = rework_job.card_id
                    created, rework_key = self._issue(
                        producer, 2, "inspection_rework", rework_job, issued
                    )
                    if created:
                        cards += 1
                        self._save(run_id, {"completed": completed, "issued": issued, "cards": cards, "retries": retries, "escalations": escalations, "counts": totals})
                    if source["attempt"] != 2:
                        try:
                            new_source = self._valid(
                                self.turn(producer, 2, rework_job), producer_id, 2,
                                rework_key,
                            )
                            issued[f"{producer_id}:2"]["command_digest"] = new_source[
                                "command_digest"
                            ]
                        except Exception:
                            new_source = {"state": "failed"}
                        if new_source.get("state") != "complete":
                            reason = (
                                "desktop_recovery_required"
                                if any(
                                    new_source.get("failure_codes", {}).get(code, 0) > 0
                                    for code in NON_RETRYABLE_FAILURE_CODES
                                )
                                else "retry_exhausted"
                            )
                            return self._park(
                                run_id, policy_id, policy_hash, reason, completed,
                                issued, cards, retries, escalations, totals,
                            )
                        for key, value in source["counts"].items():
                            totals[key] -= value
                            if totals[key] == 0:
                                del totals[key]
                        self._totals(totals, new_source)
                        source = new_source
                        completed[producer_id] = {"card_id": rework_id, "result": source}
                        self._save(
                            run_id,
                            {
                                "completed": completed, "issued": issued, "cards": cards, "retries": retries,
                                "escalations": escalations, "counts": totals,
                            },
                        )
                    card_id = f"{card_run_id}-{stage.id}-a2"
                    reinspection_job = StageJob(
                        card_id, "prospecting", card_run_id, stage.id, stage.agent,
                        (rework_id,), policy_id, policy_hash, tuple(source["ids"]),
                        tuple(source["hashes"]), counts,
                        ("independent_reinspection", "no_pii"),
                    )
                    if f"{stage.id}:2" in issued:
                        reinspection_job = self._issued_job(issued[f"{stage.id}:2"])
                        card_id = reinspection_job.card_id
                    created, inspection_key = self._issue(
                        stage, 2, "reinspection", reinspection_job, issued
                    )
                    if created:
                        cards += 1
                        self._save(run_id, {"completed": completed, "issued": issued, "cards": cards, "retries": retries, "escalations": escalations, "counts": totals})
                    inspector_attempt = 2
                    try:
                        verdict = self._inspect(stage, source, reinspection_job, 2)
                        issued[f"{stage.id}:2"]["command_digest"] = verdict[
                            "command_digest"
                        ]
                    except Exception:
                        verdict = {
                            "decision": "park", "grade": 0,
                            "execution_key": inspection_key, "command_digest": "0" * 64,
                        }

                if verdict["decision"] != "pass" or verdict["grade"] < INSPECTION_PASS_SCORE:
                    return self._park(
                        run_id, policy_id, policy_hash, "inspector_failed", completed,
                        issued, cards, retries, escalations, totals,
                    )
                result = self._inspector_result(stage.id, source, verdict, inspector_attempt)
                completion = {
                    "card_id": card_id,
                    "result": result,
                    "inspection": {
                        "decision": verdict["decision"],
                        "grade": verdict["grade"],
                        "source_result_hash": digest(source),
                        "execution_key": verdict["execution_key"],
                        "command_digest": verdict["command_digest"],
                    },
                }
            else:
                retry_record = issued.get(f"{stage.id}:2")
                resume_retry = (
                    retry_record is not None
                    and retry_record["kind"] == "failure_retry"
                )
                try:
                    result = (
                        {"state": "failed"}
                        if resume_retry
                        else self._valid(
                            self.turn(stage, 1, job), stage.id, 1, execution_key
                        )
                    )
                except ValueError as error:
                    return self._park(
                        run_id, policy_id, policy_hash,
                        "pii_result" if str(error) == "pii_result" else "invalid_result", completed,
                        issued, cards, retries, escalations, totals,
                    )
                except Exception:
                    return self._park(
                        run_id, policy_id, policy_hash, "invalid_result", completed,
                        issued, cards, retries, escalations, totals,
                    )
                if not resume_retry:
                    issued[f"{stage.id}:1"]["command_digest"] = result[
                        "command_digest"
                    ]

            if result["state"] == "failed":
                if any(
                    result.get("failure_codes", {}).get(code, 0) > 0
                    for code in NON_RETRYABLE_FAILURE_CODES
                ):
                    return self._park(
                        run_id, policy_id, policy_hash, "desktop_recovery_required",
                        completed, issued, cards, retries, escalations, totals,
                    )
                resume_retry = (
                    issued.get(f"{stage.id}:2", {}).get("kind")
                    == "failure_retry"
                )
                if not resume_retry:
                    retries += 1
                retry_id = f"{card_run_id}-{stage.id}-a2"
                retry_job = StageJob(
                    retry_id, "prospecting", card_run_id, stage.id, stage.agent, (card_id,),
                    policy_id, policy_hash, stage_ids, stage_hashes, counts,
                    ("retry_once", "summary_schema_valid", "no_pii"),
                )
                created, retry_key = self._issue(
                    stage, 2, "failure_retry", retry_job, issued
                )
                if created:
                    cards += 1
                    self._save(run_id, {"completed": completed, "issued": issued, "cards": cards, "retries": retries, "escalations": escalations, "counts": totals})
                try:
                    result = self._valid(self.turn(stage, 2, retry_job), stage.id, 2, retry_key)
                    issued[f"{stage.id}:2"]["command_digest"] = result[
                        "command_digest"
                    ]
                except Exception:
                    result = {"state": "failed"}
                if result.get("state") != "complete":
                    if any(
                        result.get("failure_codes", {}).get(code, 0) > 0
                        for code in NON_RETRYABLE_FAILURE_CODES
                    ):
                        reason = "desktop_recovery_required"
                    else:
                        reason = "retry_exhausted"
                    return self._park(
                        run_id, policy_id, policy_hash, reason, completed,
                        issued, cards, retries, escalations, totals,
                    )
                card_id = retry_id

            if not stage.inspect:
                completion = {"card_id": card_id, "result": result}

            completed[stage.id] = completion
            self._totals(totals, result)
            self._save(
                run_id,
                {
                    "completed": completed, "issued": issued, "cards": cards, "retries": retries,
                    "escalations": escalations, "counts": totals,
                },
            )

        report = RunReport(
            run_id, self.workflow.id, "complete", cards, retries, escalations, totals
        )
        self._safe(asdict(report))
        self._save(
            run_id,
            {
                "state": "complete", "completed": completed, "issued": issued, "cards": cards,
                "retries": retries, "escalations": escalations, "counts": totals,
            },
        )
        target = self._outbox_path(run_id, "-report.json")
        target.write_text(
            json.dumps(asdict(report), sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )
        return report
