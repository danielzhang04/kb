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


REPO = Path(__file__).resolve().parents[1]
FRAGMENT = (REPO / "deploy/systemd/kb-dashboard.service").read_text(encoding="utf-8")
ANCHOR = "Environment=GIT_CONFIG_GLOBAL=/dev/null\n"
TAILNET_HOST = "kb.tail82dd4f.ts.net"
TAILNET_OPERATOR = "daniel.zhang.t1@gmail.com"
STAMP = "20260831T041500Z"
# Every path an upgrade must never appear to touch, in argv-substring form.
DATA_PATHS = ("/var/lib/kb/state", "/var/lib/kb/ops", "/opt/kb-releases", "control-plane.json")


def legacy_unit_text(host: str | None = TAILNET_HOST, operator: str | None = TAILNET_OPERATOR,
                     extra: str = "") -> str:
    """The unit a pre-P6 VM actually carries: no RuntimeDirectory, no proxy-uid envs, and the two
    site-specific values injected after the anchor exactly as bootstrap once wrote them."""
    body = "\n".join(line for line in FRAGMENT.splitlines() if not line.startswith("RuntimeDirectory")) + "\n"
    injected = ""
    if host is not None:
        injected += f"Environment=DASHBOARD_TAILNET_HOST={host}\n"
    if operator is not None:
        injected += f"Environment=DASHBOARD_TAILNET_OPERATOR={operator}\n"
    return body.replace(ANCHOR, ANCHOR + injected + extra)


class Recorder:
    """The `run=` fake: records argv, answers `id -u` from a declared account set, and can mirror an
    installed unit onto the seam path so a second upgrade sees what the first one left behind."""

    def __init__(self, accounts: tuple[str, ...] = (), mirror_unit: Path | None = None) -> None:
        self.commands: list[list[str]] = []
        self.installed_units: list[tuple[str, bytes]] = []
        self.accounts = set(accounts)
        self.mirror_unit = mirror_unit

    def __call__(self, argv, **kwargs) -> subprocess.CompletedProcess:
        rendered = [str(token) for token in argv]
        self.commands.append(rendered)
        if len(rendered) == 3 and rendered[0].rsplit("/", 1)[-1] == "id" and rendered[1] == "-u":
            if rendered[2] in self.accounts:
                return subprocess.CompletedProcess(rendered, 0, "987\n", "")
            return subprocess.CompletedProcess(rendered, 1, "", "no such user\n")
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
    unit.write_text(legacy_unit_text(), encoding="utf-8")
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


def converge(vm, run, *, lookup_uid=lambda name: None, dry_run=False, emit=lambda *a: None):
    return bootstrap_vm.upgrade(
        run=run,
        unit_path=vm.unit,
        install_root=vm.install_root,
        host_node_map_path=vm.host_node_map,
        backup_dir=vm.backup_dir,
        dry_run=dry_run,
        lookup_uid=lookup_uid,
        now=lambda: STAMP,
        emit=emit,
    )


# --- happy path ---------------------------------------------------------------------------------


def test_upgrade_provisions_every_missing_piece_of_the_p6_contract(vm):
    recorder = Recorder()
    converge(vm, recorder)
    commands = recorder.commands

    assert ["install", "-d", "-o", "root", "-g", "root", "-m", "0700", "/var/lib/kb-release-staging"] in commands
    # node proxy: the pinned account plus the frozen unit trio, enabled.
    useradd = next(c for c in commands if c[0] == "useradd" and c[-1] == bootstrap_vm.NODE_PROXY_USER)
    assert useradd[useradd.index("--uid") + 1] == str(bootstrap_vm.NODE_PROXY_UID)
    for unit in bootstrap_vm.NODE_PROXY_UNITS:
        assert any(c[-1] == f"/etc/systemd/system/{unit}" for c in commands)
    assert ["systemctl", "enable", "kb-whois.socket"] in commands
    assert ["systemctl", "enable", "kb-node-proxy.service"] in commands
    # PTY broker host side: account, filesystem, both units, socket enabled.
    assert any(c[0].endswith("useradd") and c[-1] == "kb-shell" for c in commands)
    assert any(unit_target(c).endswith("/etc/systemd/system/kb-shell-broker.service") for c in commands)
    assert any(unit_target(c).endswith("/etc/systemd/system/kb-shell-broker.socket") for c in commands)
    assert any(c[-3:] == ["systemctl", "enable", bootstrap_vm.SOCKET_UNIT] or
               c == ["systemctl", "enable", bootstrap_vm.SOCKET_UNIT] for c in commands)
    # resident helpers refreshed from THIS deploy/ tree, read-only.
    for helper in bootstrap_vm.RESIDENT_HELPERS:
        assert any(c[:7] == ["install", "-o", "root", "-g", "root", "-m", "0555"]
                   and c[-1] == str(vm.install_root / helper)
                   and Path(c[-2]) == REPO / "deploy" / helper for c in commands)
    # the unit: backed up first, then re-rendered, reloaded and enabled.
    backup = str(vm.backup_dir / f"kb-dashboard.service.pre-upgrade-{STAMP}")
    assert ["install", "-o", "root", "-g", "root", "-m", "0400", str(vm.unit), backup] in commands
    unit_install = next(i for i, c in enumerate(commands) if c[-1] == str(vm.unit) and "-d" not in c)
    assert commands.index(["install", "-o", "root", "-g", "root", "-m", "0400", str(vm.unit), backup]) < unit_install
    assert commands[unit_install][:7] == ["install", "-o", "root", "-g", "root", "-m", "0444"]
    assert commands[unit_install + 1] == ["systemctl", "daemon-reload"]
    assert commands[unit_install + 2] == ["systemctl", "enable", "kb-dashboard.service"]


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


