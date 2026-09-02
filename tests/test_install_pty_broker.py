"""Static proofs for the two broker units, plus the bounded installer that puts them on a VM.

No systemd, no real accounts, no network: every child process goes through an injected fake, and the
selection symlinks go through the module's own `_symlink`/`_readlink` seam so the suite runs on
Windows as well as on the VM.
"""

from __future__ import annotations

import hashlib
import io
import os
import subprocess
import tarfile
from pathlib import Path

import pytest

from deploy import bootstrap_vm, install_pty_broker as installer
from deploy.validate_vm_runtime import (
    BROKER_EXEC_START,
    BROKER_SERVICE_DIRECTIVES,
    BROKER_SOCKET_DIRECTIVES,
    parse_unit,
    validate_broker_service,
    validate_broker_socket,
    validate_broker_units,
)

REPO = Path(__file__).resolve().parents[1]
SERVICE_PATH = REPO / "deploy/systemd/kb-shell-broker.service"
SOCKET_PATH = REPO / "deploy/systemd/kb-shell-broker.socket"
SERVICE_TEXT = SERVICE_PATH.read_text(encoding="utf-8")
SOCKET_TEXT = SOCKET_PATH.read_text(encoding="utf-8")
OLD_DIGEST = "0" * 64


# --- static unit proofs -------------------------------------------------------------------------


def test_repo_broker_units_pass_their_own_validators():
    validate_broker_service(SERVICE_TEXT)
    validate_broker_socket(SOCKET_TEXT)


def test_socket_declares_exactly_one_unix_listener_and_the_service_declares_none():
    socket_section = dict(parse_unit(SOCKET_TEXT)["Socket"])
    listeners = [line for line in SOCKET_TEXT.splitlines() if line.startswith("Listen")]
    assert listeners == ["ListenStream=/run/kb-shell/broker.sock"]
    assert socket_section["ListenStream"].startswith("/")
    assert ":" not in socket_section["ListenStream"]
    assert not [line for line in SERVICE_TEXT.splitlines() if line.startswith("Listen")]


def test_service_freezes_the_section_three_sandbox_directive_set():
    service = dict(parse_unit(SERVICE_TEXT)["Service"])
    assert service == BROKER_SERVICE_DIRECTIVES
    assert service["ExecStart"] == BROKER_EXEC_START
    assert service["ProtectSystem"] == "strict"
    assert service["ReadOnlyPaths"] == "/var/lib/kb/ops /var/lib/kb-shell/home"
    assert service["ReadWritePaths"] == "/var/lib/kb-shell/worktrees /run/kb-shell /var/lib/kb-shell/home/.claude /var/lib/kb-shell/home/.codex"
    assert service["InaccessiblePaths"] == "/var/lib/kb/state /opt/kb-releases -/var/lib/kb-activation"
    assert service["CapabilityBoundingSet"] == ""
    assert service["AmbientCapabilities"] == ""
    assert service["NoNewPrivileges"] == "yes"
    assert service["RestrictSUIDSGID"] == "yes"
    assert service["KillMode"] == "control-group"


def test_service_omits_restrict_address_families_protect_proc_and_proc_subset():
    """Provider-network-compatible children, and a /proc the fd-pinned launcher can exec through."""
    present = {key for pairs in parse_unit(SERVICE_TEXT).values() for key, _ in pairs}
    assert not present.intersection(
        {"RestrictAddressFamilies", "ProtectProc", "ProcSubset", "PrivateNetwork", "IPAddressDeny"})


