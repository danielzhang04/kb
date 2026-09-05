from __future__ import annotations

import argparse
import json
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
# DASHBOARD_DESKTOP_HELPER_ORIGIN (dashboard-v3 P5) is REQUIRED: it pins the one desktop-helper tailnet
# address the deploy/asset-pull client speaks to. The dashboard reads it once at composition and refuses to
# start when it is absent or not an https: tailnet origin, so asserting it here turns a missing helper
# address into one loud ExecStartPre failure. It carries no credential (an origin, not a key), so
# CREDENTIAL_ENV_NAME does not flag it; its format is validated dashboard-side, not here.
# dashboard-v3 P6 §3.3 [P6-C27, P6-C60]: BOTH proxy-uid envs are now REQUIRED members of the closed set —
# DASHBOARD_TAILNET_PROXY_UID (the operator/root serve proxy, pinned to 0) and DASHBOARD_NODE_PROXY_UID
# (the attested kb-node-proxy). The dashboard refuses to boot unless DASHBOARD_NODE_PROXY_UID ∉ {0,
# DASHBOARD_TAILNET_PROXY_UID}; this validator runs the SAME pairwise check against the unit env so a bad
# pair fails one loud ExecStartPre instead of the first node request.
EXPECTED_UNIT_ENV = {"DASHBOARD_PLATFORM_ROOT", "PYTHONPATH", "DASHBOARD_REPO_ROOT", "DASHBOARD_STATE_ROOT", "DASHBOARD_EXECUTION_ACTIVATED", "KB_COORDINATION_PUBLICATION", "KB_VM_RUNTIME", "GIT_CONFIG_GLOBAL", "DASHBOARD_AUTH_MODE", "DASHBOARD_TAILNET_HOST", "DASHBOARD_TAILNET_OPERATOR", "DASHBOARD_DESKTOP_HELPER_ORIGIN", "DASHBOARD_TAILNET_PROXY_UID", "DASHBOARD_NODE_PROXY_UID"}
# W47: the CONSTRAINED tailnet passkey channel. These two are OPTIONAL, not forbidden - see
# PASSKEY_UNIT_ENV below and dashboard/server/auth/mode.ts#assertTailnetPasskeyChannel, whose rules
# this validator mirrors so a bad pair fails one loud ExecStartPre instead of the first T3 gate.
OPTIONAL_UNIT_ENV: set[str] = {"DASHBOARD_RP_ORIGIN", "DASHBOARD_WEBAUTHN_CREDENTIALS"}
# DASHBOARD_TAILNET_OPERATOR is REQUIRED (Daniel, 2026-08-18), not optional: tailnet membership on this VM
# is root-equivalent, so the operator identity must be pinned rather than defaulting to "any tailnet
# principal". DASHBOARD_DEV_ORIGIN is deliberately NOT here at all: it is a win32-desktop-only convenience,
# and under tailnet's AMBIENT auth an allowlisted dev origin would grant operator authority to any page
# served from it. A unit that sets it fails the closed-set check.
TAILNET_OPERATOR_PATTERN = re.compile(r"^\S+@\S+$")
# W47 - DASHBOARD_RP_ORIGIN + DASHBOARD_WEBAUTHN_CREDENTIALS: the re-admitted, CONSTRAINED tailnet
# passkey channel. The cutover retired both (docs/specs/2026-08-18-cutover-end-state.md:310-333), which
# made governance/risk-tiers.md D2.13 unsatisfiable on this VM: a T3 item declaring `ceremony: webauthn`
# needs a provisioned credential, `resolveCredentials()` reads only DASHBOARD_WEBAUTHN_CREDENTIALS, and
# a unit carrying it could not boot. They are now OPTIONAL under exactly three rules, checked by
# _validate_passkey_channel and mirrored from the dashboard's own boot assertion:
#   1. Both absent is the default posture. DASHBOARD_RP_ORIGIN alone is the ENROLMENT posture and is
#      legal (it grants nothing: the empty store means every T3 challenge still answers 403).
#      DASHBOARD_WEBAUTHN_CREDENTIALS alone is a refusal - no RP origin means no RP-ID to verify under.
#   2. Whenever set, DASHBOARD_RP_ORIGIN == "https://<DASHBOARD_TAILNET_HOST>" exactly.
#   3. Whenever set, DASHBOARD_WEBAUTHN_CREDENTIALS parses to >= 1 {id, publicKey} entry.
#
# CREDENTIAL_ENV_NAME exemption, stated plainly because the name matches the regex: this variable holds
# WebAuthn PUBLIC keys ONLY - the same material the pre-cutover unit carried and documented as public
# (docs/specs/2026-08-18-cutover-end-state.md:180-181). A public key is not a secret: possessing it lets
# nobody assert, because the assertion is signed by a private key that never leaves the authenticator
# hardware. It is exempted by NAME, and by name only; every other CREDENTIAL_ENV_NAME match, including
# any future DASHBOARD_*_SECRET/TOKEN, is still forbidden. Its VALUE is never printed by this module.
PASSKEY_UNIT_ENV = ("DASHBOARD_RP_ORIGIN", "DASHBOARD_WEBAUTHN_CREDENTIALS")
CREDENTIAL_ENV_EXEMPT = frozenset({"DASHBOARD_WEBAUTHN_CREDENTIALS"})
# systemd drop-in carrying the passkey pair, so the operator installs it without editing the fragment
# bootstrap re-renders. EXACTLY one path is trusted; any other drop-in is still untrusted drift.
PASSKEY_DROP_IN = "/etc/systemd/system/kb-dashboard.service.d/passkey.conf"
TAILNET_HOST_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
EXPECTED_AUTH_MODE = "tailnet"
STATIC_SHOW = {"Id", "Names", "Slice", "FragmentPath", "DropInPaths", "User", "Group", "ExecStart", "WorkingDirectory", "EnvironmentFiles", "UnsetEnvironment", "KillMode", "UMask", "ReadOnlyPaths", "ReadWritePaths"}
# The daemon runs `git worktree add` for every attempt, so its umask decides whether the kb-shell
# worker can write inside the run worktree it was handed. See the UMask= comment in
# deploy/systemd/kb-dashboard.service for why 0002 is the only value that works and why it removes no
# control. Pinned EXACTLY: 0022 (the systemd default) is the wall, and anything wider is not intended.
EXPECTED_UMASK = "0002"
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
    # Added alongside kb-dashboard's own UMask=0002 (see EXPECTED_UMASK above): codex/claude workers
    # `mkdir -p` under the 2775 setgid run worktree, and at the systemd default 0022 those dirs come out
    # 2755 kb-shell:kb-shell, which the daemon (uid kb-dashboard, group kb-shell) cannot unlink during
    # `git worktree remove --force`. This is a contract change, not a relaxation: it is enforced the
    # same way every other frozen directive is, by _exact_directives against the installed unit file.
    "UMask": "0002",
    "NoNewPrivileges": "yes",
    "UnsetEnvironment": ("GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET"
                         " KB_CANARY_SESSION"),
    "PrivateTmp": "yes",
    "ProtectSystem": "strict",
    "ReadOnlyPaths": "/var/lib/kb/ops /var/lib/kb-shell/home",
    "ReadWritePaths": "/var/lib/kb-shell/worktrees /run/kb-shell /var/lib/kb-shell/home/.claude /var/lib/kb-shell/home/.codex",
    # `-` prefix: ignore-if-missing on this ONE path. /var/lib/kb-activation is never created by
    # anything in the repo, and systemd refuses to build the mount namespace (NAMESPACE, 226) when a
    # listed InaccessiblePaths entry does not exist - confirmed on the VM, where every broker spawn
    # died with "Failed to set up mount namespacing: /var/lib/kb-activation: No such file or
    # directory". `-` makes the unit correct whether or not the directory exists, while still denying
    # it the moment it does.
    "InaccessiblePaths": "/var/lib/kb/state /opt/kb-releases -/var/lib/kb-activation",
    "CapabilityBoundingSet": "",
    "AmbientCapabilities": "",
    "RestrictSUIDSGID": "yes",
}
# The privileged fixup that actually makes /run/kb-shell kb-shell:kb-dashboard 0750 - see the header
# comment on kb-shell-broker.socket for the VM evidence that RuntimeDirectory=/User=/Group= alone do
# not do this on a .socket unit. These are systemd's own repeatable ExecStartPre= directive: each
# line below is one exec, and BOTH must appear, in this order, for the socket unit to validate.
BROKER_SOCKET_RUNTIME_DIR_CHOWN = "+/usr/bin/chown kb-shell:kb-dashboard /run/kb-shell"
BROKER_SOCKET_RUNTIME_DIR_CHMOD = "+/usr/bin/chmod 0750 /run/kb-shell"
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
    # A tuple, not a string: this is the one directive in the frozen sets that systemd allows (and
    # this fix requires) to repeat. `_exact_directives`/`_collapse_directives` collect repeats of a
    # tuple-valued key in file order and compare them as a tuple, instead of raising "repeats
    # directive" the way every scalar directive here still does.
    "ExecStartPre": (BROKER_SOCKET_RUNTIME_DIR_CHOWN, BROKER_SOCKET_RUNTIME_DIR_CHMOD),
}
# The `+`-prefixed ExecStartPre pair is a privilege escalation by definition (that is the point of
# `+`), so it must be individually allowlisted past `_assert_no_privilege_escalation` by exact text -
# an attacker-added `+`-prefixed Exec line that is not byte-identical to one of these two is still
# refused, and so is a third one.
BROKER_SOCKET_PERMITTED_PRIVILEGED_EXEC = frozenset(
    f"ExecStartPre={value}" for value in BROKER_SOCKET_DIRECTIVES["ExecStartPre"]
)
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

