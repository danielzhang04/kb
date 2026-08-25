from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

try:
    from .control_plane_schema import EMPTY_CONTROL_PLANE, assert_control_plane_schema
    from .install_pty_broker import (
        Layout as BrokerLayout,
        SOCKET_UNIT,
        install_units as install_broker_units,
        provision_account_and_directories as provision_broker_account,
    )
except ImportError:  # direct `python deploy/bootstrap_vm.py` execution
    from control_plane_schema import EMPTY_CONTROL_PLANE, assert_control_plane_schema
    from install_pty_broker import (
        Layout as BrokerLayout,
        SOCKET_UNIT,
        install_units as install_broker_units,
        provision_account_and_directories as provision_broker_account,
    )

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


def provision_node_proxy(run=subprocess.run, source_root: Path | None = None) -> None:
    """Provision the attested node-proxy account (pinned uid) and install the frozen node-proxy + WhoIs
    unit trio. No proxy/shim code exists until the first release is activated, so the units are enabled but
    the node-proxy socket only comes up once the release tree lands."""
    root = source_root if source_root is not None else Path(__file__).resolve().parent
    run(["useradd", "--system", "--uid", str(NODE_PROXY_UID), "--home-dir", "/nonexistent",
         "--shell", "/usr/sbin/nologin", NODE_PROXY_USER], check=False)
    for unit in NODE_PROXY_UNITS:
        run(["install", "-o", "root", "-g", "root", "-m", "0444",
             str(root / "systemd" / unit), f"/etc/systemd/system/{unit}"], check=True)
    run(["systemctl", "daemon-reload"], check=True)
    run(["systemctl", "enable", "kb-whois.socket"], check=True)
    run(["systemctl", "enable", "kb-node-proxy.service"], check=True)


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


def unit_fragment_source(tailnet_host: str, tailnet_operator: str) -> bytes:
    """The repo unit fragment with this VM's tailnet host and operator appended.

    `DASHBOARD_AUTH_MODE=tailnet` is static in the fragment; the host varies per VM and the operator is the
    single pinned identity, so both are injected here. Both are REQUIRED: the daemon refuses to start
    without them.
    """
    validate_tailnet_host(tailnet_host)
    validate_tailnet_operator(tailnet_operator)
    source = (Path(__file__).resolve().parent / "systemd/kb-dashboard.service").read_bytes()
    # dashboard-v3 P6 §3.3: both proxy-uid envs are injected here. The tailnet (root serve) proxy is pinned
    # to 0 and the attested node proxy to its pinned system uid, so the distinctness rule
    # DASHBOARD_NODE_PROXY_UID ∉ {0, DASHBOARD_TAILNET_PROXY_UID} holds by construction.
    extra = (
        f"Environment=DASHBOARD_TAILNET_HOST={tailnet_host}\n"
        f"Environment=DASHBOARD_TAILNET_OPERATOR={tailnet_operator}\n"
        f"Environment=DASHBOARD_TAILNET_PROXY_UID={TAILNET_PROXY_UID}\n"
        f"Environment=DASHBOARD_NODE_PROXY_UID={NODE_PROXY_UID}\n"
    ).encode("ascii")
    result = source.replace(
        b"Environment=GIT_CONFIG_GLOBAL=/dev/null\n",
        b"Environment=GIT_CONFIG_GLOBAL=/dev/null\n" + extra,
    )
    if result == source:
        raise RuntimeError("kb-dashboard.service is missing the GIT_CONFIG_GLOBAL environment anchor")
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


def install_root_validators(
    release_public_key: Path,
    tailnet_host: str,
    tailnet_operator: str,
    run=subprocess.run,
    install_root: PurePosixPath = PurePosixPath("/usr/local/lib/kb"),
) -> None:
    validate_tailnet_host(tailnet_host)
    validate_tailnet_operator(tailnet_operator)
    public_key = release_public_key.read_text(encoding="ascii")
    source = public_key_module_source(public_key)
    descriptor, generated_name = tempfile.mkstemp(prefix="kb-release-signing-public-")
    generated = Path(generated_name)
    try:
        with os.fdopen(descriptor, "w", encoding="ascii", newline="") as output:
            output.write(source)
        generated.chmod(0o400)
        deploy_root = Path(__file__).resolve().parent
        run(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(install_root)], check=True)
        for helper in (
            "activate_release.py",
            "control_plane_schema.py",
            "validate_vm_runtime.py",
            "apply_ops_reconciliation.py",
            "export_tier0.py",
        ):
            run([
                "install", "-o", "root", "-g", "root", "-m", "0555",
                str(deploy_root / helper), str(install_root / helper),
            ], check=True)
        run(["install", "-o", "root", "-g", "root", "-m", "0444", str(generated), str(install_root / "release_signing_public.py")], check=True)
        unit_descriptor, unit_generated_name = tempfile.mkstemp(prefix="kb-dashboard-service-")
        unit_generated = Path(unit_generated_name)
        with os.fdopen(unit_descriptor, "wb") as output:
            output.write(unit_fragment_source(tailnet_host, tailnet_operator))
        unit_generated.chmod(0o400)
        try:
            run(["install", "-o", "root", "-g", "root", "-m", "0444", str(unit_generated), "/etc/systemd/system/kb-dashboard.service"], check=True)
        finally:
            unit_generated.chmod(0o600)
            unit_generated.unlink(missing_ok=True)
        run(["systemctl", "daemon-reload"], check=True)
        run(["systemctl", "enable", "kb-dashboard.service"], check=True)
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
    run(["systemctl", "daemon-reload"], check=True)
    run(["systemctl", "enable", SOCKET_UNIT], check=True)


def bootstrap(ops_bundle: Path, release_public_key: Path, tailnet_host: str, tailnet_operator: str, run=subprocess.run) -> None:
    # Validated BEFORE any command runs: a bad host/operator must not leave a half-bootstrapped VM behind.
    validate_tailnet_host(tailnet_host)
    validate_tailnet_operator(tailnet_operator)
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
    install_root_validators(release_public_key, tailnet_host, tailnet_operator, run=run)
    provision_pty_broker(run=run)
    provision_node_proxy(run=run)


def main() -> int:
    parser = argparse.ArgumentParser(description="Perform the one-time kb VM bootstrap")
    parser.add_argument("--ops-bundle", type=Path, required=True)
    parser.add_argument("--release-public-key", type=Path, required=True)
    parser.add_argument("--tailnet-host", required=True, help="the bare `tailscale serve` hostname this VM is published at")
    parser.add_argument("--tailnet-operator", default=DEFAULT_TAILNET_OPERATOR, help="the single tailnet login that IS the operator")
    args = parser.parse_args()
    bootstrap(args.ops_bundle, args.release_public_key, tailnet_host=args.tailnet_host, tailnet_operator=args.tailnet_operator)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