def test_runtime_directory_is_kb_shell_kb_dashboard_0750_and_the_service_never_sets_0700():
    socket_pairs = parse_unit(SOCKET_TEXT)["Socket"]
    exec_start_pre = [value for key, value in socket_pairs if key == "ExecStartPre"]
    socket_section = dict((key, value) for key, value in socket_pairs if key != "ExecStartPre")
    assert socket_section["DirectoryMode"] == "0750"
    assert socket_section["RuntimeDirectory"] == "kb-shell"
    assert socket_section["RuntimeDirectoryMode"] == "0750"
    assert (socket_section["User"], socket_section["Group"]) == ("kb-shell", "kb-dashboard")
    assert socket_section["SocketMode"] == "0600"
    # RuntimeDirectory=/User=/Group= on a .socket unit do NOT chown the runtime directory (proven on
    # the VM: they left /run/kb-shell root:root); this privileged ExecStartPre pair is what actually
    # makes it kb-shell:kb-dashboard, and both must be present in this order.
    assert exec_start_pre == [
        "+/usr/bin/chown kb-shell:kb-dashboard /run/kb-shell",
        "+/usr/bin/chmod 0750 /run/kb-shell",
    ]
    service = dict(parse_unit(SERVICE_TEXT)["Service"])
    assert "RuntimeDirectoryMode" not in service
    assert "RuntimeDirectory" not in service
    assert "RuntimeDirectoryMode=0700" not in SERVICE_TEXT
    assert "ExecStartPre" not in service


@pytest.mark.parametrize("injected", [
    "ExecStartPre=/usr/bin/sudo /bin/true",
    "ExecStartPre=+/bin/chgrp kb-dashboard /run/kb-shell",
    "RestrictAddressFamilies=AF_UNIX",
    "ProtectProc=invisible",
    "ProcSubset=pid",
    "RuntimeDirectoryMode=0700",
    "ListenStream=127.0.0.1:9000",
])
def test_service_refuses_added_privilege_listener_or_forbidden_directives(injected):
    with pytest.raises(RuntimeError):
        validate_broker_service(SERVICE_TEXT.replace("RestrictSUIDSGID=yes",
                                                     f"RestrictSUIDSGID=yes\n{injected}"))


@pytest.mark.parametrize("removed", sorted(BROKER_SERVICE_DIRECTIVES))
def test_service_refuses_any_removed_directive(removed):
    value = BROKER_SERVICE_DIRECTIVES[removed]
    with pytest.raises(RuntimeError, match="directive set drifted"):
        validate_broker_service(SERVICE_TEXT.replace(f"{removed}={value}\n", ""))


@pytest.mark.parametrize("injected", [
    "ListenDatagram=/run/kb-shell/other.sock",
    "ListenStream=/run/kb-shell/second.sock",
    "ListenStream=[::1]:9000",
])
def test_socket_refuses_a_second_or_non_unix_listener(injected):
    with pytest.raises(RuntimeError):
        validate_broker_socket(SOCKET_TEXT.replace("RemoveOnStop=yes",
                                                   f"RemoveOnStop=yes\n{injected}"))


def test_socket_refuses_a_drifted_socket_owner():
    with pytest.raises(RuntimeError, match="directive set drifted"):
        validate_broker_socket(SOCKET_TEXT.replace("SocketMode=0600", "SocketMode=0666"))


def test_installed_units_may_be_absent_but_never_installed_alone(tmp_path):
    assert validate_broker_units(tmp_path) is False
    (tmp_path / "kb-shell-broker.service").write_text(SERVICE_TEXT, encoding="utf-8")
    with pytest.raises(RuntimeError, match="pair"):
        validate_broker_units(tmp_path)
    (tmp_path / "kb-shell-broker.socket").write_text(SOCKET_TEXT, encoding="utf-8")
    assert validate_broker_units(tmp_path) is True


# --- installer fixtures -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def portable_selection_links(monkeypatch):
    """Selection links as plain files: Windows refuses os.symlink without a privilege."""
    def fake_symlink(target: Path, link: Path) -> None:
        Path(link).write_text(str(target), encoding="utf-8")

    def fake_readlink(link: Path) -> Path | None:
        path = Path(link)
        if not path.is_file():
            return None
        return Path(path.read_text(encoding="utf-8"))

    monkeypatch.setattr(installer, "_symlink", fake_symlink)
    monkeypatch.setattr(installer, "_readlink", fake_readlink)


