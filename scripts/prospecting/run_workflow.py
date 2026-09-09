"""PII-free VM terminal runner for declared prospecting workflows."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
import uuid

from scripts.prospecting.manager.bridge import DesktopBridge
from scripts.prospecting.manager.bindings import command_digest, stage_execution_key
from scripts.prospecting.manager.campaigns import (
    MAX_BRIEF_BYTES,
    CampaignService,
    DraftingSettings,
)
from scripts.prospecting.manager.compile_ask import FIT_PREFIXES
from scripts.prospecting.manager.jobs import StageJob, write_card
from scripts.prospecting.manager.p5_contracts import verify_prerequisites
from scripts.prospecting.manager.runner import (
    ALLOWED_RESULT,
    INSPECTION_PASS_SCORE,
    ManagerRunner,
)
from scripts.prospecting.manager.workflows import load_workflow
from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import migrate, open_store


ASK_REF = re.compile(r"^ask-[a-z0-9-]{3,80}$")
REPO_ROOT = Path(__file__).resolve().parents[2]
CLI = {
    "prospecting-list-builder": "list-builder",
    "prospecting-personalizer": "personalizer",
    "prospecting-campaigner": "campaigner",
    "inspector": "inspector",
}

def _same_file(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev,
        left.st_ino,
        left.st_size,
        left.st_mtime_ns,
    ) == (
        right.st_dev,
        right.st_ino,
        right.st_size,
        right.st_mtime_ns,
    )


def _local_file(path: Path, code: str) -> tuple[Path, os.stat_result]:
    try:
        absolute = Path(os.path.abspath(path))
        for candidate in reversed((absolute, *absolute.parents)):
            info = candidate.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(
                info, "st_file_attributes", 0
            ) & 0x400:
                raise OSError
            if candidate != absolute and not stat.S_ISDIR(info.st_mode):
                raise OSError
        before = absolute.lstat()
        if not stat.S_ISREG(before.st_mode):
            raise OSError
        return absolute, before
    except (OSError, ValueError):
        raise ValueError(code) from None


def _read_local_text(path: Path, code: str, *, empty_ok: bool = False) -> str:
    """Read one bounded local file without following link/reparse components."""
    absolute, before = _local_file(path, code)
    if before.st_size > MAX_BRIEF_BYTES:
        raise ValueError(code)
    try:
        with absolute.open("rb") as source:
            opened = os.fstat(source.fileno())
            if not _same_file(before, opened):
                raise OSError
            raw = source.read(MAX_BRIEF_BYTES + 1)
            after = os.fstat(source.fileno())
        if len(raw) > MAX_BRIEF_BYTES or not _same_file(opened, after):
            raise OSError
        value = raw.decode("utf-8")
    except (OSError, UnicodeError, ValueError):
        raise ValueError(code) from None
    if not empty_ok and not value.strip():
        raise ValueError(code)
    return value


def _brief_from_files(ask_file: Path, fit_file: Path | None) -> str:
    ask = _read_local_text(ask_file, "ask_file_invalid")
    if any(
        line.strip().lower().startswith(FIT_PREFIXES) for line in ask.splitlines()
    ):
        raise ValueError("ask_file_contains_fit")
    if fit_file is None:
        return ask
    fit = _read_local_text(fit_file, "fit_file_invalid", empty_ok=True)
    if any(
        line.strip()
        and not line.strip().lower().startswith(FIT_PREFIXES)
        for line in fit.splitlines()
    ):
        raise ValueError("fit_file_invalid")
    if not fit.strip():
        return ask
    return ask + ("" if ask.endswith(("\n", "\r")) else "\n") + fit


def _drafting(args: argparse.Namespace) -> DraftingSettings | None:
    values = (args.draft_step, args.minimum_confidence, args.model_version)
    if all(value is None for value in values):
        return None
    if any(value is None for value in values):
        raise ValueError("drafting_settings_incomplete")
    return DraftingSettings(*values)


def _readonly_preview(
    store_path: Path,
    *,
    brief_text: str,
    sender_profile_id: str,
    mailbox_id: str,
    drafting: DraftingSettings | None,
) -> dict[str, object]:
    """Compile through CampaignService in memory; never migrate or write the source DB."""
    safe_store, _store_stat = _local_file(store_path, "store_read_failed")
    source: sqlite3.Connection | None = None
    memory: sqlite3.Connection | None = None
    try:
        source = sqlite3.connect(safe_store.as_uri() + "?mode=ro", uri=True)
        memory = sqlite3.connect(":memory:", isolation_level=None)
        memory.row_factory = sqlite3.Row
        memory.execute("PRAGMA foreign_keys=ON")
        source.backup(memory)
        migrate(memory)
        session = CampaignService(memory).create(
            request_id=str(uuid.uuid4()),
            brief_text=brief_text,
            sender_profile_id=sender_profile_id,
            mailbox_id=mailbox_id,
            drafting=drafting,
        )
        return session.vm_projection()
    except (OSError, sqlite3.Error, RuntimeError):
        raise ValueError("store_read_failed") from None
    finally:
        if memory is not None:
            memory.close()
        if source is not None:
            source.close()


def _local_campaign(
    args: argparse.Namespace,
    brief_text: str | None,
    drafting: DraftingSettings | None,
) -> dict[str, object]:
    try:
        connection = open_store(args.store)
    except (OSError, sqlite3.Error, RuntimeError):
        raise ValueError("store_open_failed") from None
    try:
        service = CampaignService(connection)
        if args.campaign_id is not None:
            session = service.resume(args.campaign_id)
        else:
            assert brief_text is not None
            session = service.create(
                request_id=args.create_request,
                brief_text=brief_text,
                sender_profile_id=args.sender_profile_id,
                mailbox_id=args.mailbox_id,
                drafting=drafting,
            )
        return session.vm_projection()
    finally:
        connection.close()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--workflow",
        choices=(
            "outreach-run", "list-only", "personalize-only", "enroll-only",
            "reply-triage",
        ),
        required=True,
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--ask-file", type=Path)
    source.add_argument("--ask-ref")
    source.add_argument("--campaign-id")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--local", action="store_true")
    mode.add_argument("--ssh", action="store_true")
    parser.add_argument("--host")
    parser.add_argument("--store", type=Path)
    parser.add_argument("--fit-file", type=Path)
    parser.add_argument("--create-request")
    parser.add_argument("--sender-profile-id")
    parser.add_argument("--mailbox-id")
    parser.add_argument("--draft-step", type=int, choices=(0, 1, 2))
    parser.add_argument("--minimum-confidence", type=float)
    parser.add_argument("--model-version")
    parser.add_argument("--model-response-file", type=Path)
    parser.add_argument("--prepared-output-file", type=Path)
    parser.add_argument("--pending-ok", action="store_true")
    parser.add_argument("--outbox", type=Path, required=True)
    return parser


def _validate_cli(args: argparse.Namespace) -> None:
    drafting_values = (
        args.draft_step,
        args.minimum_confidence,
        args.model_version,
    )
    if any(value is not None for value in drafting_values) and any(
        value is None for value in drafting_values
    ):
        raise ValueError("drafting_settings_incomplete")
    local_create = (args.create_request, args.sender_profile_id, args.mailbox_id)
    execution_paths = (args.model_response_file, args.prepared_output_file)
    if args.ssh:
        if (
            args.host is None
            or args.ask_ref is None
            or not ASK_REF.fullmatch(args.ask_ref)
            or any(
                value is not None
                for value in (
                    args.store,
                    args.fit_file,
                    *local_create,
                    *drafting_values,
                    args.campaign_id,
                )
            )
            or any(value is None for value in execution_paths)
        ):
            raise ValueError("ssh_inputs_invalid")
        return
    if args.host is not None or args.ask_ref is not None:
        raise ValueError("local_inputs_invalid")
    if args.dry_run:
        if (
            args.ask_file is None
            or args.store is None
            or args.sender_profile_id is None
            or args.mailbox_id is None
            or args.create_request is not None
            or args.campaign_id is not None
            or any(value is not None for value in execution_paths)
        ):
            raise ValueError("dry_run_inputs_invalid")
        return
    if args.store is None or any(value is None for value in execution_paths):
        raise ValueError("local_inputs_invalid")
    if args.ask_file is not None:
        if args.campaign_id is not None or any(value is None for value in local_create):
            raise ValueError("local_create_inputs_required")
    elif args.campaign_id is not None:
        if args.fit_file is not None or any(
            value is not None for value in (*local_create, *drafting_values)
        ):
            raise ValueError("local_resume_inputs_forbidden")
    else:
        raise ValueError("local_inputs_invalid")


def _safe(value: object, sink: str) -> None:
    assert_vm_safe({"kind": sink, "fields": value}, sink)


def _job_campaign_id(campaign_id: str) -> str:
    """Translate P8's row ID only for manager surfaces that forbid underscores."""
    if re.fullmatch(r"camp_[0-9a-f]{16}", campaign_id):
        return campaign_id.replace("_", "-", 1)
    return campaign_id