# --- P6 node-proxy + WhoIs shim units (dashboard-v3 §3.3) -------------------------------------
# Eight frozen tables, set-equality-checked per section by `_exact_directives` and pairwise-equal to the
# shipped unit files, following the broker's vocabulary exactly. An unlisted section is an unfrozen section.
NODE_PROXY_SERVICE_UNIT = "kb-node-proxy.service"
WHOIS_SERVICE_UNIT = "kb-whois.service"
WHOIS_SOCKET_UNIT = "kb-whois.socket"
WHOIS_SOCKET_PATH = "/run/kb-whois/whois.sock"
TAILSCALED_SOCKET_PATH = "/var/run/tailscale/tailscaled.sock"
NODE_PROXY_EXEC_START = ("/usr/bin/python3 /opt/kb-releases/current/deploy/kb_node_proxy.py"
                         " --listen 127.0.0.1:4319 --upstream 127.0.0.1:4317 --whois /run/kb-whois/whois.sock")
WHOIS_EXEC_START = ("/usr/bin/python3 /opt/kb-releases/current/deploy/kb_whois_shim.py"
                    f" --socket-fd=3 --socket {TAILSCALED_SOCKET_PATH}")
_SECRET_UNSET = "GITHUB_TOKEN GH_TOKEN GIT_ASKPASS SSH_AUTH_SOCK DASHBOARD_SESSION_SECRET KB_CANARY_SESSION"

