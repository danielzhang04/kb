"""Provision a fresh kb VM (`bootstrap`), or converge an already-provisioned one (`upgrade`).

Operator runbook - the `upgrade` verb
=====================================

WHAT IT IS FOR. A VM bootstrapped before dashboard-v3 P6 cannot boot the current release: its unit
predates DASHBOARD_NODE_PROXY_UID, DASHBOARD_DESKTOP_HELPER_ORIGIN and RuntimeDirectory=kb-dashboard,
and the host sides of the node proxy and the PTY broker are absent. `upgrade` converges that host.
It touches NO data: never the ops checkout, never the state root, never a release tree, never the
host-node map, never the release signing key. The DO/SKIP/NEVER triage of every bootstrap step is a
table in `upgrade`'s own docstring.

PRECONDITIONS.
  * root on the VM, running from a checkout of the release you are about to deploy (the resident
    helpers and the unit are copied out of THIS deploy/ tree).
  * The VM was bootstrapped before: /usr/local/lib/kb/release_signing_public.py must exist. Its
    absence is a refusal - bootstrap such a host, do not upgrade it.
  * uid 987 is free or already belongs to kb-node-proxy. A uid held by another account is a refusal.
  * No /etc/systemd/system/kb-dashboard.service.d drop-in directory. Its presence is a refusal.
  * The desktop helper's tailnet origin, if the installed unit does not already carry one.

COMMAND. Rehearse first; the dry run executes nothing at all:

    sudo python3 deploy/bootstrap_vm.py upgrade --dry-run
    sudo python3 deploy/bootstrap_vm.py upgrade

Add `--desktop-helper-origin https://<desktop-host>.ts.net` when the installed unit has no
DASHBOARD_DESKTOP_HELPER_ORIGIN (a pre-P5 unit), or to change the pinned one. Omit it to preserve
what is installed. `--unit-path`, `--install-root`, `--host-node-map` and `--backup-dir` exist for
rehearsal against a fake tree and should be left at their defaults on a real host.

EXPECTED OUTPUT. A preflight block echoing the tailnet host, operator and helper origin it will
preserve; a WARNING if /etc/kb-dashboard/host-nodes.json is absent (node routes stay fail-closed
until Daniel installs it - this script never writes it); then one section per converged piece:
release staging directory, node-proxy account and units, PTY broker, resident helpers, unit backup,
unit re-render. It ends by listing what is still owed.

AFTER IT RETURNS - the run is NOT finished until all three are done:
  1. Activate a release: the node-proxy, WhoIs shim and broker EXECUTABLES ship inside the release
     tree, not with this script.
  2. Land the broker payload: `deploy/install_pty_broker.py --digest <the MANIFEST.sha256 digest of
     dashboard/dist-server/kb-shell-broker.tar.gz>`.
  3. `systemctl restart kb-dashboard.service`.
Until 1 and 2 are done, kb-node-proxy.service and kb-shell-broker.service are EXPECTED to sit failed
- their executables do not exist yet. That is not a failed upgrade.

ROLLBACK. The previous unit is copied to /root/kb-dashboard.service.pre-upgrade-<UTC> before the new
one is installed. To restore just the unit: install the newest such file over
/etc/systemd/system/kb-dashboard.service and `systemctl daemon-reload`. Note the resident helpers
under /usr/local/lib/kb are refreshed BEFORE the unit is replaced, so between those two steps - and
after a unit-only rollback - the new validator is paired with an old unit and a restart fails
ExecStartPre. Re-running `upgrade` is the shorter road back.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

try:
    from .control_plane_schema import EMPTY_CONTROL_PLANE, assert_control_plane_schema
    from .install_pty_broker import (
        INSTALL_BIN,
        Layout as BrokerLayout,
        SOCKET_UNIT,
        SYSTEMCTL_BIN,
        USERADD_BIN,
        install_units as install_broker_units,
        provision_account_and_directories as provision_broker_account,
    )
    from .validate_vm_runtime import EXPECTED_UNIT_ENV, OPTIONAL_UNIT_ENV, _unit_environment
except ImportError:  # direct `python deploy/bootstrap_vm.py` execution
    from control_plane_schema import EMPTY_CONTROL_PLANE, assert_control_plane_schema
    from install_pty_broker import (
        INSTALL_BIN,
        Layout as BrokerLayout,
        SOCKET_UNIT,
        SYSTEMCTL_BIN,
        USERADD_BIN,
        install_units as install_broker_units,
        provision_account_and_directories as provision_broker_account,
    )
    from validate_vm_runtime import EXPECTED_UNIT_ENV, OPTIONAL_UNIT_ENV, _unit_environment

DATA_PATTERNS = ("/CLAUDE.md", "/BOSS.md", "/HEARTBEAT.md", "/docs/", "/orgs/", "/queue/", "/ledgers/", "/traces/", "/memory/", "/dashboards/", "/handoffs/", "/governance/", "/agents/", "/skills/")
PUBLIC_KEY_PATTERN = re.compile(r"ssh-ed25519 ([A-Za-z0-9+/]+={0,3})(?: [^ \r\n][^\r\n]*)?")
# The bare `tailscale serve` hostname this VM is published at. Mirrors validate_vm_runtime's pattern.
TAILNET_HOST_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
TAILNET_OPERATOR_PATTERN = re.compile(r"^\S+@\S+$")
# The single tailnet identity that IS the operator (Daniel, 2026-08-18). Required, fail-closed.
DEFAULT_TAILNET_OPERATOR = "daniel.zhang.t1@gmail.com"
STATE_ROOT = "/var/lib/kb/state"

# dashboard-v3 P6 §3.3: the attested node-identity proxy account, created with a PINNED system uid so the
# injected DASHBOARD_NODE_PROXY_UID is deterministic and the boot validator's `id -u` == env check is exact.
# The tailnet (operator/root serve) proxy uid is pinned to 0. The dashboard refuses to boot unless
# DASHBOARD_NODE_PROXY_UID ∉ {0, DASHBOARD_TAILNET_PROXY_UID}.
NODE_PROXY_USER = "kb-node-proxy"
NODE_PROXY_UID = 987
TAILNET_PROXY_UID = 0
NODE_PROXY_UNITS = ("kb-node-proxy.service", "kb-whois.service", "kb-whois.socket")
# The root-owned host-node map: authorization derives a node's HostKind from THIS file only [design:416].
HOST_NODE_MAP_DIR = "/etc/kb-dashboard"
HOST_NODE_MAP_PATH = "/etc/kb-dashboard/host-nodes.json"
HOST_NODE_MAP_SCHEMA = "kb.host-node-map/v1"
NODE_ID_PATTERN = re.compile(r"^[A-Za-z0-9]{5,32}$")

# The resident root-owned tree. Shared by `bootstrap` and `upgrade`: both must leave byte-identical
# helper copies behind, so the list lives here once rather than in each caller.
RESIDENT_ROOT = "/usr/local/lib/kb"
RESIDENT_HELPERS = (
    "activate_release.py",
    "control_plane_schema.py",
    "validate_vm_runtime.py",
    "apply_ops_reconciliation.py",
    "export_tier0.py",
)
# Generated from the operator's key at bootstrap and NEVER regenerated afterwards: an upgrade that
# rewrote it could silently re-key release verification on a live VM.
RELEASE_SIGNING_MODULE = "release_signing_public.py"
DASHBOARD_UNIT = "kb-dashboard.service"
DASHBOARD_UNIT_PATH = f"/etc/systemd/system/{DASHBOARD_UNIT}"
UNIT_BACKUP_DIR = "/root"
RELEASE_STAGING_DIR = "/var/lib/kb-release-staging"
UNIT_ENVIRONMENT_PATTERN = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)")
# dashboard-v3 P5 [P5-C42]: the ONE desktop-helper tailnet address the deploy/asset-pull client speaks
# to. REQUIRED and never defaulted - the dashboard refuses composition without it, and
# validate_vm_runtime's EXPECTED_UNIT_ENV refuses the unit without it, so bootstrap_vm injects it.
HELPER_ORIGIN_HOST_SUFFIX = ".ts.net"
# Applied to the NORMALIZED origin, after the URL checks below have mirrored the TypeScript client.
# It exists because this value is written into a systemd `Environment=` line, where a space, newline,
# or quote would stop being a URL and start being a unit directive. It is slightly NARROWER than the
# WHATWG host grammar rather than a pure superset of it - an underscore label, say, parses there and
# is refused here - which is the safe direction for a value no tailnet name ever takes.
HELPER_ORIGIN_PATTERN = re.compile(r"https://[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?")


def validate_host_node_map(data: object) -> dict:
    """Deploy-side decode of the root-owned host-node map, mirroring auth/hostNodeMapContracts.ts exactly:
    the schema literal, a positive-integer revision, exactly {schema, revision, hosts, revoked}, hosts
    exactly {vm, desktop}, node-id charset, the two active ids distinct AND absent from revoked, and unique
    revoked entries with RFC 3339 revokedAt. Raises ValueError on any malformation (a bad map is refused at
    install rather than shipped)."""
    if not isinstance(data, dict):
        raise ValueError("host-node map must be an object")
    if set(data) != {"schema", "revision", "hosts", "revoked"}:
        raise ValueError("host-node map keys must be exactly schema/revision/hosts/revoked")
    if data["schema"] != HOST_NODE_MAP_SCHEMA:
        raise ValueError(f"host-node map schema must equal {HOST_NODE_MAP_SCHEMA}")
    revision = data["revision"]
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ValueError("host-node map revision must be a positive integer")
    hosts = data["hosts"]
    if not isinstance(hosts, dict) or set(hosts) != {"vm", "desktop"}:
        raise ValueError("host-node map hosts must be exactly {vm, desktop}")
    ids = {}
    for role in ("vm", "desktop"):
        node = hosts[role]
        if not isinstance(node, dict) or set(node) != {"nodeId"} or not isinstance(node["nodeId"], str) \
                or not NODE_ID_PATTERN.match(node["nodeId"]):
            raise ValueError(f"host-node map {role} nodeId must match /^[A-Za-z0-9]{{5,32}}$/")
        ids[role] = node["nodeId"]
    if ids["vm"] == ids["desktop"]:
        raise ValueError("host-node map active node ids must be distinct")
    revoked = data["revoked"]
    if not isinstance(revoked, list):
        raise ValueError("host-node map revoked must be an array")
    seen: set[str] = set()
    for entry in revoked:
        if not isinstance(entry, dict) or set(entry) != {"nodeId", "revokedAt"}:
            raise ValueError("host-node map revoked entries must be {nodeId, revokedAt}")
        node_id = entry["nodeId"]
        if not isinstance(node_id, str) or not NODE_ID_PATTERN.match(node_id):
            raise ValueError("host-node map revoked nodeId must match the node-id charset")
        if not _is_rfc3339_utc(entry["revokedAt"]):
            raise ValueError("host-node map revokedAt must be RFC 3339 UTC")
        if node_id in seen:
            raise ValueError(f"host-node map duplicate revoked id {node_id!r}")
        seen.add(node_id)
    if seen & set(ids.values()):
        raise ValueError("host-node map active id must not also be revoked")
    return data


def _is_rfc3339_utc(value: object) -> bool:
    from datetime import datetime
    if not isinstance(value, str) or not value.endswith(("Z", "+00:00")):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def install_host_node_map(source: Path, run=subprocess.run, target: str = HOST_NODE_MAP_PATH) -> None:
    """Install a Daniel-authored host-node map as root-owned 0444, refusing a malformed source first.
    Enrollment/rotation are file edits through deploy review — there is no endpoint and no hot reload."""
    validate_host_node_map(json.loads(source.read_text(encoding="utf-8")))
    run(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", HOST_NODE_MAP_DIR], check=True)
    run(["install", "-o", "root", "-g", "root", "-m", "0444", str(source), target], check=True)


def provision_node_proxy(run=subprocess.run, source_root: Path | None = None, lookup_uid=None) -> None:
    """Provision the attested node-proxy account (pinned uid) and install the frozen node-proxy + WhoIs
    unit trio. No proxy/shim code exists until the first release is activated, so the units are enabled but
    the node-proxy socket only comes up once the release tree lands.

    The account is created only when it does not already exist, and then with `check=True`: a
    swallowed `useradd` failure - exit 4 when uid 987 is already held by an unrelated account - would
    otherwise leave the run reporting success while DASHBOARD_NODE_PROXY_UID, the node-route trust
    anchor, pointed at somebody else's account. `--user-group` is explicit for the same reason
    install_pty_broker.py does not rely on it: kb-node-proxy.service's Group= and kb-whois.socket's
    SocketGroup= need the group to exist, and USERGROUPS_ENAB is host configuration, not a guarantee.
    """
    root = source_root if source_root is not None else Path(__file__).resolve().parent
    lookup_uid = _account_uid if lookup_uid is None else lookup_uid
    if lookup_uid(NODE_PROXY_USER) is None:
        run([USERADD_BIN, "--system", "--user-group", "--uid", str(NODE_PROXY_UID),
             "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin", NODE_PROXY_USER], check=True)
    for unit in NODE_PROXY_UNITS:
        run([INSTALL_BIN, "-o", "root", "-g", "root", "-m", "0444",
             str(root / "systemd" / unit), f"/etc/systemd/system/{unit}"], check=True)
    run([SYSTEMCTL_BIN, "daemon-reload"], check=True)
    run([SYSTEMCTL_BIN, "enable", "kb-whois.socket"], check=True)
    run([SYSTEMCTL_BIN, "enable", "kb-node-proxy.service"], check=True)


def normalize_desktop_helper_origin(value: object) -> str:
    """Validate and normalize the pinned desktop-helper origin; return the bare normalized origin.

    Mirrors dashboard/server/deploy/helperClient.ts#assertHelperOrigin check for check: an absolute
    `https:` URL whose host is a tailnet (`*.ts.net`) name, with no path, query, or fragment, reduced
    to `url.origin` (default port dropped, userinfo dropped, no trailing slash). There is no default
    [P5-C42] - the client fails composition on a missing or malformed value, so this fails the render.

    Two places are deliberately MORE closed than the TypeScript, both fail-closed: a value carrying
    whitespace or non-ASCII is refused before parsing, and the normalized result must match
    HELPER_ORIGIN_PATTERN. Both exist because this value is injected into a systemd unit rather than
    handed to a URL constructor. They are not a pure superset of the client's rules - a hostname the
    WHATWG parser tolerates but this pattern does not (an underscore label, say) is refused here and
    accepted there. That direction is the safe one, and no tailnet name looks like that; a legitimate
    host this refuses is a bug report, not a silent misconfiguration.
    """
    if not isinstance(value, str) or value == "":
        raise ValueError("dashboard desktop helper origin is required")
    if not value.isascii() or any(character.isspace() for character in value):
        raise ValueError("dashboard desktop helper origin is not a valid absolute URL")
    parsed = urlsplit(value)
    if parsed.scheme == "" or parsed.netloc == "":
        raise ValueError("dashboard desktop helper origin is not a valid absolute URL")
    if parsed.scheme != "https":
        raise ValueError("dashboard desktop helper origin must be an https: origin")
    try:
        hostname, port = parsed.hostname, parsed.port
    except ValueError as error:
        raise ValueError("dashboard desktop helper origin is not a valid absolute URL") from error
    if hostname is None or not hostname.endswith(HELPER_ORIGIN_HOST_SUFFIX):
        raise ValueError("dashboard desktop helper origin must be a tailnet (*.ts.net) host")
    if parsed.path not in ("", "/") or parsed.query != "" or parsed.fragment != "":
        raise ValueError("dashboard desktop helper origin must be a bare origin with no path, query, or fragment")
    origin = f"https://{hostname}" if port in (None, 443) else f"https://{hostname}:{port}"
    if HELPER_ORIGIN_PATTERN.fullmatch(origin) is None:
        raise ValueError("dashboard desktop helper origin is not a valid absolute URL")
    return origin


def validate_tailnet_host(value: str) -> None:
    if TAILNET_HOST_PATTERN.fullmatch(value) is None:
        raise ValueError("dashboard tailnet host is invalid")


def validate_tailnet_operator(value: str) -> None:
    if TAILNET_OPERATOR_PATTERN.fullmatch(value) is None:
        raise ValueError("dashboard tailnet operator is invalid")


def seed_control_plane(state_root: Path) -> None:
    control = state_root / "control"
    control.mkdir(mode=0o700, exist_ok=True)
    os.chmod(control, 0o700)
    final = control / "control-plane.json"
    for stale in control.glob(".control-plane.json.*.tmp"):
        stale.unlink(missing_ok=True)
    if final.exists():
        _validate_control_plane(final)
        return

    descriptor, temporary_name = tempfile.mkstemp(prefix=".control-plane.json.", suffix=".tmp", dir=control)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(EMPTY_CONTROL_PLANE)
            output.flush()
            os.fsync(output.fileno())
        _fsync_directory(control)
        try:
            os.link(temporary, final)
        except FileExistsError:
            _validate_control_plane(final)
            return
        os.chmod(final, 0o600)
        _fsync_directory(control)
    finally:
        temporary.unlink(missing_ok=True)
        _fsync_directory(control)


def _validate_control_plane(final: Path) -> None:
    try:
        assert_control_plane_schema(json.loads(final.read_bytes()))
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
        raise RuntimeError(f"control-plane state is corrupt: {final}; restore or remove it before re-running bootstrap") from error


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def assert_unit_env_complete(rendered: bytes) -> None:
    """What we render must satisfy the resident boot validator's closed env set, exactly.

    Everything here is borrowed from deploy/validate_vm_runtime.py - the same module this script
    installs at /usr/local/lib/kb and that the unit's own ExecStartPre runs - so the renderer cannot
    drift from the validator. Its `_unit_environment` reader is used rather than this module's
    tolerant one BECAUSE it is stricter: it shlex-splits and rejects a repeated name, so a value that
    renders fine but explodes on the boot path (an unbalanced quote in an operator identity, say)
    fails HERE. The comparison is set EQUALITY against the same closed set the validator checks, so an
    invented name is refused as loudly as a missing one. Either way, before a single command runs.
    """
    assigned = set(_unit_environment(rendered.decode("utf-8")))
    allowed = EXPECTED_UNIT_ENV | OPTIONAL_UNIT_ENV
    missing, unexpected = sorted(EXPECTED_UNIT_ENV - assigned), sorted(assigned - allowed)
    if missing or unexpected:
        raise RuntimeError(
            "rendered kb-dashboard.service environment set does not match what validate_vm_runtime.py"
            f" requires at boot (missing: {','.join(missing) or 'none'};"
            f" unexpected: {','.join(unexpected) or 'none'}); the service would fail ExecStartPre")


def unit_fragment_source(tailnet_host: str, tailnet_operator: str, desktop_helper_origin: str) -> bytes:
    """The repo unit fragment with this VM's site-specific values appended.

    `DASHBOARD_AUTH_MODE=tailnet` is static in the fragment; the host varies per VM, the operator is the
    single pinned identity, and the desktop-helper origin is the one address the deploy client speaks
    to, so all three are injected here. All are REQUIRED: the daemon refuses to start without them.
    """
    validate_tailnet_host(tailnet_host)
    validate_tailnet_operator(tailnet_operator)
    helper_origin = normalize_desktop_helper_origin(desktop_helper_origin)
    source = (Path(__file__).resolve().parent / "systemd/kb-dashboard.service").read_bytes()
    # dashboard-v3 P6 §3.3: both proxy-uid envs are injected here. The tailnet (root serve) proxy is pinned
    # to 0 and the attested node proxy to its pinned system uid, so the distinctness rule
    # DASHBOARD_NODE_PROXY_UID ∉ {0, DASHBOARD_TAILNET_PROXY_UID} holds by construction.
    extra = (
        f"Environment=DASHBOARD_TAILNET_HOST={tailnet_host}\n"
        f"Environment=DASHBOARD_TAILNET_OPERATOR={tailnet_operator}\n"
        f"Environment=DASHBOARD_DESKTOP_HELPER_ORIGIN={helper_origin}\n"
        f"Environment=DASHBOARD_TAILNET_PROXY_UID={TAILNET_PROXY_UID}\n"
        f"Environment=DASHBOARD_NODE_PROXY_UID={NODE_PROXY_UID}\n"
    ).encode("ascii")
    result = source.replace(
        b"Environment=GIT_CONFIG_GLOBAL=/dev/null\n",
        b"Environment=GIT_CONFIG_GLOBAL=/dev/null\n" + extra,
    )
    if result == source:
        raise RuntimeError("kb-dashboard.service is missing the GIT_CONFIG_GLOBAL environment anchor")
    assert_unit_env_complete(result)
    return result


def public_key_module_source(public_key: str) -> str:
    lines = public_key.splitlines()
    if "PRIVATE KEY" in public_key or len(lines) != 1:
        raise ValueError("release public key must be one unadorned ssh-ed25519 public key")
    match = PUBLIC_KEY_PATTERN.fullmatch(lines[0])
    if match is None:
        raise ValueError("release public key must be one unadorned ssh-ed25519 public key")
    encoded = match.group(1)
    try:
        blob = base64.b64decode(encoded, validate=True)
    except binascii.Error as error:
        raise ValueError("release public key must be one unadorned ssh-ed25519 public key") from error
    expected_prefix = len(b"ssh-ed25519").to_bytes(4, "big") + b"ssh-ed25519" + (32).to_bytes(4, "big")
    if len(blob) != len(expected_prefix) + 32 or not blob.startswith(expected_prefix):
        raise ValueError("release public key must be one unadorned ssh-ed25519 public key")
    return f"RELEASE_PUBLIC_KEY = {f'ssh-ed25519 {encoded}'!r}\n"


def install_resident_helpers(
    run=subprocess.run,
    install_root: PurePosixPath | Path = PurePosixPath(RESIDENT_ROOT),
    source_root: Path | None = None,
) -> None:
    """Refresh the root-owned resident helper scripts from the deploy/ tree this script runs from.

    Pure code, no state: every helper is a fresh read-only copy of a file already under review, so a
    re-run on an existing VM is a byte-for-byte no-op unless the release actually changed the helper.
    """
    deploy_root = Path(__file__).resolve().parent if source_root is None else source_root
    run([INSTALL_BIN, "-d", "-o", "root", "-g", "root", "-m", "0755", str(install_root)], check=True)
    for helper in RESIDENT_HELPERS:
        run([
            INSTALL_BIN, "-o", "root", "-g", "root", "-m", "0555",
            str(deploy_root / helper), str(install_root / helper),
        ], check=True)


def install_dashboard_unit(
    tailnet_host: str,
    tailnet_operator: str,
    desktop_helper_origin: str,
    run=subprocess.run,
    unit_path: PurePosixPath | Path = PurePosixPath(DASHBOARD_UNIT_PATH),
) -> None:
    """Render the repo unit fragment for this VM, install it root-owned 0444, reload and enable.

    Shared by `bootstrap` and `upgrade` so a converged VM and a fresh one carry the same unit bytes.
    Rendering the WHOLE fragment (rather than patching the installed file) is what makes the upgrade
    safe after partial manual provisioning: hand-injected Environment lines are discarded, not merged.
    """
    descriptor, generated_name = tempfile.mkstemp(prefix="kb-dashboard-service-")
    generated = Path(generated_name)
    with os.fdopen(descriptor, "wb") as output:
        output.write(unit_fragment_source(tailnet_host, tailnet_operator, desktop_helper_origin))
    generated.chmod(0o400)
    try:
        run([INSTALL_BIN, "-o", "root", "-g", "root", "-m", "0444", str(generated), str(unit_path)], check=True)
    finally:
        generated.chmod(0o600)
        generated.unlink(missing_ok=True)
    run([SYSTEMCTL_BIN, "daemon-reload"], check=True)
    run([SYSTEMCTL_BIN, "enable", DASHBOARD_UNIT], check=True)


def install_root_validators(
    release_public_key: Path,
    tailnet_host: str,
    tailnet_operator: str,
    desktop_helper_origin: str,
    run=subprocess.run,
    install_root: PurePosixPath = PurePosixPath(RESIDENT_ROOT),
) -> None:
    validate_tailnet_host(tailnet_host)
    validate_tailnet_operator(tailnet_operator)
    normalize_desktop_helper_origin(desktop_helper_origin)
    public_key = release_public_key.read_text(encoding="ascii")
    source = public_key_module_source(public_key)
    descriptor, generated_name = tempfile.mkstemp(prefix="kb-release-signing-public-")
    generated = Path(generated_name)
    try:
        with os.fdopen(descriptor, "w", encoding="ascii", newline="") as output:
            output.write(source)
        generated.chmod(0o400)
        install_resident_helpers(run=run, install_root=install_root)
        run([INSTALL_BIN, "-o", "root", "-g", "root", "-m", "0444", str(generated), str(install_root / RELEASE_SIGNING_MODULE)], check=True)
        install_dashboard_unit(tailnet_host, tailnet_operator, desktop_helper_origin, run=run)
    finally:
        if generated.exists():
            generated.chmod(0o600)
        generated.unlink(missing_ok=True)


def provision_pty_broker(run=subprocess.run, layout: BrokerLayout | None = None) -> None:
    """Newly provisioned machines get the PTY broker here.

    Only the account, its filesystem, and the two units: no broker code exists until the first
    release is activated, so the socket is enabled but never started. Existing VMs take the same end
    state through the bounded deploy/install_pty_broker.py instead.
    """
    layout = BrokerLayout() if layout is None else layout
    provision_broker_account(layout, run)
    install_broker_units(layout, run, source_root=Path(__file__).resolve().parents[1])
    run([SYSTEMCTL_BIN, "daemon-reload"], check=True)
    run([SYSTEMCTL_BIN, "enable", SOCKET_UNIT], check=True)


def unit_environment(text: str) -> dict[str, str]:
    """Every `Environment=NAME=VALUE` assignment in an installed unit, LAST assignment wins.

    Deliberately more tolerant than the boot validator's own reader: an operator who hand-patched the
    old unit may well have appended a duplicate assignment, and this reader exists only to recover the
    two site-specific values before the whole file is re-rendered from the repo fragment. Quoting is
    not unwrapped - the values this recovers are validated against their own patterns by the caller,
    and a quoted value simply fails that validation loudly.
    """
    assigned: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("Environment="):
            continue
        for token in stripped.removeprefix("Environment=").split():
            match = UNIT_ENVIRONMENT_PATTERN.fullmatch(token)
            if match is not None:
                assigned[match.group(1)] = match.group(2)
    return assigned


def installed_tailnet_identity(unit_path: Path) -> tuple[str, str, str | None]:
    """The site-specific values carried by the CURRENTLY installed unit.

    An upgrade must never invent these: the host is what `tailscale serve` publishes this VM at, and
    the operator is the single pinned identity that IS the operator. Absent or malformed, the upgrade
    refuses rather than guessing a value that would silently re-point authority.

    The desktop-helper origin is returned RAW and may be None: a pre-P5 unit has none, and a malformed
    one must still be overridable by `--desktop-helper-origin` rather than aborting the read.
    """
    if not unit_path.is_file():
        raise RuntimeError(f"installed dashboard unit is absent: {unit_path}; this VM was never bootstrapped")
    environment = unit_environment(unit_path.read_text(encoding="utf-8"))
    missing = [name for name in ("DASHBOARD_TAILNET_HOST", "DASHBOARD_TAILNET_OPERATOR") if name not in environment]
    if missing:
        raise RuntimeError(
            f"installed dashboard unit {unit_path} does not assign " + ",".join(missing)
            + "; refusing to guess this VM's tailnet identity")
    tailnet_host = environment["DASHBOARD_TAILNET_HOST"]
    tailnet_operator = environment["DASHBOARD_TAILNET_OPERATOR"]
    validate_tailnet_host(tailnet_host)
    validate_tailnet_operator(tailnet_operator)
    return tailnet_host, tailnet_operator, environment.get("DASHBOARD_DESKTOP_HELPER_ORIGIN")


def select_desktop_helper_origin(installed: str | None, override: str | None, emit=print) -> str:
    """Decide which desktop-helper origin the upgrade renders, and say so out loud.

    Preserved from the installed unit by default, exactly like the host and operator. An explicit
    `--desktop-helper-origin` wins, with a printed notice so the change is never silent. Neither
    present is a REFUSAL naming the flag: rendering a unit without it produces a service the resident
    validator rejects at ExecStartPre and a dashboard that refuses composition [P5-C42].
    """
    if override is not None:
        chosen = normalize_desktop_helper_origin(override)
        if installed is None:
            emit(f"[upgrade] using --desktop-helper-origin {chosen}; the installed unit assigns none")
        elif installed != chosen:
            emit(f"NOTICE: --desktop-helper-origin {chosen} overrides the installed"
                 f" DASHBOARD_DESKTOP_HELPER_ORIGIN={installed}")
        return chosen
    if installed is None:
        raise RuntimeError(
            "the installed dashboard unit does not assign DASHBOARD_DESKTOP_HELPER_ORIGIN and no"
            " --desktop-helper-origin was given; the dashboard refuses composition without it and"
            " validate_vm_runtime.py refuses the unit, so there is nothing safe to render."
            " Re-run with --desktop-helper-origin https://<desktop-host>.ts.net")
    return normalize_desktop_helper_origin(installed)


def _account_uid(name: str) -> int | None:
    """The uid of an existing local account, or None when it does not exist.

    A `pwd` lookup rather than an `id -u` subprocess on purpose: it is one of the two preflight
    answers that decide whether the upgrade refuses, and `--dry-run` must be able to reach it while
    running nothing at all. Absent `pwd` (Windows, tests) the account cannot exist.
    """
    try:
        import pwd
    except ImportError:
        return None
    try:
        return pwd.getpwnam(name).pw_uid
    except KeyError:
        return None


def _account_name(uid: int) -> str | None:
    """The account currently HOLDING a uid, or None when the uid is free.

    The other half of the identity check, and the half a name lookup cannot answer: uid 987 may be
    held by an unrelated system account (polkitd and friends land in that range), in which case
    `useradd --uid 987` fails and the injected DASHBOARD_NODE_PROXY_UID would name somebody else.
    Read-only, so `--dry-run` reaches it too.
    """
    try:
        import pwd
    except ImportError:
        return None
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return None


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class DryRunner:
    """The `run=` stand-in for `--dry-run`: records and prints argv, executes nothing.

    The one probe whose ANSWER changes the plan - the broker installer's `id -u <account>` - is
    answered from the read-only account lookup instead of a subprocess, so the printed plan is the
    plan a real run would actually follow rather than an optimistic one.
    """

    def __init__(self, lookup_uid=_account_uid, emit=print) -> None:
        self.commands: list[list[str]] = []
        self._lookup_uid = lookup_uid
        self._emit = emit

    def __call__(self, argv, **kwargs) -> subprocess.CompletedProcess:
        rendered = [str(token) for token in argv]
        self.commands.append(rendered)
        self._emit("would run: " + " ".join(rendered))
        if len(rendered) == 3 and rendered[0].rsplit("/", 1)[-1] == "id" and rendered[1] == "-u":
            uid = self._lookup_uid(rendered[2])
            if uid is None:
                return subprocess.CompletedProcess(rendered, 1, "", f"id: '{rendered[2]}': no such user\n")
            return subprocess.CompletedProcess(rendered, 0, f"{uid}\n", "")
        return subprocess.CompletedProcess(rendered, 0, "", "")


def upgrade(
    run=subprocess.run,
    unit_path: Path = Path(DASHBOARD_UNIT_PATH),
    install_root: Path = Path(RESIDENT_ROOT),
    host_node_map_path: Path = Path(HOST_NODE_MAP_PATH),
    backup_dir: Path = Path(UNIT_BACKUP_DIR),
    desktop_helper_origin: str | None = None,
    dry_run: bool = False,
    lookup_uid=_account_uid,
    lookup_user=_account_name,
    now=_utc_stamp,
    emit=print,
) -> None:
    """Converge an ALREADY-bootstrapped VM onto the current runtime contract, touching no state.

    The VM this exists for was bootstrapped before dashboard-v3 P6: its unit predates
    DASHBOARD_NODE_PROXY_UID and RuntimeDirectory=kb-dashboard, and it has neither the node-proxy nor
    the PTY-broker host side. Idempotent, and safe after partial manual provisioning: every account
    creation tolerates an existing account, every directory action is an `install -d`, and the unit is
    re-RENDERED from the repo fragment rather than patched, so hand-injected lines are simply gone.

    Every line of `bootstrap()` was triaged into one of three buckets. NEVER means the action touches
    data or state that a live VM already owns:

    | bootstrap() action                                    | upgrade   | why                                                                       |
    |-------------------------------------------------------|-----------|---------------------------------------------------------------------------|
    | validate_tailnet_host / _operator / helper origin     | DO        | applied to the values RECOVERED from the installed unit, before any change |
    | systemctl disable --now kb-dashboard.service          | SKIP      | bootstrap stops a service that would write into the tree it is about to    |
    |                                                       |           | clone; upgrade clones nothing, and taking the live dashboard down is not   |
    |                                                       |           | this script's call. daemon-reload + enable only; the operator restarts.    |
    | useradd kb-dashboard                                  | SKIP      | present: the running service is already User=kb-dashboard                  |
    | install -d /opt/kb-releases                           | SKIP      | present, and it is the parent of the release trees this must not touch     |
    | install -d STATE_ROOT + outbox/{ready,receipts,...}   | NEVER     | live state; `install -d` re-chowns an existing directory                   |
    | install -d -m 0700 STATE_ROOT/control                 | NEVER     | live state                                                                 |
    | seed_control_plane(state_root)                        | NEVER     | writes the control-plane document                                          |
    | chown STATE_ROOT/control/control-plane.json           | NEVER     | live state                                                                 |
    | install -d /var/lib/kb-release-staging                | DO        | may be absent on a pre-P6 VM; `install -d` is idempotent and holds no data |
    | install -d /var/lib/kb/ops                            | SKIP      | present, and it is the ops checkout's own directory                        |
    | git clone --branch ops ... /var/lib/kb/ops            | NEVER     | would destroy the live ops checkout                                        |
    | git -C /var/lib/kb/ops config user.email / user.name  | NEVER     | rewrites the live checkout's .git/config                                   |
    | git -C ... sparse-checkout set / checkout ops         | NEVER     | rewrites the live working tree                                             |
    | git -C ... update-ref refs/kb-outbox/spooled HEAD     | NEVER     | would rewind the outbox spool pointer and re-publish banked coordination   |
    | git -C ... remote set-url origin disabled://...       | NEVER     | live checkout config; already applied at bootstrap                         |
    | chown -R kb-dashboard:kb-dashboard /var/lib/kb/ops .. | NEVER     | recursive ownership rewrite across ops AND state                           |
    | install_root_validators: resident helper scripts      | DO        | pure code, sourced from THIS deploy/ tree; idempotent overwrite            |
    | install_root_validators: release_signing_public.py    | NEVER     | already on the VM; regenerating it would re-key release verification.      |
    |                                                       |           | Its ABSENCE is a hard refusal - that VM was never bootstrapped.            |
    | install_root_validators: unit render + install        | DO        | the whole point; host/operator preserved, old unit backed up first         |
    | install_root_validators: daemon-reload + enable       | DO        | idempotent                                                                 |
    | provision_pty_broker(run)                             | DO        | account + units + enabled socket; no broker code until activation          |
    | provision_node_proxy(run)                             | DO        | the missing DASHBOARD_NODE_PROXY_UID identity; refuses on a uid conflict   |
    | (not in bootstrap) host-node map                      | NEVER     | Daniel-authored; absence is WARNED about, never filled in                  |
    """
    if dry_run:
        run = DryRunner(lookup_uid=lookup_uid, emit=emit)

    # --- preflight: read-only, and every refusal fires before the first mutation ------------------
    emit("[upgrade] preflight")
    # BOTH directions of the identity. Name to uid catches a kb-node-proxy account someone already
    # made with the wrong uid; uid to name catches the case a name lookup cannot see at all - uid 987
    # held by an unrelated system account, where `useradd --uid 987` fails with exit 4 and the
    # injected DASHBOARD_NODE_PROXY_UID would name that account as the node-route trust anchor.
    existing_uid = lookup_uid(NODE_PROXY_USER)
    if existing_uid is not None and existing_uid != NODE_PROXY_UID:
        raise RuntimeError(
            f"account {NODE_PROXY_USER} already exists with uid {existing_uid}, not the pinned"
            f" {NODE_PROXY_UID}; the injected DASHBOARD_NODE_PROXY_UID would not match `id -u` and the"
            " dashboard would refuse every node request. Resolve the uid by hand before upgrading.")
    holder = lookup_user(NODE_PROXY_UID)
    if holder is not None and holder != NODE_PROXY_USER:
        raise RuntimeError(
            f"uid {NODE_PROXY_UID} is already held by account {holder!r}, not {NODE_PROXY_USER};"
            f" useradd would fail and DASHBOARD_NODE_PROXY_UID={NODE_PROXY_UID} would pin the node-route"
            f" trust anchor to {holder!r}. Free the uid or re-pin NODE_PROXY_UID before upgrading.")
    drop_in_dir = unit_path.with_name(unit_path.name + ".d")
    if drop_in_dir.is_dir():
        raise RuntimeError(
            f"unit drop-in directory exists: {drop_in_dir}; its fragments would survive the re-render"
            " unreviewed, and the boot validator rejects a non-empty DropInPaths outright. Move it"
            " aside and fold anything it carries into deploy/systemd/kb-dashboard.service.")
    tailnet_host, tailnet_operator, installed_origin = installed_tailnet_identity(unit_path)
    emit(f"[upgrade] preserving DASHBOARD_TAILNET_HOST={tailnet_host}"
         f" DASHBOARD_TAILNET_OPERATOR={tailnet_operator}")
    helper_origin = select_desktop_helper_origin(installed_origin, desktop_helper_origin, emit=emit)
    emit(f"[upgrade] rendering DASHBOARD_DESKTOP_HELPER_ORIGIN={helper_origin}")
    signing_module = install_root / RELEASE_SIGNING_MODULE
    if not signing_module.is_file():
        raise RuntimeError(
            f"release signing public key module is absent: {signing_module}; upgrade never generates"
            " one - bootstrap this VM instead of upgrading it")
    if not host_node_map_path.is_file():
        emit(f"WARNING: {host_node_map_path} is absent; node routes stay fail-closed until the"
             " Daniel-authored host-node map is installed (upgrade never creates it)")
    # Renders and throws the bytes away: proves the unit this run WILL install assigns every name
    # validate_vm_runtime.py requires, while nothing has been mutated yet.
    unit_fragment_source(tailnet_host, tailnet_operator, helper_origin)

    # --- converge ---------------------------------------------------------------------------------
    emit("[upgrade] release staging directory")
    run([INSTALL_BIN, "-d", "-o", "root", "-g", "root", "-m", "0700", RELEASE_STAGING_DIR], check=True)
    emit("[upgrade] node-proxy account and units")
    provision_node_proxy(run=run, lookup_uid=lookup_uid)
    if not dry_run:
        # The account this run just made IS the node-route trust anchor. Read it back rather than
        # trusting useradd's exit code, so a host that somehow ended up with a different uid stops the
        # upgrade here instead of at the first node request.
        provisioned = lookup_uid(NODE_PROXY_USER)
        if provisioned != NODE_PROXY_UID:
            raise RuntimeError(
                f"after provisioning, {NODE_PROXY_USER} has uid {provisioned}, not the pinned"
                f" {NODE_PROXY_UID}; the unit is NOT installed and the VM is unchanged apart from the"
                " node-proxy units. Resolve the account by hand and re-run.")
    emit("[upgrade] PTY broker account, filesystem and units")
    provision_pty_broker(run=run)
    emit("[upgrade] from here until this run completes, a `systemctl restart"
         f" {DASHBOARD_UNIT}` WILL FAIL: the new resident validator lands before the new unit does."
         " If this run aborts, either re-run upgrade or restore the unit from"
         f" {backup_dir / (DASHBOARD_UNIT + '.pre-upgrade-*')} alongside the old helpers.")
    emit("[upgrade] resident root helpers")
    install_resident_helpers(run=run, install_root=install_root)
    emit("[upgrade] backing up the installed dashboard unit")
    backup = backup_dir / f"{DASHBOARD_UNIT}.pre-upgrade-{now()}"
    run([INSTALL_BIN, "-o", "root", "-g", "root", "-m", "0400", str(unit_path), str(backup)], check=True)
    emit(f"[upgrade] re-rendering {unit_path}")
    install_dashboard_unit(tailnet_host, tailnet_operator, helper_origin, run=run, unit_path=unit_path)
    emit("[upgrade] converged. The dashboard was NOT restarted, and it is NOT yet startable. Owed:")
    emit("[upgrade]   1. activate a release (deploy/activate_release.py) - the node-proxy and broker"
         " code ships inside the release tree, not with this script")
    emit("[upgrade]   2. land the broker payload: deploy/install_pty_broker.py --digest <the"
         " MANIFEST.sha256 digest of dashboard/dist-server/kb-shell-broker.tar.gz>")
    emit(f"[upgrade]   3. then `systemctl restart {DASHBOARD_UNIT}`")
    emit("[upgrade] Until 1 and 2 are done, kb-node-proxy.service and kb-shell-broker.service are"
         " EXPECTED to sit failed - their executables do not exist yet. That is not a bad upgrade.")
    emit("[upgrade] Rollback of the unit alone: install the newest"
         f" {backup_dir / (DASHBOARD_UNIT + '.pre-upgrade-*')} over {unit_path}, then daemon-reload.")


def bootstrap(ops_bundle: Path, release_public_key: Path, tailnet_host: str, tailnet_operator: str, desktop_helper_origin: str, run=subprocess.run) -> None:
    # Validated BEFORE any command runs: a bad host/operator/helper-origin must not leave a
    # half-bootstrapped VM behind.
    validate_tailnet_host(tailnet_host)
    validate_tailnet_operator(tailnet_operator)
    normalize_desktop_helper_origin(desktop_helper_origin)
    run(["systemctl", "disable", "--now", "kb-dashboard.service"], check=False)
    run(["useradd", "--system", "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin", "kb-dashboard"], check=False)
    run(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", "/opt/kb-releases"], check=True)
    for path in (STATE_ROOT, f"{STATE_ROOT}/outbox/ready", f"{STATE_ROOT}/outbox/receipts", f"{STATE_ROOT}/outbox/incoming"):
        run(["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard", path], check=True)
    run(["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard", "-m", "0700", f"{STATE_ROOT}/control"], check=True)
    state_root = Path(STATE_ROOT)
    if not state_root.is_dir():
        raise RuntimeError(f"state root was not created: {state_root}")
    seed_control_plane(state_root)
    run(["chown", "kb-dashboard:kb-dashboard", str(state_root / "control/control-plane.json")], check=True)
    run(["install", "-d", "-o", "root", "-g", "root", "-m", "0700", "/var/lib/kb-release-staging"], check=True)
    run(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", "/var/lib/kb/ops"], check=True)
    run(["git", "clone", "--branch", "ops", "--no-checkout", str(ops_bundle), "/var/lib/kb/ops"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "config", "--replace-all", "user.email", "kb-dashboard@agents.local"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "config", "--replace-all", "user.name", "kb-dashboard"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "sparse-checkout", "set", "--no-cone", *DATA_PATTERNS], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "checkout", "ops"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "update-ref", "refs/kb-outbox/spooled", "HEAD"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "origin", "disabled://desktop-promotion-only"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "--push", "origin", "disabled://desktop-promotion-only"], check=True)
    run(["chown", "-R", "kb-dashboard:kb-dashboard", "/var/lib/kb/ops", STATE_ROOT], check=True)
    install_root_validators(release_public_key, tailnet_host, tailnet_operator, desktop_helper_origin, run=run)
    provision_pty_broker(run=run)
    provision_node_proxy(run=run)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Provision a fresh kb VM, or converge an existing one")
    subparsers = parser.add_subparsers(dest="command", required=True)

    boot = subparsers.add_parser("bootstrap", help="one-time provisioning of a fresh VM",
                                 description="Perform the one-time kb VM bootstrap")
    boot.add_argument("--ops-bundle", type=Path, required=True)
    boot.add_argument("--release-public-key", type=Path, required=True)
    boot.add_argument("--tailnet-host", required=True, help="the bare `tailscale serve` hostname this VM is published at")
    boot.add_argument("--tailnet-operator", default=DEFAULT_TAILNET_OPERATOR, help="the single tailnet login that IS the operator")
    boot.add_argument("--desktop-helper-origin", required=True, help="the pinned https://<desktop>.ts.net origin of the desktop helper; REQUIRED, never defaulted")

    converge = subparsers.add_parser(
        "upgrade",
        help="converge an existing VM onto the current runtime contract",
        description="Converge an already-bootstrapped VM onto the current runtime contract."
                    " Touches no state: never the ops checkout, the state root, or a release tree.")
    converge.add_argument("--dry-run", action="store_true", help="print every command that would run, execute nothing")
    converge.add_argument("--desktop-helper-origin", default=None, help="override the pinned desktop-helper origin; by default the installed unit's value is preserved, and its absence from both is a refusal")
    # Path seams. Defaults are the real VM locations; overriding them is for rehearsal and tests.
    converge.add_argument("--unit-path", type=Path, default=Path(DASHBOARD_UNIT_PATH), help="the installed dashboard unit to read the tailnet identity from and re-render")
    converge.add_argument("--install-root", type=Path, default=Path(RESIDENT_ROOT), help="the resident root-owned helper directory")
    converge.add_argument("--host-node-map", type=Path, default=Path(HOST_NODE_MAP_PATH), help="the Daniel-authored host-node map, checked for but never created")
    converge.add_argument("--backup-dir", type=Path, default=Path(UNIT_BACKUP_DIR), help="where the pre-upgrade copy of the unit is kept")
    return parser


def main(argv: list[str] | None = None) -> int:
    tokens = list(sys.argv[1:] if argv is None else argv)
    # Backward compatible: before the subcommands existed, the whole CLI was the bootstrap flags. A
    # leading flag therefore still means `bootstrap`, so every existing caller keeps working verbatim.
    if tokens and tokens[0].startswith("-") and tokens[0] not in ("-h", "--help"):
        tokens.insert(0, "bootstrap")
    args = build_parser().parse_args(tokens)
    if args.command == "upgrade":
        upgrade(
            unit_path=args.unit_path,
            install_root=args.install_root,
            host_node_map_path=args.host_node_map,
            backup_dir=args.backup_dir,
            desktop_helper_origin=args.desktop_helper_origin,
            dry_run=args.dry_run,
        )
        return 0
    bootstrap(args.ops_bundle, args.release_public_key, tailnet_host=args.tailnet_host,
              tailnet_operator=args.tailnet_operator, desktop_helper_origin=args.desktop_helper_origin)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
