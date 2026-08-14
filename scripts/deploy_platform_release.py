from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import re
import secrets
import subprocess
from pathlib import Path


ATTESTATION_KEYS = {"archive", "schema", "sha256", "sourceCommit", "workflow"}


def parse_local_attestation(attestation: Path, archive: Path) -> dict[str, str]:
    raw = attestation.read_bytes()
    value = json.loads(raw)
    if type(value) is not dict or set(value) != ATTESTATION_KEYS or any(type(value[key]) is not str for key in ATTESTATION_KEYS):
        raise RuntimeError("closed canonical attestation required")
    canonical = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if raw != canonical or value["schema"] != "kb.release-attestation/v1" or value["workflow"] != "kb-platform-release":
        raise RuntimeError("closed canonical attestation required")
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
