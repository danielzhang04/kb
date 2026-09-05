from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import re
import secrets
import subprocess
import sys
from pathlib import Path

if __package__ in {None, ""}:  # direct `python scripts/deploy_platform_release.py` execution
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deploy.control_plane_schema import (
    RELEASE_ATTESTATION_KEYS,
    RELEASE_ATTESTATION_SCHEMA,
    ROLLBACK_STATE_SCHEMA,
    STATE_MIGRATION,
    STATE_SCHEMA,
)

V1_ATTESTATION_KEYS = frozenset({"archive", "schema", "sha256", "sourceCommit", "workflow"})
V2_ATTESTATION_KEYS = frozenset(RELEASE_ATTESTATION_KEYS)
STATE_MIGRATIONS = frozenset({"compatible", "breaking"})
CANONICAL_DECIMAL = re.compile(r"(?:0|[1-9][0-9]*)")
# The daemon runs `git worktree add` for every attempt, so ITS umask decides whether the kb-shell worker
# can write in the run worktree it was handed; at systemd's default 0022 git writes 2755/644 and every
# worker write fails. deploy/systemd/kb-dashboard.service ships UMask=0002 and
# deploy/validate_vm_runtime.py asserts it - but the resident copy of that validator at
# /usr/local/lib/kb is refreshed ONLY by `bootstrap_vm.py converge`, never by a release deploy, so on a
# VM that has not converged the validator on the box still has no UMask rule. THIS script is the only
# guard guaranteed to be as current as the repo, so it probes the live unit before uploading anything.
DASHBOARD_UMASK_PROBE = ["systemctl", "show", "kb-dashboard", "-p", "UMask", "--value"]
EXPECTED_DASHBOARD_UMASK = "0002"
# W70 (Gate 4b run 3): the BROKER's UMask needs the same guard, for the same reason - its children
# (codex/claude workers) `mkdir -p` under the 2775 setgid run worktree, and at 0022 those dirs come out
# 2755 kb-shell:kb-shell, which the daemon (uid kb-dashboard, group kb-shell) cannot unlink during
# `git worktree remove --force`.
BROKER_UMASK_PROBE = ["systemctl", "show", "kb-shell-broker", "-p", "UMask", "--value"]
EXPECTED_BROKER_UMASK = "0002"


def parse_local_attestation(attestation: Path, archive: Path) -> dict[str, str]:
    raw = attestation.read_bytes()
    value = json.loads(raw)
    if type(value) is not dict:
        raise RuntimeError("closed canonical attestation required")
    keys = set(value)
    if keys == V1_ATTESTATION_KEYS:
        expected_schema = "kb.release-attestation/v1"
    elif keys == V2_ATTESTATION_KEYS:
        expected_schema = RELEASE_ATTESTATION_SCHEMA
    else:
        raise RuntimeError("closed canonical attestation required")
    if any(type(value[key]) is not str for key in keys):
        raise RuntimeError("closed canonical attestation required")
    canonical = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if raw != canonical or value["schema"] != expected_schema or value["workflow"] != "kb-platform-release":
        raise RuntimeError("closed canonical attestation required")
    if keys == V2_ATTESTATION_KEYS:
        if (
            CANONICAL_DECIMAL.fullmatch(value["stateSchema"]) is None
            or CANONICAL_DECIMAL.fullmatch(value["rollbackStateSchema"]) is None
            or value["stateMigration"] not in STATE_MIGRATIONS
            or value["stateSchema"] != STATE_SCHEMA
            or value["rollbackStateSchema"] != ROLLBACK_STATE_SCHEMA
            or value["stateMigration"] != STATE_MIGRATION
        ):
            raise RuntimeError("attestation registry metadata mismatch")
    commit = value["sourceCommit"]
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None or value["archive"] != f"kb-platform-{commit}.tar.gz":
        raise RuntimeError("attestation identity mismatch")
    if archive.name != value["archive"] or re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is None:
        raise RuntimeError("attestation identity mismatch")
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if not hmac.compare_digest(value["sha256"], actual):
        raise RuntimeError("release digest mismatch")
    return value


def assert_dashboard_umask(host: str, run=subprocess.run) -> None:
    """Refuse the deploy unless the LIVE kb-dashboard AND kb-shell-broker units already carry UMask=0002.

    Read-only and fail-closed: an unreadable value, a systemd default 0022, or anything else refuses.
    Fixing it is the unit-install ceremony in docs/runbooks/2026-09-03-vm-agent-launch-preflight.md d1,
    which a release deploy does not perform (it never writes /etc/systemd/system/kb-dashboard.service
    or kb-shell-broker.service). The broker check exists for the same reason as the dashboard's: its
    codex/claude worker children `mkdir -p` under the 2775 setgid run worktree, and at the systemd
    default 0022 those dirs come out 2755 kb-shell:kb-shell, which the daemon (uid kb-dashboard, group
    kb-shell) cannot unlink during `git worktree remove --force`.
    """
    for unit_label, probe, expected, rationale in (
        ("kb-dashboard", DASHBOARD_UMASK_PROBE, EXPECTED_DASHBOARD_UMASK,
         "every worker write inside the run worktree fails without it (the daemon's own "
         "`git worktree add` sets the tree's modes)"),
        ("kb-shell-broker", BROKER_UMASK_PROBE, EXPECTED_BROKER_UMASK,
         "the daemon cannot clean up worker-created directories without it "
         "(`git worktree remove --force` fails EACCES on the worker's own dirs)"),
    ):
        result = run(["ssh", host, *probe], check=True, text=True, capture_output=True)
        value = (result.stdout or "").strip()
        if value != expected:
            raise RuntimeError(
                f"refusing to deploy: {unit_label} UMask is {value!r}, must be {expected} - {rationale}. "
                "Install the unit and reload systemd first - see "
                "docs/runbooks/2026-09-03-vm-agent-launch-preflight.md section d1."
            )


def deploy(archive: Path, attestation: Path, signing_key: Path, host: str, run=subprocess.run) -> None:
    signed = parse_local_attestation(attestation, archive)
    signature = attestation.with_suffix(attestation.suffix + ".sig")
    signature.unlink(missing_ok=True)
    run(["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", "kb-release", str(attestation)], check=True)
    # Before ANY byte reaches the VM, and so long before the activation this would otherwise fail inside.
    assert_dashboard_umask(host, run=run)
    upload_id = secrets.token_hex(16)
    remote = f"/var/tmp/kb-release-upload/{upload_id}"
    run(["ssh", host, "install", "-d", "-m", "0700", remote], check=True)
    try:
        run(["scp", "--", str(archive), f"{host}:{remote}/release.tar.gz"], check=True)
        run(["scp", "--", str(attestation), f"{host}:{remote}/attestation.json"], check=True)
        run(["scp", "--", str(signature), f"{host}:{remote}/attestation.json.sig"], check=True)
        run(["ssh", host, "sudo", "python3", "/usr/local/lib/kb/activate_release.py", "activate", "--upload-dir", remote], check=True)
    finally:
        run(["ssh", host, "rm", "-rf", "--", remote], check=False)
    version = signed["sourceCommit"]
    print(f"activated {version}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sign and deploy a kb platform release")
    parser.add_argument("archive", type=Path)
    parser.add_argument("attestation", type=Path)
    parser.add_argument("--signing-key", type=Path, required=True)
    parser.add_argument("--host", required=True)
    args = parser.parse_args()
    deploy(args.archive, args.attestation, args.signing_key, args.host)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