class Recorder:
    """A fake subprocess.run: records argv + timeout, answers the installer's fixed probes."""

    def __init__(self, protocol: str = installer.BROKER_PROTOCOL, active: bool = True,
                 account_exists: bool = False,
                 failures: dict[tuple[str, ...], int] | None = None):
        self.calls: list[tuple[tuple[str, ...], int | None]] = []
        self.protocol = protocol
        self.active = active
        self.account_exists = account_exists
        # argv prefix -> exit code, so every `check=True` call in the installer can be made to fail.
        self.failures = dict(failures or {})

    def programs(self) -> list[str]:
        return [argv[0] for argv, _ in self.calls]

    def argv_list(self) -> list[tuple[str, ...]]:
        return [argv for argv, _ in self.calls]

    def __call__(self, argv, check=False, text=True, capture_output=True, timeout=None):
        self.calls.append((tuple(argv), timeout))
        code, stdout = 0, ""
        if argv[0] == installer.ID_BIN:
            code = 0 if self.account_exists else 1
        elif argv[-1] == "--print-protocol-version":
            stdout = f"{self.protocol}\n"
        elif tuple(argv[:2]) == (installer.SYSTEMCTL_BIN, "is-active"):
            stdout = "active\n" if self.active else "activating\n"
        for prefix, failure in self.failures.items():
            if tuple(argv[:len(prefix)]) == prefix:
                code, stdout = failure, ""
                break
        if code != 0 and check:
            raise subprocess.CalledProcessError(code, argv)
        return subprocess.CompletedProcess(argv, code, stdout, "")


def build_archive(path: Path, entry: bytes = b"//entry\n") -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    members = (
        ("main.js", entry),
        ("package.json", b'{"name":"kb-shell-broker","private":true,"type":"module"}\n'),
        ("server/pty/linuxBrokerMain.js", b"//broker\n"),
        ("node_modules/node-pty/build/Release/pty.node", b"\x7fELF fake native module"),
    )
    with tarfile.open(path, "w:gz") as bundle:
        for name, data in members:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o444
            bundle.addfile(info, io.BytesIO(data))
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def layout(tmp_path) -> installer.Layout:
    value = installer.Layout(
        release_root=tmp_path / "release",
        broker_root=tmp_path / "broker",
        shell_root=tmp_path / "shell",
        unit_root=tmp_path / "units",
    )
    value.releases.mkdir(parents=True)
    value.unit_root.mkdir(parents=True)
    units = value.release_root / "deploy/systemd"
    units.mkdir(parents=True)
    (units / "kb-shell-broker.service").write_text(SERVICE_TEXT, encoding="utf-8")
    (units / "kb-shell-broker.socket").write_text(SOCKET_TEXT, encoding="utf-8")
    digest = build_archive(value.archive)
    value.manifest.write_text(
        f"{'a' * 64}  dashboard/server/index.ts\n{digest}  {installer.ARCHIVE_RELATIVE}\n",
        encoding="utf-8")
    return value


def digest_of(layout: installer.Layout) -> str:
    return hashlib.sha256(layout.archive.read_bytes()).hexdigest()


def seed_previous(layout: installer.Layout) -> Path:
    previous = layout.releases / OLD_DIGEST
    previous.mkdir()
    (previous / "main.js").write_text("//old\n", encoding="utf-8")
    installer._point(layout, layout.current, previous)
    return previous


def install(layout: installer.Layout, recorder: Recorder, digest: str | None = None,
            clock: list[float] | None = None):
    ticks = iter(clock) if clock is not None else None
    return installer.install_pty_broker(
        digest_of(layout) if digest is None else digest,
        layout=layout,
        run=recorder,
        geteuid=lambda: 0,
        monotonic=(lambda: next(ticks)) if ticks is not None else (lambda: 0.0),
        sleep=lambda _seconds: None,
    )


# --- installer proofs ---------------------------------------------------------------------------


