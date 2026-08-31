import re
import subprocess
from types import SimpleNamespace
from pathlib import Path, PurePosixPath

import pytest

from deploy import validate_vm_runtime


VALID_UNIT_TEXT = """[Service]
Environment=DASHBOARD_PLATFORM_ROOT=/opt/kb-releases/current
Environment=PYTHONPATH=/opt/kb-releases/current
Environment=DASHBOARD_REPO_ROOT=/var/lib/kb/ops
Environment=DASHBOARD_STATE_ROOT=/var/lib/kb/state
Environment=DASHBOARD_EXECUTION_ACTIVATED=0
Environment=KB_COORDINATION_PUBLICATION=outbox
Environment=KB_VM_RUNTIME=1
Environment=GIT_CONFIG_GLOBAL=/dev/null
Environment=DASHBOARD_AUTH_MODE=tailnet
Environment=DASHBOARD_TAILNET_HOST=kb.command.ts.net
Environment=DASHBOARD_TAILNET_OPERATOR=daniel.zhang.t1@gmail.com
Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN=https://kb-desk.command.ts.net
Environment=DASHBOARD_TAILNET_PROXY_UID=0
Environment=DASHBOARD_NODE_PROXY_UID=987
"""


@pytest.mark.parametrize(
    "value",
    [
        "https://kb.command.ts.net",
        "kb.command.ts.net/path",
        "KB.command.ts.net",
        "kb.command.ts.net:8443",
        "",
    ],
)
def test_effective_unit_rejects_invalid_tailnet_hosts(value):
    text = VALID_UNIT_TEXT.replace(
        "Environment=DASHBOARD_TAILNET_HOST=kb.command.ts.net\n",
        f"Environment=DASHBOARD_TAILNET_HOST={value}\n",
    )
    with pytest.raises(RuntimeError, match="tailnet host"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_effective_unit_rejects_a_non_tailnet_auth_mode():
    text = VALID_UNIT_TEXT.replace(
        "Environment=DASHBOARD_AUTH_MODE=tailnet\n",
        "Environment=DASHBOARD_AUTH_MODE=win32-desktop\n",
    )
    with pytest.raises(RuntimeError, match="auth mode"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_effective_unit_requires_the_pinned_operator():
    # DASHBOARD_TAILNET_OPERATOR is REQUIRED, not optional — a unit missing it fails the closed-set check.
    text = VALID_UNIT_TEXT.replace("Environment=DASHBOARD_TAILNET_OPERATOR=daniel.zhang.t1@gmail.com\n", "")
    with pytest.raises(RuntimeError, match="assignment set is not closed"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_effective_unit_requires_the_desktop_helper_origin():
    # dashboard-v3 P5: DASHBOARD_DESKTOP_HELPER_ORIGIN is a REQUIRED member of the closed unit-env set —
    # a unit missing it fails the closed-set check rather than defaulting to some helper address.
    assert "DASHBOARD_DESKTOP_HELPER_ORIGIN" in validate_vm_runtime.EXPECTED_UNIT_ENV
    text = VALID_UNIT_TEXT.replace(
        "Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN=https://kb-desk.command.ts.net\n", "")
    with pytest.raises(RuntimeError, match="assignment set is not closed"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


@pytest.mark.parametrize("value", ["", "not-an-email", "has space@x.com"])
def test_effective_unit_rejects_an_invalid_operator(value):
    text = VALID_UNIT_TEXT.replace(
        "Environment=DASHBOARD_TAILNET_OPERATOR=daniel.zhang.t1@gmail.com\n",
        f"Environment=DASHBOARD_TAILNET_OPERATOR={value}\n",
    )
    with pytest.raises(RuntimeError, match="tailnet operator|assignment set is not closed"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


@pytest.mark.parametrize("name", ["DASHBOARD_RP_ORIGIN", "DASHBOARD_WEBAUTHN_CREDENTIALS"])
def test_effective_unit_rejects_retired_webauthn_environment(name):
    """Tailnet mode retires the WebAuthn unit channel; a unit still carrying it is stale, not optional."""
    text = VALID_UNIT_TEXT + f"Environment={name}=whatever\n"
    with pytest.raises(RuntimeError):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def valid_static_unit():
    return {
        "Id": "kb-dashboard.service",
        "Names": "kb-dashboard.service",
        "Slice": "system.slice",
        "FragmentPath": "/etc/systemd/system/kb-dashboard.service",
        "DropInPaths": "",
        "User": "kb-dashboard",
        "Group": "kb-dashboard",
        "ExecStart": "{ path=/usr/bin/node ; argv[]=/usr/bin/node --experimental-strip-types server/index.ts ; }",
        "WorkingDirectory": "/opt/kb-releases/current/dashboard",
        "EnvironmentFiles": "",
        "UnsetEnvironment": "GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET KB_CANARY_SESSION",
        "KillMode": "control-group",
        "ReadOnlyPaths": "/opt/kb-releases",
        "ReadWritePaths": "/var/lib/kb/state /var/lib/kb/ops",
    }


@pytest.mark.parametrize("name", ["GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK", "DASHBOARD_SESSION_SECRET", "KB_CANARY_SESSION", "OPENAI_API_KEY", "AWS_ACCESS_KEY_ID", "MY_TOKEN"])
def test_vm_validation_rejects_credential_channels(name, tmp_path):
    with pytest.raises(RuntimeError, match=name):
        validate_vm_runtime.validate_environment({name: "present"})


def test_environment_refusal_does_not_print_values():
    with pytest.raises(RuntimeError) as refusal:
        validate_vm_runtime.validate_environment({"OPENAI_API_KEY": "must-not-leak"})
    assert "must-not-leak" not in str(refusal.value)


def test_ops_checkout_is_data_only(tmp_path):
    (tmp_path / "scripts").mkdir()
    with pytest.raises(RuntimeError, match="platform path"):
        validate_vm_runtime.validate_ops_root(tmp_path)


def test_ops_checkout_requires_disabled_push_remote(tmp_path, monkeypatch):
    calls = []

    def run(*args, **kwargs):
        calls.append((args[0], kwargs))
        return subprocess.CompletedProcess(args[0], 0, stdout="ssh://write-enabled\n")

    monkeypatch.setattr(validate_vm_runtime.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="push remote"):
        validate_vm_runtime.validate_ops_root(tmp_path)
    assert calls[0][0][:3] == ["git", "-c", "safe.directory=/var/lib/kb/ops"]
    assert calls[0][1]["timeout"] > 0


def test_ops_git_identity_is_present():
    calls = []
    root = PurePosixPath("/var/lib/kb/ops")

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        values = {"user.email": "kb-dashboard@agents.local\n", "user.name": "kb-dashboard\n"}
        return subprocess.CompletedProcess(argv, 0, stdout=values[argv[-1]])

    validate_vm_runtime.validate_ops_git_identity(root, run=run)

    assert calls == [
        (["git", "-C", "/var/lib/kb/ops", "config", "--get", "user.email"], {"check": True, "text": True, "capture_output": True, "timeout": validate_vm_runtime.COMMAND_TIMEOUT}),
        (["git", "-C", "/var/lib/kb/ops", "config", "--get", "user.name"], {"check": True, "text": True, "capture_output": True, "timeout": validate_vm_runtime.COMMAND_TIMEOUT}),
    ]


@pytest.mark.parametrize("key", ["user.email", "user.name"])
def test_ops_git_identity_rejects_empty_values(key):
    def run(argv, **kwargs):
        value = " \n" if argv[-1] == key else "kb-dashboard@agents.local\n"
        return subprocess.CompletedProcess(argv, 0, stdout=value)

    with pytest.raises(RuntimeError, match=key):
        validate_vm_runtime.validate_ops_git_identity(PurePosixPath("/var/lib/kb/ops"), run=run)


@pytest.mark.parametrize("key", ["user.email", "user.name"])
def test_ops_git_identity_rejects_missing_values(key):
    def run(argv, **kwargs):
        if argv[-1] == key:
            raise subprocess.CalledProcessError(1, argv)
        return subprocess.CompletedProcess(argv, 0, stdout="kb-dashboard@agents.local\n")

    with pytest.raises(RuntimeError, match=key):
        validate_vm_runtime.validate_ops_git_identity(PurePosixPath("/var/lib/kb/ops"), run=run)


def test_outbox_mode_requires_initialized_anchor(tmp_path):
    calls = []

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 1)

    with pytest.raises(RuntimeError, match="outbox anchor refs/kb-outbox/spooled is absent"):
        validate_vm_runtime.validate_outbox_anchor(tmp_path, run=run)
    assert calls == [(["git", "show-ref", "--verify", "--quiet", "refs/kb-outbox/spooled"], {"cwd": tmp_path})]


def test_releases_root_must_be_root_owned_0755():
    validate_vm_runtime.validate_releases_root(SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o40755))
    with pytest.raises(RuntimeError, match="root:root 0755"):
        validate_vm_runtime.validate_releases_root(SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=0o40755))


def test_effective_unit_rejects_dropins_and_wrong_kill_mode():
    show = valid_static_unit()
    show["DropInPaths"] = "/etc/systemd/system/kb-dashboard.service.d/override.conf"
    with pytest.raises(RuntimeError, match="drop-ins"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)
    show = valid_static_unit(); show["KillMode"] = "process"
    with pytest.raises(RuntimeError, match="KillMode"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)


def test_effective_unit_must_use_the_local_outbox():
    show = valid_static_unit()
    with pytest.raises(RuntimeError, match="outbox publication"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT.replace("KB_COORDINATION_PUBLICATION=outbox", "KB_COORDINATION_PUBLICATION=github"))


def test_effective_unit_must_enable_vm_runtime():
    show = valid_static_unit()
    text = VALID_UNIT_TEXT.replace("KB_VM_RUNTIME=1", "KB_VM_RUNTIME=0")
    with pytest.raises(RuntimeError, match="VM runtime") as refusal:
        validate_vm_runtime.validate_static_unit(show, text)
    assert "0" not in str(refusal.value)


def test_effective_unit_rejects_environment_files():
    show = valid_static_unit()
    show["EnvironmentFiles"] = "/etc/kb-dashboard/session.env"
    with pytest.raises(RuntimeError, match="environment files"):
        validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)


def test_effective_unit_parses_every_assignment_on_environment_line():
    text = VALID_UNIT_TEXT.replace(
        "Environment=GIT_CONFIG_GLOBAL=/dev/null",
        'Environment="GIT_CONFIG_GLOBAL=/dev/null" "OPENAI_API_KEY=must-not-leak"',
    )
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY") as refusal:
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)
    assert "must-not-leak" not in str(refusal.value)


