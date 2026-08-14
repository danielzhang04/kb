from __future__ import annotations

import argparse
import base64
import binascii
import os
import re
import subprocess
import tempfile
from pathlib import Path, PurePosixPath


DATA_PATTERNS = ("/CLAUDE.md", "/BOSS.md", "/HEARTBEAT.md", "/docs/", "/orgs/", "/queue/", "/ledgers/", "/traces/", "/memory/", "/dashboards/", "/handoffs/", "/governance/", "/agents/", "/skills/")
PUBLIC_KEY_PATTERN = re.compile(r"ssh-ed25519 [A-Za-z0-9+/]+={0,3}")


def public_key_module_source(public_key: str) -> str:
    if "PRIVATE KEY" in public_key or PUBLIC_KEY_PATTERN.fullmatch(public_key) is None:
        raise ValueError("release public key must be one unadorned ssh-ed25519 public key")
    encoded = public_key.split(" ", 1)[1]
    try:
        blob = base64.b64decode(encoded, validate=True)
    except binascii.Error as error:
        raise ValueError("release public key must be one unadorned ssh-ed25519 public key") from error
    expected_prefix = len(b"ssh-ed25519").to_bytes(4, "big") + b"ssh-ed25519" + (32).to_bytes(4, "big")
    if len(blob) != len(expected_prefix) + 32 or not blob.startswith(expected_prefix):
        raise ValueError("release public key must be one unadorned ssh-ed25519 public key")
    return f"RELEASE_PUBLIC_KEY = {public_key!r}\n"


def install_root_validators(
    release_public_key: Path,
    run=subprocess.run,
    install_root: PurePosixPath = PurePosixPath("/usr/local/lib/kb"),
) -> None:
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
        run(["install", "-o", "root", "-g", "root", "-m", "0444", str(deploy_root / "systemd/kb-dashboard.service"), "/etc/systemd/system/kb-dashboard.service"], check=True)
        run(["systemctl", "daemon-reload"], check=True)
        run(["systemctl", "enable", "kb-dashboard.service"], check=True)
    finally:
        if generated.exists():
            generated.chmod(0o600)
        generated.unlink(missing_ok=True)


def bootstrap(ops_bundle: Path, release_public_key: Path, run=subprocess.run) -> None:
    run(["systemctl", "disable", "--now", "kb-dashboard.service"], check=False)
    run(["useradd", "--system", "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin", "kb-dashboard"], check=False)
    run(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", "/opt/kb-releases"], check=True)
    for path in ("/var/lib/kb/ops", "/var/lib/kb/state", "/var/lib/kb/state/outbox/ready", "/var/lib/kb/state/outbox/receipts", "/var/lib/kb/state/outbox/incoming"):
        run(["install", "-d", "-o", "kb-dashboard", "-g", "kb-dashboard", path], check=True)
    run(["install", "-d", "-o", "root", "-g", "root", "-m", "0700", "/var/lib/kb-release-staging"], check=True)
    run(["git", "clone", "--branch", "ops", "--no-checkout", str(ops_bundle), "/var/lib/kb/ops"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "sparse-checkout", "set", "--no-cone", *DATA_PATTERNS], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "checkout", "ops"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "update-ref", "refs/kb-outbox/spooled", "HEAD"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "origin", "disabled://desktop-promotion-only"], check=True)
    run(["git", "-C", "/var/lib/kb/ops", "remote", "set-url", "--push", "origin", "disabled://desktop-promotion-only"], check=True)
    run(["chown", "-R", "kb-dashboard:kb-dashboard", "/var/lib/kb/ops", "/var/lib/kb/state"], check=True)
    install_root_validators(release_public_key, run=run)


def main() -> int:
    parser = argparse.ArgumentParser(description="Perform the one-time kb VM bootstrap")
    parser.add_argument("--ops-bundle", type=Path, required=True)
    parser.add_argument("--release-public-key", type=Path, required=True)
    args = parser.parse_args()
    bootstrap(args.ops_bundle, args.release_public_key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
