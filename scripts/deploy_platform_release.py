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


def deploy(archive: Path, attestation: Path, signing_key: Path, host: str, run=subprocess.run) -> None:
    signed = parse_local_attestation(attestation, archive)
    signature = attestation.with_suffix(attestation.suffix + ".sig")
    signature.unlink(missing_ok=True)
    run(["ssh-keygen", "-Y", "sign", "-f", str(signing_key), "-n", "kb-release", str(attestation)], check=True)
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
