"""Bounded, PII-free manager workflow runner."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import hashlib
from pathlib import Path
import re
from typing import Callable

from scripts.prospecting.manager.jobs import OPAQUE, StageJob, write_card
from scripts.prospecting.pii_guard import assert_vm_safe


ALLOWED_RESULT = {
    "stage_id", "state", "ids", "counts", "hashes", "failure_codes", "attempt"
}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{3,63}$")
ALLOWED_FAILURE_CODES = {"fixture_failure", "synthetic_failure"}


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

    def _valid(self, value, stage_id: str) -> dict:
        if (
            not isinstance(value, dict)
            or set(value) != ALLOWED_RESULT
            or value.get("stage_id") != stage_id
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
            key in ALLOWED_FAILURE_CODES and type(item) is int and item >= 0
            for key, item in value["failure_codes"].items()
        ):
            raise ValueError("invalid_failure_codes")
        if type(value["attempt"]) is not int or not 1 <= value["attempt"] <= 2:
            raise ValueError("invalid_attempt")
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
        self._safe(value)
        self.outbox.mkdir(parents=True, exist_ok=True)
        target = self._checkpoint_path(run_id)
        temporary = target.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(value, sort_keys=True, separators=(",", ":")), encoding="utf-8"
        )
        temporary.replace(target)

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
        cards: int,
        retries: int,
        escalations: int,
        totals: dict[str, int],
    ) -> RunReport:
        self._wake(run_id, policy_id, policy_hash, reason)
        escalations += 1
        checkpoint = self._checkpoint_path(run_id)
        prior = json.loads(checkpoint.read_text(encoding="utf-8")) if checkpoint.exists() else {}
        self._save(
            run_id,
            {
                "state": "parked", "reason": reason, "failure_code": reason,
                "completed": completed, "issued": prior.get("issued", {}),
                "cards": cards, "retries": retries, "escalations": escalations,
                "counts": totals,
            },
        )
        return RunReport(
            run_id, self.workflow.id, "parked", cards, retries, escalations, totals
        )

    def _inspect(self, stage, result: dict) -> dict:
        verdict = self.inspector_turn(stage, result)
        if not isinstance(verdict, dict) or set(verdict) != {"decision", "grade"}:
            raise ValueError("invalid_inspector_result")
        if (
            verdict["decision"] not in {"pass", "retry", "park"}
            or type(verdict["grade"]) is not int
            or not 0 <= verdict["grade"] <= 100
        ):
            raise ValueError("invalid_inspector_decision")
        self._safe(verdict)
        return verdict

    @staticmethod
    def _inspector_result(stage_id: str, source: dict, attempt: int) -> dict:
        return {
            "stage_id": stage_id,
            "state": "complete",
            "ids": list(source["ids"]),
            "counts": {},
            "hashes": list(source["hashes"]),
            "failure_codes": {},
            "attempt": attempt,
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
        self._safe(
            {
                "policy_id": policy_id, "policy_hash": policy_hash,
                "input_ids": input_ids, "input_hashes": input_hashes,
                "counts": counts,
            }
        )
        checkpoint = self._checkpoint_path(run_id)
        state = (
            json.loads(checkpoint.read_text(encoding="utf-8"))
            if checkpoint.exists()
            else {"completed": {}, "issued": {}, "cards": 0, "retries": 0, "escalations": 0, "counts": {}}
        )
        if state.get("state") in {"complete", "parked"}:
            return RunReport(
                run_id, self.workflow.id, state["state"], state["cards"],
                state["retries"], state["escalations"], state["counts"],
            )

        completed = state["completed"]
        issued = state.get("issued", {})
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
                    cards, retries, escalations, totals,
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
            write_card(job, self.outbox)
            cards += 1

            # Persist this before the adapter is called.  A resumed worker uses
            # the same key, letting the desktop adapter return its cached result.
            issued[f"{stage.id}:1"] = {
                "card_path": f"{card_id}.md",
                "execution_key": hashlib.sha256(f"{run_id}|{stage.id}|1".encode()).hexdigest(),
            }
            self._save(run_id, {"completed": completed, "issued": issued, "cards": cards, "retries": retries, "escalations": escalations, "counts": totals})

            if stage.agent == "human":
                return self._park(
                    run_id, policy_id, policy_hash, "human_gate", completed, cards,
                    retries, escalations, totals,
                )

            if stage.inspect:
                if len(stage.needs) != 1:
                    return self._park(
                        run_id, policy_id, policy_hash, "invalid_inspection_stage", completed,
                        cards, retries, escalations, totals,
                    )
                producer_id = stage.needs[0]
                producer = next(item for item in self.workflow.stages if item.id == producer_id)
                source = completed[producer_id]["result"]
                try:
                    verdict = self._inspect(stage, source)
                except Exception as error:
                    return self._park(
                        run_id, policy_id, policy_hash,
                        "inspector_unavailable" if "unavailable" in str(error) else "inspector_failed", completed,
                        cards, retries, escalations, totals,
                    )

                inspector_attempt = 1
                if verdict["decision"] == "retry":
                    retries += 1
                    rework_id = f"{card_run_id}-{producer_id}-a2"
                    rework_job = StageJob(
                        rework_id, "prospecting", card_run_id, producer_id, producer.agent,
                        (card_id,), policy_id, policy_hash, stage_ids, stage_hashes, counts,
                        ("inspector_rework_once", "summary_schema_valid", "no_pii"),
                    )
                    write_card(rework_job, self.outbox)
                    cards += 1
                    try:
                        source = self._valid(self.turn(producer, 2, rework_job), producer_id)
                    except Exception:
                        source = {"state": "failed"}
                    if source.get("state") != "complete":
                        return self._park(
                            run_id, policy_id, policy_hash, "retry_exhausted", completed,
                            cards, retries, escalations, totals,
                        )
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
                    write_card(reinspection_job, self.outbox)
                    cards += 1
                    inspector_attempt = 2
                    try:
                        verdict = self._inspect(stage, source)
                    except Exception:
                        verdict = {"decision": "park", "grade": 0}

                if verdict["decision"] != "pass" or verdict["grade"] < 90:
                    return self._park(
                        run_id, policy_id, policy_hash, "inspector_failed", completed,
                        cards, retries, escalations, totals,
                    )
                result = self._inspector_result(stage.id, source, inspector_attempt)
            else:
                try:
                    result = self._valid(self.turn(stage, 1, job), stage.id)
                except ValueError as error:
                    return self._park(
                        run_id, policy_id, policy_hash,
                        "pii_result" if str(error) == "pii_result" else "invalid_result", completed,
                        cards, retries, escalations, totals,
                    )
                except Exception:
                    return self._park(
                        run_id, policy_id, policy_hash, "invalid_result", completed,
                        cards, retries, escalations, totals,
                    )

            if result["state"] == "failed":
                retries += 1
                retry_id = f"{card_run_id}-{stage.id}-a2"
                retry_job = StageJob(
                    retry_id, "prospecting", card_run_id, stage.id, stage.agent, (card_id,),
                    policy_id, policy_hash, stage_ids, stage_hashes, counts,
                    ("retry_once", "summary_schema_valid", "no_pii"),
                )
                write_card(retry_job, self.outbox)
                cards += 1
                try:
                    result = self._valid(self.turn(stage, 2, retry_job), stage.id)
                except Exception:
                    result = {"state": "failed"}
                if result.get("state") != "complete":
                    return self._park(
                        run_id, policy_id, policy_hash, "retry_exhausted", completed,
                        cards, retries, escalations, totals,
                    )
                card_id = retry_id

            completed[stage.id] = {"card_id": card_id, "result": result}
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