def test_upgrade_leaves_the_running_service_alone(vm):
    recorder = Recorder()
    converge(vm, recorder)
    # bootstrap disables --now before cloning; an upgrade clones nothing and must not take the
    # dashboard down or restart it behind the operator's back.
    assert not any(c[:2] == ["systemctl", "disable"] for c in recorder.commands)
    assert not any(c[:2] == ["systemctl", "restart"] and c[-1] == "kb-dashboard.service"
                   for c in recorder.commands)


# --- preservation and rendering ------------------------------------------------------------------


def test_upgrade_preserves_the_installed_host_and_operator_into_the_rendered_unit(tmp_path, vm):
    vm.unit.write_text(legacy_unit_text(host="other.example.ts.net", operator="someone@else.com"),
                       encoding="utf-8")
    recorder = Recorder()
    converge(vm, recorder)

    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert b"Environment=DASHBOARD_TAILNET_HOST=other.example.ts.net\n" in rendered
    assert b"Environment=DASHBOARD_TAILNET_OPERATOR=someone@else.com\n" in rendered


def test_rendered_unit_adds_the_two_things_the_pre_p6_vm_boot_was_missing(vm):
    recorder = Recorder()
    converge(vm, recorder)

    rendered = next(content for target, content in recorder.installed_units if target == str(vm.unit))
    assert b"Environment=DASHBOARD_NODE_PROXY_UID=987\n" in rendered
    assert b"Environment=DASHBOARD_TAILNET_PROXY_UID=0\n" in rendered
    assert b"RuntimeDirectory=kb-dashboard\n" in rendered
    assert rendered == bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR)


