from __future__ import annotations

import argparse
import os
import re
import shlex
import stat
import subprocess
from pathlib import Path


FORBIDDEN_ENV = frozenset({"GITHUB_TOKEN", "GH_TOKEN", "GIT_ASKPASS", "SSH_AUTH_SOCK", "DASHBOARD_SESSION_SECRET", "KB_CANARY_SESSION"})
CREDENTIAL_ENV_NAME = re.compile(r"(?i)(?:TOKEN|SECRET|PASSWORD|PASSKEY|CREDENTIAL|API_KEY|ACCESS_KEY|AUTH_SOCK|ASKPASS|COOKIE|SESSION)")
# The VM runs the tailnet-trust auth mode (docs/superpowers/specs/2026-08-18-tailnet-trust-mode-design.md).
# DASHBOARD_AUTH_MODE is static in the repo unit; DASHBOARD_TAILNET_HOST is injected at bootstrap. Both are
# REQUIRED — without the host the daemon refuses to start, and asserting it here turns that into one loud
# ExecStartPre failure instead of a restart loop.
EXPECTED_UNIT_ENV = {"DASHBOARD_PLATFORM_ROOT", "PYTHONPATH", "DASHBOARD_REPO_ROOT", "DASHBOARD_STATE_ROOT", "DASHBOARD_EXECUTION_ACTIVATED", "KB_COORDINATION_PUBLICATION", "KB_VM_RUNTIME", "GIT_CONFIG_GLOBAL", "DASHBOARD_AUTH_MODE", "DASHBOARD_TAILNET_HOST", "DASHBOARD_TAILNET_OPERATOR"}
OPTIONAL_UNIT_ENV = {"DASHBOARD_TAILNET_PROXY_UID"}
# DASHBOARD_TAILNET_OPERATOR is REQUIRED (Daniel, 2026-08-18), not optional: tailnet membership on this VM
# is root-equivalent, so the operator identity must be pinned rather than defaulting to "any tailnet
# principal". DASHBOARD_DEV_ORIGIN is deliberately NOT here at all: it is a win32-desktop-only convenience,
# and under tailnet's AMBIENT auth an allowlisted dev origin would grant operator authority to any page
# served from it. A unit that sets it fails the closed-set check.
TAILNET_OPERATOR_PATTERN = re.compile(r"^\S+@\S+$")
# DASHBOARD_RP_ORIGIN and DASHBOARD_WEBAUTHN_CREDENTIALS are deliberately in NEITHER set. Tailnet mode
# retires the WebAuthn unit channel, so a unit still carrying them is stale drift and must FAIL the
# closed-set check rather than be tolerated. With no sanctioned public-key name left, CREDENTIAL_ENV_NAME
# now applies without exception — which is what rejects a lingering DASHBOARD_WEBAUTHN_CREDENTIALS.
TAILNET_HOST_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
EXPECTED_AUTH_MODE = "tailnet"
STATIC_SHOW = {"Id", "Names", "Slice", "FragmentPath", "DropInPaths", "User", "Group", "ExecStart", "WorkingDirectory", "EnvironmentFiles", "UnsetEnvironment", "KillMode", "ReadOnlyPaths", "ReadWritePaths"}
LIVE_SHOW = {"ControlGroup", "MainPID"}
COMMAND_TIMEOUT = 30

# --- PTY broker units -------------------------------------------------------------------------
# The frozen Linux sandbox contract of the dashboard-v3 design, section 3 ("Launcher and filesystem
# policy"). These dictionaries are the single source of truth, and that is enforced rather than
# asserted: deploy/systemd/kb-shell-broker.* is validated against them here, and
# tests/test_validate_vm_runtime.py compares these dicts, the unit files, and the TypeScript
# BROKER_SYSTEMD_POLICY pairwise, so a directive cannot drift in only one of the three copies.
BROKER_UNIT_ROOT = Path("/etc/systemd/system")
BROKER_SERVICE_UNIT = "kb-shell-broker.service"
BROKER_SOCKET_UNIT = "kb-shell-broker.socket"
BROKER_SOCKET_PATH = "/run/kb-shell/broker.sock"
BROKER_EXEC_START = ("/usr/bin/node /opt/kb-shell-broker/current/main.js --socket-fd=3"
                     " --protocol-version=kb-shell-broker/v1")
