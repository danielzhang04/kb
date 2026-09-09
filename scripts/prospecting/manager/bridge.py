"""Fixed local and SSH launch of the single desktop-stage entrypoint."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from queue import Empty, Full, Queue
import re
import stat
import subprocess
import sys
from threading import Event, Thread
from time import monotonic
from typing import Callable

from scripts.prospecting.manager.p5_contracts import ENTRYPOINTS
from scripts.prospecting.pii_guard import assert_vm_safe

OUTPUT_LIMIT = 65_536


def _link_or_reparse(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & 0x400
    )


def _require_plain_directory_tree(path: Path) -> None:
    """Reject link/reparse components at the point a staged job is written."""
    for candidate in reversed((path, *path.parents)):
        try:
            info = candidate.lstat()
        except FileNotFoundError:
            continue
        if _link_or_reparse(info) or not stat.S_ISDIR(info.st_mode):
            raise ValueError("job_directory_invalid")

@dataclass(frozen=True)
class BridgeResult:
    exit_code: int
    code: str
    summary: dict

def read_bounded_output(
    proc: subprocess.Popen, timeout: int, on_chunk=None,
    cancel: Callable[[], None] | None = None,
) -> tuple[str, str] | None:
    queue: Queue[tuple[str, str | None]] = Queue(maxsize=2); stop = Event()
    cancelled = False
    def cancel_once() -> None:
        nonlocal cancelled
        if not cancelled:
            cancelled = True
            (cancel or proc.kill)()
    def publish(item):
        while not stop.is_set():
            try:
                queue.put(item, timeout=0.05)
                return
            except Full:
                continue
    def pump(name, stream):
        try:
            while not stop.is_set():
                text = stream.read(8192)
                if not text: break
                publish((name, text))
        finally:
            publish((name, None))
    threads = [Thread(target=pump, args=(name, stream), daemon=True) for name, stream in (("stdout", proc.stdout), ("stderr", proc.stderr))]
    for thread in threads: thread.start()
    result = {"stdout": [], "stderr": []}; total = closed = 0; overflow = False; deadline = monotonic() + timeout
    try:
        while closed < 2:
            remaining = deadline - monotonic()
            if remaining <= 0: raise subprocess.TimeoutExpired(proc.args, timeout)
            try: name, text = queue.get(timeout=remaining)
            except Empty as error: raise subprocess.TimeoutExpired(proc.args, timeout) from error
            if text is None: closed += 1; continue
            if on_chunk: on_chunk(name, text)
            total += len(text.encode())
            if total > OUTPUT_LIMIT:
                overflow = True
                cancel_once()
            elif not overflow: result[name].append(text)
        proc.wait(timeout=max(0, deadline - monotonic()))
        return None if overflow else ("".join(result["stdout"]), "".join(result["stderr"]))
    except BaseException:
        cancel_once()
        raise
    finally:
        stop.set()
        for stream in (proc.stdout, proc.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass
        join_deadline = monotonic() + 0.5
        for thread in threads:
            thread.join(timeout=max(0, join_deadline - monotonic()))

def terminate_windows_tree(pid: int) -> None:
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=False)

class SshStager:
    REMOTE_DIR = "C:/kb-prospecting/jobs"
    def __init__(self, run: Callable = subprocess.run, options: tuple[str, ...] = ()): self.run, self.options = run, options
    def stage(self, path: Path, host: str, timeout: int = 30) -> str:
        remote, temporary = f"{self.REMOTE_DIR}/{path.name}", f"{self.REMOTE_DIR}/{path.name}.tmp"
        calls = (["ssh", *self.options, "--", host, "powershell", "-NoProfile", "-Command", f"New-Item -ItemType Directory -Force -LiteralPath '{self.REMOTE_DIR}' | Out-Null"], ["scp", *self.options, "--", str(path), f"{host}:{temporary}"], ["ssh", *self.options, "--", host, "powershell", "-NoProfile", "-Command", f"Move-Item -Force -LiteralPath '{temporary}' -Destination '{remote}'"])
        try:
            for argv in calls: self.run(argv, check=True, shell=False, capture_output=True, timeout=timeout)
        except Exception:
            self.cleanup(host, temporary, timeout); raise
        return remote
    def cleanup(self, host: str, remote: str, timeout: int = 30) -> None:
        result = self.run(["ssh", *self.options, "--", host, "powershell", "-NoProfile", "-Command", f"Remove-Item -Force -LiteralPath '{remote}'"], check=False, shell=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout)
        if getattr(result, "returncode", 0) not in (0, None): raise RuntimeError("remote_cleanup_failed")

class DesktopBridge:
    def __init__(self, job_dir: Path, launch: Callable = subprocess.Popen, stage: Callable | None = None, cleanup: Callable | None = None, terminate_tree: Callable[[int], None] = terminate_windows_tree, remote_terminate_tree: Callable | None = None, allowed_hosts: frozenset[str] | None = None, *, local_app_data: Path | None = None, store_path: Path | None = None, repo_root: Path | None = None):
        self.job_dir = Path(os.path.abspath(job_dir))
        self.repo_root = Path(os.path.abspath(repo_root or Path(__file__).resolve().parents[3]))
        self.local_app_data = (
            Path(os.path.abspath(local_app_data)) if local_app_data is not None else None
        )
        self.store_path = (
            Path(os.path.abspath(store_path)) if store_path is not None else None
        )
        if (self.local_app_data is None) != (self.store_path is None):
            raise ValueError("desktop_context_incomplete")
        if self.local_app_data is not None:
            desktop_root = self.local_app_data / "kb-prospecting"
            if (
                self.job_dir != desktop_root
                and desktop_root not in self.job_dir.parents
            ) or (
                self.store_path != desktop_root
                and desktop_root not in self.store_path.parents
            ):
                raise ValueError("desktop_context_invalid")
        self.launch, self.terminate_tree = launch, terminate_tree
        self.options = ("-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={job_dir / 'known_hosts'}")
        stager = SshStager(options=self.options); self.stage, self.cleanup = stage or stager.stage, cleanup or stager.cleanup
        self.remote_terminate_tree = remote_terminate_tree or self._terminate_remote_tree
        configured = os.environ.get("KB_PROSPECTING_SSH_HOST", "")
        self.allowed_hosts = allowed_hosts if allowed_hosts is not None else frozenset(item for item in configured.split(",") if item)
    @staticmethod
    def _terminate_remote_tree(host: str, pid: int | None, marker: str) -> None:
        cmd = ["taskkill", "/T", "/F", "/PID", str(pid)] if pid is not None else ["powershell", "-NoProfile", "-Command", f"Get-CimInstance Win32_Process | Where-Object {{$_.CommandLine -like '*{marker}*'}} | ForEach-Object {{taskkill /T /F /PID $_.ProcessId}}"]
        subprocess.run(["ssh", "-o", "StrictHostKeyChecking=yes", "--", host, *cmd], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=False)
    @staticmethod
    def _safe(value: object, kind: str) -> None: assert_vm_safe({"kind": kind, "fields": value}, kind)
    def _env(self, mode: str) -> dict[str, str]:
        env = {key: os.environ.get(key, "") for key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP")}
        env["KB_PROSPECTING_NO_NETWORK"] = "1"
        if mode == "local" and self.local_app_data is not None:
            env["LOCALAPPDATA"] = str(self.local_app_data)
            env["KB_PROSPECTING_STORE"] = str(self.store_path)
        return env
    def _command(self, agent_cli: str, job: dict, job_path: str) -> list[str]:
        if job.get("operation") not in ENTRYPOINTS[agent_cli]["operations"]: raise ValueError("operation_not_allowed")
        return ["--job", job_path]
    def invoke(self, agent_cli: str, job: dict, mode: str, host: str | None = None, timeout: int = 120) -> BridgeResult:
        if agent_cli not in ENTRYPOINTS or mode not in {"local", "ssh"}: raise ValueError("bridge_contract_rejected")
        self._safe(job, "process_arguments")
        run_id = str(job.get("run_id", "run")); key = str(job.get("execution_key", hashlib.sha256(json.dumps(job, sort_keys=True).encode()).hexdigest()))
        if re.fullmatch(r"[a-z0-9-]{3,64}", run_id) is None or re.fullmatch(r"[0-9a-f]{64}", key) is None: raise ValueError("invalid_staged_name")
        _require_plain_directory_tree(self.job_dir)
        self.job_dir.mkdir(parents=True, exist_ok=True)
        _require_plain_directory_tree(self.job_dir)
        path = self.job_dir / f"job-{run_id}-{key}.json"
        encoded_job = json.dumps(job, sort_keys=True, separators=(",", ":")).encode()
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(path, flags, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(encoded_job)
            if _link_or_reparse(path.lstat()) or not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError("job_path_invalid")
            _require_plain_directory_tree(self.job_dir)
        except FileExistsError:
            try:
                before = path.lstat()
                if (
                    _link_or_reparse(before)
                    or not stat.S_ISREG(before.st_mode)
                    or before.st_nlink != 1
                    or before.st_size != len(encoded_job)
                ):
                    raise OSError
                with path.open("rb") as source:
                    opened = os.fstat(source.fileno())
                    existing = source.read(len(encoded_job) + 1)
                    after = os.fstat(source.fileno())
                identity = lambda info: (
                    info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns
                )
                if (
                    identity(before) != identity(opened)
                    or identity(opened) != identity(after)
                    or existing != encoded_job
                ):
                    raise OSError
                _require_plain_directory_tree(self.job_dir)
            except (OSError, ValueError):
                raise ValueError("job_path_conflict") from None
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        module, remote, remote_pid = ENTRYPOINTS[agent_cli]["module"], None, None
        selected_result: BridgeResult | None = None
        def selected(value: BridgeResult) -> BridgeResult:
            nonlocal selected_result
            selected_result = value
            return value
        try:
            if mode == "local": argv = ["py", "-3", "-m", module, *self._command(agent_cli, job, str(path))]
            else:
                if not host: raise ValueError("ssh_host_required")
                if host not in self.allowed_hosts: raise ValueError("ssh_host_not_allowed")
                remote = self.stage(path, host, min(timeout, 30)); command = ["py", "-3", "-m", module, *self._command(agent_cli, job, remote)]
                quoted = " ".join("'" + part.replace("'", "''") + "'" for part in command)
                argv = ["ssh", *self.options, "--", host, "powershell", "-NoProfile", "-Command", "$env:KB_PROSPECTING_NO_NETWORK='1'; Write-Output $PID; & " + quoted + "; exit $LASTEXITCODE"]
            proc = self.launch(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self._env(mode), cwd=str(self.repo_root), shell=False, creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
            chunks: list[str] = []; output_rejected = False
            def pid_reader(name, text):
                nonlocal remote_pid, output_rejected
                try: self._safe({name: text}, "process_results")
                except Exception: output_rejected = True
                if mode == "ssh" and name == "stdout" and remote_pid is None:
                    chunks.append(text); line, found, _ = "".join(chunks).partition("\n")
                    if found and line.strip().isdigit(): remote_pid = int(line.strip())
            def cancel_output() -> None:
                self.terminate_tree(proc.pid)
                if mode == "ssh":
                    self.remote_terminate_tree(host, remote_pid, key)
            try:
                output = read_bounded_output(
                    proc, timeout, pid_reader, cancel=cancel_output
                )
            except (subprocess.TimeoutExpired, TimeoutError):
                if output_rejected: return selected(BridgeResult(-1, "failed_output_redacted", {"counts": {"failed_output_redacted": 1}}))
                return selected(BridgeResult(-1, "timeout", {}))
            if output is None:
                if output_rejected: return selected(BridgeResult(-1, "failed_output_redacted", {"counts": {"failed_output_redacted": 1}}))
                return selected(BridgeResult(-1, "output_overflow", {}))
            stdout, stderr = output
            try: self._safe({"stdout": stdout, "stderr": stderr}, "process_results")
            except Exception: return selected(BridgeResult(proc.returncode or -1, "failed_output_redacted", {"counts": {"failed_output_redacted": 1}}))
            if mode == "ssh":
                line, found, stdout = stdout.partition("\n")
                if not found or not line.strip().isdigit() or remote_pid != int(line.strip()): raise ValueError("invalid_remote_pid")
            if proc.returncode != 0: return selected(BridgeResult(proc.returncode, "failed", {}))
            value, end = json.JSONDecoder().raw_decode(stdout)
            if stdout[end:].strip() or not isinstance(value, dict): raise ValueError("invalid_desktop_result")
            self._safe(value, "process_results"); return selected(BridgeResult(0, "ok", value))
        finally:
            primary_error = sys.exc_info()[0] is not None
            cleanup_failed = False
            if remote is not None:
                try:
                    self.cleanup(host, remote, min(timeout, 30))
                except Exception:
                    cleanup_failed = True
            try:
                path.unlink(missing_ok=True)
            except OSError:
                cleanup_failed = True
            if cleanup_failed and not primary_error and (
                selected_result is None or selected_result.code == "ok"
            ):
                raise RuntimeError("bridge_cleanup_failed")
