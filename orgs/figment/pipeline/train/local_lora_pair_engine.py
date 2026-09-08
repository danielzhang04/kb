"""Bounded two-row runtime primitives shared by fixed local comparison controllers.

This module has no CLI, stage catalogue, admission reader, or caller-selected
path interface. Controllers supply already closed roots and policy callbacks.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable


ErrorFactory = Callable[[str], Exception]
SafeExisting = Callable[[Path, Path, str], Path]
Reparse = Callable[[Path], bool]
FileHash = Callable[[Path, int | None], tuple[str, int]]


class Pumper:
    """Append one bounded stderr stream and report late reader failures."""

    def __init__(self, stream: Any, path: Path, *, maximum: int, error: ErrorFactory):
        self.stream, self.path, self.maximum, self._error_factory = stream, path, maximum, error
        self.error: BaseException | None = None
        self.truncated = False
        self.started = False
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        kept = 0
        try:
            with self.path.open("ab") as handle:
                while True:
                    block = self.stream.read(4096)
                    if not block:
                        break
                    if kept + len(block) > self.maximum:
                        self.truncated = True
                        return
                    handle.write(block)
                    handle.flush()
                    kept += len(block)
        except BaseException as exc:
            self.error = exc

    def start(self) -> None:
        self.thread.start()
        self.started = True

    def finish(self) -> None:
        if not self.started:
            return
        self.thread.join(timeout=3)
        if self.thread.is_alive() or self.error is not None or self.truncated:
            raise self._error_factory("Comfy stderr journal is incomplete")


def entries(path: Path, maximum: int, root: Path, label: str, *, safe_existing: SafeExisting, reparse: Reparse, error: ErrorFactory) -> dict[str, Path]:
    path = safe_existing(path, root, label)
    if reparse(path) or not stat.S_ISDIR(path.lstat().st_mode):
        raise error(f"{label} is not a regular directory")
    result: dict[str, Path] = {}
    try:
        with os.scandir(path) as scan:
            for entry in scan:
                if len(result) >= maximum:
                    raise error(f"{label} exceeds its entry bound")
                candidate = Path(entry.path)
                if entry.name in result or reparse(candidate):
                    raise error(f"{label} has an unsafe entry")
                result[entry.name] = candidate
    except OSError as exc:
        raise error(f"cannot enumerate {label}") from exc
    return result


def runtime_output_bound(output: Path, staged: Path | None, *, maximum_entries: int, maximum_png: int, root: Path, safe_existing: SafeExisting, reparse: Reparse, error: ErrorFactory) -> None:
    found = entries(output, maximum_entries, root, "matched output", safe_existing=safe_existing, reparse=reparse, error=error)
    loras = found.get("loras")
    if loras is None or reparse(loras) or not stat.S_ISDIR(loras.lstat().st_mode):
        raise error("matched output has no regular LoRA directory")
    lora_entries = entries(loras, 1, root, "matched LoRA output", safe_existing=safe_existing, reparse=reparse, error=error)
    if set(lora_entries) != (set() if staged is None else {staged.name}):
        raise error("matched LoRA inventory is not exact")
    for name, candidate in found.items():
        if name == "loras":
            continue
        if not name.endswith(".png") or reparse(candidate) or not stat.S_ISREG(candidate.lstat().st_mode):
            raise error("matched output contains an unsafe file")
        if candidate.stat().st_size > maximum_png:
            raise error("matched output PNG exceeds its byte bound")


def exact_output_inventory(output: Path, results: list[dict[str, Any]], staged: Path | None, *, maximum_entries: int, maximum_png: int, root: Path, safe_existing: SafeExisting, reparse: Reparse, file_hash: FileHash, error: ErrorFactory) -> None:
    expected_pngs = {entry["output"]["filename"] for entry in results}
    runtime_output_bound(output, staged, maximum_entries=maximum_entries, maximum_png=maximum_png, root=root, safe_existing=safe_existing, reparse=reparse, error=error)
    found = entries(output, maximum_entries, root, "matched output", safe_existing=safe_existing, reparse=reparse, error=error)
    if len(expected_pngs) != len(results) or set(found) != expected_pngs | {"loras"}:
        raise error("matched output inventory is not exact")
    for row in results:
        output_record = row["output"]
        name = output_record.get("filename")
        if not isinstance(name, str) or name not in expected_pngs:
            raise error("matched output filename is invalid")
        actual, size = file_hash(found[name], maximum_png)
        if actual != output_record.get("sha256") or size != output_record.get("bytes"):
            raise error("matched output bytes differ from receipt row")


def read_bounded(path: Path, maximum: int, label: str, *, root: Path, safe_existing: SafeExisting, reparse: Reparse, error: ErrorFactory, allow_empty: bool = False) -> bytes:
    path = safe_existing(path, root, label)
    before = path.stat()
    if reparse(path) or not stat.S_ISREG(path.lstat().st_mode) or (not allow_empty and before.st_size == 0) or before.st_size > maximum:
        raise error(f"{label} has an unsafe file shape")
    with path.open("rb") as handle:
        raw = handle.read(maximum + 1)
    after = path.stat()
    if len(raw) != before.st_size or len(raw) > maximum or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise error(f"{label} changed while read")
    return raw


def journal_lora_application(pumper: Any, checkpoint: dict[str, Any] | None, *, maximum_stderr: int, root: Path, safe_existing: SafeExisting, reparse: Reparse, error: ErrorFactory) -> dict[str, int]:
    pumper.finish()
    raw = read_bounded(pumper.path, maximum_stderr, "Comfy stderr journal", root=root, safe_existing=safe_existing, reparse=reparse, error=error, allow_empty=True)
    text = raw.decode("utf-8", errors="replace")
    missing = text.count("lora key not loaded:") + text.count("NOT LOADED")
    if checkpoint is not None and missing:
        raise error("Comfy reported unmatched LoRA keys")
    return {"header_unet_keys": 0 if checkpoint is None else checkpoint["unet_tensor_keys"], "comfy_missing_lora_key_warnings": missing}


def record(root: Path, name: str, value: dict[str, Any]) -> None:
    data = (json.dumps(value, sort_keys=True) + "\n").encode()
    with (root / name).open("xb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def copy_stream(source: Path, target: Path, expected: str, *, maximum: int, source_root: Path, safe_existing: SafeExisting, reparse: Reparse, file_hash: FileHash, error: ErrorFactory) -> None:
    source = safe_existing(source, source_root, "selected checkpoint")
    before = source.stat()
    if before.st_size > maximum or reparse(target.parent):
        raise error("adapter copy boundary is unsafe")
    digest = hashlib.sha256()
    total = 0
    with source.open("rb") as src, target.open("xb") as dst:
        while True:
            block = src.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > maximum:
                raise error("adapter copy exceeds bound")
            digest.update(block)
            dst.write(block)
        dst.flush()
        os.fsync(dst.fileno())
    after = source.stat()
    if total != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns or digest.hexdigest() != expected or file_hash(target, maximum)[0] != expected:
        raise error("adapter changed while copied")


def execute_pair(evidence: dict[str, Any], helper: Any, *, root: Path, main_private: Path, studio_private: Path, source: Path | None, verify_staged: Callable[[Path], dict[str, Any]], verify_before_success: Callable[[], None], receipt_inputs: Callable[[dict[str, Any]], dict[str, Any]], sha: Callable[[bytes], str], safe_existing: SafeExisting, reparse: Reparse, file_hash: FileHash, error: ErrorFactory, pumper_factory: Callable[[Any, Path], Any], schema: str, maximum_lora: int, maximum_stderr: int, maximum_png: int, maximum_output_entries: int, deadline_seconds: float) -> dict[str, Any]:
    """Launch exactly two validated rows under one owned-process deadline.

    The controller has already closed all policy inputs. This function only
    performs lifecycle, bounded-I/O, output, and durable-record mechanics.
    """
    stage = evidence.get("stage")
    rows = evidence.get("rows")
    checkpoint = evidence.get("checkpoint")
    if not isinstance(stage, str) or not isinstance(rows, list) or len(rows) != 2:
        raise error("pair engine requires exactly two validated rows")
    if source is None and checkpoint is not None:
        raise error("pair engine has no selected adapter source")
    if source is not None and checkpoint is None:
        raise error("pair engine has an unexpected adapter source")
    if root.exists() or root.parent != main_private or not main_private.is_dir():
        raise error("matched output root must be fresh and fixed")
    root.mkdir()
    output, loras, temp, user, home = root / "output", root / "output" / "loras", root / "temp", root / "user", root / "home"
    for path in (output, loras, temp, user, home):
        path.mkdir()
    stderr_path = root / "stderr.log"
    stderr_path.open("xb").close()
    staged = None
    process = wrapper = None
    tracked: dict[int, Any] = {}
    pumper: Any | None = None
    teardown: dict[str, Any] = {"verified_stopped": False}
    results: list[dict[str, Any]] = []
    application: dict[str, int] | None = None
    deadline = time.monotonic() + deadline_seconds
    failure: BaseException | None = None
    secondary_failures: list[str] = []
    try:
        if checkpoint is not None:
            staged = loras / checkpoint["filename"]
            copy_stream(source, staged, checkpoint["sha256"], maximum=maximum_lora, source_root=studio_private, safe_existing=safe_existing, reparse=reparse, file_hash=file_hash, error=error)
            copied = verify_staged(staged)
            if copied["sha256"] != checkpoint["sha256"]:
                raise error("staged adapter hash changed")
        runtime_output_bound(output, staged, maximum_entries=maximum_output_entries, maximum_png=maximum_png, root=main_private, safe_existing=safe_existing, reparse=reparse, error=error)
        if time.monotonic() >= deadline:
            raise error("matched run exceeded its one deadline before launch")
        helper._port_available()
        command = [str(helper.COMFY_PYTHON), "-X", "utf8", "main.py", "--listen", "127.0.0.1", "--port", str(helper.PORT), "--output-directory", str(output), "--temp-directory", str(temp), "--user-directory", str(user), "--disable-api-nodes", "--disable-all-custom-nodes", "--disable-auto-launch"]
        process = subprocess.Popen(command, cwd=helper.COMFY_ROOT, shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=helper._isolated_environment(root), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        wrapper = helper._process_identity(process.pid)
        if wrapper is None:
            raise error("cannot identify owned Comfy wrapper")
        pumper = pumper_factory(process.stderr, stderr_path)
        pumper.start()
        tracked = helper._wait_for_owned_listener(wrapper, deadline, {wrapper.pid: wrapper})
        opener = helper._loopback_opener()
        for row in rows:
            if time.monotonic() >= deadline:
                raise error("matched run exceeded its one deadline")
            if pumper.error is not None or pumper.truncated:
                raise error("Comfy stderr journal failed while polling")
            runtime_output_bound(output, staged, maximum_entries=maximum_output_entries, maximum_png=maximum_png, root=main_private, safe_existing=safe_existing, reparse=reparse, error=error)
            marker = root / f"dispatch-{row['seed']}.json"
            with marker.open("xb") as handle:
                handle.write(json.dumps({"stage": stage, "row_id": row["id"], "graph_sha256": sha(json.dumps(row["graph"], sort_keys=True, separators=(",", ":")).encode())}, sort_keys=True).encode())
            tracked = helper._require_owned_listener(wrapper, tracked)
            queued = helper._local_json(opener, "POST", "/prompt", {"prompt": row["graph"], "client_id": uuid.uuid4().hex})
            prompt_id = queued.get("prompt_id")
            if not isinstance(prompt_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", prompt_id):
                raise error("local prompt id is invalid")
            completed = None
            while time.monotonic() < deadline:
                if pumper.error is not None or pumper.truncated:
                    raise error("Comfy stderr journal failed while polling")
                runtime_output_bound(output, staged, maximum_entries=maximum_output_entries, maximum_png=maximum_png, root=main_private, safe_existing=safe_existing, reparse=reparse, error=error)
                tracked = helper._require_owned_listener(wrapper, tracked)
                completed = helper._completed_output(helper._local_json(opener, "GET", f"/history/{prompt_id}"), prompt_id, output)
                if completed is not None:
                    break
                time.sleep(0.5)
            if completed is None:
                raise error("matched prompt did not complete")
            results.append({"row_id": row["id"], "seed": row["seed"], "prompt_id": prompt_id, "output": completed})
        if len(results) != 2 or len({entry["output"]["sha256"] for entry in results}) != 2:
            raise error("matched pair output inventory is invalid")
    except BaseException as exc:
        failure = exc
    finally:
        try:
            if wrapper is not None:
                teardown = helper._teardown(wrapper, tracked, process)
            elif process is not None:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                    teardown = {"verified_stopped": False, "retained_wrapper_cleanup": "terminated-without-identity"}
                except BaseException as cleanup_error:
                    teardown = {"verified_stopped": False, "retained_wrapper_cleanup": type(cleanup_error).__name__}
        except BaseException as exc:
            teardown = {"verified_stopped": False, "teardown_error_class": type(exc).__name__}
            if failure is None:
                failure = exc
            else:
                secondary_failures.append(type(exc).__name__)
        try:
            if pumper is not None:
                application = journal_lora_application(pumper, checkpoint, maximum_stderr=maximum_stderr, root=main_private, safe_existing=safe_existing, reparse=reparse, error=error)
        except BaseException as exc:
            if failure is None:
                failure = exc
            else:
                secondary_failures.append(type(exc).__name__)
    if failure is None:
        try:
            if teardown.get("verified_stopped") is not True:
                raise error("owned Comfy teardown was not verified")
            exact_output_inventory(output, results, staged, maximum_entries=maximum_output_entries, maximum_png=maximum_png, root=main_private, safe_existing=safe_existing, reparse=reparse, file_hash=file_hash, error=error)
            verify_before_success()
        except BaseException as exc:
            failure = exc
    if failure is not None:
        try:
            stderr_raw = read_bounded(stderr_path, maximum_stderr, "Comfy stderr journal", root=main_private, safe_existing=safe_existing, reparse=reparse, error=error, allow_empty=True)
            stderr_sha = sha(stderr_raw)
        except BaseException as exc:
            stderr_sha = None
            secondary_failures.append(type(exc).__name__)
        record(root, "failure.json", {"schema": schema, "status": "failed", "not_promotable": True, "stage": stage, "inputs": receipt_inputs(evidence), "failure_class": type(failure).__name__, "failure_message": str(failure)[:256], "teardown": teardown, "rows": results, "stderr_sha256": stderr_sha, "stderr_complete": pumper is None or (pumper.started and pumper.error is None and not pumper.truncated and not pumper.thread.is_alive()), "secondary_failure_classes": secondary_failures})
        raise failure
    record(root, "receipt.json", {"schema": schema, "status": "complete", "not_promotable": True, "stage": stage, "inputs": receipt_inputs(evidence), "rows": results, "lora_application": application, "teardown": teardown, "stderr_sha256": file_hash(stderr_path, maximum_stderr, allow_empty=True)[0], "deadline_seconds": deadline_seconds})
    return {"schema": schema, "status": "complete", "not_promotable": True, "stage": stage, "inputs": receipt_inputs(evidence), "rows": results, "lora_application": application, "teardown": teardown, "stderr_sha256": file_hash(stderr_path, maximum_stderr, allow_empty=True)[0], "deadline_seconds": deadline_seconds}