def _prepare_outbox(outbox: Path) -> Path:
    """Establish the exact writable card directory before campaign mutation."""
    target = Path(os.path.abspath(outbox))
    queue = (REPO_ROOT / "queue").resolve(strict=False)
    try:
        for candidate in reversed((target, *target.parents)):
            try:
                info = candidate.lstat()
            except FileNotFoundError:
                continue
            if (
                stat.S_ISLNK(info.st_mode)
                or getattr(info, "st_file_attributes", 0) & 0x400
                or not stat.S_ISDIR(info.st_mode)
            ):
                raise OSError
        target.mkdir(parents=True, exist_ok=True)
        for candidate in reversed((target, *target.parents)):
            info = candidate.lstat()
            if (
                stat.S_ISLNK(info.st_mode)
                or getattr(info, "st_file_attributes", 0) & 0x400
                or not stat.S_ISDIR(info.st_mode)
            ):
                raise OSError
        resolved = target.resolve(strict=True)
        if resolved == queue or queue in resolved.parents:
            raise OSError
        descriptor, probe_name = tempfile.mkstemp(
            prefix=".workflow-probe-", suffix=".tmp", dir=target
        )
        os.close(descriptor)
        Path(probe_name).unlink()
        return target
    except (OSError, ValueError):
        raise ValueError("outbox_invalid") from None


