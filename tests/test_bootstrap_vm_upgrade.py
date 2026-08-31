"""Proofs for `bootstrap_vm.py upgrade`: converging a pre-P6 VM without touching its data.

No root, no systemd, no real accounts: every child process goes through the injected `run=` fake and
every VM path is a tmp_path seam, so the suite runs on Windows as well as on the VM.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from deploy import bootstrap_vm
from deploy.validate_vm_runtime import EXPECTED_UNIT_ENV


REPO = Path(__file__).resolve().parents[1]
FRAGMENT = (REPO / "deploy/systemd/kb-dashboard.service").read_text(encoding="utf-8")
ANCHOR = "Environment=GIT_CONFIG_GLOBAL=/dev/null\n"
TAILNET_HOST = "kb.tail82dd4f.ts.net"
TAILNET_OPERATOR = "daniel.zhang.t1@gmail.com"
HELPER_ORIGIN = "https://kb-desk.command.ts.net"
# Absolute program paths: root PATH must not decide which binary "install" means.
INSTALL = bootstrap_vm.INSTALL_BIN
USERADD = bootstrap_vm.USERADD_BIN
SYSTEMCTL = bootstrap_vm.SYSTEMCTL_BIN
STAMP = "20260831T041500Z"
# Every path an upgrade must never appear to touch, in argv-substring form.
DATA_PATHS = ("/var/lib/kb/state", "/var/lib/kb/ops", "/opt/kb-releases", "control-plane.json")


def legacy_unit_text(host: str | None = TAILNET_HOST, operator: str | None = TAILNET_OPERATOR,
                     origin: str | None = None, extra: str = "") -> str:
    """The unit an older VM actually carries: no RuntimeDirectory, no proxy-uid envs, no
    DASHBOARD_DESKTOP_HELPER_ORIGIN unless asked for, and the site-specific values injected after the
    anchor exactly as bootstrap once wrote them."""
    body = "\n".join(line for line in FRAGMENT.splitlines() if not line.startswith("RuntimeDirectory")) + "\n"
    injected = ""
    if host is not None:
        injected += f"Environment=DASHBOARD_TAILNET_HOST={host}\n"
    if operator is not None:
        injected += f"Environment=DASHBOARD_TAILNET_OPERATOR={operator}\n"
    if origin is not None:
        injected += f"Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN={origin}\n"
    return body.replace(ANCHOR, ANCHOR + injected + extra)


class Accounts:
    """As much of the host's passwd file as these tests need, and it MOVES: a recorded `useradd`
    creates the account, exactly as the real one would. Both lookup directions come off it, so the
    upgrade's post-provision re-verify is a real read-back rather than a stub that always agrees."""

    def __init__(self, existing: dict[str, int] | None = None) -> None:
        self.by_name: dict[str, int] = dict(existing or {})

    def uid(self, name: str) -> int | None:
        return self.by_name.get(name)

    def user(self, uid: int) -> str | None:
        return next((name for name, held in self.by_name.items() if held == uid), None)

    def useradd(self, argv: list[str]) -> None:
        name = argv[-1]
        uid = int(argv[argv.index("--uid") + 1]) if "--uid" in argv else 900 + len(self.by_name)
        self.by_name.setdefault(name, uid)


class Recorder:
    """The `run=` fake: records argv, answers `id -u` from an Accounts, creates accounts on useradd,
    and can mirror an installed unit onto the seam path so a second upgrade sees what the first left."""

    def __init__(self, accounts: Accounts | None = None, mirror_unit: Path | None = None) -> None:
        self.commands: list[list[str]] = []
        self.installed_units: list[tuple[str, bytes]] = []
        self.accounts = Accounts() if accounts is None else accounts
        self.mirror_unit = mirror_unit

    def __call__(self, argv, **kwargs) -> subprocess.CompletedProcess:
        rendered = [str(token) for token in argv]
        self.commands.append(rendered)
        if len(rendered) == 3 and rendered[0].rsplit("/", 1)[-1] == "id" and rendered[1] == "-u":
            uid = self.accounts.uid(rendered[2])
            if uid is not None:
                return subprocess.CompletedProcess(rendered, 0, f"{uid}\n", "")
            return subprocess.CompletedProcess(rendered, 1, "", "no such user\n")
        if rendered[0].rsplit("/", 1)[-1] == "useradd":
            self.accounts.useradd(rendered)
            return subprocess.CompletedProcess(rendered, 0, "", "")
        if rendered[0].rsplit("/", 1)[-1] == "install" and "-d" not in rendered and len(rendered) >= 3:
            source = Path(rendered[-2])
            if source.is_file():
                content = source.read_bytes()
                if rendered[-1].endswith((".service", ".socket")):
                    self.installed_units.append((rendered[-1], content))
                if self.mirror_unit is not None and rendered[-1] == str(self.mirror_unit):
                    self.mirror_unit.write_bytes(content)
        return subprocess.CompletedProcess(rendered, 0, "", "")


