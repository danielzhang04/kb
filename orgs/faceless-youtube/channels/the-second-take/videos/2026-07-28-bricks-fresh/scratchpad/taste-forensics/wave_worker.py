"""Worker-scoped, one-item Forge generation loop for a W6 wave.

This module deliberately owns no slate building, review, stamping, registration, or
promotion.  ``invoke_forge`` is the sole provider-call seam so the harness can be
tested without a provider call.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from typing import Any


RESULT_SCHEMA = "image-gen-worker-result@1"
DISPATCH_SCHEMA = "image-gen-worker-dispatch@1"
STALL_SECONDS = 240
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_new(path: str | Path, value: Any) -> None:
    """Write a worker-owned artifact once; an existing path is a planner collision."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 10
    while True:
        try:
            with target.open("x", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
            return
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.02)


def sanitize_error(text: str) -> str:
    """Keep diagnostics useful without preserving a URL, key, or bearer payload."""
    clean = re.sub(r"https?://\S+", "[redacted-url]", text or "")
    clean = re.sub(r"(?i)(api[_ -]?key|authorization|bearer)\s*[:=]\s*\S+", r"\1=[redacted]", clean)
    return clean[-500:]


def classify_output(returncode: int, output: str) -> tuple[str, int | None]:
    """Map Forge output to W6 transport outcomes without interpreting content."""
    lower = output.lower()
    if "429" in output:
        billing_words = ("resource_exhausted", "free-tier", "free tier", "limit: 0", "limit=0", "billing", "plan")
        if any(word in lower for word in billing_words):
            return "429", 429
    if "503" in output or "unavailable" in lower:
        return "503", 503
    if "skip (exists in staging)" in lower or "reserved" in lower:
        return "EXISTS", None
    if "skip (seed awaits review)" in lower or "awaits review" in lower:
        return "HELD", None
    if returncode == 0 and "ok -> _staging/" in lower:
        return "OK", None
    return "ERR", None


def invoke_forge(item_spec: Path, dispatch: dict[str, Any]) -> tuple[str, float, int | None, str]:
    """The provider seam.  Tests replace this function; production invokes Forge only."""
    forge = dispatch["forge_path"]
    kit_rel = dispatch["kit_rel"]
    command = [sys.executable, forge, "gen", "--kit", kit_rel, "--batch", str(item_spec)]
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command,
            cwd=dispatch["org_dir"],
            capture_output=True,
            text=True,
            timeout=int(dispatch["limits"].get("stall_seconds", STALL_SECONDS)),
        )
    except subprocess.TimeoutExpired:
        return "STALL", time.monotonic() - started, None, "Forge process exceeded stall ceiling"
    output = (completed.stdout or "") + (completed.stderr or "")
    outcome, code = classify_output(completed.returncode, output)
    return outcome, time.monotonic() - started, code, sanitize_error(output)


def read_json(path: str | Path) -> Any:
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def is_complete_png(path: str | Path) -> bool:
    candidate = Path(path)
    try:
        return candidate.is_file() and candidate.stat().st_size > len(PNG_MAGIC) and candidate.open("rb").read(8) == PNG_MAGIC
    except OSError:
        return False


def billing_halt_present(dispatch: dict[str, Any]) -> bool:
    return Path(dispatch["billing_halt_path"]).exists()


def write_billing_halt(dispatch: dict[str, Any], item: dict[str, Any], detail: str) -> None:
    """First qualifying 429 parks the entire wave; O_EXCL preserves first-writer evidence."""
    path = Path(dispatch["billing_halt_path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump({"status": "HALT-BILLING", "worker_id": dispatch["worker_id"],
                       "output_name": item["output_name"], "at": utc_now(), "detail": sanitize_error(detail)}, handle)
            handle.write("\n")
    except (FileExistsError, PermissionError):
        pass


