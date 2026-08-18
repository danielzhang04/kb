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
EXPECTED_UNIT_ENV = {"DASHBOARD_PLATFORM_ROOT", "PYTHONPATH", "DASHBOARD_REPO_ROOT", "DASHBOARD_STATE_ROOT", "DASHBOARD_EXECUTION_ACTIVATED", "KB_COORDINATION_PUBLICATION", "KB_VM_RUNTIME", "GIT_CONFIG_GLOBAL"}
OPTIONAL_UNIT_ENV = {"DASHBOARD_RP_ORIGIN", "DASHBOARD_WEBAUTHN_CREDENTIALS"}
RP_ORIGIN_PATTERN = re.compile(r"^https://[a-z0-9][a-z0-9.-]*$")
BASE64URL_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
TRANSPORT_PATTERN = re.compile(r"^[a-z-]{1,32}$")
# This carries public verification material, not a secret, and is shape-validated below.
SANCTIONED_PUBLIC_KEY_ENV = frozenset({"DASHBOARD_WEBAUTHN_CREDENTIALS"})
STATIC_SHOW = {"Id", "Names", "Slice", "FragmentPath", "DropInPaths", "User", "Group", "ExecStart", "WorkingDirectory", "EnvironmentFiles", "UnsetEnvironment", "KillMode", "ReadOnlyPaths", "ReadWritePaths"}
LIVE_SHOW = {"ControlGroup", "MainPID"}
COMMAND_TIMEOUT = 30


def validate_environment(env: dict[str, str]) -> None:
    present = sorted(name for name in env if name in FORBIDDEN_ENV or (name not in SANCTIONED_PUBLIC_KEY_ENV and CREDENTIAL_ENV_NAME.search(name)))
    if present:
        raise RuntimeError("forbidden VM credential channel: " + ",".join(present))
    if "DASHBOARD_WEBAUTHN_CREDENTIALS" in env:
        validate_webauthn_credentials(env["DASHBOARD_WEBAUTHN_CREDENTIALS"])


def validate_webauthn_credentials(value: str) -> None:
    if "\r" in value or "\n" in value:
        raise RuntimeError("dashboard WebAuthn credentials must not contain line breaks")
    try:
        credentials = json.loads(value)
    except json.JSONDecodeError as error:
        raise RuntimeError("dashboard WebAuthn credentials are not valid JSON") from error
    if not isinstance(credentials, list):
        raise RuntimeError("dashboard WebAuthn credentials must be a JSON array")
    if not 1 <= len(credentials) <= 8:
        raise RuntimeError("dashboard WebAuthn credentials must contain 1 to 8 entries")
    for index, credential in enumerate(credentials):
        if not isinstance(credential, dict):
            raise RuntimeError(f"dashboard WebAuthn credential {index} must be an object")
        extra = sorted(set(credential).difference({"id", "publicKey", "counter", "transports"}))
        if extra:
            raise RuntimeError(f"dashboard WebAuthn credential {index} has unsupported keys: " + ",".join(extra))
        missing = sorted({"id", "publicKey"}.difference(credential))
        if missing:
            raise RuntimeError(f"dashboard WebAuthn credential {index} is missing required keys: " + ",".join(missing))
        for name, minimum, maximum in (("id", 16, 256), ("publicKey", 32, 512)):
            field = credential[name]
            if isinstance(field, str) and "=" in field:
                raise RuntimeError(f"dashboard WebAuthn credential {index} {name} base64url padding is not allowed")
            if not isinstance(field, str) or not minimum <= len(field) <= maximum or BASE64URL_PATTERN.fullmatch(field) is None:
                raise RuntimeError(f"dashboard WebAuthn credential {index} {name} must be a {minimum}..{maximum}-character base64url string")
        if "counter" in credential and (not isinstance(credential["counter"], int) or isinstance(credential["counter"], bool) or credential["counter"] < 0):
            raise RuntimeError(f"dashboard WebAuthn credential {index} counter must be a non-negative integer")
        if "transports" in credential:
            transports = credential["transports"]
            if not isinstance(transports, list) or len(transports) > 8 or any(not isinstance(transport, str) or TRANSPORT_PATTERN.fullmatch(transport) is None for transport in transports):
                raise RuntimeError(f"dashboard WebAuthn credential {index} transports must be an array of at most 8 short strings")


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
    forbidden = sorted(name for name in assigned if name in FORBIDDEN_ENV or (name not in SANCTIONED_PUBLIC_KEY_ENV and CREDENTIAL_ENV_NAME.search(name)))
    if forbidden:
        raise RuntimeError("dashboard unit assigns a forbidden credential name: " + ",".join(forbidden))
    if not EXPECTED_UNIT_ENV.issubset(assigned) or not assigned.difference(EXPECTED_UNIT_ENV).issubset(OPTIONAL_UNIT_ENV):
        raise RuntimeError("dashboard unit environment assignment set is not closed")
    if "DASHBOARD_RP_ORIGIN" in environment and RP_ORIGIN_PATTERN.fullmatch(environment["DASHBOARD_RP_ORIGIN"]) is None:
        raise RuntimeError("dashboard unit RP origin is invalid")
    if "DASHBOARD_WEBAUTHN_CREDENTIALS" in environment:
        validate_webauthn_credentials(environment["DASHBOARD_WEBAUTHN_CREDENTIALS"])
    unset = set(show["UnsetEnvironment"].split())
    missing = sorted(FORBIDDEN_ENV.difference(unset))
    if missing:
        raise RuntimeError("dashboard unit does not unset credential channels: " + ",".join(missing))
    if environment["KB_COORDINATION_PUBLICATION"] != "outbox":
        raise RuntimeError("dashboard unit must select local outbox publication")
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
        fields = STATIC_SHOW
    else:
        show = read_live_unit(args.unit)
        validate_live_unit(show)
        fields = LIVE_SHOW
    print(f"validated VM runtime {args.phase} fields: " + ",".join(sorted(fields)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