def test_fake_systemctl_dropin_is_refused():
    def run(argv, **kwargs):
        if argv[1] == "show":
            name = argv[2].split("=", 1)[1]
            value = valid_static_unit()[name]
            if name == "DropInPaths":
                value = "/etc/systemd/system/kb-dashboard.service.d/malicious.conf"
            return subprocess.CompletedProcess(argv, 0, stdout=value + "\n")
        return subprocess.CompletedProcess(argv, 0, stdout=VALID_UNIT_TEXT + "\n# /etc/systemd/system/kb-dashboard.service.d/malicious.conf\nEnvironment=OPENAI_API_KEY=not-a-real-value\n")

    show, text = validate_vm_runtime.read_static_unit("kb-dashboard.service", run=run)
    with pytest.raises(RuntimeError, match="drop-ins"):
        validate_vm_runtime.validate_static_unit(show, text)


def test_static_phase_accepts_inactive_unit_without_a_control_group():
    show = valid_static_unit()
    assert "ControlGroup" not in show
    validate_vm_runtime.validate_static_unit(show, VALID_UNIT_TEXT)


def test_static_phase_accepts_the_tailnet_unit():
    validate_vm_runtime.validate_static_unit(valid_static_unit(), VALID_UNIT_TEXT)


def test_static_phase_requires_both_proxy_uid_envs_in_the_closed_set():
    # dashboard-v3 P6 §3.3: both proxy-uid envs are now REQUIRED members of EXPECTED_UNIT_ENV, not optional.
    assert "DASHBOARD_TAILNET_PROXY_UID" in validate_vm_runtime.EXPECTED_UNIT_ENV
    assert "DASHBOARD_NODE_PROXY_UID" in validate_vm_runtime.EXPECTED_UNIT_ENV
    for name in ("DASHBOARD_TAILNET_PROXY_UID", "DASHBOARD_NODE_PROXY_UID"):
        text = VALID_UNIT_TEXT.replace(f"Environment={name}=", f"Environment=UNUSED_{name}=")
        with pytest.raises(RuntimeError, match="assignment set is not closed"):
            validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