def test_installer_refuses_a_non_root_caller_before_touching_anything(layout):
    recorder = Recorder()
    with pytest.raises(installer.InstallError, match="must run as root"):
        installer.install_pty_broker(digest_of(layout), layout=layout, run=recorder,
                                     geteuid=lambda: 1000)
    assert recorder.calls == []
    assert list(layout.releases.iterdir()) == []


def test_installer_refuses_an_unknown_or_positional_argument():
    for argv in (["--digest", "b" * 64, "--force"], ["--digest", "b" * 64, "extra"], []):
        with pytest.raises(SystemExit) as raised:
            installer.main(argv)
        assert raised.value.code == 2


@pytest.mark.parametrize("digest", ["", "z" * 64, "A" * 64, "a" * 63, "a" * 65])
def test_installer_refuses_a_digest_that_is_not_64_lowercase_hex(layout, digest):
    with pytest.raises(installer.InstallError, match="64 lowercase hex"):
        install(layout, Recorder(), digest=digest)


def test_installer_refuses_a_digest_the_release_manifest_does_not_record(layout):
    with pytest.raises(installer.InstallError, match="release manifest"):
        install(layout, Recorder(), digest="b" * 64)


def test_installer_refuses_an_archive_whose_bytes_do_not_match_the_manifest(layout):
    recorded = digest_of(layout)
    layout.archive.write_bytes(layout.archive.read_bytes() + b"tamper")
    with pytest.raises(installer.InstallError, match="does not match the requested digest"):
        install(layout, Recorder(), digest=recorded)


def test_installer_runs_only_fixed_probes_with_30s_command_and_120s_service_deadlines(layout):
    recorder = Recorder()
    install(layout, recorder)
    assert set(recorder.programs()).issubset(installer.ALLOWED_PROGRAMS)
    assert not set(recorder.programs()).intersection({"git", "curl", "wget", "ssh", "apt", "tar"})
    for argv, timeout in recorder.calls:
        expected = installer.SERVICE_TIMEOUT if argv[:2] in {(installer.SYSTEMCTL_BIN, "enable"),
                                                             (installer.SYSTEMCTL_BIN, "restart")} else installer.COMMAND_TIMEOUT
        assert timeout == expected, argv
    assert installer.COMMAND_TIMEOUT == 30
    assert installer.SERVICE_TIMEOUT == 120


def test_installer_mutation_ceiling_refuses_every_path_outside_the_named_set(layout):
    for outside in ("/etc/passwd", "/var/lib/kb/ops", "/var/lib/kb/state/control/control-plane.json",
                    "/opt/kb-releases/current", "/etc/systemd/system/kb-dashboard.service"):
        with pytest.raises(installer.InstallError, match="outside the broker install set"):
            layout.assert_mutable(Path(outside))
    for inside in (layout.broker_root / "releases/x", layout.shell_root / "home",
                   layout.unit_root / "kb-shell-broker.service"):
        assert layout.assert_mutable(inside) == Path(inside)


def test_installer_never_runs_a_program_outside_its_closed_set(layout):
    with pytest.raises(installer.InstallError, match="outside the installer's fixed set"):
        installer._run(["git", "pull"], Recorder())


def test_install_lands_root_owned_read_only_under_the_digest_with_current_and_previous(layout):
    previous = seed_previous(layout)
    recorder = Recorder()
    install(layout, recorder)
    digest = digest_of(layout)
    candidate = layout.releases / digest
    assert (candidate / "main.js").is_file()
    assert (candidate / "node_modules/node-pty/build/Release/pty.node").is_file()
    assert installer._read_selection(layout.current) == candidate
    assert installer._read_selection(layout.previous) == previous
    assert previous.is_dir()
    # Ownership and read-only modes are applied to the staging tree, before the atomic rename that
    # publishes it as releases/<digest>: a half-owned candidate is never reachable under its digest.
    staged = [argv for argv in recorder.argv_list() if argv[0] in {installer.CHOWN_BIN, installer.CHMOD_BIN}]
    assert [argv[:3] for argv in staged] == [(installer.CHOWN_BIN, "-R", "root:root"), (installer.CHMOD_BIN, "-R", "a=rX")]
    assert all(Path(argv[-1]).parent == layout.releases and Path(argv[-1]) != candidate
               for argv in staged)
    assert (installer.NODE_BINARY, str(candidate / "main.js"),
            "--print-protocol-version") in recorder.argv_list()
    assert (installer.SYSTEMCTL_BIN, "daemon-reload") in recorder.argv_list()
    assert (installer.SYSTEMCTL_BIN, "restart", installer.SERVICE_UNIT) in recorder.argv_list()
    for name in installer.UNIT_NAMES:
        assert (layout.unit_root / name).exists() is False  # `install` is faked; argv is the proof
        assert any(argv[0] == installer.INSTALL_BIN and argv[-1] == str(layout.unit_root / name)
                   for argv in recorder.argv_list())


