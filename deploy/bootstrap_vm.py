from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import shlex
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

try:
    from .validate_vm_runtime import validate_webauthn_credentials
except ImportError:
    from validate_vm_runtime import validate_webauthn_credentials


DATA_PATTERNS = ("/CLAUDE.md", "/BOSS.md", "/HEARTBEAT.md", "/docs/", "/orgs/", "/queue/", "/ledgers/", "/traces/", "/memory/", "/dashboards/", "/handoffs/", "/governance/", "/agents/", "/skills/")
PUBLIC_KEY_PATTERN = re.compile(r"ssh-ed25519 ([A-Za-z0-9+/]+={0,3})(?: [^ \r\n][^\r\n]*)?")
RP_ORIGIN_PATTERN = re.compile(r"^https://[a-z0-9][a-z0-9.-]*$")
STATE_ROOT = "/var/lib/kb/state"
EMPTY_CONTROL_PLANE = b'{"version":1,"nextEventCursor":1,"proposals":[],"runs":[],"stages":[],"attempts":[],"sessions":[],"humanRequests":[],"events":[],"stageGenerations":[],"reviewLoops":[],"reviewReceipts":[],"generationSupersessions":[],"quarantine":[]}\n'


def validate_rp_origin(value: str) -> None:
    if RP_ORIGIN_PATTERN.fullmatch(value) is None:
        raise ValueError("dashboard RP origin is invalid")


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


def unit_fragment_source(rp_origin: str | None, webauthn_credentials: str | None = None) -> bytes:
    source = (Path(__file__).resolve().parent / "systemd/kb-dashboard.service").read_bytes()
    if rp_origin is None and webauthn_credentials is None:
        return source
    if rp_origin is not None:
        validate_rp_origin(rp_origin)
    if webauthn_credentials is not None:
        validate_webauthn_credentials(webauthn_credentials)
    extra = b""
    if rp_origin is not None:
        extra += f"Environment=DASHBOARD_RP_ORIGIN={rp_origin}\n".encode("ascii")
    if webauthn_credentials is not None:
        canonical_credentials = json.dumps(json.loads(webauthn_credentials), separators=(",", ":"))
        assignment = shlex.quote(f"DASHBOARD_WEBAUTHN_CREDENTIALS={canonical_credentials}")
        extra += f"Environment={assignment}\n".encode("ascii")
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
    run=subprocess.run,
    install_root: PurePosixPath = PurePosixPath("/usr/local/lib/kb"),
    rp_origin: str | None = None,
    webauthn_credentials: str | None = None,
) -> None:
    if rp_origin is not None:
        validate_rp_origin(rp_origin)
    if webauthn_credentials is not None:
        validate_webauthn_credentials(webauthn_credentials)
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
        unit_source = deploy_root / "systemd/kb-dashboard.service"
        unit_descriptor: int | None = None
        unit_generated: Path | None = None
        if rp_origin is not None or webauthn_credentials is not None:
            unit_descriptor, unit_generated_name = tempfile.mkstemp(prefix="kb-dashboard-service-")
            unit_generated = Path(unit_generated_name)
            with os.fdopen(unit_descriptor, "wb") as output:
                output.write(unit_fragment_source(rp_origin, webauthn_credentials))
            unit_generated.chmod(0o400)
            unit_source = unit_generated
        try:
            run(["install", "-o", "root", "-g", "root", "-m", "0444", str(unit_source), "/etc/systemd/system/kb-dashboard.service"], check=True)
        finally:
            if unit_generated is not None:
                unit_generated.chmod(0o600)
                unit_generated.unlink(missing_ok=True)
        run(["systemctl", "daemon-reload"], check=True)
        run(["systemctl", "enable", "kb-dashboard.service"], check=True)
    finally:
        if generated.exists():
            generated.chmod(0o600)
        generated.unlink(missing_ok=True)


def bootstrap(ops_bundle: Path, release_public_key: Path, run=subprocess.run, rp_origin: str | None = None, webauthn_credentials: str | None = None) -> None:
    if rp_origin is not None:
        validate_rp_origin(rp_origin)
    if webauthn_credentials is not None:
        validate_webauthn_credentials(webauthn_credentials)
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
    if rp_origin is None and webauthn_credentials is None:
        install_root_validators(release_public_key, run=run)
    else:
        install_root_validators(release_public_key, run=run, rp_origin=rp_origin, webauthn_credentials=webauthn_credentials)


def main() -> int:
    parser = argparse.ArgumentParser(description="Perform the one-time kb VM bootstrap")
    parser.add_argument("--ops-bundle", type=Path, required=True)
    parser.add_argument("--release-public-key", type=Path, required=True)
    parser.add_argument("--rp-origin")
    parser.add_argument("--webauthn-credentials")
    args = parser.parse_args()
    bootstrap(args.ops_bundle, args.release_public_key, rp_origin=args.rp_origin, webauthn_credentials=args.webauthn_credentials)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
