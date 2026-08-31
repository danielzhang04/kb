"""Bounded, root-only installer for the kb PTY broker on an already-bootstrapped VM.

Newly provisioned machines get the broker from ``deploy/bootstrap_vm.py``. This script exists for the
machines that were bootstrapped before the broker existed, and it is deliberately the smallest thing
that can put the broker on such a host:

* it refuses to run as anything but root, and refuses any argument other than ``--digest``;
* it performs NO network, git, re-clone, or control-plane/state action of any kind;
* every child process it runs comes from a fixed allow-list of ``install``/account/systemd probes with
  a 30-second command deadline and a 120-second service-readiness deadline;
* the only things it may mutate are the ``kb-shell`` account, ``/var/lib/kb-shell``,
  ``/opt/kb-shell-broker``, and the two broker units - every mutating path is checked against that set
  before the mutation happens.

Its input is the manifest-covered
``/opt/kb-releases/current/dashboard/dist-server/kb-shell-broker.tar.gz`` plus the 64-hex digest that
the release manifest records for it. Verified contents install root-owned read-only at
``/opt/kb-shell-broker/releases/<digest>/`` behind ``current``/``previous`` symlinks. Re-running with
the digest already selected is an idempotent verify-and-restart. Any extraction, unit, reload,
restart, or readiness failure restores ``previous``, reloads, restarts the old unit, and removes only
the failed candidate.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

BROKER_PROTOCOL = "kb-shell-broker/v1"
ARCHIVE_RELATIVE = "dashboard/dist-server/kb-shell-broker.tar.gz"
MANIFEST_RELATIVE = "MANIFEST.sha256"
UNIT_NAMES = ("kb-shell-broker.socket", "kb-shell-broker.service")
SERVICE_UNIT = "kb-shell-broker.service"
SOCKET_UNIT = "kb-shell-broker.socket"
SHELL_ACCOUNT = "kb-shell"
DASHBOARD_ACCOUNT = "kb-dashboard"
# Worktrees are created by the dashboard (kb-dashboard) and executed in by the broker's children
# (kb-shell): owner kb-dashboard, group kb-shell, setgid so every subdirectory the dashboard creates
# stays group-readable to the broker. kb-dashboard.service carries the matching
# SupplementaryGroups=kb-shell. Anything narrower makes the whole execution vertical dead on the VM.
WORKTREES_MODE = "02770"
NODE_BINARY = "/usr/bin/node"
DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COMMAND_TIMEOUT = 30
SERVICE_TIMEOUT = 120
READY_POLL_SECONDS = 1
# Extraction ceilings. The archive is root-authored and manifest-covered, so these are not the
# primary defence - they are the bound that keeps a corrupt or hostile payload from filling the VM's
# disk before any of the content checks below can run.
MAX_ARCHIVE_MEMBERS = 2_000
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
# `groupadd` exit 9 is "group already exists" - the only non-zero code a partially provisioned host
# may legitimately produce, and the one case where continuing to `useradd --gid kb-shell` is correct.
GROUPADD_EXISTS = 9
# Closed set, absolute. Anything else - git, curl, wget, ssh, apt, pip, tar(1), a shell - is a bug,
# not a capability: this installer must not be able to reach the network or rewrite the ops checkout.
# The paths are absolute so root's inherited PATH cannot decide which binary "install" means.
INSTALL_BIN = "/usr/bin/install"
USERADD_BIN = "/usr/sbin/useradd"
GROUPADD_BIN = "/usr/sbin/groupadd"
ID_BIN = "/usr/bin/id"
CHOWN_BIN = "/usr/bin/chown"
CHMOD_BIN = "/usr/bin/chmod"
SYSTEMCTL_BIN = "/usr/bin/systemctl"
ALLOWED_PROGRAMS = frozenset({INSTALL_BIN, USERADD_BIN, GROUPADD_BIN, ID_BIN, CHOWN_BIN, CHMOD_BIN,
                              SYSTEMCTL_BIN, NODE_BINARY})


class InstallError(RuntimeError):
    """A refusal or failure that must leave the previous broker selection in place."""


@dataclass(frozen=True)
class Layout:
    release_root: Path = Path("/opt/kb-releases/current")
    broker_root: Path = Path("/opt/kb-shell-broker")
    shell_root: Path = Path("/var/lib/kb-shell")
    unit_root: Path = Path("/etc/systemd/system")

    @property
    def archive(self) -> Path:
        return self.release_root / ARCHIVE_RELATIVE

    @property
    def manifest(self) -> Path:
        return self.release_root / MANIFEST_RELATIVE

    @property
    def releases(self) -> Path:
        return self.broker_root / "releases"

    @property
    def current(self) -> Path:
        return self.broker_root / "current"

    @property
    def previous(self) -> Path:
        return self.broker_root / "previous"

    def unit(self, name: str) -> Path:
        if name not in UNIT_NAMES:
            raise InstallError(f"unit is outside the broker unit set: {name}")
        return self.unit_root / name

    def mutable_roots(self) -> tuple[Path, ...]:
        return (self.broker_root, self.shell_root)

    def assert_mutable(self, path: Path) -> Path:
        """The mutation ceiling, enforced before every write, chown, link, and unlink.

        Realpath, not lexical: a symlinked ``/opt/kb-shell-broker`` or ``/var/lib/kb-shell`` (or a
        symlinked ``releases/<digest>``) would otherwise let ``rmtree``/``chown -R`` operate far
        outside the declared set while this check reported success. ``strict=False`` because most of
        these paths are being created by the very call that checks them.
        """
        resolved = Path(path).resolve(strict=False)
        if resolved in {Path(self.unit(name)).resolve(strict=False) for name in UNIT_NAMES}:
            return resolved
        for root in self.mutable_roots():
            root = Path(root).resolve(strict=False)
            if resolved == root or resolved.is_relative_to(root):
                return resolved
        raise InstallError(f"refusing to mutate a path outside the broker install set: {path}")


def _effective_uid() -> int:
    """Root on the VM; a non-root sentinel anywhere `os.geteuid` does not exist (Windows)."""
    getter = getattr(os, "geteuid", None)
    return -1 if getter is None else getter()


def _require_root(geteuid) -> None:
    if geteuid() != 0:
        raise InstallError("the broker installer must run as root")


def _validate_digest(digest: str) -> str:
    if DIGEST_PATTERN.fullmatch(digest) is None:
        raise InstallError("broker archive digest must be 64 lowercase hex characters")
    return digest


def _manifest_digest(manifest: Path) -> str:
    if not manifest.is_file():
        raise InstallError(f"release manifest is absent: {manifest}")
    for line in manifest.read_text(encoding="utf-8").splitlines():
        recorded, separator, name = line.partition("  ")
        if separator and name == ARCHIVE_RELATIVE:
            return _validate_digest(recorded)
    raise InstallError(f"release manifest does not cover {ARCHIVE_RELATIVE}")


def _open_verified_archive(archive: Path, digest: str):
    """Open the archive ONCE, hash from that descriptor, and return it rewound for extraction.

    The bytes that are hashed and the bytes that are extracted must be the same bytes. Hashing a
    path and then re-opening it leaves a window in which `current` (a symlink) or the archive itself
    can be swapped between the two opens - root-vs-root only, but free to close, so it is closed.
    """
    if not archive.is_file():
        raise InstallError(f"broker archive is absent: {archive}")
    handle = archive.open("rb")
    try:
        running = hashlib.sha256()
        for block in iter(lambda: handle.read(1 << 20), b""):
            running.update(block)
        if running.hexdigest() != digest:
            raise InstallError("broker archive content does not match the requested digest")
        handle.seek(0)
    except BaseException:
        handle.close()
        raise
    return handle


def _run(argv: list[str], run, timeout: int = COMMAND_TIMEOUT, check: bool = True):
    if argv[0] not in ALLOWED_PROGRAMS:
        raise InstallError(f"refusing to run a program outside the installer's fixed set: {argv[0]}")
    return run(argv, check=check, text=True, capture_output=True, timeout=timeout)


def _extract_verified(handle, destination: Path) -> None:
    """Extract regular files only, under paths that stay inside the destination.

    Reads from the already-hashed descriptor, never from the path again. Symlinks, hardlinks, device
    nodes, fifos and directories are refused outright rather than filtered, absolute and `..` names
    escape nothing, duplicate names cannot overwrite an already-extracted member, and the member
    count and total unpacked size are bounded before a single byte is written.
    """
    with tarfile.open(fileobj=handle, mode="r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise InstallError(
                f"broker archive declares {len(members)} members, over the {MAX_ARCHIVE_MEMBERS} ceiling")
        total = 0
        seen: set[str] = set()
        for member in members:
            if not member.isfile():
                raise InstallError(f"broker archive member is not a regular file: {member.name}")
            name = Path(member.name)
            if name.is_absolute() or ".." in name.parts or member.name.startswith("/"):
                raise InstallError(f"broker archive member escapes the install root: {member.name}")
            if member.name in seen:
                raise InstallError(f"broker archive repeats a member name: {member.name}")
            seen.add(member.name)
            if member.mode & 0o7000:
                raise InstallError(f"broker archive member sets setuid/setgid/sticky: {member.name}")
            total += member.size
            if total > MAX_ARCHIVE_BYTES:
                raise InstallError(
                    f"broker archive unpacks to more than {MAX_ARCHIVE_BYTES} bytes")
        bundle.extractall(destination, filter="data")


def provision_account_and_directories(layout: Layout, run) -> None:
    """The `kb-shell` account and its filesystem, shared with deploy/bootstrap_vm.py.

    Kept in one place on purpose: a freshly bootstrapped VM and a VM upgraded by this installer must
    end up with byte-identical ownership and modes, or the broker's own runtime policy refuses.
    """
    probe = _run([ID_BIN, "-u", SHELL_ACCOUNT], run, check=False)
    if probe.returncode != 0:
        group = _run([GROUPADD_BIN, "--system", SHELL_ACCOUNT], run, check=False)
        if group.returncode not in (0, GROUPADD_EXISTS):
            raise InstallError(
                f"groupadd {SHELL_ACCOUNT} failed with exit {group.returncode}")
        _run([USERADD_BIN, "--system", "--gid", SHELL_ACCOUNT, "--home-dir",
              str(layout.shell_root / "home"), "--shell", "/usr/sbin/nologin", SHELL_ACCOUNT], run)
    owned = (
        (layout.assert_mutable(layout.shell_root), "root", "root", "0755"),
        (layout.assert_mutable(layout.shell_root / "home"), SHELL_ACCOUNT, SHELL_ACCOUNT, "0700"),
        (layout.assert_mutable(layout.shell_root / "home/.local"), SHELL_ACCOUNT, SHELL_ACCOUNT, "0700"),
        (layout.assert_mutable(layout.shell_root / "home/.local/bin"), SHELL_ACCOUNT, SHELL_ACCOUNT, "0700"),
        # The two provider-CLI state dirs the broker unit carves out of the read-only home. They must
        # exist and be kb-shell-owned before the first launch: a bind-mounted ReadWritePaths entry
        # that does not exist makes systemd refuse to start the unit.
        (layout.assert_mutable(layout.shell_root / "home/.claude"), SHELL_ACCOUNT, SHELL_ACCOUNT, "0700"),
        (layout.assert_mutable(layout.shell_root / "home/.codex"), SHELL_ACCOUNT, SHELL_ACCOUNT, "0700"),
        (layout.assert_mutable(layout.shell_root / "worktrees"), DASHBOARD_ACCOUNT, SHELL_ACCOUNT,
         WORKTREES_MODE),
        (layout.assert_mutable(layout.broker_root), "root", "root", "0755"),
        (layout.assert_mutable(layout.releases), "root", "root", "0755"),
    )
    for path, owner, group, mode in owned:
        _run([INSTALL_BIN, "-d", "-o", owner, "-g", group, "-m", mode, str(path)], run)


def _probe_protocol_version(candidate: Path, run) -> None:
    result = _run([NODE_BINARY, str(candidate / "main.js"), "--print-protocol-version"], run,
                  check=False)
    if result.returncode != 0 or (result.stdout or "").strip() != BROKER_PROTOCOL:
        raise InstallError("broker candidate did not report the exact dashboard protocol version")


def _symlink(target: Path, link: Path) -> None:
    """The one place a selection link is created (a seam the tests replace on Windows)."""
    os.symlink(target, link)


def _readlink(link: Path) -> Path | None:
    try:
        return Path(os.readlink(link))
    except OSError:
        return None


def _read_selection(link: Path) -> Path | None:
    return _readlink(link)


def _point(layout: Layout, link: Path, target: Path) -> None:
    layout.assert_mutable(link)
    staged = link.parent / f".{link.name}.staging"
    layout.assert_mutable(staged)
    if staged.is_symlink() or staged.exists():
        staged.unlink()
    _symlink(target, staged)
    os.replace(staged, link)


def _unpoint(layout: Layout, link: Path) -> None:
    """Remove a selection link, inside the mutation ceiling; absence is not an error."""
    layout.assert_mutable(link)
    link.unlink(missing_ok=True)


def install_units(layout: Layout, run, source_root: Path | None = None) -> None:
    for name in UNIT_NAMES:
        source = (layout.release_root if source_root is None else source_root) / "deploy/systemd" / name
        if not source.is_file():
            raise InstallError(f"release does not carry the broker unit: {name}")
        target = layout.unit(name)
        _run([INSTALL_BIN, "-o", "root", "-g", "root", "-m", "0444", str(source), str(target)], run)


def _wait_active(unit: str, run, monotonic, sleep) -> None:
    deadline = monotonic() + SERVICE_TIMEOUT
    while True:
        result = _run([SYSTEMCTL_BIN, "is-active", unit], run, check=False)
        if (result.stdout or "").strip() == "active":
            return
        if monotonic() >= deadline:
            raise InstallError(f"broker unit did not become active within {SERVICE_TIMEOUT}s: {unit}")
        sleep(READY_POLL_SECONDS)


def _restart(layout: Layout, run, monotonic, sleep) -> None:
    _run([SYSTEMCTL_BIN, "daemon-reload"], run)
    _run([SYSTEMCTL_BIN, "enable", "--now", SOCKET_UNIT], run, timeout=SERVICE_TIMEOUT)
    _run([SYSTEMCTL_BIN, "restart", SERVICE_UNIT], run, timeout=SERVICE_TIMEOUT)
    _wait_active(SERVICE_UNIT, run, monotonic, sleep)


def _rollback(layout: Layout, previous: Path | None, candidate: Path | None, run, monotonic, sleep,
              ) -> None:
    """Restore `previous`, reload, restart the old unit, and remove ONLY the failed candidate."""
    if previous is not None:
        _point(layout, layout.current, previous)
    else:
        # First install: there is nothing to restore, and `current` may already point at the
        # candidate this rollback is about to delete. A dangling `current` with the socket enabled
        # fails every later activation, so the selection is removed rather than left hanging.
        _unpoint(layout, layout.current)
    try:
        _run([SYSTEMCTL_BIN, "daemon-reload"], run, check=False)
        if previous is not None:
            _run([SYSTEMCTL_BIN, "restart", SERVICE_UNIT], run, check=False, timeout=SERVICE_TIMEOUT)
            _wait_active(SERVICE_UNIT, run, monotonic, sleep)
    except (InstallError, subprocess.SubprocessError, OSError):
        pass
    if candidate is not None and candidate.is_dir():
        layout.assert_mutable(candidate)
        shutil.rmtree(candidate, ignore_errors=True)


def install_pty_broker(
    digest: str,
    layout: Layout | None = None,
    run=subprocess.run,
    geteuid=_effective_uid,
    monotonic=time.monotonic,
    sleep=time.sleep,
) -> None:
    layout = Layout() if layout is None else layout
    _require_root(geteuid)
    _validate_digest(digest)
    if _manifest_digest(layout.manifest) != digest:
        raise InstallError("broker archive digest does not match the release manifest")
    # Held open across the whole install: extraction reads from this exact descriptor, so no other
    # writer can substitute the bytes between the digest check and the unpack.
    verified = _open_verified_archive(layout.archive, digest)
    try:
        _install_verified(digest, verified, layout, run, monotonic, sleep)
    finally:
        verified.close()


def _install_verified(digest: str, verified, layout: Layout, run, monotonic, sleep) -> None:
    try:
        provision_account_and_directories(layout, run)
    except (subprocess.SubprocessError, OSError) as error:
        # Nothing has been selected or extracted yet, so there is nothing to roll back - but the
        # caller must still see the installer's own error type, not a raw CalledProcessError.
        raise InstallError(
            f"broker provisioning failed before any selection moved: {error}") from error
    candidate = layout.assert_mutable(layout.releases / digest)
    selected = _read_selection(layout.current)

    if selected is not None and selected == candidate and candidate.is_dir():
        # Idempotent re-install: verify the installed candidate still answers, then restart.
        _probe_protocol_version(candidate, run)
        install_units(layout, run)
        _restart(layout, run, monotonic, sleep)
        return

    extracted = False
    try:
        if not candidate.is_dir():
            staging = Path(tempfile.mkdtemp(prefix=f".{digest}.", dir=str(layout.releases)))
            layout.assert_mutable(staging)
            try:
                _extract_verified(verified, staging)
                _run([CHOWN_BIN, "-R", "root:root", str(staging)], run)
                _run([CHMOD_BIN, "-R", "a=rX", str(staging)], run)
                os.replace(staging, candidate)
            except BaseException:
                shutil.rmtree(staging, ignore_errors=True)
                raise
            extracted = True
        _probe_protocol_version(candidate, run)
        install_units(layout, run)
        if selected is not None:
            _point(layout, layout.previous, selected)
        _point(layout, layout.current, candidate)
        _restart(layout, run, monotonic, sleep)
    except (InstallError, subprocess.SubprocessError, OSError) as error:
        _rollback(layout, selected, candidate if extracted else None, run, monotonic, sleep)
        raise InstallError(f"broker install failed and the previous selection was restored: {error}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Install the kb PTY broker on an already-bootstrapped VM",
        allow_abbrev=False)
    parser.add_argument("--digest", required=True,
                        help="the 64-hex MANIFEST.sha256 digest of the broker archive")
    args = parser.parse_args(argv)
    install_pty_broker(args.digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