def test_same_digest_reinstall_is_an_idempotent_verify_and_restart(layout):
    install(layout, Recorder())
    digest = digest_of(layout)
    candidate = layout.releases / digest
    (candidate / "marker").write_text("kept\n", encoding="utf-8")
    second = Recorder()
    install(layout, second)
    assert (candidate / "marker").read_text(encoding="utf-8") == "kept\n"
    assert not any(argv[0] == installer.CHOWN_BIN for argv in second.argv_list())
    assert (installer.NODE_BINARY, str(candidate / "main.js"),
            "--print-protocol-version") in second.argv_list()
    assert (installer.SYSTEMCTL_BIN, "restart", installer.SERVICE_UNIT) in second.argv_list()
    assert installer._read_selection(layout.current) == candidate
    assert sorted(path.name for path in layout.releases.iterdir()) == [digest]


def test_a_wrong_protocol_version_restores_previous_and_removes_only_the_candidate(layout):
    previous = seed_previous(layout)
    recorder = Recorder(protocol="kb-shell-broker/v2")
    with pytest.raises(installer.InstallError, match="previous selection was restored"):
        install(layout, recorder)
    assert installer._read_selection(layout.current) == previous
    assert previous.is_dir()
    assert not (layout.releases / digest_of(layout)).exists()
    assert recorder.argv_list().count((installer.SYSTEMCTL_BIN, "daemon-reload")) >= 1
    assert (installer.SYSTEMCTL_BIN, "restart", installer.SERVICE_UNIT) in recorder.argv_list()


def test_a_service_that_never_reports_active_rolls_back_at_the_120_second_deadline(layout):
    previous = seed_previous(layout)
    recorder = Recorder(active=False)
    clock = [0.0, 0.0, 60.0, 120.0, 0.0, 0.0, 200.0]
    with pytest.raises(installer.InstallError, match="previous selection was restored"):
        install(layout, recorder, clock=clock)
    assert installer._read_selection(layout.current) == previous
    assert not (layout.releases / digest_of(layout)).exists()
    assert previous.is_dir()


def test_a_release_without_the_broker_units_refuses_before_selection_moves(layout):
    previous = seed_previous(layout)
    (layout.release_root / "deploy/systemd/kb-shell-broker.socket").unlink()
    with pytest.raises(installer.InstallError, match="previous selection was restored"):
        install(layout, Recorder())
    assert installer._read_selection(layout.current) == previous


def test_installer_provisions_the_named_account_home_and_worktrees_only(layout):
    recorder = Recorder()
    install(layout, recorder)
    directories = [argv for argv in recorder.argv_list() if argv[0] == installer.INSTALL_BIN and "-d" in argv]
    assert [argv[-1] for argv in directories] == [
        str(layout.shell_root), str(layout.shell_root / "home"),
        str(layout.shell_root / "home/.local"), str(layout.shell_root / "home/.local/bin"),
        str(layout.shell_root / "home/.claude"), str(layout.shell_root / "home/.codex"),
        str(layout.shell_root / "worktrees"), str(layout.broker_root), str(layout.releases),
    ]
    assert ("-m", "0700") == tuple(directories[1][-3:-1])
    # [C-S4]: the dashboard creates worktrees, the broker executes in them.
    assert tuple(directories[6][-7:-1]) == ("-o", installer.DASHBOARD_ACCOUNT, "-g",
                                            installer.SHELL_ACCOUNT, "-m", installer.WORKTREES_MODE)
    assert installer.WORKTREES_MODE == "02770"
    account = [argv for argv in recorder.argv_list() if argv[0] in {installer.USERADD_BIN, installer.GROUPADD_BIN}]
    assert all(argv[-1] == installer.SHELL_ACCOUNT for argv in account)
    assert "--shell" in account[-1] and "/usr/sbin/nologin" in account[-1]