@pytest.fixture
def vm(tmp_path):
    """A pre-P6 VM seam: an installed unit and a resident signing-key module, nothing else."""
    unit = tmp_path / "kb-dashboard.service"
    unit.write_text(legacy_unit_text(origin=HELPER_ORIGIN), encoding="utf-8")
    install_root = tmp_path / "usr-local-lib-kb"
    install_root.mkdir()
    (install_root / bootstrap_vm.RELEASE_SIGNING_MODULE).write_text(
        "RELEASE_PUBLIC_KEY = 'ssh-ed25519 AAAA'\n", encoding="ascii")
    backup_dir = tmp_path / "root"
    backup_dir.mkdir()
    return SimpleNamespace(unit=unit, install_root=install_root, backup_dir=backup_dir,
                           host_node_map=tmp_path / "host-nodes.json")


def unit_target(command: list[str]) -> str:
    """The install target as a posix path: the broker layout builds its unit paths with pathlib, so on
    Windows the recorded argv carries backslashes the VM never sees."""
    return command[-1].replace("\\", "/")


def normalize(commands: list[list[str]]) -> list[list[str]]:
    """Command sequence with the freshly generated unit temp file collapsed, so two runs compare."""
    return [["<rendered-unit>" if "kb-dashboard-service-" in token else token for token in command]
            for command in commands]


def converge(vm, run, *, accounts=None, lookup_uid=None, lookup_user=None, dry_run=False,
             emit=lambda *a: None, desktop_helper_origin=None):
    """Drive `upgrade` against the tmp_path seams. Both account lookups come off the same Accounts the
    recorded `useradd` writes into, unless a test overrides one to stage a specific host condition."""
    if accounts is None:
        accounts = getattr(run, "accounts", None) or Accounts()
    return bootstrap_vm.upgrade(
        run=run,
        unit_path=vm.unit,
        install_root=vm.install_root,
        host_node_map_path=vm.host_node_map,
        backup_dir=vm.backup_dir,
        desktop_helper_origin=desktop_helper_origin,
        dry_run=dry_run,
        lookup_uid=accounts.uid if lookup_uid is None else lookup_uid,
        lookup_user=accounts.user if lookup_user is None else lookup_user,
        now=lambda: STAMP,
        emit=emit,
    )


# --- happy path ---------------------------------------------------------------------------------


def test_upgrade_provisions_every_missing_piece_of_the_p6_contract(vm):
    recorder = Recorder()
    converge(vm, recorder)
    commands = recorder.commands

    assert [INSTALL, "-d", "-o", "root", "-g", "root", "-m", "0700", "/var/lib/kb-release-staging"] in commands
    # node proxy: the pinned account plus the frozen unit trio, enabled.
    useradd = next(c for c in commands if c[0] == USERADD and c[-1] == bootstrap_vm.NODE_PROXY_USER)
    assert useradd[useradd.index("--uid") + 1] == str(bootstrap_vm.NODE_PROXY_UID)
    for unit in bootstrap_vm.NODE_PROXY_UNITS:
        assert any(c[-1] == f"/etc/systemd/system/{unit}" for c in commands)
    assert "--user-group" in useradd
    assert [SYSTEMCTL, "enable", "kb-whois.socket"] in commands
    assert [SYSTEMCTL, "enable", "kb-node-proxy.service"] in commands
    # PTY broker host side: account, filesystem, both units, socket enabled.
    assert any(c[0].endswith("useradd") and c[-1] == "kb-shell" for c in commands)
    assert any(unit_target(c).endswith("/etc/systemd/system/kb-shell-broker.service") for c in commands)
    assert any(unit_target(c).endswith("/etc/systemd/system/kb-shell-broker.socket") for c in commands)
    assert [SYSTEMCTL, "enable", bootstrap_vm.SOCKET_UNIT] in commands
    # resident helpers refreshed from THIS deploy/ tree, read-only.
    for helper in bootstrap_vm.RESIDENT_HELPERS:
        assert any(c[:7] == [INSTALL, "-o", "root", "-g", "root", "-m", "0555"]
                   and c[-1] == str(vm.install_root / helper)
                   and Path(c[-2]) == REPO / "deploy" / helper for c in commands)
    # the unit: backed up first, then re-rendered, reloaded and enabled.
    backup = str(vm.backup_dir / f"kb-dashboard.service.pre-upgrade-{STAMP}")
    assert [INSTALL, "-o", "root", "-g", "root", "-m", "0400", str(vm.unit), backup] in commands
    unit_install = next(i for i, c in enumerate(commands) if c[-1] == str(vm.unit) and "-d" not in c)
    assert commands.index([INSTALL, "-o", "root", "-g", "root", "-m", "0400", str(vm.unit), backup]) < unit_install
    assert commands[unit_install][:7] == [INSTALL, "-o", "root", "-g", "root", "-m", "0444"]
    assert commands[unit_install + 1] == [SYSTEMCTL, "daemon-reload"]
    assert commands[unit_install + 2] == [SYSTEMCTL, "enable", "kb-dashboard.service"]


