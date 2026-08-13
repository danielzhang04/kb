from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import tarfile
import time
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Iterator, Protocol

from release_signing_public import RELEASE_PUBLIC_KEY

try:
    import fcntl as _fcntl
except ImportError:  # pragma: no cover - exercised by the Windows test seam
    _fcntl = None


@dataclass(frozen=True)
class RuntimePaths:
    releases: Path = Path("/opt/kb-releases")
    current: Path = Path("/opt/kb-releases/current")
    previous: Path = Path("/opt/kb-releases/previous")
    ops_root: Path = Path("/var/lib/kb/ops")
    staging: Path = Path("/var/lib/kb-release-staging")


RELEASES = Path("/opt/kb-releases")
CURRENT = RELEASES / "current"
PREVIOUS = RELEASES / "previous"
ATTESTATION_KEYS = {"archive", "schema", "sha256", "sourceCommit", "workflow"}
SHORT_COMMAND_TIMEOUT = 30
SYSTEMCTL_TIMEOUT = 120


def atomic_link(link: Path, target: Path) -> None:
    pending = link.with_name(link.name + ".new")
    pending.unlink(missing_ok=True)
    pending.symlink_to(target.name, target_is_directory=True)
    pending.replace(link)


def require_root_staging(value: os.stat_result) -> None:
    if value.st_uid != 0 or value.st_gid != 0 or not stat.S_ISDIR(value.st_mode) or stat.S_IMODE(value.st_mode) != 0o700:
        raise RuntimeError("release staging must be root:root 0700")


def nofollow_flag(platform: str | None = None) -> int:
    platform = os.name if platform is None else platform
    value = getattr(os, "O_NOFOLLOW", None)
    if platform == "posix" and value is None:
        raise RuntimeError("Linux activation requires O_NOFOLLOW")
    return 0 if value is None else value


@contextmanager
def release_lock(releases: Path) -> Iterator[None]:
    if _fcntl is None:
        if os.name == "posix":
            raise RuntimeError("Linux activation requires flock")
        yield
        return
    flags = os.O_RDONLY | nofollow_flag() | getattr(os, "O_DIRECTORY", 0)
    descriptor = os.open(releases, flags)
    try:
        _fcntl.flock(descriptor, _fcntl.LOCK_EX)
        yield
    finally:
        _fcntl.flock(descriptor, _fcntl.LOCK_UN)
        os.close(descriptor)


def parse_attestation(raw: bytes) -> dict[str, str]:
    value = json.loads(raw)
    if type(value) is not dict or set(value) != ATTESTATION_KEYS or any(type(value[key]) is not str for key in ATTESTATION_KEYS):
        raise RuntimeError("closed canonical attestation required")
    canonical = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if raw != canonical or value["schema"] != "kb.release-attestation/v1" or value["workflow"] != "kb-platform-release":
        raise RuntimeError("closed canonical attestation required")
    commit = value["sourceCommit"]
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None or value["archive"] != f"kb-platform-{commit}.tar.gz" or re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is None:
        raise RuntimeError("attestation identity mismatch")
    return value


def safe_members(archive: tarfile.TarFile) -> Iterator[tarfile.TarInfo]:
    seen: set[str] = set()
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        unsafe_path = (
            not member.name
            or "\\" in member.name
            or path.is_absolute()
            or path.as_posix() != member.name
            or any(part in ("", ".", "..") for part in path.parts)
        )
        if unsafe_path or member.name in seen or not (member.isfile() or member.isdir()):
            raise ValueError(f"unsafe archive member: {member.name}")
        seen.add(member.name)
        yield member


def _manifest_entries(raw: bytes) -> dict[str, str]:
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as error:
        raise RuntimeError("release manifest is invalid") from error
    entries: dict[str, str] = {}
    for line in text.splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if match is None:
            raise RuntimeError("release manifest is invalid")
        name = match.group(2)
        path = PurePosixPath(name)
        if path.is_absolute() or "\\" in name or path.as_posix() != name or any(part in ("", ".", "..") for part in path.parts) or name in entries or name in {"VERSION", "MANIFEST.sha256"}:
            raise RuntimeError("release manifest is invalid")
        entries[name] = match.group(1)
    return entries


def _member_bytes(archive: tarfile.TarFile, member: tarfile.TarInfo) -> bytes:
    extracted = archive.extractfile(member)
    if extracted is None:
        raise RuntimeError(f"release member is unreadable: {member.name}")
    return extracted.read()