def test_installer_creates_the_provider_cli_state_dirs_the_unit_carves_out_of_the_read_only_home(layout):
    """A ReadWritePaths entry that does not exist makes systemd refuse to start the unit, and both
    provider CLIs write their durable state (~/.claude, ~/.codex) on every run."""
    recorder = Recorder()
    install(layout, recorder)
    directories = [argv for argv in recorder.argv_list()
                   if argv[0] == installer.INSTALL_BIN and "-d" in argv]
    by_path = {argv[-1]: argv for argv in directories}
    service = (REPO / "deploy/systemd/kb-shell-broker.service").read_text(encoding="utf-8")
    carved = [line for line in service.splitlines() if line.startswith("ReadWritePaths=")][0]
    for name in (".claude", ".codex"):
        path = layout.shell_root / "home" / name
        assert str(path) in by_path, f"installer never creates {path}"
        assert tuple(by_path[str(path)][-7:-1]) == ("-o", installer.SHELL_ACCOUNT, "-g",
                                                    installer.SHELL_ACCOUNT, "-m", "0700")
        assert f"/var/lib/kb-shell/home/{name}" in carved.split("=", 1)[1].split()


def test_existing_account_is_not_recreated(layout):
    recorder = Recorder(account_exists=True)
    install(layout, recorder)
    assert not [argv for argv in recorder.argv_list() if argv[0] in {installer.USERADD_BIN, installer.GROUPADD_BIN}]


# --- rollback on every failure class ----------------------------------------------------------


def test_a_first_install_failure_leaves_no_dangling_current(layout):
    """No `previous` to restore is exactly when `current` must be removed, not left hanging.

    A `current` symlink pointing at the deleted candidate, with the socket enabled, fails every
    later activation with a confusing ENOENT instead of reporting that the broker is not installed.
    """
    recorder = Recorder(protocol="kb-shell-broker/v2")
    with pytest.raises(installer.InstallError, match="previous selection was restored"):
        install(layout, recorder)
    assert installer._read_selection(layout.current) is None
    assert not layout.current.exists()
    assert not (layout.releases / digest_of(layout)).exists()
    assert installer._read_selection(layout.previous) is None


def test_a_provisioning_failure_refuses_before_any_selection_moves(layout):
    previous = seed_previous(layout)
    recorder = Recorder(failures={(installer.INSTALL_BIN, "-d"): 1})
    with pytest.raises(installer.InstallError, match="before any selection moved"):
        install(layout, recorder)
    assert installer._read_selection(layout.current) == previous
    assert [path.name for path in layout.releases.iterdir()] == [OLD_DIGEST]


FAILURE_POINTS = {
    "chown": (installer.CHOWN_BIN,),
    "chmod": (installer.CHMOD_BIN,),
    "install-unit": (installer.INSTALL_BIN, "-o"),
    "daemon-reload": (installer.SYSTEMCTL_BIN, "daemon-reload"),
    "restart": (installer.SYSTEMCTL_BIN, "restart"),
}