BROKER_SERVICE_DIRECTIVES = {
    "Type": "simple",
    "User": "kb-shell",
    "Group": "kb-shell",
    "WorkingDirectory": "/var/lib/kb-shell/home",
    "ExecStart": BROKER_EXEC_START,
    "Restart": "on-failure",
    "KillMode": "control-group",
    "TimeoutStopSec": "90",
    "NoNewPrivileges": "yes",
    "UnsetEnvironment": ("GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET"
                         " KB_CANARY_SESSION"),
    "PrivateTmp": "yes",
    "ProtectSystem": "strict",
    "ReadOnlyPaths": "/var/lib/kb/ops /var/lib/kb-shell/home",
    "ReadWritePaths": "/var/lib/kb-shell/worktrees /run/kb-shell",
    "InaccessiblePaths": "/var/lib/kb/state /opt/kb-releases /var/lib/kb-activation",
    "CapabilityBoundingSet": "",
    "AmbientCapabilities": "",
    "RestrictSUIDSGID": "yes",
}
BROKER_SOCKET_DIRECTIVES = {
    "ListenStream": BROKER_SOCKET_PATH,
    "Accept": "no",
    "SocketUser": "kb-dashboard",
    "SocketGroup": "kb-dashboard",
    "SocketMode": "0600",
    "DirectoryMode": "0750",
    "RemoveOnStop": "yes",
    "User": "kb-shell",
    "Group": "kb-dashboard",
    "RuntimeDirectory": "kb-shell",
    "RuntimeDirectoryMode": "0750",
    "RuntimeDirectoryPreserve": "restart",
}
# [Unit] and [Install] are set-equality-checked too: without this an OnFailure=, ConditionPathExists=,
# JoinsNamespaceOf= or an extra Alias=/WantedBy= slips into a file advertised as exact.
BROKER_SERVICE_UNIT_SECTION = {
    "Description": "kb shell broker (PTY host for the kb dashboard)",
    "Requires": BROKER_SOCKET_UNIT,
    "After": BROKER_SOCKET_UNIT,
}
# Socket-activated ONLY: nothing enables the service, so it carries no [Install] section at all.
BROKER_SERVICE_SECTIONS = {"Unit", "Service"}
BROKER_SOCKET_UNIT_SECTION = {
    "Description": "kb shell broker socket",
    "PartOf": BROKER_SERVICE_UNIT,
}
BROKER_SOCKET_INSTALL_SECTION = {"WantedBy": "sockets.target"}
# Each absence is load-bearing, so each is asserted rather than merely omitted:
# RestrictAddressFamilies would cut the Claude/Codex children off from the provider network;
# ProtectProc/ProcSubset would break the fd-pinned launcher's /proc/self/fd/<n> exec;
# RuntimeDirectory* on the service would chown /run/kb-shell away from the kb-dashboard group.
BROKER_SERVICE_FORBIDDEN = ("RestrictAddressFamilies", "ProtectProc", "ProcSubset",
                            "RuntimeDirectory", "RuntimeDirectoryMode", "PrivateNetwork",
                            "IPAddressDeny", "IPAddressAllow", "SetCredential", "LoadCredential",
                            "PermissionsStartOnly", "ExecStartPre", "ExecStartPost")
BROKER_LISTEN_DIRECTIVES = ("ListenStream", "ListenDatagram", "ListenSequentialPacket", "ListenFIFO",
                            "ListenSpecial", "ListenNetlink", "ListenMessageQueue",
                            "ListenUSBFunction")
BROKER_PRIVILEGE_TOKENS = ("sudo", "setuid", "setgid", "pkexec", "su ")


def validate_environment(env: dict[str, str]) -> None:
    present = sorted(name for name in env if name in FORBIDDEN_ENV or CREDENTIAL_ENV_NAME.search(name))
    if present:
        raise RuntimeError("forbidden VM credential channel: " + ",".join(present))


def validate_ops_root(root: Path) -> None:
    for rel in ("dashboard", "scripts", "schemas", ".github"):
        if (root / rel).exists():
            raise RuntimeError(f"ops checkout contains platform path: {rel}")
    push_url = subprocess.run(
        ["git", "-c", "safe.directory=/var/lib/kb/ops", "remote", "get-url", "--push", "origin"],
        cwd=root,
        check=True,
        text=True,
        capture_output=True,
        timeout=COMMAND_TIMEOUT,
    ).stdout.strip()
    if push_url != "disabled://desktop-promotion-only":
        raise RuntimeError("ops push remote is not disabled")