def test_upgrade_never_regenerates_the_signing_key_module_or_touches_data(vm):
    recorder = Recorder()
    before = (vm.install_root / bootstrap_vm.RELEASE_SIGNING_MODULE).read_bytes()
    converge(vm, recorder)

    assert (vm.install_root / bootstrap_vm.RELEASE_SIGNING_MODULE).read_bytes() == before
    assert not any(c[-1].endswith(bootstrap_vm.RELEASE_SIGNING_MODULE) for c in recorder.commands)
    assert not any(c[0] == "git" for c in recorder.commands)
    assert not any(c[0] == "chown" for c in recorder.commands)
    for command in recorder.commands:
        joined = " ".join(command)
        assert not any(data in joined for data in DATA_PATHS), joined
    # the Daniel-authored map is never written either
    assert not any(bootstrap_vm.HOST_NODE_MAP_DIR in " ".join(c) for c in recorder.commands)
    assert not vm.host_node_map.exists()


def test_every_program_the_upgrade_runs_is_an_absolute_path(vm):
    recorder = Recorder()
    converge(vm, recorder)
    # Root's inherited PATH must not get to decide which binary "install" or "systemctl" means.
    assert recorder.commands
    assert all(c[0].startswith("/") for c in recorder.commands), [c[0] for c in recorder.commands]


def test_upgrade_announces_the_window_in_which_a_restart_would_fail(vm):
    lines: list[str] = []
    converge(vm, Recorder(), emit=lines.append)
    # The new resident validator lands before the new unit does; an aborted run leaves that pairing
    # persistent, so the operator is told before it happens and told how to get out.
    warned = next(line for line in lines if "WILL FAIL" in line)
    assert "pre-upgrade-" in warned and "re-run upgrade" in warned
    assert lines.index(warned) < next(i for i, line in enumerate(lines) if "resident root helpers" in line)


def test_upgrade_closes_by_enumerating_what_is_still_owed(vm):
    lines: list[str] = []
    converge(vm, Recorder(), emit=lines.append)
    tail = "\n".join(lines)
    assert "activate a release" in tail
    assert "install_pty_broker.py --digest" in tail
    assert "systemctl restart kb-dashboard.service" in tail
    assert "EXPECTED to sit failed" in tail
    assert "Rollback" in tail


def test_upgrade_leaves_the_running_service_alone(vm):
    recorder = Recorder()
    converge(vm, recorder)
    # bootstrap disables --now before cloning; an upgrade clones nothing and must not take the
    # dashboard down or restart it behind the operator's back.
    assert not any(c[:2] == [SYSTEMCTL, "disable"] for c in recorder.commands)
    assert not any(c[:2] == [SYSTEMCTL, "restart"] and c[-1] == "kb-dashboard.service"
                   for c in recorder.commands)


# --- preservation and rendering ------------------------------------------------------------------


def test_upgrade_preserves_the_installed_host_and_operator_into_the_rendered_unit(tmp_path, vm):
    vm.unit.write_text(legacy_unit_text(host="other.example.ts.net", operator="someone@else.com",
                                        origin="https://other-desk.example.ts.net"), encoding="utf-8")
    recorder = Recorder()
    converge(vm, recorder)

    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert b"Environment=DASHBOARD_TAILNET_HOST=other.example.ts.net\n" in rendered
    assert b"Environment=DASHBOARD_TAILNET_OPERATOR=someone@else.com\n" in rendered
    assert b"Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN=https://other-desk.example.ts.net\n" in rendered


def test_rendered_unit_adds_the_two_things_the_pre_p6_vm_boot_was_missing(vm):
    recorder = Recorder()
    converge(vm, recorder)

    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert b"Environment=DASHBOARD_NODE_PROXY_UID=987\n" in rendered
    assert b"Environment=DASHBOARD_TAILNET_PROXY_UID=0\n" in rendered
    assert b"RuntimeDirectory=kb-dashboard\n" in rendered
    assert rendered == bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR, HELPER_ORIGIN)


def test_upgrade_discards_hand_injected_drift_rather_than_merging_it(vm):
    # An operator part-way through a manual fix: a stale WebAuthn env and a duplicate host line, both
    # of which the boot validator rejects. Re-rendering the whole fragment is what removes them.
    vm.unit.write_text(
        legacy_unit_text(origin=HELPER_ORIGIN,
                         extra="Environment=DASHBOARD_RP_ORIGIN=https://stale\n"
                               f"Environment=DASHBOARD_TAILNET_HOST={TAILNET_HOST}\n"),
        encoding="utf-8")
    recorder = Recorder()
    converge(vm, recorder)

    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert b"DASHBOARD_RP_ORIGIN" not in rendered
    assert rendered.count(b"Environment=DASHBOARD_TAILNET_HOST=") == 1