@pytest.mark.parametrize("point", sorted(FAILURE_POINTS))
def test_every_failing_command_restores_previous_and_removes_only_the_candidate(layout, point):
    previous = seed_previous(layout)
    recorder = Recorder(failures={FAILURE_POINTS[point]: 1})
    with pytest.raises(installer.InstallError, match="previous selection was restored"):
        install(layout, recorder)
    assert installer._read_selection(layout.current) == previous
    assert previous.is_dir()
    assert (previous / "main.js").is_file()
    assert not (layout.releases / digest_of(layout)).exists()
    assert not [path for path in layout.releases.iterdir() if path.name != OLD_DIGEST]
    # The old unit is put back: reload, then restart, on every one of these paths.
    assert (installer.SYSTEMCTL_BIN, "daemon-reload") in recorder.argv_list()
    assert (installer.SYSTEMCTL_BIN, "restart", installer.SERVICE_UNIT) in recorder.argv_list()


def test_an_extraction_failure_rolls_back_and_leaves_no_staging_directory(layout):
    previous = seed_previous(layout)
    repack(layout, _members(("main.js", b"//entry\n"), ("../escape.js", b"//no\n")))
    recorder = Recorder()
    with pytest.raises(installer.InstallError, match="previous selection was restored"):
        install(layout, recorder)
    assert installer._read_selection(layout.current) == previous
    assert previous.is_dir()
    assert [path.name for path in layout.releases.iterdir()] == [OLD_DIGEST]


# --- tar member validation ----------------------------------------------------------------------


def _members(*entries: tuple[str, bytes]):
    def mutate(bundle: tarfile.TarFile) -> None:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o444
            bundle.addfile(info, io.BytesIO(data))
    return mutate


def _special(name: str, kind: bytes, linkname: str = ""):
    def mutate(bundle: tarfile.TarFile) -> None:
        good = tarfile.TarInfo("main.js")
        good.size, good.mtime, good.mode = 8, 0, 0o444
        bundle.addfile(good, io.BytesIO(b"//entry\n"))
        info = tarfile.TarInfo(name)
        info.type = kind
        info.linkname = linkname
        info.mtime = 0
        info.mode = 0o444
        if kind in (tarfile.CHRTYPE, tarfile.BLKTYPE):
            info.devmajor, info.devminor = 1, 3
        bundle.addfile(info)
    return mutate


def _setuid_member():
    def mutate(bundle: tarfile.TarFile) -> None:
        info = tarfile.TarInfo("main.js")
        info.size, info.mtime, info.mode = 8, 0, 0o4755
        bundle.addfile(info, io.BytesIO(b"//entry\n"))
    return mutate


def repack(layout: installer.Layout, mutate) -> str:
    """Rewrite the release archive and re-record its real digest, so the install reaches extraction."""
    with tarfile.open(layout.archive, "w:gz") as bundle:
        mutate(bundle)
    digest = digest_of(layout)
    layout.manifest.write_text(
        f"{'a' * 64}  dashboard/server/index.ts\n{digest}  {installer.ARCHIVE_RELATIVE}\n",
        encoding="utf-8")
    return digest


HOSTILE_MEMBERS = {
    "symlink": (_special("link.js", tarfile.SYMTYPE, "/etc/passwd"), "not a regular file"),
    "hardlink": (_special("link.js", tarfile.LNKTYPE, "main.js"), "not a regular file"),
    "device": (_special("dev/null", tarfile.CHRTYPE), "not a regular file"),
    "fifo": (_special("pipe", tarfile.FIFOTYPE), "not a regular file"),
    "directory": (_special("subdir", tarfile.DIRTYPE), "not a regular file"),
    "absolute": (_members(("/etc/passwd", b"root\n")), "escapes the install root"),
    "traversal": (_members(("../escape.js", b"//no\n")), "escapes the install root"),
    "duplicate": (_members(("main.js", b"//one\n"), ("main.js", b"//two\n")), "repeats a member"),
    "setuid": (_setuid_member(), "setuid/setgid/sticky"),
}