NODE_PROXY_SERVICE_DIRECTIVES = {
    "Type": "simple",
    "User": "kb-node-proxy",
    "Group": "kb-node-proxy",
    "ExecStart": NODE_PROXY_EXEC_START,
    "Restart": "on-failure",
    "KillMode": "control-group",
    "NoNewPrivileges": "yes",
    "ProtectSystem": "strict",
    "ProtectHome": "yes",
    "PrivateTmp": "yes",
    "PrivateDevices": "yes",
    "ProtectKernelTunables": "yes",
    "ProtectControlGroups": "yes",
    "RestrictAddressFamilies": "AF_UNIX AF_INET AF_INET6",
    "IPAddressAllow": "localhost",
    "IPAddressDeny": "any",
    "CapabilityBoundingSet": "",
    "UnsetEnvironment": _SECRET_UNSET,
}
NODE_PROXY_SERVICE_UNIT_SECTION = {
    "Description": "kb node proxy (node-identity hop for the kb dashboard)",
    "After": "network-online.target kb-whois.socket",
    "Wants": "kb-whois.socket",
}
# Not socket-activated, so it carries an [Install] section — frozen too.
NODE_PROXY_SERVICE_INSTALL_SECTION = {"WantedBy": "multi-user.target"}
NODE_PROXY_SERVICE_SECTIONS = {"Unit", "Service", "Install"}
# Its OWN forbidden set, NOT the broker's: RestrictAddressFamilies / IPAddress* are the confinement of a
# loopback hop and are REQUIRED above, so the forbidden list instead bans what would widen or break it.
# NAMES ONLY — `present` is built from directive keys, so a `name=value` member could never match. The
# value-level pins (User=kb-node-proxy, etc.) are asserted by the set equality on the directives above.
NODE_PROXY_SERVICE_FORBIDDEN = ("PrivateNetwork", "ListenStream", "SupplementaryGroups", "AmbientCapabilities")

