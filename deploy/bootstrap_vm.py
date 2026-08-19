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

DATA_PATTERNS = ("/CLAUDE.md", "/BOSS.md", "/HEARTBEAT.md", "/docs/", "/orgs/", "/queue/", "/ledgers/", "/traces/", "/memory/", "/dashboards/", "/handoffs/", "/governance/", "/agents/", "/skills/")
PUBLIC_KEY_PATTERN = re.compile(r"ssh-ed25519 ([A-Za-z0-9+/]+={0,3})(?: [^ \r\n][^\r\n]*)?")
# The bare `tailscale serve` hostname this VM is published at. Mirrors validate_vm_runtime's pattern.
TAILNET_HOST_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
TAILNET_OPERATOR_PATTERN = re.compile(r"^\S+@\S+$")
# The single tailnet identity that IS the operator (Daniel, 2026-08-18). Required, fail-closed.
DEFAULT_TAILNET_OPERATOR = "daniel.zhang.t1@gmail.com"
STATE_ROOT = "/var/lib/kb/state"
EMPTY_CONTROL_PLANE = b'{"version":1,"nextEventCursor":1,"proposals":[],"runs":[],"stages":[],"attempts":[],"sessions":[],"humanRequests":[],"events":[],"stageGenerations":[],"iterationLoops":[],"iterationRequests":[],"iterationReceipts":[],"generationSupersessions":[],"quarantine":[]}\n'


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
        json.loads(final.read_bytes())
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
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
    extra = (
        f"Environment=DASHBOARD_TAILNET_HOST={tailnet_host}\n"
        f"Environment=DASHBOARD_TAILNET_OPERATOR={tailnet_operator}\n"
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
