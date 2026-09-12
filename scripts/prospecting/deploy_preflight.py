from __future__ import annotations

from dataclasses import dataclass
import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    code: str


class ProbeError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class Environment:
    root: Path
    merged: Callable[[], bool]
    gates: Callable[[], tuple[str, ...]]
    version: Callable[[str], str]
    tailscale: Callable[[], bool]
    ssh_noop: Callable[[], bool]
    secret_scan: Callable[[], tuple[int, str]]


def check(env: Environment) -> tuple[Check, ...]:
    expected = {"python": "3.13.7", "datasette": "0.65.1", "playwright": "1.55.0"}

    def probe(name, callback, passed_code, failed_code) -> Check:
        try:
            ok = callback()
        except ProbeError as error:
            return Check(name, False, error.code)
        except OSError:
            return Check(name, False, "subprocess_error")
        except Exception:
            return Check(name, False, "probe_error")
        return Check(name, bool(ok), passed_code if ok else failed_code)

    results = [
        probe("merged", env.merged, "ok", "branch_not_merged"),
        probe(
            "gates", lambda: env.gates() == ("P1", "P2", "P3", "P4", "P5"),
            "recorded_gate_set", "recorded_gate_set",
        ),
    ]
    for name, wanted in expected.items():
        results.append(probe(
            name, lambda name=name, wanted=wanted: env.version(name) == wanted,
            "version_match", "version_mismatch",
        ))
    results.extend([
        probe("tailscale", env.tailscale, "peer_reachable", "peer_unreachable"),
        probe("desktop_ssh", env.ssh_noop, "fixed_noop", "ssh_noop_failed"),
    ])
    try:
        exit_code, stdout = env.secret_scan()
    except OSError:
        results.append(Check("tracked_secrets", False, "subprocess_error"))
    except Exception:
        results.append(Check("tracked_secrets", False, "probe_error"))
    else:
        if exit_code == 0:
            results.append(Check("tracked_secrets", False, "secret_paths_found"))
        elif exit_code == 1:
            results.append(Check("tracked_secrets", True, "paths_only_scan"))
        else:
            results.append(Check("tracked_secrets", False, "scan_error"))
    return tuple(results)


def _run(argv, **kwargs):
    return subprocess.run(argv, **kwargs)


def production(root: Path, desktop_host: str, expected_merge_sha: str, runner=_run) -> Environment:
    def run(argv):
        return runner(argv, cwd=root, text=True, capture_output=True, check=False, shell=False)

    def checked_run(argv):
        result = run(argv)
        if result.returncode != 0:
            raise ProbeError(f"subprocess_exit_{result.returncode}")
        return result

    def merged():
        branch = checked_run(["git", "branch", "--show-current"]).stdout.strip()
        head = checked_run(["git", "rev-parse", "HEAD"]).stdout.strip()
        checked_run(
            ["git", "merge-base", "--is-ancestor", expected_merge_sha, "HEAD"]
        )
        return branch == "ops" and head == expected_merge_sha

    def gates():
        names = []
        for phase in ("P1", "P2", "P3", "P4", "P5"):
            result = checked_run([
                "py", "-3", "-m", "scripts.prospecting.gate", "--phase", phase, "--verify-recorded",
            ])
            try:
                value = json.loads(result.stdout)
            except json.JSONDecodeError:
                raise ProbeError("record_verify_error")
            if not isinstance(value, dict):
                raise ProbeError("record_verify_error")
            if value.get("phase") != phase or value.get("status") != "passed":
                raise ProbeError("record_verify_error")
            names.append(phase)
        return tuple(names)

    def version(name):
        argv = {
            "python": ["py", "-3", "--version"],
            "datasette": ["datasette", "--version"],
            "playwright": ["py", "-3", "-m", "playwright", "--version"],
        }[name]
        match = re.search(r"\d+(?:\.\d+)+", checked_run(argv).stdout)
        if match is None:
            raise ProbeError("version_parse_error")
        return match.group(0)

    def tailscale():
        result = checked_run(["tailscale", "status", "--json"])
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            raise ProbeError("tailscale_json_error")
        if not isinstance(payload, dict) or not isinstance(payload.get("Peer", {}), dict):
            raise ProbeError("tailscale_json_error")
        peers = payload.get("Peer", {}).values()
        return any(peer.get("HostName") == desktop_host and peer.get("Online") is True for peer in peers)

    def ssh_noop():
        checked_run(["ssh", "--", desktop_host, "py", "-3", "-c", "raise SystemExit(0)"])
        return True

    def secret_scan():
        result = run([
            "git", "grep", "-Iil", "-E",
            "(API_KEY|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)[[:space:]]*=|"
            "-----BEGIN[[:space:]]+(RSA[[:space:]]+)?PRIVATE[[:space:]]+KEY-----|"
            "-----BEGIN[[:space:]]+OPENSSH[[:space:]]+PRIVATE[[:space:]]+KEY-----|"
            "BEGIN[[:space:]]+OPENSSH|token=|api_key|secret",
            "--",
        ])
        return result.returncode, result.stdout

    return Environment(root, merged, gates, version, tailscale, ssh_noop, secret_scan)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--desktop-host", required=True)
    parser.add_argument("--expected-merge-sha", required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    results = check(production(args.root, args.desktop_host, args.expected_merge_sha))
    print(json.dumps(
        {"ready": all(item.ok for item in results),
         "checks": [{"name": i.name, "ok": i.ok, "code": i.code} for i in results]},
        sort_keys=True, separators=(",", ":"),
    ))
    return 0 if all(item.ok for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