def claim_attempt(dispatch: dict[str, Any]) -> bool:
    """Dynamically lease one provider attempt from the wave cap using an O_EXCL lock."""
    lease = Path(dispatch["attempt_lease_path"])
    lock = lease.with_suffix(lease.suffix + ".lock")
    deadline = time.monotonic() + 10
    while True:
        owns_lock = False
        try:
            with lock.open("x", encoding="utf-8"):
                owns_lock = True
                state = read_json(lease)
                if state["remaining"] <= 0:
                    return False
                state["remaining"] -= 1
                state["claimed"] += 1
                temporary = lease.with_suffix(lease.suffix + ".tmp")
                temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
                os.replace(temporary, lease)
                return True
        except (FileExistsError, PermissionError):
            if time.monotonic() >= deadline:
                raise RuntimeError("attempt lease lock did not clear")
            time.sleep(0.02)
        finally:
            if owns_lock:
                try:
                    lock.unlink()
                except FileNotFoundError:
                    pass


def append_genlog(path: str | Path, record: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, sort_keys=True, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def result_item(assignment: dict[str, Any]) -> dict[str, Any]:
    return {
        "item_ordinal": assignment["item_ordinal"], "shot_id": assignment.get("shot_id"),
        "card_id": assignment.get("card_id"), "output_name": assignment["output_name"],
        "staging_slot": assignment["staging_slot"], "promotion_slot": assignment["promotion_slot"],
        "chain_id": assignment["chain_id"], "dependency_depth": assignment["dependency_depth"],
        "references": assignment.get("references", []), "attempts": [], "final_status": None,
        "staged_sha256": None, "suspected_mechanism_layer": None, "deviation_flags": [],
    }


def validate_result(result: dict[str, Any]) -> dict[str, Any]:
    required = {"schema", "run_id", "wave_id", "worker_id", "status", "worktree", "input_spec",
                "review_store_sha256", "started_at", "finished_at", "budget", "items", "genlog_segment",
                "worker_deviation_flags"}
    missing = required - set(result)
    if missing or result.get("schema") != RESULT_SCHEMA:
        raise ValueError(f"invalid worker result: missing={sorted(missing)}")
    for item in result["items"]:
        if item.get("final_status") is None or not isinstance(item.get("attempts"), list):
            raise ValueError("invalid worker result item")
    return result


def run_worker(dispatch_path: str | Path) -> dict[str, Any]:
    dispatch = read_json(dispatch_path)
    if dispatch.get("schema") != DISPATCH_SCHEMA:
        raise ValueError("invalid dispatch schema")
    spec_path = Path(dispatch["worker_spec"]["path"])
    if sha256_file(spec_path) != dispatch["worker_spec"]["sha256"]:
        raise ValueError("worker spec digest mismatch")
    source_items = read_json(spec_path)
    assignments = dispatch["assignments"]
    if len(source_items) != len(assignments):
        raise ValueError("worker spec and assignment count differ")
    started = utc_now()
    budget = {"rate_usd": dispatch["limits"]["rate_usd"], "hard_cap_usd": dispatch["limits"]["hard_cap_usd"],
              "max_provider_attempts": dispatch["limits"]["max_provider_attempts"], "provider_calls": 0,
              "billable_outputs": 0, "estimated_spend_usd": 0.0}
    result = {"schema": RESULT_SCHEMA, "run_id": dispatch["run_id"], "wave_id": dispatch["wave_id"],
              "worker_id": dispatch["worker_id"], "status": "complete", "worktree": dispatch["worktree"],
              "input_spec": dispatch["worker_spec"], "review_store_sha256": dispatch["review_store_sha256"],
              "started_at": started, "finished_at": None, "budget": budget, "items": [],
              "genlog_segment": dispatch["genlog_path"], "worker_deviation_flags": []}
    consecutive_503 = 0
    halted = False
    for ordinal, (raw_item, assignment) in enumerate(zip(source_items, assignments), 1):
        if halted or billing_halt_present(dispatch):
            result["status"] = "halted"
            result["worker_deviation_flags"].append("HALT-BILLING global signal")
            break
        item = result_item(assignment)
        item_spec = Path(dispatch["item_spec_dir"]) / f"{dispatch['run_id']}.{dispatch['wave_id']}.{dispatch['worker_id']}.item-{ordinal:04d}-{assignment['output_name']}.spec.json"
        write_json_new(item_spec, [raw_item])
        attempts_allowed = 2  # one original attempt plus the one unchanged re-issue mandated by W6.
        while len(item["attempts"]) < attempts_allowed:
            if billing_halt_present(dispatch):
                item["final_status"] = "HALT-BILLING"
                halted = True
                break
            if sha256_file(dispatch["review_store_path"]) != dispatch["review_store_sha256"]:
                item["final_status"] = "HALT-INTEGRITY"
                item["suspected_mechanism_layer"] = "review-store-race"
                halted = True
                break
            if not claim_attempt(dispatch):
                item["final_status"] = "HALT-BUDGET"
                halted = True
                break
            outcome, elapsed, code, detail = invoke_forge(item_spec, dispatch)
            budget["provider_calls"] += 1
            attempt = {"attempt_no": len(item["attempts"]) + 1, "elapsed_s": round(elapsed, 3),
                       "outcome": outcome if outcome in {"OK", "STALL", "503", "429", "ERR"} else "ERR",
                       "provider_code": code, "billable": outcome == "OK"}
            item["attempts"].append(attempt)
            append_genlog(dispatch["genlog_path"], {"run_id": dispatch["run_id"], "wave_id": dispatch["wave_id"],
                           "worker_id": dispatch["worker_id"], "wave_ordinal": dispatch["wave_ordinal"],
                           "dependency_depth": assignment["dependency_depth"], "partition_ordinal": assignment["partition_ordinal"],
                           "item_ordinal": assignment["item_ordinal"], "output_name": assignment["output_name"],
                           **attempt, "detail": sanitize_error(detail)})
            if outcome == "OK":
                if not is_complete_png(assignment["staging_slot"]):
                    item["final_status"] = "HALT-INTEGRITY"
                    item["suspected_mechanism_layer"] = "staging-publication"
                    halted = True
                else:
                    item["final_status"] = "OK"
                    item["staged_sha256"] = sha256_file(assignment["staging_slot"])
                    budget["billable_outputs"] += 1
                break
            if outcome == "429":
                item["final_status"] = "HALT-BILLING"
                write_billing_halt(dispatch, assignment, detail)
                halted = True
                break
            if outcome == "EXISTS":
                item["final_status"] = "HALT-COLLISION"
                halted = True
                break
            if outcome == "HELD":
                item["final_status"] = "HALT-INTEGRITY"
                item["suspected_mechanism_layer"] = "seed-or-review-frontier"
                halted = True
                break
            if outcome == "503":
                consecutive_503 += 1
                item["final_status"] = "PARK-503" if consecutive_503 >= 2 else "PARK-MECHANICAL"
                item["suspected_mechanism_layer"] = "provider-availability"
                break
            consecutive_503 = 0
            if outcome == "STALL" and len(item["attempts"]) < attempts_allowed:
                continue
            if outcome == "ERR" and len(item["attempts"]) < attempts_allowed:
                continue
            item["final_status"] = "PARK-STALL" if outcome == "STALL" else "PARK-MECHANICAL"
            item["suspected_mechanism_layer"] = "transport"
            break
        if item["final_status"] is None:
            item["final_status"] = "PARK-MECHANICAL"
        result["items"].append(item)
        if halted:
            result["status"] = "halted"
            break
    if result["status"] != "halted" and any(item["final_status"] != "OK" for item in result["items"]):
        result["status"] = "partial"
    budget["estimated_spend_usd"] = round(budget["billable_outputs"] * budget["rate_usd"], 6)
    result["finished_at"] = utc_now()
    validate_result(result)
    write_json_new(dispatch["result_path"], result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dispatch", required=True)
    args = parser.parse_args()
    run_worker(args.dispatch)


if __name__ == "__main__":
    main()