WHOIS_SERVICE_DIRECTIVES = {
    "Type": "simple",
    "User": "root",
    "ExecStart": WHOIS_EXEC_START,
    "Restart": "on-failure",
    "KillMode": "control-group",
    "TimeoutStopSec": "30",
    "NoNewPrivileges": "yes",
    "ProtectSystem": "strict",
    "ProtectHome": "yes",
    "PrivateTmp": "yes",
    "RestrictAddressFamilies": "AF_UNIX",
    "IPAddressDeny": "any",
    "CapabilityBoundingSet": "",
    "UnsetEnvironment": _SECRET_UNSET,
    "ReadWritePaths": "/run/kb-whois",
}
WHOIS_SERVICE_UNIT_SECTION = {
    "Description": "kb WhoIs shim (root-owned LocalAPI WhoIs for kb-node-proxy)",
    "Requires": "kb-whois.socket",
    "After": "kb-whois.socket",
}
# Socket-activated ONLY: no [Install] section at all, asserted rather than merely omitted.
WHOIS_SERVICE_SECTIONS = {"Unit", "Service"}
WHOIS_SERVICE_FORBIDDEN = ("SupplementaryGroups", "AmbientCapabilities", "RuntimeDirectory", "PrivateNetwork")

WHOIS_SOCKET_DIRECTIVES = {
    "ListenStream": WHOIS_SOCKET_PATH,
    "Accept": "no",
    "SocketUser": "root",
    "SocketGroup": "kb-node-proxy",
    "SocketMode": "0660",
    "DirectoryMode": "0750",
    "User": "root",
    "Group": "kb-node-proxy",
    "RuntimeDirectory": "kb-whois",
    "RuntimeDirectoryMode": "0750",
    "RuntimeDirectoryPreserve": "restart",
    "RemoveOnStop": "yes",
}
WHOIS_SOCKET_UNIT_SECTION = {
    "Description": "kb WhoIs shim socket",
    "PartOf": "kb-whois.service",
}
WHOIS_SOCKET_INSTALL_SECTION = {"WantedBy": "sockets.target"}

# The eight frozen tables, keyed for pairwise (unit-file vs dict) testing.
NODE_WHOIS_FROZEN_TABLES = {
    "NODE_PROXY_SERVICE_DIRECTIVES": (NODE_PROXY_SERVICE_UNIT, "Service", NODE_PROXY_SERVICE_DIRECTIVES),
    "NODE_PROXY_SERVICE_UNIT_SECTION": (NODE_PROXY_SERVICE_UNIT, "Unit", NODE_PROXY_SERVICE_UNIT_SECTION),
    "NODE_PROXY_SERVICE_SECTIONS": (NODE_PROXY_SERVICE_UNIT, "Install", NODE_PROXY_SERVICE_INSTALL_SECTION),
    "WHOIS_SERVICE_DIRECTIVES": (WHOIS_SERVICE_UNIT, "Service", WHOIS_SERVICE_DIRECTIVES),
    "WHOIS_SERVICE_UNIT_SECTION": (WHOIS_SERVICE_UNIT, "Unit", WHOIS_SERVICE_UNIT_SECTION),
    "WHOIS_SOCKET_DIRECTIVES": (WHOIS_SOCKET_UNIT, "Socket", WHOIS_SOCKET_DIRECTIVES),
    "WHOIS_SOCKET_UNIT_SECTION": (WHOIS_SOCKET_UNIT, "Unit", WHOIS_SOCKET_UNIT_SECTION),
    "WHOIS_SOCKET_INSTALL_SECTION": (WHOIS_SOCKET_UNIT, "Install", WHOIS_SOCKET_INSTALL_SECTION),
}

# /run/kb-whois must be root:kb-node-proxy 0750 and whois.sock root:kb-node-proxy 0660 (see socket unit).
WHOIS_RUNTIME_DIR = "/run/kb-whois"
WHOIS_DIR_MODE = 0o750
WHOIS_SOCKET_MODE = 0o660
# The binary whose prefs must show no OperatorUser — pinned so a PATH shim cannot answer for it.
TAILSCALE_BINARY = "/usr/bin/tailscale"
NODE_PROXY_LISTEN_ADDR = "127.0.0.1:4319"


def _validate_proxy_uid_pair(environment: dict[str, str]) -> None:
    """The SAME pairwise check the dashboard makes at boot [P6-C27, P6-C60]: the node uid is neither 0 nor
    the tailnet uid, and the tailnet uid is 0. A bad pair fails ExecStartPre, not the first request."""
    def _uid(name: str) -> int:
        raw = environment[name]
        if not re.fullmatch(r"[0-9]+", raw):
            raise RuntimeError(f"dashboard unit {name} must be a non-negative integer")
        return int(raw)
    tailnet_uid = _uid("DASHBOARD_TAILNET_PROXY_UID")
    node_uid = _uid("DASHBOARD_NODE_PROXY_UID")
    if tailnet_uid != 0:
        raise RuntimeError("dashboard unit DASHBOARD_TAILNET_PROXY_UID must be 0 (root tailscale serve)")
    if node_uid == 0 or node_uid == tailnet_uid:
        raise RuntimeError("dashboard unit DASHBOARD_NODE_PROXY_UID must be distinct from 0 and the tailnet proxy uid")


