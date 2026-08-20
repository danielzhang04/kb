#!/usr/bin/env python3
"""Back up and restore-drill KB tier-zero state from a trusted desktop."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import posixpath
import re
import secrets
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Callable

from deploy.control_plane_schema import assert_control_plane_schema


BACKUP_REPORT_KEYS = {
    "version", "operation", "startedAt", "finishedAt", "durationSeconds", "snapshot",
    "archiveSha256", "quiescentExport", "gitFsck", "invariants", "booted", "rpoMet",
    "rtoMet", "verified",
}
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
OUTBOX_MANIFEST_KEYS = {"schema", "id", "parent", "commit", "paths", "createdAt", "bundleSha256"}
PROMOTION_RECEIPT_KEYS = {"schema", "id", "sourceCommit", "promotedCommit", "promotedAt"}


def run_command(argv: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, check=False, capture_output=True, text=True)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise RuntimeError("snapshot time must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _require_success(result: subprocess.CompletedProcess[str], operation: str) -> None:
    if result.returncode != 0:
        raise RuntimeError(f"{operation} failed")


def backup(
    host: str,
    output: Path,
    rpo_minutes: int = 15,
    run=run_command,
    now=utc_now,
    remote_export_script: str = "/usr/local/lib/kb/export_tier0.py",
) -> dict:
    started = now()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / "kb-tier0.tar"
    export_id = secrets.token_hex(16)
    remote = f"/var/tmp/kb-tier0-{export_id}.tar"
    result = run([
        "ssh", host, "sudo", "python3", remote_export_script,
        "--output", remote,
    ])
    _require_success(result, "remote tier-zero export")
    result = run(["scp", f"{host}:{remote}", str(archive)])
    _require_success(result, "tier-zero transfer")
    result = run(["ssh", host, "sudo", "rm", "--", remote])
    _require_success(result, "remote tier-zero cleanup")
    digest = sha256_file(archive)
    result = run(["restic", "backup", str(archive), "--tag", "kb-tier0"])
    _require_success(result, "restic backup")
    result = run(["restic", "snapshots", "--tag", "kb-tier0", "--latest", "1", "--json"])
    _require_success(result, "restic snapshot lookup")
    snapshots = json.loads(result.stdout)
    if not isinstance(snapshots, list) or len(snapshots) != 1 or type(snapshots[0]) is not dict:
        raise RuntimeError("one latest tier-zero snapshot is required")
    latest = snapshots[-1]
    if type(latest.get("short_id")) is not str or type(latest.get("time")) is not str:
        raise RuntimeError("latest tier-zero snapshot identity is invalid")
    age = (now() - parse_utc(latest["time"])).total_seconds() / 60
    finished = now()
    return make_report(
        "backup", latest["short_id"], digest, started, finished,
        quiescentExport=True, rpoMet=age <= rpo_minutes,
    )


def safe_extract(archive_path: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive_path, "r:") as archive:
        members = archive.getmembers()
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or member.isdev() or member.isfifo() or member.islnk():
                raise RuntimeError("unsafe tier-zero archive member")
            if member.issym():
                normalized = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
                if normalized == ".." or normalized.startswith("../") or posixpath.isabs(member.linkname):
                    raise RuntimeError("tier-zero symlink escapes isolated root")
            elif not (member.isfile() or member.isdir()):
                raise RuntimeError("unsupported tier-zero archive member")
        archive.extractall(target, members=members, filter="data")


def restore_latest_snapshot(target: Path, run=run_command) -> tuple[str, Path, str]:
    if target.exists():
        raise RuntimeError("restore target must be fresh")
    staging = target.with_name(target.name + "-restic")
    if staging.exists():
        raise RuntimeError("restic staging target must be fresh")
    result = run(["restic", "snapshots", "--tag", "kb-tier0", "--latest", "1", "--json"])
    _require_success(result, "restic snapshot lookup")
    snapshots = json.loads(result.stdout)
    if not isinstance(snapshots, list) or len(snapshots) != 1 or type(snapshots[0]) is not dict:
        raise RuntimeError("one latest tier-zero snapshot is required")
    snapshot = snapshots[0].get("short_id")
    if type(snapshot) is not str or not snapshot:
        raise RuntimeError("latest tier-zero snapshot identity is invalid")
    result = run(["restic", "restore", snapshot, "--target", str(staging)])
    _require_success(result, "restic restore")
    archives = list(staging.rglob("kb-tier0.tar"))
    if len(archives) != 1 or archives[0].is_symlink() or not archives[0].is_file():
        raise RuntimeError("restored snapshot must contain one regular tier-zero archive")
    return snapshot, archives[0], sha256_file(archives[0])


def restore_drill(
    target: Path,
    rto_minutes: int = 60,
    report_path: Path | None = None,
    run=run_command,
    monotonic=time.monotonic,
    restore=restore_latest_snapshot,
    extract=safe_extract,
    verify=None,
    now=utc_now,
) -> dict:
    verify = verify or verify_restored_tree
    started_tick = monotonic()
    started_at = now()
    snapshot, archive, digest = restore(target, run)
    extract(archive, target)
    checks = verify(target, run=run)
    duration = monotonic() - started_tick
    finished_at = now()
    report = make_report(
        "restore-drill", snapshot, digest, started_at, finished_at,
        durationSeconds=duration, rtoMet=duration <= rto_minutes * 60, **checks,
    )
    if report_path is not None:
        write_canonical_exclusive(report_path, report)
    if not report["rtoMet"]:
        raise RuntimeError("restore drill exceeded RTO")
    if not report["verified"]:
        raise RuntimeError("restore drill verification failed")
    return report


def verify_restored_tree(target: Path, run=run_command) -> dict[str, bool]:
    ops = target / "var/lib/kb/ops"
    try:
        fsck = run(["git", "-C", str(ops), "fsck", "--full", "--strict", "--no-dangling"]).returncode == 0
    except OSError:
        fsck = False
    invariants = (
        validate_release_links(target)
        and validate_ops_head(ops, run=run)
        and validate_state_json(target)
        and validate_outbox_manifests_receipts(target)
    )
    unit = "kb-restore-drill-" + secrets.token_hex(8)
    port = "14317"
    started = False
    boot = False
    try:
        release = resolve_restored_release(target)
        started = run([
            "systemd-run", f"--unit={unit}", f"--working-directory={release / 'dashboard'}",
            "--property=KillMode=control-group", "--property=NoNewPrivileges=yes",
            f"--setenv=DASHBOARD_SERVICE_UNIT={unit}",
            f"--setenv=DASHBOARD_PLATFORM_ROOT={release}", f"--setenv=PYTHONPATH={release}",
            "--setenv=DASHBOARD_EXECUTION_ACTIVATED=0", f"--setenv=DASHBOARD_REPO_ROOT={ops}",
            f"--setenv=DASHBOARD_STATE_ROOT={target / 'var/lib/kb/state'}", f"--setenv=DASHBOARD_PORT={port}",
            "/usr/bin/node", "--experimental-strip-types", str(release / "dashboard/server/index.ts"),
        ]).returncode == 0
        boot = started and wait_for_locked_readiness(f"http://127.0.0.1:{port}/readyz", run=run)
    except (OSError, RuntimeError, UnicodeError, ValueError):
        boot = False
    finally:
        if started:
            try:
                run(["systemctl", "stop", unit])
            except OSError:
                boot = False
    return {"gitFsck": fsck, "invariants": invariants, "booted": boot}


def decide_restore(checks: dict[str, bool]) -> bool:
    return checks == {"gitFsck": True, "invariants": True, "booted": True}


def make_report(
    operation: str,
    snapshot: str,
    digest: str,
    started_at: datetime,
    finished_at: datetime,
    **values,
) -> dict:
    if operation not in {"backup", "restore-drill"} or not snapshot or DIGEST_RE.fullmatch(digest) is None:
        raise RuntimeError("backup report identity is invalid")
    duration = float(values.pop("durationSeconds", (finished_at - started_at).total_seconds()))
    checks = {
        "quiescentExport": bool(values.pop("quiescentExport", True)),
        "gitFsck": bool(values.pop("gitFsck", False)),
        "invariants": bool(values.pop("invariants", False)),
        "booted": bool(values.pop("booted", False)),
        "rpoMet": bool(values.pop("rpoMet", operation == "restore-drill")),
        "rtoMet": bool(values.pop("rtoMet", operation == "backup")),
    }
    if values:
        raise RuntimeError("unknown backup report field")
    verified = checks["quiescentExport"] and (
        checks["rpoMet"]
        if operation == "backup"
        else checks["gitFsck"] and checks["invariants"] and checks["booted"] and checks["rtoMet"]
    )
    report = {
        "version": 1,
        "operation": operation,
        "startedAt": started_at.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "finishedAt": finished_at.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "durationSeconds": duration,
        "snapshot": snapshot,
        "archiveSha256": digest,
        **checks,
        "verified": verified,
    }
    if set(report) != BACKUP_REPORT_KEYS or duration < 0:
        raise RuntimeError("closed backup report required")
    return report


def write_canonical_exclusive(path: Path, value: dict) -> None:
    if path.exists():
        raise RuntimeError("backup report output already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _release_link(releases: Path, name: str) -> Path:
    link = releases / name
    if not os.path.lexists(link) or not link.is_symlink():
        raise RuntimeError(f"release {name} symlink is absent")
    try:
        selected = link.resolve(strict=True)
    except OSError as error:
        raise RuntimeError(f"release {name} symlink is dangling") from error
    root = releases.resolve(strict=True)
    if not _inside(root, selected) or selected.parent != root or selected.is_symlink() or not selected.is_dir():
        raise RuntimeError(f"release {name} symlink escapes the release root")
    return selected


def _validate_release_directory(release: Path) -> None:
    version = release / "VERSION"
    manifest = release / "MANIFEST.sha256"
    if not version.is_file() or version.is_symlink() or not manifest.is_file() or manifest.is_symlink():
        raise RuntimeError("release VERSION or manifest is absent")
    commit = version.read_text(encoding="ascii").strip()
    if COMMIT_RE.fullmatch(commit) is None or release.name != commit:
        raise RuntimeError("release directory name and VERSION disagree")
    rows: dict[str, str] = {}
    for row in manifest.read_text(encoding="utf-8").splitlines():
        try:
            digest, relative = row.split("  ", 1)
        except ValueError as error:
            raise RuntimeError("release manifest row is malformed") from error
        path = Path(relative)
        if (
            DIGEST_RE.fullmatch(digest) is None
            or not relative
            or path.is_absolute()
            or ".." in path.parts
            or relative in rows
        ):
            raise RuntimeError("release manifest entry is invalid")
        rows[relative] = digest
    actual = {
        item.relative_to(release).as_posix()
        for item in release.rglob("*")
        if item.is_file()
        and not item.is_symlink()
        and item.relative_to(release).as_posix() not in {"VERSION", "MANIFEST.sha256"}
    }
    if set(rows) != actual:
        raise RuntimeError("release manifest does not cover exactly the release files")
    for relative, digest in rows.items():
        payload = release / relative
        if (
            not payload.is_file()
            or payload.is_symlink()
            or not hmac.compare_digest(hashlib.sha256(payload.read_bytes()).hexdigest(), digest)
        ):
            raise RuntimeError("release manifest digest mismatch")


def resolve_restored_release(target: Path) -> Path:
    releases = target / "opt/kb-releases"
    if not releases.is_dir() or releases.is_symlink():
        raise RuntimeError("restored release root is absent")
    current = _release_link(releases, "current")
    _validate_release_directory(current)
    return current


def validate_release_links(target: Path) -> bool:
    try:
        current = resolve_restored_release(target)
        previous = target / "opt/kb-releases/previous"
        if os.path.lexists(previous):
            _validate_release_directory(_release_link(previous.parent, "previous"))
        return current.is_dir()
    except (OSError, RuntimeError, UnicodeError, ValueError):
        return False


def validate_ops_head(ops: Path, run=run_command) -> bool:
    try:
        symbolic = run(["git", "-C", str(ops), "symbolic-ref", "-q", "HEAD"])
        head = run(["git", "-C", str(ops), "rev-parse", "--verify", "HEAD^{commit}"])
        branch = run(["git", "-C", str(ops), "rev-parse", "--verify", "refs/heads/ops^{commit}"])
        if symbolic.returncode != 0 or head.returncode != 0 or branch.returncode != 0:
            return False
        if (
            symbolic.stdout.strip() != "refs/heads/ops"
            or head.stdout.strip() != branch.stdout.strip()
            or COMMIT_RE.fullmatch(head.stdout.strip()) is None
        ):
            return False
        for operation in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"):
            git_path = run(["git", "-C", str(ops), "rev-parse", "--git-path", operation])
            operation_path = Path(git_path.stdout.strip())
            if git_path.returncode != 0 or (
                operation_path if operation_path.is_absolute() else ops / operation_path
            ).exists():
                return False
        return True
    except (OSError, RuntimeError, TypeError):
        return False


def _json_object(path: Path) -> dict:
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("JSON file is not a regular file")

    def reject_duplicates(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise RuntimeError("duplicate JSON key")
            value[key] = item
        return value

    value = json.loads(path.read_bytes(), object_pairs_hook=reject_duplicates)
    if type(value) is not dict:
        raise RuntimeError("JSON object is required")
    return value


def validate_state_json(target: Path) -> bool:
    try:
        document = _json_object(target / "var/lib/kb/state/control/control-plane.json")
        assert_control_plane_schema(document)
        runs = document["runs"]
        stages = document["stages"]
        attempts = document["attempts"]
        run_refs = {item.get("runRef") for item in runs if type(item) is dict and type(item.get("runRef")) is str}
        if len(run_refs) != len(runs) or any(not item for item in run_refs):
            return False
        stage_refs = {}
        for stage in stages:
            if (
                type(stage) is not dict
                or type(stage.get("stageRef")) is not str
                or not stage["stageRef"]
                or stage["stageRef"] in stage_refs
                or stage.get("runRef") not in run_refs
            ):
                return False
            stage_refs[stage["stageRef"]] = stage["runRef"]
        attempt_refs = set()
        for attempt in attempts:
            if (
                type(attempt) is not dict
                or type(attempt.get("attemptRef")) is not str
                or not attempt["attemptRef"]
                or attempt["attemptRef"] in attempt_refs
                or attempt.get("runRef") not in run_refs
                or attempt.get("stageRef") not in stage_refs
                or stage_refs[attempt["stageRef"]] != attempt["runRef"]
            ):
                return False
            attempt_refs.add(attempt["attemptRef"])
        return True
    except (OSError, RuntimeError, UnicodeError, ValueError, json.JSONDecodeError):
        return False


def _canonical_utc(value: object) -> bool:
    if type(value) is not str:
        return False
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") == value


def _closed_json(path: Path, keys: set[str]) -> dict:
    value = _json_object(path)
    canonical = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if set(value) != keys or path.read_bytes() != canonical:
        raise RuntimeError("closed canonical JSON is required")
    return value


def validate_outbox_manifests_receipts(target: Path) -> bool:
    try:
        outbox = target / "var/lib/kb/state/outbox"
        ready = outbox / "ready"
        receipts = outbox / "receipts"
        if not ready.is_dir() or ready.is_symlink() or not receipts.is_dir() or receipts.is_symlink():
            return False
        ready_entries = list(ready.iterdir())
        if any(not item.is_file() or item.is_symlink() or item.suffix not in {".json", ".bundle"} for item in ready_entries):
            return False
        manifest_ids = {item.stem for item in ready_entries if item.suffix == ".json"}
        bundle_ids = {item.stem for item in ready_entries if item.suffix == ".bundle"}
        if manifest_ids != bundle_ids:
            return False
        manifests = {}
        for identity in manifest_ids:
            manifest = _closed_json(ready / f"{identity}.json", OUTBOX_MANIFEST_KEYS)
            if any(type(manifest[key]) is not str for key in {"schema", "id", "parent", "commit", "createdAt", "bundleSha256"}):
                return False
            if (
                manifest["schema"] != "kb.ops-outbox/v1"
                or identity != manifest["id"]
                or manifest["id"] != manifest["commit"]
                or COMMIT_RE.fullmatch(identity) is None
                or COMMIT_RE.fullmatch(manifest["parent"]) is None
            ):
                return False
            if (
                type(manifest["paths"]) is not list
                or not manifest["paths"]
                or any(type(path) is not str for path in manifest["paths"])
                or manifest["paths"] != sorted(set(manifest["paths"]))
                or not _canonical_utc(manifest["createdAt"])
                or DIGEST_RE.fullmatch(manifest["bundleSha256"]) is None
            ):
                return False
            bundle_digest = hashlib.sha256((ready / f"{identity}.bundle").read_bytes()).hexdigest()
            if not hmac.compare_digest(bundle_digest, manifest["bundleSha256"]):
                return False
            manifests[identity] = manifest
        receipt_entries = list(receipts.iterdir())
        if any(
            not item.is_file() or item.is_symlink() or item.suffix != ".json" or item.stem not in manifests
            for item in receipt_entries
        ):
            return False
        for receipt_path in receipt_entries:
            receipt = _closed_json(receipt_path, PROMOTION_RECEIPT_KEYS)
            manifest = manifests[receipt_path.stem]
            if any(type(receipt[key]) is not str for key in PROMOTION_RECEIPT_KEYS):
                return False
            if (
                receipt["schema"] != "kb.ops-promotion/v1"
                or receipt["id"] != receipt_path.stem
                or receipt["sourceCommit"] != manifest["commit"]
                or COMMIT_RE.fullmatch(receipt["promotedCommit"]) is None
                or not _canonical_utc(receipt["promotedAt"])
            ):
                return False
        return True
    except (OSError, RuntimeError, UnicodeError, json.JSONDecodeError):
        return False


def wait_for_locked_readiness(
    url: str,
    timeout_seconds: float = 30,
    interval_seconds: float = 0.25,
    run=run_command,
    monotonic=time.monotonic,
    sleep=time.sleep,
) -> bool:
    deadline = monotonic() + timeout_seconds
    while True:
        try:
            response = run(["curl", "--fail", "--silent", "--show-error", url])
        except OSError:
            return False
        try:
            payload = json.loads(response.stdout)
        except (TypeError, json.JSONDecodeError):
            payload = None
        if response.returncode == 0 and payload == {"ok": True, "quiescent": True, "blockers": []}:
            return True
        if monotonic() >= deadline:
            return False
        sleep(interval_seconds)


def _credential_option_present(argv: list[str]) -> bool:
    for argument in argv:
        if not argument.startswith("-"):
            continue
        option = argument.split("=", 1)[0].lower()
        if option in {"-r", "--repo", "--repository", "--password", "--password-file"} or "token" in option:
            return True
    return False


def _positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Back up or restore-drill KB tier-zero runtime state.")
    subparsers = parser.add_subparsers(dest="operation", required=True)
    backup_parser = subparsers.add_parser("backup")
    backup_parser.add_argument("--host", required=True)
    backup_parser.add_argument("--output", required=True, type=Path)
    backup_parser.add_argument("--rpo-minutes", type=_positive_integer, default=15)
    restore_parser = subparsers.add_parser("restore-drill")
    restore_parser.add_argument("--target", required=True, type=Path)
    restore_parser.add_argument("--report", required=True, type=Path)
    restore_parser.add_argument("--rto-minutes", type=_positive_integer, default=60)
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    parser = _parser()
    if _credential_option_present(arguments):
        parser.error("backup credentials must be supplied by the desktop credential manager")
    args = parser.parse_args(arguments)
    if args.operation == "backup":
        report = backup(args.host, args.output, rpo_minutes=args.rpo_minutes)
    else:
        report = restore_drill(
            args.target,
            rto_minutes=args.rto_minutes,
            report_path=args.report,
        )
    sys.stdout.write(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")
    return 0 if report["verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