def test_upgrade_discards_hand_injected_drift_rather_than_merging_it(vm):
    # An operator part-way through a manual fix: a stale WebAuthn env and a duplicate host line, both
    # of which the boot validator rejects. Re-rendering the whole fragment is what removes them.
    vm.unit.write_text(
        legacy_unit_text(extra="Environment=DASHBOARD_RP_ORIGIN=https://stale\n"
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
        converge(vm, recorder, lookup_uid=lambda name: 1234 if name == "kb-node-proxy" else None)
    assert recorder.commands == []


def test_upgrade_accepts_a_node_proxy_account_that_already_carries_the_pinned_uid(vm):
    recorder = Recorder(accounts=("kb-node-proxy",))
    converge(vm, recorder, lookup_uid=lambda name: 987 if name == "kb-node-proxy" else None)
    assert any(c[0] == "useradd" and c[-1] == "kb-node-proxy" for c in recorder.commands)


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


def test_upgrade_reports_required_unit_env_the_repo_fragment_does_not_render(vm):
    lines: list[str] = []
    converge(vm, Recorder(), emit=lines.append)
    missing = bootstrap_vm._report_unrendered_unit_env(TAILNET_HOST, TAILNET_OPERATOR, emit=lambda *a: None)
    if missing:
        warning = next(line for line in lines if line.startswith("WARNING") and "ExecStartPre" in line)
        for name in missing:
            assert name in warning
    else:
        assert not any("ExecStartPre" in line for line in lines)


# --- dry run ------------------------------------------------------------------------------------


def test_dry_run_executes_nothing_and_prints_the_whole_plan(vm):
    def boom(argv, **kwargs):
        raise AssertionError("--dry-run must not run a single command")

    lines: list[str] = []
    converge(vm, boom, dry_run=True, emit=lines.append)

    planned = [line for line in lines if line.startswith("would run: ")]
    assert any("useradd --system --uid 987" in line for line in planned)
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
        converge(vm, boom, dry_run=True, lookup_uid=lambda name: 5, emit=lambda *a: None)


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
    converge(vm, None, dry_run=True, lookup_uid=lambda name: None, emit=absent.append)
    present: list[str] = []
    converge(vm, None, dry_run=True, lookup_uid=lambda name: 987, emit=present.append)

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
    assert already_converged == bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR)

    # Second pass over the VM the first pass produced: the accounts now exist, so the broker installer
    # skips groupadd/useradd, and everything else converges to the same commands and the same bytes.
    second = Recorder(accounts=("kb-shell", "kb-node-proxy"), mirror_unit=vm.unit)
    converge(vm, second, lookup_uid=lambda name: 987 if name == "kb-node-proxy" else None)

    assert vm.unit.read_bytes() == already_converged
    planned_first, planned_second = normalize(first.commands), normalize(second.commands)
    skipped = [c for c in planned_first if c not in planned_second]
    assert all(c[0].endswith(("useradd", "groupadd")) and c[-1] == "kb-shell" for c in skipped)
    assert [c for c in planned_second if c not in planned_first] == []


def test_upgrade_converges_a_partially_hand_provisioned_vm(vm):
    # The operator got part-way by hand: kb-shell exists, the broker socket unit was copied, and the
    # old unit was sed-patched with a proxy uid line. None of it changes the end state.
    vm.unit.write_text(legacy_unit_text(extra="Environment=DASHBOARD_NODE_PROXY_UID=987\n"),
                       encoding="utf-8")
    recorder = Recorder(accounts=("kb-shell",), mirror_unit=vm.unit)
    converge(vm, recorder, lookup_uid=lambda name: None)

    assert vm.unit.read_bytes() == bootstrap_vm.unit_fragment_source(TAILNET_HOST, TAILNET_OPERATOR)
    assert vm.unit.read_bytes().count(b"Environment=DASHBOARD_NODE_PROXY_UID=") == 1
    assert not any(c[0].endswith("useradd") and c[-1] == "kb-shell" for c in recorder.commands)
    assert any(c[0] == "useradd" and c[-1] == "kb-node-proxy" for c in recorder.commands)


# --- CLI ----------------------------------------------------------------------------------------


def test_legacy_flag_only_invocation_still_means_bootstrap(monkeypatch):
    seen = []
    monkeypatch.setattr(bootstrap_vm, "bootstrap", lambda ops_bundle, release_public_key, tailnet_host, tailnet_operator: seen.append(tailnet_host))
    monkeypatch.setattr(sys, "argv", ["bootstrap_vm.py", "--ops-bundle", "o", "--release-public-key", "r",
                                      "--tailnet-host", TAILNET_HOST])
    assert bootstrap_vm.main() == 0
    assert seen == [TAILNET_HOST]


def test_explicit_bootstrap_subcommand_reaches_the_same_call(monkeypatch):
    seen = []
    monkeypatch.setattr(bootstrap_vm, "bootstrap", lambda ops_bundle, release_public_key, tailnet_host, tailnet_operator: seen.append(tailnet_host))
    assert bootstrap_vm.main(["bootstrap", "--ops-bundle", "o", "--release-public-key", "r",
                              "--tailnet-host", TAILNET_HOST]) == 0
    assert seen == [TAILNET_HOST]


def test_upgrade_subcommand_passes_every_path_seam_and_the_dry_run_flag(monkeypatch, vm):
    seen = {}
    monkeypatch.setattr(bootstrap_vm, "upgrade", lambda **kwargs: seen.update(kwargs))
    assert bootstrap_vm.main([
        "upgrade", "--dry-run",
        "--unit-path", str(vm.unit),
        "--install-root", str(vm.install_root),
        "--host-node-map", str(vm.host_node_map),
        "--backup-dir", str(vm.backup_dir),
    ]) == 0
    assert seen == {
        "unit_path": vm.unit,
        "install_root": vm.install_root,
        "host_node_map_path": vm.host_node_map,
        "backup_dir": vm.backup_dir,
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
    assert seen["dry_run"] is False


def test_an_unknown_subcommand_is_refused(monkeypatch):
    with pytest.raises(SystemExit):
        bootstrap_vm.main(["reinstall"])


def test_upgrade_is_reachable_as_a_real_subprocess_dry_run(tmp_path):
    unit = tmp_path / "kb-dashboard.service"
    unit.write_text(legacy_unit_text(), encoding="utf-8")
    install_root = tmp_path / "lib"
    install_root.mkdir()
    (install_root / bootstrap_vm.RELEASE_SIGNING_MODULE).write_text("RELEASE_PUBLIC_KEY = 'x'\n", encoding="ascii")
    result = subprocess.run(
        [sys.executable, str(REPO / "deploy/bootstrap_vm.py"), "upgrade", "--dry-run",
         "--unit-path", str(unit), "--install-root", str(install_root),
         "--host-node-map", str(tmp_path / "absent.json"), "--backup-dir", str(tmp_path)],
        check=True, text=True, capture_output=True)
    assert "would run: useradd --system --uid 987" in result.stdout
    assert f"[upgrade] preserving DASHBOARD_TAILNET_HOST={TAILNET_HOST}" in result.stdout
    # nothing was executed: the unit it was pointed at is byte-for-byte what it was
    assert unit.read_text(encoding="utf-8") == legacy_unit_text()