def test_unit_environment_reads_the_last_assignment_of_a_repeated_name():
    text = "[Service]\nEnvironment=A=1\nEnvironment=A=2\nEnvironment=B=3\n"
    assert bootstrap_vm.unit_environment(text) == {"A": "2", "B": "3"}


# --- refusals -----------------------------------------------------------------------------------


def test_upgrade_refuses_a_node_proxy_account_with_a_conflicting_uid(vm):
    recorder = Recorder()
    with pytest.raises(RuntimeError, match="already exists with uid 1234"):
        converge(vm, recorder, accounts=Accounts({"kb-node-proxy": 1234}))
    assert recorder.commands == []


def test_upgrade_accepts_a_node_proxy_account_that_already_carries_the_pinned_uid(vm):
    recorder = Recorder(accounts=Accounts({"kb-node-proxy": 987}))
    converge(vm, recorder)
    # Already correct: no useradd at all, and the rest of the convergence still happens.
    assert not any(c[0] == USERADD and c[-1] == "kb-node-proxy" for c in recorder.commands)
    assert [SYSTEMCTL, "enable", "kb-node-proxy.service"] in recorder.commands


def test_upgrade_refuses_when_the_pinned_uid_belongs_to_another_account(vm):
    # The case a name lookup cannot see: kb-node-proxy does not exist, but 987 is taken. `useradd`
    # would fail with exit 4, and the injected DASHBOARD_NODE_PROXY_UID would name polkitd.
    recorder = Recorder(accounts=Accounts({"polkitd": 987}))
    with pytest.raises(RuntimeError, match="already held by account 'polkitd'"):
        converge(vm, recorder)
    assert recorder.commands == []


def test_upgrade_refuses_when_the_account_does_not_come_back_with_the_pinned_uid(vm):
    # useradd "succeeded" but the account is not there with uid 987: refuse rather than install a unit
    # pinning the node-route trust anchor to nothing.
    class Deaf(Accounts):
        def useradd(self, argv):
            return None

    recorder = Recorder(accounts=Deaf())
    with pytest.raises(RuntimeError, match="after provisioning"):
        converge(vm, recorder)
    # it stopped before the unit was touched
    assert not any(str(vm.unit) == c[-1] for c in recorder.commands)


@pytest.mark.parametrize("host,operator,missing", [
    (None, TAILNET_OPERATOR, "DASHBOARD_TAILNET_HOST"),
    (TAILNET_HOST, None, "DASHBOARD_TAILNET_OPERATOR"),
    (None, None, "DASHBOARD_TAILNET_HOST,DASHBOARD_TAILNET_OPERATOR"),
])
def test_upgrade_refuses_when_the_installed_unit_carries_no_tailnet_identity(vm, host, operator, missing):
    vm.unit.write_text(legacy_unit_text(host=host, operator=operator), encoding="utf-8")
    recorder = Recorder()
    with pytest.raises(RuntimeError, match=missing):
        converge(vm, recorder)
    assert recorder.commands == []


@pytest.mark.parametrize("host", ["KB.command.ts.net", "https://kb.command.ts.net", "kb.command.ts.net:8443"])
def test_upgrade_refuses_a_malformed_installed_host(vm, host):
    vm.unit.write_text(legacy_unit_text(host=host), encoding="utf-8")
    recorder = Recorder()
    with pytest.raises(ValueError, match="tailnet host"):
        converge(vm, recorder)
    assert recorder.commands == []


def test_upgrade_refuses_a_malformed_installed_operator(vm):
    vm.unit.write_text(legacy_unit_text(operator="not-an-email"), encoding="utf-8")
    recorder = Recorder()
    with pytest.raises(ValueError, match="tailnet operator"):
        converge(vm, recorder)
    assert recorder.commands == []


def test_upgrade_refuses_when_the_resident_signing_key_module_is_absent(vm):
    (vm.install_root / bootstrap_vm.RELEASE_SIGNING_MODULE).unlink()
    recorder = Recorder()
    with pytest.raises(RuntimeError, match="release signing public key module is absent"):
        converge(vm, recorder)
    assert recorder.commands == []


def test_upgrade_refuses_when_a_unit_drop_in_directory_exists(vm):
    # Drop-in fragments would survive the re-render unreviewed, and the boot validator rejects a
    # non-empty DropInPaths outright.
    (vm.unit.parent / (vm.unit.name + ".d")).mkdir()
    recorder = Recorder()
    with pytest.raises(RuntimeError, match="drop-in directory exists"):
        converge(vm, recorder)
    assert recorder.commands == []


def test_upgrade_refuses_when_no_unit_is_installed_at_all(vm):
    vm.unit.unlink()
    recorder = Recorder()
    with pytest.raises(RuntimeError, match="installed dashboard unit is absent"):
        converge(vm, recorder)
    assert recorder.commands == []


# --- warnings -----------------------------------------------------------------------------------