def extract_read_only(archive_path: Path, destination: Path) -> None:
    nofollow = nofollow_flag()
    archive_fd = os.open(archive_path, os.O_RDONLY | nofollow | getattr(os, "O_BINARY", 0))
    try:
        archive_stat = os.fstat(archive_fd)
        if not stat.S_ISREG(archive_stat.st_mode) or archive_stat.st_nlink != 1:
            raise RuntimeError("release archive must be one regular file")
        with os.fdopen(os.dup(archive_fd), "rb") as archive_file, tarfile.open(fileobj=archive_file, mode="r:gz") as archive:
            members = list(safe_members(archive))
            by_name = {member.name: member for member in members}
            if "VERSION" not in by_name or "MANIFEST.sha256" not in by_name:
                raise RuntimeError("release manifest metadata is incomplete")
            if not by_name["VERSION"].isfile() or not by_name["MANIFEST.sha256"].isfile():
                raise RuntimeError("release manifest metadata is invalid")
            manifest = _manifest_entries(_member_bytes(archive, by_name["MANIFEST.sha256"]))
            payload_names = {member.name for member in members if member.isfile()} - {"VERSION", "MANIFEST.sha256"}
            if payload_names != set(manifest):
                raise RuntimeError("release manifest does not cover every and only payload file")

            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.mkdir(mode=0o700)
            try:
                for member in members:
                    target = destination.joinpath(*PurePosixPath(member.name).parts)
                    if member.isdir():
                        target.mkdir(parents=True, exist_ok=True, mode=0o700)
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    data = _member_bytes(archive, member)
                    if member.name in manifest and not hmac.compare_digest(hashlib.sha256(data).hexdigest(), manifest[member.name]):
                        raise RuntimeError(f"release manifest digest mismatch: {member.name}")
                    with target.open("xb") as output:
                        output.write(data)
                    target.chmod(0o444)
                directories = [path for path in destination.rglob("*") if path.is_dir()]
                for directory in sorted(directories, key=lambda path: len(path.parts), reverse=True):
                    directory.chmod(0o555)
                destination.chmod(0o555)
            except BaseException:
                for path in destination.rglob("*"):
                    if path.exists():
                        path.chmod(0o700 if path.is_dir() else 0o600)
                shutil.rmtree(destination)
                raise
    finally:
        os.close(archive_fd)


def secure_copy(source: Path, destination: Path) -> None:
    nofollow = nofollow_flag()
    binary = getattr(os, "O_BINARY", 0)
    source_fd = os.open(source, os.O_RDONLY | nofollow | binary)
    try:
        source_stat = os.fstat(source_fd)
        if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_nlink != 1:
            raise RuntimeError("upload must be one regular file")
        destination_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | nofollow | binary, 0o400)
        try:
            while chunk := os.read(source_fd, 1024 * 1024):
                view = memoryview(chunk)
                while view:
                    written = os.write(destination_fd, view)
                    view = view[written:]
            os.fsync(destination_fd)
        finally:
            os.close(destination_fd)
    finally:
        os.close(source_fd)


def verify_signature(attestation: Path, signature: Path, run=subprocess.run) -> None:
    allowed = attestation.parent / "allowed_signers"
    try:
        with allowed.open("x", encoding="ascii", newline="") as output:
            output.write(f"kb-release {RELEASE_PUBLIC_KEY}\n")
        allowed.chmod(0o400)
        result = run(
            ["ssh-keygen", "-Y", "verify", "-f", str(allowed), "-I", "kb-release", "-n", "kb-release", "-s", str(signature)],
            input=attestation.read_bytes(),
            capture_output=True,
            timeout=SHORT_COMMAND_TIMEOUT,
        )
    finally:
        if allowed.exists():
            allowed.chmod(0o600)
        allowed.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError("release signature verification failed")


class ActivationIo(Protocol):
    def secure_copy(self, source: Path, destination: Path) -> None: ...
    def verify_signature(self, attestation: Path, signature: Path) -> None: ...
    def run(self, argv: list[str], **kwargs) -> subprocess.CompletedProcess: ...
    def wait_healthy(self) -> None: ...


def production_activation_io() -> ActivationIo:
    return SimpleNamespace(secure_copy=secure_copy, verify_signature=verify_signature, run=subprocess.run, wait_healthy=wait_healthy)


def copy_and_verify_upload(upload_dir: Path, stage: Path, io: ActivationIo | None = None) -> None:
    io = io or production_activation_io()
    for name in ("release.tar.gz", "attestation.json", "attestation.json.sig"):
        io.secure_copy(upload_dir / name, stage / name)
    io.verify_signature(stage / "attestation.json", stage / "attestation.json.sig")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def read_readiness() -> dict:
    with urllib.request.urlopen("http://127.0.0.1:4317/readyz", timeout=5) as response:
        value = json.loads(response.read())
    if type(value) is not dict or set(value) != {"ok", "quiescent", "blockers"} or type(value["ok"]) is not bool or type(value["quiescent"]) is not bool or type(value["blockers"]) is not list or any(type(item) is not str for item in value["blockers"]):
        raise RuntimeError("invalid dashboard readiness response")
    return value