def _validate_passkey_drop_in(path: Path) -> None:
    """W47: admitting a drop-in path widened the unit's trust boundary, so the FILE is pinned too, not
    just its name. A systemd drop-in can set ANY [Service] directive - ExecStartPre=, NoNewPrivileges=,
    SupplementaryGroups=, BindPaths=, CapabilityBoundingSet=, User= - which would let a passkey.conf
    quietly undo the sandbox this validator spends the rest of its length proving. So the only content
    allowed here is a [Service] header plus Environment= assignments naming PASSKEY_UNIT_ENV members
    (blank lines and # comments ignored). Any other directive, section, or environment name refuses.
    Values are never echoed: a refusal names the DIRECTIVE, never what it was set to."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise RuntimeError(f"dashboard unit passkey drop-in is unreadable: {path}") from error
    except UnicodeDecodeError as error:
        raise RuntimeError(f"dashboard unit passkey drop-in is not UTF-8: {path}") from error
    seen_service = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith(";"):
            continue
        if line.startswith("["):
            if line != "[Service]":
                raise RuntimeError(f"passkey drop-in may only carry a [Service] section; found {line}")
            seen_service = True
            continue
        if not seen_service:
            raise RuntimeError("passkey drop-in has a directive before its [Service] header")
        directive, separator, _value = line.partition("=")
        if not separator or directive.strip() != "Environment":
            raise RuntimeError(
                "passkey drop-in may only carry Environment= assignments; found directive "
                + (directive.strip() or line)
            )
        for name in _unit_environment(line):
            if name not in PASSKEY_UNIT_ENV:
                raise RuntimeError(f"passkey drop-in may only assign {'/'.join(PASSKEY_UNIT_ENV)}; found {name}")


def _validate_passkey_channel(environment: dict[str, str]) -> None:
    """The SAME posture rules the dashboard makes at boot (W47,
    dashboard/server/auth/mode.ts#assertTailnetPasskeyChannel). Absent from the unit is the default
    posture and passes silently. Nothing here is printed: only presence and shape are inspected."""
    origin, credentials = (environment.get(name, "").strip() for name in PASSKEY_UNIT_ENV)
    if not origin and not credentials:
        return
    # RP origin ALONE is legal: it is the enrolment posture (the register ceremony needs an RP origin,
    # and is the only way to obtain a credential). It grants nothing - the store is empty, so the
    # dashboard reports ceremonyAvailable false and every T3 challenge answers 403. Credentials ALONE
    # refuse: no RP origin means no RP-ID, so nothing could ever verify against that store.
    if credentials and not origin:
        raise RuntimeError(
            "dashboard unit must set DASHBOARD_RP_ORIGIN whenever DASHBOARD_WEBAUTHN_CREDENTIALS is set "
            "(a credential store with no RP origin cannot pin an RP-ID, so no assertion could ever verify)"
        )
    expected = "https://" + environment["DASHBOARD_TAILNET_HOST"]
    if origin != expected:
        raise RuntimeError(f"dashboard unit DASHBOARD_RP_ORIGIN must equal {expected} exactly")
    if credentials and _provisioned_credential_count(credentials) < 1:
        raise RuntimeError(
            "dashboard unit DASHBOARD_WEBAUTHN_CREDENTIALS must parse to at least one "
            "{id, publicKey} credential"
        )


def _provisioned_credential_count(raw: str) -> int:
    """Mirror of resolveCredentials' parse (dashboard/server/auth/credentialStore.ts): a non-array,
    unparseable, or shape-invalid entry counts zero, so this refuses exactly the values that would
    leave ctx.credentials() empty. Returns a COUNT; it never decodes or echoes key material."""
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return 0
    if not isinstance(parsed, list):
        return 0
    return sum(
        1 for entry in parsed
        if isinstance(entry, dict)
        and isinstance(entry.get("id"), str)
        and isinstance(entry.get("publicKey"), str)
    )


def validate_environment(env: dict[str, str]) -> None:
    present = sorted(
        name for name in env
        if name in FORBIDDEN_ENV
        or (CREDENTIAL_ENV_NAME.search(name) and name not in CREDENTIAL_ENV_EXEMPT)
    )
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
    if show["FragmentPath"] != "/etc/systemd/system/kb-dashboard.service":
        raise RuntimeError("dashboard unit fragment is untrusted")
    # W47: exactly one drop-in is trusted - the passkey pair's. Anything else is stale or hostile drift.
    drop_ins = show["DropInPaths"].split()
    if not set(drop_ins).issubset({PASSKEY_DROP_IN}):
        raise RuntimeError("dashboard unit drop-ins are untrusted: " + ",".join(sorted(drop_ins)))
    if PASSKEY_DROP_IN in drop_ins:
        _validate_passkey_drop_in(Path(PASSKEY_DROP_IN))
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
    forbidden = sorted(
        name for name in assigned
        if name in FORBIDDEN_ENV
        or (CREDENTIAL_ENV_NAME.search(name) and name not in CREDENTIAL_ENV_EXEMPT)
    )
    if forbidden:
        raise RuntimeError("dashboard unit assigns a forbidden credential name: " + ",".join(forbidden))
    if not EXPECTED_UNIT_ENV.issubset(assigned) or not assigned.difference(EXPECTED_UNIT_ENV).issubset(OPTIONAL_UNIT_ENV):
        raise RuntimeError("dashboard unit environment assignment set is not closed")
    if environment["DASHBOARD_AUTH_MODE"] != EXPECTED_AUTH_MODE:
        raise RuntimeError("dashboard unit auth mode must be tailnet")
    if show["UMask"] != EXPECTED_UMASK:
        raise RuntimeError(
            "dashboard unit UMask must be 0002 so a kb-shell worker can write in the run worktree the "
            "daemon created for it; add 'UMask=0002' to [Service] in deploy/systemd/kb-dashboard.service, "
            "reinstall the unit (deploy/bootstrap_vm.py converge, or copy it and daemon-reload) and restart"
        )
    if TAILNET_HOST_PATTERN.fullmatch(environment["DASHBOARD_TAILNET_HOST"]) is None:
        raise RuntimeError("dashboard unit tailnet host is invalid")
    if TAILNET_OPERATOR_PATTERN.fullmatch(environment["DASHBOARD_TAILNET_OPERATOR"]) is None:
        raise RuntimeError("dashboard unit tailnet operator is invalid")
    _validate_proxy_uid_pair(environment)
    _validate_passkey_channel(environment)
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


def _collapse_directives(pairs: list[tuple[str, str]], expected: dict[str, object],
                         unit: str) -> dict[str, object]:
    """Fold parsed (key, value) pairs into one dict, in file order.

    A key repeats only when `expected` maps it to a tuple - systemd's own repeatable directives
    (ExecStartPre= is the one member today). Those repeats are collected in order and compared as a
    tuple. Every other key is still scalar: a second occurrence is unexpected drift, not intent, and
    is refused the same way it always was.
    """
    seen: dict[str, object] = {}
    repeatable: dict[str, list[str]] = {}
    for key, value in pairs:
        if isinstance(expected.get(key), tuple):
            repeatable.setdefault(key, []).append(value)
            continue
        if key in seen:
            raise RuntimeError(f"{unit} repeats directive {key}")
        seen[key] = value
    for key, values in repeatable.items():
        seen[key] = tuple(values)
    return seen


def _exact_directives(pairs: list[tuple[str, str]], expected: dict[str, object], unit: str) -> None:
    seen = _collapse_directives(pairs, expected, unit)
    if seen != expected:
        added = sorted(set(seen) - set(expected))
        removed = sorted(set(expected) - set(seen))
        drifted = sorted(name for name in set(seen) & set(expected) if seen[name] != expected[name])
        raise RuntimeError(
            f"{unit} directive set drifted: added={added} removed={removed} changed={drifted}")


def _assert_no_privilege_escalation(text: str, unit: str,
                                    permitted_prefixed_exec: frozenset[str] = frozenset()) -> None:
    # Directives only: comments explain the sandbox, and explaining why `sudo` is impossible must not
    # be the thing that fails the unit. `permitted_prefixed_exec` is an exact-text allowlist (full
    # "Directive=value" lines) for the one case a privileged Exec prefix is required on purpose - the
    # socket unit's ExecStartPre `+chown`/`+chmod` pair that fixes /run/kb-shell ownership. Because the
    # match is byte-for-byte against the pinned literal, an attacker-added `+`-prefixed line that is
    # not identical to one of these two is still refused here.
    directives = [line for line in text.splitlines()
                  if line.strip() and not line.strip().startswith(("#", ";"))]
    lowered = "\n".join(directives).lower()
    for token in BROKER_PRIVILEGE_TOKENS:
        if token in lowered:
            raise RuntimeError(f"{unit} references a privilege-escalation token: {token.strip()}")
    for line in directives:
        stripped = line.strip()
        if stripped.startswith("Exec") and "=" in stripped:
            argv = stripped.split("=", 1)[1].strip()
            if argv[:1] in {"+", "!", "@", "-", ":"} and stripped not in permitted_prefixed_exec:
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
    _assert_no_privilege_escalation(text, BROKER_SOCKET_UNIT, BROKER_SOCKET_PERMITTED_PRIVILEGED_EXEC)


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


def _forbidden_and_privilege(sections: dict[str, list[tuple[str, str]]], forbidden: tuple[str, ...],
                             text: str, unit: str) -> None:
    present = {key for pairs in sections.values() for key, _ in pairs}
    hits = sorted(present.intersection(forbidden))
    if hits:
        raise RuntimeError(f"{unit} declares a forbidden directive: " + ",".join(hits))
    _assert_no_privilege_escalation(text, unit)


def validate_node_proxy_service(text: str) -> None:
    sections = parse_unit(text)
    if set(sections) != NODE_PROXY_SERVICE_SECTIONS:
        raise RuntimeError("node proxy service sections drifted")
    _exact_directives(sections["Unit"], NODE_PROXY_SERVICE_UNIT_SECTION, NODE_PROXY_SERVICE_UNIT)
    _exact_directives(sections["Service"], NODE_PROXY_SERVICE_DIRECTIVES, NODE_PROXY_SERVICE_UNIT)
    _exact_directives(sections["Install"], NODE_PROXY_SERVICE_INSTALL_SECTION, NODE_PROXY_SERVICE_UNIT)
    # RestrictAddressFamilies / IPAddressDeny are REQUIRED confinement here (asserted by the set equality
    # above), so this forbidden set is the proxy's OWN, not the broker's, and holds directive NAMES only.
    _forbidden_and_privilege(sections, NODE_PROXY_SERVICE_FORBIDDEN, text, NODE_PROXY_SERVICE_UNIT)
    listeners = sorted({key for pairs in sections.values() for key, _ in pairs}.intersection(BROKER_LISTEN_DIRECTIVES))
    if listeners:
        raise RuntimeError("node proxy service declares a listener: " + ",".join(listeners))


def validate_whois_service(text: str) -> None:
    sections = parse_unit(text)
    if set(sections) != WHOIS_SERVICE_SECTIONS:
        raise RuntimeError("whois service sections drifted")
    _exact_directives(sections["Unit"], WHOIS_SERVICE_UNIT_SECTION, WHOIS_SERVICE_UNIT)
    _exact_directives(sections["Service"], WHOIS_SERVICE_DIRECTIVES, WHOIS_SERVICE_UNIT)
    _forbidden_and_privilege(sections, WHOIS_SERVICE_FORBIDDEN, text, WHOIS_SERVICE_UNIT)
    listeners = sorted({key for pairs in sections.values() for key, _ in pairs}.intersection(BROKER_LISTEN_DIRECTIVES))
    if listeners:
        raise RuntimeError("whois service declares a listener: " + ",".join(listeners))


def validate_whois_socket(text: str) -> None:
    sections = parse_unit(text)
    if set(sections) != {"Unit", "Socket", "Install"}:
        raise RuntimeError("whois socket sections drifted")
    _exact_directives(sections["Unit"], WHOIS_SOCKET_UNIT_SECTION, WHOIS_SOCKET_UNIT)
    _exact_directives(sections["Install"], WHOIS_SOCKET_INSTALL_SECTION, WHOIS_SOCKET_UNIT)
    _exact_directives(sections["Socket"], WHOIS_SOCKET_DIRECTIVES, WHOIS_SOCKET_UNIT)
    listeners = [(key, value) for pairs in sections.values() for key, value in pairs
                 if key in BROKER_LISTEN_DIRECTIVES]
    if listeners != [("ListenStream", WHOIS_SOCKET_PATH)]:
        raise RuntimeError("whois socket must declare exactly one Unix ListenStream")
    if not WHOIS_SOCKET_PATH.startswith("/") or ":" in WHOIS_SOCKET_PATH:
        raise RuntimeError("whois socket listener is not an AF_UNIX path")
    _assert_no_privilege_escalation(text, WHOIS_SOCKET_UNIT)


def validate_node_proxy_units(unit_root: Path = BROKER_UNIT_ROOT) -> bool:
    """Validate the installed node-proxy + WhoIs units when they exist (absence tolerated, presence strict —
    the broker's own contract). All three ride the attested release tree and are digest-verified at boot."""
    service = unit_root / NODE_PROXY_SERVICE_UNIT
    whois_service = unit_root / WHOIS_SERVICE_UNIT
    whois_socket = unit_root / WHOIS_SOCKET_UNIT
    present = [p for p in (service, whois_service, whois_socket) if p.exists()]
    if not present:
        return False
    if len(present) != 3:
        raise RuntimeError("node-proxy + WhoIs units must be installed as a trio")
    validate_node_proxy_service(service.read_text(encoding="utf-8"))
    validate_whois_service(whois_service.read_text(encoding="utf-8"))
    validate_whois_socket(whois_socket.read_text(encoding="utf-8"))
    return True


def validate_whois_runtime_dir(dir_stat: os.stat_result, sock_stat: os.stat_result, node_proxy_gid: int) -> None:
    """/run/kb-whois must be root:kb-node-proxy 0750, and whois.sock root:kb-node-proxy 0660 [P6-C62].
    Without the group, kb-node-proxy loses the traverse bit and the 0660 socket is unreachable."""
    if dir_stat.st_uid != 0 or dir_stat.st_gid != node_proxy_gid or stat.S_IMODE(dir_stat.st_mode) != WHOIS_DIR_MODE:
        raise RuntimeError(f"{WHOIS_RUNTIME_DIR} must be root:kb-node-proxy 0750")
    if sock_stat.st_uid != 0 or sock_stat.st_gid != node_proxy_gid or stat.S_IMODE(sock_stat.st_mode) != WHOIS_SOCKET_MODE:
        raise RuntimeError(f"{WHOIS_SOCKET_PATH} must be root:kb-node-proxy 0660")


def validate_tailscaled_socket(sock_stat: os.stat_result) -> None:
    """The pinned --socket value must exist AND be a socket [P6-C79]; anything else is a misconfigured shim."""
    if not stat.S_ISSOCK(sock_stat.st_mode):
        raise RuntimeError(f"pinned tailscaled socket {TAILSCALED_SOCKET_PATH} is not a socket")


def validate_no_operator_pref(run=subprocess.run) -> None:
    """`/usr/bin/tailscale debug prefs` must show NO OperatorUser [P6-C47]: kb-node-proxy holds no tailnet
    rights, so any operator pref means a grant the shim design forbids — fail the boot."""
    result = run([TAILSCALE_BINARY, "debug", "prefs"], check=True, text=True, capture_output=True, timeout=COMMAND_TIMEOUT)
    text = result.stdout.strip()
    operator = ""
    if text.startswith("{"):
        operator = (json.loads(text).get("OperatorUser") or "")
    else:
        for line in text.splitlines():
            match = re.match(r"\s*OperatorUser\s*[:=]\s*(\S+)", line)
            if match and match.group(1) not in ("", '""', "null", "<nil>"):
                operator = match.group(1)
    if operator:
        raise RuntimeError("tailnet has an OperatorUser pref set; kb-node-proxy must hold no operator grant")


def _serve_listener_ports(serve_status: dict) -> set[str]:
    return set((serve_status.get("TCP") or {}).keys())


def _serve_backend_for_port(serve_status: dict, port: str) -> str | None:
    for host_port, entry in (serve_status.get("Web") or {}).items():
        if host_port.endswith(f":{port}"):
            for handler in (entry.get("Handlers") or {}).values():
                proxy = handler.get("Proxy")
                if proxy:
                    return proxy
    tcp = (serve_status.get("TCP") or {}).get(port) or {}
    return tcp.get("TCPForward")


def validate_node_listener_and_uid(serve_status: dict, node_proxy_uid: int, expected_node_uid: int) -> None:
    """The fourth named validator [P6-C60]: from `tailscale serve status --json` the 8444 listener's only
    backend is the node proxy's port, and kb-node-proxy's uid == DASHBOARD_NODE_PROXY_UID. A single-listener
    config (no 8444) fails boot, and a uid mismatch fails boot."""
    ports = _serve_listener_ports(serve_status)
    if "443" not in ports or "8444" not in ports:
        raise RuntimeError("node identity requires two serve listeners (443 operator, 8444 node); single-listener config refused")
    backend = _serve_backend_for_port(serve_status, "8444")
    if backend not in (f"http://{NODE_PROXY_LISTEN_ADDR}", f"https://{NODE_PROXY_LISTEN_ADDR}", NODE_PROXY_LISTEN_ADDR):
        raise RuntimeError("the 8444 serve listener does not forward to the node proxy port")
    if node_proxy_uid != expected_node_uid:
        raise RuntimeError("kb-node-proxy uid does not match DASHBOARD_NODE_PROXY_UID")


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
        validate_node_proxy_units()
        fields = STATIC_SHOW
    else:
        show = read_live_unit(args.unit)
        validate_live_unit(show)
        fields = LIVE_SHOW
    print(f"validated VM runtime {args.phase} fields: " + ",".join(sorted(fields)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