def test_upgrade_warns_that_node_routes_stay_fail_closed_without_the_host_node_map(vm):
    lines: list[str] = []
    converge(vm, Recorder(), emit=lines.append)
    warning = next(line for line in lines if line.startswith("WARNING") and "host-node map" in line)
    assert str(vm.host_node_map) in warning
    assert "fail-closed" in warning


def test_upgrade_does_not_warn_when_the_host_node_map_is_present(vm):
    vm.host_node_map.write_text("{}", encoding="utf-8")
    lines: list[str] = []
    converge(vm, Recorder(), emit=lines.append)
    assert not any("host-node map" in line for line in lines)


# --- the rendered unit satisfies the resident validator's closed env set -------------------------


def test_every_name_the_boot_validator_requires_is_actually_rendered():
    rendered = bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR, HELPER_ORIGIN)
    assigned = set(bootstrap_vm.unit_environment(rendered.decode("utf-8")))
    assert EXPECTED_UNIT_ENV.issubset(assigned)
    # the renderer must not invent names the validator's closed set would reject either
    assert assigned == EXPECTED_UNIT_ENV


def test_a_render_missing_a_required_name_fails_instead_of_warning(monkeypatch):
    monkeypatch.setattr(bootstrap_vm, "EXPECTED_UNIT_ENV", EXPECTED_UNIT_ENV | {"DASHBOARD_NOT_RENDERED"})
    with pytest.raises(RuntimeError, match="DASHBOARD_NOT_RENDERED"):
        bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR, HELPER_ORIGIN)


def test_a_render_assigning_an_unexpected_name_fails_too(monkeypatch):
    # Set EQUALITY, not a superset check: a name the validator's closed set does not allow is refused
    # here rather than at ExecStartPre.
    monkeypatch.setattr(bootstrap_vm, "EXPECTED_UNIT_ENV", EXPECTED_UNIT_ENV - {"KB_VM_RUNTIME"})
    with pytest.raises(RuntimeError, match="unexpected: KB_VM_RUNTIME"):
        bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR, HELPER_ORIGIN)


def test_a_value_that_renders_but_breaks_the_boot_parser_is_refused_at_render():
    # `^\S+@\S+$` accepts this operator, but the boot validator shlex-splits the Environment line and
    # an unbalanced quote makes it explode. Checking with the validator's OWN reader catches it here.
    with pytest.raises(RuntimeError, match="environment assignment syntax is invalid"):
        bootstrap_vm.unit_fragment_source(TAILNET_HOST, '"unclosed@example.com', HELPER_ORIGIN)


def test_upgrade_refuses_before_mutating_when_the_render_would_be_incomplete(vm, monkeypatch):
    monkeypatch.setattr(bootstrap_vm, "EXPECTED_UNIT_ENV", EXPECTED_UNIT_ENV | {"DASHBOARD_NOT_RENDERED"})
    recorder = Recorder()
    with pytest.raises(RuntimeError, match="would fail ExecStartPre"):
        converge(vm, recorder)
    assert recorder.commands == []


# --- desktop helper origin -----------------------------------------------------------------------


@pytest.mark.parametrize("value,message", [
    (None, "is required"),
    ("", "is required"),
    ("kb-desk.command.ts.net", "not a valid absolute URL"),
    ("//kb-desk.command.ts.net", "not a valid absolute URL"),
    ("https://kb-desk.command.ts.net\nExecStart=/bin/sh", "not a valid absolute URL"),
    ("https://kb-desk.command.ts.net evil", "not a valid absolute URL"),
    ("http://kb-desk.command.ts.net", "must be an https: origin"),
    ("wss://kb-desk.command.ts.net", "must be an https: origin"),
    ("https://kb-desk.example.com", "must be a tailnet"),
    ("https://kb-desk.ts.net.evil.com", "must be a tailnet"),
    ("https://kb-desk.command.ts.net/deploy", "bare origin"),
    ("https://kb-desk.command.ts.net/?x=1", "bare origin"),
    ("https://kb-desk.command.ts.net#frag", "bare origin"),
])
def test_desktop_helper_origin_validation_mirrors_the_typescript_client(value, message):
    with pytest.raises(ValueError, match=message):
        bootstrap_vm.normalize_desktop_helper_origin(value)


@pytest.mark.parametrize("value,expected", [
    ("https://kb-desk.command.ts.net", "https://kb-desk.command.ts.net"),
    ("https://kb-desk.command.ts.net/", "https://kb-desk.command.ts.net"),
    ("https://KB-Desk.Command.TS.NET/", "https://kb-desk.command.ts.net"),
    ("https://kb-desk.command.ts.net:443/", "https://kb-desk.command.ts.net"),
    ("https://kb-desk.command.ts.net:8443", "https://kb-desk.command.ts.net:8443"),
])
def test_desktop_helper_origin_normalizes_to_a_bare_origin(value, expected):
    assert bootstrap_vm.normalize_desktop_helper_origin(value) == expected