@pytest.mark.parametrize("node_uid,tailnet_uid,message", [
    ("0", "0", "DASHBOARD_NODE_PROXY_UID"),          # node uid 0 lets root serve satisfy the node peer check
    ("987", "0", None),                              # the valid pinned pair
    ("1000", "1000", "DASHBOARD_TAILNET_PROXY_UID"), # non-zero tailnet uid is refused first (must be 0)
    ("987", "1000", "DASHBOARD_TAILNET_PROXY_UID"),  # tailnet uid must be 0
])
def test_static_phase_enforces_the_pairwise_proxy_uid_rule(node_uid, tailnet_uid, message):
    text = (VALID_UNIT_TEXT
            .replace("Environment=DASHBOARD_NODE_PROXY_UID=987\n", f"Environment=DASHBOARD_NODE_PROXY_UID={node_uid}\n")
            .replace("Environment=DASHBOARD_TAILNET_PROXY_UID=0\n", f"Environment=DASHBOARD_TAILNET_PROXY_UID={tailnet_uid}\n"))
    if message is None:
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)
    else:
        with pytest.raises(RuntimeError, match=message):
            validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_static_phase_rejects_dev_origin_under_ambient_tailnet_auth():
    # A dev origin allowlisted under ambient auth would grant operator authority to any page on it.
    text = VALID_UNIT_TEXT + "Environment=DASHBOARD_DEV_ORIGIN=http://localhost:4317\n"
    with pytest.raises(RuntimeError, match="assignment set is not closed"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_static_phase_rejects_other_credential_named_unit_environment():
    for name in ("DASHBOARD_SESSION_SECRET", "MY_TOKEN"):
        text = VALID_UNIT_TEXT + f"Environment={name}=present\n"
        with pytest.raises(RuntimeError, match=name):
            validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_environment_has_no_sanctioned_credential_exemption_left():
    """With the WebAuthn public-key channel retired, CREDENTIAL_ENV_NAME applies without exception."""
    with pytest.raises(RuntimeError, match="DASHBOARD_WEBAUTHN_CREDENTIALS"):
        validate_vm_runtime.validate_environment({"DASHBOARD_WEBAUTHN_CREDENTIALS": "anything"})


def test_environment_accepts_the_tailnet_names():
    validate_vm_runtime.validate_environment({"DASHBOARD_AUTH_MODE": "tailnet", "DASHBOARD_TAILNET_HOST": "kb.ts.net"})


def test_effective_unit_still_refuses_a_ninth_unknown_environment_name():
    text = VALID_UNIT_TEXT + "Environment=UNSANCTIONED_NINTH_NAME=1\n"
    with pytest.raises(RuntimeError, match="assignment set is not closed"):
        validate_vm_runtime.validate_static_unit(valid_static_unit(), text)


def test_broker_units_absent_is_tolerated_but_a_drifted_installed_pair_is_refused(tmp_path):
    """A VM bootstrapped before the broker existed still starts; a weakened broker unit does not."""
    repo = Path(__file__).parents[1] / "deploy/systemd"
    assert validate_vm_runtime.validate_broker_units(tmp_path) is False
    for name in ("kb-shell-broker.service", "kb-shell-broker.socket"):
        (tmp_path / name).write_text((repo / name).read_text(encoding="utf-8"), encoding="utf-8")
    assert validate_vm_runtime.validate_broker_units(tmp_path) is True
    drifted = (tmp_path / "kb-shell-broker.service")
    drifted.write_text(drifted.read_text(encoding="utf-8").replace(
        "ProtectSystem=strict", "ProtectSystem=full"), encoding="utf-8")
    with pytest.raises(RuntimeError, match="directive set drifted"):
        validate_vm_runtime.validate_broker_units(tmp_path)


REPO = Path(__file__).resolve().parents[1]
TS_POLICY = REPO / "dashboard/server/pty/fdPinnedPaths.ts"


def _typescript_broker_policy() -> dict[str, dict[str, str]]:
    """Parse `BROKER_SYSTEMD_POLICY` out of the TypeScript source.

    Textual on purpose: a JSON export would need a build step to stay current, and the whole point
    of this test is to compare what a human edits in each of the three files.
    """
    text = TS_POLICY.read_text(encoding="utf-8")
    constants = dict(re.findall(r"^export const ([A-Z_]+) = '([^']*)';$", text, re.MULTILINE))
    body = re.search(r"export const BROKER_SYSTEMD_POLICY = \{\n(.*?)\n\} as const;", text, re.S)
    assert body is not None, "BROKER_SYSTEMD_POLICY literal not found in fdPinnedPaths.ts"
    sections: dict[str, dict[str, str]] = {}
    for name, block in re.findall(r"^  (\w+): \{\n(.*?)\n  \},$", body.group(1), re.S | re.MULTILINE):
        entries: dict[str, str] = {}
        for key, quoted, identifier in re.findall(
                r"^    (\w+): (?:'([^']*)'|([A-Za-z_][A-Za-z0-9_]*)),$", block, re.MULTILINE):
            entries[key] = quoted if not identifier else constants[identifier]
        entries.pop("", None)
        sections[name] = entries
    return sections


@pytest.mark.parametrize("unit,section,expected_key", [
    ("kb-shell-broker.service", "Service", "service"),
    ("kb-shell-broker.socket", "Socket", "socket"),
])
def test_the_frozen_broker_policy_is_identical_in_all_three_copies(unit, section, expected_key):
    """unit file == validate_vm_runtime BROKER_*_DIRECTIVES == TypeScript BROKER_SYSTEMD_POLICY.

    Three files carry the frozen sandbox contract, and the comment above the Python dicts calls them
    the single source of truth. That is only true if drift in any one of them is a red test.
    """
    text = (REPO / "deploy/systemd" / unit).read_text(encoding="utf-8")
    from_unit = dict(validate_vm_runtime.parse_unit(text)[section])
    from_python = (validate_vm_runtime.BROKER_SERVICE_DIRECTIVES if section == "Service"
                   else validate_vm_runtime.BROKER_SOCKET_DIRECTIVES)
    from_typescript = _typescript_broker_policy()[expected_key]
    assert from_unit == dict(from_python)
    assert from_typescript == dict(from_python)
    assert from_typescript == from_unit


def test_the_broker_units_carry_the_ruled_directive_values():
    """The values the boss ruled on, pinned by name so a silent revert is visible."""
    service = validate_vm_runtime.BROKER_SERVICE_DIRECTIVES
    socket = validate_vm_runtime.BROKER_SOCKET_DIRECTIVES
    dashboard = (REPO / "deploy/systemd/kb-dashboard.service").read_text(encoding="utf-8")
    assert service["PrivateTmp"] == "yes"
    assert service["UnsetEnvironment"] == dict(
        validate_vm_runtime.parse_unit(dashboard)["Service"])["UnsetEnvironment"]
    assert service["ReadWritePaths"] == "/var/lib/kb-shell/worktrees /run/kb-shell /var/lib/kb-shell/home/.claude /var/lib/kb-shell/home/.codex"
    # The provider CLIs must be able to persist their own state under the read-only home.
    assert service["ReadOnlyPaths"] == "/var/lib/kb/ops /var/lib/kb-shell/home"
    for carved in ("/var/lib/kb-shell/home/.claude", "/var/lib/kb-shell/home/.codex"):
        assert carved in service["ReadWritePaths"].split()
    assert "RuntimeDirectory" not in service and "RuntimeDirectoryMode" not in service
    assert (socket["User"], socket["Group"]) == ("kb-shell", "kb-dashboard")
    assert socket["RuntimeDirectoryMode"] == "0750"
    assert socket["RuntimeDirectoryPreserve"] == "restart"
    # Socket-activated only: the service must carry no [Install] section to enable.
    assert validate_vm_runtime.BROKER_SERVICE_SECTIONS == {"Unit", "Service"}
    # [C-S4]: the dashboard needs the kb-shell group to reach /var/lib/kb-shell/worktrees.
    assert "SupplementaryGroups=kb-shell" in dashboard


@pytest.mark.parametrize("unit,injected", [
    ("kb-shell-broker.service", ("[Unit]", "[Unit]\nOnFailure=kb-panic.service")),
    ("kb-shell-broker.service", ("Requires=kb-shell-broker.socket", "")),
    ("kb-shell-broker.service", ("RestrictSUIDSGID=yes", "RestrictSUIDSGID=yes\n\n[Install]\nWantedBy=multi-user.target")),
    ("kb-shell-broker.socket", ("[Unit]", "[Unit]\nConditionPathExists=/tmp/x")),
    ("kb-shell-broker.socket", ("WantedBy=sockets.target", "WantedBy=sockets.target\nAlias=kb.socket")),
])
def test_the_unit_and_install_sections_are_set_equal_too(unit, injected):
    """Sandbox sections were exact; [Unit] and [Install] were only name-checked."""
    text = (REPO / "deploy/systemd" / unit).read_text(encoding="utf-8").replace(*injected)
    validator = (validate_vm_runtime.validate_broker_service if unit.endswith(".service")
                 else validate_vm_runtime.validate_broker_socket)
    with pytest.raises(RuntimeError):
        validator(text)


def test_a_comment_may_explain_privilege_escalation_without_failing_the_unit():
    """The scan reads directives, not prose: `# no sudo here` must not fail a frozen unit."""
    text = (REPO / "deploy/systemd/kb-shell-broker.service").read_text(encoding="utf-8")
    validate_vm_runtime.validate_broker_service(
        "# there is deliberately no sudo, no setuid, and no pkexec in this unit\n" + text)
    with pytest.raises(RuntimeError, match="privilege-escalation token"):
        validate_vm_runtime._assert_no_privilege_escalation(
            text.replace("Restart=on-failure", "Restart=/usr/bin/sudo"), "kb-shell-broker.service")


def test_live_phase_requires_service_cgroup_and_current_release_cwd(tmp_path):
    current = tmp_path / "releases" / "current"
    expected_cwd = current / "dashboard"
    expected_cwd.mkdir(parents=True)
    seen = []

    def resolve_proc_cwd(path):
        seen.append(path)
        return expected_cwd

    validate_vm_runtime.validate_live_unit(
        {"ControlGroup": "/system.slice/kb-dashboard.service", "MainPID": "4317"},
        current,
        resolve_proc_cwd=resolve_proc_cwd,
    )
    assert seen == [Path("/proc/4317/cwd")]

    with pytest.raises(RuntimeError, match="working directory"):
        validate_vm_runtime.validate_live_unit(
            {"ControlGroup": "/system.slice/kb-dashboard.service", "MainPID": "4317"},
            current,
            resolve_proc_cwd=lambda _path: tmp_path / "wrong" / "dashboard",
        )


# --- P6 node-proxy + WhoIs frozen units + validators -------------------------------------------

import stat as stat_module
from types import SimpleNamespace

SYSTEMD = REPO / "deploy/systemd"
NODE_WHOIS_UNITS = {
    "kb-node-proxy.service": validate_vm_runtime.validate_node_proxy_service,
    "kb-whois.service": validate_vm_runtime.validate_whois_service,
    "kb-whois.socket": validate_vm_runtime.validate_whois_socket,
}


@pytest.mark.parametrize("table_name", list(validate_vm_runtime.NODE_WHOIS_FROZEN_TABLES))
def test_the_eight_frozen_tables_match_the_shipped_unit_section(table_name):
    """Each of the eight frozen tables is set-equal to its unit-file section (pairwise-exact)."""
    unit, section, expected = validate_vm_runtime.NODE_WHOIS_FROZEN_TABLES[table_name]
    text = (SYSTEMD / unit).read_text(encoding="utf-8")
    from_unit = dict(validate_vm_runtime.parse_unit(text)[section])
    assert from_unit == dict(expected)


@pytest.mark.parametrize("unit,validator", list(NODE_WHOIS_UNITS.items()))
def test_the_shipped_node_whois_units_validate_clean(unit, validator):
    validator((SYSTEMD / unit).read_text(encoding="utf-8"))


@pytest.mark.parametrize("unit,validator,injected", [
    ("kb-node-proxy.service", validate_vm_runtime.validate_node_proxy_service, ("NoNewPrivileges=yes", "NoNewPrivileges=yes\nProtectClock=yes")),
    ("kb-node-proxy.service", validate_vm_runtime.validate_node_proxy_service, ("ProtectHome=yes\n", "")),
    ("kb-node-proxy.service", validate_vm_runtime.validate_node_proxy_service, ("[Install]", "[Install]\nAlias=x.service")),
    ("kb-node-proxy.service", validate_vm_runtime.validate_node_proxy_service, ("[Unit]", "[Unit]\nOnFailure=kb-panic.service")),
    ("kb-whois.service", validate_vm_runtime.validate_whois_service, ("RestrictAddressFamilies=AF_UNIX", "RestrictAddressFamilies=AF_UNIX AF_INET")),
    ("kb-whois.service", validate_vm_runtime.validate_whois_service, ("ReadWritePaths=/run/kb-whois\n", "ReadWritePaths=/run/kb-whois\n\n[Install]\nWantedBy=multi-user.target")),
    ("kb-whois.socket", validate_vm_runtime.validate_whois_socket, ("SocketMode=0660", "SocketMode=0666")),
    ("kb-whois.socket", validate_vm_runtime.validate_whois_socket, ("Group=kb-node-proxy\n", "")),
    ("kb-whois.socket", validate_vm_runtime.validate_whois_socket, ("DirectoryMode=0750\n", "")),
])
def test_an_added_or_dropped_directive_fails_each_frozen_table(unit, validator, injected):
    text = (SYSTEMD / unit).read_text(encoding="utf-8").replace(*injected)
    with pytest.raises(RuntimeError):
        validator(text)


def test_node_proxy_forbidden_set_is_directive_names_only_and_confinement_is_required():
    forbidden = validate_vm_runtime.NODE_PROXY_SERVICE_FORBIDDEN
    # NAMES only — a name=value member could never intersect present, so none may carry '='.
    assert all("=" not in name for name in forbidden)
    # The loopback-hop confinement is REQUIRED here, the inverse of the broker: it must NOT be forbidden.
    for required in ("RestrictAddressFamilies", "IPAddressDeny", "IPAddressAllow"):
        assert required not in forbidden
        assert required in validate_vm_runtime.NODE_PROXY_SERVICE_DIRECTIVES
    assert set(forbidden) == {"PrivateNetwork", "ListenStream", "SupplementaryGroups", "AmbientCapabilities"}


def test_node_proxy_forbids_a_supplementary_group_join():
    # A SupplementaryGroups= join is rejected. Every section is set-equality-frozen, so an added directive
    # trips that check; the names-only forbidden tuple is the second wall (see the tuple-contents test).
    text = (SYSTEMD / "kb-node-proxy.service").read_text(encoding="utf-8").replace(
        "CapabilityBoundingSet=", "SupplementaryGroups=tailscale\nCapabilityBoundingSet=")
    with pytest.raises(RuntimeError, match="drifted|forbidden"):
        validate_vm_runtime.validate_node_proxy_service(text)


def test_node_proxy_user_is_its_own_nologin_account_and_shim_pair_is_root_plus_group():
    directives = validate_vm_runtime.NODE_PROXY_SERVICE_DIRECTIVES
    assert directives["User"] == "kb-node-proxy" and directives["Group"] == "kb-node-proxy"
    assert "SupplementaryGroups" not in directives
    assert validate_vm_runtime.WHOIS_SERVICE_DIRECTIVES["User"] == "root"
    socket = validate_vm_runtime.WHOIS_SOCKET_DIRECTIVES
    assert (socket["User"], socket["Group"]) == ("root", "kb-node-proxy")
    assert socket["SocketGroup"] == "kb-node-proxy" and socket["SocketMode"] == "0660"
    assert socket["DirectoryMode"] == "0750"
    # The nologin shell is asserted on the account at provisioning (bootstrap); the unit runs as that user.


def test_whois_service_has_no_install_section_and_no_listener():
    assert validate_vm_runtime.WHOIS_SERVICE_SECTIONS == {"Unit", "Service"}
    text = (SYSTEMD / "kb-whois.service").read_text(encoding="utf-8")
    sections = validate_vm_runtime.parse_unit(text)  # comments dropped, so directives only
    assert set(sections) == {"Unit", "Service"}
    directive_names = {key for pairs in sections.values() for key, _ in pairs}
    assert "ListenStream" not in directive_names


def test_shim_socket_path_is_pinned_in_the_frozen_service_table():
    assert validate_vm_runtime.TAILSCALED_SOCKET_PATH == "/var/run/tailscale/tailscaled.sock"
    assert validate_vm_runtime.TAILSCALED_SOCKET_PATH in validate_vm_runtime.WHOIS_SERVICE_DIRECTIVES["ExecStart"]


def test_node_whois_units_absent_is_tolerated_but_a_drifted_trio_is_refused(tmp_path):
    assert validate_vm_runtime.validate_node_proxy_units(tmp_path) is False
    for name in NODE_WHOIS_UNITS:
        (tmp_path / name).write_text((SYSTEMD / name).read_text(encoding="utf-8"), encoding="utf-8")
    assert validate_vm_runtime.validate_node_proxy_units(tmp_path) is True
    drifted = tmp_path / "kb-whois.socket"
    drifted.write_text(drifted.read_text(encoding="utf-8").replace("SocketMode=0660", "SocketMode=0666"), encoding="utf-8")
    with pytest.raises(RuntimeError):
        validate_vm_runtime.validate_node_proxy_units(tmp_path)


def test_node_whois_units_must_be_installed_as_a_trio(tmp_path):
    (tmp_path / "kb-node-proxy.service").write_text((SYSTEMD / "kb-node-proxy.service").read_text(encoding="utf-8"), encoding="utf-8")
    with pytest.raises(RuntimeError, match="trio"):
        validate_vm_runtime.validate_node_proxy_units(tmp_path)


def test_whois_runtime_dir_must_be_root_kb_node_proxy_0750_and_socket_0660():
    gid = 987
    validate_vm_runtime.validate_whois_runtime_dir(
        SimpleNamespace(st_uid=0, st_gid=gid, st_mode=0o040750),
        SimpleNamespace(st_uid=0, st_gid=gid, st_mode=stat_module.S_IFSOCK | 0o660), gid)
    with pytest.raises(RuntimeError, match="0750"):
        validate_vm_runtime.validate_whois_runtime_dir(
            SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o040750),
            SimpleNamespace(st_uid=0, st_gid=gid, st_mode=stat_module.S_IFSOCK | 0o660), gid)
    with pytest.raises(RuntimeError, match="0660"):
        validate_vm_runtime.validate_whois_runtime_dir(
            SimpleNamespace(st_uid=0, st_gid=gid, st_mode=0o040750),
            SimpleNamespace(st_uid=0, st_gid=gid, st_mode=stat_module.S_IFSOCK | 0o666), gid)