def _local_bridge(store_path: Path, execution_paths: tuple[Path, Path]) -> DesktopBridge:
    """Bind the child process to one explicit desktop-local data root.

    This desktop trust boundary assumes another process running as the same OS
    user does not rename and replace the selected SQLite file between stage
    launches.  The bridge rejects path/link divergence, but SQLite is opened by
    pathname in each process rather than through a transferable Windows handle.
    """
    store, _store_stat = _local_file(store_path, "desktop_context_invalid")
    desktop_root = store.parent
    if desktop_root.name.casefold() != "kb-prospecting":
        raise ValueError("desktop_context_invalid")
    for path in execution_paths:
        absolute = Path(os.path.abspath(path))
        if desktop_root not in absolute.parents:
            raise ValueError("desktop_context_invalid")
    return DesktopBridge(
        desktop_root / "jobs",
        local_app_data=desktop_root.parent,
        store_path=store,
        repo_root=REPO_ROOT,
    )


def _plan(workflow, outbox: Path, compiled: dict) -> int:
    cards: dict[str, str] = {}
    for stage in workflow.stages:
        card_id = f"plan-{stage.id}-a1"
        dependencies = tuple(cards[item] for item in stage.needs)
        write_card(
            StageJob(
                card_id, "prospecting", "plan", stage.id, stage.agent, dependencies,
                compiled["policy_id"], compiled["policy_hash"],
                (_job_campaign_id(compiled["campaign_id"]),), (),
                {"requested": compiled["target_policy"]["requested_people"]},
                ("dry_run_only", "no_pii"),
            ),
            outbox,
        )
        cards[stage.id] = card_id
    return len(cards)


