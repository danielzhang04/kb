#!/usr/bin/env python3
"""Create a quiescent tier-zero runtime archive on the KB VM."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Protocol


TIER_ZERO = ("opt/kb-releases", "var/lib/kb/ops", "var/lib/kb/state")


class ExportIo(Protocol):
    def is_root(self) -> bool: ...

    def output_root(self) -> Path: ...

    def exclusive_lock(self, path: Path) -> Iterator[None]: ...

    def run(self, argv: list[str]) -> subprocess.CompletedProcess[str]: ...

    def service_cgroup_children(self, unit: str) -> int: ...

    def fsync_file_and_parent(self, path: Path) -> None: ...

    def wait_readiness(self) -> dict: ...


class ProductionExportIo:
    def is_root(self) -> bool:
        return os.geteuid() == 0

    def output_root(self) -> Path:
        return Path("/var/tmp")

    @contextmanager
    def exclusive_lock(self, path: Path) -> Iterator[None]:
        import fcntl

        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def run(self, argv: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(argv, check=True, capture_output=True, text=True)

    def service_cgroup_children(self, unit: str) -> int:
        result = self.run(["systemctl", "show", "--property=ControlGroup", "--value", unit])
        control_group = result.stdout.strip()
        if not control_group.startswith("/") or control_group == "/":
            raise RuntimeError("service cgroup is unavailable")
        cgroup_root = Path("/sys/fs/cgroup").resolve(strict=True)
        service_root = (cgroup_root / control_group.lstrip("/")).resolve(strict=True)
        try:
            service_root.relative_to(cgroup_root)
        except ValueError as error:
            raise RuntimeError("service cgroup escapes cgroup root") from error
        processes = 0
        for process_file in set(service_root.glob("**/cgroup.procs")):
            processes += sum(1 for row in process_file.read_text(encoding="ascii").splitlines() if row.strip())
        return processes

    def fsync_file_and_parent(self, path: Path) -> None:
        with path.open("rb") as handle:
            os.fsync(handle.fileno())
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def wait_readiness(self) -> dict:
        deadline = time.monotonic() + 30
        while True:
            result = subprocess.run(
                ["curl", "--fail", "--silent", "--show-error", "http://127.0.0.1:4317/readyz"],
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                try:
                    payload = json.loads(result.stdout)
                except json.JSONDecodeError:
                    payload = None
                if isinstance(payload, dict):
                    return payload
            if time.monotonic() >= deadline:
                raise RuntimeError("service readiness timed out")
            time.sleep(0.25)


production_io = ProductionExportIo()


def export(output: Path, io: ExportIo = production_io) -> None:
    if not io.is_root() or output.exists() or output.parent != io.output_root():
        raise RuntimeError("export requires root and a fresh /var/tmp target")
    restart_error: BaseException | None = None
    primary_error: BaseException | None = None
    with io.exclusive_lock(Path("/run/lock/kb-maintenance.lock")):
        try:
            io.run(["systemctl", "stop", "kb-dashboard.service"])
            if io.service_cgroup_children("kb-dashboard.service") != 0:
                raise RuntimeError("service cgroup is not empty")
            io.run([
                "tar", "--acls", "--xattrs", "--numeric-owner", "--format=pax",
                "-C", "/", "-cf", str(output), *TIER_ZERO,
            ])
            io.fsync_file_and_parent(output)
        except BaseException as error:
            primary_error = error
            raise
        finally:
            try:
                io.run(["systemctl", "start", "kb-dashboard.service"])
                locked = io.wait_readiness()
                if not locked.get("quiescent") or "execution-unlocked" in locked.get("blockers", []):
                    raise RuntimeError("service did not restart locked")
            except BaseException as error:
                restart_error = error
                # Preserve an in-flight export/stop failure; it is the root cause. With no primary
                # failure, surface the restart/readiness failure after releasing the maintenance lock.
    if restart_error is not None:
        raise restart_error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the credential-free KB tier-zero runtime state.")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    export(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