def test_pinned_tailscaled_socket_must_exist_and_be_a_socket():
    validate_vm_runtime.validate_tailscaled_socket(SimpleNamespace(st_mode=stat_module.S_IFSOCK | 0o660))
    with pytest.raises(RuntimeError, match="is not a socket"):
        validate_vm_runtime.validate_tailscaled_socket(SimpleNamespace(st_mode=stat_module.S_IFREG | 0o644))


@pytest.mark.parametrize("prefs,fails", [
    ('{"OperatorUser":""}', False),
    ('{"OperatorUser":"kb-node-proxy"}', True),
    ("OperatorUser = kb-node-proxy", True),
])
def test_tailscale_prefs_must_show_no_operator_user(prefs, fails):
    def run(argv, **kwargs):
        assert argv[:3] == [validate_vm_runtime.TAILSCALE_BINARY, "debug", "prefs"]
        return subprocess.CompletedProcess(argv, 0, stdout=prefs)
    if fails:
        with pytest.raises(RuntimeError, match="OperatorUser"):
            validate_vm_runtime.validate_no_operator_pref(run=run)
    else:
        validate_vm_runtime.validate_no_operator_pref(run=run)


def test_no_operator_grant_string_exists_anywhere_in_deploy():
    """kb-node-proxy holds no tailnet rights: `tailscale set --operator` must appear nowhere in deploy/."""
    for path in (REPO / "deploy").rglob("*"):
        if path.is_file() and path.suffix in {".py", ".service", ".socket", ".sh"}:
            assert "set --operator" not in path.read_text(encoding="utf-8", errors="ignore")