def wait_healthy(timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            readiness = read_readiness()
            if readiness["ok"]:
                return
        except BaseException as error:
            last_error = error
        time.sleep(1)
    raise RuntimeError("dashboard did not become healthy after restart") from last_error


def remove_release_tree(destination: Path) -> None:
    if not destination.exists():
        return
    for path in sorted(destination.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        if path.exists():
            path.chmod(0o700 if path.is_dir() else 0o600)
    destination.chmod(0o700)
    shutil.rmtree(destination)


def _points_to(link: Path, target: Path) -> bool:
    try:
        return link.resolve(strict=True) == target.resolve(strict=True)
    except (FileNotFoundError, OSError):
        return False


def activate_from_upload(upload_dir: Path, paths: RuntimePaths = RuntimePaths(), io: ActivationIo | None = None) -> str:
    io = io or production_activation_io()
    if os.geteuid() != 0:
        raise RuntimeError("activation requires root")
    with release_lock(paths.releases):
        stage = paths.staging / secrets.token_hex(16)
        stage.mkdir(mode=0o700)
        destination: Path | None = None
        destination_created = False
        activated = False
        try:
            require_root_staging(stage.stat())
            copy_and_verify_upload(upload_dir, stage, io)
            attestation = parse_attestation((stage / "attestation.json").read_bytes())
            archive = stage / "release.tar.gz"
            actual = sha256_file(archive)
            if not hmac.compare_digest(attestation["sha256"], actual):
                raise RuntimeError("release digest mismatch")
            if paths.current.exists():
                require_quiescence(read_readiness(), "release activation")
            elif io.run(["systemctl", "is-active", "--quiet", "kb-dashboard.service"], timeout=SHORT_COMMAND_TIMEOUT).returncode == 0:
                raise RuntimeError("initial activation requires the old live-checkout service to be stopped")
            version = attestation["sourceCommit"]
            destination = paths.releases / version
            extract_read_only(archive, destination)
            destination_created = True
            if (destination / "VERSION").read_text(encoding="ascii").strip() != version:
                raise RuntimeError("release VERSION mismatch")
            validator = ["python3", "-I", "-B", "/usr/local/lib/kb/validate_vm_runtime.py"]
            io.run([*validator, "--phase", "static", "--ops-root", str(paths.ops_root), "--unit", "kb-dashboard.service"], check=True, timeout=SHORT_COMMAND_TIMEOUT)
            old = paths.current.resolve() if paths.current.exists() else None
            if old is not None:
                atomic_link(paths.previous, old)
            atomic_link(paths.current, destination)
            try:
                io.run(["systemctl", "restart", "kb-dashboard.service"], check=True, timeout=SYSTEMCTL_TIMEOUT)
                io.wait_healthy()
                io.run([*validator, "--phase", "live", "--ops-root", str(paths.ops_root), "--unit", "kb-dashboard.service"], check=True, timeout=SHORT_COMMAND_TIMEOUT)
            except BaseException:
                if old is None:
                    paths.current.unlink(missing_ok=True)
                    io.run(["systemctl", "stop", "kb-dashboard.service"], check=False, timeout=SYSTEMCTL_TIMEOUT)
                else:
                    atomic_link(paths.current, old)
                    io.run(["systemctl", "restart", "kb-dashboard.service"], check=True, timeout=SYSTEMCTL_TIMEOUT)
                    io.wait_healthy()
                raise
            activated = True
            return version
        finally:
            if not activated and destination_created and destination is not None and not _points_to(paths.current, destination):
                remove_release_tree(destination)
            shutil.rmtree(stage, ignore_errors=True)


def rollback(paths: RuntimePaths = RuntimePaths()) -> str:
    with release_lock(paths.releases):
        readiness = read_readiness()
        require_quiescence(readiness, "rollback")
        current = paths.current.resolve(strict=True)
        target = paths.previous.resolve(strict=True)
        if target == current:
            raise RuntimeError("rollback target is already selected")
        atomic_link(paths.previous, current)
        atomic_link(paths.current, target)
        subprocess.run(["systemctl", "restart", "kb-dashboard.service"], check=True, timeout=SYSTEMCTL_TIMEOUT)
        wait_healthy()
        return target.name


def require_quiescence(readiness: dict, operation: str) -> None:
    if not readiness.get("quiescent"):
        raise RuntimeError(operation + " is not quiescent: " + ",".join(readiness.get("blockers", [])))


def main() -> int:
    parser = argparse.ArgumentParser(description="Activate or roll back a kb platform release")
    parser.add_argument("action", choices=("activate", "rollback"))
    parser.add_argument("--upload-dir", type=Path)
    args = parser.parse_args()
    if args.action == "activate":
        if args.upload_dir is None:
            parser.error("activate requires --upload-dir")
        print(f"activated {activate_from_upload(args.upload_dir)}")
    else:
        if args.upload_dir is not None:
            parser.error("rollback does not accept --upload-dir")
        print(f"rolled back to {rollback()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