def test_upgrade_preserves_the_installed_helper_origin_by_default(vm):
    recorder = Recorder()
    lines: list[str] = []
    converge(vm, recorder, emit=lines.append)

    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert f"Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN={HELPER_ORIGIN}\n".encode("ascii") in rendered
    assert not any(line.startswith("NOTICE") for line in lines)


def test_the_flag_overrides_the_installed_helper_origin_with_a_printed_notice(vm):
    recorder = Recorder()
    lines: list[str] = []
    converge(vm, recorder, emit=lines.append, desktop_helper_origin="https://new-desk.command.ts.net/")

    notice = next(line for line in lines if line.startswith("NOTICE"))
    assert "https://new-desk.command.ts.net" in notice and HELPER_ORIGIN in notice
    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    # normalized on the way in: the trailing slash never reaches the unit
    assert b"Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN=https://new-desk.command.ts.net\n" in rendered


def test_the_flag_supplies_the_origin_a_pre_p5_unit_does_not_carry(vm):
    vm.unit.write_text(legacy_unit_text(), encoding="utf-8")
    recorder = Recorder()
    lines: list[str] = []
    converge(vm, recorder, emit=lines.append, desktop_helper_origin=HELPER_ORIGIN)

    assert any("the installed unit assigns none" in line for line in lines)
    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert f"Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN={HELPER_ORIGIN}\n".encode("ascii") in rendered


def test_upgrade_refuses_when_neither_the_unit_nor_the_flag_names_a_helper_origin(vm):
    vm.unit.write_text(legacy_unit_text(), encoding="utf-8")
    recorder = Recorder()
    with pytest.raises(RuntimeError, match="--desktop-helper-origin"):
        converge(vm, recorder)
    assert recorder.commands == []


def test_upgrade_refuses_a_malformed_flag_before_mutating(vm):
    recorder = Recorder()
    with pytest.raises(ValueError, match="must be a tailnet"):
        converge(vm, recorder, desktop_helper_origin="https://desk.example.com")
    assert recorder.commands == []


def test_a_malformed_installed_origin_is_refused_but_the_flag_can_rescue_it(vm):
    vm.unit.write_text(legacy_unit_text(origin="http://desk.command.ts.net"), encoding="utf-8")
    with pytest.raises(ValueError, match="must be an https: origin"):
        converge(vm, Recorder())

    recorder = Recorder()
    converge(vm, recorder, desktop_helper_origin=HELPER_ORIGIN)
    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert f"Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN={HELPER_ORIGIN}\n".encode("ascii") in rendered


# --- dry run ------------------------------------------------------------------------------------


def test_dry_run_executes_nothing_and_prints_the_whole_plan(vm):
    def boom(argv, **kwargs):
        raise AssertionError("--dry-run must not run a single command")

    lines: list[str] = []
    converge(vm, boom, dry_run=True, emit=lines.append)

    planned = [line for line in lines if line.startswith("would run: ")]
    assert any("useradd --system --user-group --uid 987" in line for line in planned)
    assert any("/var/lib/kb-release-staging" in line for line in planned)
    assert any(str(vm.unit) in line for line in planned)
    assert any("systemctl daemon-reload" in line for line in planned)
    # read-only findings still happen
    assert any(f"DASHBOARD_TAILNET_HOST={TAILNET_HOST}" in line for line in lines)
    assert any(line.startswith("WARNING") for line in lines)


def test_dry_run_still_refuses_a_uid_conflict_without_running_anything(vm):
    def boom(argv, **kwargs):
        raise AssertionError("--dry-run must not run a single command")

    with pytest.raises(RuntimeError, match="already exists with uid"):
        converge(vm, boom, dry_run=True, accounts=Accounts({"kb-node-proxy": 5}), emit=lambda *a: None)


def test_dry_run_reaches_both_account_lookups_without_running_anything(vm):
    def boom(argv, **kwargs):
        raise AssertionError("--dry-run must not run a single command")

    asked_by_name, asked_by_uid = [], []

    def by_name(name):
        asked_by_name.append(name)
        return None

    def by_uid(uid):
        asked_by_uid.append(uid)
        return None

    converge(vm, boom, dry_run=True, lookup_uid=by_name, lookup_user=by_uid, emit=lambda *a: None)
    # Both preflight questions are answered from `pwd`, never a subprocess, so the refusals still fire
    # under --dry-run.
    assert bootstrap_vm.NODE_PROXY_USER in asked_by_name
    assert bootstrap_vm.NODE_PROXY_UID in asked_by_uid


def test_dry_run_refuses_a_uid_held_by_another_account(vm):
    def boom(argv, **kwargs):
        raise AssertionError("--dry-run must not run a single command")

    with pytest.raises(RuntimeError, match="already held by account"):
        converge(vm, boom, dry_run=True, accounts=Accounts({"polkitd": 987}), emit=lambda *a: None)