@pytest.mark.parametrize("kind", sorted(HOSTILE_MEMBERS))
def test_extraction_refuses_a_hostile_member(layout, kind):
    """Every refusal in `_extract_verified`, exercised: the branch was previously uncovered."""
    mutate, message = HOSTILE_MEMBERS[kind]
    digest = repack(layout, mutate)
    staging = layout.releases / "staging"
    staging.mkdir()
    with installer._open_verified_archive(layout.archive, digest) as handle:
        with pytest.raises(installer.InstallError, match=message):
            installer._extract_verified(handle, staging)
    assert list(staging.iterdir()) == []


def test_extraction_refuses_an_archive_over_the_member_ceiling(layout, monkeypatch):
    assert installer.MAX_ARCHIVE_MEMBERS == 2_000
    digest = repack(layout, _members(("a.js", b"a"), ("b.js", b"b"), ("c.js", b"c")))
    monkeypatch.setattr(installer, "MAX_ARCHIVE_MEMBERS", 2)
    with installer._open_verified_archive(layout.archive, digest) as handle:
        with pytest.raises(installer.InstallError, match="over the 2 ceiling"):
            installer._extract_verified(handle, layout.releases)


def test_extraction_refuses_an_archive_over_the_total_size_ceiling(layout, monkeypatch):
    assert installer.MAX_ARCHIVE_BYTES == 256 * 1024 * 1024
    digest = repack(layout, _members(("a.js", b"0123456789"), ("b.js", b"0123456789")))
    monkeypatch.setattr(installer, "MAX_ARCHIVE_BYTES", 12)
    with installer._open_verified_archive(layout.archive, digest) as handle:
        with pytest.raises(installer.InstallError, match="unpacks to more than 12 bytes"):
            installer._extract_verified(handle, layout.releases)


def test_the_hashed_bytes_and_the_extracted_bytes_come_from_one_descriptor(layout):
    """Swapping the archive after the digest check must not change what is extracted."""
    digest = digest_of(layout)
    handle = installer._open_verified_archive(layout.archive, digest)
    try:
        swap = layout.archive.with_suffix(".swap")
        build_archive(swap, entry=b"//swapped\n")
        try:
            os.replace(swap, layout.archive)
        except OSError:  # pragma: no cover - Windows refuses to replace an open file
            pytest.skip("this host cannot replace a file that is open for reading")
        destination = layout.releases / "unpacked"
        destination.mkdir()
        installer._extract_verified(handle, destination)
    finally:
        handle.close()
    assert (destination / "main.js").read_bytes() == b"//entry\n"


def test_mutation_ceiling_refuses_a_symlinked_path_inside_a_named_root(tmp_path, layout):
    """Lexical normalisation accepted these: `releases/<digest>` could be a symlink to anywhere."""
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (layout.releases / "escape").symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):  # pragma: no cover - unprivileged Windows
        pytest.skip("this host cannot create symlinks without elevation")
    with pytest.raises(installer.InstallError, match="outside the broker install set"):
        layout.assert_mutable(layout.releases / "escape")
    with pytest.raises(installer.InstallError, match="outside the broker install set"):
        layout.assert_mutable(layout.releases / "escape" / "main.js")


# --- bootstrap integration ------------------------------------------------------------------------


def test_bootstrap_provisions_the_broker_account_and_enables_only_the_socket(tmp_path):
    recorder = Recorder()
    layout_value = installer.Layout(release_root=tmp_path / "release",
                                    broker_root=tmp_path / "broker",
                                    shell_root=tmp_path / "shell", unit_root=tmp_path / "units")
    bootstrap_vm.provision_pty_broker(run=recorder, layout=layout_value)
    argv_list = recorder.argv_list()
    # Absolute paths throughout, same rationale as the installer's own allow-list: root's inherited
    # PATH must not decide which binary "systemctl" means.
    assert (installer.SYSTEMCTL_BIN, "enable", installer.SOCKET_UNIT) in argv_list
    assert not any(argv[:3] == (installer.SYSTEMCTL_BIN, "enable", "--now") for argv in argv_list)
    assert any(argv[0] == installer.INSTALL_BIN and argv[-1] == str(layout_value.unit_root
                                                        / "kb-shell-broker.service")
               for argv in argv_list)