def validate_ops_git_identity(root: Path, run=subprocess.run) -> None:
    for key in ("user.email", "user.name"):
        try:
            value = run(
                ["git", "-C", str(root), "config", "--get", key],
                check=True,
                text=True,
                capture_output=True,
                timeout=COMMAND_TIMEOUT,
            ).stdout.strip()
        except subprocess.CalledProcessError as error:
            raise RuntimeError(f"ops git identity is missing: {key}") from error
        if not value:
            raise RuntimeError(f"ops git identity is missing: {key}")


def validate_outbox_anchor(root: Path, run=subprocess.run) -> None:
    result = run(["git", "show-ref", "--verify", "--quiet", "refs/kb-outbox/spooled"], cwd=root)
    if result.returncode != 0:
        raise RuntimeError("outbox anchor refs/kb-outbox/spooled is absent")


def validate_releases_root(value: os.stat_result) -> None:
    if value.st_uid != 0 or value.st_gid != 0 or not stat.S_ISDIR(value.st_mode) or stat.S_IMODE(value.st_mode) != 0o755:
        raise RuntimeError("release root must be root:root 0755")


def _read_show(unit: str, fields: set[str], run=subprocess.run) -> dict[str, str]:
    show: dict[str, str] = {}
    for name in sorted(fields):
        result = run(["systemctl", "show", f"--property={name}", "--value", unit], check=True, text=True, capture_output=True, timeout=COMMAND_TIMEOUT)
        show[name] = result.stdout.strip()
    return show


def read_static_unit(unit: str, run=subprocess.run) -> tuple[dict[str, str], str]:
    show = _read_show(unit, STATIC_SHOW, run)
    text = run(["systemctl", "cat", unit], check=True, text=True, capture_output=True, timeout=COMMAND_TIMEOUT).stdout
    return show, text


def read_live_unit(unit: str, run=subprocess.run) -> dict[str, str]:
    return _read_show(unit, LIVE_SHOW, run)


def _unit_environment(text: str) -> dict[str, str]:
    assigned: dict[str, str] = {}
    for line in text.splitlines():
        if not line.startswith("Environment="):
            continue
        try:
            tokens = shlex.split(line.removeprefix("Environment="), posix=True)
        except ValueError as error:
            raise RuntimeError("dashboard unit environment assignment syntax is invalid") from error
        for token in tokens:
            match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", token)
            if match is None or match.group(1) in assigned:
                raise RuntimeError("dashboard unit environment assignment set is not closed")
            assigned[match.group(1)] = match.group(2)
    return assigned