def test_dry_run_skips_the_post_provision_read_back_it_cannot_satisfy(vm):
    # Nothing was created, so the account is still absent; the re-verify must not turn a rehearsal
    # into a refusal.
    lines: list[str] = []
    converge(vm, None, dry_run=True, accounts=Accounts(), emit=lines.append)
    assert any("converged" in line for line in lines)


def test_dry_runner_answers_the_broker_account_probe_from_the_read_only_lookup():
    runner = bootstrap_vm.DryRunner(lookup_uid=lambda name: 42 if name == "kb-shell" else None,
                                    emit=lambda *a: None)
    assert runner(["/usr/bin/id", "-u", "kb-shell"]).returncode == 0
    assert runner(["/usr/bin/id", "-u", "kb-shell"]).stdout.strip() == "42"
    assert runner(["/usr/bin/id", "-u", "kb-node-proxy"]).returncode == 1
    assert runner(["/usr/bin/install", "-d", "/tmp/x"]).returncode == 0
    assert runner.commands[-1] == ["/usr/bin/install", "-d", "/tmp/x"]


def test_dry_run_plans_the_broker_account_only_when_it_is_missing(vm):
    absent: list[str] = []
    converge(vm, None, dry_run=True, accounts=Accounts(), emit=absent.append)
    present: list[str] = []
    converge(vm, None, dry_run=True, accounts=Accounts({"kb-shell": 900, "kb-node-proxy": 987}),
             emit=present.append)

    assert any("useradd" in line and "kb-shell" in line for line in absent)
    assert not any("useradd" in line and line.rstrip().endswith("kb-shell") for line in present)


# --- idempotency and partial state ---------------------------------------------------------------


def test_a_second_upgrade_on_an_untouched_vm_plans_the_identical_sequence(vm):
    first = Recorder()
    converge(vm, first)
    second = Recorder()
    converge(vm, second)
    assert normalize(first.commands) == normalize(second.commands)


def test_upgrading_a_vm_this_script_already_converged_is_a_no_op_render(tmp_path, vm):
    first = Recorder(mirror_unit=vm.unit)
    converge(vm, first)
    already_converged = vm.unit.read_bytes()
    assert already_converged == bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR, HELPER_ORIGIN)

    # Second pass over the VM the first pass produced: the accounts now exist, so the broker installer
    # skips groupadd/useradd, and everything else converges to the same commands and the same bytes.
    second = Recorder(accounts=first.accounts, mirror_unit=vm.unit)
    converge(vm, second)

    assert vm.unit.read_bytes() == already_converged
    planned_first, planned_second = normalize(first.commands), normalize(second.commands)
    skipped = [c for c in planned_first if c not in planned_second]
    # The only commands the second pass drops are the account creations the first pass performed.
    assert all(c[0].endswith(("useradd", "groupadd")) for c in skipped)
    assert {c[-1] for c in skipped} == {"kb-shell", "kb-node-proxy"}
    assert [c for c in planned_second if c not in planned_first] == []


def test_upgrade_converges_a_partially_hand_provisioned_vm(vm):
    # The operator got part-way by hand: kb-shell exists, the broker socket unit was copied, and the
    # old unit was sed-patched with a proxy uid line. None of it changes the end state.
    vm.unit.write_text(legacy_unit_text(origin=HELPER_ORIGIN,
                                        extra="Environment=DASHBOARD_NODE_PROXY_UID=987\n"),
                       encoding="utf-8")
    recorder = Recorder(accounts=Accounts({"kb-shell": 900}), mirror_unit=vm.unit)
    converge(vm, recorder)

    assert vm.unit.read_bytes() == bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR, HELPER_ORIGIN)
    assert vm.unit.read_bytes().count(b"Environment=DASHBOARD_NODE_PROXY_UID=") == 1
    assert not any(c[0].endswith("useradd") and c[-1] == "kb-shell" for c in recorder.commands)
    assert any(c[0] == USERADD and c[-1] == "kb-node-proxy" for c in recorder.commands)
    assert recorder.accounts.uid("kb-node-proxy") == bootstrap_vm.NODE_PROXY_UID


# --- CLI ----------------------------------------------------------------------------------------


def fake_bootstrap(seen):
    def call(ops_bundle, release_public_key, tailnet_host, tailnet_operator, desktop_helper_origin):
        seen.append((tailnet_host, desktop_helper_origin))
    return call


def test_legacy_flag_only_invocation_still_means_bootstrap(monkeypatch):
    seen = []
    monkeypatch.setattr(bootstrap_vm, "bootstrap", fake_bootstrap(seen))
    monkeypatch.setattr(sys, "argv", ["bootstrap_vm.py", "--ops-bundle", "o", "--release-public-key", "r",
                                      "--tailnet-host", TAILNET_HOST,
                                      "--desktop-helper-origin", HELPER_ORIGIN])
    assert bootstrap_vm.main() == 0
    assert seen == [(TAILNET_HOST, HELPER_ORIGIN)]