VALID_SERVE_STATUS = {
    "TCP": {"443": {"HTTPS": True}, "8444": {"HTTPS": True}},
    "Web": {"kb.command.ts.net:8444": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:4319"}}}},
}


def test_listener_uid_validator_requires_two_listeners_and_a_matching_uid():
    validate_vm_runtime.validate_node_listener_and_uid(VALID_SERVE_STATUS, node_proxy_uid=987, expected_node_uid=987)


def test_listener_uid_validator_fails_a_single_listener_config():
    single = {"TCP": {"443": {"HTTPS": True}}, "Web": {}}
    with pytest.raises(RuntimeError, match="single-listener|two serve listeners"):
        validate_vm_runtime.validate_node_listener_and_uid(single, node_proxy_uid=987, expected_node_uid=987)


def test_listener_uid_validator_fails_a_wrong_backend_or_uid_mismatch():
    wrong_backend = {"TCP": {"443": {}, "8444": {}}, "Web": {"h:8444": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:9999"}}}}}
    with pytest.raises(RuntimeError, match="node proxy port"):
        validate_vm_runtime.validate_node_listener_and_uid(wrong_backend, node_proxy_uid=987, expected_node_uid=987)
    with pytest.raises(RuntimeError, match="uid does not match"):
        validate_vm_runtime.validate_node_listener_and_uid(VALID_SERVE_STATUS, node_proxy_uid=1000, expected_node_uid=987)


def test_main_static_phase_validates_the_node_proxy_units():
    import inspect
    assert "validate_node_proxy_units()" in inspect.getsource(validate_vm_runtime.main)