def validate_static_unit(show: dict[str, str], text: str) -> None:
    if set(show) != STATIC_SHOW:
        raise RuntimeError("static unit fields are incomplete")
    if show["FragmentPath"] != "/etc/systemd/system/kb-dashboard.service" or show["DropInPaths"]:
        raise RuntimeError("dashboard unit fragment or drop-ins are untrusted")
    if show["Id"] != "kb-dashboard.service" or set(show["Names"].split()) != {"kb-dashboard.service"} or show["Slice"] != "system.slice":
        raise RuntimeError("dashboard unit or slice naming mismatch")
    expected = {"User": "kb-dashboard", "Group": "kb-dashboard", "WorkingDirectory": "/opt/kb-releases/current/dashboard", "KillMode": "control-group"}
    for name, value in expected.items():
        if show[name] != value:
            raise RuntimeError(f"effective unit {name} mismatch")
    if show["EnvironmentFiles"]:
        raise RuntimeError("effective unit must not load credential-bearing environment files")
    if "/usr/bin/node" not in show["ExecStart"]:
        raise RuntimeError("effective unit executable mismatch")
    environment = _unit_environment(text)
    assigned = set(environment)
    forbidden = sorted(name for name in assigned if name in FORBIDDEN_ENV or CREDENTIAL_ENV_NAME.search(name))
    if forbidden:
        raise RuntimeError("dashboard unit assigns a forbidden credential name: " + ",".join(forbidden))
    if not EXPECTED_UNIT_ENV.issubset(assigned) or not assigned.difference(EXPECTED_UNIT_ENV).issubset(OPTIONAL_UNIT_ENV):
        raise RuntimeError("dashboard unit environment assignment set is not closed")
    if environment["DASHBOARD_AUTH_MODE"] != EXPECTED_AUTH_MODE:
        raise RuntimeError("dashboard unit auth mode must be tailnet")
    if TAILNET_HOST_PATTERN.fullmatch(environment["DASHBOARD_TAILNET_HOST"]) is None:
        raise RuntimeError("dashboard unit tailnet host is invalid")
    if TAILNET_OPERATOR_PATTERN.fullmatch(environment["DASHBOARD_TAILNET_OPERATOR"]) is None:
        raise RuntimeError("dashboard unit tailnet operator is invalid")
    unset = set(show["UnsetEnvironment"].split())
    missing = sorted(FORBIDDEN_ENV.difference(unset))
    if missing:
        raise RuntimeError("dashboard unit does not unset credential channels: " + ",".join(missing))
    if environment["KB_COORDINATION_PUBLICATION"] != "outbox":
        raise RuntimeError("dashboard unit must select local outbox publication")
    if environment["KB_VM_RUNTIME"] != "1":
        raise RuntimeError("dashboard unit must enable VM runtime")
    if show["ReadOnlyPaths"] != "/opt/kb-releases" or set(show["ReadWritePaths"].split()) != {"/var/lib/kb/ops", "/var/lib/kb/state"}:
        raise RuntimeError("effective unit filesystem policy mismatch")


def _resolve_proc_cwd(path: Path) -> Path:
    return path.resolve(strict=True)


def validate_live_unit(show: dict[str, str], current_release: Path = Path("/opt/kb-releases/current"), resolve_proc_cwd=_resolve_proc_cwd) -> None:
    if set(show) != LIVE_SHOW:
        raise RuntimeError("live unit fields are incomplete")
    if not show["ControlGroup"].startswith("/system.slice/kb-dashboard.service"):
        raise RuntimeError("live unit cgroup mismatch")
    if re.fullmatch(r"[1-9][0-9]*", show["MainPID"]) is None:
        raise RuntimeError("live unit MainPID mismatch")
    expected_cwd = (current_release.resolve(strict=True) / "dashboard").resolve(strict=True)
    actual_cwd = resolve_proc_cwd(Path("/proc") / show["MainPID"] / "cwd")
    if actual_cwd != expected_cwd:
        raise RuntimeError("live unit working directory mismatch")