def test_explicit_bootstrap_subcommand_reaches_the_same_call(monkeypatch):
    seen = []
    monkeypatch.setattr(bootstrap_vm, "bootstrap", fake_bootstrap(seen))
    assert bootstrap_vm.main(["bootstrap", "--ops-bundle", "o", "--release-public-key", "r",
                              "--tailnet-host", TAILNET_HOST,
                              "--desktop-helper-origin", HELPER_ORIGIN]) == 0
    assert seen == [(TAILNET_HOST, HELPER_ORIGIN)]


def test_bootstrap_refuses_to_run_without_a_desktop_helper_origin(monkeypatch):
    monkeypatch.setattr(bootstrap_vm, "bootstrap", fake_bootstrap([]))
    with pytest.raises(SystemExit):
        bootstrap_vm.main(["bootstrap", "--ops-bundle", "o", "--release-public-key", "r",
                           "--tailnet-host", TAILNET_HOST])


def test_upgrade_subcommand_passes_every_path_seam_and_the_dry_run_flag(monkeypatch, vm):
    seen = {}
    monkeypatch.setattr(bootstrap_vm, "upgrade", lambda **kwargs: seen.update(kwargs))
    assert bootstrap_vm.main([
        "upgrade", "--dry-run",
        "--unit-path", str(vm.unit),
        "--install-root", str(vm.install_root),
        "--host-node-map", str(vm.host_node_map),
        "--backup-dir", str(vm.backup_dir),
        "--desktop-helper-origin", HELPER_ORIGIN,
    ]) == 0
    assert seen == {
        "unit_path": vm.unit,
        "install_root": vm.install_root,
        "host_node_map_path": vm.host_node_map,
        "backup_dir": vm.backup_dir,
        "desktop_helper_origin": HELPER_ORIGIN,
        "dry_run": True,
    }


def test_upgrade_defaults_point_at_the_real_vm_locations(monkeypatch):
    seen = {}
    monkeypatch.setattr(bootstrap_vm, "upgrade", lambda **kwargs: seen.update(kwargs))
    assert bootstrap_vm.main(["upgrade"]) == 0
    assert seen["unit_path"] == Path("/etc/systemd/system/kb-dashboard.service")
    assert seen["install_root"] == Path("/usr/local/lib/kb")
    assert seen["host_node_map_path"] == Path(bootstrap_vm.HOST_NODE_MAP_PATH)
    assert seen["backup_dir"] == Path("/root")
    # optional on upgrade: the installed unit's value is preserved when the flag is omitted
    assert seen["desktop_helper_origin"] is None
    assert seen["dry_run"] is False


def test_an_unknown_subcommand_is_refused(monkeypatch):
    with pytest.raises(SystemExit):
        bootstrap_vm.main(["reinstall"])


def real_dry_run(tmp_path, unit_text: str, *extra: str) -> subprocess.CompletedProcess:
    unit = tmp_path / "kb-dashboard.service"
    unit.write_text(unit_text, encoding="utf-8")
    install_root = tmp_path / "lib"
    install_root.mkdir(exist_ok=True)
    (install_root / bootstrap_vm.RELEASE_SIGNING_MODULE).write_text("RELEASE_PUBLIC_KEY = 'x'\n", encoding="ascii")
    result = subprocess.run(
        [sys.executable, str(REPO / "deploy/bootstrap_vm.py"), "upgrade", "--dry-run",
         "--unit-path", str(unit), "--install-root", str(install_root),
         "--host-node-map", str(tmp_path / "absent.json"), "--backup-dir", str(tmp_path), *extra],
        text=True, capture_output=True)
    # nothing was executed: the unit it was pointed at is byte-for-byte what it was
    assert unit.read_text(encoding="utf-8") == unit_text
    return result


def test_upgrade_is_reachable_as_a_real_subprocess_dry_run(tmp_path):
    result = real_dry_run(tmp_path, legacy_unit_text(origin=HELPER_ORIGIN))
    assert result.returncode == 0, result.stderr
    assert "would run: /usr/sbin/useradd --system --user-group --uid 987" in result.stdout
    assert f"[upgrade] preserving DASHBOARD_TAILNET_HOST={TAILNET_HOST}" in result.stdout
    assert f"[upgrade] rendering DASHBOARD_DESKTOP_HELPER_ORIGIN={HELPER_ORIGIN}" in result.stdout


def test_a_real_subprocess_dry_run_refuses_a_unit_with_no_helper_origin(tmp_path):
    result = real_dry_run(tmp_path, legacy_unit_text())
    assert result.returncode != 0
    assert "--desktop-helper-origin" in result.stderr
    assert "would run:" not in result.stdout


def test_a_real_subprocess_dry_run_accepts_the_helper_origin_flag(tmp_path):
    result = real_dry_run(tmp_path, legacy_unit_text(), "--desktop-helper-origin", HELPER_ORIGIN)
    assert result.returncode == 0, result.stderr
    assert "the installed unit assigns none" in result.stdout