def main(argv=None, compile_ref=None, bridge=None, prerequisites=None) -> int:
    args = _parser().parse_args(argv)
    _validate_cli(args)
    if args.ssh:
        raise ValueError("ssh_saved_request_resolver_unavailable")
    workflow = load_workflow(REPO_ROOT / "workflows" / f"{args.workflow}.md")
    if args.pending_ok and not args.dry_run:
        raise ValueError("pending_ok_is_dry_run_only")
    drafting = _drafting(args)
    if (
        args.local
        and args.ask_file is not None
        and drafting is None
        and any(stage.agent == "prospecting-personalizer" for stage in workflow.stages)
    ):
        raise ValueError("drafting_not_configured")

    phase_states = (prerequisites or (
        lambda pending_ok: verify_prerequisites(REPO_ROOT, pending_ok).phases
    ))(args.pending_ok)
    args.outbox = _prepare_outbox(args.outbox)
    active_bridge = bridge
    if active_bridge is None and args.local:
        active_bridge = _local_bridge(
            args.store,
            (args.model_response_file, args.prepared_output_file),
        )
    brief = (
        _brief_from_files(args.ask_file, args.fit_file)
        if args.ask_file is not None
        else None
    )
    if compile_ref is not None:
        compiled = compile_ref(brief if brief is not None else args.campaign_id)
    elif args.dry_run:
        assert brief is not None
        compiled = _readonly_preview(
            args.store,
            brief_text=brief,
            sender_profile_id=args.sender_profile_id,
            mailbox_id=args.mailbox_id,
            drafting=drafting,
        )
    elif args.local:
        compiled = _local_campaign(args, brief, drafting)
    else:  # guarded by the SSH preflight above
        raise ValueError("ssh_saved_request_resolver_unavailable")
    if not args.dry_run:
        compiled = {
            **compiled,
            "model_response": str(args.model_response_file),
            "output": str(args.prepared_output_file),
        }
    if (
        args.local
        and any(stage.agent == "prospecting-personalizer" for stage in workflow.stages)
        and compiled.get("drafting_configured") is not True
    ):
        raise ValueError("drafting_not_configured")
    _safe(compiled, "vm_policy")

    if args.dry_run:
        result = {
            "mode": "dry-run", "workflow": workflow.id,
            "campaign_id": compiled["campaign_id"],
            "policy_id": compiled["policy_id"],
            "policy_hash": compiled["policy_hash"],
            "card_count": _plan(workflow, args.outbox, compiled),
            "prerequisites": phase_states,
        }
    else:
        mode = "ssh" if args.ssh else "local"
        bridge_calls = list(getattr(active_bridge, "workflow_call_records", ()))

        def invoke_bound(agent, payload):
            payload["command_digest"] = command_digest(payload)
            outcome = active_bridge.invoke(agent, payload, mode, host=args.host)
            summary = outcome.summary
            if outcome.code == "ok" and (
                not isinstance(summary, dict)
                or set(summary) != ALLOWED_RESULT
                or summary.get("stage_id") != payload["stage_id"]
                or summary.get("attempt") != payload["attempt"]
                or summary.get("execution_key") != payload["execution_key"]
                or summary.get("command_digest") != payload["command_digest"]
            ):
                raise RuntimeError("result_binding_conflict")
            return outcome

        def turn(stage, attempt, job):
            execution_key = stage_execution_key(workflow, job, stage, attempt)
            payload = {
                "operation": stage.operation,
                "stage_id": stage.id,
                "attempt": attempt,
                "run_id": job.workflow,
                "execution_key": execution_key,
                "policy_id": job.policy_id,
                "policy_hash": job.policy_hash,
                "campaign_id": compiled["campaign_id"],
                "sender_profile_id": compiled["sender_profile_id"],
                "lanes": list(compiled["target_policy"].get("lane_plan", ["manual"])),
                "model_response": compiled["model_response"],
                "output": compiled["output"],
                "ids": list(job.input_ids),
                "hashes": list(job.input_hashes),
                "counts": dict(job.counts),
            }
            outcome = invoke_bound(CLI[stage.agent], payload)
            bridge_calls.append({
                "entrypoint": CLI[stage.agent],
                "exit_code": outcome.exit_code,
                "state": outcome.code,
                "counts": outcome.summary.get("counts", {}),
            })
            active_bridge.workflow_call_records = bridge_calls
            if outcome.code != "ok":
                return {
                    "stage_id": stage.id,
                    "state": "failed",
                    "ids": [],
                    "counts": {},
                    "hashes": [],
                    "failure_codes": {"adapter_recovery_required": 1},
                    "attempt": attempt,
                    "execution_key": execution_key,
                    "command_digest": payload["command_digest"],
                }
            return outcome.summary

        def inspect(stage, prior, job, attempt):
            execution_key = stage_execution_key(workflow, job, stage, attempt)
            payload = {
                "operation": "grade", "stage_id": stage.id, "attempt": attempt,
                "run_id": job.workflow, "execution_key": execution_key,
                "policy_id": job.policy_id, "policy_hash": job.policy_hash,
                "campaign_id": compiled["campaign_id"], "sender_profile_id": compiled["sender_profile_id"],
                "lanes": list(compiled["target_policy"].get("lane_plan", ["manual"])),
                "model_response": compiled["model_response"], "output": compiled["output"],
                "ids": list(job.input_ids), "hashes": list(job.input_hashes),
                "counts": dict(job.counts),
            }
            outcome = invoke_bound("inspector", payload)
            if outcome.code != "ok":
                raise RuntimeError("inspector_unavailable")
            if outcome.summary.get("failure_codes", {}).get("inspector_unavailable"):
                raise RuntimeError("inspector_unavailable")
            grade = outcome.summary.get("counts", {}).get("grade")
            if type(grade) is not int or not 0 <= grade <= 100:
                raise RuntimeError("inspector_failed")
            return {
                "decision": "pass" if grade >= INSPECTION_PASS_SCORE else "park",
                "grade": grade,
                "execution_key": execution_key,
                "command_digest": payload["command_digest"],
            }

        report = ManagerRunner(workflow, args.outbox, turn, inspect).run(
            "run-" + _job_campaign_id(compiled["campaign_id"]),
            compiled["policy_id"],
            compiled["policy_hash"],
            (_job_campaign_id(compiled["campaign_id"]),),
            (),
            {"requested": compiled["target_policy"]["requested_people"]},
        )
        result = {
            **asdict(report), "campaign_id": compiled["campaign_id"],
            "mode": mode, "prerequisites": phase_states,
            "bridge_calls": bridge_calls,
        }

    _safe(result, "stdout")
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