def parse_unit(text: str) -> dict[str, list[tuple[str, str]]]:
    """Parse a unit file into section -> ordered (directive, value) pairs, comments dropped."""
    sections: dict[str, list[tuple[str, str]]] = {}
    section: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith(";"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            if section in sections:
                raise RuntimeError(f"broker unit repeats section [{section}]")
            sections[section] = []
            continue
        if section is None:
            raise RuntimeError("broker unit directive precedes any section")
        key, separator, value = line.partition("=")
        if not separator:
            raise RuntimeError(f"broker unit line is not an assignment: {line}")
        sections[section].append((key.strip(), value.strip()))
    return sections


def _exact_directives(pairs: list[tuple[str, str]], expected: dict[str, str], unit: str) -> None:
    seen: dict[str, str] = {}
    for key, value in pairs:
        if key in seen:
            raise RuntimeError(f"{unit} repeats directive {key}")
        seen[key] = value
    if seen != expected:
        added = sorted(set(seen) - set(expected))
        removed = sorted(set(expected) - set(seen))
        drifted = sorted(name for name in set(seen) & set(expected) if seen[name] != expected[name])
        raise RuntimeError(
            f"{unit} directive set drifted: added={added} removed={removed} changed={drifted}")


def _assert_no_privilege_escalation(text: str, unit: str) -> None:
    # Directives only: comments explain the sandbox, and explaining why `sudo` is impossible must not
    # be the thing that fails the unit.
    directives = [line for line in text.splitlines()
                  if line.strip() and not line.strip().startswith(("#", ";"))]
    lowered = "\n".join(directives).lower()
    for token in BROKER_PRIVILEGE_TOKENS:
        if token in lowered:
            raise RuntimeError(f"{unit} references a privilege-escalation token: {token.strip()}")
    for line in directives:
        if line.strip().startswith("Exec") and "=" in line:
            argv = line.split("=", 1)[1].strip()
            if argv[:1] in {"+", "!", "@", "-", ":"}:
                raise RuntimeError(f"{unit} uses a privileged or special Exec prefix")


def validate_broker_service(text: str) -> None:
    sections = parse_unit(text)
    if set(sections) != BROKER_SERVICE_SECTIONS:
        raise RuntimeError("broker service sections drifted")
    _exact_directives(sections["Unit"], BROKER_SERVICE_UNIT_SECTION, BROKER_SERVICE_UNIT)
    _exact_directives(sections["Service"], BROKER_SERVICE_DIRECTIVES, BROKER_SERVICE_UNIT)
    present = {key for pairs in sections.values() for key, _ in pairs}
    forbidden = sorted(present.intersection(BROKER_SERVICE_FORBIDDEN))
    if forbidden:
        raise RuntimeError("broker service declares a forbidden directive: " + ",".join(forbidden))
    listeners = sorted(present.intersection(BROKER_LISTEN_DIRECTIVES))
    if listeners:
        raise RuntimeError("broker service declares a listener: " + ",".join(listeners))
    _assert_no_privilege_escalation(text, BROKER_SERVICE_UNIT)


def validate_broker_socket(text: str) -> None:
    sections = parse_unit(text)
    if set(sections) != {"Unit", "Socket", "Install"}:
        raise RuntimeError("broker socket sections drifted")
    _exact_directives(sections["Unit"], BROKER_SOCKET_UNIT_SECTION, BROKER_SOCKET_UNIT)
    _exact_directives(sections["Install"], BROKER_SOCKET_INSTALL_SECTION, BROKER_SOCKET_UNIT)
    _exact_directives(sections["Socket"], BROKER_SOCKET_DIRECTIVES, BROKER_SOCKET_UNIT)
    listeners = [(key, value) for pairs in sections.values() for key, value in pairs
                 if key in BROKER_LISTEN_DIRECTIVES]
    if listeners != [("ListenStream", BROKER_SOCKET_PATH)]:
        raise RuntimeError("broker socket must declare exactly one Unix ListenStream")
    if not BROKER_SOCKET_PATH.startswith("/") or ":" in BROKER_SOCKET_PATH:
        raise RuntimeError("broker socket listener is not an AF_UNIX path")
    _assert_no_privilege_escalation(text, BROKER_SOCKET_UNIT)


def validate_broker_units(unit_root: Path = BROKER_UNIT_ROOT) -> bool:
    """Validate the installed broker units when they exist.

    Absence is allowed: a VM bootstrapped before the broker existed runs the dashboard with its pty
    capability closed until deploy/install_pty_broker.py runs. Presence is validated strictly, so a
    drifted or hand-edited unit fails the dashboard's own ExecStartPre rather than starting a broker
    with a weakened sandbox.
    """
    service = unit_root / BROKER_SERVICE_UNIT
    socket_unit = unit_root / BROKER_SOCKET_UNIT
    if not service.exists() and not socket_unit.exists():
        return False
    if not service.is_file() or not socket_unit.is_file():
        raise RuntimeError("broker units must be installed as a pair")
    validate_broker_service(service.read_text(encoding="utf-8"))
    validate_broker_socket(socket_unit.read_text(encoding="utf-8"))
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the effective kb VM runtime")
    parser.add_argument("--phase", choices=("static", "live"), required=True)
    parser.add_argument("--ops-root", type=Path, required=True)
    parser.add_argument("--unit", required=True)
    args = parser.parse_args()
    if args.phase == "static":
        validate_environment(dict(os.environ))
        validate_ops_root(args.ops_root)
        validate_ops_git_identity(args.ops_root)
        validate_releases_root(Path("/opt/kb-releases").stat())
        show, text = read_static_unit(args.unit)
        validate_static_unit(show, text)
        validate_outbox_anchor(args.ops_root)
        validate_broker_units()
        fields = STATIC_SHOW
    else:
        show = read_live_unit(args.unit)
        validate_live_unit(show)
        fields = LIVE_SHOW
    print(f"validated VM runtime {args.phase} fields: " + ",".join(sorted(fields)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
